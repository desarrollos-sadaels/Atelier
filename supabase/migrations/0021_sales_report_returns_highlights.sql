-- ============================================================
-- 0021 — Reporte de ventas: cambios/devoluciones reales y destacados
--
-- Dos cosas:
--
-- 1) `sales_by_seller_channel` contaba las devoluciones desde `sale_movements`,
--    copiando a `sales_kpis`. Pero la app NO registra ahí: una devolución marca
--    la prenda (`sale_items.status = 'returned'`, `returned_at`) y un cambio crea
--    prendas nuevas con `exchange_of_item_id`. `sale_movements` está vacía, así
--    que el reporte (y el KPI "Devoluciones" de Ventas, que usa `sales_kpis`)
--    decía 0 con 4 devoluciones y 1 cambio reales en la base (verificado el
--    2026-09-14). Se redefine la función para contarlos desde las prendas.
--
--    La PLATA no cambia: sigue siendo espejo de `sales_kpis`, movimientos
--    incluidos, y la suma de todas las filas sigue igual a `sales_kpis`.
--
-- 2) `sales_report_highlights`: ítem más vendido y día con mayores ventas, con
--    los mismos filtros que la pantalla (canales y cuenta).
--
-- Criterios (los dos siguen el EVENTO, no la fecha de la venta — igual que los
-- movimientos en `sales_kpis`: una devolución del 2/9 de una compra de agosto
-- es del 2/9):
--
--   Devolución — prenda con `status = 'returned'` y `returned_at` en el rango.
--                Devolver la prenda de un cambio también marca la ORIGINAL como
--                devuelta (ver /api/ventas/[id]/devolucion): la original se
--                excluye para no contar dos devoluciones por una.
--   Cambio     — prenda original con reemplazos; la fecha es la del primer
--                reemplazo creado. Cuenta aunque después devuelvan el reemplazo:
--                el cambio ocurrió.
--
-- Depende, como la 0020, de `sale_movements`, `sales.shipping_amount` y
-- `sales.workshop_order_id`, que existen en producción sin migración en el repo.
-- ============================================================

-- Cambia el tipo de retorno: `create or replace` no alcanza.
drop function if exists public.sales_by_seller_channel(date, date);

