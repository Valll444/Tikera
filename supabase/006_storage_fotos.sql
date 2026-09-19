-- Fotos de producto y foto de perfil del negocio: comparten un solo bucket
-- de Storage ("uploads"), cada archivo bajo una carpeta con el user_id para
-- poder restringir quién puede subir/borrar qué.
-- Correr una sola vez en el SQL Editor de Supabase (Dashboard > SQL Editor > New query).

-- 1) Bucket público (las fotos se ven sin necesidad de estar logueado,
--    igual que cualquier imagen de un catálogo online).
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

-- 2) Cualquiera puede LEER (bucket público), pero solo el dueño de la
--    carpeta (su propio user_id) puede subir, actualizar o borrar ahí.
create policy "uploads_read_all" on storage.objects
  for select using (bucket_id = 'uploads');

create policy "uploads_insert_own" on storage.objects
  for insert with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "uploads_update_own" on storage.objects
  for update using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "uploads_delete_own" on storage.objects
  for delete using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3) Columnas donde guardar la URL pública de cada foto.
alter table public.products add column if not exists imagen_url text;
alter table public.profiles add column if not exists avatar_url text;
