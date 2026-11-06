/* ═══════════════════════════════════════════════════════════════
   UpGames · Nexus en la barra de búsqueda + "¿Funciona en mi celular?"
   ───────────────────────────────────────────────────────────────
   1) Barra: si escribes una frase ("juegos de carreras que corran en
      3 GB de RAM") Nexus la convierte en filtros y busca en TODO el
      catálogo (POST /nexus/buscar). Enter o el botón ✦ lo fuerzan.
   2) Ficha de cada publicación: botón "¿Funciona en mi celular?" que
      manda lo que el navegador sabe del equipo (RAM, GPU, sistema) y
      muestra un semáforo con razones y ajustes (POST /nexus/compatibilidad).
   Depende de script.js (API_URL, todosLosItems, filteredItems, render, openDetail).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const API = (typeof API_URL !== 'undefined' && API_URL) || 'https://upgames-production.up.railway.app';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tok = () => { try { return localStorage.getItem('token'); } catch (_) { return null; } };
  const hdr = () => { const t = tok(); return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }; };

  // ══════════════ 1) BARRA DE BÚSQUEDA ══════════════
  const input = $('buscador'), main = $('main-view'), out = $('output');
  if (input && main && out) {
    input.placeholder = 'Busca o pregúntale a Nexus: "juegos de carreras para gama baja"…';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'nxb-btn'; btn.title = 'Buscar con Nexus'; btn.setAttribute('aria-label', 'Buscar con Nexus');
    btn.innerHTML = '<span>✦</span>';
    input.after(btn);
    const banner = document.createElement('div');
    banner.className = 'nxb-banner'; banner.hidden = true; banner.setAttribute('role', 'status');
    out.before(banner);

    let tm = null, ctl = null, activo = '';
    const esFrase = q => q.split(/\s+/).filter(Boolean).length >= 3;
    const quitar = () => { banner.hidden = true; banner.innerHTML = ''; activo = ''; window.UG_NEXUS_Q = ''; btn.classList.remove('on'); };

    async function buscar(q, forzado) {
      if (q.length < 3) return;
      if (ctl) ctl.abort();
      ctl = new AbortController();
      activo = q; btn.classList.add('on');
      banner.hidden = false;
      banner.innerHTML = `<span class="nxb-orb"></span><div class="nxb-t"><b>Nexus está entendiendo tu búsqueda…</b><small>${esc(q)}</small></div>`;
      try {
        const r = await fetch(`${API}/nexus/buscar`, { method: 'POST', headers: hdr(), body: JSON.stringify({ q }), signal: ctl.signal });
        const d = await r.json().catch(() => ({}));
        if (input.value.trim() !== q) return;   // siguió escribiendo
        if (!r.ok || !d.ok) { banner.innerHTML = `<span class="nxb-ic">✦</span><div class="nxb-t"><b>${esc(d.error || 'Nexus no pudo buscar ahora')}</b><small>Te muestro la búsqueda normal.</small></div>`; return; }
        const chips = (d.entendido || []).map(x => `<span class="nxb-chip">${esc(x)}</span>`).join('')
          + (d.filtros?.terminos || []).slice(0, 5).map(x => `<span class="nxb-chip nxb-chip-t">${esc(x)}</span>`).join('');
        if (!d.items.length) {
          banner.innerHTML = `<span class="nxb-ic">✦</span><div class="nxb-t"><b>Nexus no encontró nada con esos filtros</b><small>${chips || esc(q)}</small></div><button type="button" class="nxb-x" aria-label="Quitar filtros de Nexus">✕</button>`;
        } else {
          banner.innerHTML = `<span class="nxb-ic">✦</span><div class="nxb-t"><b>Nexus encontró ${d.total} resultado${d.total === 1 ? '' : 's'}</b><div class="nxb-chips">${chips}</div>${d.explicacion ? `<small>${esc(d.explicacion)}</small>` : ''}</div><button type="button" class="nxb-x" aria-label="Quitar filtros de Nexus">✕</button>`;
          // Las publicaciones que ya están en la portada se reutilizan (traen los mismos datos)
          const map = new Map((typeof todosLosItems !== 'undefined' ? todosLosItems : []).map(i => [i._id, i]));
          filteredItems = d.items.map(i => map.get(i._id) || i);
          window.UG_NEXUS_Q = q.toLowerCase();
          if (typeof render === 'function') render(filteredItems);
          if (forzado) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        banner.querySelector('.nxb-x')?.addEventListener('click', () => { quitar(); input.dispatchEvent(new Event('input', { bubbles: true })); });
      } catch (e) { if (e.name !== 'AbortError') quitar(); }
    }

    input.addEventListener('input', () => {
      clearTimeout(tm);
      const q = input.value.trim();
      if (!esFrase(q)) { if (ctl) ctl.abort(); quitar(); return; }
      tm = setTimeout(() => buscar(q), 950);
    });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const q = input.value.trim(); if (q.length < 3) return;
      e.preventDefault(); clearTimeout(tm); $('autocomplete-dropdown') && ($('autocomplete-dropdown').style.display = 'none');
      buscar(q, true); input.blur();
    });
    btn.addEventListener('click', () => {
      const q = input.value.trim();
      if (q.length < 3) { input.focus(); input.placeholder = 'Ej: "mods de terror para Android", "emuladores de PS2 ligeros"…'; return; }
      clearTimeout(tm); buscar(q, true);
    });
    // Al cambiar de categoría se limpia la búsqueda: también el filtro de Nexus
    document.querySelectorAll('#category-row .chip').forEach(c => c.addEventListener('click', quitar));
  }

  // ══════════════ 2) ¿FUNCIONA EN MI CELULAR? ══════════════
  async function infoDispositivo() {
    const ua = navigator.userAgent || '';
    const so = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) ? 'ios'
      : /cros/i.test(ua) ? 'chromeos' : /windows/i.test(ua) ? 'windows' : /mac os/i.test(ua) ? 'mac' : /linux/i.test(ua) ? 'linux' : 'otro';
    let gpu = '';
    try {
      const c = document.createElement('canvas'), gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (gl) { const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || ''); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
    } catch (_) {}
    let modelo = '', version = (ua.match(/Android\s([\d.]+)/i) || ua.match(/OS (\d+[_\d]*) like Mac/i) || [])[1] || '';
    try {
      const h = await navigator.userAgentData?.getHighEntropyValues?.(['model', 'platformVersion']);
      if (h) { modelo = h.model || ''; if (so === 'android' && h.platformVersion) version = h.platformVersion.split('.')[0]; }
    } catch (_) {}
    if (!modelo) modelo = (ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/i) || [])[1] || '';
    if (modelo === 'K') modelo = '';   // UA reducido de Chrome
    return { so, gpu: gpu.replace(/\s+/g, ' ').trim(), modelo, version: String(version).replace(/_/g, '.'), ramGB: navigator.deviceMemory || null, nucleos: navigator.hardwareConcurrency || null };
  }

  const COLOR = { si: 'ok', probable: 'ok2', dudoso: 'warn', no: 'bad', no_aplica: 'na' };
  const ICONO = { si: '🟢', probable: '🟢', dudoso: '🟡', no: '🔴', no_aplica: '⚪' };
  let itemActual = null;

  function pintar(box, r) {
    const d = r.dispositivo || {};
    const equipo = [d.modelo, d.so === 'android' ? `Android ${d.version || ''}`.trim() : d.so === 'ios' ? 'iPhone/iPad' : d.so, d.gpu, d.ramGB ? (d.ramGB >= 8 ? '8 GB+ RAM' : `≈ ${d.ramGB} GB RAM`) : ''].filter(Boolean).join(' · ');
    box.className = `nxc-res nxc-${COLOR[r.veredicto] || 'na'}`;
    box.innerHTML = `
      <div class="nxc-h"><span class="nxc-sem">${ICONO[r.veredicto] || '⚪'}</span><div><b>${esc(r.titulo)}</b>${r.puntuacion != null ? `<small>${r.puntuacion}/100 de compatibilidad estimada</small>` : ''}</div></div>
      ${r.puntuacion != null ? `<div class="nxc-bar"><i style="width:${Math.max(3, r.puntuacion)}%"></i></div>` : ''}
      ${r.resumen ? `<p class="nxc-p">${esc(r.resumen)}</p>` : ''}
      <ul class="nxc-l">${(r.razones || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      ${(r.ajustes || []).length ? `<div class="nxc-aj"><b>✦ Ajustes recomendados</b>${r.ajustes.map(x => `<div>⚙️ ${esc(x)}</div>`).join('')}</div>` : ''}
      <small class="nxc-eq">Tu equipo: ${esc(equipo || 'no identificado')}${r.fuente ? ' · ' + esc(r.fuente) : ''}<br>Estimación de Nexus: puede variar según el emulador y los ajustes.</small>`;
  }

  async function comprobar() {
    const box = $('nxc-res'), b = $('nxc-btn'); if (!box || !itemActual) return;
    const id = itemActual._id, key = 'nxc:' + id;
    try { const c = JSON.parse(sessionStorage.getItem(key) || 'null'); if (c) { box.hidden = false; pintar(box, c); return; } } catch (_) {}
    box.hidden = false; box.className = 'nxc-res';
    box.innerHTML = '<div class="nxc-load"><span class="nxb-orb"></span><span>Nexus está revisando tu equipo y lo que pide esta publicación…</span></div>';
    b.disabled = true;
    try {
      const dispositivo = await infoDispositivo();
      const r = await fetch(`${API}/nexus/compatibilidad`, { method: 'POST', headers: hdr(), body: JSON.stringify({ itemId: id, dispositivo }) });
      const d = await r.json().catch(() => ({}));
      if (!itemActual || itemActual._id !== id) return;
      if (!r.ok || !d.ok) { box.innerHTML = `<p class="nxc-p">⚠️ ${esc(d.error || 'No se pudo comprobar ahora')}</p>`; return; }
      try { sessionStorage.setItem(key, JSON.stringify(d)); } catch (_) {}
      pintar(box, d);
    } catch (_) { box.innerHTML = '<p class="nxc-p">⚠️ Error de conexión</p>'; }
    finally { b.disabled = false; }
  }

  const anchor = $('ds-btn-nexus');
  if (anchor) {
    const wrap = document.createElement('div');
    wrap.className = 'nxc';
    wrap.innerHTML = `<button type="button" class="nxc-btn" id="nxc-btn"><span class="nxc-ic">📱</span><span><b>¿Funciona en mi celular?</b><small>Nexus revisa tu equipo y lo que pide esta publicación</small></span><ion-icon name="chevron-forward"></ion-icon></button>
      <div class="nxc-res" id="nxc-res" hidden></div>`;
    anchor.before(wrap);
    $('nxc-btn').addEventListener('click', comprobar);
  }
  if (typeof window.openDetail === 'function') {
    const orig = window.openDetail;
    window.openDetail = function (item) {
      itemActual = item || null;
      const box = $('nxc-res'), w = document.querySelector('.nxc');
      if (box) { box.hidden = true; box.innerHTML = ''; }
      if (w) w.hidden = !item || item.category === 'Video';
      return orig.apply(this, arguments);
    };
  }
})();
