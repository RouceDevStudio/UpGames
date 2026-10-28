/* ══════════════════════════════════════════════════════════════════
   UpGames Live — directorio, reproductor, chat, regalos y estudio.
   Video:  'p2p'      → WebRTC directo del creador a cada espectador
           'mediamtx' → servidor de medios (HLS para ver, WHIP/OBS para emitir)
   ══════════════════════════════════════════════════════════════════ */
'use strict';
(() => {
const API   = (window.UG_CONFIG && window.UG_CONFIG.API_URL) || 'https://upgames-production.up.railway.app';
const ME    = (localStorage.getItem('user_admin') || '').toLowerCase();
const TOKEN = localStorage.getItem('token') || '';
const Q     = new URLSearchParams(location.search);
const $     = id => document.getElementById(id);
const app   = $('app');
const esc   = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt   = n => { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n); };
const usd   = n => '$' + (Math.round((+n || 0) * 100) / 100).toFixed(2);
const uid   = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
const dur   = ms => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const hue   = s => { let h = 0; for (const ch of s || 'u') h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
function cld(url, t) {
  const u = String(url || '');
  if (!/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(u)) return u;
  if (/\/image\/upload\/(?!v\d+\/)[a-z]{1,3}_[^/]*\//.test(u)) return u;
  return u.replace('/image/upload/', `/image/upload/${t}/`);
}
function avatar(user, url, cls = 'av') {
  if (url && /^https:\/\//.test(url)) return `<img class="${cls}" src="${esc(cld(url, 'c_fill,g_face,w_160,h_160,q_auto,f_auto'))}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;${cls}&quot;>${esc((user || '?')[0].toUpperCase())}</div>'">`;
  return `<div class="${cls}" style="background:linear-gradient(135deg,hsl(${hue(user)} 70% 55%),hsl(${(hue(user) + 50) % 360} 75% 45%))">${esc((user || '?')[0].toUpperCase())}</div>`;
}
let toastT;
function toast(msg, ms = 2800) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms);
}
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(opts.headers || {}) };
  const r = await fetch(API + path, { ...opts, headers, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && TOKEN) {
    try { localStorage.removeItem('token'); localStorage.removeItem('user_admin'); } catch (_) {}
    toast('Tu sesión expiró. Inicia sesión de nuevo'); setTimeout(() => location.replace('../index.html'), 1600);
  }
  if (!r.ok || d.success === false) { const e = new Error(d.error || 'Error de conexión'); e.status = r.status; e.data = d; throw e; }
  return d;
}
// Login que devuelve al mismo live (o al directorio) al terminar
const urlLogin = () => `../index.html?volver=${encodeURIComponent('./public/live.html' + location.search.replace(/[^\w=&%.~+?-]/g, ''))}`;
const irLogin = () => { location.href = urlLogin(); };
// Deja en el log del servidor fallos que solo ocurren en el dispositivo del usuario
const diag = (tipo, nombre, mensaje, contexto = '') => {
  try { fetch(API + '/live/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo, nombre, mensaje: String(mensaje).slice(0, 240), contexto }), keepalive: true }).catch(() => {}); } catch (_) {}
};

/* ══════════════ Estado global ══════════════ */
let CFG = null;
let socket = null;
let monedas = 0;
const cleanup = [];

function conectar() {
  if (socket) return socket;
  // WebSocket primero; si la red lo bloquea (algunas redes móviles/corporativas), long-polling HTTP
  socket = io(API, { transports: ['websocket', 'polling'], tryAllTransports: true, auth: { token: TOKEN }, reconnectionDelayMax: 6000 });
  return socket;
}
async function cargarConfig() {
  if (CFG) return CFG;
  CFG = await api('/live/config');
  return CFG;
}
async function refrescarMonedas() {
  if (!TOKEN) return;
  try { const d = await api('/monedas/saldo'); monedas = d.monedas; $('coins-n').textContent = fmt(monedas); return d; } catch (_) {}
}

/* Cabecera: su altura real alimenta el video fijo del móvil (--top-h) */
const medirTop = () => document.documentElement.style.setProperty('--top-h', document.querySelector('.top').offsetHeight + 'px');
medirTop(); window.addEventListener('resize', medirTop);
/* Cabecera */
$('btn-back').onclick = () => { if (Q.has('u') || Q.has('estudio')) location.href = './live.html'; else location.href = './biblioteca.html'; };
$('btn-golive').onclick = () => { TOKEN ? (location.href = './live.html?estudio=1') : irLogin(); };
if (TOKEN) { $('btn-coins').hidden = false; $('btn-coins').onclick = () => abrirMonedas(); refrescarMonedas(); }

/* ══════════════ 1) Directorio ══════════════ */
async function vistaDirectorio() {
  $('btn-golive').hidden = false;
  document.title = 'En vivo · UpGames';
  app.innerHTML = `
    <section class="dir-hero">
      <div><h1>🔴 En vivo ahora</h1><p>Gameplays en directo de la comunidad. Mira, chatea y apoya con regalos.</p></div>
    </section>
    <div class="grid" id="dir-grid">${'<div class="skel"></div>'.repeat(4)}</div>`;
  const pintar = async () => {
    try {
      const { lives } = await api('/live/activos');
      const g = $('dir-grid'); if (!g) return;
      if (!lives.length) {
        g.outerHTML = `<div class="empty glass" id="dir-grid"><div class="big">📡</div><h2>Nadie está transmitiendo ahora</h2><p>Sé el primero: comparte tu pantalla y juega en directo con tu comunidad.</p><button class="btn btn-live" onclick="document.getElementById('btn-golive').click()"><ion-icon name="radio"></ion-icon> Ir en vivo</button></div>`;
        return;
      }
      if (g.className !== 'grid') g.outerHTML = '<div class="grid" id="dir-grid"></div>';
      $('dir-grid').innerHTML = lives.map(l => `
        <a class="card glass" href="./live.html?u=${encodeURIComponent(l.creador)}">
          <div class="card-thumb">
            ${l.avatar && /^https:\/\//.test(l.avatar) ? `<div class="bgblur" style="background-image:url('${esc(cld(l.avatar, 'w_400,q_auto,f_auto'))}')"></div>` : ''}
            ${avatar(l.creador, l.avatar)}
            <span class="pill-live">EN VIVO</span>
            <span class="viewers"><ion-icon name="eye"></ion-icon> ${fmt(l.espectadores)}</span>
          </div>
          <div class="card-body">
            <h3>${esc(l.titulo)}</h3>
            <div class="meta"><b>@${esc(l.creador)}</b>${l.verificado ? '<ion-icon class="verif" name="checkmark-circle"></ion-icon>' : ''}${l.categoria ? `<span class="tag">${esc(l.categoria)}</span>` : ''}<span>· ${dur(Date.now() - new Date(l.inicio))}</span></div>
          </div>
        </a>`).join('');
    } catch (e) { const g = $('dir-grid'); if (g) g.outerHTML = `<div class="empty glass" id="dir-grid"><div class="big">⚠️</div><h2>No se pudo cargar</h2><p>${esc(e.message)}</p></div>`; }
  };
  await pintar();
  const t = setInterval(() => { if (!document.hidden) pintar(); }, 20000);
  cleanup.push(() => clearInterval(t));
}

/* ══════════════ Chat (compartido por espectador y estudio) ══════════════ */
/** Nivel visual del Super Chat según el monto (1 a 4). */
const nivelSC = m => m >= 200 ? 4 : m >= 100 ? 3 : m >= 50 ? 2 : 1;

function crearChat(raiz, { liveId, esHost, alEnviar }) {
  raiz.innerHTML = `
    <div class="side-tabs"><button class="on" data-t="chat">Chat</button><button data-t="top">🏆 Top regalos</button></div>
    <div class="sc-pins" id="sc-pins"></div>
    <div class="chat" id="chat-list" aria-live="polite"></div>
    <div class="top-list" id="top-list" hidden></div>
    <button class="newmsgs" id="chat-new" hidden>Mensajes nuevos ↓</button>
    ${TOKEN ? `<form class="chat-form" id="chat-form" autocomplete="off">
        <input id="chat-in" maxlength="200" placeholder="${esHost ? 'Habla con tu comunidad…' : 'Escribe un mensaje…'}" aria-label="Mensaje">
        ${esHost ? '' : '<button type="button" class="heart-btn" id="btn-like" aria-label="Me gusta"><ion-icon name="heart"></ion-icon></button>'}
        <button class="send" aria-label="Enviar"><ion-icon name="send"></ion-icon></button>
      </form>` : `<div class="chat-login"><a href="${urlLogin()}">Inicia sesión</a> para chatear y enviar regalos</div>`}`;
  const list = raiz.querySelector('#chat-list'), nuevo = raiz.querySelector('#chat-new'), top = raiz.querySelector('#top-list'), pins = raiz.querySelector('#sc-pins');
  raiz.querySelectorAll('.side-tabs button').forEach(b => b.onclick = () => {
    raiz.querySelectorAll('.side-tabs button').forEach(x => x.classList.toggle('on', x === b));
    list.hidden = b.dataset.t !== 'chat'; top.hidden = b.dataset.t !== 'top'; nuevo.hidden = true;
  });
  const abajo = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.addEventListener('scroll', () => { if (abajo()) nuevo.hidden = true; }, { passive: true });
  nuevo.onclick = () => { list.scrollTop = list.scrollHeight; nuevo.hidden = true; };
  function meter(el) {
    const pegado = abajo();
    list.appendChild(el);
    while (list.children.length > 200) list.firstChild.remove();
    if (pegado) list.scrollTop = list.scrollHeight; else if (!list.hidden) nuevo.hidden = false;
  }
  // Super Chat: fijado arriba del chat durante unos segundos según el monto (m.sc.seg)
  function fijar(m) {
    const resta = m.ts + m.sc.seg * 1000 - Date.now();
    if (resta <= 0 || !pins || pins.querySelector(`[data-id="${CSS.escape(m.id)}"]`)) return;
    const p = document.createElement('div'); p.className = `sc-pin sc-t${nivelSC(m.sc.monto)}`; p.dataset.id = m.id;
    p.innerHTML = `<b class="${m.c ? 'ugs-c-' + esc(m.c) : ''}">@${esc(m.u)}</b><span class="sc-m">🪙 ${fmt(m.sc.monto)}</span><div>${esc(m.t)}</div><i style="animation-duration:${resta}ms"></i>`;
    pins.prepend(p);
    while (pins.children.length > 3) pins.lastChild.remove();
    setTimeout(() => p.remove(), resta);
  }
  function add(m) {
    const el = document.createElement('div');
    el.className = 'msg' + (m.sc ? ` superchat sc-t${nivelSC(m.sc.monto)}` : ''); el.dataset.id = m.id; el.dataset.u = m.u;
    const color = m.c ? '' : `color:hsl(${hue(m.u)} 75% 68%)`;   // color comprado con UpCoins: clase ugs-c-*
    if (m.sc) fijar(m);
    el.innerHTML = `${m.av && /^https:\/\//.test(m.av) ? `<img class="mav" src="${esc(cld(m.av, 'c_fill,w_48,h_48,q_auto,f_auto'))}" alt="">` : `<div class="mav" style="background:hsl(${hue(m.u)} 60% 45%)">${esc(m.u[0].toUpperCase())}</div>`}
      <div class="mb">${m.sc ? `<span class="sc-tag">💬 Super Chat · 🪙 ${fmt(m.sc.monto)}</span>` : ''}${m.host ? '<span class="badge-host">CREADOR</span>' : ''}<span class="mu ${m.c ? 'ugs-c-' + esc(m.c) : ''}" style="${color}">${esc(m.u)}${m.v ? ' <ion-icon class="verif" name="checkmark-circle"></ion-icon>' : ''}${m.pase ? ' <span class="badge-pase" title="Es Premium">⭐</span>' : ''}</span>${esc(m.t)}</div>
      ${esHost && !m.host ? `<div class="mod"><button data-a="borrar" title="Borrar mensaje"><ion-icon name="trash-outline"></ion-icon></button><button data-a="silenciar" title="Silenciar a @${esc(m.u)}"><ion-icon name="volume-mute-outline"></ion-icon></button></div>` : ''}`;
    el.querySelector('.mu').onclick = () => window.open(`./perfil-publico.html?u=${encodeURIComponent(m.u)}`, '_blank');
    el.querySelectorAll('.mod button').forEach(b => b.onclick = () => {
      if (b.dataset.a === 'borrar') socket.emit('mod', { liveId, accion: 'borrar', id: m.id });
      else if (confirm(`¿Silenciar a @${m.u} durante este live?`)) socket.emit('mod', { liveId, accion: 'silenciar', usuario: m.u });
    });
    meter(el);
  }
  function sys(texto, cls = 'sys') { const el = document.createElement('div'); el.className = 'msg ' + cls; el.innerHTML = texto; meter(el); }
  function regalo(g) { sys(`<div class="mb"><b>@${esc(g.de)}</b> envió ${esc(g.regalo.emoji)} <b>${esc(g.regalo.nombre)}</b>${g.cantidad > 1 ? ` ×${g.cantidad}` : ''} · <span style="color:var(--gold)">🪙 ${fmt(g.total)}</span></div>`, 'gift-msg'); }
  function pintarTop(lista) {
    top.innerHTML = lista?.length ? lista.map((t, i) => `<div class="top-item"><span class="pos">${['🥇', '🥈', '🥉'][i] || i + 1}</span>${avatar(t.usuario, '', 'mav')}<span class="u">@${esc(t.usuario)}</span><span class="m">🪙 ${fmt(t.monedas)}</span></div>`).join('')
      : '<div class="empty" style="padding:30px 10px"><div class="big">🎁</div><p>Aún no hay regalos en este live.<br>¡El primero se lleva el 🥇!</p></div>';
  }
  const form = raiz.querySelector('#chat-form');
  if (form) form.onsubmit = e => {
    e.preventDefault();
    const inp = raiz.querySelector('#chat-in'), t = inp.value.trim();
    if (!t) return;
    socket.emit('chat', { liveId, texto: t }, r => { if (r && !r.ok && r.error) toast(r.error); });
    inp.value = ''; alEnviar?.();
  };
  socket.on('chat:borrado', ({ id }) => list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove());
  socket.on('chat:silenciado', ({ u }) => { list.querySelectorAll(`[data-u="${CSS.escape(u)}"]`).forEach(x => x.remove()); if (u === ME) toast('El creador te silenció en este live'); });
  pintarTop([]);
  return { add, sys, regalo, pintarTop, likeBtn: raiz.querySelector('#btn-like') };
}

/* ══════════════ Animaciones de regalos ══════════════ */
function capaRegalos(capa) {
  const cola = []; let activo = false;
  function siguiente() {
    if (!cola.length) { activo = false; return; }
    activo = true;
    const g = cola.shift();
    const b = document.createElement('div'); b.className = 'gift-banner';
    b.innerHTML = `${avatar(g.de, g.av, 'mav')}<div><b>@${esc(g.de)}</b><small>envió ${esc(g.regalo.nombre)}</small></div><span class="e">${esc(g.regalo.emoji)}</span>${g.cantidad > 1 ? `<span class="x">×${g.cantidad}</span>` : ''}`;
    capa.appendChild(b);
    if (g.total >= 1000) { const x = document.createElement('div'); x.className = 'gift-burst'; x.textContent = g.regalo.emoji; capa.appendChild(x); setTimeout(() => x.remove(), 2300); }
    setTimeout(() => { b.remove(); siguiente(); }, 3300);
  }
  return {
    regalo(g) { if (cola.length < 30) cola.push(g); if (!activo) siguiente(); },
    corazon() {
      const h = document.createElement('div'); h.className = 'heart';
      h.textContent = ['❤️', '💖', '💗', '🧡', '💜'][Math.floor(Math.random() * 5)];
      h.style.setProperty('--dx', `${Math.round(Math.random() * 80 - 40)}px`);
      capa.appendChild(h); setTimeout(() => h.remove(), 1900);
    },
  };
}

/* ══════════════ Burbujas de chat sobre el video (estilo TikTok) ══════════════ */
const esMovil = () => matchMedia('(max-width: 760px)').matches;
const prefBurbujas = () => { try { const v = localStorage.getItem('ug_live_ov'); return v === null ? null : v === '1'; } catch (_) { return null; } };
function burbujas(el, max = 6) {
  function poner(html, cls, attrs = {}) {
    const b = document.createElement('div');
    b.className = 'ovb ' + (cls || '');
    for (const [k, v] of Object.entries(attrs)) b.dataset[k] = v;
    b.innerHTML = html;
    el.appendChild(b);
    while (el.children.length > max) el.firstChild.remove();
    // Se desvanecen solas: el video nunca queda tapado por comentarios viejos
    setTimeout(() => { b.classList.add('fuera'); setTimeout(() => b.remove(), 650); }, 20000);
  }
  const mini = (u, av) => av && /^https:\/\//.test(av)
    ? `<img class="mav" src="${esc(cld(av, 'c_fill,w_48,h_48,q_auto,f_auto'))}" alt="">`
    : `<span class="mav" style="background:hsl(${hue(u)} 60% 45%)">${esc((u || '?')[0].toUpperCase())}</span>`;
  return {
    add: m => poner(`${mini(m.u, m.av)}<div><b class="${m.c ? 'ugs-c-' + esc(m.c) : ''}" style="${m.c ? '' : `color:hsl(${hue(m.u)} 85% 76%)`}">${esc(m.u)}${m.pase ? ' ⭐' : ''}${m.sc ? ` · 🪙 ${fmt(m.sc.monto)}` : ''}</b>${esc(m.t)}</div>`, m.sc ? `superchat sc-t${nivelSC(m.sc.monto)}` : m.host ? 'host' : '', { id: m.id, u: m.u }),
    regalo: g => poner(`<span style="font-size:1.15rem;line-height:1">${esc(g.regalo.emoji)}</span><div><b>${esc(g.de)}</b>envió ${esc(g.regalo.nombre)}${g.cantidad > 1 ? ` ×${g.cantidad}` : ''}</div>`, 'regalo'),
    sys: t => poner(`<div>${esc(t)}</div>`, 'sys'),
    borrar: id => el.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove(),
    silenciar: u => el.querySelectorAll(`[data-u="${CSS.escape(u)}"]`).forEach(x => x.remove()),
  };
}
// Mostrar/ocultar las burbujas (preferencia guardada; por defecto sí en pantallas sin chat lateral)
function interruptorBurbujas(pw, botones) {
  const pintar = () => { const on = !pw.classList.contains('sin-ov'); botones.forEach(b => b && b.classList.toggle('apagado', !on)); };
  pw.classList.toggle('sin-ov', !(prefBurbujas() ?? innerWidth <= 1020));
  pintar();
  botones.forEach(b => b && (b.onclick = e => {
    e.stopPropagation();
    pw.classList.toggle('sin-ov');
    try { localStorage.setItem('ug_live_ov', pw.classList.contains('sin-ov') ? '0' : '1'); } catch (_) {}
    pintar();
  }));
  // Sin preferencia del usuario: en pantalla completa se ven (el chat lateral queda oculto)
  return { segunPantalla(inm) { if (prefBurbujas() === null) { pw.classList.toggle('sin-ov', !(inm || innerWidth <= 1020)); pintar(); } } };
}

/* ══════════════ Modo inmersivo (video a pantalla completa con todo encima) ══════════════ */
// En móvil es el modo por defecto. "Atrás" del teléfono sale del modo, no de la página.
function modoInmersivo(pw, alCambiar) {
  let on = false;
  const aplicar = v => {
    on = v; pw.classList.toggle('inm', v); document.body.classList.toggle('inm-on', v);
    if (!v && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    alCambiar?.(v);
  };
  const entrar = () => {
    if (on) return;
    aplicar(true);
    history.pushState({ ugInm: 1 }, '');
    // En PC además pantalla completa real; en móvil basta el modo fijo (iOS no deja hacer fullscreen de un div)
    if (!esMovil() && pw.requestFullscreen) pw.requestFullscreen().catch(() => {});
  };
  const salir = () => { if (!on) return; if (history.state?.ugInm) history.back(); else aplicar(false); };
  const alVolver = () => { if (on) aplicar(false); };
  const alSalirFS = () => { if (!document.fullscreenElement && on && !esMovil()) salir(); };
  window.addEventListener('popstate', alVolver);
  document.addEventListener('fullscreenchange', alSalirFS);
  cleanup.push(() => { window.removeEventListener('popstate', alVolver); document.removeEventListener('fullscreenchange', alSalirFS); document.body.classList.remove('inm-on'); });
  return { entrar, salir, alternar: () => (on ? salir() : entrar()), get activo() { return on; } };
}

/* ══════════════ Reproductores ══════════════ */
// WebRTC directo: el creador nos envía una oferta por Socket.IO
function reproductorP2P(video, liveId, estado) {
  let pc = null, host = null, cadena = Promise.resolve(), reintento = null, fallos = 0;
  const cerrar = () => { try { pc?.close(); } catch (_) {} pc = null; };
  async function manejar({ de, data }) {
    if (data.sdp?.type === 'offer') {
      cerrar(); host = de;
      pc = new RTCPeerConnection({ iceServers: CFG.ice });
      pc.ontrack = e => { if (video.srcObject !== e.streams[0]) { video.srcObject = e.streams[0]; video.play().catch(() => {}); } };
      pc.onicecandidate = e => { if (e.candidate) socket.emit('p2p:senal', { liveId, para: host, data: { candidate: e.candidate } }); };
      pc.onconnectionstatechange = () => {
        const s = pc?.connectionState;
        if (s === 'connected') { estado('ok'); clearTimeout(reintento); fallos = 0; }
        if (s === 'failed' && ++fallos === 3) {
          // Sin servidor TURN, algunas redes (4G con NAT estricto, redes corporativas) no permiten video directo
          diag('video', 'ice_fallo', 'El video P2P no logró conectar tras 3 intentos', navigator.connection?.effectiveType || '');
        }
        if (s === 'failed' || s === 'disconnected') {
          estado('cargando', fallos >= 3
            ? 'Tu red no permite conectar el video directo con este creador (pasa en algunas redes móviles o de empresa). Prueba con otra red (Wi-Fi ↔ datos); el chat y los regalos siguen funcionando.'
            : 'Reconectando video…');
          clearTimeout(reintento);
          reintento = setTimeout(() => { if (!pc || pc.connectionState !== 'connected') socket.emit('p2p:solicitar', { liveId }); }, s === 'failed' ? 500 : 5000);
        }
      };
      await pc.setRemoteDescription(data.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      socket.emit('p2p:senal', { liveId, para: host, data: { sdp: pc.localDescription } });
    } else if (data.candidate && pc && de === host) {
      await pc.addIceCandidate(data.candidate).catch(() => {});
    }
  }
  socket.on('p2p:senal', m => { cadena = cadena.then(() => manejar(m)).catch(e => console.warn('[live] señal', e)); });
  return { cerrar };
}
// HLS desde el servidor de medios
async function reproductorHLS(video, url, estado) {
  let hls = null, intentos = 0;
  const iniciar = () => {
    if (video.canPlayType('application/vnd.apple.mpegurl') && !window.Hls) { video.src = url; video.play().catch(() => {}); return; }
    hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2, maxLiveSyncPlaybackRate: 1.5, backBufferLength: 30 });
    hls.loadSource(url); hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { intentos = 0; video.play().catch(() => {}); });
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal) return;
      estado('cargando', 'Esperando la señal del creador…');
      hls.destroy();
      setTimeout(iniciar, Math.min(15000, 2000 * ++intentos));
    });
  };
  if (!video.canPlayType('application/vnd.apple.mpegurl')) {
    await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js'; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  }
  video.addEventListener('playing', () => estado('ok'));
  iniciar();
  return { cerrar: () => hls?.destroy() };
}

