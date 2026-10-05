-- Endurece lo que usa el asistente con IA (Edge Function ai-agent, hoy SIN
-- deployar -- ver supabase/functions/README.md y docs/tiki.md). Correr esto
-- ANTES de deployar esa funcion: la funcion nueva lo necesita y, si no
-- esta, se niega a responder (falla cerrada, sin gastar la API).
--
-- 1. Cupo diario por cuenta, contado por la base y no por agent_messages.
--    Antes el limite contaba los mensajes del dia en agent_messages, y como
--    cada usuario puede borrar sus propios mensajes (derecho a borrar su
--    historial), borrandolos recuperaba el cupo: consultas ilimitadas a
--    costa nuestra. Tambien era contar-y-despues-insertar: varias consultas
--    simultaneas pasaban todas el control. Ahora es un solo UPDATE atomico,
--    en una tabla que el usuario puede leer pero no tocar, y el dia se
--    cuenta en hora argentina (antes era UTC: se reseteaba a las 21 hs).
--
-- 2. agent_messages: tope de largo por mensaje (antes un usuario podia
--    insertar directo por la API un mensaje de megas, que la funcion
--    despues mandaba al modelo como historial = costo y lentitud).
--
-- Correr una sola vez en el SQL Editor de Supabase (Dashboard > SQL Editor > New query).
-- Se puede volver a correr sin romper nada. Necesita 010_agent_messages.sql.

create table if not exists public.agent_uso (
  user_id uuid not null references auth.users(id) on delete cascade,
  dia date not null,
  consultas integer not null default 0 check (consultas >= 0),
  primary key (user_id, dia)
);

alter table public.agent_uso enable row level security;
drop policy if exists "agent_uso_select_own" on public.agent_uso;
create policy "agent_uso_select_own" on public.agent_uso
  for select to authenticated using (auth.uid() = user_id);
-- Sin policies de escritura: el unico camino es la funcion de abajo.
revoke insert, update, delete on public.agent_uso from anon, authenticated;
revoke all on public.agent_uso from anon;

-- Suma una consulta al cupo de hoy de la cuenta logueada, si queda cupo.
-- Devuelve cuantas le quedan despues de esta, o -1 si ya no tenia (y en
-- ese caso no suma nada). Llamarla a mano desde el navegador solo sirve
-- para gastar el cupo propio: nunca lo devuelve.
create or replace function public.tiki_consumir_consulta(limite integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  usadas integer;
begin
  if uid is null then
    raise exception 'sin sesion' using errcode = '42501';
  end if;
  if limite is null or limite < 1 or limite > 500 then
    raise exception 'limite invalido' using errcode = '22023';
  end if;
  insert into public.agent_uso as u (user_id, dia, consultas)
  values (uid, hoy, 1)
  on conflict (user_id, dia) do update set consultas = u.consultas + 1
    where u.consultas < limite
  returning u.consultas into usadas;
  if usadas is null then
    return -1;
  end if;
  return limite - usadas;
end;
$$;

revoke all on function public.tiki_consumir_consulta(integer) from public, anon;
grant execute on function public.tiki_consumir_consulta(integer) to authenticated;

-- not valid: no revisa filas viejas (si hubiera alguna enorme, la migracion
-- no falla), pero si todo lo que se inserte de aca en adelante.
alter table public.agent_messages drop constraint if exists agent_messages_content_largo;
alter table public.agent_messages add constraint agent_messages_content_largo
  check (char_length(content) <= 4000) not valid;

-- Retencion (opcional, recomendado si se activa el asistente con IA): borrar
-- charlas de mas de 90 dias. Requiere la extension pg_cron (Dashboard >
-- Database > Extensions). Descomentar despues de activarla:
-- select cron.schedule('tiki-borrar-charlas-viejas', '15 4 * * *',
--   $$delete from public.agent_messages where created_at < now() - interval '90 days'$$);
