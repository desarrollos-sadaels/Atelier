const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

export function isShopifyConfigured(): boolean {
  return Boolean(
    process.env.SHOPIFY_STORE_DOMAIN &&
      process.env.SHOPIFY_CLIENT_ID &&
      process.env.SHOPIFY_CLIENT_SECRET,
  );
}

// Cache en memoria del token (client credentials grant → válido 24h).
let cached: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const id = process.env.SHOPIFY_CLIENT_ID;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!domain || !id || !secret) throw new Error("Shopify no configurado");

  const now = Date.now();
  if (cached && cached.exp > now + 60_000) return cached.token;

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify token ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: data.access_token, exp: now + (data.expires_in ?? 86399) * 1000 };
  return cached.token;
}

/** Llama a la Admin REST API de Shopify. `path` ej: "products.json?limit=250". */
export async function shopifyAdmin<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error("Shopify no configurado");
  const token = await getAccessToken();

  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/${path}`, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);

  // Los DELETE de la Admin REST API contestan 200 con el body vacío, y
  // `res.json()` sobre un body vacío tira. Devolvemos undefined en ese caso.
  const body = await res.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

/** Llama a la Admin GraphQL API de Shopify. */
export async function shopifyGraphql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error("Shopify no configurado");
  const token = await getAccessToken();

  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

// Location de inventario (cacheada en memoria).
let cachedLocation: string | null = null;

/**
 * Primera location de la tienda. Fallback, no la vía principal.
 *
 * OJO con los campos que se piden acá: `isPrimary`, `isActive` y `name`
 * requieren el scope `read_locations`, que esta app NO tiene (tiene
 * write_inventory, read_inventory, read_orders, read_products, write_products).
 * Pedirlos hacía fallar la query entera con ACCESS_DENIED y, como
 * `adjustInventory` la llamaba siempre, NINGUNA venta lograba descontar stock
 * (descubierto probando el flujo real, QA 2026-09-02). `id` solo sí está
 * permitido.
 *
 * Sin `isPrimary` no hay forma de saber cuál es la principal, así que esto sirve
 * únicamente mientras haya una sola location — hoy es el caso. La vía correcta
 * es `locationForInventoryItems()`, que deduce la ubicación del propio item.
 */
export async function getFallbackLocationId(): Promise<string> {
  if (cachedLocation) return cachedLocation;
  const data = await shopifyGraphql<{ locations: { nodes: { id: string }[] } }>(
    `{ locations(first: 1) { nodes { id } } }`,
  );
  const first = data.locations.nodes[0];
  if (!first) throw new Error("Shopify: la tienda no tiene ninguna location");
  cachedLocation = first.id;
  return cachedLocation;
}

/** Igual que shopifyAdmin pero devuelve también el path de la página siguiente (cursor REST). */
export async function shopifyAdminPage<T = unknown>(
  path: string,
): Promise<{ data: T; next: string | null }> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error("Shopify no configurado");
  const token = await getAccessToken();

  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/${path}`, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as T;
  const link = res.headers.get("link") || res.headers.get("Link") || "";
  const m = link.match(/<[^>]*[?&]page_info=([^>&]+)[^>]*>;\s*rel="next"/);
  const limitMatch = path.match(/[?&]limit=(\d+)/);
  const limit = limitMatch ? limitMatch[1] : "250";
  const base = path.split("?")[0];
  const next = m ? `${base}?limit=${limit}&page_info=${m[1]}` : null;
  return { data, next };
}
