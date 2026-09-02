import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { adjustInventory, getProductVariants, type VariantStock } from "@/lib/shopify/inventory";
import { requireRole } from "@/lib/api-auth";
import { notifyLowStock, notifyStockDeductionUnmarked } from "@/lib/notify";
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

/**
 * Deja la venta marcada como "ya descontó stock", y de paso fija el
 * `variant_gid` que se validó contra Shopify.
 *
 * Se reintenta porque este write es el que sostiene la reposición: si se
 * pierde, `DELETE /api/ventas/[id]` no repone (mira ese flag) y el stock
 * descontado no vuelve nunca. Es un update chico contra la misma base en la que
 * el INSERT acaba de funcionar, así que un fallo acá es casi siempre transitorio.
 */
async function markStockDeducted(
  supa: ReturnType<typeof createAdminClient>,
  saleId: string,
  validatedVariantGid: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supa
      .from("sales")
      .update({ stock_deducted: true, variant_gid: validatedVariantGid })
      .eq("id", saleId);
    if (!error) return true;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  return false;
}

/** Registrar una venta. Si viene variante de Shopify, descuenta stock. */
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

  const article = str(body.article);
  const price = Number(body.price);
  const qty = Math.trunc(Number(body.qty));
  const discount = Number(body.discount) || 0;
  if (!article) return NextResponse.json({ ok: false, error: "Falta el artículo" }, { status: 400 });
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ ok: false, error: "Precio inválido" }, { status: 400 });
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ ok: false, error: "Cantidad inválida" }, { status: 400 });
  }
  if (discount < 0 || discount >= 1) {
    return NextResponse.json({ ok: false, error: "Descuento inválido" }, { status: 400 });
  }

  const soldAtRaw = str(body.soldAt);
  const soldAt = soldAtRaw && /^\d{4}-\d{2}-\d{2}$/.test(soldAtRaw) ? soldAtRaw : undefined;
  const installmentsRaw = Math.trunc(Number(body.installments));
  const installments = Number.isFinite(installmentsRaw) && installmentsRaw > 0 ? installmentsRaw : null;
  const customer = (body.customer ?? {}) as Record<string, unknown>;
  const isOtherBrand = Boolean(body.isOtherBrand);
  const productId = !isOtherBrand ? str(body.productId) : null;
  const inventoryItemId = !isOtherBrand ? str(body.inventoryItemId) : null;
  const idempotencyKey = str(body.idempotencyKey);

  // El path de la factura lo manda el cliente; después se firma con service_role
  // (que ignora RLS). Solo aceptamos la forma que produce nuestro uploader.
  const invoicePath = Boolean(body.invoiced) ? str(body.invoicePath) : null;
  if (invoicePath && !isValidInvoicePath(invoicePath)) {
    return NextResponse.json({ ok: false, error: "Factura inválida" }, { status: 400 });
  }

  const row: TablesInsert<"sales"> = {
    ...(soldAt ? { sold_at: soldAt } : {}),
    seller_id: auth.identity.userId,
    seller_name: auth.identity.name,
    customer_name: str(customer.name),
    customer_dni: str(customer.dni),
    customer_contact: str(customer.contact),
    customer_address: str(customer.address),
    product_id: productId,
    // Provisorio: lo manda el cliente sin validar. Si el descuento de stock
    // llega a concretarse, la fase 3 lo pisa con el GID de la variante que se
    // verificó contra Shopify. Acá solo se filtra por forma, para no guardar
    // texto arbitrario en un campo por el que después se busca.
    variant_gid: !isOtherBrand ? variantGid(body.variantGid) : null,
    article,
    color: str(body.color),
    talle: str(body.talle),
    qty,
    is_other_brand: isOtherBrand,
    brand: isOtherBrand ? str(body.brand) : null,
    price,
    discount,
    payment_method: str(body.paymentMethod),
    installments,
    pos: str(body.pos),
    invoiced: Boolean(body.invoiced),
    invoice_path: invoicePath,
    delivered: Boolean(body.delivered),
    notes: str(body.notes),
    idempotency_key: idempotencyKey,
    stock_deducted: false,
  };

  const supaAdmin = createAdminClient();

  /** Reintento de una venta ya registrada: devolvemos la original tal cual. */
  async function existingSale(key: string) {
    const { data } = await supaAdmin
      .from("sales")
      .select("id, stock_deducted")
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
        stockDeducted: dup.stock_deducted,
        duplicate: true,
      });
    }
  }

  // 2) Guardar la venta ANTES de tocar Shopify. El orden importa: así el índice
  //    único arbitra dos requests simultáneas antes de que cualquiera descuente
  //    stock. Al revés, las dos descontarían y recién después una fallaría.
  const { data: inserted, error } = await supaAdmin
    .from("sales")
    .insert(row)
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
          stockDeducted: winner.stock_deducted,
          duplicate: true,
        });
      }
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const saleId = inserted.id;

  // 3) Descontar stock en Shopify si corresponde (venta de catálogo con variante).
  //
  // El orden de las tres fases no es cosmético: `adjustInventory` es la línea
  // que divide "el stock no se movió" de "el stock ya se movió", y cada lado
  // necesita un manejo de error distinto. Antes las tres vivían en un solo
  // `try`, así que un fallo POSTERIOR al descuento se reportaba como si el
  // descuento hubiera fallado — y encima dejaba `stock_deducted` en false, con
  // lo cual borrar esa venta no reponía nunca el stock (QA 2026-09-01).
  let stockDeducted = false;
  let warning: string | undefined;
  if (productId && inventoryItemId?.startsWith("gid://") && isShopifyConfigured()) {
    const { data: product } = await supaAdmin
      .from("products")
      .select("id, shopify_id, name, alert_threshold")
      .eq("id", productId)
      .maybeSingle();

    if (!product?.shopify_id) {
      warning = "La venta se registró pero el producto no tiene vínculo con Shopify: no se descontó stock.";
    } else {
      // --- Fase 1: validar la variante. Todavía no se tocó nada. ---
      // El inventoryItemId viene del cliente: verificar que sea una variante de
      // ESTE producto antes de descontar, para no poder mover el stock de otro
      // producto mandando un id de otra parte.
      let variant: VariantStock | undefined;
      try {
        const known = await getProductVariants(product.shopify_id);
        variant = known?.variants.find((v) => v.inventoryItemId === inventoryItemId);
      } catch (e) {
        warning = `La venta se registró pero no se pudo leer el inventario en Shopify, así que no se descontó stock: ${
          e instanceof Error ? e.message : "error desconocido"
        }`;
      }

      if (!warning && !variant) {
        warning = "La venta se registró pero la variante indicada no pertenece a este producto: no se descontó stock.";
      } else if (!warning && variant && !variant.tracked) {
        warning = "La venta se registró, pero Shopify no controla stock para esa variante.";
      }

      // --- Fase 2: el descuento. Único punto donde "no se descontó" es cierto. ---
      if (!warning && variant) {
        try {
          await adjustInventory([{ inventoryItemId, delta: -qty }], {
            // Atado a la venta: si esta request se reintenta y Shopify ya
            // habia aplicado el descuento, no lo aplica dos veces.
            idempotencyScope: `sale-deduct:${saleId}`,
            reference: `gid://atelier/Sale/${saleId}`,
          });
          stockDeducted = true;
        } catch (e) {
          warning = `La venta se registró pero NO se pudo descontar stock en Shopify: ${
            e instanceof Error ? e.message : "error desconocido"
          }`;
        }
      }

      // --- Fase 3: el stock YA se movió. Nada de acá lo puede desmentir. ---
      if (stockDeducted && variant) {
        // `stock_deducted` es lo que mira el DELETE para decidir si repone, así
        // que este write es el que no se puede perder: se reintenta. De paso se
        // fija el `variant_gid` autoritativo (el del cliente entró sin validar y
        // es justamente el campo por el que el DELETE busca la variante).
        const marked = await markStockDeducted(supaAdmin, saleId, variant.id);
        if (!marked) {
          warning =
            `ATENCIÓN: el stock SÍ se descontó en Shopify, pero la venta ${saleId} no quedó marcada como descontada. ` +
            "Si se elimina esta venta, el stock NO se va a reponer solo: corregirlo a mano en Shopify.";
          // El toast se lo lleva el primer refresh; esto queda en la campanita.
          await notifyStockDeductionUnmarked(supaAdmin, {
            saleId,
            productId: product.id,
            article,
            qty,
          });
        }

        // Espejo local del total. Es cosmético y su fallo no cambia nada de lo
        // anterior: `adjustInventory` dispara el webhook `inventory_levels/update`,
        // que recalcula `products.stock` leyendo de Shopify. Por eso se ignora
        // el error en vez de convertirlo en un warning que asuste al vendedor.
        try {
          const fresh = await getProductVariants(product.shopify_id);
          if (fresh) {
            await supaAdmin
              .from("products")
              .update({ stock: fresh.total, updated_at: new Date().toISOString() })
              .eq("id", product.id);
            await notifyLowStock(supaAdmin, {
              productId: product.id,
              name: product.name,
              newStock: fresh.total,
              alertThreshold: product.alert_threshold,
            });
          }
        } catch {
          // Silencio a propósito: lo reconcilia el webhook.
        }
      }
    }
  }

  return NextResponse.json({ ok: true, id: saleId, stockDeducted, warning });
}
