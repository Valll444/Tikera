-- Perfil del comercio: rubro(s) y módulos habilitados, para que Tikera se
-- adapte al tipo de negocio (kiosco, celulares, ropa, gastronomía, etc.).
--
-- No toca ningún dato existente ni rompe a los usuarios que ya venían usando
-- Tikera: las columnas arrancan vacías y la app trata "vacío" como "todos los
-- módulos activos" (config legacy), así nadie pierde funciones. El onboarding
-- de ahí en más escribe los módulos elegidos.
--
-- Los módulos son personalización de UX (qué ve/usa cada comercio). El
-- aislamiento entre cuentas lo sigue garantizando RLS: cada usuario solo
-- accede a SUS datos, habilite el módulo que habilite. Por eso NO hace falta
-- "bloquear módulos" a nivel de Postgres (no hay escalada posible).
--
-- Correr una sola vez en el SQL Editor de Supabase (Dashboard > SQL Editor > New query).

alter table public.profiles
  add column if not exists rubros jsonb not null default '[]'::jsonb,
  add column if not exists modulos jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_at timestamptz;

-- El usuario puede editar su propio rubro/módulos. plan y trial_started_at
-- siguen fuera de su alcance (ver 011_profiles_plan_lockdown.sql): se re-otorga
-- el UPDATE por columnas sumando las nuevas, sin volver a dar las prohibidas.
revoke update on public.profiles from authenticated;
grant update (business_name, avatar_url, rubros, modulos, onboarding_at)
  on public.profiles to authenticated;
