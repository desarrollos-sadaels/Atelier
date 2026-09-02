import { NextResponse } from "next/server";
import { shopifyAdmin, isShopifyConfigured } from "@/lib/shopify/client";
import { allowsInsecureLocalFallback, publicAppOrigin } from "@/lib/env";
import { hasValidSecret } from "@/lib/secrets";

export const runtime = "nodejs";

const TOPICS = [
  "orders/create",
  "products/create",
  "products/update",
  "inventory_levels/update",
];

type Webhook = { id: number; topic: string; address: string };

function authorized(request: Request): boolean {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    return hasValidSecret(request, secret);
  }
  // Sin SYNC_SECRET solo se permite en `next dev` (mismo criterio que
  // /api/shopify/sync): este endpoint reescribe los webhooks de la tienda.
  return allowsInsecureLocalFallback();
}

/**
 * A dónde tienen que pegar los webhooks.
 *
 * Sale de la config del proyecto, NO de la request: ver `publicAppOrigin()`.
 * En `next dev` se acepta el origen de la request para poder apuntar a un túnel
 * (ngrok y compañía) sin tener que setear una env var.
 */
function resolveAddress(request: Request): { address: string } | { error: string } {
  const origin = publicAppOrigin();
  if (origin) return { address: `${origin}/api/shopify/webhooks` };

  if (allowsInsecureLocalFallback()) {
    return { address: `${new URL(request.url).origin}/api/shopify/webhooks` };
  }
  return {
    error:
      "Falta NEXT_PUBLIC_APP_URL (o VERCEL_PROJECT_PRODUCTION_URL). Sin una URL estable los webhooks quedarían clavados a este deploy.",
  };
}

async function listWebhooks(): Promise<Webhook[]> {
  const data = await shopifyAdmin<{ webhooks: Webhook[] }>("webhooks.json?limit=250");
  return data.webhooks ?? [];
}

/**
 * Deja la tienda con exactamente un webhook por topic, apuntando a `address`.
 *
 * Antes esto solo hacía POST y trataba el 422 "already been taken" como éxito
 * ("exists"). Eso es justamente lo que ocultó el incidente: ya existía una
 * suscripción para cada topic, pero contra el deploy viejo, así que el endpoint
 * reportaba todo en verde mientras los eventos seguían yendo a otro lado.
 * Ahora se compara la address y se reescribe la que no coincide.
 */
export async function POST(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!isShopifyConfigured())
    return NextResponse.json({ error: "Shopify no configurado" }, { status: 400 });

  const resolved = resolveAddress(request);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }
  const { address } = resolved;

  let existing: Webhook[];
  try {
    existing = await listWebhooks();
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudieron leer los webhooks actuales: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  const results: Array<{ topic: string; status: string; detail?: string }> = [];

  for (const topic of TOPICS) {
    const forTopic = existing.filter((w) => w.topic === topic);
    const alreadyOk = forTopic.some((w) => w.address === address);
    const stale = forTopic.filter((w) => w.address !== address);

    try {
      // Borrar primero las que apuntan a otro lado: si dejamos la vieja viva y
      // la nueva falla, quedaríamos peor que antes (dos destinos recibiendo).
      for (const w of stale) {
        await shopifyAdmin(`webhooks/${w.id}.json`, { method: "DELETE" });
      }

      if (alreadyOk) {
        results.push({
          topic,
          status: "ok",
          detail: stale.length ? `se borraron ${stale.length} apuntando a otra URL` : undefined,
        });
        continue;
      }

      await shopifyAdmin("webhooks.json", {
        method: "POST",
        body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
      });
      results.push({
        topic,
        status: stale.length ? "reapuntado" : "creado",
        detail: stale.length ? `antes: ${stale.map((w) => w.address).join(", ")}` : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ topic, status: "error", detail: msg.slice(0, 200) });
    }
  }

  const ok = results.every((r) => r.status !== "error");
  return NextResponse.json({ ok, address, results }, { status: ok ? 200 : 500 });
}

export async function GET(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!isShopifyConfigured())
    return NextResponse.json({ error: "Shopify no configurado" }, { status: 400 });

  const resolved = resolveAddress(request);
  const expected = "error" in resolved ? null : resolved.address;

  const webhooks = await listWebhooks();
  return NextResponse.json({
    expected,
    // `matches` es lo que hay que mirar: un topic registrado no sirve de nada si
    // la address no es la de este deploy.
    webhooks: webhooks.map((w) => ({
      topic: w.topic,
      address: w.address,
      matches: expected ? w.address === expected : null,
    })),
    missing: expected ? TOPICS.filter((t) => !webhooks.some((w) => w.topic === t && w.address === expected)) : TOPICS,
  });
}
