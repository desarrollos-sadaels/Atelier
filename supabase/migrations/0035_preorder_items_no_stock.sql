-- ============================================================
-- 0035 - Snapshot de preventa por prenda
-- ============================================================

alter table public.sale_items
  add column if not exists is_preorder boolean not null default false;

comment on column public.sale_items.is_preorder is
  'Snapshot de preventa al registrar la prenda. Las preventas no descuentan ni reponen stock desde Atelier.';

