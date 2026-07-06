import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-auth";
import { ROLES, type Role } from "@/lib/roles";

/** Cambiar el rol de un usuario (solo admin). */
export async function PATCH(req: NextRequest) {
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  let body: { userId?: unknown; role?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  const role = body.role as Role;
  if (!userId || !ROLES.includes(role)) {
    return NextResponse.json({ ok: false, error: "userId o rol inválido" }, { status: 400 });
  }
  // Un admin no puede sacarse el rol a sí mismo (evita quedarse sin admins por accidente).
  if (userId === auth.identity.userId && role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "No podés quitarte el rol de administrador a vos mismo" },
      { status: 400 },
    );
  }

  const supaAdmin = createAdminClient();
  const { error } = await supaAdmin.from("profiles").update({ role }).eq("id", userId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, userId, role });
}
