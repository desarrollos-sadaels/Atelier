import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Tables } from "@/lib/supabase/types";
import type { UiProduct } from "@/lib/ui-types";
import { normalizeCategory } from "@/lib/categories";
import { normalizeRole, type Role } from "@/lib/roles";
import { parsePaymentMethods, DEFAULT_PAYMENT_METHODS, type PaymentMethod } from "@/lib/payments";
import { parseExternalBrands, DEFAULT_EXTERNAL_BRANDS, type ExternalBrand } from "@/lib/external-brands";
import { parseNotificationSettings, type NotificationSettings } from "@/lib/notifications";
import { grossProductRevenue, saleItemRevenue, saleTotal, type SaleOrigin } from "@/lib/sales";
import { workshopSaleKey } from "@/lib/workshop-sales";

export type { UiProduct };

export async function getExternalBrands(): Promise<ExternalBrand[]> {
  if (!isSupabaseConfigured()) return DEFAULT_EXTERNAL_BRANDS;
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "external_brands")
    .maybeSingle();
  return parseExternalBrands(data?.value);
}

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
    isPreorder: p.is_preorder,
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

export type PickerProduct = {
  id: string;
  name: string;
  sku: string;
  image: string | null;
  price: number;
  stock: number;
  isPreorder: boolean;
};

/**
 * Catálogo reducido para los buscadores de prendas (alta de venta, cambio).
 *
 * No es `getProducts()` con otro nombre: aquella trae `select("*")` de 404
 * productos más el join de campañas para armar la grilla del catálogo. Acá
 * solo hacen falta seis columnas y ninguna relación, y la lista se serializa
 * entera al cliente — traer el resto es pagar peso en cada búsqueda.
 */
export async function getPickerProducts(): Promise<PickerProduct[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, sku, image_url, price, stock, is_preorder")
    .order("name", { ascending: true });
  if (!error) {
    return (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku ?? "—",
      image: p.image_url,
      price: p.price ?? 0,
      stock: p.stock,
      isPreorder: p.is_preorder,
    }));
  }

  // Mantiene operativo el selector si el deploy llega antes que la columna
  // aditiva de pre-order. La etiqueta queda apagada hasta aplicar la migración,
  // pero el catálogo existente nunca desaparece por ese desacople temporal.
  const fallback = await supabase
    .from("products")
    .select("id, name, sku, image_url, price, stock")
    .order("name", { ascending: true });
  if (fallback.error) {
    throw new Error(`No se pudo cargar el catálogo: ${fallback.error.message}`);
  }
  return (fallback.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku ?? "—",
    image: p.image_url,
    price: p.price ?? 0,
    stock: p.stock,
    isPreorder: false,
  }));
}

export async function getProductById(id: string): Promise<Tables<"products"> | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("*").eq("id", id).limit(1);
  return data?.[0] ?? null;
}

// ---------- taller ----------

export type WorkshopOrderRow = Tables<"workshop_orders">;

/** Pedidos internos para preparar en el taller, pendientes primero. */
export async function getWorkshopOrders(): Promise<WorkshopOrderRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("workshop_orders")
    .select("*")
    .order("status", { ascending: false })
    .order("created_at", { ascending: false });
  const rows = data ?? [];
  const needsLegacyHydration = rows.some(
    (row) => (row as unknown as Record<string, unknown>).price === undefined,
  );
  if (!needsLegacyHydration || rows.length === 0) return rows;

  // Compatibilidad durante un deploy escalonado: antes de 0021 precio y envío
  // viven en el espejo de `sales`, unido por una clave estable. Cuando la
  // migración esté aplicada estas propiedades ya vienen en la fila y esta
  // segunda consulta desaparece automáticamente.
  const keys = rows.map((row) => workshopSaleKey(row.id));
  const { data: linkedSales } = await supabase
    .from("sales")
    .select(
      "idempotency_key, shipping_amount, sale_items(price, created_at, exchange_of_item_id, shopify_line_item_id)",
    )
    .in("idempotency_key", keys);
  const byKey = new Map((linkedSales ?? []).map((sale) => [sale.idempotency_key, sale]));

  return rows.map((row) => {
    const sale = byKey.get(workshopSaleKey(row.id));
    const item = (sale?.sale_items ?? [])
      .filter((candidate) => !candidate.exchange_of_item_id && !candidate.shopify_line_item_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    return {
      ...row,
      price: Number(item?.price) || 0,
      shipping_amount: Number(sale?.shipping_amount) || 0,
      variant_label: null,
    };
  });
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
  /**
   * `id` es la clave de la lista, no `sku`: el SKU no es único (0002) y los
   * productos sin SKU llegan todos como "—", así que dos en alerta repetían la
   * key y React lo reportaba en consola.
   */
  alerts: { id: string; name: string; sku: string; qty: string; alert: boolean }[];
};

