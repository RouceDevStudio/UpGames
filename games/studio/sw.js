// Caché para usar Studio sin conexión. Cambia VERSION al publicar archivos nuevos.
const VERSION = 'studio-v1';
const ARCHIVOS = [
  './', './index.html', './estilo.css', './manifest.webmanifest', './icono.svg', './icono-512.png',
  './lib/three.module.min.js', './lib/addons/controls/TransformControls.js', './lib/addons/exporters/GLTFExporter.js',
  './js/main.js', './js/camara.js', './js/escena.js', './js/primitivas.js', './js/deshacer.js',
  './js/ui/gestos.js', './js/ui/radial.js', './js/herramientas/gizmo.js',
  './js/foto/fotoA3D.js', './js/foto/dialogoFoto.js', './js/archivo/glb.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('studio-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// red primero (para recibir actualizaciones) y caché si no hay conexión
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    const copia = r.clone();
    caches.open(VERSION).then((c) => c.put(e.request, copia));
    return r;
  }).catch(() => caches.match(e.request)));
});
