import crypto from "node:crypto";
import { shopifyGraphql, getFallbackLocationId } from "./client";

export type VariantStock = {
  id: string; // variant GID
  optionLabel: string; // título completo (ej. "S / Marrón")
  color: string | null;
  size: string | null;
  sku: string | null;
  available: number;
  tracked: boolean;
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
  inventoryItem: { id: string; tracked: boolean } | null;
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
      options: { name: string; optionValues: { name: string }[] }[];
      variants: { nodes: VariantNode[] };
    } | null;
  }>(
    `query Variants($id: ID!) {
      product(id: $id) {
        options { name optionValues { name } }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            inventoryQuantity
            selectedOptions { name value }
            inventoryItem { id tracked }
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
      available: v.inventoryItem!.tracked ? (v.inventoryQuantity ?? 0) : 0,
      tracked: v.inventoryItem!.tracked,
      inventoryItemId: v.inventoryItem!.id,
      imageUrl: v.image?.url ?? null,
    }));

  // Una respuesta sin ninguna variante no es "stock 0", es una respuesta rara:
  // todo producto de Shopify tiene al menos una. Cortamos acá en vez de dejar
  // que el llamador escriba un 0 inventado en `products.stock`.
  if (!data.product.variants.nodes.length) {
    throw new Error("Shopify devolvió el producto sin variantes; no se puede calcular el stock");
  }

  // El total sale de la SUMA de las variantes, no de `product.totalInventory`.
  //
  // Medido el 2026-09-02: después de un `inventoryAdjustQuantities`,
  // `totalInventory` seguía devolviendo el valor viejo aun 4 segundos más tarde,
  // mientras que `inventoryQuantity` por variante ya reflejaba el cambio en la
  // primera lectura. Como este total es lo que se escribe en `products.stock`
  // justo después de descontar por una venta, usar el campo que lagea dejaba el
  // catálogo mostrando stock de antes de la venta hasta el siguiente evento.
  const total = variants.reduce((s, v) => s + v.available, 0);

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

/** Resuelve a qué producto pertenece un inventory item (para el webhook inventory_levels/update). */
export async function getProductIdByInventoryItem(inventoryItemId: string): Promise<string | null> {
  const data = await shopifyGraphql<{
    inventoryItem: { variant: { product: { id: string } | null } | null } | null;
  }>(
    `query InventoryItemProduct($id: ID!) {
      inventoryItem(id: $id) {
        variant { product { id } }
      }
    }`,
    { id: inventoryItemId },
  );
  const gid = data.inventoryItem?.variant?.product?.id;
  return gid ? gid.split("/").pop()! : null;
}

type ItemLevel = { locationId: string; available: number };

export type AdjustOptions = {
  /**
   * Identidad LÓGICA del ajuste, no de la request. Dos llamadas con el mismo
   * scope son el mismo movimiento de stock y Shopify aplica solo una.
   *
   * Por eso tiene que derivar de la operación de negocio (`sale-deduct:<id>`,
   * `sale-restock:<id>`) y no de algo random: es la red que atrapa el reintento
   * que ninguna otra capa ve, el de la respuesta que se perdió en el camino
   * después de que Shopify ya aplicó el cambio.
   */
  idempotencyScope: string;
  /**
   * URI que Shopify muestra en el historial de inventario de la tienda. Sirve
   * para que un movimiento se pueda rastrear hasta la venta que lo causó.
   */
  reference?: string;
};

/**
 * Clave con forma de UUID derivada determinísticamente de un texto.
 *
 * `@idempotent` es obligatoria desde la API 2026-04 y los ejemplos usan UUIDs,
 * así que se le da esa forma. Determinística a propósito: una clave random por
 * llamada cumpliría el requisito formal y no protegería de nada.
 */
function idempotencyKey(scope: string): string {
  const h = crypto.createHash("sha256").update(scope).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Ubicación en la que cada inventory item lleva stock.
 *
 * Se pregunta por item en vez de asumir "la location primaria de la tienda" por
 * dos razones. La primera es de permisos: identificar la primaria exige el scope
 * `read_locations`, que esta app no tiene, y pedirlo rompía todos los ajustes de
 * inventario (ver `getFallbackLocationId`). La segunda es de correctitud: con más
 * de un depósito, descontar siempre en la primaria mueve stock de un lugar que
 * puede no ser donde estaba la prenda.
 *
 * Si un item tiene inventario en varias locations, se prefiere una con
 * disponible > 0. Sigue siendo una heurística: la app no modela desde qué
 * depósito se vende.
 */
async function levelsForInventoryItems(ids: string[]): Promise<Map<string, ItemLevel>> {
  const data = await shopifyGraphql<{
    nodes: ({
      id: string;
      inventoryLevels: {
        nodes: { location: { id: string }; quantities: { quantity: number }[] }[];
      };
    } | null)[];
  }>(
    `query Levels($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on InventoryItem {
          id
          inventoryLevels(first: 10) {
            nodes {
              location { id }
              quantities(names: ["available"]) { quantity }
            }
          }
        }
      }
    }`,
    { ids },
  );

  const out = new Map<string, ItemLevel>();
  for (const node of data.nodes) {
    if (!node) continue;
    const levels = node.inventoryLevels.nodes;
    const withStock = levels.find((l) => (l.quantities[0]?.quantity ?? 0) > 0);
    const chosen = withStock ?? levels[0];
    if (chosen) {
      out.set(node.id, {
        locationId: chosen.location.id,
        available: chosen.quantities[0]?.quantity ?? 0,
      });
    }
  }
  return out;
}

/**
 * Ajusta el inventario disponible por variante (delta), en la location del item.
 *
 * `changeFromQuantity` es obligatorio desde la API 2026-07 y habilita un
 * compare-and-swap: si el disponible en Shopify no coincide con el que leímos,
 * la mutación falla con `CHANGE_FROM_QUANTITY_STALE` en vez de aplicar el delta
 * sobre un número viejo. Se puede saltear pasando `null`, pero acá conviene
 * tenerlo: Shopify es la fuente de verdad del stock (no Atelier), así que
 * descontar a ciegas es exactamente cómo se sobrevende sin enterarse.
 *
 * El costo del CAS es que una venta concurrente puede hacerlo fallar, y un
 * fallo en el mostrador es caro. Por eso se reintenta una vez con datos
 * frescos: cubre la carrera real (dos ventas casi simultáneas) sin renunciar
 * al chequeo.
 */
export async function adjustInventory(
  changes: { inventoryItemId: string; delta: number }[],
  opts: AdjustOptions,
): Promise<void> {
  const filtered = changes.filter((c) => Number.isInteger(c.delta) && c.delta !== 0);
  if (!filtered.length) return;

  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const levels = await levelsForInventoryItems(filtered.map((c) => c.inventoryItemId));

    // Un item sin ningún inventory level todavía no está stockeado en ninguna
    // parte; ahí no queda otra que la única location de la tienda, y sin
    // cantidad previa contra la cual comparar.
    let fallback: string | null = null;
    const resolved: ItemLevel[] = [];
    for (const c of filtered) {
      let level = levels.get(c.inventoryItemId);
      if (!level) {
        fallback ??= await getFallbackLocationId();
        level = { locationId: fallback, available: 0 };
      }
      resolved.push(level);
    }

    const data = await shopifyGraphql<{
      inventoryAdjustQuantities: {
        userErrors: { field: string[] | null; message: string; code: string | null }[];
      };
    }>(
      // La clave cambia entre reintentos a propósito: un rechazo por CAS
      // significa que Shopify NO aplicó nada, así que no hay qué deduplicar —
      // y reusar la clave arriesgaría que devuelva el resultado cacheado del
      // intento fallido en vez de evaluar los datos frescos.
      `mutation Adjust($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input)
          @idempotent(key: "${idempotencyKey(
            attempt === 1 ? opts.idempotencyScope : `${opts.idempotencyScope}#retry${attempt}`,
          )}") {
          inventoryAdjustmentGroup { reason }
          userErrors { field message code }
        }
      }`,
      {
        input: {
          name: "available",
          reason: "correction",
          ...(opts.reference ? { referenceDocumentUri: opts.reference } : {}),
          changes: filtered.map((c, i) => ({
            inventoryItemId: c.inventoryItemId,
            locationId: resolved[i].locationId,
            delta: c.delta,
            changeFromQuantity: resolved[i].available,
          })),
        },
      },
    );

    const errs = data.inventoryAdjustQuantities.userErrors;
    if (!errs?.length) return;

    const stale = errs.some((e) => /STALE/i.test(e.code ?? "") || /stale/i.test(e.message));
    if (!stale || attempt === MAX_ATTEMPTS) {
      throw new Error(errs.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join(" · "));
    }
    // Alguien movió el inventario entre la lectura y la escritura: volvemos a leer.
  }
}
