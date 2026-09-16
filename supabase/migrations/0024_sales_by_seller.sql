-- ============================================================
-- 0024 — Reporte de ventas: por vendedor y por canal
--
-- El reporte necesita la misma plata que muestran los KPIs, abierta por quién
-- tiene cada compra a su nombre y por el canal por el que entró. Se agrega en
-- la base por la misma razón que `sales_kpis`: traer las filas para sumarlas en
-- JavaScript es mover datos de clientes al server para devolver unos números.
--
-- Devuelve UNA fila por (vendedor, canal) y no una por vendedor: con esa sola
-- consulta la app arma el resumen por canal, el ranking por vendedor y el
-- resumen de un empleado, sin una función por vista.
--
-- La fórmula es un ESPEJO de `sales_kpis` tal como estaba en producción, no de
-- la versión de la 0018: la función viva además suma `sales.shipping_amount` y
-- los movimientos de `sale_movements`. Cuando se escribió, ese DDL (junto con
-- `workshop_orders` y su trigger) existía en la base sin archivo en el repo;
-- ahora lo traen la 0019 y la 0021 (Taller), que corren antes que esta.
--
-- Invariante que la hace confiable: la suma de TODAS las filas es, columna por
-- columna, lo que devuelve `sales_kpis` para el mismo rango. Si una de las dos
-- cambia la fórmula, la otra también. Se verificó contra datos reales
-- (15/08–14/09/2026: 5.406.100 en 22 operaciones y 31 unidades, igual en las dos).
--
-- Atribución:
--   - Una compra cuenta para su `seller_id`. Los pedidos web llegan sin dueño
--     (`seller_id` null) y quedan en su propia fila hasta que un vendedor los
--     reclama desde Ventas; no se reparten ni se esconden.
--   - Un movimiento (devolución, diferencia de un cambio) cuenta para el
--     vendedor y el canal de la compra ORIGINAL, en la fecha en que ocurrió —
--     el mismo criterio de fechas que `sales_kpis`.
--   - El nombre sale del perfil actual; `sales.seller_name` (la foto del
--     momento de la venta) es solo el fallback para perfiles que ya no están.
--
-- `security invoker`: corre con la RLS de quien consulta. Hoy toda la staff
-- lee todas las ventas, así que el recorte "el vendedor ve solo lo suyo" lo
-- hace la app. Si algún día la RLS de `sales` se acota por vendedor, esta
-- función lo hereda sola.
-- ============================================================

-- ---------- canal de una compra ----------
--
-- No hay columna de canal: sale del punto de venta y la plataforma, en este
-- orden de prioridad.
--
--   taller      — pedidos del taller. Los crea el trigger de `workshop_orders`
--                 con `pos = 'TALLER'`; el `workshop_order_id` cubre una venta
--                 del taller a la que después le cambiaron el punto de venta.
--   mayoristas  — punto de venta MAYORISTAS (cargado desde el alta o la edición).
--   shopify     — el resto de lo que entró por la tienda online.
--   atelier     — el resto de lo cargado en la app: local, chat, redes.
--
-- Espejo en `saleChannel` (src/lib/sales-report.ts), que lo usa el CSV de
-- detalle. Si cambia uno, cambia el otro.
create or replace function public.sale_channel(
  p_pos text,
  p_origin text,
  p_workshop_order_id uuid
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when upper(trim(coalesce(p_pos, ''))) = 'TALLER' or p_workshop_order_id is not null then 'taller'
    when upper(trim(coalesce(p_pos, ''))) = 'MAYORISTAS' then 'mayoristas'
    when p_origin = 'shopify' then 'shopify'
    else 'atelier'
  end
$$;

-- ---------- ventas por vendedor y canal ----------

create or replace function public.sales_by_seller_channel(p_start date, p_end date)
returns table (
  seller_id uuid,
  seller_name text,
  channel text,
  total_amount numeric,
  units bigint,
  operations bigint,
  pending_delivery bigint,
  returned_amount numeric,
  returned_count bigint
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
  -- Compras y movimientos en una sola lista para agrupar una vez. Un FULL JOIN
  -- por `seller_id` no sirve: el null de los pedidos web no matchea consigo
  -- mismo, y Postgres no acepta `is not distinct from` como condición de un
  -- full join.
  lines as (
    select
      r.seller_id,
      r.seller_name,
      r.channel,
      r.amount,
      r.has_revenue,
      r.active_units,
      (r.active_units > 0 and not r.delivered) as pending,
      null::text as movement_kind
    from sale_rollup r
    union all
    select
      s.seller_id,
      s.seller_name,
      public.sale_channel(s.pos, s.origin, s.workshop_order_id),
      m.amount,
      false,
      0,
      false,
      m.kind
    from public.sale_movements m
    join public.sales s on s.id = m.sale_id
    where (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date >= p_start
      and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date < p_end
  )
  select
    l.seller_id,
    coalesce(nullif(trim(p.full_name), ''), p.email, max(l.seller_name)),
    l.channel,
    coalesce(sum(l.amount), 0)::numeric,
    coalesce(sum(l.active_units), 0)::bigint,
    count(*) filter (where l.has_revenue)::bigint,
    count(*) filter (where l.pending)::bigint,
    coalesce(-sum(l.amount) filter (where l.movement_kind = 'return'), 0)::numeric,
    count(*) filter (where l.movement_kind = 'return')::bigint
  from lines l
  left join public.profiles p on p.id = l.seller_id
  group by l.seller_id, l.channel, p.full_name, p.email
  order by 4 desc;
$$;

-- Las funciones nacen ejecutables por PUBLIC (la lección de la 0016): sin este
-- revoke, `anon` también podría llamarlas. No leería nada —la RLS de `sales` es
-- solo para `authenticated`—, pero el ACL no debería depender de eso.
revoke execute on function public.sale_channel(text, text, uuid) from public, anon;
grant execute on function public.sale_channel(text, text, uuid) to authenticated;
revoke execute on function public.sales_by_seller_channel(date, date) from public, anon;
grant execute on function public.sales_by_seller_channel(date, date) to authenticated;

comment on function public.sale_channel(text, text, uuid) is
  'Canal de una compra (taller / mayoristas / shopify / atelier). Espejo de saleChannel en src/lib/sales-report.ts.';
comment on function public.sales_by_seller_channel(date, date) is
  'Ventas del rango [p_start, p_end) por vendedor y canal. La suma de todas las filas es igual a sales_kpis.';
