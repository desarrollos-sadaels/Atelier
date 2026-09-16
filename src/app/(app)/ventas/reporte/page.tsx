import { getSalesKpis, formatARS, lastDaysRangeART } from "@/lib/queries";
import { ReporteClient } from "./ReporteClient";

export default async function ReportePage() {
  // Comparte el rango [inicio, fin) en Buenos Aires con el gráfico del dashboard.
  const { start, end } = lastDaysRangeART(30);
  const lastDay = new Date(Date.parse(`${end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const periodLabel = `${start.slice(8, 10)}/${start.slice(5, 7)}/${start.slice(0, 4)} al ${lastDay.slice(8, 10)}/${lastDay.slice(5, 7)}/${lastDay.slice(0, 4)}`;
  const k = await getSalesKpis(start, end);
  const hasSales = k.operations > 0 || k.totalAmount !== 0 || k.returnedCount > 0;

  const summary = [
    { k: "Ventas brutas · productos", v: hasSales ? formatARS(k.grossProductAmount) : "—" },
    { k: "Ingreso Sadaels · productos", v: hasSales ? formatARS(k.totalAmount) : "—", acc: hasSales },
    { k: "Envíos", v: hasSales ? formatARS(k.shippingAmount) : "—" },
    { k: "Otras marcas · venta bruta", v: hasSales ? formatARS(k.otherBrandGrossAmount) : "—" },
    { k: "Otras marcas · ingreso Sadaels", v: hasSales ? formatARS(k.otherBrandAmount) : "—" },
    ...(k.otherBrandUnmappedAmount !== 0
      ? [{ k: "Otras marcas · sin tasa (100% Sadaels)", v: formatARS(k.otherBrandUnmappedAmount) }]
      : []),
    { k: "Unidades", v: hasSales ? String(k.units) : "—" },
    { k: "Operaciones", v: hasSales ? String(k.operations) : "—" },
    {
      k: "Ingreso prom.",
      v: k.operations > 0 ? formatARS(Math.round(k.totalAmount / k.operations)) : "—",
    },
  ];

  return <ReporteClient summary={summary} hasSales={hasSales} periodLabel={periodLabel} />;
}
