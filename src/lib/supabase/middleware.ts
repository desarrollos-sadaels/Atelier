import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";
import { canAccess, normalizeRole, ROLE_HOME } from "@/lib/roles";

const PROTECTED = [
  "/dashboard",
  "/catalogo",
  "/ventas",
  "/metricas",
  "/configuracion",
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  let pendingCookies: Parameters<SetAllCookies>[0] = [];
  const pendingHeaders: Record<string, string> = {};

  function withSession(target: NextResponse) {
    pendingCookies.forEach(({ name, value, options }) =>
      target.cookies.set(name, value, options),
    );
    Object.entries(pendingHeaders).forEach(([name, value]) =>
      target.headers.set(name, value),
    );
    return target;
  }

  const supabase = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        pendingCookies = [...pendingCookies, ...cookiesToSet];
        Object.assign(pendingHeaders, headers);
        response = withSession(NextResponse.next({ request }));
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return withSession(NextResponse.redirect(url));
  }

  if (user && (isProtected || path === "/login")) {
    // Rol del usuario (equipo chico: un select liviano por request es aceptable).
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const role = normalizeRole(profile?.role);
    const home = ROLE_HOME[role];

    if (path === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = home;
      return withSession(NextResponse.redirect(url));
    }

    if (isProtected && !canAccess(role, path)) {
      const url = request.nextUrl.clone();
      url.pathname = home;
      return withSession(NextResponse.redirect(url));
    }
  }

  return response;
}
