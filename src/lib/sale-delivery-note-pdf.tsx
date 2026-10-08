import "server-only";

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import {
  DELIVERY_STATE_LABEL,
  deliveryState,
  normalizeItemStatus,
  saleTotal,
  type RevenueItem,
  type SaleWithDiscount,
} from "@/lib/sales";

const INK = "#141414";
const MUTED = "#777370";
const LINE = "#dedbd6";
const PANEL = "#f5f3ef";
const ACCENT = "#e2342b";

const clean = (value: string) => value.replace(/[  ]/g, " ");
const moneyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
const money = (value: number) => clean(moneyFormatter.format(value));
const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

export type SaleDeliveryNoteItem = RevenueItem & {
  id: string;
  article: string;
  brand: string | null;
  color: string | null;
  talle: string | null;
  status: string;
};

export type SaleDeliveryNoteInput = {
  sale: SaleWithDiscount & {
    id: string;
    sold_at: string;
    customer_name: string | null;
    customer_dni: string | null;
    customer_contact: string | null;
    customer_address: string | null;
    seller_name: string | null;
    pos: string | null;
    payment_method: string | null;
    installments: number | null;
    notes: string | null;
    delivered: boolean;
    preorder: boolean;
    status: string;
    shopify_order_name: string | null;
    wholesale_store: string | null;
  };
  items: SaleDeliveryNoteItem[];
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 38,
    paddingBottom: 46,
    paddingHorizontal: 42,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: INK,
  },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { fontSize: 8, color: MUTED, letterSpacing: 1.6 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 26, marginTop: 7 },
  disclaimer: { fontSize: 7.5, color: MUTED, marginTop: 5 },
  referenceBox: { width: 170, borderWidth: 1, borderColor: INK, padding: 12 },
  referenceLabel: { fontSize: 7, color: MUTED },
  reference: { fontFamily: "Helvetica-Bold", fontSize: 13, marginTop: 4 },
  referenceDate: { fontSize: 8, marginTop: 7 },
  state: { color: ACCENT, fontFamily: "Helvetica-Bold", fontSize: 8, marginTop: 5 },
  infoGrid: { flexDirection: "row", gap: 10, marginTop: 24 },
  infoBox: { flex: 1, backgroundColor: PANEL, padding: 12, minHeight: 92 },
  sectionLabel: { fontSize: 7, color: MUTED, letterSpacing: 0.7, marginBottom: 7 },
  strong: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  infoLine: { fontSize: 8.5, marginTop: 4 },
  table: { marginTop: 24, borderTopWidth: 1, borderTopColor: INK },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 8 },
  headerRow: { paddingVertical: 6 },
  th: { fontSize: 7, color: MUTED },
  article: { flex: 3, paddingRight: 8 },
  detail: { flex: 2, paddingRight: 8 },
  qty: { width: 52, textAlign: "right" },
  status: { width: 70, textAlign: "right" },
  itemName: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  itemSub: { color: MUTED, fontSize: 7.5, marginTop: 2 },
  summary: { marginTop: 16, marginLeft: "auto", width: 245 },
  summaryLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  summaryLabel: { color: MUTED, fontSize: 8 },
  totalLine: { borderTopWidth: 1, borderTopColor: INK, marginTop: 4, paddingTop: 8 },
  totalLabel: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  totalValue: { fontFamily: "Helvetica-Bold", fontSize: 16 },
  notes: { marginTop: 22, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 10 },
  notesText: { fontSize: 8.5, lineHeight: 1.4 },
  signatures: { flexDirection: "row", gap: 42, marginTop: 42 },
  signature: { flex: 1, borderTopWidth: 1, borderTopColor: INK, paddingTop: 6, fontSize: 7.5, color: MUTED },
  footer: {
    position: "absolute",
    left: 42,
    right: 42,
    bottom: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 6,
    fontSize: 7,
    color: MUTED,
  },
});

function saleReference(sale: SaleDeliveryNoteInput["sale"]): string {
  return sale.shopify_order_name?.trim() || sale.id.slice(0, 8).toUpperCase();
}

function itemStatus(status: string): string {
  const normalized = normalizeItemStatus(status);
  if (normalized === "returned") return "Devuelta";
  if (normalized === "exchanged") return "Cambiada";
  return "Activa";
}

