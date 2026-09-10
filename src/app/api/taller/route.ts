import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/supabase/types";
import { isMissingWorkshopColumns, upsertWorkshopSale } from "@/lib/workshop-sales";

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function workshopStatus(value: unknown): "pending_send" | "in_process" | "finished" {
  if (value === "finished" || value === "in_process") return value;
  return "pending_send";
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(["admin", "vendedor"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const customerName = clean(body.customerName, 120);
  const productId = clean(body.productId, 80);
  if (!customerName) {
    return NextResponse.json({ ok: false, error: "El cliente es obligatorio" }, { status: 400 });
  }
  if (!productId) {
    return NextResponse.json({ ok: false, error: "El producto es obligatorio" }, { status: 400 });
  }

  const price = body.price == null || body.price === "" ? Number.NaN : Number(body.price);
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ ok: false, error: "El precio es obligatorio" }, { status: 400 });
  }
  const shippingAmount = body.shippingAmount == null || body.shippingAmount === ""
    ? 0
    : Number(body.shippingAmount);
  if (!Number.isFinite(shippingAmount) || shippingAmount < 0) {
    return NextResponse.json({ ok: false, error: "Costo de envío inválido" }, { status: 400 });
  }

  const supaAdmin = createAdminClient();
  const { data: product } = await supaAdmin
    .from("products")
    .select("id, name")
    .eq("id", productId)
    .maybeSingle();
  if (!product) {
    return NextResponse.json({ ok: false, error: "Producto inexistente" }, { status: 400 });
  }

  const status = workshopStatus(body.status);
  const baseRow: TablesInsert<"workshop_orders"> = {
    customer_name: customerName,
    customer_contact: clean(body.customerContact, 160),
    product_id: product.id,
    product_name: product.name,
    color: clean(body.color, 80),
    talle: clean(body.talle, 40),
    detail: clean(body.detail, 4000),
    status,
    completed_at: status === "finished" ? new Date().toISOString() : null,
    created_by: auth.identity.userId,
    created_by_name: auth.identity.name,
  };
  const row: TablesInsert<"workshop_orders"> = {
    ...baseRow,
    variant_label: clean(body.variantLabel, 160),
    price,
    shipping_amount: shippingAmount,
  };

  let { data, error } = await supaAdmin
    .from("workshop_orders")
    .insert(row)
    .select("*")
    .single();

  let usedLegacySchema = false;
  if (error && isMissingWorkshopColumns(error)) {
    usedLegacySchema = true;
    const fallback = await supaAdmin
      .from("workshop_orders")
      .insert(baseRow)
      .select("*")
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json({ ok: false, error: "No se pudo crear el pedido" }, { status: 500 });
  }

  if (usedLegacySchema) {
    try {
      await upsertWorkshopSale(supaAdmin, {
        id: data.id,
        createdAt: data.created_at,
        createdBy: data.created_by,
        createdByName: data.created_by_name,
        customerName: data.customer_name,
        customerContact: data.customer_contact,
        productId: data.product_id,
        productName: data.product_name,
        color: data.color,
        talle: data.talle,
        price,
        shippingAmount,
        detail: data.detail,
      });
    } catch (saleError) {
      await supaAdmin.from("workshop_orders").delete().eq("id", data.id);
      return NextResponse.json(
        {
          ok: false,
          error: saleError instanceof Error ? saleError.message : "No se pudo crear la venta de Taller",
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    order: {
      ...data,
      price,
      shipping_amount: shippingAmount,
      variant_label: clean(body.variantLabel, 160),
    },
  });
}
