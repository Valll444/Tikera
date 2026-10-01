-- Arregla un agujero real: la policy "profiles_update_own" deja que cada
-- usuario actualice su propia fila de profiles, pero no dice que columnas
-- puede tocar -- y por default Supabase le da a "authenticated" permiso de
-- UPDATE sobre toda la tabla. Eso significa que, tal cual estaba, cualquier
-- cuenta podia hacer desde la consola del navegador:
--
--   sb.from('profiles').update({ plan: 'cortesia' }).eq('id', miId)
--
-- y regalarse el plan pago sin pasar por ningun control. Esto restringe a
-- nivel de Postgres que columnas puede tocar un usuario de su propia fila:
-- nombre del negocio y foto si, plan y fecha de inicio de prueba no -- esas
-- dos solo se cambian a mano desde el SQL Editor (o, el dia de mañana,
-- desde una Edge Function con service role que valide un pago de verdad).
--
-- Correr una sola vez en el SQL Editor de Supabase (Dashboard > SQL Editor > New query).

revoke update on public.profiles from authenticated;
grant update (business_name, avatar_url) on public.profiles to authenticated;
