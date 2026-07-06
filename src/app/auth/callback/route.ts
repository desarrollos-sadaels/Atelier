import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAccessRestriction, isEmailAllowed } from "@/lib/supabase/config";
import { normalizeRole, ROLE_HOME } from "@/lib/roles";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Enforce acceso: dominios autorizados (NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN)
      // o email puntual aprobado (NEXT_PUBLIC_ALLOWED_EMAILS).
      if (hasAccessRestriction()) {
        const email = (user?.email ?? "").toLowerCase();
        if (!isEmailAllowed(email)) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/login?error=domain`);
        }
      }

      // Landing según rol (salvo que venga un `next` explícito).
      if (next) return NextResponse.redirect(`${origin}${next}`);
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user?.id ?? "")
        .maybeSingle();
      return NextResponse.redirect(`${origin}${ROLE_HOME[normalizeRole(profile?.role)]}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
