# Tiki — diseño, seguridad y memoria

Auditoría y rediseño de octubre de 2026. Este documento explica cómo funciona
Tiki, qué problemas se encontraron (en Tiki y en la app que lo alimenta), qué
se corrigió, qué queda pendiente y cómo tiene que crecer sin perder
seguridad. Si cambiás algo de Tiki, actualizá este archivo.

---

## 1. Cómo funciona Tiki hoy

Tiki **no es un modelo de IA**. Es un motor de reglas propio, en
[`js/tiki.js`](../js/tiki.js), que corre en el navegador:

1. El comerciante escribe una pregunta (o toca un atajo).
2. Tiki normaliza el texto y busca tres cosas: **qué** quiere saber (ventas,
   gastos, stock, deudas, cierre…), **de cuándo** (hoy, ayer, el sábado,
   este mes, una fecha) y **de qué** (un producto, proveedor o tipo de gasto).
3. Según eso hace una cuenta con los datos que la app ya descargó para la
   cuenta logueada (`entries`, `products`, `proveedores`, `pedidosProveedor`,
   `cierresCaja`) usando las mismas funciones que el resto de las pantallas
   (`efectivoEsperadoDe`, `calcularReposicion`, la fórmula de ganancia real
   del Resumen).
4. Arma la respuesta en HTML, con todo dato escrito por el usuario escapado.

Consecuencias de este diseño, buenas y malas:

| | |
|---|---|
| Costo por consulta | $0. No hay servidor ni API de por medio. |
| Funciona sin conexión | Sí (salvo el aviso de feriados). |
| Privacidad | Las preguntas no salen del dispositivo. |
| Prompt injection | No aplica en el sentido clásico: no hay un modelo que "obedezca". Las palabras solo eligen qué cuenta hacer; ningún texto puede cambiar el orden de las reglas ni darle permisos. |
| Alucinaciones | No puede inventar números: todo sale de una cuenta sobre datos reales. Cuando no hay datos, lo dice. |
| Límite | No entiende charla libre ni da consejos abiertos. Cuando no entiende, lo dice y ofrece preguntas que sí sabe responder. |

El "router" (`tikiResponder`) decide en este orden:

1. Pedidos que **nunca** cumple: instrucciones internas / modo administrador
   (`TIKI_RE_META`), datos de otras cuentas (`TIKI_RE_AJENO`).
2. Respuesta a algo que Tiki ofreció recordar ("sí" / "no").
3. Hábitos con evidencia ("¿siempre cierro a las 20?") y memoria (ver,
   olvidar, contarle algo).
4. Pedidos de cargar, cambiar o borrar datos: Tiki solo lee
   (`TIKI_RE_ACCION`).
5. Preguntas del negocio: plan del día, stock, deudas, cierre, mejor día y
   hora, precios, ranking, cómo vengo, actividad, gastos, ventas.

### Cómo conversa (sin IA)

Para que se sienta como una charla y no como un formulario
(`tikiResponder` → `tikiSeguimiento` → `tikiRutear` → `tikiCerrarRespuesta`):

- **Sigue el hilo** (`tikiCtx`, vence a los 10 minutos): después de una
  respuesta entiende "¿por qué?" (`tikiExplicar`, de dónde sale el número),
  "¿y eso es bueno?" (`tikiEvaluar`, siempre contra la propia historia del
  comercio: el mismo día de la semana, el período anterior, el margen
  promedio del catálogo), "¿y qué hago?" (`tikiRecomendar`, pasos concretos
  con sus datos), "contame más" (`tikiMas`) y "¿y la coca?" / "¿y Arcor?"
  (la misma pregunta sobre otra cosa).
- **Ofrece el paso siguiente** (`tikiSugerencia`): termina con una pregunta
  ("¿Querés ver qué fue lo que más vendiste?") que se acepta tocando el
  botón o escribiendo "sí". Vale solo para la respuesta siguiente.
- **Reacciona solo si los números lo justifican**: "¡Buen día!" o "Fue un día
  flojo" aparecen únicamente si ese día se vendió un 15% más o menos que el
  promedio de ese mismo día de la semana (con al menos 3 semanas para
  comparar).
- **Pregunta cuando le falta algo**: "ayer" solo → "¿Qué querés ver de ayer:
  las ventas, los gastos o el cierre?".
- **Entiende errores de tipeo** (`tikiCorregir`) solo cuando la palabra suena
  exactamente igual a una palabra clave ("bendi", "sierre", "aller",
  "provedor"). Nunca cambia una palabra por otra parecida ni toca nombres de
  productos o proveedores.
