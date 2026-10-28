/* ═══════════════════════════════════════════════════════════════
   UpGames · Usos extra de los UpCoins (UGX)
   Estilo del perfil, Apoyar publicaciones, revisión prioritaria, regalar Premium,
   cambio de nombre inmediato y misiones semanales. El servidor fija precios y
   reglas (rutas/extrasUC.js); aquí solo se muestra y se cobra con clave única.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const API = (window.UG_CONFIG && window.UG_CONFIG.API_URL) || 'https://upgames-production.up.railway.app';
  const tok = () => { try { return localStorage.getItem('token'); } catch (_) { return null; } };
  const yo = () => { try { return localStorage.getItem('user_admin') || ''; } catch (_) { return ''; } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Math.floor(Number(n) || 0).toLocaleString('es-CO');
  const clave = () => 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const TIPO_TXT = { marco: 'Marcos', color: 'Color del nombre', fondo: 'Fondos', insignia: 'Insignias' };
  const MIS_IC = { comentar: '💬', favorito: '❤️', seguir: '👥', ver_live: '🔴', apoyar: '🪙', regalo_live: '🎁' };

  let cfg = null, mio = null, planes = null;

  async function api(path, opts = {}) {
    const r = await fetch(API + path, { method: opts.method || 'GET', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(tok() ? { Authorization: 'Bearer ' + tok() } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && d.success !== false, status: r.status, d };
  }
  async function cargarCfg() {
    if (cfg) return cfg;
    try { const r = await api('/extras/catalogo'); if (r.ok) cfg = r.d; } catch (_) {}
    return cfg;
  }
  async function cargarMio() {
    if (!tok()) return null;
    try { const r = await api('/extras/mio'); if (r.ok) { mio = r.d; cfg = r.d.catalogo; } } catch (_) {}
    return mio;
  }
  const activo = k => !!cfg?.activo?.[k];
  const precio = k => {
    if (!cfg) return null;
    const act = { nombre: 'nombre', prioridad: 'prioridad' }[k];
    return act && !cfg.activo[act] ? null : cfg.precios[k];
  };
  const aviso = (msg, tipo) => { if (window.showToast) window.showToast(msg, tipo); else if (window.toast) window.toast(msg); else alert(msg); };

  // ── Hoja genérica ────────────────────────────────────────────────────────
  function cerrarHoja() { document.querySelectorAll('.ugx-ov').forEach(o => { o.classList.remove('on'); setTimeout(() => o.remove(), 220); }); document.removeEventListener('keydown', escHoja); }
  function escHoja(e) { if (e.key === 'Escape') cerrarHoja(); }
  function hoja(titulo, html, alAbrir) {
    cerrarHoja();
    const ov = document.createElement('div'); ov.className = 'ugx-ov';
    ov.innerHTML = `<div class="ugx-sheet" role="dialog" aria-modal="true" aria-label="${esc(titulo)}"><div class="ugx-h"><h3>${esc(titulo)}</h3><button type="button" class="ugx-x" aria-label="Cerrar">✕</button></div><div class="ugx-b">${html}</div></div>`;
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.ugx-x')) cerrarHoja(); });
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('on'));
    document.addEventListener('keydown', escHoja);
    const b = ov.querySelector('.ugx-b'); alAbrir?.(b);
    setTimeout(() => ov.querySelector('button:not(.ugx-x), input')?.focus({ preventScroll: true }), 80);
    return b;
  }
  function fiesta(emoji, texto) {
    const f = document.createElement('div'); f.className = 'ugx-fiesta'; f.innerHTML = `<div>${emoji}</div>${esc(texto)}`;
    document.body.appendChild(f); requestAnimationFrame(() => f.classList.add('on'));
    setTimeout(() => { f.classList.remove('on'); setTimeout(() => f.remove(), 400); }, 1800);
  }
  /** "Te faltan X UpCoins" con botón directo a recargar. */
  function faltan(msg) {
    hoja('🪙 Te faltan UpCoins', `<p class="ugx-sub">${esc(msg || 'No tienes UpCoins suficientes.')}</p><button type="button" class="ugx-btn oro" data-recargar style="width:100%">Recargar UpCoins</button>`, b => {
      b.querySelector('[data-recargar]').onclick = () => { cerrarHoja(); recargar(); };
    });
  }
  function recargar() {
    if (typeof window.switchTab === 'function' && document.getElementById('economia-view')) {
      window.switchTab('economia');
      setTimeout(() => { document.getElementById('eco-tienda')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); window.ecoAbrirTienda?.(); }, 350);
    } else location.href = './biblioteca.html?plan=1';
  }
  /** Cobro común: clave única, avisos de saldo y refresco del contador de la cabecera. */
  async function pagar(path, body, btn, metodo = 'POST') {
    if (!tok()) { window.ugPedirSesion ? window.ugPedirSesion('usar tus UpCoins') : (location.href = '../index.html'); return null; }
    if (btn) btn.disabled = true;
    try {
      const r = await api(path, { method: metodo, body: { ...body, clave: clave() } });
      if (r.ok) { window.dispatchEvent(new Event('ug:upcoins')); return r.d; }
      if (r.status === 402) faltan(r.d.error); else aviso(r.d.error || 'No se pudo completar', 'error');
      return null;
    } catch (_) { aviso('Error de red, inténtalo de nuevo', 'error'); return null; }
    finally { if (btn) btn.disabled = false; }
  }

  // ── Estilo: clases para pintar marcos, colores, fondos e insignias ───────
  const clasesMarco = id => id ? ['ugs-marco', 'ugs-m-' + id] : [];
  function insigniasHTML(ids) {
    const l = (ids || []).map(id => (cfg?.cosmeticos || []).find(c => c.id === id)).filter(Boolean);
    return l.length ? `<span class="ugs-ins">${l.map(c => `<span title="${esc(c.nombre)}">${esc(c.emoji)} ${esc(c.nombre)}</span>`).join('')}</span>` : '';
  }
  /** Aplica un estilo a elementos existentes: { avatar, nombre, fondo, insignias } (cualquiera opcional). */
  function aplicarEstilo(estilo = {}, el = {}) {
    if (el.avatar) { el.avatar.className = el.avatar.className.replace(/\bugs-(marco|m-\S+)\b/g, '').trim(); clasesMarco(estilo.marco).forEach(c => el.avatar.classList.add(c)); }
    if (el.nombre) { el.nombre.className = el.nombre.className.replace(/\bugs-c-\S+\b/g, '').trim(); if (estilo.color) el.nombre.classList.add('ugs-c-' + estilo.color); }
    if (el.fondo) { el.fondo.className = el.fondo.className.replace(/\bugs-f-\S+\b/g, '').trim(); if (estilo.fondo) el.fondo.classList.add('ugs-f-' + estilo.fondo); }
    if (el.insignias) el.insignias.innerHTML = insigniasHTML(estilo.insignias);
  }
  function estiloPropio() {
    if (!mio) return;
    let ins = document.getElementById('ugx-mis-insignias');
    const badge = document.getElementById('pf-badge');
    if (!ins && badge) { ins = document.createElement('span'); ins.id = 'ugx-mis-insignias'; badge.after(ins); }
    aplicarEstilo(mio.estilo, { avatar: document.querySelector('.pf2-avatar-wrap'),   // el avatar recorta (overflow:hidden): el marco va en su contenedor
 nombre: document.getElementById('pf-username'), insignias: ins });
  }

  // ── Panel "Usa tus UpCoins" (pestaña Economía) ───────────────────────────
  async function hub() {
    const caja = document.getElementById('ugx-hub'); if (!caja || !tok()) return;
    await cargarMio(); if (!cfg) return;
    const pend = (mio?.misiones?.misiones || []).filter(m => m.completa && !m.reclamada).length;
    const t = [];
    if (activo('misiones')) t.push(['misiones', '🎯', 'Misiones semanales', 'Gana UpCoins e insignias', pend]);
    if (activo('cosmeticos')) t.push(['estilo', '✨', 'Estilo del perfil', 'Marcos, colores, fondos']);
    if (activo('regalarPremium')) t.push(['regalar', '🎁', 'Regalar Premium', 'Sorprende a un amigo']);
    if (activo('nombre')) t.push(['nombre', '✏️', 'Cambiar nombre ya', `Sin esperar · ${precio('nombre')} UC`]);
    if (!t.length) { caja.innerHTML = ''; return; }
    caja.innerHTML = `<div class="ugx-hub"><div class="ugx-hub-h"><b>🪙 USA TUS UPCOINS</b><span class="ugx-saldo">🪙 ${fmt(mio?.upcoins?.total)}</span></div>
      <div class="ugx-hub-g">${t.map(([id, ic, ti, sub, dot]) => `<button type="button" class="ugx-tile" data-ugx="${id}"><span>${ic}</span><b>${esc(ti)}</b><small>${esc(sub)}</small>${dot ? `<span class="ugx-dot">${dot}</span>` : ''}</button>`).join('')}</div></div>`;
    caja.querySelectorAll('[data-ugx]').forEach(b => b.onclick = () => ({ misiones, estilo: tienda, regalar, nombre: irANombre }[b.dataset.ugx])());
  }
  function irANombre() {
    if (typeof window.pfOpenSettings === 'function') { window.switchTab?.('profile'); setTimeout(() => window.pfOpenSettings('nombre'), 250); }
  }

  // ── Misiones ─────────────────────────────────────────────────────────────
  async function misiones() {
    if (!tok()) return window.ugPedirSesion?.('hacer misiones');
    const r = await api('/misiones'); if (!r.ok) return aviso(r.d.error || 'No se pudieron cargar', 'error');
    pintarMisiones(r.d);
  }
  function pintarMisiones(e) {
    const dias = Math.max(0, Math.ceil((new Date(e.terminaEn) - Date.now()) / 864e5));
    const html = !e.activo || !e.misiones.length ? '<p class="ugx-sub">No hay misiones activas esta semana.</p>'
      : `<p class="ugx-sub">Se reinician cada lunes · quedan ${dias} día${dias === 1 ? '' : 's'}. Los UpCoins de misiones son de regalo: se usan en UpGames, no se retiran.</p>
        <div class="ugx-mis">${e.misiones.map(m => {
          const pr = Math.round(m.progreso / m.objetivo * 100);
          const premio = [m.uc ? `🪙 ${m.uc} UC` : '', m.insignia ? `${m.insignia.emoji} Insignia ${m.insignia.nombre}` : ''].filter(Boolean).join(' + ');
          const accion = m.reclamada ? '<span class="ugx-ok-tag">✓ Reclamada</span>'
            : m.completa ? `<button type="button" class="ugx-btn oro" data-reclamar="${esc(m.id)}">Reclamar</button>` : `<span class="ugx-ok-tag" style="color:#a3a8b6">${m.progreso}/${m.objetivo}</span>`;
          return `<div class="ugx-mi ${m.completa ? 'hecha' : ''}"><div class="ugx-mi-ic">${MIS_IC[m.tipo] || '🎯'}</div><div class="ugx-mi-t"><b>${esc(m.titulo)}</b><small>${esc(premio)}</small><div class="ugx-bar"><i style="width:${pr}%"></i></div></div>${accion}</div>`;
        }).join('')}</div>`;
    hoja('🎯 Misiones de la semana', html, b => b.querySelectorAll('[data-reclamar]').forEach(btn => btn.onclick = async () => {
      btn.disabled = true;
      const r = await api(`/misiones/${encodeURIComponent(btn.dataset.reclamar)}/reclamar`, { method: 'POST' });
      if (!r.ok) { btn.disabled = false; return aviso(r.d.error || 'No se pudo reclamar', 'error'); }
      window.dispatchEvent(new Event('ug:upcoins'));
      fiesta(r.d.insignia ? '🏅' : '🪙', r.d.insignia ? '¡Nueva insignia desbloqueada!' : `+${r.d.uc} UpCoins`);
      mio = null; pintarMisiones(r.d.misiones); hub();
    }));
  }

  // ── Tienda de estilo ─────────────────────────────────────────────────────
  async function tienda(tab = 'marco') {
    if (!tok()) return window.ugPedirSesion?.('personalizar tu perfil');
    await cargarMio(); if (!mio) return aviso('No se pudo cargar tu estilo', 'error');
    const mios = new Set(mio.cosmeticos), est = mio.estilo || {};
    const av = document.getElementById('pf-avatar-img')?.getAttribute('src') || '';
    const lista = cfg.cosmeticos.filter(c => c.tipo === tab && (!c.soloMision || mios.has(c.id)));
    const equipado = c => c.tipo === 'insignia' ? (est.insignias || []).includes(c.id) : est[c.tipo] === c.id;
    const prev = c => c.tipo === 'marco' ? `<div class="ugx-prev ugs-marco ugs-m-${esc(c.id)}">${esc(c.emoji)}</div>`
      : c.tipo === 'color' ? `<div class="ugx-prev-color ugs-c-${esc(c.id)}">@${esc(yo())}</div>`
      : c.tipo === 'fondo' ? `<div class="ugx-prev-fondo ugs-f-${esc(c.id)}"></div>` : `<div class="ugx-prev">${esc(c.emoji)}</div>`;
    const accion = c => mios.has(c.id)
      ? (equipado(c) ? `<button type="button" class="ugx-btn sec" data-quitar="${esc(c.id)}">Quitar</button>` : `<button type="button" class="ugx-btn" data-equipar="${esc(c.id)}">Usar</button>`)
      : `<button type="button" class="ugx-btn oro" data-comprar="${esc(c.id)}">🪙 ${fmt(c.precio)}</button>`;
    const html = `<div class="ugx-preview ${est.fondo ? 'ugs-f-' + esc(est.fondo) : ''}"><div class="ugx-av ${est.marco ? 'ugs-marco ugs-m-' + esc(est.marco) : ''}" style="${av ? `background-image:url('${esc(av)}')` : ''}">${av ? '' : esc((yo()[0] || '?').toUpperCase())}</div>
        <div><b class="${est.color ? 'ugs-c-' + esc(est.color) : ''}" style="font-size:1.05rem">@${esc(yo())}</b><div style="margin-top:5px">${insigniasHTML(est.insignias)}</div></div><span class="ugx-saldo" style="margin-left:auto">🪙 ${fmt(mio.upcoins?.total)}</span></div>
      <div class="ugx-tabs">${Object.entries(TIPO_TXT).map(([k, t]) => `<button type="button" class="ugx-tab ${k === tab ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
      ${tab === 'insignia' ? '<p class="ugx-sub">Muestra hasta 3 insignias junto a tu nombre. Algunas solo se ganan con misiones.</p>' : ''}
      <div class="ugx-grid">${lista.map(c => `<div class="ugx-card ${equipado(c) ? 'eq' : ''}">${prev(c)}<b>${esc(c.nombre)}</b><small>${mios.has(c.id) ? (equipado(c) ? 'En uso' : 'Tuyo') : c.soloMision ? 'De misión' : `${fmt(c.precio)} UpCoins`}</small>${accion(c)}</div>`).join('') || '<p class="ugx-sub">Nada por aquí todavía.</p>'}</div>`;
    hoja('✨ Estilo del perfil', html, b => {
      b.querySelectorAll('[data-tab]').forEach(x => x.onclick = () => tienda(x.dataset.tab));
      b.querySelectorAll('[data-comprar]').forEach(x => x.onclick = async () => {
        const c = cfg.cosmeticos.find(y => y.id === x.dataset.comprar);
        if (!confirm(`¿Comprar "${c.nombre}" por ${fmt(c.precio)} UpCoins? Se queda en tu cuenta para siempre.`)) return;
        const r = await pagar('/extras/cosmetico', { id: c.id }, x);
        if (r) { fiesta(c.emoji, `¡${c.nombre} es tuyo!`); mio = null; await cargarMio(); estiloPropio(); tienda(tab); }
      });
      const guardar = async (cambio, x) => {
        x.disabled = true;
        const r = await api('/extras/estilo', { method: 'PUT', body: cambio });
        x.disabled = false;
        if (!r.ok) return aviso(r.d.error || 'No se pudo guardar', 'error');
        mio.estilo = r.d.estilo; estiloPropio(); tienda(tab);
      };
      b.querySelectorAll('[data-equipar]').forEach(x => x.onclick = () => {
        const c = cfg.cosmeticos.find(y => y.id === x.dataset.equipar);
        if (c.tipo !== 'insignia') return guardar({ [c.tipo]: c.id }, x);
        const l = [...(est.insignias || []), c.id];
        if (l.length > 3) return aviso('Puedes mostrar hasta 3 insignias: quita una primero', 'error');
        guardar({ insignias: l }, x);
      });
      b.querySelectorAll('[data-quitar]').forEach(x => x.onclick = () => {
        const c = cfg.cosmeticos.find(y => y.id === x.dataset.quitar);
        guardar(c.tipo === 'insignia' ? { insignias: (est.insignias || []).filter(i => i !== c.id) } : { [c.tipo]: '' }, x);
      });
    });
  }

  // ── Regalar Premium ──────────────────────────────────────────────────────
  async function regalar(para = '') {
    if (!tok()) return window.ugPedirSesion?.('regalar Premium');
    await cargarCfg();
    if (!activo('regalarPremium')) return aviso('Regalar Premium no está disponible ahora', 'error');
    if (!planes) { const r = await api('/tienda/catalogo'); planes = r.d?.planes || []; }
    let elegido = planes[0]?.id;
    const html = `<p class="ugx-sub">Se paga con tus UpCoins y la otra persona recibe Premium al instante (sin anuncios, NEXUS ilimitado y más visibilidad). Si ya tenía Premium, se le suman los días.</p>
      <input class="ugx-in" id="ugx-para" placeholder="@usuario que lo recibe" value="${esc(para)}" autocomplete="off" maxlength="21">
      <div class="ugx-montos">${planes.map((p, i) => `<button type="button" class="ugx-monto ${i ? '' : 'on'}" data-plan="${esc(p.id)}">${esc(p.nombre.replace('Premium ', ''))}<small>🪙 ${fmt(p.monedas)} UC</small></button>`).join('')}</div>
      <button type="button" class="ugx-btn oro" id="ugx-regalar" style="width:100%">🎁 Regalar Premium</button>`;
    hoja('🎁 Regalar Premium', html, b => {
      b.querySelectorAll('[data-plan]').forEach(x => x.onclick = () => { elegido = x.dataset.plan; b.querySelectorAll('[data-plan]').forEach(y => y.classList.toggle('on', y === x)); });
      b.querySelector('#ugx-regalar').onclick = async e => {
        const u = b.querySelector('#ugx-para').value.trim().replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9_.-]{3,20}$/.test(u)) return aviso('Escribe el @usuario que recibirá Premium', 'error');
        const p = planes.find(x => x.id === elegido);
        if (!confirm(`¿Regalar ${p.nombre} a @${u} por ${fmt(p.monedas)} UpCoins?`)) return;
        const r = await pagar('/tienda/pagar', { producto: `plan:${p.id}`, metodo: 'upcoins', para: u }, e.currentTarget);
        if (r) { cerrarHoja(); fiesta('🎁', `¡Le regalaste ${p.nombre} a @${u}!`); hub(); }
      };
    });
  }

  // ── Apoyar una publicación (detalle) ─────────────────────────────────────
  async function alAbrirDetalle(item) {
    document.getElementById('ugx-apoyar')?.remove();
    await cargarCfg();
    if (!item || !activo('apoyar') || (item.status && item.status !== 'aprobado') || item.usuario === yo()) return;   // el catálogo público no trae status: solo lista aprobadas
    const acc = document.querySelector('#detail-sheet .sheet-actions'); if (!acc) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'ugx-apoyar'; b.className = 'ugx-apoyar';
    b.innerHTML = `<span>🪙</span><span><b>Apoyar a @${esc(item.usuario)}</b><small id="ugx-apoyos">Envíale UpCoins: recibe el 25 % como ganancia</small></span><ion-icon name="chevron-forward"></ion-icon>`;
    b.onclick = () => apoyar(item);
    acc.after(b);
    try {
      const r = await api(`/items/${item._id}/apoyos`);
      if (r.ok && r.d.fans && document.getElementById('ugx-apoyar') === b) b.querySelector('#ugx-apoyos').textContent = `${fmt(r.d.fans)} fan${r.d.fans === 1 ? ' ya lo apoyó' : 's ya lo apoyaron'} · ${fmt(r.d.uc)} UC`;
    } catch (_) {}
  }
  function apoyar(item) {
    if (!tok()) return window.ugPedirSesion?.('apoyar a los creadores');
    const montos = cfg.precios.apoyo || [];
    let monto = montos[Math.min(1, montos.length - 1)];
    const html = `<p class="ugx-sub">Tu apoyo le llega a @${esc(item.usuario)} como ganancia (25 % del valor, retirable tras 7 días). Gracias por impulsar a los creadores.</p>
      <div class="ugx-montos">${montos.map(m => `<button type="button" class="ugx-monto ${m === monto ? 'on' : ''}" data-monto="${m}">🪙 ${fmt(m)}<small>UpCoins</small></button>`).join('')}</div>
      <button type="button" class="ugx-btn oro" id="ugx-apoyar-ok" style="width:100%">Apoyar con 🪙 <span>${fmt(monto)}</span></button>`;
    hoja('🪙 Apoyar publicación', html, b => {
      b.querySelectorAll('[data-monto]').forEach(x => x.onclick = () => { monto = +x.dataset.monto; b.querySelectorAll('[data-monto]').forEach(y => y.classList.toggle('on', y === x)); b.querySelector('#ugx-apoyar-ok span').textContent = fmt(monto); });
      b.querySelector('#ugx-apoyar-ok').onclick = async e => {
        const r = await pagar(`/items/${item._id}/apoyar`, { monto }, e.currentTarget);
        if (r) { cerrarHoja(); fiesta('💛', `¡Apoyaste a @${item.usuario}!`); alAbrirDetalle(item); }
      };
    });
  }

  // ── Revisión prioritaria (hoja de la publicación propia) ─────────────────
  async function prioridad(id, btn) {
    await cargarCfg();
    const p = precio('prioridad'); if (!p) return aviso('La revisión prioritaria no está disponible ahora', 'error');
    if (!confirm(`¿Pasar esta publicación al frente de la fila por ${p} UpCoins?\nSi no se revisa en ${cfg.prioridadHoras || 24} h, te devolvemos los UpCoins. (No garantiza que se apruebe.)`)) return;
    const r = await pagar(`/items/${id}/prioridad`, {}, btn);
    if (!r) return;
    const caja = document.getElementById('pf2-prioridad');
    if (caja) caja.innerHTML = '<span>⚡ <b>Revisión prioritaria activa</b>: va primera en la fila</span>';
    fiesta('⚡', '¡Publicación priorizada!');
  }

  // Precios reales en textos renderizados por otras partes (p. ej. la hoja de una publicación)
  const pintarPrecios = () => { if (!cfg) return; document.querySelectorAll('[data-ugx-precio]').forEach(e => { const v = precio(e.dataset.ugxPrecio); if (v != null && e.textContent !== String(v)) e.textContent = v; }); };

  // ── Arranque ─────────────────────────────────────────────────────────────
  async function iniciar() {
    await cargarCfg();
    if (tok()) {
      await cargarMio();
      estiloPropio();
      // Sincroniza la espera del cambio de nombre con el servidor (otro dispositivo pudo cambiarlo)
      try {
        if (mio?.nombreEsperaDias > 0 && typeof window.pfGetMeta === 'function') {
          const m = window.pfGetMeta();
          if (!m.lastUsernameChange) window.pfSetMeta?.({ lastUsernameChange: new Date(Date.now() - (30 - mio.nombreEsperaDias) * 864e5 + 3600e3).toISOString() });
        }
        if (typeof window.pfCheckCooldown === 'function') window.pfCheckCooldown('nombre', window.pfGetMeta?.().lastUsernameChange);
      } catch (_) {}
    }
    pintarPrecios();
    new MutationObserver(() => { clearTimeout(iniciar.t); iniciar.t = setTimeout(pintarPrecios, 120); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  window.UGX = { precio, activo, cargarCfg, cargarMio, hub, misiones, tienda, regalar, apoyar, alAbrirDetalle, prioridad, faltan, aplicarEstilo, insigniasHTML, clasesMarco,
    hoja, cerrarHoja, pagar, fiesta, get cfg() { return cfg; } };
})();
