import { NextResponse } from "next/server";
import { isShopifyConfigured } from "@/lib/shopify/client";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { syncProducts } from "@/lib/shopify/sync";

function authorized(request: Request): boolean {
  const secret = process.env.SYNC_SECRET;
  // En dev (sin SYNC_SECRET) se permite libremente; en prod exige el secreto.
  if (!secret) return true;
  if (request.headers.get("x-vercel-cron")) return true; // Vercel Cron
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}` || request.headers.get("x-sync-secret") === secret;
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
