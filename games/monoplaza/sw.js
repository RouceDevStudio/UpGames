// Caché para jugar sin conexión. Cambia VERSION al publicar archivos nuevos.
const VERSION = 'apexgp-v11';
const ARCHIVOS = [
  './', './index.html', './estilo.css', './manifest.webmanifest', './icono.svg', './logo.svg', './icono-512.png',
  './lib/three.module.min.js', './lib/addons/objects/Sky.js', './lib/addons/utils/BufferGeometryUtils.js',
  './lib/addons/postprocessing/EffectComposer.js', './lib/addons/postprocessing/RenderPass.js',
  './lib/addons/postprocessing/ShaderPass.js', './lib/addons/postprocessing/UnrealBloomPass.js',
  './lib/addons/postprocessing/OutputPass.js', './lib/addons/postprocessing/MaskPass.js', './lib/addons/postprocessing/Pass.js',
  './lib/addons/shaders/CopyShader.js', './lib/addons/shaders/LuminosityHighPassShader.js', './lib/addons/shaders/OutputShader.js',
  './js/main.js', './js/config.js', './js/track.js', './js/race.js', './js/ai.js', './js/audio.js', './js/input.js',
  './js/physics/monoplaza.js', './js/physics/neumatico.js', './js/red.js', './lib/socket.io.esm.min.js',
  './js/render/escenario.js', './js/render/cocheModelo.js', './js/render/efectos.js', './js/render/camara.js', './js/render/texturas.js', './js/render/librea.js', './js/render/equipo.js',
  './js/render/barreras.js', './js/render/vida.js', './js/render/camaraRepe.js', './js/render/personas.js', './js/render/garaje.js', './js/render/cine.js', './js/grabarVideo.js', './js/motorWorklet.js', './js/clima.js', './js/campeonato.js', './js/radio.js', './js/repeticion.js', './js/telemetria.js', './js/render/lluvia.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('apexgp-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
