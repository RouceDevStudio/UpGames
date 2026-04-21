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

const CACHE_VERSION = 'upgames-v1.0.0';
const CACHE_STATIC  = `${CACHE_VERSION}-static`;
const CACHE_RUNTIME = `${CACHE_VERSION}-runtime`;
const CACHE_API     = `${CACHE_VERSION}-api`;

// Assets esenciales que se precachean
const PRECACHE_URLS = [
    './',
    './biblioteca.html',
    './perfil-publico.html',
    './chats.html',
    './puente.html',
    './politica-privacidad.html',
    './terminos&condiciones.html',
    './biblioteca.css',
    './script.js',
    './og-cover.png',
    './manifest.json',
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
                    .filter(n => !n.startsWith(CACHE_VERSION))
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

    // Estrategia 4: Otros (CSS, JS, fuentes) → Cache first, refresh en background
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
    try {
        const response = await fetch(request);
        // Solo cachear respuestas exitosas para GETs simples
        if (response.ok && request.method === 'GET') {
            const cache = await caches.open(CACHE_API);
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (err) {
        // Sin conexión → devolver del caché si existe
        const cached = await caches.match(request);
        if (cached) return cached;
        // Respuesta de fallback genérica para que la app no crashee
        return new Response(
            JSON.stringify({ error: 'offline', message: 'Sin conexión. Por favor intenta más tarde.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

async function cacheFirstImages(request) {
    const cached = await caches.match(request);
    if (cached) {
        // Revalidar en background (stale-while-revalidate)
        fetch(request).then(async (r) => {
            if (r.ok) {
                const cache = await caches.open(CACHE_RUNTIME);
                cache.put(request, r).catch(() => {});
            }
        }).catch(() => {});
        return cached;
    }

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_RUNTIME);
            cache.put(request, response.clone()).catch(() => {});
        }
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
// PUSH NOTIFICATIONS (para futuro)
// ======================================================================
self.addEventListener('push', (event) => {
    if (!event.data) return;
    const data = event.data.json();
    const options = {
        body: data.body || 'Nueva actividad en UpGames',
        icon: './og-cover.png',
        badge: './og-cover.png',
        data: { url: data.url || './biblioteca.html' },
        tag: data.tag || 'upgames-notif',
        requireInteraction: false
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'UpGames', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || './biblioteca.html';

    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes(url) && 'focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});
