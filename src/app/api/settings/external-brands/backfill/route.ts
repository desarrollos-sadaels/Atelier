import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/api-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { findExternalBrand, parseExternalBrands } from "@/lib/external-brands";

/** Aplica la configuración vigente solo a prendas históricas aún sin tasa. */
export async function POST() {
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: settings, error: settingsError } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "external_brands")
    .maybeSingle();
  if (settingsError) {
    return NextResponse.json({ ok: false, error: settingsError.message }, { status: 500 });
  }
  const brands = parseExternalBrands(settings?.value);
  let cursor: string | null = null;
  let updated = 0;

  // Cursor por ID: al actualizar una fila desaparece del filtro de pendientes.
  // Paginación con offset saltearía las filas siguientes.
  for (;;) {
    let query = supabase
      .from("sale_items")
      .select("id,brand")
      .eq("is_other_brand", true)
      .is("external_brand_rate", null)
      .order("id")
      .limit(500);
    if (cursor) query = query.gt("id", cursor);
    const { data: rows, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message, updated }, { status: 500 });
    }
    if (!rows?.length) break;

    const byRate = new Map<number, string[]>();
    for (const row of rows) {
      const brand = findExternalBrand(row.brand, brands);
      if (!brand) continue;
      const rate = brand.percentage / 100;
      byRate.set(rate, [...(byRate.get(rate) ?? []), row.id]);
    }
    for (const [rate, ids] of byRate) {
      const { data: changed, error: updateError } = await supabase
        .from("sale_items")
        .update({ external_brand_rate: rate })
        .in("id", ids)
        .is("external_brand_rate", null)
        .select("id");
      if (updateError) {
        return NextResponse.json({ ok: false, error: updateError.message, updated }, { status: 500 });
      }
      updated += changed?.length ?? 0;
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < 500) break;
  }

  revalidatePath("/ventas");
  revalidatePath("/ventas/reporte");
  revalidatePath("/dashboard");
  return NextResponse.json({ ok: true, updated });
}
