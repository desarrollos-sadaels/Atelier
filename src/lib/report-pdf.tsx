import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { SalesKpis } from "@/lib/queries";
import {
  CHANNEL_LABEL,
  SALE_CHANNELS,
  channelsLabel,
  formatRangeLabel,
  sellerLabel,
  sharePct,
  type ChannelSummary,
  type ReportHighlights,
  type ReportRange,
  type ReportTotals,
  type SaleChannel,
  type SellerSummary,
} from "@/lib/sales-report";

/**
 * El reporte de ventas como PDF: la misma vista previa, en A4.
 *
 * Se genera en el server con @react-pdf/renderer y no con `window.print()`
 * porque tiene que ser un archivo que se descarga, igual para todos: imprimir
 * desde el navegador depende del diálogo, de los márgenes y del zoom de cada
 * uno, y parte las tablas donde cae.
 *
 * Usa las fuentes estándar de PDF (Helvetica), que no hay que embeber ni bajar
 * de ningún lado. Codifican WinAnsi: los acentos y la ñ entran, pero los
 * espacios angostos que mete `Intl` en los montos no — ver `clean`.
 */

const ACC = "#e2342b";
const INK = "#141414";
const MUT = "#7a7775";
const LINE = "#e4e1dc";
const PANEL = "#f5f3ef";

/** `Intl` separa "$" del número con un espacio no separable que Helvetica dibuja como un glifo roto. */
const clean = (s: string) => s.replace(/[  ]/g, " ");

const arsFmt = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const money = (n: number) => clean(arsFmt.format(n));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ticket = (t: ReportTotals) => (t.operations ? money(Math.round(t.total / t.operations)) : "—");

const longDayFmt = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const stampFmt = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

const s = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 52,
    paddingHorizontal: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: INK,
  },
  brand: { fontSize: 7.5, color: MUT, letterSpacing: 1.2 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 22, marginTop: 6 },
  meta: { fontSize: 9, color: MUT, marginTop: 5 },
  scope: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 10 },
  kpis: {
    flexDirection: "row",
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: INK,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },
  kpi: { flex: 1, paddingVertical: 10, paddingRight: 8 },
  kpiDivider: { borderLeftWidth: 1, borderLeftColor: LINE, paddingLeft: 10 },
  label: { fontSize: 7.5, color: MUT },
  kpiValue: { fontFamily: "Helvetica-Bold", fontSize: 15, marginTop: 4 },
  sub: { fontSize: 7.5, color: MUT, marginTop: 4 },
  cards: { flexDirection: "row", gap: 8, marginTop: 12 },
  card: { flex: 1, backgroundColor: PANEL, padding: 10, borderRadius: 3 },
  cardValue: { fontFamily: "Helvetica-Bold", fontSize: 12, marginTop: 4 },
  rankRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 3 },
  section: { marginTop: 22 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 10.5 },
  sectionNote: { fontSize: 7.5, color: MUT, marginTop: 3, marginBottom: 8 },
  table: { borderTopWidth: 1, borderTopColor: INK },
  headRow: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: LINE },
  row: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: LINE },
  totalRow: { flexDirection: "row", paddingVertical: 6, fontFamily: "Helvetica-Bold" },
  th: { fontSize: 7, color: MUT },
  cellSub: { fontSize: 7, color: MUT, marginTop: 1.5 },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: MUT,
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 6,
  },
});

// ---------- tabla ----------

/** Anchos relativos: primera columna (nombre) y las ocho de números. */
const FLEX = [2.3, 1.4, 0.55, 0.75, 0.7, 1.2, 0.65, 0.75, 0.65];
const HEADS = ["Ventas", "%", "Operac.", "Unid.", "Ticket prom.", "Pend.", "Cambios", "Devol."];

type TableRow = { key: string; label: string; sub?: string; cells: string[]; dim?: boolean };

function metricCells(t: ReportTotals, share: number): string[] {
  return [
    money(t.total),
    `${share}%`,
    String(t.operations),
    String(t.units),
    ticket(t),
    String(t.pendingDelivery),
    String(t.exchangedCount),
    String(t.returnedCount),
  ];
}

