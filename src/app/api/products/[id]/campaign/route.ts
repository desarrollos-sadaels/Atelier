import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-auth";

/** Vincular/desvincular un producto a una campaña de Meta (solo avisa, no pausa nada). */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const metaCampaignId = typeof body.metaCampaignId === "string" ? body.metaCampaignId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!metaCampaignId || !name) {
    return NextResponse.json({ ok: false, error: "Falta la campaña a vincular" }, { status: 400 });
  }

  const supa = createAdminClient();

  const { data: product } = await supa.from("products").select("id").eq("id", id).maybeSingle();
  if (!product) return NextResponse.json({ ok: false, error: "Producto no encontrado" }, { status: 404 });

  const { data: campaign, error: campaignErr } = await supa
    .from("campaigns")
    .upsert(
      { meta_campaign_id: metaCampaignId, name, updated_at: new Date().toISOString() },
      { onConflict: "meta_campaign_id" },
    )
    .select("id")
    .single();
  if (campaignErr || !campaign) {
    return NextResponse.json(
      { ok: false, error: campaignErr?.message || "No se pudo guardar la campaña" },
      { status: 500 },
    );
  }

  // Un producto vinculado a lo sumo a una campaña: reemplaza cualquier vínculo previo.
  await supa.from("product_campaign_links").delete().eq("product_id", id);
  const { error: linkErr } = await supa
    .from("product_campaign_links")
    .insert({ product_id: id, campaign_id: campaign.id, auto_action: "notify" });
  if (linkErr) {
    return NextResponse.json({ ok: false, error: linkErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  const supa = createAdminClient();
  const { error } = await supa.from("product_campaign_links").delete().eq("product_id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
