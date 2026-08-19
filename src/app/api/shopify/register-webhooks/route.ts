import { NextResponse } from "next/server";
import { shopifyAdmin, isShopifyConfigured } from "@/lib/shopify/client";
import { allowsInsecureLocalFallback } from "@/lib/env";
import { hasValidSecret } from "@/lib/secrets";

const TOPICS = [
  "orders/create",
  "products/create",
  "products/update",
  "inventory_levels/update",
];

function authorized(request: Request): boolean {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    return hasValidSecret(request, secret);
  }
  // Sin SYNC_SECRET solo se permite en `next dev` (mismo criterio que
  // /api/shopify/sync): este endpoint reescribe los webhooks de la tienda.
  return allowsInsecureLocalFallback();
}

export async function POST(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!isShopifyConfigured())
    return NextResponse.json({ error: "Shopify no configurado" }, { status: 400 });

  const address = new URL(request.url).origin + "/api/shopify/webhooks";
  const results: Array<{ topic: string; status: string; detail?: string }> = [];

  for (const topic of TOPICS) {
    try {
      await shopifyAdmin("webhooks.json", {
        method: "POST",
        body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
      });
      results.push({ topic, status: "created" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const exists = msg.includes("already been taken") || msg.includes("422");
      results.push({
        topic,
        status: exists ? "exists" : "error",
        detail: exists ? undefined : msg.slice(0, 200),
      });
    }
  }
  return NextResponse.json({ address, results });
}

export async function GET(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!isShopifyConfigured())
    return NextResponse.json({ error: "Shopify no configurado" }, { status: 400 });
  const data = await shopifyAdmin<{
    webhooks: Array<{ id: number; topic: string; address: string }>;
  }>("webhooks.json");
  return NextResponse.json({
    webhooks: (data.webhooks || []).map((w) => ({ topic: w.topic, address: w.address })),
  });
}
