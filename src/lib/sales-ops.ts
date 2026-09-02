import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { adjustInventory, getProductVariants, type VariantStock } from "@/lib/shopify/inventory";
import { notifyLowStock, notifyOversold, notifyStockDeductionUnmarked } from "@/lib/notify";

type Supa = ReturnType<typeof createAdminClient>;

/**
 * Movimientos de stock atados a una PRENDA de una venta: descontar, reponer.
 *
 * La unidad es la prenda y no la compra desde la 0018: una compra puede llevar
 * tres prendas y el cliente devolver una sola, así que el flag que dice "esta
 * mercadería sostiene un descuento de stock" tiene que vivir por prenda.
 *
 * Vive acá y no en cada endpoint porque el orden de los pasos es lo delicado
 * del asunto y ya se rompió una vez. `adjustInventory` es la línea que divide
 * "el stock no se movió" de "el stock ya se movió", y cada lado necesita un
 * manejo de error distinto: antes las dos mitades vivían en un solo `try`, así
 * que un fallo POSTERIOR al descuento se reportaba como si el descuento hubiera
 * fallado — y encima dejaba `stock_deducted` en false, con lo cual deshacer esa
 * venta no reponía nunca (QA 2026-09-01).
 *
 * Con devoluciones y cambios el problema se multiplicaba por tres endpoints, así
 * que hay una sola copia.
 */

/** Espejo local del total del producto. Cosmético: lo recalcula el webhook. */
async function mirrorProductStock(
  supa: Supa,
  product: { id: string; shopify_id: string | null; name?: string; alert_threshold?: number | null },
): Promise<void> {
  if (!product.shopify_id) return;
  try {
    const fresh = await getProductVariants(product.shopify_id);
    if (!fresh) return;
    await supa
      .from("products")
      .update({ stock: fresh.total, updated_at: new Date().toISOString() })
      .eq("id", product.id);
    if (product.name != null) {
      await notifyLowStock(supa, {
        productId: product.id,
        name: product.name,
        newStock: fresh.total,
        alertThreshold: product.alert_threshold ?? 0,
      });
    }
  } catch {
    // Silencio a propósito: `adjustInventory` dispara `inventory_levels/update`,
    // que relee el stock real. Un fallo acá no puede abortar la operación.
  }
}

/**
 * Deja la prenda marcada como "ya descontó stock", fijando de paso el
 * `variant_gid` que se validó contra Shopify.
 *
 * Se reintenta porque este write es el que sostiene la reposición: si se
 * pierde, la devolución no repone (mira ese flag) y el stock descontado no
 * vuelve nunca.
 */
async function markStockDeducted(
  supa: Supa,
  itemId: string,
  validatedVariantGid: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supa
      .from("sale_items")
      .update({ stock_deducted: true, variant_gid: validatedVariantGid })
      .eq("id", itemId);
    if (!error) return true;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  return false;
}

export type DeductInput = {
  /** La PRENDA cuyo stock se descuenta (no la compra). */
  itemId: string;
  productId: string;
  inventoryItemId: string;
  qty: number;
  article: string;
  /** Identidad lógica del movimiento (`sale-deduct:<id>`, `exchange-deduct:<id>`). */
  scope: string;
  /** URI que Shopify muestra en el historial de inventario. */
  reference: string;
  /** El operador ya vio y aceptó el faltante: no reportarlo como hallazgo. */
  allowOversell?: boolean;
};

export type StockResult = { stockDeducted: boolean; warning?: string };

/**
 * Descuenta stock en Shopify por una prenda ya registrada.
 *
 * La fila tiene que existir ANTES de llamar acá: el orden importa, porque así
 * el índice único de idempotencia arbitra dos requests simultáneas antes de que
 * cualquiera toque el inventario. Al revés, las dos descontarían.
 */
