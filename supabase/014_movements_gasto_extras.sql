-- Suma a movements lo que le faltaba a la pantalla de Gasto: categoria (para
-- poder ver despues "cuanto gasto en luz" separado de "cuanto en
-- mercaderia", hoy todo cae junto en descripcion libre), a que proveedor
-- corresponde el pago (hoy Proveedores y Gastos son dos sistemas que no se
-- hablan), y si es un gasto fijo que se repite todos los meses (alquiler,
-- luz, sueldos) para poder distinguirlo de uno puntual en el historial.
-- Correr una sola vez en el SQL Editor de Supabase (Dashboard > SQL Editor > New query).
-- Necesita que ya este corrido 008_proveedores.sql (proveedor_id referencia esa tabla).

alter table public.movements add column if not exists categoria text;
alter table public.movements add column if not exists proveedor_id bigint references public.proveedores(id) on delete set null;
alter table public.movements add column if not exists es_fijo boolean not null default false;

create index if not exists movements_proveedor_id_idx on public.movements(proveedor_id);
