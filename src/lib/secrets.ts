import "server-only";
import crypto from "node:crypto";

/**
 * Compara dos strings en tiempo constante.
 *
 * `a === b` corta en el primer byte distinto, así que el tiempo de respuesta
 * filtra cuántos caracteres del secreto se acertaron. Es el mismo criterio que
 * ya usa el webhook de Shopify para el HMAC (`crypto.timingSafeEqual`); esto lo
 * extiende a los bearer tokens de SYNC_SECRET y CRON_SECRET.
 *
 * `timingSafeEqual` exige buffers del mismo largo — con largos distintos tira,
 * y ahí devolvemos false. Esa comparación de largo sí es variable en tiempo,
 * pero solo revela el tamaño del secreto, no su contenido.
 */
export function secretEquals(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * ¿La request trae el bearer token (o el header `x-sync-secret`) correcto?
 * Devuelve false si el secreto no está configurado — el llamador decide qué
 * hacer en ese caso (los endpoints fallan cerrado en los deploys).
 */
export function hasValidSecret(
  request: Request,
  expected: string | undefined,
  { allowHeader = true }: { allowHeader?: boolean } = {},
): boolean {
  if (!expected) return false;
  if (secretEquals(request.headers.get("authorization"), `Bearer ${expected}`)) return true;
  return allowHeader && secretEquals(request.headers.get("x-sync-secret"), expected);
}
