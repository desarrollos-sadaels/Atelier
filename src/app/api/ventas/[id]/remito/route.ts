import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  renderSaleDeliveryNotePdf,
  saleDeliveryNoteFilename,
  type SaleDeliveryNoteInput,
} from "@/lib/sale-delivery-note-pdf";

export const runtime = "nodejs";

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

  const supa = createAdminClient();
  const { data: sale, error } = await supa
    .from("sales")
    .select(
      "id, sold_at, customer_name, customer_dni, customer_contact, customer_address, seller_name, pos, payment_method, installments, notes, delivered, preorder, status, sale_discount, shipping_amount, shopify_order_name, wholesale_store, sale_items(id, article, brand, color, talle, qty, price, discount, status, counts_revenue, exchange_adjustment)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: "No se pudo consultar la venta" }, { status: 500 });
  }
  if (!sale) {
    return NextResponse.json({ ok: false, error: "Venta no encontrada" }, { status: 404 });
  }
  if (!sale.sale_items?.length) {
    return NextResponse.json({ ok: false, error: "La venta no tiene prendas" }, { status: 409 });
  }

  try {
    const input: SaleDeliveryNoteInput = { sale, items: sale.sale_items };
    const pdf = await renderSaleDeliveryNotePdf(input);
    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${saleDeliveryNoteFilename(input.sale)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (cause) {
    console.error("Error generando remito de venta", cause);
    return NextResponse.json({ ok: false, error: "No se pudo generar el remito" }, { status: 500 });
  }
}
