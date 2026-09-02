import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-auth";
import { deductStockForItem, restockItem } from "@/lib/sales-ops";
import { exchangeBalance, saleItemNet } from "@/lib/sales";
import type { TablesInsert } from "@/lib/supabase/types";

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

/** GID de variante con la forma que emite Shopify, o null. */
function variantGid(v: unknown): string | null {
  const s = str(v);
  return s && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(s) ? s : null;
}

type ParsedItem = {
  productId: string | null;
  inventoryItemId: string | null;
  variantGid: string | null;
  article: string;
  color: string | null;
  talle: string | null;
  brand: string | null;
  isOtherBrand: boolean;
  qty: number;
  price: number;
  discount: number;
};

function parseItem(raw: unknown, index: number): ParsedItem | { error: string } {
  if (!raw || typeof raw !== "object") return { error: `Prenda ${index + 1}: datos inválidos` };
  const it = raw as Record<string, unknown>;

  const isOtherBrand = Boolean(it.isOtherBrand);
  const article = str(it.article);
  if (!article) return { error: `Prenda ${index + 1}: falta el artículo` };

  const qty = Math.trunc(Number(it.qty));
  if (!Number.isFinite(qty) || qty <= 0) return { error: `Prenda ${index + 1}: cantidad inválida` };

  const price = Number(it.price);
  if (!Number.isFinite(price) || price < 0) return { error: `Prenda ${index + 1}: precio inválido` };

  const discount = Number(it.discount) || 0;
  if (discount < 0 || discount >= 1) return { error: `Prenda ${index + 1}: descuento inválido` };

  return {
    productId: isOtherBrand ? null : str(it.productId),
    inventoryItemId: isOtherBrand ? null : str(it.inventoryItemId),
    variantGid: isOtherBrand ? null : variantGid(it.variantGid),
    article,
    color: str(it.color),
    talle: str(it.talle),
    brand: isOtherBrand ? str(it.brand) : null,
    isOtherBrand,
    qty,
    price,
    discount,
  };
}

