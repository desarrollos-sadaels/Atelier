-- ============================================================
-- 0008 — Métodos de pago configurables (cada uno con su propia config de cuotas)
-- Reemplaza el setting único `installment_options` por `payment_methods`:
-- una lista editable de { name, installments: number[] | null }.
-- ============================================================

insert into public.app_settings (key, value)
values (
  'payment_methods',
  '[
    {"name":"EFECTIVO","installments":null},
    {"name":"TRANSFERENCIA","installments":null},
    {"name":"QR","installments":null},
    {"name":"TARJETA","installments":[1,3,6,12]},
    {"name":"MERCADOPAGO","installments":[1,3,6,12]},
    {"name":"OTRO","installments":null}
  ]'::jsonb
)
on conflict (key) do nothing;
