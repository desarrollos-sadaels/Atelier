import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { KpiRow } from "@/components/KpiRow";
import { btnCls } from "@/components/ui";
import { Plus } from "@/components/icons";
import {
  getCurrentProfile,
  getPaymentMethods,
  getSales,
  getSalesKpis,
  getSellers,
  monthRange,
  formatARS,
  SALES_PAGE_SIZE,
} from "@/lib/queries";
import { uiRole } from "@/lib/roles";
import type { SaleOrigin } from "@/lib/sales";
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

const ORIGINS: OriginFilter[] = ["todos", "atelier", "shopify"];
const STATUSES: StatusFilter[] = ["todos", "active", "returned"];

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
  const [profile, k, sales, sellers, paymentMethods] = await Promise.all([
    getCurrentProfile(),
    getSalesKpis(start, end),
    getSales(start, end, {
      q: search,
      page,
      origin: origin as SaleOrigin | "todos",
      status,
    }),
    getSellers(),
    getPaymentMethods(),
  ]);
  const role = uiRole(profile?.role);

  const [y, m] = month.split("-").map(Number);
  const monthLabel = MONTH_LABEL.format(new Date(y, m - 1, 1));

  const shopifyShare =
    k.totalAmount > 0 ? Math.round((k.shopifyAmount / k.totalAmount) * 100) : 0;

  const kpis = [
    { label: "Ventas del mes", value: formatARS(k.totalAmount), sub: "las dos plataformas" },
    {
      label: "Tienda online",
      value: formatARS(k.shopifyAmount),
      sub: k.totalAmount > 0 ? `${shopifyShare}% del total · ${k.shopifyUnits} u` : "sin ventas online",
    },
    { label: "Unidades", value: String(k.units), sub: `${k.operations} operaciones` },
    {
      label: k.returnedCount > 0 ? "Devoluciones" : "Entregas pendientes",
      value: k.returnedCount > 0 ? String(k.returnedCount) : String(k.pendingDelivery),
      sub:
        k.returnedCount > 0
          ? `${formatARS(k.returnedAmount)} · ${k.pendingDelivery} entregas pendientes`
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

      <VentasClient
        rows={sales.rows}
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
        currentUserId={profile?.id ?? null}
      />
    </>
  );
}
