"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Card, btnCls } from "@/components/ui";
import { Toggle } from "@/components/forms";
import { Dropdown } from "@/components/Dropdown";
import { Popover } from "@/components/Popover";
import { KpiRow } from "@/components/KpiRow";
import { PageHeader } from "@/components/PageHeader";
import { ChevronLeft, Download } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { SalesKpis } from "@/lib/queries";
import {
  CHANNEL_LABEL,
  MAX_REPORT_DAYS,
  REPORT_PRESETS,
  SALE_CHANNELS,
  channelsLabel,
  countDays,
  dayLabel,
  formatRangeLabel,
  normalizeChannels,
  presetBounds,
  rangeFromStart,
  reportSearchParams,
  sellerLabel,
  sharePct,
  type ChannelSummary,
  type NamedPreset,
  type ReportHighlights,
  type ReportRange,
  type ReportTotals,
  type SaleChannel,
  type SellerSummary,
} from "@/lib/sales-report";

export type SellerOption = { id: string; label: string };

/** Forma del rango en el formulario: un preset, o fechas libres elegidas a mano. */
type RangeMode = NamedPreset | "libre";

const arsFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
const fmtARS = (n: number) => arsFmt.format(n);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Reporte de ventas: un formulario que arma un BORRADOR y una vista previa que
 * muestra lo último que se generó.
 *
 * Los cambios del formulario no tocan la vista hasta "Generar vista previa":
 * elegir un rango en el calendario son dos clics, y si cada uno disparara una
 * consulta la vista parpadearía con reportes a medio armar. La vista previa y
 * los CSV siempre corresponden a lo aplicado (la URL), nunca al borrador.
 */
