-- ============================================================
-- 0019 — Etiqueta pre-order, Taller, movimientos y envíos
--
-- Todos los cambios son aditivos. No se reescriben ventas ni importes
-- históricos: las diferencias y devoluciones nuevas empiezan a registrarse
-- como movimientos con fecha propia, y las correcciones de envíos históricos
-- quedan para una acción explícita después de revisar una vista previa.
-- ============================================================

-- Pre-order es una etiqueta interna: no modifica stock ni Shopify.
alter table public.products
  add column if not exists is_preorder boolean not null default false;

-- El envío es un importe de la compra y se suma una sola vez, después de los
-- descuentos de las prendas y de la compra.
alter table public.sales
  add column if not exists shipping_amount numeric not null default 0;

do $$ begin
  alter table public.sales add constraint sales_shipping_amount_non_negative
    check (shipping_amount >= 0);
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- Pedidos internos que el equipo comunica manualmente al Taller.
-- ------------------------------------------------------------
create table if not exists public.workshop_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  customer_name text not null,
  customer_contact text,
  product_id uuid references public.products(id) on delete set null,
  -- Snapshot: el pedido sigue siendo legible si el producto deja de existir.
  product_name text not null,
  color text,
  talle text,
  detail text,
  status text not null default 'in_process'
    check (status in ('in_process', 'finished'))
);

create index if not exists idx_workshop_orders_status_created
  on public.workshop_orders (status, created_at desc);
create index if not exists idx_workshop_orders_product
  on public.workshop_orders (product_id) where product_id is not null;

alter table public.workshop_orders enable row level security;

drop policy if exists "workshop_orders_select_admin_vendedor" on public.workshop_orders;
create policy "workshop_orders_select_admin_vendedor" on public.workshop_orders
  for select to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = (select auth.uid()) and p.role in ('admin', 'vendedor'))
  );

drop policy if exists "workshop_orders_insert_admin_vendedor" on public.workshop_orders;
create policy "workshop_orders_insert_admin_vendedor" on public.workshop_orders
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.id = (select auth.uid()) and p.role in ('admin', 'vendedor'))
  );

drop policy if exists "workshop_orders_update_admin_vendedor" on public.workshop_orders;
create policy "workshop_orders_update_admin_vendedor" on public.workshop_orders
  for update to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = (select auth.uid()) and p.role in ('admin', 'vendedor'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.id = (select auth.uid()) and p.role in ('admin', 'vendedor'))
  );

drop policy if exists "workshop_orders_delete_admin_vendedor" on public.workshop_orders;
create policy "workshop_orders_delete_admin_vendedor" on public.workshop_orders
  for delete to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = (select auth.uid()) and p.role in ('admin', 'vendedor'))
  );

-- ------------------------------------------------------------
-- Movimientos económicos posteriores a una venta.
--
-- La venta original conserva su fecha y su importe. Una diferencia cobrada
-- suma en el momento del cambio y una devolución resta en el momento real en
-- que se entrega el dinero.
-- ------------------------------------------------------------
create table if not exists public.sale_movements (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  sale_item_id uuid references public.sale_items(id) on delete set null,
  created_at timestamptz not null default now(),
  occurred_at timestamptz not null default now(),
  kind text not null check (kind in ('exchange_difference', 'return')),
  amount numeric not null check (
    (kind = 'exchange_difference' and amount > 0)
    or (kind = 'return' and amount < 0)
  ),
  payment_method text,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  -- Evita cobrar o descontar dos veces ante reintentos de red.
  source_key text not null unique
);

create index if not exists idx_sale_movements_occurred
  on public.sale_movements (occurred_at desc);
create index if not exists idx_sale_movements_sale
  on public.sale_movements (sale_id);
create index if not exists idx_sale_movements_item
  on public.sale_movements (sale_item_id) where sale_item_id is not null;

alter table public.sale_movements enable row level security;

drop policy if exists "sale_movements_select_staff" on public.sale_movements;
create policy "sale_movements_select_staff" on public.sale_movements
  for select to authenticated using (true);

drop policy if exists "sale_movements_insert_admin_vendedor" on public.sale_movements;
create policy "sale_movements_insert_admin_vendedor" on public.sale_movements
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.id = (select auth.uid()) and p.role in ('admin', 'vendedor'))
  );

drop policy if exists "sale_movements_update_admin" on public.sale_movements;
create policy "sale_movements_update_admin" on public.sale_movements
  for update to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p
                      where p.id = (select auth.uid()) and p.role = 'admin'));

drop policy if exists "sale_movements_delete_admin" on public.sale_movements;
create policy "sale_movements_delete_admin" on public.sale_movements
  for delete to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.role = 'admin'));

