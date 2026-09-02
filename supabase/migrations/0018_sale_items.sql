-- ============================================================
-- 0018 — Una venta es un PAGO, y puede tener varias prendas
--
-- Hasta acá `sales` era "una fila = un producto": el modelo asumía que cada
-- venta tenía exactamente una prenda. No es cierto ni en el local ni online.
-- Las consecuencias eran concretas, no teóricas:
--
--   - Una compra de dos prendas entraba como DOS ventas. El ticket promedio
--     del reporte quedaba a la mitad y "operaciones" contaba el doble.
--   - El pago vivía duplicado en cada fila (medio, cuotas, factura, cliente,
--     domicilio). Editar el contacto en una fila y no en la otra dejaba dos
--     versiones del mismo cliente para la misma compra.
--   - Una sola factura no se podía adjuntar a la compra: había que subirla dos
--     veces, una por fila.
--
-- El corte es el de siempre en retail:
--
--   `sales`      — el PAGO. Fecha, vendedor, cliente, medio, cuotas, canal,
--                  factura, origen. Uno por operación.
--   `sale_items` — la MERCADERÍA. Producto, variante, cantidad, precio, y el
--                  estado de esa prenda en particular.
--
-- El estado por prenda (`status`, `counts_revenue`, `exchange_adjustment`) se
-- muda tal cual de `sales` a `sale_items`: es donde siempre perteneció. Que
-- viva en la prenda es lo que permite devolver una de tres sin tocar las otras
-- dos, y lo que hace que un cambio no cuente la plata dos veces (ver el
-- comentario largo de la 0017, que sigue valiendo palabra por palabra — solo
-- cambia la tabla en la que vive).
-- ============================================================

-- ------------------------------------------------------------
-- 1) La tabla de prendas.
-- ------------------------------------------------------------
create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  created_at timestamptz not null default now(),

  product_id uuid references public.products(id) on delete set null,
  variant_gid text,
  article text not null,
  color text,
  talle text,
  is_other_brand boolean not null default false,
  brand text,

  qty integer not null default 1 check (qty > 0),
  price numeric not null check (price >= 0),
  -- Descuento de ESTA prenda (fracción). El descuento general de la compra
  -- vive en `sales.sale_discount` y se aplica encima.
  discount numeric not null default 0 check (discount >= 0 and discount < 1),

  stock_deducted boolean not null default false,

  status text not null default 'active' check (status in ('active', 'returned', 'exchanged')),
  counts_revenue boolean not null default true,
  exchange_adjustment numeric not null default 0 check (exchange_adjustment >= 0),
  -- Cómo pagó el cliente la diferencia del cambio, si hubo.
  exchange_payment_method text,
  -- En las prendas NUEVAS de un cambio: a qué prenda reemplazan.
  exchange_of_item_id uuid references public.sale_items(id) on delete set null,
  returned_at timestamptz,
  return_reason text,

  shopify_line_item_id text
);

create index if not exists idx_sale_items_sale on public.sale_items (sale_id);
create index if not exists idx_sale_items_product on public.sale_items (product_id) where product_id is not null;
create index if not exists idx_sale_items_status on public.sale_items (status);
create index if not exists idx_sale_items_exchange_of
  on public.sale_items (exchange_of_item_id) where exchange_of_item_id is not null;

-- Idempotencia del import de Shopify. Único COMÚN, no parcial: Postgres solo
-- infiere un índice parcial para un `ON CONFLICT` si la sentencia repite el
-- predicado, y PostgREST no lo emite nunca — con el parcial, el import fallaba
-- entero. Los NULL son distintos entre sí, así que las prendas cargadas a mano
-- (sin línea de Shopify) conviven sin chocar.
create unique index if not exists idx_sale_items_shopify_line
  on public.sale_items (shopify_line_item_id);

-- ------------------------------------------------------------
-- 2) Columnas nuevas de la cabecera.
-- ------------------------------------------------------------
alter table public.sales
  -- Descuento sobre el total de la compra ("te hago 10% por llevar dos"). Se
  -- aplica ENCIMA del descuento de cada prenda, no en lugar de él.
  add column if not exists sale_discount numeric not null default 0,
  -- Denormalizado y mantenido por trigger. Existe para que el listado pueda
  -- filtrar por estado con un índice, en vez de un EXISTS correlacionado sobre
  -- sale_items en cada carga de página.
  add column if not exists has_returns boolean not null default false;

do $$ begin
  alter table public.sales add constraint sales_sale_discount_range
    check (sale_discount >= 0 and sale_discount < 1);
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 3) Migrar las filas existentes.
--
-- No se borra nada: las filas de Shopify que hoy son "una por prenda" se
-- agrupan por su orden, que es la compra real. Las cargadas a mano quedan como
-- ventas de una prenda, que es lo que son.
-- ------------------------------------------------------------
-- Sin `on commit drop`: fuera de un bloque de transacción explícito esa
-- cláusula borra la tabla al terminar el propio CREATE, y los INSERT de abajo
-- se quedarían sin ella. Se dropea a mano.
create temp table _canon as
select
  s.id as old_id,
  case
    when s.shopify_order_id is not null
      then first_value(s.id) over (
             partition by s.shopify_order_id order by s.created_at, s.id
           )
    else s.id
  end as sale_id
