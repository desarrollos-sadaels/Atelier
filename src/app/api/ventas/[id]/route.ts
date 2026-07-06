import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { adjustInventory, getProductVariants } from "@/lib/shopify/inventory";
import { requireRole } from "@/lib/api-auth";

/** Toggles de estado de una venta (entregado / factura). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRole(["admin", "vendedor"]);
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

  const patch: { delivered?: boolean; invoiced?: boolean } = {};
  if (typeof body.delivered === "boolean") patch.delivered = body.delivered;
  if (typeof body.invoiced === "boolean") patch.invoiced = body.invoiced;
  if (!Object.keys(patch).length) {
    return NextResponse.json({ ok: false, error: "Nada para actualizar" }, { status: 400 });
  }

  const supaAdmin = createAdminClient();
  const { error } = await supaAdmin.from("sales").update(patch).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id });
}

/** Eliminar una venta (solo admin). Si descontó stock, lo repone. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  const supaAdmin = createAdminClient();
  const { data: sale, error: fetchErr } = await supaAdmin
    .from("sales")
    .select("id, qty, product_id, variant_gid, stock_deducted")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  if (!sale) return NextResponse.json({ ok: false, error: "Venta no encontrada" }, { status: 404 });

  // Reponer stock si la venta lo había descontado.
  if (sale.stock_deducted && sale.product_id && isShopifyConfigured()) {
    try {
      const { data: product } = await supaAdmin
        .from("products")
        .select("id, shopify_id")
        .eq("id", sale.product_id)
        .maybeSingle();
      if (product?.shopify_id) {
        const pv = await getProductVariants(product.shopify_id);
        const variant = pv?.variants.find((v) => v.id === sale.variant_gid);
        if (!variant) throw new Error("No se encontró la variante para reponer");
        await adjustInventory([{ inventoryItemId: variant.inventoryItemId, delta: sale.qty }]);
        const fresh = await getProductVariants(product.shopify_id);
        if (fresh) {
          await supaAdmin
            .from("products")
            .update({ stock: fresh.total, updated_at: new Date().toISOString() })
            .eq("id", product.id);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error reponiendo stock";
      return NextResponse.json(
        { ok: false, error: `No se eliminó la venta: ${msg}` },
        { status: 500 },
      );
    }
  }

  const { error } = await supaAdmin.from("sales").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id });
}
