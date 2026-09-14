import { getCurrentProfile, getSellers, type Seller } from "@/lib/queries";
import { loadSalesReport } from "@/lib/sales-report-data";
import { ROLE_LABEL, uiRole } from "@/lib/roles";
import {
  parseReportChannels,
  parseSellerId,
  resolveReportRange,
  sellerLabel,
  todayART,
} from "@/lib/sales-report";
import { ReporteClient, type SellerOption } from "./ReporteClient";

/**
 * Los nombres de cuenta pueden repetirse (la misma persona con un perfil de
 * admin y otro de vendedor), y el selector elige por etiqueta: sin
 * desambiguar, elegir uno podía filtrar por el otro.
 */
function sellerOptions(sellers: Seller[]): SellerOption[] {
  const count = new Map<string, number>();
  for (const s of sellers) count.set(s.name, (count.get(s.name) ?? 0) + 1);
  const seen = new Set<string>();
  return sellers.map((s) => {
    let label = (count.get(s.name) ?? 0) > 1 ? `${s.name} · ${ROLE_LABEL[s.role]}` : s.name;
    for (let i = 2; seen.has(label); i++) label = `${s.name} (${i})`;
    seen.add(label);
    return { id: s.id, label };
  });
}

/**
 * Reporte de ventas. El estado aplicado vive en la URL (igual que Ventas): se
 * puede compartir con un link, y los exports (CSV y PDF) leen los mismos
 * parámetros, así que descargan la vista previa que se generó.
 *
 * Los números los arma `loadSalesReport`, que es la misma función que usa el
 * PDF: la pantalla y el archivo no pueden contar cosas distintas.
 */
export default async function ReportePage({
  searchParams,
}: {
  searchParams: Promise<{
    rango?: string;
    desde?: string;
    hasta?: string;
    canal?: string;
    vendedor?: string;
  }>;
}) {
  const sp = await searchParams;
  const range = resolveReportRange(sp);
  const channels = parseReportChannels(sp.canal);

  // La cuenta del reporte depende del rol, que sale del perfil: por eso el
  // perfil va antes que los números.
  const [profile, sellers] = await Promise.all([getCurrentProfile(), getSellers()]);
  const role = uiRole(profile?.role);

  // El vendedor ve sus números, no el ranking del equipo: su resumen por
  // empleado queda fijo en su propia cuenta. Es un recorte de la app (la RLS
  // deja leer todas las ventas a la staff), pero sus comisiones no tienen por
  // qué quedar a la vista de sus compañeros.
  const ownOnly = role === "vendedor";
  const sellerId = ownOnly ? (profile?.id ?? null) : parseSellerId(sp.vendedor);

  const data = await loadSalesReport(range, {
    channels,
    sellerId,
    // Un vendedor sin perfil resuelto no tiene "lo suyo": no se le muestra todo.
    blocked: ownOnly && !sellerId,
  });

  const options = sellerOptions(sellers);
  const sellerName = sellerId
    ? (options.find((o) => o.id === sellerId)?.label ??
      (ownOnly ? profile?.name : null) ??
      sellerLabel({ sellerId, name: data.rows.find((r) => r.sellerId === sellerId)?.name ?? null }))
    : null;

  return (
    <ReporteClient
      range={range}
      today={todayART()}
      channels={channels}
      sellerId={sellerId}
      sellerName={sellerName}
      sellerOptions={options}
      ownOnly={ownOnly}
      totals={data.totals}
      byChannel={data.byChannel}
      bySeller={data.bySeller}
      highlights={data.highlights}
      error={data.error}
    />
  );
}
