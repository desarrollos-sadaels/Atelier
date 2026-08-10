import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isVercelDeployment } from "@/lib/env";
import { hasValidSecret } from "@/lib/secrets";

/**
 * Diagnóstico de conexión a la DB (usa la service_role key).
 *
 * Va protegido con SYNC_SECRET, igual que /api/shopify/sync: antes respondía a
 * cualquiera, filtraba el tamaño del catálogo y cada llamada ejecutaba un count
 * con la service_role — un vector barato para quemar cuota de Supabase.
 */
function authorized(request: Request): boolean {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    return hasValidSecret(request, secret);
  }
  return !isVercelDeployment();
}

export async function GET(request: Request) {
  if (!authorized(request)) return new NextResponse("No autorizado", { status: 401 });
  if (!isAdminConfigured()) {
    return NextResponse.json({
      ok: false,
      reason: "Falta SUPABASE_SERVICE_ROLE_KEY en el entorno",
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
