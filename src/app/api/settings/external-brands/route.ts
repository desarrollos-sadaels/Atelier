import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-auth";
import { validateExternalBrands } from "@/lib/external-brands";

/** Solo administración puede cambiar la participación de las marcas externas. */
export async function PATCH(req: NextRequest) {
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  let body: { brands?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  const brands = validateExternalBrands(body.brands);
  if (!brands) {
    return NextResponse.json(
      { ok: false, error: "Definí al menos una marca, sin duplicados y con porcentajes entre 0 y 100" },
      { status: 400 },
    );
  }

  const { error } = await createAdminClient()
    .from("app_settings")
    .upsert({ key: "external_brands", value: brands, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, brands });
}
