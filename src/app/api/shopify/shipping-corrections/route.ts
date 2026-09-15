import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isShopifyConfigured } from "@/lib/shopify/client";
import {
  applyShippingCorrections,
  ORDERS_BACKFILL_DAYS,
  previewShippingCorrections,
} from "@/lib/shopify/orders";

export const runtime = "nodejs";
export const maxDuration = 300;

function configuredResponse() {
  if (isShopifyConfigured() && isAdminConfigured()) return null;
  return NextResponse.json(
    { ok: false, error: "Falta configurar Shopify o Supabase admin" },
    { status: 400 },
  );
}

/** Vista previa read-only para aprobar correcciones históricas. */
export async function GET(req: NextRequest) {
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const configError = configuredResponse();
  if (configError) return configError;

  const rawDays = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(rawDays) && rawDays > 0
    ? Math.min(Math.trunc(rawDays), 365)
    : ORDERS_BACKFILL_DAYS;
  try {
    const corrections = await previewShippingCorrections(createAdminClient(), { days });
    return NextResponse.json({ ok: true, days, corrections });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/** Aplica solo las órdenes cuyos ids fueron aprobados después de la vista previa. */
export async function PATCH(req: NextRequest) {
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const configError = configuredResponse();
  if (configError) return configError;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  const orderIds = Array.isArray(body.orderIds)
    ? [...new Set(body.orderIds.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)))]
    : [];
  if (!orderIds.length || orderIds.length > 50) {
    return NextResponse.json(
      { ok: false, error: "Indicá entre 1 y 50 ids de órdenes" },
      { status: 400 },
    );
  }

  try {
    const applied = await applyShippingCorrections(createAdminClient(), orderIds);
    return NextResponse.json({ ok: true, applied });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