- **Charla corta**: saludo, "¿cómo andás?", gracias, "chau" (si la caja de hoy
  no se cerró, lo recuerda). Las frases alternan para no sonar repetidas,
  siempre en el mismo orden, así que los tests son estables.

Existe además una Edge Function con Claude
([`supabase/functions/ai-agent`](../supabase/functions/ai-agent)) para una
**etapa 2**. Hoy **no está deployada** ni conectada a la app (verificado con
`supabase functions list`).

## 2. Modelo de amenazas y aislamiento

**La garantía de que una cuenta no ve datos de otra no la da Tiki ni ningún
modelo: la da la base de datos.** Todas las tablas tienen Row Level
Security por `auth.uid() = user_id`. La app solo descarga filas de la cuenta
logueada, y Tiki solo puede leer lo que la app tiene en memoria. Si alguien le
pide a Tiki "las ventas de otro comercio", no hay de dónde sacarlas.

En Tikera hoy **una cuenta = un comercio** (no hay `merchant_id`, empleados ni
varios locales por cuenta). El único identificador de "inquilino" es
`user_id`. Si algún día un comercio tiene varios usuarios, hay que agregar
`merchant_id` + una tabla de membresías y reescribir las políticas RLS en
función de esa membresía (ver §11).

Niveles de confianza de la información (de más a menos):

1. **Código y reglas** (`js/tiki.js`, el system prompt de `ai-agent`).
2. **Lo que el usuario pide en el chat**: es una pregunta, nunca un cambio de
   reglas.
3. **Datos del negocio**: nombres de productos, notas, descripciones. Los
   escribió el usuario o vinieron de un Excel importado, así que son **texto
   no confiable**: se escapan siempre al mostrarlos y, en la etapa 2, van al
   modelo limpios y marcados como datos.
4. **Historial de charla** (solo en la etapa 2): también no confiable, porque
   un usuario puede insertar filas en su propio `agent_messages`.
5. **Contenido de otros usuarios**: no existe en Tikera (no hay nada
   compartido entre cuentas), y así tiene que seguir.

Permisos de Tiki (mínimo privilegio): **solo lectura** de los datos del
negocio. Lo único que puede escribir es su propia memoria (`tiki_memoria`), y
solo después de una confirmación explícita del usuario.

## 3. Vulnerabilidades y bugs encontrados

Cada ítem dice qué es, dónde está, por qué pasa, qué riesgo genera, cómo
reproducirlo, cómo se solucionó (o cómo se soluciona) y qué impacto tiene la
solución. Los que dicen **Corregido** tienen test.

### CRÍTICO

**C1. La app cargaba solo los 1000 movimientos más viejos.** *Corregido.*
- Dónde: `loadData` en `js/app.js`.
- Por qué: Supabase corta cada respuesta en "Max rows" (1000 por defecto en
  Settings → API). La consulta no paginaba y ordenaba de más viejo a más nuevo.
- Riesgo: un kiosco con ~30 ventas por día pasa las 1000 en un mes. Desde ahí,
  Inicio, Historial, **el efectivo esperado del cierre de caja** y Tiki
  trabajaban sin las ventas recientes. El cierre (la función central de
  Tikera) daba mal en silencio.
- Reproducir: cuenta con más de 1000 movimientos → las ventas de hoy no
  aparecen.
- Solución: `fetchAllRows` pagina hasta traer todo, con el total pedido a la
  base, avanza por la cantidad recibida (sirve con cualquier "Max rows") y
  descarta repetidos.
- Impacto: más pedidos al iniciar sesión en cuentas grandes (1 cada 1000
  filas). A largo plazo ver §11 (no cargar todo el historial).
- Test: `trae todos los movimientos aunque sean más de 1000`, `con 3500
  movimientos el efectivo esperado de hoy sale completo`.

### ALTO

**A1. Datos de una cuenta visibles para otra en el mismo dispositivo.** *Corregido.*
- Dónde: cierre de sesión y `loadData` en `js/app.js`.
- Por qué: al cerrar sesión solo se vaciaban algunas listas; productos,
  cierres y facturas quedaban en memoria. Si fallaba la carga de la cuenta
  nueva, se veían los de la anterior.
- Riesgo: en un celular compartido (turnos, un empleado, un equipo vendido),
  la cuenta B veía catálogo, cierres y respuestas de Tiki de la cuenta A.
