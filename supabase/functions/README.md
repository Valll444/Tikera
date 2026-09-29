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
de los últimos 30 días, productos que más venden, proveedores). Necesita
la service role key para leer esos datos y la API key de Anthropic para
llamar al modelo — ninguna de las dos puede estar en app.html.

### Deploy

```bash
supabase functions deploy ai-agent
```

### Secretos que necesita

Además de `SUPABASE_SERVICE_ROLE_KEY` (la misma que ya usa `delete-account`,
si ya la cargaste no hace falta repetirlo), esta función necesita una API
key de Anthropic — se consigue en [console.anthropic.com](https://console.anthropic.com/settings/keys):

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Esta es la única función del proyecto que genera costo por uso (se paga por
consulta al modelo). La función ya limita a 20 consultas por día por
usuario para que ese costo no se dispare solo; para cambiar ese número hay
que editar `LIMITE_DIARIO` en `index.ts` y volver a deployar.
