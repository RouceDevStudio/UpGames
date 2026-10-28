/* ═══════════════════════════════════════════════════════════════
   UpGames · Reseñas con estrellas y colecciones (UGR)
   Servidor: rutas/social.js. Usa la hoja y el api de upgames-extras.js (UGX).
     UGR.resenas(item)            sección de reseñas en el detalle (biblioteca)
     UGR.estrellasTile(item)      "★ 4,6" para las tarjetas del catálogo
     UGR.colecciones(usuario, el, { propio })   lista de colecciones de un creador
     UGR.abrir(id)                ver una colección (hoja)
     UGR.editar(id?)              crear / editar una colección propia
     UGR.agregar(itemId)          añadir una publicación propia a una colección
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const API = (window.UG_CONFIG && window.UG_CONFIG.API_URL) || 'https://upgames-production.up.railway.app';
  const tok = () => { try { return localStorage.getItem('token'); } catch (_) { return null; } };
  const yo = () => { try { return (localStorage.getItem('user_admin') || '').toLowerCase(); } catch (_) { return ''; } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Math.floor(Number(n) || 0).toLocaleString('es-CO');
  const dec = n => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const esId = s => /^[a-f\d]{24}$/i.test(String(s || ''));
  const aviso = (m, t) => (window.UGX?.aviso || window.showToast || alert)(m, t);
  async function api(path, opts = {}) {
    const r = await fetch(API + path, { method: opts.method || 'GET', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(tok() ? { Authorization: 'Bearer ' + tok() } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && d.success !== false, status: r.status, d };
  }
  const hoja = (t, h, f) => window.UGX?.hoja ? window.UGX.hoja(t, h, f) : null;
  const cerrar = () => window.UGX?.cerrarHoja?.();
  const cld = (u, t) => /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(u || '') && !/\/image\/upload\/(?!v\d+\/)[a-z]{1,3}_[^/]*\//.test(u) ? u.replace('/image/upload/', `/image/upload/${t}/`) : (u || '');
  const pedirSesion = q => window.ugPedirSesion ? window.ugPedirSesion(q) : aviso('Inicia sesión para ' + q, 'error');
  const fecha = d => { try { return new Date(d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return ''; } };
  const estrellasTxt = (n, max = 5) => '★'.repeat(Math.round(n)) + '☆'.repeat(max - Math.round(n));

  // ══ Reseñas ═══════════════════════════════════════════════════════════
  function estrellasTile(item) {
    const r = item?.resenas; if (!r || !r.n) return '';
    return `<span class="ugrs-tile-star" title="${fmt(r.n)} reseña${r.n === 1 ? '' : 's'}">★ ${dec(r.promedio)}</span>`;
  }

  let actual = null;   // publicación abierta en el detalle
  async function resenas(item) {
    actual = item;
    let caja = document.getElementById('ugrs-resenas');
    if (!caja) {
      const ref = document.querySelector('#detail-sheet .comments-section-title'); if (!ref) return;
      caja = document.createElement('section'); caja.id = 'ugrs-resenas'; caja.className = 'ugrs-caja';
      ref.before(caja);
    }
    caja.innerHTML = '<div class="ugrs-cargando">Cargando reseñas…</div>';
    const r = await api(`/items/${item._id}/resenas`);
    if (actual !== item) return;
    if (!r.ok) { caja.innerHTML = ''; return; }
    pintar(caja, item, r.d);
    colEnDetalle(item);
  }
  function pintar(caja, item, d) {
    const s = d.resumen, mia = d.mia, propio = String(item.usuario || '').toLowerCase() === yo();
    const pct = s.si + s.no ? Math.round(s.si / (s.si + s.no) * 100) : null;
    const max = Math.max(1, ...s.dist);
    caja.innerHTML = `
      <div class="ugrs-tit"><span>⭐ Reseñas</span>${s.n ? `<small>${fmt(s.n)}</small>` : ''}</div>
      ${s.n ? `<div class="ugrs-res">
        <div class="ugrs-prom"><b>${dec(s.promedio)}</b><span class="ugrs-est" aria-label="${dec(s.promedio)} de 5">${estrellasTxt(s.promedio)}</span><small>${fmt(s.n)} reseña${s.n === 1 ? '' : 's'}</small></div>
        <div class="ugrs-dist">${[5, 4, 3, 2, 1].map(e => `<div class="ugrs-fila"><span>${e}</span><i><em style="width:${Math.round(s.dist[e - 1] / max * 100)}%"></em></i><small>${fmt(s.dist[e - 1])}</small></div>`).join('')}</div>
      </div>
      ${pct !== null ? `<div class="ugrs-func ${pct >= 70 ? 'bien' : pct >= 40 ? 'medio' : 'mal'}">${pct >= 70 ? '✅' : pct >= 40 ? '⚠️' : '❌'} <b>${pct}%</b> dice que le funcionó <small>(${fmt(s.si)} sí · ${fmt(s.no)} no)</small></div>` : ''}`
      : '<p class="ugrs-vacio">Aún no hay reseñas. ¡Sé el primero en contar si funciona!</p>'}
      ${propio ? '' : formHTML(mia)}
      <div class="ugrs-lista">${(d.resenas || []).map(x => `<div class="ugrs-item"><div class="ugrs-cab"><b>@${esc(x.usuario)}</b><span class="ugrs-est sm">${estrellasTxt(x.estrellas)}</span>${x.funciono === true ? '<span class="ugrs-chip si">Funcionó</span>' : x.funciono === false ? '<span class="ugrs-chip no">No funcionó</span>' : ''}<small>${fecha(x.editada || x.fecha)}</small></div><p>${esc(x.texto)}</p></div>`).join('')}</div>`;
    enlazar(caja, item, mia);
  }
  function formHTML(mia) {
    const e = mia?.estrellas || 0, f = mia ? mia.funciono : null;
    return `<form class="ugrs-form" novalidate>
      <div class="ugrs-pick" role="radiogroup" aria-label="Tu calificación">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="${n === e}" aria-label="${n} estrella${n > 1 ? 's' : ''}" data-e="${n}" class="${n <= e ? 'on' : ''}">★</button>`).join('')}</div>
      <div class="ugrs-funcq"><span>¿Te funcionó?</span><button type="button" data-f="1" class="${f === true ? 'on' : ''}">👍 Sí</button><button type="button" data-f="0" class="${f === false ? 'on' : ''}">👎 No</button></div>
      <textarea maxlength="500" rows="2" placeholder="Cuenta tu experiencia (opcional): ¿cómo lo instalaste? ¿qué versión?">${esc(mia?.texto || '')}</textarea>
      <div class="ugrs-acc"><button type="submit" class="ugrs-btn">${mia ? 'Actualizar reseña' : 'Publicar reseña'}</button>${mia ? '<button type="button" class="ugrs-btn sec" data-borrar>Borrar</button>' : ''}</div>
    </form>`;
  }
  function enlazar(caja, item, mia) {
    const f = caja.querySelector('.ugrs-form'); if (!f) return;
    let e = mia?.estrellas || 0, func = mia ? mia.funciono : null;
    const pintarE = () => f.querySelectorAll('[data-e]').forEach(b => { const on = +b.dataset.e <= e; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(+b.dataset.e === e)); });
    f.querySelectorAll('[data-e]').forEach(b => {
      b.onclick = () => { e = +b.dataset.e; pintarE(); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); };
      b.onmouseenter = () => f.querySelectorAll('[data-e]').forEach(x => x.classList.toggle('hover', +x.dataset.e <= +b.dataset.e));
    });
    f.querySelector('.ugrs-pick').onmouseleave = () => f.querySelectorAll('[data-e]').forEach(x => x.classList.remove('hover'));
    f.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { const v = b.dataset.f === '1'; func = func === v ? null : v; f.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', func !== null && (x.dataset.f === '1') === func)); });
    f.onsubmit = async ev => {
      ev.preventDefault();
      if (!tok()) return pedirSesion('dejar una reseña');
      if (!e) return aviso('Toca las estrellas para calificar', 'error');
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      const r = await api(`/items/${item._id}/resenas`, { method: 'POST', body: { estrellas: e, funciono: func, texto: f.querySelector('textarea').value } });
      btn.disabled = false;
      if (!r.ok) return aviso(r.d.error || 'No se pudo guardar', 'error');
      aviso(r.d.editada ? 'Reseña actualizada' : '¡Gracias por tu reseña!', 'success');
      item.resenas = { n: r.d.resumen.n, promedio: r.d.resumen.promedio };
      resenas(item); refrescarTile(item);
    };
    f.querySelector('[data-borrar]')?.addEventListener('click', async () => {
      if (!confirm('¿Borrar tu reseña?')) return;
      const r = await api(`/items/${item._id}/resenas`, { method: 'DELETE' });
      if (!r.ok) return aviso(r.d.error || 'No se pudo borrar', 'error');
      item.resenas = { n: r.d.resumen.n, promedio: r.d.resumen.promedio };
      resenas(item); refrescarTile(item);
    });
  }
  function refrescarTile(item) {
    document.querySelectorAll(`.game-tile[data-id="${item._id}"] .tile-meta, .game-tile[data-id="${item._id}"] .tile-yt-meta`).forEach(m => {
      m.querySelector('.ugrs-tile-star')?.remove();
      if (item.resenas?.n) m.insertAdjacentHTML('beforeend', estrellasTile(item));
    });
  }

  // ══ Colecciones ═══════════════════════════════════════════════════════
  // "Parte de la colección…" en el detalle + botón para añadir si es mía
  async function colEnDetalle(item) {
    const caja = document.getElementById('ugrs-resenas'); if (!caja) return;
    document.getElementById('ugrs-en-col')?.remove();
    const r = await api(`/items/${item._id}/colecciones`); if (actual !== item) return;
    const cols = r.ok ? r.d.colecciones : [], propio = String(item.usuario || '').toLowerCase() === yo();
    if (!cols.length && !propio) return;
    const div = document.createElement('div'); div.id = 'ugrs-en-col'; div.className = 'ugrs-en-col';
    div.innerHTML = cols.map(c => `<button type="button" class="ugrs-col-chip" data-col="${esc(c.id)}">📚 ${esc(c.titulo)} <small>${fmt(c.total)}</small></button>`).join('')
      + (propio ? '<button type="button" class="ugrs-col-chip add" data-add>＋ Añadir a una colección</button>' : '');
    caja.before(div);
    div.querySelectorAll('[data-col]').forEach(b => b.onclick = () => abrir(b.dataset.col));
    div.querySelector('[data-add]')?.addEventListener('click', () => agregar(item._id));
  }

  const portadaHTML = c => c.portada ? `<img src="${esc(cld(c.portada, 'c_fill,g_auto,w_480,h_300,q_auto,f_auto'))}" alt="" loading="lazy" onerror="this.remove()">` : '<span class="ugrs-sin">📚</span>';
  async function colecciones(usuario, el, { propio = false } = {}) {
    if (!el) return;
    el.innerHTML = '<div class="ugrs-cargando">Cargando colecciones…</div>';
    const r = await api(`/colecciones/usuario/${encodeURIComponent(usuario)}`);
    const cols = r.ok ? r.d.colecciones : [];
    el.innerHTML = `${propio ? `<button type="button" class="ugrs-nueva" data-nueva><span>＋</span><b>Nueva colección</b><small>Agrupa tus mods, juegos o videos en una lista con portada</small></button>` : ''}
      ${cols.length ? `<div class="ugrs-cols">${cols.map(c => `<button type="button" class="ugrs-col" data-col="${esc(c.id)}"><div class="ugrs-col-img">${portadaHTML(c)}<span class="ugrs-col-n">${fmt(c.total)}</span></div><b>${esc(c.titulo)}</b>${c.descripcion ? `<small>${esc(c.descripcion)}</small>` : ''}</button>`).join('')}</div>`
        : `<p class="ugrs-vacio">${propio ? 'Todavía no tienes colecciones.' : 'Este creador todavía no tiene colecciones.'}</p>`}`;
    el.querySelector('[data-nueva]')?.addEventListener('click', () => editar(null, () => colecciones(usuario, el, { propio })));
    el.querySelectorAll('[data-col]').forEach(b => b.onclick = () => abrir(b.dataset.col, () => colecciones(usuario, el, { propio })));
  }

  async function abrir(id, alCambiar) {
    if (!esId(id)) return;
    const r = await api(`/colecciones/${id}`);
    if (!r.ok) return aviso(r.d.error || 'No se pudo abrir la colección', 'error');
    const c = r.d.coleccion, propio = c.usuario === yo();
    const enlace = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}biblioteca.html?coleccion=${c.id}`;
    hoja('📚 Colección', `
      <div class="ugrs-hero">${portadaHTML(c)}<div class="ugrs-hero-t"><b>${esc(c.titulo)}</b><a href="perfil-publico.html?usuario=${encodeURIComponent(c.usuario)}">@${esc(c.usuario)}</a> · ${fmt(c.total)} publicacion${c.total === 1 ? '' : 'es'}</div></div>
      ${c.descripcion ? `<p class="ugrs-desc">${esc(c.descripcion)}</p>` : ''}
      <div class="ugrs-acc">${propio ? '<button type="button" class="ugrs-btn sec" data-editar>✏️ Editar</button>' : ''}<button type="button" class="ugrs-btn sec" data-compartir>🔗 Compartir</button></div>
      <div class="ugrs-grid">${c.items.map((i, k) => `<a class="ugrs-it" href="biblioteca.html?id=${esc(i._id)}" data-it="${k}"><span class="ugrs-it-img"><img src="${esc(cld(i.image, 'c_fill,g_auto,w_300,h_300,q_auto,f_auto'))}" alt="" loading="lazy" onerror="this.onerror=null;this.src=window.UG_PH||''"></span><b>${esc(i.title)}</b><small>${esc(i.category || '')}${i.resenas?.n ? ` · ★ ${dec(i.resenas.promedio)}` : ''}</small></a>`).join('') || '<p class="ugrs-vacio">Esta colección está vacía.</p>'}</div>`, b => {
      b.querySelector('[data-editar]')?.addEventListener('click', () => editar(c.id, alCambiar));
      b.querySelector('[data-compartir]').onclick = async () => {
        try { if (navigator.share) await navigator.share({ title: c.titulo, text: `Colección "${c.titulo}" de @${c.usuario} en UpGames`, url: enlace }); else { await navigator.clipboard.writeText(enlace); aviso('Enlace copiado', 'success'); } } catch (_) {}
      };
      // En la biblioteca se abre el detalle sin salir de la página
      b.querySelectorAll('[data-it]').forEach(a => a.addEventListener('click', ev => {
        if (typeof window.openDetail !== 'function') return;
        ev.preventDefault(); cerrar(); const it = c.items[+a.dataset.it];
        fetch(`${API}/items/${it._id}`).then(x => x.json()).then(d => window.openDetail(d.item || d)).catch(() => { location.href = a.href; });
      }));
    });
  }

  let misItems = null;
  async function cargarMios() {
    if (misItems) return misItems;
    const r = await api(`/items/user/${encodeURIComponent(yo())}`);
    const l = Array.isArray(r.d) ? r.d : (r.d.items || r.d.juegos || []);
    misItems = l.filter(i => i && i._id && ['aprobado'].includes(i.status));
    return misItems;
  }
  async function editar(id, alCambiar) {
    if (!tok()) return pedirSesion('crear colecciones');
    const [mios, r] = await Promise.all([cargarMios(), id ? api(`/colecciones/${id}`) : null]);
    const c = r?.ok ? r.d.coleccion : { titulo: '', descripcion: '', items: [], portadaId: '' };
    let orden = (c.items || []).map(i => i._id), portada = c.portadaId || '';
    const porId = new Map(mios.map(i => [String(i._id), i]));
    const render = b => {
      const lista = b.querySelector('.ugrs-sel');
      lista.innerHTML = mios.length ? mios.map(i => String(i._id)).map(x => {
        const i = porId.get(x), dentro = orden.includes(x), pos = orden.indexOf(x);
        return `<div class="ugrs-op ${dentro ? 'on' : ''}" data-id="${esc(x)}"><button type="button" class="ugrs-op-sel" aria-pressed="${dentro}"><img src="${esc(cld(i.image, 'c_fill,w_96,h_96,q_auto,f_auto'))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span>${esc(i.title)}</span>${dentro ? `<em>${pos + 1}</em>` : ''}</button>
          ${dentro ? `<button type="button" class="ugrs-op-mini ${portada === x || (!portada && pos === 0) ? 'on' : ''}" data-portada title="Usar como portada">🖼️</button><button type="button" class="ugrs-op-mini" data-subir title="Subir" ${pos === 0 ? 'disabled' : ''}>▲</button>` : ''}</div>`;
      }).join('') : '<p class="ugrs-vacio">Necesitas publicaciones aprobadas para armar una colección.</p>';
      b.querySelector('.ugrs-cuenta').textContent = `${orden.length} seleccionada${orden.length === 1 ? '' : 's'}`;
      lista.querySelectorAll('.ugrs-op').forEach(op => {
        const x = op.dataset.id;
        op.querySelector('.ugrs-op-sel').onclick = () => { orden = orden.includes(x) ? orden.filter(y => y !== x) : [...orden, x]; if (!orden.includes(portada)) portada = ''; render(b); };
        op.querySelector('[data-portada]')?.addEventListener('click', () => { portada = x; render(b); });
        op.querySelector('[data-subir]')?.addEventListener('click', () => { const p = orden.indexOf(x); if (p > 0) { [orden[p - 1], orden[p]] = [orden[p], orden[p - 1]]; render(b); } });
      });
    };
    hoja(id ? '✏️ Editar colección' : '📚 Nueva colección', `
      <label class="ugrs-lbl">Nombre<input class="ugrs-in" maxlength="60" data-titulo value="${esc(c.titulo)}" placeholder="Ej: Saga Resident Evil · Mods de GTA V"></label>
      <label class="ugrs-lbl">Descripción <small>(opcional)</small><textarea class="ugrs-in" maxlength="300" rows="2" data-desc placeholder="De qué trata esta colección">${esc(c.descripcion)}</textarea></label>
      <div class="ugrs-lbl">Publicaciones <small class="ugrs-cuenta"></small></div>
      <p class="ugrs-sub">Toca para agregar o quitar. El número verde es su lugar en la colección; 🖼️ elige la portada y ▲ la adelanta un lugar.</p>
      <div class="ugrs-sel"></div>
      <div class="ugrs-acc fijo"><button type="button" class="ugrs-btn" data-guardar>${id ? 'Guardar cambios' : 'Crear colección'}</button>${id ? '<button type="button" class="ugrs-btn sec peligro" data-borrar>Borrar</button>' : ''}</div>`, b => {
      render(b);
      const btnG = b.querySelector('[data-guardar]');
      btnG.onclick = async () => {
        const body = { titulo: b.querySelector('[data-titulo]').value, descripcion: b.querySelector('[data-desc]').value, items: orden.filter(x => porId.has(x)), portadaId: portada };
        btnG.disabled = true;
        const x = await api(id ? `/colecciones/${id}` : '/colecciones', { method: id ? 'PUT' : 'POST', body });
        btnG.disabled = false;
        if (!x.ok) return aviso(x.d.error || 'No se pudo guardar', 'error');
        aviso(id ? 'Colección guardada' : '¡Colección creada!', 'success'); cerrar(); alCambiar?.();
        setTimeout(() => abrir(x.d.coleccion.id, alCambiar), 260);
      };
      b.querySelector('[data-borrar]')?.addEventListener('click', async () => {
        if (!confirm('¿Borrar esta colección? Las publicaciones no se borran.')) return;
        const x = await api(`/colecciones/${id}`, { method: 'DELETE' });
        if (!x.ok) return aviso(x.d.error || 'No se pudo borrar', 'error');
        aviso('Colección borrada', 'success'); cerrar(); alCambiar?.();
      });
    });
  }

  async function agregar(itemId) {
    if (!tok()) return pedirSesion('crear colecciones');
    const r = await api(`/colecciones/usuario/${encodeURIComponent(yo())}`);
    const cols = r.ok ? r.d.colecciones : [];
    const dentro = new Set(((await api(`/items/${itemId}/colecciones`)).d.colecciones || []).map(c => c.id));
    hoja('📚 Añadir a una colección', `${cols.length ? `<div class="ugrs-sel">${cols.map(c => `<div class="ugrs-op ${dentro.has(c.id) ? 'on' : ''}"><button type="button" class="ugrs-op-sel" data-col="${esc(c.id)}" aria-pressed="${dentro.has(c.id)}"><span class="ugrs-op-ic">${dentro.has(c.id) ? '✓' : '＋'}</span><span>${esc(c.titulo)} <small>· ${fmt(c.total)}</small></span></button></div>`).join('')}</div>` : '<p class="ugrs-vacio">Aún no tienes colecciones.</p>'}
      <div class="ugrs-acc"><button type="button" class="ugrs-btn sec" data-nueva>＋ Nueva colección</button></div>`, b => {
      b.querySelectorAll('[data-col]').forEach(x => x.onclick = async () => {
        const quitar = dentro.has(x.dataset.col); x.disabled = true;
        const y = await api(`/colecciones/${x.dataset.col}/items`, { method: 'POST', body: { itemId, quitar } });
        if (!y.ok) { x.disabled = false; return aviso(y.d.error || 'No se pudo', 'error'); }
        aviso(quitar ? 'Quitada de la colección' : 'Añadida a la colección', 'success'); cerrar();
        if (actual && String(actual._id) === String(itemId)) colEnDetalle(actual);
      });
      b.querySelector('[data-nueva]').onclick = () => { misItems = null; editar(null).then(() => {}); };
    });
  }

  // Enlace directo: biblioteca.html?coleccion=<id>
  document.addEventListener('DOMContentLoaded', () => {
    const id = new URLSearchParams(location.search).get('coleccion');
    if (esId(id)) setTimeout(() => abrir(id), 1200);
  });

  window.UGR = { resenas, estrellasTile, colecciones, abrir, editar, agregar };
})();
