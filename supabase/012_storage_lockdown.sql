-- La funcion de "foto de producto" / "foto de perfil" que usaba el bucket de
-- Storage "uploads" se saco de la app (ahora el logo es fijo, un solo
-- archivo del propio sitio). Pero las policies de 006_storage_fotos.sql
-- siguen activas: cualquier cuenta registrada todavia puede escribir
-- archivos ahi directo contra la API de Supabase (sin pasar por la UI), y
-- son publicos para cualquiera que tenga el link, este logueado o no. Sin
-- una pantalla que lo use, esto no sirve para fotos de verdad -- lo unico
-- que queda es alguien usando el proyecto como hosting de archivos gratis.
--
-- Esto saca el permiso de escritura. La lectura publica se deja (no rompe
-- nada si quedo algun avatar_url viejo apuntando ahi), pero ya no se puede
-- subir, actualizar ni borrar nada nuevo en el bucket.
--
-- Si en algun momento vuelve una pantalla de fotos de producto, hay que
-- volver a crear estas tres policies de 006_storage_fotos.sql.
--
-- Correr una sola vez en el SQL Editor de Supabase (Dashboard > SQL Editor > New query).

drop policy if exists "uploads_insert_own" on storage.objects;
drop policy if exists "uploads_update_own" on storage.objects;
drop policy if exists "uploads_delete_own" on storage.objects;

-- avatar_url tampoco se edita mas desde ningun lado de la app (se borro la
-- pantalla que lo usaba junto con la de "foto de producto" de arriba) --
-- deja de ser una columna que el propio usuario pueda tocar.
revoke update on public.profiles from authenticated;
grant update (business_name) on public.profiles to authenticated;
