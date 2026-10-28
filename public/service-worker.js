// ========================================
// 🛰️ SERVICE WORKER - UPGAMES PWA
// ========================================
//
// Gestiona:
//   - Caché de assets estáticos (HTML, CSS, JS, imágenes)
//   - Estrategia offline-first para navegación básica
//   - Estrategia network-first para API calls (con fallback a cache)
//   - Actualización automática cuando hay nueva versión
//
// IMPORTANTE: bump CACHE_VERSION cuando cambies archivos estáticos.
// ========================================

const CACHE_VERSION = 'upgames-v6.28.0';
const CACHE_STATIC  = `${CACHE_VERSION}-static`;
const CACHE_RUNTIME = `${CACHE_VERSION}-runtime`;
const CACHE_API     = `${CACHE_VERSION}-api`;
// Imágenes: caché propio que NO se borra al desplegar (las portadas no cambian de URL al cambiar el código)
const CACHE_IMG     = 'upgames-img-v1';
const IMG_MAX       = 400;                       // entradas como máximo (se van las más viejas)
const IMG_REVALIDAR = 7 * 24 * 3600 * 1000;      // las que no son de Cloudinary se refrescan cada 7 días

// Assets esenciales que se precachean
const PRECACHE_URLS = [
    './',
    './biblioteca.html',
    './perfil-publico.html',
    './chats.html',
    './live.html',
    './puente.html',
    './politica-privacidad.html',
    './terminos_condiciones.html',
    './biblioteca.css',
    './upgames-glass.css',
    './upgames-estilo.css',
    './upgames-extras.js',
    './upgames-social.js',
    './upgames-guia.js',
  './upgames-errores.js',
    './script.js',
    './upgames-autoinfo.js',
    './upgames-motion.js',
    './og-cover.png',
    './manifest.json',
    './icons/icon-192.png?v=2',
    './icons/icon-512.png?v=2',
    './offline.html'
];

// ======================================================================
// INSTALL
// ======================================================================
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando v' + CACHE_VERSION);
    event.waitUntil(
        caches.open(CACHE_STATIC).then((cache) => {
            // addAll falla si UNA URL falla. Usamos Promise.allSettled para tolerancia.
            return Promise.allSettled(
                PRECACHE_URLS.map(url => cache.add(url).catch(err => {
                    console.warn('[SW] No se pudo cachear:', url, err.message);
                }))
            );
        }).then(() => self.skipWaiting())
    );
});

