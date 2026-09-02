"use client";

import { useState } from "react";
import type { SalesDay } from "@/lib/queries";
import { cn } from "@/lib/cn";

/**
 * Ventas por día, apiladas por plataforma.
 *
 * Los dos colores son la única parte no obvia. La paleta de Atelier es
 * monocroma con un solo acento rojo, y "negro + rojo" no sirve para dos series:
 * el negro no tiene croma, así que en un apilado lee como "sombra" y no como
 * una categoría. Se validó el par contra los seis chequeos de color (banda de
 * luminosidad, piso de croma, separación con daltonismo, piso de visión normal
 * y contraste contra el fondo) y el ganador fue el acento de la marca más un
 * azul editorial. Un ocre —lo primero que uno probaría en una paleta cálida—
 * falla: contra el rojo queda a ΔE 4.9 en deuteranopía, o sea indistinguible.
 *
 * Y como el color nunca puede ser la única señal, cada serie va además con su
 * leyenda, su número en el tooltip y la tabla de datos.
 */
const SERIES = [
  { key: "atelier" as const, label: "Atelier", color: "#e2342b" },
  { key: "shopify" as const, label: "Shopify", color: "#33538f" },
];

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

export function SalesChart({ data }: { data: SalesDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const max = Math.max(...data.map((d) => d.total), 0);
  const totalAtelier = data.reduce((s, d) => s + d.atelier, 0);
  const totalShopify = data.reduce((s, d) => s + d.shopify, 0);
  const total = totalAtelier + totalShopify;

  if (!data.length || max === 0) {
    return (
      <div className="mt-8 grid h-[180px] place-items-center rounded-[4px] border border-dashed border-line">
        <div className="text-center">
          <div className="font-serif text-[20px]">Sin ventas en los últimos 30 días</div>
          <p className="mono mt-2 text-[11px] text-mut">
            Se puebla con las ventas del local y las de la tienda online
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
          <div className="mono mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-mut">
            {SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: s.color }}
                />
                {s.label} {arsFmt.format(s.key === "atelier" ? totalAtelier : totalShopify)}
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

      {showTable ? (
        <div className="mt-5 max-h-[200px] overflow-y-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="mono sticky top-0 bg-bg text-[9px] text-mut">
              <tr>
                <th className="border-b border-line py-2 pr-3 font-normal">Día</th>
                <th className="border-b border-line py-2 pr-3 text-right font-normal">Atelier</th>
                <th className="border-b border-line py-2 pr-3 text-right font-normal">Shopify</th>
                <th className="border-b border-line py-2 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-b border-line">
                  <td className="mono py-1.5 pr-3 text-[11px] text-mut">
                    {dayFmt.format(parseDay(d.day))}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{arsFmt.format(d.atelier)}</td>
                  <td className="py-1.5 pr-3 text-right">{arsFmt.format(d.shopify)}</td>
                  <td className="py-1.5 text-right font-medium">{arsFmt.format(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
                // arriba, con el primer hijo abajo. Es lo que hace que Atelier
                // quede apoyado en la línea de base y Shopify encima.
                className="group relative flex h-full flex-1 flex-col-reverse justify-start"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${fullDayFmt.format(parseDay(d.day))}: ${arsFmt.format(
                  d.total,
                )} — Atelier ${arsFmt.format(d.atelier)}, Shopify ${arsFmt.format(d.shopify)}`}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-0 rounded-t-[4px] transition-colors",
                    hover === i ? "bg-panel" : "bg-transparent",
                  )}
                />
                {/* Apilado de abajo hacia arriba: Atelier al piso, Shopify
                    encima, con 2px de fondo entre los dos para que se lean
                    como dos segmentos y no como un degradé. */}
                {SERIES.map((s, si) => {
                  const value = d[s.key];
                  if (value <= 0) return null;
                  const isTop = si === SERIES.length - 1 || d[SERIES[si + 1].key] <= 0;
                  return (
                    <span
                      key={s.key}
                      aria-hidden
                      className={cn("relative w-full", isTop && "rounded-t-[4px]")}
                      style={{
                        height: `${Math.max((value / max) * 100, 1.5)}%`,
                        background: s.color,
                        marginBottom: si > 0 ? 2 : 0,
                        opacity: hover === null || hover === i ? 1 : 0.35,
                      }}
                    />
                  );
                })}
              </button>
            ))}
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
