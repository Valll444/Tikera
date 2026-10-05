-- Memoria de Tiki: lo que el usuario le pide EXPLICITAMENTE que recuerde y
-- confirma con un boton (o un "si"). No es un historial de charla: el texto
-- de las conversaciones no se guarda en ningun lado. Solo 3 cosas, con
-- forma fija:
--   horario_cierre     {"hora": 0-23, "minuto": 0-59}
--   dias_cerrado       {"dias": [0-6, ...]}        (0 = domingo, sin repetir)
--   meta_venta_diaria  {"monto": numero >= 1}
-- Una fila por clave y por cuenta (primary key): como mucho 3 filas por
-- usuario, asi que no crece con el uso.
--
-- Aislamiento entre cuentas: RLS por auth.uid() = user_id en las cuatro
-- operaciones, igual que el resto de las tablas. js/tiki.js tambien filtra
-- por user_id, pero la garantia es esta, no el codigo del navegador.
-- Diseño completo de la memoria: docs/tiki.md.
--
-- Correr una sola vez en el SQL Editor de Supabase (Dashboard > SQL Editor > New query).
-- Se puede volver a correr sin romper nada.

create or replace function public.tiki_dias_validos(d jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(d) = 'array'
    and jsonb_array_length(d) <= 6
    and coalesce((select bool_and(jsonb_typeof(x) = 'number' and x::text ~ '^[0-6]$') from jsonb_array_elements(d) as x), true)
    and (select count(distinct x) = count(*) from jsonb_array_elements(d) as x)
$$;

create table if not exists public.tiki_memoria (
  user_id uuid not null references auth.users(id) on delete cascade,
  clave text not null,
  valor jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, clave),
  constraint tiki_memoria_clave_valida check (clave in ('horario_cierre', 'dias_cerrado', 'meta_venta_diaria')),
  constraint tiki_memoria_valor_chico check (pg_column_size(valor) <= 256),
  constraint tiki_memoria_forma check (
    case clave
      when 'horario_cierre' then
        case when jsonb_typeof(valor->'hora') = 'number' and jsonb_typeof(valor->'minuto') = 'number'
          then (valor->>'hora') ~ '^([0-9]|1[0-9]|2[0-3])$' and (valor->>'minuto') ~ '^([0-9]|[1-5][0-9])$'
          else false end
      when 'dias_cerrado' then public.tiki_dias_validos(valor->'dias')
      when 'meta_venta_diaria' then
        case when jsonb_typeof(valor->'monto') = 'number'
          then (valor->>'monto')::numeric >= 1 and (valor->>'monto')::numeric < 10000000000
          else false end
      else false
    end
  )
);

alter table public.tiki_memoria enable row level security;

drop policy if exists "tiki_memoria_select_own" on public.tiki_memoria;
drop policy if exists "tiki_memoria_insert_own" on public.tiki_memoria;
drop policy if exists "tiki_memoria_update_own" on public.tiki_memoria;
drop policy if exists "tiki_memoria_delete_own" on public.tiki_memoria;

create policy "tiki_memoria_select_own" on public.tiki_memoria
  for select to authenticated using (auth.uid() = user_id);
create policy "tiki_memoria_insert_own" on public.tiki_memoria
  for insert to authenticated with check (auth.uid() = user_id);
create policy "tiki_memoria_update_own" on public.tiki_memoria
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tiki_memoria_delete_own" on public.tiki_memoria
  for delete to authenticated using (auth.uid() = user_id);

-- Sin sesion no hay nada que hacer en esta tabla.
revoke all on public.tiki_memoria from anon;

-- updated_at lo pone la base, no el navegador.
create or replace function public.tiki_memoria_tocar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tiki_memoria_updated_at on public.tiki_memoria;
create trigger tiki_memoria_updated_at
  before update on public.tiki_memoria
  for each row execute function public.tiki_memoria_tocar();
