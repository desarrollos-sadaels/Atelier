-- ============================================================
-- Atelier — esquema inicial (Fase 1)
-- Herramienta interna: todos los usuarios autenticados son staff
-- (acceso restringido por dominio de Google en el callback de auth).
-- Por eso las tablas de negocio son de lectura/escritura compartida
-- para el rol `authenticated`. La sync server-to-server usa la
-- service_role key (que bypassa RLS).
-- ============================================================

-- ---------- profiles (1:1 con auth.users) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'viewer'
    check (role in ('admin', 'media', 'pauta', 'compras', 'viewer')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_team" on public.profiles;
create policy "profiles_select_team" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Crear el perfil automáticamente al registrarse un usuario.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- products ----------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  shopify_id text unique,
  sku text unique,
  name text not null,
  category text,
  price numeric(12, 2),
  cost numeric(12, 2),
  stock integer not null default 0,
  alert_threshold integer not null default 10,
  shopify_status text default 'active',
  barcode text,
  provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- campaigns (Meta Ads) ----------
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  meta_campaign_id text unique,
  name text not null,
  objective text,
  status text default 'active',
  ad_set text,
  budget_daily numeric(12, 2),
  spend_7d numeric(12, 2),
  reach_7d bigint,
  purchases_7d integer,
  roas numeric(6, 2),
  updated_at timestamptz not null default now()
);

-- ---------- product ↔ campaign links ----------
create table if not exists public.product_campaign_links (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  auto_action text not null default 'suggest'
    check (auto_action in ('suggest', 'pause', 'notify')),
  created_at timestamptz not null default now(),
  unique (product_id, campaign_id)
);

-- ---------- automation rules ----------
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trigger text not null default 'out_of_stock',
  threshold integer not null default 3,
  action text not null default 'suggest_pause'
    check (action in ('suggest_pause', 'auto_pause', 'notify_only')),
  notify_email boolean not null default true,
  notify_slack boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- notifications ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  body text,
  product_id uuid references public.products (id) on delete set null,
  severity text not null default 'info' check (severity in ('info', 'warn', 'alert')),
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- RLS para tablas de negocio (staff compartido) ----------
do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'campaigns', 'product_campaign_links',
    'automation_rules', 'notifications'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "%s_rw_staff" on public.%I;', t, t);
    execute format(
      'create policy "%s_rw_staff" on public.%I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end$$;

-- ---------- índices útiles ----------
create index if not exists idx_products_stock on public.products (stock);
create index if not exists idx_notifications_created on public.notifications (created_at desc);
create index if not exists idx_links_product on public.product_campaign_links (product_id);