/* ══════════════ 2) Espectador ══════════════ */
async function vistaEspectador(usuario) {
  $('btn-golive').hidden = !TOKEN || usuario === ME;
  app.innerHTML = `<div class="empty glass" style="margin-top:20px"><div class="spin" style="margin:0 auto 14px;width:36px;height:36px;border-radius:50%;border:3px solid rgba(255,255,255,.1);border-top-color:var(--live);animation:rot .9s linear infinite"></div><p>Cargando canal…</p></div>`;
  let canal;
  try { await cargarConfig(); canal = await api(`/live/canal/${encodeURIComponent(usuario)}`); }
  catch (e) { app.innerHTML = `<div class="empty glass" style="margin-top:20px"><div class="big">😕</div><h2>${esc(e.message)}</h2><p></p><a class="btn btn-ghost" href="./live.html">Ver otros lives</a></div>`; return; }
  const c = canal.creador;
  document.title = `@${c.usuario} · En vivo · UpGames`;

  if (!canal.live) {
    app.innerHTML = `<div class="empty glass" style="margin-top:20px"><div class="off-av">${avatar(c.usuario, c.avatar)}</div>
      <h2>@${esc(c.usuario)} no está en vivo</h2>
      <p>${canal.ultimo ? `Su último directo fue “${esc(canal.ultimo.titulo)}” · ${new Date(canal.ultimo.inicio).toLocaleDateString()}` : 'Aún no ha hecho ningún directo.'}<br>Te avisaremos cuando empiece si lo sigues.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn btn-ghost" href="./perfil-publico.html?u=${encodeURIComponent(c.usuario)}">Ver perfil</a><a class="btn btn-live" href="./live.html">Ver quién está en vivo</a></div></div>`;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try { const d = await api(`/live/canal/${encodeURIComponent(usuario)}`); if (d.live) { clearInterval(t); vistaEspectador(usuario); } } catch (_) {}
    }, 15000);
    cleanup.push(() => clearInterval(t));
    return;
  }

  const L0 = canal.live, liveId = String(L0._id);
  let inicio = new Date(L0.inicio).getTime();
  app.innerHTML = `
  <div class="stage">
    <section>
      <div class="player-wrap" id="pw">
        <video id="vid" playsinline autoplay muted></video>
        <div class="gift-layer" id="gl"></div>
        <div class="p-top"><span class="pill-live">EN VIVO</span><span class="chip-dark"><ion-icon name="eye"></ion-icon> <span id="v-n">${fmt(L0.espectadores)}</span></span><span class="chip-dark timer" id="v-t">0:00</span></div>
        <div class="p-overlay" id="pov"><div class="spin"></div><p id="pov-t">Conectando con el directo…</p></div>
        <div class="ov-chat" id="ov-chat" aria-hidden="true"></div>
        <div class="ov-head">
          ${avatar(c.usuario, c.avatar)}
          <div class="t"><b>@${esc(c.usuario)}${c.verificado ? ' <ion-icon class="verif" name="checkmark-circle"></ion-icon>' : ''}</b><small id="ov-title">${esc(L0.titulo)}</small></div>
          <button class="ico-btn ov-x" id="ov-x" aria-label="Salir de pantalla completa"><ion-icon name="close"></ion-icon></button>
        </div>
        <div class="ov-rail">
          <button id="ov-like" aria-label="Me gusta"><span class="i">❤️</span><span id="ov-likes">${fmt(L0.likes)}</span></button>
          ${usuario === ME ? '' : '<button id="ov-gift" aria-label="Enviar regalo"><span class="i">🎁</span>Regalo</button>'}
          <button id="ov-share" aria-label="Compartir"><span class="i"><ion-icon name="share-social"></ion-icon></span>Compartir</button>
          <button id="ov-sound" aria-label="Sonido"><span class="i" id="ov-sound-i">🔇</span>Sonido</button>
          <button id="ov-toggle" aria-label="Mostrar u ocultar comentarios"><span class="i">💬</span>Chat</button>
        </div>
        ${TOKEN ? `<form class="ov-bar" id="ov-form" autocomplete="off"><input id="ov-in" maxlength="200" placeholder="Agrega un comentario…" enterkeyhint="send" aria-label="Comentario"><button class="send" aria-label="Enviar"><ion-icon name="send"></ion-icon></button></form>`
                : `<div class="ov-bar"><a href="${urlLogin()}">Inicia sesión para comentar y enviar regalos</a></div>`}
        <button class="unmute" id="unmute" hidden><ion-icon name="volume-high"></ion-icon> Activar sonido</button>
        <div class="p-ctrls">
          <button class="ico-btn" id="b-mute" aria-label="Silenciar"><ion-icon name="volume-mute"></ion-icon></button>
          <input type="range" class="vol" id="vol" min="0" max="1" step="0.05" value="1" aria-label="Volumen">
          <div class="spacer"></div>
          <button class="ico-btn" id="b-ov" aria-label="Comentarios sobre el video" title="Comentarios sobre el video"><ion-icon name="chatbubbles"></ion-icon></button>
          <button class="ico-btn" id="b-pip" aria-label="Imagen en imagen"><ion-icon name="albums-outline"></ion-icon></button>
          <button class="ico-btn" id="b-inmersivo" aria-label="Pantalla completa" title="Pantalla completa"><ion-icon name="expand"></ion-icon></button>
        </div>
      </div>
      <div class="info">
        ${avatar(c.usuario, c.avatar)}
        <div class="txt">
          <h1 id="v-title">${esc(L0.titulo)}</h1>
          <div class="who"><a href="./perfil-publico.html?u=${encodeURIComponent(c.usuario)}">@${esc(c.usuario)}</a>${c.verificado ? '<ion-icon class="verif" name="checkmark-circle"></ion-icon>' : ''}<span>· ${fmt(c.seguidores)} seguidores</span>${L0.categoria ? `<span class="tag">${esc(L0.categoria)}</span>` : ''}</div>
          <div class="stats" style="margin-top:8px"><span><ion-icon name="heart"></ion-icon> <b id="v-likes">${fmt(L0.likes)}</b></span><span><ion-icon name="gift"></ion-icon> <b id="v-gifts">${fmt(L0.regalos)}</b></span></div>
        </div>
        <div class="acts"><button class="btn btn-ghost" id="b-share"><ion-icon name="share-social"></ion-icon> Compartir</button></div>
      </div>
      ${usuario === ME ? '' : `<div class="gifts glass">
        <div class="gifts-head"><span>🎁 Envía un regalo a @${esc(c.usuario)}</span>${TOKEN ? '<span style="display:flex;gap:6px"><button class="coins-chip sc-btn" data-superchat hidden>💬 Super Chat</button><button class="coins-chip" id="b-recargar">🪙 Recargar</button></span>' : ''}</div>
        <div class="gifts-row">${CFG.regalos.map(g => `<button class="gift" data-g="${g.id}" title="${esc(g.nombre)} · ${g.monedas} UpCoins"><span class="e">${g.emoji}</span><span class="n">${esc(g.nombre)}</span><span class="c">🪙 ${fmt(g.monedas)}</span></button>`).join('')}</div>
      </div>`}
    </section>
    <aside class="side glass" id="side"></aside>
  </div>
  ${usuario === ME ? '' : `<div class="sheet-bg" id="sheet-bg"></div>
  <div class="gift-sheet" id="gift-sheet" role="dialog" aria-label="Enviar regalo">
    <div class="grab"></div>
    <div class="gifts-head"><span>🎁 Regalo para @${esc(c.usuario)}</span>${TOKEN ? '<span style="display:flex;gap:6px"><button class="coins-chip sc-btn" data-superchat hidden>💬 Super Chat</button><button class="coins-chip" id="sheet-recargar">🪙 <span id="sheet-coins">0</span> · Recargar</button></span>' : ''}</div>
    <div class="gifts-row">${CFG.regalos.map(g => `<button class="gift" data-g="${g.id}" title="${esc(g.nombre)} · ${g.monedas} UpCoins"><span class="e">${g.emoji}</span><span class="n">${esc(g.nombre)}</span><span class="c">🪙 ${fmt(g.monedas)}</span></button>`).join('')}</div>
  </div>`}`;

  const video = $('vid'), pov = $('pov'), capa = capaRegalos($('gl')), pw = $('pw'), ov = burbujas($('ov-chat'));
  const estado = (e, txt) => { pov.hidden = e === 'ok'; if (txt) $('pov-t').textContent = txt; if (e === 'ok' && video.muted) $('unmute').hidden = false; };
  // Controles
  const sincMute = () => {
    const mudo = video.muted || !video.volume;
    $('b-mute').innerHTML = `<ion-icon name="${mudo ? 'volume-mute' : 'volume-high'}"></ion-icon>`;
    $('ov-sound-i').textContent = mudo ? '🔇' : '🔊';
    $('unmute').hidden = !video.muted || !pov.hidden;
  };
  $('unmute').onclick = () => { video.muted = false; video.play().catch(() => {}); sincMute(); };
  $('b-mute').onclick = () => { video.muted = !video.muted; sincMute(); };
  $('vol').oninput = e => { video.volume = +e.target.value; video.muted = !video.volume; sincMute(); };
  let burb = null;
  const inm = modoInmersivo(pw, on => { $('b-inmersivo').innerHTML = `<ion-icon name="${on ? 'contract' : 'expand'}"></ion-icon>`; burb?.segunPantalla(on); });
  $('b-inmersivo').onclick = e => { e.stopPropagation(); inm.alternar(); };
  $('ov-x').onclick = () => inm.salir();
  $('ov-sound').onclick = () => { video.muted = !video.muted; if (!video.muted && !video.volume) video.volume = 1; video.play().catch(() => {}); sincMute(); };
  $('ov-share').onclick = () => $('b-share').click();
  burb = interruptorBurbujas(pw, [$('b-ov'), $('ov-toggle')]);
  // Video vertical (cámara del móvil) llena la pantalla; el de PC se ve completo
  video.addEventListener('resize', () => pw.classList.toggle('vertical', video.videoHeight > video.videoWidth));
  if (esMovil()) inm.entrar();
  $('b-pip').hidden = !document.pictureInPictureEnabled;
  $('b-pip').onclick = () => (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() => {});
  pw.onclick = e => { if (e.target === video && !inm.activo) pw.classList.toggle('show-ctrls'); };
  $('b-share').onclick = async () => {
    const url = location.href.split('#')[0];
    try { if (navigator.share) await navigator.share({ title: `@${c.usuario} está en vivo en UpGames`, text: L0.titulo, url }); else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } } catch (_) {}
  };
  const reloj = setInterval(() => { const t = $('v-t'); if (t) t.textContent = dur(Date.now() - inicio); }, 1000);
  cleanup.push(() => clearInterval(reloj));

  // Tiempo real
  conectar();
  const chat = crearChat($('side'), { liveId, esHost: false });
  let reproductor = null, likes = L0.likes || 0, lleno = false;
  const unirse = () => socket.emit('unirse', { liveId, rol: 'espectador' }, async r => {
    if (!r?.ok) { finDelLive(r?.error || 'Este live terminó'); return; }
    $('v-n').textContent = fmt(r.espectadores); likes = r.likes; $('v-likes').textContent = fmt(likes);
    chat.pintarTop(r.top);
    if (!unirse.hecho) { r.chat.forEach(chat.add); r.chat.slice(-4).forEach(ov.add); chat.sys('Bienvenido al chat. Sé respetuoso 💚'); unirse.hecho = true; }
    if (!reproductor) {
      if (r.live.modo === 'mediamtx' && CFG.proveedor.hls) reproductor = await reproductorHLS(video, CFG.proveedor.hls.replace('{u}', encodeURIComponent(c.usuario)), estado);
      else reproductor = reproductorP2P(video, liveId, estado);
    }
    if (r.live.modo === 'p2p' && !r.host) estado('cargando', 'El creador se desconectó un momento. Esperando que vuelva…');
  });
  socket.on('connect', unirse);
  if (socket.connected) unirse();
  socket.on('connect_error', () => estado('cargando', 'Sin conexión con el servidor. Reintentando…'));
  socket.on('espectadores', ({ n }) => { $('v-n').textContent = fmt(n); });
  socket.on('likes', ({ total }) => { if (total > likes) for (let i = 0; i < Math.min(5, total - likes); i++) setTimeout(capa.corazon, i * 120); likes = total; $('v-likes').textContent = fmt(total); $('ov-likes').textContent = fmt(total); });
  socket.on('chat', m => { chat.add(m); ov.add(m); });
  socket.on('chat:borrado', ({ id }) => ov.borrar(id));
  socket.on('chat:silenciado', ({ u }) => ov.silenciar(u));
  socket.on('top', ({ top }) => chat.pintarTop(top));
  socket.on('regalo', g => { capa.regalo(g); chat.regalo(g); ov.regalo(g); const el = $('v-gifts'); el.textContent = fmt((parseInt(el.dataset.n || L0.regalos, 10) || 0) + g.cantidad); el.dataset.n = (parseInt(el.dataset.n || L0.regalos, 10) || 0) + g.cantidad; });
  socket.on('titulo', ({ titulo }) => { $('v-title').textContent = titulo; $('ov-title').textContent = titulo; });
  socket.on('host:desconectado', () => estado('cargando', 'El creador se desconectó un momento. Esperando que vuelva…'));
  socket.on('host:conectado', () => estado('cargando', 'El creador volvió. Reconectando video…'));
  socket.on('p2p:lleno', ({ max }) => { lleno = true; estado('cargando', `El directo está lleno (${max} espectadores en modo directo). Te conectaremos en cuanto se libere un lugar; mientras, puedes usar el chat.`); });
  socket.on('p2p:hueco', () => { if (lleno) { lleno = false; socket.emit('p2p:solicitar', { liveId }); } });
  socket.on('fin', ({ motivo }) => finDelLive(motivo));
  function finDelLive(motivo) {
    reproductor?.cerrar(); video.srcObject = null; video.removeAttribute('src');
    pov.hidden = false;
    pov.innerHTML = `<div style="font-size:2.6rem">📴</div><h2>El live terminó</h2><p>${esc(motivo || '')}</p><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><a class="btn btn-ghost" href="./perfil-publico.html?u=${encodeURIComponent(c.usuario)}">Ver perfil</a><a class="btn btn-live" href="./live.html">Más lives</a></div>`;
  }

  // Likes (botón del chat, botón lateral y doble toque sobre el video, como en TikTok)
  const darLike = () => { capa.corazon(); socket.emit('like', { liveId }); };
  if (chat.likeBtn) chat.likeBtn.onclick = darLike;
  $('ov-like').onclick = e => { e.stopPropagation(); darLike(); };
  video.addEventListener('dblclick', darLike);
  // Comentar sin salir de la pantalla completa
  const ovForm = $('ov-form');
  if (ovForm) ovForm.onsubmit = e => {
    e.preventDefault();
    const inp = $('ov-in'), t = inp.value.trim();
    if (!t) return;
    socket.emit('chat', { liveId, texto: t }, r => { if (r && !r.ok && r.error) toast(r.error); });
    inp.value = '';
  };
  // Hoja de regalos (modo inmersivo)
  const hoja = $('gift-sheet'), fondo = $('sheet-bg');
  const abrirHoja = abrir => { if (!hoja) return; hoja.classList.toggle('on', abrir); fondo.classList.toggle('on', abrir); if (abrir && $('sheet-coins')) $('sheet-coins').textContent = fmt(monedas); };
  if ($('ov-gift')) $('ov-gift').onclick = e => { e.stopPropagation(); if (!TOKEN) return irLogin(); abrirHoja(true); };
  if (fondo) fondo.onclick = () => abrirHoja(false);
  const recargar = () => { abrirHoja(false); abrirMonedas(); };
  $('b-recargar') && ($('b-recargar').onclick = recargar);
  // ── Super Chat (usa la hoja y el cobro de upgames-extras.js) ──
  window.UGX?.cargarCfg().then(cfgX => {
    if (!cfgX?.activo?.superchat || !TOKEN) return;
    document.querySelectorAll('[data-superchat]').forEach(b => { b.hidden = false; b.onclick = () => superChat(cfgX.precios.superchat); });
  });
  function superChat(montos) {
    let monto = montos[0];
    const seg = m => m >= 200 ? '5 min' : m >= 100 ? '2 min' : m >= 50 ? '1 min' : '30 s';
    window.UGX.hoja('💬 Super Chat', `<p class="ugx-sub">Tu mensaje sale destacado y fijado arriba del chat. @${esc(c.usuario)} recibe el 25 % como ganancia.</p>
      <input class="ugx-in" id="sc-texto" maxlength="200" placeholder="Escribe tu mensaje…" autocomplete="off">
      <div class="ugx-montos">${montos.map(m => `<button type="button" class="ugx-monto ${m === monto ? 'on' : ''}" data-m="${m}">🪙 ${fmt(m)}<small>fijado ${seg(m)}</small></button>`).join('')}</div>
      <button type="button" class="ugx-btn oro" id="sc-ok" style="width:100%">Enviar Super Chat · 🪙 <span>${fmt(monto)}</span></button>`, b => {
      b.querySelectorAll('[data-m]').forEach(x => x.onclick = () => { monto = +x.dataset.m; b.querySelectorAll('[data-m]').forEach(y => y.classList.toggle('on', y === x)); b.querySelector('#sc-ok span').textContent = fmt(monto); });
      b.querySelector('#sc-ok').onclick = async e => {
        const texto = b.querySelector('#sc-texto').value.trim();
        if (!texto) return toast('Escribe tu mensaje');
        const r = await window.UGX.pagar(`/live/${liveId}/superchat`, { monto, texto }, e.currentTarget);
        if (!r) return;
        window.UGX.cerrarHoja();
        if (typeof r.monedas === 'number') { monedas = r.monedas; $('coins-n') && ($('coins-n').textContent = fmt(monedas)); $('sheet-coins') && ($('sheet-coins').textContent = fmt(monedas)); }
        toast('💬 ¡Super Chat enviado!');
      };
    });
  }
  // Misión "Mira un live": cuenta tras 2 minutos viendo (el servidor valida el live)
  if (TOKEN && usuario !== ME) {
    const tMision = setTimeout(() => { fetch(`${API}/misiones/evento`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ tipo: 'ver_live', liveId }) }).catch(() => {}); }, 125000);
    cleanup.push(() => clearTimeout(tMision));
  }
  $('sheet-recargar') && ($('sheet-recargar').onclick = recargar);
  // Regalos: el mismo envío para el panel y para la hoja
  document.querySelectorAll('.gift').forEach(b => b.onclick = async () => {
    if (!TOKEN) return irLogin();
    const g = CFG.regalos.find(x => x.id === b.dataset.g);
    if (monedas < g.monedas) { toast(`Necesitas ${g.monedas} UpCoins para ${g.nombre}`); recargar(); return; }
    b.classList.add('sending');
    try {
      const d = await api(`/live/${liveId}/regalo`, { method: 'POST', body: { regaloId: g.id, cantidad: 1, clave: uid() } });
      if (typeof d.monedas === 'number') { monedas = d.monedas; $('coins-n').textContent = fmt(monedas); if ($('sheet-coins')) $('sheet-coins').textContent = fmt(monedas); }
      if (hoja?.contains(b)) abrirHoja(false);
    } catch (e) {
      if (e.status === 402) { toast('No tienes UpCoins suficientes'); recargar(); }
      else toast(e.message);
    } finally { b.classList.remove('sending'); }
  });
  cleanup.push(() => reproductor?.cerrar());
}

