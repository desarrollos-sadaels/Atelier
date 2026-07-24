import "server-only";
import crypto from "node:crypto";
import { isVercelDeployment } from "@/lib/env";

/**
 * Cliente mínimo de la Meta Graph API (marketing insights).
 * La app deployada NO tiene acceso al MCP de Meta; habla con la Graph API
 * usando un token de larga duración con permiso `ads_read`.
 */

const API_VERSION = process.env.META_API_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;

/**
 * `appsecret_proof`: HMAC-SHA256 del access token, firmado con el app secret.
 *
 * Ata el token a nuestro backend. Como el token de System User no vence nunca,
 * esta es la protección que hace que un token filtrado no sirva de nada sin el
 * app secret — que solo vive en las env vars del server.
 *
 * OJO: firmar la llamada por sí solo NO protege. Hace falta activar además
 * "Require App Secret" en App Dashboard → Configuración → Avanzado → Seguridad.
 * Con el toggle apagado el parámetro es opcional del lado de Meta, así que
 * quien robe el token simplemente lo omite y la firma queda decorativa.
 */
function appsecretProof(token: string): string | null {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(token).digest("hex");
}

/** ¿Hay credenciales suficientes para consultar Meta? */
export function isMetaConfigured(): boolean {
  return Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
}

/** ID de cuenta con prefijo `act_` (acepta el valor con o sin prefijo). */
export function metaAccountId(): string {
  const raw = (process.env.META_AD_ACCOUNT_ID ?? "").trim();
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

/**
 * GET a la Graph API. `path` es relativo (ej: `act_123/insights` o
 * `<campaignId>/insights`). Devuelve el JSON parseado; lanza en error.
 */
export async function metaGraph<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN no configurado");

  // En los deploys la firma es obligatoria: si faltara el secreto, las llamadas
  // saldrían sin proof y la protección quedaría apagada sin que nadie se entere.
  const proof = appsecretProof(token);
  if (!proof && isVercelDeployment()) {
    throw new Error(
      "META_APP_SECRET no configurado: en producción las llamadas a Meta se firman con appsecret_proof.",
    );
  }

  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  url.searchParams.set("access_token", token);
  if (proof) url.searchParams.set("appsecret_proof", proof);

  const res = await fetch(url.toString(), {
    // Insights cambian lento; cacheamos 5 min para no golpear la API en cada render.
    next: { revalidate: 300 },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || `Meta API ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}
