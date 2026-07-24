-- ============================================================
-- 0012 — Realinear las RLS al modelo de roles vigente
--
-- Contexto del drift (ver también el ledger de la DB):
--   * 0001 creó políticas always-true (`using (true) with check (true)`).
--   * Una migración `harden_rls` — aplicada en la DB pero que NUNCA quedó como
--     archivo en el repo — las reemplazó por `role <> 'viewer'`.
--   * 0006 después eliminó el rol `viewer` (los roles pasaron a
--     admin/medios/vendedor). Desde entonces `role <> 'viewer'` da verdadero
--     para cualquier usuario con perfil: el hardening quedó en no-op.
--
-- Esta migración fija el estado FINAL deseado con DROP + CREATE idempotente, de
-- modo que la base reproduzca lo mismo si se levanta desde el repo (partiendo de
-- las always-true) o desde producción (partiendo de las `<> 'viewer'`).
--
-- Modelo real de acceso, verificado contra el código:
--   * Todas las mutaciones de negocio de `products` y de las tablas de Meta van
--     por la service_role (Shopify sync, webhooks, API de productos, ventas),
--     que bypassa RLS. Ningún usuario autenticado escribe estas tablas directo.
--   * La ÚNICA escritura por cliente autenticado es marcar notificaciones como
--     leídas (TopNav): un UPDATE sobre `notifications` que hace todo el staff.
--
-- Por eso: lectura para el staff, escritura solo admin, salvo el UPDATE de
-- notifications que queda abierto al staff para preservar el "marcar leídas".
-- ============================================================

do $$
declare
  t text;
  is_admin text := 'exists (select 1 from public.profiles p '
                || 'where p.id = (select auth.uid()) and p.role = ''admin'')';
begin
  foreach t in array array[
    'products', 'campaigns', 'product_campaign_links', 'automation_rules', 'notifications'
  ] loop
    -- Limpiar cualquier política previa (nombres de 0001 y de harden_rls).
    execute format('drop policy if exists "%1$s_rw_staff" on public.%1$I;', t);
    execute format('drop policy if exists "%1$s_select" on public.%1$I;', t);
    execute format('drop policy if exists "%1$s_insert" on public.%1$I;', t);
    execute format('drop policy if exists "%1$s_update" on public.%1$I;', t);
    execute format('drop policy if exists "%1$s_delete" on public.%1$I;', t);

    -- Lectura: todo el staff autenticado.
    execute format(
      'create policy "%1$s_select" on public.%1$I for select to authenticated using (true);', t);
    -- Escritura: solo admin (la app real escribe con service_role, que bypassa RLS).
    execute format(
      'create policy "%1$s_insert" on public.%1$I for insert to authenticated with check (%2$s);', t, is_admin);
    execute format(
      'create policy "%1$s_delete" on public.%1$I for delete to authenticated using (%2$s);', t, is_admin);
  end loop;
end$$;

-- UPDATE por tabla: admin en general, pero notifications abierto al staff para
-- que la campanita pueda marcar leídas (única escritura autenticada del app).
do $$
declare
  t text;
  is_admin text := 'exists (select 1 from public.profiles p '
                || 'where p.id = (select auth.uid()) and p.role = ''admin'')';
begin
  foreach t in array array['products', 'campaigns', 'product_campaign_links', 'automation_rules'] loop
    execute format(
      'create policy "%1$s_update" on public.%1$I for update to authenticated using (%2$s) with check (%2$s);',
      t, is_admin);
  end loop;
end$$;

create policy "notifications_update" on public.notifications
  for update to authenticated using (true) with check (true);
