import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Lee la key saneando lo que el dashboard de Vercel NO sanea.
 *
 * Vercel guarda el valor literal de la env var: si se pegó con comillas
 * alrededor o con un espacio/salto de línea colado, eso llega tal cual. Como el
 * chequeo de abajo es un `startsWith`, un solo carácter de más lo hacía fallar
 * con el mismo mensaje que si la variable no existiera — y el 503 resultante no
 * daba forma de distinguir un caso del otro (QA 2026-09-01).
 */
function readKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim().replace(/^["']|["']$/g, "");
}

function isServiceRoleKey(key: string): boolean {
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
 * Por qué falla `isAdminConfigured()`, en texto seguro de mostrar en una
 * respuesta HTTP: describe la FORMA de la clave, nunca su contenido.
 *
 * Existe porque este error solo se manifiesta en endpoints de máquina
 * (webhooks, crons, sync) donde nadie mira los logs, y "clave inválida" a secas
 * no dice si falta, si es la publishable o si vino con comillas.
 */
export function adminConfigProblem(): string | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return "falta NEXT_PUBLIC_SUPABASE_URL";

  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw || !raw.trim()) return "falta SUPABASE_SERVICE_ROLE_KEY";

  const key = readKey();
  if (isServiceRoleKey(key)) return null;

  if (key.startsWith("sb_publishable_")) {
    return "SUPABASE_SERVICE_ROLE_KEY tiene la clave PUBLISHABLE (sb_publishable_…); hace falta la secreta (sb_secret_…)";
  }
  if (key.split(".").length === 3) {
    return "SUPABASE_SERVICE_ROLE_KEY es un JWT que no declara role=service_role (¿la anon key?)";
  }
  if (key !== raw) {
    return `SUPABASE_SERVICE_ROLE_KEY no tiene un formato reconocido (${key.length} chars, y el valor traía comillas o espacios de más)`;
  }
  return `SUPABASE_SERVICE_ROLE_KEY no tiene un formato reconocido (${key.length} chars; se esperaba sb_secret_… o un JWT service_role)`;
}

/**
 * Cliente con service_role: SOLO para código server (sync de Shopify/Meta,
 * webhooks, crons). Bypassa RLS — nunca exponer al browser.
 */
export function createAdminClient() {
  const problem = adminConfigProblem();
  if (problem) throw new Error(problem);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // La normalizada, no `process.env` crudo: si el valor venía entre comillas,
  // mandarlo tal cual daría un 401 de Supabase mucho más difícil de leer.
  return createClient<Database>(url, readKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isAdminConfigured(): boolean {
  return adminConfigProblem() === null;
}
