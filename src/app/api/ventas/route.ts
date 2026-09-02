import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-auth";
import { deductStockForItem } from "@/lib/sales-ops";
import { isValidInvoicePath } from "@/lib/sales";
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

/**
 * Valida una prenda del carrito.
 *
 * El precio admite 0 (regalo, prenda bonificada al 100%); lo que no admite es
 * un negativo. La cantidad y el descuento sí tienen piso, porque un 0 ahí es
 * siempre un error de carga.
 */
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
    // Provisorio: lo manda el cliente sin validar. Si el descuento de stock se
    // concreta, `deductStockForItem` lo pisa con el GID de la variante que se
    // verificó contra Shopify. Acá solo se filtra por forma, para no guardar
    // texto arbitrario en un campo por el que después se busca.
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
 * Registrar una venta: UNA compra con una o varias prendas.
 *
 * Antes esto registraba exactamente un producto por venta, así que una compra
 * de dos prendas entraba como dos ventas —con el pago, el cliente y la factura
 * duplicados en las dos— y el ticket promedio del reporte salía a la mitad.
 */
export async function POST(req: NextRequest) {
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

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) {
    return NextResponse.json({ ok: false, error: "La venta no tiene prendas" }, { status: 400 });
  }
  if (rawItems.length > 30) {
    return NextResponse.json({ ok: false, error: "Máximo 30 prendas por venta" }, { status: 400 });
  }

  const items: ParsedItem[] = [];
  for (const [i, raw] of rawItems.entries()) {
    const parsed = parseItem(raw, i);
    if ("error" in parsed) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    items.push(parsed);
  }

  const soldAtRaw = str(body.soldAt);
  const soldAt = soldAtRaw && /^\d{4}-\d{2}-\d{2}$/.test(soldAtRaw) ? soldAtRaw : undefined;
  const installmentsRaw = Math.trunc(Number(body.installments));
  const installments = Number.isFinite(installmentsRaw) && installmentsRaw > 0 ? installmentsRaw : null;
  const customer = (body.customer ?? {}) as Record<string, unknown>;
  const idempotencyKey = str(body.idempotencyKey);
  // El cliente lo manda cuando el vendedor confirmó el diálogo de stock
  // insuficiente. Distingue una sobreventa deliberada de una que apareció sola.
  const allowOversell = Boolean(body.allowOversell);

  const saleDiscount = Number(body.saleDiscount) || 0;
  if (saleDiscount < 0 || saleDiscount >= 1) {
    return NextResponse.json({ ok: false, error: "Descuento general inválido" }, { status: 400 });
  }

  // El path de la factura lo manda el cliente; después se firma con service_role
  // (que ignora RLS). Solo aceptamos la forma que produce nuestro uploader.
  const invoicePath = Boolean(body.invoiced) ? str(body.invoicePath) : null;
  if (invoicePath && !isValidInvoicePath(invoicePath)) {
    return NextResponse.json({ ok: false, error: "Factura inválida" }, { status: 400 });
  }

  const saleRow: TablesInsert<"sales"> = {
    ...(soldAt ? { sold_at: soldAt } : {}),
    origin: "atelier",
    seller_id: auth.identity.userId,
    seller_name: auth.identity.name,
    customer_name: str(customer.name),
    customer_dni: str(customer.dni),
    customer_contact: str(customer.contact),
    customer_address: str(customer.address),
    payment_method: str(body.paymentMethod),
    installments,
    pos: str(body.pos),
    sale_discount: saleDiscount,
    invoiced: Boolean(body.invoiced),
    invoice_path: invoicePath,
    delivered: Boolean(body.delivered),
    notes: str(body.notes),
    idempotency_key: idempotencyKey,
  };

  const supaAdmin = createAdminClient();

  /** Reintento de una venta ya registrada: devolvemos la original tal cual. */
  async function existingSale(key: string) {
    const { data } = await supaAdmin
      .from("sales")
      .select("id, sale_items(stock_deducted)")
      .eq("idempotency_key", key)
      .maybeSingle();
    return data;
  }

  // 1) Si esta clave ya se usó, es un reintento (doble tap, retry de red).
  //    Cortamos acá: ni se duplica la venta ni se vuelve a descontar stock.
  if (idempotencyKey) {
    const dup = await existingSale(idempotencyKey);
    if (dup) {
      return NextResponse.json({
        ok: true,
        id: dup.id,
        stockDeducted: (dup.sale_items ?? []).some((i) => i.stock_deducted),
        duplicate: true,
      });
    }
  }

  // 2) Guardar la compra ANTES de tocar Shopify. El orden importa: así el índice
  //    único arbitra dos requests simultáneas antes de que cualquiera descuente
  //    stock. Al revés, las dos descontarían y recién después una fallaría.
  const { data: inserted, error } = await supaAdmin
    .from("sales")
    .insert(saleRow)
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation: otra request con la misma clave nos ganó de
    // mano y ya registró la venta.
    if (error.code === "23505" && idempotencyKey) {
      const winner = await existingSale(idempotencyKey);
      if (winner) {
        return NextResponse.json({
          ok: true,
          id: winner.id,
          stockDeducted: (winner.sale_items ?? []).some((i) => i.stock_deducted),
          duplicate: true,
        });
      }
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const saleId = inserted.id;

  // 3) Las prendas. Si esto falla, la cabecera queda sin prendas: se borra, para
  //    no dejar una compra fantasma en el listado. El `delete` es seguro incluso
  //    con la clave de idempotencia ya usada, porque libera la clave junto con
  //    la fila y un reintento vuelve a empezar limpio.
  const itemRows: TablesInsert<"sale_items">[] = items.map((it) => ({
    sale_id: saleId,
    product_id: it.productId,
    variant_gid: it.variantGid,
    article: it.article,
    color: it.color,
    talle: it.talle,
    is_other_brand: it.isOtherBrand,
    brand: it.brand,
    qty: it.qty,
    price: it.price,
    discount: it.discount,
    stock_deducted: false,
  }));

  const { data: createdItems, error: itemsError } = await supaAdmin
    .from("sale_items")
    .insert(itemRows)
    .select("id");

  if (itemsError || !createdItems?.length) {
    await supaAdmin.from("sales").delete().eq("id", saleId);
    return NextResponse.json(
      {
        ok: false,
        error: `No se pudieron registrar las prendas: ${itemsError?.message ?? "sin filas creadas"}`,
      },
      { status: 500 },
    );
  }

  // 4) Descontar stock, prenda por prenda. A esta altura la venta YA está
  //    registrada: un fallo acá es un warning, no un error — la prenda salió
  //    del local igual y lo que queda mal es el inventario, no la venta.
  //
  //    El detalle delicado (validar la variante, descontar, y recién después
  //    marcar la prenda) vive en `deductStockForItem`; el orden de sus fases no
  //    es cosmético y está explicado ahí.
  let stockDeducted = false;
  const warnings: string[] = [];

  for (const [i, it] of items.entries()) {
    const itemId = createdItems[i]?.id;
    if (!itemId || it.isOtherBrand) continue;
    if (!it.productId || !it.inventoryItemId?.startsWith("gid://")) continue;

    const result = await deductStockForItem(supaAdmin, {
      itemId,
      productId: it.productId,
      inventoryItemId: it.inventoryItemId,
      qty: it.qty,
      article: it.article,
      // Atado a la prenda: si esta request se reintenta y Shopify ya había
      // aplicado el descuento, no lo aplica dos veces.
      scope: `item-deduct:${itemId}`,
      reference: `gid://atelier/SaleItem/${itemId}`,
      allowOversell,
    });
    if (result.stockDeducted) stockDeducted = true;
    if (result.warning) warnings.push(`${it.article}: ${result.warning}`);
  }

  return NextResponse.json({
    ok: true,
    id: saleId,
    items: createdItems.length,
    stockDeducted,
    warning: warnings.length ? warnings.join(" · ") : undefined,
  });
}
