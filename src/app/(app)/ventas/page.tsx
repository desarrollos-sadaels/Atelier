import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { KpiRow } from "@/components/KpiRow";
import { btnCls } from "@/components/ui";
import { Plus } from "@/components/icons";
import {
  getCurrentProfile,
  getSales,
  getSalesKpis,
  monthRange,
  formatARS,
  SALES_PAGE_SIZE,
} from "@/lib/queries";
import { VentasClient } from "./VentasClient";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_LABEL = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; q?: string; p?: string }>;
}) {
  const { mes, q, p } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(mes ?? "") ? (mes as string) : currentMonth();
  const search = (q ?? "").slice(0, 60);
  const page = Math.max(1, Number(p) || 1);
  const { start, end } = monthRange(month);

  // Los KPIs salen de una agregación en la base sobre el mes completo, así que
  // no dependen ni de la página ni de la búsqueda activa.
  const [profile, k, sales] = await Promise.all([
    getCurrentProfile(),
    getSalesKpis(start, end),
    getSales(start, end, { q: search, page }),
  ]);
  const role = profile?.role ?? "admin";

  const [y, m] = month.split("-").map(Number);
  const monthLabel = MONTH_LABEL.format(new Date(y, m - 1, 1));

  const kpis = [
    { label: "Ventas del mes", value: formatARS(k.totalAmount), sub: "con descuentos aplicados" },
    { label: "Unidades", value: String(k.units), sub: `${k.operations} operaciones` },
    {
      label: "Entregas pendientes",
      value: String(k.pendingDelivery),
      sub: "sin marcar entregado",
      alert: k.pendingDelivery > 0,
    },
    { label: "Otras marcas", value: String(k.otherBrandUnits), sub: "unidades en consignación" },
  ];

  return (
    <>
      <PageHeader
        kicker={`Ventas · ${monthLabel}`}
        title="Ventas"
        actions={
          <>
            <Link href="/ventas/reporte" className={btnCls("ghost")}>
              Reporte
            </Link>
            {role !== "medios" && (
              <Link href="/ventas/nueva" className={btnCls("primary")}>
                <Plus className="h-4 w-4" /> Registrar venta
              </Link>
            )}
          </>
        }
      />

      <div className="mt-8">
        <KpiRow items={kpis} />
      </div>

      <VentasClient
        rows={sales.rows}
        total={sales.total}
        page={page}
        pageSize={SALES_PAGE_SIZE}
        query={search}
        month={month}
        role={role}
        monthLabel={monthLabel}
        prevMonth={shiftMonth(month, -1)}
        nextMonth={shiftMonth(month, 1)}
      />
    </>
  );
}