from public.sales s;

insert into public.sale_items (
  sale_id, created_at, product_id, variant_gid, article, color, talle,
  is_other_brand, brand, qty, price, discount, stock_deducted,
  status, counts_revenue, exchange_adjustment, returned_at, return_reason,
  shopify_line_item_id
)
select
  c.sale_id, s.created_at, s.product_id, s.variant_gid, s.article, s.color, s.talle,
  s.is_other_brand, s.brand, s.qty, s.price, s.discount, s.stock_deducted,
  s.status, s.counts_revenue, s.exchange_adjustment, s.returned_at, s.return_reason,
  s.shopify_line_item_id
from public.sales s
join _canon c on c.old_id = s.id;

-- Las filas que dejaron de ser cabecera (2ª, 3ª prenda de una misma orden).
delete from public.sales s
where exists (select 1 from _canon c where c.old_id = s.id and c.sale_id <> s.id);

drop table _canon;

-- ------------------------------------------------------------
-- 4) Sacar de la cabecera lo que ahora vive en la prenda.
-- ------------------------------------------------------------
alter table public.sales
  drop column if exists product_id,
  drop column if exists variant_gid,
  drop column if exists article,
  drop column if exists color,
  drop column if exists talle,
  drop column if exists qty,
  drop column if exists is_other_brand,
  drop column if exists brand,
  drop column if exists price,
  drop column if exists discount,
  drop column if exists stock_deducted,
  drop column if exists counts_revenue,
  drop column if exists exchange_adjustment,
  drop column if exists exchange_of_sale_id,
  drop column if exists returned_at,
  drop column if exists return_reason,
  drop column if exists shopify_line_item_id;

-- `status` sobrevive en la cabecera pero cambia de significado: ya no es el
-- estado de una prenda sino el de la compra — 'returned' solo cuando NO queda
-- ninguna prenda en manos del cliente. Lo mantiene el trigger de abajo.
do $$ begin
  alter table public.sales drop constraint sales_status_valid;
exception when undefined_object then null; end $$;

do $$ begin
  alter table public.sales add constraint sales_status_valid
    check (status in ('active', 'returned'));
exception when duplicate_object then null; end $$;

-- Una orden de Shopify es UNA compra. Antes no podía ser único porque había una
-- fila por prenda.
create unique index if not exists idx_sales_shopify_order_unique
  on public.sales (shopify_order_id);

drop index if exists public.idx_sales_shopify_order;
drop index if exists public.idx_sales_shopify_line_item;
drop index if exists public.idx_sales_exchange_of;

-- ------------------------------------------------------------
-- 5) Trigger que mantiene el estado de la cabecera.
--
-- Se recalcula desde las prendas en vez de escribirse a mano en cada endpoint:
-- devolución, cambio, import de Shopify y borrado de una prenda son cuatro
-- caminos distintos que pueden dejar la compra sin prendas activas, y bastaba
-- con olvidarse en uno para que el listado mintiera.
-- ------------------------------------------------------------
create or replace function public.sync_sale_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.sale_id, old.sale_id);
begin
  update public.sales s
  set
    status = case
      when exists (select 1 from public.sale_items i
                   where i.sale_id = target and i.status = 'active')
      then 'active' else 'returned' end,
    has_returns = exists (select 1 from public.sale_items i
                          where i.sale_id = target and i.status = 'returned')
  where s.id = target;
  return null;
end;
$$;

-- `security definer` porque el trigger escribe en `sales`, cuya policy de
-- UPDATE es solo-admin: sin esto, un vendedor insertando una prenda fallaría al
-- intentar poner al día la cabecera. La función no recibe datos del llamador
-- más que el `sale_id` de la fila tocada, así que no amplía lo que puede hacer.
revoke execute on function public.sync_sale_status() from public;

drop trigger if exists sale_items_sync_status on public.sale_items;
create trigger sale_items_sync_status
after insert or update of status or delete on public.sale_items
for each row execute function public.sync_sale_status();

-- Poner al día lo que se migró en el paso 3 (el trigger todavía no existía).
update public.sales s
set
  status = case
    when exists (select 1 from public.sale_items i where i.sale_id = s.id and i.status = 'active')
    then 'active' else 'returned' end,
  has_returns = exists (select 1 from public.sale_items i
                        where i.sale_id = s.id and i.status = 'returned');

create index if not exists idx_sales_origin_status on public.sales (origin, status);

