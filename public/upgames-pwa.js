// ========================================
// 📲 PWA REGISTRATION - UPGAMES
// ========================================
//
// Script para:
//   - Registrar el service worker
//   - Detectar actualizaciones y prompt para refresh
//   - Mostrar prompt de instalación personalizado
//   - Manejar estado online/offline
//
// Incluir en <head> de todas las páginas:
//   <link rel="manifest" href="./manifest.json">
//   <script src="./upgames-pwa.js" defer></script>
// ========================================

(function() {
    'use strict';

    const SW_URL = './service-worker.js';
    let deferredInstallPrompt = null;
    let swRegistration = null;

    // ======================================================================
    // REGISTRO DEL SERVICE WORKER
    // ======================================================================

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', async () => {
            try {
                swRegistration = await navigator.serviceWorker.register(SW_URL, { scope: './' });
                console.log('[PWA] Service Worker registrado:', swRegistration.scope);

                // Detectar updates
                swRegistration.addEventListener('updatefound', () => {
                    const nuevoSW = swRegistration.installing;
                    if (!nuevoSW) return;

                    nuevoSW.addEventListener('statechange', () => {
                        if (nuevoSW.state === 'installed' && navigator.serviceWorker.controller) {
                            // Hay una nueva versión esperando
                            mostrarPromptActualizar(nuevoSW);
                        }
                    });
                });

                // Detectar si otro SW tomó control
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    window.location.reload();
                });

            } catch (err) {
                console.warn('[PWA] Error registrando SW:', err);
            }
        });
    }

    // ======================================================================
    // INSTALL PROMPT PERSONALIZADO
    // ======================================================================

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;

        // Mostrar botón de instalar (si no se ha mostrado antes)
        const yaRechazado = localStorage.getItem('upgames_install_rejected');
        if (!yaRechazado) {
            setTimeout(mostrarPromptInstalar, 30000); // Después de 30s de uso
        }
    });

    window.addEventListener('appinstalled', () => {
        console.log('[PWA] UpGames instalado como app');
        deferredInstallPrompt = null;
        // Ocultar botón si estaba visible
        const btn = document.getElementById('upgames-install-btn');
        if (btn) btn.remove();
    });

    function mostrarPromptInstalar() {
        if (!deferredInstallPrompt) return;
        if (document.getElementById('upgames-install-prompt')) return;

        const prompt = document.createElement('div');
        prompt.id = 'upgames-install-prompt';
        prompt.innerHTML = `
            <div class="ug-install-backdrop"></div>
            <div class="ug-install-card">
                <div class="ug-install-icon">📲</div>
                <h3>Instalar UpGames</h3>
                <p>Accede más rápido, recibe notificaciones y úsalo sin conexión.</p>
                <div class="ug-install-actions">
                    <button class="ug-install-btn-primary" id="ug-install-yes">Instalar</button>
                    <button class="ug-install-btn-secondary" id="ug-install-no">Ahora no</button>
                </div>
            </div>
        `;

        // Estilos inline para no depender del CSS global
        const style = document.createElement('style');
        style.textContent = `
            #upgames-install-prompt {
                position: fixed; inset: 0; z-index: 99999;
                display: flex; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                animation: ug-fadein 0.3s;
            }
            @keyframes ug-fadein { from { opacity: 0; } to { opacity: 1; } }
            .ug-install-backdrop {
                position: absolute; inset: 0;
                background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
            }
            .ug-install-card {
                position: relative; background: #15152a;
                border: 1px solid rgba(139, 92, 246, 0.3);
                border-radius: 20px; padding: 32px 28px; max-width: 360px; width: 90%;
                text-align: center; color: #fff;
                box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                animation: ug-slideup 0.3s ease-out;
            }
            @keyframes ug-slideup {
                from { transform: translateY(30px); opacity: 0; }
                to   { transform: translateY(0); opacity: 1; }
            }
            .ug-install-icon { font-size: 56px; margin-bottom: 16px; }
            .ug-install-card h3 { margin: 0 0 8px; font-size: 20px; font-weight: 700; }
            .ug-install-card p { margin: 0 0 24px; color: #a0a0b8; font-size: 14px; line-height: 1.5; }
            .ug-install-actions { display: flex; gap: 10px; justify-content: center; }
            .ug-install-btn-primary, .ug-install-btn-secondary {
                padding: 12px 20px; border: none; border-radius: 10px;
                font-weight: 600; font-size: 14px; cursor: pointer;
                transition: transform 0.15s, box-shadow 0.15s;
            }
            .ug-install-btn-primary {
                background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
                box-shadow: 0 8px 24px rgba(99,102,241,0.3);
            }
            .ug-install-btn-primary:hover { transform: translateY(-1px); }
            .ug-install-btn-secondary {
                background: rgba(255,255,255,0.05); color: #a0a0b8;
                border: 1px solid rgba(255,255,255,0.1);
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(prompt);

        document.getElementById('ug-install-yes').onclick = async () => {
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                const { outcome } = await deferredInstallPrompt.userChoice;
                console.log('[PWA] Usuario eligió:', outcome);
                deferredInstallPrompt = null;
            }
            prompt.remove();
        };

        document.getElementById('ug-install-no').onclick = () => {
            localStorage.setItem('upgames_install_rejected', Date.now());
            prompt.remove();
        };
    }

    // ======================================================================
    // PROMPT DE ACTUALIZACIÓN
    // ======================================================================

    function mostrarPromptActualizar(nuevoSW) {
        if (document.getElementById('upgames-update-prompt')) return;

        const prompt = document.createElement('div');
        prompt.id = 'upgames-update-prompt';
        prompt.innerHTML = `
            <div class="ug-update-bar">
                <span>🎉 Hay una nueva versión de UpGames disponible</span>
                <div class="ug-update-btns">
                    <button class="ug-update-yes">Actualizar</button>
                    <button class="ug-update-no">Después</button>
                </div>
            </div>
        `;

        const style = document.createElement('style');
        style.textContent = `
            #upgames-update-prompt {
                position: fixed; bottom: 20px; left: 20px; right: 20px;
                z-index: 99998; pointer-events: none;
            }
            .ug-update-bar {
                max-width: 520px; margin: 0 auto;
                background: linear-gradient(135deg, #6366f1, #8b5cf6);
                color: #fff; padding: 14px 20px; border-radius: 14px;
                display: flex; align-items: center; gap: 14px;
                justify-content: space-between; flex-wrap: wrap;
                box-shadow: 0 15px 40px rgba(99,102,241,0.4);
                pointer-events: auto;
                font-family: -apple-system, sans-serif;
                animation: ug-slideupbottom 0.4s ease-out;
            }
            @keyframes ug-slideupbottom {
                from { transform: translateY(100px); opacity: 0; }
                to   { transform: translateY(0); opacity: 1; }
            }
            .ug-update-bar span { font-size: 14px; font-weight: 500; }
            .ug-update-btns { display: flex; gap: 8px; }
            .ug-update-yes, .ug-update-no {
                padding: 8px 16px; border-radius: 8px; border: none;
                font-weight: 600; font-size: 13px; cursor: pointer;
            }
            .ug-update-yes { background: #fff; color: #6366f1; }
            .ug-update-no  { background: rgba(255,255,255,0.15); color: #fff; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(prompt);

        prompt.querySelector('.ug-update-yes').onclick = () => {
            nuevoSW.postMessage({ type: 'SKIP_WAITING' });
            prompt.remove();
        };
        prompt.querySelector('.ug-update-no').onclick = () => prompt.remove();
    }

    // ======================================================================
    // ESTADO ONLINE/OFFLINE
    // ======================================================================

    function mostrarEstadoConexion(online) {
        // Solo mostrar cuando cambia, no al cargar
        const existente = document.getElementById('upgames-connection-status');
        if (existente) existente.remove();

        const banner = document.createElement('div');
        banner.id = 'upgames-connection-status';
        banner.className = online ? 'online' : 'offline';
        banner.textContent = online ? '✓ Conectado de nuevo' : '⚠ Sin conexión';
        banner.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            padding: 10px 20px; border-radius: 999px;
            font-size: 13px; font-weight: 600; z-index: 99997;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            animation: ug-slidedown 0.3s ease-out;
            font-family: -apple-system, sans-serif;
        `;
        banner.style.background = online ? '#22c55e' : '#ef4444';
        banner.style.color = '#fff';

        if (!document.getElementById('ug-connection-styles')) {
            const st = document.createElement('style');
            st.id = 'ug-connection-styles';
            st.textContent = `
                @keyframes ug-slidedown {
                    from { transform: translate(-50%, -30px); opacity: 0; }
                    to   { transform: translate(-50%, 0); opacity: 1; }
                }
            `;
            document.head.appendChild(st);
        }

        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), online ? 3000 : 6000);
    }

    let yaEstabaOnline = navigator.onLine;
    window.addEventListener('online', () => {
        if (!yaEstabaOnline) mostrarEstadoConexion(true);
        yaEstabaOnline = true;
    });
    window.addEventListener('offline', () => {
        if (yaEstabaOnline) mostrarEstadoConexion(false);
        yaEstabaOnline = false;
    });

    // ======================================================================
    // API PÚBLICA
    // ======================================================================

    window.UpGamesPWA = {
        instalar: mostrarPromptInstalar,
        clearCache: async () => {
            if (!swRegistration || !swRegistration.active) return false;
            return new Promise((resolve) => {
                const channel = new MessageChannel();
                channel.port1.onmessage = (e) => resolve(e.data?.ok === true);
                swRegistration.active.postMessage({ type: 'CLEAR_CACHE' }, [channel.port2]);
            });
        },
        getVersion: async () => {
            if (!swRegistration || !swRegistration.active) return null;
            return new Promise((resolve) => {
                const channel = new MessageChannel();
                channel.port1.onmessage = (e) => resolve(e.data?.version);
                swRegistration.active.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
            });
        },
        isInstalled: () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
    };

    console.log('[PWA] UpGamesPWA listo. Use UpGamesPWA.instalar() / .clearCache() / .getVersion()');
})();
