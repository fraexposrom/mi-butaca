// Guarda la app en el móvil para que abra sin conexión. Los datos (api.github.com) nunca se guardan aquí.
const CACHE = 'mibutaca-v6';
const ARCHIVOS = ['./', 'index.html', 'estilos.css', 'app.js', 'manifest.webmanifest',
  'iconos/logo.svg', 'iconos/icono-192.png', 'iconos/icono-512.png', 'iconos/icono-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Primero la red (para recibir mejoras); si no hay, la copia guardada.
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
