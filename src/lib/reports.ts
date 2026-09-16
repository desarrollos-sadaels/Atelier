import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  DELIVERY_STATE_LABEL,
  SALE_ITEM_STATUS_LABEL,
  deliveryState,
  normalizeItemStatus,
  saleItemRevenue,
} from "@/lib/sales";
import {
  CHANNEL_LABEL,
  EMPTY_HIGHLIGHTS,
  SALE_CHANNELS,
  saleChannel,
  sellerLabel,
  type BreakdownRow,
  type ReportHighlights,
  type SaleChannel,
} from "@/lib/sales-report";

const num = (v: unknown) => Number(v) || 0;

const isChannel = (v: string): v is SaleChannel => SALE_CHANNELS.some((c) => c.value === v);

export type SalesBreakdown = { rows: BreakdownRow[]; error: string | null };

/**
 * Ventas del rango [start, end) por vendedor y canal (función
 * `sales_by_seller_channel`, migraciones 0024/0025). Los filtros de canal y de
 * cuenta se aplican después, sobre estas filas: son a lo sumo cuentas × 4, y así
 * una sola consulta alimenta el resumen, la tabla por canal y la tabla por
 * vendedor.
 *
 * El error se devuelve en vez de tragarse: si la función no está aplicada, un
 * reporte vacío se leería como "nadie vendió nada".
 */
export async function getSalesBreakdown(start: string, end: string): Promise<SalesBreakdown> {
  if (!isSupabaseConfigured()) return { rows: [], error: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sales_by_seller_channel", {
    p_start: start,
    p_end: end,
  });
  if (error) return { rows: [], error: error.message };
  return {
    rows: (data ?? []).map((r) => ({
      sellerId: r.seller_id,
      name: r.seller_name,
      // Un canal desconocido solo podría venir de una función SQL más nueva que
      // este código; se cuenta como Atelier antes que perder la plata.
      channel: isChannel(r.channel) ? r.channel : "atelier",
      total: num(r.total_amount),
      units: num(r.units),
      operations: num(r.operations),
      pendingDelivery: num(r.pending_delivery),
      returnedCount: num(r.returned_count),
      returnedUnits: num(r.returned_units),
      returnedAmount: num(r.returned_amount),
      exchangedCount: num(r.exchanged_count),
      exchangedUnits: num(r.exchanged_units),
    })),
    error: null,
  };
}

/**
 * Ítem más vendido (top 5) y día con mayores ventas, con los filtros de la
 * pantalla (función `sales_report_highlights`, migración 0025). No se puede
 * sacar de `getSalesBreakdown`: necesita las prendas y los días, que ahí ya
 * vienen agregados.
 *
 * Si falla devuelve vacío: los destacados acompañan al reporte, y el error de
 * fondo (función no aplicada, por ejemplo) ya lo muestra el breakdown.
 */
export async function getReportHighlights(
  start: string,
  end: string,
  opts: { channels: readonly SaleChannel[]; sellerId: string | null },
): Promise<ReportHighlights> {
  if (!isSupabaseConfigured()) return EMPTY_HIGHLIGHTS;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sales_report_highlights", {
    p_start: start,
    p_end: end,
    p_channels: opts.channels.length ? [...opts.channels] : null,
    p_seller_id: opts.sellerId,
  });
  if (error || !data || typeof data !== "object") return EMPTY_HIGHLIGHTS;

  const raw = data as { top_items?: unknown; best_day?: unknown };
  const topItems = Array.isArray(raw.top_items)
    ? raw.top_items.map((t) => {
        const it = t as Record<string, unknown>;
        return { name: String(it.name ?? "—"), units: num(it.units), amount: num(it.amount) };
      })
    : [];
  const bd = raw.best_day as Record<string, unknown> | null | undefined;
  const bestDay =
    bd && typeof bd.day === "string"
      ? { day: bd.day.slice(0, 10), amount: num(bd.amount), operations: num(bd.operations) }
      : null;
  return { topItems, bestDay };
}

export type SaleDetailLine = {
  soldAt: string;
  order: string;
  channel: string;
  seller: string;
  article: string;
  color: string;
  talle: string;
  qty: number;
  price: number;
  itemDiscount: number;
  saleDiscount: number;
  amount: number;
  itemStatus: string;
  paymentMethod: string;
  installments: number | null;
  pos: string;
  delivery: string;
};

/** Filas por pedido a PostgREST. Su `max-rows` default es 1000; pedir más no sirve. */
const DETAIL_BATCH = 1000;
/** Tope de compras de un export. Con el rango limitado a un año sobra; si se llega, se avisa. */
const DETAIL_MAX_SALES = 30_000;

/** Día (YYYY-MM-DD) de un timestamp en hora de Buenos Aires, el corte que usa la base. */
const ART_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

const MOVEMENT_LABEL: Record<string, string> = {
  return: "Devolución",
  exchange_difference: "Diferencia de cambio",
};

/**
 * Una línea por prenda, una por envío y una por movimiento para el CSV de detalle.
 *
 * El canal se filtra acá y no en la query porque no es una columna: sale de
 * `saleChannel`, el espejo de la función SQL. La cuenta sí va en la query.
 *
 * El corte de páginas usa el `count` y avanza por lo que efectivamente llegó,
 * no por el tamaño pedido: si el proyecto tiene un `max-rows` menor a 1000,
 * cortar cuando "vinieron menos de 1000" devolvería un export incompleto sin
 * avisar.
 *
 * Sin DNI, contacto ni dirección del cliente: el reporte es de ventas, y un CSV
 * se reenvía por mail sin pensarlo.
 *
 * Los movimientos de `sale_movements` (el egreso de una devolución, la
 * diferencia cobrada en un cambio) van en su propia línea, con la fecha en que
 * OCURRIERON y el canal y la cuenta de la compra original: el mismo criterio
 * que `sales_kpis`. Desde Taller la app escribe ahí en cada devolución, y sin
 * estas líneas el detalle dejaba de sumar lo mismo que el resumen.
 */
