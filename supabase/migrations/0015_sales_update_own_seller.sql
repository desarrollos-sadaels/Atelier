-- ============================================================
-- 0015 — Alinear el UPDATE de `sales` con la regla real de negocio:
--        el vendedor toca los toggles de SUS ventas, el admin los de todas.
--
-- Hallazgo (QA 2026-08-18):
--   `PATCH /api/ventas/[id]` exigía requireRole(["admin","vendedor"]) y después
--   updateaba por `id` con service_role, que bypassa RLS. No había chequeo de
--   pertenencia, así que cualquier vendedor podía marcar entregada/facturada
--   una venta ajena mandando el id. La RLS decía otra cosa
--   (`sales_update_admin`, 0006: solo admin), o sea que las dos capas estaban
--   en desacuerdo y la que mandaba era la más floja.
--
--   El handler ya se corrigió (filtra por seller_id cuando el rol es vendedor).
--   Esta migración pone a la RLS a decir lo mismo, para que la regla valga
--   también si algún día se escribe `sales` desde el browser con la anon key.
--
-- Por qué además hacen falta GRANTs por columna:
--   Igual que en 0014: RLS decide QUÉ FILAS se tocan, nunca QUÉ COLUMNAS. Si
--   solo aflojáramos la policy, un vendedor podría editar `price`, `qty`,
--   `discount` o `stock_deducted` de su propia venta desde el browser, salteando
--   la validación de negocio de la API. Los grants acotan la escritura a los dos
--   toggles que la app realmente expone.
--
-- Verificado antes de escribirla: no hay ningún `.from("sales").update(...)`
-- con el cliente anon en src/ — todos los writes de sales van por el admin
-- client (service_role), que no se ve afectado por estos revoke/grant.
-- ============================================================

-- ---------- A) RLS: filas propias o admin ----------
drop policy if exists "sales_update_admin" on public.sales;
drop policy if exists "sales_update_admin_or_own_seller" on public.sales;
create policy "sales_update_admin_or_own_seller" on public.sales
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'
    )
    or seller_id = (select auth.uid())
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'admin'
    )
    or seller_id = (select auth.uid())
  );

-- Nota: las ventas viejas con `seller_id` null quedan solo para admin.
-- `null = auth.uid()` da NULL, que no es true, así que la policy las niega.
-- Es el mismo criterio que aplica el handler.

-- ---------- B) GRANTs: desde el cliente, solo los toggles ----------
-- No se puede revocar una columna suelta de un grant a nivel tabla: hay que
-- revocar la tabla y volver a otorgar solo las columnas permitidas.
revoke update on public.sales from authenticated, anon;
grant update (delivered, invoiced) on public.sales to authenticated;
