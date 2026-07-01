import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAccessRestriction, isEmailAllowed } from "@/lib/supabase/config";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Enforce acceso: dominios autorizados (NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN)
      // o email puntual aprobado (NEXT_PUBLIC_ALLOWED_EMAILS).
      if (hasAccessRestriction()) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const email = (user?.email ?? "").toLowerCase();
        if (!isEmailAllowed(email)) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/login?error=domain`);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
