import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isAuthEnabled } from "@/lib/supabase/config";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { adjustInventory, getProductVariants } from "@/lib/shopify/inventory";
import { notifyLowStock } from "@/lib/notify";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (isAuthEnabled()) {
    const supa = await createClient();
    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }
  if (!isShopifyConfigured() || !isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Shopify/Supabase no configurado" }, { status: 400 });
  }

  let body: { changes?: { inventoryItemId?: unknown; delta?: unknown }[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const changes = (Array.isArray(body.changes) ? body.changes : [])
    .map((c) => ({ inventoryItemId: String(c.inventoryItemId ?? ""), delta: Math.trunc(Number(c.delta)) }))
    .filter((c) => c.inventoryItemId.startsWith("gid://") && Number.isFinite(c.delta) && c.delta !== 0);

  if (!changes.length) {
    return NextResponse.json({ ok: false, error: "No hay ajustes para aplicar" }, { status: 400 });
  }

  const supaAdmin = createAdminClient();
  const { data: product, error: fetchErr } = await supaAdmin
    .from("products")
    .select("id, shopify_id, name, alert_threshold")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  if (!product?.shopify_id) {
    return NextResponse.json({ ok: false, error: "Producto sin vínculo a Shopify" }, { status: 400 });
  }

  try {
    await adjustInventory(changes);
    // Releer el estado real desde Shopify y reflejarlo en la DB.
    const fresh = await getProductVariants(product.shopify_id);
    const total = fresh?.total ?? 0;
    await supaAdmin
      .from("products")
      .update({ stock: total, updated_at: new Date().toISOString() })
      .eq("id", product.id);

    await notifyLowStock(supaAdmin, {
      productId: product.id,
      name: product.name,
      newStock: total,
      alertThreshold: product.alert_threshold,
    });

    return NextResponse.json({ ok: true, total, variants: fresh?.variants ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error ajustando inventario";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
