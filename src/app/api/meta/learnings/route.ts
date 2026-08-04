import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isMetaConfigured } from "@/lib/meta/client";
import { getActiveCampaigns, getCampaignDemographics } from "@/lib/meta/insights";
import { generateCampaignLearnings, isLearningsEnabled } from "@/lib/meta/learnings";
import { getLinkedProductId, getRealRevenueByMetaCampaignId } from "@/lib/queries";

export async function POST(req: NextRequest) {
  if (!isLearningsEnabled()) {
    return NextResponse.json({ ok: false, error: "No encontrado" }, { status: 404 });
  }
  const auth = await requireRole(["admin", "medios"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isMetaConfigured()) {
    return NextResponse.json({ ok: false, error: "Meta no está configurado" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const metaCampaignId = typeof body.metaCampaignId === "string" ? body.metaCampaignId.trim() : "";
  if (!metaCampaignId) {
    return NextResponse.json({ ok: false, error: "Falta la campaña" }, { status: 400 });
  }

  try {
    const [campaigns, demo, revenue, productId] = await Promise.all([
      getActiveCampaigns(),
      getCampaignDemographics(metaCampaignId),
      getRealRevenueByMetaCampaignId([metaCampaignId]),
      getLinkedProductId(metaCampaignId),
    ]);
    const campaign = campaigns.find((c) => c.id === metaCampaignId);
    if (!campaign) {
      return NextResponse.json(
        { ok: false, error: "La campaña no está activa o no se encontró" },
        { status: 404 },
      );
    }

    const realRevenue = revenue[metaCampaignId];
    const realRoas = realRevenue && campaign.spend > 0 ? realRevenue / campaign.spend : null;

    const insights = await generateCampaignLearnings({
      campaignName: campaign.name,
      spend: campaign.spend,
      reach: campaign.reach,
      impressions: campaign.impressions,
      purchases: campaign.purchases,
      metaRoas: campaign.roas,
      realRoas,
      byAgeGender: demo.byAgeGender,
      byRegion: demo.byRegion,
      productId,
    });

    return NextResponse.json({ ok: true, insights });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudieron generar los insights";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
