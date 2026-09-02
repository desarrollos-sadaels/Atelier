import { NextResponse } from "next/server";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { syncOrders, ORDERS_BACKFILL_DAYS } from "@/lib/shopify/orders";
import { allowsInsecureLocalFallback } from "@/lib/env";
import { hasValidSecret } from "@/lib/secrets";

export const runtime = "nodejs";
// Un backfill largo pagina de a 250 órdenes y hace varias consultas por línea.
export const maxDuration = 300;

/**
 * Autoriza el cron de Vercel o una corrida manual. Mismo patrón que
 * /api/shopify/sync: `CRON_SECRET` lo pone Vercel en las llamadas del cron,
 * `SYNC_SECRET` queda para dispararlo a mano.
 */
function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (hasValidSecret(request, cronSecret, { allowHeader: false })) return true;

  const syncSecret = process.env.SYNC_SECRET;
  if (hasValidSecret(request, syncSecret)) return true;

  // Sin ningún secreto configurado, solo se permite en `next dev`: este
  // endpoint lee órdenes, o sea datos personales de clientes.
  if (!cronSecret && !syncSecret) return allowsInsecureLocalFallback();
  return false;
}

/**
 * Importa las órdenes de Shopify como ventas.
 *
 * Los webhooks son el mecanismo principal; esto es la red. Ya pasó una vez que
 * los webhooks quedaran apuntando a un deploy abandonado durante tres meses
 * (junio–septiembre 2026) sin que nada avisara: con este cron, una venta que se
 * pierda aparece en la corrida de esa noche en vez de faltar para siempre.
 *
 * También es el backfill inicial: `?days=90` (el default) trae el trimestre.
 */
async function run(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!isShopifyConfigured() || !isAdminConfigured()) {
    return NextResponse.json(
      { error: "Falta configurar Shopify o SUPABASE_SERVICE_ROLE_KEY." },
      { status: 400 },
    );
  }

  const raw = Number(new URL(request.url).searchParams.get("days"));
  // Tope de un año: más que eso es un pedido a mano contra la API de Shopify,
  // no algo que deba poder disparar una URL.
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(Math.trunc(raw), 365) : ORDERS_BACKFILL_DAYS;

  try {
    const result = await syncOrders(createAdminClient(), { days });
    return NextResponse.json({ ok: true, days, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
