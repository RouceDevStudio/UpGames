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
const irLogin = () => { location.href = '../index.html'; };

/* ══════════════ Estado global ══════════════ */
let CFG = null;
let socket = null;
let monedas = 0;
const cleanup = [];

function conectar() {
  if (socket) return socket;
  socket = io(API, { transports: ['websocket'], auth: { token: TOKEN }, reconnectionDelayMax: 6000 });
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
function crearChat(raiz, { liveId, esHost, alEnviar }) {
  raiz.innerHTML = `
    <div class="side-tabs"><button class="on" data-t="chat">Chat</button><button data-t="top">🏆 Top regalos</button></div>
    <div class="chat" id="chat-list" aria-live="polite"></div>
    <div class="top-list" id="top-list" hidden></div>
    <button class="newmsgs" id="chat-new" hidden>Mensajes nuevos ↓</button>
    ${TOKEN ? `<form class="chat-form" id="chat-form" autocomplete="off">
        <input id="chat-in" maxlength="200" placeholder="${esHost ? 'Habla con tu comunidad…' : 'Escribe un mensaje…'}" aria-label="Mensaje">
        ${esHost ? '' : '<button type="button" class="heart-btn" id="btn-like" aria-label="Me gusta"><ion-icon name="heart"></ion-icon></button>'}
        <button class="send" aria-label="Enviar"><ion-icon name="send"></ion-icon></button>
      </form>` : `<div class="chat-login"><a href="../index.html">Inicia sesión</a> para chatear y enviar regalos</div>`}`;
  const list = raiz.querySelector('#chat-list'), nuevo = raiz.querySelector('#chat-new'), top = raiz.querySelector('#top-list');
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
  function add(m) {
    const el = document.createElement('div');
    el.className = 'msg'; el.dataset.id = m.id; el.dataset.u = m.u;
    const color = `hsl(${hue(m.u)} 75% 68%)`;
    el.innerHTML = `${m.av && /^https:\/\//.test(m.av) ? `<img class="mav" src="${esc(cld(m.av, 'c_fill,w_48,h_48,q_auto,f_auto'))}" alt="">` : `<div class="mav" style="background:hsl(${hue(m.u)} 60% 45%)">${esc(m.u[0].toUpperCase())}</div>`}
      <div class="mb">${m.host ? '<span class="badge-host">CREADOR</span>' : ''}<span class="mu" style="color:${color}">${esc(m.u)}${m.v ? ' <ion-icon class="verif" name="checkmark-circle"></ion-icon>' : ''}</span>${esc(m.t)}</div>
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

/* ══════════════ Reproductores ══════════════ */
// WebRTC directo: el creador nos envía una oferta por Socket.IO
function reproductorP2P(video, liveId, estado) {
  let pc = null, host = null, cadena = Promise.resolve(), reintento = null;
  const cerrar = () => { try { pc?.close(); } catch (_) {} pc = null; };
  async function manejar({ de, data }) {
    if (data.sdp?.type === 'offer') {
      cerrar(); host = de;
      pc = new RTCPeerConnection({ iceServers: CFG.ice });
      pc.ontrack = e => { if (video.srcObject !== e.streams[0]) { video.srcObject = e.streams[0]; video.play().catch(() => {}); } };
      pc.onicecandidate = e => { if (e.candidate) socket.emit('p2p:senal', { liveId, para: host, data: { candidate: e.candidate } }); };
      pc.onconnectionstatechange = () => {
        const s = pc?.connectionState;
        if (s === 'connected') { estado('ok'); clearTimeout(reintento); }
        if (s === 'failed' || s === 'disconnected') {
          estado('cargando', 'Reconectando video…');
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
        <button class="unmute" id="unmute" hidden><ion-icon name="volume-high"></ion-icon> Activar sonido</button>
        <div class="p-ctrls">
          <button class="ico-btn" id="b-mute" aria-label="Silenciar"><ion-icon name="volume-mute"></ion-icon></button>
          <input type="range" class="vol" id="vol" min="0" max="1" step="0.05" value="1" aria-label="Volumen">
          <div class="spacer"></div>
          <button class="ico-btn" id="b-pip" aria-label="Imagen en imagen"><ion-icon name="albums-outline"></ion-icon></button>
          <button class="ico-btn" id="b-fs" aria-label="Pantalla completa"><ion-icon name="expand"></ion-icon></button>
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
        <div class="gifts-head"><span>🎁 Envía un regalo a @${esc(c.usuario)}</span>${TOKEN ? '<button class="coins-chip" id="b-recargar">🪙 Recargar</button>' : ''}</div>
        <div class="gifts-row">${CFG.regalos.map(g => `<button class="gift" data-g="${g.id}" title="${esc(g.nombre)} · ${g.monedas} monedas"><span class="e">${g.emoji}</span><span class="n">${esc(g.nombre)}</span><span class="c">🪙 ${fmt(g.monedas)}</span></button>`).join('')}</div>
      </div>`}
    </section>
    <aside class="side glass" id="side"></aside>
  </div>`;

  const video = $('vid'), pov = $('pov'), capa = capaRegalos($('gl'));
  const estado = (e, txt) => { pov.hidden = e === 'ok'; if (txt) $('pov-t').textContent = txt; if (e === 'ok' && video.muted) $('unmute').hidden = false; };
  // Controles
  const sincMute = () => { $('b-mute').innerHTML = `<ion-icon name="${video.muted || !video.volume ? 'volume-mute' : 'volume-high'}"></ion-icon>`; $('unmute').hidden = !video.muted || !pov.hidden; };
  $('unmute').onclick = () => { video.muted = false; video.play().catch(() => {}); sincMute(); };
  $('b-mute').onclick = () => { video.muted = !video.muted; sincMute(); };
  $('vol').oninput = e => { video.volume = +e.target.value; video.muted = !video.volume; sincMute(); };
  $('b-fs').onclick = () => { const pw = $('pw'); document.fullscreenElement ? document.exitFullscreen() : (pw.requestFullscreen?.() || video.webkitEnterFullscreen?.()); };
  $('b-pip').hidden = !document.pictureInPictureEnabled;
  $('b-pip').onclick = () => (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() => {});
  $('pw').onclick = e => { if (e.target === video) $('pw').classList.toggle('show-ctrls'); };
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
    if (!unirse.hecho) { r.chat.forEach(chat.add); chat.sys('Bienvenido al chat. Sé respetuoso 💚'); unirse.hecho = true; }
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
  socket.on('likes', ({ total }) => { if (total > likes) for (let i = 0; i < Math.min(5, total - likes); i++) setTimeout(capa.corazon, i * 120); likes = total; $('v-likes').textContent = fmt(total); });
  socket.on('chat', chat.add);
  socket.on('top', ({ top }) => chat.pintarTop(top));
  socket.on('regalo', g => { capa.regalo(g); chat.regalo(g); const el = $('v-gifts'); el.textContent = fmt((parseInt(el.dataset.n || L0.regalos, 10) || 0) + g.cantidad); el.dataset.n = (parseInt(el.dataset.n || L0.regalos, 10) || 0) + g.cantidad; });
  socket.on('titulo', ({ titulo }) => { $('v-title').textContent = titulo; });
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

  // Likes
  if (chat.likeBtn) chat.likeBtn.onclick = () => { capa.corazon(); socket.emit('like', { liveId }); };
  // Regalos
  $('b-recargar') && ($('b-recargar').onclick = () => abrirMonedas());
  document.querySelectorAll('.gift').forEach(b => b.onclick = async () => {
    if (!TOKEN) return irLogin();
    const g = CFG.regalos.find(x => x.id === b.dataset.g);
    if (monedas < g.monedas) { toast(`Necesitas ${g.monedas} monedas para ${g.nombre}`); abrirMonedas(); return; }
    b.classList.add('sending');
    try {
      const d = await api(`/live/${liveId}/regalo`, { method: 'POST', body: { regaloId: g.id, cantidad: 1, clave: uid() } });
      if (typeof d.monedas === 'number') { monedas = d.monedas; $('coins-n').textContent = fmt(monedas); }
    } catch (e) {
      if (e.status === 402) { toast('No tienes monedas suficientes'); abrirMonedas(); }
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
  const pref = (() => { try { return JSON.parse(localStorage.getItem('ug_live_pref') || '{}'); } catch (_) { return {}; } })();
  let fuente = pref.fuente && (pref.fuente !== 'pantalla' || puedePantalla) ? pref.fuente : (puedePantalla ? 'pantalla' : 'camara');
  if (fuente === 'obs' && prov.tipo !== 'mediamtx') fuente = puedePantalla ? 'pantalla' : 'camara';

  app.innerHTML = `
  <div class="studio-grid">
    <section>
      <div class="player-wrap" id="pw">
        <video id="prev" playsinline autoplay muted></video>
        <div class="gift-layer" id="gl"></div>
        <div class="p-top" id="s-top" hidden><span class="pill-live">EN VIVO</span><span class="chip-dark"><ion-icon name="eye"></ion-icon> <span id="s-n">0</span></span><span class="chip-dark timer" id="s-t">0:00</span><span class="chip-dark" id="s-net" title="Conexiones de video">📶 <span id="s-peers">0</span></span></div>
        <div class="p-overlay" id="pov"><div style="font-size:2.6rem">🎮</div><h2>Vista previa</h2><p id="pov-t">Elige qué vas a transmitir y pulsa <b>Vista previa</b>. Nadie te ve hasta que inicies el live.</p></div>
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
            <button class="src" data-f="camara"><ion-icon name="videocam-outline"></ion-icon>Cámara<small>Móvil o webcam</small></button>
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
        <div class="studio-actions">
          <button class="btn btn-ghost" id="b-prev"><ion-icon name="eye-outline"></ion-icon> Vista previa</button>
          <button class="btn btn-live" id="b-go" disabled><ion-icon name="radio"></ion-icon> Iniciar transmisión</button>
        </div>
      </div>
      <div class="panel glass" style="margin-top:16px" id="live-ctrl" hidden>
        <div class="field"><label>Título del directo</label><div class="keybox"><input id="l-tit" maxlength="100"><button class="btn btn-ghost" id="b-tit">Guardar</button></div></div>
        <div class="studio-actions">
          <button class="btn btn-ghost" id="b-mic-t"><ion-icon name="mic"></ion-icon> Silenciar micro</button>
          <button class="btn btn-ghost" id="b-share-l"><ion-icon name="share-social"></ion-icon> Compartir enlace</button>
          <button class="btn btn-danger" id="b-end"><ion-icon name="stop-circle"></ion-icon> Terminar live</button>
        </div>
        <p class="fine" id="earn-note"></p>
      </div>
    </section>
    <aside class="side glass" id="side"><div class="empty" style="margin:auto"><div class="big">💬</div><p>El chat de tu directo aparecerá aquí cuando inicies.</p></div></aside>
  </div>`;

  const video = $('prev'), pov = $('pov');
  let stream = null, mezcla = null, liveId = null, enVivo = false, inicio = 0, ganado = 0, pico = 0, whip = null;
  const peers = new Map();   // espectador → { pc, cadena }
  const timers = [];
  cleanup.push(() => timers.forEach(clearInterval));

  const guardarPref = () => { try { localStorage.setItem('ug_live_pref', JSON.stringify({ fuente, titulo: $('f-tit').value, categoria: $('f-cat').value, calidad: $('f-q').value, mic: $('f-mic').checked })); } catch (_) {} };
  function marcarFuente() {
    document.querySelectorAll('.src').forEach(b => b.classList.toggle('on', b.dataset.f === fuente));
    $('obs-box').hidden = fuente !== 'obs'; $('nav-box').hidden = fuente === 'obs'; $('b-prev').hidden = fuente === 'obs';
    $('b-go').disabled = fuente !== 'obs' && !stream;
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
    if (!enVivo) { pov.hidden = false; $('b-go').disabled = fuente !== 'obs'; }
  }
  function mezclador(fuentes) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    return { pista: dest.stream.getAudioTracks()[0] || null, nodos, ctx, cerrar() { cancelAnimationFrame(raf); ctx.close().catch(() => {}); } };
  }
  async function capturar() {
    detenerCaptura();
    const q = CALIDADES[$('f-q').value] || CALIDADES['720p30'];
    const conMic = $('f-mic').checked;
    let vid, mic = null;
    try {
      if (fuente === 'pantalla') {
        vid = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps, max: q.fps } },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
        });
        if (conMic) mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).catch(() => { toast('No se pudo usar el micrófono'); return null; });
      } else {
        vid = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps }, facingMode: 'user' }, audio: conMic ? { echoCancellation: true, noiseSuppression: true } : false });
      }
    } catch (e) {
      toast(e.name === 'NotAllowedError' ? 'Permiso denegado. Necesitamos acceso para transmitir.' : 'No se pudo iniciar la captura: ' + e.message, 4000);
      return false;
    }
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
    video.srcObject = stream; pov.hidden = true;
    vt.addEventListener('ended', () => {
      if (enVivo) { toast('Dejaste de compartir. Elige de nuevo qué transmitir o termina el live.', 5000); reemplazarVideo(); }
      else detenerCaptura();
    });
    $('b-go').disabled = false;
    return true;
  }
  // Cambiar de ventana/pantalla en pleno directo sin cortar a los espectadores
  async function reemplazarVideo() {
    const q = CALIDADES[$('f-q').value] || CALIDADES['720p30'];
    try {
      const nuevo = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps, max: q.fps } }, audio: false });
      const vt = nuevo.getVideoTracks()[0]; vt.contentHint = 'motion';
      const viejo = stream.getVideoTracks()[0];
      stream.removeTrack(viejo); stream.addTrack(vt); stream._fuentes.push(nuevo);
      for (const { pc } of peers.values()) pc.getSenders().find(s => s.track?.kind === 'video' || s.track === viejo)?.replaceTrack(vt);
      whip?.pc.getSenders().find(s => s.track?.kind === 'video' || s.track === viejo)?.replaceTrack(vt);
      video.srcObject = stream;
      vt.addEventListener('ended', () => { if (enVivo) { toast('Dejaste de compartir.'); reemplazarVideo(); } });
    } catch (_) { toast('Sin video: tus espectadores ven la última imagen. Puedes terminar el live.'); }
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
  $('b-prev').onclick = () => capturar();
  $('b-go').onclick = async () => {
    if (fuente !== 'obs' && !stream && !(await capturar())) return;
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
      toast(e.message, 4000);
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
    window.onbeforeunload = e => { if (enVivo) { e.preventDefault(); e.returnValue = ''; } };

    conectar();
    const chat = crearChat($('side'), { liveId, esHost: true });
    const capa = capaRegalos($('gl'));
    const unirse = () => socket.emit('unirse', { liveId, rol: 'host' }, r => {
      if (!r?.ok) { toast(r?.error || 'No se pudo conectar el live'); return; }
      $('k-v').textContent = fmt(r.espectadores); $('k-l').textContent = fmt(r.likes); chat.pintarTop(r.top);
      if (!unirse.hecho) { r.chat.forEach(chat.add); chat.sys(`🔴 Estás en vivo. Comparte tu enlace para que te encuentren.`); unirse.hecho = true; }
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
    socket.on('chat', chat.add);
    socket.on('top', ({ top }) => chat.pintarTop(top));
    socket.on('regalo', g => {
      capa.regalo(g); chat.regalo(g);
      ganado += g.total * CFG.monedaUsd * (1 - CFG.comision);
      $('k-g').textContent = usd(ganado);
    });
    socket.on('reemplazado', () => { toast('Abriste el estudio en otra pestaña. Esta se desconectó.', 6000); enVivo = false; window.onbeforeunload = null; detenerCaptura(); peers.forEach((_, p) => cerrarPeer(p)); socket.disconnect(); });
    socket.on('fin', ({ motivo }) => terminar(motivo, true));
    timers.push(setInterval(() => socket.emit('latido', { liveId }), 25000));
    timers.push(setInterval(() => { const t = $('s-t'); if (t) t.textContent = dur(Date.now() - inicio); }, 1000));
    $('earn-note').innerHTML = `Recibes el <b>${Math.round((1 - CFG.comision) * 100)}%</b> del valor de cada regalo. ${CFG.retencionDias ? `Las ganancias quedan retenidas ${CFG.retencionDias} días (protección contra fraudes y contracargos) y luego pasan a tu saldo retirable.` : ''}`;
  }

  $('b-tit').onclick = async () => { try { await api('/live/titulo', { method: 'PUT', body: { titulo: $('l-tit').value } }); toast('Título actualizado'); } catch (e) { toast(e.message); } };
  $('b-mic-t').onclick = () => {
    const n = mezcla?.nodos.mic; if (!n) return;
    const off = n.g.gain.value > 0;
    n.prev = off ? n.g.gain.value : n.prev; n.g.gain.value = off ? 0 : (n.prev || 1);
    $('b-mic-t').innerHTML = off ? '<ion-icon name="mic-off"></ion-icon> Activar micro' : '<ion-icon name="mic"></ion-icon> Silenciar micro';
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
        <div class="kpi glass money"><b>${usd(ganado)}</b><small>Ganado</small></div>
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

/* ══════════════ Monedas (PayPal) ══════════════ */
let ppCargado = null;
function cargarPayPal() {
  if (ppCargado) return ppCargado;
  ppCargado = new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(CFG.paypal.clientId)}&currency=USD&intent=capture&components=buttons`;
    s.onload = ok; s.onerror = () => { ppCargado = null; ko(new Error('No se pudo cargar PayPal')); };
    document.head.appendChild(s);
  });
  return ppCargado;
}
async function abrirMonedas() {
  if (!TOKEN) return irLogin();
  await cargarConfig().catch(() => {});
  const saldo = await refrescarMonedas() || {};
  document.querySelector('.modal-bg')?.remove();
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal glass" role="dialog" aria-modal="true" aria-label="Monedas">
    <div class="modal-head"><h2>🪙 Monedas</h2><button class="ico-btn" id="m-x" aria-label="Cerrar"><ion-icon name="close"></ion-icon></button></div>
    <div class="bal"><div><small style="color:var(--txt2)">Tu saldo</small><br><b>${fmt(monedas)}</b></div><div style="text-align:right;font-size:.8rem;color:var(--txt2)">${saldo.saldoRetenido ? `Ganancias en retención:<br><b style="font-size:1rem;color:var(--txt)">${usd(saldo.saldoRetenido)}</b>` : 'Úsalas para enviar<br>regalos en los lives'}</div></div>
    ${CFG?.paypal ? `<div class="packs">${CFG.paquetes.map(p => `<button class="pack" data-p="${p.id}">${p.extra ? `<span class="px">${esc(p.extra)}</span>` : ''}<div class="pm">🪙 ${fmt(p.monedas)}</div><div class="pu">US$${p.usd.toFixed(2)}</div></button>`).join('')}</div>
      <div id="pp-buttons"><p class="fine" style="text-align:center">Elige un paquete para pagar con PayPal o tarjeta.</p></div>` : '<div class="note warn">Las compras de monedas aún no están activadas. Vuelve pronto.</div>'}
    <p class="fine">Las monedas no son reembolsables ni canjeables por dinero. Al comprar aceptas los <a href="./terminos_condiciones.html" target="_blank" style="color:var(--g)">términos</a>. El creador recibe el ${Math.round((1 - (CFG?.comision ?? 0.3)) * 100)}% del valor de cada regalo.</p>
  </div>`;
  document.body.appendChild(bg);
  const cerrar = () => bg.remove();
  bg.onclick = e => { if (e.target === bg) cerrar(); };
  bg.querySelector('#m-x').onclick = cerrar;
  bg.querySelectorAll('.pack').forEach(b => b.onclick = async () => {
    bg.querySelectorAll('.pack').forEach(x => x.classList.toggle('on', x === b));
    const box = bg.querySelector('#pp-buttons');
    box.innerHTML = '<p class="fine" style="text-align:center">Cargando PayPal…</p>';
    try {
      await cargarPayPal();
      box.innerHTML = '';
      await window.paypal.Buttons({
        style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'pay', height: 45 },
        createOrder: async () => (await api('/monedas/orden', { method: 'POST', body: { paquete: b.dataset.p } })).orderID,
        onApprove: async (data, actions) => {
          try {
            const d = await api('/monedas/capturar', { method: 'POST', body: { orderID: data.orderID } });
            monedas = d.monedas; $('coins-n').textContent = fmt(monedas);
            toast(`✅ +${fmt(d.acreditadas)} monedas`); cerrar();
          } catch (e) {
            if (e.data?.reintentar) return actions.restart();
            toast(e.message, 5000);
          }
        },
        onError: () => toast('PayPal tuvo un problema. Intenta de nuevo.'),
      }).render(box);
    } catch (e) { box.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
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
