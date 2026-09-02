import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireRole, type ApiIdentity } from "@/lib/api-auth";
import { restockItem } from "@/lib/sales-ops";
import { isValidInvoicePath } from "@/lib/sales";
import type { Tables, TablesUpdate } from "@/lib/supabase/types";

type Supa = ReturnType<typeof createAdminClient>;
type Sale = Tables<"sales">;

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

/**
 * ¿Puede esta identidad editar esta venta?
 *
 * El admin puede con todas. El vendedor puede con las suyas y, además, con las
 * que no tienen dueño: eso es lo que habilita el caso que motivó todo esto —
 * una venta que entró por Shopify (`seller_id` null porque la hizo el sitio) y
 * que en realidad la cerró un vendedor por WhatsApp. Reclamarla es una edición
 * como cualquier otra, no un permiso especial.
 *
 * `medios` no llega hasta acá: `requireRole` ya lo frena.
 */
function canEdit(identity: ApiIdentity, sale: Pick<Sale, "seller_id">): boolean {
  if (identity.role === "admin") return true;
  if (!identity.userId) return false;
  return sale.seller_id === null || sale.seller_id === identity.userId;
}

/** Datos del cliente, si el body trae el objeto. */
function customerPatch(body: Record<string, unknown>): TablesUpdate<"sales"> {
  const c = body.customer;
  if (!c || typeof c !== "object") return {};
  const src = c as Record<string, unknown>;
  const patch: TablesUpdate<"sales"> = {};
  if ("name" in src) patch.customer_name = str(src.name);
  if ("dni" in src) patch.customer_dni = str(src.dni);
  if ("contact" in src) patch.customer_contact = str(src.contact);
  if ("address" in src) patch.customer_address = str(src.address);
  return patch;
}

