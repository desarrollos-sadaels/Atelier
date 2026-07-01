import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// Verificación rápida de la conexión a la DB con la service_role key.
export async function GET() {
  if (!isAdminConfigured()) {
    return NextResponse.json({
      ok: false,
      reason: "Falta SUPABASE_SERVICE_ROLE_KEY en .env.local",
    });
  }
  try {
    const supa = createAdminClient();
    const { count, error } = await supa
      .from("products")
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, products: count ?? 0 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
