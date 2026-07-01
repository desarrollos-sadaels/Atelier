import { notFound } from "next/navigation";
import { EditProductClient, type EditInitial } from "./EditProductClient";
import { getProductById, formatARS } from "@/lib/queries";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { getProductVariants } from "@/lib/shopify/inventory";
import { getProductBasics } from "@/lib/shopify/product";
import { CATEGORY_OPTIONS, CATEGORY_SELECT_DEFAULT, normalizeCategory } from "@/lib/categories";

const STATUS_ES: Record<string, string> = {
  active: "Activo",
  draft: "Borrador",
  archived: "Archivado",
};

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await getProductById(id);
  if (!p) notFound();

  let description = "";
  let colors: string[] = [];
  let sizes: string[] = [];
  let statusCanonical = p.shopify_status ?? "draft";

  if (p.shopify_id && isShopifyConfigured()) {
    try {
      const [basics, pv] = await Promise.all([
        getProductBasics(p.shopify_id),
        getProductVariants(p.shopify_id),
      ]);
      if (basics) {
        description = basics.descriptionHtml ?? "";
        statusCanonical = basics.status?.toLowerCase() ?? statusCanonical;
      }
      if (pv) {
        const cset = new Set<string>();
        const sset = new Set<string>();
        for (const v of pv.variants) {
          if (v.color) cset.add(v.color);
          if (v.size) sset.add(v.size);
        }
        colors = [...cset];
        sizes = [...sset];
      }
    } catch {
      // fallback a datos de DB
    }
  }

  const normalizedCat = normalizeCategory(p.category);
  const initial: EditInitial = {
    name: p.name,
    description,
    category: (CATEGORY_OPTIONS as readonly string[]).includes(normalizedCat)
      ? normalizedCat
      : CATEGORY_SELECT_DEFAULT,
    vendor: p.provider ?? "",
    status: STATUS_ES[statusCanonical] ?? "Borrador",
    alertThreshold: String(p.alert_threshold),
  };

  return (
    <EditProductClient
      id={p.id}
      initial={initial}
      readonlyInfo={{
        sku: p.sku ?? "—",
        price: formatARS(p.price),
        barcode: p.barcode ?? "—",
      }}
      colors={colors}
      sizes={sizes}
    />
  );
}
