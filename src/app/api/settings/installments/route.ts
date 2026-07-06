import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-auth";

/** Actualizar las opciones de cuotas configurables (solo admin). */
export async function PATCH(req: NextRequest) {
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  let body: { options?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const options = Array.isArray(body.options)
    ? [...new Set(body.options.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n) && n > 0 && n <= 60))].sort(
        (a, b) => a - b,
      )
    : [];
  if (!options.length) {
    return NextResponse.json({ ok: false, error: "Ingresá al menos una opción de cuotas" }, { status: 400 });
  }

  const supaAdmin = createAdminClient();
  const { error } = await supaAdmin
    .from("app_settings")
    .upsert({ key: "installment_options", value: options, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, options });
}