create function public.sales_by_seller_channel(p_start date, p_end date)
returns table (
  seller_id uuid,
  seller_name text,
  channel text,
  total_amount numeric,
  units bigint,
  operations bigint,
  pending_delivery bigint,
  returned_count bigint,
  returned_units bigint,
  returned_amount numeric,
  exchanged_count bigint,
  exchanged_units bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with sale_rollup as (
    select
      s.id,
      s.seller_id,
      s.seller_name,
      public.sale_channel(s.pos, s.origin, s.workshop_order_id) as channel,
      s.delivered,
      coalesce(bool_or(i.counts_revenue), false) as has_revenue,
      coalesce(sum(
        (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
        + i.exchange_adjustment
      ) filter (where i.counts_revenue), 0)
      + case when coalesce(bool_or(i.counts_revenue), false)
             then s.shipping_amount else 0 end as amount,
      coalesce(sum(i.qty) filter (where i.status = 'active'), 0) as active_units
    from public.sales s
    left join public.sale_items i on i.sale_id = s.id
    where s.sold_at >= p_start and s.sold_at < p_end
    group by s.id, s.seller_id, s.seller_name, s.pos, s.origin, s.workshop_order_id,
             s.delivered, s.shipping_amount
  ),
  -- Todo en una lista para agrupar una vez (un FULL JOIN por `seller_id` no
  -- sirve: el null de los pedidos web no matchea consigo mismo).
  lines as (
    -- compras del rango: plata, unidades, operaciones, entregas
    select
      r.seller_id, r.seller_name, r.channel,
      r.amount, r.has_revenue, r.active_units,
      (r.active_units > 0 and not r.delivered) as pending,
      0::bigint as ret_count, 0::bigint as ret_units, 0::numeric as ret_amount,
      0::bigint as exc_count, 0::bigint as exc_units
    from sale_rollup r

    union all
    -- movimientos: solo plata (espejo de sales_kpis)
    select
      s.seller_id, s.seller_name, public.sale_channel(s.pos, s.origin, s.workshop_order_id),
      m.amount, false, 0, false,
      0, 0, 0, 0, 0
    from public.sale_movements m
    join public.sales s on s.id = m.sale_id
    where (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end

    union all
    -- devoluciones
    select
      s.seller_id, s.seller_name, public.sale_channel(s.pos, s.origin, s.workshop_order_id),
      0, false, 0, false,
      1, i.qty, i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount),
      0, 0
    from public.sale_items i
    join public.sales s on s.id = i.sale_id
    where i.status = 'returned'
      and i.returned_at is not null
      and (i.returned_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (i.returned_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
      and not exists (select 1 from public.sale_items r where r.exchange_of_item_id = i.id)

    union all
    -- cambios
    select
      s.seller_id, s.seller_name, public.sale_channel(s.pos, s.origin, s.workshop_order_id),
      0, false, 0, false,
      0, 0, 0,
      1, o.qty
    from public.sale_items o
    join public.sales s on s.id = o.sale_id
    join lateral (
      select min(r.created_at) as exchanged_at
      from public.sale_items r
      where r.exchange_of_item_id = o.id
    ) x on x.exchanged_at is not null
    where (x.exchanged_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (x.exchanged_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
  )
  select
    l.seller_id,
    coalesce(nullif(trim(p.full_name), ''), p.email, max(l.seller_name)),
    l.channel,
    coalesce(sum(l.amount), 0)::numeric,
    coalesce(sum(l.active_units), 0)::bigint,
    count(*) filter (where l.has_revenue)::bigint,
    count(*) filter (where l.pending)::bigint,
    coalesce(sum(l.ret_count), 0)::bigint,
    coalesce(sum(l.ret_units), 0)::bigint,
    coalesce(sum(l.ret_amount), 0)::numeric,
    coalesce(sum(l.exc_count), 0)::bigint,
    coalesce(sum(l.exc_units), 0)::bigint
  from lines l
  left join public.profiles p on p.id = l.seller_id
  group by l.seller_id, l.channel, p.full_name, p.email
  order by 4 desc;
$$;

-- ---------- destacados ----------
--
-- Ítem más vendido: top 5 por unidades en poder del cliente (`status = 'active'`,
-- el mismo criterio que "Unidades" de los KPIs: lo devuelto no se vendió, y en
-- un cambio cuenta la prenda que se llevó). Se agrupa por producto —todas sus
-- variantes juntas— y por nombre cuando la prenda no tiene producto (otra marca).
--
-- Día con mayores ventas: la plata de cada día con la misma fórmula que
-- `sales_daily_series` (compras por `sold_at` + movimientos por fecha).
--
-- `p_channels` null o vacío = todos los canales; `p_seller_id` null = todas las cuentas.
create or replace function public.sales_report_highlights(
  p_start date,
  p_end date,
  p_channels text[] default null,
  p_seller_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select s.id, s.sold_at, s.sale_discount, s.shipping_amount
    from public.sales s
    where s.sold_at >= p_start and s.sold_at < p_end
      and (p_seller_id is null or s.seller_id = p_seller_id)
      and (p_channels is null or cardinality(p_channels) = 0
           or public.sale_channel(s.pos, s.origin, s.workshop_order_id) = any (p_channels))
  ),
  top_items as (
    select
      coalesce(max(p.name), max(i.article)) as name,
      coalesce(sum(i.qty) filter (where i.status = 'active'), 0) as units,
      coalesce(sum(
        (i.price * (1 - i.discount) * i.qty * (1 - sc.sale_discount)) + i.exchange_adjustment
      ) filter (where i.counts_revenue), 0) as amount
    from public.sale_items i
    join scoped sc on sc.id = i.sale_id
    left join public.products p on p.id = i.product_id
    group by coalesce(i.product_id::text, lower(trim(i.article)))
    having coalesce(sum(i.qty) filter (where i.status = 'active'), 0) > 0
    order by 2 desc, 3 desc, 1
    limit 5
  ),
  sale_day as (
    select
      sc.sold_at as day,
      case when coalesce(bool_or(i.counts_revenue), false) then 1 else 0 end as ops,
      coalesce(sum(
        (i.price * (1 - i.discount) * i.qty * (1 - sc.sale_discount)) + i.exchange_adjustment
      ) filter (where i.counts_revenue), 0)
      + case when coalesce(bool_or(i.counts_revenue), false)
             then sc.shipping_amount else 0 end as amount
    from scoped sc
    left join public.sale_items i on i.sale_id = sc.id
    group by sc.id, sc.sold_at, sc.shipping_amount
  ),
  movement_day as (
    select (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as day, m.amount
    from public.sale_movements m
    join public.sales s on s.id = m.sale_id
    where (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
      and (p_seller_id is null or s.seller_id = p_seller_id)
      and (p_channels is null or cardinality(p_channels) = 0
           or public.sale_channel(s.pos, s.origin, s.workshop_order_id) = any (p_channels))
  ),
  days as (
    select d.day, sum(d.amount) as amount, sum(d.ops) as operations
    from (
      select day, amount, ops from sale_day
      union all
      select day, amount, 0 from movement_day
    ) d
    group by d.day
  ),
  best_day as (
    select day, amount, operations
    from days
    where amount > 0
    order by amount desc, operations desc, day desc
    limit 1
  )
  select jsonb_build_object(
    'top_items', coalesce(
      (select jsonb_agg(
         jsonb_build_object('name', t.name, 'units', t.units, 'amount', t.amount)
         order by t.units desc, t.amount desc, t.name)
       from top_items t),
      '[]'::jsonb),
    'best_day',
      (select jsonb_build_object('day', b.day, 'amount', b.amount, 'operations', b.operations)
       from best_day b)
  );
$$;

revoke execute on function public.sales_by_seller_channel(date, date) from public, anon;
grant execute on function public.sales_by_seller_channel(date, date) to authenticated;
revoke execute on function public.sales_report_highlights(date, date, text[], uuid) from public, anon;
grant execute on function public.sales_report_highlights(date, date, text[], uuid) to authenticated;

comment on function public.sales_by_seller_channel(date, date) is
  'Ventas del rango [p_start, p_end) por vendedor y canal, con cambios y devoluciones desde sale_items. La plata sumada es igual a sales_kpis.';
comment on function public.sales_report_highlights(date, date, text[], uuid) is
  'Ítem más vendido (top 5 por unidades) y día con mayores ventas, filtrado por canales y cuenta.';
