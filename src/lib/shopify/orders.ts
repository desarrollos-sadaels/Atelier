import { shopifyAdmin, shopifyAdminPage } from "./client";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/supabase/types";
import { saleTotal } from "@/lib/sales";

type Supa = ReturnType<typeof createAdminClient>;

/**
 * Importación de órdenes de Shopify a la tabla `sales`.
 *
 * Hasta la 0017 las ventas online no llegaban acá: el webhook `orders/create`
 * solo reconciliaba stock, así que el listado de Ventas mostraba únicamente lo
 * cargado a mano en el local. Este módulo cierra esa mitad.
 *
 * Una orden es UNA compra (`sales`) con una prenda por línea (`sale_items`),
 * exactamente igual que una venta cargada a mano en el local. Eso es lo que
 * hace que el resto del sistema —KPIs, ROAS por producto, devoluciones
 * parciales, cambios— no necesite ningún caso especial para lo online.
 *
 * Antes de la 0018 cada línea era su propia venta, así que una orden de tres
 * prendas contaba como tres operaciones y el ticket promedio salía a un tercio.
 */

export type ShopifyOrderLineItem = {
  id: number | string;
  title?: string | null;
  name?: string | null;
  variant_title?: string | null;
  sku?: string | null;
  quantity?: number;
  price?: string | number | null;
  product_id?: number | string | null;
  variant_id?: number | string | null;
  total_discount?: string | number | null;
  discount_allocations?: { amount?: string | number | null }[] | null;
};

type RefundLineItem = {
  line_item_id?: number | string | null;
  quantity?: number | null;
  restock_type?: string | null;
};

export type ShopifyRefundPayload = {
  id?: number | string | null;
  order_id?: number | string | null;
  created_at?: string | null;
  refund_line_items?: RefundLineItem[] | null;
  transactions?: {
    id?: number | string | null;
    kind?: string | null;
    status?: string | null;
    amount?: string | number | null;
    gateway?: string | null;
    processed_at?: string | null;
  }[] | null;
};

export type ShopifyOrder = {
  id: number | string;
  name?: string | null;
  order_number?: number | null;
  created_at?: string | null;
  processed_at?: string | null;
  cancelled_at?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  currency?: string | null;
  total_price?: string | number | null;
  note?: string | null;
  gateway?: string | null;
  payment_gateway_names?: string[] | null;
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  email?: string | null;
  phone?: string | null;
  shipping_address?: {
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    name?: string | null;
    phone?: string | null;
  } | null;
  billing_address?: { name?: string | null } | null;
  line_items?: ShopifyOrderLineItem[] | null;
  refunds?: ShopifyRefundPayload[] | null;
  total_shipping_price_set?: {
    shop_money?: { amount?: string | number | null } | null;
  } | null;
};

const PRODUCT_FIELDS = "id, shopify_id, name, alert_threshold";

export type MatchedProduct = {
  id: string;
  shopify_id: string | null;
  name: string;
  alert_threshold: number | null;
};

/**
 * Ubica el producto local de una línea de la orden.
 *
 * Matchea por `shopify_id`, que es el único identificador realmente único: la
 * migración 0002 le sacó a propósito el constraint de unicidad al SKU porque en
 * Shopify se repiten entre productos. El fallback por SKU solo aplica cuando
 * identifica a UN producto: ante ambigüedad preferimos dejar la venta sin
 * vincular antes que atribuírsela al producto equivocado.
 */
export async function findProductForLine(
  li: { product_id?: number | string | null; sku?: string | null },
  supa: Supa,
): Promise<MatchedProduct | null> {
  if (li.product_id != null) {
    const { data } = await supa
      .from("products")
      .select(PRODUCT_FIELDS)
      .eq("shopify_id", String(li.product_id))
      .maybeSingle();
    if (data) return data;
  }
  if (li.sku) {
    const { data: rows } = await supa
      .from("products")
      .select(PRODUCT_FIELDS)
      .eq("sku", li.sku)
      .limit(2);
    if (rows?.length === 1) return rows[0];
  }
  return null;
}

const ART_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
});