// ======================================================================
// ACTIVATE: limpiar cachés viejos
// ======================================================================
self.addEventListener('activate', (event) => {
    console.log('[SW] Activando v' + CACHE_VERSION);
    event.waitUntil(
        caches.keys().then((nombres) => {
            return Promise.all(
                nombres
                    .filter(n => !n.startsWith(CACHE_VERSION) && n !== CACHE_IMG)
                    .map(n => {
                        console.log('[SW] Borrando caché viejo:', n);
                        return caches.delete(n);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// ======================================================================
// FETCH: estrategias de caché
// ======================================================================
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Ignorar non-GET y extensiones
    if (request.method !== 'GET') return;
    if (url.protocol === 'chrome-extension:') return;
    // Tiempo real y video en vivo: nunca pasar por caché (Socket.IO, HLS)
    if (url.pathname.startsWith('/socket.io/') || /\.(m3u8|m4s|ts)(\?|$)/i.test(url.pathname)) return;
    // Video y audio: el navegador los pide por rangos (Range/206) para avanzar y adelantar; no se guardan en caché
    if (request.destination === 'video' || request.destination === 'audio' || request.headers.has('range') || (/\/video\/upload\//.test(url.pathname) && !/\.(jpe?g|png|webp|gif)$/i.test(url.pathname))) return;
    // Pagos: el SDK de PayPal es dinámico (sesión, riesgo, idioma) → siempre de la red
    if (/(^|\.)(paypal|paypalobjects|mercadopago|mercadolibre|mlstatic|mercadolivre)\.com(\.\w+)?$/i.test(url.hostname)) return;

    // Estrategia 1: API calls → Network first, fallback a cache
    if (isApiRequest(url)) {
        event.respondWith(networkFirstAPI(request));
        return;
    }

    // Estrategia 2: Imágenes externas (cloudinary, etc) → Cache first, refresh en background
    if (isImageRequest(request)) {
        event.respondWith(cacheFirstImages(request));
        return;
    }

    // Estrategia 3: Navegación (HTML) → Network first, fallback a cache, luego offline page
    if (request.mode === 'navigate' || request.destination === 'document') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    // Estrategia 4: JS/CSS PROPIOS → Network first (fallback a caché sin conexión).
    // Antes eran cache-first: tras cada despliegue el usuario recibía el HTML
    // nuevo con el script.js VIEJO (botones nuevos sin función, p. ej. Portada).
    if (url.origin === self.location.origin) {
        event.respondWith(networkFirstStatic(request));
        return;
    }

    // Estrategia 5: recursos de terceros (fuentes, CDNs versionados) → stale-while-revalidate
    event.respondWith(cacheFirstStale(request));
});

// ======================================================================
// HELPERS
// ======================================================================

function isApiRequest(url) {
    const apiDomains = [
        'up-games-backend',     // Old Render
        'upgames-backend',      // Railway
        'railway.app',
        'onrender.com'
    ];
    return apiDomains.some(d => url.hostname.includes(d));
}

function isImageRequest(request) {
    const dest = request.destination;
    return dest === 'image' || /\.(png|jpg|jpeg|gif|webp|svg|avif)$/i.test(request.url);
}

// ---------- Estrategias ----------

async function networkFirstAPI(request) {
    // Peticiones con sesión (saldo, notificaciones, chats…) NUNCA se guardan:
    // en un dispositivo compartido otro usuario podría verlas sin conexión.
    const privada = request.headers.has('Authorization');
    try {
        const response = await fetch(request);
        // Solo cachear respuestas exitosas de GETs públicos
        if (!privada && response.ok && request.method === 'GET') {
            const cache = await caches.open(CACHE_API);
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (err) {
        // Sin conexión → devolver del caché si existe (solo públicas)
        const cached = privada ? null : await caches.match(request);
        if (cached) return cached;
        // Respuesta de fallback genérica para que la app no crashee
        return new Response(
            JSON.stringify({ error: 'offline', message: 'Sin conexión. Por favor intenta más tarde.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

// Cloudinary: una URL = un archivo que nunca cambia (la versión va en la URL) → se sirve del caché sin volver a bajarlo.
// Se pide en modo CORS: así la respuesta se puede guardar de verdad (una respuesta "opaca" ocupa ~7 MB de cuota en Chrome).
const esCloudinary = url => /(^|\.)res\.cloudinary\.com$/i.test(new URL(url).hostname);
let recortando = null;
async function recortarImagenes(cache) {
    if (recortando) return recortando;
    recortando = (async () => {
        const claves = await cache.keys();
        if (claves.length > IMG_MAX) await Promise.all(claves.slice(0, claves.length - IMG_MAX).map(k => cache.delete(k)));
    })().finally(() => { recortando = null; });
    return recortando;
}
async function guardarImagen(request, response) {
    if (!response || !response.ok || response.type === 'opaque') return;
    const tipo = response.headers.get('Content-Type') || '';
    if (tipo && !/^image\//i.test(tipo)) return;
    const cache = await caches.open(CACHE_IMG);
    // Marca de cuándo se guardó (para refrescar las que no son de Cloudinary)
    const h = new Headers(response.headers); h.set('X-UG-Guardada', String(Date.now()));
    const cuerpo = await response.blob();
    await cache.put(request.url, new Response(cuerpo, { status: 200, headers: h }));
    recortarImagenes(cache).catch(() => {});
}
async function bajarImagen(request) {
    const url = request.url;
    if (esCloudinary(url) || new URL(url).origin === self.location.origin) {
        try { return await fetch(url, { mode: 'cors', credentials: 'omit' }); } catch (_) { /* cae al pedido normal */ }
    }
    return fetch(request);
}
async function cacheFirstImages(request) {
    const cache = await caches.open(CACHE_IMG);
    const cached = await cache.match(request.url);
    if (cached) {
        const edad = Date.now() - Number(cached.headers.get('X-UG-Guardada') || 0);
        if (!esCloudinary(request.url) && edad > IMG_REVALIDAR)
            bajarImagen(request).then(r => guardarImagen(request, r.clone ? r.clone() : r)).catch(() => {});
        return cached;
    }
    try {
        const response = await bajarImagen(request);
        guardarImagen(request, response.clone()).catch(() => {});
        return response;
    } catch (err) {
        // Placeholder SVG genérico para imágenes que fallan offline
        return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="#1a1a2e" width="100" height="100"/><text x="50" y="50" text-anchor="middle" fill="#fff" font-size="10">Sin conexión</text></svg>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
        );
    }
}

async function networkFirstNavigation(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_RUNTIME);
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Fallback a página offline
        const offline = await caches.match('./offline.html');
        if (offline) return offline;
        return new Response('Sin conexión', { status: 503 });
    }
}

async function networkFirstStatic(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_STATIC);
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        return new Response('Sin conexión', { status: 503 });
    }
}

async function cacheFirstStale(request) {
    const cached = await caches.match(request);
    if (cached) {
        fetch(request).then(async (r) => {
            if (r.ok) {
                const cache = await caches.open(CACHE_STATIC);
                cache.put(request, r).catch(() => {});
            }
        }).catch(() => {});
        return cached;
    }

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_STATIC);
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (err) {
        return new Response('Sin conexión', { status: 503 });
    }
}

// ======================================================================
// MESSAGE: comunicación con la page
// ======================================================================
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data?.type === 'CLEAR_CACHE') {
        caches.keys().then(names => {
            return Promise.all(names.map(n => caches.delete(n)));
        }).then(() => {
            event.ports[0]?.postMessage({ ok: true });
        });
    }
    if (event.data?.type === 'GET_VERSION') {
        event.ports[0]?.postMessage({ version: CACHE_VERSION });
    }
});

// ======================================================================
// PUSH NOTIFICATIONS — avisos reales aunque UpGames esté cerrado
// ======================================================================
self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data && event.data.text() }; }
    event.waitUntil((async () => {
        const ventanas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        // UpGames abierto y a la vista → la isla flotante dentro de la app (sin duplicar)
        const abierta = ventanas.find(c => c.visibilityState === 'visible' && /biblioteca\.html/.test(c.url));
        if (abierta) { abierta.postMessage({ type: 'UG_PUSH', data }); return; }
        const opciones = {
            body: data.body || 'Nueva actividad en UpGames',
            icon: data.icon || './icons/icon-192.png?v=2',
            badge: data.badge || './icons/icon-96.png?v=2',
            tag: data.tag || 'upgames',
            renotify: true,
            timestamp: Date.now(),
            vibrate: [80, 40, 80],
            data: { url: data.url || './biblioteca.html', id: data.id || '' },
        };
        if (data.image) opciones.image = data.image;
        await self.registration.showNotification(data.title || 'UpGames', opciones);
        if (self.navigator && 'setAppBadge' in self.navigator) self.navigator.setAppBadge().catch(() => {});
    })());
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = new URL(event.notification.data?.url || './biblioteca.html', self.location.href).href;
    event.waitUntil((async () => {
        const ventanas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        // Reutilizar una pestaña de UpGames si hay alguna abierta
        const propia = ventanas.find(c => c.url.startsWith(self.registration.scope));
        if (propia) {
            await propia.focus();
            if ('navigate' in propia) return propia.navigate(url).catch(() => clients.openWindow(url));
        }
        return clients.openWindow(url);
    })());
});
