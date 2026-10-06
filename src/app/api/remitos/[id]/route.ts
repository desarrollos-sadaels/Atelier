import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { deliveryNoteStatus } from "@/lib/delivery-notes";
import type { DeliveryNoteItemRow } from "@/lib/delivery-notes";
import { restockLoanItem } from "@/lib/delivery-notes-server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
  const status = deliveryNoteStatus(body.status);
  if (status !== "returned" && status !== "cancelled") {
    return NextResponse.json({ ok: false, error: "Estado inválido" }, { status: 400 });
  }

  const supa = createAdminClient();
  const { data: note, error } = await supa
    .from("delivery_notes")
    .select("id, type, status, delivery_note_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!note) return NextResponse.json({ ok: false, error: "Remito inexistente" }, { status: 404 });
  if (note.status === status) return NextResponse.json({ ok: true, id, status });
  if (note.status !== "issued") {
    return NextResponse.json({ ok: false, error: "El remito ya está cerrado" }, { status: 409 });
  }
  if (status === "returned" && note.type !== "loan") {
    return NextResponse.json({ ok: false, error: "Solo un préstamo puede marcarse devuelto" }, { status: 400 });
  }

  if (note.type === "loan") {
    try {
      for (const item of note.delivery_note_items as DeliveryNoteItemRow[]) {
        await restockLoanItem(supa, item);
      }
    } catch (cause) {
      return NextResponse.json(
        { ok: false, error: `No se cerró el préstamo: ${cause instanceof Error ? cause.message : String(cause)}` },
        { status: 500 },
      );
    }
  }

  const { data: updated, error: updateError } = await supa
    .from("delivery_notes")
    .update({
      status,
      returned_at: status === "returned" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "issued")
    .select("id");
  if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  if (!updated?.length) {
    return NextResponse.json({ ok: false, error: "El remito cambió de estado; recargá la página" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, id, status });
}
