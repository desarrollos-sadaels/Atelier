-- ============================================================
-- 0028 — KPIs y serie diaria: Taller como canal + devoluciones desde prendas
--
-- Reconcilia dos ramas que redefinieron `sales_kpis` en paralelo:
--
--   - 0022 (Taller) abrió Taller como canal propio (`workshop_amount`) en
--     `sales_kpis` y `sales_daily_series`, pero seguía contando las
--     devoluciones desde `sale_movements`.
--   - 0026 (reporte) pasó a contarlas desde las prendas, sin `workshop_amount`.
--
-- La que se aplicara última pisaba el arreglo de la otra. Esta versión junta
-- las dos, y es la que tiene que quedar viva.
--
-- Devoluciones: desde las prendas (`status = 'returned'`, por `returned_at`).
-- Desde la 0022, una devolución escribe además un movimiento `return`, así que
-- para las nuevas los dos criterios dan lo mismo; pero las devoluciones
-- anteriores solo existen como prendas, y contar desde `sale_movements` las
-- dejaría afuera. La plata no cambia: el total sigue siendo compras por
-- `sold_at` + movimientos por `occurred_at`. `returned_amount` es informativo;
-- no se resta del total, así que la devolución no se descuenta dos veces.
--
-- Canal: un solo criterio, `public.sale_channel` (0024), el mismo del reporte.
-- Así se sostiene la invariante de la 0024 —la suma de `sales_by_seller_channel`
-- es igual a `sales_kpis`— también canal por canal:
--
--   taller              -> workshop_amount
--   shopify             -> shopify_amount, shopify_units
--   atelier, mayoristas -> atelier_amount (ya no incluye Taller)
--
-- La 0022 detectaba Taller por `workshop_order_id` o `idempotency_key like
-- 'workshop:%'`. El trigger de la 0021 escribe las dos cosas y además
-- `pos = 'TALLER'`, así que los criterios coinciden (verificado: 0 compras en
-- las que difieren).
--
-- Verificado contra la base antes de aplicar, con las dos funciones en pg_temp:
-- mismos KPIs que la versión viva en 01/09–01/10, 15/08–15/09 y toda la
-- historia (10.454.300 en 43 operaciones; 4 devoluciones por 600.000), igual a
-- la suma de `sales_by_seller_channel`, y la serie diaria de 2026 idéntica día
-- por día.
-- ============================================================

-- Cambia el tipo de retorno respecto de la 0026: `create or replace` no alcanza.
drop function if exists public.sales_kpis(date, date);

create function public.sales_kpis(p_start date, p_end date)
returns table (
  total_amount numeric,
  atelier_amount numeric,
  workshop_amount numeric,
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
      public.sale_channel(s.pos, s.origin, s.workshop_order_id) as channel,
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
    group by s.id, s.pos, s.origin, s.workshop_order_id, s.delivered, s.shipping_amount
  ),
  movements as (
    select m.amount, public.sale_channel(s.pos, s.origin, s.workshop_order_id) as channel
    from public.sale_movements m
    join public.sales s on s.id = m.sale_id
    where (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
  ),
  -- Mismo criterio que `sales_by_seller_channel` (0025): devolver la prenda de
  -- un cambio también marcaba la ORIGINAL como devuelta, y se excluye para no
  -- contar dos devoluciones por una.
  returned_items as (
    select i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount) as amount
    from public.sale_items i
    join public.sales s on s.id = i.sale_id
    where i.status = 'returned'
      and i.returned_at is not null
      and (i.returned_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (i.returned_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
      and not exists (select 1 from public.sale_items r where r.exchange_of_item_id = i.id)
  )
  select
    (coalesce(sum(r.amount), 0)
      + coalesce((select sum(m.amount) from movements m), 0))::numeric,
    (coalesce(sum(r.amount) filter (where r.channel in ('atelier', 'mayoristas')), 0)
      + coalesce((select sum(m.amount) from movements m
                  where m.channel in ('atelier', 'mayoristas')), 0))::numeric,
    (coalesce(sum(r.amount) filter (where r.channel = 'taller'), 0)
      + coalesce((select sum(m.amount) from movements m where m.channel = 'taller'), 0))::numeric,
    (coalesce(sum(r.amount) filter (where r.channel = 'shopify'), 0)
      + coalesce((select sum(m.amount) from movements m where m.channel = 'shopify'), 0))::numeric,
    coalesce(sum(r.active_units), 0)::bigint,
    count(*) filter (where r.has_revenue)::bigint,
    count(*) filter (where r.active_units > 0 and not r.delivered)::bigint,
    coalesce(sum(r.other_brand_units), 0)::bigint,
    coalesce((select sum(ri.amount) from returned_items ri), 0)::numeric,
    (select count(*) from returned_items)::bigint,
    coalesce(sum(r.active_units) filter (where r.channel = 'shopify'), 0)::bigint
  from sale_rollup r;
$$;

drop function if exists public.sales_daily_series(date, date);

create function public.sales_daily_series(p_start date, p_end date)
returns table (
  day date,
  atelier_amount numeric,
  workshop_amount numeric,
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
      public.sale_channel(s.pos, s.origin, s.workshop_order_id) as channel,
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
    group by s.sold_at, s.id, s.pos, s.origin, s.workshop_order_id, s.shipping_amount
  ),
  movement_day as (
    select
      (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as day,
      public.sale_channel(s.pos, s.origin, s.workshop_order_id) as channel,
      sum(m.amount) as amount
    from public.sale_movements m
    join public.sales s on s.id = m.sale_id
    where (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
    group by 1, 2
  )
  select
    d::date,
    (
      coalesce((select sum(s.amount) from sale_day s
                where s.day = d::date and s.channel in ('atelier', 'mayoristas')), 0)
      + coalesce((select sum(m.amount) from movement_day m
                  where m.day = d::date and m.channel in ('atelier', 'mayoristas')), 0)
    )::numeric,
    (
      coalesce((select sum(s.amount) from sale_day s
                where s.day = d::date and s.channel = 'taller'), 0)
      + coalesce((select sum(m.amount) from movement_day m
                  where m.day = d::date and m.channel = 'taller'), 0)
    )::numeric,
    (
      coalesce((select sum(s.amount) from sale_day s
                where s.day = d::date and s.channel = 'shopify'), 0)
      + coalesce((select sum(m.amount) from movement_day m
                  where m.day = d::date and m.channel = 'shopify'), 0)
    )::numeric,
    (select count(*) from sale_day s
     where s.day = d::date and s.has_revenue)::bigint
  from generate_series(p_start, p_end - 1, interval '1 day') d
  order by d;
$$;

-- `drop` + `create` vuelve al EXECUTE por default para PUBLIC (la lección de la
-- 0016): se recorta igual que las funciones del reporte.
revoke execute on function public.sales_kpis(date, date) from public, anon;
grant execute on function public.sales_kpis(date, date) to authenticated;
revoke execute on function public.sales_daily_series(date, date) from public, anon;
grant execute on function public.sales_daily_series(date, date) to authenticated;

comment on function public.sales_kpis(date, date) is
  'KPIs de ventas del rango [p_start, p_end), por canal (sale_channel). Devoluciones por fecha de devolución, desde sale_items.';
comment on function public.sales_daily_series(date, date) is
  'Serie diaria del rango [p_start, p_end) por canal (sale_channel): compras por sold_at + movimientos por occurred_at.';