export async function getDashboardStats(): Promise<DashboardStats> {
  if (!isSupabaseConfigured()) return { total: 0, lowStock: 0, outStock: 0, alerts: [] };
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("id,name,sku,stock,alert_threshold");
  const rows = data ?? [];
  const lowStock = rows.filter((r) => r.stock > 0 && r.stock <= r.alert_threshold).length;
  const outStock = rows.filter((r) => r.stock === 0).length;
  const alerts = [...rows]
    .filter((r) => r.stock <= r.alert_threshold)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 5)
    .map((r) => ({ id: r.id, name: r.name, sku: r.sku ?? "—", qty: `${r.stock}u`, alert: r.stock === 0 }));
  return { total: rows.length, lowStock, outStock, alerts };
}

// ---------- perfil / rol ----------

export type CurrentProfile = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

/**
 * Nombre que manda el proveedor OAuth. `profiles.full_name` es una foto sacada
 * por el trigger `handle_new_user` en el primer login y nadie la refresca, así
 * que cuando quedó vacía (perfil creado a mano, o sin el claim en su momento)
 * esto es lo más cercano al nombre real que tenemos.
 */
function metadataName(meta: Record<string, unknown> | undefined): string | null {
  for (const key of ["full_name", "name"]) {
    const value = meta?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

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
    name: data?.full_name?.trim() || metadataName(user.user_metadata) || user.email || "Usuario",
    role: normalizeRole(data?.role),
  };
}

/**
 * Primer nombre para el saludo. Devuelve null si no hay nada que mostrar, para
 * que el saludo se arme sin nombre en vez de inventar uno.
 */
export function firstNameOf(name: string | null | undefined): string | null {
  const value = name?.trim();
  if (!value) return null;
  if (value.includes("@")) {
    // Sólo tenemos el mail: la parte antes del @, cortada en el primer separador.
    const local = value.split("@")[0].split(/[._-]+/).filter(Boolean)[0];
    return local ? local[0].toUpperCase() + local.slice(1) : null;
  }
  return value.split(/\s+/)[0] ?? null;
}

// ---------- ventas ----------

export type SaleRow = Tables<"sales">;
export type SaleItemRow = Tables<"sale_items">;

/** Una compra con las prendas que lleva. Es la unidad que muestra el listado. */
export type SaleWithItems = SaleRow & { sale_items: SaleItemRow[] };

export const SALES_PAGE_SIZE = 50;

export type SalesPage = { rows: SaleWithItems[]; total: number };

export type SaleMovementListItem = {
  id: string;
  saleId: string;
  kind: "exchange_difference" | "return";
  amount: number;
  occurredAt: string;
  paymentMethod: string | null;
  description: string | null;
  saleLabel: string | null;
  customerName: string | null;
  itemArticle: string | null;
};

function artDateTime(date: string): string {
  return new Date(`${date}T00:00:00-03:00`).toISOString();
}

/** Movimientos posteriores a una venta, agrupados por su propia fecha. */
export async function getSaleMovements(
  start: string,
  end: string,
): Promise<SaleMovementListItem[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("sale_movements")
    .select(
      "id, sale_id, kind, amount, occurred_at, payment_method, description, sales(customer_name, shopify_order_name), sale_items(article)",
    )
    .gte("occurred_at", artDateTime(start))
    .lt("occurred_at", artDateTime(end))
    .order("occurred_at", { ascending: false });

  return (data ?? []).map((row) => {
    const sale = row.sales as unknown as {
      customer_name: string | null;
      shopify_order_name: string | null;
    } | null;
    const item = row.sale_items as unknown as { article: string } | null;
    return {
      id: row.id,
      saleId: row.sale_id,
      kind: row.kind === "return" ? "return" : "exchange_difference",
      amount: Number(row.amount) || 0,
      occurredAt: row.occurred_at,
      paymentMethod: row.payment_method,
      description: row.description,
      saleLabel: sale?.shopify_order_name ?? null,
      customerName: sale?.customer_name ?? null,
      itemArticle: item?.article ?? null,
    };
  });
}

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
 * Estado por el que se filtra el listado.
 *
 * `returned` acá significa "tiene alguna devolución", no "está toda devuelta":
 * lo que el vendedor busca cuando filtra es la compra donde pasó algo, y con
 * devoluciones parciales una compra puede tener una prenda devuelta y dos
 * activas. La columna `has_returns` (mantenida por trigger) es justo eso.
 *
 * `preorder` son las preventas que todavía deben mercadería —cobradas, sin
 * entregar y sin devolver—, o sea las que el listado muestra como "Esperando
 * entrega". No incluye la preventa ya entregada: esa dejó de esperar, aunque
 * la columna siga marcada como historia de la compra.
 */