/* ══════════════ 3) Estudio del creador ══════════════ */
const CALIDADES = {
  '720p30':  { w: 1280, h: 720,  fps: 30, kbps: 2500, nombre: '720p · 30 fps' },
  '720p60':  { w: 1280, h: 720,  fps: 60, kbps: 3500, nombre: '720p · 60 fps' },
  '1080p30': { w: 1920, h: 1080, fps: 30, kbps: 4500, nombre: '1080p · 30 fps' },
  '1080p60': { w: 1920, h: 1080, fps: 60, kbps: 6000, nombre: '1080p · 60 fps' },
  '480p30':  { w: 854,  h: 480,  fps: 30, kbps: 1200, nombre: '480p · ahorro de datos' },
};
const CATEGORIAS = ['Acción', 'Shooter', 'Battle Royale', 'RPG', 'Mundo abierto', 'Deportes', 'Carreras', 'Estrategia', 'Terror', 'Minecraft', 'Free Fire', 'Fortnite', 'GTA', 'Retro / Emuladores', 'Móvil', 'Indie', 'Charla', 'Otro'];

async function vistaEstudio() {
  if (!TOKEN) return irLogin();
  $('btn-golive').hidden = true;
  document.title = 'Estudio · En vivo · UpGames';
  await cargarConfig();
  const prov = CFG.proveedor;
  const puedePantalla = !!navigator.mediaDevices?.getDisplayMedia;
  const puedeCamara = !!navigator.mediaDevices?.getUserMedia;
  const pref = (() => { try { return JSON.parse(localStorage.getItem('ug_live_pref') || '{}'); } catch (_) { return {}; } })();
  let fuente = pref.fuente && (pref.fuente !== 'pantalla' || puedePantalla) && (pref.fuente !== 'camara' || puedeCamara) ? pref.fuente : (puedePantalla ? 'pantalla' : 'camara');
  if (fuente === 'obs' && prov.tipo !== 'mediamtx') fuente = puedePantalla ? 'pantalla' : 'camara';

  app.innerHTML = `
  <div class="studio-grid">
    <section>
      <div class="player-wrap" id="pw">
        <video id="prev" playsinline autoplay muted></video>
        <div class="gift-layer" id="gl"></div>
        <div class="p-top" id="s-top" hidden><span class="pill-live">EN VIVO</span><span class="chip-dark"><ion-icon name="eye"></ion-icon> <span id="s-n">0</span></span><span class="chip-dark timer" id="s-t">0:00</span><span class="chip-dark" id="s-net" title="Conexiones de video">📶 <span id="s-peers">0</span></span></div>
        <div class="p-overlay" id="pov"><div style="font-size:2.6rem">🎮</div><h2>Vista previa</h2><p id="pov-t">Elige qué vas a transmitir y pulsa <b>Vista previa</b>. Nadie te ve hasta que inicies el live.</p></div>
        <div class="ov-chat" id="ov-chat" aria-hidden="true"></div>
        <div class="ov-head">
          ${avatar(ME, '')}
          <div class="t"><b>🔴 Estás en vivo</b><small id="ov-title"></small></div>
          <button class="ico-btn ov-x" id="ov-x" aria-label="Ver controles del estudio"><ion-icon name="close"></ion-icon></button>
        </div>
        <div class="ov-rail">
          <button id="ov-mic" aria-label="Micrófono"><span class="i" id="ov-mic-i">🎙️</span>Micro</button>
          <button id="ov-flip" aria-label="Voltear cámara" hidden><span class="i">🔄</span>Voltear</button>
          <button id="ov-toggle" aria-label="Mostrar u ocultar comentarios"><span class="i">💬</span>Chat</button>
          <button id="ov-share" aria-label="Compartir"><span class="i"><ion-icon name="share-social"></ion-icon></span>Compartir</button>
          <button id="ov-end" class="danger" aria-label="Terminar live"><span class="i">⏹</span>Terminar</button>
        </div>
        <form class="ov-bar" id="ov-form" autocomplete="off"><input id="ov-in" maxlength="200" placeholder="Habla con tu comunidad…" enterkeyhint="send" aria-label="Mensaje"><button class="send" aria-label="Enviar"><ion-icon name="send"></ion-icon></button></form>
      </div>
      <div class="kpis" id="kpis" hidden>
        <div class="kpi glass"><b id="k-v">0</b><small>Espectadores</small></div>
        <div class="kpi glass"><b id="k-pico">0</b><small>Pico</small></div>
        <div class="kpi glass"><b id="k-l">0</b><small>Me gusta</small></div>
        <div class="kpi glass money"><b id="k-g">$0.00</b><small>Ganado en este live</small></div>
      </div>
      <div class="panel glass" style="margin-top:16px" id="setup">
        <h2>Configura tu directo</h2>
        <p class="sub">Comparte tu pantalla mientras juegas, o usa la cámara. Todo desde el navegador.</p>
        <div class="field"><label>Título</label><input id="f-tit" maxlength="100" placeholder="Ej: Ranked hasta Diamante 💎" value="${esc(pref.titulo || '')}"></div>
        <div class="row2">
          <div class="field"><label>Categoría</label><select id="f-cat">${CATEGORIAS.map(x => `<option ${pref.categoria === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="field"><label>Calidad</label><select id="f-q">${Object.entries(CALIDADES).map(([k, v]) => `<option value="${k}" ${(pref.calidad || '720p30') === k ? 'selected' : ''}>${v.nombre}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Fuente</label>
          <div class="src-grid">
            <button class="src" data-f="pantalla" ${puedePantalla ? '' : 'disabled'}><ion-icon name="desktop-outline"></ion-icon>Pantalla<small>${puedePantalla ? 'Juego + audio' : 'Solo en PC'}</small></button>
            <button class="src" data-f="camara" ${puedeCamara ? '' : 'disabled'}><ion-icon name="videocam-outline"></ion-icon>Cámara<small>${puedeCamara ? 'Móvil o webcam' : 'No disponible'}</small></button>
            <button class="src" data-f="obs" ${prov.tipo === 'mediamtx' ? '' : 'disabled'}><ion-icon name="construct-outline"></ion-icon>OBS<small>${prov.tipo === 'mediamtx' ? 'Pro · RTMP' : 'Próximamente'}</small></button>
          </div>
        </div>
        <div id="obs-box" hidden></div>
        <div id="nav-box">
          <div class="toggle"><span>🎙️ Micrófono</span><label class="switch"><input type="checkbox" id="f-mic" ${pref.mic !== false ? 'checked' : ''}><span></span></label></div>
          <div class="mixer" id="mixer" hidden>
            <label>🎮 Juego <input type="range" id="g-juego" min="0" max="1.5" step="0.05" value="1"><span class="meter"><i id="m-juego"></i></span></label>
            <label>🎙️ Voz <input type="range" id="g-mic" min="0" max="2" step="0.05" value="1"><span class="meter"><i id="m-mic"></i></span></label>
          </div>
          ${puedePantalla ? '<div class="note" style="margin-top:12px">💡 Al compartir, elige <b>la pestaña o pantalla del juego</b> y activa <b>“Compartir audio”</b> para que se escuche el juego.</div>' : '<div class="note warn" style="margin-top:12px">📱 Tu navegador no permite compartir pantalla (los móviles no lo soportan). Puedes transmitir con la cámara, o desde un PC para compartir tu juego.</div>'}
          ${prov.tipo === 'p2p' ? `<div class="note warn">📡 Modo directo: hasta <b>${prov.p2pMax} espectadores con video</b>; el resto puede usar el chat. Tu subida de internet se reparte entre ellos, así que usa una calidad acorde a tu conexión.</div>` : ''}
        </div>
        ${!puedeCamara && !puedePantalla ? `<div class="note warn" id="sin-media">🚫 <b>Este navegador no permite usar la cámara.</b> Pasa casi siempre al abrir el enlace dentro de otra app (Instagram, Facebook, TikTok, WhatsApp…). Ábrelo en <b>Chrome</b> o <b>Safari</b> (menú ⋮ → “Abrir en el navegador”) y vuelve a intentarlo.</div>` : ''}
        <div class="note warn" id="cap-err" role="alert" hidden></div>
        <div class="studio-actions">
          <button class="btn btn-ghost" id="b-prev"><ion-icon name="eye-outline"></ion-icon> Vista previa</button>
          <button class="btn btn-live" id="b-go"><ion-icon name="radio"></ion-icon> Iniciar transmisión</button>
        </div>
      </div>
      <div class="panel glass" style="margin-top:16px" id="live-ctrl" hidden>
        <div class="field"><label>Título del directo</label><div class="keybox"><input id="l-tit" maxlength="100"><button class="btn btn-ghost" id="b-tit">Guardar</button></div></div>
        <div class="studio-actions">
          <button class="btn btn-ghost" id="b-inm-s"><ion-icon name="expand"></ion-icon> Pantalla completa</button>
          <button class="btn btn-ghost" id="b-flip" hidden><ion-icon name="camera-reverse"></ion-icon> Voltear cámara</button>
          <button class="btn btn-ghost" id="b-mic-t"><ion-icon name="mic"></ion-icon> Silenciar micro</button>
          <button class="btn btn-ghost" id="b-share-l"><ion-icon name="share-social"></ion-icon> Compartir enlace</button>
          <button class="btn btn-danger" id="b-end"><ion-icon name="stop-circle"></ion-icon> Terminar live</button>
        </div>
        <p class="fine" id="earn-note"></p>
      </div>
    </section>
    <aside class="side glass vacio" id="side"><div class="empty" style="margin:auto"><div class="big">💬</div><p>El chat de tu directo aparecerá aquí cuando inicies.</p></div></aside>
  </div>`;

  const video = $('prev'), pov = $('pov'), pw = $('pw'), ov = burbujas($('ov-chat'));
  const inm = modoInmersivo(pw);
  let camara = 'user';   // cámara frontal o trasera
  const espejo = () => { video.style.transform = fuente === 'camara' && camara === 'user' ? 'scaleX(-1)' : ''; };
  let stream = null, mezcla = null, liveId = null, enVivo = false, inicio = 0, ganado = 0, pico = 0, whip = null;
  const peers = new Map();   // espectador → { pc, cadena }
  const timers = [];
  let liberarPantalla = null;
  cleanup.push(() => timers.forEach(clearInterval));

  const guardarPref = () => { try { localStorage.setItem('ug_live_pref', JSON.stringify({ fuente, titulo: $('f-tit').value, categoria: $('f-cat').value, calidad: $('f-q').value, mic: $('f-mic').checked })); } catch (_) {} };
  function marcarFuente() {
    document.querySelectorAll('.src').forEach(b => b.classList.toggle('on', b.dataset.f === fuente));
    $('obs-box').hidden = fuente !== 'obs'; $('nav-box').hidden = fuente === 'obs'; $('b-prev').hidden = fuente === 'obs';
    if (fuente === 'obs') pintarOBS();
  }
  document.querySelectorAll('.src').forEach(b => b.onclick = () => { if (b.disabled || enVivo) return; fuente = b.dataset.f; detenerCaptura(); marcarFuente(); guardarPref(); });

  async function pintarOBS() {
    const box = $('obs-box');
    box.innerHTML = '<div class="note">Cargando tu clave…</div>';
    try {
      const k = await api('/live/mi-clave');
      box.innerHTML = `<div class="note">Configura OBS en <b>Ajustes → Emisión → Personalizado</b> con estos datos. Al pulsar “Iniciar transmisión” en OBS tu live aparece solo en UpGames.</div>
        <div class="field"><label>Servidor</label><div class="keybox"><input readonly value="${esc(k.servidor || 'No configurado')}"><button class="btn btn-ghost" data-copy="${esc(k.servidor || '')}">Copiar</button></div></div>
        <div class="field"><label>Clave de transmisión (privada)</label><div class="keybox"><input readonly type="password" id="obs-k" value="${esc(k.streamKey)}"><button class="btn btn-ghost" id="obs-ver">Ver</button><button class="btn btn-ghost" data-copy="${esc(k.streamKey)}">Copiar</button></div></div>
        <button class="btn btn-ghost" id="obs-reg" style="width:100%"><ion-icon name="refresh"></ion-icon> Regenerar clave</button>
        <p class="fine">Recomendado en OBS: x264 o NVENC, CBR 3000–6000 kbps, keyframe cada 2 s, perfil “high”. Nunca compartas tu clave: con ella cualquiera podría transmitir en tu canal.</p>`;
      box.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copiado')));
      $('obs-ver').onclick = () => { const i = $('obs-k'); i.type = i.type === 'password' ? 'text' : 'password'; };
      $('obs-reg').onclick = async () => { if (!confirm('La clave anterior dejará de funcionar. ¿Continuar?')) return; await api('/live/mi-clave/regenerar', { method: 'POST' }); pintarOBS(); toast('Clave nueva generada'); };
    } catch (e) { box.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
  }

  // ── Captura y mezcla de audio ──
  function detenerCaptura() {
    stream?.getTracks().forEach(t => t.stop());
    stream?._fuentes?.forEach(f => f.getTracks().forEach(t => t.stop()));
    stream = null;
    mezcla?.cerrar(); mezcla = null;
    video.srcObject = null;
    if (!enVivo) pov.hidden = false;
  }
  // iOS solo deja sonar un AudioContext creado/reanudado DURANTE el toque del usuario
  let ctxAudio = null;
  const prepararAudio = () => {
    try {
      ctxAudio = ctxAudio || new (window.AudioContext || window.webkitAudioContext)();
      if (ctxAudio.state === 'suspended') ctxAudio.resume().catch(() => {});
    } catch (_) {}
  };
  function mezclador(fuentes) {
    const ctx = ctxAudio || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const dest = ctx.createMediaStreamDestination();
    const nodos = {};
    for (const [k, s] of Object.entries(fuentes)) {
      if (!s?.getAudioTracks().length) continue;
      const src = ctx.createMediaStreamSource(s), g = ctx.createGain(), an = ctx.createAnalyser();
      an.fftSize = 256; src.connect(g); g.connect(an); g.connect(dest);
      nodos[k] = { g, an, buf: new Uint8Array(an.fftSize) };
    }
    let raf;
    const medir = () => {
      for (const [k, n] of Object.entries(nodos)) {
        n.an.getByteTimeDomainData(n.buf);
        let p = 0; for (const v of n.buf) p = Math.max(p, Math.abs(v - 128));
        const m = $(k === 'juego' ? 'm-juego' : 'm-mic'); if (m) m.style.width = Math.min(100, p / 1.28) + '%';
      }
      raf = requestAnimationFrame(medir);
    };
    medir();
    const fuentesAudio = Object.values(nodos);
    return { pista: dest.stream.getAudioTracks()[0] || null, nodos, ctx, cerrar() {
      cancelAnimationFrame(raf);
      fuentesAudio.forEach(n => { try { n.g.disconnect(); } catch (_) {} });
      if (ctx !== ctxAudio) ctx.close().catch(() => {});
    } };
  }
  function errorCaptura(e) {
    const n = e?.name || '';
    if (!navigator.mediaDevices) return 'Este navegador no permite usar la cámara. Ábrelo en Chrome o Safari (no dentro de otra app) y vuelve a intentarlo.';
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError')
      return fuente === 'pantalla'
        ? 'Cancelaste o bloqueaste el permiso para compartir pantalla. Vuelve a tocar el botón y elige qué compartir.'
        : 'Bloqueaste el permiso de cámara o micrófono. Toca el candado 🔒 (o ⓘ) junto a la dirección del sitio → Permisos → permite Cámara y Micrófono, recarga la página y vuelve a intentarlo.';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return 'No encontramos una cámara disponible en este dispositivo.';
    if (n === 'NotSupportedError' || n === 'TypeError') return 'Este navegador no deja usar la cámara en esta página. Ábrela en Chrome o Safari actualizados (no dentro de otra app) y vuelve a intentarlo.';
    if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'La cámara está ocupada por otra app (cámara, videollamada, otra pestaña). Ciérrala y vuelve a intentarlo.';
    return 'No se pudo iniciar la captura: ' + (e?.message || n || 'error desconocido');
  }
  const mostrarError = msg => { const el = $('cap-err'); if (!el) return toast(msg, 5000); el.textContent = msg ? '⚠️ ' + msg : ''; el.hidden = !msg; if (msg) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const reportar = (e, contexto) => { try { fetch(API + '/live/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'captura', nombre: e?.name || 'Error', mensaje: e?.message || String(e), contexto }), keepalive: true }).catch(() => {}); } catch (_) {} };
  // Cámara: de lo ideal a lo más simple. Si el micrófono se rechaza, sigue solo con video.
  async function abrirCamara(q, conMic) {
    const audio = conMic ? { echoCancellation: true, noiseSuppression: true } : false;
    const intentos = [
      { video: { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps }, facingMode: camara }, audio },
      { video: { facingMode: camara }, audio },
      { video: true, audio },
    ];
    let ultimo;
    for (const c of intentos) {
      try { return await navigator.mediaDevices.getUserMedia(c); }
      catch (e) {
        ultimo = e;
        if (conMic && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
          try { const v = await navigator.mediaDevices.getUserMedia({ ...c, audio: false }); toast('Sin acceso al micrófono: transmitirás solo video', 4500); return v; }
          catch (e2) { ultimo = e2; }
        }
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break;   // reintentar no cambia un permiso denegado
      }
    }
    throw ultimo;
  }
  async function capturar() {
    detenerCaptura();
    mostrarError('');
    const q = CALIDADES[$('f-q').value] || CALIDADES['720p30'];
    const conMic = $('f-mic').checked;
    let vid, mic = null;
    if (!navigator.mediaDevices?.getUserMedia) { mostrarError(errorCaptura(null)); reportar({ name: 'SinMediaDevices', message: 'navigator.mediaDevices no existe' }, location.protocol); return false; }
    try {
      if (fuente === 'pantalla') {
        vid = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
        });
        if (conMic) mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).catch(() => { toast('No se pudo usar el micrófono'); return null; });
      } else {
        vid = await abrirCamara(q, conMic);
      }
    } catch (e) {
      mostrarError(errorCaptura(e));
      reportar(e, `fuente=${fuente} mic=${conMic}`);
      return false;
    }
    if (!vid.getVideoTracks().length) { mostrarError('La cámara no entregó video. Vuelve a intentarlo.'); vid.getTracks().forEach(t => t.stop()); return false; }
    const vt = vid.getVideoTracks()[0];
    if (vt && 'contentHint' in vt) vt.contentHint = 'motion';   // en juegos, fluidez antes que nitidez
    const juegoAudio = fuente === 'pantalla' && vid.getAudioTracks().length ? new MediaStream(vid.getAudioTracks()) : null;
    const vozAudio = fuente === 'pantalla' ? mic : (vid.getAudioTracks().length ? new MediaStream(vid.getAudioTracks()) : null);
    mezcla = (juegoAudio || vozAudio) ? mezclador({ juego: juegoAudio, mic: vozAudio }) : null;
    $('mixer').hidden = !mezcla;
    if (mezcla) {
      $('g-juego').closest('label').hidden = !mezcla.nodos.juego; $('g-mic').closest('label').hidden = !mezcla.nodos.mic;
      $('g-juego').oninput = e => { if (mezcla?.nodos.juego) mezcla.nodos.juego.g.gain.value = +e.target.value; };
      $('g-mic').oninput = e => { if (mezcla?.nodos.mic) mezcla.nodos.mic.g.gain.value = +e.target.value; };
    }
    if (fuente === 'pantalla' && !juegoAudio) toast('No se compartió el audio del juego. Si quieres que se escuche, vuelve a compartir y activa “Compartir audio”.', 5000);
    stream = new MediaStream([vt, ...(mezcla?.pista ? [mezcla.pista] : [])]);
    stream._fuentes = [vid, mic].filter(Boolean);   // capturas originales: se detienen al terminar
    video.srcObject = stream; pov.hidden = true; espejo();
    vt.addEventListener('ended', () => {
      if (enVivo) { toast('Dejaste de compartir. Elige de nuevo qué transmitir o termina el live.', 5000); reemplazarVideo(); }
      else detenerCaptura();
    });
    return true;
  }
  // Cambiar la pista de video en pleno directo sin cortar a los espectadores
  function cambiarVideo(vt, origen) {
    const viejo = stream.getVideoTracks()[0];
    stream.removeTrack(viejo); stream.addTrack(vt); stream._fuentes.push(origen);
    viejo.stop();
    for (const { pc } of peers.values()) pc.getSenders().find(s => s.track === viejo || s.track?.kind === 'video')?.replaceTrack(vt);
    whip?.pc.getSenders().find(s => s.track === viejo || s.track?.kind === 'video')?.replaceTrack(vt);
    video.srcObject = stream; espejo();
  }
  async function reemplazarVideo() {
    const q = CALIDADES[$('f-q').value] || CALIDADES['720p30'];
    try {
      const nuevo = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps, max: q.fps } }, audio: false });
      const vt = nuevo.getVideoTracks()[0]; vt.contentHint = 'motion';
      cambiarVideo(vt, nuevo);
      vt.addEventListener('ended', () => { if (enVivo) { toast('Dejaste de compartir.'); reemplazarVideo(); } });
    } catch (_) { toast('Sin video: tus espectadores ven la última imagen. Puedes terminar el live.'); }
  }
  // Frontal ↔ trasera (móvil), en vivo y sin cortar
  async function voltearCamara() {
    if (fuente !== 'camara' || !stream) return;
    const q = CALIDADES[$('f-q').value] || CALIDADES['720p30'];
    const siguiente = camara === 'user' ? 'environment' : 'user';
    const abrir = modo => navigator.mediaDevices.getUserMedia({ video: { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps }, facingMode: modo }, audio: false });
    // Muchos Android no abren dos cámaras a la vez: soltar la actual antes de pedir la otra
    stream.getVideoTracks()[0]?.stop();
    let nuevo;
    try { nuevo = await abrir({ exact: siguiente }); camara = siguiente; }
    catch (_) {
      toast('Este dispositivo no tiene otra cámara disponible');
      try { nuevo = await abrir(camara); } catch (e) { toast('No se pudo recuperar la cámara: ' + e.message, 4000); return; }
    }
    const vt = nuevo.getVideoTracks()[0]; vt.contentHint = 'motion';
    cambiarVideo(vt, nuevo);
  }
  async function aplicarCalidad(pc) {
    const q = CALIDADES[$('f-q').value] || CALIDADES['720p30'];
    for (const s of pc.getSenders()) {
      if (!s.track) continue;
      const p = s.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      if (s.track.kind === 'video') { p.encodings[0].maxBitrate = q.kbps * 1000; p.encodings[0].maxFramerate = q.fps; p.degradationPreference = 'maintain-framerate'; }
      else p.encodings[0].maxBitrate = 128000;
      await s.setParameters(p).catch(() => {});
    }
  }

  // ── P2P: una conexión por espectador ──
  function nuevoPeer(peer) {
    cerrarPeer(peer);
    if (!stream) return;
    const pc = new RTCPeerConnection({ iceServers: CFG.ice });
    const reg = { pc, cadena: Promise.resolve() };
    peers.set(peer, reg);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.onicecandidate = e => { if (e.candidate) socket.emit('p2p:senal', { liveId, para: peer, data: { candidate: e.candidate } }); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) cerrarPeer(peer); pintarPeers(); };
    reg.cadena = reg.cadena.then(async () => {
      await pc.setLocalDescription(await pc.createOffer());
      await aplicarCalidad(pc);
      socket.emit('p2p:senal', { liveId, para: peer, data: { sdp: pc.localDescription } });
    }).catch(e => console.warn('[live] oferta', e));
  }
  function cerrarPeer(peer) { const r = peers.get(peer); if (!r) return; try { r.pc.close(); } catch (_) {} peers.delete(peer); pintarPeers(); }
  const pintarPeers = () => { const el = $('s-peers'); if (el) el.textContent = [...peers.values()].filter(r => r.pc.connectionState === 'connected').length; };

  // ── WHIP: publicar desde el navegador al servidor de medios ──
  async function publicarWHIP(url, clave) {
    const pc = new RTCPeerConnection({ iceServers: CFG.ice });
    stream.getTracks().forEach(t => {
      const tr = pc.addTransceiver(t, { direction: 'sendonly', streams: [stream] });
      // HLS no transporta VP8: el servidor de medios necesita H.264 para reempaquetar
      const caps = t.kind === 'video' && RTCRtpSender.getCapabilities?.('video');
      if (caps && tr.setCodecPreferences) {
        const h264 = caps.codecs.filter(c => /h264/i.test(c.mimeType));
        if (h264.length) tr.setCodecPreferences([...h264, ...caps.codecs.filter(c => !/h264/i.test(c.mimeType))]);
      }
    });
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise(ok => { if (pc.iceGatheringState === 'complete') return ok(); const t = setTimeout(ok, 2500); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); ok(); } }); });
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${clave}` }, body: pc.localDescription.sdp });
    if (!r.ok) { pc.close(); throw new Error(`El servidor de video rechazó la conexión (${r.status})`); }
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    await aplicarCalidad(pc);
    const loc = r.headers.get('Location');
    return { pc, cerrar() { if (loc) fetch(new URL(loc, url), { method: 'DELETE' }).catch(() => {}); pc.close(); } };
  }

  // ── Iniciar / terminar ──
  $('b-prev').onclick = () => { prepararAudio(); capturar(); };
  $('b-go').onclick = async () => {
    if ($('b-go').dataset.ocupado) return;
    prepararAudio();
    if (fuente !== 'obs' && !stream) {
      $('b-go').dataset.ocupado = '1'; $('b-go').innerHTML = '<ion-icon name="videocam"></ion-icon> Abriendo cámara…';
      const ok = await capturar();
      delete $('b-go').dataset.ocupado; $('b-go').innerHTML = '<ion-icon name="radio"></ion-icon> Iniciar transmisión';
      if (!ok) return;
    }
    guardarPref();
    $('b-go').disabled = true; $('b-go').innerHTML = '<ion-icon name="hourglass"></ion-icon> Iniciando…';
    try {
      const usarMTX = prov.tipo === 'mediamtx' && (fuente === 'obs' || prov.whip);
      const d = await api('/live/iniciar', { method: 'POST', body: { titulo: $('f-tit').value, categoria: $('f-cat').value, modo: usarMTX ? 'mediamtx' : 'p2p' } });
      liveId = String(d.live._id);
      if (usarMTX && fuente !== 'obs') {
        const k = await api('/live/mi-clave');
        whip = await publicarWHIP(k.whip, k.clave);
      }
      empezarDirecto(d.live);
    } catch (e) {
      mostrarError(e.status === 403 ? e.message : `No se pudo iniciar el live: ${e.message}`);
      reportar(e, 'iniciar');
      $('b-go').disabled = false; $('b-go').innerHTML = '<ion-icon name="radio"></ion-icon> Iniciar transmisión';
    }
  };

  function empezarDirecto(live) {
    enVivo = true; inicio = new Date(live.inicio).getTime();
    $('setup').hidden = true; $('live-ctrl').hidden = false; $('kpis').hidden = false; $('s-top').hidden = false;
    $('s-net').hidden = live.modo !== 'p2p';
    $('l-tit').value = live.titulo;
    if (fuente === 'obs') { pov.hidden = false; pov.innerHTML = '<div style="font-size:2.4rem">🎛️</div><h2>Transmitiendo desde OBS</h2><p>Tu señal llega a los espectadores desde el servidor de video. Aquí ves el chat y los regalos en tiempo real.</p>'; }
    $('b-mic-t').hidden = !mezcla?.nodos.mic;
    $('ov-mic').hidden = !mezcla?.nodos.mic;
    const puedeVoltear = fuente === 'camara';
    $('b-flip').hidden = $('ov-flip').hidden = !puedeVoltear;
    $('ov-title').textContent = live.titulo;
    const burb = interruptorBurbujas(pw, [$('ov-toggle')]);
    burb.segunPantalla(true);   // el creador siempre ve los comentarios sobre su video al empezar
    // En el móvil el creador ve su cámara a pantalla completa con los comentarios encima
    if (esMovil()) inm.entrar();
    window.onbeforeunload = e => { if (enVivo) { e.preventDefault(); e.returnValue = ''; } };
    // El celular apaga la pantalla a los pocos segundos y con ella la cámara: mantenerla encendida
    let wake = null;
    const pedirPantalla = async () => { try { if (enVivo && document.visibilityState === 'visible' && 'wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (_) {} };
    const alVolver = () => {
      if (!enVivo) return;
      if (document.visibilityState === 'visible') { pedirPantalla(); if (fuera) toast('Volviste al live. Si tus espectadores dejaron de verte, ya se reconectan.', 4000); fuera = false; }
      else fuera = true;
    };
    let fuera = false;
    document.addEventListener('visibilitychange', alVolver);
    liberarPantalla = () => { document.removeEventListener('visibilitychange', alVolver); wake?.release().catch(() => {}); wake = null; };
    cleanup.push(liberarPantalla);
    pedirPantalla();
    if (esMovil()) setTimeout(() => toast('📱 No salgas de la app mientras transmites: el teléfono pausa la cámara en segundo plano.', 5000), 1500);

    conectar();
    $('side').classList.remove('vacio');
    const chat = crearChat($('side'), { liveId, esHost: true });
    const capa = capaRegalos($('gl'));
    const unirse = () => socket.emit('unirse', { liveId, rol: 'host' }, r => {
      if (!r?.ok) { toast(r?.error || 'No se pudo conectar el live'); return; }
      $('k-v').textContent = fmt(r.espectadores); $('k-l').textContent = fmt(r.likes); chat.pintarTop(r.top);
      if (!unirse.hecho) { r.chat.forEach(chat.add); chat.sys(`🔴 Estás en vivo. Comparte tu enlace para que te encuentren.`); ov.sys('🔴 Estás en vivo. Los comentarios aparecerán aquí.'); unirse.hecho = true; }
    });
    socket.on('connect', unirse);
    if (socket.connected) unirse();
    socket.on('p2p:nuevo', ({ peer }) => nuevoPeer(peer));
    socket.on('p2p:salio', ({ peer }) => cerrarPeer(peer));
    socket.on('p2p:senal', ({ de, data }) => {
      const r = peers.get(de); if (!r) return;
      r.cadena = r.cadena.then(async () => {
        if (data.sdp?.type === 'answer') await r.pc.setRemoteDescription(data.sdp);
        else if (data.candidate) await r.pc.addIceCandidate(data.candidate).catch(() => {});
      }).catch(e => console.warn('[live] respuesta', e));
    });
    socket.on('espectadores', ({ n }) => { $('k-v').textContent = fmt(n); $('s-n').textContent = fmt(n); pico = Math.max(pico, n); $('k-pico').textContent = fmt(pico); });
    socket.on('likes', ({ total }) => { $('k-l').textContent = fmt(total); capa.corazon(); });
    socket.on('chat', m => { chat.add(m); ov.add(m); });
    socket.on('chat:borrado', ({ id }) => ov.borrar(id));
    socket.on('chat:silenciado', ({ u }) => ov.silenciar(u));
    socket.on('top', ({ top }) => chat.pintarTop(top));
    socket.on('regalo', g => {
      capa.regalo(g); chat.regalo(g); ov.regalo(g);
      ganado += g.total * CFG.monedaUsd * (1 - CFG.comision);
      $('k-g').textContent = `🪙 ${(ganado / CFG.monedaUsd).toLocaleString('es-CO', { maximumFractionDigits: 1 })}`;   // ganado en UpCoins
    });
    socket.on('reemplazado', () => { toast('Abriste el estudio en otra pestaña. Esta se desconectó.', 6000); enVivo = false; window.onbeforeunload = null; detenerCaptura(); peers.forEach((_, p) => cerrarPeer(p)); socket.disconnect(); });
    socket.on('fin', ({ motivo }) => terminar(motivo, true));
    timers.push(setInterval(() => socket.emit('latido', { liveId }), 25000));
    timers.push(setInterval(() => { const t = $('s-t'); if (t) t.textContent = dur(Date.now() - inicio); }, 1000));
    $('earn-note').innerHTML = `Recibes el <b>${Math.round((1 - CFG.comision) * 100)}%</b> del valor de cada regalo. ${CFG.retencionDias ? `Las ganancias (en UpCoins) quedan retenidas ${CFG.retencionDias} días (protección contra fraudes y contracargos) y luego pasan a tus UpCoins retirables.` : ''}`;
  }

  $('b-tit').onclick = async () => { try { await api('/live/titulo', { method: 'PUT', body: { titulo: $('l-tit').value } }); $('ov-title').textContent = $('l-tit').value; toast('Título actualizado'); } catch (e) { toast(e.message); } };
  const alternarMic = () => {
    const n = mezcla?.nodos.mic; if (!n) return;
    const off = n.g.gain.value > 0;
    n.prev = off ? n.g.gain.value : n.prev; n.g.gain.value = off ? 0 : (n.prev || 1);
    $('b-mic-t').innerHTML = off ? '<ion-icon name="mic-off"></ion-icon> Activar micro' : '<ion-icon name="mic"></ion-icon> Silenciar micro';
    $('ov-mic-i').textContent = off ? '🔇' : '🎙️';
    toast(off ? 'Micrófono silenciado' : 'Micrófono activado', 1500);
  };
  $('b-mic-t').onclick = alternarMic;
  $('ov-mic').onclick = e => { e.stopPropagation(); alternarMic(); };
  $('b-flip').onclick = voltearCamara;
  $('ov-flip').onclick = e => { e.stopPropagation(); voltearCamara(); };
  $('b-inm-s').onclick = () => inm.entrar();
  $('ov-x').onclick = () => inm.salir();
  $('ov-share').onclick = e => { e.stopPropagation(); $('b-share-l').click(); };
  $('ov-end').onclick = e => { e.stopPropagation(); $('b-end').click(); };
  $('ov-form').onsubmit = e => {
    e.preventDefault();
    const inp = $('ov-in'), t = inp.value.trim();
    if (!t || !liveId) return;
    socket?.emit('chat', { liveId, texto: t }, r => { if (r && !r.ok && r.error) toast(r.error); });
    inp.value = '';
  };
  $('b-share-l').onclick = async () => {
    const url = new URL(`./live.html?u=${encodeURIComponent(ME)}`, location.href).href;
    try { if (navigator.share) await navigator.share({ title: '¡Estoy en vivo en UpGames!', url }); else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } } catch (_) {}
  };
  $('b-end').onclick = () => { if (confirm('¿Terminar el live? Tus espectadores verán que finalizó.')) terminar(); };

  async function terminar(motivo, remoto) {
    if (!enVivo) return;
    enVivo = false; window.onbeforeunload = null;
    timers.forEach(clearInterval); timers.length = 0;
    inm.salir(); document.body.classList.remove('inm-on');
    liberarPantalla?.();
    let resumen = null;
    if (!remoto) { try { resumen = (await api('/live/finalizar', { method: 'POST' })).resumen; } catch (_) {} }
    peers.forEach((_, p) => cerrarPeer(p)); whip?.cerrar(); whip = null;
    detenerCaptura();
    socket?.disconnect(); socket = null;   // la vista del estudio ya no existe: nada de eventos huérfanos
    const r = resumen || {};
    app.innerHTML = `<div class="empty glass" style="margin-top:20px;max-width:640px;margin-left:auto;margin-right:auto">
      <div class="big">🏁</div><h2>${remoto ? esc(motivo || 'El live terminó') : '¡Gran directo!'}</h2>
      <div class="kpis" style="margin:18px 0">
        <div class="kpi glass"><b>${dur((r.fin ? new Date(r.fin) : Date.now()) - inicio)}</b><small>Duración</small></div>
        <div class="kpi glass"><b>${fmt(r.pico ?? pico)}</b><small>Pico</small></div>
        <div class="kpi glass"><b>${fmt(r.likes ?? 0)}</b><small>Me gusta</small></div>
        <div class="kpi glass money"><b>🪙 ${(ganado / (CFG?.monedaUsd || 0.02)).toLocaleString('es-CO', { maximumFractionDigits: 1 })}</b><small>UpCoins ganados</small></div>
      </div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn btn-ghost" href="./biblioteca.html">Volver a UpGames</a><a class="btn btn-live" href="./live.html?estudio=1">Nuevo live</a></div></div>`;
  }

  marcarFuente();
  // ¿Había un live activo (recarga de página)? Ofrecer retomarlo
  try {
    const c = await api(`/live/canal/${encodeURIComponent(ME)}`);
    if (c.live) {
      const note = document.createElement('div'); note.className = 'note warn';
      note.innerHTML = `⚡ Tienes un live activo (“${esc(c.live.titulo)}”). Pulsa <b>Vista previa</b> e <b>Iniciar</b> para retomarlo, o <button class="btn btn-danger" style="padding:4px 10px;margin-left:4px" id="b-end-old">termínalo</button>.`;
      $('setup').insertBefore(note, $('setup').children[2]);
      $('b-end-old').onclick = async () => { await api('/live/finalizar', { method: 'POST' }).catch(() => {}); note.remove(); toast('Live anterior terminado'); };
      if (!$('f-tit').value) $('f-tit').value = c.live.titulo;
    }
  } catch (_) {}
}

