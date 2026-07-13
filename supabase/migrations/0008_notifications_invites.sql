-- ============================================================
-- 0008 — Invitaciones de usuarios + Realtime en notifications
-- ============================================================

-- ---------- A) invitations ----------
-- Habilita loguear a un email fuera del dominio (además del gate por dominio env).
create table if not exists public.invitations (
  email text primary key,
  role text not null default 'vendedor' check (role in ('admin', 'medios', 'vendedor')),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

alter table public.invitations enable row level security;

-- Todo el staff puede ver las invitaciones.
drop policy if exists "invitations_select_staff" on public.invitations;
create policy "invitations_select_staff" on public.invitations
  for select to authenticated using (true);

-- Crear/editar/borrar invitaciones: solo admin.
drop policy if exists "invitations_write_admin" on public.invitations;
create policy "invitations_write_admin" on public.invitations
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

-- ---------- B) Realtime en notifications (campanita en vivo) ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
