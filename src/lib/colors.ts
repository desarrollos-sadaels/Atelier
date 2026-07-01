// Mapa de nombres de color (ES/EN, moda) → hex. Claves sin acentos, en minúscula.
const COLOR_MAP: Record<string, string> = {
  negro: "#141414",
  black: "#141414",
  blanco: "#FFFFFF",
  white: "#FFFFFF",
  "off white": "#F3EFE6",
  offwhite: "#F3EFE6",
  crudo: "#EFE7D6",
  hueso: "#ECE5D6",
  marfil: "#FBF7E9",
  nude: "#E3BC9A",
  beige: "#D9C3A5",
  arena: "#D9C7A8",
  gris: "#9AA0A6",
  grey: "#9AA0A6",
  gray: "#9AA0A6",
  plomo: "#6B7177",
  rojo: "#D62828",
  red: "#D62828",
  bordo: "#6E1423",
  vino: "#6E1423",
  rosa: "#F4A6C0",
  rosado: "#F4A6C0",
  pink: "#F4A6C0",
  fucsia: "#E0218A",
  coral: "#FF6F61",
  naranja: "#F77F00",
  orange: "#F77F00",
  terracota: "#C66B3D",
  amarillo: "#F4B400",
  yellow: "#F4B400",
  mostaza: "#D8A200",
  dorado: "#C9A227",
  gold: "#C9A227",
  verde: "#2E7D32",
  green: "#2E7D32",
  oliva: "#6B8E23",
  militar: "#4B5320",
  menta: "#9FE2BF",
  turquesa: "#1FB6B6",
  turquoise: "#1FB6B6",
  celeste: "#7EC8E3",
  cyan: "#27B6C9",
  azul: "#1D4ED8",
  blue: "#1D4ED8",
  marino: "#1B2A4A",
  navy: "#1B2A4A",
  violeta: "#7C3AED",
  purple: "#7C3AED",
  lila: "#B197FC",
  lavanda: "#C9BCF5",
  marron: "#6B4226",
  brown: "#6B4226",
  camel: "#C19A6B",
  caqui: "#C3B091",
  khaki: "#C3B091",
  cobre: "#B87333",
  plateado: "#C0C0C0",
  silver: "#C0C0C0",
};

const DIACRITICS = /[̀-ͯ]/g;

function normalize(name: string): string {
  return name.trim().toLowerCase().normalize("NFD").replace(DIACRITICS, "");
}

/** hex del color por nombre, o null si es desconocido. */
export function colorToHex(name: string): string | null {
  const n = normalize(name);
  return COLOR_MAP[n] ?? COLOR_MAP[n.replace(/\s+/g, "")] ?? null;
}

/** ¿El color es claro? (para decidir borde y color del check). */
export function isLightColor(hex: string): boolean {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // luminancia percibida
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.8;
}