/* ══════════════ Monedas (tarjeta o PayPal, ver upgames-pagos.js) ══════════════ */
async function abrirMonedas() {
  if (!TOKEN) return irLogin();
  await cargarConfig().catch(() => {});
  const saldo = await refrescarMonedas() || {};
  document.querySelector('.modal-bg')?.remove();
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal glass" role="dialog" aria-modal="true" aria-label="Conseguir UpCoins">
    <div class="modal-head"><h2>🪙 Conseguir UpCoins</h2><button class="ico-btn" id="m-x" aria-label="Cerrar"><ion-icon name="close"></ion-icon></button></div>
    <div id="m-tienda"></div>
    <p class="fine">El creador recibe el ${Math.round((1 - (CFG?.comision ?? 0.3)) * 100)}% del valor de cada regalo.${saldo.saldoRetenido ? ` Tus ganancias en retención: <b>🪙 ${(saldo.saldoRetenido / 0.02).toLocaleString('es-CO', { maximumFractionDigits: 2 })} UC</b>.` : ''}</p>
  </div>`;
  document.body.appendChild(bg);
  const cerrar = () => { bg.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = e => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', esc_);
  bg.onclick = e => { if (e.target === bg) cerrar(); };
  bg.querySelector('#m-x').onclick = cerrar;
  window.UGPagos.tienda(bg.querySelector('#m-tienda'), {
    alComprar: d => { monedas = d.monedas; $('coins-n').textContent = fmt(monedas); toast(`✅ +${fmt(d.acreditadas)} UpCoins`); setTimeout(cerrar, 900); },
  });
}

/* ══════════════ Arranque ══════════════ */
(async () => {
  try {
    if (Q.has('estudio')) await vistaEstudio();
    else if (Q.get('u')) await vistaEspectador(String(Q.get('u')).toLowerCase().slice(0, 20));
    else await vistaDirectorio();
  } catch (e) {
    app.innerHTML = `<div class="empty glass" style="margin-top:20px"><div class="big">⚠️</div><h2>Algo salió mal</h2><p>${esc(e.message)}</p><a class="btn btn-ghost" href="./live.html">Reintentar</a></div>`;
  }
})();
window.addEventListener('pagehide', () => cleanup.forEach(f => { try { f(); } catch (_) {} }));
})();
