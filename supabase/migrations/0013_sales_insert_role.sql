-- ============================================================
-- 0013 — Restringir el INSERT de sales a admin/vendedor (medios es solo lectura)
--
-- La policy "sales_insert_staff" (0006) dejaba insertar a cualquier staff
-- autenticado, redactada antes de que el modelo de roles definiera a `medios`
-- como solo-lectura de ventas (ver src/lib/roles.ts). La API (/api/ventas
-- POST) ya exige requireRole(["admin","vendedor"]), pero la RLS no: un
-- usuario `medios` podía insertar directo en `sales` con el cliente de
-- Supabase (browser), sin pasar por la API ni su validación de negocio
-- (idempotencia, variante válida, etc.).
-- ============================================================

drop policy if exists "sales_insert_staff" on public.sales;
create policy "sales_insert_admin_vendedor" on public.sales
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role in ('admin', 'vendedor')
    )
  );

-- Constraint que faltaba junto a los de qty/discount (0006): un INSERT
-- directo (fuera de la API, que ya valida price > 0) podía guardar un precio
-- en cero o negativo. Verificado contra prod: 0 filas existentes lo violan.
alter table public.sales
  add constraint sales_price_positive check (price > 0);