export type SalesStatusFilter = "active" | "preorder" | "returned" | "todos";
export type SalesChannelFilter = SaleOrigin | "taller" | "todos";

export type SalesFilters = {
  q?: string;
  page?: number;
  pageSize?: number;
  origin?: SalesChannelFilter;
  status?: SalesStatusFilter;
};

/**
 * Cuántas compras puede alcanzar una búsqueda por artículo.
 *
 * El tope no es arbitrario: estos ids viajan como `id.in.(...)` en la query
 * string de PostgREST, y un UUID ocupa 37 caracteres. Con 400 la URL pasa los
 * 15KB y la corta el proxy (8KB es el default habitual) — el síntoma sería un
 * 414 en la búsqueda, no un resultado incompleto. Con 150 quedan ~5,5KB, y son
 * tres páginas de resultados: de sobra para buscar una prenda en un mes.
 */
const SEARCH_MATCH_CAP = 150;

/**
 * Compras del rango que mencionan el término en alguna de sus prendas.
 *
 * Va en dos pasos y no como un filtro embebido a propósito: PostgREST solo sabe
 * filtrar una tabla embebida recortando SUS filas, así que
 * `sale_items.article=ilike.*x*` devolvería la compra con únicamente la prenda
 * que matcheó y escondería las otras dos. Buscando primero los ids, la compra
 * se muestra completa.
 */
async function saleIdsMatchingArticle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  term: string,
  start: string,
  end: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("sale_items")
    .select("sale_id, sales!inner(sold_at)")
    .ilike("article", `%${term}%`)
    .gte("sales.sold_at", start)
    .lt("sales.sold_at", end)
    .limit(SEARCH_MATCH_CAP);
  return [...new Set((data ?? []).map((r) => r.sale_id))];
}

/**
 * Una página de compras del rango, más recientes primero, con sus prendas.
 *
 * Antes esto traía TODAS las ventas del mes con `select("*")` y la búsqueda y
 * la paginación se hacían en el cliente. Con 200 ventas/día eso son ~6.000
 * filas —incluyendo datos personales de cada cliente— en cada carga de página.
 *
 * El default de `status` es 'active' y no "todas" a propósito: la pantalla de
 * Ventas es la lista de lo que se vendió, y una compra íntegramente devuelta
 * mezclada ahí sin pedirla hace sumar mal de un vistazo.
 */
export async function getSales(
  start: string,
  end: string,
  opts: SalesFilters = {},
): Promise<SalesPage> {
  if (!isSupabaseConfigured()) return { rows: [], total: 0 };
  const { q = "", page = 1, pageSize = SALES_PAGE_SIZE, origin = "todos", status = "todos" } = opts;
  const supabase = await createClient();

  let query = supabase
    .from("sales")
    .select("*, sale_items(*)", { count: "exact" })
    .gte("sold_at", start)
    .lt("sold_at", end);

  if (origin === "shopify") query = query.eq("origin", "shopify");
  else if (origin === "taller") query = query.like("idempotency_key", "workshop:%");
  else if (origin === "atelier") {
    query = query
      .eq("origin", "atelier")
      .or("idempotency_key.is.null,idempotency_key.not.like.workshop:%");
  }
  if (status === "active") query = query.eq("status", "active");
  else if (status === "returned") query = query.eq("has_returns", true);
  // Los tres filtros juntos son el predicado del índice parcial
  // `idx_sales_preorder_pending` (migración 0023): si cambian acá, hay que
  // cambiarlo allá o la consulta pasa a escanear la tabla.
  else if (status === "preorder") {
    query = query.eq("preorder", true).eq("delivered", false).eq("status", "active");
  }

  const term = sanitizeSearch(q);
  if (term) {
    const ids = await saleIdsMatchingArticle(supabase, term, start, end);
    const clauses = [
      `customer_name.ilike.%${term}%`,
      `seller_name.ilike.%${term}%`,
      `shopify_order_name.ilike.%${term}%`,
    ];
    if (ids.length) clauses.push(`id.in.(${ids.join(",")})`);
    query = query.or(clauses.join(","));
  }

  const from = Math.max(0, (page - 1) * pageSize);
  const { data, count } = await query
    .order("sold_at", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  // Las prendas vienen sin orden garantizado; se ordenan por alta para que la
  // compra se lea siempre igual (y la primera sea la que titula la fila).
  const rows = (data ?? []).map((r) => ({
    ...r,
    sale_items: [...(r.sale_items ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
  })) as SaleWithItems[];

  return { rows, total: count ?? 0 };
}

export type Seller = { id: string; name: string; role: Role };

/**
 * Staff que puede tener ventas a su nombre — para el selector de vendedor al
 * editar una venta importada de Shopify, que llega sin dueño.
 *
 * `medios` queda afuera: es solo lectura de ventas, no vende.
 */
export async function getSellers(): Promise<Seller[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .in("role", ["admin", "vendedor"])
    .order("full_name", { ascending: true });
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name?.trim() || p.email || "—",
    role: normalizeRole(p.role),
  }));
}

