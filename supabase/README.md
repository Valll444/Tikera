# Esquema de base de datos

Migraciones en orden. Para levantar un proyecto de Supabase nuevo desde
cero, correrlas en este orden en el SQL Editor (Dashboard → SQL Editor →
New query). En el proyecto real de Tikera ya están todas aplicadas.

| # | Archivo | Qué agrega |
|---|---|---|
| 1 | `001_profiles.sql` | Tabla `profiles` (nombre del negocio, foto, plan) + trigger que crea el perfil al registrarse |
| 2 | `002_movements.sql` | Tabla `movements`: cada venta o gasto cargado |
| 3 | `003_products.sql` | Tabla `products`: catálogo con stock |
| 4 | `004_products_codigo_barras.sql` | Código de barras por producto |
| 5 | `005_products_categoria.sql` | Categoría por producto (para agrupar el catálogo) |
| 6 | `006_storage_fotos.sql` | Bucket de Storage `uploads` + columnas `imagen_url` / `avatar_url` para fotos de producto y de perfil |
| 7 | `007_frequent_items.sql` | Tabla `frequent_items`: chips de "producto/gasto frecuente" en la pantalla Cargar |
| 8 | `008_proveedores.sql` | Tablas `proveedores` y `pedidos_proveedor`: a quién le comprás y qué le debés |
| 9 | `009_cierres_caja.sql` | Tabla `cierres_caja`: efectivo esperado vs. contado por día, para detectar diferencias de caja |
| 10 | `010_agent_messages.sql` | Tabla `agent_messages`: historial de la conversación con el asistente de IA |
| 11 | `011_profiles_plan_lockdown.sql` | Restringe qué columnas de `profiles` puede editar el propio usuario — `plan` y `trial_started_at` quedan fuera, solo editables a mano (antes cualquier cuenta podía regalarse el plan pago desde la consola del navegador) |

Hay además dos Edge Functions — `functions/delete-account` (borrado real de
cuenta) y `functions/ai-agent` (el asistente de IA) — ver `functions/README.md`
para el deploy, que necesita la Supabase CLI y no se puede hacer desde acá.

Todas las tablas tienen Row Level Security activado: cada cuenta solo puede
leer y modificar sus propios datos (`auth.uid() = user_id`, o `= id` en
`profiles`). En `profiles` especificamente, además de la fila, también está
restringido *qué columnas* puede tocar el propio usuario (ver
`011_profiles_plan_lockdown.sql`) — `plan` y `trial_started_at` no se pueden
cambiar desde el cliente, ni editando su propia fila.
