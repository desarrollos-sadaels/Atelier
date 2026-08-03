import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { KpiRow } from "@/components/KpiRow";
import { Card, btnCls } from "@/components/ui";
import { DemoBlock } from "@/components/DemoBlock";
import { LearningsPanel } from "@/components/LearningsPanel";
import { formatARS, getRealRevenueByMetaCampaignId } from "@/lib/queries";
import { isMetaConfigured } from "@/lib/meta/client";
import { isLearningsEnabled } from "@/lib/meta/learnings";
import {
  getMetaOverview,
  getActiveCampaigns,
  getCampaignDemographics,
  getTopAds,
  metaStatusLabel,
  type MetaCampaign,
  type MetaAd,
  type DemographicRow,
} from "@/lib/meta/insights";

const intFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const nf = (n: number) => intFmt.format(n);

export default async function MetricasPage() {
  if (!isMetaConfigured()) return <NotConnected />;

  let campaigns: MetaCampaign[] = [];
  let topAds: MetaAd[] = [];
  let kpis: { label: string; value: string; sub: string }[];
  let loadError: string | null = null;

  try {
    const [overview, active, ads] = await Promise.all([
      getMetaOverview(),
      getActiveCampaigns(),
      getTopAds(3).catch(() => []),
    ]);
    campaigns = active;
    topAds = ads;
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

  // ROAS real: ingreso de sales.ts (productos vinculados) / gasto de Meta.
  const realRevenue = await getRealRevenueByMetaCampaignId(campaigns.map((c) => c.id));

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

      {!loadError && topAds.length > 0 && (
        <>
          <div className="mt-9 flex items-center justify-between">
            <h2 className="font-serif text-[22px] tracking-tight">Top 3 anuncios</h2>
            <span className="mono text-[11px] text-mut">Últimos 7 días · por ROAS</span>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {topAds.map((ad, i) => (
              <TopAdCard key={ad.id} rank={i + 1} ad={ad} />
            ))}
          </div>
        </>
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
            <CampaignCard key={c.id} c={c} demo={demos[i]} realRevenue={realRevenue[c.id] ?? null} />
          ))}
        </div>
      )}
    </>
  );
}

function TopAdCard({ rank, ad }: { rank: number; ad: MetaAd }) {
  return (
    <Card>
      <div className="flex items-center justify-between px-6 pt-6">
        <span className="mono text-[11px] text-mut">#{rank}</span>
        <span className="mono text-[10px] text-mut">{metaStatusLabel(ad.status)}</span>
      </div>
      <div className="px-6 pt-2">
        <div className="truncate font-serif text-[16px] tracking-tight" title={ad.name}>
          {ad.name}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-y-4 px-6 pb-6 pt-4">
        {(
          [
            ["ROAS", ad.roas ? `${ad.roas.toFixed(2)}×` : "—"],
            ["Compras", nf(ad.purchases)],
            ["Gasto", formatARS(ad.spend)],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k}>
            <div className="mono text-[10px] text-mut">{k}</div>
            <div className="mt-1 font-serif text-[18px] leading-none">{v}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CampaignCard({
  c,
  demo,
  realRevenue,
}: {
  c: MetaCampaign;
  demo: { byAgeGender: DemographicRow[]; byRegion: DemographicRow[] } | null;
  realRevenue: number | null;
}) {
  const realRoas = realRevenue && c.spend > 0 ? realRevenue / c.spend : null;
  const metrics: [string, string][] = [
    ["Gasto", formatARS(c.spend)],
    ["Alcance", nf(c.reach)],
    ["Impresiones", nf(c.impressions)],
    ["Clics", nf(c.clicks)],
    ["CTR", `${c.ctr.toFixed(2)}%`],
    ["Compras", nf(c.purchases)],
    ["ROAS (Meta)", c.roas ? `${c.roas.toFixed(2)}×` : "—"],
    ["ROAS real", realRoas ? `${realRoas.toFixed(2)}×` : "—"],
  ];
  return (
    <Card>
      <div className="flex items-center justify-between px-6 pt-6">
        <div className="font-serif text-[18px] tracking-tight">{c.name}</div>
        <span className="mono text-[10px] text-mut">{metaStatusLabel(c.status)}</span>
      </div>

      <div className="grid grid-cols-2 gap-y-4 px-6 pb-6 pt-5 sm:grid-cols-4 lg:grid-cols-8">
        {metrics.map(([k, v]) => (
          <div key={k}>
            <div className="mono text-[10px] text-mut">{k}</div>
            <div className="mt-1 font-serif text-[20px] leading-none">{v}</div>
          </div>
        ))}
      </div>
      {realRevenue == null && (
        <p className="mono px-6 pb-5 text-[10px] text-mut">
          ROAS real: vinculá un producto a esta campaña para calcularlo con ventas reales.
        </p>
      )}

      {demo && (demo.byAgeGender.length > 0 || demo.byRegion.length > 0) && (
        <div className="grid grid-cols-1 gap-8 border-t border-line px-6 py-6 md:grid-cols-2">
          <DemoBlock title="Edad y género · alcance" rows={demo.byAgeGender.slice(0, 8)} />
          <DemoBlock title="Regiones · alcance" rows={demo.byRegion} />
        </div>
      )}

      {isLearningsEnabled() && <LearningsPanel metaCampaignId={c.id} />}
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
