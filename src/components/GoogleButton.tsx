"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Google } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured, ALLOWED_EMAIL_DOMAINS } from "@/lib/supabase/config";

export function GoogleButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    // Si hay backend, siempre se loguea de verdad. Antes esto miraba el flag
    // `NEXT_PUBLIC_AUTH_ENABLED`, que en el bundle del browser puede estar
    // ausente aunque el server sí esté exigiendo auth: el botón entraba por el
    // atajo demo y el usuario quedaba sin sesión. El atajo ahora existe solo
    // cuando no hay Supabase configurado (mock puro, sin backend al que entrar).
    if (isSupabaseConfigured()) {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${location.origin}/auth/callback`,
          // `hd` filtra el selector de Google a un único dominio Workspace;
          // solo lo aplicamos si hay exactamente un dominio permitido.
          queryParams:
            ALLOWED_EMAIL_DOMAINS.length === 1
              ? { hd: ALLOWED_EMAIL_DOMAINS[0], prompt: "select_account" }
              : { prompt: "select_account" },
        },
      });
      if (error) setLoading(false);
      // On success the browser redirects to Google.
    } else {
      // Demo mode: no backend — go straight to the dashboard.
      setTimeout(() => router.push("/dashboard"), 700);
    }
  }

  return (
    <button
      onClick={signIn}
      disabled={loading}
      className="mt-8 flex h-14 w-full items-center justify-center gap-3 rounded-full bg-ink text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-70"
    >
      {loading ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          Ingresando…
        </>
      ) : (
        <>
          <span className="grid h-6 w-6 place-items-center rounded-md bg-white">
            <Google />
          </span>
          Continuar con Google
        </>
      )}
    </button>
  );
}
