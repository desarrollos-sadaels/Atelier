"use client";

import { useState } from "react";
import { btnCls } from "@/components/ui";

type Insight = { title: string; detail: string };

export function LearningsPanel({ metaCampaignId }: { metaCampaignId: string }) {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/learnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metaCampaignId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudieron generar los insights");
      setInsights(data.insights);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron generar los insights");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-t border-line px-6 py-6">
      <div className="flex items-center justify-between">
        <div className="mono text-[10px] text-mut">LEARNINGS (IA)</div>
        <button className={btnCls("ghost", "h-9 text-[12px]")} disabled={loading} onClick={generate}>
          {loading ? "Generando…" : insights ? "Regenerar" : "Generar insights"}
        </button>
      </div>

      {error && <p className="mono mt-3 text-[11px] text-acc">{error}</p>}

      {!insights && !loading && !error && (
        <p className="mono mt-3 text-[11px] text-mut">
          Un modelo de IA lee la demografía y performance real de esta campaña y te devuelve
          lecturas accionables.
        </p>
      )}

      {insights && (
        <div className="mt-4 space-y-3">
          {insights.map((ins, i) => (
            <div key={i} className="rounded-[4px] border border-line bg-panel px-4 py-3">
              <div className="text-[13px] font-medium">{ins.title}</div>
              <p className="mono mt-1 text-[11px] leading-relaxed text-mut">{ins.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
