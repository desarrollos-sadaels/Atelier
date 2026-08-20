/**
 * Importe de una venta. Único lugar donde vive la fórmula.
 *
 * Estaba duplicada en tres lugares (tabla de ventas, KPIs del mes y resumen
 * diario por mail) y dos de las tres copias se olvidaban de multiplicar por
 * la cantidad, así que la misma venta mostraba números distintos según la
 * pantalla. Módulo puro a propósito: lo importan tanto el server como el
 * cliente, así que no puede depender de `server-only`.
 */

export type SaleAmount = {
  price: number | string;
  discount: number | string;
  qty: number;
};

/** Precio unitario × cantidad, con el descuento aplicado. */
export function saleNet(sale: SaleAmount): number {
  return Number(sale.price) * (1 - Number(sale.discount)) * sale.qty;
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
