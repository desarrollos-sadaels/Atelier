import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-auth";

/** Redirige a una signed URL de la factura adjunta (bucket privado). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRole(["admin", "medios", "vendedor"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  const supaAdmin = createAdminClient();
  const { data: sale } = await supaAdmin
    .from("sales")
    .select("invoice_path")
    .eq("id", id)
    .maybeSingle();
  if (!sale?.invoice_path) {
    return NextResponse.json({ ok: false, error: "Sin factura adjunta" }, { status: 404 });
  }

  const { data, error } = await supaAdmin.storage
    .from("invoices")
    .createSignedUrl(sale.invoice_path, 120);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ ok: false, error: "No se pudo generar el acceso" }, { status: 500 });
  }
  return NextResponse.redirect(data.signedUrl);
}
