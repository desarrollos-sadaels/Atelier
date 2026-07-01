"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Google } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { isAuthEnabled, ALLOWED_EMAIL_DOMAIN } from "@/lib/supabase/config";

export function GoogleButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    if (isAuthEnabled()) {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${location.origin}/auth/callback`,
          queryParams: ALLOWED_EMAIL_DOMAIN
            ? { hd: ALLOWED_EMAIL_DOMAIN, prompt: "select_account" }
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
