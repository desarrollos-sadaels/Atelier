"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardTitle, Eyebrow, btnCls } from "@/components/ui";
import { Field, Toggle } from "@/components/forms";
import { Dropdown } from "@/components/Dropdown";
import { ChevronLeft, Download } from "@/components/icons";
import { CATEGORY_OPTIONS } from "@/lib/categories";
import { cn } from "@/lib/cn";

const ranges = ["Hoy", "7 días", "30 días", "Mes", "Custom"];
const formats = ["CSV", "XLSX", "PDF"];

type SummaryItem = { k: string; v: string; acc?: boolean };

export function ReporteClient({
  summary,
  hasSales,
}: {
  summary: SummaryItem[];
  hasSales: boolean;
}) {
  const [range, setRange] = useState("30 días");
  const [format, setFormat] = useState("XLSX");
  const [tipo, setTipo] = useState("Ventas por producto");
  const [cat, setCat] = useState("Todas");
  const [canal, setCanal] = useState("Shopify + Manual");
  const [group, setGroup] = useState("Día");
  const [email, setEmail] = useState(false);

  function generar() {
    toast(hasSales ? "Export en construcción" : "Sin ventas para exportar todavía", {
      description: hasSales
        ? "La descarga CSV/XLSX/PDF llega en una próxima fase."
        : "Registrá ventas desde la pantalla de Ventas para poblar el reporte.",
    });
  }

  return (
    <>
      <div className="flex items-end justify-between gap-6 pt-9 pb-1">
        <div>
          <Eyebrow className="mb-3">Ventas / Reporte</Eyebrow>
          <h1 className="font-serif text-[44px] leading-none tracking-tight">
            Reporte de ventas
          </h1>
        </div>
        <Link href="/ventas" className={btnCls("ghost")}>
          <ChevronLeft className="h-4 w-4" /> Volver a Ventas
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[460px_1fr]">
        {/* config */}
        <Card>
          <CardTitle>Configurar reporte</CardTitle>
          <div className="space-y-6 px-6 pb-6 pt-4">
            <Dropdown
              label="TIPO DE REPORTE"
              value={tipo}
              options={["Ventas por producto", "Ventas por categoría", "Ventas por canal", "Stock valorizado"]}
              onChange={setTipo}
            />
            <div>
              <div className="mono text-[10px] text-mut">RANGO DE FECHAS</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {ranges.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={cn(
                      "mono rounded-full px-3 py-1.5 text-[11px] transition-colors",
                      r === range
                        ? "bg-acc text-white"
                        : "border border-line2 text-ink2 hover:border-ink/40",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="DESDE" placeholder="01/06/2026" />
              <Field label="HASTA" placeholder="25/06/2026" />
            </div>
            <Dropdown label="CATEGORÍA" value={cat} options={["Todas", ...CATEGORY_OPTIONS]} onChange={setCat} />
            <Dropdown label="CANAL" value={canal} options={["Shopify + Manual", "Solo Shopify", "Solo Manual"]} onChange={setCanal} />
            <Dropdown label="AGRUPAR POR" value={group} options={["Día", "Semana", "Mes"]} onChange={setGroup} />
            <div>
              <div className="mono text-[10px] text-mut">FORMATO DE DESCARGA</div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {formats.map((ff) => (
                  <button
                    key={ff}
                    onClick={() => setFormat(ff)}
                    className={cn(
                      "mono grid h-10 place-items-center rounded-lg text-[12px] transition-colors",
                      ff === format
                        ? "bg-acc text-white"
                        : "border border-line2 text-ink hover:border-ink/40",
                    )}
                  >
                    {ff}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">Enviar copia por email</span>
              <Toggle on={email} onChange={setEmail} />
            </div>
            <button className={btnCls("primary", "w-full")} onClick={generar}>
              <Download className="h-4 w-4" /> Generar y descargar
            </button>
            <button
              className={btnCls("ghost", "h-10 w-full text-[12px]")}
              onClick={() => toast("Reporte programado", { description: `${range} · cada lunes 09:00` })}
            >
              Programar reporte recurrente
            </button>
          </div>
        </Card>

        {/* preview */}
        <Card>
          <div className="flex items-center justify-between px-6 pt-6">
            <span className="mono text-[11px] text-mut">Vista previa</span>
            <span className="mono text-[10px] text-acc">Actualizada</span>
          </div>
          <div className="px-6 pb-6">
            <div className="mt-4 grid grid-cols-2 border-t border-line md:grid-cols-4">
              {summary.map((s, i) => (
                <div key={s.k} className={cn("py-5", i > 0 && "border-l border-line pl-5")}>
                  <div className="mono text-[10px] text-mut">{s.k}</div>
                  <div className={cn("mt-1 font-serif text-[30px] tracking-tight", s.acc && "text-acc")}>
                    {s.v}
                  </div>
                </div>
              ))}
            </div>
            <div className="hair" />
            <div className="mt-6 grid h-[220px] place-items-center rounded-[4px] border border-dashed border-line text-center">
              <div>
                <div className="font-serif text-[18px]">
                  {hasSales ? "Ventas de los últimos 30 días" : "Sin ventas en este período"}
                </div>
                <p className="mono mt-2 text-[11px] text-mut">
                  {hasSales
                    ? "El detalle exportable (CSV / XLSX / PDF) llega en una próxima fase."
                    : "Registrá ventas desde la pantalla de Ventas para poblar el reporte."}
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
