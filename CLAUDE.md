# Tikera — guía de diseño

Este archivo es para que cualquier cambio futuro en el sitio público
(`index.html`, `precios.html`, `terminos.html`, `privacidad.html`, `404.html`)
o en la app (`app.html`) se mida contra el sistema real de Tikera, en vez de
caer en los defaults genéricos de "hecho por una IA".

## Por qué existe este archivo

Un modelo de IA sin instrucciones concretas tiende a converger siempre en
las mismas soluciones: gradiente violeta-a-azul en el hero, todo centrado,
`rounded-lg` en cada elemento, Inter como fuente "segura", barra de acento
decorativa en cada card, emoji como viñeta de sección. Ninguna de esas
decisiones está mal en sí misma — el problema es que se eligen por default,
no porque el proyecto las pida. Este archivo documenta las decisiones que
Tikera **ya tomó a propósito**, para que un cambio nuevo las respete en vez
de reemplazarlas por el piloto automático.

## Paleta (oscuro, la base real de todas las páginas)

```
--bg:#0D1113          --bg-elevated:#151A1D     --bg-card:#12171A
--text:#F4F2ED        --text-dim:#9BA3A6        --text-faint:#8A9194
--slate:#3E5670        (acento principal)
--slate-bright:#6089B4 --slate-soft:rgba(62,86,112,.16)
--brand-gradient: linear-gradient(135deg, #6089B4 0%, #3E5670 60%, #2C4256 100%)
--green:#4CAF80        (éxito / venta)
```

En `app.html` se suman `--gasto` (rojo), `--gold`, `--teal` — colores
semánticos, no decorativos: cada uno significa algo puntual (gasto, alerta,
catálogo) y no se reasignan a otro uso solo porque "queda lindo".

## Paleta clara

```
--bg:#F4F6F7  --bg-card:#FFFFFF  --text:#14191C  --text-dim:#5B666B
--slate:#3E5670 (el mismo — el acento no cambia entre temas)
--green:#2E8F63 (más oscuro para contraste sobre fondo claro)
```

Toda página nueva necesita las dos paletas (`:root` + `:root[data-theme="light"]`),
el script anti-flash en `<head>` (ver cualquier página existente), y probarse
en ambos temas antes de darse por terminada — no alcanza con "se ve bien en
oscuro".

## Tipografía

- **Space Grotesk** para títulos y números grandes — peso 700, tracking
  ajustado (`tracking-tight` o `letter-spacing` negativo).
- **Inter** para texto de cuerpo.
- La combinación no es el default "por las dudas" — es deliberada y se
  mantiene así. No mezclar una tercera familia sin razón.

## Patrones ya establecidos (protegerlos, no reinventarlos)

- **Mockup-shell aislado**: el componente que muestra una captura real del
  producto (login replica, demo tabs) redeclara las variables de color
  *localmente* dentro de su propio selector, para quedar fijo en oscuro sin
  importar el tema del sitio — es una captura de producto, no chrome de la
  landing. Ver `.mockup-shell` en `index.html`.
- **Bento asimétrico**: las secciones de features usan un grid tipo bento
  (tamaños de card desiguales), no una fila pareja de cards idénticas.
- **Grano sutil**: overlay de ruido SVG a opacity 0.035 (`.grain`) para que
  el fondo oscuro no se sienta plano — es a propósito, no un accidente.
- **Resplandor radial detrás de las capturas** (inspirado en go-marz.com):
  un glow verde suave detrás del mockup oscuro sobre fondo claro, no un
  gradiente decorativo genérico de fondo completo.
- **Scroll-reveal que nunca deja la pantalla en blanco**: los elementos con
  `.reveal` empiezan visibles por CSS; solo se ocultan si JS confirma que
  arrancan fuera de pantalla. Nunca depender solo de un IntersectionObserver
  para la visibilidad inicial.
- **Radio de borde por escala, no uniforme**: badges chicos ~6-10px, cards
  ~14-24px, nav en cápsula ~24px+. No aplicar el mismo `border-radius` a
  todo.
- **Border-left de color en `.metric`**: es semántico (venta=verde,
  gasto=rojo), no decorativo. No copiar ese acento a cards que no
  signifiquen nada por color.

## Evitar

- Gradiente violeta→azul de fondo completo en el hero. El
  `--brand-gradient` de Tikera se usa en botones y acentos puntuales, no
  como telón de fondo de toda la sección.
- Todo centrado. Los heroes y secciones de Tikera son asimétricos a
  propósito (texto a la izquierda, mockup a la derecha, o el bento).
- Emoji como viñeta o ícono de sección — Tikera dibuja sus propios íconos
  SVG de línea dentro de badges de color.
- Una tarjeta con el mismo borde+sombra+radio para absolutamente todo. No
  todo es una card — el mockup-shell y los number-callouts flotantes son
  ejemplos de elementos que rompen ese molde a propósito.
- Colores nuevos por fuera de la paleta de arriba sin agregarlos acá
  primero.

## Antes de dar por terminado un cambio visual

1. Probarlo en oscuro y en claro.
2. Probarlo en mobile (~375px) y desktop.
3. Si el cambio toca `index.html`, revisar que no rompa el aislamiento del
   `.mockup-shell` (debe seguir oscuro fijo pase lo que pase con el tema).
4. Releer la sección "Evitar" de acá arriba antes de aceptar la primera
   solución que surja.
