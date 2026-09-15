# Tikera Neural Activity

Vista "Actividad" de la app (`app.html` → `switchView('neural')`): una red que
representa en vivo cómo entran, se procesan y se sincronizan los datos reales
de Tikera. No es una animación decorativa: cada pulso que viaja por la red
corresponde a un evento real disparado por `addMovement`, `updateMovement`,
`deleteMovement`, `addFrequent`, `removeFrequent`, `loadData` o
`renderSummary`.

## Disclaimer importante

**"AI CORE" es una capa de simulación / visualización de procesamiento, no un
modelo de IA entrenado.** Tikera hoy no tiene machine learning real. El
tooltip del nodo AI CORE y las entradas de tipo `AI_REINFORCEMENT` lo aclaran
explícitamente. El nodo `FORECAST` queda **reservado** (nunca se activa, se
dibuja punteado) para cuando exista un modelo predictivo de verdad — no
finjas que ya existe.

## Arquitectura (4 capas, sin bundler)

```
Tikera (Supabase CRUD real)
      ↓ emit()
neural/neural-bus.js      → EventBus (pub/sub minimo, window.TikeraBus)
      ↓
neural/neural-engine.js   → NeuralEngine (estado de nodos/conexiones,
                             mapeo evento→pipeline, event log)
      ↓
neural/neural-graph.js    → NeuralGraph (Canvas 2D: nodos, conexiones,
                             particulas, pan/zoom, hover/click)
      ↓
neural/neural-ui.js       → TikeraNeuralUI (controles, filtros, System
                             Status, Event Inspector, Live Activity)
```

Se eligió **Canvas 2D sin dependencias** porque la red tiene ~11 nodos y unos
pocos eventos por minuto: WebGL/Three.js/D3/React Flow habrían agregado peso
y complejidad de bundling (el proyecto no tiene bundler) sin ninguna ganancia
real a esta escala.

## Archivos

- `neural-bus.js` — `window.TikeraBus.emit(type, payload)` / `.on(type, cb)`.
- `neural-engine.js` — la red (nodos/conexiones), la traducción de eventos a
  "pipelines" (rutas de nodos que se activan en secuencia), el log de
  eventos y el cálculo de `systemStatus()`.
- `neural-graph.js` — todo el dibujo en `<canvas>` y la interacción
  (zoom, pan, hover, click, touch).
- `neural-ui.js` — conecta DOM ↔ engine ↔ graph: botones de modo
  (LIVE/PAUSE/DEMO), chips de filtro, tooltip, Event Inspector, Live
  Activity, generador de eventos Demo.
- `neural.css` — estilos, reutiliza las variables de color de `app.html`
  (`--accent`, `--venta`, `--gasto`, etc.) para no verse como una página
  pegada aparte.

En `app.html` la integración es mínima: un `<link>`, 4 `<script src>`, el
botón "Actividad" del bottom-nav, el contenedor `#viewNeural`, un `case` más
en `switchView()`, y un `window.TikeraBus?.emit(...)` al final de cada
función que ya persistía datos reales (nunca antes de que la operación en
Supabase termine, y nunca condicionando su resultado).

## Cómo agregar un nuevo evento real

1. En el punto de la app donde ya se confirma la operación (después del
   `await sb.from(...)`, revisando `error`), agregá:
   ```js
   window.TikeraBus?.emit('mi:evento', { /* datos minimos necesarios */ });
   ```
2. En `neural-engine.js`, agregá un `case 'mi:evento'` en `handle()` que
   llame a un método `_onMiEvento(payload, demo)` que decida:
   - qué nodos activa (`this._activatePath([...ids], opts)`),
   - qué le guarda al Event Inspector (`this._pushLog({...})`).
3. Si el evento es sintético para Demo Mode, agregalo también a
   `DEMO_EVENTS` en `neural-ui.js`.

## Cómo agregar un nodo o una conexión

En `neural-engine.js`, arriba del archivo:

