import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WHOLESALE_SETTINGS,
  findWholesaleStore,
  parseWholesaleSettings,
  validateWholesaleSettings,
  wholesaleFulfillmentFromLabel,
} from "../src/lib/wholesale.ts";

test("la configuración inicial usa 50% y las tres tiendas solicitadas", () => {
  assert.deepEqual(DEFAULT_WHOLESALE_SETTINGS, {
    discountPercentage: 50,
    stores: ["Yey House", "Studio 33", "Ikal (México)"],
  });
  assert.equal(findWholesaleStore(" yey house ", DEFAULT_WHOLESALE_SETTINGS), "Yey House");
  assert.equal(findWholesaleStore("IKAL (MÉXICO)", DEFAULT_WHOLESALE_SETTINGS), "Ikal (México)");
});

test("las tiendas se validan sin vacíos ni duplicados por mayúsculas", () => {
  assert.equal(
    validateWholesaleSettings({ discountPercentage: 50, stores: ["Studio 33", "studio 33"] }),
    null,
  );
  assert.equal(validateWholesaleSettings({ discountPercentage: 100, stores: ["Yey House"] }), null);
  assert.equal(validateWholesaleSettings({ discountPercentage: 50, stores: [] }), null);
});

test("una configuración inválida vuelve a la regla mayorista inicial", () => {
  assert.deepEqual(parseWholesaleSettings({ discountPercentage: 0, stores: [] }), DEFAULT_WHOLESALE_SETTINGS);
  assert.equal(wholesaleFulfillmentFromLabel("Envío"), "shipping");
  assert.equal(wholesaleFulfillmentFromLabel("Retiro presencial"), "pickup");
});
