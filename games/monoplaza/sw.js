// Caché para jugar sin conexión. Cambia VERSION al publicar archivos nuevos.
const VERSION = 'apexgp-v40';
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
  './js/render/barreras.js', './js/render/vida.js', './js/render/camaraRepe.js', './js/render/personas.js', './js/render/garaje.js', './lib/mp4-muxer/mp4-muxer.mjs', './js/render/cine.js', './js/grabarVideo.js', './js/motorWorklet.js', './js/clima.js', './js/campeonato.js', './js/radio.js', './js/repeticion.js', './js/telemetria.js', './js/render/lluvia.js', './js/circuitosReales.js', './js/ingeniero.js', './js/trayectoria.js', './js/editorCircuito.js', './js/render/publico.js', './js/render/helicoptero.js', './js/render/piloto.js', './js/render/podio.js', './js/render/salidaBoxes.js', './js/render/pilotoFuera.js', './js/escuela.js', './js/estrategia.js', './js/progresion.js', './js/idioma.js', './idiomas/en.json', './idiomas/pt.json', './audio/motor_ferrari.wav', './audio/motor_ferrari.json', './audio/motor_alonso.wav', './audio/motor_alonso.json', './audio/motor_verstappen.wav', './audio/motor_verstappen.json', './audio/motor_v10.wav', './audio/motor_v10.json', './audio/motor_v6.wav', './audio/motor_v6.json', './audio/choque.mp3', './audio/radio_ini.mp3', './audio/radio_fin.mp3', './audio/chirrido.mp3', './audio/revienta.mp3', './audio/salida_parrilla.mp3', './audio/publico.mp3', './audio/ovacion.mp3',
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