-- ------------------------------------------------------------
-- KPIs: ventas base por `sold_at`; movimientos por `occurred_at` en ART.
-- El envío se suma una vez por compra y no recibe el descuento general.
-- `exchange_adjustment` se conserva para no alterar datos históricos.
-- ------------------------------------------------------------
create or replace function public.sales_kpis(p_start date, p_end date)
returns table (
  total_amount numeric,
  atelier_amount numeric,
  shopify_amount numeric,
  units bigint,
  operations bigint,
  pending_delivery bigint,
  other_brand_units bigint,
  returned_amount numeric,
  returned_count bigint,
  shopify_units bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with sale_rollup as (
    select
      s.id,
      s.origin,
      s.delivered,
      coalesce(bool_or(i.counts_revenue), false) as has_revenue,
      coalesce(sum(
        (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
        + i.exchange_adjustment
      ) filter (where i.counts_revenue), 0)
      + case when coalesce(bool_or(i.counts_revenue), false)
             then s.shipping_amount else 0 end as amount,
      coalesce(sum(i.qty) filter (where i.status = 'active'), 0) as active_units,
      coalesce(sum(i.qty) filter (
        where i.status = 'active' and i.is_other_brand
      ), 0) as other_brand_units
    from public.sales s
    left join public.sale_items i on i.sale_id = s.id
    where s.sold_at >= p_start and s.sold_at < p_end
    group by s.id, s.origin, s.delivered, s.shipping_amount
  ),
  movements as (
    select m.amount, m.kind, s.origin
    from public.sale_movements m
    join public.sales s on s.id = m.sale_id
    where (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
  )
  select
    (coalesce(sum(r.amount), 0) + coalesce((select sum(m.amount) from movements m), 0))::numeric,
    (coalesce(sum(r.amount) filter (where r.origin = 'atelier'), 0)
      + coalesce((select sum(m.amount) from movements m where m.origin = 'atelier'), 0))::numeric,
    (coalesce(sum(r.amount) filter (where r.origin = 'shopify'), 0)
      + coalesce((select sum(m.amount) from movements m where m.origin = 'shopify'), 0))::numeric,
    coalesce(sum(r.active_units), 0)::bigint,
    count(*) filter (where r.has_revenue)::bigint,
    count(*) filter (where r.active_units > 0 and not r.delivered)::bigint,
    coalesce(sum(r.other_brand_units), 0)::bigint,
    coalesce(-(select sum(m.amount) from movements m where m.kind = 'return'), 0)::numeric,
    (select count(*) from movements m where m.kind = 'return')::bigint,
    coalesce(sum(r.active_units) filter (where r.origin = 'shopify'), 0)::bigint
  from sale_rollup r;
$$;

grant execute on function public.sales_kpis(date, date) to authenticated;

create or replace function public.sales_daily_series(p_start date, p_end date)
returns table (
  day date,
  atelier_amount numeric,
  shopify_amount numeric,
  operations bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with sale_day as (
    select
      s.sold_at as day,
      s.id,
      s.origin,
      coalesce(bool_or(i.counts_revenue), false) as has_revenue,
      coalesce(sum(
        (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
        + i.exchange_adjustment
      ) filter (where i.counts_revenue), 0)
      + case when coalesce(bool_or(i.counts_revenue), false)
             then s.shipping_amount else 0 end as amount
    from public.sales s
    left join public.sale_items i on i.sale_id = s.id
    where s.sold_at >= p_start and s.sold_at < p_end
    group by s.sold_at, s.id, s.origin, s.shipping_amount
  ),
  movement_day as (
    select
      (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as day,
      s.origin,
      sum(m.amount) as amount
    from public.sale_movements m
    join public.sales s on s.id = m.sale_id
    where (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
    group by 1, s.origin
  )
  select
    d::date,
    (
      coalesce((select sum(s.amount) from sale_day s
                where s.day = d::date and s.origin = 'atelier'), 0)
      + coalesce((select sum(m.amount) from movement_day m
                  where m.day = d::date and m.origin = 'atelier'), 0)
    )::numeric,
    (
      coalesce((select sum(s.amount) from sale_day s
                where s.day = d::date and s.origin = 'shopify'), 0)
      + coalesce((select sum(m.amount) from movement_day m
                  where m.day = d::date and m.origin = 'shopify'), 0)
    )::numeric,
    (select count(*) from sale_day s
     where s.day = d::date and s.has_revenue)::bigint
  from generate_series(p_start, p_end - 1, interval '1 day') d
  order by d;
$$;

grant execute on function public.sales_daily_series(date, date) to authenticated;
