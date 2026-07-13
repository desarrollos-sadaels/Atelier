import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapProduct } from "@/lib/shopify/sync";
import { notifyLowStock } from "@/lib/notify";

export const runtime = "nodejs";

function verifyHmac(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const digest = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(header));
  } catch {
    return false;
  }
}

type Supa = ReturnType<typeof createAdminClient>;

async function handleOrder(order: { line_items?: Array<{ sku?: string; quantity?: number }> }, supa: Supa) {
  for (const li of order.line_items ?? []) {
    if (!li.sku) continue;
    const { data: rows } = await supa
      .from("products")
      .select("id,name,stock,alert_threshold")
      .eq("sku", li.sku)
      .limit(1);
    const prod = rows?.[0];
    if (!prod) continue;

    const newStock = Math.max(0, (prod.stock ?? 0) - (li.quantity ?? 0));
    await supa
      .from("products")
      .update({ stock: newStock, updated_at: new Date().toISOString() })
      .eq("id", prod.id);

    await notifyLowStock(supa, {
      productId: prod.id,
      name: prod.name,
      newStock,
      alertThreshold: prod.alert_threshold ?? 0,
    });
  }
}

export async function POST(request: Request) {
  const secret =
    process.env.SHOPIFY_WEBHOOK_SECRET ||
    process.env.SHOPIFY_CLIENT_SECRET ||
    process.env.SHOPIFY_API_SECRET;
  if (!secret) return new NextResponse("Webhook no configurado", { status: 503 });

  const raw = await request.text();
  if (!verifyHmac(raw, request.headers.get("x-shopify-hmac-sha256"), secret)) {
    return new NextResponse("HMAC inválido", { status: 401 });
  }

  const topic = request.headers.get("x-shopify-topic") || "";
  const payload = JSON.parse(raw);
  const supa = createAdminClient();

  try {
    if (topic === "products/create" || topic === "products/update") {
      await supa.from("products").upsert(mapProduct(payload), { onConflict: "shopify_id" });
    } else if (topic === "orders/create") {
      await handleOrder(payload, supa);
    }
    // inventory_levels/update: requiere mapear inventory_item_id → producto;
    // por ahora se reconcilia con el sync periódico (Vercel Cron, Fase 4).
    return NextResponse.json({ ok: true, topic });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
