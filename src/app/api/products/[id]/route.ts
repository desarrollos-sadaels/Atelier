import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isAuthEnabled } from "@/lib/supabase/config";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { updateShopifyProduct } from "@/lib/shopify/product";

const STATUS_MAP: Record<string, "ACTIVE" | "DRAFT" | "ARCHIVED"> = {
  Borrador: "DRAFT",
  Activo: "ACTIVE",
  Archivado: "ARCHIVED",
};

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t !== "Seleccionar" ? t : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const title = clean(body.title);
  if (!title) return NextResponse.json({ ok: false, error: "El nombre es obligatorio" }, { status: 400 });

  const category = clean(body.category);
  const vendor = clean(body.vendor);
  const status = STATUS_MAP[String(body.status)] ?? "DRAFT";
  const alertThreshold = Number(body.alertThreshold) > 0 ? Math.trunc(Number(body.alertThreshold)) : 10;
  const description = typeof body.description === "string" ? body.description : "";

  const supaAdmin = createAdminClient();
  const { data: product, error: fetchErr } = await supaAdmin
    .from("products")
    .select("id, shopify_id")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  if (!product?.shopify_id) {
    return NextResponse.json({ ok: false, error: "Producto sin vínculo a Shopify" }, { status: 400 });
  }

  try {
    await updateShopifyProduct(product.shopify_id, {
      title,
      descriptionHtml: description,
      productType: category ?? "",
      vendor: vendor ?? "",
      status,
    });

    const { error } = await supaAdmin
      .from("products")
      .update({
        name: title,
        category,
        provider: vendor,
        shopify_status: status.toLowerCase(),
        alert_threshold: alertThreshold,
        updated_at: new Date().toISOString(),
      })
      .eq("id", product.id);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: product.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error actualizando el producto";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