export async function getSalesDetail(
  start: string,
  end: string,
  opts: { channels: readonly SaleChannel[]; sellerId?: string | null },
): Promise<{ lines: SaleDetailLine[]; truncated: boolean }> {
  const supabase = await createClient();
  const lines: SaleDetailLine[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total && offset < DETAIL_MAX_SALES) {
    let query = supabase
      .from("sales")
      .select(
        "id, sold_at, shopify_order_name, origin, pos, workshop_order_id, seller_id, seller_name, payment_method, installments, delivered, preorder, sale_discount, shipping_amount, sale_items(created_at, article, color, talle, qty, price, discount, status, counts_revenue, exchange_adjustment)",
        { count: offset === 0 ? "exact" : undefined },
      )
      .gte("sold_at", start)
      .lt("sold_at", end);
    if (opts.sellerId) query = query.eq("seller_id", opts.sellerId);

    const { data, count, error } = await query
      .order("sold_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + DETAIL_BATCH - 1);
    if (error) throw new Error(error.message);
    if (offset === 0) total = count ?? 0;
    if (!data?.length) break;
    offset += data.length;

    for (const sale of data) {
      const channel = saleChannel(sale);
      if (opts.channels.length && !opts.channels.includes(channel)) continue;

      const base = {
        soldAt: sale.sold_at,
        order: sale.shopify_order_name ?? sale.id.slice(0, 8),
        channel: CHANNEL_LABEL[channel],
        seller: sellerLabel({ sellerId: sale.seller_id, name: sale.seller_name }),
        saleDiscount: num(sale.sale_discount),
        paymentMethod: sale.payment_method ?? "",
        installments: sale.installments,
        pos: sale.pos ?? "",
        delivery: DELIVERY_STATE_LABEL[deliveryState(sale)],
      };
      const items = [...(sale.sale_items ?? [])].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
      for (const it of items) {
        lines.push({
          ...base,
          article: it.article ?? "",
          color: it.color ?? "",
          talle: it.talle ?? "",
          qty: it.qty,
          price: num(it.price),
          itemDiscount: num(it.discount),
          amount: saleItemRevenue(it, sale.sale_discount),
          itemStatus: SALE_ITEM_STATUS_LABEL[normalizeItemStatus(it.status)],
        });
      }
      // El envío se cobra solo si la compra factura; `sales_kpis` lo muestra aparte.
      const shipping = num(sale.shipping_amount);
      if (shipping !== 0 && items.some((it) => it.counts_revenue)) {
        lines.push({
          ...base,
          article: "Envío",
          color: "",
          talle: "",
          qty: 1,
          price: shipping,
          itemDiscount: 0,
          saleDiscount: 0,
          amount: shipping,
          itemStatus: "",
        });
      }
    }
  }

  // Movimientos del rango, por `occurred_at`. Los días son de Buenos Aires
  // (UTC-3 fijo, sin horario de verano): el mismo corte que hace la base.
  let movOffset = 0;
  let movTotal = Infinity;
  while (movOffset < movTotal) {
    let query = supabase
      .from("sale_movements")
      .select(
        "id, occurred_at, kind, amount, payment_method, description, sale_items(article, color, talle), sales!inner(id, shopify_order_name, origin, pos, workshop_order_id, seller_id, seller_name, installments)",
        { count: movOffset === 0 ? "exact" : undefined },
      )
      .gte("occurred_at", `${start}T00:00:00-03:00`)
      .lt("occurred_at", `${end}T00:00:00-03:00`);
    if (opts.sellerId) query = query.eq("sales.seller_id", opts.sellerId);

    const { data, count, error } = await query
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(movOffset, movOffset + DETAIL_BATCH - 1);
    if (error) throw new Error(error.message);
    if (movOffset === 0) movTotal = count ?? 0;
    if (!data?.length) break;
    movOffset += data.length;

    for (const m of data) {
      const sale = m.sales;
      const channel = saleChannel(sale);
      if (opts.channels.length && !opts.channels.includes(channel)) continue;
      const amount = num(m.amount);
      lines.push({
        soldAt: ART_DAY.format(new Date(m.occurred_at)),
        order: sale.shopify_order_name ?? sale.id.slice(0, 8),
        channel: CHANNEL_LABEL[channel],
        seller: sellerLabel({ sellerId: sale.seller_id, name: sale.seller_name }),
        article: m.description ?? m.sale_items?.article ?? "",
        color: m.sale_items?.color ?? "",
        talle: m.sale_items?.talle ?? "",
        // Un movimiento es plata, no mercadería: no suma unidades.
        qty: 0,
        price: amount,
        itemDiscount: 0,
        saleDiscount: 0,
        amount,
        itemStatus: MOVEMENT_LABEL[m.kind] ?? m.kind,
        paymentMethod: m.payment_method ?? "",
        installments: sale.installments,
        pos: sale.pos ?? "",
        delivery: "",
      });
    }
  }

  // Compras por `sold_at` y movimientos por su fecha, en un solo orden. `sort`
  // es estable: las líneas de una compra siguen juntas y en su orden.
  lines.sort((a, b) => a.soldAt.localeCompare(b.soldAt));

  return { lines, truncated: offset < total };
}