/**
 * Compatibilidad con una función de métricas anterior a 0022.
 *
 * Esa versión ya suma las ventas de Taller, pero dentro de `atelier_amount`.
 * Mientras la migración todavía no llegó a la base, recuperamos únicamente
 * esas compras por su clave estable y trasladamos el importe al canal correcto.
 */
async function getLegacyWorkshopRevenueByDay(
  supabase: Awaited<ReturnType<typeof createClient>>,
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("sales")
    .select(
      "sold_at, sale_discount, shipping_amount, sale_items(price, discount, qty, counts_revenue, exchange_adjustment)",
    )
    .like("idempotency_key", "workshop:%")
    .gte("sold_at", start)
    .lt("sold_at", end);

  if (error) return new Map();

  const revenue = new Map<string, number>();
  for (const sale of data ?? []) {
    const day = String(sale.sold_at).slice(0, 10);
    const amount = saleTotal(sale, sale.sale_items ?? []);
    revenue.set(day, (revenue.get(day) ?? 0) + amount);
  }
  return revenue;
}

export type SalesKpis = {
  /** Ingreso de Sadaels por productos, sin envíos; incluye cambios y devoluciones. */
  totalAmount: number;
  /** Precio neto cobrado por productos antes de repartir ventas de otras marcas. */
  grossProductAmount: number;
  /** Facturado por ventas cargadas directamente en el Atelier. */
  atelierAmount: number;
  /** Facturado por pedidos personalizados cargados desde Taller. */
  workshopAmount: number;
  /** Facturado por ventas que entraron por la tienda online. */
  shopifyAmount: number;
  /** Participación de Sadaels en otras marcas; sin tasa explícita cuenta al 100%. */
  otherBrandAmount: number;
  otherBrandGrossAmount: number;
  /** Subconjunto del ingreso de otras marcas que usa el 100% por falta de tasa. */
  otherBrandUnmappedAmount: number;
  /** Envíos cobrados, separados del valor de las prendas. */
  shippingAmount: number;
  atelierShippingAmount: number;
  workshopShippingAmount: number;
  shopifyShippingAmount: number;
  units: number;
  operations: number;
  pendingDelivery: number;
  otherBrandUnits: number;
  returnedAmount: number;
  returnedCount: number;
  shopifyUnits: number;
};

export type OtherBrandSalesRow = {
  brand: string;
  grossAmount: number;
  realAmount: number;
  units: number;
  /** Subconjunto bruto sin tasa, ya incluido al 100% en realAmount. */
  unmappedAmount: number;
};

export async function getOtherBrandSalesBreakdown(start: string, end: string): Promise<OtherBrandSalesRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("other_brand_sales_breakdown", {
    p_start: start,
    p_end: end,
  });
  return (data ?? []).map((row) => ({
    brand: row.brand,
    grossAmount: Number(row.gross_amount) || 0,
    realAmount: Number(row.real_amount) || 0,
    units: Number(row.units) || 0,
    unmappedAmount: Number(row.unmapped_amount) || 0,
  }));
}

