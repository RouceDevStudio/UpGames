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
    if (activo('regalarPremium')) t.push(['regalar', '🎁', 'Regalar Premium', 'Sorprende a un amigo']);
    if (activo('nombre')) t.push(['nombre', '✏️', 'Cambiar nombre ya', `Sin esperar · ${precio('nombre')} UC`]);
    if (!t.length) { caja.innerHTML = ''; return; }
    caja.innerHTML = `<div class="ugx-hub"><div class="ugx-hub-h"><b>🪙 USA TUS UPCOINS</b><span class="ugx-saldo">🪙 ${fmt(mio?.upcoins?.total)}</span></div>
      <div class="ugx-hub-g">${t.map(([id, ic, ti, sub, dot]) => `<button type="button" class="ugx-tile" data-ugx="${id}"><span>${ic}</span><b>${esc(ti)}</b><small>${esc(sub)}</small>${dot ? `<span class="ugx-dot">${dot}</span>` : ''}</button>`).join('')}</div></div>`;
    caja.querySelectorAll('[data-ugx]').forEach(b => b.onclick = () => ({ misiones, estilo: tienda, regalar, nombre: irANombre }[b.dataset.ugx])());
    referidos(); promoLive();
  }
  // ── Referidos: invita y ganan los dos (al verificar el email) ──────────────
  async function referidos() {
    const caja = document.getElementById('ugx-referidos'); if (!caja || !tok()) return;
    const r = await api('/referidos/mio'); if (!r.ok || !r.d.activo) { caja.innerHTML = ''; return; }
    const d = r.d, link = `https://upgames.games/public/biblioteca.html?ref=${encodeURIComponent(d.codigo)}`;
    const est = { pendiente: ['⏳', 'Falta que verifique su email'], procesando: ['⏳', 'Procesando'], pagado: ['✅', `+${d.recompensa.invitador} UC`], tope: ['⏸', 'Tope del mes alcanzado'], misma_red: ['⚠️', 'Misma red: no cuenta'], bloqueado: ['⛔', 'No cuenta'] };
    caja.innerHTML = `<div class="ugx-ref">
      <div class="ugx-ref-h"><span class="ugx-ref-ic">🤝</span><div><b>Invita y ganen los dos</b><small>Tú recibes <b>${d.recompensa.invitador} UC</b> y tu amigo <b>${d.recompensa.invitado} UC</b> cuando verifique su email.</small></div></div>
      <div class="ugx-ref-link"><input readonly value="${esc(link)}" aria-label="Tu enlace de invitación"><button type="button" class="ugx-btn" data-a="copiar">Copiar</button></div>
      <div class="ugx-ref-acc">${navigator.share ? '<button type="button" class="ugx-btn sec" data-a="compartir">📤 Compartir</button>' : ''}<a class="ugx-btn sec" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Te invito a UpGames: descargas, videos, lives y una IA que te paga. Crea tu cuenta y recibe UpCoins de regalo 👉 ' + link)}">WhatsApp</a></div>
      <div class="ugx-ref-st"><div><b>${fmt(d.total)}</b><small>Invitados</small></div><div><b>${fmt(d.pagados)}</b><small>Verificados</small></div><div><b>${fmt(d.ganadoUC)}</b><small>UC ganados</small></div><div><b>${d.pagadosMes}/${d.topeMes}</b><small>Este mes</small></div></div>
      ${d.recientes.length ? `<details class="ugx-ref-lista"><summary>Ver mis invitados (${d.recientes.length})</summary>${d.recientes.map(x => `<div><span>@${esc(x.usuario)}</span><small>${(est[x.estado] || est.pendiente).join(' ')}</small></div>`).join('')}</details>` : ''}
      <p class="ugx-sub">Son UpCoins de regalo: se usan en UpGames y no se retiran. Cuentas falsas, la misma red o el abuso anulan las recompensas.</p></div>`;
    caja.querySelector('[data-a="copiar"]').onclick = async () => { try { await navigator.clipboard.writeText(link); aviso('🔗 Enlace copiado'); } catch (_) { caja.querySelector('input').select(); } };
    caja.querySelector('[data-a="compartir"]')?.addEventListener('click', () => navigator.share({ title: 'UpGames', text: 'Te invito a UpGames y recibes UpCoins de regalo', url: link }).catch(() => {}));
  }

  // ── Promover mi live: plus en el directorio y en "En vivo ahora" ───────────
  async function promoLive(destino) {
    const caja = destino || document.getElementById('ugx-promo-live'); if (!caja || !tok()) return;
    const r = await api('/live/promo/mio'); if (!r.ok || !r.d.activo) { caja.innerHTML = ''; return; }
    const d = r.d;
    caja.innerHTML = `<div class="ugx-promo">
      <div class="ugx-ref-h"><span class="ugx-ref-ic">🚀</span><div><b>Promueve tu live</b><small>Tu directo sube en "En vivo ahora" y en el directorio. Cuentan más tus espectadores, seguidores y descargas; los UpCoins son un <b>plus</b> que dura todo el live.</small></div></div>
      ${d.live ? `<p class="ugx-sub" style="margin:10px 0 8px">🔴 <b>${esc(d.live.titulo || 'Tu live')}</b>${d.live.promoUC ? ` · ya invertiste <b>${fmt(d.live.promoUC)} UC</b> (+${d.live.puntos} puntos)` : ''}</p>
        <div class="ugx-montos">${d.paquetes.map(m => `<button type="button" class="ugx-monto" data-m="${m}">🪙 ${fmt(m)}<small>+${Math.round(12 * Math.log2(1 + (d.live.promoUC + m) / 30)) - d.live.puntos} pts</small></button>`).join('')}</div>`
      : `<p class="ugx-sub" style="margin-top:10px">Cuando estés en vivo podrás promoverlo desde aquí o desde tu estudio. Paquetes: ${d.paquetes.map(m => fmt(m) + ' UC').join(' · ')}.</p><a class="ugx-btn" href="./live.html?estudio=1">🔴 Ir en vivo</a>`}
    </div>`;
    caja.querySelectorAll('[data-m]').forEach(b => b.onclick = async () => {
      const m = +b.dataset.m;
      if (!confirm(`¿Invertir ${m} UpCoins en promover este live? Se descuentan ahora y el plus dura hasta que termine.`)) return;
      const x = await pagar('/live/promover', { monto: m }, b);
      if (x) { fiesta('🚀', `¡Live promovido! Plus total: +${x.puntos} puntos`); promoLive(caja); }
    });
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
  // ── Packs a juego: precio = lo que te falta con descuento (igual que el servidor) ──
  function precioPack(p, mios) {
    const arts = p.items.map(id => cfg.cosmeticos.find(c => c.id === id)).filter(Boolean), faltan = arts.filter(a => !mios.has(a.id));
    const lleno = faltan.reduce((t, a) => t + a.precio, 0);
    return { arts, faltan, lleno, precio: Math.max(1, Math.round(lleno * (1 - (cfg.precios.packDescuento || 0) / 100))), completo: !faltan.length };
  }
  function packsHTML(mios, est) {
    const d = cfg.precios.packDescuento || 0;
    return `<p class="ugx-sub">Marco, color y fondo que combinan${d ? `, con <b>${d} % de descuento</b>` : ''}. Solo pagas lo que aún no tienes.</p>
      <div class="ugx-packs">${(cfg.packs || []).map(p => {
        const pr = precioPack(p, mios), m = pr.arts.find(a => a.tipo === 'marco'), co = pr.arts.find(a => a.tipo === 'color'), f = pr.arts.find(a => a.tipo === 'fondo');
        const enUso = pr.arts.every(a => a.tipo === 'insignia' ? (est.insignias || []).includes(a.id) : est[a.tipo] === a.id);
        return `<div class="ugx-pack ${f ? 'ugs-f-' + esc(f.id) : ''}">
          <div class="ugx-pack-top"><div class="ugx-prev ${m ? 'ugs-marco ugs-m-' + esc(m.id) : ''}">${esc(p.emoji)}</div>
            <div><b class="${co ? 'ugs-c-' + esc(co.id) : ''}">${esc(p.nombre)}</b><small>${pr.arts.map(a => esc(a.emoji + ' ' + a.nombre)).join(' · ')}</small></div></div>
          <div class="ugx-pack-pie">${pr.completo ? (enUso ? '<span class="ugx-pack-ok">✓ En uso</span>' : `<button type="button" class="ugx-btn" data-usar-pack="${esc(p.id)}">Usar pack</button>`)
            : `<span class="ugx-pack-precio">${pr.lleno !== pr.precio ? `<s>${fmt(pr.lleno)}</s>` : ''}<b>🪙 ${fmt(pr.precio)}</b>${pr.faltan.length < pr.arts.length ? `<small>te faltan ${pr.faltan.length}</small>` : ''}</span><button type="button" class="ugx-btn oro" data-pack="${esc(p.id)}">Comprar pack</button>`}</div>
        </div>`; }).join('')}</div>`;
  }

  /** Tienda de estilo. destino = contenedor (Editar perfil → Estilo); sin él, se abre como hoja. */
  async function tienda(tab = 'marco', destino) {
    if (!tok()) return window.ugPedirSesion?.('personalizar tu perfil');
    if (!destino && typeof window.pfOpenSettings === 'function' && document.getElementById('pfx-estilo')) {   // vive en Editar perfil
      window.switchTab?.('profile'); setTimeout(() => window.pfOpenSettings('estilo'), 250); return;
    }
    await cargarMio(); if (!mio) return aviso('No se pudo cargar tu estilo', 'error');
    if (tab === 'pack' && !(cfg.packs || []).length) tab = 'marco';
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
    const html = (destino ? '' : `<div class="ugx-preview ${est.fondo ? 'ugs-f-' + esc(est.fondo) : ''}"><div class="ugx-av ${est.marco ? 'ugs-marco ugs-m-' + esc(est.marco) : ''}" style="${av ? `background-image:url('${esc(av)}')` : ''}">${av ? '' : esc((yo()[0] || '?').toUpperCase())}</div>
        <div><b class="${est.color ? 'ugs-c-' + esc(est.color) : ''}" style="font-size:1.05rem">@${esc(yo())}</b><div style="margin-top:5px">${insigniasHTML(est.insignias)}</div></div><span class="ugx-saldo" style="margin-left:auto">🪙 ${fmt(mio.upcoins?.total)}</span></div>`) + `
      ${destino ? `<div class="pfx-saldo">Tu saldo: <b>🪙 ${fmt(mio.upcoins?.total)}</b> UpCoins <button type="button" class="ugx-btn sec" data-recargar>Recargar</button></div>` : ''}
      <div class="ugx-tabs">${(cfg.packs || []).length ? `<button type="button" class="ugx-tab ${tab === 'pack' ? 'on' : ''}" data-tab="pack">🎁 Packs</button>` : ''}${Object.entries(TIPO_TXT).map(([k, t]) => `<button type="button" class="ugx-tab ${k === tab ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
      ${tab === 'insignia' ? '<p class="ugx-sub">Muestra hasta 3 insignias junto a tu nombre. Algunas solo se ganan con misiones.</p>' : ''}
      ${tab === 'pack' ? packsHTML(mios, est) : `<div class="ugx-grid">${lista.map(c => `<div class="ugx-card ${equipado(c) ? 'eq' : ''}">${prev(c)}<b>${esc(c.nombre)}</b><small>${mios.has(c.id) ? (equipado(c) ? 'En uso' : 'Tuyo') : c.soloMision ? 'De misión' : `${fmt(c.precio)} UpCoins`}</small>${accion(c)}</div>`).join('') || '<p class="ugx-sub">Nada por aquí todavía.</p>'}</div>`}`;
    const enlazar = b => {
      b.querySelectorAll('[data-pack]').forEach(x => x.onclick = async () => {
        const p = (cfg.packs || []).find(y => y.id === x.dataset.pack), pr = precioPack(p, mios);
        if (!confirm(`¿Comprar el pack "${p.nombre}" por ${fmt(pr.precio)} UpCoins? Ahorras ${fmt(pr.lleno - pr.precio)} UC y se equipa todo.`)) return;
        const r = await pagar('/extras/pack', { id: p.id }, x);
        if (r) { fiesta(p.emoji, `¡Pack ${p.nombre} es tuyo! Ahorraste ${fmt(r.ahorro)} UC`); mio = null; await cargarMio(); estiloPropio(); window.pfxVista?.(); tienda('pack', destino); }
      });
      b.querySelectorAll('[data-usar-pack]').forEach(x => x.onclick = async () => {
        const p = (cfg.packs || []).find(y => y.id === x.dataset.usarPack), arts = p.items.map(id => cfg.cosmeticos.find(c => c.id === id)).filter(Boolean), cambio = {};
        for (const a of arts) if (a.tipo !== 'insignia') cambio[a.tipo] = a.id;
        const ins = [...(est.insignias || [])]; for (const a of arts) if (a.tipo === 'insignia' && !ins.includes(a.id) && ins.length < 3) ins.push(a.id);
        cambio.insignias = ins; x.disabled = true;
        const r = await api('/extras/estilo', { method: 'PUT', body: cambio }); x.disabled = false;
        if (!r.ok) return aviso(r.d.error || 'No se pudo guardar', 'error');
        mio.estilo = r.d.estilo; estiloPropio(); window.pfxVista?.(); tienda('pack', destino);
      });
      const otra = t => { if (window.pfxGrupo) window.pfxGrupo.tipo = t; tienda(t, destino); };
      b.querySelector('[data-recargar]')?.addEventListener('click', () => { window.pfCloseSettings?.(); window.switchTab?.('economia'); setTimeout(() => window.ecoAbrirTienda?.(), 350); });
      b.querySelectorAll('[data-tab]').forEach(x => x.onclick = () => otra(x.dataset.tab));
      b.querySelectorAll('[data-comprar]').forEach(x => x.onclick = async () => {
        const c = cfg.cosmeticos.find(y => y.id === x.dataset.comprar);
        if (!confirm(`¿Comprar "${c.nombre}" por ${fmt(c.precio)} UpCoins? Se queda en tu cuenta para siempre.`)) return;
        const r = await pagar('/extras/cosmetico', { id: c.id }, x);
        if (r) { fiesta(c.emoji, `¡${c.nombre} es tuyo!`); mio = null; await cargarMio(); estiloPropio(); window.pfxVista?.(); tienda(tab, destino); }
      });
      const guardar = async (cambio, x) => {
        x.disabled = true;
        const r = await api('/extras/estilo', { method: 'PUT', body: cambio });
        x.disabled = false;
        if (!r.ok) return aviso(r.d.error || 'No se pudo guardar', 'error');
        mio.estilo = r.d.estilo; estiloPropio(); window.pfxVista?.(); tienda(tab, destino);
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
    };
    if (destino) { destino.innerHTML = html; enlazar(destino); }
    else hoja('✨ Estilo del perfil', html, enlazar);
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
  // ── Tarjetas de creador: lo que compró en "Estilo" se ve donde aparece su nombre ──
  const cacheTarj = new Map();
  async function tarjetas(nombres) {
    const faltan = [...new Set(nombres.map(n => String(n || '').toLowerCase()))].filter(n => n && !cacheTarj.has(n));
    if (faltan.length) {
      try { const r = await api('/usuarios/tarjetas?u=' + encodeURIComponent(faltan.slice(0, 40).join(','))); if (r.ok) for (const n of faltan) cacheTarj.set(n, r.d.tarjetas?.[n] || null); } catch (_) {}
    }
    return Object.fromEntries(nombres.map(n => [String(n).toLowerCase(), cacheTarj.get(String(n).toLowerCase()) || null]));
  }
  const fotoOk = u => /^https:\/\//.test(u || '');
  function pintarAvatar(el, t, letra) {
    if (!el) return;
    if (t && fotoOk(t.avatar)) { el.textContent = ''; el.style.backgroundImage = `url("${String(t.avatar).replace(/"/g, '%22')}")`; el.classList.add('ugs-av-foto'); }
    else { el.style.backgroundImage = ''; el.classList.remove('ugs-av-foto'); if (letra) el.textContent = letra; }
    el.classList.add('ugs-av-pos');
    aplicarEstilo(t?.estilo || {}, { avatar: el });
  }
  async function pintarAutor(item) {
    const card = document.getElementById('ds-author'); if (!card || !item?.usuario) return;
    const u = String(item.usuario).toLowerCase();
    card.dataset.u = u;
    card.className = card.className.replace(/\bugs-f-\S+\b|\bugs-autor-pro\b/g, '').trim();
    card.querySelector('.ugs-ins-autor')?.remove();
    await cargarCfg();
    const t = (await tarjetas([u]))[u];
    if (card.dataset.u !== u) return;   // se abrió otra publicación mientras cargaba
    pintarAvatar(document.getElementById('ds-av-letter'), t);
    const nombre = document.getElementById('ds-author-name');
    if (nombre) { let n = nombre.querySelector('.an-n'); if (!n) { nombre.innerHTML = nombre.innerHTML.replace(/^@([^<\s]+)/, '<span class="an-n">@$1</span>'); n = nombre.querySelector('.an-n'); } aplicarEstilo(t?.estilo || {}, { nombre: n }); }
    if (!t) return;
    const est = t.estilo || {};
    if (est.fondo) card.classList.add('ugs-f-' + est.fondo, 'ugs-autor-pro');
    const sub = card.querySelector('.author-sub');
    if (sub) sub.textContent = `${t.seguidores ? fmt(t.seguidores) + ' seguidor' + (t.seguidores === 1 ? '' : 'es') + ' · ' : ''}Ver perfil completo`;
    if ((est.insignias || []).length || t.premium) {
      const ins = document.createElement('div'); ins.className = 'ugs-ins-autor';
      ins.innerHTML = insigniasHTML(est.insignias) + (t.premium ? '<span class="ugs-ins"><span>⭐ Premium</span></span>' : '');
      card.querySelector('.author-info')?.appendChild(ins);
    }
  }
  async function estilizarComentarios(lista) {
    const filas = [...(lista?.querySelectorAll('.comment-item[data-u]') || [])]; if (!filas.length) return;
    await cargarCfg();
    const ts = await tarjetas(filas.map(f => f.dataset.u));
    for (const f of filas) {
      const t = ts[f.dataset.u]; if (!t) continue;
      pintarAvatar(f.querySelector('.comment-avatar'), t);
      aplicarEstilo(t.estilo || {}, { nombre: f.querySelector('.cu-n') });
      const ins = (t.estilo?.insignias || []).slice(0, 1);
      if (ins.length && !f.querySelector('.ugs-ins')) f.querySelector('.comment-user')?.insertAdjacentHTML('beforeend', ' ' + insigniasHTML(ins));
    }
  }

  async function alAbrirDetalle(item) {
    pintarAutor(item);
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

  window.UGX = { precio, activo, cargarCfg, cargarMio, hub, referidos, promoLive, tarjetas, estilizarComentarios, pintarAvatar, misiones, tienda, regalar, apoyar, alAbrirDetalle, prioridad, faltan, aplicarEstilo, insigniasHTML, clasesMarco,
    hoja, cerrarHoja, pagar, fiesta, get cfg() { return cfg; } };
})();
