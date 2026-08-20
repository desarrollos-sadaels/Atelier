import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/queries";
import { isAuthEnabled } from "@/lib/supabase/config";
import { ROLE_HOME } from "@/lib/roles";
import { ConfiguracionClient } from "./ConfiguracionClient";

/**
 * Gate server-side de /configuracion.
 *
 * La página es un client component y hasta ahora su única defensa era el proxy
 * (`ROLE_ROUTES` en middleware). Las demás páginas de admin llevan además este
 * chequeo redundante; ésta no lo tenía, así que la autorización de la ruta
 * colgaba de una sola capa. El proxy sigue siendo el filtro de entrada — el
 * "check medio" — y esto lo respalda leyendo el rol de la DB en el render.
 *
 * Las mutaciones ya estaban cubiertas aparte: todo lo que este panel escribe va
 * por APIs detrás de `requireRole(["admin"])`.
 */
export default async function ConfiguracionPage() {
  // Con auth apagada (demo, sin backend) no hay perfil que chequear.
  if (isAuthEnabled()) {
    const profile = await getCurrentProfile();
    if (!profile) redirect("/login");
    if (profile.role !== "admin") redirect(ROLE_HOME[profile.role]);
  }

  return <ConfiguracionClient />;
}
