import { isVercelDeployment } from "@/lib/env";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Dominios de email permitidos para login (coma-separados).
 * Ej: "lanzallamas.tv, sadaels.com". Configurable por env.
 */
export const ALLOWED_EMAIL_DOMAINS = (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/**
 * Emails puntuales aprobados además de los dominios (coma-separados).
 * Ej: "juan@otra.com". Útil para invitados de un dominio no aprobado.
 */
export const ALLOWED_EMAILS = (process.env.NEXT_PUBLIC_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** ¿Hay alguna restricción de acceso configurada? */
export function hasAccessRestriction(): boolean {
  return ALLOWED_EMAIL_DOMAINS.length > 0 || ALLOWED_EMAILS.length > 0;
}

/**
 * ¿Este email puede loguear? Permitido si su dominio está autorizado
 * O está en la lista explícita de emails. Si no hay ninguna restricción
 * configurada, permite todo (modo abierto).
 */
export function isEmailAllowed(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!hasAccessRestriction()) return true;
  if (ALLOWED_EMAIL_DOMAINS.some((d) => e.endsWith("@" + d))) return true;
  return ALLOWED_EMAILS.includes(e);
}

/**
 * Si no hay credenciales de Supabase, la app corre en modo demo (datos mock).
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Enforcement de auth real (middleware protege rutas, login usa Google).
 *
 * En cualquier deploy de Vercel (production o preview) la auth es OBLIGATORIA:
 * el flag no puede apagarla. Antes, si `NEXT_PUBLIC_AUTH_ENABLED` faltaba o
 * tenía un typo, el middleware dejaba de proteger las rutas y `requireRole()`
 * devolvía identidad admin a cualquier request anónima — un error de tipeo en
 * una env var abría la app entera contra datos reales.
 *
 * El flag sigue existiendo solo para desarrollo local, donde permite cablear
 * la DB sin configurar el provider de Google + el dominio permitido.
 *
 * SOLO SERVER: `VERCEL_ENV` no está en el bundle del browser, así que en el
 * cliente esta función no puede distinguir producción de local. Para decidir
 * algo en un client component usá `isSupabaseConfigured()`.
 */
export function isAuthEnabled(): boolean {
  if (!isSupabaseConfigured()) return false;
  if (isVercelDeployment()) return true;
  return process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
}
