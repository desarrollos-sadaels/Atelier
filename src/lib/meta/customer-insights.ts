import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Lecturas de clientes (segmentación, retención, combos) para el producto
 * vinculado a una campaña — metodología inspirada en las skills de
 * carodubi.com/skills.
 *
 * Desde la 0018 el cliente vive en `sales` (la compra) y el artículo en
 * `sale_items` (la prenda), así que todo esto atraviesa las dos tablas. La
 * "ocasión de compra" ya no hay que aproximarla con `customer_dni + sold_at`:
 * una compra ES una fila de `sales`, que es justamente lo que faltaba.
 */

async function buyerDnisOf(productId: string): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("sale_items")
    .select("sales!inner(customer_dni)")
    .eq("product_id", productId)
    .not("sales.customer_dni", "is", null);
  const dnis = (data ?? [])
    .map((r) => (r.sales as unknown as { customer_dni: string | null } | null)?.customer_dni)
    .filter((d): d is string => Boolean(d));
  return [...new Set(dnis)];
}

export type CustomerSegments = {
  totalCustomers: number;
  campeones: number;
  enRiesgo: number;
  dormidos: number;
  nuevos: number;
};

/**
 * Segmenta (RFM simplificado) a los compradores de un producto, usando TODO
 * su historial de compras (no solo las de este producto):
 * - Dormido: última compra hace más de 270 días.
 * - Nuevo: una sola compra registrada (sin historial suficiente).
 * - Campeón: 3+ ocasiones de compra y la última fue hace 90 días o menos.
 * - En riesgo: el resto (compró más de una vez, pero no califica como Campeón).
 */
export async function getCustomerSegments(productId: string): Promise<CustomerSegments> {
  const dnis = await buyerDnisOf(productId);
  if (!dnis.length) {
    return { totalCustomers: 0, campeones: 0, enRiesgo: 0, dormidos: 0, nuevos: 0 };
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("sales")
    .select("customer_dni, sold_at")
    .in("customer_dni", dnis);

  const byDni = new Map<string, { occasions: Set<string>; lastDate: string }>();
  for (const row of data ?? []) {
    const dni = row.customer_dni;
    if (!dni) continue;
    const entry = byDni.get(dni) ?? { occasions: new Set<string>(), lastDate: row.sold_at };
    entry.occasions.add(row.sold_at);
    if (row.sold_at > entry.lastDate) entry.lastDate = row.sold_at;
    byDni.set(dni, entry);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const segments = { campeones: 0, enRiesgo: 0, dormidos: 0, nuevos: 0 };
  for (const { occasions, lastDate } of byDni.values()) {
    const recencyDays = Math.floor(
      (Date.parse(todayIso) - Date.parse(lastDate)) / 86_400_000,
    );
    const frequency = occasions.size;
    if (recencyDays > 270) segments.dormidos++;
    else if (frequency === 1) segments.nuevos++;
    else if (frequency >= 3 && recencyDays <= 90) segments.campeones++;
    else segments.enRiesgo++;
  }

  return { totalCustomers: byDni.size, ...segments };
}

export type RetentionInfo = {
  totalBuyers: number;
  returned: number;
  retentionRate: number;
};

/** % de compradores de este producto que volvieron a comprar (cualquier producto) después. */
export async function getRetention(productId: string): Promise<RetentionInfo> {
  const dnis = await buyerDnisOf(productId);
  if (!dnis.length) return { totalBuyers: 0, returned: 0, retentionRate: 0 };

  const supabase = await createClient();
  const [{ data: firstBuys }, { data: allSales }] = await Promise.all([
    supabase
      .from("sale_items")
      .select("sales!inner(customer_dni, sold_at)")
      .eq("product_id", productId)
      .in("sales.customer_dni", dnis)
      .then(({ data }) => ({
        data: (data ?? []).map(
          (r) => r.sales as unknown as { customer_dni: string | null; sold_at: string },
        ),
      })),
    supabase.from("sales").select("customer_dni, sold_at").in("customer_dni", dnis),
  ]);

  const firstPurchaseDate = new Map<string, string>();
  for (const row of firstBuys ?? []) {
    const dni = row.customer_dni;
    if (!dni) continue;
    const prev = firstPurchaseDate.get(dni);
    if (!prev || row.sold_at < prev) firstPurchaseDate.set(dni, row.sold_at);
  }

  const returned = new Set<string>();
  for (const row of allSales ?? []) {
    const dni = row.customer_dni;
    if (!dni) continue;
    const first = firstPurchaseDate.get(dni);
    if (first && row.sold_at > first) returned.add(dni);
  }

  return {
    totalBuyers: dnis.length,
    returned: returned.size,
    retentionRate: dnis.length > 0 ? returned.size / dnis.length : 0,
  };
}

export type ProductAffinityRow = { article: string; buyers: number };

/** Qué otros productos compran los mismos clientes que compraron este ("combos"). */
export async function getProductAffinity(
  productId: string,
  limit = 5,
): Promise<ProductAffinityRow[]> {
  const dnis = await buyerDnisOf(productId);
  if (!dnis.length) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("sale_items")
    .select("article, product_id, sales!inner(customer_dni)")
    .in("sales.customer_dni", dnis)
    .neq("product_id", productId);

  const buyersByArticle = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const dni = (row.sales as unknown as { customer_dni: string | null } | null)?.customer_dni;
    if (!dni || !row.article) continue;
    const set = buyersByArticle.get(row.article) ?? new Set<string>();
    set.add(dni);
    buyersByArticle.set(row.article, set);
  }

  return [...buyersByArticle.entries()]
    .map(([article, buyers]) => ({ article, buyers: buyers.size }))
    .sort((a, b) => b.buyers - a.buyers)
    .slice(0, limit);
}
