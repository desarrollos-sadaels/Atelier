import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function isServiceRoleKey(key: string | undefined): boolean {
  if (!key) return false;
  // Claves secret nuevas de Supabase.
  if (key.startsWith("sb_secret_")) return true;
  // Claves JWT legacy: validar al menos el claim de rol para no aceptar por
  // error una anon key en la variable privilegiada.
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      role?: unknown;
    };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

/**
 * Cliente con service_role: SOLO para código server (sync de Shopify/Meta,
 * webhooks, crons). Bypassa RLS — nunca exponer al browser.
 */
export function createAdminClient() {
  if (!isAdminConfigured()) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY no es una clave service_role/secret válida");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    isServiceRoleKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
