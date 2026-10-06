export type DeliveryNoteType = "delivery" | "loan" | "quote";
export type DeliveryNoteStatus = "issued" | "returned" | "cancelled";

export type DeliveryNoteItemRow = {
  id: string;
  product_id: string | null;
  variant_gid: string | null;
  inventory_item_id: string | null;
  article: string;
  color: string | null;
  talle: string | null;
  qty: number;
  unit_price: number;
  discount: number;
  stock_deducted: boolean;
};

export type DeliveryNoteRow = {
  id: string;
  number: number;
  created_at: string;
  issued_at: string;
  created_by_name: string | null;
  type: DeliveryNoteType;
  status: DeliveryNoteStatus;
  customer_name: string;
  customer_contact: string | null;
  customer_address: string | null;
  loan_due_at: string | null;
  returned_at: string | null;
  notes: string | null;
  delivery_note_items: DeliveryNoteItemRow[];
};

export const DELIVERY_NOTE_TYPE_LABEL: Record<DeliveryNoteType, string> = {
  delivery: "Remito",
  loan: "Préstamo",
  quote: "Presupuesto",
};

export const DELIVERY_NOTE_STATUS_LABEL: Record<DeliveryNoteStatus, string> = {
  issued: "Emitido",
  returned: "Devuelto",
  cancelled: "Anulado",
};

export function deliveryNoteType(value: unknown): DeliveryNoteType | null {
  return value === "delivery" || value === "loan" || value === "quote" ? value : null;
}

export function deliveryNoteStatus(value: unknown): DeliveryNoteStatus | null {
  return value === "issued" || value === "returned" || value === "cancelled" ? value : null;
}

export function deliveryNoteItemTotal(item: {
  unit_price: number | string;
  discount: number | string;
  qty: number;
}): number {
  return Number(item.unit_price) * (1 - Number(item.discount)) * item.qty;
}

export function deliveryNoteNumber(value: number | string): string {
  return String(value).padStart(6, "0");
}
