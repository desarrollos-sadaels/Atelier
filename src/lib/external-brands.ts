/** Porcentaje del precio neto de la prenda que queda como ingreso de Sadaels. */
export type ExternalBrand = { name: string; percentage: number };

export const DEFAULT_EXTERNAL_BRANDS: ExternalBrand[] = [
  { name: "MADEO", percentage: 30 },
  { name: "MARIN", percentage: 28 },
  { name: "LANGLOIS", percentage: 30 },
  { name: "ALUMINA DICE", percentage: 30 },
  { name: "DEMOLISHED", percentage: 28 },
  { name: "GIRO", percentage: 37 },
  { name: "Chiara Magnahani", percentage: 35 },
  { name: "PABLO BERNARD", percentage: 28 },
];

export function validateExternalBrands(raw: unknown): ExternalBrand[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) return null;
  const names = new Set<string>();
  const brands: ExternalBrand[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return null;
    const candidate = row as Record<string, unknown>;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const percentage = candidate.percentage;
    const key = name.toLocaleUpperCase("es-AR");
    if (!name || name.length > 80 || names.has(key)) return null;
    if (typeof percentage !== "number" || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null;
    names.add(key);
    brands.push({ name, percentage: Math.round(percentage * 100) / 100 });
  }
  return brands;
}

export function parseExternalBrands(raw: unknown): ExternalBrand[] {
  return validateExternalBrands(raw) ?? DEFAULT_EXTERNAL_BRANDS;
}

export function findExternalBrand(name: string | null, brands: ExternalBrand[]): ExternalBrand | null {
  if (!name) return null;
  const key = name.trim().toLocaleUpperCase("es-AR");
  return brands.find((brand) => brand.name.toLocaleUpperCase("es-AR") === key) ?? null;
}
