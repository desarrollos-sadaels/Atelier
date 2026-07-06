import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isAuthEnabled } from "@/lib/supabase/config";
import { normalizeRole, type Role } from "@/lib/roles";

export type ApiIdentity = {
  userId: string | null;
  name: string;
  role: Role;
};

/**
 * Autoriza la request por rol. Devuelve la identidad si el rol está permitido,
 * o `{ error, status }` para responder. Con auth deshabilitado (demo) permite todo.
 */
export async function requireRole(
  allowed: Role[],
): Promise<{ identity: ApiIdentity } | { error: string; status: number }> {
  if (!isAuthEnabled()) {
    return { identity: { userId: null, name: "Demo", role: "admin" } };
  }
  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "No autenticado", status: 401 };

  const { data: profile } = await supa
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", user.id)
    .maybeSingle();
  const role = normalizeRole(profile?.role);
  if (!allowed.includes(role)) return { error: "No autorizado para esta acción", status: 403 };

  return {
    identity: {
      userId: user.id,
      name: profile?.full_name ?? profile?.email ?? user.email ?? "—",
      role,
    },
  };
}
