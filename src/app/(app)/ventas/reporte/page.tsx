import { getSalesKpis, formatARS } from "@/lib/queries";
import { ReporteClient } from "./ReporteClient";

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function ReportePage() {
  // Últimos 30 días. Antes esto traía las ventas de dos meses enteros y
  // filtraba en JavaScript; ahora el rango se resuelve en la base y vuelven
  // solo los agregados.
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  const end = new Date(now);
  end.setDate(end.getDate() + 1); // rango [inicio, fin), incluye hoy

  const k = await getSalesKpis(isoDate(start), isoDate(end));
  const hasSales = k.operations > 0;

  const summary = [
    { k: "Ventas", v: hasSales ? formatARS(k.totalAmount) : "—", acc: hasSales },
    { k: "Unidades", v: hasSales ? String(k.units) : "—" },
    { k: "Operaciones", v: hasSales ? String(k.operations) : "—" },
    {
      k: "Ticket prom.",
      v: hasSales ? formatARS(Math.round(k.totalAmount / k.operations)) : "—",
    },
  ];

  return <ReporteClient summary={summary} hasSales={hasSales} />;
}
