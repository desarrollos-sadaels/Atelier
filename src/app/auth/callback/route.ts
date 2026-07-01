import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/supabase/config";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Enforce allowed email domain (configurable via NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN).
      if (ALLOWED_EMAIL_DOMAIN) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const email = (user?.email ?? "").toLowerCase();
        if (!email.endsWith("@" + ALLOWED_EMAIL_DOMAIN.toLowerCase())) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/login?error=domain`);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
