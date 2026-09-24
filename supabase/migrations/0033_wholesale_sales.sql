-- ============================================================
-- 0033 — Configuración y trazabilidad de ventas mayoristas
-- ============================================================

-- Snapshot de la tienda y de la modalidad elegida. Se guardan en la venta y
-- no como FK a la configuración para que borrar una tienda habilitada no borre
-- ni vuelva ilegible el historial.
alter table public.sales
  add column if not exists wholesale_store text,
  add column if not exists fulfillment_method text;

alter table public.sales
  drop constraint if exists sales_fulfillment_method_check;

alter table public.sales
  add constraint sales_fulfillment_method_check
  check (fulfillment_method is null or fulfillment_method in ('pickup', 'shipping'));

-- Las ventas que ya estaban marcadas MAYORISTAS no tenían modalidad. El único
-- dato histórico disponible para inferirla es el envío cobrado.
update public.sales
set fulfillment_method = case when coalesce(shipping_amount, 0) > 0 then 'shipping' else 'pickup' end
where upper(trim(coalesce(pos, ''))) = 'MAYORISTAS'
  and fulfillment_method is null;

-- Regla inicial solicitada: 50% del PVP y las tres tiendas actuales. El panel
-- de Configuración permite cambiar el porcentaje y sumar/quitar tiendas.
insert into public.app_settings (key, value)
values (
  'wholesale_settings',
  '{"discountPercentage":50,"stores":["Yey House","Studio 33","Ikal (México)"]}'::jsonb
)
on conflict (key) do nothing;

comment on column public.sales.wholesale_store is
  'Nombre histórico de la tienda compradora cuando pos = MAYORISTAS.';
comment on column public.sales.fulfillment_method is
  'Modalidad de entrega mayorista: pickup o shipping.';
