import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { KpiRow } from "@/components/KpiRow";
import { Card, CardTitle, btnCls } from "@/components/ui";
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

function DemoBlock({ title, rows }: { title: string; rows: DemographicRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.reach));
  return (
    <div>
      <CardTitle>{title}</CardTitle>
      <div className="mt-4 space-y-2.5">
        {rows.length === 0 ? (
          <p className="px-6 text-[12px] text-mut">Sin datos.</p>
        ) : (
          rows.map((r) => (
            <div key={r.label} className="flex items-center gap-3">
              <span className="mono w-32 shrink-0 truncate text-[11px] text-ink2">{r.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel">
                <div
                  className="h-full rounded-full bg-acc"
                  style={{ width: `${Math.round((r.reach / max) * 100)}%` }}
                />
              </div>
              <span className="mono w-14 shrink-0 text-right text-[11px] text-mut">{nf(r.reach)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function NotConnected() {
  const steps = [
    "En Meta for Developers creá/usá una App Business y copiá App ID y App Secret.",
    "En Business Settings → Usuario del sistema, generá un token de larga duración con permiso ads_read y asignale la cuenta publicitaria.",
    "Cargá META_APP_ID, META_APP_SECRET, META_ACCESS_TOKEN y META_AD_ACCOUNT_ID en el entorno.",
  ];
  return (
    <>
      <PageHeader kicker="Métricas · Meta Ads" title="Métricas" />
      <div className="mt-8 grid place-items-center rounded-[4px] border border-dashed border-line py-16 text-center">
        <div className="font-serif text-[22px]">Conectá Meta Ads</div>
        <p className="mono mt-2 max-w-[440px] text-[11px] leading-relaxed text-mut">
          Todavía no hay credenciales de Meta configuradas. Una vez conectada la cuenta, vas a ver
          gasto, alcance, impresiones, campañas activas y la demografía de cada campaña.
        </p>
        <ol className="mt-6 max-w-[520px] space-y-2 text-left">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-[12px] text-ink2">
              <span className="mono text-mut">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
