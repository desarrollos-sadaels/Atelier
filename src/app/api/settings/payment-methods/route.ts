import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-auth";
import { parsePaymentMethods } from "@/lib/payments";

/** Actualizar los métodos de pago configurables (solo admin). */
export async function PATCH(req: NextRequest) {
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  let body: { methods?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  // Normaliza y deduplica; exige al menos un método con nombre válido.
  const methods = parsePaymentMethods(body.methods);
  if (!Array.isArray(body.methods) || methods.length === 0) {
    return NextResponse.json({ ok: false, error: "Definí al menos un método de pago" }, { status: 400 });
  }

  const supaAdmin = createAdminClient();
  const { error } = await supaAdmin
    .from("app_settings")
    .upsert({ key: "payment_methods", value: methods, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, methods });
}