/** Fecha de la venta en horario de Buenos Aires (la tabla guarda `date`, no timestamp). */
function soldAtART(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  return ART_DATE.format(Number.isNaN(d.getTime()) ? new Date() : d);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Envío original informado por Shopify, expresado en la moneda de la tienda. */
export function shippingAmountOf(order: ShopifyOrder): number {
  return Math.max(0, num(order.total_shipping_price_set?.shop_money?.amount));
}

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

/**
 * Color y talle a partir del `variant_title` ("S / Marrón").
 *
 * Es una heurística: el payload REST de la orden no dice qué opción es cuál.
 * Se resuelve por posición contra las opciones conocidas del catálogo cuando se
 * puede, y si no, se asume el orden habitual de la tienda (talle / color).
 * Cuando no se puede decidir, el valor entero va a `talle` y se deja `color` en
 * null: es mejor un dato incompleto que uno inventado, porque `color` alimenta
 * el swatch de la grilla.
 */
function splitVariantTitle(variantTitle: string | null): { color: string | null; talle: string | null } {
  const title = clean(variantTitle);
  if (!title || title === "Default Title") return { color: null, talle: null };

  const parts = title.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) return { color: null, talle: parts[0] };

  // Talle: el que parece un talle (S/M/L, un número, "ÚNICO"). El resto, color.
  const sizeLike = /^(x{0,3}[sml]|[0-9]{1,3}|[uú]nico|t[.\s-]?\d+)$/i;
  const sizeIdx = parts.findIndex((p) => sizeLike.test(p));
  if (sizeIdx === -1) return { color: parts[parts.length - 1], talle: parts[0] };
  const rest = parts.filter((_, i) => i !== sizeIdx);
  return { color: rest.join(" / ") || null, talle: parts[sizeIdx] };
}

function customerNameOf(order: ShopifyOrder): string | null {
  const c = order.customer;
  const fromCustomer = [clean(c?.first_name), clean(c?.last_name)].filter(Boolean).join(" ");
  return clean(fromCustomer) ?? clean(order.shipping_address?.name) ?? clean(order.billing_address?.name);
}

function customerAddressOf(order: ShopifyOrder): string | null {
  const a = order.shipping_address;
  if (!a) return null;
  return clean([a.address1, a.address2, a.city, a.province, a.zip].filter(Boolean).join(", "));
}

function paymentMethodOf(order: ShopifyOrder): string | null {
  const gw = clean(order.gateway) ?? clean(order.payment_gateway_names?.[0]);
  return gw ? gw.toUpperCase() : null;
}

/** Unidades devueltas por línea, según los refunds de la orden. */
function refundedByLine(order: ShopifyOrder): Map<string, number> {
  const out = new Map<string, number>();
  for (const refund of order.refunds ?? []) {
    for (const rli of refund.refund_line_items ?? []) {
      if (rli.line_item_id == null) continue;
      const key = String(rli.line_item_id);
      out.set(key, (out.get(key) ?? 0) + num(rli.quantity));
    }
  }
  return out;
}

/**
 * Precio unitario y descuento de una línea.
 *
 * Shopify expresa el descuento en PLATA (`discount_allocations`), no en
 * porcentaje. Se convierte a fracción para que la fila se vea y se sume igual
 * que una cargada a mano — la fórmula de `saleNet()` no cambia.
 *
 * El caso 100% bonificado no puede guardarse como descuento 1 (`discount < 1`
 * es un constraint de la 0006), así que se guarda como precio 0. El importe
 * resultante es idéntico.
 */
function priceAndDiscount(li: ShopifyOrderLineItem): { price: number; discount: number } {
  const unit = num(li.price);
  const qty = Math.max(1, Math.trunc(num(li.quantity)) || 1);
  const gross = unit * qty;

  const allocated = (li.discount_allocations ?? []).reduce((s, a) => s + num(a?.amount), 0);
  const discountAmount = allocated > 0 ? allocated : num(li.total_discount);

  if (gross <= 0 || discountAmount <= 0) return { price: unit, discount: 0 };
  if (discountAmount >= gross) return { price: 0, discount: 0 };

  return { price: unit, discount: discountAmount / gross };
}

export type MappedOrder = {
  sale: TablesInsert<"sales">;
  items: { row: Omit<TablesInsert<"sale_items">, "sale_id">; product: MatchedProduct | null }[];
  /** Productos locales tocados por la orden, para reconciliar su stock. */
  products: MatchedProduct[];
};

