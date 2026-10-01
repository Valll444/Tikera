# Edge Functions

## delete-account

Borra la cuenta del usuario logueado: sus fotos en Storage y su fila en
`auth.users` (que en cascada se lleva `profiles`, `movements` y `products`,
porque esas tablas ya tienen `on delete cascade`). Necesaria porque Apple
exige que una app que permite crear cuenta también permita borrarla desde
adentro (App Store Guideline 5.1.1(v)) — y porque borrar de verdad requiere
la service role key, que nunca puede estar en el código de app.html.

### Requisitos

- [Supabase CLI](https://supabase.com/docs/guides/cli) instalada (`npm install -g supabase` o `scoop install supabase`).
- Estar logueado: `supabase login`.

### Deploy (una sola vez, y de nuevo cada vez que se edite `index.ts`)

```bash
supabase link --project-ref <tu-project-ref>
supabase functions deploy delete-account
```

El `project-ref` se ve en la URL del dashboard de Supabase
(`https://supabase.com/dashboard/project/<project-ref>`).

### Secretos que necesita

La función lee `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY`. Supabase ya inyecta las dos primeras
automáticamente en toda Edge Function. Solo hay que cargar la service role
key a mano (Settings → API del dashboard, "service_role secret" — **nunca**
la publishable/anon key):

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<tu-service-role-key>
```

### Probarla

Una vez deployada, queda en:

```
https://<project-ref>.supabase.co/functions/v1/delete-account
```

app.html ya está armado para llamarla — no hace falta pegar la URL a mano en
ningún lado, arma la URL sola a partir de `SUPABASE_URL`.

## ai-agent

Asistente de IA (chat flotante, ícono abajo a la derecha) que responde
dudas de plata/negocio con el contexto real del usuario (ventas y gastos
de los últimos 30 días, productos que más venden, proveedores). A
diferencia de `delete-account`, esta función **no** usa la service role
key: lee y escribe autenticada como el usuario que pregunta (con su
propio token), así que queda sujeta a las mismas reglas de RLS de
siempre. Solo necesita la API key de Anthropic, que no puede estar en
app.html.

### Deploy

```bash
supabase functions deploy ai-agent
```

### Secretos que necesita

`SUPABASE_URL` y `SUPABASE_ANON_KEY` ya los inyecta Supabase solo. Lo
único que hay que cargar a mano es la API key de Anthropic — se consigue
en [console.anthropic.com](https://console.anthropic.com/settings/keys):

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Esta es la única función del proyecto que genera costo por uso (se paga por
consulta al modelo). La función ya limita a 20 consultas por día por
usuario para que ese costo no se dispare solo; para cambiar ese número hay
que editar `LIMITE_DIARIO` en `index.ts` y volver a deployar.

## arca-config y arca-facturar

Facturación electrónica (ARCA, ex-AFIP): cada negocio factura bajo su
propio CUIT, con su propio certificado. `arca-config` guarda esa
configuración (CUIT, punto de venta, certificado — cifrado antes de
guardarse, nunca en texto plano) y prueba la conexión contra ARCA.
`arca-facturar` pide el CAE de una venta puntual cuando el usuario aprieta
"Facturar" en el ticket — nunca se dispara solo al guardar una venta.

A diferencia de `ai-agent`, estas dos **sí** usan la service role key, por
el mismo motivo que `delete-account`: el certificado/clave privada no puede
tener ningún permiso hacia el rol `authenticated` (ver
`013_facturacion_arca.sql`), así que un cliente autenticado-como-el-usuario
no alcanza — hace falta poder escribir algo que el propio usuario no podría
escribir directo. La lógica de hablar con ARCA (login WSAA, pedir el CAE)
está compartida en `_shared/arca.ts`.

No se usa la librería `afip.ts`/AfipSDK (depende de paquetes de Node sin
garantía de andar en Deno, y el proyecto está sin mantenimiento activo) —
en cambio, `fetch` nativo para los SOAP de ARCA y
[`pkijs`](https://github.com/PeculiarVentures/PKI.js)/`asn1js` (pensados
para Web Crypto, no para Node) para la firma CMS que pide WSAA. Verificado
con un spike antes de construir la lógica real: ambas importan y firman
limpio en Deno.

### Deploy

```bash
supabase functions deploy arca-config
supabase functions deploy arca-facturar
```

### Secretos que necesita

Además de `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`
(las dos últimas ya las necesita `delete-account`), hace falta una clave
propia para cifrar certificado y clave privada antes de guardarlos — **no**
reusar ninguna de las otras:

```bash
supabase secrets set ARCA_CERT_ENC_KEY=<una cadena larga y random, generada una sola vez>
```

Si se pierde o se cambia esta clave, todos los certificados ya guardados
quedan ilegibles y cada negocio tiene que volver a subir el suyo.

### Antes de usarlo con un negocio real

Arrancar siempre contra homologación (ambiente de pruebas de ARCA) con tu
propio CUIT, nunca contra producción directo — ver la sección de
facturación electrónica en `supabase/README.md` para los pasos.
