import { shopifyGraphql, getPrimaryLocationId } from "./client";

export type VariantStock = {
  id: string; // variant GID
  optionLabel: string; // título completo (ej. "S / Marrón")
  color: string | null;
  size: string | null;
  sku: string | null;
  available: number;
  inventoryItemId: string; // GID del inventory item
  imageUrl: string | null; // imagen específica de la variante (color)
};

export type ProductVariants = {
  total: number;
  variants: VariantStock[];
  options: { name: string; values: string[] }[];
  colorOptionName: string | null;
  sizeOptionName: string | null;
};

type VariantNode = {
  id: string;
  title: string;
  sku: string | null;
  inventoryQuantity: number | null;
  selectedOptions: { name: string; value: string }[];
  inventoryItem: { id: string } | null;
  image: { url: string } | null;
};

const isColor = (name: string) => /color|colour/i.test(name);
const isSize = (name: string) => /talle|size|talla|tama/i.test(name);

function fullLabel(v: VariantNode): string {
  if (v.title && v.title !== "Default Title") return v.title;
  const vals = v.selectedOptions.map((o) => o.value).filter((x) => x && x !== "Default Title");
  return vals.length ? vals.join(" / ") : "Único";
}

/** Lee las variantes de un producto desde Shopify (fuente de verdad del stock). */
export async function getProductVariants(shopifyId: string): Promise<ProductVariants | null> {
  const data = await shopifyGraphql<{
    product: {
      totalInventory: number | null;
      options: { name: string; optionValues: { name: string }[] }[];
      variants: { nodes: VariantNode[] };
    } | null;
  }>(
    `query Variants($id: ID!) {
      product(id: $id) {
        totalInventory
        options { name optionValues { name } }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            inventoryQuantity
            selectedOptions { name value }
            inventoryItem { id }
            image { url }
          }
        }
      }
    }`,
    { id: `gid://shopify/Product/${shopifyId}` },
  );

  if (!data.product) return null;

  const colorOptionName = data.product.options.find((o) => isColor(o.name))?.name ?? null;
  const sizeOptionName = data.product.options.find((o) => isSize(o.name))?.name ?? null;

  const variants: VariantStock[] = data.product.variants.nodes
    .filter((v) => v.inventoryItem?.id)
    .map((v) => ({
      id: v.id,
      optionLabel: fullLabel(v),
      color: colorOptionName
        ? v.selectedOptions.find((o) => o.name === colorOptionName)?.value ?? null
        : null,
      size: sizeOptionName
        ? v.selectedOptions.find((o) => o.name === sizeOptionName)?.value ?? null
        : null,
      sku: v.sku || null,
      available: v.inventoryQuantity ?? 0,
      inventoryItemId: v.inventoryItem!.id,
      imageUrl: v.image?.url ?? null,
    }));

  const total = data.product.totalInventory ?? variants.reduce((s, v) => s + v.available, 0);

  return {
    total,
    variants,
    options: data.product.options.map((o) => ({
      name: o.name,
      values: o.optionValues.map((x) => x.name),
    })),
    colorOptionName,
    sizeOptionName,
  };
}

/** Ajusta el inventario disponible por variante (delta) en la location primaria. */
export async function adjustInventory(
  changes: { inventoryItemId: string; delta: number }[],
): Promise<void> {
  const filtered = changes.filter((c) => Number.isInteger(c.delta) && c.delta !== 0);
  if (!filtered.length) return;
  const locationId = await getPrimaryLocationId();

  const data = await shopifyGraphql<{
    inventoryAdjustQuantities: { userErrors: { field: string[] | null; message: string }[] };
  }>(
    `mutation Adjust($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        inventoryAdjustmentGroup { reason }
        userErrors { field message }
      }
    }`,
    {
      input: {
        name: "available",
        reason: "correction",
        changes: filtered.map((c) => ({
          inventoryItemId: c.inventoryItemId,
          locationId,
          delta: c.delta,
        })),
      },
    },
  );

  const errs = data.inventoryAdjustQuantities.userErrors;
  if (errs?.length) {
    throw new Error(errs.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join(" · "));
  }
}
