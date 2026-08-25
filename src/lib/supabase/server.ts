import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";
import type { Database } from "./types";

/**
 * En un Route Handler se puede pasar la respuesta que finalmente se devuelve.
 * Supabase escribe entonces cookies y headers anti-cache sobre esa respuesta.
 */
export async function createClient(response?: NextResponse) {
  const cookieStore = await cookies();
  const currentCookies = new Map(
    cookieStore.getAll().map(({ name, value }) => [name, { name, value }]),
  );
  return createServerClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return [...currentCookies.values()];
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          currentCookies.set(name, { name, value }),
        );

        if (response) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([name, value]) =>
            response.headers.set(name, value),
          );
          return;
        }

        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component — safe to ignore; middleware refreshes the session.
        }
      },
    },
  });
}
