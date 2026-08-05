import { NextResponse, type NextRequest } from "next/server";
import { isAuthEnabled } from "@/lib/supabase/config";
import { updateSession } from "@/lib/supabase/middleware";

// `middleware.ts` quedó deprecado en Next 16.2 y se renombró a `proxy.ts`.
// Misma firma y mismo `config.matcher`; solo cambia el nombre del export.
export async function proxy(request: NextRequest) {
  // Sin auth (demo / solo DB, únicamente en local): no se enforza sesión.
  if (!isAuthEnabled()) return NextResponse.next();
  return updateSession(request);
}

// `/api` queda afuera a propósito: no está en PROTECTED, así que el proxy no tomaba
// ninguna decisión de acceso ahí, pero igual pagaba un getUser() contra el Auth server
// en cada llamada. Las rutas de API se autorizan solas (requireRole / SYNC_SECRET) y
// refrescan la sesión con su propio cliente, así que sacarlas no cambia el enforcement.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|auth|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
