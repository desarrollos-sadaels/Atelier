"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { KpiRow } from "@/components/KpiRow";
import { Card, CardTitle, btnCls } from "@/components/ui";
import { Check } from "@/components/icons";
import { cn } from "@/lib/cn";

const campaignKpis = [
  { label: "Campañas activas", value: "0", sub: "sin vincular aún" },
  { label: "Gasto · 7 días", value: "—", sub: "—" },
  { label: "Alcance · 7 días", value: "—", sub: "—" },
  { label: "Pausadas por stock", value: "0", sub: "—" },
];
const campaigns: never[] = [];

const RULES = [
  "Notificar al administrador de medios",
  "Pausar automáticamente al quedar sin stock",
  "Reactivar campaña al reponer",
];

export default function MetaAdsPage() {
  const [rules, setRules] = useState([true, true, true]);
  const toggle = (i: number) =>
    setRules((r) => r.map((v, idx) => (idx === i ? !v : v)));

  return (
    <>
      <PageHeader
        kicker="Meta Ads · Lanzallamas · act_1029384 · Conectado"
        title="Meta Ads"
        actions={
          <>
            <button
              className={btnCls("ghost")}
              onClick={() => toast("Automatización", { description: "Reglas de stock ↔ campañas" })}
            >
              Automatización
            </button>
            <button
              className={btnCls("ghost")}
              onClick={() => toast.success("Cuenta de Meta sincronizada")}
            >
              Reconectar
            </button>
          </>
        }
      />

      <div className="mt-8">
        <KpiRow items={campaignKpis} />
      </div>

      <div className="mt-9 flex items-center justify-between">
        <h2 className="font-serif text-[22px] tracking-tight">Campañas activas</h2>
        <button className="mono text-[11px] text-acc" onClick={() => toast("Mostrando todas las campañas")}>
          Ver todas →
        </button>
      </div>

      {campaigns.length === 0 && (
        <div className="mt-4 grid place-items-center rounded-[4px] border border-dashed border-line py-16 text-center">
          <div className="font-serif text-[20px]">Sin campañas vinculadas</div>
          <p className="mono mt-2 text-[11px] text-mut">
            Conectá Meta Ads y vinculá productos a campañas (Fase Meta Ads)
          </p>
        </div>
      )}

      {/* automation */}
      <Card className="mt-8">
        <CardTitle>Automatización · alertas de stock</CardTitle>
        <div className="grid grid-cols-1 gap-8 px-6 pb-6 pt-5 md:grid-cols-3">
          <div className="space-y-3">
            {RULES.map((t, i) => (
              <button
                key={t}
                onClick={() => toggle(i)}
                className="flex w-full items-center gap-3 text-left"
              >
                <span
                  className={cn(
                    "grid h-[18px] w-[18px] place-items-center rounded transition-colors",
                    rules[i] ? "bg-acc text-white" : "border border-line2",
                  )}
                >
                  {rules[i] && <Check className="h-3 w-3" />}
                </span>
                <span className="text-[14px]">{t}</span>
              </button>
            ))}
          </div>
          <div>
            <div className="mono text-[10px] text-mut2">Destinatarios</div>
            <div className="mt-3 space-y-3">
              {["María G. · Media Manager", "Pablo R. · Pauta", "#stock-alertas"].map((d) => (
                <div key={d} className="flex items-center gap-3">
                  <span className="h-6 w-6 rounded-full border border-line2 bg-tile" />
                  <span className="text-[12px]">{d}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mono text-[10px] text-mut">Umbral de alerta</div>
            <div className="mt-1 font-serif text-[20px]">≤ 3 unidades</div>
          </div>
        </div>
      </Card>
    </>
  );
}