- Solución: `clearUserState()` limpia todo lo de la cuenta (y Tiki) al cerrar
  sesión, cuando entra otra cuenta y cuando falla la carga (falla cerrada).
- Tests: bloque "Aislamiento entre cuentas en el mismo dispositivo".

**A2. La cola de ventas sin conexión mezclaba cuentas.** *Corregido.*
- Dónde: `hydratePendingIntoEntries` / `syncPendingMovements`.
- Por qué: la cola vive en `localStorage`, que es del navegador y no de la
  cuenta.
- Riesgo: la cuenta B veía como propias las ventas pendientes de A, y le
  cambiaban el **efectivo esperado del cierre**. Subirlas no era posible (RLS
  las rechazaba: la base funcionó como última defensa).
- Solución: cada pendiente se muestra y se sube solo si su `user_id` es el de
  la cuenta logueada; lo ajeno queda esperando a su dueño.
- Tests: bloque "Cola de ventas sin conexión".

**A3. (Latente, etapa 2) El cupo diario del asistente con IA se podía evadir.** *Corregido en código, sin deployar.*
- Dónde: `supabase/functions/ai-agent/index.ts` (versión anterior).
- Por qué: contaba los mensajes del día en `agent_messages`, que el usuario
  puede borrar; además era contar-y-después-insertar (carrera), contaba el
  día en UTC y no revisaba si la prueba gratis había vencido.
- Riesgo: consultas ilimitadas a costa de Tikera desde cualquier cuenta,
  incluso con la prueba vencida.
- Solución: `016_tiki_agente_seguro.sql` agrega `tiki_consumir_consulta`, un
  contador atómico por cuenta y por día argentino, en una tabla que el usuario
  puede leer pero no tocar. La función corta antes de llamar a la API si la
  prueba venció o no hay cupo, y si el contador no existe se niega (falla
  cerrada).
- Tests: `tests/db/rls.test.mjs` (cupo atómico, por cuenta, no se resetea
  borrando mensajes).

**A4. "Borrar cuenta" no funciona: `delete-account` no está deployada.** *Pendiente (decisión tuya).*
- Dónde: Supabase (solo están deployadas `arca-config` y `arca-facturar`).
- Riesgo: la Ley 25.326 da derecho de supresión y la política de privacidad
  promete que se puede borrar la cuenta desde la app. Hoy el botón falla con
  un mensaje de error.
- Solución: `supabase functions deploy delete-account`. No hace falta cargar
  ningún secret: Supabase ya inyecta `SUPABASE_SERVICE_ROLE_KEY` (verificado
  con `supabase secrets list`). La función ya no devuelve errores internos al
  navegador, y la app borra del dispositivo las ventas sin conexión de la
  cuenta borrada.

### MEDIO

**M1. Inyección de HTML por atributos (`escapeHtml` no escapaba comillas).** *Corregido.*
- Dónde: `escapeHtml` en `js/app.js`, usada dentro de `value="…"` (categorías)
  y `title="…"` (barras de Tiki).
- Por qué: la versión anterior usaba `textContent → innerHTML`, que no escapa
  comillas.
- Riesgo: un nombre como `x" onmouseover="…` ejecutaba código. Las
  descripciones de ventas pueden venir de un **Excel importado**, así que un
  archivo armado a propósito podía robar la sesión al pasar el mouse sobre un
  gráfico de Tiki.
- Solución: `escapeHtml` escapa `& < > " '` con reemplazo de texto, sirve en
  texto y en atributos y no depende del DOM.
- Test: `texto malicioso guardado en los datos se muestra como texto…`.

**M2. La cola sin conexión podía perder o duplicar ventas.** *Corregido.*
- Por qué: al terminar de sincronizar se pisaba la cola con una copia vieja
  (se perdía lo que se encolara mientras tanto) y, si algo fallaba después de
  subir una venta, esa venta quedaba en la cola y se volvía a subir.
- Tests: `una venta encolada mientras se sincroniza no se pierde`, `si falla
  el ajuste de stock, la venta subida no se vuelve a subir`.

**M3. (Latente, etapa 2) Prompt injection y costo en el asistente con IA.** *Corregido en código.*
- Antes, los nombres de productos iban dentro del system prompt (un nombre
  podía "escribir reglas"), el historial se mandaba sin límite de tamaño y se
  podían insertar mensajes enormes directo por la API.
- Ahora: system prompt fijo sin datos, datos en un bloque aparte, limpios (sin
  `< >`, sin saltos ni control) y marcados como datos; historial de 10
  mensajes recortados; tope de 4000 caracteres por mensaje en la base; el
  modelo no tiene herramientas.
