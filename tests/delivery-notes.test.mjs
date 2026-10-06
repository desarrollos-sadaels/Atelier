import test from "node:test";
import assert from "node:assert/strict";
import {
  DELIVERY_NOTE_STATUS_LABEL,
  DELIVERY_NOTE_TYPE_LABEL,
  deliveryNoteItemTotal,
  deliveryNoteNumber,
  deliveryNoteType,
} from "../src/lib/delivery-notes.ts";
import { isStocklessPreorder } from "../src/lib/sales.ts";

test("los tres documentos tienen etiquetas estables", () => {
  assert.equal(DELIVERY_NOTE_TYPE_LABEL.delivery, "Remito");
  assert.equal(DELIVERY_NOTE_TYPE_LABEL.loan, "Préstamo");
  assert.equal(DELIVERY_NOTE_TYPE_LABEL.quote, "Presupuesto");
  assert.equal(DELIVERY_NOTE_STATUS_LABEL.returned, "Devuelto");
  assert.equal(deliveryNoteType("otro"), null);
});

test("el número y el total son imprimibles", () => {
  assert.equal(deliveryNoteNumber(31), "000031");
  assert.equal(deliveryNoteItemTotal({ unit_price: 10000, discount: 0.1, qty: 2 }), 18000);
});

test("la preventa de la compra o del producto evita el movimiento de stock", () => {
  assert.equal(isStocklessPreorder(false, false), false);
  assert.equal(isStocklessPreorder(true, false), true);
  assert.equal(isStocklessPreorder(false, true), true);
});

