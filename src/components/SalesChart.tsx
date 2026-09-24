"use client";

import { useState } from "react";
import type { SalesDay } from "@/lib/queries";
import { cn } from "@/lib/cn";

/** Ingreso real por día, apilado por canal y acompañado por etiquetas numéricas. */
const SERIES = [
  { key: "atelier" as const, label: "Atelier", color: "#e2342b" },
  { key: "taller" as const, label: "Taller", color: "#16847b" },
  { key: "shopify" as const, label: "Shopify", color: "#33538f" },
  { key: "otherBrands" as const, label: "Otras marcas", color: "#7951a7" },
];
const SHIPPING_CHANNELS = [
  { key: "atelierShipping" as const, label: "Atelier" },
  { key: "tallerShipping" as const, label: "Taller" },
  { key: "shopifyShipping" as const, label: "Shopify" },
];
const SHIPPING_COLOR = "#ad7845";

const arsFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const dayFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short" });
const fullDayFmt = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "numeric",
  month: "long",
});

function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

export function SalesChart({ data, grossProductAmount }: {
  data: SalesDay[];
  grossProductAmount: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const max = Math.max(...data.map((d) => d.total), 0);
  const maxShipping = Math.max(...data.map((d) => d.shipping), 0);
  const totals = {
    atelier: data.reduce((sum, day) => sum + day.atelier, 0),
    taller: data.reduce((sum, day) => sum + day.taller, 0),
    shopify: data.reduce((sum, day) => sum + day.shopify, 0),
    otherBrands: data.reduce((sum, day) => sum + day.otherBrands, 0),
  };
  const total = totals.atelier + totals.taller + totals.shopify + totals.otherBrands;
  const shippingTotals = {
    atelierShipping: data.reduce((sum, day) => sum + day.atelierShipping, 0),
    tallerShipping: data.reduce((sum, day) => sum + day.tallerShipping, 0),
    shopifyShipping: data.reduce((sum, day) => sum + day.shopifyShipping, 0),
  };
  const shippingTotal = shippingTotals.atelierShipping + shippingTotals.tallerShipping + shippingTotals.shopifyShipping;

  if (max === 0 && shippingTotal === 0 && grossProductAmount === 0) {
    return (
      <div className="mt-8 grid h-[180px] place-items-center rounded-[4px] border border-dashed border-line">
        <div className="text-center">
          <div className="font-serif text-[20px]">Sin ingresos de productos en los últimos 30 días</div>
          <p className="mono mt-2 text-[11px] text-mut">
            Se completa al registrar ventas
          </p>
        </div>
      </div>
    );
  }

  const active = hover !== null ? data[hover] : null;

  return (
    <div className="mt-6">
      {/* El número grande es el titular; el gráfico es el detalle. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-serif text-[36px] leading-none tracking-tight">
            {arsFmt.format(total)}
          </div>
          <div className="mono mt-1 text-[9px] uppercase tracking-wide text-mut">
            Ingreso Sadaels · productos
          </div>
          <div className="mono mt-3 text-[10px] uppercase tracking-wide text-mut">
            Venta bruta {arsFmt.format(grossProductAmount)}
          </div>
          <div className="mono mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-mut">
            {SERIES.filter((s) => totals[s.key] !== 0).map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: s.color }}
                />
                {s.label} {arsFmt.format(totals[s.key])}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="mono text-[10px] text-mut hover:text-ink"
          aria-expanded={showTable}
        >
          {showTable ? "Ver gráfico" : "Ver datos"}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line pt-3">
        <span className="mono flex items-center gap-1.5 text-[10px] text-mut">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: SHIPPING_COLOR }} />
          ENVÍOS COBRADOS
        </span>
        <span className="font-serif text-[21px] leading-none">{arsFmt.format(shippingTotal)}</span>
        {SHIPPING_CHANNELS.some((channel) => shippingTotals[channel.key] !== 0) && (
          <span className="mono text-[9px] text-mut">
            {SHIPPING_CHANNELS.filter((channel) => shippingTotals[channel.key] !== 0)
              .map((channel) => `${channel.label} ${arsFmt.format(shippingTotals[channel.key])}`)
              .join(" · ")}
          </span>
        )}
      </div>

      {showTable ? (
        <div className="mt-5">
          <div className="max-h-[200px] overflow-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="mono sticky top-0 bg-bg text-[9px] text-mut">
                <tr>
                  <th className="border-b border-line py-2 pr-3 font-normal">Día</th>
                  <th className="border-b border-line py-2 pr-3 text-right font-normal">Atelier · propios</th>
                  <th className="border-b border-line py-2 pr-3 text-right font-normal">Taller · propios</th>
                  <th className="border-b border-line py-2 pr-3 text-right font-normal">Shopify · propios</th>
                  <th className="border-b border-line py-2 pr-3 text-right font-normal">Otras marcas · Sadaels</th>
                  <th className="border-b border-line py-2 pr-3 text-right font-normal">Total Sadaels</th>
                  <th className="border-b border-line py-2 text-right font-normal">Envíos aparte</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.day} className="border-b border-line">
                    <td className="mono py-1.5 pr-3 text-[11px] text-mut">
                      {dayFmt.format(parseDay(d.day))}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{arsFmt.format(d.atelier)}</td>
                    <td className="py-1.5 pr-3 text-right">{arsFmt.format(d.taller)}</td>
                    <td className="py-1.5 pr-3 text-right">{arsFmt.format(d.shopify)}</td>
                    <td className="py-1.5 pr-3 text-right">{arsFmt.format(d.otherBrands)}</td>
                    <td className="py-1.5 pr-3 text-right font-medium">{arsFmt.format(d.total)}</td>
                    <td className="py-1.5 text-right">
                      {arsFmt.format(d.shipping)}
                      {d.shipping > 0 && (
                        <div className="mono text-[9px] text-mut">
                          {SHIPPING_CHANNELS.filter((channel) => d[channel.key] > 0)
                            .map((channel) => `${channel.label} ${arsFmt.format(d[channel.key])}`)
                            .join(" · ")}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="relative mt-6">
          {active && (
            <div
              className="pointer-events-none absolute -top-1 z-10 w-max max-w-[220px] -translate-y-full rounded-[4px] border border-line2 bg-bg px-3 py-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.22)]"
              style={{
                // Se ancla al centro de la barra y se mantiene dentro de la
                // caja: en los extremos del mes, centrarlo lo cortaría.
                left: `${((hover! + 0.5) / data.length) * 100}%`,
                transform: `translate(${hover! < data.length / 2 ? "-10%" : "-90%"}, -100%)`,
              }}
              role="status"
            >
              <div className="mono text-[9px] text-mut">{fullDayFmt.format(parseDay(active.day))}</div>
              <div className="mt-1.5 font-serif text-[18px] leading-none">
                {arsFmt.format(active.total)}
              </div>
              <div className="mono mt-0.5 text-[9px] text-mut">Ingreso Sadaels de productos</div>
              <div className="mono mt-2 space-y-0.5 text-[9px] text-ink2">
                {SERIES.map((s) => (
                  <div key={s.key} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ background: s.color }}
                    />
                    {s.label} {arsFmt.format(active[s.key])}
                  </div>
                ))}
                <div className="mt-1 border-t border-line pt-1 text-mut">
                  Envíos {arsFmt.format(active.shipping)}
                </div>
                {SHIPPING_CHANNELS.filter((channel) => active[channel.key] > 0).map((channel) => (
                  <div key={channel.key} className="text-mut">
                    {channel.label} {arsFmt.format(active[channel.key])}
                  </div>
                ))}
                <div className="text-mut">
                  {active.operations} {active.operations === 1 ? "operación" : "operaciones"}
                </div>
              </div>
            </div>
          )}

          <div
            className="flex h-[180px] items-end gap-[2px]"
            onMouseLeave={() => setHover(null)}
          >
            {data.map((d, i) => (
              <button
                key={d.day}
                type="button"
                // El área de hover es la columna entera, no la barra: con
                // montos chicos la barra mide 3px y sería imposible apuntarle.
                // `flex-col-reverse` + `justify-start` apila desde el piso hacia
                // arriba, con el primer canal apoyado en la línea de base.
                className="group relative flex h-full flex-1 flex-col-reverse justify-start"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${fullDayFmt.format(parseDay(d.day))}: ${arsFmt.format(
                  d.total,
                )} de ingreso Sadaels — Atelier ${arsFmt.format(d.atelier)}, Taller ${arsFmt.format(d.taller)}, Shopify ${arsFmt.format(d.shopify)}, ingreso Sadaels de otras marcas ${arsFmt.format(d.otherBrands)}; envíos ${arsFmt.format(d.shipping)}`}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-0 rounded-t-[4px] transition-colors",
                    hover === i ? "bg-panel" : "bg-transparent",
                  )}
                />
                {/* Un corte de 2px separa los canales presentes en cada día. */}
                {SERIES.map((s, si) => {
                  const value = d[s.key];
                  if (value <= 0) return null;
                  const hasLowerSegment = SERIES.slice(0, si).some(
                    (lower) => d[lower.key] > 0,
                  );
                  const isTop = SERIES.slice(si + 1).every((upper) => d[upper.key] <= 0);
                  return (
                    <span
                      key={s.key}
                      aria-hidden
                      className={cn("relative w-full", isTop && "rounded-t-[4px]")}
                      style={{
                        height: `${Math.max((value / max) * 100, 1.5)}%`,
                        background: s.color,
                        marginBottom: hasLowerSegment ? 2 : 0,
                        opacity: hover === null || hover === i ? 1 : 0.35,
                      }}
                    />
                  );
                })}
              </button>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <div className="mono flex items-center justify-between gap-3 text-[9px] text-mut">
              <span>ENVÍOS POR DÍA</span>
              <span className="text-right">
                {active
                  ? `${dayFmt.format(parseDay(active.day))} · ${arsFmt.format(active.shipping)}`
                  : `TOTAL ${arsFmt.format(shippingTotal)}`}
              </span>
            </div>
            <div className="mt-2 flex h-10 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
              {data.map((d, i) => (
                <button
                  key={d.day}
                  type="button"
                  className="flex h-full flex-1 items-end"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={d.shipping > 0 ? 0 : -1}
                  aria-label={`${fullDayFmt.format(parseDay(d.day))}: envíos ${arsFmt.format(d.shipping)} — ${SHIPPING_CHANNELS.map((channel) => `${channel.label} ${arsFmt.format(d[channel.key])}`).join(", ")}`}
                >
                  {d.shipping > 0 && (
                    <span
                      aria-hidden
                      className="w-full rounded-t-[2px]"
                      style={{
                        height: `${Math.max((d.shipping / maxShipping) * 100, 8)}%`,
                        background: SHIPPING_COLOR,
                        opacity: hover === null || hover === i ? 1 : 0.35,
                      }}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="mono mt-3 flex justify-between text-[9px] text-mut2">
            <span>{dayFmt.format(parseDay(data[0].day))}</span>
            <span>{dayFmt.format(parseDay(data[Math.floor(data.length / 2)].day))}</span>
            <span>{dayFmt.format(parseDay(data[data.length - 1].day))}</span>
          </div>
        </div>
      )}
    </div>
  );
}