/**
 * Cambiar UNA prenda de una compra por una o más prendas nuevas.
 *
 * El modelo de plata es el punto no obvio, y es una decisión de negocio, no una
 * técnica: **el importe de la venta original no baja nunca**. Si lo nuevo sale
 * más caro, el cliente paga la diferencia y esa diferencia se suma a la prenda
 * original (`exchange_adjustment`). Si sale más barato, el sobrante queda a
 * favor del negocio: no se devuelve plata, así que el mes cierra igual.
 *
 * De ahí sale el reparto entre filas, que a primera vista parece redundante:
 *
 * - La prenda ORIGINAL conserva la plata (`counts_revenue` = true) pero pierde
 *   la mercadería (`status` = 'exchanged'): volvió al stock.
 * - Las prendas NUEVAS tienen la mercadería (`status` = 'active') pero NO
 *   facturan (`counts_revenue` = false): esa plata ya entró con la original.
 *
 * Si las nuevas también facturaran, un cambio inflaría el mes al doble.
 *
 * Las prendas nuevas se cuelgan de la MISMA compra: es la misma operación
 * comercial, con otra prenda adentro. Por eso heredan cliente, canal y factura
 * sin copiar nada — están en la misma cabecera.
 *
 * El orden de los pasos importa. La reposición de la prenda vieja va primero
 * porque es la única que puede fallar dejando el inventario mal; recién cuando
 * volvió se marca el cambio y se descuentan las nuevas.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRole(["admin", "vendedor"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const itemId = str(body.itemId);
  if (!itemId) {
    return NextResponse.json({ ok: false, error: "Falta indicar qué prenda se cambia" }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) {
    return NextResponse.json(
      { ok: false, error: "Elegí al menos una prenda para el cambio" },
      { status: 400 },
    );
  }
  if (rawItems.length > 10) {
    return NextResponse.json({ ok: false, error: "Máximo 10 prendas por cambio" }, { status: 400 });
  }

  const items: ParsedItem[] = [];
  for (const [i, raw] of rawItems.entries()) {
    const parsed = parseItem(raw, i);
    if ("error" in parsed) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    items.push(parsed);
  }

  const supaAdmin = createAdminClient();
  const { data: sale, error: fetchErr } = await supaAdmin
    .from("sales")
    .select("id, seller_id, seller_name, sale_discount, notes")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });

  const owned =
    auth.identity.role === "admin" ||
    (Boolean(auth.identity.userId) &&
      (sale?.seller_id === null || sale?.seller_id === auth.identity.userId));
  if (!sale || !owned) {
    return NextResponse.json(
      { ok: false, error: "Venta inexistente o de otro vendedor" },
      { status: 404 },
    );
  }

  const { data: original } = await supaAdmin
    .from("sale_items")
    .select("id, article, qty, price, discount, product_id, variant_gid, stock_deducted, status")
    .eq("id", itemId)
    .eq("sale_id", id)
    .maybeSingle();

  if (!original) {
    return NextResponse.json({ ok: false, error: "La prenda no es de esta venta" }, { status: 404 });
  }
  if (original.status === "returned") {
    return NextResponse.json(
      { ok: false, error: "La prenda está devuelta: no se puede cambiar." },
      { status: 409 },
    );
  }

  // Un cambio ya hecho tiene prendas que lo reemplazan. Si el estado dice
  // 'exchanged' pero no hay ninguna, el intento anterior se cortó a la mitad
  // (se marcó la prenda y el proceso murió antes de crear las nuevas): ahí se
  // deja reintentar en vez de dejar la prenda trabada para siempre.
  if (original.status === "exchanged") {
    const { count } = await supaAdmin
      .from("sale_items")
      .select("id", { count: "exact", head: true })
      .eq("exchange_of_item_id", itemId);
    if (count) {
      return NextResponse.json({ ok: false, error: "Esta prenda ya se cambió." }, { status: 409 });
    }
  }

  // El descuento general de la compra alcanza a las dos puntas del cambio: la
  // prenda que vuelve valía lo que valía CON la promo aplicada, y la nueva se
  // cotiza igual. Comparar una con promo contra otra sin promo le cobraría al
  // cliente una diferencia que no existe.
  const originalNet = saleItemNet(original, sale.sale_discount);
  const replacementNet = items.reduce((sum, it) => sum + saleItemNet(it, sale.sale_discount), 0);
  const balance = exchangeBalance(originalNet, replacementNet);

  // --- 1) La prenda vieja vuelve al stock. Es el paso que puede fallar dejando
  // --- el inventario mal, así que va primero y aborta todo si no sale.
  try {
    await restockItem(supaAdmin, original);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error reponiendo stock";
    return NextResponse.json(
      { ok: false, error: `No se registró el cambio: ${msg}` },
      { status: 500 },
    );
  }

  // --- 2) Reservar el cambio. El compare-and-swap sobre `status` es lo que
  // --- impide que dos requests simultáneas creen dos juegos de prendas nuevas.
  const { data: claimed, error: claimErr } = await supaAdmin
    .from("sale_items")
    .update({
      status: "exchanged",
      // La plata se queda acá: la prenda original sigue facturando, más la
      // diferencia que el cliente haya pagado de más.
      exchange_adjustment: balance.toCharge,
      exchange_payment_method: balance.toCharge > 0 ? str(body.differencePaymentMethod) : null,
    })
    .eq("id", itemId)
    .in("status", original.status === "exchanged" ? ["exchanged"] : ["active"])
    .select("id");

  if (claimErr) {
    return NextResponse.json(
      { ok: false, error: `No se registró el cambio: ${claimErr.message}` },
      { status: 500 },
    );
  }
  if (!claimed?.length) {
    return NextResponse.json(
      { ok: false, error: "La prenda cambió de estado mientras se procesaba. Recargá y reintentá." },
      { status: 409 },
    );
  }

  // --- 3) Crear las prendas nuevas, colgadas de la misma compra.
  const rows: TablesInsert<"sale_items">[] = items.map((it) => ({
    sale_id: id,
    exchange_of_item_id: itemId,
    status: "active",
    // Ver el comentario de arriba: la mercadería es de esta fila, la plata no.
    counts_revenue: false,
    product_id: it.productId,
    variant_gid: it.variantGid,
    article: it.article,
    color: it.color,
    talle: it.talle,
    qty: it.qty,
    is_other_brand: it.isOtherBrand,
    brand: it.brand,
    price: it.price,
    discount: it.discount,
    stock_deducted: false,
  }));

  const { data: created, error: insertErr } = await supaAdmin
    .from("sale_items")
    .insert(rows)
    .select("id");
  if (insertErr || !created?.length) {
    // La prenda quedó marcada como cambiada sin reemplazo. No es un callejón
    // sin salida: el chequeo de arriba reconoce ese estado y deja reintentar.
    return NextResponse.json(
      {
        ok: false,
        error:
          `El stock de "${original.article}" se repuso pero no se pudieron crear las prendas nuevas: ` +
          `${insertErr?.message ?? "sin filas creadas"}. Reintentá el cambio.`,
      },
      { status: 500 },
    );
  }

  // Dejar constancia en la compra de qué se cambió por qué. Es lo único que
  // después explica un `exchange_adjustment` suelto en el reporte.
  const note =
    `Cambio ${new Date().toLocaleDateString("es-AR")}: ${original.article} → ` +
    items.map((it) => `${it.article}${it.qty > 1 ? ` ×${it.qty}` : ""}`).join(", ") +
    (balance.toCharge > 0
      ? ` · diferencia cobrada ${Math.round(balance.toCharge)}`
      : balance.surplus > 0
        ? ` · sobrante a favor ${Math.round(balance.surplus)}`
        : "");
  await supaAdmin
    .from("sales")
    .update({ notes: [sale.notes, note].filter(Boolean).join("\n") })
    .eq("id", id);

  // --- 4) Descontar el stock de las prendas nuevas. A esta altura el cambio ya
  // --- está registrado: un fallo acá es un warning, no un error — la prenda
  // --- salió del local igual.
  const allowOversell = Boolean(body.allowOversell);
  const warnings: string[] = [];

  for (const [i, it] of items.entries()) {
    const newId = created[i]?.id;
    if (!newId || it.isOtherBrand) continue;
    if (!it.productId || !it.inventoryItemId?.startsWith("gid://")) continue;

    const result = await deductStockForItem(supaAdmin, {
      itemId: newId,
      productId: it.productId,
      inventoryItemId: it.inventoryItemId,
      qty: it.qty,
      article: it.article,
      scope: `exchange-deduct:${newId}`,
      reference: `gid://atelier/SaleItemExchange/${newId}`,
      allowOversell,
    });
    if (result.warning) warnings.push(`${it.article}: ${result.warning}`);
  }

  return NextResponse.json({
    ok: true,
    id,
    itemId,
    newItemIds: created.map((r) => r.id),
    originalNet,
    replacementNet,
    charged: balance.toCharge,
    surplus: balance.surplus,
    warning: warnings.length ? warnings.join(" · ") : undefined,
  });
}
