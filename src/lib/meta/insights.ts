import "server-only";
import { metaGraph, metaAccountId } from "@/lib/meta/client";

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

/** Campañas activas con sus métricas (últimos 7 días). */
export async function getActiveCampaigns(): Promise<MetaCampaign[]> {
  const acct = metaAccountId();
  type Row = {
    id: string;
    name: string;
    effective_status: string;
    insights?: { data: RawInsight[] };
  };
  const res = await metaGraph<{ data: Row[] }>(`${acct}/campaigns`, {
    fields:
      "id,name,effective_status,insights.date_preset(last_7d){spend,reach,impressions,clicks,ctr,actions,purchase_roas}",
    effective_status: JSON.stringify(["ACTIVE"]),
    limit: 200,
  });
  return (res.data ?? []).map((c) => {
    const ins = c.insights?.data?.[0] ?? {};
    return {
      id: c.id,
      name: c.name,
      status: c.effective_status,
      spend: num(ins.spend),
      reach: num(ins.reach),
      impressions: num(ins.impressions),
      clicks: num(ins.clicks),
      ctr: num(ins.ctr),
      purchases: purchasesFrom(ins.actions),
      roas: roasFrom(ins.purchase_roas),
    };
  });
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
