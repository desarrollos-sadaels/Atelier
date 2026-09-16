-- ============================================================
-- 0027 — sales_by_seller_channel: los cambios sin recorrer toda la tabla
--
-- En la 0025 los cambios se contaban partiendo de CADA prenda y buscando, con
-- un `join lateral`, si tenía reemplazos. Ese lateral corría para todas las
-- filas de `sale_items`, de toda la historia, cada vez que se abría el reporte:
-- con 70 prendas no se nota; con un año de operación es un escaneo completo
-- por request (salió de la revisión de QA).
--
-- Ahora se parte al revés: de los reemplazos (`exchange_of_item_id is not
-- null`), agrupados por la prenda original. Ese conjunto lo resuelve el índice
-- parcial `idx_sale_items_exchange_of`, y la original se trae por su primary
-- key. El resultado es el mismo — verificado fila por fila contra la versión
-- anterior antes de aplicarla.
--
-- Nada más cambia: misma firma, misma plata (espejo de `sales_kpis`), mismos
-- criterios de devolución y de cambio que documenta la 0025.
-- ============================================================

create or replace function public.sales_by_seller_channel(p_start date, p_end date)
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
  -- Cada prenda original con reemplazos, y cuándo se hizo el cambio (el primer
  -- reemplazo creado). Parte del índice parcial sobre `exchange_of_item_id`.
  exchanges as (
    select r.exchange_of_item_id as original_id, min(r.created_at) as exchanged_at
    from public.sale_items r
    where r.exchange_of_item_id is not null
    group by r.exchange_of_item_id
  ),
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

-- `create or replace` conserva los permisos de la 0025; se repiten para que un
-- entorno levantado desde el repo quede igual aunque se corra suelta.
revoke execute on function public.sales_by_seller_channel(date, date) from public, anon;
grant execute on function public.sales_by_seller_channel(date, date) to authenticated;