- `NODES`: agregá `{ id, label, layer, category, x, y }` (coordenadas
  normalizadas 0..1; `category` debe ser una de `sales | expenses | catalog |
  analytics | ai | system` para que los filtros y colores funcionen).
- `EDGES`: agregá el par `['origen','destino']`.
- Si el nodo/conexión debe existir pero todavía no tiene datos reales
  detrás (como `forecast`), marcalo `reserved:true` — se dibuja punteado y
  nunca recibe partículas ni cuenta eventos falsos.

Los colores por categoría están en `neural-graph.js` (`COLORS`) y se
reflejan también en `neural.css` (`--n-*`) para los chips/leyendas del DOM.

## Demo Mode vs Real Mode

- **LIVE** (default): solo procesa eventos reales del bus (`demo` no
  definido / `false`).
- **DEMO**: `neural-ui.js` dispara eventos sintéticos marcados `demo:true`
  cada 1.4–3.6s desde `DEMO_EVENTS`. El motor **nunca mezcla** ambos modos:
  en LIVE ignora los eventos `demo:true`, en DEMO ignora los reales
  (`NeuralEngine.prototype.handle`). Los elementos demo llevan un badge
  visual (`MODO DEMO`, tag `DEMO` en feed/inspector, partícula punteada).
- **PAUSE**: el motor no procesa ningún evento nuevo (`if(this.mode ===
  'pause') return;`); el canvas sigue dibujando el último estado congelado.

## Rendimiento

- El loop de `requestAnimationFrame` (`NeuralGraph.start/stop`) solo corre
  mientras la vista "Actividad" está visible — `switchView()` llama a
  `tikeraNeural.mount()/.unmount()`. Al salir de la vista se cancela el
  frame y se detiene el `setInterval` del System Status.
- Es ~11 elementos `<canvas>`-drawn, no DOM: no hay miles de nodos DOM ni
  listeners duplicados por evento.
- `prefers-reduced-motion: reduce` desactiva el jitter orgánico continuo de
  los nodos (`NeuralGraph._worldPos`) y el pulso CSS del status dot; los
  cambios de estado (color, actividad) se siguen mostrando, solo sin el
  movimiento idle.

## Conectar una IA real en el futuro

Cuando exista un modelo real (forecasting, detección de anomalías,
recomendaciones), el punto de integración es:

1. Sacar `reserved:true` del nodo `forecast` (o agregar nodos nuevos) en
   `neural-engine.js`.
2. Emitir eventos reales del modelo (`window.TikeraBus.emit('ai:prediction',
   {...})`) desde donde se llame a la API/modelo real.
3. Agregar el `case` correspondiente en `NeuralEngine.prototype.handle` con
   su propio pipeline (`DATA → FEATURE ENGINEERING → MODEL → PREDICTION →
   DECISION → INSIGHT`, como conceptualmente ya sugiere la capa
   `analysis`/`aiCore`/`insight`).
4. Actualizar el tooltip de `aiCore` en `neural-ui.js` (`_renderTooltip`)
   para que dejar de decir "simulación" cuando el modelo sea real —
   **no antes**.

## Errores comunes

- **La red no se mueve nunca en LIVE**: revisá que `window.TikeraBus` esté
  cargado antes de `neural-ui.js` (orden de `<script>` en `app.html`) y que
  las funciones de Supabase (`addMovement`, etc.) sigan teniendo el
  `window.TikeraBus?.emit(...)` al final.
- **Canvas en blanco / tamaño 0**: pasa si `#viewNeural` estaba `display:none`
  cuando se llamó `mount()`. `switchView()` ya hace `display='block'` antes
  de montar; si movés el código, respetá ese orden.
- **DEMO y LIVE mezclados**: no debería pasar — `NeuralEngine.handle`
  filtra por `mode` y por el flag `demo`. Si ves eventos reales en modo
  DEMO, revisá que no se esté llamando a `engine.handle(type, payload)` sin
  el tercer argumento `demo` en algún lugar nuevo.
