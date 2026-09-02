import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseNotificationSettings, type NotificationSettings } from "@/lib/notifications";
import { isEmailConfigured, sendEmail, emailShell, escapeHtml } from "@/lib/email";

type Supa = ReturnType<typeof createAdminClient>;

async function loadSettings(supa: Supa): Promise<NotificationSettings> {
  const { data } = await supa
    .from("app_settings")
    .select("value")
    .eq("key", "notification_settings")
    .maybeSingle();
  return parseNotificationSettings(data?.value);
}

/** Destinatarios: los configurados, o los admins por defecto. */
export async function resolveRecipients(supa: Supa, explicit: string[]): Promise<string[]> {
  if (explicit.length) return explicit;
  const { data } = await supa.from("profiles").select("email").eq("role", "admin");
  return (data ?? [])
    .map((r) => r.email)
    .filter((e): e is string => Boolean(e && e.includes("@")));
}

/** Destinatarios para avisos de Meta: los configurados, o el equipo de medios (admins si no hay). */
async function resolveMediaRecipients(supa: Supa, explicit: string[]): Promise<string[]> {
  if (explicit.length) return explicit;
  const { data } = await supa.from("profiles").select("email").eq("role", "medios");
  const emails = (data ?? [])
    .map((r) => r.email)
    .filter((e): e is string => Boolean(e && e.includes("@")));
  return emails.length ? emails : resolveRecipients(supa, []);
}

/**
 * Deja constancia de una venta que descontó stock en Shopify pero no logró
 * quedar marcada como tal en la base.
 *
 * Es el único estado del sistema que ninguna capa puede reparar sola: el
 * inventario ya bajó, pero `sales.stock_deducted` quedó en false, así que si
 * después se elimina la venta el stock NO se repone. El vendedor ve un warning
 * en el toast, pero eso se lo lleva el primer refresh — de ahí la campanita,
 * que sobrevive a la sesión y le llega a quien pueda corregirlo.
 *
 * Nunca lanza: se llama en un camino donde la venta ya está hecha y no puede
 * fallar por un problema de notificación.
 */
export async function notifyStockDeductionUnmarked(
  supa: Supa,
  input: { saleId: string; productId: string; article: string; qty: number },
): Promise<void> {
  try {
    await supa.from("notifications").insert({
      type: "stock",
      title: "Venta sin marcar: revisar stock a mano",
      body:
        `Se descontaron ${input.qty}u de "${input.article}" en Shopify, pero la venta ${input.saleId} ` +
        "no quedó marcada como descontada. Si se elimina esa venta, el stock NO se va a reponer solo.",
      product_id: input.productId,
      severity: "alert",
    });
  } catch (e) {
    console.error("[notify] no se pudo registrar la venta sin marcar:", e);
  }
}

export type LowStockInput = {
  productId: string;
  name: string;
  newStock: number;
  alertThreshold: number;
};

/**
 * Si el nuevo stock cruza el umbral, inserta una notificación (campanita) y,
 * según las preferencias + Resend, manda el email de alerta. Idempotencia laxa:
 * inserta una notificación por evento (aceptable para el volumen del negocio).
 */
export async function notifyLowStock(supa: Supa, input: LowStockInput): Promise<void> {
  const { productId, name, newStock, alertThreshold } = input;
  if (newStock > alertThreshold) return;

  const out = newStock === 0;
  const title = out ? "Sin stock" : "Stock bajo";
  const body = out
    ? `${name} quedó en 0u.`
    : `${name} bajó a ${newStock}u (umbral ${alertThreshold}).`;

  await supa.from("notifications").insert({
    type: "stock",
    title,
    body,
    product_id: productId,
    severity: out ? "alert" : "warn",
  });

  // Email (gated por Resend + preferencia).
  let settings: NotificationSettings | null = null;
  try {
    settings = await loadSettings(supa);
    const wantsEmail = out ? settings.pushOutOfStock || settings.stockEmail : settings.stockEmail;
    if (wantsEmail && isEmailConfigured()) {
      const recipients = await resolveRecipients(supa, settings.recipients);
      if (recipients.length) {
        await sendEmail({
          to: recipients,
          subject: `Atelier · ${title}: ${name}`,
          html: emailShell(title, `<p style="font-size:14px;line-height:1.5">${escapeHtml(body)}</p>`),
        });
      }
    }
  } catch (e) {
    // El email no debe romper el flujo de stock.
    console.error("[notify] email fallo:", e);
  }

  if (out) await notifyCampaignOutOfStock(supa, { productId, name, settings });
}

/**
 * Si el producto que se quedó sin stock está vinculado a una campaña de Meta,
 * avisa al equipo de medios (campanita + email). Nunca pausa la campaña — solo
 * notifica, la acción la toma una persona.
 */
async function notifyCampaignOutOfStock(
  supa: Supa,
  input: { productId: string; name: string; settings: NotificationSettings | null },
): Promise<void> {
  const { productId, name, settings } = input;
  const { data: link } = await supa
    .from("product_campaign_links")
    .select("campaigns(name)")
    .eq("product_id", productId)
    .limit(1)
    .maybeSingle();
  const campaign = link?.campaigns as { name: string } | null | undefined;
  if (!campaign) return;

  const title = "Campaña activa sin stock";
  const body = `${name} se quedó sin stock y está vinculado a la campaña "${campaign.name}". Pausala manualmente si corresponde.`;

  await supa.from("notifications").insert({
    type: "meta_stock",
    title,
    body,
    product_id: productId,
    severity: "alert",
  });

  try {
    const s = settings ?? (await loadSettings(supa));
    if (!s.metaAlerts || !isEmailConfigured()) return;
    const recipients = await resolveMediaRecipients(supa, s.recipients);
    if (!recipients.length) return;
    await sendEmail({
      to: recipients,
      subject: `Atelier · ${title}: ${name}`,
      html: emailShell(title, `<p style="font-size:14px;line-height:1.5">${escapeHtml(body)}</p>`),
    });
  } catch (e) {
    console.error("[notify] email meta fallo:", e);
  }
}
