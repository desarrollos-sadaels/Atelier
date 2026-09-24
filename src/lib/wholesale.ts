export type WholesaleSettings = {
  /** Descuento sobre el PVP vigente, expresado como porcentaje 0-100. */
  discountPercentage: number;
  stores: string[];
};

export type WholesaleFulfillmentMethod = "pickup" | "shipping";

export const WHOLESALE_POS = "MAYORISTAS";

export const DEFAULT_WHOLESALE_SETTINGS: WholesaleSettings = {
  discountPercentage: 50,
  stores: ["Yey House", "Studio 33", "Ikal (México)"],
};

export const WHOLESALE_FULFILLMENT_LABEL: Record<WholesaleFulfillmentMethod, string> = {
  pickup: "Retiro presencial",
  shipping: "Envío",
};

export const WHOLESALE_FULFILLMENT_OPTIONS = Object.values(WHOLESALE_FULFILLMENT_LABEL);

export function wholesaleFulfillmentFromLabel(label: string): WholesaleFulfillmentMethod {
  return label === WHOLESALE_FULFILLMENT_LABEL.shipping ? "shipping" : "pickup";
}

export function validateWholesaleSettings(raw: unknown): WholesaleSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const discountPercentage = source.discountPercentage;
  if (
    typeof discountPercentage !== "number" ||
    !Number.isFinite(discountPercentage) ||
    discountPercentage <= 0 ||
    discountPercentage >= 100
  ) {
    return null;
  }
  if (!Array.isArray(source.stores) || source.stores.length < 1 || source.stores.length > 100) {
    return null;
  }

  const seen = new Set<string>();
  const stores: string[] = [];
  for (const rawStore of source.stores) {
    const store = typeof rawStore === "string" ? rawStore.trim() : "";
    const key = store.toLocaleUpperCase("es-AR");
    if (!store || store.length > 80 || seen.has(key)) return null;
    seen.add(key);
    stores.push(store);
  }

  return {
    discountPercentage: Math.round(discountPercentage * 100) / 100,
    stores,
  };
}

export function parseWholesaleSettings(raw: unknown): WholesaleSettings {
  return validateWholesaleSettings(raw) ?? DEFAULT_WHOLESALE_SETTINGS;
}

/** Devuelve el nombre canónico configurado; evita guardar variantes por mayúsculas. */
export function findWholesaleStore(name: string | null, settings: WholesaleSettings): string | null {
  if (!name) return null;
  const key = name.trim().toLocaleUpperCase("es-AR");
  return settings.stores.find((store) => store.toLocaleUpperCase("es-AR") === key) ?? null;
}

export function isWholesaleFulfillmentMethod(value: unknown): value is WholesaleFulfillmentMethod {
  return value === "pickup" || value === "shipping";
}
