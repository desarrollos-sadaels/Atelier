import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-auth";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/roles";
import { sendEmail, emailShell } from "@/lib/email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://atelier-six-iota.vercel.app";

/** Invitar un usuario por email (solo admin). Habilita su acceso + manda instrucciones. */
export async function POST(req: NextRequest) {
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  let body: { email?: unknown; role?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: "Email inválido" }, { status: 400 });
  }
  const role: Role = ROLES.includes(body.role as Role) ? (body.role as Role) : "vendedor";

  const supaAdmin = createAdminClient();
  const { error } = await supaAdmin
    .from("invitations")
    .upsert(
      { email, role, invited_by: auth.identity.userId, accepted_at: null },
      { onConflict: "email" },
    );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Email de invitación (gated: si no hay Resend configurado, queda pendiente).
  const mail = await sendEmail({
    to: email,
    subject: "Te invitaron a Atelier",
    html: emailShell(
      "Acceso a Atelier",
      `<p style="font-size:14px;line-height:1.6">Te dieron acceso a <strong>Atelier</strong> (control de stock de Sadaels) con el rol <strong>${ROLE_LABEL[role]}</strong>.</p>
       <p style="font-size:14px;line-height:1.6">Ingresá con tu cuenta de Google en:<br/>
       <a href="${APP_URL}/login" style="color:#c0392b">${APP_URL}/login</a></p>`,
    ),
  });

  return NextResponse.json({
    ok: true,
    email,
    role,
    emailSent: mail.ok,
    emailSkipped: Boolean(mail.skipped),
  });
}
