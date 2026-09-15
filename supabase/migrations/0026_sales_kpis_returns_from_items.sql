-- ============================================================
-- 0026 — sales_kpis: las devoluciones se cuentan desde las prendas
--
-- El KPI "Devoluciones" de la pantalla de Ventas decía 0 siempre. `sales_kpis`
-- contaba las devoluciones desde `sale_movements`, pero la app no registra ahí:
-- una devolución marca la prenda (`sale_items.status = 'returned'` y
-- `returned_at`, ver /api/ventas/[id]/devolucion). `sale_movements` está vacía,
-- así que septiembre de 2026 mostraba 0 devoluciones con 4 prendas devueltas
-- ($600.000). El reporte ya lo corrigió en la 0025; esto lo corrige en la
-- fuente de los KPIs.
--
-- Qué cambia: SOLO `returned_amount` y `returned_count`, con el mismo criterio
-- que `sales_by_seller_channel` (0025):
--
--   - Por la fecha de la DEVOLUCIÓN (`returned_at` en hora de Buenos Aires), no
--     por la de la venta: una prenda de agosto devuelta el 2/9 es de septiembre.
--     Es el criterio que ya tenían los movimientos, y el que explica por qué un
--     mes cerró más bajo.
--   - Devolver la prenda de un cambio también marca la ORIGINAL como devuelta:
--     la original se excluye para no contar dos devoluciones por una.
--   - `returned_amount` es lo que valían las prendas devueltas, con sus
--     descuentos (antes era el monto negado de los movimientos de devolución).
--
-- Qué NO cambia: la plata, las unidades, las operaciones y las entregas. Siguen
-- sumando `shipping_amount` y los movimientos de `sale_movements`, igual que la
-- versión que estaba viva. La firma es la misma, así que el código no se toca.
--
-- Esta migración trae además al repo la definición completa de la función, que
-- en producción había cambiado por fuera de las migraciones (la 0018 no sumaba
-- envío ni movimientos; ese cambio es la 0019). Depende de `sale_movements` y
-- `sales.shipping_amount` (0019).
--
-- De paso: la función tenía EXECUTE para `anon` (el grant por default a
-- PUBLIC). No leía nada —la RLS de `sales` es solo para `authenticated`—, pero
-- se alinea con las funciones del reporte.
--
-- Corrida en orden desde el repo, esta migración cae sobre la 0022, que ya le
-- agregó `workshop_amount` al retorno, y `create or replace` no puede cambiar
-- el tipo: por eso el `drop`. La función queda sin `workshop_amount` hasta la
-- 0028, que junta las dos versiones.
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
  ),
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
    (coalesce(sum(r.amount), 0) + coalesce((select sum(m.amount) from movements m), 0))::numeric,
    (coalesce(sum(r.amount) filter (where r.origin = 'atelier'), 0)
      + coalesce((select sum(m.amount) from movements m where m.origin = 'atelier'), 0))::numeric,
    (coalesce(sum(r.amount) filter (where r.origin = 'shopify'), 0)
      + coalesce((select sum(m.amount) from movements m where m.origin = 'shopify'), 0))::numeric,
    coalesce(sum(r.active_units), 0)::bigint,
    count(*) filter (where r.has_revenue)::bigint,
    count(*) filter (where r.active_units > 0 and not r.delivered)::bigint,
    coalesce(sum(r.other_brand_units), 0)::bigint,
    coalesce((select sum(ri.amount) from returned_items ri), 0)::numeric,
    (select count(*) from returned_items)::bigint,
    coalesce(sum(r.active_units) filter (where r.origin = 'shopify'), 0)::bigint
  from sale_rollup r;
$$;

revoke execute on function public.sales_kpis(date, date) from public, anon;
grant execute on function public.sales_kpis(date, date) to authenticated;

comment on function public.sales_kpis(date, date) is
  'KPIs de ventas del rango [p_start, p_end). Devoluciones por fecha de devolución, desde sale_items.';