export async function deductStockForItem(supa: Supa, input: DeductInput): Promise<StockResult> {
  const { itemId, productId, inventoryItemId, qty, article, scope, reference } = input;
  if (!isShopifyConfigured()) {
    return { stockDeducted: false, warning: "Shopify no está configurado: no se descontó stock." };
  }

  const { data: product } = await supa
    .from("products")
    .select("id, shopify_id, name, alert_threshold")
    .eq("id", productId)
    .maybeSingle();

  if (!product?.shopify_id) {
    return {
      stockDeducted: false,
      warning: "El producto no tiene vínculo con Shopify: no se descontó stock.",
    };
  }

  // --- Fase 1: validar la variante. Todavía no se tocó nada. ---
  // El inventoryItemId viene del cliente: verificar que sea una variante de
  // ESTE producto antes de descontar, para no poder mover el stock de otro
  // producto mandando un id de otra parte.
  let variant: VariantStock | undefined;
  try {
    const known = await getProductVariants(product.shopify_id);
    variant = known?.variants.find((v) => v.inventoryItemId === inventoryItemId);
  } catch (e) {
    return {
      stockDeducted: false,
      warning: `No se pudo leer el inventario en Shopify, así que no se descontó stock: ${
        e instanceof Error ? e.message : "error desconocido"
      }`,
    };
  }

  if (!variant) {
    return {
      stockDeducted: false,
      warning: "La variante indicada no pertenece a este producto: no se descontó stock.",
    };
  }
  if (!variant.tracked) {
    return { stockDeducted: false, warning: "Shopify no controla stock para esa variante." };
  }

  // Relectura del lado del server: el chequeo del cliente usa el número que leyó
  // al elegir el producto, que puede tener minutos. No se bloquea —si la prenda
  // está en la mano hay que poder venderla— pero se deja constancia.
  const oversold = variant.available < qty;

  // --- Fase 2: el descuento. Único punto donde "no se descontó" es cierto. ---
  try {
    await adjustInventory([{ inventoryItemId, delta: -qty }], {
      idempotencyScope: scope,
      reference,
    });
  } catch (e) {
    return {
      stockDeducted: false,
      warning: `NO se pudo descontar stock en Shopify: ${
        e instanceof Error ? e.message : "error desconocido"
      }`,
    };
  }

  // --- Fase 3: el stock YA se movió. Nada de acá lo puede desmentir. ---
  let warning: string | undefined;
  const marked = await markStockDeducted(supa, itemId, variant.id);
  if (!marked) {
    warning =
      `ATENCIÓN: el stock SÍ se descontó en Shopify, pero la prenda ${itemId} no quedó marcada como ` +
      "descontada. Si se deshace esta venta, el stock NO se va a reponer solo: corregirlo a mano en Shopify.";
    await notifyStockDeductionUnmarked(supa, { itemId, productId: product.id, article, qty });
  } else if (oversold && !input.allowOversell) {
    warning =
      `Stock insuficiente: Shopify tenía ${variant.available}u y se movieron ${qty}. ` +
      "Quedó en negativo — revisá el inventario físico.";
    await notifyOversold(supa, { productId: product.id, article, qty, available: variant.available });
  }

  await mirrorProductStock(supa, product);
  return { stockDeducted: true, warning };
}

export type RestockableItem = {
  id: string;
  qty: number;
  product_id: string | null;
  variant_gid: string | null;
  stock_deducted: boolean;
};

export type RestockResult =
  | { restocked: true }
  | { restocked: false; reason: "nada-que-reponer" | "ya-reclamada" };

/**
 * Repone en Shopify el stock que esta prenda había descontado.
 *
 * La reposición se "reserva" con un compare-and-swap sobre `stock_deducted`
 * ANTES de tocar Shopify: solo la request que consigue bajar el flag repone.
 * Sin eso, cualquier segundo intento volvía a reponer — y bastaba con que
 * fallara un paso posterior para que el endpoint devolviera 500 con la venta
 * todavía viva, invitando a reintentar y sumar unidades fantasma (QA 2026-09-01).
 *
 * Si Shopify falla, el flag se restaura y se propaga el error: el llamador NO
 * debe seguir adelante, porque la prenda no volvió al inventario.
 */
export async function restockItem(supa: Supa, item: RestockableItem): Promise<RestockResult> {
  if (!item.stock_deducted || !item.product_id || !isShopifyConfigured()) {
    return { restocked: false, reason: "nada-que-reponer" };
  }

  const { data: claimed, error: claimError } = await supa
    .from("sale_items")
    .update({ stock_deducted: false })
    .eq("id", item.id)
    .eq("stock_deducted", true)
    .select("id");

  if (claimError) throw new Error(claimError.message);
  // 0 filas = otra request ya se llevó la reposición. No es un error.
  if (!claimed?.length) return { restocked: false, reason: "ya-reclamada" };

  try {
    const { data: product } = await supa
      .from("products")
      .select("id, shopify_id, name, alert_threshold")
      .eq("id", item.product_id)
      .maybeSingle();
    if (!product?.shopify_id) throw new Error("El producto no tiene vínculo con Shopify");

    const pv = await getProductVariants(product.shopify_id);
    const variant = pv?.variants.find((v) => v.id === item.variant_gid);
    if (!variant) throw new Error("No se encontró la variante para reponer");
    if (!variant.tracked) throw new Error("La variante ya no controla inventario en Shopify");

    await adjustInventory([{ inventoryItemId: variant.inventoryItemId, delta: item.qty }], {
      // Scope distinto al del descuento: son dos movimientos opuestos de la
      // misma prenda y compartir clave haría que Shopify ignorara el segundo
      // por "duplicado".
      idempotencyScope: `item-restock:${item.id}`,
      reference: `gid://atelier/SaleItemReversal/${item.id}`,
    });

    // A partir de acá el stock YA volvió: el espejo es cosmético.
    await mirrorProductStock(supa, product);
    return { restocked: true };
  } catch (e) {
    // No se repuso: devolver el flag a su lugar para que un reintento sí lo haga.
    await supa.from("sale_items").update({ stock_deducted: true }).eq("id", item.id);
    throw new Error(e instanceof Error ? e.message : "Error reponiendo stock");
  }
}
