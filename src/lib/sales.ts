/**
 * Aritmética de una venta. Único lugar donde viven las fórmulas.
 *
 * Estaban duplicadas en tres lugares (tabla de ventas, KPIs del mes y resumen
 * diario por mail) y dos de las tres copias se olvidaban de multiplicar por la
 * cantidad, así que la misma venta mostraba números distintos según la
 * pantalla. Módulo puro a propósito: lo importan tanto el server como el
 * cliente, así que no puede depender de `server-only`.
 *
 * El modelo son DOS niveles, y la distinción importa:
 *
 *   `sales`      — el PAGO. Una operación: un cliente, un medio de pago, una
 *                  factura. Puede llevar varias prendas.
 *   `sale_items` — la MERCADERÍA. Cada prenda, con su precio, su descuento y
 *                  su propio estado (activa / devuelta / cambiada).
 *
 * El descuento se aplica en ese mismo orden: primero el de la prenda ("esta
 * está en liquidación"), después el de la compra ("y te hago 10% por llevar
 * dos"). No son alternativas — se componen.
 */

export type SaleAmount = {
  price: number | string;
  discount: number | string;
  qty: number;
};

/**
 * Importe de UNA prenda: precio unitario × cantidad, con su descuento y el
 * descuento general de la compra aplicados en cascada.
 */
export function saleItemNet(item: SaleAmount, saleDiscount: number | string = 0): number {
  const base = Number(item.price) * (1 - Number(item.discount)) * item.qty;
  return base * (1 - Number(saleDiscount || 0));
}

/**
 * `saleItemNet` sin el descuento de la compra. Sirve para mostrar el precio de
 * una prenda suelta —el picker del cambio, por ejemplo— donde todavía no hay
 * compra a la que pertenezca.
 */
export function saleNet(item: SaleAmount): number {
  return saleItemNet(item, 0);
}

// ---------- origen y estado ----------

/** De dónde salió la venta. */
export type SaleOrigin = "atelier" | "shopify";

/**
 * Qué pasó con la MERCADERÍA de una prenda.
 *
 * - `active`: está en manos del cliente.
 * - `returned`: volvió; el stock se repuso y dejó de facturar.
 * - `exchanged`: volvió y se la reemplazó por otra(s). La fila conserva la
 *   plata, pero las unidades pasan a las prendas nuevas del cambio.
 */
export type SaleItemStatus = "active" | "returned" | "exchanged";

/**
 * Estado de la COMPRA. Solo dos, y lo mantiene un trigger en la base a partir
 * de sus prendas: `returned` únicamente cuando no queda ninguna activa. Una
 * devolución parcial deja la compra en `active` con `has_returns` en true.
 */
export type SaleStatus = "active" | "returned";

export const SALE_ORIGIN_LABEL: Record<SaleOrigin, string> = {
  atelier: "Atelier",
  shopify: "Shopify",
};

export const SALE_ITEM_STATUS_LABEL: Record<SaleItemStatus, string> = {
  active: "Activa",
  returned: "Devuelta",
  exchanged: "Cambiada",
};

export function normalizeOrigin(raw: string | null | undefined): SaleOrigin {
  return raw === "shopify" ? "shopify" : "atelier";
}

export function normalizeItemStatus(raw: string | null | undefined): SaleItemStatus {
  return raw === "returned" || raw === "exchanged" ? raw : "active";
}

// ---------- importes de la compra ----------

export type RevenueItem = SaleAmount & {
  counts_revenue: boolean;
  exchange_adjustment: number | string;
};

/**
 * Plata que una prenda aporta al mes. Espejo exacto de `sales_kpis` en la
 * migración 0018 — si una cambia, la otra también.
 *
 * No es `saleItemNet` por dos motivos, y los dos vienen de los cambios:
 *
 * - Las prendas NUEVAS de un cambio traen mercadería pero NO facturan: esa
 *   plata ya entró con la prenda original. Cuentan 0 (`counts_revenue` false).
 * - La prenda original suma la diferencia que el cliente pagó de más
 *   (`exchange_adjustment`), que no está en su precio ni en su descuento. Va
 *   SIN el descuento de la compra: es plata cobrada después, en el momento del
 *   cambio, y no la alcanza la promo de la compra original.
 */
export function saleItemRevenue(item: RevenueItem, saleDiscount: number | string = 0): number {
  if (!item.counts_revenue) return 0;
  return saleItemNet(item, saleDiscount) + Number(item.exchange_adjustment ?? 0);
}

export type SaleWithDiscount = { sale_discount: number | string };

/** Lo que esta compra aporta al mes: la suma de lo que facturan sus prendas. */
export function saleTotal(sale: SaleWithDiscount, items: RevenueItem[]): number {
  return items.reduce((sum, it) => sum + saleItemRevenue(it, sale.sale_discount), 0);
}

/** Lo que el cliente se llevó puesto: solo las prendas todavía en su poder. */
export function saleActiveUnits(items: { qty: number; status: string }[]): number {
  return items.reduce((sum, it) => (it.status === "active" ? sum + it.qty : sum), 0);
}

/**
 * Diferencia de un cambio: lo que valen las prendas nuevas menos lo que valía
 * la original. Positiva = el cliente paga; negativa = sobrante a favor del
 * negocio (no se devuelve plata, así que el importe del mes no baja).
 */
export function exchangeBalance(originalNet: number, replacementNet: number) {
  const diff = replacementNet - originalNet;
  return {
    diff,
    /** Lo que el cliente tiene que pagar ahora (0 si la prenda nueva es más barata). */
    toCharge: diff > 0 ? diff : 0,
    /** Lo que queda a favor del negocio (0 si el cliente pagó diferencia). */
    surplus: diff < 0 ? -diff : 0,
  };
}

/**
 * Forma exacta que produce el uploader de facturas: `<uuid>.<ext>`, en la raíz
 * del bucket (ver `uploadInvoice` en NuevaVentaClient).
 */
const INVOICE_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/i;

/**
 * ¿Es un path de factura que pudo haber generado la app?
 *
 * El path llega desde el cliente al registrar la venta y después
 * `/api/ventas/[id]/factura` lo firma con la service_role — y una signed URL
 * ignora las RLS. Hoy eso no agrega acceso (la policy `invoices_auth_read` ya
 * deja leer el bucket entero a cualquier autenticado), pero sin validar, el día
 * que esa policy se acote —facturas por vendedor, por ejemplo— el endpoint
 * pasaría a ser una lectura de cualquier objeto del bucket. Validar acá evita
 * que el agujero aparezca solo.
 */
export function isValidInvoicePath(path: string | null | undefined): boolean {
  return typeof path === "string" && INVOICE_PATH_RE.test(path);
}
