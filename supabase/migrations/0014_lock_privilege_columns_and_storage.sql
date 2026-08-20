-- ============================================================
-- 0014 — Cerrar la escalada de privilegios por `profiles.role`
--        + acotar los buckets de Storage
--
-- Hallazgo (QA 2026-08-05, verificado contra producción):
--   La policy `profiles_update_own` (0001) permite UPDATE sobre la propia fila
--   sin restricción de columna. Como `authenticated` tenía el grant de UPDATE a
--   nivel TABLA, eso incluía la columna `role`, y `profiles_role_check` admite
--   'admin'. Resultado: cualquier vendedor/medios logueado podía correr
--
--       supabase.from('profiles').update({ role: 'admin' }).eq('id', <su id>)
--
--   desde el browser con la anon key y quedar admin. Toda la autorización del
--   server (requireRole, el proxy, y las RLS de sales/products/app_settings)
--   lee `profiles.role`, así que un solo UPDATE las derrotaba a todas.
--
-- Por qué se arregla con GRANTs y no con RLS:
--   RLS decide QUÉ FILAS se tocan, nunca QUÉ COLUMNAS. La protección por
--   columna en Postgres son los grants. Además no se puede revocar una columna
--   suelta de un grant a nivel tabla: hay que revocar la tabla y volver a
--   otorgar solo las columnas permitidas.
-- ============================================================

-- ---------- A) profiles: nadie escribe `role` desde el cliente ----------
-- El único cambio legítimo de rol pasa por /api/users/role y por el callback de
-- auth (aceptación de invitación), ambos con service_role, que bypassa RLS y
-- grants. El cliente solo hace SELECT sobre profiles.
revoke update on public.profiles from authenticated, anon;

-- Se devuelve únicamente `full_name`, para que `profiles_update_own` conserve
-- un propósito coherente (que un usuario corrija su propio nombre).
--
-- `email` queda deliberadamente afuera: `resolveRecipients()` (src/lib/notify.ts)
-- elige a quién mandarle las alertas leyendo `profiles.email` de los admins. Si
-- un usuario pudiera reescribir ese campo, podría desviarse los mails de alerta.
grant update (full_name) on public.profiles to authenticated;

-- ---------- B) notifications: el staff solo marca leídas ----------
-- La policy `notifications_update` es `using (true) with check (true)` (0012)
-- para habilitar el "marcar leídas" de la campanita (TopNav). Sin límite de
-- columna eso también dejaba reescribir title/body/severity de cualquier
-- notificación. El grant por columna acota la escritura a lo que la app usa.
revoke update on public.notifications from authenticated, anon;
grant update (read) on public.notifications to authenticated;

-- ---------- C) Storage: límite de tamaño y de tipo ----------
-- Los dos buckets aceptaban cualquier MIME y cualquier tamaño, y el
-- `contentType` lo manda el cliente en el upload.
--
-- Qué arregla el allowlist: Storage guarda y sirve el content-type declarado,
-- así que restringirlo a una lista segura impide que un objeto se sirva como
-- `text/html`. Sumado al `nosniff` que ya manda Supabase, eso cierra el vector
-- de XSS/phishing alojado en el bucket público. NO valida los bytes en sí — un
-- archivo HTML declarado `image/png` se puede subir igual, pero el browser no
-- lo va a ejecutar. El límite de tamaño sí es server-side y no se puede eludir.
--
-- `image/svg+xml` queda excluido a propósito: un SVG puede contener <script>.
update storage.buckets
set file_size_limit = 10485760,  -- 10 MB
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'
    ]
where id = 'product-images';

update storage.buckets
set file_size_limit = 10485760,  -- 10 MB
    allowed_mime_types = array[
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'
    ]
where id = 'invoices';