/**
 * Editar una venta.
 *
 * Nació como dos toggles (entregado / factura) y ahora es la edición completa
 * de los datos comerciales, porque una venta importada de Shopify llega sin
 * nada de eso: sin vendedor, sin canal real, sin factura. El artículo, la
 * cantidad y la variante NO se editan por acá — mover cualquiera de esos
 * desincronizaría el stock de Shopify sin un movimiento de inventario que lo
 * acompañe. Para eso están la devolución y el cambio.
 */
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

  const supaAdmin = createAdminClient();

  // Este handler escribe con service_role, así que la RLS de `sales` (UPDATE
  // solo admin) queda bypasseada y el chequeo de pertenencia hay que hacerlo
  // acá. Sin esto, cualquier vendedor podría editar una venta ajena mandando
  // el id.
  const { data: sale, error: fetchErr } = await supaAdmin
    .from("sales")
    .select("id, seller_id, origin, status")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }
  // No distinguimos "no existe" de "es de otro" para no confirmar ids ajenos.
  if (!sale || !canEdit(auth.identity, sale)) {
    return NextResponse.json(
      { ok: false, error: "Venta inexistente o de otro vendedor" },
      { status: 404 },
    );
  }

  const patch: TablesUpdate<"sales"> = {};

  // --- Siempre editables, incluso sobre una venta devuelta o cambiada: son
  // --- datos administrativos que se cargan tarde (la factura sobre todo).
  if (typeof body.invoiced === "boolean") patch.invoiced = body.invoiced;
  if ("invoicePath" in body) {
    const path = str(body.invoicePath);
    // El path lo manda el cliente y después `/api/ventas/[id]/factura` lo firma
    // con service_role, que ignora RLS. Solo se acepta la forma que produce
    // nuestro uploader.
    if (path && !isValidInvoicePath(path)) {
      return NextResponse.json({ ok: false, error: "Factura inválida" }, { status: 400 });
    }
    patch.invoice_path = path;
    if (path) patch.invoiced = true;
  }
  if ("notes" in body) patch.notes = str(body.notes);

  // --- El resto solo tiene sentido sobre una compra viva. Editar el canal o el
  // --- medio de pago de una compra íntegramente devuelta solo confunde al
  // --- reporte. Una devolución PARCIAL no bloquea nada: la compra sigue
  // --- activa y sus prendas restantes todavía se entregan y se facturan.
  const liveFields =
    "delivered" in body ||
    "pos" in body ||
    "paymentMethod" in body ||
    "installments" in body ||
    "claim" in body ||
    "sellerId" in body ||
    "saleDiscount" in body ||
    "customer" in body;

  if (liveFields && sale.status !== "active") {
    return NextResponse.json(
      { ok: false, error: "La compra está devuelta: solo se puede editar la factura y las notas." },
      { status: 409 },
    );
  }

  if (typeof body.delivered === "boolean") patch.delivered = body.delivered;
  if ("pos" in body) patch.pos = str(body.pos);
  if ("paymentMethod" in body) patch.payment_method = str(body.paymentMethod);
  if ("installments" in body) {
    const n = Math.trunc(Number(body.installments));
    patch.installments = Number.isFinite(n) && n > 0 ? n : null;
  }
  Object.assign(patch, customerPatch(body));

  // Reclamar la venta: "esta la hice yo". El caso central de las ventas de
  // Shopify, que llegan sin vendedor.
  if (body.claim === true) {
    if (!auth.identity.userId) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    patch.seller_id = auth.identity.userId;
    patch.seller_name = auth.identity.name;
  } else if ("sellerId" in body) {
    // Asignársela a otra persona es cosa del admin: un vendedor que pudiera
    // hacerlo podría sacarse de encima una venta propia o atribuírsela a otro.
    if (auth.identity.role !== "admin") {
      return NextResponse.json(
        { ok: false, error: "Solo un administrador puede asignar la venta a otra persona" },
        { status: 403 },
      );
    }
    const sellerId = str(body.sellerId);
    if (sellerId) {
      const { data: profile } = await supaAdmin
        .from("profiles")
        .select("id, full_name, email")
        .eq("id", sellerId)
        .maybeSingle();
      if (!profile) {
        return NextResponse.json({ ok: false, error: "Vendedor inexistente" }, { status: 400 });
      }
      patch.seller_id = profile.id;
      patch.seller_name = profile.full_name?.trim() || profile.email || "—";
    } else {
      patch.seller_id = null;
      patch.seller_name = null;
    }
  }

  // Descuento general de la compra: solo admin, y solo sobre ventas cargadas en
  // el Atelier. En una compra de Shopify los importes los fijó la tienda (y ya
  // vienen prorrateados por línea en `discount_allocations`); meter acá un
  // descuento encima haría que el reporte de Atelier y el de Shopify dejaran de
  // cerrar, sin nada que explique la diferencia.
  if ("saleDiscount" in body) {
    if (auth.identity.role !== "admin") {
      return NextResponse.json(
        { ok: false, error: "Solo un administrador puede corregir el descuento" },
        { status: 403 },
      );
    }
    if (sale.origin === "shopify") {
      return NextResponse.json(
        { ok: false, error: "Los importes de una venta de Shopify los fija la tienda" },
        { status: 409 },
      );
    }
    const discount = Number(body.saleDiscount) || 0;
    if (discount < 0 || discount >= 1) {
      return NextResponse.json({ ok: false, error: "Descuento inválido" }, { status: 400 });
    }
    patch.sale_discount = discount;
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ ok: false, error: "Nada para actualizar" }, { status: 400 });
  }

  const { error } = await supaAdmin.from("sales").update(patch).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id });
}

/**
 * Eliminar una compra entera (solo admin). Repone el stock de cada prenda que
 * lo haya descontado.
 *
 * Queda para el error de carga —una venta que nunca existió— y por eso sigue
 * borrando de verdad. Una devolución real va por `POST .../devolucion`, que
 * conserva las filas: el mes tiene que poder explicar por qué cerró más bajo.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  }

  const supaAdmin: Supa = createAdminClient();
  const { data: sale, error: fetchErr } = await supaAdmin
    .from("sales")
    .select("id, sale_items(id, article, qty, product_id, variant_gid, stock_deducted)")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  if (!sale) return NextResponse.json({ ok: false, error: "Venta no encontrada" }, { status: 404 });

  // Reponer TODO antes de borrar nada. Si una prenda no puede volver al
  // inventario, se aborta con la compra intacta: es preferible una venta que
  // sigue ahí a un borrado que deja stock perdido y ya no se puede rastrear.
  for (const item of sale.sale_items ?? []) {
    try {
      await restockItem(supaAdmin, item);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error reponiendo stock";
      return NextResponse.json(
        { ok: false, error: `No se eliminó la venta ("${item.article}"): ${msg}` },
        { status: 500 },
      );
    }
  }

  // Las prendas se van solas: `sale_items.sale_id` es ON DELETE CASCADE.
  const { error } = await supaAdmin.from("sales").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id });
}
