-- ============================================================
-- 0007 — Factura adjunta + cuotas en ventas + settings de la app
-- ============================================================

-- ---------- A) columnas nuevas en sales ----------
alter table public.sales add column if not exists invoice_path text;   -- factura adjunta (storage)
alter table public.sales add column if not exists installments integer; -- cuotas (tarjeta / mercadopago)

-- ---------- B) settings clave-valor ----------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "settings_select_staff" on public.app_settings;
create policy "settings_select_staff" on public.app_settings
  for select to authenticated using (true);

drop policy if exists "settings_write_admin" on public.app_settings;
create policy "settings_write_admin" on public.app_settings
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

-- Opciones de cuotas configurables (editables por admin desde Configuración).
insert into public.app_settings (key, value)
values ('installment_options', '[1, 3, 6, 12]'::jsonb)
on conflict (key) do nothing;

-- ---------- C) bucket privado para facturas ----------
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

-- Solo staff autenticado sube y lee (bucket privado; se sirve por signed URL).
drop policy if exists "invoices_auth_insert" on storage.objects;
create policy "invoices_auth_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices');

drop policy if exists "invoices_auth_read" on storage.objects;
create policy "invoices_auth_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'invoices');
