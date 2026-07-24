-- CRIPTA Sprite Forge: biblioteca colaborativa, almacenamiento y control de cuota IA.
-- Ejecutar una sola vez en Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.sprite_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_sprite_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sprite_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_sprite_admin() from public;
grant execute on function public.is_sprite_admin() to authenticated;

create table if not exists public.sprite_projects (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  author text not null default 'Sin nombre',
  name text not null default 'Sin nombre',
  payload jsonb not null default '{}'::jsonb,
  thumbnail_path text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sprite_projects_owner_idx on public.sprite_projects(owner_id);
create index if not exists sprite_projects_updated_idx on public.sprite_projects(updated_at desc);

create or replace function public.set_sprite_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sprite_projects_set_updated_at on public.sprite_projects;
create trigger sprite_projects_set_updated_at
before update on public.sprite_projects
for each row execute function public.set_sprite_updated_at();

alter table public.sprite_admins enable row level security;
alter table public.sprite_projects enable row level security;

grant select, insert, update, delete on public.sprite_projects to authenticated;

-- Todos los dispositivos autenticados ven la biblioteca familiar.
drop policy if exists "sprite projects family read" on public.sprite_projects;
create policy "sprite projects family read"
on public.sprite_projects for select
to authenticated
using (true);

-- Cada dispositivo crea proyectos bajo su propia identidad anónima.
drop policy if exists "sprite projects owner insert" on public.sprite_projects;
create policy "sprite projects owner insert"
on public.sprite_projects for insert
to authenticated
with check ((select auth.uid()) = owner_id);

-- El autor y los administradores pueden editar.
drop policy if exists "sprite projects owner admin update" on public.sprite_projects;
create policy "sprite projects owner admin update"
on public.sprite_projects for update
to authenticated
using ((select auth.uid()) = owner_id or public.is_sprite_admin())
with check ((select auth.uid()) = owner_id or public.is_sprite_admin());

-- El autor y los administradores pueden eliminar.
drop policy if exists "sprite projects owner admin delete" on public.sprite_projects;
create policy "sprite projects owner admin delete"
on public.sprite_projects for delete
to authenticated
using ((select auth.uid()) = owner_id or public.is_sprite_admin());

-- Los administradores solo se administran desde el SQL Editor/service role.
drop policy if exists "sprite admins self read" on public.sprite_admins;
create policy "sprite admins self read"
on public.sprite_admins for select
to authenticated
using (user_id = (select auth.uid()));

-- Bucket público: la metadata del proyecto sigue protegida por RLS; las URL de imagen
-- son públicas para que el editor y la Edge Function puedan reutilizarlas sin firmarlas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sprite-assets',
  'sprite-assets',
  true,
  12582912,
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "sprite assets select own folder" on storage.objects;
create policy "sprite assets select own folder"
on storage.objects for select
to authenticated
using (
  bucket_id = 'sprite-assets'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_sprite_admin()
  )
);

drop policy if exists "sprite assets insert own folder" on storage.objects;
create policy "sprite assets insert own folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'sprite-assets'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_sprite_admin()
  )
);

drop policy if exists "sprite assets update own folder" on storage.objects;
create policy "sprite assets update own folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'sprite-assets'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_sprite_admin()
  )
)
with check (
  bucket_id = 'sprite-assets'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_sprite_admin()
  )
);

drop policy if exists "sprite assets delete own folder" on storage.objects;
create policy "sprite assets delete own folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'sprite-assets'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_sprite_admin()
  )
);

-- Realtime para que los cambios aparezcan en los móviles de la familia.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sprite_projects'
  ) then
    alter publication supabase_realtime add table public.sprite_projects;
  end if;
end $$;

