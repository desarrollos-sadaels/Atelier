import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { getPickerProducts } from "@/lib/queries";

/**
 * Catálogo reducido para el buscador de prendas del cambio.
 *
 * Existe para no cargarlo en el server de `/ventas`: son 404 productos que
 * viajarían en cada render del listado, y solo hacen falta cuando alguien abre
 * el diálogo de cambio. El alta de venta sí lo trae desde el server, porque ahí
 * el buscador es lo primero que se usa.
 */
export async function GET() {
  const auth = await requireRole(["admin", "vendedor"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({ ok: true, products: await getPickerProducts() });
}