const EMPTY_KPIS: SalesKpis = {
  totalAmount: 0,
  grossProductAmount: 0,
  atelierAmount: 0,
  workshopAmount: 0,
  shopifyAmount: 0,
  otherBrandAmount: 0,
  otherBrandGrossAmount: 0,
  otherBrandUnmappedAmount: 0,
  shippingAmount: 0,
  atelierShippingAmount: 0,
  workshopShippingAmount: 0,
  shopifyShippingAmount: 0,
  units: 0,
  operations: 0,
  pendingDelivery: 0,
  otherBrandUnits: 0,
  returnedAmount: 0,
  returnedCount: 0,
  shopifyUnits: 0,
};

/**
 * KPIs del rango completo, agregados en Postgres (función `sales_kpis`).
 * Independientes de la página y de la búsqueda activa.
 *
 * Ojo con la asimetría entre plata y unidades, que la función explica en
 * detalle: la plata sale de las filas que facturan (`counts_revenue`) y las
 * unidades de las que tienen mercadería (`status = 'active'`). En un cambio no
 * son las mismas filas.
 */
export async function getSalesKpis(start: string, end: string): Promise<SalesKpis> {
  if (!isSupabaseConfigured()) return EMPTY_KPIS;
  const supabase = await createClient();
  const { data } = await supabase.rpc("sales_kpis", { p_start: start, p_end: end });
  const r = data?.[0];
  if (!r) return EMPTY_KPIS;
  const hasWorkshopAmount = "workshop_amount" in (r as unknown as Record<string, unknown>);
  const legacyWorkshopByDay = hasWorkshopAmount
    ? null
    : await getLegacyWorkshopRevenueByDay(supabase, start, end);
  const workshopAmount = hasWorkshopAmount
    ? Number(r.workshop_amount) || 0
    : [...(legacyWorkshopByDay?.values() ?? [])].reduce((sum, amount) => sum + amount, 0);
  const rawAtelierAmount = Number(r.atelier_amount) || 0;
  const totalAmount = Number(r.total_amount) || 0;
  const otherBrandAmount = Number(r.other_brand_amount) || 0;
  const otherBrandGrossAmount = Number(r.other_brand_gross_amount) || 0;
  return {
    totalAmount,
    grossProductAmount: grossProductRevenue(totalAmount, otherBrandAmount, otherBrandGrossAmount),
    atelierAmount: hasWorkshopAmount
      ? rawAtelierAmount
      : Math.max(0, rawAtelierAmount - workshopAmount),
    workshopAmount,
    shopifyAmount: Number(r.shopify_amount) || 0,
    otherBrandAmount,
    otherBrandGrossAmount,
    otherBrandUnmappedAmount: Number(r.other_brand_unmapped_amount) || 0,
    shippingAmount: Number(r.shipping_amount) || 0,
    atelierShippingAmount: Number(r.atelier_shipping_amount) || 0,
    workshopShippingAmount: Number(r.workshop_shipping_amount) || 0,
    shopifyShippingAmount: Number(r.shopify_shipping_amount) || 0,
    units: Number(r.units) || 0,
    operations: Number(r.operations) || 0,
    pendingDelivery: Number(r.pending_delivery) || 0,
    otherBrandUnits: Number(r.other_brand_units) || 0,
    returnedAmount: Number(r.returned_amount) || 0,
    returnedCount: Number(r.returned_count) || 0,
    shopifyUnits: Number(r.shopify_units) || 0,
  };
}

export type SalesDay = {
  day: string;
  /** Importes de productos por canal; los envíos no entran en el gráfico. */
  atelier: number;
  taller: number;
  shopify: number;
  otherBrands: number;
  atelierShipping: number;
  tallerShipping: number;
  shopifyShipping: number;
  shipping: number;
  total: number;
  operations: number;
};

/**
 * Serie diaria por origen, para el gráfico del dashboard. Devuelve un punto por
 * día del rango, incluidos los días sin ventas (los completa la función en la
 * base con un `generate_series`, así que el gráfico no queda con huecos).
 */
