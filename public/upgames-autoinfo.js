/* ═══════════════════════════════════════════════════════════════
   UpGames · Auto-Info — reconocimiento de títulos al publicar
   ───────────────────────────────────────────────────────────────
   Mientras el usuario escribe el título (ej. "gta v"), se busca el
   juego / app / herramienta y se muestra una tarjeta con imagen y
   descripción breve. Si la portada o la descripción están vacías,
   se rellenan automáticamente (el usuario puede quitarlas).

   Fuente principal: backend  GET /items/autoinfo  (Steam · App Store · Wikipedia)
   Respaldo:         Wikipedia directo desde el navegador (CORS abierto)
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const API = (typeof PF_API !== 'undefined' && PF_API) || 'https://upgames-production.up.railway.app';
  const DEBOUNCE_MS = 650;

  const RUIDO = ['mod','mods','modpack','apk','ipa','pc','android','ios','windows','mac','linux','full',
    'espanol','spanish','latino','optimizado','optimizada','optimizacion','portable','repack','gratis','free',
    'descargar','download','mega','mediafire','drive','version','update','actualizado','pack','texturas',
    'graficos','realista','fps','boost','lite','pro','premium','rom','roms','iso','nsp','xci','nes','snes',
    'n64','gba','gbc','nds','3ds','psp','ps1','ps2','psx','wii','gamecube','dreamcast','sega','emulador',
    'emulator','herramienta','tool','tools','app','juego','game'];

  const PISTA = { Juego:'videojuego', Mod:'videojuego', Optimizacion:'videojuego', ROM:'videojuego',
    Apps:'aplicación', Software:'software', Ajustes:'software' };

  const cache = new Map();
  let timer = null;
  let ctrl = null;
  let ultimo = null; // última info mostrada

  const $ = id => document.getElementById(id);
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const categoria = () => ($('pf-addCategory') && $('pf-addCategory').value) || 'Juego';

  function limpiar(t) {
    let s = ' ' + norm(t)
      .replace(/[\[(][^\])]*[\])]/g, ' ')
      .replace(/\bv?\d+(\.\d+){1,3}\b/g, ' ')
      .replace(/[_|+\-–—:]+/g, ' ') + ' ';
    RUIDO.forEach(w => { s = s.split(' ' + w + ' ').join(' '); });
    return s.replace(/\s+/g, ' ').trim();
  }

  function similitud(a, b) {
    const A = new Set(norm(a).split(/\W+/).filter(Boolean));
    const B = new Set(norm(b).split(/\W+/).filter(Boolean));
    if (!A.size || !B.size) return 0;
    let c = 0; A.forEach(w => { if (B.has(w)) c++; });
    return (2 * c) / (A.size + B.size);
  }

  function resumir(t, max = 260) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const corte = t.slice(0, max), p = corte.lastIndexOf('. ');
    return p > max * 0.5 ? corte.slice(0, p + 1) : corte.replace(/\s+\S*$/, '') + '…';
  }

  async function getJSON(url, signal, ms = 5000) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    const onAbort = () => c.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      const r = await fetch(url, { signal: c.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  /* ── Respaldo: Wikipedia desde el navegador ── */
  async function wikipedia(q, cat, signal) {
    const pista = PISTA[cat] || '';
    const url = 'https://es.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1'
      + '&generator=search&gsrlimit=5&gsrsearch=' + encodeURIComponent((q + ' ' + pista).trim())
      + '&prop=pageimages%7Cextracts%7Clanglinks&exintro=1&explaintext=1&exsentences=3&exlimit=max'
      + '&piprop=thumbnail&pithumbsize=640&lllang=en&lllimit=max';
    const r = await getJSON(url, signal);
    const pages = Object.values((r && r.query && r.query.pages) || {});
    const pn = norm(pista);
    pages.forEach(p => {
      p._s = similitud(q, p.title) * 3 + (pn && norm(p.extract).includes(pn) ? 2 : 0) - (p.index || 0) * 0.2;
    });
    pages.sort((a, b) => b._s - a._s);
    const p = pages[0];
    if (!p || p._s < 1) return null;
    let image = (p.thumbnail && p.thumbnail.source) || '';
    const en = p.langlinks && p.langlinks[0] && p.langlinks[0]['*'];
    if (!image && en) {
      try {
        const s = await getJSON('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(en.replace(/ /g, '_')), signal);
        image = (s.originalimage && s.originalimage.source) || (s.thumbnail && s.thumbnail.source) || '';
      } catch (_) {}
    }
    return {
      name: p.title, description: resumir(p.extract), image,
      source: 'Wikipedia', sourceUrl: 'https://es.wikipedia.org/wiki/' + encodeURIComponent(p.title.replace(/ /g, '_')),
      detectedGame: null
    };
  }

  async function buscar(titulo, cat, signal) {
    const key = cat + '|' + norm(titulo);
    if (cache.has(key)) return cache.get(key);
    let info = null;
    try {
      const r = await getJSON(`${API}/items/autoinfo?title=${encodeURIComponent(titulo)}&cat=${encodeURIComponent(cat)}`, signal, 6000);
      info = r && r.found ? r : null;
      if (!r || r.found === undefined) throw new Error('sin endpoint');
    } catch (e) {
      if (signal.aborted) throw e;
      // Backend sin /items/autoinfo (o caído) → Wikipedia directo
      const q = limpiar(titulo);
      if (q.length >= 2) info = await wikipedia(q, cat, signal).catch(() => null);
      // Hint de compra con el detector existente
      if (info) {
        try {
          const d = await fetch(`${API}/items/detect-game`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: titulo }), signal
          }).then(x => x.json());
          if (d && d.detected) info.detectedGame = { gameName: d.gameName, purchaseLink: d.purchaseLink, platform: d.platform };
        } catch (_) {}
      }
    }
    cache.set(key, info);
    return info;
  }

  /* ── Autorrelleno: solo toca campos vacíos o que rellenamos nosotros ── */
  function puedeEscribir(el) {
    return el && (!el.value.trim() || el.dataset.ugAuto === el.value);
  }
  function escribir(el, valor) {
    el.value = valor;
    el.dataset.ugAuto = valor;
    el.classList.add('ug-autofilled');
    setTimeout(() => el.classList.remove('ug-autofilled'), 900);
  }
  function refrescarPreview() {
    if (typeof pfUpdatePreview === 'function') pfUpdatePreview();
    if (typeof pfPreviewSlot === 'function') pfPreviewSlot(0);
  }

  function aplicar(info) {
    const img = $('pf-addImage'), desc = $('pf-addDescription');
    const hechos = [];
    if (info.image && puedeEscribir(img)) { escribir(img, info.image); hechos.push('portada'); }
    if (info.description && puedeEscribir(desc)) { escribir(desc, info.description); hechos.push('descripción'); }
    refrescarPreview();
    return hechos;
  }

  function quitar() {
    ['pf-addImage', 'pf-addDescription'].forEach(id => {
      const el = $(id);
      if (el && el.dataset.ugAuto && el.dataset.ugAuto === el.value) el.value = '';
      if (el) delete el.dataset.ugAuto;
    });
    refrescarPreview();
  }

  /* ── UI ── */
  function contenedor() {
    let box = $('ug-autoinfo');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ug-autoinfo';
      box.className = 'ug-autoinfo';
      box.setAttribute('aria-live', 'polite');
      const ancla = $('pf-game-detection-hint') || $('pf-addTitle');
      ancla.insertAdjacentElement('afterend', box);
    }
    return box;
  }

  function ocultar() {
    const box = $('ug-autoinfo');
    if (box) box.classList.remove('show', 'loading');
    const hint = $('pf-game-detection-hint');
    if (hint) hint.style.display = 'none';
    ultimo = null;
  }

  function cargando() {
    const box = contenedor();
    box.innerHTML = `<div class="ug-ai-skel"><div class="ug-ai-skel-img"></div><div class="ug-ai-skel-lines"><span></span><span></span><span></span></div></div>`;
    box.classList.add('show', 'loading');
  }

  function mostrar(info, hechos) {
    const box = contenedor();
    box.classList.remove('loading');
    const nota = hechos.length
      ? `Se añadió ${hechos.join(' y ')} automáticamente.`
      : 'Tus datos se mantienen. Puedes usar esta información.';
    box.innerHTML = `
      <div class="ug-ai-card">
        ${info.image ? `<div class="ug-ai-img"><img src="${esc(info.image)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>` : ''}
        <div class="ug-ai-body">
          <div class="ug-ai-top">
            <ion-icon name="sparkles"></ion-icon>
            <span class="ug-ai-name">${esc(info.name)}</span>
            <a class="ug-ai-src" href="${esc(info.sourceUrl || '#')}" target="_blank" rel="noopener">${esc(info.source)}</a>
          </div>
          ${info.description ? `<p class="ug-ai-desc">${esc(info.description)}</p>` : ''}
          <div class="ug-ai-foot">
            <span class="ug-ai-note">${nota}</span>
            <div class="ug-ai-actions">
              ${hechos.length
                ? `<button type="button" class="ug-ai-btn ghost" data-act="quitar">Quitar</button>`
                : `<button type="button" class="ug-ai-btn" data-act="usar">Usar</button>`}
            </div>
          </div>
        </div>
      </div>`;
    box.classList.add('show');
    box.querySelector('[data-act]')?.addEventListener('click', e => {
      if (e.currentTarget.dataset.act === 'quitar') { quitar(); mostrar(info, []); }
      else {
        // "Usar" reemplaza lo que haya en portada y descripción
        ['pf-addImage', 'pf-addDescription'].forEach(id => { const el = $(id); if (el) el.dataset.ugAuto = el.value; });
        mostrar(info, aplicar(info));
      }
    });

    const hint = $('pf-game-detection-hint');
    if (hint) {
      const dg = info.detectedGame;
      hint.style.display = dg ? 'block' : 'none';
      if (dg && $('pf-detected-game-name')) $('pf-detected-game-name').textContent = 'Detectado: ' + dg.gameName;
    }
  }

  async function detectar(valor) {
    const titulo = String(valor || '').trim();
    if (ctrl) ctrl.abort();
    if (titulo.length < 3 || categoria() === 'Video') { ocultar(); return; }
    ctrl = new AbortController();
    const signal = ctrl.signal;
    cargando();
    try {
      const info = await buscar(titulo, categoria(), signal);
      if (signal.aborted) return;
      if (!info) { ocultar(); return; }
      ultimo = info;
      mostrar(info, aplicar(info));
    } catch (_) {
      if (!signal.aborted) ocultar();
    }
  }

  /* API pública usada por el oninput del título */
  window.pfDetectGameRealtime = function (valor) {
    clearTimeout(timer);
    timer = setTimeout(() => detectar(valor), DEBOUNCE_MS);
  };

  /* El usuario edita un campo rellenado → pasa a ser suyo */
  document.addEventListener('input', e => {
    const el = e.target;
    if (el && (el.id === 'pf-addImage' || el.id === 'pf-addDescription') && el.dataset.ugAuto !== undefined && el.value !== el.dataset.ugAuto) {
      delete el.dataset.ugAuto;
    }
  }, true);

  /* Cambio de categoría → volver a buscar con la nueva pista */
  const origCat = window.pfOnCategoryChange;
  if (typeof origCat === 'function') {
    window.pfOnCategoryChange = function (cat, btn) {
      origCat.apply(this, arguments);
      const t = $('pf-addTitle');
      if (t && t.value.trim().length >= 3) window.pfDetectGameRealtime(t.value);
      else ocultar();
    };
  }

  /* Tras publicar el formulario se vacía → ocultar la tarjeta */
  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('#pf-subirBtn')) {
      setTimeout(() => { const t = $('pf-addTitle'); if (t && !t.value.trim()) ocultar(); }, 2500);
    }
  });
})();
