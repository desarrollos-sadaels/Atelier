import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Lecturas de clientes (segmentación, retención, combos) para el producto
 * vinculado a una campaña — metodología inspirada en las skills de
 * carodubi.com/skills, adaptadas a la tabla `sales` (sin order_id: se agrupa
 * por customer_dni + sold_at como proxy de "ocasión de compra").
 */

type SaleRow = {
  customer_dni: string | null;
  article: string;
  qty: number;
  price: number;
  discount: number;
  sold_at: string;
};

async function buyerDnisOf(productId: string): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales")
    .select("customer_dni")
    .eq("product_id", productId)
    .not("customer_dni", "is", null);
  return [...new Set((data ?? []).map((r) => r.customer_dni as string))];
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
      .from("sales")
      .select("customer_dni, sold_at")
      .eq("product_id", productId)
      .in("customer_dni", dnis),
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
    .from("sales")
    .select("customer_dni, article")
    .in("customer_dni", dnis)
    .neq("product_id", productId);

  const buyersByArticle = new Map<string, Set<string>>();
  for (const row of (data ?? []) as SaleRow[]) {
    const dni = row.customer_dni;
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