/**
 * Convierte una orden de Shopify en una compra con sus prendas.
 *
 * Sobre `stock_deducted`: en una orden online el stock lo movió Shopify, no
 * nosotros. El flag significa "esta prenda sostiene un descuento de stock que
 * hay que revertir si se deshace", y para una línea viva eso es cierto: si el
 * cliente la devuelve en el local, Atelier tiene que reponerla porque Shopify
 * no se entera. Pero si la orden ya se canceló o la línea se reembolsó DENTRO
 * de Shopify, Shopify ya resolvió su inventario: ahí el flag va en false para
 * no reponer dos veces la misma prenda.
 *
 * `sale_discount` queda en 0 a propósito. Shopify ya reparte los descuentos de
 * la orden entre las líneas (`discount_allocations`), así que aplicar además un
 * descuento de compra los contaría dos veces.
 */
export async function mapOrder(order: ShopifyOrder, supa: Supa): Promise<MappedOrder> {
  const soldAt = soldAtART(order.processed_at ?? order.created_at);
  const cancelled = Boolean(order.cancelled_at);
  const refunded = refundedByLine(order);
  const orderName = clean(order.name) ?? (order.order_number != null ? `#${order.order_number}` : null);
  const customerContact =
    clean(order.customer?.email) ?? clean(order.email) ?? clean(order.customer?.phone) ?? clean(order.phone);
  const fulfilled = order.fulfillment_status === "fulfilled";

  const sale: TablesInsert<"sales"> = {
    origin: "shopify",
    shopify_order_id: String(order.id),
    shopify_order_name: orderName,
    sold_at: soldAt,
    // Sin vendedor: una venta online no la hizo nadie del equipo todavía. Quien
    // la haya atendido por otro canal puede reclamarla desde el listado
    // (PATCH /api/ventas/[id] con `claim`).
    seller_id: null,
    seller_name: null,
    customer_name: customerNameOf(order),
    customer_contact: customerContact,
    customer_address: customerAddressOf(order),
    payment_method: paymentMethodOf(order),
    pos: "SHOPIFY",
    sale_discount: 0,
    shipping_amount: shippingAmountOf(order),
    invoiced: false,
    delivered: fulfilled,
    notes: clean(order.note),
  };

  const items: MappedOrder["items"] = [];
  const products: MatchedProduct[] = [];

  for (const li of order.line_items ?? []) {
    if (li.id == null) continue;
    const qty = Math.max(1, Math.trunc(num(li.quantity)) || 1);
    const { price, discount } = priceAndDiscount(li);
    const { color, talle } = splitVariantTitle(li.variant_title ?? null);
    const product = await findProductForLine(li, supa);
    if (product && !products.some((p) => p.id === product.id)) products.push(product);

    const lineReturned = cancelled || (refunded.get(String(li.id)) ?? 0) >= qty;

    items.push({
      product,
      row: {
        shopify_line_item_id: String(li.id),
        product_id: product?.id ?? null,
        variant_gid: li.variant_id != null ? `gid://shopify/ProductVariant/${li.variant_id}` : null,
        article: clean(li.title) ?? clean(li.name) ?? "Artículo sin nombre",
        color,
        talle,
        qty,
        is_other_brand: false,
        price,
        discount,
        stock_deducted: !lineReturned,
        status: lineReturned ? "returned" : "active",
        counts_revenue: !lineReturned,
        returned_at: lineReturned ? new Date().toISOString() : null,
        return_reason: cancelled
          ? "Orden cancelada en Shopify"
          : lineReturned
            ? "Reembolsada en Shopify"
            : null,
      },
    });
  }

  return { sale, items, products };
}

/**
 * Campos que Shopify sigue siendo dueño de actualizar en una prenda ya
 * importada.
 *
 * El resto NO se toca en un re-import. Un vendedor puede haber reclamado la
 * venta, cambiado el canal, adjuntado la factura o corregido los datos del
 * cliente: pisar eso con el payload de Shopify en el siguiente `orders/updated`
 * borraría el trabajo sin avisar.
 */
type ShopifyOwnedItemPatch = {
  status: string;
  counts_revenue: boolean;
  stock_deducted: boolean;
  returned_at: string | null;
  return_reason: string | null;
};

export type ImportResult = { inserted: number; updated: number; products: MatchedProduct[] };

