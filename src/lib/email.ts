import "server-only";

/**
 * Envío de emails vía Resend (REST API, sin dependencia extra).
 * Gated: si no hay `RESEND_API_KEY` + `RESEND_FROM`, es un no-op con log.
 */

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

export type SendResult = { ok: boolean; skipped?: boolean; error?: string };

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string | string[];
  subject: string;
  html: string;
}): Promise<SendResult> {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!isEmailConfigured()) {
    console.log(`[email] gated (sin RESEND_API_KEY) — no se envió: "${subject}" → ${recipients.join(", ")}`);
    return { ok: false, skipped: true };
  }
  if (recipients.length === 0) return { ok: false, skipped: true };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to: recipients, subject, html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[email] Resend ${res.status}: ${detail}`);
      return { ok: false, error: `Resend ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[email] error:", e);
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}

/**
 * Escapa un valor para interpolarlo en el HTML de un mail.
 *
 * Los mails arman markup a mano (no hay JSX que escape solo), y los valores que
 * se interpolan —nombre de producto, SKU, nombre de campaña— vienen de Shopify y
 * de la DB, no de constantes del código. Sin escapar, cualquiera que pueda
 * nombrar un producto inyecta markup en la casilla de los admins.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wrapper HTML mínimo con la marca, para los mails transaccionales.
 *
 * `title` es texto plano y se escapa acá. `bodyHtml` es HTML: cualquier valor
 * dinámico que se interpole ahí lo tiene que escapar el que lo arma, con
 * `escapeHtml()`.
 */
export function emailShell(title: string, bodyHtml: string): string {
  return `<div style="font-family:ui-sans-serif,system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <div style="font-size:20px;font-weight:600;letter-spacing:-0.02em;padding:8px 0 16px">Atelier</div>
    <div style="font-size:16px;font-weight:600;margin-bottom:12px">${escapeHtml(title)}</div>
    ${bodyHtml}
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;font-size:11px;color:#888">
      Atelier · Control de stock · Sadaels
    </div>
  </div>`;
}
