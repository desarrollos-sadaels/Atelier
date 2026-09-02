import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient, adminConfigProblem } from "@/lib/supabase/admin";
import { mapProduct } from "@/lib/shopify/sync";
import { getProductIdByInventoryItem, getProductVariants } from "@/lib/shopify/inventory";
import {
  fetchOrder,
  importOrder,
  type MatchedProduct,
  type ShopifyOrder,
} from "@/lib/shopify/orders";
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

const PRODUCT_FIELDS = "id,shopify_id,name,alert_threshold";

/**
 * Releer el stock real de un producto desde Shopify (fuente de verdad) y
 * reflejarlo en la DB. Usado por cualquier webhook que toque inventario: evita
 * el problema de descontar sobre un número cacheado, que se pisa si llegan dos
 * eventos concurrentes para el mismo producto.
 */
async function reconcileStock(supa: Supa, prod: MatchedProduct) {
  if (!prod.shopify_id) return;
  const fresh = await getProductVariants(prod.shopify_id);
  if (!fresh) return;
  const { error } = await supa
    .from("products")
    .update({ stock: fresh.total, updated_at: new Date().toISOString() })
    .eq("id", prod.id);
  if (error) throw error;

  await notifyLowStock(supa, {
    productId: prod.id,
    name: prod.name,
    newStock: fresh.total,
    alertThreshold: prod.alert_threshold ?? 0,
  });
}

/**
 * Una orden de Shopify hace DOS cosas acá, y hasta la 0017 solo hacía la
 * primera: reconciliar el stock de los productos que tocó. Faltaba la segunda —
 * registrarla como venta — así que el listado de Ventas mostraba únicamente lo
 * cargado a mano en el local, y la mitad online del negocio no existía para
 * Atelier.
 *
 * El import va primero porque es lo que no se puede recuperar solo: si falla,
 * el cron de `sync-orders` la levanta más tarde, pero conviene que el error se
 * vea en la respuesta del webhook (Shopify reintenta).
 */
async function handleOrder(order: ShopifyOrder, supa: Supa) {
  const { products } = await importOrder(order, supa);
  for (const prod of products) {
    await reconcileStock(supa, prod);
  }
}

async function handleInventoryLevel(
  payload: { inventory_item_id?: number | string },
  supa: Supa,
) {
  if (payload.inventory_item_id == null) return;
  const shopifyId = await getProductIdByInventoryItem(
    `gid://shopify/InventoryItem/${payload.inventory_item_id}`,
  );
  if (!shopifyId) return;
  const { data: prod } = await supa
    .from("products")
    .select(PRODUCT_FIELDS)
    .eq("shopify_id", shopifyId)
    .maybeSingle();
  if (!prod) return;
  await reconcileStock(supa, prod);
}

/**
 * `refunds/create` trae el reembolso, no la orden. Se relee la orden completa
 * para recalcular qué líneas quedaron devueltas: un reembolso parcial devuelve
 * una prenda de tres, y sin el estado completo de la orden no hay forma de
 * saber cuáles.
 */
async function handleRefund(payload: { order_id?: number | string }, supa: Supa) {
  if (payload.order_id == null) return;
  const order = await fetchOrder(payload.order_id);
  if (order) await handleOrder(order, supa);
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

  // El detalle describe la FORMA de la env var, nunca su contenido. Este 503 es
  // el único síntoma visible cuando la config de prod está mal, y llega acá
  // recién después de validar el HMAC: o sea que quien lo lee ya probó ser
  // Shopify. Sin el detalle no hay forma de saber si falta la clave o si está
  // puesta la publishable.
  const configProblem = adminConfigProblem();
  if (configProblem) {
    return new NextResponse(`Supabase mal configurado: ${configProblem}`, { status: 503 });
  }

  const topic = request.headers.get("x-shopify-topic") || "";
  const payload = JSON.parse(raw);
  const supa = createAdminClient();

  try {
    if (topic === "products/create" || topic === "products/update") {
      // `stock` se excluye a propósito del upsert.
      //
      // Un evento de PRODUCTO no es una fuente confiable de inventario: el
      // payload del webhook no tiene por qué traer las cantidades igual que la
      // REST API, y este handler compite con `inventory_levels/update` — que sí
      // relee el stock real. Cuando ganaba esta carrera, `products.stock`
      // quedaba con un número inventado (visto el 2026-09-02: un producto con 15
      // unidades en Shopify quedó en 0 en Atelier). Omitir la columna la deja
      // intacta en el UPDATE y en 0 (su default) en el INSERT; el valor de
      // verdad lo pone `reconcileStock` acá abajo.
      const withoutStock = { ...mapProduct(payload) };
      delete (withoutStock as { stock?: number }).stock;
      const { error } = await supa
        .from("products")
        .upsert(withoutStock, { onConflict: "shopify_id" });
      if (error) throw error;

      const { data: prod } = await supa
        .from("products")
        .select(PRODUCT_FIELDS)
        .eq("shopify_id", withoutStock.shopify_id!)
        .maybeSingle();
      if (prod) await reconcileStock(supa, prod);
    } else if (
      topic === "orders/create" ||
      topic === "orders/updated" ||
      topic === "orders/cancelled"
    ) {
      // Los tres traen la orden completa, así que el mismo handler sirve: el
      // import es idempotente por `shopify_line_item_id` y `orders/cancelled`
      // se distingue solo, por el `cancelled_at` del payload.
      await handleOrder(payload, supa);
    } else if (topic === "refunds/create") {
      await handleRefund(payload, supa);
    } else if (topic === "inventory_levels/update") {
      await handleInventoryLevel(payload, supa);
    }
    return NextResponse.json({ ok: true, topic });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