export function ReporteClient({
  range,
  today,
  channels,
  sellerId,
  sellerName,
  sellerOptions,
  ownOnly,
  totals,
  byChannel,
  bySeller,
  highlights,
  incomeSummary,
  error,
}: {
  range: ReportRange;
  today: string;
  channels: SaleChannel[];
  sellerId: string | null;
  sellerName: string | null;
  sellerOptions: SellerOption[];
  ownOnly: boolean;
  totals: ReportTotals;
  byChannel: ChannelSummary[];
  bySeller: SellerSummary[];
  highlights: ReportHighlights;
  incomeSummary: SalesKpis | null;
  error: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // El vendedor no lleva `vendedor` en la URL: el server ya lo fija en su cuenta.
  const applied = reportSearchParams({
    preset: range.preset,
    from: range.from,
    to: range.to,
    channels,
    sellerId: ownOnly ? null : sellerId,
  });
  const appliedQs = applied.toString();

  function apply(qs: string) {
    startTransition(() => {
      router.push(qs ? `/ventas/reporte?${qs}` : "/ventas/reporte", { scroll: false });
    });
  }

  const hrefWith = (extra: Record<string, string>) => {
    const p = new URLSearchParams(applied);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/ventas/reporte?${p.toString()}`;
  };

  // Los exports llevan las FECHAS de la vista previa, nunca el preset. Con
  // `rango=hoy`, generar a las 23:58 y descargar a las 00:01 bajaba el día
  // siguiente: la API vuelve a calcular "hoy" al momento de la descarga.
  const exportHref = (tipo: "pdf" | "resumen" | "detalle") => {
    const p = reportSearchParams({
      preset: "custom",
      from: range.from,
      to: range.to,
      channels,
      sellerId: ownOnly ? null : sellerId,
    });
    p.set("tipo", tipo);
    return `/api/ventas/reporte?${p.toString()}`;
  };

  const employeeMode = Boolean(sellerId);
  const hasSales = totals.operations > 0 || totals.gross !== 0 || totals.income !== 0;
  const scopeLabel = channelsLabel(channels);
  const changes = totals.returnedCount + totals.exchangedCount;

  const kpis = [
    {
      label: "Ingreso Sadaels · productos",
      value: hasSales ? fmtARS(totals.income) : "—",
      sub: hasSales
        ? `Venta bruta ${fmtARS(totals.gross)} · envíos ${fmtARS(totals.shipping)} aparte`
        : `${scopeLabel} · sin ventas`,
    },
    {
      label: "Operaciones",
      value: String(totals.operations),
      sub: plural(totals.units, "unidad", "unidades"),
    },
    {
      label: "Ticket promedio",
      value: totals.operations ? fmtARS(Math.round(totals.total / totals.operations)) : "—",
      sub: "ventas ÷ operaciones",
    },
    {
      label: "Cambios y devoluciones",
      value: String(changes),
      sub: changes
        ? `${plural(totals.exchangedCount, "cambio", "cambios")} · ${plural(totals.returnedCount, "devolución", "devoluciones")}`
        : "sin cambios ni devoluciones",
      alert: changes > 0,
    },
  ];

  return (
    <>
      <PageHeader
        kicker="Ventas · Reporte"
        title="Reporte de ventas"
        actions={
          <Link href="/ventas" className={btnCls("ghost")}>
            <ChevronLeft className="h-4 w-4" /> Volver a Ventas
          </Link>
        }
      />

      {/* Keyed por lo aplicado: al generar (o al navegar atrás) el borrador
          vuelve a arrancar desde lo que muestra la vista previa. */}
      <ReportForm
        key={appliedQs}
        range={range}
        today={today}
        channels={channels}
        sellerId={sellerId}
        sellerName={sellerName}
        sellerOptions={sellerOptions}
        ownOnly={ownOnly}
        pending={pending}
        onApply={apply}
      />

      {/* ---------- vista previa ---------- */}
      <div
        aria-busy={pending}
        className={cn("transition-opacity duration-150", pending && "pointer-events-none opacity-50")}
      >
        <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mono text-[11px] text-mut">Vista previa</div>
            <h2 className="mt-2 font-serif text-[26px] leading-tight tracking-tight">
              {employeeMode ? `Resumen de ${sellerName ?? "la cuenta"}` : "Todas las cuentas"}
            </h2>
            <p className="mono mt-1.5 text-[11px] text-mut">
              {formatRangeLabel(range.from, range.to)} · {plural(range.days, "día", "días")} · {scopeLabel}
            </p>
          </div>
          {!error && (hasSales || changes > 0) && (
            <div className="flex flex-wrap gap-2">
              {/* El PDF es la vista previa tal cual, para mandar o imprimir; los
                  CSV son los datos, para trabajarlos en una planilla. */}
              <DownloadButton href={exportHref("pdf")} fallbackName="reporte-ventas.pdf" variant="dark">
                Descargar PDF
              </DownloadButton>
              <DownloadButton href={exportHref("resumen")} fallbackName="ventas-resumen.csv">
                Resumen CSV
              </DownloadButton>
              <DownloadButton href={exportHref("detalle")} fallbackName="ventas-detalle.csv">
                Detalle por prenda
              </DownloadButton>
            </div>
          )}
        </div>
        {range.notice && (
          <p className="mono mt-3 text-[11px] text-acc" role="status">
            {range.notice}
          </p>
        )}

        {error ? (
          <Card className="mt-6">
            <EmptyState title="No se pudo calcular el reporte">
              {/sales_by_seller_channel|sale_channel|returned_units|exchanged_/i.test(error)
                ? "Falta aplicar la migración 0025 (cambios, devoluciones y destacados) en la base."
                : error}
            </EmptyState>
          </Card>
        ) : (
          <>
            <div className="mt-6">
              <KpiRow items={kpis} />
            </div>

            {incomeSummary && <IncomeSummaryCard data={incomeSummary} />}

            <HighlightsCard highlights={highlights} totals={totals} />

            <Card className="mt-8">
              <SectionHead
                title={employeeMode ? "Por canal" : "Ventas por canal"}
                description="El ingreso de Sadaels aparece primero y la venta bruta debajo; los envíos se informan aparte. Mayoristas y Taller se cuentan separados de Atelier."
              />
              <ChannelTable rows={byChannel} selected={channels} />
            </Card>

            {!employeeMode && (
              <Card className="mt-8">
                <SectionHead
                  title="Ventas por vendedor"
                  description="El ingreso de Sadaels aparece primero y la venta bruta debajo. Cada compra cuenta para quien la tiene a su nombre; los pedidos web sin reclamar quedan en su propia fila."
                />
                {bySeller.length === 0 ? (
                  <EmptyState title="Sin ventas en este período">
                    Probá con un rango más amplio o con todos los canales.
                  </EmptyState>
                ) : (
                  <SellerTable rows={bySeller} totals={totals} hrefFor={(id) => hrefWith({ vendedor: id })} />
                )}
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ---------- formulario ----------

function ReportForm({
  range,
  today,
  channels,
  sellerId,
  sellerName,
  sellerOptions,
  ownOnly,
  pending,
  onApply,
}: {
  range: ReportRange;
  today: string;
  channels: SaleChannel[];
  sellerId: string | null;
  sellerName: string | null;
  sellerOptions: SellerOption[];
  ownOnly: boolean;
  pending: boolean;
  onApply: (qs: string) => void;
}) {
  const [mode, setMode] = useState<RangeMode>(range.preset === "custom" ? "libre" : range.preset);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [draftChannels, setDraftChannels] = useState<SaleChannel[]>(channels);
  const [perEmployee, setPerEmployee] = useState(ownOnly || sellerId !== null);
  const [draftSeller, setDraftSeller] = useState<string | null>(ownOnly ? null : sellerId);

  const days = countDays(from, to);
  const rangeError =
    from > to
      ? "La fecha de inicio es posterior a la de fin."
      : days > MAX_REPORT_DAYS
        ? `El rango máximo es de ${MAX_REPORT_DAYS} días.`
        : null;
  const needsSeller = perEmployee && !ownOnly && !draftSeller;

  // Si las fechas siguen siendo exactamente las del preset, se guarda el
  // preset y no las fechas: así "30 días" compartido mañana sigue siendo los
  // últimos 30 días, y no los de hoy.
  const presetStillExact =
    mode !== "libre" && presetBounds(mode, today).join() === [from, to].join();
  const qs = reportSearchParams({
    preset: presetStillExact ? (mode as NamedPreset) : "custom",
    from,
    to,
    channels: draftChannels,
    sellerId: perEmployee && !ownOnly ? draftSeller : null,
  }).toString();
  // Se compara el reporte que se pediría, no el texto de la URL: con "7 días"
  // aplicado, tocar "Personalizado" sin mover las fechas cambia `rango=7d` por
  // `rango=custom&desde…`, y marcaba "cambios sin aplicar" para el mismo reporte.
  // Los canales vienen normalizados de los dos lados, así que se comparan en orden.
  const dirty =
    from !== range.from ||
    to !== range.to ||
    draftChannels.join() !== channels.join() ||
    (perEmployee && !ownOnly ? draftSeller : null) !== (ownOnly ? null : sellerId);
  const canApply = !rangeError && !needsSeller && !pending;

  function choosePreset(p: NamedPreset) {
    const [a, b] = presetBounds(p, today);
    setMode(p);
    setFrom(a);
    setTo(b);
  }

  // Cada canal se prende y apaga por separado; "Todos" limpia la selección.
  // `normalizeChannels` hace que marcar los cuatro vuelva a ser "Todos".
  function toggleChannel(c: SaleChannel) {
    setDraftChannels((prev) =>
      normalizeChannels(prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]),
    );
  }

  const selectedSeller = sellerOptions.find((o) => o.id === draftSeller);
  const modeLabel = REPORT_PRESETS.find((p) => p.value === mode)?.label;

  return (
    <Card className="mt-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canApply) onApply(qs);
        }}
      >
        <div className="grid grid-cols-1 gap-8 px-6 pt-6 pb-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {/* período */}
          <fieldset className="min-w-0">
            <legend className="mono text-[10px] text-mut">PERÍODO</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {REPORT_PRESETS.map((p) => (
                <Pill key={p.value} active={mode === p.value} onClick={() => choosePreset(p.value)}>
                  {p.label}
                </Pill>
              ))}
              <Pill active={mode === "libre"} onClick={() => setMode("libre")}>
                Personalizado
              </Pill>
            </div>

            <div className="mt-4">
              <DateRangePicker
                from={from}
                to={to}
                mode={mode}
                today={today}
                onChange={(a, b) => {
                  setFrom(a);
                  setTo(b);
                }}
              />
              <p className={cn("mono mt-2 text-[10px]", rangeError ? "text-acc" : "text-mut")}>
                {rangeError ??
                  (mode === "libre"
                    ? `Elegí inicio y fin en el calendario · ${plural(days, "día", "días")}`
                    : mode === "mes" || mode === "mes-anterior"
                      ? "Marcá cualquier día: se completa el mes entero"
                      : `Marcá el inicio: el fin se completa con ${modeLabel?.toLowerCase()} · ${plural(days, "día", "días")}`)}
              </p>
            </div>
          </fieldset>

          <div className="min-w-0 space-y-7">
            {/* canales */}
            <fieldset>
              <legend className="mono text-[10px] text-mut">CANALES</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                <Pill active={draftChannels.length === 0} onClick={() => setDraftChannels([])}>
                  Todos
                </Pill>
                {SALE_CHANNELS.map((c) => (
                  <Pill
                    key={c.value}
                    checkbox
                    active={draftChannels.includes(c.value)}
                    onClick={() => toggleChannel(c.value)}
                  >
                    {c.label}
                  </Pill>
                ))}
              </div>
              <p className="mono mt-2 text-[10px] text-mut">
                {draftChannels.length ? `${channelsLabel(draftChannels)} · podés sumar más` : "Podés elegir uno o varios"}
              </p>
            </fieldset>

            {/* por empleado */}
            <fieldset>
              {/* El `legend` tiene que ser el primer hijo del fieldset para
                  nombrar el grupo; el título visible va aparte por el layout. */}
              <legend className="sr-only">Resumen por empleado</legend>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium" aria-hidden>
                    Resumen por empleado
                  </div>
                  <p className="mt-0.5 text-[11px] text-mut">
                    {ownOnly
                      ? `Ves solo las ventas registradas por tu cuenta${sellerName ? ` (${sellerName})` : ""}.`
                      : "Solo las ventas registradas por una cuenta."}
                  </p>
                </div>
                {!ownOnly && (
                  <Toggle on={perEmployee} onChange={setPerEmployee} label="Resumen por empleado" />
                )}
              </div>
              {perEmployee && !ownOnly && (
                <div className="mt-3">
                  <Dropdown
                    label="CUENTA"
                    value={selectedSeller?.label ?? "Elegí una cuenta"}
                    options={sellerOptions.map((o) => o.label)}
                    onChange={(label) =>
                      setDraftSeller(sellerOptions.find((o) => o.label === label)?.id ?? null)
                    }
                  />
                </div>
              )}
            </fieldset>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-line px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <span className={cn("mono text-[11px]", dirty ? "text-acc" : "text-mut")} aria-live="polite">
            {needsSeller
              ? "Elegí una cuenta para el resumen por empleado"
              : dirty
                ? "Hay cambios sin aplicar"
                : "La vista previa está al día"}
          </span>
          <button type="submit" className={btnCls("primary", "w-full sm:w-auto")} disabled={!canApply}>
            {pending ? "Generando…" : "Generar vista previa"}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Pill({
  active,
  onClick,
  children,
  checkbox,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Opción de selección múltiple: se anuncia como casilla y lleva tilde. */
  checkbox?: boolean;
}) {
  return (
    <button
      type="button"
      role={checkbox ? "checkbox" : undefined}
      aria-checked={checkbox ? active : undefined}
      aria-pressed={checkbox ? undefined : active}
      onClick={onClick}
      className={cn(
        "mono inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] transition-colors",
        active ? "bg-acc text-white" : "border border-line2 text-ink2 hover:border-ink/40",
      )}
    >
      {checkbox && active && (
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M2.5 6.2 5 8.5l4.5-5" />
        </svg>
      )}
      {children}
    </button>
  );
}

/**
 * Descarga de un export. Va por `fetch` y no con `<a download>` por dos cosas
 * que el link no puede hacer: si la API responde error (sesión vencida, 403,
 * 500), el link guardaba un archivo con el JSON del error como si fuera el
 * reporte; y el aviso de detalle truncado viaja en un header que nadie veía.
 */
function DownloadButton({
  href,
  fallbackName,
  variant = "ghost",
  children,
}: {
  href: string;
  fallbackName: string;
  variant?: "dark" | "ghost";
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(href, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error("No se pudo descargar el reporte", {
          description: body?.error ?? `El servidor respondió ${res.status}.`,
        });
        return;
      }
      const blob = await res.blob();
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revocar en el mismo tick puede cortar la descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (res.headers.get("X-Report-Truncated")) {
        toast.warning("El detalle salió incompleto", {
          description: "El período tiene más compras de las que entran en un export. Acotá el rango.",
        });
      }
    } catch {
      toast.error("No se pudo descargar el reporte", { description: "Revisá la conexión y probá de nuevo." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      aria-busy={busy}
      className={btnCls(variant, "h-9 px-4 text-[12px] disabled:opacity-60")}
    >
      <Download className="h-3.5 w-3.5" /> {busy ? "Generando…" : children}
    </button>
  );
}

// ---------- calendario ----------

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-mut" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
    </svg>
  );
}

function DateBox({ label, value }: { label: string; value: string }) {
  return (
    <span className="block">
      <span className="mono block text-[10px] text-mut">{label}</span>
      <span className="mt-2 flex h-11 items-center justify-between rounded-lg border border-line2 px-3.5 text-[13px] text-ink2 hover:border-ink/40">
        {dayLabel(value)}
        <CalendarGlyph />
      </span>
    </span>
  );
}

function DateRangePicker({
  from,
  to,
  mode,
  today,
  onChange,
}: {
  from: string;
  to: string;
  mode: RangeMode;
  today: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <Popover
      triggerClass="block w-full max-w-[420px] text-left"
      panelClass="w-[300px] p-3"
      triggerLabel={`Rango: ${formatRangeLabel(from, to)}. Abrir calendario`}
      trigger={
        <span className="grid grid-cols-2 gap-3">
          <DateBox label="DESDE" value={from} />
          <DateBox label="HASTA" value={to} />
        </span>
      }
    >
      {(close) => (
        <RangeCalendar from={from} to={to} mode={mode} today={today} onChange={onChange} close={close} />
      )}
    </Popover>
  );
}

const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const monthTitleFmt = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Calendario de un mes. Con un preset, un clic marca el inicio y el fin se
 * completa con la forma del preset (ver `rangeFromStart`). En "Personalizado"
 * son dos clics: inicio y fin, en cualquier orden.
 */
function RangeCalendar({
  from,
  to,
  mode,
  today,
  onChange,
  close,
}: {
  from: string;
  to: string;
  mode: RangeMode;
  today: string;
  onChange: (from: string, to: string) => void;
  close: () => void;
}) {
  const [view, setView] = useState(to.slice(0, 7));
  const [awaitingEnd, setAwaitingEnd] = useState(false);

  const [y, m] = view.split("-").map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${view}-${String(i + 1).padStart(2, "0")}`),
  ];
  const shift = (n: number) => setView(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));

  function pick(day: string) {
    if (mode === "libre") {
      if (!awaitingEnd) {
        onChange(day, day);
        setAwaitingEnd(true);
        return;
      }
      onChange(day < from ? day : from, day < from ? from : day);
      setAwaitingEnd(false);
      close();
      return;
    }
    const [a, b] = rangeFromStart(mode, day, today);
    onChange(a, b);
    close();
  }

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          onClick={() => shift(-1)}
          className="grid h-8 w-8 place-items-center rounded-md text-ink2 hover:bg-panel"
          aria-label="Mes anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-[13px] font-medium capitalize">
          {monthTitleFmt.format(new Date(Date.UTC(y, m - 1, 1)))}
        </div>
        <button
          type="button"
          onClick={() => shift(1)}
          className="grid h-8 w-8 place-items-center rounded-md text-ink2 hover:bg-panel"
          aria-label="Mes siguiente"
        >
          <ChevronLeft className="h-4 w-4 rotate-180" />
        </button>
      </div>

      <div className="mono grid grid-cols-7 text-center text-[9px] text-mut">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} />;
          const edge = day === from || day === to;
          const inRange = day > from && day < to;
          return (
            <button
              key={day}
              type="button"
              onClick={() => pick(day)}
              aria-label={dayLabel(day)}
              aria-pressed={edge || inRange}
              className={cn(
                "h-9 rounded-md text-[12px] tabular-nums transition-colors",
                edge ? "bg-acc font-medium text-white" : inRange ? "bg-panel text-ink" : "text-ink2 hover:bg-panel",
                day === today && !edge && "ring-1 ring-inset ring-line2",
                day > today && !edge && !inRange && "text-mut2",
              )}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>

      <p className="mono mt-2 border-t border-line px-1 pt-2 text-[10px] text-mut">
        {mode === "libre"
          ? awaitingEnd
            ? "Ahora elegí la fecha de fin"
            : "Elegí la fecha de inicio"
          : "Elegí el inicio: el fin se completa solo"}
      </p>
    </div>
  );
}

