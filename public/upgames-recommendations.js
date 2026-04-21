// ========================================
// 🧠 UPGAMES — UI DE RECOMENDACIONES
// ========================================
//
// Renderiza las secciones de recomendaciones:
//   - Trending (viral últimas 48h)
//   - Para ti (personalizado, requiere auth)
//   - Similares (parecidos a X)
//   - Otros descargaron también (colaborativo)
//
// Uso:
//   UpGamesRecs.init({
//       apiBase: 'https://up-games-backend-production.up.railway.app',
//       token:   localStorage.getItem('token'),
//       onSelectItem: (item) => location.href = '#item-' + item._id
//   });
//
//   // Renderizar secciones donde quieras:
//   UpGamesRecs.renderTrending('#home-trending');
//   UpGamesRecs.renderFeed('#home-personal');
//   UpGamesRecs.renderSimilar('#detail-similar', itemId);
//   UpGamesRecs.renderCollaborative('#detail-collab', itemId);
// ========================================

(function (global) {
    'use strict';

    const config = {
        apiBase: '',
        token: null,
        onSelectItem: null
    };

    function init(opts = {}) {
        Object.assign(config, opts);
        inyectarEstilos();
    }

    function setToken(token) {
        config.token = token;
    }

    // ======================================================================
    // FETCH HELPERS
    // ======================================================================

    async function apiGet(path) {
        const headers = {};
        if (config.token) headers['Authorization'] = `Bearer ${config.token}`;
        try {
            const res = await fetch(`${config.apiBase}${path}`, { headers });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            console.warn('[Recs] error:', e);
            return null;
        }
    }

    // ======================================================================
    // RENDER SECCIONES
    // ======================================================================

    async function renderTrending(selector, opts = {}) {
        const el = resolveEl(selector);
        if (!el) return;
        const limit = opts.limit || 15;
        const titulo = opts.titulo || '🔥 Tendencia ahora';

        renderSkeleton(el, titulo);
        const items = await apiGet(`/recommendations/trending?limit=${limit}`);
        if (!items || items.length === 0) {
            el.innerHTML = '';
            return;
        }
        renderSeccion(el, titulo, items, opts);
    }

    async function renderFeed(selector, opts = {}) {
        const el = resolveEl(selector);
        if (!el) return;
        const limit = opts.limit || 20;
        const titulo = opts.titulo || '✨ Para ti';

        if (!config.token) {
            // Usuario no logueado → mostrar trending
            return renderTrending(selector, { ...opts, titulo });
        }

        renderSkeleton(el, titulo);
        const items = await apiGet(`/recommendations/feed?limit=${limit}`);
        if (!items || items.length === 0) {
            el.innerHTML = '';
            return;
        }
        renderSeccion(el, titulo, items, opts);
    }

    async function renderPersonalized(selector, opts = {}) {
        const el = resolveEl(selector);
        if (!el) return;
        const limit = opts.limit || 12;
        const titulo = opts.titulo || '🎯 Recomendado para ti';

        if (!config.token) return renderTrending(selector, opts);

        renderSkeleton(el, titulo);
        const items = await apiGet(`/recommendations/personalized?limit=${limit}`);
        if (!items || items.length === 0) {
            el.innerHTML = '';
            return;
        }
        renderSeccion(el, titulo, items, opts);
    }

    async function renderSimilar(selector, juegoId, opts = {}) {
        const el = resolveEl(selector);
        if (!el || !juegoId) return;
        const limit = opts.limit || 8;
        const titulo = opts.titulo || '🧩 Contenido similar';

        renderSkeleton(el, titulo);
        const items = await apiGet(`/recommendations/similar/${juegoId}?limit=${limit}`);
        if (!items || items.length === 0) {
            el.innerHTML = '';
            return;
        }
        renderSeccion(el, titulo, items, opts);
    }

    async function renderCollaborative(selector, juegoId, opts = {}) {
        const el = resolveEl(selector);
        if (!el || !juegoId) return;
        const limit = opts.limit || 10;
        const titulo = opts.titulo || '👥 Otros usuarios también descargaron';

        renderSkeleton(el, titulo);
        const items = await apiGet(`/recommendations/collaborative/${juegoId}?limit=${limit}`);
        if (!items || items.length === 0) {
            el.innerHTML = '';
            return;
        }
        renderSeccion(el, titulo, items, opts);
    }

    // ======================================================================
    // RENDER INTERNO
    // ======================================================================

    function renderSkeleton(el, titulo) {
        el.innerHTML = `
            <div class="ugr-section">
                <div class="ugr-header">
                    <h3 class="ugr-title">${escapeHTML(titulo)}</h3>
                </div>
                <div class="ugr-scroll">
                    ${Array(6).fill('<div class="ugr-card ugr-skeleton"></div>').join('')}
                </div>
            </div>
        `;
    }

    function renderSeccion(el, titulo, items, opts = {}) {
        const modo = opts.layout || 'scroll'; // 'scroll' | 'grid'

        if (modo === 'grid') {
            el.innerHTML = `
                <div class="ugr-section">
                    <div class="ugr-header"><h3 class="ugr-title">${escapeHTML(titulo)}</h3></div>
                    <div class="ugr-grid">${items.map(renderCard).join('')}</div>
                </div>
            `;
        } else {
            el.innerHTML = `
                <div class="ugr-section">
                    <div class="ugr-header">
                        <h3 class="ugr-title">${escapeHTML(titulo)}</h3>
                        <div class="ugr-nav">
                            <button class="ugr-nav-btn" data-dir="-1">‹</button>
                            <button class="ugr-nav-btn" data-dir="1">›</button>
                        </div>
                    </div>
                    <div class="ugr-scroll">${items.map(renderCard).join('')}</div>
                </div>
            `;
        }

        // Clicks en items
        el.querySelectorAll('.ugr-card[data-id]').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                const item = items.find(i => String(i._id) === id);
                if (typeof config.onSelectItem === 'function') config.onSelectItem(item);
            });
        });

        // Navegación scroll horizontal
        const scroll = el.querySelector('.ugr-scroll');
        el.querySelectorAll('.ugr-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!scroll) return;
                const dir = parseInt(btn.dataset.dir);
                scroll.scrollBy({ left: 300 * dir, behavior: 'smooth' });
            });
        });
    }

    function renderCard(item) {
        const img = item.image || '';
        const stats = [];
        if (item.descargasEfectivas !== undefined) stats.push(`📥 ${fmtNum(item.descargasEfectivas)}`);
        if (item.likesCount !== undefined) stats.push(`❤️ ${fmtNum(item.likesCount)}`);

        const badge = item.trendingScore ? '<div class="ugr-badge ugr-badge-trending">🔥 TRENDING</div>' :
                      item.coOccurrences ? `<div class="ugr-badge ugr-badge-collab">${item.coOccurrences} usuarios</div>` :
                      '';

        return `
            <div class="ugr-card" data-id="${item._id}">
                ${badge}
                <div class="ugr-img">
                    ${img ? `<img src="${escapeHTML(img)}" alt="${escapeAttr(item.title)}" loading="lazy">` : '<div class="ugr-noimg">🎮</div>'}
                </div>
                <div class="ugr-info">
                    <div class="ugr-card-title">${escapeHTML(item.title)}</div>
                    <div class="ugr-card-creator">@${escapeHTML(item.usuario)}</div>
                    ${stats.length ? `<div class="ugr-card-stats">${stats.join(' · ')}</div>` : ''}
                </div>
            </div>
        `;
    }

    // ======================================================================
    // HELPERS
    // ======================================================================

    function resolveEl(sel) {
        return typeof sel === 'string' ? document.querySelector(sel) : sel;
    }
    function escapeHTML(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    }
    function escapeAttr(s) { return escapeHTML(s).replace(/"/g, '&quot;'); }
    function fmtNum(n) {
        n = Number(n) || 0;
        if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n/1e3).toFixed(1) + 'k';
        return String(n);
    }

    // ======================================================================
    // ESTILOS
    // ======================================================================

    function inyectarEstilos() {
        if (document.getElementById('upgames-recs-styles')) return;
        const st = document.createElement('style');
        st.id = 'upgames-recs-styles';
        st.textContent = `
            .ugr-section {
                margin: 24px 0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .ugr-header {
                display: flex; align-items: center; justify-content: space-between;
                margin-bottom: 14px; padding: 0 4px;
            }
            .ugr-title {
                font-size: 18px; font-weight: 700; color: #fff; margin: 0;
                letter-spacing: -0.01em;
            }
            .ugr-nav { display: flex; gap: 6px; }
            .ugr-nav-btn {
                width: 32px; height: 32px; border-radius: 8px;
                background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
                color: #fff; font-size: 18px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
            }
            .ugr-nav-btn:hover { background: rgba(139,92,246,0.2); border-color: #8b5cf6; }

            .ugr-scroll {
                display: flex; gap: 12px; overflow-x: auto; padding: 4px 4px 16px;
                scroll-snap-type: x mandatory; scrollbar-width: thin;
            }
            .ugr-scroll::-webkit-scrollbar { height: 6px; }
            .ugr-scroll::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.3); border-radius: 3px; }

            .ugr-grid {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                gap: 12px;
            }

            .ugr-card {
                position: relative; flex-shrink: 0; width: 200px;
                background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
                border-radius: 14px; overflow: hidden; cursor: pointer;
                scroll-snap-align: start;
                transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
            }
            .ugr-grid .ugr-card { width: 100%; }
            .ugr-card:hover {
                transform: translateY(-3px);
                border-color: rgba(139,92,246,0.5);
                box-shadow: 0 12px 30px rgba(139,92,246,0.2);
            }
            .ugr-skeleton {
                height: 240px;
                background: linear-gradient(90deg,
                    rgba(255,255,255,0.03) 0%,
                    rgba(255,255,255,0.08) 50%,
                    rgba(255,255,255,0.03) 100%);
                background-size: 200% 100%;
                animation: ugr-shimmer 1.5s infinite;
                cursor: default;
            }
            @keyframes ugr-shimmer {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }

            .ugr-img { aspect-ratio: 16/9; overflow: hidden; background: #1a1a2e; }
            .ugr-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .ugr-noimg {
                width: 100%; height: 100%; display: flex; align-items: center;
                justify-content: center; font-size: 36px; opacity: 0.3;
            }

            .ugr-info { padding: 10px 12px 12px; }
            .ugr-card-title {
                font-size: 13px; font-weight: 600; color: #fff;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                margin-bottom: 2px;
            }
            .ugr-card-creator { font-size: 12px; color: #a0a0b8; }
            .ugr-card-stats { font-size: 11px; color: #8b8ba5; margin-top: 6px; }

            .ugr-badge {
                position: absolute; top: 8px; left: 8px; z-index: 2;
                padding: 4px 10px; border-radius: 999px;
                font-size: 10px; font-weight: 700; color: #fff;
                text-transform: uppercase; letter-spacing: 0.04em;
                backdrop-filter: blur(8px);
            }
            .ugr-badge-trending {
                background: linear-gradient(135deg, rgba(249,115,22,0.9), rgba(239,68,68,0.9));
                box-shadow: 0 4px 14px rgba(249,115,22,0.3);
            }
            .ugr-badge-collab {
                background: linear-gradient(135deg, rgba(99,102,241,0.9), rgba(139,92,246,0.9));
                box-shadow: 0 4px 14px rgba(99,102,241,0.3);
            }

            @media (max-width: 640px) {
                .ugr-card { width: 160px; }
                .ugr-title { font-size: 16px; }
                .ugr-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
            }
        `;
        document.head.appendChild(st);
    }

    // Expose
    global.UpGamesRecs = {
        init, setToken,
        renderTrending, renderFeed, renderPersonalized,
        renderSimilar, renderCollaborative
    };
})(typeof window !== 'undefined' ? window : this);
