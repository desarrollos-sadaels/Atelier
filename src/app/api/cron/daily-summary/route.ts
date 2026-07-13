import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { parseNotificationSettings } from "@/lib/notifications";
import { resolveRecipients } from "@/lib/notify";
import { isEmailConfigured, sendEmail, emailShell } from "@/lib/email";

export const runtime = "nodejs";

/** Autoriza Vercel Cron o una llamada manual con SYNC_SECRET. */
function authorized(request: Request): boolean {
  if (request.headers.get("x-vercel-cron")) return true;
  const secret = process.env.SYNC_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function todayART(): string {
  // YYYY-MM-DD en horario de Buenos Aires.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

async function buildAndSend() {
  const supa = createAdminClient();

  const { data: settingRow } = await supa
    .from("app_settings")
    .select("value")
    .eq("key", "notification_settings")
    .maybeSingle();
  const settings = parseNotificationSettings(settingRow?.value);

  const day = todayART();

  const { data: sales = [] } = await supa.from("sales").select("*").eq("sold_at", day);
  const rows = sales ?? [];
  const totalAmount = rows.reduce((acc, r) => acc + Number(r.price) * (1 - Number(r.discount)) * r.qty, 0);
  const units = rows.reduce((acc, r) => acc + r.qty, 0);
  const pendingDelivery = rows.filter((r) => !r.delivered).length;

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
              `<tr><td style="padding:4px 8px">${p.name}</td><td style="padding:4px 8px;color:#888">${p.sku ?? "—"}</td><td style="padding:4px 8px;text-align:right;font-weight:600;${p.stock === 0 ? "color:#c00" : ""}">${p.stock}u</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="3" style="padding:8px;color:#888">Sin productos bajo umbral 🎉</td></tr>`;

    const html = emailShell(
      `Resumen diario · ${day}`,
      `<div style="font-size:14px;line-height:1.6">
        <p><strong>Ventas de hoy:</strong> ${rows.length} operaciones · ${units} unidades · ${ars.format(totalAmount)}<br/>
        <strong>Entregas pendientes:</strong> ${pendingDelivery}</p>
        <p style="font-weight:600;margin-top:16px">Stock bajo / sin stock</p>
        <table style="border-collapse:collapse;width:100%;font-size:13px;border-top:1px solid #eee">${lowRows}</table>
      </div>`,
    );

    await sendEmail({ to: recipients, subject: `Atelier · Resumen diario ${day}`, html });
  }

  return {
    ok: true,
    day,
    sales: rows.length,
    units,
    totalAmount,
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
