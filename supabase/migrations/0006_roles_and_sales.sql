-- ============================================================
-- 0006 — Roles simplificados (admin / medios / vendedor) + tabla sales
-- ============================================================

-- ---------- A) roles ----------
-- Soltar el constraint viejo ANTES de migrar valores (el viejo no admite 'vendedor').
alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles set role = 'medios'   where role in ('media', 'pauta');
update public.profiles set role = 'vendedor' where role in ('compras', 'viewer');

alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'medios', 'vendedor'));

alter table public.profiles alter column role set default 'vendedor';

-- Usuarios existentes arrancan como admin (decisión 2026-07-06).
update public.profiles set role = 'admin'
  where email in ('luz@lanzallamas.tv', 'teo@lanzallamas.tv', 'juan@sadaels.com');

-- ---------- B) sales ----------
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  sold_at date not null default current_date,          -- FECHA
  seller_id uuid references public.profiles (id) on delete set null,
  seller_name text,                                    -- QUIEN (denormalizado)
  customer_name text,
  customer_dni text,
  customer_contact text,                               -- MAIL O TELEFONO
  customer_address text,                               -- DOMICILIO
  product_id uuid references public.products (id) on delete set null,
  variant_gid text,                                    -- variante Shopify (trazabilidad)
  article text not null,                               -- ARTICULO
  color text,
  talle text,
  qty integer not null default 1 check (qty > 0),
  is_other_brand boolean not null default false,       -- ¿Es de otra marca?
  brand text,                                          -- marca en consignación
  price numeric(12, 2) not null,                       -- PRECIO $
  discount numeric(4, 2) not null default 0
    check (discount >= 0 and discount < 1),            -- fracción (0.15, 0.25)
  payment_method text,                                 -- Forma de pago
  pos text,                                            -- PUNTO DE VENTA
  invoiced boolean not null default false,             -- ¿Se hizo factura?
  delivered boolean not null default false,            -- ENTREGADO
  notes text,                                          -- col. R (observaciones)
  stock_deducted boolean not null default false,       -- "BAJADO DE STOCK" automático
  created_at timestamptz not null default now()
);

alter table public.sales enable row level security;

-- Todo el staff puede ver e insertar ventas.
drop policy if exists "sales_select_staff" on public.sales;
create policy "sales_select_staff" on public.sales
  for select to authenticated using (true);

drop policy if exists "sales_insert_staff" on public.sales;
create policy "sales_insert_staff" on public.sales
  for insert to authenticated with check (true);

-- Editar/borrar: solo admin (los toggles de entregado/factura van por API con service role).
drop policy if exists "sales_update_admin" on public.sales;
create policy "sales_update_admin" on public.sales
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

drop policy if exists "sales_delete_admin" on public.sales;
create policy "sales_delete_admin" on public.sales
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

create index if not exists idx_sales_sold_at on public.sales (sold_at desc);
create index if not exists idx_sales_product on public.sales (product_id);
