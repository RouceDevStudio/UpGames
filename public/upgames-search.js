// ========================================
// 🔍 UPGAMES — UI DE BÚSQUEDA AVANZADA
// ========================================
//
// UI completa para el endpoint /search con:
//   - Autocomplete en vivo (debounce 200ms)
//   - Panel de filtros (categoría, creador, likes, descargas, fechas, tags)
//   - Ordenamiento (relevancia / popular / reciente / descargas / likes)
//   - Paginación
//   - Facets (contadores dinámicos)
//   - Historial de búsquedas local
//
// Uso:
//   UpGamesSearch.init({
//       apiBase: 'https://up-games-backend-production.up.railway.app',
//       montarEn: '#search-container',
//       onSelectItem: (item) => console.log('Click:', item)
//   });
// ========================================

(function (global) {
    'use strict';

    const config = {
        apiBase: '',
        montarEn: null,
        onSelectItem: null,
        placeholder: 'Buscar juegos, creadores, categorías...',
        maxHistorial: 10
    };

    let estado = {
        query: '',
        filtros: {
            categoria: null, usuario: null, minLikes: 0, minDescargas: 0,
            desde: null, hasta: null, tags: [], orden: 'relevancia'
        },
        page: 1,
        total: 0,
        pages: 0,
        items: [],
        facets: null,
        cargando: false
    };

    let debounceTimer = null;

    // ======================================================================
    // API PÚBLICO
    // ======================================================================

    function init(opts = {}) {
        Object.assign(config, opts);
        if (!config.montarEn) {
            console.warn('[UpGamesSearch] Falta `montarEn`');
            return;
        }
        const root = typeof config.montarEn === 'string'
            ? document.querySelector(config.montarEn)
            : config.montarEn;
        if (!root) return;

        inyectarEstilos();
        root.innerHTML = plantilla();
        bindEventos(root);
    }

    // ======================================================================
    // TEMPLATE
    // ======================================================================

    function plantilla() {
        return `
        <div class="ugs-root">
            <div class="ugs-searchbar">
                <span class="ugs-icon">🔍</span>
                <input type="text" class="ugs-input" id="ugs-input" placeholder="${config.placeholder}" autocomplete="off">
                <button class="ugs-clear" id="ugs-clear" style="display:none" aria-label="Limpiar">✕</button>
                <button class="ugs-filters-toggle" id="ugs-filters-toggle" aria-label="Filtros">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
                        <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
                        <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
                        <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/>
                        <line x1="17" y1="16" x2="23" y2="16"/>
                    </svg>
                </button>
            </div>

            <div class="ugs-autocomplete" id="ugs-autocomplete"></div>

            <div class="ugs-filters" id="ugs-filters" style="display:none">
                <div class="ugs-filter-row">
                    <label>Ordenar:</label>
                    <select id="ugs-orden">
                        <option value="relevancia">Más relevante</option>
                        <option value="popular">Más popular</option>
                        <option value="reciente">Más reciente</option>
                        <option value="descargas">Más descargado</option>
                        <option value="likes">Más likes</option>
                    </select>
                </div>
                <div class="ugs-filter-row">
                    <label>Categoría:</label>
                    <select id="ugs-categoria">
                        <option value="">Todas</option>
                    </select>
                </div>
                <div class="ugs-filter-row">
                    <label>Creador:</label>
                    <input type="text" id="ugs-usuario" placeholder="@username">
                </div>
                <div class="ugs-filter-row">
                    <label>Min. likes:</label>
                    <input type="number" id="ugs-minlikes" min="0" value="0">
                </div>
                <div class="ugs-filter-row">
                    <label>Min. descargas:</label>
                    <input type="number" id="ugs-mindesc" min="0" value="0">
                </div>
                <div class="ugs-filter-row ugs-filter-dates">
                    <label>Desde:</label>
                    <input type="date" id="ugs-desde">
                    <label>Hasta:</label>
                    <input type="date" id="ugs-hasta">
                </div>
                <div class="ugs-filter-actions">
                    <button class="ugs-btn-primary" id="ugs-apply">Aplicar filtros</button>
                    <button class="ugs-btn-secondary" id="ugs-reset">Limpiar</button>
                </div>
            </div>

            <div class="ugs-meta" id="ugs-meta"></div>
            <div class="ugs-results" id="ugs-results"></div>
            <div class="ugs-pagination" id="ugs-pagination"></div>
        </div>`;
    }

    // ======================================================================
    // EVENTOS
    // ======================================================================

    function bindEventos(root) {
        const input = root.querySelector('#ugs-input');
        const clearBtn = root.querySelector('#ugs-clear');
        const filtersToggle = root.querySelector('#ugs-filters-toggle');
        const filtersPanel = root.querySelector('#ugs-filters');
        const autocomplete = root.querySelector('#ugs-autocomplete');

        // Input: autocomplete en vivo
        input.addEventListener('input', (e) => {
            const val = e.target.value;
            clearBtn.style.display = val ? 'flex' : 'none';
            estado.query = val;

            clearTimeout(debounceTimer);
            if (val.length < 2) {
                autocomplete.style.display = 'none';
                return;
            }
            debounceTimer = setTimeout(() => solicitarAutocomplete(val), 200);
        });

        // Enter: búsqueda completa
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                autocomplete.style.display = 'none';
                estado.page = 1;
                ejecutarBusqueda();
                guardarHistorial(estado.query);
            }
            if (e.key === 'Escape') {
                autocomplete.style.display = 'none';
            }
        });

        // Limpiar
        clearBtn.addEventListener('click', () => {
            input.value = '';
            estado.query = '';
            clearBtn.style.display = 'none';
            autocomplete.style.display = 'none';
            estado.items = [];
            estado.total = 0;
            pintarResultados();
        });

        // Toggle filtros
        filtersToggle.addEventListener('click', () => {
            const visible = filtersPanel.style.display !== 'none';
            filtersPanel.style.display = visible ? 'none' : 'grid';
        });

        // Aplicar filtros
        root.querySelector('#ugs-apply').addEventListener('click', () => {
            estado.filtros.orden        = root.querySelector('#ugs-orden').value;
            estado.filtros.categoria    = root.querySelector('#ugs-categoria').value || null;
            estado.filtros.usuario      = (root.querySelector('#ugs-usuario').value || '').trim().toLowerCase() || null;
            estado.filtros.minLikes     = parseInt(root.querySelector('#ugs-minlikes').value) || 0;
            estado.filtros.minDescargas = parseInt(root.querySelector('#ugs-mindesc').value) || 0;
            estado.filtros.desde        = root.querySelector('#ugs-desde').value || null;
            estado.filtros.hasta        = root.querySelector('#ugs-hasta').value || null;
            estado.page = 1;
            ejecutarBusqueda();
        });

        // Reset filtros
        root.querySelector('#ugs-reset').addEventListener('click', () => {
            ['#ugs-usuario', '#ugs-minlikes', '#ugs-mindesc', '#ugs-desde', '#ugs-hasta'].forEach(sel => {
                root.querySelector(sel).value = sel.includes('min') ? '0' : '';
            });
            root.querySelector('#ugs-orden').value = 'relevancia';
            root.querySelector('#ugs-categoria').value = '';
            estado.filtros = {
                categoria: null, usuario: null, minLikes: 0, minDescargas: 0,
                desde: null, hasta: null, tags: [], orden: 'relevancia'
            };
            estado.page = 1;
            ejecutarBusqueda();
        });

        // Click fuera cierra autocomplete
        document.addEventListener('click', (e) => {
            if (!root.contains(e.target)) autocomplete.style.display = 'none';
        });
    }

    // ======================================================================
    // AUTOCOMPLETE
    // ======================================================================

    async function solicitarAutocomplete(q) {
        try {
            const res = await fetch(`${config.apiBase}/search/autocomplete?q=${encodeURIComponent(q)}&limit=8`);
            if (!res.ok) return;
            const data = await res.json();
            pintarAutocomplete(data);
        } catch (err) {
            console.warn('[Search] autocomplete error:', err);
        }
    }

    function pintarAutocomplete(data) {
        const ac = document.getElementById('ugs-autocomplete');
        if (!ac) return;

        const partes = [];

        if (data.items?.length) {
            partes.push('<div class="ugs-ac-title">Resultados</div>');
            data.items.forEach(item => {
                partes.push(`
                    <div class="ugs-ac-item" data-action="item" data-id="${item._id}">
                        ${item.image ? `<img src="${escapeHTML(item.image)}" alt="" loading="lazy">` : '<div class="ugs-ac-noimg">🎮</div>'}
                        <div class="ugs-ac-info">
                            <div class="ugs-ac-title-text">${escapeHTML(item.title)}</div>
                            <div class="ugs-ac-meta">${escapeHTML(item.category)} · ${fmtNum(item.descargas)} descargas</div>
                        </div>
                    </div>
                `);
            });
        }

        if (data.creadores?.length) {
            partes.push('<div class="ugs-ac-title">Creadores</div>');
            data.creadores.forEach(c => {
                partes.push(`
                    <div class="ugs-ac-item" data-action="creator" data-usuario="${escapeAttr(c.usuario)}">
                        ${c.avatar ? `<img src="${escapeHTML(c.avatar)}" alt="" loading="lazy">` : '<div class="ugs-ac-noimg">👤</div>'}
                        <div class="ugs-ac-info">
                            <div class="ugs-ac-title-text">@${escapeHTML(c.usuario)} ${c.verificado ? '<span class="ugs-verif">✓</span>' : ''}</div>
                            <div class="ugs-ac-meta">${fmtNum(c.descargas)} descargas totales</div>
                        </div>
                    </div>
                `);
            });
        }

        if (data.categorias?.length) {
            partes.push('<div class="ugs-ac-title">Categorías</div>');
            data.categorias.forEach(cat => {
                partes.push(`
                    <div class="ugs-ac-item" data-action="categoria" data-categoria="${escapeAttr(cat.categoria)}">
                        <div class="ugs-ac-noimg">📂</div>
                        <div class="ugs-ac-info">
                            <div class="ugs-ac-title-text">${escapeHTML(cat.categoria)}</div>
                            <div class="ugs-ac-meta">${cat.count} items</div>
                        </div>
                    </div>
                `);
            });
        }

        if (partes.length === 0) {
            ac.style.display = 'none';
            return;
        }

        ac.innerHTML = partes.join('');
        ac.style.display = 'block';

        // Bind click
        ac.querySelectorAll('.ugs-ac-item').forEach(el => {
            el.addEventListener('click', () => {
                const action = el.dataset.action;
                ac.style.display = 'none';
                if (action === 'item' && typeof config.onSelectItem === 'function') {
                    config.onSelectItem({ _id: el.dataset.id });
                } else if (action === 'creator') {
                    estado.filtros.usuario = el.dataset.usuario;
                    document.getElementById('ugs-usuario').value = el.dataset.usuario;
                    estado.page = 1;
                    ejecutarBusqueda();
                } else if (action === 'categoria') {
                    estado.filtros.categoria = el.dataset.categoria;
                    const sel = document.getElementById('ugs-categoria');
                    if (sel) sel.value = el.dataset.categoria;
                    estado.page = 1;
                    ejecutarBusqueda();
                }
            });
        });
    }

    // ======================================================================
    // BÚSQUEDA
    // ======================================================================

    async function ejecutarBusqueda() {
        if (estado.cargando) return;
        estado.cargando = true;
        pintarMeta('Buscando…');

        const params = new URLSearchParams();
        if (estado.query)                      params.set('q', estado.query);
        if (estado.filtros.categoria)          params.set('categoria', estado.filtros.categoria);
        if (estado.filtros.usuario)            params.set('usuario', estado.filtros.usuario);
        if (estado.filtros.minLikes > 0)       params.set('minLikes', estado.filtros.minLikes);
        if (estado.filtros.minDescargas > 0)   params.set('minDescargas', estado.filtros.minDescargas);
        if (estado.filtros.desde)              params.set('desde', estado.filtros.desde);
        if (estado.filtros.hasta)              params.set('hasta', estado.filtros.hasta);
        if (estado.filtros.tags?.length)       params.set('tags', estado.filtros.tags.join(','));
        params.set('orden',  estado.filtros.orden);
        params.set('page',   estado.page);
        params.set('limit',  20);
        params.set('facets', estado.page === 1 ? 'true' : 'false');

        try {
            const res = await fetch(`${config.apiBase}/search?${params}`);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();

            estado.items  = data.items || [];
            estado.total  = data.total || 0;
            estado.pages  = data.pages || 0;
            if (data.facets) estado.facets = data.facets;

            pintarResultados();
            pintarPaginacion();
            if (estado.facets) poblarCategoriasFacet();
        } catch (err) {
            console.error('[Search] error:', err);
            pintarMeta('Error al buscar');
        } finally {
            estado.cargando = false;
        }
    }

    // ======================================================================
    // RENDER
    // ======================================================================

    function pintarMeta(msg) {
        const el = document.getElementById('ugs-meta');
        if (!el) return;
        if (msg) {
            el.textContent = msg;
            el.style.display = 'block';
            return;
        }
        if (estado.total === 0 && estado.query) {
            el.textContent = `Sin resultados para "${estado.query}"`;
        } else if (estado.total > 0) {
            el.textContent = `${fmtNum(estado.total)} resultado${estado.total !== 1 ? 's' : ''}`;
        } else {
            el.textContent = '';
        }
        el.style.display = el.textContent ? 'block' : 'none';
    }

    function pintarResultados() {
        const el = document.getElementById('ugs-results');
        if (!el) return;
        pintarMeta();

        if (estado.items.length === 0) {
            el.innerHTML = '';
            return;
        }

        el.innerHTML = estado.items.map(item => `
            <div class="ugs-result" data-id="${item._id}">
                <div class="ugs-result-img">
                    ${item.image ? `<img src="${escapeHTML(item.image)}" alt="${escapeAttr(item.title)}" loading="lazy">` : '<div class="ugs-no-img">🎮</div>'}
                </div>
                <div class="ugs-result-info">
                    <div class="ugs-result-title">${escapeHTML(item.title)}</div>
                    <div class="ugs-result-creator">@${escapeHTML(item.usuario)}</div>
                    <div class="ugs-result-stats">
                        <span>📥 ${fmtNum(item.descargasEfectivas)}</span>
                        <span>❤️ ${fmtNum(item.likesCount)}</span>
                        <span class="ugs-chip">${escapeHTML(item.category)}</span>
                    </div>
                </div>
            </div>
        `).join('');

        el.querySelectorAll('.ugs-result').forEach(r => {
            r.addEventListener('click', () => {
                if (typeof config.onSelectItem === 'function') {
                    const id = r.dataset.id;
                    const item = estado.items.find(i => String(i._id) === id);
                    config.onSelectItem(item);
                }
            });
        });
    }

    function pintarPaginacion() {
        const el = document.getElementById('ugs-pagination');
        if (!el) return;
        if (estado.pages <= 1) { el.innerHTML = ''; return; }

        const current = estado.page;
        const total = estado.pages;
        const partes = [];

        partes.push(`<button data-page="${Math.max(1, current-1)}" ${current === 1 ? 'disabled' : ''}>← Anterior</button>`);
        partes.push(`<span class="ugs-page-info">Página ${current} de ${total}</span>`);
        partes.push(`<button data-page="${Math.min(total, current+1)}" ${current === total ? 'disabled' : ''}>Siguiente →</button>`);

        el.innerHTML = partes.join('');
        el.querySelectorAll('button[data-page]').forEach(b => {
            b.addEventListener('click', () => {
                const p = parseInt(b.dataset.page);
                if (p !== estado.page && !b.disabled) {
                    estado.page = p;
                    ejecutarBusqueda();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
        });
    }

    function poblarCategoriasFacet() {
        const sel = document.getElementById('ugs-categoria');
        if (!sel || !estado.facets) return;

        const valorActual = sel.value;
        sel.innerHTML = '<option value="">Todas</option>';
        estado.facets.categorias.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.categoria;
            opt.textContent = `${c.categoria} (${c.count})`;
            if (c.categoria === valorActual) opt.selected = true;
            sel.appendChild(opt);
        });
    }

    // ======================================================================
    // HISTORIAL LOCAL
    // ======================================================================

    function guardarHistorial(q) {
        if (!q || q.length < 2) return;
        try {
            const lista = JSON.parse(localStorage.getItem('upgames_search_history') || '[]');
            const nueva = [q, ...lista.filter(x => x !== q)].slice(0, config.maxHistorial);
            localStorage.setItem('upgames_search_history', JSON.stringify(nueva));
        } catch (e) {}
    }

    function obtenerHistorial() {
        try {
            return JSON.parse(localStorage.getItem('upgames_search_history') || '[]');
        } catch (e) { return []; }
    }

    // ======================================================================
    // HELPERS
    // ======================================================================

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
        if (document.getElementById('upgames-search-styles')) return;
        const st = document.createElement('style');
        st.id = 'upgames-search-styles';
        st.textContent = `
            .ugs-root { position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
            .ugs-searchbar {
                display: flex; align-items: center; gap: 8px;
                background: rgba(255,255,255,0.05); border: 1px solid rgba(139,92,246,0.3);
                border-radius: 14px; padding: 4px 8px 4px 16px;
                transition: border-color 0.2s, box-shadow 0.2s;
            }
            .ugs-searchbar:focus-within { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,0.15); }
            .ugs-icon { font-size: 18px; opacity: 0.6; }
            .ugs-input {
                flex: 1; background: transparent; border: none; outline: none;
                padding: 14px 8px; color: #fff; font-size: 15px;
            }
            .ugs-clear, .ugs-filters-toggle {
                background: transparent; border: none; color: #a0a0b8; cursor: pointer;
                width: 36px; height: 36px; border-radius: 10px;
                display: flex; align-items: center; justify-content: center;
                transition: background 0.15s;
            }
            .ugs-clear:hover, .ugs-filters-toggle:hover { background: rgba(255,255,255,0.08); color: #fff; }

            .ugs-autocomplete {
                position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 100;
                background: #15152a; border: 1px solid rgba(139,92,246,0.3);
                border-radius: 14px; padding: 8px; max-height: 480px; overflow-y: auto;
                display: none; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            }
            .ugs-ac-title {
                font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
                color: #6b6b85; padding: 8px 12px 4px; font-weight: 700;
            }
            .ugs-ac-item {
                display: flex; align-items: center; gap: 12px;
                padding: 8px 12px; border-radius: 10px; cursor: pointer;
                transition: background 0.15s;
            }
            .ugs-ac-item:hover { background: rgba(139,92,246,0.1); }
            .ugs-ac-item img, .ugs-ac-noimg {
                width: 40px; height: 40px; border-radius: 8px; object-fit: cover; flex-shrink: 0;
                background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center;
            }
            .ugs-ac-info { flex: 1; min-width: 0; }
            .ugs-ac-title-text { font-size: 14px; color: #fff; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ugs-ac-meta { font-size: 12px; color: #a0a0b8; margin-top: 2px; }
            .ugs-verif { color: #22c55e; margin-left: 4px; }

            .ugs-filters {
                display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
                padding: 16px; margin-top: 12px;
                background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
                border-radius: 14px;
            }
            .ugs-filter-row { display: flex; flex-direction: column; gap: 6px; }
            .ugs-filter-row label { font-size: 12px; color: #a0a0b8; font-weight: 600; }
            .ugs-filter-row input, .ugs-filter-row select {
                background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
                border-radius: 8px; padding: 8px 12px; color: #fff; font-size: 13px; outline: none;
            }
            .ugs-filter-row input:focus, .ugs-filter-row select:focus { border-color: #8b5cf6; }
            .ugs-filter-dates { grid-column: 1/-1; flex-direction: row; align-items: center; gap: 8px; flex-wrap: wrap; }
            .ugs-filter-dates label { flex-shrink: 0; }
            .ugs-filter-dates input { flex: 1; min-width: 120px; }
            .ugs-filter-actions { grid-column: 1/-1; display: flex; gap: 8px; justify-content: flex-end; }
            .ugs-btn-primary {
                background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
                border: none; padding: 10px 20px; border-radius: 10px; font-weight: 600; cursor: pointer;
            }
            .ugs-btn-secondary {
                background: rgba(255,255,255,0.05); color: #a0a0b8;
                border: 1px solid rgba(255,255,255,0.1); padding: 10px 20px; border-radius: 10px; cursor: pointer;
            }

            .ugs-meta {
                margin-top: 16px; font-size: 13px; color: #a0a0b8;
                padding: 0 4px; display: none;
            }

            .ugs-results {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
                gap: 14px; margin-top: 12px;
            }
            .ugs-result {
                background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
                border-radius: 14px; overflow: hidden; cursor: pointer;
                transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
            }
            .ugs-result:hover {
                transform: translateY(-2px); border-color: rgba(139,92,246,0.4);
                box-shadow: 0 12px 30px rgba(0,0,0,0.3);
            }
            .ugs-result-img { aspect-ratio: 16/9; background: #1a1a2e; overflow: hidden; }
            .ugs-result-img img { width: 100%; height: 100%; object-fit: cover; }
            .ugs-no-img { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 40px; opacity: 0.3; }
            .ugs-result-info { padding: 12px; }
            .ugs-result-title { font-size: 14px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .ugs-result-creator { font-size: 12px; color: #a0a0b8; margin-top: 2px; }
            .ugs-result-stats {
                display: flex; gap: 10px; margin-top: 8px; font-size: 12px; color: #a0a0b8;
                align-items: center; flex-wrap: wrap;
            }
            .ugs-chip {
                background: rgba(139,92,246,0.15); color: #c4b5fd;
                padding: 2px 8px; border-radius: 999px; font-size: 11px;
            }

            .ugs-pagination {
                display: flex; align-items: center; justify-content: center; gap: 12px;
                margin-top: 24px;
            }
            .ugs-pagination button {
                background: rgba(255,255,255,0.05); color: #fff;
                border: 1px solid rgba(255,255,255,0.1);
                padding: 8px 16px; border-radius: 10px; font-size: 13px; cursor: pointer;
            }
            .ugs-pagination button:disabled { opacity: 0.3; cursor: not-allowed; }
            .ugs-pagination button:not(:disabled):hover { background: rgba(139,92,246,0.2); border-color: #8b5cf6; }
            .ugs-page-info { font-size: 13px; color: #a0a0b8; }

            @media (max-width: 640px) {
                .ugs-filters { grid-template-columns: 1fr; }
                .ugs-results { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
                .ugs-result-title { font-size: 13px; }
                .ugs-input { font-size: 14px; padding: 12px 4px; }
            }
        `;
        document.head.appendChild(st);
    }

    // Expose
    global.UpGamesSearch = { init, buscar: ejecutarBusqueda, getEstado: () => ({...estado}) };
})(typeof window !== 'undefined' ? window : this);
