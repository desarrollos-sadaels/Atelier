import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import type { TablesUpdate } from "@/lib/supabase/types";
import {
  isMissingWorkshopColumns,
  upsertWorkshopSale,
  workshopSaleKey,
} from "@/lib/workshop-sales";

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function workshopStatus(value: unknown): "pending_send" | "in_process" | "finished" {
  if (value === "finished" || value === "in_process") return value;
  return "pending_send";
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
  if (!customerName || !productId) {
    return NextResponse.json(
      { ok: false, error: "Cliente y producto son obligatorios" },
      { status: 400 },
    );
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
  const [{ data: product }, { data: existing }] = await Promise.all([
    supaAdmin.from("products").select("id, name").eq("id", productId).maybeSingle(),
    supaAdmin
      .from("workshop_orders")
      .select("id, created_at, created_by, created_by_name, completed_at")
      .eq("id", id)
      .maybeSingle(),
  ]);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Pedido inexistente" }, { status: 404 });
  }
  if (!product) {
    return NextResponse.json({ ok: false, error: "Producto inexistente" }, { status: 400 });
  }

  const status = workshopStatus(body.status);
  const basePatch: TablesUpdate<"workshop_orders"> = {
    customer_name: customerName,
    customer_contact: clean(body.customerContact, 160),
    product_id: product.id,
    product_name: product.name,
    color: clean(body.color, 80),
    talle: clean(body.talle, 40),
    detail: clean(body.detail, 4000),
    status,
    completed_at: status === "finished" ? existing.completed_at ?? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const patch: TablesUpdate<"workshop_orders"> = {
    ...basePatch,
    variant_label: clean(body.variantLabel, 160),
    price,
    shipping_amount: shippingAmount,
  };

  let { data, error } = await supaAdmin
    .from("workshop_orders")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  let usedLegacySchema = false;
  if (error && isMissingWorkshopColumns(error)) {
    usedLegacySchema = true;
    const fallback = await supaAdmin
      .from("workshop_orders")
      .update(basePatch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Pedido inexistente" }, { status: 404 });

  if (usedLegacySchema) {
    try {
      await upsertWorkshopSale(supaAdmin, {
        id: data.id,
        createdAt: existing.created_at,
        createdBy: existing.created_by,
        createdByName: existing.created_by_name,
        customerName,
        customerContact: basePatch.customer_contact ?? null,
        productId: product.id,
        productName: product.name,
        color: basePatch.color ?? null,
        talle: basePatch.talle ?? null,
        price,
        shippingAmount,
        detail: basePatch.detail ?? null,
      });
    } catch (saleError) {
      return NextResponse.json(
        {
          ok: false,
          error: saleError instanceof Error ? saleError.message : "No se pudo actualizar la venta de Taller",
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRole(["admin", "vendedor"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  const supaAdmin = createAdminClient();
  const { data: linkedSale } = await supaAdmin
    .from("sales")
    .select("id")
    .eq("idempotency_key", workshopSaleKey(id))
    .maybeSingle();

  const { data, error } = await supaAdmin
    .from("workshop_orders")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Pedido inexistente" }, { status: 404 });

  // Con 0021 la FK ya lo eliminó en cascada. En el esquema anterior esta
  // segunda operación limpia el espejo creado por compatibilidad.
  if (linkedSale) {
    const { error: saleError } = await supaAdmin.from("sales").delete().eq("id", linkedSale.id);
    if (saleError) {
      return NextResponse.json({ ok: false, error: saleError.message }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, id });
}
