import "server-only";
import { metaGraph, metaAccountId } from "@/lib/meta/client";

/* ---------- estado (Meta lo devuelve en SCREAMING_SNAKE_CASE) ---------- */

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activa",
  PAUSED: "Pausada",
  CAMPAIGN_PAUSED: "Pausada (campaña)",
  ADSET_PAUSED: "Pausada (conjunto)",
  ARCHIVED: "Archivada",
  DELETED: "Eliminada",
  IN_PROCESS: "En revisión",
  PENDING_REVIEW: "Pendiente de revisión",
  PENDING_BILLING_INFO: "Falta info de facturación",
  WITH_ISSUES: "Con problemas",
  DISAPPROVED: "Rechazada",
  PREAPPROVED: "Preaprobada",
  DISABLED: "Deshabilitada",
};

/** Traduce el estado crudo de Meta (ACTIVE, CAMPAIGN_PAUSED, ...) a un rótulo legible. */
export function metaStatusLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  if (STATUS_LABEL[raw]) return STATUS_LABEL[raw];
  const words = raw.toLowerCase().split("_");
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/* ---------- tipos ---------- */

type RawAction = { action_type: string; value: string };
type RawInsight = {
  spend?: string;
  reach?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  actions?: RawAction[];
  purchase_roas?: RawAction[];
};

export type MetaOverview = {
  spend: number;
  reach: number;
  impressions: number;
  activeCampaigns: number;
};

export type MetaCampaign = {
  id: string;
  name: string;
  status: string;
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  ctr: number;
  purchases: number;
  roas: number;
};

/** Mismo shape que MetaCampaign — usado para anuncios (creatividades) individuales. */
export type MetaAd = MetaCampaign;

export type DemographicRow = { label: string; reach: number };
export type CampaignDemographics = {
  byAgeGender: DemographicRow[]; // ej: "25-34 · Mujeres"
  byRegion: DemographicRow[];
};

/* ---------- helpers ---------- */

const num = (v: string | undefined) => (v == null ? 0 : Number(v) || 0);

const PURCHASE_TYPES = new Set(["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);

function purchasesFrom(actions?: RawAction[]): number {
  if (!actions) return 0;
  return actions
    .filter((a) => PURCHASE_TYPES.has(a.action_type))
    .reduce((acc, a) => acc + num(a.value), 0);
}
function roasFrom(roas?: RawAction[]): number {
  if (!roas || roas.length === 0) return 0;
  // tomamos el ROAS agregado (omni_purchase si está, si no el primero)
  const omni = roas.find((r) => r.action_type === "omni_purchase");
  return num((omni ?? roas[0]).value);
}

/* ---------- queries ---------- */

/** KPIs a nivel cuenta (últimos 7 días) + conteo de campañas activas. */
export async function getMetaOverview(): Promise<MetaOverview> {
  const acct = metaAccountId();
  const [insightsRes, campaignsRes] = await Promise.all([
    metaGraph<{ data: RawInsight[] }>(`${acct}/insights`, {
      fields: "spend,reach,impressions",
      date_preset: "last_7d",
    }),
    metaGraph<{ data: { id: string }[] }>(`${acct}/campaigns`, {
      fields: "id",
      effective_status: JSON.stringify(["ACTIVE"]),
      limit: 200,
    }),
  ]);
  const d = insightsRes.data?.[0] ?? {};
  return {
    spend: num(d.spend),
    reach: num(d.reach),
    impressions: num(d.impressions),
    activeCampaigns: campaignsRes.data?.length ?? 0,
  };
}

type MetaEntityRow = {
  id: string;
  name: string;
  effective_status: string;
  insights?: { data: RawInsight[] };
};

function mapEntityRow(row: MetaEntityRow): MetaCampaign {
  const ins = row.insights?.data?.[0] ?? {};
  return {
    id: row.id,
    name: row.name,
    status: row.effective_status,
    spend: num(ins.spend),
    reach: num(ins.reach),
    impressions: num(ins.impressions),
    clicks: num(ins.clicks),
    ctr: num(ins.ctr),
    purchases: purchasesFrom(ins.actions),
    roas: roasFrom(ins.purchase_roas),
  };
}

const INSIGHT_FIELDS =
  "insights.date_preset(last_7d){spend,reach,impressions,clicks,ctr,actions,purchase_roas}";

/** Campañas activas con sus métricas (últimos 7 días). */
export async function getActiveCampaigns(): Promise<MetaCampaign[]> {
  const acct = metaAccountId();
  const res = await metaGraph<{ data: MetaEntityRow[] }>(`${acct}/campaigns`, {
    fields: `id,name,effective_status,${INSIGHT_FIELDS}`,
    effective_status: JSON.stringify(["ACTIVE"]),
    limit: 200,
  });
  return (res.data ?? []).map(mapEntityRow);
}

/** Top N anuncios (creatividades) por ROAS de los últimos 7 días, entre los que tuvieron gasto. */
export async function getTopAds(limit = 3): Promise<MetaAd[]> {
  const acct = metaAccountId();
  const res = await metaGraph<{ data: MetaEntityRow[] }>(`${acct}/ads`, {
    fields: `id,name,effective_status,${INSIGHT_FIELDS}`,
    effective_status: JSON.stringify(["ACTIVE"]),
    limit: 200,
  });
  return (res.data ?? [])
    .map(mapEntityRow)
    .filter((ad) => ad.spend > 0)
    .sort((a, b) => b.roas - a.roas || b.purchases - a.purchases)
    .slice(0, limit);
}

const GENDER_ES: Record<string, string> = {
  male: "Hombres",
  female: "Mujeres",
  unknown: "N/D",
};

/** Demografía de una campaña: edad×género y top regiones (últimos 30 días). */
export async function getCampaignDemographics(campaignId: string): Promise<CampaignDemographics> {
  type Row = { reach?: string; age?: string; gender?: string; region?: string };
  const [ag, reg] = await Promise.all([
    metaGraph<{ data: Row[] }>(`${campaignId}/insights`, {
      fields: "reach",
      breakdowns: "age,gender",
      date_preset: "last_30d",
    }).catch(() => ({ data: [] as Row[] })),
    metaGraph<{ data: Row[] }>(`${campaignId}/insights`, {
      fields: "reach",
      breakdowns: "region",
      date_preset: "last_30d",
    }).catch(() => ({ data: [] as Row[] })),
  ]);

  const byAgeGender = (ag.data ?? [])
    .map((r) => ({
      label: `${r.age ?? "?"} · ${GENDER_ES[r.gender ?? "unknown"] ?? r.gender ?? "N/D"}`,
      reach: num(r.reach),
    }))
    .filter((r) => r.reach > 0)
    .sort((a, b) => b.reach - a.reach);

  const byRegion = (reg.data ?? [])
    .map((r) => ({ label: r.region ?? "N/D", reach: num(r.reach) }))
    .filter((r) => r.reach > 0)
    .sort((a, b) => b.reach - a.reach)
    .slice(0, 6);

  return { byAgeGender, byRegion };
}
