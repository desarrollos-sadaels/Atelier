import {
  clearAuthCookiesAtScopes,
  createServerClient,
  type SetAllCookies,
} from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
} from "@/lib/supabase/config";

type SignOutScope = "local" | "global";

function authStorageKey(): string {
  const projectRef = new URL(SUPABASE_URL!).hostname.split(".")[0];
  return `sb-${projectRef}-auth-token`;
}

/**
 * Cierra la sesión y escribe las cookies vencidas sobre la misma respuesta
 * que redirige al login. La limpieza explícita del final es intencional: si
 * Supabase no responde, el usuario igualmente debe poder salir de este
 * navegador en lugar de quedar atrapado entre /login y el proxy de auth.
 */
export async function signOutAndRedirect(
  request: NextRequest,
  scope: SignOutScope,
) {
  const response = NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );

  if (!isSupabaseConfigured()) return response;

  const getAll = () => request.cookies.getAll();
  const setAll: SetAllCookies = (cookiesToSet, headers) => {
    cookiesToSet.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options),
    );
    Object.entries(headers).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
  };

  const supabase = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: { getAll, setAll },
  });

  try {
    const { error } = await supabase.auth.signOut({ scope });
    if (error) console.error(`No se pudo revocar la sesión (${scope}).`, error);
  } catch (error) {
    console.error(`Falló el cierre de sesión (${scope}).`, error);
  } finally {
    // También cubre respuestas fallidas de Auth y cookies divididas en chunks.
    await clearAuthCookiesAtScopes({
      getAll,
      setAll,
      storageKey: authStorageKey(),
      scopes: [{}],
    });
  }

  return response;
}
