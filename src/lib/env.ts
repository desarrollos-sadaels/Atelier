/**
 * Detección de entorno, en un solo lugar.
 *
 * Regla: todo lo que sea un chequeo de seguridad tiene que fallar CERRADO en
 * los deploys. Los flags y secretos opcionales pueden relajar el acceso en
 * local, nunca en production ni en preview (un preview apunta a la misma base
 * de datos real, así que cuenta como producción a estos efectos).
 *
 * OJO: `VERCEL_ENV` no llega al bundle del browser. Esto es solo para server.
 */
export function isVercelDeployment(): boolean {
  const env = process.env.VERCEL_ENV;
  return env === "production" || env === "preview";
}

/**
 * ¿Este proceso puede relajar un chequeo de seguridad por falta de secreto?
 *
 * Solo `next dev`. Antes los endpoints de máquina preguntaban por
 * `!isVercelDeployment()`, así que la garantía dependía del hosting: un
 * `next start` en self-host, Docker o una VM, sin `SYNC_SECRET`/`CRON_SECRET`
 * seteados, dejaba abiertos el sync del catálogo, el registro de webhooks, el
 * resumen diario y el health con service_role.
 *
 * Ahora exige las dos cosas: no ser un deploy de Vercel Y no ser un build de
 * producción. Cualquier `next build` queda fail-closed corra donde corra, y el
 * único modo de habilitar esos endpoints ahí es configurarles el secreto.
 */
export function allowsInsecureLocalFallback(): boolean {
  return !isVercelDeployment() && process.env.NODE_ENV !== "production";
}

/** Normaliza a origen (`https://host`), tolerando que falte el esquema. */
function toOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).origin;
  } catch {
    return null;
  }
}

/**
 * Origen público y ESTABLE de la app.
 *
 * Existe por un incidente concreto (QA 2026-09-01): `/api/shopify/register-webhooks`
 * derivaba la address de `new URL(request.url).origin`, así que los webhooks
 * quedaron clavados en la URL del deploy desde el que se llamó al endpoint —
 * en 2026-06-26, un proyecto de Vercel que después se abandonó. Shopify siguió
 * entregando ahí durante meses, contra la base vieja, mientras la base nueva se
 * congelaba sin que nada avisara.
 *
 * Por eso el orden de preferencia nunca mira la request:
 *
 * 1. `NEXT_PUBLIC_APP_URL` — el dominio propio, si lo hay.
 * 2. `VERCEL_PROJECT_PRODUCTION_URL` — Vercel la setea con el dominio de
 *    PRODUCCIÓN del proyecto y la expone también en los previews. O sea que
 *    registrar los webhooks desde un preview igual apunta a producción, que es
 *    lo que uno quiere: un preview es efímero y su URL muere con él.
 *
 * Devuelve null si no hay ninguna: el llamador decide si cae a la request
 * (solo aceptable en `next dev`) o si falla.
 */
export function publicAppOrigin(): string | null {
  for (const raw of [process.env.NEXT_PUBLIC_APP_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    const origin = raw ? toOrigin(raw) : null;
    if (origin) return origin;
  }
  return null;
}
