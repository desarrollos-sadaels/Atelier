-- Sin tasa registrada, el 100% del producto se reconoce como ingreso de Sadaels.
-- Se conserva external_brand_rate = null para identificar ventas históricas sin tasa
-- y permitir que el admin les asigne una tasa explícita más adelante.
-- Ejecutar después de 0031_external_brand_revenue.sql.
begin;


create or replace function public.sales_kpis(p_start date, p_end date)
returns table (
  total_amount numeric,
  atelier_amount numeric,
  workshop_amount numeric,
  shopify_amount numeric,
  other_brand_amount numeric,
  other_brand_gross_amount numeric,
  other_brand_unmapped_amount numeric,
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
      case public.sale_channel(s.pos, s.origin, s.workshop_order_id)
        when 'taller' then 'workshop'
        when 'shopify' then 'shopify'
        else 'atelier'
      end as channel,
      s.delivered,
      coalesce(bool_or(i.counts_revenue), false) as has_revenue,
      coalesce(sum(
        case when i.is_other_brand then 0 else
          (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
          + i.exchange_adjustment end
      ) filter (where i.counts_revenue), 0) as own_amount,
      coalesce(sum(
        case when i.is_other_brand then
          ((i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
          + i.exchange_adjustment) * coalesce(i.external_brand_rate, 1)
        else 0 end
      ) filter (where i.counts_revenue), 0) as other_brand_amount,
      coalesce(sum(
        (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
        + i.exchange_adjustment
      ) filter (where i.counts_revenue and i.is_other_brand), 0) as other_brand_gross_amount,
      coalesce(sum(
        (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
        + i.exchange_adjustment
      ) filter (where i.counts_revenue and i.is_other_brand
                and i.external_brand_rate is null), 0) as other_brand_unmapped_amount,
      case when coalesce(bool_or(i.counts_revenue), false)
           then s.shipping_amount else 0 end as shipping_amount,
      coalesce(sum(i.qty) filter (where i.status = 'active'), 0) as active_units,
      coalesce(sum(i.qty) filter (
        where i.status = 'active' and i.is_other_brand
      ), 0) as other_brand_units
    from public.sales s
    left join public.sale_items i on i.sale_id = s.id
    where s.sold_at >= p_start and s.sold_at < p_end
    group by s.id, s.pos, s.origin, s.workshop_order_id, s.idempotency_key,
             s.delivered, s.shipping_amount
  ),
  movements as (
    select
      m.amount as gross_amount,
      m.amount * case when coalesce(i.is_other_brand, false)
                      then coalesce(i.external_brand_rate, 1) else 1 end as real_amount,
      coalesce(i.is_other_brand, false) as is_other_brand,
      i.external_brand_rate,
      m.kind,
      case public.sale_channel(s.pos, s.origin, s.workshop_order_id)
        when 'taller' then 'workshop'
        when 'shopify' then 'shopify'
        else 'atelier'
      end as channel
    from public.sale_movements m
    join public.sales s on s.id = m.sale_id
    left join public.sale_items i on i.id = m.sale_item_id
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
    (coalesce(sum(r.own_amount + r.other_brand_amount), 0)
      + coalesce((select sum(m.real_amount) from movements m), 0))::numeric,
    (coalesce(sum(r.own_amount) filter (where r.channel = 'atelier'), 0)
      + coalesce((select sum(m.real_amount) from movements m
                  where m.channel = 'atelier' and not m.is_other_brand), 0))::numeric,
    (coalesce(sum(r.own_amount) filter (where r.channel = 'workshop'), 0)
      + coalesce((select sum(m.real_amount) from movements m
                  where m.channel = 'workshop' and not m.is_other_brand), 0))::numeric,
    (coalesce(sum(r.own_amount) filter (where r.channel = 'shopify'), 0)
      + coalesce((select sum(m.real_amount) from movements m
                  where m.channel = 'shopify' and not m.is_other_brand), 0))::numeric,
    (coalesce(sum(r.other_brand_amount), 0)
      + coalesce((select sum(m.real_amount) from movements m
                  where m.is_other_brand), 0))::numeric,
    (coalesce(sum(r.other_brand_gross_amount), 0)
      + coalesce((select sum(m.gross_amount) from movements m
                  where m.is_other_brand), 0))::numeric,
    (coalesce(sum(r.other_brand_unmapped_amount), 0)
      + coalesce((select sum(m.gross_amount) from movements m
                  where m.is_other_brand and m.external_brand_rate is null), 0))::numeric,
    coalesce(sum(r.shipping_amount), 0)::numeric,
    coalesce(sum(r.shipping_amount) filter (where r.channel = 'atelier'), 0)::numeric,
    coalesce(sum(r.shipping_amount) filter (where r.channel = 'workshop'), 0)::numeric,
    coalesce(sum(r.shipping_amount) filter (where r.channel = 'shopify'), 0)::numeric,
    coalesce(sum(r.active_units), 0)::bigint,
    count(*) filter (where r.has_revenue)::bigint,
    count(*) filter (where r.active_units > 0 and not r.delivered)::bigint,
    coalesce(sum(r.other_brand_units), 0)::bigint,
    coalesce((select sum(ri.amount) from returned_items ri), 0)::numeric,
    (select count(*) from returned_items)::bigint,
    coalesce(sum(r.active_units) filter (where r.channel = 'shopify'), 0)::bigint
  from sale_rollup r;
$$;

revoke execute on function public.sales_kpis(date, date) from public, anon;
grant execute on function public.sales_kpis(date, date) to authenticated;



create or replace function public.sales_daily_series(p_start date, p_end date)
returns table (
  day date,
  atelier_amount numeric,
  workshop_amount numeric,
  shopify_amount numeric,
  other_brand_amount numeric,
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
      case public.sale_channel(s.pos, s.origin, s.workshop_order_id)
        when 'taller' then 'workshop'
        when 'shopify' then 'shopify'
        else 'atelier'
      end as channel,
      coalesce(bool_or(i.counts_revenue), false) as has_revenue,
      coalesce(sum(
        case when i.is_other_brand then 0 else
          (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
          + i.exchange_adjustment end
      ) filter (where i.counts_revenue), 0) as own_amount,
      coalesce(sum(
        case when i.is_other_brand then
          ((i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
          + i.exchange_adjustment) * coalesce(i.external_brand_rate, 1)
        else 0 end
      ) filter (where i.counts_revenue), 0) as other_brand_amount,
      case when coalesce(bool_or(i.counts_revenue), false)
           then s.shipping_amount else 0 end as shipping_amount
    from public.sales s
    left join public.sale_items i on i.sale_id = s.id
    where s.sold_at >= p_start and s.sold_at < p_end
    group by s.sold_at, s.id, s.pos, s.origin, s.workshop_order_id,
             s.idempotency_key, s.shipping_amount
  ),
  movement_day as (
    select
      (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as day,
      case public.sale_channel(s.pos, s.origin, s.workshop_order_id)
        when 'taller' then 'workshop'
        when 'shopify' then 'shopify'
        else 'atelier'
      end as channel,
      sum(case when coalesce(i.is_other_brand, false) then 0 else m.amount end) as own_amount,
      sum(case when coalesce(i.is_other_brand, false)
               then m.amount * coalesce(i.external_brand_rate, 1) else 0 end) as other_brand_amount
    from public.sale_movements m
    join public.sales s on s.id = m.sale_id
    left join public.sale_items i on i.id = m.sale_item_id
    where (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
    group by 1, 2
  )
  select
    d::date,
    (
      coalesce((select sum(s.own_amount) from sale_day s
                where s.day = d::date and s.channel = 'atelier'), 0)
      + coalesce((select sum(m.own_amount) from movement_day m
                  where m.day = d::date and m.channel = 'atelier'), 0)
    )::numeric,
    (
      coalesce((select sum(s.own_amount) from sale_day s
                where s.day = d::date and s.channel = 'workshop'), 0)
      + coalesce((select sum(m.own_amount) from movement_day m
                  where m.day = d::date and m.channel = 'workshop'), 0)
    )::numeric,
    (
      coalesce((select sum(s.own_amount) from sale_day s
                where s.day = d::date and s.channel = 'shopify'), 0)
      + coalesce((select sum(m.own_amount) from movement_day m
                  where m.day = d::date and m.channel = 'shopify'), 0)
    )::numeric,
    (
      coalesce((select sum(s.other_brand_amount) from sale_day s
                where s.day = d::date), 0)
      + coalesce((select sum(m.other_brand_amount) from movement_day m
                  where m.day = d::date), 0)
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

revoke execute on function public.sales_daily_series(date, date) from public, anon;
grant execute on function public.sales_daily_series(date, date) to authenticated;



create or replace function public.other_brand_sales_breakdown(p_start date, p_end date)
returns table (
  brand text,
  gross_amount numeric,
  real_amount numeric,
  units bigint,
  unmapped_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with entries as (
    select
      coalesce(nullif(trim(i.brand), ''), 'Sin marca') as brand,
      case when i.counts_revenue then
        (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
        + i.exchange_adjustment else 0 end as gross,
      case when i.counts_revenue then
        ((i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
        + i.exchange_adjustment) * coalesce(i.external_brand_rate, 1) else 0 end as real,
      case when i.status = 'active' then i.qty else 0 end as units,
      case when i.counts_revenue and i.external_brand_rate is null then
        (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
        + i.exchange_adjustment else 0 end as unmapped
    from public.sale_items i
    join public.sales s on s.id = i.sale_id
    where i.is_other_brand and s.sold_at >= p_start and s.sold_at < p_end

    union all

    select
      coalesce(nullif(trim(i.brand), ''), 'Sin marca'),
      m.amount,
      m.amount * coalesce(i.external_brand_rate, 1),
      0,
      case when i.external_brand_rate is null then m.amount else 0 end
    from public.sale_movements m
    join public.sale_items i on i.id = m.sale_item_id
    where i.is_other_brand
      and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
  )
  select e.brand, sum(e.gross)::numeric, sum(e.real)::numeric,
         sum(e.units)::bigint, sum(e.unmapped)::numeric
  from entries e
  group by e.brand
  order by sum(e.gross) desc;
$$;

revoke execute on function public.other_brand_sales_breakdown(date, date) from public, anon;
grant execute on function public.other_brand_sales_breakdown(date, date) to authenticated;

commit;