export async function getSalesSeries(start: string, end: string): Promise<SalesDay[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("sales_daily_series", { p_start: start, p_end: end });
  const hasWorkshopAmount = (data ?? []).some(
    (row) => "workshop_amount" in (row as unknown as Record<string, unknown>),
  );
  const legacyWorkshopByDay = hasWorkshopAmount
    ? null
    : await getLegacyWorkshopRevenueByDay(supabase, start, end);
  return (data ?? []).map((r) => {
    const rawAtelier = Number(r.atelier_amount) || 0;
    const taller = hasWorkshopAmount
      ? Number(r.workshop_amount) || 0
      : legacyWorkshopByDay?.get(String(r.day).slice(0, 10)) ?? 0;
    const atelier = hasWorkshopAmount ? rawAtelier : Math.max(0, rawAtelier - taller);
    const shopify = Number(r.shopify_amount) || 0;
    const otherBrands = Number(r.other_brand_amount) || 0;
    const atelierShipping = Number(r.atelier_shipping_amount) || 0;
    const tallerShipping = Number(r.workshop_shipping_amount) || 0;
    const shopifyShipping = Number(r.shopify_shipping_amount) || 0;
    return {
      day: String(r.day).slice(0, 10),
      atelier,
      taller,
      shopify,
      otherBrands,
      atelierShipping,
      tallerShipping,
      shopifyShipping,
      shipping: atelierShipping + tallerShipping + shopifyShipping,
      total: atelier + taller + shopify + otherBrands,
      operations: Number(r.operations) || 0,
    };
  });
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

/** Monto vendido "hoy" (Buenos Aires), abierto por canal — KPI del dashboard. */
export async function getTodaySales(): Promise<{
  totalAmount: number;
  grossProductAmount: number;
  atelierAmount: number;
  workshopAmount: number;
  shopifyAmount: number;
  otherBrandAmount: number;
  otherBrandUnmappedAmount: number;
  shippingAmount: number;
  operations: number;
}> {
  const { start, end } = todayRangeART();
  const { totalAmount, grossProductAmount, atelierAmount, workshopAmount, shopifyAmount, otherBrandAmount, otherBrandUnmappedAmount, shippingAmount, operations } =
    await getSalesKpis(start, end);
  return { totalAmount, grossProductAmount, atelierAmount, workshopAmount, shopifyAmount, otherBrandAmount, otherBrandUnmappedAmount, shippingAmount, operations };
}

/** Rango [hoy-N, mañana) en Buenos Aires — para el gráfico de los últimos N días. */
export function lastDaysRangeART(days: number): { start: string; end: string } {
  const { start: today } = todayRangeART();
  const [y, m, d] = today.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - (days - 1)));
  const to = new Date(Date.UTC(y, m - 1, d + 1));
  const iso = (x: Date) =>
    `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(
      x.getUTCDate(),
    ).padStart(2, "0")}`;
  return { start: iso(from), end: iso(to) };
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
  // El ROAS se calcula sobre plata REAL, así que entran `counts_revenue` y
  // `exchange_adjustment`: una prenda devuelta no financió nada, y la prenda
  // nueva de un cambio no volvió a facturar. Sumar el neto a secas inflaba el
  // retorno de la campaña que trajo esa venta.
  //
  // El `sales!inner` no es decorativo: el descuento general de la compra vive
  // en la cabecera y el rango de fechas también, así que el importe de una
  // prenda no se puede calcular sin ella.
  const { data: items } = await supabase
    .from("sale_items")
    .select(
      "product_id, price, discount, qty, counts_revenue, exchange_adjustment, sales!inner(sold_at, sale_discount)",
    )
    .in("product_id", [...productToMeta.keys()])
    .gte("sales.sold_at", start)
    .lt("sales.sold_at", end);

  for (const it of items ?? []) {
    const meta = it.product_id ? productToMeta.get(it.product_id) : undefined;
    if (!meta) continue;
    const sale = it.sales as unknown as { sale_discount: number | string } | null;
    revenue[meta] += saleItemRevenue(it, sale?.sale_discount ?? 0);
  }

  // Diferencias y devoluciones se atribuyen al producto de la prenda, pero a
  // la fecha real del movimiento, no a la venta original.
  const { data: movements } = await supabase
    .from("sale_movements")
    .select("amount, sale_items!inner(product_id)")
    .in("sale_items.product_id", [...productToMeta.keys()])
    .gte("occurred_at", artDateTime(start))
    .lt("occurred_at", artDateTime(end));

  for (const movement of movements ?? []) {
    const item = movement.sale_items as unknown as { product_id: string | null } | null;
    const meta = item?.product_id ? productToMeta.get(item.product_id) : undefined;
    if (meta) revenue[meta] += Number(movement.amount) || 0;
  }
  return revenue;
}

/** Producto vinculado a una campaña de Meta, si tiene uno (para las skills de Learnings). */
export async function getLinkedProductId(metaCampaignId: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id")
    .eq("meta_campaign_id", metaCampaignId)
    .maybeSingle();
  if (!campaign) return null;

  const { data: link } = await supabase
    .from("product_campaign_links")
    .select("product_id")
    .eq("campaign_id", campaign.id)
    .maybeSingle();
  return link?.product_id ?? null;
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
