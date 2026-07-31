import { NextResponse } from "next/server";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { syncProducts } from "@/lib/shopify/sync";
import { isVercelDeployment } from "@/lib/env";

function authorized(request: Request): boolean {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    return auth === `Bearer ${secret}` || request.headers.get("x-sync-secret") === secret;
  }
  // Sin SYNC_SECRET solo se permite en local. Antes esto devolvía `true` sin
  // más, así que un deploy al que le faltara la env var dejaba el sync de todo
  // el catálogo abierto a cualquiera.
  return !isVercelDeployment();
}

export async function POST(request: Request) {
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
