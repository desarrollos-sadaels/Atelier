import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXTERNAL_BRANDS,
  findExternalBrand,
  validateExternalBrands,
} from "../src/lib/external-brands.ts";
import {
  grossProductRevenue,
  saleItemRealRevenue,
  saleItemRevenue,
  saleTotal,
} from "../src/lib/sales.ts";

test("las ocho marcas tienen el porcentaje solicitado", () => {
  assert.deepEqual(DEFAULT_EXTERNAL_BRANDS.map(({ name, percentage }) => [name, percentage]), [
    ["MADEO", 30], ["MARIN", 28], ["LANGLOIS", 30], ["ALUMINA DICE", 30],
    ["DEMOLISHED", 28], ["GIRO", 37], ["Chiara Magnahani", 35], ["PABLO BERNARD", 28],
  ]);
  assert.equal(findExternalBrand(" madeo ", DEFAULT_EXTERNAL_BRANDS)?.percentage, 30);
  assert.equal(validateExternalBrands([{ name: "MADEO", percentage: 30 }, { name: "madeo", percentage: 28 }]), null);
});

test("el bruto vendido conserva las marcas sin tasa computadas al 100%", () => {
  assert.equal(grossProductRevenue(225000, 225000, 225000), 225000);
  assert.equal(grossProductRevenue(30000, 30000, 100000), 100000);
  assert.equal(grossProductRevenue(50000, 30000, 100000), 120000);
});

test("una venta sin tasa no se asigna a la marca", () => {
  const item = (price, rate) => ({
    price, discount: 0, qty: 1, counts_revenue: true,
    exchange_adjustment: 0, is_other_brand: true, external_brand_rate: rate,
  });
  const gross = saleItemRevenue(item(350000, 0.3)) + saleItemRevenue(item(225000, null));
  const sadaels = saleItemRealRevenue(item(350000, 0.3)) + saleItemRealRevenue(item(225000, null));
  assert.equal(gross, 575000);
  assert.equal(sadaels, 330000);
  assert.equal(gross - sadaels, 245000);
});

test("el ingreso real aplica la participación después de ambos descuentos sin alterar el cobro", () => {
  const external = {
    price: 1000, discount: 0.1, qty: 2, counts_revenue: true,
    exchange_adjustment: 0, is_other_brand: true, external_brand_rate: 0.3,
  };
  const own = {
    price: 500, discount: 0, qty: 1, counts_revenue: true,
    exchange_adjustment: 0, is_other_brand: false, external_brand_rate: null,
  };
  const sale = { sale_discount: 0.2, shipping_amount: 50 };
  assert.equal(saleItemRevenue(external, sale.sale_discount), 1440);
  assert.equal(saleItemRealRevenue(external, sale.sale_discount), 432);
  assert.equal(saleItemRealRevenue(own, sale.sale_discount), 400);
  assert.equal(saleTotal(sale, [external, own]), 1890);
});

test("una prenda que no factura no suma ingreso y una tasa ausente usa el 100%", () => {
  assert.equal(saleItemRealRevenue({
    price: 1000, discount: 0, qty: 1, counts_revenue: false,
    exchange_adjustment: 0, is_other_brand: true, external_brand_rate: 0.3,
  }), 0);
  assert.equal(saleItemRealRevenue({
    price: 1000, discount: 0, qty: 1, counts_revenue: true,
    exchange_adjustment: 0, is_other_brand: true, external_brand_rate: null,
  }), 1000);
});
