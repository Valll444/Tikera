-- Código de barras por producto: escaneo con lector físico o generación de
-- un código interno (prefijo GS1 "20", reservado para uso interno de
-- comercios) para productos que no traen uno de fábrica.
--
-- NOTA: esto ya está aplicado en la base real de Tikera. Se documenta acá
-- para que el repo sea reproducible desde cero.

alter table public.products add column if not exists codigo_barras text;

-- Único por negocio (no global): dos kioscos distintos pueden tener el
-- mismo código sin problema; el mismo kiosco no puede repetirlo. Se
-- permiten múltiples NULL (productos sin código todavía).
create unique index if not exists products_codigo_barras_user_uniq
  on public.products(user_id, codigo_barras)
  where codigo_barras is not null;
