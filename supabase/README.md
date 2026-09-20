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

Hay además una Edge Function (`functions/delete-account`) para el borrado real
de cuenta — ver `functions/README.md` para el deploy, que necesita la
Supabase CLI y no se puede hacer desde acá.

Todas las tablas tienen Row Level Security activado: cada cuenta solo puede
leer y modificar sus propios datos (`auth.uid() = user_id`, o `= id` en
`profiles`).
