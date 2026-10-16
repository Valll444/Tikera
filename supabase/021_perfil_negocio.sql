-- Perfil del comercio que arma el onboarding en pasos: antigüedad del negocio,
-- volumen de ventas por día y forma de cobro habitual. Son datos de
-- personalización (ajustan el tono de Tiki, las proyecciones y el método de
-- pago por defecto) — el aislamiento entre cuentas lo sigue garantizando RLS.
--
-- No toca ningún dato existente: la columna arranca vacía ('{}') y el código
-- funciona igual antes y después de correr esto (lee 'perfil' aparte y tolera
-- que no exista todavía; al guardar reintenta sin 'perfil' si falla).
--
-- Correr una sola vez en el SQL Editor de Supabase (Dashboard > SQL Editor > New query).

alter table public.profiles
  add column if not exists perfil jsonb not null default '{}'::jsonb;

-- El usuario puede editar su propio perfil. Se re-otorga el UPDATE por columnas
-- sumando 'perfil', sin volver a dar las prohibidas (plan, trial_started_at —
-- ver 011_profiles_plan_lockdown.sql).
revoke update on public.profiles from authenticated;
grant update (business_name, avatar_url, rubros, modulos, onboarding_at, perfil)
  on public.profiles to authenticated;
