import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { KpiRow } from "@/components/KpiRow";
import { Card, CardTitle, btnCls } from "@/components/ui";
import { Plus } from "@/components/icons";
import {
  getCurrentProfile,
  getPaymentMethods,
  getExternalBrands,
  getOtherBrandSalesBreakdown,
  getSales,
  getSalesKpis,
  getSaleMovements,
  getSellers,
  monthRange,
  formatARS,
  SALES_PAGE_SIZE,
} from "@/lib/queries";
import { uiRole } from "@/lib/roles";
import { VentasClient, type OriginFilter, type StatusFilter } from "./VentasClient";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const ORIGINS: OriginFilter[] = ["todos", "atelier", "taller", "shopify"];
const STATUSES: StatusFilter[] = ["todos", "active", "preorder", "returned"];

const MONTH_LABEL = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<{
    mes?: string;
    q?: string;
    p?: string;
    origen?: string;
    estado?: string;
  }>;
}) {
  const { mes, q, p, origen, estado } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(mes ?? "") ? (mes as string) : currentMonth();
  const search = (q ?? "").slice(0, 60);
  const page = Math.max(1, Number(p) || 1);
  const origin: OriginFilter = ORIGINS.includes(origen as OriginFilter)
    ? (origen as OriginFilter)
    : "todos";
  // El default es "activas": la pantalla de Ventas es la lista de lo que se
  // vendió, y mezclarle las compras íntegramente devueltas sin pedirlo hace
  // sumar mal de un vistazo. Se ven cambiando el filtro.
  const status: StatusFilter = STATUSES.includes(estado as StatusFilter)
    ? (estado as StatusFilter)
    : "active";
  const { start, end } = monthRange(month);

  // Los KPIs salen de una agregación en la base sobre el mes completo, así que
  // no dependen ni de la página ni de los filtros activos.
  const [profile, k, sales, movements, sellers, paymentMethods, brands, brandSales] = await Promise.all([
    getCurrentProfile(),
    getSalesKpis(start, end),
    getSales(start, end, {
      q: search,
      page,
      origin,
      status,
    }),
    getSaleMovements(start, end),
    getSellers(),
    getPaymentMethods(),
    getExternalBrands(),
    getOtherBrandSalesBreakdown(start, end),
  ]);
  const role = uiRole(profile?.role);

  const [y, m] = month.split("-").map(Number);
  const monthLabel = MONTH_LABEL.format(new Date(y, m - 1, 1));

  const shopifyShare =
    k.totalAmount > 0 ? Math.round((k.shopifyAmount / k.totalAmount) * 100) : 0;

  const kpis = [
    {
      label: "Ventas brutas de productos",
      value: formatARS(k.grossProductAmount),
      sub: `${k.units} unidades · ${k.operations} operaciones · sin envíos`,
    },
    { label: "Ingreso Sadaels del mes", value: formatARS(k.totalAmount), sub: `Productos · sin envíos${k.otherBrandUnmappedAmount !== 0 ? " · incluye marcas sin tasa al 100%" : ""}` },
    {
      label: "Tienda online",
      value: formatARS(k.shopifyAmount),
      sub: k.totalAmount > 0 ? `${shopifyShare}% del total · ${k.shopifyUnits} u` : "sin ventas online",
    },
    {
      label: "Envíos cobrados",
      value: formatARS(k.shippingAmount),
      sub: `${formatARS(k.atelierShippingAmount)} atelier · ${formatARS(k.workshopShippingAmount)} taller · ${formatARS(k.shopifyShippingAmount)} online`,
    },
    {
      label: "Otras marcas · venta bruta",
      value: formatARS(k.otherBrandGrossAmount),
      sub: `Sadaels ${formatARS(k.otherBrandAmount)} · Marcas ${formatARS(k.otherBrandGrossAmount - k.otherBrandAmount)} · Sin tasa incluidos en Sadaels ${formatARS(k.otherBrandUnmappedAmount)} · ${k.otherBrandUnits} u`,
    },
    {
      label: k.returnedCount > 0 ? "Devoluciones" : "Entregas pendientes",
      value: k.returnedCount > 0 ? String(k.returnedCount) : String(k.pendingDelivery),
      // Las devoluciones van por la fecha en que se DEVOLVIERON (0028), no por
      // la de la venta: una prenda de agosto devuelta en septiembre suma acá. El
      // filtro "Con devolución" lista por mes de venta, así que los dos números
      // pueden no coincidir, y el "en el mes" es para que no se lea como error.
      sub:
        k.returnedCount > 0
          ? `${formatARS(k.returnedAmount)} devueltos en el mes · ${k.pendingDelivery} entregas pendientes`
          : "sin marcar entregado",
      alert: k.returnedCount > 0 || k.pendingDelivery > 0,
    },
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

      <Card className="mt-6">
        <CardTitle>Otras marcas · ventas del mes</CardTitle>
        <div className="px-6 pb-6 pt-3">
          <p className="text-[12px] text-mut">
            La venta bruta de otras marcas se divide entre ingreso de Sadaels y parte de las marcas. Si una venta histórica no tiene tasa, el 100% se cuenta como ingreso de Sadaels y la parte de la marca es $0. Primero se descuenta cada prenda; después, el descuento general. El porcentaje se aplica sobre ese precio neto. El envío se muestra aparte. Los cambios de porcentaje en Configuración rigen para ventas nuevas.
          </p>
          {k.otherBrandUnmappedAmount !== 0 && (
            <p className="mt-3 text-[12px] text-acc">
              {formatARS(k.otherBrandUnmappedAmount)} de ventas sin tasa se incluyen íntegramente en el ingreso de Sadaels. Si el admin les asigna una tasa histórica, el reparto se recalcula.
            </p>
          )}
          {brandSales.length === 0 ? (
            <p className="mono mt-5 text-[11px] text-mut">Sin ventas de otras marcas en este mes.</p>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="mono text-[10px] text-mut">
                  <tr className="border-b border-line">
                    <th className="py-2 font-normal">Marca</th>
                    <th className="py-2 text-right font-normal">Unidades</th>
                    <th className="py-2 text-right font-normal">Venta bruta</th>
                    <th className="py-2 text-right font-normal">Parte de la marca</th>
                    <th className="py-2 text-right font-normal">Ingreso Sadaels</th>
                  </tr>
                </thead>
                <tbody>
                  {brandSales.map((row) => (
                    <tr key={row.brand} className="border-b border-line last:border-0">
                      <td className="py-2.5 font-medium">{row.brand}{row.unmappedAmount !== 0 ? " · sin tasa: 100% Sadaels" : ""}</td>
                      <td className="py-2.5 text-right">{row.units}</td>
                      <td className="py-2.5 text-right">{formatARS(row.grossAmount)}</td>
                      <td className="py-2.5 text-right">{formatARS(row.grossAmount - row.realAmount)}</td>
                      <td className="py-2.5 text-right font-medium">
                        {formatARS(row.realAmount)}
                        {row.unmappedAmount !== 0 && (
                          <div className="mono text-[9px] font-normal text-acc">
                            Incluye {formatARS(row.unmappedAmount)} sin tasa al 100%
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line font-medium">
                  <tr>
                    <td className="pt-3">Total otras marcas</td>
                    <td className="pt-3 text-right">{k.otherBrandUnits}</td>
                    <td className="pt-3 text-right">{formatARS(k.otherBrandGrossAmount)}</td>
                    <td className="pt-3 text-right">{formatARS(k.otherBrandGrossAmount - k.otherBrandAmount)}</td>
                    <td className="pt-3 text-right">{formatARS(k.otherBrandAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </Card>

      <VentasClient
        rows={sales.rows}
        movements={movements}
        total={sales.total}
        page={page}
        pageSize={SALES_PAGE_SIZE}
        query={search}
        month={month}
        origin={origin}
        status={status}
        role={role}
        monthLabel={monthLabel}
        prevMonth={shiftMonth(month, -1)}
        nextMonth={shiftMonth(month, 1)}
        sellers={sellers}
        paymentMethods={paymentMethods}
        brands={brands}
        currentUserId={profile?.id ?? null}
      />
    </>
  );
}
