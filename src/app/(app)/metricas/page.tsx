import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { KpiRow } from "@/components/KpiRow";
import { Card, btnCls } from "@/components/ui";
import { DemoBlock } from "@/components/DemoBlock";
import { formatARS } from "@/lib/queries";
import { isMetaConfigured } from "@/lib/meta/client";
import {
  getMetaOverview,
  getActiveCampaigns,
  getCampaignDemographics,
  type MetaCampaign,
  type DemographicRow,
} from "@/lib/meta/insights";

const intFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const nf = (n: number) => intFmt.format(n);

export default async function MetricasPage() {
  if (!isMetaConfigured()) return <NotConnected />;

  let campaigns: MetaCampaign[] = [];
  let kpis: { label: string; value: string; sub: string }[];
  let loadError: string | null = null;

  try {
    const [overview, active] = await Promise.all([getMetaOverview(), getActiveCampaigns()]);
    campaigns = active;
    kpis = [
      { label: "Gasto · 7 días", value: formatARS(overview.spend), sub: "inversión en Meta" },
      { label: "Alcance · 7 días", value: nf(overview.reach), sub: "personas alcanzadas" },
      { label: "Impresiones · 7 días", value: nf(overview.impressions), sub: "veces mostrado" },
      { label: "Campañas activas", value: String(overview.activeCampaigns), sub: "en curso" },
    ];
  } catch (e) {
    loadError = e instanceof Error ? e.message : "No se pudieron cargar las métricas";
    kpis = [
      { label: "Gasto · 7 días", value: "—", sub: "—" },
      { label: "Alcance · 7 días", value: "—", sub: "—" },
      { label: "Impresiones · 7 días", value: "—", sub: "—" },
      { label: "Campañas activas", value: "—", sub: "—" },
    ];
  }

  // Demografía por campaña (en paralelo, tolerante a fallos).
  const demos = await Promise.all(
    campaigns.map((c) => getCampaignDemographics(c.id).catch(() => null)),
  );

  return (
    <>
      <PageHeader
        kicker="Métricas · Meta Ads"
        title="Métricas"
        actions={
          <Link href="/configuracion" className={btnCls("ghost")}>
            Conexión Meta
          </Link>
        }
      />

      <div className="mt-8">
        <KpiRow items={kpis} />
      </div>

      {loadError && (
        <div className="mt-6 rounded-[4px] border border-acc/30 bg-acc/5 px-4 py-3 text-[13px] text-acc">
          {loadError}
        </div>
      )}

      <div className="mt-9 flex items-center justify-between">
        <h2 className="font-serif text-[22px] tracking-tight">Campañas activas</h2>
        <span className="mono text-[11px] text-mut">Últimos 7 días · demografía 30 días</span>
      </div>

      {!loadError && campaigns.length === 0 ? (
        <div className="mt-4 grid place-items-center rounded-[4px] border border-dashed border-line py-16 text-center">
          <div className="font-serif text-[20px]">Sin campañas activas</div>
          <p className="mono mt-2 text-[11px] text-mut">
            Cuando tengas campañas corriendo en Meta, aparecerán acá con sus métricas y demografía.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {campaigns.map((c, i) => (
            <CampaignCard key={c.id} c={c} demo={demos[i]} />
          ))}
        </div>
      )}
    </>
  );
}

function CampaignCard({
  c,
  demo,
}: {
  c: MetaCampaign;
  demo: { byAgeGender: DemographicRow[]; byRegion: DemographicRow[] } | null;
}) {
  const metrics: [string, string][] = [
    ["Gasto", formatARS(c.spend)],
    ["Alcance", nf(c.reach)],
    ["Impresiones", nf(c.impressions)],
    ["Clics", nf(c.clicks)],
    ["CTR", `${c.ctr.toFixed(2)}%`],
    ["Compras", nf(c.purchases)],
    ["ROAS", c.roas ? `${c.roas.toFixed(2)}×` : "—"],
  ];
  return (
    <Card>
      <div className="flex items-center justify-between px-6 pt-6">
        <div className="font-serif text-[18px] tracking-tight">{c.name}</div>
        <span className="mono text-[10px] text-mut">{c.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-y-4 px-6 pb-6 pt-5 sm:grid-cols-4 lg:grid-cols-7">
        {metrics.map(([k, v]) => (
          <div key={k}>
            <div className="mono text-[10px] text-mut">{k}</div>
            <div className="mt-1 font-serif text-[20px] leading-none">{v}</div>
          </div>
        ))}
      </div>

      {demo && (demo.byAgeGender.length > 0 || demo.byRegion.length > 0) && (
        <div className="grid grid-cols-1 gap-8 border-t border-line px-6 py-6 md:grid-cols-2">
          <DemoBlock title="Edad y género · alcance" rows={demo.byAgeGender.slice(0, 8)} />
          <DemoBlock title="Regiones · alcance" rows={demo.byRegion} />
        </div>
      )}
    </Card>
  );
}

function NotConnected() {
  return (
    <>
      <PageHeader kicker="Métricas · Meta Ads" title="Métricas" />
      <div className="mt-8 grid place-items-center rounded-[4px] border border-dashed border-line py-16 text-center">
        <div className="font-serif text-[22px]">Conectá Meta Ads</div>
        <p className="mono mt-2 max-w-[440px] text-[11px] leading-relaxed text-mut">
          Todavía no hay credenciales de Meta configuradas. Una vez conectada la cuenta, vas a ver
          gasto, alcance, impresiones, campañas activas y la demografía de cada campaña.
        </p>
      </div>
    </>
  );
}
