import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Card, Chip, Dot, Eyebrow, btnCls } from "@/components/ui";
import { Plus } from "@/components/icons";
import {
  getDashboardStats,
  getRecentActivity,
  getTodaySales,
  getSalesSeries,
  getCurrentProfile,
  firstNameOf,
  formatARS,
  lastDaysRangeART,
} from "@/lib/queries";
import { SalesChart } from "@/components/SalesChart";
import { cn } from "@/lib/cn";

const CHART_DAYS = 30;

export default async function DashboardPage() {
  const chartRange = lastDaysRangeART(CHART_DAYS);
  const [stats, activity, todaySales, series, profile] = await Promise.all([
    getDashboardStats(),
    getRecentActivity(),
    getTodaySales(),
    getSalesSeries(chartRange.start, chartRange.end),
    getCurrentProfile(),
  ]);
  const firstName = firstNameOf(profile?.name);
  const todayKicker = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
  const kpis = [
    { label: "Productos", value: stats.total.toLocaleString("es-AR"), sub: "sincronizados con Shopify", alert: false },
    { label: "Stock bajo", value: String(stats.lowStock), sub: "en o bajo el umbral", alert: false },
    { label: "Sin stock", value: String(stats.outStock), sub: "requieren reposición", alert: stats.outStock > 0 },
    {
      label: "Ventas hoy",
      value: todaySales.operations > 0 ? formatARS(todaySales.totalAmount) : "—",
      // Abrir el número por plataforma es el punto: el mismo KPI ahora suma el
      // local y la tienda online, y sin el desglose no se sabe cuál movió.
      sub:
        todaySales.operations > 0
          ? `${formatARS(todaySales.atelierAmount)} atelier · ${formatARS(todaySales.shopifyAmount)} online`
          : "sin ventas todavía",
      alert: false,
    },
  ];
  const alerts = stats.alerts;
  return (
    <>
      <PageHeader
        kicker={`${todayKicker} · Buenos Aires`}
        title={
          firstName ? (
            <>
              Buenos días, <span className="italic">{firstName}</span>
            </>
          ) : (
            "Buenos días"
          )
        }
        actions={
          <>
            <Link href="/ventas/reporte" className={btnCls("ghost")}>
              Reporte de ventas
            </Link>
            <Link href="/catalogo/nuevo" className={btnCls("primary")}>
              <Plus className="h-4 w-4" /> Nuevo producto
            </Link>
          </>
        }
      />

      {/* KPIs */}
      <div className="mt-8 grid grid-cols-2 border-t border-line md:grid-cols-4">
        {kpis.map((k, i) => (
          <div
            key={k.label}
            className={cn("py-6 pr-7", i > 0 && "md:border-l md:border-line md:pl-7")}
          >
            <div className="mono text-[11px] text-mut">{k.label}</div>
            <div
              className={cn(
                "mt-1 font-serif text-[44px] leading-none tracking-tight",
                k.alert && "text-acc",
              )}
            >
              {k.value}
            </div>
            <div className="mt-4 text-[12px] text-mut">{k.sub}</div>
          </div>
        ))}
      </div>
      <div className="hair" />

      {/* main grid */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.75fr_1fr]">
        {/* chart */}
        <Card className="p-6">
          <Eyebrow>Ventas · últimos {CHART_DAYS} días</Eyebrow>
          <SalesChart data={series} />
        </Card>

        {/* alerts */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <Eyebrow>Alertas de stock</Eyebrow>
            {alerts.length > 0 && <Chip tone="acc">{alerts.length} alertas</Chip>}
          </div>
          {alerts.length === 0 && (
            <p className="mt-5 text-[13px] text-mut">Sin alertas de stock por ahora.</p>
          )}
          <ul className="mt-5">
            {alerts.map((a, i) => (
              <li
                key={a.sku}
                className={cn(
                  "flex items-center gap-3 py-3",
                  i < alerts.length - 1 && "border-b border-line",
                )}
              >
                <Dot alert={a.alert} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{a.name}</div>
                  <div className="mono text-[10px] text-mut">{a.sku}</div>
                </div>
                <div
                  className={cn(
                    "font-serif text-[17px]",
                    a.alert && "text-acc",
                  )}
                >
                  {a.qty}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* activity */}
      <div className="mt-10 flex items-center justify-between">
        <Eyebrow>Actividad reciente</Eyebrow>
      </div>
      {activity.length === 0 ? (
        <div className="mt-4 grid place-items-center rounded-[4px] border border-dashed border-line py-12 text-center">
          <div className="font-serif text-[18px]">Sin actividad todavía</div>
          <p className="mono mt-2 text-[11px] text-mut">
            Ventas, reposiciones y alertas aparecerán acá
          </p>
        </div>
      ) : (
        <ul className="mt-4 border-t border-line">
          {activity.map((a, i) => (
            <li key={i} className="flex items-center gap-3 border-b border-line py-3.5">
              <Dot alert={a.severity === "alert"} />
              <div className="min-w-0 flex-1">
                <span className="text-[13px] font-medium">{a.title}</span>
                {a.body && <span className="ml-2 text-[13px] text-mut">{a.body}</span>}
              </div>
              <span className="mono text-[11px] text-mut">{a.date}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
