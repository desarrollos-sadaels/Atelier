/**
 * Tipos compartidos de Meta Ads.
 *
 * Vive aparte de `insights.ts` / `campaigns.ts` a propósito: esos módulos importan
 * `server-only` (hablan con la Graph API usando el access token), así que un Client
 * Component que importe un tipo desde ahí arrastra el módulo entero al bundle del
 * browser y el build falla con "'server-only' cannot be imported from a Client
 * Component module". Este archivo no tiene runtime ni secretos: lo pueden importar
 * los dos lados.
 */

/* ---------- insights ---------- */

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

/* ---------- campañas ---------- */

/** Campaña de Meta lista para elegir en el picker de vinculación (cualquier estado). */
export type MetaCampaignOption = { id: string; name: string; status: string };
