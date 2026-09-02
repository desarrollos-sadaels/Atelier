import { NextResponse } from "next/server";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { syncProducts } from "@/lib/shopify/sync";
import { allowsInsecureLocalFallback } from "@/lib/env";
import { hasValidSecret } from "@/lib/secrets";

export const runtime = "nodejs";

/**
 * Autoriza el cron de Vercel o una corrida manual.
 *
 * Mismo patrón que /api/cron/daily-summary: cuando `CRON_SECRET` existe en el
 * proyecto, Vercel le agrega `Authorization: Bearer <CRON_SECRET>` a las
 * llamadas del cron y a nadie más. `SYNC_SECRET` queda para dispararlo a mano.
 */
function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (hasValidSecret(request, cronSecret, { allowHeader: false })) return true;

  const syncSecret = process.env.SYNC_SECRET;
  if (hasValidSecret(request, syncSecret)) return true;

  // Sin ningún secreto configurado, solo se permite en `next dev`. Antes esto
  // devolvía `true` sin más, así que un deploy al que le faltara la env var
  // dejaba el sync de todo el catálogo abierto a cualquiera.
  if (!cronSecret && !syncSecret) return allowsInsecureLocalFallback();
  return false;
}

/**
 * Reimporta el catálogo entero de Shopify.
 *
 * Corre por cron (ver `vercel.json`) además de a pedido. Los webhooks son el
 * mecanismo principal y este es la red: si se caen —o quedan apuntando a otro
 * deploy, que es lo que pasó entre junio y septiembre de 2026— el cron repara
 * la deriva en la corrida siguiente en vez de dejarla crecer en silencio.
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
  try {
    const result = await syncProducts();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// El cron de Vercel solo emite GET; el POST se conserva para las corridas
// manuales que ya estaban documentadas.
export const GET = run;
export const POST = run;