// ---------- vista previa ----------

const longDayFmt = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/**
 * Tres datos sueltos que no entran en una tabla: qué se vendió más, qué día se
 * vendió más y qué quedó pendiente de entregar. Todos respetan los filtros.
 */
function IncomeSummaryCard({ data }: { data: SalesKpis }) {
  const brandShare = data.grossProductAmount - data.totalAmount;
  const items = [
    { label: "Ventas brutas · productos", value: data.grossProductAmount },
    { label: "Ingreso Sadaels · productos", value: data.totalAmount },
    { label: "Envíos cobrados · aparte", value: data.shippingAmount },
    { label: "Otras marcas · venta bruta", value: data.otherBrandGrossAmount },
    { label: "Otras marcas · ingreso Sadaels", value: data.otherBrandAmount },
  ];

  return (
    <Card className="mt-6 px-6 py-6">
      <div className="mono text-[11px] text-mut">Ingreso Sadaels · todos los canales y vendedores</div>
      <p className="mt-2 text-[12px] leading-relaxed text-mut">
        Ventas brutas de productos {fmtARS(data.grossProductAmount)} {brandShare < 0 ? "+" : "−"}
        {" "}{fmtARS(Math.abs(brandShare))} de parte de otras marcas = {fmtARS(data.totalAmount)} para Sadaels.
        Los envíos se muestran aparte.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-5 border-t border-line pt-5 md:grid-cols-3">
        {items.map((item) => (
          <div key={item.label}>
            <div className="mono text-[10px] text-mut">{item.label}</div>
            <div className="mt-1 font-serif text-[21px] leading-none">{fmtARS(item.value)}</div>
          </div>
        ))}
      </div>
      {data.otherBrandUnmappedAmount !== 0 && (
        <p className="mono mt-5 text-[10px] text-mut">
          Otras marcas sin tasa: {fmtARS(data.otherBrandUnmappedAmount)} ya incluidos al 100% en ingreso Sadaels.
        </p>
      )}
    </Card>
  );
}

