import "server-only";
import { getSalesKpis, type SalesKpis } from "@/lib/queries";
import { getReportHighlights, getSalesBreakdown } from "@/lib/reports";
import {
  EMPTY_HIGHLIGHTS,
  filterBreakdown,
  groupByChannel,
  groupBySeller,
  sumTotals,
  type BreakdownRow,
  type ChannelSummary,
  type ReportHighlights,
  type ReportRange,
  type ReportTotals,
  type SaleChannel,
  type SellerSummary,
} from "@/lib/sales-report";

export type SalesReportData = {
  /** Las filas sin filtrar: para resolver nombres de cuentas. */
  rows: BreakdownRow[];
  totals: ReportTotals;
  byChannel: ChannelSummary[];
  bySeller: SellerSummary[];
  highlights: ReportHighlights;
  /** Solo cuando el alcance es todos los canales y vendedores. */
  incomeSummary: SalesKpis | null;
  error: string | null;
};

/**
 * Todo lo que muestra el reporte, ya filtrado por canales y cuenta.
 *
 * Existe para que la página y el PDF no armen los números cada uno por su lado:
 * con dos copias de estos filtros, el PDF descargado terminaba diciendo algo
 * distinto de la vista previa en cuanto una de las dos cambiaba.
 *
 * `blocked` es el vendedor sin perfil resuelto: no tiene "lo suyo", y mostrarle
 * todo sería fallar abierto.
 */
export async function loadSalesReport(
  range: Pick<ReportRange, "start" | "end">,
  opts: { channels: SaleChannel[]; sellerId: string | null; blocked?: boolean },
): Promise<SalesReportData> {
  if (opts.blocked) {
    return {
      rows: [],
      totals: sumTotals([]),
      byChannel: groupByChannel([]),
      bySeller: [],
      highlights: EMPTY_HIGHLIGHTS,
      incomeSummary: null,
      error: null,
    };
  }

  const [report, highlights, incomeSummary] = await Promise.all([
    getSalesBreakdown(range.start, range.end),
    getReportHighlights(range.start, range.end, opts),
    opts.channels.length === 0 && !opts.sellerId
      ? getSalesKpis(range.start, range.end)
      : Promise.resolve(null),
  ]);
  const scoped = filterBreakdown(report.rows, opts);

  return {
    rows: report.rows,
    totals: sumTotals(scoped),
    // Por canal ignora el filtro de canal a propósito: se ven los cuatro y se
    // resaltan los elegidos, así se entiende qué parte del total son.
    byChannel: groupByChannel(filterBreakdown(report.rows, { sellerId: opts.sellerId })),
    bySeller: groupBySeller(scoped),
    highlights,
    incomeSummary,
    error: report.error,
  };
}
