import { shopifyAdminPage } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/supabase/types";

type ShopifyVariant = {
  sku?: string | null;
  price?: string | null;
  inventory_quantity?: number;
  inventory_management?: string | null;
  barcode?: string | null;
};
type ShopifyImage = { src?: string | null };
type ShopifyProduct = {
  id: number;
  title: string;
  product_type?: string;
  vendor?: string;
  status?: string;
  variants?: ShopifyVariant[];
  image?: ShopifyImage | null;
  images?: ShopifyImage[];
};

export function mapProduct(p: ShopifyProduct): TablesInsert<"products"> {
  const variants = p.variants ?? [];
  // Shopify conserva a veces un inventory_quantity residual aun cuando una
  // variante ya no trackea inventario. Product.totalInventory no lo cuenta y
  // Atelier tampoco debe hacerlo.
  const stock = variants.reduce(
    (sum, v) =>
      sum +
      (v.inventory_management && typeof v.inventory_quantity === "number"
        ? v.inventory_quantity
        : 0),
    0,
  );
  // Primer valor no vacío entre variantes (la 1ª suele venir vacía).
  const sku = variants.find((v) => v.sku && v.sku.trim())?.sku ?? null;
  const barcode = variants.find((v) => v.barcode && v.barcode.trim())?.barcode ?? null;
  const priceVar = variants.find((v) => v.price && Number(v.price) > 0) ?? variants[0];
  const price = priceVar?.price ? Number(priceVar.price) : null;

  return {
    shopify_id: String(p.id),
    sku,
    name: p.title,
    category: p.product_type || null,
    price,
    stock,
    shopify_status: p.status || "active",
    barcode,
    provider: p.vendor || null,
    image_url: p.image?.src ?? p.images?.[0]?.src ?? null,
    images: (p.images ?? [])
      .map((i) => i.src)
      .filter((s): s is string => Boolean(s)),
    updated_at: new Date().toISOString(),
  };
}

/** Importa/actualiza todos los productos de Shopify en la DB (upsert por shopify_id). */
export async function syncProducts(): Promise<{ count: number }> {
  const supa = createAdminClient();
  let path: string | null = "products.json?limit=250";
  let count = 0;

  while (path) {
    const page: { data: { products: ShopifyProduct[] }; next: string | null } =
      await shopifyAdminPage<{ products: ShopifyProduct[] }>(path);
    const rows = (page.data.products ?? []).map(mapProduct);
    if (rows.length) {
      const { error } = await supa
        .from("products")
        .upsert(rows, { onConflict: "shopify_id" });
      if (error) {
        throw new Error(
          [error.message, error.details, error.hint, error.code]
            .filter(Boolean)
            .join(" · "),
        );
      }
      count += rows.length;
    }
    path = page.next;
  }

  return { count };
}