function HighlightsCard({ highlights, totals }: { highlights: ReportHighlights; totals: ReportTotals }) {
  const [top, ...rest] = highlights.topItems;
  const best = highlights.bestDay;
  const cell = (i: number) =>
    cn("px-6 py-6", i > 0 && "border-t border-line md:border-t-0 md:border-l");

  return (
    <Card className="mt-8">
      <div className="grid grid-cols-1 md:grid-cols-3">
        <div className={cell(0)}>
          <div className="mono text-[11px] text-mut">Ítem más vendido</div>
          {top ? (
            <>
              <div className="mt-2 font-serif text-[24px] leading-tight tracking-tight">{top.name}</div>
              <div className="mono mt-2 text-[11px] text-mut">
                {plural(top.units, "unidad", "unidades")} · {fmtARS(top.amount)}
              </div>
              {rest.length > 0 && (
                <ol className="mt-4 space-y-1.5 border-t border-line pt-3 text-[12px]">
                  {rest.map((it, i) => (
                    <li key={`${it.name}-${i}`} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-ink2">
                        <span className="mono mr-1.5 text-[10px] text-mut">{i + 2}</span>
                        {it.name}
                      </span>
                      <span className="mono shrink-0 text-[10px] text-mut">{it.units} u</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            <p className="mt-2 text-[13px] text-mut">Sin prendas vendidas en el período.</p>
          )}
        </div>

        <div className={cell(1)}>
          <div className="mono text-[11px] text-mut">Día con mayores ventas</div>
          {best ? (
            <>
              <div className="mt-2 font-serif text-[24px] leading-tight tracking-tight first-letter:uppercase">
                {longDayFmt.format(new Date(`${best.day}T00:00:00Z`))}
              </div>
              <div className="mono mt-2 text-[11px] text-mut">
                {fmtARS(best.amount)} · {plural(best.operations, "operación", "operaciones")}
              </div>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-mut">Sin ventas en el período.</p>
          )}
        </div>

        <div className={cell(2)}>
          <div className="mono text-[11px] text-mut">Entregas pendientes</div>
          <div
            className={cn(
              "mt-2 font-serif text-[24px] leading-tight tracking-tight",
              totals.pendingDelivery > 0 && "text-acc",
            )}
          >
            {totals.pendingDelivery}
          </div>
          <div className="mono mt-2 text-[11px] text-mut">
            {totals.pendingDelivery ? "compras sin marcar entregadas" : "todo entregado"}
          </div>
          {totals.returnedCount > 0 && (
            <div className="mono mt-4 border-t border-line pt-3 text-[11px] text-mut">
              Devuelto: {plural(totals.returnedUnits, "unidad", "unidades")} · {fmtARS(totals.returnedAmount)}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function SectionHead({ title, description }: { title: string; description: string }) {
  return (
    <div className="max-w-[640px] px-6 pt-6">
      <div className="mono text-[11px] text-mut">{title}</div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-mut">{description}</p>
    </div>
  );
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-6 mt-6 mb-6 grid min-h-[160px] place-items-center rounded-[4px] border border-dashed border-line px-6 text-center">
      <div>
        <div className="font-serif text-[20px]">{title}</div>
        <p className="mono mt-2 text-[11px] text-mut">{children}</p>
      </div>
    </div>
  );
}

const th = "border-b border-line py-2.5 pr-4 font-normal";
const td = "py-3 pr-4 align-top tabular-nums";

function ShareBar({ pct, muted }: { pct: number; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className={cn("h-full rounded-full", muted ? "bg-mut2" : "bg-acc")} style={{ width: `${pct}%` }} />
      </div>
      <span className="mono text-[11px] text-mut">{pct}%</span>
    </div>
  );
}

function SalesAmount({ totals, empty = false }: { totals: ReportTotals; empty?: boolean }) {
  if (empty) return <>—</>;
  return (
    <>
      <div className="text-[14px] font-medium text-ink">{fmtARS(totals.income)}</div>
      <div className="mono mt-1 text-[9px] font-normal uppercase tracking-wide text-mut">
        Venta bruta {fmtARS(totals.gross)}
        {totals.shipping !== 0 ? ` · Envíos ${fmtARS(totals.shipping)}` : ""}
      </div>
    </>
  );
}

function ChannelTable({ rows, selected }: { rows: ChannelSummary[]; selected: SaleChannel[] }) {
  const all = rows.reduce((s, r) => s + r.income, 0);
  const hint = Object.fromEntries(SALE_CHANNELS.map((c) => [c.value, c.hint]));
  const showChanges = rows.some((r) => r.returnedCount > 0 || r.exchangedCount > 0);
  return (
    <div className="mt-5 overflow-x-auto px-6 pb-6">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="mono text-[10px] text-mut">
          <tr>
            <th className={th}>Canal</th>
            <th className={cn(th, "text-right")}>Ingreso Sadaels</th>
            <th className={th}>Participación</th>
            <th className={cn(th, "text-right")}>Operac.</th>
            <th className={cn(th, "text-right")}>Unidades</th>
            <th className={cn(th, "text-right")}>Ticket prom.</th>
            <th className={cn(th, "text-right")}>Pend. entrega</th>
            {showChanges && <th className={cn(th, "text-right")}>Cambios</th>}
            {showChanges && <th className={cn(th, "text-right")}>Devol.</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // Con canales elegidos se ven los cuatro igual, pero los otros
            // quedan atenuados: no suman en los totales de arriba.
            const dimmed = selected.length > 0 && !selected.includes(r.channel);
            return (
              <tr key={r.channel} className={cn("border-b border-line transition-opacity", dimmed && "opacity-40")}>
                <td className="py-3 pr-4 align-top">
                  <div className="font-medium">{CHANNEL_LABEL[r.channel]}</div>
                  <div className="mono mt-0.5 text-[10px] text-mut">{hint[r.channel]}</div>
                </td>
                <td className={cn(td, "text-right")}>
                  <SalesAmount totals={r} empty={!r.operations && !r.gross && !r.income} />
                </td>
                <td className={td}>
                  <ShareBar pct={sharePct(r.income, all)} />
                </td>
                <td className={cn(td, "text-right")}>{r.operations}</td>
                <td className={cn(td, "text-right")}>{r.units}</td>
                <td className={cn(td, "text-right")}>
                  {r.operations ? fmtARS(Math.round(r.total / r.operations)) : "—"}
                </td>
                <td className={cn(td, "text-right", r.pendingDelivery > 0 && "text-acc")}>{r.pendingDelivery}</td>
                {showChanges && <td className={cn(td, "text-right")}>{r.exchangedCount || "—"}</td>}
                {showChanges && <td className={cn(td, "text-right")}>{r.returnedCount || "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SellerTable({
  rows,
  totals,
  hrefFor,
}: {
  rows: SellerSummary[];
  totals: ReportTotals;
  hrefFor: (sellerId: string) => string;
}) {
  const showChanges = rows.some((r) => r.returnedCount > 0 || r.exchangedCount > 0);
  return (
    <div className="mt-5 overflow-x-auto px-6 pb-6">
      <table className="w-full min-w-[680px] text-left text-[13px]">
        <thead className="mono text-[10px] text-mut">
          <tr>
            <th className={th}>Vendedor</th>
            <th className={cn(th, "text-right")}>Ingreso Sadaels</th>
            <th className={th}>Participación</th>
            <th className={cn(th, "text-right")}>Operac.</th>
            <th className={cn(th, "text-right")}>Unidades</th>
            <th className={cn(th, "text-right")}>Ticket prom.</th>
            <th className={cn(th, "text-right")}>Pend. entrega</th>
            {showChanges && <th className={cn(th, "text-right")}>Cambios</th>}
            {showChanges && <th className={cn(th, "text-right")}>Devol.</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const unassigned = !r.sellerId;
            return (
              <tr key={r.sellerId ?? "sin-vendedor"} className="border-b border-line">
                <td className="py-3 pr-4 align-top">
                  <div className={cn("font-medium", unassigned && "text-ink2")}>{sellerLabel(r)}</div>
                  {r.sellerId ? (
                    <Link
                      href={hrefFor(r.sellerId)}
                      scroll={false}
                      className="mono mt-0.5 inline-block text-[10px] text-mut hover:text-acc"
                    >
                      Ver resumen →
                    </Link>
                  ) : (
                    <div className="mono mt-0.5 text-[10px] text-mut">pedidos web sin reclamar</div>
                  )}
                </td>
                <td className={cn(td, "text-right")}>
                  <SalesAmount totals={r} />
                </td>
                <td className={td}>
                  <ShareBar pct={sharePct(r.income, totals.income)} muted={unassigned} />
                </td>
                <td className={cn(td, "text-right")}>{r.operations}</td>
                <td className={cn(td, "text-right")}>{r.units}</td>
                <td className={cn(td, "text-right")}>
                  {r.operations ? fmtARS(Math.round(r.total / r.operations)) : "—"}
                </td>
                <td className={cn(td, "text-right", r.pendingDelivery > 0 && "text-acc")}>{r.pendingDelivery}</td>
                {showChanges && <td className={cn(td, "text-right")}>{r.exchangedCount || "—"}</td>}
                {showChanges && <td className={cn(td, "text-right")}>{r.returnedCount || "—"}</td>}
              </tr>
            );
          })}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="font-medium">
              <td className="py-3 pr-4">Total</td>
              <td className={cn(td, "text-right")}>
                <SalesAmount totals={totals} />
              </td>
              <td className={td} />
              <td className={cn(td, "text-right")}>{totals.operations}</td>
              <td className={cn(td, "text-right")}>{totals.units}</td>
              <td className={cn(td, "text-right")}>
                {totals.operations ? fmtARS(Math.round(totals.total / totals.operations)) : "—"}
              </td>
              <td className={cn(td, "text-right")}>{totals.pendingDelivery}</td>
              {showChanges && <td className={cn(td, "text-right")}>{totals.exchangedCount}</td>}
              {showChanges && <td className={cn(td, "text-right")}>{totals.returnedCount}</td>}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