/**
 * Importa (o actualiza) una orden como UNA compra con sus prendas.
 *
 * Doble idempotencia: la cabecera por `shopify_order_id`, cada prenda por
 * `shopify_line_item_id`. Las dos son índices únicos, así que si el webhook y
 * el cron de backfill procesan la misma orden a la vez, la base arbitra y el
 * perdedor no duplica nada.
 */
export async function importOrder(order: ShopifyOrder, supa: Supa): Promise<ImportResult> {
  const mapped = await mapOrder(order, supa);
  if (!mapped.items.length) return { inserted: 0, updated: 0, products: [] };

  // --- Cabecera. `ignoreDuplicates` para no pisar ediciones locales (vendedor
  // --- reclamado, canal corregido, factura adjunta) en cada re-import.
  const { error: saleErr } = await supa
    .from("sales")
    .upsert(mapped.sale, { onConflict: "shopify_order_id", ignoreDuplicates: true });
  if (saleErr) throw new Error(`No se pudo importar la orden: ${saleErr.message}`);

  const { data: sale, error: findErr } = await supa
    .from("sales")
    .select("id, delivered")
    .eq("shopify_order_id", mapped.sale.shopify_order_id!)
    .maybeSingle();
  if (findErr || !sale) {
    throw new Error(`No se pudo ubicar la compra importada: ${findErr?.message ?? "sin fila"}`);
  }

  // `delivered` vive en la cabecera y solo AVANZA: Shopify sabe cuándo se
  // despachó, pero si un vendedor lo marcó entregado a mano (retiro en el
  // local) no hay que volver a ponerlo en pendiente porque la orden todavía no
  // tiene fulfillment.
  if (mapped.sale.delivered && !sale.delivered) {
    await supa.from("sales").update({ delivered: true }).eq("id", sale.id);
  }

  // --- Prendas.
  const lineIds = mapped.items.map((i) => i.row.shopify_line_item_id!).filter(Boolean);
  const { data: existing } = await supa
    .from("sale_items")
    .select("id, shopify_line_item_id, status, counts_revenue, stock_deducted")
    .in("shopify_line_item_id", lineIds);
  const byLineId = new Map((existing ?? []).map((r) => [r.shopify_line_item_id!, r]));

  const toInsert = mapped.items
    .filter((i) => !byLineId.has(i.row.shopify_line_item_id!))
    .map((i) => ({ ...i.row, sale_id: sale.id }));

  let inserted = 0;
  if (toInsert.length) {
    const { data, error } = await supa
      .from("sale_items")
      .upsert(toInsert, { onConflict: "shopify_line_item_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`No se pudieron importar las prendas de la orden: ${error.message}`);
    inserted = data?.length ?? 0;
  }

  let updated = 0;
  for (const item of mapped.items) {
    const prev = byLineId.get(item.row.shopify_line_item_id!);
    if (!prev) continue;

    // Una devolución o cambio hechos en Atelier son la decisión más reciente
    // sobre esa prenda: Shopify no los conoce y no debe revertirlos.
    if (prev.status !== "active" && item.row.status === "active") continue;
    // Nada cambió: no gastamos un write (el cron reprocesa órdenes todas las
    // noches y la enorme mayoría ya está al día).
    if (
      prev.status === item.row.status &&
      prev.counts_revenue === item.row.counts_revenue &&
      prev.stock_deducted === item.row.stock_deducted
    ) {
      continue;
    }

    const patch: ShopifyOwnedItemPatch = {
      status: item.row.status!,
      counts_revenue: item.row.counts_revenue!,
      stock_deducted: item.row.stock_deducted!,
      returned_at: item.row.returned_at ?? null,
      return_reason: item.row.return_reason ?? null,
    };
    const { error } = await supa.from("sale_items").update(patch).eq("id", prev.id);
    if (error) throw new Error(`No se pudo actualizar la prenda importada: ${error.message}`);
    updated++;
  }

  return { inserted, updated, products: mapped.products };
}

/** Trae una orden puntual por id (la usa el webhook de `refunds/create`). */
export async function fetchOrder(orderId: string | number): Promise<ShopifyOrder | null> {
  const data = await shopifyAdmin<{ order?: ShopifyOrder }>(`orders/${orderId}.json`);
  return data?.order ?? null;
}

export type SyncOrdersResult = {
  orders: number;
  inserted: number;
  updated: number;
  since: string;
};

/** Cuántos días de historial trae el backfill por defecto. */
export const ORDERS_BACKFILL_DAYS = 90;

export type ShippingCorrection = {
  orderId: string;
  orderName: string | null;
  productTotal: number;
  currentShipping: number;
  shopifyShipping: number;
  currentTotal: number;
  expectedTotal: number;
  shopifyOrderTotal: number | null;
  matchesShopifyOrderTotal: boolean | null;
};

/**
 * Vista previa de envíos históricos que difieren de Shopify.
 * Es deliberadamente read-only: corregirlos requiere mandar los ids elegidos
 * al endpoint explícito de correcciones.
 */
export async function previewShippingCorrections(
  supa: Supa,
  opts: { days?: number } = {},
): Promise<ShippingCorrection[]> {
  const days = Math.max(1, Math.min(365, Math.trunc(opts.days ?? ORDERS_BACKFILL_DAYS)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let path: string | null =
    `orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since)}`;
  const orders: ShopifyOrder[] = [];

  while (path) {
    const page: { data: { orders?: ShopifyOrder[] }; next: string | null } =
      await shopifyAdminPage<{ orders?: ShopifyOrder[] }>(path);
    orders.push(...(page.data.orders ?? []));
    path = page.next;
  }

  const byId = new Map(orders.map((order) => [String(order.id), order]));
  const local = new Map<
    string,
    {
      shipping_amount: number;
      sale_discount: number;
      sale_items: {
        price: number;
        discount: number;
        qty: number;
        counts_revenue: boolean;
        exchange_adjustment: number;
      }[];
    }
  >();

  const ids = [...byId.keys()];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supa
      .from("sales")
      .select(
        "shopify_order_id, shipping_amount, sale_discount, sale_items(price, discount, qty, counts_revenue, exchange_adjustment)",
      )
      .in("shopify_order_id", ids.slice(offset, offset + 100));
    if (error) throw new Error(`No se pudo comparar el envío: ${error.message}`);
    for (const row of data ?? []) {
      if (row.shopify_order_id) local.set(row.shopify_order_id, row);
    }
  }

  const corrections: ShippingCorrection[] = [];
  for (const [orderId, order] of byId) {
    const sale = local.get(orderId);
    if (!sale) continue;
    const currentShipping = Number(sale.shipping_amount) || 0;
    const shopifyShipping = shippingAmountOf(order);
    if (Math.abs(currentShipping - shopifyShipping) < 0.005) continue;
    const currentTotal = saleTotal(sale, sale.sale_items ?? []);
    const productTotal = currentTotal - currentShipping;
    const rawOrderTotal = order.total_price == null ? null : Number(order.total_price);
    const shopifyOrderTotal = rawOrderTotal !== null && Number.isFinite(rawOrderTotal)
      ? rawOrderTotal
      : null;
    const expectedTotal = productTotal + shopifyShipping;
    corrections.push({
      orderId,
      orderName: clean(order.name) ?? null,
      productTotal,
      currentShipping,
      shopifyShipping,
      currentTotal,
      expectedTotal,
      shopifyOrderTotal,
      matchesShopifyOrderTotal:
        shopifyOrderTotal === null ? null : Math.abs(expectedTotal - shopifyOrderTotal) < 0.005,
    });
  }

  return corrections.sort((a, b) => (b.orderName ?? "").localeCompare(a.orderName ?? ""));
}

/** Corrige únicamente los ids aprobados, releyendo el importe desde Shopify. */
export async function applyShippingCorrections(
  supa: Supa,
  orderIds: string[],
): Promise<{ orderId: string; shippingAmount: number }[]> {
  const applied: { orderId: string; shippingAmount: number }[] = [];
  for (const orderId of orderIds) {
    const order = await fetchOrder(orderId);
    if (!order) throw new Error(`Orden Shopify ${orderId} inexistente`);
    const shippingAmount = shippingAmountOf(order);
    const { data, error } = await supa
      .from("sales")
      .update({ shipping_amount: shippingAmount })
      .eq("shopify_order_id", orderId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`No se pudo corregir ${order.name ?? orderId}: ${error.message}`);
    if (!data) throw new Error(`La orden ${order.name ?? orderId} todavía no está importada`);
    applied.push({ orderId, shippingAmount });
  }
  return applied;
}

/**
 * Registra el dinero efectivamente reembolsado por Shopify con la fecha de la
 * transacción. Se llama desde `refunds/create`: el backfill histórico no crea
 * movimientos silenciosamente.
 */
export async function recordShopifyRefund(
  refund: ShopifyRefundPayload,
  supa: Supa,
): Promise<number> {
  if (refund.order_id == null || refund.id == null) return 0;

  const { data: sale, error: saleError } = await supa
    .from("sales")
    .select("id, shopify_order_name, payment_method")
    .eq("shopify_order_id", String(refund.order_id))
    .maybeSingle();
  if (saleError) throw new Error(`No se pudo ubicar el reembolso: ${saleError.message}`);
  if (!sale) return 0;

  const lineIds = (refund.refund_line_items ?? [])
    .map((line) => line.line_item_id)
    .filter((lineId): lineId is string | number => lineId != null)
    .map(String);
  const { data: localItems, error: itemsError } = lineIds.length
    ? await supa
        .from("sale_items")
        .select("id")
        .eq("sale_id", sale.id)
        .in("shopify_line_item_id", lineIds)
    : { data: [], error: null };
  if (itemsError) {
    throw new Error(`No se pudieron ubicar las prendas reembolsadas: ${itemsError.message}`);
  }

  const successful = (refund.transactions ?? []).filter((transaction) => {
    const status = transaction.status?.toLowerCase();
    return (
      transaction.kind?.toLowerCase() === "refund"
      && status === "success"
      && num(transaction.amount) > 0
    );
  });
  if (!successful.length) return 0;

  const linkedItemId = localItems?.length === 1 ? localItems[0].id : null;
  let inserted = 0;
  for (const transaction of successful) {
    if (transaction.id == null) continue;
    const { data, error } = await supa
      .from("sale_movements")
      .upsert(
        {
          sale_id: sale.id,
          sale_item_id: linkedItemId,
          kind: "return",
          amount: -num(transaction.amount),
          payment_method: clean(transaction.gateway) ?? sale.payment_method,
          description: `Reembolso Shopify ${sale.shopify_order_name ?? ""}`.trim(),
          occurred_at: transaction.processed_at ?? refund.created_at ?? new Date().toISOString(),
          source_key: `shopify-refund:${refund.id}:${transaction.id}`,
        },
        { onConflict: "source_key", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(`No se pudo registrar el reembolso: ${error.message}`);
    inserted += data?.length ?? 0;
  }

  // `importOrder` mantiene la compatibilidad de los reembolsos históricos
  // poniendo la línea en false. Una vez guardado el egreso fechado por el
  // webhook, la base original debe contar otra vez en el mes de la venta.
  if (localItems?.length) {
    const { error } = await supa
      .from("sale_items")
      .update({ counts_revenue: true })
      .in("id", localItems.map((item) => item.id));
    if (error) {
      throw new Error(`El reembolso se guardó pero no se preservó la venta original: ${error.message}`);
    }
  }

  return inserted;
}

/**
 * Reimporta las órdenes de los últimos `days` días.
 *
 * Los webhooks son el mecanismo principal y esto es la red, igual que
 * `syncProducts`: si un webhook se pierde —o queda apuntando a otro deploy, que
 * es exactamente lo que pasó entre junio y septiembre de 2026— la venta
 * aparece en la corrida siguiente en vez de faltar para siempre. Corre por cron
 * (ver `vercel.json`) y también a pedido para el backfill inicial.
 *
 * `status=any` incluye canceladas y archivadas a propósito: una orden cancelada
 * tiene que entrar marcada como devuelta, no faltar.
 */
export async function syncOrders(
  supa: Supa,
  opts: { days?: number } = {},
): Promise<SyncOrdersResult> {
  const days = Math.max(1, Math.trunc(opts.days ?? ORDERS_BACKFILL_DAYS));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let path: string | null =
    `orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since)}`;
  let orders = 0;
  let inserted = 0;
  let updated = 0;

  while (path) {
    const page: { data: { orders?: ShopifyOrder[] }; next: string | null } =
      await shopifyAdminPage<{ orders?: ShopifyOrder[] }>(path);
    for (const order of page.data.orders ?? []) {
      const res = await importOrder(order, supa);
      orders++;
      inserted += res.inserted;
      updated += res.updated;
    }
    path = page.next;
  }

  return { orders, inserted, updated, since };
}
