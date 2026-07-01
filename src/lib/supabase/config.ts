export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Dominio de email permitido para login (ej: "tu-dominio.com"). Configurable por env. */
export const ALLOWED_EMAIL_DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN;

/**
 * Si no hay credenciales de Supabase, la app corre en modo demo (datos mock).
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Enforcement de auth real (middleware protege rutas, login usa Google).
 * Se activa solo cuando hay Supabase configurado Y el flag está en "true".
 * Permite cablear la DB (Fase 2) sin bloquear la navegación antes de
 * configurar el provider de Google + el dominio permitido.
 */
export function isAuthEnabled(): boolean {
  return isSupabaseConfigured() && process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
}
