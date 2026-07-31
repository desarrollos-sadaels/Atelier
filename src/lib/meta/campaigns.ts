import "server-only";
import { metaGraph, metaAccountId, isMetaConfigured } from "@/lib/meta/client";

/** Campaña de Meta lista para elegir en el picker de vinculación (cualquier estado). */
export type MetaCampaignOption = { id: string; name: string; status: string };

/** Todas las campañas de la cuenta (no solo activas), para el selector de vinculación. */
export async function getAllMetaCampaigns(): Promise<MetaCampaignOption[]> {
  if (!isMetaConfigured()) return [];
  const acct = metaAccountId();
  type Row = { id: string; name: string; effective_status: string };
  const res = await metaGraph<{ data: Row[] }>(`${acct}/campaigns`, {
    fields: "id,name,effective_status",
    limit: 200,
  });
  return (res.data ?? [])
    .map((c) => ({ id: c.id, name: c.name, status: c.effective_status }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
