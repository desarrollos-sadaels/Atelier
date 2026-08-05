import { CardTitle } from "@/components/ui";
import type { DemographicRow } from "@/lib/meta/types";

const intFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

export function DemoBlock({ title, rows }: { title: string; rows: DemographicRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.reach));
  return (
    <div>
      <CardTitle>{title}</CardTitle>
      <div className="mt-4 space-y-2.5">
        {rows.length === 0 ? (
          <p className="px-6 text-[12px] text-mut">Sin datos.</p>
        ) : (
          rows.map((r) => (
            <div key={r.label} className="flex items-center gap-3">
              <span className="mono w-32 shrink-0 truncate text-[11px] text-ink2">{r.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel">
                <div
                  className="h-full rounded-full bg-acc"
                  style={{ width: `${Math.round((r.reach / max) * 100)}%` }}
                />
              </div>
              <span className="mono w-14 shrink-0 text-right text-[11px] text-mut">
                {intFmt.format(r.reach)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
