-- ============================================================
-- 0029 — Las funciones de trigger no se llaman por la API
--
-- `sync_sale_status()` (0018) y `sync_workshop_order_sale()` (0021) son
-- SECURITY DEFINER y quedaban ejecutables por `anon` y `authenticated` vía
-- `/rest/v1/rpc/...` (advisor de seguridad de Supabase). La 0021 ya hacía
-- `revoke ... from public`, pero en Supabase `anon` y `authenticated` reciben
-- EXECUTE por default privileges propios, no a través de PUBLIC: ese revoke no
-- alcanzaba. Es la misma lección de la 0016 con `handle_new_user()`.
--
-- Son funciones de trigger: llamadas por RPC fallan igual ("trigger functions
-- can only be called as triggers"), así que no había un agujero explotable. Se
-- revoca para que el ACL no dependa de eso.
--
-- Los triggers siguen disparando: Postgres chequea EXECUTE sobre la función al
-- CREAR el trigger, no cada vez que dispara. `service_role` conserva el permiso.
-- ============================================================

revoke execute on function public.sync_sale_status() from public, anon, authenticated;
revoke execute on function public.sync_workshop_order_sale() from public, anon, authenticated;
