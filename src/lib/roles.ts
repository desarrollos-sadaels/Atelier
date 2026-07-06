/**
 * Modelo de roles de Atelier.
 * - admin: ve todo.
 * - medios: métricas, reportes y tracking de ventas + catálogo (solo lectura de ventas).
 * - vendedor: catálogo + pantalla de ventas (carga ventas).
 */
export type Role = "admin" | "medios" | "vendedor";

export const ROLES: Role[] = ["admin", "medios", "vendedor"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  medios: "Admin de medios",
  vendedor: "Vendedor",
};

/** Landing por rol (post-login y fallback ante rutas no permitidas). */
export const ROLE_HOME: Record<Role, string> = {
  admin: "/dashboard",
  medios: "/metricas",
  vendedor: "/ventas",
};

/** Prefijos de ruta permitidos por rol (admin ve todo). */
const ROLE_ROUTES: Record<Role, string[]> = {
  admin: ["/dashboard", "/catalogo", "/ventas", "/metricas", "/configuracion"],
  medios: ["/metricas", "/ventas", "/catalogo"],
  vendedor: ["/catalogo", "/ventas"],
};

export function normalizeRole(raw: string | null | undefined): Role {
  return raw === "admin" || raw === "medios" || raw === "vendedor" ? raw : "vendedor";
}

/** ¿Puede este rol acceder a esta ruta de la app? */
export function canAccess(role: Role, path: string): boolean {
  return ROLE_ROUTES[role].some((p) => path === p || path.startsWith(p + "/"));
}

/** Items de navegación visibles por rol. */
export function navForRole(role: Role): { label: string; href: string }[] {
  const ALL = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Catálogo", href: "/catalogo" },
    { label: "Ventas", href: "/ventas" },
    { label: "Métricas", href: "/metricas" },
    { label: "Config", href: "/configuracion" },
  ];
  return ALL.filter((i) => canAccess(role, i.href));
}