-- Presupuesto estimado de Workers AI. Se reserva margen respecto a los 10.000 neurons/día.
create table if not exists public.sprite_app_settings (
  singleton boolean primary key default true check (singleton),
  daily_neuron_limit integer not null default 9000 check (daily_neuron_limit > 0),
  user_daily_neuron_limit integer not null default 3500 check (user_daily_neuron_limit > 0),
  updated_at timestamptz not null default now()
);
insert into public.sprite_app_settings(singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.sprite_ai_daily_usage (
  usage_day date primary key,
  used_neurons integer not null default 0 check (used_neurons >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.sprite_ai_user_daily_usage (
  usage_day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  used_neurons integer not null default 0 check (used_neurons >= 0),
  updated_at timestamptz not null default now(),
  primary key (usage_day, user_id)
);

alter table public.sprite_app_settings enable row level security;
alter table public.sprite_ai_daily_usage enable row level security;
alter table public.sprite_ai_user_daily_usage enable row level security;

drop function if exists public.claim_sprite_ai_budget(integer);
drop function if exists public.refund_sprite_ai_budget(integer);
drop function if exists public.claim_sprite_ai_budget(uuid, integer);
drop function if exists public.refund_sprite_ai_budget(uuid, integer);

-- Solo la Edge Function, usando la clave secreta de Supabase, puede reservar cuota.
-- Así un navegador no puede falsificar devoluciones o alterar el contador diario.
create or replace function public.claim_sprite_ai_budget(
  p_user_id uuid,
  p_estimated_neurons integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_global_used integer := 0;
  v_user_used integer := 0;
  v_global_limit integer;
  v_user_limit integer;
  v_is_admin boolean := false;
begin
  if p_user_id is null then
    raise exception 'User required';
  end if;
  if p_estimated_neurons is null or p_estimated_neurons < 1 then
    raise exception 'Invalid neuron estimate';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cripta-sprite-ai-' || v_day::text, 0));

  select daily_neuron_limit, user_daily_neuron_limit
    into v_global_limit, v_user_limit
  from public.sprite_app_settings
  where singleton = true;

  select coalesce((
    select used_neurons
    from public.sprite_ai_daily_usage
    where usage_day = v_day
  ), 0) into v_global_used;

  select coalesce((
    select used_neurons
    from public.sprite_ai_user_daily_usage
    where usage_day = v_day and user_id = p_user_id
  ), 0) into v_user_used;

  select exists(
    select 1 from public.sprite_admins where user_id = p_user_id
  ) into v_is_admin;

  if v_global_used + p_estimated_neurons > v_global_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_global_limit',
      'remaining', greatest(0, v_global_limit - v_global_used)
    );
  end if;

  if v_user_used + p_estimated_neurons > v_user_limit and not v_is_admin then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_user_limit',
      'remaining', greatest(0, v_global_limit - v_global_used),
      'user_remaining', greatest(0, v_user_limit - v_user_used)
    );
  end if;

  insert into public.sprite_ai_daily_usage(usage_day, used_neurons, updated_at)
  values (v_day, p_estimated_neurons, now())
  on conflict (usage_day) do update
    set used_neurons = public.sprite_ai_daily_usage.used_neurons + excluded.used_neurons,
        updated_at = now();

  insert into public.sprite_ai_user_daily_usage(usage_day, user_id, used_neurons, updated_at)
  values (v_day, p_user_id, p_estimated_neurons, now())
  on conflict (usage_day, user_id) do update
    set used_neurons = public.sprite_ai_user_daily_usage.used_neurons + excluded.used_neurons,
        updated_at = now();

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(0, v_global_limit - v_global_used - p_estimated_neurons),
    'user_remaining', greatest(0, v_user_limit - v_user_used - p_estimated_neurons)
  );
end;
$$;

create or replace function public.refund_sprite_ai_budget(
  p_user_id uuid,
  p_estimated_neurons integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  if p_user_id is null or p_estimated_neurons is null or p_estimated_neurons < 1 then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cripta-sprite-ai-' || v_day::text, 0));
  update public.sprite_ai_daily_usage
    set used_neurons = greatest(0, used_neurons - p_estimated_neurons), updated_at = now()
    where usage_day = v_day;
  update public.sprite_ai_user_daily_usage
    set used_neurons = greatest(0, used_neurons - p_estimated_neurons), updated_at = now()
    where usage_day = v_day and user_id = p_user_id;
end;
$$;

revoke all on function public.claim_sprite_ai_budget(uuid, integer) from public, anon, authenticated;
revoke all on function public.refund_sprite_ai_budget(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_sprite_ai_budget(uuid, integer) to service_role;
grant execute on function public.refund_sprite_ai_budget(uuid, integer) to service_role;

-- Para hacer administrador al dueño, sustituye el UUID por el que muestra la app:
-- insert into public.sprite_admins(user_id) values ('TU-UUID-AQUI') on conflict do nothing;
