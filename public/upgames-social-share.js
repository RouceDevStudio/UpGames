// ========================================
// 📤 UPGAMES — COMPARTIR EN REDES SOCIALES
// ========================================
//
// Soporta:
//   - Twitter / X
//   - TikTok (copia + instrucciones)
//   - WhatsApp
//   - Discord (copia)
//   - Reddit
//   - Telegram
//   - Facebook
//   - Copiar link
//   - Web Share API nativa (mobile)
//
// Uso:
//   UpGamesShare.agregarBoton({
//       contenedor: '#share-buttons',
//       url:    'https://roucedevstudio.github.io/UpGames/?item=abc123',
//       titulo: 'GTA San Andreas Mobile',
//       texto:  'Descárgalo gratis en UpGames'
//   });
//
//   // O abrir directamente el modal:
//   UpGamesShare.abrir({ url, titulo, texto });
// ========================================

(function (global) {
    'use strict';

    function inyectarEstilos() {
        if (document.getElementById('upgames-share-styles')) return;
        const st = document.createElement('style');
        st.id = 'upgames-share-styles';
        st.textContent = `
            .ugsh-btn {
                display: inline-flex; align-items: center; gap: 6px;
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                color: #fff; padding: 8px 14px; border-radius: 10px;
                cursor: pointer; font-size: 13px; font-weight: 600;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                transition: all 0.15s;
            }
            .ugsh-btn:hover {
                background: rgba(139,92,246,0.15);
                border-color: #8b5cf6; transform: translateY(-1px);
            }
            .ugsh-modal {
                position: fixed; inset: 0; z-index: 99997;
                display: flex; align-items: center; justify-content: center;
                opacity: 0; pointer-events: none; transition: opacity 0.2s;
                font-family: -apple-system, sans-serif;
            }
            .ugsh-modal.show { opacity: 1; pointer-events: auto; }
            .ugsh-backdrop {
                position: absolute; inset: 0;
                background: rgba(0,0,0,0.7); backdrop-filter: blur(10px);
            }
            .ugsh-card {
                position: relative; background: #15152a;
                border: 1px solid rgba(139,92,246,0.3);
                border-radius: 20px; padding: 24px 20px;
                width: 90%; max-width: 440px;
                transform: scale(0.95); transition: transform 0.2s;
                box-shadow: 0 30px 60px rgba(0,0,0,0.5);
            }
            .ugsh-modal.show .ugsh-card { transform: scale(1); }
            .ugsh-header {
                display: flex; align-items: center; justify-content: space-between;
                margin-bottom: 16px;
            }
            .ugsh-header h3 { margin: 0; font-size: 17px; color: #fff; font-weight: 700; }
            .ugsh-close {
                background: rgba(255,255,255,0.05); border: none; color: #fff;
                width: 32px; height: 32px; border-radius: 8px; cursor: pointer;
            }
            .ugsh-preview {
                background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
                border-radius: 12px; padding: 12px; margin-bottom: 16px;
                font-size: 13px; color: #a0a0b8; line-height: 1.5;
            }
            .ugsh-preview strong { color: #fff; display: block; margin-bottom: 4px; }
            .ugsh-grid {
                display: grid; grid-template-columns: repeat(4, 1fr);
                gap: 10px; margin-bottom: 16px;
            }
            .ugsh-item {
                display: flex; flex-direction: column; align-items: center;
                gap: 6px; padding: 12px 6px; border-radius: 12px;
                background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
                cursor: pointer; transition: all 0.15s; color: #fff;
                text-decoration: none;
            }
            .ugsh-item:hover { background: rgba(139,92,246,0.12); border-color: #8b5cf6; transform: translateY(-2px); }
            .ugsh-item-icon { font-size: 24px; }
            .ugsh-item-label { font-size: 11px; color: #a0a0b8; font-weight: 600; }
            .ugsh-copy-box {
                display: flex; gap: 8px; margin-top: 4px;
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 10px; padding: 4px;
            }
            .ugsh-copy-box input {
                flex: 1; background: transparent; border: none; outline: none;
                color: #fff; padding: 8px 10px; font-size: 12px; font-family: monospace;
            }
            .ugsh-copy-btn {
                background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
                border: none; padding: 8px 16px; border-radius: 8px;
                font-weight: 600; font-size: 12px; cursor: pointer;
            }
            .ugsh-copy-btn.ok { background: #22c55e; }
            .ugsh-native {
                width: 100%; margin-top: 12px;
                background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
                border: none; padding: 12px; border-radius: 12px;
                font-weight: 700; font-size: 14px; cursor: pointer;
            }
            @media (max-width: 480px) { .ugsh-grid { grid-template-columns: repeat(4, 1fr); } }
        `;
        document.head.appendChild(st);
    }

    function construirUrls({ url, titulo, texto }) {
        const encodedUrl   = encodeURIComponent(url);
        const encodedTitle = encodeURIComponent(titulo || '');
        const encodedText  = encodeURIComponent(`${texto || ''}${texto ? ' — ' : ''}${url}`);
        const encodedAll   = encodeURIComponent(`${titulo || ''} — ${texto || ''}`);

        return {
            twitter:   `https://twitter.com/intent/tweet?text=${encodedAll}&url=${encodedUrl}`,
            reddit:    `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`,
            telegram:  `https://t.me/share/url?url=${encodedUrl}&text=${encodedAll}`,
            whatsapp:  `https://wa.me/?text=${encodedText}`,
            facebook:  `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
            linkedin:  `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
            email:     `mailto:?subject=${encodedTitle}&body=${encodedText}`,
        };
    }

    async function abrir({ url, titulo = '', texto = '' }) {
        inyectarEstilos();
        cerrar();

        const urls = construirUrls({ url, titulo, texto });
        const canShareNative = typeof navigator.share === 'function';

        const modal = document.createElement('div');
        modal.id = 'ugsh-modal';
        modal.className = 'ugsh-modal';
        modal.innerHTML = `
            <div class="ugsh-backdrop"></div>
            <div class="ugsh-card">
                <div class="ugsh-header">
                    <h3>📤 Compartir</h3>
                    <button class="ugsh-close" aria-label="Cerrar">✕</button>
                </div>
                <div class="ugsh-preview">
                    ${titulo ? `<strong>${escapeHTML(titulo)}</strong>` : ''}
                    ${texto  ? escapeHTML(texto)                      : ''}
                </div>

                <div class="ugsh-grid">
                    <a class="ugsh-item" data-net="twitter"  href="${urls.twitter}"  target="_blank" rel="noopener">
                        <span class="ugsh-item-icon">𝕏</span><span class="ugsh-item-label">Twitter</span>
                    </a>
                    <a class="ugsh-item" data-net="reddit"   href="${urls.reddit}"   target="_blank" rel="noopener">
                        <span class="ugsh-item-icon">🤖</span><span class="ugsh-item-label">Reddit</span>
                    </a>
                    <a class="ugsh-item" data-net="whatsapp" href="${urls.whatsapp}" target="_blank" rel="noopener">
                        <span class="ugsh-item-icon">💬</span><span class="ugsh-item-label">WhatsApp</span>
                    </a>
                    <a class="ugsh-item" data-net="telegram" href="${urls.telegram}" target="_blank" rel="noopener">
                        <span class="ugsh-item-icon">✈️</span><span class="ugsh-item-label">Telegram</span>
                    </a>
                    <a class="ugsh-item" data-net="facebook" href="${urls.facebook}" target="_blank" rel="noopener">
                        <span class="ugsh-item-icon">📘</span><span class="ugsh-item-label">Facebook</span>
                    </a>
                    <div class="ugsh-item" data-net="tiktok">
                        <span class="ugsh-item-icon">🎵</span><span class="ugsh-item-label">TikTok</span>
                    </div>
                    <div class="ugsh-item" data-net="discord">
                        <span class="ugsh-item-icon">🎮</span><span class="ugsh-item-label">Discord</span>
                    </div>
                    <a class="ugsh-item" data-net="email" href="${urls.email}">
                        <span class="ugsh-item-icon">✉️</span><span class="ugsh-item-label">Email</span>
                    </a>
                </div>

                <div class="ugsh-copy-box">
                    <input type="text" value="${escapeAttr(url)}" readonly id="ugsh-url">
                    <button class="ugsh-copy-btn" id="ugsh-copy">Copiar</button>
                </div>

                ${canShareNative ? `<button class="ugsh-native" id="ugsh-native">📲 Compartir con apps del sistema</button>` : ''}
            </div>
        `;
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('show'));

        // Cerrar
        modal.querySelector('.ugsh-close').onclick = cerrar;
        modal.querySelector('.ugsh-backdrop').onclick = cerrar;

        // Copiar
        const input = modal.querySelector('#ugsh-url');
        const copyBtn = modal.querySelector('#ugsh-copy');
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(url);
            } catch (e) {
                input.select(); input.setSelectionRange(0, 99999);
                try { document.execCommand('copy'); } catch (_) {}
            }
            copyBtn.textContent = '✓ Copiado';
            copyBtn.classList.add('ok');
            setTimeout(() => {
                copyBtn.textContent = 'Copiar';
                copyBtn.classList.remove('ok');
            }, 2000);
        };

        // TikTok/Discord: copian + muestran instrucción
        modal.querySelector('[data-net="tiktok"]')?.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(url); } catch (_) {}
            alert('✓ Link copiado\n\nAbre TikTok, crea un video y pega el enlace en la descripción o comentarios.');
        });
        modal.querySelector('[data-net="discord"]')?.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(`${titulo}\n${texto}\n${url}`); } catch (_) {}
            alert('✓ Mensaje copiado\n\nPégalo en tu canal de Discord con Ctrl+V / ⌘+V.');
        });

        // Native share
        const nativeBtn = modal.querySelector('#ugsh-native');
        if (nativeBtn) {
            nativeBtn.onclick = async () => {
                try {
                    await navigator.share({ title: titulo, text: texto, url });
                    cerrar();
                } catch (e) { /* cancelado */ }
            };
        }

        // Registrar analytics de share (si hay endpoint futuro)
        modal.querySelectorAll('.ugsh-item').forEach(el => {
            el.addEventListener('click', () => {
                const net = el.dataset.net;
                try {
                    window.dispatchEvent(new CustomEvent('upgames:share', { detail: { red: net, url, titulo } }));
                } catch (e) {}
            });
        });
    }

    function cerrar() {
        const ex = document.getElementById('ugsh-modal');
        if (ex) {
            ex.classList.remove('show');
            setTimeout(() => ex.remove(), 200);
        }
    }

    /**
     * Agrega un botón de compartir a un contenedor existente.
     */
    function agregarBoton({ contenedor, url, titulo = '', texto = '', label = '📤 Compartir' }) {
        const el = typeof contenedor === 'string' ? document.querySelector(contenedor) : contenedor;
        if (!el) return null;

        inyectarEstilos();
        const btn = document.createElement('button');
        btn.className = 'ugsh-btn';
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', () => abrir({ url, titulo, texto }));
        el.appendChild(btn);
        return btn;
    }

    /**
     * Genera un objeto con todos los links (sin UI), por si el dev quiere
     * integrarlo en sus propios botones.
     */
    function generarLinks({ url, titulo = '', texto = '' }) {
        return construirUrls({ url, titulo, texto });
    }

    function escapeHTML(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    }
    function escapeAttr(s) { return escapeHTML(s).replace(/"/g, '&quot;'); }

    global.UpGamesShare = { abrir, cerrar, agregarBoton, generarLinks };
})(typeof window !== 'undefined' ? window : this);
