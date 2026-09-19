-- Categoría de producto, para poder agrupar y filtrar el catálogo
-- (Bebidas, Almacén, Cigarrillos, etc.) en vez de una lista larga sin dividir.
-- Correr una sola vez en el SQL Editor de Supabase (Dashboard > SQL Editor > New query).

alter table public.products add column if not exists categoria text;
