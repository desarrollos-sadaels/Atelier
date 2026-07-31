"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardTitle, btnCls } from "@/components/ui";
import { Dropdown } from "@/components/Dropdown";
import { DemoBlock } from "@/components/DemoBlock";
import type { MetaCampaignOption } from "@/lib/meta/campaigns";
import type { DemographicRow } from "@/lib/meta/insights";

const NO_CAMPAIGN = "Seleccionar campaña…";

export function CampaignLinkCard({
  productId,
  readOnly,
  metaConfigured,
  link,
  campaigns,
  demo,
}: {
  productId: string;
  readOnly: boolean;
  metaConfigured: boolean;
  link: { name: string; status: string | null } | null;
  campaigns: MetaCampaignOption[];
  demo: { byAgeGender: DemographicRow[]; byRegion: DemographicRow[] } | null;
}) {
  const router = useRouter();
  const [campaign, setCampaign] = useState(NO_CAMPAIGN);
  const [saving, setSaving] = useState(false);

  async function linkCampaign() {
    const picked = campaigns.find((c) => c.name === campaign);
    if (!picked || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${productId}/campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metaCampaignId: picked.id, name: picked.name }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error vinculando la campaña");
      toast.success("Campaña vinculada");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error vinculando la campaña");
    } finally {
      setSaving(false);
    }
  }

  async function unlinkCampaign() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${productId}/campaign`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error desvinculando la campaña");
      toast.success("Campaña desvinculada");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error desvinculando la campaña");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardTitle>Campaña Meta vinculada</CardTitle>
      <div className="px-6 pb-6 pt-4">
        {!metaConfigured ? (
          <>
            <div className="text-[15px] font-medium">Meta no está conectado</div>
            <p className="mono mt-3 text-[11px] leading-relaxed text-mut">
              Configurá las credenciales de Meta Ads para poder vincular campañas.
            </p>
          </>
        ) : link ? (
          <>
            <div className="flex items-center justify-between">
              <div className="text-[15px] font-medium">{link.name}</div>
              <span className="mono text-[10px] text-mut">{link.status ?? "—"}</span>
            </div>
            <p className="mono mt-3 text-[11px] leading-relaxed text-mut">
              Si este producto se queda sin stock, avisamos al equipo de medios (campanita + email).
              No se pausa la campaña automáticamente.
            </p>
            {!readOnly && (
              <button
                className={btnCls("ghost", "mt-5 h-10 text-[12px]")}
                disabled={saving}
                onClick={unlinkCampaign}
              >
                {saving ? "Desvinculando…" : "Desvincular campaña"}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="text-[15px] font-medium">Sin campaña vinculada</div>
            <p className="mono mt-3 text-[11px] leading-relaxed text-mut">
              Vinculá este producto con una campaña de Meta Ads para avisar al equipo de medios
              automáticamente al quedar sin stock.
            </p>
            {!readOnly &&
              (campaigns.length === 0 ? (
                <p className="mono mt-4 text-[11px] text-mut">No hay campañas disponibles en Meta.</p>
              ) : (
                <>
                  <div className="mt-4">
                    <Dropdown
                      label="CAMPAÑA"
                      value={campaign}
                      options={[NO_CAMPAIGN, ...campaigns.map((c) => c.name)]}
                      onChange={setCampaign}
                    />
                  </div>
                  <button
                    className={btnCls("ghost", "mt-4 h-10 text-[12px]")}
                    disabled={saving || campaign === NO_CAMPAIGN}
                    onClick={linkCampaign}
                  >
                    {saving ? "Vinculando…" : "Vincular campaña"}
                  </button>
                </>
              ))}
          </>
        )}

        {link && demo && (demo.byAgeGender.length > 0 || demo.byRegion.length > 0) && (
          <div className="mt-6 space-y-6 border-t border-line pt-6">
            <DemoBlock title="Edad y género · alcance" rows={demo.byAgeGender.slice(0, 8)} />
            <DemoBlock title="Regiones · alcance" rows={demo.byRegion} />
          </div>
        )}
      </div>
    </Card>
  );
}
