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

type Param = string | string[] | undefined;

/**
 * Next entrega un parámetro repetido (`?rango=hoy&rango=7d`) como array. Sin
 * esto, `?canal=atelier&canal=shopify` tiraba "v.split is not a function" y la
 * página entera daba error.
 */
const first = (v: Param): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Reporte de ventas. El estado aplicado vive en la URL (igual que Ventas): se
 * puede compartir con un link, y los exports (CSV y PDF) reciben las mismas
 * fechas, canales y cuenta, así que descargan la vista previa que se generó.
 *
 * Los números los arma `loadSalesReport`, que es la misma función que usa el
 * PDF: la pantalla y el archivo no pueden contar cosas distintas.
 */
export default async function ReportePage({
  searchParams,
}: {
  searchParams: Promise<{
    rango?: Param;
    desde?: Param;
    hasta?: Param;
    canal?: Param;
    vendedor?: Param;
  }>;
}) {
  const sp = await searchParams;
  const range = resolveReportRange({ rango: first(sp.rango), desde: first(sp.desde), hasta: first(sp.hasta) });
  // Los canales repetidos se suman: es la forma natural de pedir varios.
  const channels = parseReportChannels(Array.isArray(sp.canal) ? sp.canal.join(",") : sp.canal);

  // La cuenta del reporte depende del rol, que sale del perfil: por eso el
  // perfil va antes que los números.
  const [profile, sellers] = await Promise.all([getCurrentProfile(), getSellers()]);
  const role = uiRole(profile?.role);

  // El vendedor ve sus números, no el ranking del equipo: su resumen por
  // empleado queda fijo en su propia cuenta. Es un recorte de la app (la RLS
  // deja leer todas las ventas a la staff), pero sus comisiones no tienen por
  // qué quedar a la vista de sus compañeros.
  const ownOnly = role === "vendedor";
  const sellerId = ownOnly ? (profile?.id ?? null) : parseSellerId(first(sp.vendedor));

  const data = await loadSalesReport(range, {
    channels,
    sellerId,
    // Un vendedor sin perfil resuelto no tiene "lo suyo": no se le muestra todo.
    blocked: ownOnly && !sellerId,
  });

  const options = sellerOptions(sellers);
  const rowName = sellerId ? (data.rows.find((r) => r.sellerId === sellerId)?.name ?? null) : null;

  // "Ver resumen" también lleva a cuentas que el selector no lista (un perfil
  // de medios, o uno que ya no existe pero dejó ventas). Sin agregarla, la
  // vista decía "Resumen de X" y el formulario "Elegí una cuenta", sin forma de
  // volver a elegirla.
  if (sellerId && !ownOnly && !options.some((o) => o.id === sellerId)) {
    options.unshift({ id: sellerId, label: sellerLabel({ sellerId, name: rowName }) });
  }

  const sellerName = sellerId
    ? (options.find((o) => o.id === sellerId)?.label ??
      (ownOnly ? profile?.name : null) ??
      sellerLabel({ sellerId, name: rowName }))
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
      incomeSummary={ownOnly ? null : data.incomeSummary}
      error={data.error}
    />
  );
}
