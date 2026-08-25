import { isVercelDeployment } from "@/lib/env";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const PUBLIC_APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

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
 * Regla: si hay Supabase configurado, la auth está PRENDIDA salvo que alguien
 * la apague a propósito. El default invertido es el punto — antes, fuera de
 * Vercel había que poner el flag en "true" para tener auth, así que una var
 * ausente o con un typo dejaba el middleware sin proteger nada y `requireRole()`
 * devolviendo identidad admin a cualquier request anónima. Un `next start` en
 * self-host, Docker o una VM abría la app entera contra datos reales.
 *
 * Dos capas:
 *
 * 1. En un deploy de Vercel (production o preview) la auth es innegociable: el
 *    flag ni se lee. Preview apunta a la misma base que production, así que
 *    cuenta como production a estos efectos.
 * 2. Fuera de Vercel el default también es prendida. Apagarla exige el opt-out
 *    explícito `NEXT_PUBLIC_AUTH_ENABLED=false`, pensado para ver una build
 *    local (`next build && next start`) sin tener que loguearse. Ausente,
 *    vacía o mal escrita ⇒ auth prendida.
 *
 * Queda un residuo asumido: un deploy fuera de Vercel que setee el flag en
 * "false" a mano se queda sin auth. Es una acción deliberada, no un descuido.
 */
export function isAuthEnabled(): boolean {
  if (!isSupabaseConfigured()) return false;
  if (isVercelDeployment()) return true;
  return process.env.NEXT_PUBLIC_AUTH_ENABLED !== "false";
}
