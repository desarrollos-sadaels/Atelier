import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Tables } from "@/lib/supabase/types";
import type { UiProduct } from "@/lib/ui-types";
import { normalizeCategory } from "@/lib/categories";
import { normalizeRole, type Role } from "@/lib/roles";
import { parsePaymentMethods, DEFAULT_PAYMENT_METHODS, type PaymentMethod } from "@/lib/payments";
import { parseNotificationSettings, type NotificationSettings } from "@/lib/notifications";
import { saleNet } from "@/lib/sales";

export type { UiProduct };

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function formatARS(n: number | null): string {
  return n == null ? "—" : ars.format(n);
}

const SHOPIFY_LABEL: Record<string, string> = {
  active: "Activo",
  draft: "Borrador",
  archived: "Archivado",
};

function toUi(p: Tables<"products">, linkedProductIds?: Set<string>): UiProduct {
  const linked = linkedProductIds?.has(p.id) ?? false;
  return {
    id: p.id,
    name: p.name,
    sku: p.sku ?? "—",
    cat: normalizeCategory(p.category),
    price: formatARS(p.price),
    priceNum: p.price ?? 0,
    stock: `${p.stock}u`,
    out: p.stock === 0,
    shopify: p.stock === 0 ? "Sin stock" : (SHOPIFY_LABEL[p.shopify_status ?? "active"] ?? "Activo"),
    meta: linked ? "Vinculado" : "—",
    metaState: linked ? "a" : "n",
    image: p.image_url ?? null,
    stockNum: p.stock,
    alertThreshold: p.alert_threshold,
  };
}

export async function getProducts(): Promise<UiProduct[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const [{ data }, { data: links }] = await Promise.all([
    supabase.from("products").select("*").order("name", { ascending: true }),
    supabase.from("product_campaign_links").select("product_id"),
  ]);
  const linkedProductIds = new Set((links ?? []).map((l) => l.product_id));
  return (data ?? []).map((p) => toUi(p, linkedProductIds));
}

export async function getProductById(id: string): Promise<Tables<"products"> | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("*").eq("id", id).limit(1);
  return data?.[0] ?? null;
}

export type ProductCampaignLink = {
  linkId: string;
  metaCampaignId: string | null;
  name: string;
  status: string | null;
};

/** Campaña de Meta vinculada a este producto (a lo sumo una), si existe. */
export async function getProductCampaignLink(productId: string): Promise<ProductCampaignLink | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_campaign_links")
    .select("id, campaigns(meta_campaign_id, name, status)")
    .eq("product_id", productId)
    .limit(1)
    .maybeSingle();
  const campaign = data?.campaigns as
    | { meta_campaign_id: string | null; name: string; status: string | null }
    | null
    | undefined;
  if (!data || !campaign) return null;
  return {
    linkId: data.id,
    metaCampaignId: campaign.meta_campaign_id,
    name: campaign.name,
    status: campaign.status,
  };
}

export type DashboardStats = {
  total: number;
  lowStock: number;
  outStock: number;
  alerts: { name: string; sku: string; qty: string; alert: boolean }[];
};

export async function getDashboardStats(): Promise<DashboardStats> {
  if (!isSupabaseConfigured()) return { total: 0, lowStock: 0, outStock: 0, alerts: [] };
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("name,sku,stock,alert_threshold");
  const rows = data ?? [];
  const lowStock = rows.filter((r) => r.stock > 0 && r.stock <= r.alert_threshold).length;
  const outStock = rows.filter((r) => r.stock === 0).length;
  const alerts = [...rows]
    .filter((r) => r.stock <= r.alert_threshold)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 5)
    .map((r) => ({ name: r.name, sku: r.sku ?? "—", qty: `${r.stock}u`, alert: r.stock === 0 }));
  return { total: rows.length, lowStock, outStock, alerts };
}

// ---------- perfil / rol ----------

export type CurrentProfile = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