function SaleDeliveryNoteDocument({ sale, items }: SaleDeliveryNoteInput) {
  const reference = saleReference(sale);
  const units = items.reduce((sum, item) => sum + item.qty, 0);
  const total = saleTotal(sale, items);
  const shipping = Number(sale.shipping_amount) || 0;
  const discount = Number(sale.sale_discount) || 0;

  return (
    <Document title={`Remito ${reference}`} author="Atelier · SADAELS" language="es-AR">
      <Page size="A4" style={styles.page}>
        <View style={styles.top}>
          <View>
            <Text style={styles.brand}>ATELIER · SADAELS</Text>
            <Text style={styles.title}>Remito</Text>
            <Text style={styles.disclaimer}>Documento asociado a la venta · No válido como factura</Text>
          </View>
          <View style={styles.referenceBox}>
            <Text style={styles.referenceLabel}>REFERENCIA DE VENTA</Text>
            <Text style={styles.reference}>{reference}</Text>
            <Text style={styles.referenceDate}>
              Fecha: {dateFormatter.format(new Date(`${sale.sold_at}T12:00:00Z`))}
            </Text>
            <Text style={styles.state}>{DELIVERY_STATE_LABEL[deliveryState(sale)]}</Text>
          </View>
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoBox}>
            <Text style={styles.sectionLabel}>CLIENTE</Text>
            <Text style={styles.strong}>{sale.customer_name || "Consumidor final"}</Text>
            {sale.customer_dni ? <Text style={styles.infoLine}>DNI: {sale.customer_dni}</Text> : null}
            {sale.customer_contact ? <Text style={styles.infoLine}>{sale.customer_contact}</Text> : null}
            {sale.customer_address ? <Text style={styles.infoLine}>{sale.customer_address}</Text> : null}
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.sectionLabel}>VENTA</Text>
            <Text style={styles.strong}>{sale.pos || "Atelier"}</Text>
            <Text style={styles.infoLine}>Vendedor: {sale.seller_name || "Sin asignar"}</Text>
            <Text style={styles.infoLine}>Pago: {sale.payment_method || "Sin especificar"}</Text>
            {sale.installments ? <Text style={styles.infoLine}>{sale.installments} cuotas</Text> : null}
            {sale.wholesale_store ? <Text style={styles.infoLine}>Tienda: {sale.wholesale_store}</Text> : null}
          </View>
        </View>

        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]} fixed>
            <Text style={[styles.th, styles.article]}>ARTÍCULO</Text>
            <Text style={[styles.th, styles.detail]}>DETALLE</Text>
            <Text style={[styles.th, styles.qty]}>CANTIDAD</Text>
            <Text style={[styles.th, styles.status]}>ESTADO</Text>
          </View>
          {items.map((item) => (
            <View key={item.id} style={styles.row} wrap={false}>
              <View style={styles.article}>
                <Text style={styles.itemName}>{item.article}</Text>
                {item.brand ? <Text style={styles.itemSub}>{item.brand}</Text> : null}
              </View>
              <Text style={styles.detail}>{[item.color, item.talle && `Talle ${item.talle}`].filter(Boolean).join(" · ") || "—"}</Text>
              <Text style={styles.qty}>{item.qty}</Text>
              <Text style={styles.status}>{itemStatus(item.status)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.summary} wrap={false}>
          <View style={styles.summaryLine}>
            <Text style={styles.summaryLabel}>Unidades</Text>
            <Text>{units}</Text>
          </View>
          {discount > 0 ? (
            <View style={styles.summaryLine}>
              <Text style={styles.summaryLabel}>Descuento general</Text>
              <Text>{Math.round(discount * 100)}%</Text>
            </View>
          ) : null}
          {shipping > 0 ? (
            <View style={styles.summaryLine}>
              <Text style={styles.summaryLabel}>Envío incluido</Text>
              <Text>{money(shipping)}</Text>
            </View>
          ) : null}
          <View style={[styles.summaryLine, styles.totalLine]}>
            <Text style={styles.totalLabel}>TOTAL DE LA VENTA</Text>
            <Text style={styles.totalValue}>{money(total)}</Text>
          </View>
        </View>

        {sale.notes ? (
          <View style={styles.notes} wrap={false}>
            <Text style={styles.sectionLabel}>OBSERVACIONES</Text>
            <Text style={styles.notesText}>{sale.notes}</Text>
          </View>
        ) : null}

        <View style={styles.signatures} wrap={false}>
          <Text style={styles.signature}>Firma de quien recibe</Text>
          <Text style={styles.signature}>Aclaración y DNI</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>Atelier · SADAELS</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function saleDeliveryNoteFilename(sale: SaleDeliveryNoteInput["sale"]): string {
  const safeReference = saleReference(sale)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `remito-${safeReference || sale.id.slice(0, 8)}.pdf`;
}

export async function renderSaleDeliveryNotePdf(input: SaleDeliveryNoteInput): Promise<Uint8Array> {
  const buffer = await renderToBuffer(SaleDeliveryNoteDocument(input));
  return new Uint8Array(buffer);
}
