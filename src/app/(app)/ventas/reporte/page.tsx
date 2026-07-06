import { getSales, salesKpis, formatARS } from "@/lib/queries";
import { ReporteClient } from "./ReporteClient";

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function ReportePage() {
  // Vista previa: ventas de los últimos ~30 días (mes actual + anterior filtrado).
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);

  const [cur, last] = await Promise.all([getSales(monthKey(now)), getSales(monthKey(prev))]);
  const rows = [...cur, ...last].filter((r) => new Date(`${r.sold_at}T00:00:00`) >= cutoff);
  const k = salesKpis(rows);

  const summary = [
    { k: "Ventas", v: rows.length ? formatARS(k.totalAmount) : "—", acc: rows.length > 0 },
    { k: "Unidades", v: rows.length ? String(k.units) : "—" },
    { k: "Operaciones", v: rows.length ? String(rows.length) : "—" },
    {
      k: "Ticket prom.",
      v: rows.length ? formatARS(Math.round(k.totalAmount / rows.length)) : "—",
    },
  ];

  return <ReporteClient summary={summary} hasSales={rows.length > 0} />;
}
