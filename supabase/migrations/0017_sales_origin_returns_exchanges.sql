-- ============================================================
-- 0017 — Ventas de las dos plataformas + devoluciones y cambios
--
-- Hasta acá `sales` modelaba una sola cosa: una venta cargada a mano en el
-- Atelier, viva para siempre. Faltaban tres ejes:
--
--   1. ORIGEN. Las órdenes de Shopify nunca llegaban a esta tabla: el webhook
--      `orders/create` solo reconciliaba stock. O sea que el listado de ventas
--      mostraba la mitad del negocio.
--   2. ESTADO. Una devolución se hacía borrando la fila (el botón Eliminar),
--      así que el mes cerraba distinto sin dejar rastro de por qué.
--   3. CAMBIOS. No existían.
--
-- Las dos columnas que sostienen el modelo son distintas a propósito:
--
--   `status`         — qué pasó con la MERCADERÍA (activa / devuelta / cambiada).
--   `counts_revenue` — si esta fila aporta PLATA al mes.
--
-- Se separan porque en un cambio no coinciden. La venta original conserva la
-- plata (`counts_revenue` = true) pero ya no tiene la mercadería
-- (`status` = 'exchanged'); las prendas nuevas tienen la mercadería
-- (`status` = 'active') pero no vuelven a facturar (`counts_revenue` = false),
-- porque esa plata ya entró con la original. Si el cliente pagó una diferencia,
-- va en `exchange_adjustment` de la original. Una sola columna no puede
-- expresar eso sin contar doble o perder unidades.
-- ============================================================

alter table public.sales
  -- 'atelier' = cargada por un vendedor; 'shopify' = importada de una orden online.
  add column if not exists origin text not null default 'atelier',
  add column if not exists status text not null default 'active',
  add column if not exists counts_revenue boolean not null default true,
  -- Diferencia que el cliente pagó de más en un cambio. Suma al importe de la
  -- venta original. Cuando la prenda nueva sale más barata queda en 0: el
  -- sobrante queda a favor del negocio, que es la decisión de negocio tomada.
  add column if not exists exchange_adjustment numeric not null default 0,
  -- En las filas NUEVAS de un cambio: a qué venta reemplazan.
  add column if not exists exchange_of_sale_id uuid references public.sales(id) on delete set null,
  add column if not exists returned_at timestamptz,
  add column if not exists return_reason text,
  add column if not exists shopify_order_id text,
  add column if not exists shopify_order_name text,
  add column if not exists shopify_line_item_id text;

