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

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
