import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from "@/lib/supabase/config";

export async function POST(request: NextRequest) {
  // Construimos el redirect primero y escribimos las cookies expiradas sobre
  // ESTA respuesta, para que el navegador reciba los Set-Cookie del signOut.
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });

  if (isSupabaseConfigured()) {
    const supabase = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    await supabase.auth.signOut();
  }

  return response;
}