function Table({ first, rows, total }: { first: string; rows: TableRow[]; total?: string[] }) {
  return (
    <View style={s.table}>
      <View style={s.headRow} fixed>
        <Text style={[s.th, { flex: FLEX[0] }]}>{first}</Text>
        {HEADS.map((h, i) => (
          <Text key={h} style={[s.th, { flex: FLEX[i + 1], textAlign: "right" }]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((r) => (
        // `wrap={false}`: una fila nunca se parte entre dos páginas.
        <View key={r.key} style={[s.row, r.dim ? { opacity: 0.4 } : {}]} wrap={false}>
          <View style={{ flex: FLEX[0], paddingRight: 6 }}>
            <Text>{r.label}</Text>
            {r.sub ? <Text style={s.cellSub}>{r.sub}</Text> : null}
          </View>
          {r.cells.map((c, i) => (
            <Text key={i} style={{ flex: FLEX[i + 1], textAlign: "right" }}>
              {c}
            </Text>
          ))}
        </View>
      ))}
      {total ? (
        <View style={s.totalRow} wrap={false}>
          <Text style={{ flex: FLEX[0] }}>Total</Text>
          {total.map((c, i) => (
            <Text key={i} style={{ flex: FLEX[i + 1], textAlign: "right" }}>
              {c}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------- documento ----------

export type SalesReportPdfInput = {
  range: ReportRange;
  channels: SaleChannel[];
  /** null = todas las cuentas. */
  sellerName: string | null;
  totals: ReportTotals;
  byChannel: ChannelSummary[];
  bySeller: SellerSummary[];
  highlights: ReportHighlights;
  incomeSummary: SalesKpis | null;
  generatedAt: Date;
};

function SalesReportDocument({
  range,
  channels,
  sellerName,
  totals,
  byChannel,
  bySeller,
  highlights,
  incomeSummary,
  generatedAt,
}: SalesReportPdfInput) {
  const employeeMode = sellerName !== null;
  const changes = totals.returnedCount + totals.exchangedCount;
  const [top, ...rest] = highlights.topItems;
  const best = highlights.bestDay;
  const channelTotal = byChannel.reduce((sum, r) => sum + r.total, 0);
  const hint = Object.fromEntries(SALE_CHANNELS.map((c) => [c.value, c.hint]));
  const brandShare = incomeSummary ? incomeSummary.grossProductAmount - incomeSummary.totalAmount : 0;

  const kpis = [
    { label: "Ventas cobradas", value: totals.operations || totals.total ? money(totals.total) : "—", sub: `${channelsLabel(channels)} · productos y envíos` },
    { label: "Operaciones", value: String(totals.operations), sub: plural(totals.units, "unidad", "unidades") },
    { label: "Ticket promedio", value: ticket(totals), sub: "ventas / operaciones" },
    {
      label: "Cambios y devoluciones",
      value: String(changes),
      sub: `${plural(totals.exchangedCount, "cambio", "cambios")} · ${plural(totals.returnedCount, "devolución", "devoluciones")}`,
      alert: changes > 0,
    },
  ];

  return (
    <Document title="Reporte de ventas" author="Atelier · SADAELS" language="es-AR">
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>ATELIER · SADAELS</Text>
        <Text style={s.title}>Reporte de ventas</Text>
        <Text style={s.meta}>
          {formatRangeLabel(range.from, range.to)} · {plural(range.days, "día", "días")} · {channelsLabel(channels)}
        </Text>
        <Text style={s.scope}>{employeeMode ? `Resumen de ${sellerName}` : "Todas las cuentas"}</Text>

        <View style={s.kpis}>
          {kpis.map((k, i) => (
            <View key={k.label} style={[s.kpi, i > 0 ? s.kpiDivider : {}]}>
              <Text style={s.label}>{k.label}</Text>
              <Text style={[s.kpiValue, k.alert ? { color: ACC } : {}]}>{k.value}</Text>
              <Text style={s.sub}>{k.sub}</Text>
            </View>
          ))}
        </View>

        {incomeSummary ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Ingreso Sadaels · productos</Text>
            <Text style={s.sectionNote}>
              Ventas brutas de productos {money(incomeSummary.grossProductAmount)}{" "}
              {brandShare < 0 ? "+" : "−"} parte de otras marcas {money(Math.abs(brandShare))} = ingreso Sadaels{" "}
              {money(incomeSummary.totalAmount)}. Los envíos van aparte.
            </Text>
            <View style={s.cards}>
              <View style={s.card}>
                <Text style={s.label}>Ventas brutas · productos</Text>
                <Text style={s.cardValue}>{money(incomeSummary.grossProductAmount)}</Text>
              </View>
              <View style={s.card}>
                <Text style={s.label}>Ingreso Sadaels · productos</Text>
                <Text style={s.cardValue}>{money(incomeSummary.totalAmount)}</Text>
              </View>
              <View style={s.card}>
                <Text style={s.label}>Envíos cobrados · aparte</Text>
                <Text style={s.cardValue}>{money(incomeSummary.shippingAmount)}</Text>
              </View>
            </View>
            <Text style={s.sectionNote}>
              Otras marcas: {money(incomeSummary.otherBrandGrossAmount)} brutos;{" "}
              {money(incomeSummary.otherBrandAmount)} para Sadaels.
              {incomeSummary.otherBrandUnmappedAmount !== 0
                ? ` ${money(incomeSummary.otherBrandUnmappedAmount)} sin tasa ya incluidos al 100%.`
                : ""}
            </Text>
          </View>
        ) : null}

        <View style={s.cards}>
          <View style={s.card}>
            <Text style={s.label}>Ítem más vendido</Text>
            {top ? (
              <>
                <Text style={s.cardValue}>{top.name}</Text>
                <Text style={s.sub}>
                  {plural(top.units, "unidad", "unidades")} · {money(top.amount)}
                </Text>
                {rest.map((it, i) => (
                  <View key={`${it.name}-${i}`} style={s.rankRow}>
                    <Text style={{ fontSize: 7.5 }}>
                      {i + 2}. {it.name}
                    </Text>
                    <Text style={{ fontSize: 7.5, color: MUT }}>{it.units} u</Text>
                  </View>
                ))}
              </>
            ) : (
              <Text style={s.sub}>Sin prendas vendidas en el período.</Text>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.label}>Día con mayores ventas</Text>
            {best ? (
              <>
                <Text style={s.cardValue}>{longDayFmt.format(new Date(`${best.day}T00:00:00Z`))}</Text>
                <Text style={s.sub}>
                  {money(best.amount)} · {plural(best.operations, "operación", "operaciones")}
                </Text>
              </>
            ) : (
              <Text style={s.sub}>Sin ventas en el período.</Text>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.label}>Entregas pendientes</Text>
            <Text style={[s.cardValue, totals.pendingDelivery > 0 ? { color: ACC } : {}]}>
              {totals.pendingDelivery}
            </Text>
            <Text style={s.sub}>
              {totals.pendingDelivery ? "compras sin marcar entregadas" : "todo entregado"}
            </Text>
            {totals.returnedCount > 0 ? (
              <Text style={s.sub}>
                Devuelto: {plural(totals.returnedUnits, "unidad", "unidades")} · {money(totals.returnedAmount)}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>{employeeMode ? "Por canal" : "Ventas por canal"}</Text>
          <Text style={s.sectionNote}>
            Mayoristas y Taller se cuentan aparte de Atelier: salen del punto de venta de cada compra.
            {channels.length ? " Los canales atenuados no suman en los totales." : ""}
          </Text>
          <Table
            first="Canal"
            rows={byChannel.map((r) => ({
              key: r.channel,
              label: CHANNEL_LABEL[r.channel],
              sub: hint[r.channel],
              cells: metricCells(r, sharePct(r.total, channelTotal)),
              dim: channels.length > 0 && !channels.includes(r.channel),
            }))}
          />
        </View>

        {!employeeMode && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Ventas por vendedor</Text>
            <Text style={s.sectionNote}>
              Cada compra cuenta para quien la tiene a su nombre. Los pedidos web sin reclamar quedan aparte.
            </Text>
            {bySeller.length ? (
              <Table
                first="Vendedor"
                rows={bySeller.map((r) => ({
                  key: r.sellerId ?? "sin-vendedor",
                  label: sellerLabel(r),
                  sub: r.sellerId ? undefined : "pedidos web sin reclamar",
                  cells: metricCells(r, sharePct(r.total, totals.total)),
                }))}
                total={bySeller.length > 1 ? metricCells(totals, totals.total > 0 ? 100 : 0) : undefined}
              />
            ) : (
              <Text style={s.sub}>Sin ventas en este período.</Text>
            )}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>Generado el {clean(stampFmt.format(generatedAt))} · Atelier</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderSalesReportPdf(input: SalesReportPdfInput): Promise<Uint8Array> {
  // Se llama como función y no como <SalesReportDocument />: `renderToBuffer`
  // tipa su argumento como el elemento <Document> mismo.
  const buffer = await renderToBuffer(SalesReportDocument(input));
  return new Uint8Array(buffer);
}
