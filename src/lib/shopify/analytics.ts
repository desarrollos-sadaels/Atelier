import "server-only";
import { shopifyAdminPage } from "./client";

export type ShopifyOverview = {
  revenue: number;
  orders: number;
  aov: number;
};

type ShopifyOrderRow = {
  id: number;
  total_price: string;
  cancelled_at: string | null;
};

/** [hoy-7, hoy) en Buenos Aires — mismo criterio que el resto de /metricas (Meta "last_7d"). */
function last7DaysRangeART(): { start: string; end: string } {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - 7));
  const start = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}-${String(
    from.getUTCDate(),
  ).padStart(2, "0")}`;
  return { start, end: today };
}

/**
 * Ingresos, pedidos y ticket promedio de la tienda (Shopify Orders API en
 * vivo, no pasa por Supabase), últimos 7 días. Excluye pedidos cancelados.
 */
export async function getShopifyOverview(): Promise<ShopifyOverview> {
  const { start, end } = last7DaysRangeART();
  let path: string | null =
    `orders.json?status=any&created_at_min=${start}T00:00:00-03:00&created_at_max=${end}T00:00:00-03:00&fields=id,total_price,cancelled_at&limit=250`;

  let revenue = 0;
  let orders = 0;
  while (path) {
    const page: { data: { orders: ShopifyOrderRow[] }; next: string | null } =
      await shopifyAdminPage<{ orders: ShopifyOrderRow[] }>(path);
    for (const o of page.data.orders ?? []) {
      if (o.cancelled_at) continue;
      revenue += Number(o.total_price);
      orders += 1;
    }
    path = page.next;
  }
  return { revenue, orders, aov: orders > 0 ? revenue / orders : 0 };
}
