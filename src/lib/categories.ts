/**
 * Categorías canónicas del catálogo (español), fuente única de verdad.
 * Reemplaza los arrays `CATS` duplicados en los formularios.
 */
export const CATEGORY_OPTIONS = [
  "Vestidos",
  "Tops",
  "Pantalones",
  "Faldas",
  "Bikers",
  "Abrigos",
  "Bodies",
  "Mallas",
  "Monos",
  "Accesorios",
] as const;

/** Valor placeholder para los dropdowns de formulario. */
export const CATEGORY_SELECT_DEFAULT = "Seleccionar";

/** Fallback para categorías desconocidas / vacías. */
export const CATEGORY_FALLBACK = "Otros";

/**
 * Mapa de normalización: valor crudo en minúsculas (productType de Shopify en
 * inglés + categorías viejas en español) → categoría canónica.
 * Consolida duplicados: biker+biker leggings, coats+jackets+blazer+trench, etc.
 */
const CATEGORY_MAP: Record<string, (typeof CATEGORY_OPTIONS)[number]> = {
  // Vestidos
  dress: "Vestidos",
  dresses: "Vestidos",
  vestidos: "Vestidos",
  // Tops (remeras, tops, crops, shirts)
  top: "Tops",
  tops: "Tops",
  shirt: "Tops",
  shirts: "Tops",
  "shirts & tops": "Tops",
  crop: "Tops",
  remeras: "Tops",
  buzos: "Tops",
  // Pantalones
  pants: "Pantalones",
  pant: "Pantalones",
  pantalones: "Pantalones",
  // Faldas
  skirt: "Faldas",
  skirts: "Faldas",
  faldas: "Faldas",
  // Bikers
  biker: "Bikers",
  bikers: "Bikers",
  "biker leggings": "Bikers",
  bikershorts: "Bikers",
  "biker shorts": "Bikers",
  // Abrigos (camperas, tapados, blazers, trench)
  coat: "Abrigos",
  coats: "Abrigos",
  jacket: "Abrigos",
  jackets: "Abrigos",
  blazer: "Abrigos",
  "trench coat": "Abrigos",
  trench: "Abrigos",
  camperas: "Abrigos",
  abrigos: "Abrigos",
  // Bodies
  body: "Bodies",
  bodies: "Bodies",
  bodysuit: "Bodies",
  // Mallas
  "bathing suit": "Mallas",
  swimwear: "Mallas",
  "swim suit": "Mallas",
  malla: "Mallas",
  mallas: "Mallas",
  // Monos
  mono: "Monos",
  monos: "Monos",
  jumpsuit: "Monos",
  romper: "Monos",
  // Accesorios
  accessories: "Accesorios",
  accessory: "Accesorios",
  accesorios: "Accesorios",
};

/**
 * Normaliza una categoría cruda (de la DB / Shopify) a la canónica en español.
 * Devuelve `CATEGORY_FALLBACK` para valores vacíos o desconocidos.
 */
export function normalizeCategory(raw: string | null | undefined): string {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return CATEGORY_FALLBACK;
  return CATEGORY_MAP[key] ?? CATEGORY_FALLBACK;
}
