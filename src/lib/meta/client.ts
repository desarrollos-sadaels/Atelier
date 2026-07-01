import "server-only";

/**
 * Cliente mínimo de la Meta Graph API (marketing insights).
 * La app deployada NO tiene acceso al MCP de Meta; habla con la Graph API
 * usando un token de larga duración con permiso `ads_read`.
 */

const API_VERSION = process.env.META_API_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;

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

  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  url.searchParams.set("access_token", token);

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
