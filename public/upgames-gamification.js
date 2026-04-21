// ========================================
// 🎮 UPGAMES — UI DE GAMIFICACIÓN
// ========================================
//
// Widgets para:
//   - XP bar + nivel + barra de progreso
//   - Modal con badges desbloqueados
//   - Notificación toast al subir nivel o ganar badge
//   - Leaderboard (xp / descargas / creadores)
//   - Perfil compacto de gamificación
//
// Uso:
//   UpGamesGami.init({ apiBase: '...', token: '...' });
//   UpGamesGami.renderWidget('#xp-widget');
//   UpGamesGami.mostrarBadge(badgeObj);  // Toast
//   UpGamesGami.abrirModalBadges();
//   UpGamesGami.renderLeaderboard('#lb-container', 'xp');
// ========================================

(function (global) {
    'use strict';

    const config = {
        apiBase: '',
        token: null,
        pollingMs: 60000 // Cada 1 min revisa si hay nuevos badges
    };

    let cacheGamification = null;
    let pollingInterval = null;

    function init(opts = {}) {
        Object.assign(config, opts);
        inyectarEstilos();

        // Registrar login diario si tiene token
        if (config.token) {
            registrarLoginDiario();
        }
    }

    function setToken(token) {
        config.token = token;
        if (token) registrarLoginDiario();
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
        } catch (e) { return null; }
    }

    async function apiPost(path, body = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (config.token) headers['Authorization'] = `Bearer ${config.token}`;
        try {
            const res = await fetch(`${config.apiBase}${path}`, {
                method: 'POST', headers, body: JSON.stringify(body)
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) { return null; }
    }

    // ======================================================================
    // LOGIN DIARIO (racha)
    // ======================================================================

    async function registrarLoginDiario() {
        const hoy = new Date().toISOString().slice(0, 10);
        const ultimoLocal = localStorage.getItem('upgames_last_daily');
        if (ultimoLocal === hoy) return; // Ya registró hoy

        const r = await apiPost('/gamification/daily-login');
        if (!r) return;
        localStorage.setItem('upgames_last_daily', hoy);

        if (r.esNuevoDia && r.xpGanado > 0) {
            toast({
                titulo: `🔥 Racha de ${r.rachaActual} día${r.rachaActual !== 1 ? 's' : ''}`,
                texto: `+${r.xpGanado} XP por volver`
            });
        }

        if (r.badges && r.badges.length > 0) {
            r.badges.forEach(b => mostrarBadge(b));
        }
    }

    // ======================================================================
    // WIDGET: XP BAR + NIVEL
    // ======================================================================

    async function renderWidget(selector, opts = {}) {
        const el = resolveEl(selector);
        if (!el) return;
        if (!config.token) {
            el.innerHTML = '';
            return;
        }

        const g = await apiGet('/gamification/me');
        if (!g) { el.innerHTML = ''; return; }
        cacheGamification = g;

        const compact = opts.compact !== false;

        el.innerHTML = `
            <div class="ugg-widget ${compact ? 'compact' : ''}">
                <div class="ugg-widget-top">
                    <div class="ugg-level">
                        <span class="ugg-level-num">${g.nivel}</span>
                        <span class="ugg-level-label">Nivel</span>
                    </div>
                    <div class="ugg-widget-info">
                        <div class="ugg-xp-text">${fmtNum(g.xp)} XP</div>
                        <div class="ugg-xp-bar">
                            <div class="ugg-xp-fill" style="width:${g.progresoNivel}%"></div>
                        </div>
                        <div class="ugg-xp-next">${fmtNum(g.xpParaProximoNivel)} XP para nivel ${g.nivel + 1}</div>
                    </div>
                </div>
                <div class="ugg-widget-stats">
                    <div class="ugg-stat" data-action="badges">
                        <span class="ugg-stat-num">${g.badgesDesbloqueados.length}</span>
                        <span class="ugg-stat-label">Badges</span>
                    </div>
                    <div class="ugg-stat">
                        <span class="ugg-stat-num">🔥 ${g.rachaActual}</span>
                        <span class="ugg-stat-label">Racha</span>
                    </div>
                    <div class="ugg-stat" data-action="leaderboard">
                        <span class="ugg-stat-num">🏆</span>
                        <span class="ugg-stat-label">Ranking</span>
                    </div>
                </div>
            </div>
        `;

        el.querySelector('[data-action="badges"]')?.addEventListener('click', () => abrirModalBadges());
        el.querySelector('[data-action="leaderboard"]')?.addEventListener('click', () => abrirModalLeaderboard());
    }

    // ======================================================================
    // TOAST: BADGE GANADO / LEVEL UP
    // ======================================================================

    function mostrarBadge(badge) {
        if (!badge) return;
        toast({
            titulo: `🏆 ¡Badge desbloqueado!`,
            texto: `${badge.emoji} ${badge.titulo}`,
            sub: badge.descripcion,
            duracion: 5000,
            importante: true
        });
    }

    function mostrarLevelUp(nivel) {
        toast({
            titulo: '⭐ ¡LEVEL UP!',
            texto: `Ahora eres Nivel ${nivel}`,
            duracion: 6000,
            importante: true
        });
    }

    function toast({ titulo, texto, sub = '', duracion = 4000, importante = false }) {
        const div = document.createElement('div');
        div.className = 'ugg-toast' + (importante ? ' ugg-toast-importante' : '');
        div.innerHTML = `
            <div class="ugg-toast-content">
                <div class="ugg-toast-title">${escapeHTML(titulo)}</div>
                <div class="ugg-toast-text">${escapeHTML(texto)}</div>
                ${sub ? `<div class="ugg-toast-sub">${escapeHTML(sub)}</div>` : ''}
            </div>
            <button class="ugg-toast-close" aria-label="Cerrar">✕</button>
        `;
        document.body.appendChild(div);

        requestAnimationFrame(() => div.classList.add('show'));

        const cerrar = () => {
            div.classList.remove('show');
            setTimeout(() => div.remove(), 300);
        };
        div.querySelector('.ugg-toast-close').onclick = cerrar;
        setTimeout(cerrar, duracion);
    }

    // ======================================================================
    // MODAL: BADGES
    // ======================================================================

    async function abrirModalBadges() {
        const [gami, catalogo] = await Promise.all([
            apiGet('/gamification/me'),
            apiGet('/gamification/badges-catalog')
        ]);
        if (!gami || !catalogo) return;

        const desbloqueados = new Set(gami.badges || []);
        const todos = Object.values(catalogo);

        const contenido = todos.map(b => {
            const unlocked = desbloqueados.has(b.id);
            return `
                <div class="ugg-badge-item ${unlocked ? 'unlocked' : 'locked'}" title="${escapeAttr(b.descripcion)}">
                    <div class="ugg-badge-emoji">${b.emoji}</div>
                    <div class="ugg-badge-titulo">${escapeHTML(b.titulo)}</div>
                    <div class="ugg-badge-desc">${escapeHTML(b.descripcion)}</div>
                    <div class="ugg-badge-xp">${unlocked ? '✅ Desbloqueado' : `+${b.xp} XP`}</div>
                </div>
            `;
        }).join('');

        abrirModal(
            `🏆 Mis Badges (${desbloqueados.size}/${todos.length})`,
            `<div class="ugg-badges-grid">${contenido}</div>`
        );
    }

    // ======================================================================
    // MODAL: LEADERBOARD
    // ======================================================================

    async function abrirModalLeaderboard(tipoInicial = 'xp') {
        let tipoActivo = tipoInicial;

        const miPosicionPromise = config.token ? apiGet(`/gamification/my-rank/${tipoActivo}`) : null;
        const data = await apiGet(`/gamification/leaderboard/${tipoActivo}?limit=50`);
        const miPos = await miPosicionPromise;

        const render = (data, miPos) => `
            <div class="ugg-lb-tabs">
                <button class="ugg-lb-tab ${tipoActivo==='xp'?'active':''}" data-tipo="xp">XP</button>
                <button class="ugg-lb-tab ${tipoActivo==='descargas'?'active':''}" data-tipo="descargas">Descargas</button>
                <button class="ugg-lb-tab ${tipoActivo==='creadores'?'active':''}" data-tipo="creadores">Creadores</button>
            </div>
            ${miPos && miPos.posicion ? `<div class="ugg-lb-mi-pos">Tu posición: #${miPos.posicion}</div>` : ''}
            <div class="ugg-lb-list">
                ${(data || []).map((u, i) => renderLBItem(u, i, tipoActivo)).join('')}
            </div>
        `;

        abrirModal('🏆 Ranking Global', render(data, miPos));

        // Tabs click
        const modal = document.getElementById('ugg-modal');
        modal.querySelectorAll('.ugg-lb-tab').forEach(t => {
            t.addEventListener('click', async () => {
                tipoActivo = t.dataset.tipo;
                const [d, mp] = await Promise.all([
                    apiGet(`/gamification/leaderboard/${tipoActivo}?limit=50`),
                    config.token ? apiGet(`/gamification/my-rank/${tipoActivo}`) : null
                ]);
                modal.querySelector('.ugg-modal-body').innerHTML = render(d, mp);
                // Re-bind tabs
                modal.querySelectorAll('.ugg-lb-tab').forEach(bt => {
                    bt.addEventListener('click', async (ev) => {
                        tipoActivo = ev.currentTarget.dataset.tipo;
                        const [d2, mp2] = await Promise.all([
                            apiGet(`/gamification/leaderboard/${tipoActivo}?limit=50`),
                            config.token ? apiGet(`/gamification/my-rank/${tipoActivo}`) : null
                        ]);
                        modal.querySelector('.ugg-modal-body').innerHTML = render(d2, mp2);
                    });
                });
            });
        });
    }

    function renderLBItem(u, i, tipo) {
        const pos = i + 1;
        const medalla = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `#${pos}`;
        let valor = '';
        if (tipo === 'xp') valor = `${fmtNum(u.xp)} XP · Nivel ${u.nivel}`;
        else if (tipo === 'descargas') valor = `${fmtNum(u.stats?.totalDescargas || 0)} descargas`;
        else if (tipo === 'creadores') valor = `${fmtNum(u.stats?.totalUploads || 0)} items · $${(u.stats?.totalGanado||0).toFixed(2)}`;

        return `
            <div class="ugg-lb-row">
                <div class="ugg-lb-pos">${medalla}</div>
                <div class="ugg-lb-user">@${escapeHTML(u.usuario)}</div>
                <div class="ugg-lb-valor">${valor}</div>
            </div>
        `;
    }

    // ======================================================================
    // LEADERBOARD INLINE (no modal)
    // ======================================================================

    async function renderLeaderboard(selector, tipo = 'xp', opts = {}) {
        const el = resolveEl(selector);
        if (!el) return;
        const limit = opts.limit || 20;

        el.innerHTML = '<div class="ugg-lb-loading">Cargando ranking…</div>';
        const data = await apiGet(`/gamification/leaderboard/${tipo}?limit=${limit}`);
        if (!data) { el.innerHTML = ''; return; }

        el.innerHTML = `
            <div class="ugg-lb-inline">
                <h3>${tipo === 'xp' ? '🏆 Top XP' : tipo === 'descargas' ? '📥 Top Descargadores' : '⭐ Top Creadores'}</h3>
                <div class="ugg-lb-list">${data.map((u, i) => renderLBItem(u, i, tipo)).join('')}</div>
            </div>
        `;
    }

    // ======================================================================
    // MODAL GENÉRICO
    // ======================================================================

    function abrirModal(titulo, contenidoHTML) {
        cerrarModal();
        const modal = document.createElement('div');
        modal.id = 'ugg-modal';
        modal.className = 'ugg-modal';
        modal.innerHTML = `
            <div class="ugg-modal-backdrop"></div>
            <div class="ugg-modal-card">
                <div class="ugg-modal-header">
                    <h2>${escapeHTML(titulo)}</h2>
                    <button class="ugg-modal-close" aria-label="Cerrar">✕</button>
                </div>
                <div class="ugg-modal-body">${contenidoHTML}</div>
            </div>
        `;
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('show'));

        modal.querySelector('.ugg-modal-close').onclick = cerrarModal;
        modal.querySelector('.ugg-modal-backdrop').onclick = cerrarModal;
    }

    function cerrarModal() {
        const existente = document.getElementById('ugg-modal');
        if (existente) {
            existente.classList.remove('show');
            setTimeout(() => existente.remove(), 200);
        }
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
        if (document.getElementById('upgames-gami-styles')) return;
        const st = document.createElement('style');
        st.id = 'upgames-gami-styles';
        st.textContent = `
            .ugg-widget {
                background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.05));
                border: 1px solid rgba(139,92,246,0.25);
                border-radius: 16px; padding: 16px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .ugg-widget-top { display: flex; gap: 14px; align-items: center; }
            .ugg-level {
                width: 60px; height: 60px; flex-shrink: 0;
                background: linear-gradient(135deg, #6366f1, #8b5cf6);
                border-radius: 14px;
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                color: #fff; box-shadow: 0 8px 20px rgba(99,102,241,0.4);
            }
            .ugg-level-num { font-size: 22px; font-weight: 800; line-height: 1; }
            .ugg-level-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.85; }

            .ugg-widget-info { flex: 1; min-width: 0; }
            .ugg-xp-text { font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 6px; }
            .ugg-xp-bar {
                height: 8px; background: rgba(255,255,255,0.08);
                border-radius: 999px; overflow: hidden;
            }
            .ugg-xp-fill {
                height: 100%;
                background: linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899);
                background-size: 200% 100%;
                animation: ugg-shine 3s linear infinite;
                transition: width 0.6s ease-out;
            }
            @keyframes ugg-shine {
                0% { background-position: 0% 0; }
                100% { background-position: 200% 0; }
            }
            .ugg-xp-next { font-size: 11px; color: #a0a0b8; margin-top: 5px; }

            .ugg-widget-stats {
                display: grid; grid-template-columns: repeat(3, 1fr);
                gap: 8px; margin-top: 14px;
            }
            .ugg-stat {
                background: rgba(255,255,255,0.04); border-radius: 10px;
                padding: 10px; text-align: center; cursor: pointer;
                transition: background 0.15s, transform 0.15s;
            }
            .ugg-stat[data-action]:hover {
                background: rgba(139,92,246,0.15); transform: translateY(-1px);
            }
            .ugg-stat-num { display: block; font-size: 16px; font-weight: 700; color: #fff; }
            .ugg-stat-label { font-size: 11px; color: #a0a0b8; }

            /* ============ TOAST ============ */
            .ugg-toast {
                position: fixed; top: 20px; right: 20px; z-index: 99999;
                min-width: 280px; max-width: 360px;
                background: #15152a; border: 1px solid rgba(139,92,246,0.4);
                border-radius: 14px; padding: 14px 16px;
                display: flex; gap: 12px; align-items: flex-start;
                box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                transform: translateX(400px); opacity: 0;
                transition: transform 0.3s ease-out, opacity 0.3s;
                font-family: -apple-system, sans-serif;
            }
            .ugg-toast.show { transform: translateX(0); opacity: 1; }
            .ugg-toast-importante {
                background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.15));
                border-color: rgba(139,92,246,0.6);
                box-shadow: 0 20px 60px rgba(139,92,246,0.3);
            }
            .ugg-toast-content { flex: 1; min-width: 0; }
            .ugg-toast-title { font-size: 13px; color: #a0a0b8; font-weight: 600; margin-bottom: 2px; }
            .ugg-toast-text { font-size: 15px; color: #fff; font-weight: 700; line-height: 1.3; }
            .ugg-toast-sub { font-size: 12px; color: #a0a0b8; margin-top: 4px; }
            .ugg-toast-close {
                background: transparent; border: none; color: #a0a0b8;
                cursor: pointer; font-size: 14px; padding: 4px; flex-shrink: 0;
            }

            /* ============ MODAL ============ */
            .ugg-modal {
                position: fixed; inset: 0; z-index: 99998;
                opacity: 0; pointer-events: none; transition: opacity 0.2s;
                font-family: -apple-system, sans-serif;
            }
            .ugg-modal.show { opacity: 1; pointer-events: auto; }
            .ugg-modal-backdrop {
                position: absolute; inset: 0;
                background: rgba(0,0,0,0.75); backdrop-filter: blur(10px);
            }
            .ugg-modal-card {
                position: absolute; top: 50%; left: 50%;
                transform: translate(-50%, -50%) scale(0.95);
                background: #15152a; border: 1px solid rgba(139,92,246,0.3);
                border-radius: 20px; width: 90%; max-width: 720px;
                max-height: 85vh; display: flex; flex-direction: column;
                overflow: hidden; transition: transform 0.2s;
                box-shadow: 0 30px 80px rgba(0,0,0,0.6);
            }
            .ugg-modal.show .ugg-modal-card { transform: translate(-50%, -50%) scale(1); }
            .ugg-modal-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.06);
            }
            .ugg-modal-header h2 { margin: 0; font-size: 18px; color: #fff; font-weight: 700; }
            .ugg-modal-close {
                background: rgba(255,255,255,0.05); border: none; color: #fff;
                width: 32px; height: 32px; border-radius: 8px; cursor: pointer;
            }
            .ugg-modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; }

            /* ============ BADGES GRID ============ */
            .ugg-badges-grid {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                gap: 12px;
            }
            .ugg-badge-item {
                background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
                border-radius: 14px; padding: 16px 12px; text-align: center;
                transition: transform 0.15s, border-color 0.15s;
            }
            .ugg-badge-item.unlocked {
                background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08));
                border-color: rgba(139,92,246,0.4);
            }
            .ugg-badge-item.locked { opacity: 0.4; filter: grayscale(1); }
            .ugg-badge-emoji { font-size: 36px; margin-bottom: 8px; }
            .ugg-badge-titulo { font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 4px; }
            .ugg-badge-desc { font-size: 11px; color: #a0a0b8; line-height: 1.3; min-height: 28px; }
            .ugg-badge-xp {
                margin-top: 8px; font-size: 11px; font-weight: 700;
                color: #c4b5fd; padding: 4px 8px;
                background: rgba(139,92,246,0.15); border-radius: 999px;
                display: inline-block;
            }
            .ugg-badge-item.unlocked .ugg-badge-xp { color: #86efac; background: rgba(34,197,94,0.15); }

            /* ============ LEADERBOARD ============ */
            .ugg-lb-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
            .ugg-lb-tab {
                flex: 1; background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.08); color: #a0a0b8;
                padding: 9px 12px; border-radius: 10px;
                font-size: 13px; font-weight: 600; cursor: pointer;
                transition: all 0.15s;
            }
            .ugg-lb-tab:hover { background: rgba(139,92,246,0.15); color: #fff; }
            .ugg-lb-tab.active {
                background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
                border-color: transparent;
            }
            .ugg-lb-mi-pos {
                background: rgba(139,92,246,0.15); border: 1px solid rgba(139,92,246,0.3);
                border-radius: 10px; padding: 10px 14px; margin-bottom: 12px;
                font-size: 13px; color: #fff; font-weight: 600;
            }
            .ugg-lb-list { display: flex; flex-direction: column; gap: 6px; }
            .ugg-lb-row {
                display: flex; align-items: center; gap: 12px;
                background: rgba(255,255,255,0.03); padding: 10px 14px;
                border-radius: 10px; font-size: 14px;
            }
            .ugg-lb-pos {
                min-width: 40px; font-weight: 700; color: #a0a0b8;
                font-size: 15px;
            }
            .ugg-lb-user { flex: 1; color: #fff; font-weight: 600; }
            .ugg-lb-valor { color: #a0a0b8; font-size: 12px; text-align: right; }

            .ugg-lb-loading { color: #a0a0b8; text-align: center; padding: 40px; font-size: 14px; }

            @media (max-width: 640px) {
                .ugg-toast { right: 10px; left: 10px; max-width: none; top: 10px; }
                .ugg-widget-stats { grid-template-columns: 1fr 1fr 1fr; font-size: 12px; }
                .ugg-modal-card { width: 96%; max-height: 92vh; }
                .ugg-badges-grid { grid-template-columns: repeat(2, 1fr); }
            }
        `;
        document.head.appendChild(st);
    }

    // Expose
    global.UpGamesGami = {
        init, setToken,
        renderWidget,
        mostrarBadge, mostrarLevelUp, toast,
        abrirModalBadges, abrirModalLeaderboard,
        renderLeaderboard,
        cerrarModal
    };
})(typeof window !== 'undefined' ? window : this);
