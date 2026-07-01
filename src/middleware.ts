import { NextResponse, type NextRequest } from "next/server";
import { isAuthEnabled } from "@/lib/supabase/config";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Auth not enabled yet (demo nav / DB-only): skip session enforcement.
  if (!isAuthEnabled()) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
