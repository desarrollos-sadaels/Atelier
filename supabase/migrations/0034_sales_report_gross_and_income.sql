-- ============================================================
-- 0034 — Venta bruta e ingreso Sadaels por canal y vendedor
--
-- La venta bruta es lo cobrado por los productos después de descuentos.
-- El ingreso Sadaels descuenta la parte correspondiente a otras marcas.
-- Los envíos se devuelven aparte para no presentarlos como venta de producto.
-- `total_amount` conserva su significado anterior (bruto + envío) para que
-- los consumidores existentes de la función sigan siendo compatibles.
-- ============================================================

begin;

drop function if exists public.sales_by_seller_channel(date, date);

create function public.sales_by_seller_channel(p_start date, p_end date)
returns table (
  seller_id uuid,
  seller_name text,
  channel text,
  total_amount numeric,
  gross_amount numeric,
  income_amount numeric,
  shipping_amount numeric,
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
      ) filter (where i.counts_revenue), 0) as gross_amount,
      coalesce(sum(
        (
          (i.price * (1 - i.discount) * i.qty * (1 - s.sale_discount))
          + i.exchange_adjustment
        ) * case
          when i.is_other_brand then coalesce(i.external_brand_rate, 1)
          else 1
        end
      ) filter (where i.counts_revenue), 0) as income_amount,
      case when coalesce(bool_or(i.counts_revenue), false)
           then s.shipping_amount else 0 end as shipping_amount,
      coalesce(sum(i.qty) filter (where i.status = 'active'), 0) as active_units
    from public.sales s
    left join public.sale_items i on i.sale_id = s.id
    where s.sold_at >= p_start and s.sold_at < p_end
    group by s.id, s.seller_id, s.seller_name, s.pos, s.origin, s.workshop_order_id,
             s.delivered, s.shipping_amount
  ),
  exchanges as (
    select r.exchange_of_item_id as original_id, min(r.created_at) as exchanged_at
    from public.sale_items r
    where r.exchange_of_item_id is not null
    group by r.exchange_of_item_id
  ),
  lines as (
    -- Compras del rango.
    select
      r.seller_id, r.seller_name, r.channel,
      r.gross_amount, r.income_amount, r.shipping_amount,
      r.has_revenue, r.active_units,
      (r.active_units > 0 and not r.delivered) as pending,
      0::bigint as ret_count, 0::bigint as ret_units, 0::numeric as ret_amount,
      0::bigint as exc_count, 0::bigint as exc_units
    from sale_rollup r

    union all
    -- Diferencias y devoluciones monetarias: bruto e ingreso respetan la tasa
    -- histórica de la prenda de otra marca.
    select
      s.seller_id,
      s.seller_name,
      public.sale_channel(s.pos, s.origin, s.workshop_order_id),
      m.amount,
      m.amount * case
        when coalesce(i.is_other_brand, false) then coalesce(i.external_brand_rate, 1)
        else 1
      end,
      0::numeric,
      false, 0, false,
      0, 0, 0, 0, 0
    from public.sale_movements m
    join public.sales s on s.id = m.sale_id
    left join public.sale_items i on i.id = m.sale_item_id
    where (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end

    union all
    -- Metadatos de devoluciones (la plata ya está en sale_movements).
    select
      s.seller_id, s.seller_name, public.sale_channel(s.pos, s.origin, s.workshop_order_id),
      0, 0, 0, false, 0, false,
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
    -- Metadatos de cambios.
    select
      s.seller_id, s.seller_name, public.sale_channel(s.pos, s.origin, s.workshop_order_id),
      0, 0, 0, false, 0, false,
      0, 0, 0,
      1, o.qty
    from exchanges x
    join public.sale_items o on o.id = x.original_id
    join public.sales s on s.id = o.sale_id
    where (x.exchanged_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (x.exchanged_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
  )
  select
    l.seller_id,
    coalesce(nullif(trim(p.full_name), ''), p.email, max(l.seller_name)),
    l.channel,
    coalesce(sum(l.gross_amount + l.shipping_amount), 0)::numeric,
    coalesce(sum(l.gross_amount), 0)::numeric,
    coalesce(sum(l.income_amount), 0)::numeric,
    coalesce(sum(l.shipping_amount), 0)::numeric,
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
  order by 6 desc;
$$;

revoke execute on function public.sales_by_seller_channel(date, date) from public, anon;
grant execute on function public.sales_by_seller_channel(date, date) to authenticated;

comment on function public.sales_by_seller_channel(date, date) is
  'Ventas por vendedor/canal con bruto de productos, ingreso Sadaels y envíos separados.';

commit;
