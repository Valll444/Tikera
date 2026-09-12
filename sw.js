// Service worker minimo: solo cachea el "shell" de la app (HTML/manifest/iconos)
// para que abra rapido y funcione si se pierde la conexion un instante.
// Todo lo demas (Supabase, CDNs de librerias) pasa directo a la red: los datos
// de caja tienen que ser siempre los reales, nunca una copia vieja cacheada.
const CACHE_NAME = 'tikera-shell-v1';
const SHELL_FILES = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isShellFile = url.origin === self.location.origin &&
    SHELL_FILES.some((f) => url.pathname.endsWith(f.replace('./', '/')));

  if (!isShellFile) return; // todo lo demas (Supabase, CDNs) va directo a la red

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
