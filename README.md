# Tikera

Caja registradora, control de stock y gestión de proveedores para kioscos y comercios chicos. Vanilla JS, sin build step, backend en Supabase.

🔗 **Demo en vivo**: https://valll444.github.io/Tikera/

## Qué es

Un kiosquero necesita saber cuánto vendió, cuánto gastó y cuánto le queda de
ganancia real (no solo facturación), sin usar planillas ni un sistema pensado
para comercios grandes. Tikera es una PWA liviana que resuelve eso y funciona
incluso con la conexión cortada.

## Funcionalidades

- Carga rápida de ventas y gastos, con cálculo de ganancia real (precio − costo)
- Catálogo de productos con stock, categorías y foto
- Descuento automático de stock al vender un producto del catálogo
- Reposición sugerida: estima cuándo se va a agotar cada producto según su velocidad de venta real, no solo un umbral fijo
- Proveedores: a quién le comprás, pedidos anotados y cuánto les debés
- Cierre de caja: efectivo esperado (según lo cargado) vs. contado, para cualquier fecha, con historial y gráfico de diferencias
- Noticias: cotización del dólar (oficial/blue/mayorista/tarjeta), inflación mensual (INDEC), riesgo país, tasa de plazo fijo promedio, próximo feriado y una calculadora de IVA — todo de fuentes públicas reales
- Resumen con gráfico de ventas de los últimos 7 días y ranking de productos que más facturan
- Historial completo, filtrable, exportable a Excel/PDF e importable desde Excel
- Funciona offline: las ventas se guardan en el dispositivo y se sincronizan solas al volver la conexión
- Ticket de venta imprimible (comprobante no fiscal)
- Tema claro/oscuro/sistema y color de acento personalizable, en toda la app y el sitio público
- Prueba gratuita de 14 días con bloqueo automático al vencer
- Perfil (cuenta, seguridad) y Ajustes (negocio, apariencia) separados, con borrado de cuenta real
- Monitoreo de errores con Sentry

## Stack

- **Frontend**: HTML/CSS/JS vanilla, sin framework ni build step. Las páginas públicas (`index.html`, `precios.html`, etc.) son cada una un solo archivo autocontenido; `app.html` separa su CSS y JS en `css/app.css` y `js/app.js` por ser la más grande, pero se sirve igual, sin ningún paso de compilación
- **Backend**: [Supabase](https://supabase.com) (Postgres + Auth + Storage + Edge Functions), con Row Level Security en todas las tablas
- **IA**: asistente conversacional opcional vía Edge Function + API de Anthropic (ver `supabase/functions/README.md`) — apagado por defecto porque tiene costo por uso
- **Hosting**: GitHub Pages
- **PWA**: service worker con cache del shell de la app para carga instantánea

## Estructura

```
app.html                  la aplicación (requiere login)
css/app.css                estilos de app.html
js/app.js                  logica de app.html
index.html                 landing page
precios.html                página de precios
terminos.html / privacidad.html    términos y política de privacidad
404.html                   página de error
sw.js / manifest.json       service worker y manifest de la PWA
supabase/                   esquema de la base de datos (ver supabase/README.md)
supabase/functions/          Edge Functions: borrado de cuenta, asistente de IA (ver supabase/functions/README.md)
```

## Correrlo localmente

No hay build step: alcanza con servir la carpeta con cualquier servidor
estático.

```bash
python -m http.server 8080
```

Para conectarlo a tu propio backend, configurá `SUPABASE_URL` y
`SUPABASE_KEY` en [`js/app.js`](js/app.js) con las credenciales de tu
proyecto de Supabase (el esquema completo para reproducirlo está en
[`supabase/`](supabase/README.md)).

---

Hecho por [Valll444](https://github.com/Valll444).
