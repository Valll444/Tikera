-- Endurece producto_variantes (019): el WITH CHECK solo exigia que la fila
-- fuera de la cuenta (user_id = auth.uid()), pero NO que el product_id sea un
-- producto PROPIO. Como los id de products son bigint correlativos y
-- enumerables, una cuenta podia insertar directo por la API una variante
-- apuntando al producto de otra cuenta:
--
--   sb.from('producto_variantes').insert({ user_id: miId, product_id: <ajeno> })
--
-- Impacto acotado (no filtra datos del otro: el select sigue siendo por
-- user_id propio), pero (a) acopla filas a un producto ajeno que se borran en
-- cascada cuando el otro lo elimina, y (b) da un oraculo de existencia: el
-- insert exito/falla segun exista el product_id. Es exactamente el agujero
-- cross-tenant que 008_proveedores.sql ya cierra para pedidos_proveedor.
--
-- Esto agrega la validacion de propiedad del producto, igual que alla. No
-- rompe el uso legitimo: la app siempre crea variantes sobre un producto propio.
--
-- Correr una sola vez en el SQL Editor de Supabase (Dashboard > SQL Editor > New query).
-- Se puede volver a correr sin romper nada. Necesita 019_producto_variantes.sql.

drop policy if exists "variantes_insert_own" on public.producto_variantes;
create policy "variantes_insert_own" on public.producto_variantes
  for insert with check (
    auth.uid() = user_id
    and exists (select 1 from public.products p where p.id = product_id and p.user_id = auth.uid())
  );

drop policy if exists "variantes_update_own" on public.producto_variantes;
create policy "variantes_update_own" on public.producto_variantes
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.products p where p.id = product_id and p.user_id = auth.uid())
  );
