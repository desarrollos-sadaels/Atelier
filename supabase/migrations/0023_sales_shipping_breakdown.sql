-- Separa los ingresos por prendas de los importes de envío en todos los canales.
-- Los movimientos (cambios y devoluciones) siguen afectando solo a ventas.
-- No modifica las ventas guardadas: shipping_amount ya existe por compra.

drop function if exists public.sales_kpis(date, date);

create function public.sales_kpis(p_start date, p_end date)
returns table (
  total_amount numeric,
  atelier_amount numeric,
  workshop_amount numeric,
  shopify_amount numeric,
  shipping_amount numeric,
  atelier_shipping_amount numeric,
  workshop_shipping_amount numeric,
  shopify_shipping_amount numeric,
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
      case
        when s.workshop_order_id is not null
          or s.idempotency_key like 'workshop:%' then 'workshop'
        when s.origin = 'shopify' then 'shopify'
        else 'atelier'
      end as channel,
      s.delivered,
      coalesce(bool_or(i.counts_revenue), false) as has_revenue,
      coalesce(sum(
        (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
        + i.exchange_adjustment
      ) filter (where i.counts_revenue), 0) as product_amount,
      case when coalesce(bool_or(i.counts_revenue), false)
           then s.shipping_amount else 0 end as shipping_amount,
      coalesce(sum(i.qty) filter (where i.status = 'active'), 0) as active_units,
      coalesce(sum(i.qty) filter (
        where i.status = 'active' and i.is_other_brand
      ), 0) as other_brand_units
    from public.sales s
    left join public.sale_items i on i.sale_id = s.id
    where s.sold_at >= p_start and s.sold_at < p_end
    group by
      s.id, s.origin, s.workshop_order_id, s.idempotency_key,
      s.delivered, s.shipping_amount
  ),
  movements as (
    select
      m.amount,
      m.kind,
      case
        when s.workshop_order_id is not null
          or s.idempotency_key like 'workshop:%' then 'workshop'
        when s.origin = 'shopify' then 'shopify'
        else 'atelier'
      end as channel
    from public.sale_movements m
    join public.sales s on s.id = m.sale_id
    where (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
  )
  select
    (coalesce(sum(r.product_amount), 0)
      + coalesce((select sum(m.amount) from movements m), 0))::numeric,
    (coalesce(sum(r.product_amount) filter (where r.channel = 'atelier'), 0)
      + coalesce((select sum(m.amount) from movements m where m.channel = 'atelier'), 0))::numeric,
    (coalesce(sum(r.product_amount) filter (where r.channel = 'workshop'), 0)
      + coalesce((select sum(m.amount) from movements m where m.channel = 'workshop'), 0))::numeric,
    (coalesce(sum(r.product_amount) filter (where r.channel = 'shopify'), 0)
      + coalesce((select sum(m.amount) from movements m where m.channel = 'shopify'), 0))::numeric,
    coalesce(sum(r.shipping_amount), 0)::numeric,
    coalesce(sum(r.shipping_amount) filter (where r.channel = 'atelier'), 0)::numeric,
    coalesce(sum(r.shipping_amount) filter (where r.channel = 'workshop'), 0)::numeric,
    coalesce(sum(r.shipping_amount) filter (where r.channel = 'shopify'), 0)::numeric,
    coalesce(sum(r.active_units), 0)::bigint,
    count(*) filter (where r.has_revenue)::bigint,
    count(*) filter (where r.active_units > 0 and not r.delivered)::bigint,
    coalesce(sum(r.other_brand_units), 0)::bigint,
    coalesce(-(select sum(m.amount) from movements m where m.kind = 'return'), 0)::numeric,
    (select count(*) from movements m where m.kind = 'return')::bigint,
    coalesce(sum(r.active_units) filter (where r.channel = 'shopify'), 0)::bigint
  from sale_rollup r;
$$;

grant execute on function public.sales_kpis(date, date) to authenticated;

drop function if exists public.sales_daily_series(date, date);

create function public.sales_daily_series(p_start date, p_end date)
returns table (
  day date,
  atelier_amount numeric,
  workshop_amount numeric,
  shopify_amount numeric,
  atelier_shipping_amount numeric,
  workshop_shipping_amount numeric,
  shopify_shipping_amount numeric,
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
      case
        when s.workshop_order_id is not null
          or s.idempotency_key like 'workshop:%' then 'workshop'
        when s.origin = 'shopify' then 'shopify'
        else 'atelier'
      end as channel,
      coalesce(bool_or(i.counts_revenue), false) as has_revenue,
      coalesce(sum(
        (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
        + i.exchange_adjustment
      ) filter (where i.counts_revenue), 0) as amount,
      case when coalesce(bool_or(i.counts_revenue), false)
           then s.shipping_amount else 0 end as shipping_amount
    from public.sales s
    left join public.sale_items i on i.sale_id = s.id
    where s.sold_at >= p_start and s.sold_at < p_end
    group by
      s.sold_at, s.id, s.origin, s.workshop_order_id, s.idempotency_key,
      s.shipping_amount
  ),
  movement_day as (
    select
      (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as day,
      case
        when s.workshop_order_id is not null
          or s.idempotency_key like 'workshop:%' then 'workshop'
        when s.origin = 'shopify' then 'shopify'
        else 'atelier'
      end as channel,
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
                where s.day = d::date and s.channel = 'atelier'), 0)
      + coalesce((select sum(m.amount) from movement_day m
                  where m.day = d::date and m.channel = 'atelier'), 0)
    )::numeric,
    (
      coalesce((select sum(s.amount) from sale_day s
                where s.day = d::date and s.channel = 'workshop'), 0)
      + coalesce((select sum(m.amount) from movement_day m
                  where m.day = d::date and m.channel = 'workshop'), 0)
    )::numeric,
    (
      coalesce((select sum(s.amount) from sale_day s
                where s.day = d::date and s.channel = 'shopify'), 0)
      + coalesce((select sum(m.amount) from movement_day m
                  where m.day = d::date and m.channel = 'shopify'), 0)
    )::numeric,
    coalesce((select sum(s.shipping_amount) from sale_day s
              where s.day = d::date and s.channel = 'atelier'), 0)::numeric,
    coalesce((select sum(s.shipping_amount) from sale_day s
              where s.day = d::date and s.channel = 'workshop'), 0)::numeric,
    coalesce((select sum(s.shipping_amount) from sale_day s
              where s.day = d::date and s.channel = 'shopify'), 0)::numeric,
    (select count(*) from sale_day s
     where s.day = d::date and s.has_revenue)::bigint
  from generate_series(p_start, p_end - 1, interval '1 day') d
  order by d;
$$;

grant execute on function public.sales_daily_series(date, date) to authenticated;
