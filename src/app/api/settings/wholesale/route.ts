import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-auth";
import { validateWholesaleSettings } from "@/lib/wholesale";

/** Configuración comercial mayorista: descuento sobre PVP y tiendas habilitadas. */
export async function PATCH(req: NextRequest) {
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  let body: { settings?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const settings = validateWholesaleSettings(body.settings);
  if (!settings) {
    return NextResponse.json(
      {
        ok: false,
        error: "Definí un descuento entre 0 y 100 y al menos una tienda, sin nombres duplicados",
      },
      { status: 400 },
    );
  }

  const { error } = await createAdminClient()
    .from("app_settings")
    .upsert({ key: "wholesale_settings", value: settings, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, settings });
}
