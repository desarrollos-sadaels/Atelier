import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { deliveryNoteType } from "@/lib/delivery-notes";
import { deductLoanItem } from "@/lib/delivery-notes-server";
import type { TablesInsert } from "@/lib/supabase/types";

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

function date(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

type ParsedItem = {
  productId: string | null;
  inventoryItemId: string | null;
  variantGid: string | null;
  article: string;
  color: string | null;
  talle: string | null;
  qty: number;
  unitPrice: number;
  discount: number;
};

function parseItem(raw: unknown, index: number): ParsedItem | { error: string } {
  if (!raw || typeof raw !== "object") return { error: `Ítem ${index + 1}: datos inválidos` };
  const item = raw as Record<string, unknown>;
  const article = text(item.article, 180);
  const qty = Math.trunc(Number(item.qty));
  const unitPrice = Number(item.unitPrice);
  const discount = Number(item.discount) || 0;
  if (!article) return { error: `Ítem ${index + 1}: falta el artículo` };
  if (!Number.isFinite(qty) || qty <= 0) return { error: `Ítem ${index + 1}: cantidad inválida` };
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: `Ítem ${index + 1}: precio inválido` };
  if (discount < 0 || discount >= 1) return { error: `Ítem ${index + 1}: descuento inválido` };
  return {
    productId: text(item.productId, 80),
    inventoryItemId: text(item.inventoryItemId, 180),
    variantGid: text(item.variantGid, 180),
    article,
    color: text(item.color, 80),
    talle: text(item.talle, 40),
    qty,
    unitPrice,
    discount,
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(["admin", "vendedor"]);
  if ("error" in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const type = deliveryNoteType(body.type);
  const allowOversell = Boolean(body.allowOversell);
  const customerName = text(body.customerName, 160);
  const issuedAt = date(body.issuedAt);
  if (!type) return NextResponse.json({ ok: false, error: "Tipo de remito inválido" }, { status: 400 });
  if (!customerName) return NextResponse.json({ ok: false, error: "El cliente es obligatorio" }, { status: 400 });

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length || rawItems.length > 50) {
    return NextResponse.json({ ok: false, error: "El remito debe tener entre 1 y 50 ítems" }, { status: 400 });
  }
  const items: ParsedItem[] = [];
  for (const [index, raw] of rawItems.entries()) {
    const parsed = parseItem(raw, index);
    if ("error" in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    items.push(parsed);
  }

  const supa = createAdminClient();
  const header: TablesInsert<"delivery_notes"> = {
    ...(issuedAt ? { issued_at: issuedAt } : {}),
    created_by: auth.identity.userId,
    created_by_name: auth.identity.name,
    type,
    status: "issued",
    customer_name: customerName,
    customer_contact: text(body.customerContact, 180),
    customer_address: text(body.customerAddress, 300),
    loan_due_at: type === "loan" ? date(body.loanDueAt) : null,
    notes: text(body.notes, 4000),
  };
  const { data: note, error: headerError } = await supa
    .from("delivery_notes")
    .insert(header)
    .select("id, number")
    .single();
  if (headerError || !note) {
    return NextResponse.json({ ok: false, error: headerError?.message ?? "No se pudo crear el remito" }, { status: 500 });
  }

  const rows: TablesInsert<"delivery_note_items">[] = items.map((item) => ({
    delivery_note_id: note.id,
    product_id: item.productId,
    inventory_item_id: item.inventoryItemId,
    variant_gid: item.variantGid,
    article: item.article,
    color: item.color,
    talle: item.talle,
    qty: item.qty,
    unit_price: item.unitPrice,
    discount: item.discount,
  }));
  const { data: created, error: itemError } = await supa
    .from("delivery_note_items")
    .insert(rows)
    .select("id");
  if (itemError || !created?.length) {
    await supa.from("delivery_notes").delete().eq("id", note.id);
    return NextResponse.json({ ok: false, error: itemError?.message ?? "No se pudieron guardar los ítems" }, { status: 500 });
  }

  const warnings: string[] = [];
  if (type === "loan") {
    for (const [index, item] of items.entries()) {
      const warning = await deductLoanItem(supa, {
        ...item,
        id: created[index].id,
        allowOversell,
      });
      if (warning) warnings.push(warning);
    }
  }

  return NextResponse.json({
    ok: true,
    id: note.id,
    number: note.number,
    warning: warnings.length ? warnings.join(" · ") : undefined,
  });
}
