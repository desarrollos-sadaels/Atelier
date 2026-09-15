/**
 * Reporte de ventas: rango de fechas, canales, filtros y totales.
 *
 * Módulo puro a propósito. Lo usan la página (server), el export CSV (route
 * handler) y los controles (cliente), y los tres tienen que resolver la MISMA
 * URL al MISMO reporte: si no, el CSV que se descarga no es lo que se ve en
 * pantalla.
 *
 * Todo en horario de Buenos Aires. La versión anterior calculaba "últimos 30
 * días" con el `new Date()` del servidor, que en Vercel corre en UTC: de 21:00
 * a medianoche el "hoy" del reporte ya era mañana.
 */

const TZ = "America/Argentina/Buenos_Aires";

// ---------- rango de fechas ----------

export type ReportPreset = "hoy" | "7d" | "30d" | "mes" | "mes-anterior" | "custom";

/** Los rangos con nombre. "custom" no es uno: es lo que queda al elegir fechas a mano. */
export type NamedPreset = Exclude<ReportPreset, "custom">;

export const REPORT_PRESETS: { value: NamedPreset; label: string }[] = [
  { value: "hoy", label: "Hoy" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "mes", label: "Este mes" },
  { value: "mes-anterior", label: "Mes anterior" },
];

export const DEFAULT_PRESET = "30d" satisfies NamedPreset;

/**
 * Tope del rango. No es por la agregación (la hace Postgres y un año es
 * barato) sino por el CSV de detalle, que sí trae una fila por prenda.
 */
export const MAX_REPORT_DAYS = 366;

