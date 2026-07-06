/**
 * Métodos de pago configurables. Cada método puede cobrar en cuotas
 * (installments = lista de opciones) o no (installments = null).
 * Editable por admin desde Configuración → Ventas.
 */
export type PaymentMethod = {
  name: string;
  installments: number[] | null;
};

export const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { name: "EFECTIVO", installments: null },
  { name: "TRANSFERENCIA", installments: null },
  { name: "QR", installments: null },
  { name: "TARJETA", installments: [1, 3, 6, 12] },
  { name: "MERCADOPAGO", installments: [1, 3, 6, 12] },
  { name: "OTRO", installments: null },
];

function cleanInstallments(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const list = [
    ...new Set(raw.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n) && n > 0 && n <= 60)),
  ].sort((a, b) => a - b);
  return list.length ? list : null;
}

/** Normaliza el valor crudo de app_settings a PaymentMethod[]. */
export function parsePaymentMethods(raw: unknown): PaymentMethod[] {
  if (!Array.isArray(raw)) return DEFAULT_PAYMENT_METHODS;
  const seen = new Set<string>();
  const out: PaymentMethod[] = [];
  for (const item of raw) {
    const name = typeof (item as { name?: unknown })?.name === "string" ? (item as { name: string }).name.trim() : "";
    if (!name) continue;
    const key = name.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, installments: cleanInstallments((item as { installments?: unknown }).installments) });
  }
  return out.length ? out : DEFAULT_PAYMENT_METHODS;
}
