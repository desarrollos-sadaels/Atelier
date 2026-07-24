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
