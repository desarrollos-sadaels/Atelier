import { shopifyGraphql, getFallbackLocationId } from "./client";

export type OptionDef = { name: string; values: string[] };
export type VariantDef = { optionValues: { name: string; value: string }[]; qty: number };

export type NewProductInput = {
  title: string;
  descriptionHtml?: string;
  category?: string; // -> productType
  vendor?: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  price: number;
  cost?: number | null;
  skuBase?: string | null;
  barcode?: string | null;
  /** Opciones (ej. Talle, Color). Vacío = producto de variante única. */
  options: OptionDef[];
  /** Combinaciones de variantes con su stock. */
  variants: VariantDef[];
  /** Stock cuando no hay opciones. */
  singleStock?: number;
  imageUrls?: string[];
};

export type CreatedProduct = {
  id: string; // GID
  handle: string;
  status: string;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  variants: { nodes: { id: string; sku: string | null; barcode: string | null; price: string; inventoryQuantity: number | null }[] };
};

type ProductSetResult = {
  productSet: {
    product: CreatedProduct | null;
    userErrors: { field: string[] | null; message: string }[];
  };
};

/** Crea un producto en Shopify (con opciones, variantes, inventario e imágenes) vía productSet. */
export async function createShopifyProduct(input: NewProductInput): Promise<CreatedProduct> {
  // Producto nuevo: todavia no tiene inventory levels de los que deducir la
  // ubicacion, asi que se usa la unica location de la tienda.
  const locationId = await getFallbackLocationId();
  const money = (n: number) => n.toFixed(2);
  const qty = (n: number) => Math.max(0, Math.trunc(n));
  const inv = (cost?: number | null) => ({
    tracked: true,
    ...(cost != null ? { cost: money(cost) } : {}),
  });

  const useVariants = input.options.length > 0 && input.variants.length > 0;

  const variants = useVariants
    ? input.variants.map((v) => {
        const suffix = v.optionValues.map((o) => o.value).join("-");
        return {
          optionValues: v.optionValues.map((o) => ({ optionName: o.name, name: o.value })),
          price: money(input.price),
          ...(input.skuBase ? { sku: `${input.skuBase}-${suffix}` } : {}),
          inventoryItem: inv(input.cost),
          inventoryQuantities: [{ locationId, name: "available", quantity: qty(v.qty) }],
        };
      })
    : [
        {
          price: money(input.price),
          ...(input.skuBase ? { sku: input.skuBase } : {}),
          ...(input.barcode ? { barcode: input.barcode } : {}),
          inventoryItem: inv(input.cost),
          inventoryQuantities: [
            { locationId, name: "available", quantity: qty(input.singleStock ?? 0) },
          ],
        },
      ];

  const setInput: Record<string, unknown> = {
    title: input.title,
    status: input.status,
    ...(input.descriptionHtml ? { descriptionHtml: input.descriptionHtml } : {}),
    ...(input.category ? { productType: input.category } : {}),
    ...(input.vendor ? { vendor: input.vendor } : {}),
    ...(useVariants
      ? {
          productOptions: input.options.map((o) => ({
            name: o.name,
            values: o.values.map((v) => ({ name: v })),
          })),
        }
      : {}),
    variants,
    ...(input.imageUrls && input.imageUrls.length
      ? { files: input.imageUrls.map((url) => ({ originalSource: url, contentType: "IMAGE" })) }
      : {}),
  };

  const mutation = `
    mutation CreateProduct($input: ProductSetInput!) {
      productSet(synchronous: true, input: $input) {
        product {
          id
          handle
          status
          featuredMedia { preview { image { url } } }
          variants(first: 100) { nodes { id sku barcode price inventoryQuantity } }
        }
        userErrors { field message }
      }
    }`;

  const data = await shopifyGraphql<ProductSetResult>(mutation, { input: setInput });
  const errs = data.productSet.userErrors;
  if (errs?.length) {
    throw new Error(errs.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join(" · "));
  }
  const product = data.productSet.product;
  if (!product) throw new Error("Shopify no devolvió el producto creado");
  return product;
}
