import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert, TablesUpdate } from "@/lib/supabase/types";

type Supa = ReturnType<typeof createAdminClient>;

export type WorkshopCommercialData = {
  id: string;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
  customerName: string;
  customerContact: string | null;
  productId: string | null;
  productName: string;
  color: string | null;
  talle: string | null;
  price: number;
  shippingAmount: number;
  detail: string | null;
};

export function workshopSaleKey(orderId: string): string {
  return `workshop:${orderId}`;
}

export function workshopOrderIdFromKey(key: string | null | undefined): string | null {
  const match = /^workshop:([0-9a-f-]{36})$/i.exec(key ?? "");
  return match?.[1] ?? null;
}

export function isMissingWorkshopColumns(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    /could not find.*(?:price|shipping_amount|variant_label).*schema cache/i.test(error.message ?? "")
  );
}

/**
 * Espejo compatible con el esquema previo a 0021.
 *
 * Cuando la migración ya está activa, el trigger hace esta operación dentro de
 * la misma transacción del pedido. Mientras PostgREST todavía ve el esquema
 * anterior, esta ruta usa `sales.idempotency_key = workshop:<id>` como vínculo:
 * conserva precio/envío y hace que Dashboard/Ventas cuenten el pedido sin tocar
 * inventario. Al aplicar 0021, la migración adopta esa misma venta en vez de
 * duplicarla.
 */
export async function upsertWorkshopSale(
  supa: Supa,
  order: WorkshopCommercialData,
): Promise<string> {
  const key = workshopSaleKey(order.id);
  const existing = await supa
    .from("sales")
    .select(
      "id, sale_items(id, created_at, exchange_of_item_id, shopify_line_item_id)",
    )
    .eq("idempotency_key", key)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  let saleId = existing.data?.id ?? null;
  let createdSale = false;

  if (!saleId) {
    const saleRow: TablesInsert<"sales"> = {
      sold_at: new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Argentina/Buenos_Aires",
      }).format(new Date(order.createdAt)),
      seller_id: order.createdBy,
      seller_name: order.createdByName,
      customer_name: order.customerName,
      customer_contact: order.customerContact,
      origin: "atelier",
      payment_method: null,
      pos: "TALLER",
      shipping_amount: order.shippingAmount,
      delivered: false,
      notes: order.detail,
      idempotency_key: key,
    };
    const inserted = await supa.from("sales").insert(saleRow).select("id").single();
    if (inserted.error || !inserted.data) {
      throw new Error(inserted.error?.message ?? "No se pudo crear la venta de Taller");
    }
    saleId = inserted.data.id;
    createdSale = true;
  } else {
    const salePatch: TablesUpdate<"sales"> = {
      customer_name: order.customerName,
      customer_contact: order.customerContact,
      origin: "atelier",
      pos: "TALLER",
      shipping_amount: order.shippingAmount,
      notes: order.detail,
    };
    const updated = await supa.from("sales").update(salePatch).eq("id", saleId);
    if (updated.error) throw new Error(updated.error.message);
  }

  const originalItem = (existing.data?.sale_items ?? [])
    .filter((item) => !item.exchange_of_item_id && !item.shopify_line_item_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  if (originalItem) {
    const itemPatch: TablesUpdate<"sale_items"> = {
      product_id: order.productId,
      variant_gid: null,
      article: order.productName,
      color: order.color,
      talle: order.talle,
      price: order.price,
      stock_deducted: false,
    };
    const updated = await supa.from("sale_items").update(itemPatch).eq("id", originalItem.id);
    if (updated.error) throw new Error(updated.error.message);
  } else {
    const itemRow: TablesInsert<"sale_items"> = {
      sale_id: saleId,
      product_id: order.productId,
      variant_gid: null,
      article: order.productName,
      color: order.color,
      talle: order.talle,
      qty: 1,
      price: order.price,
      discount: 0,
      stock_deducted: false,
      counts_revenue: true,
    };
    const inserted = await supa.from("sale_items").insert(itemRow);
    if (inserted.error) {
      if (createdSale) await supa.from("sales").delete().eq("id", saleId);
      throw new Error(inserted.error.message);
    }
  }

  return saleId;
}

