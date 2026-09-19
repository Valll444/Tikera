# Tikera

Caja registradora y control de stock para kioscos y comercios chicos. Vanilla JS, sin build step, backend en Supabase.

🔗 **Demo en vivo**: https://valll444.github.io/Tikera/

## Qué es

Un kiosquero necesita saber cuánto vendió, cuánto gastó y cuánto le queda de
ganancia real (no solo facturación), sin usar planillas ni un sistema pensado
para comercios grandes. Tikera es una PWA liviana que resuelve eso y funciona
incluso con la conexión cortada.

## Funcionalidades

- Carga rápida de ventas y gastos, con cálculo de ganancia real (precio − costo)
- Catálogo de productos con stock, categorías, código de barras (escaneo o generación interna) y foto
- Descuento automático de stock al vender un producto del catálogo
- Reposición sugerida: estima cuándo se va a agotar cada producto según su velocidad de venta real, no solo un umbral fijo
- Resumen con gráfico de ventas de los últimos 7 días y ranking de productos que más facturan
- Historial completo, filtrable, exportable a Excel/PDF e importable desde Excel
- Funciona offline: las ventas se guardan en el dispositivo y se sincronizan solas al volver la conexión
- Ticket de venta imprimible (comprobante no fiscal)
- Tema claro/oscuro/sistema en toda la app y el sitio público
- Prueba gratuita de 14 días con bloqueo automático al vencer
- Perfil de negocio con foto o iniciales, cuenta, seguridad y apariencia personalizable

## Stack

- **Frontend**: HTML/CSS/JS vanilla, sin framework ni build step — cada página es un solo archivo autocontenido
- **Backend**: [Supabase](https://supabase.com) (Postgres + Auth + Storage), con Row Level Security en todas las tablas
- **Hosting**: GitHub Pages
- **PWA**: service worker con cache del shell de la app para carga instantánea

## Estructura

```
app.html                la aplicación (requiere login)
index.html               landing page
precios.html              página de precios
terminos.html / privacidad.html   términos y política de privacidad
404.html                 página de error
sw.js / manifest.json     service worker y manifest de la PWA
supabase/                 esquema de la base de datos (ver supabase/README.md)
```

## Correrlo localmente

No hay build step: alcanza con servir la carpeta con cualquier servidor
estático.

```bash
python -m http.server 8080
```

Para conectarlo a tu propio backend, configurá `SUPABASE_URL` y
`SUPABASE_KEY` en `app.html` con las credenciales de tu proyecto de
Supabase (el esquema completo para reproducirlo está en
[`supabase/`](supabase/README.md)).

---

Hecho por [Valll444](https://github.com/Valll444).
