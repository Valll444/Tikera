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
| 12 | `012_storage_lockdown.sql` | Saca el permiso de escritura al bucket `uploads` (la pantalla de foto de producto/perfil que lo usaba ya no existe) y le saca `avatar_url` a lo que `profiles_update_own` puede tocar, por el mismo motivo |
| 13 | `013_facturacion_arca.sql` | Tablas `facturacion_config` (CUIT, punto de venta, certificado cifrado por negocio) y `facturas` (CAE por venta) para facturación electrónica ARCA |

Hay además cuatro Edge Functions — `functions/delete-account` (borrado real
de cuenta), `functions/ai-agent` (el asistente de IA) y
`functions/arca-config`/`functions/arca-facturar` (facturación electrónica)
— ver `functions/README.md` para el deploy, que necesita la Supabase CLI y
no se puede hacer desde acá.

Todas las tablas tienen Row Level Security activado: cada cuenta solo puede
leer y modificar sus propios datos (`auth.uid() = user_id`, o `= id` en
`profiles`). En `profiles` especificamente, además de la fila, también está
restringido *qué columnas* puede tocar el propio usuario (ver
`011_profiles_plan_lockdown.sql` y `012_storage_lockdown.sql`) — hoy el
cliente solo puede tocar `business_name`, nada más.

El bucket de Storage `uploads` (de `006_storage_fotos.sql`) quedó sin ninguna
pantalla que lo use — ver `012_storage_lockdown.sql`, que le saca el permiso
de escritura por el mismo motivo que `plan`: una policy de fila sin
restricción de qué puede hacer ahí cualquier cuenta logueada, sin que haga
falta ningún feature roto para que sea un problema.

## Facturación electrónica (ARCA)

`facturacion_config`/`facturas` (`013_facturacion_arca.sql`) van un paso
más allá del patrón de siempre: ni `authenticated` tiene insert/update/
delete en ninguna de las dos (toda escritura pasa por `arca-config`/
`arca-facturar` con service role — ver `functions/README.md`), y en
`facturacion_config` ni siquiera el `select` es parejo — columnas como
`certificado_enc`, `clave_privada_enc`, `wsaa_token` y `wsaa_sign` no tienen
ningún grant hacia el cliente, cifradas o no. No es "no editable", es "no
existe para el navegador".

Para activarlo en un negocio real: primero conectarlo contra el ambiente de
**Homologación** de ARCA (el toggle está en Ajustes), con un certificado de
homologación generado desde el portal de ARCA con tu propio CUIT — nunca
arrancar directo en Producción. `functions/README.md` tiene el detalle de
qué secret hace falta cargar antes de que esto funcione
(`ARCA_CERT_ENC_KEY`).
