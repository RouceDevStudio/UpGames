/* ═══════════════════════════════════════════════════════════════
   UpGames · Temas visuales
   ───────────────────────────────────────────────────────────────
   Se carga en <head>, ANTES de pintar, para que no parpadee:
     • <html data-tema="cyber"> por defecto (localStorage 'ug_tema').
     • El tema cyber carga sus fuentes (Orbitron, Rajdhani, Share Tech
       Mono) y una capa de líneas de escaneo.
     • window.UGTema.set('cyber' | 'clasico') cambia de tema y avisa con el
       evento 'ug:tema' (para la música de fondo y los temas que se
       compren con UpCoins más adelante).
     • En la biblioteca añade "Tema" al menú rápido (orbe del encabezado).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const TEMAS = { cyber: 'Cyber (neón)', clasico: 'Clásico' };
  const leer = () => { try { const t = localStorage.getItem('ug_tema'); return TEMAS[t] ? t : 'cyber'; } catch (_) { return 'cyber'; } };
  const html = document.documentElement;

  function fuentes() {
    if (document.getElementById('cb-fuentes')) return;
    const l = document.createElement('link');
    l.id = 'cb-fuentes'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800;900&family=Rajdhani:wght@500;600;700&family=Share+Tech+Mono&display=swap';
    document.head.appendChild(l);
  }
  function escaneo(on) {
    let s = document.getElementById('cb-scan');
    if (on && !s && document.body) { s = document.createElement('div'); s.id = 'cb-scan'; s.className = 'cb-scan'; s.setAttribute('aria-hidden', 'true'); document.body.appendChild(s); }
    if (!on && s) s.remove();
  }
  function aplicar(t) {
    html.dataset.tema = t;
    if (t === 'cyber') fuentes();
    escaneo(t === 'cyber');
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'cyber' ? '#05030D' : '#0A0B0F');
  }
  function set(t) {
    if (!TEMAS[t]) return;
    try { localStorage.setItem('ug_tema', t); } catch (_) {}
    aplicar(t);
    window.dispatchEvent(new CustomEvent('ug:tema', { detail: t }));
  }

  aplicar(leer());
  document.addEventListener('DOMContentLoaded', () => {
    escaneo(html.dataset.tema === 'cyber');
    // Botón en el menú rápido de la biblioteca
    const radial = document.querySelector('#hdr-radial .ugr-items');
    if (radial && !document.getElementById('ug-tema-btn')) {
      const b = document.createElement('button');
      b.id = 'ug-tema-btn'; b.type = 'button'; b.className = 'ugr-item ug-tema-btn'; b.setAttribute('role', 'menuitem');
      const pintar = () => { const c = html.dataset.tema === 'cyber'; b.setAttribute('aria-label', c ? 'Cambiar al tema clásico' : 'Cambiar al tema cyber'); b.innerHTML = `<span class="ugr-bub"><ion-icon name="${c ? 'contrast-outline' : 'flash-outline'}"></ion-icon></span><span class="ugr-lbl">${c ? 'Clásico' : 'Cyber'}</span>`; };
      pintar();
      b.addEventListener('click', e => {
        e.stopPropagation(); window.UGR?.cerrar?.();
        set(html.dataset.tema === 'cyber' ? 'clasico' : 'cyber'); pintar();
        try { window.toast?.(html.dataset.tema === 'cyber' ? '⚡ Tema Cyber activado' : '🌙 Tema clásico activado'); } catch (_) {}
      });
      radial.appendChild(b);
    }
  });
  window.UGTema = { set, get: () => html.dataset.tema, TEMAS };
})();
