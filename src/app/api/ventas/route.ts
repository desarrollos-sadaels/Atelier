import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { adjustInventory, getProductVariants } from "@/lib/shopify/inventory";
import { requireRole } from "@/lib/api-auth";
import type { TablesInsert } from "@/lib/supabase/types";

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

/** Registrar una venta. Si viene variante de Shopify, descuenta stock. */
export async function POST(req: NextRequest) {
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

  const article = str(body.article);
  const price = Number(body.price);
  const qty = Math.trunc(Number(body.qty)) || 1;
  const discount = Number(body.discount) || 0;
  if (!article) return NextResponse.json({ ok: false, error: "Falta el artículo" }, { status: 400 });
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ ok: false, error: "Precio inválido" }, { status: 400 });
  }
  if (qty <= 0) return NextResponse.json({ ok: false, error: "Cantidad inválida" }, { status: 400 });
  if (discount < 0 || discount >= 1) {
    return NextResponse.json({ ok: false, error: "Descuento inválido" }, { status: 400 });
  }

  const soldAtRaw = str(body.soldAt);
  const soldAt = soldAtRaw && /^\d{4}-\d{2}-\d{2}$/.test(soldAtRaw) ? soldAtRaw : undefined;
  const installmentsRaw = Math.trunc(Number(body.installments));
  const installments = Number.isFinite(installmentsRaw) && installmentsRaw > 0 ? installmentsRaw : null;
  const customer = (body.customer ?? {}) as Record<string, unknown>;
  const isOtherBrand = Boolean(body.isOtherBrand);
  const productId = !isOtherBrand ? str(body.productId) : null;
  const inventoryItemId = !isOtherBrand ? str(body.inventoryItemId) : null;

  const row: TablesInsert<"sales"> = {
    ...(soldAt ? { sold_at: soldAt } : {}),
    seller_id: auth.identity.userId,
    seller_name: auth.identity.name,
    customer_name: str(customer.name),
    customer_dni: str(customer.dni),
    customer_contact: str(customer.contact),
    customer_address: str(customer.address),
    product_id: productId,
    variant_gid: !isOtherBrand ? str(body.variantGid) : null,
    article,
    color: str(body.color),
    talle: str(body.talle),
    qty,
    is_other_brand: isOtherBrand,
    brand: isOtherBrand ? str(body.brand) : null,
    price,
    discount,
    payment_method: str(body.paymentMethod),
    installments,
    pos: str(body.pos),
    invoiced: Boolean(body.invoiced),
    invoice_path: Boolean(body.invoiced) ? str(body.invoicePath) : null,
    delivered: Boolean(body.delivered),
    notes: str(body.notes),
    stock_deducted: false,
  };

  const supaAdmin = createAdminClient();

  // 1) Descontar stock en Shopify si corresponde (venta de catálogo con variante).
  let stockDeducted = false;
  let warning: string | undefined;
  if (productId && inventoryItemId?.startsWith("gid://") && isShopifyConfigured()) {
    try {
      await adjustInventory([{ inventoryItemId, delta: -qty }]);
      stockDeducted = true;
      // Reflejar el total real en la DB (mismo patrón que el restock).
      const { data: product } = await supaAdmin
        .from("products")
        .select("id, shopify_id")
        .eq("id", productId)
        .maybeSingle();
      if (product?.shopify_id) {
        const fresh = await getProductVariants(product.shopify_id);
        if (fresh) {
          await supaAdmin
            .from("products")
            .update({ stock: fresh.total, updated_at: new Date().toISOString() })
            .eq("id", product.id);
        }
      }
    } catch (e) {
      // La venta no se pierde: se guarda sin descontar stock y avisamos.
      warning = `La venta se registró pero NO se pudo descontar stock en Shopify: ${
        e instanceof Error ? e.message : "error desconocido"
      }`;
    }
  }
  row.stock_deducted = stockDeducted;

  // 2) Guardar la venta.
  const { data, error } = await supaAdmin.from("sales").insert(row).select("id").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: data.id, stockDeducted, warning });
}
