import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { hasAccessRestriction, isEmailAllowed } from "@/lib/supabase/config";
import { normalizeRole, ROLE_HOME, type Role } from "@/lib/roles";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  // Solo rutas relativas propias: `//evil.com` o `https://evil.com` resuelven
  // a otro host si se concatenan directo en el redirect.
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : null;

  if (code) {
    const supabase = await createClient();
    // `data.user` viene del propio intercambio de código contra el Auth server, o sea
    // ya está validado: el getUser() que había acá era un viaje de red extra en el
    // camino crítico del login.
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const user = data.user;
      // Cuando el rol lo fija una invitación ya lo sabemos y nos ahorramos el
      // select de más abajo.
      let role: Role | null = null;

      // Enforce acceso: dominios/emails autorizados (env) o invitación puntual (DB).
      if (hasAccessRestriction()) {
        const email = (user?.email ?? "").toLowerCase();
        let allowed = isEmailAllowed(email);

        if (!allowed && email && isAdminConfigured()) {
          const admin = createAdminClient();
          const { data: inv } = await admin
            .from("invitations")
            .select("role, accepted_at")
            .eq("email", email)
            .maybeSingle();
          if (inv) {
            allowed = true;
            // Primera aceptación: aplicar el rol invitado y marcar aceptada.
            // Son dos tablas independientes: en serie eran dos viajes encadenados.
            if (user && !inv.accepted_at) {
              role = normalizeRole(inv.role);
              await Promise.all([
                admin.from("profiles").update({ role }).eq("id", user.id),
                admin
                  .from("invitations")
                  .update({ accepted_at: new Date().toISOString() })
                  .eq("email", email),
              ]);
            }
          }
        }

        if (!allowed) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/login?error=domain`);
        }
      }

      // Landing según rol (salvo que venga un `next` explícito).
      if (next) return NextResponse.redirect(`${origin}${next}`);
      if (!role) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user?.id ?? "")
          .maybeSingle();
        role = normalizeRole(profile?.role);
      }
      return NextResponse.redirect(`${origin}${ROLE_HOME[role]}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
