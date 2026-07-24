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