/** Perfil del usuario logueado (null en modo demo / sin sesión). */
export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", user.id)
    .maybeSingle();
  return {
    id: user.id,
    email: data?.email ?? user.email ?? "",
    name: data?.full_name ?? user.email ?? "Usuario",
    role: normalizeRole(data?.role),
  };
}

// ---------- ventas ----------

export type SaleRow = Tables<"sales">;

export const SALES_PAGE_SIZE = 50;

export type SalesPage = { rows: SaleRow[]; total: number };

/** Rango [inicio, fin) de un mes YYYY-MM. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start: `${month}-01`, end };
}

/**
 * PostgREST parsea el filtro `or=(...)` separando por comas y paréntesis, así
 * que esos caracteres en el término de búsqueda romperían la query.
 */
function sanitizeSearch(q: string): string {
  return q.trim().replace(/[,()%*\\"']/g, "").slice(0, 60);
}

/**
 * Una página de ventas del rango, más recientes primero, con búsqueda opcional
 * por artículo, cliente o vendedor.
 *
 * Antes esto traía TODAS las ventas del mes con `select("*")` y la búsqueda y
 * la paginación se hacían en el cliente. Con 200 ventas/día eso son ~6.000
 * filas —incluyendo datos personales de cada cliente— en cada carga de página.
 */
export async function getSales(
  start: string,
  end: string,
  opts: { q?: string; page?: number; pageSize?: number } = {},
): Promise<SalesPage> {
  if (!isSupabaseConfigured()) return { rows: [], total: 0 };
  const { q = "", page = 1, pageSize = SALES_PAGE_SIZE } = opts;
  const supabase = await createClient();

  let query = supabase
    .from("sales")
    .select("*", { count: "exact" })
    .gte("sold_at", start)
    .lt("sold_at", end);

  const term = sanitizeSearch(q);
  if (term) {
    query = query.or(
      `article.ilike.%${term}%,customer_name.ilike.%${term}%,seller_name.ilike.%${term}%`,
    );
  }

  const from = Math.max(0, (page - 1) * pageSize);
  const { data, count } = await query
    .order("sold_at", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  return { rows: data ?? [], total: count ?? 0 };
}

export type SalesKpis = {
  totalAmount: number;
  units: number;
  operations: number;
  pendingDelivery: number;
  otherBrandUnits: number;
};

const EMPTY_KPIS: SalesKpis = {
  totalAmount: 0,
  units: 0,
  operations: 0,
  pendingDelivery: 0,
  otherBrandUnits: 0,
};

/**
 * KPIs del rango completo, agregados en Postgres (función `sales_kpis`).
 * Son cinco números, independientes de la página y de la búsqueda activa.
 */
export async function getSalesKpis(start: string, end: string): Promise<SalesKpis> {
  if (!isSupabaseConfigured()) return EMPTY_KPIS;
  const supabase = await createClient();
  const { data } = await supabase.rpc("sales_kpis", { p_start: start, p_end: end });
  const r = data?.[0];
  if (!r) return EMPTY_KPIS;
  return {
    totalAmount: Number(r.total_amount) || 0,
    units: Number(r.units) || 0,
    operations: Number(r.operations) || 0,
    pendingDelivery: Number(r.pending_delivery) || 0,
    otherBrandUnits: Number(r.other_brand_units) || 0,
  };
}

/** Rango [hoy, mañana) en horario de Buenos Aires. */
function todayRangeART(): { start: string; end: string } {
  const start = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
  const [y, m, d] = start.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(
    next.getUTCDate(),
  ).padStart(2, "0")}`;
  return { start, end };
}

/** Monto total vendido "hoy" (Buenos Aires) — para el KPI del dashboard. */
export async function getTodaySales(): Promise<{ totalAmount: number; operations: number }> {
  const { start, end } = todayRangeART();
  const { totalAmount, operations } = await getSalesKpis(start, end);
  return { totalAmount, operations };
}

// ---------- meta (ROAS real) ----------

/** [hoy-7, hoy) en Buenos Aires — mismo criterio que el "last_7d" de Meta. */
function last7DaysRangeART(): { start: string; end: string } {
  const { start: today } = todayRangeART();
  const [y, m, d] = today.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - 7));
  const start = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}-${String(
    from.getUTCDate(),
  ).padStart(2, "0")}`;
  return { start, end: today };
}

/**
 * Ingreso real (tabla `sales`, últimos 7 días) de los productos vinculados a
 * cada campaña de Meta — para calcular un ROAS real (venta efectiva / gasto)
 * en vez del que reporta la propia Meta (atribución de su Pixel/CAPI).
 */
export async function getRealRevenueByMetaCampaignId(
  metaCampaignIds: string[],
): Promise<Record<string, number>> {
  if (!isSupabaseConfigured() || metaCampaignIds.length === 0) return {};
  const supabase = await createClient();

  const { data: campaignRows } = await supabase
    .from("campaigns")
    .select("id, meta_campaign_id")
    .in("meta_campaign_id", metaCampaignIds);
  if (!campaignRows?.length) return {};

  const internalToMeta = new Map(
    campaignRows
      .filter((c): c is { id: string; meta_campaign_id: string } => Boolean(c.meta_campaign_id))
      .map((c) => [c.id, c.meta_campaign_id]),
  );

  const { data: links } = await supabase
    .from("product_campaign_links")
    .select("product_id, campaign_id")
    .in("campaign_id", [...internalToMeta.keys()]);
  if (!links?.length) return {};

  const productToMeta = new Map<string, string>();
  for (const l of links) {
    const meta = internalToMeta.get(l.campaign_id);
    if (meta) productToMeta.set(l.product_id, meta);
  }
  if (!productToMeta.size) return {};

  // Arranca en 0 (no `undefined`) para toda campaña CON producto vinculado —
  // así el caller distingue "vinculada, 0 ventas" de "sin vincular" (sin key).
  const revenue: Record<string, number> = {};
  for (const meta of productToMeta.values()) revenue[meta] = 0;

  const { start, end } = last7DaysRangeART();
  const { data: sales } = await supabase
    .from("sales")
    .select("product_id, price, discount, qty")
    .in("product_id", [...productToMeta.keys()])
    .gte("sold_at", start)
    .lt("sold_at", end);

  for (const s of sales ?? []) {
    const meta = s.product_id ? productToMeta.get(s.product_id) : undefined;
    if (!meta) continue;
    revenue[meta] += saleNet(s);
  }
  return revenue;
}

// ---------- settings ----------

/** Métodos de pago configurables (fallback a DEFAULT_PAYMENT_METHODS). */
export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  if (!isSupabaseConfigured()) return DEFAULT_PAYMENT_METHODS;
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "payment_methods")
    .maybeSingle();
  return parsePaymentMethods(data?.value);
}

/** Preferencias de notificación (para el panel de Configuración). */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  if (!isSupabaseConfigured()) return parseNotificationSettings(undefined);
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "notification_settings")
    .maybeSingle();
  return parseNotificationSettings(data?.value);
}

// ---------- notificaciones (campanita) ----------

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  severity: string;
  read: boolean;
  createdAt: string;
};

/** Últimas notificaciones para la campanita. */
export async function getNotifications(limit = 8): Promise<NotificationItem[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id,type,title,body,severity,read,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    severity: n.severity,
    read: n.read,
    createdAt: n.created_at,
  }));
}

/** Cantidad de notificaciones sin leer. */
export async function getUnreadCount(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("read", false);
  return count ?? 0;
}

export type ActivityItem = { title: string; body: string | null; severity: string; date: string };

export async function getRecentActivity(): Promise<ActivityItem[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("title,body,severity,created_at")
    .order("created_at", { ascending: false })
    .limit(6);
  return (data ?? []).map((n) => ({
    title: n.title,
    body: n.body,
    severity: n.severity,
    date: new Date(n.created_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }),
  }));
}
