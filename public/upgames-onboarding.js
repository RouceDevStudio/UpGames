// ========================================
// 🎓 UPGAMES — ONBOARDING MEJORADO
// ========================================
//
// Tour guiado con:
//   - Highlights tipo spotlight (resalta elemento real)
//   - Branching: flujo distinto para creadores vs consumidores
//   - Skip siempre disponible
//   - Persistencia en localStorage
//   - Reactivable desde settings
//
// Uso:
//   UpGamesOnboarding.iniciar({ tipo: 'auto' }); // auto-detecta
//   UpGamesOnboarding.reset(); // para volver a mostrar
//   UpGamesOnboarding.fueCompletado(); // bool
//
// Se puede definir tu propio flujo:
//   UpGamesOnboarding.iniciar({
//       pasos: [
//           { selector: '#home-btn', titulo: 'Inicio', texto: '...' },
//           { centrado: true, titulo: 'Listo', texto: '...' }
//       ]
//   });
// ========================================

(function (global) {
    'use strict';

    const STORAGE_KEY = 'upgames_onboarding_v2';

    // ======================================================================
    // FLUJOS PREDEFINIDOS
    // ======================================================================

    const FLUJOS = {
        bienvenida: [
            {
                centrado: true,
                emoji: '👋',
                titulo: '¡Bienvenido a UpGames!',
                texto: 'La primera plataforma gaming con monetización directa para creadores. Vamos a hacer un tour rápido (30 segundos).'
            },
            {
                centrado: true,
                emoji: '🎮',
                titulo: '¿Qué es UpGames?',
                texto: 'Una biblioteca global donde cualquiera puede compartir juegos, mods, APKs y contenido gaming. Los creadores ganan dinero real por cada descarga ($1 por cada 1000 descargas).'
            },
            {
                centrado: true,
                emoji: '🤔',
                titulo: '¿Cómo lo usarás?',
                texto: 'Cuéntanos qué te interesa más para personalizar tu experiencia.',
                opciones: [
                    { id: 'consumer', label: '🎯 Quiero descargar contenido', flujo: 'consumer' },
                    { id: 'creator',  label: '⭐ Quiero subir y monetizar',   flujo: 'creator' },
                    { id: 'ambos',    label: '🚀 Ambos',                       flujo: 'consumer' }
                ]
            }
        ],
        consumer: [
            {
                centrado: true,
                emoji: '🔍',
                titulo: 'Busca y descubre',
                texto: 'Usa la búsqueda avanzada para encontrar exactamente lo que buscas. Filtra por categoría, creador, popularidad o fecha.'
            },
            {
                centrado: true,
                emoji: '❤️',
                titulo: 'Guarda tus favoritos',
                texto: 'Marca contenido como favorito para verlo después. Además, ayuda al creador: sus items con más favoritos suben en el ranking.'
            },
            {
                centrado: true,
                emoji: '🏆',
                titulo: 'Gana XP y badges',
                texto: 'Cada acción te da experiencia. Sube de nivel, desbloquea badges y compite en el ranking global.'
            },
            {
                centrado: true,
                emoji: '✨',
                titulo: '¡A explorar!',
                texto: 'Ya tienes todo lo que necesitas. Empieza explorando las categorías o el contenido trending.',
                final: true
            }
        ],
        creator: [
            {
                centrado: true,
                emoji: '📤',
                titulo: 'Sube tu primer contenido',
                texto: 'Desde tu perfil puedes subir juegos, mods, APKs. Cuanto más original y de calidad, más descargas atraerás.'
            },
            {
                centrado: true,
                emoji: '💰',
                titulo: 'Monetización CPM',
                texto: 'Ganas $1 USD por cada 1000 descargas efectivas. 100% va a tu bolsillo. Mínimo de retiro: $10.'
            },
            {
                centrado: true,
                emoji: '📊',
                titulo: 'Analytics detallado',
                texto: 'Tu dashboard te muestra descargas, engagement, ganancias y qué contenido te funciona mejor.'
            },
            {
                centrado: true,
                emoji: '🎯',
                titulo: 'Tips para crecer',
                texto: '• Imágenes y descripciones claras\n• Títulos descriptivos\n• Responde comentarios\n• Comparte en redes con el botón integrado'
            },
            {
                centrado: true,
                emoji: '🚀',
                titulo: '¡Listo para empezar!',
                texto: 'Sube tu primer item y empieza a construir tu audiencia. Si necesitas ayuda, revisa la sección de FAQ.',
                final: true
            }
        ]
    };

    // ======================================================================
    // ESTADO
    // ======================================================================

    let estado = {
        activo: false,
        pasos: [],
        pasoActual: 0,
        onFinish: null
    };

    // ======================================================================
    // API PÚBLICO
    // ======================================================================

    function iniciar(opts = {}) {
        if (estado.activo) return;

        inyectarEstilos();

        let pasos = opts.pasos;
        if (!pasos) {
            // Autodetectar flujo
            const guardado = obtenerEstadoGuardado();
            if (guardado.completado && !opts.forzar) return;

            if (guardado.flujoSeleccionado) {
                pasos = FLUJOS[guardado.flujoSeleccionado] || FLUJOS.bienvenida;
            } else {
                pasos = FLUJOS.bienvenida;
            }
        }

        estado = {
            activo: true,
            pasos,
            pasoActual: 0,
            onFinish: opts.onFinish || null
        };

        renderizar();
    }

    function reset() {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    }

    function fueCompletado() {
        return obtenerEstadoGuardado().completado === true;
    }

    function cerrar(completo = false) {
        const existente = document.getElementById('upgames-onboarding');
        if (existente) {
            existente.classList.remove('show');
            setTimeout(() => existente.remove(), 250);
        }
        estado.activo = false;

        if (completo) {
            const actual = obtenerEstadoGuardado();
            guardarEstado({ ...actual, completado: true, ultimoCompletado: Date.now() });
        }

        if (typeof estado.onFinish === 'function') estado.onFinish(completo);
    }

    // ======================================================================
    // RENDER
    // ======================================================================

    function renderizar() {
        const paso = estado.pasos[estado.pasoActual];
        if (!paso) return cerrar(true);

        let existente = document.getElementById('upgames-onboarding');
        if (!existente) {
            existente = document.createElement('div');
            existente.id = 'upgames-onboarding';
            existente.innerHTML = `
                <div class="ugo-backdrop"></div>
                <div class="ugo-spotlight" id="ugo-spotlight"></div>
                <div class="ugo-card" id="ugo-card"></div>
            `;
            document.body.appendChild(existente);
            requestAnimationFrame(() => existente.classList.add('show'));
        }

        const spotlight = existente.querySelector('#ugo-spotlight');
        const card = existente.querySelector('#ugo-card');

        // Spotlight: resalta elemento real si hay selector
        if (paso.selector && !paso.centrado) {
            const target = document.querySelector(paso.selector);
            if (target) {
                const rect = target.getBoundingClientRect();
                const padding = 8;
                spotlight.style.display = 'block';
                spotlight.style.top = (rect.top - padding) + 'px';
                spotlight.style.left = (rect.left - padding) + 'px';
                spotlight.style.width = (rect.width + padding * 2) + 'px';
                spotlight.style.height = (rect.height + padding * 2) + 'px';
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                spotlight.style.display = 'none';
            }
        } else {
            spotlight.style.display = 'none';
        }

        const total = estado.pasos.length;
        const actual = estado.pasoActual + 1;
        const opciones = paso.opciones || [];
        const esUltimo = paso.final === true || actual === total;
        const esPrimero = estado.pasoActual === 0;

        card.innerHTML = `
            <div class="ugo-progress">
                ${Array.from({ length: total }).map((_, i) =>
                    `<span class="ugo-dot ${i < actual ? 'active' : ''}"></span>`
                ).join('')}
            </div>
            <button class="ugo-skip" id="ugo-skip">Saltar tour</button>
            ${paso.emoji ? `<div class="ugo-emoji">${paso.emoji}</div>` : ''}
            <h2 class="ugo-titulo">${escapeHTML(paso.titulo || '')}</h2>
            <p class="ugo-texto">${escapeHTML(paso.texto || '').replace(/\n/g, '<br>')}</p>
            ${opciones.length > 0 ? `
                <div class="ugo-opciones">
                    ${opciones.map(o => `
                        <button class="ugo-opcion" data-id="${o.id}" data-flujo="${o.flujo || ''}">
                            ${escapeHTML(o.label)}
                        </button>
                    `).join('')}
                </div>
            ` : `
                <div class="ugo-nav">
                    ${!esPrimero ? '<button class="ugo-btn-secondary" id="ugo-prev">← Anterior</button>' : '<div></div>'}
                    <button class="ugo-btn-primary" id="ugo-next">
                        ${esUltimo ? '¡Empezar!' : 'Siguiente →'}
                    </button>
                </div>
            `}
        `;

        // Bind
        card.querySelector('#ugo-skip').onclick = () => cerrar(false);
        card.querySelector('#ugo-next')?.addEventListener('click', () => {
            if (esUltimo) cerrar(true);
            else { estado.pasoActual++; renderizar(); }
        });
        card.querySelector('#ugo-prev')?.addEventListener('click', () => {
            if (estado.pasoActual > 0) { estado.pasoActual--; renderizar(); }
        });

        card.querySelectorAll('.ugo-opcion').forEach(b => {
            b.onclick = () => {
                const flujo = b.dataset.flujo;
                if (flujo && FLUJOS[flujo]) {
                    const guardado = obtenerEstadoGuardado();
                    guardarEstado({ ...guardado, flujoSeleccionado: flujo });
                    estado.pasos = FLUJOS[flujo];
                    estado.pasoActual = 0;
                    renderizar();
                } else {
                    estado.pasoActual++;
                    renderizar();
                }
            };
        });

        // Reposicionar card si hay spotlight
        if (paso.selector && !paso.centrado) {
            card.classList.add('positioned');
            card.style.top = '';
            card.style.left = '';
            card.style.bottom = '24px';
            card.style.right = '24px';
        } else {
            card.classList.remove('positioned');
            card.style.top = '';
            card.style.left = '';
            card.style.bottom = '';
            card.style.right = '';
        }
    }

    // ======================================================================
    // PERSISTENCIA
    // ======================================================================

    function obtenerEstadoGuardado() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    function guardarEstado(obj) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
        } catch (e) {}
    }

    // ======================================================================
    // HELPERS
    // ======================================================================

    function escapeHTML(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    }

    // ======================================================================
    // ESTILOS
    // ======================================================================

    function inyectarEstilos() {
        if (document.getElementById('upgames-onboarding-styles')) return;
        const st = document.createElement('style');
        st.id = 'upgames-onboarding-styles';
        st.textContent = `
            #upgames-onboarding {
                position: fixed; inset: 0; z-index: 99996;
                opacity: 0; pointer-events: none;
                transition: opacity 0.3s;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            #upgames-onboarding.show { opacity: 1; pointer-events: auto; }
            .ugo-backdrop {
                position: absolute; inset: 0;
                background: rgba(0,0,0,0.82); backdrop-filter: blur(6px);
            }
            .ugo-spotlight {
                position: absolute; display: none;
                border-radius: 14px;
                box-shadow: 0 0 0 9999px rgba(0,0,0,0.82),
                            0 0 0 3px rgba(139,92,246,0.9),
                            0 0 40px rgba(139,92,246,0.6);
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                pointer-events: none;
            }
            .ugo-card {
                position: absolute; top: 50%; left: 50%;
                transform: translate(-50%, -50%);
                background: linear-gradient(145deg, #1a1a2e 0%, #15152a 100%);
                border: 1px solid rgba(139,92,246,0.3);
                border-radius: 24px; padding: 32px 28px;
                width: 90%; max-width: 460px;
                color: #fff; text-align: center;
                box-shadow: 0 30px 80px rgba(0,0,0,0.6);
                animation: ugo-enter 0.4s ease-out;
            }
            .ugo-card.positioned {
                top: auto; left: auto;
                transform: none;
                max-width: 380px;
            }
            @keyframes ugo-enter {
                from { transform: translate(-50%, -50%) scale(0.9); opacity: 0; }
                to   { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            }
            .ugo-card.positioned { animation: ugo-enterSide 0.4s ease-out; }
            @keyframes ugo-enterSide {
                from { transform: translateY(20px); opacity: 0; }
                to   { transform: translateY(0); opacity: 1; }
            }

            .ugo-progress {
                display: flex; gap: 5px; justify-content: center;
                margin-bottom: 20px;
            }
            .ugo-dot {
                width: 8px; height: 8px; border-radius: 50%;
                background: rgba(255,255,255,0.15);
                transition: all 0.3s;
            }
            .ugo-dot.active {
                background: linear-gradient(135deg, #6366f1, #8b5cf6);
                width: 24px; border-radius: 999px;
            }

            .ugo-skip {
                position: absolute; top: 16px; right: 16px;
                background: transparent; border: none; color: #a0a0b8;
                font-size: 12px; cursor: pointer; padding: 6px 10px;
                border-radius: 8px; transition: all 0.15s;
            }
            .ugo-skip:hover { background: rgba(255,255,255,0.05); color: #fff; }

            .ugo-emoji { font-size: 56px; margin-bottom: 12px; animation: ugo-bounce 1s ease-out; }
            @keyframes ugo-bounce {
                0%   { transform: scale(0); }
                50%  { transform: scale(1.2); }
                100% { transform: scale(1); }
            }
            .ugo-titulo {
                font-size: 22px; font-weight: 800; margin: 0 0 12px;
                background: linear-gradient(135deg, #fff 0%, #c4b5fd 100%);
                -webkit-background-clip: text; background-clip: text;
                -webkit-text-fill-color: transparent;
                letter-spacing: -0.02em;
            }
            .ugo-texto {
                margin: 0 0 24px; color: #a0a0b8;
                font-size: 15px; line-height: 1.55;
            }

            .ugo-opciones {
                display: flex; flex-direction: column; gap: 10px;
                margin-top: 8px;
            }
            .ugo-opcion {
                background: rgba(255,255,255,0.04);
                border: 1.5px solid rgba(139,92,246,0.25);
                color: #fff; padding: 14px 20px; border-radius: 12px;
                font-size: 14px; font-weight: 600; cursor: pointer;
                transition: all 0.15s; text-align: center;
            }
            .ugo-opcion:hover {
                background: rgba(139,92,246,0.18);
                border-color: #8b5cf6;
                transform: translateY(-1px);
                box-shadow: 0 8px 20px rgba(139,92,246,0.25);
            }

            .ugo-nav {
                display: flex; justify-content: space-between;
                align-items: center; gap: 10px;
            }
            .ugo-btn-primary {
                background: linear-gradient(135deg, #6366f1, #8b5cf6);
                color: #fff; border: none;
                padding: 12px 28px; border-radius: 12px;
                font-weight: 700; font-size: 14px; cursor: pointer;
                box-shadow: 0 8px 24px rgba(99,102,241,0.3);
                transition: transform 0.15s, box-shadow 0.15s;
            }
            .ugo-btn-primary:hover {
                transform: translateY(-1px);
                box-shadow: 0 12px 30px rgba(99,102,241,0.4);
            }
            .ugo-btn-secondary {
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                color: #a0a0b8; padding: 10px 20px;
                border-radius: 10px; font-size: 13px; cursor: pointer;
            }

            @media (max-width: 480px) {
                .ugo-card { padding: 24px 20px; }
                .ugo-titulo { font-size: 19px; }
                .ugo-texto { font-size: 14px; }
                .ugo-emoji { font-size: 44px; }
                .ugo-card.positioned {
                    max-width: 92%;
                    bottom: 16px !important;
                    right: 16px !important;
                    left: 16px;
                }
            }
        `;
        document.head.appendChild(st);
    }

    global.UpGamesOnboarding = { iniciar, reset, cerrar, fueCompletado, FLUJOS };
})(typeof window !== 'undefined' ? window : this);
