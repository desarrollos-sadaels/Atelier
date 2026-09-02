import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api-auth";
import { restockItem } from "@/lib/sales-ops";

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

/**
 * Devolver prendas de una compra.
 *
 * La unidad es la PRENDA, no la compra: el cliente lleva tres y devuelve una.
 * El cuerpo manda `itemIds`; sin él se devuelve todo lo que quede activo, que
 * es el atajo de "devolvió toda la compra".
 *
 * Las filas NO se borran. El botón Eliminar (DELETE) existe para el error de
 * carga —una venta que nunca ocurrió— y ahí borrar es lo correcto. Una
 * devolución es lo contrario: ocurrió, y el mes tiene que poder explicar por
 * qué cerró más bajo, con qué prenda y de qué vendedor.
 *
 * El orden es a propósito: primero Shopify, después la base. Si la reposición
 * falla, `restockItem` lanza y esa prenda queda intacta y activa — que es el
 * estado verdadero, porque no volvió al inventario. Al revés, figuraría
 * devuelta con el stock todavía descontado.
 *
 * Cuando se devuelven varias, cada una se resuelve por separado: que falle la
 * reposición de una no puede impedir que las otras se registren. Las que no
 * pudieron volver se informan en `failed`.
 */
export async function POST(
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

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // Sin body: se devuelve la compra entera y sin motivo.
  }
  const reason = str(body.reason);
  const requested = Array.isArray(body.itemIds)
    ? body.itemIds.filter((v): v is string => typeof v === "string")
    : null;

  const supaAdmin = createAdminClient();
  const { data: sale, error: fetchErr } = await supaAdmin
    .from("sales")
    .select(
      "id, seller_id, sale_items(id, article, qty, product_id, variant_gid, stock_deducted, status, exchange_of_item_id)",
    )
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });

  // Mismo criterio que el PATCH: el vendedor devuelve las suyas y las que no
  // tienen dueño (las de Shopify llegan así); el admin, todas. No se distingue
  // "no existe" de "es de otro" para no confirmar ids ajenos.
  const owned =
    auth.identity.role === "admin" ||
    (Boolean(auth.identity.userId) &&
      (sale?.seller_id === null || sale?.seller_id === auth.identity.userId));
  if (!sale || !owned) {
    return NextResponse.json(
      { ok: false, error: "Venta inexistente o de otro vendedor" },
      { status: 404 },
    );
  }

  const active = (sale.sale_items ?? []).filter((i) => i.status === "active");
  const targets = requested ? active.filter((i) => requested.includes(i.id)) : active;

  if (!targets.length) {
    return NextResponse.json(
      {
        ok: false,
        error: requested?.length
          ? "Esas prendas ya están devueltas o cambiadas."
          : "La compra no tiene prendas para devolver.",
      },
      { status: 409 },
    );
  }

  const returnedIds: string[] = [];
  const failed: { article: string; error: string }[] = [];
  let restockedCount = 0;

  for (const item of targets) {
    try {
      const result = await restockItem(supaAdmin, item);
      if (result.restocked) restockedCount++;
    } catch (e) {
      failed.push({ article: item.article, error: e instanceof Error ? e.message : "error" });
      continue;
    }

    const { error } = await supaAdmin
      .from("sale_items")
      .update({
        status: "returned",
        // Deja de sumar al mes. La fila sobrevive para el reporte de devoluciones.
        counts_revenue: false,
        returned_at: new Date().toISOString(),
        return_reason: reason,
      })
      .eq("id", item.id);

    if (error) {
      failed.push({
        article: item.article,
        error:
          `el stock se repuso en Shopify pero la prenda NO quedó marcada como devuelta (${error.message}). ` +
          "Reintentá: la reposición no se va a duplicar.",
      });
      continue;
    }
    returnedIds.push(item.id);

    // Devolver la prenda de un cambio anula ese cambio: la original ya había
    // vuelto al stock, así que el cliente no se quedó con nada. Su plata
    // tampoco puede seguir contando.
    if (item.exchange_of_item_id) {
      await supaAdmin
        .from("sale_items")
        .update({
          status: "returned",
          counts_revenue: false,
          exchange_adjustment: 0,
          returned_at: new Date().toISOString(),
          return_reason: reason ?? "Se devolvió la prenda del cambio",
        })
        .eq("id", item.exchange_of_item_id);
    }
  }

  if (!returnedIds.length) {
    return NextResponse.json(
      {
        ok: false,
        error: `No se registró la devolución: ${failed.map((f) => `${f.article}: ${f.error}`).join(" · ")}`,
      },
      { status: 500 },
    );
  }

  // El estado de la compra ('active' / 'returned') y `has_returns` los recalcula
  // el trigger `sale_items_sync_status` a partir de sus prendas: no se escriben
  // acá. Era justamente el tipo de cosa que se olvidaba en uno de los caminos.
  return NextResponse.json({
    ok: true,
    id,
    returned: returnedIds.length,
    restocked: restockedCount,
    warning: failed.length
      ? `No se pudieron devolver: ${failed.map((f) => `${f.article} (${f.error})`).join(" · ")}`
      : undefined,
  });
}
