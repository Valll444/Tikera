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
`SUPABASE_SERVICE_ROLE_KEY`. Supabase inyecta **las tres** automáticamente
en toda Edge Function (se puede ver con `supabase secrets list`, que muestra
solo los nombres y una huella, nunca el valor): no hay que cargar nada a
mano. La service role key no tiene que aparecer nunca en `app.html` ni en
`js/`.

### Probarla

Una vez deployada, queda en:

```
https://<project-ref>.supabase.co/functions/v1/delete-account
```

app.html ya está armado para llamarla — no hace falta pegar la URL a mano en
ningún lado, arma la URL sola a partir de `SUPABASE_URL`.

## ai-agent

> **Hoy no está deployada ni conectada a la app.** El asistente que usa la
> app es Tiki, con motor propio en `js/tiki.js` (sin IA externa ni costo por
> consulta). Esta función es la etapa 2: Tiki con Claude. Diseño, amenazas
> y lo que falta para activarla: [`docs/tiki.md`](../../docs/tiki.md).

Recibe una pregunta, arma un resumen chico del negocio del usuario (ventas
y gastos de hoy/7/30 días, lo que más factura, deudas con proveedores,
último cierre y lo que el usuario le pidió recordar a Tiki) y se lo pasa a
Claude junto con los últimos 10 mensajes de la charla.

- **Aislamiento:** no usa la service role key. Lee y escribe con el token
  del usuario que pregunta, así que RLS limita todo a su cuenta. El modelo
  no tiene herramientas: no puede consultar la base, solo contestar texto.
- **Costo:** antes de llamar a la API corta si la prueba gratis venció y
  descuenta el cupo diario (20 consultas, en hora argentina) con
  `tiki_consumir_consulta`, una función atómica de la base (`016`). Si esa
  función no existe, la función se niega a responder.
- **Prompt injection:** las reglas van solas en el system prompt; los datos
  (que escribe el usuario o vienen de un Excel importado) van aparte,
  limpios y marcados como datos (`prompt.ts`, probado en `prompt.test.ts`).
- **Errores:** el usuario ve siempre un mensaje genérico; los logs guardan
  el tipo de error, nunca el contenido de la charla.

### Antes de deployar

1. Correr `015_tiki_memoria.sql` y `016_tiki_agente_seguro.sql`.
2. Actualizar `privacidad.html#tiki`: hoy promete que las preguntas a Tiki
   no salen del dispositivo, y con esta función van a Anthropic.
3. Conectar la pantalla de Tiki a esta función (opt-in del usuario).

### Deploy y secretos

```bash
supabase functions deploy ai-agent
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Opcionales: `TIKI_MODEL` (por defecto `claude-haiku-4-5`, el más barato) y
`TIKI_ALLOWED_ORIGINS` (orígenes permitidos separados por coma, por ejemplo
`https://valll444.github.io`; por defecto cualquiera).

### Probarla sin gastar

```bash
deno check supabase/functions/ai-agent/index.ts
deno test supabase/functions/ai-agent/
```

Esta es la única función del proyecto que genera costo por uso. Para
cambiar el cupo diario, editar `LIMITE_DIARIO` en `index.ts`.

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
