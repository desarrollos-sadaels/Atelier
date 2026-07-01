import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Cliente con service_role: SOLO para código server (sync de Shopify/Meta,
 * webhooks, crons). Bypassa RLS — nunca exponer al browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isAdminConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
