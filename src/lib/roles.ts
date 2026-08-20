import { isSupabaseConfigured } from "@/lib/supabase/config";

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

/**
 * Rol para decisiones de UI cuando no hay perfil. Son dos casos distintos que
 * antes se confundían en un `?? "admin"`:
 *
 * - Sin Supabase configurado es modo demo (datos mock, no hay a quién
 *   consultarle el rol): la UI se muestra completa, que es el punto de la demo.
 * - Con backend, un perfil ausente es una sesión que no resolvió. Ahí hay que
 *   fallar CERRADO, igual que `normalizeRole`, y no regalar la vista de admin.
 *
 * Es solo cosmético — todas las APIs revalidan el rol server-side — pero el
 * default no debería apuntar al lado permisivo.
 */
export function uiRole(role: Role | null | undefined): Role {
  if (role) return role;
  return isSupabaseConfigured() ? "vendedor" : "admin";
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
