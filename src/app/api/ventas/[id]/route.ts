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
  // Este handler escribe con service_role, así que la RLS de `sales` (UPDATE
  // solo admin) queda bypasseada y el chequeo de pertenencia hay que hacerlo
  // acá. Sin esto, cualquier vendedor podía togglear entregado/factura de una
  // venta ajena mandando el id. El admin sigue pudiendo tocar todas.
  let q = supaAdmin.from("sales").update(patch).eq("id", id);
  if (auth.identity.role === "vendedor") {
    if (!auth.identity.userId) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    // `.eq` también descarta las ventas con seller_id null (cargadas antes de
    // que existiera la columna): esas quedan solo para admin.
    q = q.eq("seller_id", auth.identity.userId);
  }

  const { data: updated, error } = await q.select("id");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!updated?.length) {
    // No distinguimos "no existe" de "es de otro" para no confirmar ids ajenos.
    return NextResponse.json(
      { ok: false, error: "Venta inexistente o de otro vendedor" },
      { status: 404 },
    );
  }
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
