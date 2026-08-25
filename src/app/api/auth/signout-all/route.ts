import type { NextRequest } from "next/server";
import { signOutAndRedirect } from "@/lib/supabase/signout";

/**
 * Cierra la sesión en TODOS los dispositivos (revoca refresh tokens) y
 * redirige a /login. Escribe las cookies expiradas sobre el propio redirect.
 */
export async function POST(request: NextRequest) {
  return signOutAndRedirect(request, "global");
}
