import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { KpiRow } from "@/components/KpiRow";
import { btnCls } from "@/components/ui";
import { Plus } from "@/components/icons";
import { getCurrentProfile, getSales, salesKpis, formatARS } from "@/lib/queries";
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
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(mes ?? "") ? (mes as string) : currentMonth();
  const [profile, rows] = await Promise.all([getCurrentProfile(), getSales(month)]);
  const role = profile?.role ?? "admin";
  const k = salesKpis(rows);

  const [y, m] = month.split("-").map(Number);
  const monthLabel = MONTH_LABEL.format(new Date(y, m - 1, 1));

  const kpis = [
    { label: "Ventas del mes", value: formatARS(k.totalAmount), sub: "con descuentos aplicados" },
    { label: "Unidades", value: String(k.units), sub: `${rows.length} operaciones` },
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
        rows={rows}
        role={role}
        monthLabel={monthLabel}
        prevMonth={shiftMonth(month, -1)}
        nextMonth={shiftMonth(month, 1)}
      />
    </>
  );
}
