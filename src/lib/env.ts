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