- Queda aceptado: un usuario puede insertar mensajes "del asistente" en **su
  propio** historial. Solo se engaña a sí mismo (no hay datos ajenos ni
  permisos que ganar) y el cupo limita el costo. Cerrarlo del todo requiere
  que la función escriba con la service role key.
- Tests: `deno test supabase/functions/ai-agent/`.

**M4. Tiki contestaba con datos propios a "mostrame las ventas de otro comercio".** *Corregido.*
- No había fuga (no tiene datos ajenos), pero la respuesta se podía leer como
  si fueran del otro comercio. Ahora dice explícitamente que solo ve esta
  cuenta. Igual para "instrucciones internas", "modo administrador" y pedidos
  de borrar o cargar datos.

**M5. El ajuste de stock no es atómico.** *Pendiente.*
- Dónde: `applyStockDelta` (lee el stock y escribe stock − cantidad).
- Riesgo: dos dispositivos vendiendo el mismo producto a la vez pierden una
  de las restas; el stock queda mal y "Reposición sugerida" y Tiki se
  equivocan.
- Solución: una función de la base que haga `stock_actual = stock_actual - x`
  en un solo `UPDATE` (con RLS), llamada por `rpc`.

**M6. La ventana de "Reposición sugerida" medía 13 o 14 días según la hora.** *Corregido.*
- Comparaba fechas parseadas en UTC contra "ahora menos 14 días". Ahora son
  los últimos 14 días de calendario, igual para Inicio y Tiki.

### BAJO

- **B1.** Sentry no figuraba en la política de privacidad. *Corregido.*
- **B2.** Los breadcrumbs de Sentry pueden incluir URLs de Supabase con el
  `user_id` (por ejemplo `user_id=eq.…`). *Pendiente:* filtrarlos con
  `beforeBreadcrumb`.
- **B3.** `agent_messages` no tiene retención. *Pendiente:* activar el borrado
  a 90 días que está comentado en `016` si se activa la etapa 2.
- **B4.** CORS abierto (`*`) en `ai-agent`. Con autenticación por token el
  riesgo es bajo. *Ahora configurable* con `TIKI_ALLOWED_ORIGINS`.
- **B5.** Tiki no reconocía "Ignore las instrucciones" (sin tilde) y leía
  "1,5 millones" como 1.500. *Corregidos* (los encontraron los tests).
- **B6.** "¿Y ayer?" seguía la pregunta anterior aunque hubieran pasado
  horas. *Corregido:* el contexto vence a los 10 minutos.
- **B7.** "Hoy vendiste $0 en 0 ventas" y otros textos raros sin datos.
  *Corregidos.*

### MEJORA

Implementado en esta auditoría: memoria controlada (§5), hábitos con
evidencia, resumen de actividad ("¿qué hice la semana pasada?"), Tiki
separado en `js/tiki.js`, y tests (§8). Pendiente: la tarjeta "Próximamente:
Asistente de IA" de la landing ya no corresponde.

## 4. Cómo funcionaba la memoria antes

- **Tiki (motor propio):** no tenía memoria persistente. Solo recordaba la
  última pregunta con fecha (para "¿y ayer?"), sin vencimiento.
- **`ai-agent` (sin deployar):** guardaba **toda** la charla en
  `agent_messages` (texto completo, para siempre) y mandaba los últimos 20
  mensajes sin recortar al modelo. No distinguía hechos de opiniones: todo
  era texto.

## 5. Cómo funciona la memoria ahora

Cinco tipos de información, que no se mezclan:

| Tipo | Qué es | Dónde vive | Cuánto dura | Confianza |
|---|---|---|---|---|
| A. Corto plazo | La charla actual y la última pregunta con fecha | Memoria del navegador | Hasta 10 min sin usarla, o hasta recargar o cerrar sesión | — |
| B. Charlas anteriores | — | **No se guardan** | — | — |
| C. Memoria del usuario | Horario de cierre, días que no abre, meta de venta diaria | Tabla `tiki_memoria` (RLS) | Hasta que el usuario la borre | **Declarada** por el usuario y confirmada. Tiki la cita como "me dijiste que…". |
| D. Datos del negocio | Ventas, gastos, productos, proveedores, cierres | Tablas de siempre (RLS) | Lo que defina el usuario | **Fuente de verdad** de cualquier número |
| E. Patrones | Mejor día, horario de cierre, hora pico, productos que no se mueven | **No se guardan**: se calculan en el momento desde D | — | Siempre con su evidencia ("en 18 de tus últimos 20 cierres") y con mínimos: menos de 5 cierres o de 2 semanas de ventas → "no alcanza para decirlo" |