export type ReportRange = {
  preset: ReportPreset;
  /** Primer día incluido (YYYY-MM-DD). */
  from: string;
  /** Último día incluido. */
  to: string;
  /** [start, end) para la base: `end` es el día siguiente a `to`. */
  start: string;
  end: string;
  days: number;
  /** Qué se corrigió de lo que pedía la URL, para decírselo al usuario. */
  notice: string | null;
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Años que acepta el reporte. No es cosmético: `Date.UTC` interpreta 0–99 como
 * 1900–1999, así que `0026-01-01` pasaba el tope de días (contaba 2) pero
 * terminaba pidiendo casi dos mil años; y `9999-12-31` hace que `end` salga
 * del rango de fechas de Postgres y la consulta falle.
 */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_RE.test(v)) return false;
  const year = Number(v.slice(0, 4));
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  // `new Date("2026-02-31")` no falla: salta al 3 de marzo. Hay que comparar.
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function todayART(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function lastDayOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Días del rango, contando los dos extremos. */
export function countDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

export function presetBounds(preset: NamedPreset, today: string): [string, string] {
  switch (preset) {
    case "hoy":
      return [today, today];
    case "7d":
      return [addDays(today, -6), today];
    case "mes":
      return [`${today.slice(0, 7)}-01`, today];
    case "mes-anterior": {
      const lastOfPrev = addDays(`${today.slice(0, 7)}-01`, -1);
      return [`${lastOfPrev.slice(0, 7)}-01`, lastOfPrev];
    }
    case "30d":
      // Hoy y los 29 anteriores: 30 días. El reporte viejo sumaba 31.
      return [addDays(today, -29), today];
  }
}

/**
 * Rango que arranca en `start` con la forma del preset elegido: es lo que
 * completa la fecha final cuando se marca el inicio en el calendario.
 *
 * - Hoy / 7 días / 30 días conservan la DURACIÓN: marcar el 1/9 con "7 días"
 *   da 1/9–7/9.
 * - Este mes / Mes anterior conservan la FORMA: marcar cualquier día da el mes
 *   calendario que lo contiene.
 *
 * En los dos casos el fin se corta en hoy: los días que todavía no pasaron no
 * tienen ventas y solo inflarían el "30 días" del rótulo. Con "30 días" y el
 * 1/9 marcado un 14/9, el rango es 1/9–14/9 y dice 14 días.
 */
export function rangeFromStart(preset: NamedPreset, start: string, today: string): [string, string] {
  // Un inicio en el futuro no tiene hoy contra el cual cortar: queda en un día.
  const upTo = (end: string): [string, string] => [start, end > today ? (start > today ? start : today) : end];
  switch (preset) {
    case "hoy":
      return [start, start];
    case "7d":
      return upTo(addDays(start, 6));
    case "30d":
      return upTo(addDays(start, 29));
    case "mes":
    case "mes-anterior": {
      const first = `${start.slice(0, 7)}-01`;
      const last = lastDayOfMonth(start);
      return [first, first <= today && today < last ? today : last];
    }
  }
}

function isNamedPreset(v: unknown): v is NamedPreset {
  return REPORT_PRESETS.some((p) => p.value === v);
}

/** Traduce los parámetros de la URL a un rango válido. Nunca falla: corrige y avisa. */
export function resolveReportRange(
  params: { rango?: string | null; desde?: string | null; hasta?: string | null },
  now: Date = new Date(),
): ReportRange {
  const today = todayART(now);
  const build = (preset: ReportPreset, from: string, to: string, notice: string | null) => ({
    preset,
    from,
    to,
    start: from,
    end: addDays(to, 1),
    days: countDays(from, to),
    notice,
  });

  const { rango, desde, hasta } = params;
  const wantsCustom = rango === "custom" || (!rango && Boolean(desde || hasta));

  if (wantsCustom) {
    if (isIsoDate(desde) && isIsoDate(hasta)) {
      let from = desde;
      let to = hasta;
      let notice: string | null = null;
      if (from > to) {
        [from, to] = [to, from];
        notice = "Las fechas estaban invertidas: se ordenaron.";
      }
      if (countDays(from, to) > MAX_REPORT_DAYS) {
        from = addDays(to, -(MAX_REPORT_DAYS - 1));
        notice = `El rango máximo es de ${MAX_REPORT_DAYS} días: se recortó el comienzo.`;
      }
      return build("custom", from, to, notice);
    }
    const [from, to] = presetBounds(DEFAULT_PRESET, today);
    return build(DEFAULT_PRESET, from, to, "Las fechas no eran válidas: se muestran los últimos 30 días.");
  }

  const preset = isNamedPreset(rango) ? rango : DEFAULT_PRESET;
  const [from, to] = presetBounds(preset, today);
  return build(preset, from, to, null);
}

// Las fechas del reporte son días calendario, no instantes: se formatean en UTC
// para que el huso del navegador no las corra un día para atrás.
const monthFmt = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });

/**
 * "14 sept 2026". Se arma a mano porque `Intl` en es-AR mete "de" solo cuando
 * lleva año ("16 ago" pero "14 de sept de 2026"), y los dos extremos del rango
 * quedaban escritos distinto.
 */
export function dayLabel(iso: string, withYear = true): string {
  const month = monthFmt.format(new Date(`${iso}T00:00:00Z`)).replace(".", "");
  const day = Number(iso.slice(8, 10));
  return withYear ? `${day} ${month} ${iso.slice(0, 4)}` : `${day} ${month}`;
}

