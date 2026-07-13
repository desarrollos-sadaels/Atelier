import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseNotificationSettings, type NotificationSettings } from "@/lib/notifications";
import { isEmailConfigured, sendEmail, emailShell } from "@/lib/email";

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
  try {
    const settings = await loadSettings(supa);
    const wantsEmail = out ? settings.pushOutOfStock || settings.stockEmail : settings.stockEmail;
    if (!wantsEmail || !isEmailConfigured()) return;
    const recipients = await resolveRecipients(supa, settings.recipients);
    if (!recipients.length) return;
    await sendEmail({
      to: recipients,
      subject: `Atelier · ${title}: ${name}`,
      html: emailShell(title, `<p style="font-size:14px;line-height:1.5">${body}</p>`),
    });
  } catch (e) {
    // El email no debe romper el flujo de stock.
    console.error("[notify] email fallo:", e);
  }
}