Reglas de la memoria C:

- **Nunca se guarda sola.** Tiki detecta una afirmación ("cierro a las 21",
  "los domingos no abro", "mi meta es 100 lucas por día"), pregunta, y solo
  guarda con "Sí" (botón o texto). Cualquier otra respuesta hace caducar la
  oferta.
- **Solo 3 claves con forma fija**, validadas en el navegador y en la base
  (constraints en `015`). No se guarda texto libre: no hay forma de que una
  "instrucción" termine en la memoria.
- **Ambigüedad = pregunta**: "cierro a las 9" ofrece 9:00 o 21:00. "Los
  sábados cierro a las 14" no se guarda (hoy hay un solo horario para todos
  los días).
- **Afirmación ≠ pregunta**: "siempre cierro a las 20, ¿no?" no se guarda: se
  contesta con evidencia.
- **Frases sueltas no son memoria**: "hoy vendí muchísimo" se contesta con
  los números reales de hoy.
- **Visible y borrable**: "¿qué recordás de mí?", "olvidate de la meta", o el
  botón "Olvidar" al costado del chat.
- **De una sola cuenta**: RLS en la base, y en el navegador se descarta al
  cerrar sesión o cambiar de cuenta.

Para qué se usa: el recordatorio de cierre aparece una hora antes del
horario dicho, los días cerrados no cuentan como "días flojos" y la meta se
compara con las ventas del día y del mes.

### Por qué no hay embeddings ni base vectorial

Todo lo que Tiki necesita es **estructurado** (fechas, montos, nombres) y se
recupera con filtros exactos: `user_id` (lo pone RLS), rango de fechas,
producto o proveedor. Una búsqueda semántica no agrega precisión y suma
costo, latencia y otra copia de los datos. Solo tendría sentido si en el
futuro hay mucho texto libre (notas largas, charlas resumidas) y aun así
empezaría por la búsqueda de texto de Postgres (`tsvector`) antes que por
vectores.

## 6. Etapa 2: Tiki con Claude (cuando haya presupuesto)

Diseño recomendado, apoyado en lo que ya existe:

1. **El modelo no toca la base.** El servidor calcula con el token del
   usuario (RLS) y le pasa al modelo un resumen chico (como hoy en
   `armarContexto`) o, mejor, **herramientas de solo lectura** que reutilicen
   las mismas cuentas que `js/tiki.js` (ventas de un período, cierre de una
   fecha, stock de un producto). El `user_id` **nunca** es un parámetro que
   el modelo pueda elegir: sale del token.
2. **Sin herramientas de escritura.** Si algún día Tiki carga datos, que sea
   con confirmación explícita en la interfaz, una acción por vez, límites y
   registro de auditoría.
3. **Memoria:** la misma `tiki_memoria` (estructurada, confirmada) va como
   dato. Las charlas anteriores, si se quieren, como **resúmenes cortos
   opt-in** con retención (90 días), nunca el texto completo de todo.
4. **Antes de activarla:** correr `016`, actualizar
   `privacidad.html#tiki` (hoy promete que nada sale del dispositivo), que el
   usuario elija activarla (opt-in) y conectar la pantalla de Tiki.

Costo estimado con `claude-haiku-4-5` ($1 por millón de tokens de entrada,
$5 por millón de salida): ~1.500 tokens de entrada y ~150 de salida por
pregunta ≈ **US$ 0,002 por pregunta**. Con 1.000 comercios a 3 preguntas por
día ≈ US$ 200/mes; el peor caso (cupo completo de 20 por día) ≈ US$ 1.350/mes.
El cupo diario es lo que pone el techo. Un modelo más capaz mejora las
respuestas abiertas pero multiplica ese costo: es una decisión de negocio.

## 7. Modificaciones realizadas

- `js/app.js`: carga paginada (`fetchAllRows`), `clearUserState`, cola
  sin conexión por cuenta y sin pérdidas ni duplicados, `escapeHtml` seguro
  en atributos, ventana de reposición fija y `calcularReposicion` compartida
  con Tiki. Tiki se movió a `js/tiki.js`.
- `js/tiki.js`: guardas (otras cuentas, manipulación, escritura), memoria C,
  hábitos con evidencia, actividad, meta, vencimiento del contexto, límite
  de mensajes en pantalla y textos sin datos.