-- ------------------------------------------------------------
-- 6) RLS de la tabla nueva. Espeja exactamente la de `sales` (0012/0013):
--    lectura para todo el staff, alta para admin/vendedor, edición y borrado
--    para admin. La API escribe con service_role y hace su propio chequeo de
--    pertenencia, igual que con `sales`.
-- ------------------------------------------------------------
alter table public.sale_items enable row level security;

drop policy if exists "sale_items_select_staff" on public.sale_items;
create policy "sale_items_select_staff" on public.sale_items
  for select to authenticated using (true);

drop policy if exists "sale_items_insert_admin_vendedor" on public.sale_items;
create policy "sale_items_insert_admin_vendedor" on public.sale_items
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.id = (select auth.uid()) and p.role in ('admin', 'vendedor'))
  );

drop policy if exists "sale_items_update_admin" on public.sale_items;
create policy "sale_items_update_admin" on public.sale_items
  for update to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.role = 'admin'));

drop policy if exists "sale_items_delete_admin" on public.sale_items;
create policy "sale_items_delete_admin" on public.sale_items
  for delete to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.role = 'admin'));

-- ============================================================
-- 7) KPIs, ahora sobre las dos tablas.
--
-- La asimetría de la 0017 sigue, con una vuelta más:
--   plata       -> prendas con `counts_revenue`
--   mercadería  -> prendas con status 'active'
--   OPERACIONES -> COMPRAS (cabeceras), no prendas. Es justamente el número
--                  que el modelo viejo contaba mal.
--
-- La fórmula del importe es la de `saleItemNet()` en src/lib/sales.ts:
-- precio × cantidad, con el descuento de la prenda y después el de la compra.
-- `exchange_adjustment` se suma SIN descuento: es plata que el cliente pagó
-- después, al hacer el cambio, y no la alcanza la promo de la compra original.
-- ============================================================

drop function if exists public.sales_kpis(date, date);

create function public.sales_kpis(p_start date, p_end date)
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
  with lines as (
    select
      s.id as sale_id, s.origin, s.delivered, s.sale_discount,
      i.qty, i.status, i.counts_revenue, i.is_other_brand,
      (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount)) as net,
      i.exchange_adjustment,
      (i.exchange_of_item_id is not null) as is_replacement
    from public.sales s
    join public.sale_items i on i.sale_id = s.id
    where s.sold_at >= p_start and s.sold_at < p_end
  )
  select
    coalesce(sum(net + exchange_adjustment) filter (where counts_revenue), 0)::numeric,
    coalesce(sum(net + exchange_adjustment) filter (where counts_revenue and origin = 'atelier'), 0)::numeric,
    coalesce(sum(net + exchange_adjustment) filter (where counts_revenue and origin = 'shopify'), 0)::numeric,
    coalesce(sum(qty) filter (where status = 'active'), 0)::bigint,
    count(distinct sale_id) filter (where status = 'active')::bigint,
    count(distinct sale_id) filter (where status = 'active' and not delivered)::bigint,
    coalesce(sum(qty) filter (where status = 'active' and is_other_brand), 0)::bigint,
    -- Devoluciones: solo lo que de verdad DEJÓ de facturar. Se excluyen las
    -- prendas que entraron por un cambio (`exchange_of_item_id` no nulo): esas
    -- nunca facturaron —su plata ya había entrado con la prenda original— así
    -- que devolverlas no revierte ningún ingreso, y sumarlas acá inflaba el
    -- número de devoluciones del mes.
    coalesce(sum(net) filter (where status = 'returned' and not is_replacement), 0)::numeric,
    count(*) filter (where status = 'returned' and not is_replacement)::bigint,
    coalesce(sum(qty) filter (where status = 'active' and origin = 'shopify'), 0)::bigint
  from lines;
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
  with lines as (
    select
      s.sold_at, s.id as sale_id, s.origin, s.sale_discount,
      i.status, i.counts_revenue,
      (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount)) as net,
      i.exchange_adjustment
    from public.sales s
    join public.sale_items i on i.sale_id = s.id
    -- El filtro va acá y no solo en el join de abajo: sin él, el CTE materializa
    -- TODAS las ventas de la historia en cada carga del dashboard para después
    -- descartar casi todas contra los 30 días del `generate_series`.
    where s.sold_at >= p_start and s.sold_at < p_end
  )
  select
    d::date,
    coalesce(sum(l.net + l.exchange_adjustment)
             filter (where l.counts_revenue and l.origin = 'atelier'), 0)::numeric,
    coalesce(sum(l.net + l.exchange_adjustment)
             filter (where l.counts_revenue and l.origin = 'shopify'), 0)::numeric,
    count(distinct l.sale_id) filter (where l.status = 'active')::bigint
  from generate_series(p_start, p_end - 1, interval '1 day') d
  left join lines l on l.sold_at = d::date
  group by d
  order by d;
$$;

grant execute on function public.sales_daily_series(date, date) to authenticated;
