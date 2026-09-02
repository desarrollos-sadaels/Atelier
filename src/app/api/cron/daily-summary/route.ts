import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { parseNotificationSettings } from "@/lib/notifications";
import { resolveRecipients } from "@/lib/notify";
import { isEmailConfigured, sendEmail, emailShell, escapeHtml } from "@/lib/email";
import { saleItemRevenue, saleItemNet } from "@/lib/sales";
import { allowsInsecureLocalFallback } from "@/lib/env";
import { hasValidSecret } from "@/lib/secrets";

export const runtime = "nodejs";

/**
 * Autoriza el cron de Vercel o una llamada manual.
 *
 * Antes alcanzaba con que la request trajera el header `x-vercel-cron`, que es
 * un header cualquiera y no una credencial. El patrón documentado por Vercel es
 * CRON_SECRET: cuando la variable existe en el proyecto, Vercel agrega solo el
 * header `Authorization: Bearer <CRON_SECRET>` a las llamadas del cron.
 */
function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (hasValidSecret(request, cronSecret, { allowHeader: false })) return true;

  // SYNC_SECRET queda para dispararlo a mano desde una terminal.
  const syncSecret = process.env.SYNC_SECRET;
  if (hasValidSecret(request, syncSecret, { allowHeader: false })) return true;

  // Sin ningún secreto configurado, solo se permite en `next dev`.
  if (!cronSecret && !syncSecret) return allowsInsecureLocalFallback();
  return false;
}

const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

/**
 * Día del resumen en horario de Buenos Aires.
 *
 * El cron corre a las 00:10 ART (03:10 UTC, ver vercel.json): a esa hora ya
 * empezó el día siguiente en ART, así que el resumen es del día que acaba de
 * cerrar, no del que recién arrancó. Antes el cron corría a las 23:00 UTC
 * (20:00 ART) y llamaba a esta función sin el ajuste: el resumen se armaba 4
 * horas antes de que terminara el día, así que las ventas entre las 20:00 y
 * la medianoche ART nunca entraban en ningún resumen.
 */
function summaryDayART(): string {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(yesterday);
}

async function buildAndSend() {
  const supa = createAdminClient();

  const { data: settingRow } = await supa
    .from("app_settings")
    .select("value")
    .eq("key", "notification_settings")
    .maybeSingle();
  const settings = parseNotificationSettings(settingRow?.value);

  const day = summaryDayART();

  // Una compra con sus prendas: la plata sale de las prendas, el conteo de
  // operaciones de las compras. Antes eran la misma fila y por eso una compra
  // de dos prendas contaba como dos ventas en el resumen de la noche.
  const { data: sales = [] } = await supa
    .from("sales")
    .select("id, origin, delivered, sale_discount, sale_items(qty, price, discount, status, counts_revenue, exchange_adjustment)")
    .eq("sold_at", day);
  const rows = sales ?? [];

  const lines = rows.flatMap((s) =>
    (s.sale_items ?? []).map((i) => ({ ...i, sale: s })),
  );
  const live = rows.filter((s) => (s.sale_items ?? []).some((i) => i.status === "active"));
  const totalAmount = lines.reduce((acc, l) => acc + saleItemRevenue(l, l.sale.sale_discount), 0);
  const shopifyAmount = lines
    .filter((l) => l.sale.origin === "shopify")
    .reduce((acc, l) => acc + saleItemRevenue(l, l.sale.sale_discount), 0);
  const units = lines.reduce((acc, l) => (l.status === "active" ? acc + l.qty : acc), 0);
  const pendingDelivery = live.filter((s) => !s.delivered).length;
  const returned = lines.filter((l) => l.status === "returned");
  const returnedAmount = returned.reduce((acc, l) => acc + saleItemNet(l, l.sale.sale_discount), 0);

  const { data: products = [] } = await supa
    .from("products")
    .select("name,sku,stock,alert_threshold")
    .order("stock", { ascending: true });
  const lowStock = (products ?? [])
    .filter((p) => p.stock <= p.alert_threshold)
    .slice(0, 12);

  const recipients = await resolveRecipients(supa, settings.recipients);

  const skipped =
    !settings.dailySummary || !isEmailConfigured() || recipients.length === 0;

  if (!skipped) {
    const lowRows = lowStock.length
      ? lowStock
          .map(
            (p) =>
              `<tr><td style="padding:4px 8px">${escapeHtml(p.name)}</td><td style="padding:4px 8px;color:#888">${escapeHtml(p.sku ?? "—")}</td><td style="padding:4px 8px;text-align:right;font-weight:600;${p.stock === 0 ? "color:#c00" : ""}">${p.stock}u</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="3" style="padding:8px;color:#888">Sin productos bajo umbral 🎉</td></tr>`;

    const html = emailShell(
      `Resumen diario · ${day}`,
      `<div style="font-size:14px;line-height:1.6">
        <p><strong>Ventas de hoy:</strong> ${live.length} operaciones · ${units} unidades · ${ars.format(totalAmount)}<br/>
        <strong>De la tienda online:</strong> ${ars.format(shopifyAmount)}<br/>
        <strong>Entregas pendientes:</strong> ${pendingDelivery}${returned.length ? `<br/><strong>Devoluciones:</strong> ${returned.length} prendas · ${ars.format(returnedAmount)}` : ""}</p>
        <p style="font-weight:600;margin-top:16px">Stock bajo / sin stock</p>
        <table style="border-collapse:collapse;width:100%;font-size:13px;border-top:1px solid #eee">${lowRows}</table>
      </div>`,
    );

    await sendEmail({ to: recipients, subject: `Atelier · Resumen diario ${day}`, html });
  }

  return {
    ok: true,
    day,
    sales: live.length,
    items: lines.length,
    units,
    totalAmount,
    shopifyAmount,
    returned: returned.length,
    lowStock: lowStock.length,
    emailSkipped: skipped,
    recipients: recipients.length,
  };
}

export async function GET(request: Request) {
  if (!authorized(request)) return new NextResponse("No autorizado", { status: 401 });
  if (!isAdminConfigured()) return NextResponse.json({ ok: false, error: "Supabase no configurado" }, { status: 400 });
  try {
    return NextResponse.json(await buildAndSend());
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// Vercel Cron hace GET; POST disponible para pruebas manuales.
export const POST = GET;
