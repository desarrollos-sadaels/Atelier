import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { createShopifyProduct } from "@/lib/shopify/create";
import { requireRole } from "@/lib/api-auth";

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

export async function POST(req: NextRequest) {
  // Crear productos es una acción de catálogo: solo admin.
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isShopifyConfigured()) {
    return NextResponse.json({ ok: false, error: "Shopify no está configurado" }, { status: 400 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase admin no configurado" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const title = clean(body.title);
  if (!title) return NextResponse.json({ ok: false, error: "El nombre es obligatorio" }, { status: 400 });

  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ ok: false, error: "Ingresá un precio válido" }, { status: 400 });
  }

  const cost = body.cost != null && body.cost !== "" ? Number(body.cost) : null;
  const skuBase = clean(body.sku);
  const barcode = clean(body.barcode);
  const category = clean(body.category);
  const vendor = clean(body.vendor);
  const status = STATUS_MAP[String(body.status)] ?? "DRAFT";
  const alertThreshold = Number(body.alertThreshold) > 0 ? Math.trunc(Number(body.alertThreshold)) : 10;

  const options = Array.isArray(body.options)
    ? (body.options as { name?: unknown; values?: unknown }[])
        .filter((o) => typeof o?.name === "string" && Array.isArray(o.values) && o.values.length)
        .map((o) => ({
          name: String(o.name),
          values: (o.values as unknown[]).map((x) => String(x)).filter(Boolean),
        }))
    : [];
  const variants = Array.isArray(body.variants)
    ? (body.variants as { optionValues?: unknown; qty?: unknown }[])
        .filter((v) => Array.isArray(v?.optionValues) && (v.optionValues as unknown[]).length)
        .map((v) => ({
          optionValues: (v.optionValues as { name?: unknown; value?: unknown }[])
            .filter((o) => typeof o?.name === "string" && typeof o?.value === "string")
            .map((o) => ({ name: String(o.name), value: String(o.value) })),
          qty: Number(v.qty) || 0,
        }))
        .filter((v) => v.optionValues.length)
    : [];
  const singleStock = Number(body.stock) || 0;
  const imageUrls = Array.isArray(body.imageUrls)
    ? (body.imageUrls as unknown[]).filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];

  try {
    const product = await createShopifyProduct({
      title,
      descriptionHtml: clean(body.description) ?? undefined,
      category: category ?? undefined,
      vendor: vendor ?? undefined,
      status,
      price,
      cost: cost != null && Number.isFinite(cost) ? cost : null,
      skuBase,
      barcode,
      options,
      variants,
      singleStock,
      imageUrls,
    });

    const shopifyNumericId = product.id.split("/").pop()!;
    const useVariants = options.length > 0 && variants.length > 0;
    const totalStock = useVariants
      ? variants.reduce((s, v) => s + (Number(v.qty) || 0), 0)
      : singleStock;
    const first = product.variants?.nodes?.[0];

    const supaAdmin = createAdminClient();
    const { data: upserted, error } = await supaAdmin
      .from("products")
      .upsert(
        {
          shopify_id: shopifyNumericId,
          name: title,
          category,
          price,
          cost: cost != null && Number.isFinite(cost) ? cost : null,
          stock: totalStock,
          sku: first?.sku || skuBase || null,
          // createShopifyProduct no manda barcode cuando hay variantes por
          // color/talle (un solo código no distingue variantes distintas):
          // no guardar acá el valor tipeado por el usuario si Shopify no lo
          // tiene, para que la DB no diga algo que Shopify desmiente.
          barcode: useVariants ? first?.barcode || null : first?.barcode || barcode || null,
          provider: vendor,
          shopify_status: (product.status || status).toLowerCase(),
          alert_threshold: alertThreshold,
          image_url: imageUrls[0] ?? product.featuredMedia?.preview?.image?.url ?? null,
          images: imageUrls,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "shopify_id" },
      )
      .select("id")
      .limit(1);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      id: upserted?.[0]?.id ?? null,
      shopifyId: shopifyNumericId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error creando el producto";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
