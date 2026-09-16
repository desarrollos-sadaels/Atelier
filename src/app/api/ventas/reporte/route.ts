import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSellers } from "@/lib/queries";
import { getSalesBreakdown, getSalesDetail } from "@/lib/reports";
import { loadSalesReport } from "@/lib/sales-report-data";
import { renderSalesReportPdf } from "@/lib/report-pdf";
import {
  SALE_CHANNELS,
  filterBreakdown,
  groupBySeller,
  parseReportChannels,
  parseSellerId,
  resolveReportRange,
  sellerLabel,
  sharePct,
  sumTotals,
  type BreakdownRow,
  type ReportTotals,
} from "@/lib/sales-report";

type Cell = string | number | null;

/**
 * Celda de CSV para Excel en español: `;` como separador y coma decimal, que es
 * como lo abre un Excel con configuración regional de Argentina sin pasar por
 * "Importar datos".
 *
 * Los textos que empiezan con = + - @ se escapan con un apóstrofo: el artículo
 * y el nombre del cliente los tipea alguien, y Excel ejecuta una celda que
 * empieza con "=" como fórmula (CSV injection). Los números no pasan por ahí —
 * un monto negativo tiene que seguir siendo un número.
 */
function cell(v: Cell): string {
  if (v == null) return "";
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
  }
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Cell[][]): string {
  // BOM: sin él, Excel abre el UTF-8 como Latin-1 y rompe cada tilde.
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

function csvResponse(body: string, filename: string, truncated = false) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      ...(truncated ? { "X-Report-Truncated": "true" } : {}),
    },
  });
}

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * Export del reporte de ventas. Recibe los mismos parámetros que la página
 * (`rango`, `desde`, `hasta`, `canal`, `vendedor`) y los resuelve con las
 * mismas funciones, así que descarga exactamente la vista previa generada.
 *
 * - `tipo=resumen` (default): CSV, una fila por cuenta con la plata abierta por
 *   canal, más el total.
 * - `tipo=detalle`: CSV, una fila por prenda vendida.
 * - `tipo=pdf`: la vista previa en A4 (KPIs, destacados y tablas).
 *
 * El vendedor solo exporta lo suyo, pida lo que pida la URL. La RLS de `sales`
 * hoy deja leer todo a la staff, así que este recorte es de la app y no de la
 * base — consistente con lo que muestra la página, no una barrera de seguridad.
 */
export async function GET(req: NextRequest) {
  const auth = await requireRole(["admin", "medios", "vendedor"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  const { identity } = auth;
  const ownOnly = identity.role === "vendedor";
  if (ownOnly && !identity.userId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const range = resolveReportRange({
    rango: sp.get("rango"),
    desde: sp.get("desde"),
    hasta: sp.get("hasta"),
  });
  const channels = parseReportChannels(sp.get("canal"));
  const sellerId = ownOnly ? identity.userId : parseSellerId(sp.get("vendedor"));
  const suffix = [range.from, range.to, channels.join("-") || null].filter(Boolean).join("_");
  const tipo = sp.get("tipo");

  if (tipo === "pdf") {
    try {
      const data = await loadSalesReport(range, { channels, sellerId });
      if (data.error) {
        return NextResponse.json({ ok: false, error: data.error }, { status: 500 });
      }
      // El nombre sale del perfil y no de las filas: una cuenta sin ventas en el
      // período no tiene filas, y su PDF igual tiene que decir de quién es.
      let sellerName: string | null = null;
      if (sellerId) {
        sellerName = ownOnly
          ? identity.name
          : ((await getSellers()).find((s) => s.id === sellerId)?.name ??
            sellerLabel({ sellerId, name: data.rows.find((r) => r.sellerId === sellerId)?.name ?? null }));
      }
      const pdf = await renderSalesReportPdf({
        range,
        channels,
        sellerName,
        totals: data.totals,
        byChannel: data.byChannel,
        bySeller: data.bySeller,
        highlights: data.highlights,
        incomeSummary: data.incomeSummary,
        generatedAt: new Date(),
      });
      return new Response(pdf as BodyInit, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="reporte-ventas_${suffix}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Error al generar el PDF";
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  if (tipo === "detalle") {
    try {
      const { lines, truncated } = await getSalesDetail(range.start, range.end, { channels, sellerId });
      const rows: Cell[][] = [
        [
          "Fecha",
          "Compra",
          "Canal",
          "Vendedor",
          "Artículo",
          "Color",
          "Talle",
          "Cantidad",
          "Precio unitario",
          "Desc. prenda %",
          "Desc. compra %",
          "Importe",
          "Estado prenda",
          "Medio de pago",
          "Cuotas",
          "Punto de venta",
          "Entrega",
        ],
        ...lines.map((l) => [
          l.soldAt,
          l.order,
          l.channel,
          l.seller,
          l.article,
          l.color,
          l.talle,
          l.qty,
          l.price,
          Math.round(l.itemDiscount * 1000) / 10,
          Math.round(l.saleDiscount * 1000) / 10,
          money(l.amount),
          l.itemStatus,
          l.paymentMethod,
          l.installments,
          l.pos,
          l.delivery,
        ]),
      ];
      return csvResponse(toCsv(rows), `ventas-detalle_${suffix}.csv`, truncated);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Error al generar el detalle";
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  const report = await getSalesBreakdown(range.start, range.end);
  if (report.error) {
    return NextResponse.json({ ok: false, error: report.error }, { status: 500 });
  }
  const scoped = filterBreakdown(report.rows, { channels, sellerId });
  const totals = sumTotals(scoped);

  // La plata por canal de una cuenta (o del total), en el orden fijo de canales.
  const channelAmounts = (rows: BreakdownRow[]) =>
    SALE_CHANNELS.map(({ value }) => money(sumTotals(rows.filter((r) => r.channel === value)).total));

  const line = (label: string, t: ReportTotals, rows: BreakdownRow[]): Cell[] => [
    label,
    money(t.total),
    sharePct(t.total, totals.total),
    t.operations,
    t.units,
    t.operations ? Math.round(t.total / t.operations) : null,
    ...channelAmounts(rows),
    t.pendingDelivery,
    t.exchangedCount,
    t.returnedCount,
    t.returnedUnits,
    money(t.returnedAmount),
  ];

  const csv: Cell[][] = [
    [
      "Vendedor",
      "Ventas cobradas · productos y envíos",
      "% del total",
      "Operaciones",
      "Unidades",
      "Ticket promedio",
      ...SALE_CHANNELS.map((c) => c.label),
      "Entregas pendientes",
      "Cambios",
      "Devoluciones",
      "Unidades devueltas",
      "Monto devuelto",
    ],
    ...groupBySeller(scoped).map((s) =>
      line(sellerLabel(s), s, scoped.filter((r) => r.sellerId === s.sellerId)),
    ),
    line("Total", totals, scoped),
  ];
  return csvResponse(toCsv(csv), `ventas-resumen_${suffix}.csv`);
}
