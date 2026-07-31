import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { getProductVariants } from "@/lib/shopify/inventory";
import { requireRole } from "@/lib/api-auth";

/** Variantes (color/talle/stock) de un producto — para el picker de ventas y restock. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await requireRole(["admin", "medios", "vendedor"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isShopifyConfigured() || !isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Shopify/Supabase no configurado" }, { status: 400 });
  }

  const supaAdmin = createAdminClient();
  const { data: product } = await supaAdmin
    .from("products")
    .select("id, shopify_id")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (!product?.shopify_id) {
    return NextResponse.json({ ok: true, variants: [] });
  }

  try {
    const pv = await getProductVariants(product.shopify_id);
    return NextResponse.json({
      ok: true,
      variants: (pv?.variants ?? []).map((v) => ({
        id: v.id,
        color: v.color,
        size: v.size,
        optionLabel: v.optionLabel,
        available: v.available,
        inventoryItemId: v.inventoryItemId,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error consultando variantes";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
