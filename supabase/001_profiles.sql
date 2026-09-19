-- Perfil de cada cuenta: nombre del negocio, foto, y el estado del plan
-- (prueba gratuita / pago / cortesía) que controla el acceso a la app.
--
-- NOTA: esto ya está aplicado en la base real de Tikera (se armó a mano,
-- paso a paso, en el SQL Editor). Este archivo documenta el esquema
-- completo para que el repo sea reproducible desde cero -- no hace falta
-- volver a correrlo salvo que estés levantando un proyecto de Supabase
-- nuevo.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_name text,
  plan text not null default 'trial', -- 'trial' | 'pago' | 'cortesia'
  trial_started_at timestamptz not null default now(),
  avatar_url text
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Crea el perfil automáticamente cuando alguien se registra, tomando el
-- nombre del negocio que se manda como metadata en el signup
-- (sb.auth.signUp({ options: { data: { business_name } } }) en app.html).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, business_name)
  values (new.id, new.raw_user_meta_data->>'business_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
