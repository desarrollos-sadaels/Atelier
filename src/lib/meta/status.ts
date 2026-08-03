/* ---------- estado (Meta lo devuelve en SCREAMING_SNAKE_CASE) ---------- */
// Sin "server-only": lo importan tanto Server Components como Client Components
// (ej. CampaignLinkCard.tsx) para mostrar el estado de una campaña/anuncio.

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
