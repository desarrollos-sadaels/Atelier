-- ============================================================
-- 0011 — KPIs de ventas por agregación en la base
--
-- La pantalla de Ventas traía TODAS las ventas del mes con `select("*")` para
-- después sumar en JavaScript. Con 200 ventas/día son ~6.000 filas (con nombre,
-- DNI, contacto y domicilio de cada cliente) viajando en cada carga de página.
-- Los KPIs ahora se calculan acá y viajan como cinco números.
--
-- La fórmula del importe es la misma que `saleNet()` en src/lib/sales.ts:
-- precio unitario × cantidad, con el descuento aplicado.
-- ============================================================

create or replace function public.sales_kpis(p_start date, p_end date)
returns table (
  total_amount numeric,
  units bigint,
  operations bigint,
  pending_delivery bigint,
  other_brand_units bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(sum(s.price * (1 - s.discount) * s.qty), 0)::numeric,
    coalesce(sum(s.qty), 0)::bigint,
    count(*)::bigint,
    count(*) filter (where not s.delivered)::bigint,
    coalesce(sum(s.qty) filter (where s.is_other_brand), 0)::bigint
  from public.sales s
  where s.sold_at >= p_start and s.sold_at < p_end;
$$;

-- `security invoker`: corre con los permisos de quien llama, así que las
-- policies de RLS sobre `sales` siguen aplicando normalmente.
grant execute on function public.sales_kpis(date, date) to authenticated;

-- Índice que cubre el orden de la grilla paginada (fecha desc, alta desc).
create index if not exists idx_sales_sold_at_created
  on public.sales (sold_at desc, created_at desc);