export function formatRangeLabel(from: string, to: string): string {
  if (from === to) return dayLabel(from, true);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${dayLabel(from, !sameYear)} – ${dayLabel(to, true)}`;
}

// ---------- canales ----------

export type SaleChannel = "atelier" | "shopify" | "mayoristas" | "taller";

export const SALE_CHANNELS: { value: SaleChannel; label: string; hint: string }[] = [
  { value: "atelier", label: "Atelier", hint: "local, chat y redes" },
  { value: "shopify", label: "Shopify", hint: "tienda online" },
  { value: "mayoristas", label: "Mayoristas", hint: "punto de venta MAYORISTAS" },
  { value: "taller", label: "Taller", hint: "pedidos del taller" },
];

export const CHANNEL_LABEL = Object.fromEntries(
  SALE_CHANNELS.map((c) => [c.value, c.label]),
) as Record<SaleChannel, string>;

/** Punto de venta que marca una venta mayorista. Lo ofrecen el alta y la edición. */
export const WHOLESALE_POS = "MAYORISTAS";
/** Punto de venta con el que el trigger de `workshop_orders` crea las ventas del taller. */
export const WORKSHOP_POS = "TALLER";

/**
 * Canal de una compra. ESPEJO de `public.sale_channel` (migración 0024): la
 * base clasifica para los totales y esto para el CSV de detalle, así que si
 * cambia una, cambia la otra. El orden importa: una venta del taller sigue
 * siendo del taller aunque después le cambien el punto de venta.
 */
export function saleChannel(sale: {
  pos: string | null;
  origin: string;
  workshop_order_id?: string | null;
}): SaleChannel {
  // Solo espacios, no `trim()`: el `trim` de Postgres saca únicamente espacios,
  // y el de JS además tabs y saltos de línea. Con `trim()`, un "MAYORISTAS\t"
  // cargado por fuera de la app era Mayoristas en el CSV y Atelier en los totales.
  const pos = (sale.pos ?? "").replace(/^ +| +$/g, "").toUpperCase();
  if (pos === WORKSHOP_POS || sale.workshop_order_id) return "taller";
  if (pos === WHOLESALE_POS) return "mayoristas";
  return sale.origin === "shopify" ? "shopify" : "atelier";
}

/**
 * Selección de canales en su forma canónica: sin repetidos, en el orden de
 * `SALE_CHANNELS`, y VACÍA para "todos". Elegir los cuatro es lo mismo que no
 * filtrar, y tiene que dar la misma URL — si no, el formulario marcaría
 * "cambios sin aplicar" entre dos reportes idénticos.
 */
export function normalizeChannels(list: readonly string[]): SaleChannel[] {
  const wanted = new Set(list);
  const picked = SALE_CHANNELS.map((c) => c.value).filter((c) => wanted.has(c));
  return picked.length === SALE_CHANNELS.length ? [] : picked;
}

/** `canal=atelier,mayoristas` → ["atelier", "mayoristas"]. Ignora lo que no es un canal. */
export function parseReportChannels(v: string | null | undefined): SaleChannel[] {
  if (!v) return [];
  return normalizeChannels(v.split(",").map((s) => s.trim().toLowerCase()));
}

export function channelsLabel(channels: readonly SaleChannel[]): string {
  return channels.length ? channels.map((c) => CHANNEL_LABEL[c]).join(" + ") : "todos los canales";
}

// ---------- vendedor ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSellerId(v: string | null | undefined): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

export const UNASSIGNED_SELLER_LABEL = "Sin vendedor asignado";

export function sellerLabel(row: { sellerId: string | null; name: string | null }): string {
  if (!row.sellerId) return UNASSIGNED_SELLER_LABEL;
  return row.name?.trim() || "Usuario sin nombre";
}

// ---------- URL ----------

/** Query string del reporte. Omite los defaults para que la URL quede corta. */
export function reportSearchParams(state: {
  preset: ReportPreset;
  from?: string;
  to?: string;
  channels: readonly SaleChannel[];
  sellerId?: string | null;
}): URLSearchParams {
  const p = new URLSearchParams();
  if (state.preset === "custom" && state.from && state.to) {
    p.set("rango", "custom");
    p.set("desde", state.from);
    p.set("hasta", state.to);
  } else if (state.preset !== DEFAULT_PRESET && state.preset !== "custom") {
    p.set("rango", state.preset);
  }
  const channels = normalizeChannels(state.channels);
  if (channels.length) p.set("canal", channels.join(","));
  if (state.sellerId) p.set("vendedor", state.sellerId);
  return p;
}

// ---------- totales ----------

export type ReportTotals = {
  total: number;
  units: number;
  operations: number;
  pendingDelivery: number;
  /** Prendas devueltas en el período (por fecha de devolución). */
  returnedCount: number;
  returnedUnits: number;
  /** Lo que valían las prendas devueltas, con sus descuentos. */
  returnedAmount: number;
  /** Prendas cambiadas en el período (por fecha del cambio). */
  exchangedCount: number;
  exchangedUnits: number;
};

/** Una fila de `sales_by_seller_channel`: lo que vendió una cuenta por un canal. */
export type BreakdownRow = ReportTotals & {
  /** null = pedidos web que nadie reclamó todavía. */
  sellerId: string | null;
  name: string | null;
  channel: SaleChannel;
};

export type SellerSummary = ReportTotals & { sellerId: string | null; name: string | null };
export type ChannelSummary = ReportTotals & { channel: SaleChannel };

export function emptyTotals(): ReportTotals {
  return {
    total: 0,
    units: 0,
    operations: 0,
    pendingDelivery: 0,
    returnedCount: 0,
    returnedUnits: 0,
    returnedAmount: 0,
    exchangedCount: 0,
    exchangedUnits: 0,
  };
}

function addInto(acc: ReportTotals, r: ReportTotals): void {
  acc.total += r.total;
  acc.units += r.units;
  acc.operations += r.operations;
  acc.pendingDelivery += r.pendingDelivery;
  acc.returnedCount += r.returnedCount;
  acc.returnedUnits += r.returnedUnits;
  acc.returnedAmount += r.returnedAmount;
  acc.exchangedCount += r.exchangedCount;
  acc.exchangedUnits += r.exchangedUnits;
}

/**
 * Totales de un conjunto de filas. Con todas las filas del rango la PLATA es
 * igual a `sales_kpis` (la función SQL garantiza esa invariante), así que el
 * resumen del reporte y los KPIs de Ventas no pueden facturar distinto.
 */
export function sumTotals(rows: ReportTotals[]): ReportTotals {
  const acc = emptyTotals();
  for (const r of rows) addInto(acc, r);
  return acc;
}

export function filterBreakdown(
  rows: BreakdownRow[],
  opts: { channels?: readonly SaleChannel[]; sellerId?: string | null },
): BreakdownRow[] {
  const channels = opts.channels ?? [];
  return rows.filter(
    (r) =>
      (channels.length === 0 || channels.includes(r.channel)) &&
      (!opts.sellerId || r.sellerId === opts.sellerId),
  );
}

/**
 * Una fila por cuenta, de la que más vendió a la que menos. Las cuentas que en
 * el período solo tuvieron cambios o devoluciones también aparecen: esas filas
 * existen justamente para explicar por qué el mes cerró más bajo.
 */
export function groupBySeller(rows: BreakdownRow[]): SellerSummary[] {
  const map = new Map<string, SellerSummary>();
  for (const r of rows) {
    const key = r.sellerId ?? "";
    let acc = map.get(key);
    if (!acc) {
      acc = { ...emptyTotals(), sellerId: r.sellerId, name: r.name };
      map.set(key, acc);
    }
    addInto(acc, r);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** Los cuatro canales, siempre en el mismo orden y con cero si no vendieron: la tabla no salta. */
export function groupByChannel(rows: BreakdownRow[]): ChannelSummary[] {
  return SALE_CHANNELS.map(({ value }) => ({
    ...sumTotals(rows.filter((r) => r.channel === value)),
    channel: value,
  }));
}

/** Participación en el total, 0–100. Las devoluciones pueden dejar montos negativos. */
export function sharePct(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

// ---------- destacados ----------

export type TopItem = { name: string; units: number; amount: number };
export type BestDay = { day: string; amount: number; operations: number };
export type ReportHighlights = { topItems: TopItem[]; bestDay: BestDay | null };

export const EMPTY_HIGHLIGHTS: ReportHighlights = { topItems: [], bestDay: null };
