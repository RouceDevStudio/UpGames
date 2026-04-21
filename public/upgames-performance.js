// ========================================
// 🚀 UPGAMES — OPTIMIZACIONES DE PERFORMANCE
// ========================================
//
// Utilities para performance:
//   - Lazy loading de imágenes con IntersectionObserver
//   - Virtual scroll para listas largas (solo renderiza lo visible)
//   - Debounce / throttle helpers
//   - Preload inteligente de imágenes cercanas al viewport
//   - Prefetch de rutas al hacer hover
//
// Uso:
//   UpGamesPerf.initLazyImages();         // Auto: [data-src] → src cuando visible
//   UpGamesPerf.virtualScroll(config);    // Lista larga con solo items visibles
//   UpGamesPerf.debounce(fn, 200);        // Retrasa llamadas frecuentes
//   UpGamesPerf.throttle(fn, 100);        // Limita frecuencia de llamadas
//   UpGamesPerf.prefetchLinks();          // Prefetch en hover
// ========================================

(function (global) {
    'use strict';

    // ======================================================================
    // 1. LAZY LOADING DE IMÁGENES
    // ======================================================================

    let lazyObserver = null;

    function initLazyImages(opts = {}) {
        const rootMargin = opts.rootMargin || '200px 0px';
        const selector   = opts.selector   || 'img[data-src], img[loading="lazy"][src=""]';

        if (!('IntersectionObserver' in window)) {
            // Fallback: cargar todo inmediatamente
            document.querySelectorAll(selector).forEach(img => {
                if (img.dataset.src) img.src = img.dataset.src;
            });
            return;
        }

        if (lazyObserver) lazyObserver.disconnect();

        lazyObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const img = entry.target;

                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                }
                if (img.dataset.srcset) {
                    img.srcset = img.dataset.srcset;
                    img.removeAttribute('data-srcset');
                }
                img.classList.add('ug-loaded');
                lazyObserver.unobserve(img);
            });
        }, { rootMargin });

        document.querySelectorAll(selector).forEach(img => {
            lazyObserver.observe(img);
        });

        // Auto-detectar imágenes nuevas que se agreguen al DOM
        const mutObs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    const imgs = node.matches?.(selector) ? [node]
                               : (node.querySelectorAll?.(selector) || []);
                    imgs.forEach(img => lazyObserver.observe(img));
                }
            }
        });
        mutObs.observe(document.body, { childList: true, subtree: true });

        return { observer: lazyObserver, mutObserver: mutObs };
    }

    /**
     * Convierte una img normal en lazy: copia `src` → `data-src`.
     * Útil para retrofit de HTML existente.
     */
    function convertirALazy(imgElement) {
        if (imgElement.dataset.src) return; // Ya es lazy
        const src = imgElement.getAttribute('src');
        if (!src) return;
        imgElement.dataset.src = src;
        // Placeholder SVG 1x1 transparente
        imgElement.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
        if (lazyObserver) lazyObserver.observe(imgElement);
    }

    // ======================================================================
    // 2. VIRTUAL SCROLL
    // ======================================================================

    /**
     * Virtual scroll: solo renderiza los items visibles en viewport.
     * Ideal para listas con 100+ items.
     *
     * config:
     *   container: selector/HTMLElement donde va la lista
     *   items: array de datos
     *   itemHeight: altura estimada por item (px)
     *   renderItem: (item, index) => HTMLElement
     *   buffer: items extra a renderizar arriba/abajo (default 5)
     */
    function virtualScroll(config) {
        const container = typeof config.container === 'string'
            ? document.querySelector(config.container)
            : config.container;
        if (!container) return null;

        const {
            items = [],
            itemHeight = 80,
            renderItem,
            buffer = 5
        } = config;

        if (typeof renderItem !== 'function') {
            console.warn('[UpGamesPerf] virtualScroll necesita renderItem()');
            return null;
        }

        // Estructura: container → spacer (altura total) + absolute items visibles
        container.style.position = container.style.position || 'relative';
        container.style.overflowY = 'auto';
        container.innerHTML = '';

        const totalHeight = items.length * itemHeight;
        const spacer = document.createElement('div');
        spacer.style.height = totalHeight + 'px';
        spacer.style.position = 'relative';
        container.appendChild(spacer);

        const itemsEnPantalla = new Map(); // index → element

        function renderVisibles() {
            const scrollTop = container.scrollTop;
            const viewportHeight = container.clientHeight;

            const inicio = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
            const fin    = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / itemHeight) + buffer);

            // Remover los que ya no se ven
            for (const [idx, el] of itemsEnPantalla) {
                if (idx < inicio || idx >= fin) {
                    el.remove();
                    itemsEnPantalla.delete(idx);
                }
            }

            // Agregar los nuevos
            for (let i = inicio; i < fin; i++) {
                if (itemsEnPantalla.has(i)) continue;
                const el = renderItem(items[i], i);
                if (!el) continue;
                el.style.position = 'absolute';
                el.style.top = (i * itemHeight) + 'px';
                el.style.left = '0';
                el.style.right = '0';
                spacer.appendChild(el);
                itemsEnPantalla.set(i, el);
            }
        }

        const onScroll = throttle(renderVisibles, 50);
        container.addEventListener('scroll', onScroll);

        renderVisibles();

        return {
            actualizar: (nuevosItems) => {
                config.items = nuevosItems;
                itemsEnPantalla.forEach(el => el.remove());
                itemsEnPantalla.clear();
                spacer.style.height = (nuevosItems.length * itemHeight) + 'px';
                renderVisibles();
            },
            destruir: () => {
                container.removeEventListener('scroll', onScroll);
                spacer.remove();
            },
            scrollToIndex: (index) => {
                container.scrollTop = index * itemHeight;
            }
        };
    }

    // ======================================================================
    // 3. DEBOUNCE / THROTTLE
    // ======================================================================

    function debounce(fn, delay = 200) {
        let t;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function throttle(fn, limit = 100) {
        let lastCall = 0;
        let pending = null;
        return function (...args) {
            const ahora = Date.now();
            const restante = limit - (ahora - lastCall);
            if (restante <= 0) {
                lastCall = ahora;
                fn.apply(this, args);
            } else {
                clearTimeout(pending);
                pending = setTimeout(() => {
                    lastCall = Date.now();
                    fn.apply(this, args);
                }, restante);
            }
        };
    }

    // ======================================================================
    // 4. PREFETCH DE LINKS EN HOVER
    // ======================================================================

    const prefetched = new Set();

    function prefetchLinks(opts = {}) {
        if (!('IntersectionObserver' in window)) return;

        const selector = opts.selector || 'a[href]';
        const delay = opts.delay || 100; // ms sobre el link antes de prefetch

        document.addEventListener('mouseover', (e) => {
            const link = e.target.closest(selector);
            if (!link) return;
            const href = link.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
            if (prefetched.has(href)) return;

            const timer = setTimeout(() => {
                if (prefetched.has(href)) return;
                prefetched.add(href);
                const l = document.createElement('link');
                l.rel = 'prefetch';
                l.href = href;
                document.head.appendChild(l);
            }, delay);

            link.addEventListener('mouseleave', () => clearTimeout(timer), { once: true });
        });
    }

    // ======================================================================
    // 5. REQUEST IDLE WRAPPER
    // ======================================================================

    const idle = window.requestIdleCallback
        ? (cb) => requestIdleCallback(cb)
        : (cb) => setTimeout(cb, 1);

    /**
     * Ejecuta tareas pesadas en chunks durante tiempo libre.
     */
    function processInChunks(items, handler, chunkSize = 20) {
        let idx = 0;
        function procesar(deadline) {
            while (idx < items.length && (!deadline || deadline.timeRemaining() > 5)) {
                const fin = Math.min(idx + chunkSize, items.length);
                for (let i = idx; i < fin; i++) handler(items[i], i);
                idx = fin;
            }
            if (idx < items.length) idle(procesar);
        }
        idle(procesar);
    }

    // ======================================================================
    // 6. DETECTAR CONEXIÓN LENTA
    // ======================================================================

    function detectarConexion() {
        if (!navigator.connection) return { tipo: 'unknown', lenta: false };
        const c = navigator.connection;
        return {
            tipo: c.effectiveType || 'unknown',  // 'slow-2g' | '2g' | '3g' | '4g'
            lenta: ['slow-2g', '2g'].includes(c.effectiveType),
            saveData: c.saveData === true,
            rtt: c.rtt,
            downlink: c.downlink
        };
    }

    // ======================================================================
    // 7. MEASURING / LIGHTHOUSE HELPERS
    // ======================================================================

    function marcar(nombre) {
        try { performance.mark(nombre); } catch (e) {}
    }

    function medir(nombre, inicio, fin) {
        try {
            performance.measure(nombre, inicio, fin);
            const m = performance.getEntriesByName(nombre).pop();
            console.log(`[Perf] ${nombre}: ${m.duration.toFixed(2)}ms`);
            return m.duration;
        } catch (e) { return null; }
    }

    // ======================================================================
    // AUTO-INIT (opcional, se puede desactivar con data-no-autoinit)
    // ======================================================================

    if (!document.documentElement.dataset.noAutoinit) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                initLazyImages();
            });
        } else {
            initLazyImages();
        }
    }

    // Expose
    global.UpGamesPerf = {
        initLazyImages,
        convertirALazy,
        virtualScroll,
        debounce,
        throttle,
        prefetchLinks,
        processInChunks,
        detectarConexion,
        marcar,
        medir
    };
})(typeof window !== 'undefined' ? window : this);
