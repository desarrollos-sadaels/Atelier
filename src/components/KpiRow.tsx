import { cn } from "@/lib/cn";

type Kpi = { label: string; value: string; sub: string; alert?: boolean };

export function KpiRow({ items }: { items: Kpi[] }) {
  return (
    <>
      <div className="grid grid-cols-2 border-t border-line md:grid-cols-4">
        {items.map((k, i) => (
          <div
            key={k.label}
            className={cn("py-6 pr-7", i > 0 && "md:border-l md:border-line md:pl-7")}
          >
            <div className="mono text-[11px] text-mut">{k.label}</div>
            <div
              className={cn(
                "mt-1 font-serif text-[40px] leading-none tracking-tight",
                k.alert && "text-acc",
              )}
            >
              {k.value}
            </div>
            <div className="mt-4 text-[12px] text-mut">{k.sub}</div>
          </div>
        ))}
      </div>
      <div className="hair" />
    </>
  );
}