do $$ begin
  alter table public.sales add constraint sales_origin_valid
    check (origin in ('atelier', 'shopify'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.sales add constraint sales_status_valid
    check (status in ('active', 'returned', 'exchanged'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.sales add constraint sales_exchange_adjustment_non_negative
    check (exchange_adjustment >= 0);
exception when duplicate_object then null; end $$;

-- La línea de la orden es la unidad de importación: una orden de Shopify con
-- tres prendas produce tres filas. Este único es la idempotencia del import —
-- sin él, el webhook `orders/create` y el cron de backfill se pisarían y la
-- misma prenda aparecería dos veces en el listado.
--
-- NO es un índice parcial (`where shopify_line_item_id is not null`), aunque a
-- primera vista sea lo natural: Postgres solo puede inferir un índice parcial
-- para un `ON CONFLICT` si la sentencia repite el mismo predicado, y PostgREST
-- —o sea `supabase.upsert(..., { onConflict })`— no lo emite. Con el parcial, el
-- import fallaba entero con "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification". Un único común alcanza: los NULL son
-- distintos entre sí por default, así que todas las ventas del Atelier (que no
-- tienen línea de Shopify) siguen entrando.
create unique index if not exists idx_sales_shopify_line_item
  on public.sales (shopify_line_item_id);

create index if not exists idx_sales_origin_status on public.sales (origin, status);
create index if not exists idx_sales_exchange_of
  on public.sales (exchange_of_sale_id)
  where exchange_of_sale_id is not null;
create index if not exists idx_sales_shopify_order
  on public.sales (shopify_order_id)
  where shopify_order_id is not null;

-- ------------------------------------------------------------
-- `price > 0` pasa a `price >= 0`.
--
-- La 0013 lo agregó pensando en la carga manual, donde un precio en cero es
-- siempre un error de tipeo. Pero una orden de Shopify trae líneas de $0 que no
-- son errores: regalos, muestras, y líneas bonificadas al 100%. Con el
-- constraint viejo la importación de esa orden fallaba entera — se perdían
-- también las prendas pagas de la misma orden.
--
-- El caso de "100% off" se guarda como precio 0 y descuento 0 (en vez de
-- descuento 1, que violaría `discount < 1`): el importe resultante es el mismo.
-- ------------------------------------------------------------
alter table public.sales drop constraint if exists sales_price_positive;

do $$ begin
  alter table public.sales add constraint sales_price_non_negative check (price >= 0);
exception when duplicate_object then null; end $$;

-- ============================================================
-- KPIs: la firma cambia (se suman origen y devoluciones), así que hay que
-- soltar la función vieja antes de recrearla.
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
  select
    -- Plata: solo las filas que facturan, y con la diferencia del cambio sumada.
    -- Misma fórmula que `saleRevenue()` en src/lib/sales.ts.
    coalesce(sum((s.price * (1 - s.discount) * s.qty) + s.exchange_adjustment)
             filter (where s.counts_revenue), 0)::numeric,
    coalesce(sum((s.price * (1 - s.discount) * s.qty) + s.exchange_adjustment)
             filter (where s.counts_revenue and s.origin = 'atelier'), 0)::numeric,
    coalesce(sum((s.price * (1 - s.discount) * s.qty) + s.exchange_adjustment)
             filter (where s.counts_revenue and s.origin = 'shopify'), 0)::numeric,
    -- Mercadería: las filas vivas. Una venta cambiada ya no tiene prenda
    -- asociada (volvió al stock), así que sus unidades las aporta la fila nueva.
    coalesce(sum(s.qty) filter (where s.status = 'active'), 0)::bigint,
    count(*) filter (where s.status = 'active')::bigint,
    count(*) filter (where s.status = 'active' and not s.delivered)::bigint,
    coalesce(sum(s.qty) filter (where s.status = 'active' and s.is_other_brand), 0)::bigint,
    coalesce(sum(s.price * (1 - s.discount) * s.qty)
             filter (where s.status = 'returned'), 0)::numeric,
    count(*) filter (where s.status = 'returned')::bigint,
    coalesce(sum(s.qty) filter (where s.status = 'active' and s.origin = 'shopify'), 0)::bigint
  from public.sales s
  where s.sold_at >= p_start and s.sold_at < p_end;
$$;

grant execute on function public.sales_kpis(date, date) to authenticated;

-- ============================================================
-- Serie diaria por origen — alimenta el gráfico del dashboard.
--
-- Agrega en la base por la misma razón que `sales_kpis`: traer las filas del
-- mes al server para sumarlas en JavaScript significa mover los datos
-- personales de cada cliente en cada carga del dashboard.
-- ============================================================

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
  select
    d::date,
    coalesce(sum((s.price * (1 - s.discount) * s.qty) + s.exchange_adjustment)
             filter (where s.counts_revenue and s.origin = 'atelier'), 0)::numeric,
    coalesce(sum((s.price * (1 - s.discount) * s.qty) + s.exchange_adjustment)
             filter (where s.counts_revenue and s.origin = 'shopify'), 0)::numeric,
    count(s.id) filter (where s.status = 'active')::bigint
  from generate_series(p_start, p_end - 1, interval '1 day') d
  left join public.sales s on s.sold_at = d::date
  group by d
  order by d;
$$;

grant execute on function public.sales_daily_series(date, date) to authenticated;