- `app.html` / `css/app.css`: sección Tiki, bloque "Lo que me pediste que
  recuerde", botones de un solo uso. `sw.js`: `tiki.js` en la caché y
  versión nueva.
- `supabase/015_tiki_memoria.sql` (nuevo): tabla de memoria con RLS y
  constraints. **Hay que correrlo** para que Tiki pueda recordar.
- `supabase/016_tiki_agente_seguro.sql` (nuevo): cupo atómico y tope de
  mensajes. Solo hace falta antes de activar la etapa 2.
- `supabase/functions/ai-agent/`: reescrita con el SDK oficial de Anthropic,
  separación de instrucciones y datos (`prompt.ts`), prueba vencida y cupo
  antes de gastar, errores genéricos.
- `privacidad.html` / `terminos.html`: sección de Tiki, memoria, Sentry.
- `tests/` y `prompt.test.ts`: ver §8.

## 8. Tests

| Qué | Cómo | Resultado |
|---|---|---|
| Tiki y la app (65 tests): carga paginada, aislamiento entre cuentas, cola sin conexión, pedidos ajenos y de manipulación, que no escriba datos, texto malicioso en los datos, consistencia entre formas de preguntar, datos viejos y nuevos, sin datos, datos rotos, hábitos con evidencia, memoria, contexto, plan del día, conversación (repreguntas, paso siguiente, tipeo, charla corta) | `cd tests && npm test` | 65/65 |
| Base de datos (6 tests): migraciones en Postgres real (PGlite), RLS entre cuentas en todas las tablas, constraints de la memoria, cupo atómico | incluido en `npm test` | 6/6 |
| `ai-agent` (8 tests): system prompt fijo, datos que no pueden cerrar el bloque, historial saneado, respuestas cortadas o rechazadas | `deno test supabase/functions/ai-agent/` + `deno check` | 8/8 |
| Navegador: sección Tiki en oscuro y claro, celular y escritorio, flujo de memoria contra el Supabase real (sin la tabla, falla sin fingir) | vista previa | OK |

## 9. Evaluación

| Área | Antes | Ahora | Comentario |
|---|---|---|---|
| Seguridad | Media | Buena | RLS sólida en la base; corregidos la mezcla de cuentas en el dispositivo y la inyección por atributos. Falta el stock atómico. |
| Privacidad | Media | Buena | Nada sale del dispositivo; la memoria es mínima, confirmada y borrable. Falta deployar el borrado de cuenta. |
| Inteligencia | Básica | Buena para preguntas de números | Sin IA no hay charla libre: es el techo de un motor de reglas. |
| Memoria | Ninguna | Controlada | Tres datos estructurados más patrones con evidencia. |
| Escalabilidad | Mala (corte en 1000) | Aceptable | Carga todo el historial al entrar: bien hasta decenas de miles de filas; después ver §11. |
| Rendimiento | Bueno | Bueno | Respuestas instantáneas y sin red. |
| Experiencia de uso | Buena | Buena | Respuestas cortas, botones de acción, honesto cuando no sabe. |

## 10. Pendientes (en orden)

1. Correr `015_tiki_memoria.sql` en el SQL Editor de Supabase.
2. Deployar `delete-account` (A4).
3. Confirmar en Supabase → Settings → API el valor de "Max rows" (la app ya
   pagina, pero conviene saberlo).
4. Stock atómico (M5).
5. Filtrar los breadcrumbs de Sentry (B2).
6. ~~Actualizar la tarjeta "Próximamente: Asistente de IA" de la landing.~~ Hecho: ahora es la tarjeta de Tiki.

## 11. Recomendaciones para versiones futuras

- **No cargar todo el historial al iniciar sesión.** Cargar los últimos 13
  meses y pedir lo más viejo bajo demanda, o mover los totales a vistas o
  funciones SQL (con RLS) para que el navegador reciba números y no miles de
  filas. Es el próximo cuello de botella a partir de ~50.000 movimientos.
- **Varios usuarios por comercio** (empleados, sucursales): `merchant_id`,
  tabla de membresías con rol, y RLS por membresía en todas las tablas
  (incluida `tiki_memoria`). No hacerlo filtrando en el navegador.
- **Ventas con `product_id`**: hoy las ventas se cruzan con el catálogo por
  nombre; un id evitaría errores cuando se renombra un producto.
- **Etapa 2** tal como se describe en §6, empezando por las herramientas de
  solo lectura.
- **Más memoria** solo con el mismo patrón: clave cerrada, forma validada en
  la base, confirmación explícita, visible y borrable.
