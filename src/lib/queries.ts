import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Tables } from "@/lib/supabase/types";
import type { UiProduct } from "@/lib/ui-types";
import { normalizeCategory } from "@/lib/categories";

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

function toUi(p: Tables<"products">): UiProduct {
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
    meta: "—",
    metaState: "n",
    image: p.image_url ?? null,
    stockNum: p.stock,
    alertThreshold: p.alert_threshold,
  };
}

export async function getProducts(): Promise<UiProduct[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("*").order("name", { ascending: true });
  return (data ?? []).map(toUi);
}

export async function getProductById(id: string): Promise<Tables<"products"> | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("*").eq("id", id).limit(1);
  return data?.[0] ?? null;
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
