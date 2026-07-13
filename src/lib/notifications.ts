/**
 * Preferencias de notificación (persistidas en app_settings key
 * `notification_settings`). Módulo puro (sin cliente) para reusar en
 * server components, API routes y el cron.
 */
export type NotificationSettings = {
  stockEmail: boolean; // alertas de stock por email
  pushOutOfStock: boolean; // aviso al quedar en 0u
  dailySummary: boolean; // resumen diario por email
  metaAlerts: boolean; // avisos de campañas Meta
  recipients: string[]; // mails destino (vacío = admins por defecto)
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  stockEmail: true,
  pushOutOfStock: true,
  dailySummary: false,
  metaAlerts: true,
  recipients: [],
};

export function parseNotificationSettings(value: unknown): NotificationSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
  const recipients = Array.isArray(v.recipients)
    ? Array.from(
        new Set(
          v.recipients
            .filter((e): e is string => typeof e === "string" && e.includes("@"))
            .map((e) => e.trim().toLowerCase()),
        ),
      )
    : [];
  return {
    stockEmail: bool(v.stockEmail, DEFAULT_NOTIFICATION_SETTINGS.stockEmail),
    pushOutOfStock: bool(v.pushOutOfStock, DEFAULT_NOTIFICATION_SETTINGS.pushOutOfStock),
    dailySummary: bool(v.dailySummary, DEFAULT_NOTIFICATION_SETTINGS.dailySummary),
    metaAlerts: bool(v.metaAlerts, DEFAULT_NOTIFICATION_SETTINGS.metaAlerts),
    recipients,
  };
}
