// Imagen de respaldo local (antes via.placeholder.com, que dejó de existir: se veía la imagen rota)
window.UG_PH = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#12141c"/><text x="160" y="98" font-family="sans-serif" font-size="18" font-weight="700" fill="#3a3f4d" text-anchor="middle">UpGames</text></svg>');

// ═══════════════════════════════════════════════════════════
// UPGAMES — BIBLIOTECA REDESIGN v3.0
// Mobile-first · App Store style
// ═══════════════════════════════════════════════════════════

const API_URL = "https://upgames-production.up.railway.app";

// ── Sesión caducada o revocada: salir limpio en vez de quedar "conectado" con todo fallando ──
// (pasa al cambiar la contraseña en otro dispositivo, o cuando el token vence a los 30 días)
(function vigilarSesion() {
  const original = window.fetch.bind(window);
  let saliendo = false;
  window.fetch = async (input, init = {}) => {
    const r = await original(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const auth = init?.headers && (init.headers.Authorization || init.headers.authorization || (init.headers.get && init.headers.get('Authorization')));
      if (r.status === 401 && auth && url.startsWith(API_URL) && !saliendo) {
        const d = await r.clone().json().catch(() => ({}));
        if (['SESSION_REVOKED', 'TOKEN_EXPIRED', 'TOKEN_INVALID'].includes(d.code)) {
          saliendo = true;
          try { localStorage.removeItem('token'); localStorage.removeItem('user_admin'); sessionStorage.setItem('ug_sesion_msg', d.error || 'Vuelve a iniciar sesión'); } catch (_) {}
          location.replace('../index.html');
        }
      }
    } catch (_) {}
    return r;
  };
})();

// ── SAFE LOCALSTORAGE (modo incógnito estricto no rompe la app) ──────────
// Catálogo: portadas al ancho de la tarjeta, sin recortar (la tarjeta ya recorta con object-fit)
const CLD_TILE_FEED = 'c_limit,w_560,q_auto,f_auto', CLD_DESTACADA = 'c_limit,w_1100,q_auto,f_auto';
const LS = {
  get(k, fallback='') {
    try { return localStorage.getItem(k) ?? fallback; } catch(_) { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch(_) {}
  },
  remove(k) {
    try { localStorage.removeItem(k); } catch(_) {}
  },
  getJSON(k, fallback=null) {
    try { const r=localStorage.getItem(k); return r ? JSON.parse(r) : fallback; } catch(_) { return fallback; }
  },
  setJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch(_) {}
  }
};

// ── INVITADOS ────────────────────────────────────────────
// Ver, buscar y descargar es libre. Interactuar (comentar, favoritos, seguir, reportar,
// publicar, comprar, chatear en lives y Nexus) pide una cuenta: se muestra una hoja
// que lleva al login y luego devuelve al usuario exactamente a donde estaba.
const ugSesion = () => !!(LS.get('token') && LS.get('user_admin'));
function ugUrlLogin(registro) {
  const aqui = './public/' + location.pathname.split('/').pop() + location.search.replace(/[^\w=&%.~+?-]/g, '');
  return `../index.html?volver=${encodeURIComponent(aqui)}${registro ? '&registro=1' : ''}`;
}
function ugPedirSesion(accion = 'interactuar') {
  if (ugSesion()) return true;
  let h = document.getElementById('ug-login-sheet');
  if (!h) {
    const st = document.createElement('style');
    st.textContent = `#ug-login-sheet{position:fixed;inset:0;z-index:99990;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)}
#ug-login-sheet .ugl{width:min(440px,100%);background:#12141b;border:1px solid rgba(50,213,131,.25);border-radius:22px 22px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom));text-align:center;color:#e9ecf3;animation:uglUp .22s ease}
@media(min-width:600px){#ug-login-sheet{align-items:center}#ug-login-sheet .ugl{border-radius:22px}}
@keyframes uglUp{from{transform:translateY(30px);opacity:0}}
#ug-login-sheet .ic{font-size:2.2rem}#ug-login-sheet h3{margin:6px 0 4px;font-size:1.15rem}#ug-login-sheet p{margin:0 0 16px;color:#A3A8B6;font-size:.9rem;line-height:1.45}
#ug-login-sheet a{display:block;padding:13px;border-radius:14px;font-weight:800;text-decoration:none;margin-top:8px;font-size:.95rem}
#ug-login-sheet .p{background:#32D583;color:#04110a}#ug-login-sheet .s{border:1px solid rgba(255,255,255,.14);color:#e9ecf3}
#ug-login-sheet button{margin-top:10px;background:none;border:0;color:#8a90a0;font-size:.85rem;padding:6px 12px;cursor:pointer}`;
    document.head.appendChild(st);
    h = document.createElement('div'); h.id = 'ug-login-sheet'; h.setAttribute('role', 'dialog'); h.setAttribute('aria-modal', 'true');
    h.onclick = e => { if (e.target === h || e.target.dataset.cerrar !== undefined) h.remove(); };
  }
  h.innerHTML = `<div class="ugl"><div class="ic">🎮</div><h3>Crea tu cuenta gratis para ${escH(accion)}</h3>
    <p>Sin cuenta puedes ver y descargar todo. Con una cuenta además comentas, guardas favoritos, sigues creadores, chateas en los lives, publicas, ganas dinero y usas NEXUS IA.</p>
    <a class="p" href="${ugUrlLogin(true)}">Crear cuenta gratis</a><a class="s" href="${ugUrlLogin(false)}">Ya tengo cuenta · Iniciar sesión</a>
    <button type="button" data-cerrar>Ahora no</button></div>`;
  document.body.appendChild(h);
  return false;
}
window.ugPedirSesion = ugPedirSesion;
// ── Contador de UpCoins en la cabecera (comprados + ganados; toca para recargar) ──
function ugContadorUC(total) {
  if (!ugSesion()) return;
  const acc = document.querySelector('.hdr-actions'); if (!acc) return;
  let b = document.getElementById('hdr-uc');
  if (!b) {
    b = document.createElement('button'); b.id = 'hdr-uc'; b.type = 'button'; b.title = 'Tus UpCoins'; b.setAttribute('aria-label', 'Tus UpCoins');
    b.style.cssText = 'display:inline-flex;align-items:center;gap:5px;height:38px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,204,77,.35);background:rgba(255,204,77,.1);color:#ffcc4d;font-weight:800;font-size:.85rem;cursor:pointer;font-family:inherit;white-space:nowrap';
    b.onclick = () => { switchTab('economia'); setTimeout(() => { document.getElementById('eco-tienda')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); ecoAbrirTienda(); }, 350); };
    acc.insertBefore(b, acc.firstChild);
  }
  const pintar = t => { const n = Math.floor(t || 0); b.innerHTML = `🪙 <span>${n >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : n.toLocaleString('es-CO')}</span>`; };
  if (typeof total === 'number') return pintar(total);
  fetch(`${API_URL}/monedas/saldo`, { headers: { Authorization: `Bearer ${LS.get('token')}` } }).then(r => r.ok ? r.json() : null).then(d => d?.success && pintar(d.upcoins?.total ?? d.monedas)).catch(() => {});
}
window.ugContadorUC = ugContadorUC;
document.addEventListener('DOMContentLoaded', () => ugContadorUC());
window.addEventListener('ug:upcoins', () => ugContadorUC());

// ── Menú rápido radial: el orbe de la cabecera despliega las opciones en abanico ──
// Las burbujas se reparten en un cuarto de círculo hacia abajo-izquierda del orbe;
// las etiquetas van por fuera, sobre el mismo radio, para que nunca se pisen.
const UGR = (() => {
  let abierto = false;
  const raiz = () => document.getElementById('hdr-radial'), orbe = () => document.getElementById('hdr-orb');
  const ACCIONES = {
    live: () => { location.href = './live.html'; },
    subir: () => switchTab('upload'),
    premium: () => { switchTab('economia'); setTimeout(() => window.ecoCargarPlan?.(true), 350); },
    soporte: () => handleMail(),
  };
  function colocar() {
    const r = raiz(), o = orbe(); if (!r || !o) return;
    const b = o.getBoundingClientRect();
    r.style.setProperty('--ox', `${b.left + b.width / 2}px`); r.style.setProperty('--oy', `${b.top + b.height / 2}px`);   // --cy ya es el color cian
    const items = [...r.querySelectorAll('.ugr-item')], n = items.length;
    // Orbe pegado al borde (móviles angostos): el abanico termina un poco antes de "abajo"
    // para que la última etiqueta no se salga por la derecha.
    const fin = innerWidth - (b.left + b.width / 2) < 45 ? 102 : 90, arco = 180 - fin;
    const R = Math.min(n > 4 ? (arco < 90 ? 166 : 150) : 132, (innerWidth - 40) * 0.6);
    items.forEach((it, i) => {
      const ang = (180 - (n > 1 ? i * arco / (n - 1) : arco / 2)) * Math.PI / 180;   // 180° = izquierda · 90° = abajo
      const x = R * Math.cos(ang), y = R * Math.sin(ang);
      it.style.setProperty('--x', `${x.toFixed(1)}px`); it.style.setProperty('--y', `${y.toFixed(1)}px`);
      it.style.setProperty('--lx', `${(Math.cos(ang) * 62).toFixed(1)}px`); it.style.setProperty('--ly', `${(Math.sin(ang) * 44).toFixed(1)}px`);
      it.style.setProperty('--i', i);
    });
  }
  function abrir() {
    const r = raiz(); if (!r || abierto) return;
    abierto = true; colocar();
    r.classList.add('open'); r.setAttribute('aria-hidden', 'false');
    orbe()?.setAttribute('aria-expanded', 'true'); orbe()?.classList.add('on');
    setTimeout(() => r.querySelector('.ugr-item')?.focus({ preventScroll: true }), 120);
  }
  function cerrar(volverFoco) {
    const r = raiz(); if (!r || !abierto) return;
    abierto = false;
    r.classList.remove('open'); r.setAttribute('aria-hidden', 'true');
    orbe()?.setAttribute('aria-expanded', 'false'); orbe()?.classList.remove('on');
    if (volverFoco) orbe()?.focus({ preventScroll: true });
  }
  document.addEventListener('DOMContentLoaded', () => {
    const r = raiz(), o = orbe(); if (!r || !o) return;
    o.addEventListener('click', e => { e.stopPropagation(); abierto ? cerrar() : abrir(); });
    r.addEventListener('click', e => {
      if (e.target.closest('[data-ugr-cerrar]')) return cerrar(true);
      const it = e.target.closest('.ugr-item[data-ugr]'); if (!it) return;
      cerrar(); ACCIONES[it.dataset.ugr]?.();
    });
    r.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); return cerrar(true); }
      if (!/^Arrow/.test(e.key)) return;
      const l = [...r.querySelectorAll('.ugr-item')], i = l.indexOf(document.activeElement);
      e.preventDefault(); l[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length]?.focus();
    });
    addEventListener('resize', () => cerrar());
    addEventListener('scroll', () => cerrar(), { passive: true });
  });
  return { abrir, cerrar, colocar, get abierto() { return abierto; } };
})();
window.UGR = UGR;

// Invitados: botón "Entrar" en la cabecera (en lugar de pedir cuenta para mirar)
document.addEventListener('DOMContentLoaded', () => {
  if (ugSesion()) return;
  const acc = document.querySelector('.hdr-actions');
  if (!acc || document.getElementById('hdr-entrar')) return;
  const a = document.createElement('a');
  a.id = 'hdr-entrar'; a.href = ugUrlLogin(false); a.textContent = 'Entrar';
  a.style.cssText = 'display:inline-flex;align-items:center;padding:0 14px;height:38px;border-radius:999px;background:#32D583;color:#04110a;font-weight:800;font-size:.85rem;text-decoration:none;white-space:nowrap';
  acc.appendChild(a);
});

// State
let todosLosItems = [];
let filteredItems = [];
let mapaUsuarios = {};
let currentItem = null;
let currentTab = 'main';
let activeCategory = '';
let reportItemId = null;
let currentObserver = null;

// ── PRELOADER ─────────────────────────────────────────────
(function initPreloader() {
  const fill = document.getElementById('pl-fill');
  const preloader = document.getElementById('preloader');
  let closed = false;

  // Animar barra con delays absolutos: 30% → 55% → 75%
  setTimeout(() => { if(!closed) fill.style.width='30%'; }, 0);
  setTimeout(() => { if(!closed) fill.style.width='55%'; }, 300);
  setTimeout(() => { if(!closed) fill.style.width='75%'; }, 700);

  // Antes arrancaba solo un tutorial de 54 pasos que bloqueaba la pantalla. Ahora la
  // ayuda es la Guía de inicio y pistas puntuales (upgames-guia.js), sin bloquear nada.
  function afterPreloader() {}

  window.closePreloader = function() {
    if(closed) return;
    closed = true;
    fill.style.width='100%';
    setTimeout(()=>{
      preloader.classList.add('hide');
      if(typeof startTutorial === 'function') afterPreloader();
    }, 350);
  };

  // Si no hay caché, mostrar mensaje de estado al usuario
  const hasCachedItems = (()=>{ try{ const r=localStorage.getItem('upgames_items_cache'); if(!r) return false; const {ts}=JSON.parse(r); return (Date.now()-ts) < 120000; }catch(_){ return false; } })();
  if(!hasCachedItems) {
    const sub = preloader.querySelector('.pl-sub');
    if(sub) {
      setTimeout(()=>{ if(!closed) sub.textContent='CONECTANDO CON EL SERVIDOR...'; }, 800);
      setTimeout(()=>{ if(!closed) sub.textContent='EL SERVIDOR PUEDE TARDAR HASTA 30s...'; }, 4000);
    }
  }

  setTimeout(()=>{ window.closePreloader && window.closePreloader(); }, 1500);
})();

// (Se quitaron los "pings de despertar" no-cors: en Railway el backend no se
// duerme, el navegador descartaba su respuesta (CORP same-origin) y cada visita
// descargaba el catálogo y la lista de usuarios de más.)

// ── CACHE SYSTEM ──────────────────────────────────────────
const CACHE_KEY_ITEMS   = 'upgames_items_cache';
const CACHE_KEY_USERS   = 'upgames_users_cache';
const CACHE_TTL         = 10 * 60 * 1000; // 10 minutos

function cacheSet(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch(_) {}
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch(_) { return null; }
}

// ── TOAST ─────────────────────────────────────────────────
// Ajustes (biblioteca.html) llama a showToast(msg, 'error'|'success'): no existía y cada aviso
// lanzaba un error silencioso (el usuario no veía si su cambio funcionó).
function showToast(msg, tipo) { toast((tipo === 'error' ? '⚠️ ' : tipo === 'success' ? '✅ ' : '') + msg, tipo === 'error' ? 3800 : 2600); }
function toast(msg, dur=2500) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className='toast'; t.textContent=msg;
  c.appendChild(t);
  setTimeout(()=>{
    t.classList.add('out');
    setTimeout(()=>t.remove(), 320);
  }, dur);
}

// ── CUSTOM CONFIRM (reemplaza confirm() nativo) ────────────
function customConfirm({ icon='⚠️', title='', msg='', okText='Confirmar', okDanger=false } = {}) {
  return new Promise(resolve => {
    const el = document.getElementById('custom-confirm');
    document.getElementById('cc-icon').textContent = icon;
    document.getElementById('cc-title').textContent = title;
    document.getElementById('cc-msg').textContent = msg;
    const okBtn = document.getElementById('cc-ok');
    okBtn.textContent = okText;
    okBtn.className = 'cc-btn confirm' + (okDanger ? ' danger' : '');
    el.classList.add('show');
    document.body.style.overflow = 'hidden';
    const close = (val) => {
      el.classList.remove('show');
      document.body.style.overflow = '';
      resolve(val);
    };
    okBtn.onclick = () => close(true);
    document.getElementById('cc-cancel').onclick = () => close(false);
    el.onclick = (e) => { if(e.target === el) close(false); };
  });
}

// ── FORMAT NUMBER ─────────────────────────────────────────
function fmt(n) {
  if(n>=1e6) return (n/1e6).toFixed(1)+'M';
  if(n>=1e3) return (n/1e3).toFixed(1)+'K';
  return n||'0';
}

// ── TIME AGO ──────────────────────────────────────────────
function timeAgo(d) {
  const diff = Date.now()-new Date(d).getTime();
  const m=Math.floor(diff/60000), h=Math.floor(m/60), days=Math.floor(h/24);
  if(m<1) return 'Ahora';
  if(m<60) return m+'m';
  if(h<24) return h+'h';
  if(days<7) return days+'d';
  return new Date(d).toLocaleDateString('es-ES',{day:'numeric',month:'short'});
}

// ── VERIFICATION BADGE ────────────────────────────────────
function getBadge(usuario) {
  const n = mapaUsuarios[usuario]||0;
  if(!n) return '';
  const cls = ['','lv1','lv2','lv3'][n]||'lv3';
  return `<ion-icon name="checkmark-circle" class="verificado-badge ${cls}" title="Verificado nivel ${n}"></ion-icon>`;
}

// ── AVATAR LETTER ─────────────────────────────────────────
function avatarLetter(str) {
  return (str||'?')[0].toUpperCase();
}

// ── YOUTUBE HELPERS ──────────────────────────────────────
function getYouTubeId(url) {
  if(!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/))([-\w]{11})/i);
  return m ? m[1] : null;
}
function isYouTubeUrl(url) { return !!getYouTubeId(url); }
// ── Videos subidos ──
// Los teléfonos graban en formatos que el navegador no reproduce (3gp en Android, mov/hevc en iPhone…).
// Todo lo que está en /video/upload/ de Cloudinary es video, tenga la extensión que tenga, y se pide
// convertido a MP4 (H.264) cambiando la extensión: Cloudinary lo transcodifica y lo guarda.
const UG_VIDEO_EXT = /\.(mp4|webm|mov|m4v|avi|3gp|3g2|mkv|ogv|mpe?g|wmv|flv)(\?.*)?$/i;
const UG_CLD_VIDEO = /^https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\//i;
function ugEsVideoArchivo(url) { return !!url && (UG_VIDEO_EXT.test(url) || UG_CLD_VIDEO.test(url)); }
function ugVideoSrc(url) {
  const u = String(url || '');
  if (!UG_CLD_VIDEO.test(u) || /\.(mp4|webm)(\?.*)?$/i.test(u)) return u;
  return /\/[^/?]+\.[a-z0-9]{2,4}(\?.*)?$/i.test(u) ? u.replace(/\.[a-z0-9]{2,4}(\?.*)?$/i, '.mp4$1') : u + '.mp4';
}
// Miniatura de un video de Cloudinary (fotograma en el segundo 1)
function ugVideoThumb(url) {
  const u = String(url || '');
  if (!UG_CLD_VIDEO.test(u)) return '';
  const base = /\/[^/?]+\.[a-z0-9]{2,4}(\?.*)?$/i.test(u) ? u.replace(/\.[a-z0-9]{2,4}(\?.*)?$/i, '.jpg') : u + '.jpg';
  return base.replace('/video/upload/', '/video/upload/so_1,c_limit,w_960,q_auto/');
}
function isVideoUrl(url) {
  if(!url) return false;
  return ugEsVideoArchivo(url) || isYouTubeUrl(url);
}
function getYouTubeThumbnail(url) {
  const id = getYouTubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}
function getYouTubeEmbed(url, autoplay=0) {
  const id = getYouTubeId(url);
  return id ? `https://www.youtube.com/embed/${id}?autoplay=${autoplay}&mute=1&loop=1&playlist=${id}&controls=1&rel=0&playsinline=1` : null;
}

// ── TILE EXTRA BADGES — info por categoría ───────────────
function getTileExtras(item) {
  const ex = item.extraData || {};
  const cat = item.category || '';
  const badges = [];

  if(cat === 'Juego') {
    if(ex.plataforma) badges.push({ icon:'desktop-outline', text: ex.plataforma });
    if(ex.size)       badges.push({ icon:'archive-outline',  text: ex.size });
  } else if(cat === 'ROM') {
    if(ex.consola) badges.push({ icon:'disc-outline', text: ex.consola });
    if(ex.region)  badges.push({ icon:'globe-outline', text: ex.region.replace(/\s*\(.*\)/,'') });
  } else if(cat === 'Mod') {
    if(ex['juego-base']) badges.push({ icon:'game-controller-outline', text: ex['juego-base'] });
    if(ex.version)       badges.push({ icon:'git-branch-outline', text: 'v' + ex.version });
  } else if(cat === 'Apps') {
    if(ex.so)      badges.push({ icon:'phone-portrait-outline', text: ex.so });
    if(ex.version) badges.push({ icon:'code-working-outline',   text: 'v' + ex.version });
    if(ex.size)    badges.push({ icon:'archive-outline',         text: ex.size });
  } else if(cat === 'Software') {
    if(ex.licencia) badges.push({ icon:'document-text-outline', text: ex.licencia });
    if(ex.so)       badges.push({ icon:'desktop-outline',        text: ex.so });
  } else if(cat === 'Ajustes') {
    if(ex['tipo-herramienta']) badges.push({ icon:'construct-outline', text: ex['tipo-herramienta'] });
    if(ex.compatible)          badges.push({ icon:'checkmark-circle-outline', text: ex.compatible });
  } else if(cat === 'Optimizacion') {
    if(ex['tipo-opt'])  badges.push({ icon:'speedometer-outline', text: ex['tipo-opt'] });
    if(ex.compatible)   badges.push({ icon:'checkmark-circle-outline', text: ex.compatible });
  } else if(cat === 'Video') {
    if(item.videoType) badges.push({ icon:'film-outline', text: item.videoType });
  }

  if(!badges.length) return '';
  return `<div class="tile-extras">
    ${badges.slice(0,2).map(b =>
      `<span class="tile-extra-badge"><ion-icon name="${b.icon}"></ion-icon>${escH(b.text)}</span>`
    ).join('')}
  </div>`;
}

// Nombre visible de cada categoría (el valor guardado en la BD no cambia)
const CAT_LABEL = { Ajustes:'Herramientas', Optimizacion:'Optimización', Juego:'Juego', ROM:'ROM', Mod:'Mod', Apps:'App', Software:'Software', Video:'Video' };
const catLabel = c => CAT_LABEL[c] || c || 'General';

// ── SERIES POR PARTES ─────────────────────────────────────
// Un mod grande se publica en partes ("… parte 1", "… parte 2"). En el detalle
// se ve la parte siguiente; al descargar una parte se desbloquea la próxima.
// Cada parte es su propia publicación: cada descarga cuenta para el autor.
const SERIE_CACHE = new Map();
function partesDescargadas() { try { return new Set(JSON.parse(localStorage.getItem('ug_descargadas') || '[]')); } catch (_) { return new Set(); } }
function marcarDescargada(id) {
  try { const s = [...partesDescargadas()]; if (!s.includes(id)) { s.push(id); localStorage.setItem('ug_descargadas', JSON.stringify(s.slice(-3000))); } } catch (_) {}
}
const pareceParte = it => !!(it.serie?.clave || it.serieInfo || /\b(parte|part|pt|disco|disc|cd|vol)\.?\s*#?\s*(\d{1,3}|[ivx]{1,4})\b|[([]\s*\d{1,3}\s*(\/|de|of)\s*\d{1,3}\s*[)\]]/i.test(it.title || ''));
async function renderSerieDetalle(item) {
  const box = document.getElementById('ds-serie'); if (!box) return;
  box.style.display = 'none'; box.innerHTML = '';
  if (!item?._id || !pareceParte(item)) return;
  const clave = item.serie?.clave;
  let serie = clave && SERIE_CACHE.get(clave);
  if (!serie) {
    try { const r = await fetchTimeout(`${API_URL}/items/${item._id}/serie`, 8000); if (r.ok) serie = (await r.json()).serie; } catch (_) {}
    if (serie) SERIE_CACHE.set(serie.clave, serie);
  }
  if (!serie || currentItem?._id !== item._id) return;
  const partes = serie.partes, idx = partes.findIndex(p => p._id === item._id);
  if (idx < 0) return;
  const desc = partesDescargadas();
  const hechas = partes.filter(p => desc.has(p._id)).length;
  let ultima = -1; partes.forEach((p, i) => { if (desc.has(p._id)) ultima = i; });
  const visibleHasta = Math.min(partes.length - 1, Math.max(idx, ultima) + 1);
  const pct = Math.round(hechas / partes.length * 100);
  const filas = partes.slice(0, visibleHasta + 1).map((p, i) => {
    const n = p.serie?.parte || i + 1, hecha = desc.has(p._id), actual = i === idx, siguiente = i === visibleHasta && !hecha && !actual;
    const estado = actual ? '<span class="ds-serie-tag cur">Estás aquí</span>' : hecha ? '<span class="ds-serie-tag ok">✓ Descargada</span>' : siguiente ? '<span class="ds-serie-tag next">Siguiente</span>' : '';
    return `<button class="ds-serie-row ${actual ? 'cur' : ''} ${siguiente ? 'next' : ''}" data-i="${i}" ${actual ? 'disabled' : ''}>
      <span class="ds-serie-n">${hecha ? '✓' : n}</span><span class="ds-serie-t">Parte ${n}${p.linkStatus === 'caido' ? ' · ⚠️ enlace caído' : ''}</span>${estado}${actual ? '' : '<ion-icon name="chevron-forward"></ion-icon>'}</button>`;
  }).join('');
  const bloqueadas = partes.length - 1 - visibleHasta;
  box.innerHTML = `<div class="ds-serie">
    <div class="ds-serie-h"><ion-icon name="folder-open"></ion-icon><div><b>${escH(serie.base || 'Serie')}</b><small>Contenido dividido en ${partes.length} partes · ${fmt(serie.descargas || 0)} descargas en total</small></div></div>
    <div class="ds-serie-bar"><i style="width:${pct}%"></i></div><div class="ds-serie-prog">Has descargado ${hechas} de ${partes.length} partes</div>
    <div class="ds-serie-list">${filas}</div>
    ${bloqueadas > 0 ? `<div class="ds-serie-lock"><ion-icon name="lock-closed-outline"></ion-icon> ${bloqueadas} parte${bloqueadas > 1 ? 's' : ''} más: se desbloquean a medida que descargas</div>` : `<div class="ds-serie-lock ok"><ion-icon name="checkmark-done-outline"></ion-icon> Todas las partes disponibles</div>`}
  </div>`;
  box.style.display = '';
  box.querySelectorAll('.ds-serie-row:not([disabled])').forEach(b => b.addEventListener('click', () => {
    const p = partes[+b.dataset.i]; if (p) openDetail(todosLosItems.find(x => x._id === p._id) || p);
    document.querySelector('#detail-sheet .sheet-scroll')?.scrollTo?.({ top: 0, behavior: 'smooth' });
  }));
}

// Escapa texto de usuarios antes de meterlo en HTML (títulos, autores, URLs…).
// Antes los títulos se insertaban tal cual: un título con <img onerror> ejecutaba código en el catálogo.
const escH = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── CREATE TILE ───────────────────────────────────────────
function createTile(item, isFeatured=false) {
  const ls = item.linkStatus || (item.reportes>=3?'revision':'online');
  // Serie por partes: el catálogo muestra el título base + "📁 N partes"
  const tituloT = item.serieInfo?.base || item.title;
  const isOnline = ls==='online';
  const statusLabel = ls==='online'?'Online':ls==='revision'?'Revisión':'Caído';
  const cat = item.category || 'General';
  const isVideo = cat === 'Video';

  // Para video: la imagen es la miniatura, el link es el video real
  const imgSrc = item.image || '';
  const isVid = !isVideo && ugEsVideoArchivo(imgSrc);
  // Portadas al tamaño de la tarjeta (antes se bajaba la imagen original completa)
  const media = isVid
    ? `<video data-src="${escH(ugVideoSrc(imgSrc))}" muted loop playsinline preload="none" class="lazy-vid"></video>`
    : `<img src="${escH(cldOpt(imgSrc, CLD_TILE_FEED))}" alt="${escH(tituloT)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=window.UG_PH">`;

  const favIds = LS.getJSON('favoritos', []);
  const isFav = favIds.includes(item._id);
  const dl = item.descargasEfectivas||0;
  const lk = item.likesCount||0;
  const extraBadges = (item.serieInfo ? `<span class="tile-extra-badge tile-serie-badge"><ion-icon name="folder-open"></ion-icon>${item.serieInfo.partes} partes</span>` : '') + getTileExtras(item);

  if(isFeatured) {
    const el = document.createElement('div');
    el.className='featured-tile';
    el.dataset.id=item._id;
    const ftMedia = isVid
      ? `<video data-src="${escH(ugVideoSrc(imgSrc))}" muted loop playsinline preload="none" class="lazy-vid"></video>`
      : `<img src="${escH(cldOpt(imgSrc, CLD_DESTACADA))}" alt="${escH(tituloT)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=window.UG_PH">`;
    el.innerHTML=`
      <div class="thumb-wrap">${ftMedia}
        ${isVideo?'<div class="tile-video-overlay"><ion-icon name="play-circle"></ion-icon></div>':''}
      </div>
      <div class="ft-info">
        <div class="ft-badge">${isVideo?'▶ '+( item.videoType||'Video'):'⭐ Destacado'}</div>
        <div class="ft-title">${escH(tituloT)}</div>
        <div class="ft-meta">
          <div class="ft-user">@${escH(item.usuario||'Cloud')}${getBadge(item.usuario)}</div>
          ${lk?`<div class="ft-dl"><ion-icon name="heart"></ion-icon>${fmt(lk)}</div>`:''}
        </div>
      </div>`;
    el.addEventListener('click',()=>openDetail(item));
    return el;
  }

  const el = document.createElement('div');
  const catClass = cat.toLowerCase().replace('ó','o').replace('ó','o').replace(/[^a-z]/g,'');
  el.className = 'game-tile game-tile--' + catClass + (isVideo?' game-tile--video':'');
  el.dataset.id=item._id;
  if(item.usuario) el.dataset.u=String(item.usuario).toLowerCase();

  if(isVideo) {
    // Badge de duración — se guarda en extraData.duracion (formato "12:34")
    const duracion = item.extraData?.duracion || '';
    // YouTube-style card: thumbnail arriba, info abajo con avatar a la izquierda
    el.innerHTML=`
      <div class="thumb-wrap">
        ${media}
        <div class="tile-video-overlay"><ion-icon name="play-circle"></ion-icon></div>
        <div class="tile-status ${ls}"><span class="tile-status-dot"></span>${statusLabel}</div>
        <button class="tile-fav-quick ${isFav?'active':''}" data-id="${item._id}" title="Favorito" aria-label="${isFav?'Quitar de favoritos':'Añadir a favoritos'}">
          <ion-icon name="${isFav?'heart':'heart-outline'}"></ion-icon>
        </button>
        ${item.videoType?`<div class="tile-vid-type-badge">${escH(item.videoType)}</div>`:''}
        ${duracion?`<div class="tile-duration-badge">${duracion}</div>`:''}
      </div>
      <div class="tile-info tile-info--yt">
        <div class="tile-yt-avatar">${avatarLetter(item.usuario)}</div>
        <div class="tile-yt-body">
          <div class="tile-title">${escH(tituloT)}</div>
          <div class="tile-yt-meta">
            <span class="tile-user">@${escH(item.usuario||'Cloud')}${getBadge(item.usuario)}</span>
            ${dl?`<span class="tile-yt-dot">·</span><span class="tile-yt-views"><ion-icon name="eye-outline"></ion-icon>${fmt(dl)}</span>`:''}
            ${lk?`<span class="tile-yt-dot">·</span><span class="tile-yt-likes"><ion-icon name="heart"></ion-icon>${fmt(lk)}</span>`:''}
            ${window.UGR?.estrellasTile(item)||''}
          </div>
        </div>
      </div>`;
  } else {
    el.innerHTML=`
      <div class="thumb-wrap">
        ${media}
        <div class="tile-status ${ls}">
          <span class="tile-status-dot"></span>${statusLabel}
        </div>
        <button class="tile-fav-quick ${isFav?'active':''}" data-id="${item._id}" title="Favorito" aria-label="${isFav?'Quitar de favoritos':'Añadir a favoritos'}">
          <ion-icon name="${isFav?'heart':'heart-outline'}"></ion-icon>
        </button>

      </div>
      <div class="tile-info">
        <div class="tile-cat">${catLabel(cat)}${item.promocionado ? ' <span class="tile-promo" title="Su autor pagó para destacarla">Promocionado</span>' : ''}</div>
        ${extraBadges}
        <div class="tile-title">${escH(tituloT)}</div>
        <div class="tile-meta">
          <div class="tile-avatar">${avatarLetter(item.usuario)}</div>
          <div class="tile-user">@${escH(item.usuario||'Cloud')}</div>
          ${lk?`<div class="tile-downloads"><ion-icon name="heart"></ion-icon>${fmt(lk)}</div>`:''}
          ${window.UGR?.estrellasTile(item)||''}
        </div>
      </div>`;
  }

  el.addEventListener('click',(e)=>{
    if(e.target.closest('.tile-fav-quick')) return;
    openDetail(item);
  });
  el.querySelector('.tile-fav-quick').addEventListener('click',(e)=>{
    e.stopPropagation();
    fav(item._id);
  });
  return el;
}

// ── VIDEO CARD — siempre abre el detail sheet ────────────
function toggleVideoCard(el, item) { openDetail(item); }
function expandVideoCard(el, item) { openDetail(item); }
function collapseVideoCard(el) { el.classList.remove('expanded'); }


// ══════════════════════════════════════════════════
// HERO CAROUSEL — muestra los 10 primeros items
// ══════════════════════════════════════════════════
let heroItems = [];
let heroIdx = 0;
let heroTimer = null;
let heroTouchStartX = 0;
let heroAutoplayPaused = false;

function initHeroCarousel(items, isVideoMode) {
  // En modo video: top 10 más vistos. En modo normal: primeros 6
  heroItems = items.slice(0, isVideoMode ? 10 : 6);
  if(heroItems.length < 2) {
    // Ocultar carousel cuando no hay suficientes items
    const carousel = document.getElementById('hero-carousel');
    if(carousel) carousel.style.display = 'none';
    return;
  }
  
  const carousel = document.getElementById('hero-carousel');
  const track    = document.getElementById('hero-track');
  const dotsEl   = document.getElementById('hero-dots');
  
  carousel.style.display = 'block';
  // Marcar visualmente el carousel según el modo
  carousel.classList.toggle('hero-video-mode', !!isVideoMode);
  track.innerHTML = '';
  dotsEl.innerHTML = '';

  heroItems.forEach((item, i) => {
    const slide = document.createElement('div');
    slide.className = 'hero-slide' + (isVideoMode ? ' hero-slide--video' : '');
    slide.dataset.id = item._id;

    const isYT  = isYouTubeUrl(item.image);
    const isMp4 = ugEsVideoArchivo(item.image);
    let mediaSrc = item.image;
    if(isYT) mediaSrc = getYouTubeThumbnail(item.image);

    const lk = item.likesCount || 0;
    const vistas = item.descargasEfectivas || 0;

    // Badge: video mode usa icono play + cyan, normal usa estrella
    const badgeHTML = isVideoMode
      ? `<div class="hero-badge hero-badge--video"><ion-icon name="play-circle"></ion-icon> TOP ${i+1}</div>`
      : `<div class="hero-badge">⭐ Top ${i+1}</div>`;

    // Tipo de video (Tutorial, Gameplay, etc.)
    const vidTypeHTML = isVideoMode && item.videoType
      ? `<div class="hero-vid-type">${escH(item.videoType)}</div>`
      : '';

    slide.innerHTML = `
      <img src="${escH(cldOpt(mediaSrc, CLD_DESTACADA))}" alt="${escH(item.title)}" loading="${i===0?'eager':'lazy'}" decoding="async"
           onerror="this.onerror=null;this.src=window.UG_PH">
      ${isYT || isMp4 || isVideoMode ? '<div class="yt-play-badge large"><ion-icon name="play-circle"></ion-icon></div>' : ''}
      <div class="hero-info">
        ${badgeHTML}
        ${vidTypeHTML}
        <div class="hero-title">${escH(item.title)}</div>
        <div class="hero-meta">
          <span class="hero-user">@${escH(item.usuario||'Cloud')}${getBadge(item.usuario)}</span>
          ${isVideoMode && vistas ? `<span class="hero-dl"><ion-icon name="eye-outline"></ion-icon>${fmt(vistas)}</span>` : ''}
          ${lk ? `<span class="hero-dl"><ion-icon name="heart"></ion-icon>${fmt(lk)}</span>` : ''}
        </div>
      </div>`;

    // Click: video mode abre player inline en el output grid, normal abre detail
    slide.addEventListener('click', () => {
      if(isVideoMode) {
        const tileEl = document.querySelector(`.game-tile--video[data-id="${item._id}"]`);
        if(tileEl) {
          tileEl.scrollIntoView({ behavior:'smooth', block:'center' });
          setTimeout(() => expandVideoCard(tileEl, item), 400);
        } else {
          openDetail(item);
        }
      } else {
        openDetail(item);
      }
    });
    track.appendChild(slide);

    // Dot
    const dot = document.createElement('span');
    dot.className = 'hero-dot' + (i===0?' active':'');
    dot.addEventListener('click', (e) => { e.stopPropagation(); heroGoTo(i); });
    dotsEl.appendChild(dot);
  });

  heroGoTo(0);
  heroStartAutoplay();

  // Flechas
  document.getElementById('hero-prev').onclick = (e) => { e.stopPropagation(); heroPrev(); };
  document.getElementById('hero-next').onclick = (e) => { e.stopPropagation(); heroNext(); };

  // Swipe táctil
  carousel.addEventListener('touchstart', e => {
    heroTouchStartX = e.touches[0].clientX;
    heroAutoplayPaused = true;
  }, {passive:true});
  carousel.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - heroTouchStartX;
    if(Math.abs(dx) > 40) { dx < 0 ? heroNext() : heroPrev(); }
    setTimeout(() => { heroAutoplayPaused = false; }, 3000);
  }, {passive:true});
  
  // Pausar al tocar
  carousel.addEventListener('touchstart', () => { heroAutoplayPaused = true; }, {passive:true});
}

function heroGoTo(idx) {
  heroIdx = ((idx % heroItems.length) + heroItems.length) % heroItems.length;
  document.getElementById('hero-track').style.transform = `translateX(-${heroIdx * 100}%)`;
  document.querySelectorAll('.hero-dot').forEach((d,i) => d.classList.toggle('active', i===heroIdx));
}
function heroNext() { heroGoTo(heroIdx + 1); }
function heroPrev() { heroGoTo(heroIdx - 1); }

function heroStartAutoplay() {
  if(heroTimer) clearInterval(heroTimer);
  heroTimer = setInterval(() => {
    // No animar si la página no es visible
    if(!heroAutoplayPaused && !document.hidden) heroNext();
  }, 5000);
}

function heroStop() {
  if(heroTimer) { clearInterval(heroTimer); heroTimer = null; }
}

// ── LAZY VIDEO LOADER ─────────────────────────────────────
// Solo carga y reproduce videos cuando entran al viewport
let _vidObserver = null;
function initLazyVideos() {
  if(!('IntersectionObserver' in window)) {
    document.querySelectorAll('video.lazy-vid[data-src]').forEach(v=>{
      if(v.dataset.loaded) return;
      v.dataset.loaded='1'; v.src=v.dataset.src; v.play().catch(()=>{});
    });
    return;
  }
  if(!_vidObserver) {
    _vidObserver = new IntersectionObserver((entries)=>{
      entries.forEach(e=>{
        const v = e.target;
        if(e.isIntersecting) {
          if(!v.dataset.loaded && v.dataset.src) {
            v.dataset.loaded='1'; v.src=v.dataset.src; v.play().catch(()=>{});
          } else if(v.dataset.loaded) { v.play().catch(()=>{}); }
        } else { if(v.dataset.loaded) v.pause(); }
      });
    },{rootMargin:'150px'});
  }
  document.querySelectorAll('video.lazy-vid[data-src]').forEach(v=>{
    if(!v.dataset.observed){ v.dataset.observed='1'; _vidObserver.observe(v); }
  });
}

// ── RENDER — todo de una vez, sin scroll infinito ────────
function render(list, reset=true) {
  const out = document.getElementById('output');
  const skel = document.getElementById('skeleton');
  if(skel) skel.remove();
  if(currentObserver){ currentObserver.disconnect(); currentObserver=null; }
  if(!reset) return;
  if(typeof _vidObserver!=='undefined'&&_vidObserver){ _vidObserver.disconnect(); _vidObserver=null; }
  out.innerHTML='';
  if(list.length>0 && typeof initHeroCarousel==='function') {
    const isVideoMode = activeCategory === 'Video';
    const carouselSource = isVideoMode
      ? [...list].filter(i=>i.category==='Video').sort((a,b)=>(b.likesCount||0)-(a.likesCount||0))
      : [...list].filter(i=>i.category!=='Video').sort((a,b)=>(b.likesCount||0)-(a.likesCount||0));
    if(carouselSource.length) initHeroCarousel(carouselSource, isVideoMode);
  }
  if(!list.length) {
    out.innerHTML=`<div class="empty-state">
      <ion-icon name="cloud-offline-outline"></ion-icon>
      <h3>Sin resultados</h3>
      <p>No hay coincidencias en la nube.</p>
      <button type="button" class="empty-action empty-action--nexus" id="empty-ask-nexus"><span>✦</span> Pregúntale a Nexus</button>
      <button type="button" class="empty-action" onclick="switchTab('profile');setTimeout(()=>window.pfOpenPublish&&pfOpenPublish(),300)">Subir ahora</button>
    </div>`;
    const qBusq = document.getElementById('buscador')?.value?.trim();
    document.getElementById('empty-ask-nexus')?.addEventListener('click', () =>
      nexusPreguntar(qBusq ? `Busco "${qBusq}" en UpGames y no aparece. ¿Hay algo parecido o qué me recomiendas?` : '¿Qué me recomiendas descargar hoy en UpGames?'));
    return;
  }
  const frag = document.createDocumentFragment();
  list.forEach((item, idx) => {
    if(idx > 0 && idx % 12 === 0) {
      const sh = document.createElement('div');
      sh.className = 'section-header';
      sh.innerHTML = `<span class="section-title">Más Contenido</span><span class="section-count">${list.length} publicaciones</span>`;
      frag.appendChild(sh);
    }
    frag.appendChild(createTile(item, false));
  });
  out.appendChild(frag);
  initLazyVideos();
  window.UGX?.estilizarTiles?.(out);
}


// ── LOAD DATA ─────────────────────────────────────────────
// Helper: fetch con timeout configurable
function fetchTimeout(url, ms=10000, opts={}) {
  const ctrl = new AbortController();
  const tid = setTimeout(()=>ctrl.abort(), ms);
  return fetch(url, {...opts, signal:ctrl.signal})
    .finally(()=>clearTimeout(tid));
}

async function loadContent() {
  // ── PASO 1: Caché instantáneo — mostrar ANTES de red ──
  const cachedUsers = cacheGet(CACHE_KEY_USERS);
  if(cachedUsers) {
    cachedUsers.forEach(u=>{ mapaUsuarios[u.usuario]=u.verificadoNivel||0; });
  }

  const cachedItems = cacheGet(CACHE_KEY_ITEMS);
  if(cachedItems && cachedItems.length) {
    todosLosItems = cachedItems;
    // ← FIX: nunca mostrar videos en "Todos" — filtrar igual que la red
    filteredItems = activeCategory
      ? cachedItems.filter(i=>i.category===activeCategory)
      : cachedItems.filter(i=>i.category!=='Video');
    // Mostrar caché y cerrar preloader de inmediato — no esperar la red
    render(filteredItems);
    window.closePreloader && window.closePreloader();
  }

  // ── PASO 3: Actualizar desde la red en background ──
  try {
    // Catálogo y usuarios EN PARALELO (antes uno esperaba al otro: ~1 RTT + consulta de más)
    const pUsers = fetchTimeout(`${API_URL}/auth/users/public`, 8000).then(ru => ru.json()).then(users => {
      cacheSet(CACHE_KEY_USERS, users);
      users.forEach(u=>{ mapaUsuarios[u.usuario]=u.verificadoNivel||0; });
    }).catch(()=>{});
    const r = await fetchTimeout(`${API_URL}/items`, 12000);
    const data = await r.json();
    await pUsers;   // las insignias de verificado necesitan el mapa antes de pintar
    cacheSet(CACHE_KEY_ITEMS, data);

    const changed = data.length !== todosLosItems.length ||
      data.some((it,i) => !todosLosItems[i] || it._id !== todosLosItems[i]._id || it.scoreRecomendacion !== todosLosItems[i].scoreRecomendacion);
    todosLosItems = data;
    filteredItems = activeCategory
      ? data.filter(i=>i.category===activeCategory)
      : data.filter(i=>i.category!=='Video');

    window.closePreloader && window.closePreloader();
    if(changed || !cachedItems) render(filteredItems);

    // Deep link
    const sid = new URLSearchParams(window.location.search).get('id');
    if(sid && /^[a-f\d]{24}$/i.test(sid)) {
      setTimeout(async ()=>{
        let item = todosLosItems.find(i=>i._id===sid);
        // Enlaces de Google o compartidos: la publicación puede no estar en la primera página
        if(!item) { try { const r = await fetch(`${API_URL}/items/${sid}`); if(r.ok) { const d = await r.json(); item = d && d._id ? d : (d.item || null); } } catch(_) {} }
        if(item) openDetail(item);
      }, 600);
    }

  } catch(e) {
    console.error(e);
    window.closePreloader && window.closePreloader();
    // Si no hay caché tampoco, mostrar error
    if(!cachedItems || !cachedItems.length) {
      const out = document.getElementById('output');
      const skel = document.getElementById('skeleton');
      if(skel) skel.remove();
      out.innerHTML=`<div class="empty-state">
        <ion-icon name="cloud-offline-outline"></ion-icon>
        <h3>Sin conexión</h3>
        <p>No se pudo conectar con el servidor.<br>El servidor puede estar despertando (30s).<br>Verifica tu internet e intenta de nuevo.</p>
        <button class="empty-action" onclick="location.reload()">🔄 Reintentar</button>
      </div>`;
    }
  }
}

// ── CACHE INVALIDATION ───────────────────────────────────
// Llamar esto cuando el usuario sube, edita o elimina contenido
function invalidateCache() {
  try {
    LS.remove(CACHE_KEY_ITEMS);
  } catch(_) {}
}

// ── SEARCH (con debounce 280ms para no filtrar en cada keystroke) ──────────
let _searchTimer = null;
document.getElementById('buscador').addEventListener('input', function(e) {
  if (this.value.trim().length >= 3) window.dispatchEvent(new CustomEvent('ug:guia', { detail: 'explorar' }));
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    const q = e.target.value.toLowerCase().trim();
    if(q) {
      filteredItems = todosLosItems.filter(i=>
        i.title.toLowerCase().includes(q) ||
        (i.description&&i.description.toLowerCase().includes(q)) ||
        i.usuario.toLowerCase().includes(q) ||
        (i.category&&i.category.toLowerCase().includes(q)) ||
        (i.tags&&i.tags.some(t=>t.toLowerCase().includes(q)))
      );
    } else {
      filteredItems = activeCategory
        ? todosLosItems.filter(i=>i.category===activeCategory)
        : todosLosItems.filter(i=>i.category!=='Video');
    }
    render(filteredItems);
  }, 280);
});

// ── CATEGORY CHIPS ────────────────────────────────────────
document.querySelectorAll('.chip').forEach(c=>{
  c.addEventListener('click',function() {
    document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));
    this.classList.add('active');
    activeCategory = this.dataset.cat;
    window.dispatchEvent(new CustomEvent('ug:guia', { detail: 'explorar' }));
    // Limpiar buscador al cambiar categoría para evitar doble filtro silencioso
    const buscEl = document.getElementById('buscador');
    buscEl.value = '';
    filteredItems = activeCategory
      ? todosLosItems.filter(i=>i.category===activeCategory)
      : todosLosItems.filter(i=>i.category!=='Video');
    render(filteredItems);
  });
});

// ── REGISTRAR VISTA (videos) ──────────────────────────────
// Usa PUT /items/vistas/:id — backend deduplica por IP (1/día, TTL 24h).
// Frontend deduplica por sessionStorage para no volver a llamar en la misma sesión.
// La vista se registra si el usuario permanece 60 segundos en el video.
let _vistaTimer = null;
const _vistasRegistradas = new Set(); // deduplicación en sesión

function toastVista(msg) {
  let el = document.getElementById('toast-vista-el');
  if(!el) {
    el = document.createElement('div');
    el.id = 'toast-vista-el';
    el.className = 'toast-vista';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function registrarVista(item) {
  if(!item || !item._id) return;
  if(_vistaTimer) { clearTimeout(_vistaTimer); _vistaTimer = null; }

  _vistaTimer = setTimeout(async () => {
    _vistaTimer = null;
    // Deduplicación en sesión — no llamar si ya se registró en este tab
    if(_vistasRegistradas.has(item._id)) return;
    _vistasRegistradas.add(item._id);
    try {
      const r = await fetch(`${API_URL}/items/vistas/${item._id}`, { method: 'PUT' });
      if(r.ok) {
        const data = await r.json();
        if(data.duplicada) return; // IP ya contada hoy, no actualizar UI
        const newCount = data.descargasEfectivas ?? ((item.descargasEfectivas||0) + 1);
        item.descargasEfectivas = newCount;
        // Reflejar en stat del detail sheet
        const dlEl = document.getElementById('ds-dl');
        if(dlEl) dlEl.textContent = fmt(newCount);
        // Reflejar en tile de la lista
        const tile = document.querySelector(`.game-tile--video[data-id="${item._id}"]`);
        if(tile) {
          const viewsEl = tile.querySelector('.tile-yt-views');
          if(viewsEl) viewsEl.innerHTML = `<ion-icon name="eye-outline"></ion-icon>${fmt(newCount)}`;
        }
        // Toast feedback (punto 10)
        toastVista(`👁 +1 vista registrada`);
      }
    } catch(_) {}
  }, 60000);
}

// ── OPEN DETAIL SHEET ─────────────────────────────────────
// ── SEO por publicación: título, descripción, imagen y datos estructurados ──
const UG_SEO_BASE = { title: document.title, url: 'https://upgames.games/public/biblioteca.html' };
function ugMeta(attr, key, val) {
  let m = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!m) { m = document.createElement('meta'); m.setAttribute(attr, key); document.head.appendChild(m); }
  m.setAttribute('content', val);
}
function ugSeo(item) {
  try {
    const canon = document.head.querySelector('link[rel="canonical"]') || document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'canonical' }));
    let ld = document.getElementById('ug-ld-item');
    if (!item) {
      document.title = UG_SEO_BASE.title; canon.href = UG_SEO_BASE.url; if (ld) ld.remove();
      try { const u = new URL(location.href); if (u.searchParams.has('id')) { u.searchParams.delete('id'); history.replaceState(null, '', u.pathname + u.search); } } catch(_) {}
      return;
    }
    // Si ya tiene su página estática (public/p/, se genera a diario) esa es la canónica: evita contenido duplicado
    const slug = String(item.title || 'publicacion').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'publicacion';
    const estatica = item.status === 'aprobado' && item.createdAt && Date.now() - new Date(item.createdAt) > 36 * 3600e3;
    const url = estatica ? `https://upgames.games/public/p/${slug}-${item._id}.html` : `${UG_SEO_BASE.url}?id=${item._id}`;
    const desc = String(item.description || `${item.category || 'Contenido'} compartido por @${item.usuario} en UpGames.`).replace(/\s+/g, ' ').slice(0, 160);
    const img = /^https:\/\//.test(item.image || '') ? item.image : 'https://upgames.games/public/og-cover.png';
    document.title = `${item.title} — ${item.category || 'Descargar'} | UpGames`;
    canon.href = url;
    ugMeta('name', 'description', desc);
    ugMeta('property', 'og:title', `${item.title} | UpGames`); ugMeta('property', 'og:description', desc);
    ugMeta('property', 'og:image', img); ugMeta('property', 'og:url', url); ugMeta('property', 'og:type', 'website');
    ugMeta('name', 'twitter:card', 'summary_large_image');
    const tipo = item.category === 'Video' ? 'VideoObject' : (['Juego', 'ROMs'].includes(item.category) ? 'VideoGame' : 'SoftwareApplication');
    const datos = { '@context': 'https://schema.org', '@type': tipo, name: item.title, description: desc, image: img, url,
      author: { '@type': 'Person', name: item.usuario, url: `https://upgames.games/public/perfil-publico.html?usuario=${encodeURIComponent(item.usuario)}` },
      ...(item.createdAt ? { datePublished: item.createdAt } : {}),
      ...(tipo === 'VideoObject' ? { thumbnailUrl: img, uploadDate: item.createdAt || undefined, contentUrl: item.link } : { applicationCategory: tipo === 'VideoGame' ? 'Game' : 'Utilities', operatingSystem: 'Windows, Android', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } }),
      interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/DownloadAction', userInteractionCount: item.descargasEfectivas || 0 } };
    if (!ld) { ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.id = 'ug-ld-item'; document.head.appendChild(ld); }
    ld.textContent = JSON.stringify(datos).replace(/</g, '\\u003c');
    // URL propia para compartir y para que Google la asocie a esta publicación
    try { const u = new URL(location.href); if (u.searchParams.get('id') !== item._id) { u.searchParams.set('id', item._id); history.replaceState(null, '', u.pathname + u.search); } } catch(_) {}
  } catch (_) {}
}

function openDetail(item) {
  currentItem = item;
  ugSeo(item);
  const ls = item.linkStatus||(item.reportes>=3?'revision':'online');
  const isVideoItem = item.category === 'Video';

  // Para videos: el link ES el video; para otros: medias son imágenes/previews
  const rawMedias = [item.image, ...(item.images||[])].filter(m=>m&&m.trim());
  const allMedias = isVideoItem && item.link
    ? [item.link, ...rawMedias.filter(m=>m!==item.link)]
    : rawMedias;

  const firstVideo = isVideoItem
    ? (item.link || allMedias[0] || '')
    : (allMedias.find(m=>isYouTubeUrl(m)||ugEsVideoArchivo(m)) || allMedias[0] || '');
  const primaryMedia = firstVideo || allMedias[0] || '';

  function loadSheetMedia(mediaUrl) {
    const img2 = document.getElementById('ds-media-img');
    const vid2 = document.getElementById('ds-media-vid');
    const sheetMedia = document.querySelector('.sheet-media');
    const overlay = sheetMedia.querySelector('.sheet-media-overlay');

    // Limpiar inyecciones previas
    const oldIf  = document.getElementById('ds-yt-iframe');
    const oldVid = document.getElementById('ds-injected-vid');
    if(oldIf)  oldIf.remove();
    if(oldVid) oldVid.remove();

    const isYT2  = isYouTubeUrl(mediaUrl);
    const isMp42 = ugEsVideoArchivo(mediaUrl);

    if(isYT2) {
      img2.style.display='none'; vid2.style.display='none'; vid2.src='';
      if(overlay) overlay.style.display = isVideoItem ? 'none' : '';

      const yti = document.createElement('iframe');
      yti.id = 'ds-yt-iframe';
      const autoplay = isVideoItem ? 1 : 0;
      const mute     = isVideoItem ? 0 : 1;
      const ytId = getYouTubeId(mediaUrl);
      yti.src = `https://www.youtube.com/embed/${ytId}?autoplay=${autoplay}&mute=${mute}&controls=1&rel=0&playsinline=1${isVideoItem ? '' : ('&loop=1&playlist=' + ytId)}`;
      yti.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      yti.allowFullscreen = true;
      yti.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;border-radius:16px;';
      sheetMedia.appendChild(yti);

    } else if(isMp42) {
      img2.style.display = 'none';

      if(isVideoItem) {
        // Video item: inyectar <video> limpio con controls, igual que el iframe de YT
        vid2.style.display = 'none'; vid2.src = '';
        if(overlay) overlay.style.display = 'none';

        const nv = document.createElement('video');
        nv.id = 'ds-injected-vid';
        nv.src = ugVideoSrc(mediaUrl);
        if (ugVideoThumb(mediaUrl)) nv.poster = ugVideoThumb(mediaUrl);
        nv.controls = true;
        nv.autoplay  = true;
        nv.playsInline = true;
        // Sin border-radius en el elemento video — Android WebView lo bloquea al hacer fullscreen
        nv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;background:#000;object-fit:contain;';
        sheetMedia.appendChild(nv);

        // Botón de fullscreen explícito (usa la API del navegador, no el control nativo)
        // para evitar que overflow:hidden/clip del contenedor lo bloquee
        const fsBtn = document.createElement('button');
        fsBtn.id = 'ds-vid-fs-btn';
        fsBtn.setAttribute('aria-label','Pantalla completa');
        fsBtn.innerHTML = '<ion-icon name="expand-outline"></ion-icon>';
        fsBtn.style.cssText = [
          'position:absolute','bottom:10px','right:10px','z-index:20',
          'background:rgba(0,0,0,.6)','backdrop-filter:blur(6px)',
          'border:1px solid rgba(90,200,250,.35)','border-radius:8px',
          'color:#5AC8FA','font-size:1.05rem',
          'width:34px','height:34px',
          'display:flex','align-items:center','justify-content:center',
          'cursor:pointer','transition:opacity .15s'
        ].join(';');
        fsBtn.onclick = (e) => {
          e.stopPropagation();
          if      (nv.requestFullscreen)        nv.requestFullscreen();
          else if (nv.webkitRequestFullscreen)  nv.webkitRequestFullscreen();
          else if (nv.webkitEnterFullscreen)    nv.webkitEnterFullscreen(); // iOS/Safari
        };
        sheetMedia.appendChild(fsBtn);

        // Ocultar botón cuando el browser ya está en fullscreen
        const onFsChange = () => {
          const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
          fsBtn.style.display = inFs ? 'none' : 'flex';
        };
        document.addEventListener('fullscreenchange',       onFsChange);
        document.addEventListener('webkitfullscreenchange', onFsChange);
        // Limpiar listeners al cerrar
        nv._fsCleanup = () => {
          document.removeEventListener('fullscreenchange',       onFsChange);
          document.removeEventListener('webkitfullscreenchange', onFsChange);
        };
      } else {
        // Preview de juego: usar el <video> existente muted loop
        if(overlay) overlay.style.display = '';
        vid2.style.display = 'block';
        vid2.muted = true; vid2.loop = true;
        vid2.removeAttribute('controls');
        vid2.src = mediaUrl;
      }

    } else {
      // Imagen estática
      vid2.style.display = 'none'; vid2.src = '';
      if(overlay) overlay.style.display = '';
      img2.style.display = 'block'; img2.src = mediaUrl;
      img2.onerror = () => { img2.src = window.UG_PH; };
    }
  }
  loadSheetMedia(primaryMedia);

  // Galería de miniaturas
  const galleryEl = document.getElementById('ds-gallery');
  if(allMedias.length > 1) {
    galleryEl.style.display='flex'; galleryEl.innerHTML='';
    allMedias.forEach((m,i)=>{
      const th=document.createElement('div');
      th.className='gallery-thumb'+(m===primaryMedia?' active':'');
      const isYTt=isYouTubeUrl(m);
      const isMp4t=ugEsVideoArchivo(m);

      if(isMp4t) {
        // Punto 9: auto-capturar frame del video via canvas
        th.innerHTML=`<img src="${window.UG_PH}" alt="media ${i+1}">
          <div class="gallery-yt-icon"><ion-icon name="play-circle"></ion-icon></div>`;
        // Cloudinary da el fotograma ya hecho (antes se bajaba el video entero para capturarlo)
        const thC = ugVideoThumb(m);
        if (thC) { th.querySelector('img').src = thC.replace('c_limit,w_960', 'c_fill,w_288,h_208'); }
        // Otros servidores: captura de frame en segundo plano
        const tmpVid = thC ? null : document.createElement('video');
        if (tmpVid) {
        tmpVid.src = ugVideoSrc(m); tmpVid.crossOrigin = 'anonymous';
        tmpVid.muted = true; tmpVid.preload = 'metadata';
        tmpVid.currentTime = 1;
        tmpVid.addEventListener('loadeddata', () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 144; canvas.height = 104;
            canvas.getContext('2d').drawImage(tmpVid, 0, 0, 144, 104);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
            const imgEl = th.querySelector('img');
            if(imgEl) imgEl.src = dataUrl;
            tmpVid.src = '';
          } catch(_) { tmpVid.src = ''; }
        }, { once: true });
        }
      } else {
        const tSrc=isYTt?getYouTubeThumbnail(m):m;
        th.innerHTML=`<img src="${tSrc}" alt="media ${i+1}" onerror="this.onerror=null;this.src=window.UG_PH">
          ${isYTt?'<div class="gallery-yt-icon"><ion-icon name="play-circle"></ion-icon></div>':''}`;
      }
      th.onclick=()=>{
        document.querySelectorAll('.gallery-thumb').forEach(t2=>t2.classList.remove('active'));
        th.classList.add('active'); loadSheetMedia(m);
      };
      galleryEl.appendChild(th);
    });
  } else { galleryEl.style.display='none'; galleryEl.innerHTML=''; }

  document.getElementById('ds-cat').textContent=catLabel(item.category);
  document.getElementById('ds-title').textContent=item.title;
  document.getElementById('ds-dl').textContent=fmt(item.descargasEfectivas||0);
  document.getElementById('ds-rep').textContent=item.reportes||0;
  document.getElementById('ds-desc').textContent=item.description||'Sin descripción.';
  renderSerieDetalle(item);
  const askBtn = document.getElementById('ds-btn-nexus');
  if (askBtn) askBtn.onclick = () => nexusPreguntar(item.category === 'Video'
    ? `Cuéntame sobre el video "${item.title}" de @${item.usuario} y qué contenido relacionado hay en UpGames.`
    : `¿Qué es "${item.title}" (${catLabel(item.category)}) de @${item.usuario}? ¿Cómo lo instalo y qué necesito? ¿Hay algo parecido en UpGames?`);

  // ── Entrada destacada (solo para videos) ───────────────
  const featEl = document.getElementById('ds-featured-entry');
  if(featEl) {
    if(isVideoItem && item.featuredItemId) {
      featEl.style.display = '';
      featEl.innerHTML = '<div class="ds-featured-entry"><div class="ds-featured-label"><ion-icon name="sync-outline" style="animation:spinAnim .8s linear infinite"></ion-icon> Cargando entrada\u2026</div></div>';
      const cached = todosLosItems.find(i => i._id === item.featuredItemId);
      if(cached) {
        renderFeaturedEntry(featEl, cached);
      } else {
        fetch(`${API_URL}/items/${item.featuredItemId}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => { if(d && d._id) renderFeaturedEntry(featEl, d); else featEl.style.display = 'none'; })
          .catch(() => { featEl.style.display = 'none'; });
      }
    } else {
      featEl.style.display = 'none';
      featEl.innerHTML = '';
    }
  }

  // ← FIX bug 2: actualizar el stat-box de FAVS/likes con el número real
  const dsLikesEl = document.getElementById('ds-likes');
  if(dsLikesEl) {
    dsLikesEl.textContent = fmt(item.likesCount||0);
  } else {
    // Fallback: buscar el tercer stat-box y rellenar su stat-val
    const statBoxes = document.querySelectorAll('.sheet-stats .stat-box');
    if(statBoxes[2]) {
      const val = statBoxes[2].querySelector('.stat-val');
      if(val) val.textContent = fmt(item.likesCount||0);
    }
  }

  // Etiquetas adaptadas por tipo
  const dlStatLbl = document.querySelector('#ds-dl')?.closest?.('.stat-box')?.querySelector?.('.stat-lbl');
  if(dlStatLbl) dlStatLbl.textContent = isVideoItem ? 'Vistas' : 'Descargas';

  // Author
  document.getElementById('ds-av-letter').textContent=avatarLetter(item.usuario);
  document.getElementById('ds-author-name').innerHTML=`@${escH(item.usuario||'Cloud')} ${getBadge(item.usuario)}`;
  document.getElementById('ds-author').onclick=()=>visitarPerfil(item.usuario);

  // Status
  const sb = document.getElementById('ds-status');
  const st = document.getElementById('ds-status-text');
  sb.className='sheet-status-bar '+ls;
  st.textContent=ls==='online'?'✓ Link Activo':ls==='revision'?'⚠️ En Revisión':'✗ Link Caído';

  // Download / Ver video
  const dlBtn = document.getElementById('ds-download');
  if(isVideoItem) {
    // Video: el player está embebido arriba — ningún botón de acción aplica
    dlBtn.style.display = 'none';
    dlBtn.onclick = null;
    // Limpiar wrap y botón comprar que puedan haber quedado de una card anterior
    const _vWrap = document.getElementById('ds-action-wrap');
    if(_vWrap) _vWrap.remove();
    const _vBuy = document.getElementById('ds-buy-btn');
    if(_vBuy) _vBuy.remove();
  } else {
    dlBtn.style.display = '';
    const _puenteMedia = [item.image, ...(item.images||[])].filter(m=>m&&m.trim()).find(m=>
      /youtu/i.test(m)||/\.mp4|\.webm|\.mov/i.test(m)
    ) || item.image || '';
    const _puenteTitle = encodeURIComponent(item.title||'');
    const _puenteMediaEnc = encodeURIComponent(_puenteMedia);
    dlBtn.href = `puente.html?id=${item._id}&media=${_puenteMediaEnc}&title=${_puenteTitle}`;
    dlBtn.innerHTML = '<ion-icon name="cloud-download-outline"></ion-icon> OBTENER LINK';
    dlBtn.onclick = function(e) {
      marcarDescargada(item._id);
      if(ls === 'caido') {
        e.preventDefault();
        if(confirm('⚠️ Este link está reportado como caído.\n¿Deseas intentar acceder de todas formas?')) {
          window.open(`puente.html?id=${item._id}&media=${_puenteMediaEnc}&title=${_puenteTitle}`, '_blank');
        }
      }
    };

    // Botones Acceder + Comprar lado a lado
    const _existWrap = document.getElementById('ds-action-wrap');
    if(_existWrap) { _existWrap.parentNode.insertBefore(dlBtn, _existWrap); _existWrap.remove(); }
    const _existBuy = document.getElementById('ds-buy-btn');
    if(_existBuy) _existBuy.remove();

    const _det = item.extraData && item.extraData.detectedGame
      ? item.extraData.detectedGame
      : clientDetectGame(item.title, item.description);

    if(_det && _det.purchaseLink) {
      // Crear wrapper flex que contiene ambos botones
      const _wrap = document.createElement('div');
      _wrap.id = 'ds-action-wrap';
      _wrap.className = 'ds-action-wrap';

      // Clonar dlBtn dentro del wrapper
      const _cloudBtn = dlBtn.cloneNode(true);
      _cloudBtn.onclick = dlBtn.onclick;
      _wrap.appendChild(_cloudBtn);

      // Botón comprar
      const _buyBtn = document.createElement('button');
      _buyBtn.id = 'ds-buy-btn';
      _buyBtn.className = 'sheet-buy-btn';
      _buyBtn.innerHTML = '<ion-icon name="cart-outline"></ion-icon> COMPRAR';
      _buyBtn.onclick = function() { showBuyModal(item._id, _det.gameName, _det.purchaseLink); };
      _wrap.appendChild(_buyBtn);

      // Reemplazar dlBtn con el wrapper
      dlBtn.parentNode.insertBefore(_wrap, dlBtn);
      dlBtn.style.display = 'none';
    }
  }

  // Fav button
  const favIds = LS.getJSON('favoritos', []);
  const isFav = favIds.includes(item._id);
  const btnFav = document.getElementById('ds-btn-fav');
  btnFav.className='action-pill'+(isFav?' fav-active':'');
  btnFav.innerHTML=`<ion-icon name="${isFav?'heart':'heart-outline'}"></ion-icon> ${isFav?'Guardado':'Favorito'}`;
  btnFav.onclick=()=>{ fav(item._id); };

  document.getElementById('ds-btn-share').onclick=()=>share(item._id);
  document.getElementById('ds-btn-report').onclick=()=>openReportModal(item._id);

  // Comments
  document.getElementById('ds-comments-list').innerHTML='<div class="no-comments">Cargando...</div>';
  loadComments(item._id);
  document.getElementById('ds-comment-post').onclick=()=>postComment(item._id);
  document.getElementById('ds-comment-input').onkeypress=e=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();postComment(item._id);}
  };

  // Open sheet
  document.getElementById('detail-overlay').classList.add('show');
  document.getElementById('detail-sheet').classList.add('open');
  document.body.style.overflow='hidden';
  window.UGX?.alAbrirDetalle(item);   // botón "Apoyar" (usos extra de los UpCoins)
  window.UGR?.resenas(item);          // reseñas con estrellas + colecciones donde aparece
  window.dispatchEvent(new CustomEvent('ug:detalle', { detail: item._id }));   // guía de inicio

  // Registrar vista si es un video (usa ruta dedicada /items/vistas/:id con dedup IP)
  if(isVideoItem) {
    registrarVista(item);
    // Punto 12: inyectar botón teatro en .sheet-media
    const sheetMediaEl = document.querySelector('.sheet-media');
    if(sheetMediaEl && !document.getElementById('ds-btn-theater')) {
      const theatBtn = document.createElement('button');
      theatBtn.id = 'ds-btn-theater';
      theatBtn.setAttribute('aria-label', 'Modo teatro');
      theatBtn.title = 'Modo teatro';
      theatBtn.innerHTML = '<ion-icon name="tv-outline"></ion-icon>';
      theatBtn.onclick = (e) => { e.stopPropagation(); openTheater(item); };
      sheetMediaEl.appendChild(theatBtn);
    }
    // Punto 6: escuchar evento ended en el video inyectado o iframe
    setTimeout(() => { attachAutoplayListener(item); }, 800);
  }
}

// ── Renderiza la entrada destacada en el detail sheet ─────
function renderFeaturedEntry(container, item) {
  const cat   = item.category || 'General';
  const title = item.title    || 'Sin título';
  const img   = item.image    || '';
  const dl    = fmt(item.descargasEfectivas || 0);
  const ls    = item.linkStatus || 'online';
  const lsColor = ls === 'online' ? 'var(--g)' : ls === 'revision' ? '#ffcc00' : '#ff4343';
  const lsDot   = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${lsColor};margin-right:4px;vertical-align:middle"></span>`;

  container.innerHTML = `
    <div class="ds-featured-entry">
      <div class="ds-featured-label">
        <ion-icon name="pin"></ion-icon>
        Entrada del autor
      </div>
      <div class="ds-featured-card">
        <img src="${img}" alt="${title}"
             onerror="this.onerror=null;this.src=window.UG_PH">
        <div class="ds-featured-info">
          <div class="ds-featured-cat">${catLabel(cat)}</div>
          <div class="ds-featured-title">${title}</div>
          <div class="ds-featured-meta">
            ${lsDot}
            <ion-icon name="cloud-download-outline"></ion-icon>${dl} descargas
          </div>
        </div>
        <div class="ds-featured-arrow">
          <ion-icon name="chevron-forward-outline"></ion-icon>
        </div>
      </div>
    </div>`;

  container.querySelector('.ds-featured-card').addEventListener('click', () => openDetail(item));
}

function closeDetail() {
  ugSeo(null);
  // Cancelar vista pendiente si el usuario cierra antes del minuto
  if(_vistaTimer) { clearTimeout(_vistaTimer); _vistaTimer = null; }
  document.getElementById('detail-overlay').classList.remove('show');
  document.getElementById('detail-sheet').classList.remove('open');
  if(!tutActive && !nxOpen) document.body.style.overflow='';
  currentItem=null;
  const vid=document.getElementById('ds-media-vid'); vid.src=''; vid.style.display='none';
  const ytIf=document.getElementById('ds-yt-iframe'); if(ytIf) ytIf.remove();
  const injVid=document.getElementById('ds-injected-vid');
  if(injVid){ if(injVid._fsCleanup) injVid._fsCleanup(); injVid.remove(); }
  const fsBtn=document.getElementById('ds-vid-fs-btn'); if(fsBtn) fsBtn.remove();
  const theatBtn2=document.getElementById('ds-btn-theater'); if(theatBtn2) theatBtn2.remove();
  const apPanel=document.getElementById('autoplay-panel'); if(apPanel) apPanel.remove();
  if(_autoplayTimer){ clearTimeout(_autoplayTimer); _autoplayTimer=null; }
  // Restaurar overlay
  const overlay = document.querySelector('.sheet-media .sheet-media-overlay');
  if(overlay) overlay.style.display = '';
  const gal=document.getElementById('ds-gallery');
  if(gal){ gal.innerHTML=''; gal.style.display='none'; }
}

document.getElementById('ds-close').addEventListener('click', closeDetail);
document.getElementById('detail-overlay').addEventListener('click', closeDetail);

// ── SWIPE DOWN para cerrar el detail sheet ────────────────
(function initSheetSwipe() {
  const sheet = document.getElementById('detail-sheet');
  const handle = sheet.querySelector('.sheet-handle');
  let startY = 0, startScroll = 0, dragging = false;
  const THRESHOLD = 90; // px hacia abajo para cerrar

  function onStart(e) {
    const scroll = sheet.querySelector('.sheet-scroll');
    // Solo iniciar swipe si el scroll interno está en top=0
    if(scroll && scroll.scrollTop > 4) return;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startScroll = scroll ? scroll.scrollTop : 0;
    dragging = true;
    sheet.style.transition = 'none';
  }
  function onMove(e) {
    if(!dragging) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const dy = y - startY;
    if(dy > 0) {
      e.preventDefault();
      sheet.style.transform = `translateY(${dy}px)`;
    }
  }
  function onEnd(e) {
    if(!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    const y = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    const dy = y - startY;
    if(dy > THRESHOLD) {
      sheet.style.transform = '';
      closeDetail();
    } else {
      sheet.style.transform = '';
    }
  }
  handle.addEventListener('touchstart', onStart, {passive:true});
  sheet.addEventListener('touchmove', onMove, {passive:false});
  sheet.addEventListener('touchend', onEnd, {passive:true});
})();

// ── COMMENTS ─────────────────────────────────────────────
async function loadComments(id) {
  const list = document.getElementById('ds-comments-list');
  try {
    const r = await fetch(`${API_URL}/comentarios/${id}`);
    const comms = await r.json();
    if(!comms.length) {
      list.innerHTML='<div class="no-comments">Sé el primero en comentar</div>';
      return;
    }
    list.innerHTML=comms.map(c=>`
      <div class="comment-item" data-u="${escH(c.usuario)}">
        <div class="comment-head">
          <div class="comment-avatar">${escH(avatarLetter(c.usuario))}</div>
          <div class="comment-user"><span class="cu-n">@${escH(c.usuario)}</span>${getBadge(c.usuario)}</div>
          <div class="comment-time">${timeAgo(c.fecha)}</div>
        </div>
        <div class="comment-text">${escH(c.texto)}</div>
      </div>`).join('');
    window.UGX?.estilizarComentarios?.(list);   // foto, marco, color e insignias de cada autor
  } catch(e) {
    list.innerHTML='<div class="no-comments" style="color:#ff4343">Error al cargar</div>';
  }
}

async function postComment(id) {
  const user = LS.get('user_admin');
  if(!user) { ugPedirSesion('comentar'); return; }
  const input = document.getElementById('ds-comment-input');
  const texto = input.value.trim();
  if(!texto) return;
  try {
    const r = await fetch(`${API_URL}/comentarios`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${LS.get('token')}`},
      body:JSON.stringify({itemId:id,texto})
    });
    if(r.ok) {
      input.value='';
      loadComments(id);
      toast('✅ Comentario publicado');
    } else {
      const d = await r.json().catch(() => ({}));   // antes un error no mostraba nada
      toast('❌ ' + (d.error || (r.status === 401 ? 'Inicia sesión de nuevo para comentar' : 'No se pudo publicar el comentario')));
    }
  } catch(e) { toast('❌ Error al comentar'); }
}

// ── FAVORITES ────────────────────────────────────────────
async function fav(id) {
  const user = LS.get('user_admin');
  if(!user) { ugPedirSesion('guardar favoritos'); return; }
  try {
    const cr = await fetch(`${API_URL}/favoritos/${user}`);
    const favs = await cr.json();
    const isFav = Array.isArray(favs) && favs.some(f=>f._id===id);
    if(isFav) {
      await fetch(`${API_URL}/favoritos/remove`,{
        method:'DELETE',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${LS.get('token')}`},
        body:JSON.stringify({itemId:id})
      });
      toast('💔 Eliminado de favoritos');
      let local=LS.getJSON('favoritos', []);
      local=local.filter(f=>f!==id);
      LS.setJSON('favoritos', local);
    } else {
      await fetch(`${API_URL}/favoritos/add`,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${LS.get('token')}`},
        body:JSON.stringify({itemId:id})
      });
      toast('❤️ Añadido a favoritos');
      window.dispatchEvent(new CustomEvent('ug:guia', { detail: 'favorito' }));
      let local=LS.getJSON('favoritos', []);
      if(!local.includes(id)){local.push(id); LS.setJSON('favoritos', local);}
      // La notificación al autor ahora la crea el backend en /favoritos/add
    }
    // Update all heart buttons for this id
    document.querySelectorAll(`[data-id="${id}"] .tile-fav-quick`).forEach(b=>{
      const newFav=!isFav;
      b.className='tile-fav-quick'+(newFav?' active':'');
      b.innerHTML=`<ion-icon name="${newFav?'heart':'heart-outline'}"></ion-icon>`;
    });
    // Actualizar likesCount en el item local y reflejar en todas las tiles
    const newFavGlobal = !isFav;
    const localItem = todosLosItems.find(i => i._id === id);
    if(localItem) {
      localItem.likesCount = Math.max(0, (localItem.likesCount||0) + (newFavGlobal ? 1 : -1));
      // Reflejar el contador en tiles normales y featured
      document.querySelectorAll(`[data-id="${id}"] .tile-downloads, [data-id="${id}"] .ft-dl`).forEach(el => {
        el.innerHTML = `<ion-icon name="heart"></ion-icon>${fmt(localItem.likesCount)}`;
        el.style.display = localItem.likesCount > 0 ? '' : 'none';
      });
      // Reflejar en tile-yt-likes (video tiles)
      document.querySelectorAll(`[data-id="${id}"] .tile-yt-likes`).forEach(el => {
        el.innerHTML = `<ion-icon name="heart"></ion-icon>${fmt(localItem.likesCount)}`;
      });
    }
    // Actualizar tambien el boton del detail sheet si el item abierto es este
    const btnFav = document.getElementById('ds-btn-fav');
    if(btnFav && currentItem && currentItem._id === id) {
      btnFav.className = 'action-pill' + (newFavGlobal ? ' fav-active' : '');
      btnFav.innerHTML = `<ion-icon name="${newFavGlobal?'heart':'heart-outline'}"></ion-icon> ${newFavGlobal?'Guardado':'Favorito'}`;
    }
  } catch(e) { toast('❌ Error al guardar'); }
}

// ── SHARE ─────────────────────────────────────────────────
async function share(id) {
  const url=`${location.origin}${location.pathname}?id=${id}`;
  if(navigator.share) {
    try {
      await navigator.share({url,title:'Mira este contenido en UpGames',text:'Compartido desde UpGames'});
      toast('✅ Enlace compartido');
    } catch(_){ copyToClipboard(url); }
  } else {
    copyToClipboard(url);
  }
}
function copyToClipboard(t) {
  if(navigator.clipboard) {
    navigator.clipboard.writeText(t).then(()=>toast('📋 Enlace copiado')).catch(()=>fallbackCopy(t));
  } else { fallbackCopy(t); }
}
function fallbackCopy(t) {
  const inp=document.createElement('input');
  inp.value=t; document.body.appendChild(inp);
  inp.select(); inp.setSelectionRange(0,99999);
  try{document.execCommand('copy');toast('📋 Enlace copiado');}catch(_){toast('❌ No se pudo copiar');}
  inp.remove();
}

// ── REPORT ────────────────────────────────────────────────
function openReportModal(id) {
  if (!ugPedirSesion('reportar contenido')) return;
  reportItemId=id;
  document.getElementById('report-modal').classList.add('show');
}
function closeReportModal() {
  document.getElementById('report-modal').classList.remove('show');
  reportItemId=null;
}
document.querySelectorAll('.report-opt').forEach(btn=>{
  btn.addEventListener('click',function() {
    const motivo=this.dataset.motivo;
    sendReport(reportItemId,motivo);
    closeReportModal();
  });
});

async function sendReport(id, motivo) {
  try {
    const user=LS.get('user_admin','Anónimo');
    const r=await fetch(`${API_URL}/items/report/${id}`,{
      method:'PUT',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${LS.get('token')}`},
      body:JSON.stringify({motivo,usuario:user})
    });
    const data=await r.json();
    if(r.ok) {
      const labels={caido:'Link caído',viejo:'Obsoleto',malware:'Malware'};
      toast(`✅ Reporte enviado: ${labels[motivo]||motivo}`);
      if(data.linkStatus==='revision') {
        document.querySelectorAll(`[data-id="${id}"] .tile-status`).forEach(s=>{
          s.className='tile-status revision';
          s.innerHTML='<span class="tile-status-dot"></span>Revisión';
        });
      }
    } else if(r.status===429) {
      toast('⏱️ Ya reportaste este contenido recientemente');
    } else { toast('❌ Error al reportar'); }
  } catch(e) { toast('❌ Error de conexión'); }
}

// ── PROFILE NAVIGATION ───────────────────────────────────
function visitarPerfil(usuario) {
  window.location.href=`./perfil-publico.html?usuario=${encodeURIComponent(usuario)}`;
}

// ── HANDLE MAIL (abuse) ─────────────────────────────────
function handleMail(e) {
  if(e) e.preventDefault();
  const email='mr.m0onster@protonmail.com';
  const sub=encodeURIComponent('Soporte - UP GAMES');
  const body=encodeURIComponent('Hola, necesito ayuda con...\n\n[Describe tu problema aquí]');
  window.location.href=`mailto:${email}?subject=${sub}&body=${body}`;
}

// ── BOTTOM NAV TABS ───────────────────────────────────────
document.querySelectorAll('.nav-tab[data-tab]').forEach(tab=>{
  tab.addEventListener('click',function(){
    const t=this.dataset.tab;
    switchTab(t);
  });
});

function switchTab(t) {
  if (t === 'upload' && !ugPedirSesion('publicar contenido')) return;
  const abrirPublicar = t === 'upload';
  if(t==='upload') t='profile';
  if(abrirPublicar) setTimeout(() => pfOpenPublish && pfOpenPublish(true), 150);
  currentTab=t;
  window.dispatchEvent(new CustomEvent('ug:tab', { detail: t }));   // pistas de la guía (upgames-guia.js)
  document.querySelectorAll('.nav-tab').forEach(x=>x.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-tab[data-tab="${t}"]`);
  if(navBtn) navBtn.classList.add('active');
  document.getElementById('main-view').style.display=t==='main'?'':'none';
  document.getElementById('category-row').style.display=t==='main'?'':'none';
  // Carousel: reanudar en main, pausar en otros tabs
  if(t==='main') heroStartAutoplay && heroStartAutoplay();
  else heroStop && heroStop();
  const favsView     = document.getElementById('favs-view');
  const economiaView = document.getElementById('economia-view');
  const profileView  = document.getElementById('profile-view');
  favsView.classList.toggle('active',     t==='favs');
  economiaView.classList.toggle('active', t==='economia');
  profileView.classList.toggle('active',  t==='profile');
  if(t==='favs')     renderFavs();
  if(t==='economia') { renderEconomia(); pfStartEcoPolling(); ecoCargarPlan(); window.UGX?.hub(); }
  else               { pfStopEcoPolling(); }
  if(t==='profile')  renderProfile();
}

// ── FAVORITES VIEW ────────────────────────────────────────
async function renderFavs() {
  const user = LS.get('user_admin');
  const cont = document.getElementById('favs-grid');
  if(!cont) return;
  if(!user) {
    cont.innerHTML=`<div class="empty-state">
      <ion-icon name="person-circle-outline"></ion-icon>
      <h3>Inicia sesión</h3>
      <p>Guarda tus juegos favoritos y recíbelos en todos tus dispositivos.</p><a href="${ugUrlLogin(true)}" class="btn-login-action" style="margin-top:14px;display:inline-flex">Crear cuenta gratis</a><p style="margin-top:10px;font-size:.82rem"><a href="${ugUrlLogin(false)}" style="color:#32D583">Ya tengo cuenta</a></p>
    </div>`;
    return;
  }
  cont.innerHTML='<div class="pf-empty"><ion-icon name="sync-outline"></ion-icon><p>Cargando...</p></div>';
  try {
    const res = await fetch(`${API_URL}/favoritos/${user}`);
    const data = await res.json();
    const favs = Array.isArray(data) ? data : [];
    if(!favs.length) {
      cont.innerHTML=`<div class="empty-state">
        <ion-icon name="heart-outline"></ion-icon>
        <h3>Sin favoritos aún</h3>
        <p>Guarda contenido que te guste pulsando ❤️</p>
      </div>`;
      return;
    }
    cont.innerHTML='';
    favs.forEach(item => {
      if(!item) return;
      const card = document.createElement('div');
      card.className='pf-vault-card';
      card.innerHTML=`
        <img src="${item.image||window.UG_PH}" alt="${item.title||''}" onerror="this.onerror=null;this.src=window.UG_PH">
        <div class="pf-vault-info">
          <div class="pf-vault-title">${(item.title||'Sin título').substring(0,40)}</div>
          <div class="pf-vault-user">@${escH(item.usuario||'Anónimo')}</div>
          <div class="pf-vault-actions">
            <button class="pf-vault-btn access" onclick="window.open('puente.html?id=${item._id}','_blank')"><ion-icon name="cloud-download"></ion-icon> Acceder</button>
            <button class="pf-vault-btn remove" onclick="pfRemoveFav('${item._id}')"><ion-icon name="trash"></ion-icon> Quitar</button>
          </div>
        </div>`;
      cont.appendChild(card);
    });
  } catch(e) {
    cont.innerHTML='<div class="pf-empty" style="color:#ff4343"><p>Error al cargar favoritos</p></div>';
  }
}

// ── ECONOMIA VIEW ──────────────────────────────────────────
async function renderEconomia() {
  const user = LS.get('user_admin');
  if(!user) {
    const cont = document.getElementById('economia-view');
    if(cont) cont.innerHTML=`
      <div class="favs-header"><ion-icon name="cash-outline"></ion-icon> Mi Economía</div>
      <div class="empty-state" style="padding:40px 20px">
        <ion-icon name="person-circle-outline"></ion-icon>
        <h3>Inicia sesión</h3>
        <p>Con una cuenta ganas dinero por cada descarga de lo que publicas, recibes regalos en tus lives y ganas UpCoins (la moneda de UpGames) que puedes gastar o retirar, y puedes hacerte Premium: sin anuncios y NEXUS ilimitado.</p><a href="${ugUrlLogin(true)}" class="btn-login-action" style="margin-top:14px;display:inline-flex">Crear cuenta gratis</a><p style="margin-top:10px;font-size:.82rem"><a href="${ugUrlLogin(false)}" style="color:#32D583">Ya tengo cuenta</a></p>
      </div>`;
    return;
  }
  // Setear pfUser si aún no está seteado
  if(!pfUser) pfUser = user;
  // Registrar listeners de botones (por si es la primera vez que se abre esta vista)
  const btnPago   = document.getElementById('pf-btn-solicitar-pago');
  if(btnPago && !btnPago._listenerAdded) {
    btnPago.addEventListener('click', pfSolicitarPago);
    btnPago._listenerAdded = true;
  }
  pfStartEcoPolling();
}

// ── PROFILE TAB ──────────────────────────────────────────
function renderProfile() {
  const user = LS.get('user_admin');
  if(!user) {
    document.getElementById('pf-not-logged').style.display='';
    document.getElementById('pf-logged').style.display='none';
    return;
  }
  document.getElementById('pf-not-logged').style.display='none';
  document.getElementById('pf-logged').style.display='';
  pfInit(user);
}

// ═══════════════════════════════════════════════════════════
// PERFIL INTEGRADO — FULL LOGIC
// ═══════════════════════════════════════════════════════════
const PF_API = "https://upgames-production.up.railway.app";
let pfUser = null;
let pfInitialized = false;
let pfCurrentEditId = null;

function pfInit(user) {
  pfUser = user;
  if(pfInitialized) {
    // Refresh data
    pfChatBadge();
    pfLoadUserData();
    pfLoadHistorial();
    pfLoadEconomia();
    pfLoadTarjetas();
    return;
  }
  pfInitialized = true;
  pfChatBadge();
  pfLoadUserData();
  pfLoadHistorial();
  pfLoadBoveda();
  pfLoadEconomia();
  pfLoadTarjetas();
  pfInitForm();
}

// ── Load user data (badge, bio, avatar, stats) ──
async function pfLoadUserData() {
  if(!pfUser) return;
  document.getElementById('pf-username').textContent = '@' + pfUser;

  try {
    // Solo MI perfil (antes se descargaba la lista de TODOS los usuarios para buscarlo)
    const res = await fetch(`${PF_API}/usuarios/perfil-publico/${encodeURIComponent(pfUser)}`);
    const pd  = await res.json();
    const ud  = pd && pd.usuario;
    if(!ud) return;
    pfApplyBanner(ud.banner || '');

    const nivel = ud.verificadoNivel || 0;
    if(nivel > 0) {
      const cls = ['','lv1','lv2','lv3'][nivel]||'lv3';
      const ico = nivel === 3 ? 'checkmark-done-circle-sharp' : 'checkmark-circle';
      document.getElementById('pf-badge').innerHTML =
        `<ion-icon name="${ico}" class="verificado-badge ${cls}" title="Verificado nivel ${nivel}"></ion-icon>`;
    }

    if(ud.avatar && ud.avatar.trim()) {
      const img = document.getElementById('pf-avatar-img');
      const ico = document.getElementById('pf-avatar-icon');
      img.src = cldOpt(ud.avatar, CLD_AVATAR); img.style.display='block'; ico.style.display='none';
      const prev = document.getElementById('pf-preview-avatar');
      if(prev) { prev.innerHTML=''; const pi=document.createElement('img'); pi.src=ud.avatar; pi.alt='Avatar'; prev.appendChild(pi); }
      const inp = document.getElementById('pf-input-avatar-url');
      if(inp) inp.value = ud.avatar;
    }
    if(ud.bio && ud.bio.trim()) {
      document.getElementById('pf-bio').textContent = ud.bio;
      const inp = document.getElementById('pf-input-bio');
      if(inp) { inp.value = ud.bio; document.getElementById('pf-bio-count').textContent = ud.bio.length; }
    }
  } catch(e) { console.error('pfLoadUserData', e); }

  // Stats
  try {
    const sr = await fetch(`${PF_API}/usuarios/stats-seguimiento/${pfUser}`);
    if(sr.ok) {
      const sd = await sr.json();
      if(sd.stats) {
        document.getElementById('pf-stat-followers').textContent = sd.stats.seguidores || 0;
        document.getElementById('pf-stat-following').textContent = sd.stats.siguiendo || 0;
      }
    } else {
      // fallback
      const ur = await fetch(`${PF_API}/auth/users/public`);
      const us = await ur.json();
      const uu = us.find(u => u.usuario === pfUser);
      if(uu) {
        const seg = uu.listaSeguidores ? uu.listaSeguidores.length : (uu.seguidores ? uu.seguidores.length : 0);
        const sig = uu.siguiendo ? uu.siguiendo.length : 0;
        document.getElementById('pf-stat-followers').textContent = seg;
        document.getElementById('pf-stat-following').textContent = sig;
      }
    }
  } catch(e) {}

  // (El contador de publicaciones lo actualiza pfLoadHistorial: evita descargar dos veces la lista)

  // Gamificación — XP y nivel en header de perfil
  try {
    const token = LS.get('token');
    if(token) {
      const gr = await fetch(`${PF_API}/gamification/profile/${encodeURIComponent(pfUser)}`, { headers: { Authorization: `Bearer ${token}` } });
      if(gr.ok) {
        const gd = await gr.json();
        const g = gd.gamification || gd;
        if(g && g.nivel) {
          const xpEl = document.getElementById('pf-stat-xp');
          if(xpEl) { xpEl.textContent = `Nv.${g.nivel} · ${(g.xp||0).toLocaleString()} XP`; }
        }
      }
    }
  } catch(_) {}
}

// ── Inner tab switching ──
function pfSwitchTab(tabName, el) {
  if (tabName === 'publicar') { pfOpenPublish(true); return; }
  document.querySelectorAll('.perfil-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.perfil-tab-content').forEach(c => c.classList.remove('active'));
  if(el) el.classList.add('active');
  else document.querySelector(`[data-pftab="${tabName}"]`)?.classList.add('active');
  const tc = document.getElementById(`pf-tab-${tabName}`);
  if(tc) tc.classList.add('active');
  if(tabName === 'historial') pfLoadHistorial();
  if(tabName === 'boveda') pfLoadBoveda();
  if(tabName === 'reportes') pfLoadReportes();
  if(tabName === 'pagos') pfLoadHistorialPagos();
  if(tabName === 'logros') pfLoadLogros();
  if(tabName === 'colecciones') window.UGR?.colecciones(localStorage.getItem('user_admin') || '', document.getElementById('pf-colecciones'), { propio: true });
  if(tabName === 'economia') pfStartEcoPolling();
  else pfStopEcoPolling();
}

// ── Historial sub-nav ──
function histSwitchSubTab(tab, el) {
  document.querySelectorAll('.hist-subnav-tab').forEach(t => t.classList.remove('active'));
  if(el) el.classList.add('active');
  const panelPub = document.getElementById('hist-panel-publicaciones');
  const panelVid = document.getElementById('hist-panel-videos');
  if(panelPub) panelPub.style.display = tab === 'publicaciones' ? 'block' : 'none';
  if(panelVid) panelVid.style.display = tab === 'videos' ? 'block' : 'none';
}

// ── Publicaciones / Videos (pestañas superiores tipo Instagram) ──
function pfShowPosts(sub, el) {
  sub = sub === 'videos' ? 'videos' : 'publicaciones';
  const btn = el || document.querySelector(`.perfil-tab[data-sub="${sub}"]`);
  pfSwitchTab('historial', btn);
  histSwitchSubTab(sub);
  if (!el) document.getElementById('pf-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── "Crear publicación": botón que despliega todo el formulario ──
function pfOpenPublish(open) {
  const wrap = document.getElementById('pf-publish-wrap');
  const btn  = document.getElementById('pf-create-btn');
  if (!wrap || !btn) return;
  const abrir = open === undefined ? wrap.hidden : !!open;
  wrap.hidden = !abrir;
  btn.setAttribute('aria-expanded', String(abrir));
  btn.classList.toggle('open', abrir);
  if (typeof pfpVigilar === 'function') pfpVigilar(abrir);   // vista previa en vivo solo con el formulario abierto
  if (abrir) {
    wrap.classList.remove('pf2-publish-in'); void wrap.offsetWidth; wrap.classList.add('pf2-publish-in');
    setTimeout(() => btn.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }
}
function pfTogglePublish() { pfOpenPublish(); }

// ── Mensajes sin leer (botón Chats del perfil) ──
async function pfChatBadge() {
  const el = document.getElementById('pf-chat-n');
  const token = LS.get('token');
  if (!el || !token) return;
  try {
    const r = await fetch(`${PF_API}/chat/no-leidos`, { headers: { Authorization: `Bearer ${token}` } });
    const d = r.ok ? await r.json() : null;
    const n = d && d.noLeidos || 0;
    el.textContent = n > 99 ? '99+' : n; el.hidden = !n;
  } catch (_) {}
}
setInterval(() => { if (!document.hidden && currentTab === 'profile') pfChatBadge(); }, 30000);

// ── Compartir el perfil público ──
async function pfShareProfile() {
  if (!pfUser) return;
  const url = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}perfil-publico.html?usuario=${encodeURIComponent(pfUser)}`;
  try {
    if (navigator.share) { await navigator.share({ title: `@${pfUser} en UpGames`, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('🔗 Enlace de tu perfil copiado'); }
  catch (_) { prompt('Copia el enlace de tu perfil:', url); }
}

// ── Form: upload ──
function pfInitForm() {
  ['pf-addTitle','pf-addDescription','pf-addLink','pf-addImage'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', pfUpdatePreview);
    if(id === 'pf-addTitle' && el) el.addEventListener('input', pfValidateTitle);
  });
  const btn = document.getElementById('pf-subirBtn');
  if(btn) btn.addEventListener('click', pfSubirJuego);
  const btnV = document.getElementById('pf-subirVideoBtn');
  if(btnV) btnV.addEventListener('click', pfSubirVideo);
  // Video preview live update
  const vidTitle = document.getElementById('pf-vid-title');
  if(vidTitle) vidTitle.addEventListener('input', pfUpdateVideoPreview);
  document.addEventListener('click', e => {
    if(!e.target.closest('.pf-info-icon') && !e.target.closest('.pf-tooltip')) {
      document.querySelectorAll('.pf-tooltip').forEach(t => t.classList.remove('active'));
    }
  });
  // PayPal
  document.getElementById('pf-btn-solicitar-pago')?.addEventListener('click', pfSolicitarPago);
  // Edit save
  document.getElementById('pf-edit-save-btn')?.addEventListener('click', pfSaveEdit);
  // Init category form state
  pfOnCategoryChange('Juego', document.querySelector('.pf-cat-btn[data-cat="Juego"]'));
}

const PF_BANNED = ['crack','cracked','crackeado','crackeo','pirata','pirateado','piratear',
  'gratis','free','gratuito','full','completo','complete','premium gratis','pro gratis',
  'descargar gratis','download free'];
const PF_BANNED_VISUAL = ['crack','cracked','crackeado','crackeo','pirata','pirateado',
  'gratis','free','gratuito','full','completo','complete','premium','pro','descargar','download'];
const PF_ALLOWED_LINKS = ['mediafire.com','mega.nz','mega.co.nz','drive.google.com',
  'gofile.io','onedrive.live.com','icloud.com','proton.me','pcloud.com',
  'pixeldrain.com','1fichier.com','qiwi.gg','krakenfiles.com','dropbox.com','github.com','github.io','sto.romsfast.com','clarodrive.com'];

function pfAnalizarLink(url) {
  if(!url) return { ok: null };
  try {
    const h = new URL(url).hostname.replace('www.','');
    const ok = PF_ALLOWED_LINKS.some(d => h === d || h.endsWith('.'+d));
    if(!ok) return { ok:false, msg:'❌ Solo se permite MediaFire, Mega, Drive, etc. Sin acortadores.' };
    if(url.toLowerCase().endsWith('.exe')||url.toLowerCase().endsWith('.msi'))
      return { ok:false, msg:'⚠️ No enlaces directos a .exe. Usa .zip o .rar' };
    return { ok:true };
  } catch(e) { return { ok:false, msg:'❌ Formato de enlace inválido.' }; }
}

function pfPreviewSlot(slotIdx) {
  const ids = ['pf-addImage','pf-addImage2','pf-addImage3','pf-addImage4'];
  const url = document.getElementById(ids[slotIdx])?.value.trim();
  const prev = document.getElementById('pf-slot-prev-' + slotIdx);
  if(!prev) return;
  if(!url) { prev.classList.remove('show'); return; }
  const img = prev.querySelector('img');
  const displaySrc = isYouTubeUrl(url) ? getYouTubeThumbnail(url) : url;
  img.src = displaySrc;
  img.onerror = () => { prev.classList.remove('show'); prev.classList.add('rota'); };   // (via.placeholder.com ya no existe)
  img.onload = () => prev.classList.remove('rota');
  prev.classList.add('show');
  if (slotIdx === 0) pfpRender();
}

function pfUpdatePreview() {
  pfpRender();
  const linkEl = document.getElementById('pf-addLink');
  if(linkEl && linkEl.value.trim()) {
    const r = pfAnalizarLink(linkEl.value.trim());
    linkEl.classList.toggle('valid', r.ok === true);
    linkEl.classList.toggle('invalid', r.ok === false);
  } else if(linkEl) { linkEl.classList.remove('valid','invalid'); }
}

/* ── Vista previa fiel de la publicación: como la tarjeta del catálogo, con tu estilo ──
   Antes usaba via.placeholder.com (ya no existe: imagen rota) y solo cambiaba al pegar la portada. */
let _pfpSnap = '', _pfpTimer = null;
function pfpRender() {
  const v = id => (document.getElementById(id)?.value || '').trim();
  const titulo = v('pf-addTitle'), cat = v('pf-addCategory') || 'Juego', img = v('pf-addImage'), link = v('pf-addLink'), desc = v('pf-addDescription');
  const snap = [titulo, cat, img, link, desc.length].join('|'); if (snap === _pfpSnap) return; _pfpSnap = snap;
  const t = document.getElementById('pf-prev-title'); if (t) t.textContent = titulo || 'Título de tu publicación';
  const tag = document.getElementById('pf-prev-tag'); if (tag) tag.textContent = catLabel(cat).toUpperCase();
  const box = document.getElementById('pfp-prev-img');
  if (box) {
    const src = img ? (isYouTubeUrl(img) ? getYouTubeThumbnail(img) : img) : '';
    if (src) { box.innerHTML = `<img src="${ugEsc(src)}" alt="">${isYouTubeUrl(img) ? '<i class="pfp-play">▶</i>' : ''}`; box.querySelector('img').onerror = () => { box.innerHTML = '<span>⚠️ No se pudo cargar la imagen</span>'; }; }
    else box.innerHTML = '<span>Sin portada</span>';
  }
  document.getElementById('pfp-portada')?.classList.toggle('con', !!img);
  const yo = LS.get('user_admin', ''), au = document.getElementById('pfp-prev-autor');
  if (au && !au.dataset.ok && yo) { au.dataset.ok = '1'; au.innerHTML = `<span class="pfp-prev-av"></span><span class="pfp-prev-n">@${ugEsc(yo)}</span>`; window.UGX?.tarjetas?.([yo]).then(ts => { const tj = ts[yo.toLowerCase()]; window.UGX?.pintarAvatar?.(au.querySelector('.pfp-prev-av'), tj, yo[0].toUpperCase()); window.UGX?.aplicarEstilo?.(tj?.estilo || {}, { nombre: au.querySelector('.pfp-prev-n') }); }); }
  // Lista de lo que falta (simple y en lenguaje claro)
  const lk = link ? pfAnalizarLink(link) : { ok: null };
  const items = [
    [titulo.length >= 5, titulo ? (titulo.length >= 5 ? 'Título listo' : 'El título es muy corto') : 'Escribe un título'],
    [lk.ok === true, !link ? 'Pega el enlace de descarga' : lk.ok ? 'Enlace permitido' : (lk.msg || 'Revisa el enlace').replace(/^\W+\s*/, '')],
    [!!img, img ? 'Portada lista' : 'Agrega una portada (las publicaciones con portada se descargan mucho más)'],
    [desc.length >= 30, desc.length >= 30 ? 'Descripción lista' : 'Opcional: una descripción ayuda a que te encuentren'],
  ];
  const ul = document.getElementById('pfp-check');
  if (ul) ul.innerHTML = items.map(([ok, txt], i) => `<li class="${ok ? 'ok' : i === 3 ? 'opc' : 'falta'}">${ok ? '✓' : i === 3 ? '○' : '•'} ${ugEsc(txt)}</li>`).join('');
}
// Plantillas de descripción por categoría (modulos/plantillas.js) y "Que NEXUS la escriba"
let _pfpPlantillas = null;
async function pfpPlantilla() {
  const ta = document.getElementById('pf-addDescription'); if (!ta) return;
  try { if (!_pfpPlantillas) _pfpPlantillas = (await (await fetch(`${API_URL}/items/plantillas`)).json()).plantillas || {}; } catch (_) { return toast('⚠️ No se pudo cargar la plantilla'); }
  const cat = document.getElementById('pf-addCategory')?.value || 'Juego', tpl = _pfpPlantillas[cat] || _pfpPlantillas.Juego || '';
  if (ta.value.trim() && !confirm('¿Reemplazar lo que ya escribiste por la plantilla?')) return;
  ta.value = tpl; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus();
  const i = tpl.indexOf('• \n'); if (i >= 0) ta.setSelectionRange(i + 2, i + 2);   // cursor en el primer espacio por llenar
}
async function pfpNexusDescribe() {
  const ta = document.getElementById('pf-addDescription'), b = document.getElementById('pfp-nexus-desc'); if (!ta || !b) return;
  const title = (document.getElementById('pf-addTitle')?.value || '').trim();
  if (title.length < 3) return toast('✏️ Escribe primero el título');
  const tk = LS.get('token'); if (!tk) return ugPedirSesion('usar NEXUS');
  if (ta.value.trim() && !confirm('NEXUS reemplazará lo que escribiste. ¿Continuar?')) return;
  const extras = {}; document.querySelectorAll('#pf-extra-fields [id]').forEach(x => { if (x.value) extras[x.id.replace(/^pf-extra-?/, '')] = x.value; });
  b.disabled = true; const txt = b.textContent; b.textContent = '✦ Escribiendo…';
  try {
    const r = await fetch(`${API_URL}/items/describir`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
      body: JSON.stringify({ title, category: document.getElementById('pf-addCategory')?.value || 'Juego', extras }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success) return toast('⚠️ ' + (d.error || 'NEXUS no pudo escribirla ahora'));
    ta.value = d.descripcion; ta.dispatchEvent(new Event('input', { bubbles: true }));
    toast(d.fuente === 'nexus' ? '✦ Lista. Revísala y completa lo que diga "(complétalo)"' : '📋 Te dejamos la plantilla con lo que sabemos del título');
  } catch (_) { toast('⚠️ Error de conexión'); }
  finally { b.disabled = false; b.textContent = txt; }
}

// Los campos que llenan la nube o NEXUS cambian sin evento "input": se revisa cada 700 ms solo con el formulario abierto
function pfpVigilar(on) { clearInterval(_pfpTimer); _pfpTimer = on ? setInterval(() => { if (!document.hidden) pfpRender(); }, 700) : null; if (on) { _pfpSnap = ''; pfpRender(); } }
document.getElementById('pf-tab-publicar')?.addEventListener('input', () => pfpRender());

function pfValidateTitle() {
  const el = document.getElementById('pf-addTitle');
  if(!el) return;
  const txt = el.value.toLowerCase();
  const bad = PF_BANNED_VISUAL.some(k => new RegExp('\\b'+k+'\\b','i').test(txt));
  el.classList.toggle('invalid', bad && txt.length > 0);
  if(bad && txt.length > 0) el.classList.remove('valid');
}

// ══════════════════════════════════════════════════════
// FORMULARIO DINÁMICO POR CATEGORÍA
// ══════════════════════════════════════════════════════

const CLOUDINARY_CLOUD_NAME = 'dd4w2plxn';
const CLOUDINARY_UPLOAD_PRESET = 'upgames_videos';

// Config por categoría: icono, label, campos extra
const CAT_CONFIG = {
  Juego: {
    icon: 'game-controller', label: 'SUBIR JUEGO',
    extras: [
      { id:'pf-ex-plataforma', label:'Plataforma', type:'select',
        options:['PC','Android','iOS','PlayStation','Xbox','Nintendo Switch','Multi-plataforma'] },
      { id:'pf-ex-size', label:'Tamaño del archivo', type:'text', placeholder:'Ej: 25 GB' },
      { id:'pf-ex-requisitos', label:'Requisitos mínimos (opcional)', type:'textarea', placeholder:'CPU, RAM, GPU...' },
    ]
  },
  ROM: {
    icon: 'disc', label: 'SUBIR ROM',
    extras: [
      { id:'pf-ex-consola', label:'Consola / Sistema', type:'select',
        options:['NES','SNES','Nintendo 64','GameCube','Wii','Game Boy / Color','Game Boy Advance','Nintendo DS','Nintendo 3DS',
          'PlayStation 1','PlayStation 2','PSP','Sega Genesis / Mega Drive','Sega Dreamcast','Arcade (MAME)','Homebrew','Otra'] },
      { id:'pf-ex-region', label:'Región', type:'select', options:['USA (NTSC-U)','Europa (PAL)','Japón (NTSC-J)','Multi-región'] },
      { id:'pf-ex-emulador', label:'Emulador recomendado (opcional)', type:'text', placeholder:'Ej: RetroArch, PPSSPP, Dolphin...' },
      { id:'pf-ex-size', label:'Tamaño', type:'text', placeholder:'Ej: 8 MB' },
    ]
  },
  Mod: {
    icon: 'construct', label: 'SUBIR MOD',
    extras: [
      { id:'pf-ex-juego-base', label:'Juego base', type:'text', placeholder:'Ej: GTA V, Minecraft...' },
      { id:'pf-ex-version', label:'Versión compatible', type:'text', placeholder:'Ej: v1.0.3' },
    ]
  },
  Apps: {
    icon: 'phone-portrait', label: 'SUBIR APP',
    extras: [
      { id:'pf-ex-so', label:'Sistema Operativo', type:'select',
        options:['Android','iOS','Windows','macOS','Linux','Multi-plataforma'] },
      { id:'pf-ex-version', label:'Versión de la app', type:'text', placeholder:'Ej: 2.4.1' },
      { id:'pf-ex-size', label:'Tamaño', type:'text', placeholder:'Ej: 120 MB' },
    ]
  },
  Software: {
    icon: 'code-slash', label: 'SUBIR SOFTWARE',
    extras: [
      { id:'pf-ex-licencia', label:'Licencia', type:'select',
        options:['Open Source','Freeware','Shareware','MIT','GPL','Apache 2.0','Otro'] },
      { id:'pf-ex-so', label:'Sistema Operativo', type:'select',
        options:['Windows','macOS','Linux','Multi-plataforma'] },
      { id:'pf-ex-version', label:'Versión', type:'text', placeholder:'Ej: 3.2.0' },
    ]
  },
  Ajustes: {
    icon: 'settings', label: 'SUBIR HERRAMIENTA',
    extras: [
      { id:'pf-ex-tipo-herramienta', label:'Tipo de herramienta', type:'select',
        options:['Config / CFG','Script','Plugin','Extension','Pack de texturas','Otro'] },
      { id:'pf-ex-compatible', label:'Compatible con', type:'text', placeholder:'Ej: Windows 10/11, GTA V...' },
    ]
  },
  Optimizacion: {
    icon: 'speedometer', label: 'SUBIR OPTIMIZACIÓN',
    extras: [
      { id:'pf-ex-tipo-opt', label:'Tipo de mejora', type:'select',
        options:['Mejora de FPS','Reducción de lag','Visual/Gráficos','Audio','Red / Latencia','Otro'] },
      { id:'pf-ex-compatible', label:'Compatible con', type:'text', placeholder:'Ej: Windows 10/11...' },
    ]
  }
};

let pfCurrentCategory = 'Juego';
let pfCloudinaryWidget = null;
let pfVideoUrl = '';
let pfVideoSelectedType = 'Tutorial';

function pfOnCategoryChange(cat, btnEl) {
  pfCurrentCategory = cat;
  // Update hidden input
  const catInput = document.getElementById('pf-addCategory');
  if(catInput) catInput.value = cat;

  // Update category button styles
  document.querySelectorAll('.pf-cat-btn').forEach(b => b.classList.remove('active'));
  if(btnEl) btnEl.classList.add('active');

  const formStd = document.getElementById('pf-form-standard');
  const formVid = document.getElementById('pf-form-video');

  if(cat === 'Video') {
    if(formStd) formStd.style.display = 'none';
    if(formVid) formVid.style.display = 'block';
    pfLoadFeaturedSelector();
    return;
  }

  if(formStd) formStd.style.display = 'block';
  if(formVid) formVid.style.display = 'none';

  const cfg = CAT_CONFIG[cat] || CAT_CONFIG['Juego'];

  // Update header icon + label
  const icon  = document.getElementById('pf-form-icon');
  const label = document.getElementById('pf-form-cat-label');
  if(icon)  icon.setAttribute('name', cfg.icon);
  if(label) label.textContent = cfg.label;

  // Render extra fields
  const extraZone = document.getElementById('pf-extra-fields');
  if(!extraZone) return;
  extraZone.innerHTML = '';
  (cfg.extras || []).forEach(field => {
    const group = document.createElement('div');
    group.className = 'pf-form-group';
    let inputHTML = '';
    if(field.type === 'select') {
      inputHTML = `<select id="${field.id}" class="pf-select">
        ${field.options.map(o=>`<option value="${o}">${o}</option>`).join('')}
      </select>`;
    } else if(field.type === 'textarea') {
      inputHTML = `<textarea id="${field.id}" class="pf-textarea" placeholder="${field.placeholder||''}"></textarea>`;
    } else {
      inputHTML = `<input type="text" id="${field.id}" class="pf-input" placeholder="${field.placeholder||''}">`;
    }
    group.innerHTML = `<label class="pf-label">${field.label}</label>${inputHTML}`;
    extraZone.appendChild(group);
  });
}

// ── Video type selector ──
function pfSelectVidType(type, btnEl) {
  pfVideoSelectedType = type;
  document.querySelectorAll('.pf-vid-type-btn').forEach(b => b.classList.remove('active'));
  if(btnEl) btnEl.classList.add('active');
  document.getElementById('pf-vid-type').value = type;
  pfUpdateVideoPreview();
}

// ══════════════════════════════════════════════════════
// FEATURED ENTRY SELECTOR — Video Form
// ══════════════════════════════════════════════════════
let pfFeaturedItems = [];   // cache of non-video items for the selector

async function pfLoadFeaturedSelector() {
  if(!pfUser) return;

  // If an item is already selected, don't re-render the list
  const alreadySelected = document.getElementById('pf-vid-featured-id')?.value;
  if(alreadySelected) return;

  const list    = document.getElementById('pf-featured-list');
  const loading = document.getElementById('pf-featured-loading');
  if(!list) return;

  if(loading) { loading.style.display = 'flex'; list.innerHTML = ''; list.appendChild(loading); }

  try {
    const token = LS.get('token');
    const res = await fetch(`${PF_API}/items/user/${pfUser}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const data = await res.json();
    const items = Array.isArray(data) ? data : [];
    // Only approved, non-video items
    pfFeaturedItems = items.filter(i => i.category !== 'Video' && i.status !== 'pendiente' && i.status !== 'pending');
    pfRenderFeaturedList(pfFeaturedItems);
  } catch(e) {
    if(list) list.innerHTML = '<div style="padding:14px;color:var(--txt3);font-size:.75rem;text-align:center">Error al cargar publicaciones</div>';
  }
}

function pfRenderFeaturedList(items) {
  const list = document.getElementById('pf-featured-list');
  if(!list) return;

  if(!items.length) {
    list.innerHTML = `<div style="padding:16px;color:var(--txt3);font-size:.75rem;text-align:center;display:flex;flex-direction:column;gap:6px;align-items:center">
      <ion-icon name="cloud-offline-outline" style="font-size:1.4rem"></ion-icon>
      <span>No tienes publicaciones aprobadas disponibles</span>
    </div>`;
    return;
  }

  list.innerHTML = items.map(item => {
    const safeTitle = (item.title || '').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    const safeImg   = (item.image || '').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    const safeCat   = (item.category || 'General').replace(/'/g, '&#39;');
    return `
      <div class="pf-featured-item" onclick="pfSelectFeaturedItem('${item._id}','${safeTitle}','${safeImg}','${safeCat}')">
        <img src="${item.image || window.UG_PH}"
             alt="" loading="lazy"
             onerror="this.onerror=null;this.src=window.UG_PH">
        <div class="pf-featured-item-info">
          <div class="pf-featured-item-cat">${catLabel(item.category)}</div>
          <div class="pf-featured-item-title">${(item.title || 'Sin título').substring(0, 52)}</div>
        </div>
        <ion-icon name="pin-outline" class="pf-featured-item-add"></ion-icon>
      </div>`;
  }).join('');
}

function pfFilterFeaturedItems(query) {
  if(!query.trim()) { pfRenderFeaturedList(pfFeaturedItems); return; }
  const q = query.toLowerCase();
  const filtered = pfFeaturedItems.filter(i =>
    (i.title    || '').toLowerCase().includes(q) ||
    (i.category || '').toLowerCase().includes(q)
  );
  pfRenderFeaturedList(filtered);
}

function pfSelectFeaturedItem(id, title, image, cat) {
  document.getElementById('pf-vid-featured-id').value = id;
  const img = document.getElementById('pf-featured-sel-img');
  img.src = image || window.UG_PH;
  img.onerror = () => { img.src = window.UG_PH; };
  document.getElementById('pf-featured-sel-title').textContent = title;
  document.getElementById('pf-featured-sel-cat').textContent   = cat;
  document.getElementById('pf-featured-selected').style.display = 'flex';
  // Hide search + list
  const wrap = document.getElementById('pf-featured-search-wrap');
  const list = document.getElementById('pf-featured-list');
  if(wrap) wrap.style.display = 'none';
  if(list) list.style.display = 'none';
  toast('📌 Entrada anclada al video');
}

function pfClearFeaturedItem() {
  document.getElementById('pf-vid-featured-id').value = '';
  document.getElementById('pf-featured-selected').style.display = 'none';
  const wrap = document.getElementById('pf-featured-search-wrap');
  const list = document.getElementById('pf-featured-list');
  if(wrap) { wrap.style.display = ''; const inp = document.getElementById('pf-featured-search'); if(inp) inp.value = ''; }
  if(list) list.style.display = '';
  pfRenderFeaturedList(pfFeaturedItems);
}

// ── Cloudinary Widget UNIVERSAL (imágenes y videos) ──
// Usa sources:['local'] → abre directo el selector de archivos del teléfono (rápido).
// El widget maneja el preset correctamente (por eso no da "cloud_name is disabled").
let pfUniversalWidget = null;
let pfWidgetCallback  = null;

function pfGetUniversalWidget() {
  if(!pfUniversalWidget) {
    pfUniversalWidget = cloudinary.createUploadWidget({
      cloudName: CLOUDINARY_CLOUD_NAME,
      uploadPreset: CLOUDINARY_UPLOAD_PRESET,
      sources: ['local'],
      resourceType: 'auto',
      maxFileSize: 1610612736, // 1,5 GB (el plan de Cloudinary puede fijar un tope menor: ver el mensaje de error abajo)
      maxChunkSize: 20000000,  // sube por partes de 20 MB: aguanta mejor los datos móviles
      multiple: false,
      cropping: false,
      showAdvancedOptions: false,
      showSkipCropButton: false,
      styles: {
        palette: {
          window: '#0A0B0F', windowBorder: '#32D583', tabIcon: '#32D583',
          menuIcons: '#9090aa', textDark: '#f0f0f8', textLight: '#f0f0f8',
          link: '#32D583', action: '#32D583', inactiveTabIcon: '#555570',
          error: '#ff4343', inProgress: '#5AC8FA', complete: '#32D583', sourceBg: '#0d0d1a'
        }
      }
    }, (error, result) => {
      if(error) {
        const msg = String(error.message || error.statusText || error || 'Error');
        // El plan de almacenamiento rechaza archivos más pesados que su tope: explicar qué hacer
        const tope = /exceeds maximum|too large|maximum allowed/i.test(msg);
        if(pfWidgetCallback) pfWidgetCallback({ error: tope ? 'Ese archivo pesa más de lo que hoy acepta la nube de UpGames (100 MB por video). Comprímelo (p. ej. a 720p) o súbelo a YouTube y pega el enlace.' : msg });
        return;
      }
      if(result.event === 'progress' && pfWidgetCallback) {
        pfWidgetCallback({ progress: Math.round(result.info.progress || 0) });
      }
      if(result.event === 'success' && pfWidgetCallback) {
        pfWidgetCallback({ url: result.info.secure_url });
      }
    });
  }
  return pfUniversalWidget;
}

// Abre el widget y resuelve con la URL subida
// ── Widget de IMAGEN con recorte (portada 3:1, foto 1:1) ──
// Devuelve una URL de Cloudinary ya recortada y optimizada (formato y tamaño
// automáticos), así una foto de 4000px o HEIC del móvil se ve bien y carga rápido.
const _pfImgWidgets = {};
function pfImageUpload({ aspect = 1, transform = CLD_AVATAR, folder = 'avatars' } = {}) {
  return new Promise((resolve, reject) => {
    const key = String(aspect);
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; fn(v); } };
    _pfImgWidgets[key + '_cb'] = { resolve: v => finish(resolve, v), reject: e => finish(reject, e) };
    if (!_pfImgWidgets[key]) {
      _pfImgWidgets[key] = cloudinary.createUploadWidget({
        cloudName: CLOUDINARY_CLOUD_NAME,
        uploadPreset: CLOUDINARY_UPLOAD_PRESET,
        folder,
        sources: ['local', 'camera', 'url'],
        resourceType: 'image',
        clientAllowedFormats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif'],
        maxImageFileSize: 25 * 1024 * 1024,
        multiple: false,
        cropping: true,
        croppingAspectRatio: aspect,
        croppingCoordinatesMode: 'custom',
        croppingShowDimensions: true,
        showSkipCropButton: false,
        language: 'es',
        text: { es: { crop: { title: aspect === 1 ? 'Recorta tu foto' : 'Recorta tu portada', crop_btn: 'Listo' } } },
        styles: { palette: { window: '#0A0B0F', windowBorder: '#32D583', tabIcon: '#32D583', menuIcons: '#9090aa', textDark: '#f0f0f8', textLight: '#f0f0f8', link: '#32D583', action: '#32D583', inactiveTabIcon: '#555570', error: '#ff4343', inProgress: '#5AC8FA', complete: '#32D583', sourceBg: '#0d0d1a' } }
      }, (error, result) => {
        const cb = _pfImgWidgets[key + '_cb'];
        if (!cb) return;
        if (error) { cb.reject(new Error(error.message || error.statusText || 'No se pudo subir la imagen')); return; }
        if (result.event === 'success') {
          const info = result.info || {};
          let url = info.secure_url || '';
          const c = info.coordinates && info.coordinates.custom && info.coordinates.custom[0];
          const crop = c ? `c_crop,x_${Math.round(c[0])},y_${Math.round(c[1])},w_${Math.round(c[2])},h_${Math.round(c[3])}/` : '';
          url = url.replace('/image/upload/', `/image/upload/${crop}${transform}/`).replace(/\.(heic|heif)$/i, '.jpg');
          cb.resolve(url);
          try { _pfImgWidgets[key].close(); } catch (_) {}
        }
        if (result.event === 'close') cb.resolve(null);   // cerró sin subir
      });
    }
    _pfImgWidgets[key].open();
  });
}

function pfWidgetUpload(onProgress) {
  return new Promise((resolve, reject) => {
    pfWidgetCallback = (res) => {
      if(res.error) { reject(new Error(res.error)); pfWidgetCallback = null; }
      else if(res.progress !== undefined && onProgress) onProgress(res.progress);
      else if(res.url) { resolve({ success: true, url: res.url }); pfWidgetCallback = null; }
    };
    pfGetUniversalWidget().open();
  });
}

// ── Video form: usa el widget universal ──
function pfOpenCloudinaryWidget() { pfOpenVideoUpload(); }

async function pfOpenVideoUpload() {
  pfCldShowUploading();
  try {
    const data = await pfWidgetUpload((pct) => {
      const fill = document.getElementById('pf-cld-progress-fill');
      if(fill) fill.style.width = pct + '%';
    });
    if(data.success) {
      pfVideoUrl = data.url;
      document.getElementById('pf-vid-url').value = pfVideoUrl;
      pfCldShowDone(pfVideoUrl);
      toast('✅ Video subido a la nube');
    }
  } catch(e) {
    toast('❌ ' + e.message);
    pfCldShowIdle();
  }
}

function pfCldShowIdle() {
  document.getElementById('pf-cld-idle').style.display = '';
  document.getElementById('pf-cld-uploading').style.display = 'none';
  document.getElementById('pf-cld-done').style.display = 'none';
}
function pfCldShowUploading() {
  document.getElementById('pf-cld-idle').style.display = 'none';
  document.getElementById('pf-cld-uploading').style.display = '';
  document.getElementById('pf-cld-done').style.display = 'none';
}
function pfCldShowDone(url) {
  document.getElementById('pf-cld-idle').style.display = 'none';
  document.getElementById('pf-cld-uploading').style.display = 'none';
  document.getElementById('pf-cld-done').style.display = '';
  const vid = document.getElementById('pf-vid-preview');
  if(vid) { vid.src = ugVideoSrc(url); }
  pfUpdateVideoPreview();
}

// ── Video card preview update ──
function pfUpdateVideoPreview() {
  const title = document.getElementById('pf-vid-title')?.value || 'Título del Video';
  const thumb = document.getElementById('pf-vid-thumbnail')?.value || '';
  const type  = pfVideoSelectedType || 'Tutorial';

  document.getElementById('pf-vpc-title').textContent = title;
  document.getElementById('pf-vpc-type').textContent  = type;

  const img = document.getElementById('pf-vpc-img');
  if(thumb) {
    img.src = thumb;
    const prev = document.getElementById('pf-vid-thumb-prev');
    if(prev) { prev.querySelector('img').src = thumb; prev.classList.add('show'); }
  } else if(pfVideoUrl) {
    // Auto-generate thumbnail from Cloudinary (replace extension with .jpg)
    img.src = ugVideoThumb(pfVideoUrl) || pfVideoUrl.replace(/\.(mp4|webm|mov|avi)/i, '.jpg');
  }
}

// ── Upload Video to backend ──
async function pfSubirVideo() {
  if(!pfUser) return toast('⚠️ Debes iniciar sesión.');
  const ahora = Date.now();
  const ult = LS.get('ultima_publicacion');
  if(ult && ahora - parseInt(ult) < 30000) {
    const s = Math.ceil((30000-(ahora-parseInt(ult)))/1000);
    return toast(`⏱️ Anti-spam: Espera ${s}s antes de publicar.`);
  }

  const titulo = document.getElementById('pf-vid-title')?.value.trim();
  const desc   = document.getElementById('pf-vid-description')?.value.trim();
  const vidUrl = document.getElementById('pf-vid-url')?.value.trim();
  const thumb  = document.getElementById('pf-vid-thumbnail')?.value.trim();
  const type   = document.getElementById('pf-vid-type')?.value || 'Tutorial';
  const duracion = document.getElementById('pf-vid-duracion')?.value.trim() || '';
  const featuredItemId = document.getElementById('pf-vid-featured-id')?.value.trim() || '';

  if(!titulo)  return toast('⚠️ El título es obligatorio.');
  if(!vidUrl)  return toast('⚠️ Debes subir un video primero.');

  // Auto-thumb desde Cloudinary si no hay manual
  // Sin portada manual: fotograma del video (antes, con un .3gp quedaba el mismo video como "imagen")
  const thumbFinal = thumb || ugVideoThumb(vidUrl) || (ugEsVideoArchivo(vidUrl) ? '' : vidUrl);

  const token = LS.get('token');
  if(!token) { alert('⚠️ Sesión expirada.'); location.href='./index.html'; return; }

  const btn = document.getElementById('pf-subirVideoBtn');
  btn.textContent = 'Publicando...'; btn.disabled = true;
  try {
    const res = await fetch(`${PF_API}/items/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        title:    titulo,
        description: desc,
        link:     vidUrl,
        image:    thumbFinal,
        images:   [],
        category: 'Video',
        videoType: type,
        extraData: duracion ? { duracion } : {},
        featuredItemId: featuredItemId || undefined,
        usuario:  pfUser,
        status:   'pendiente'
      })
    });
    if(res.ok) {
      LS.set('ultima_publicacion', Date.now().toString());
      window.dispatchEvent(new CustomEvent('ug:guia', { detail: 'publicar' }));
      toast('✅ Video publicado. Esperando aprobación.');
      // Reset form
      document.getElementById('pf-vid-title').value = '';
      document.getElementById('pf-vid-description').value = '';
      document.getElementById('pf-vid-thumbnail').value = '';
      document.getElementById('pf-vid-url').value = '';
      pfVideoUrl = '';
      pfCldShowIdle();
      pfCloudinaryWidget = null;
      pfUpdateVideoPreview();
      // Reset featured selector
      pfFeaturedItems = [];
      pfClearFeaturedItem();
      pfLoadHistorial();
      pfLoadUserData();
    } else {
      const err = await res.json();
      toast('❌ ' + (err.error || err.message || 'Error al publicar'));
    }
  } catch(e) { toast('❌ Error de conexión'); }
  finally { btn.innerHTML='<ion-icon name="cloud-upload"></ion-icon> PUBLICAR VIDEO'; btn.disabled=false; }
}

// ── NEXUS: revisar la publicación antes de enviarla ──
let _pfNx = null;   // { firma, res } — última revisión hecha
function pfFormPublicacion() {
  const v = id => (document.getElementById(id)?.value || '').trim();
  return { title: v('pf-addTitle'), description: v('pf-addDescription'), link: v('pf-addLink'), image: v('pf-addImage'),
    images: ['pf-addImage2', 'pf-addImage3', 'pf-addImage4'].map(v).filter(Boolean), category: document.getElementById('pf-addCategory')?.value || pfCurrentCategory };
}
async function pfRevisarConNexus(conIA) {
  const d = pfFormPublicacion(), out = document.getElementById('pf-nexus-res'), btn = document.getElementById('pf-nexus-btn');
  if (!d.title || !d.link) { if (conIA) toast('✦ Escribe al menos el título y el enlace para que Nexus lo revise'); return null; }
  const token = LS.get('token'); if (!token) return null;
  if (conIA && out) {
    out.innerHTML = `<div class="pf-nx-load"><span class="pf-nx-orb"></span><div><b>Nexus está revisando tu publicación…</b><small>Abriendo tu enlace, comprobando la portada y el texto</small></div></div>`;
    if (btn) btn.disabled = true;
  }
  try {
    const r = await fetch(`${PF_API}/items/precheck`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...d, ia: !!conIA }) });
    const res = await r.json().catch(() => ({}));
    if (!r.ok || !res.success) { if (out && conIA) out.innerHTML = `<div class="pf-nx-res warn">${ugEsc(res.error || 'Nexus no pudo revisar ahora. Puedes publicar igualmente.')}</div>`; return null; }
    _pfNx = { firma: [d.title, d.link, d.image, d.description.length].join('|'), res };
    if (out) pfPintarNexus(res, out);
    return res;
  } catch (_) { return null; } finally { if (btn) btn.disabled = false; }
}
function pfPintarNexus(r, out) {
  const ic = { ok: '✅', info: 'ℹ️', warn: '⚠️', bad: '❌' };
  const orden = { bad: 0, warn: 1, info: 2, ok: 3 };
  const hechos = [...r.hechos].sort((a, b) => orden[a.tipo] - orden[b.tipo]);
  out.innerHTML = `<div class="pf-nx-res ${r.problemas ? 'bad' : r.avisos ? 'warn' : 'ok'}">
    <div class="pf-nx-h"><span class="pf-nexus-ic">✦</span><b>${r.problemas ? `${r.problemas} problema(s) por corregir` : r.avisos ? 'Casi lista: revisa los avisos' : '¡Lista para publicar!'}</b></div>
    <p>${ugEsc(r.resumen || '')}</p>
    <ul>${hechos.map(h => `<li class="${h.tipo}"><span>${ic[h.tipo] || '•'}</span>${ugEsc(h.texto)}</li>`).join('')}</ul>
    ${(r.sugerencias || []).length ? `<div class="pf-nx-sug"><b>Sugerencias de Nexus</b>${r.sugerencias.slice(0, 4).map(x => `<div>💡 ${ugEsc(x)}</div>`).join('')}</div>` : ''}
    <small class="pf-nx-src">${r.fuente ? 'Analizado por ' + ugEsc(r.fuente) : 'Comprobaciones automáticas de Nexus'}</small>
  </div>`;
}

async function pfSubirJuego() {
  if(!pfUser) return alert('Debes iniciar sesión.');
  const ahora = Date.now();
  const ult = LS.get('ultima_publicacion');
  if(ult && ahora - parseInt(ult) < 30000) {
    const s = Math.ceil((30000-(ahora-parseInt(ult)))/1000);
    return toast(`⏱️ Anti-spam: Espera ${s}s antes de publicar.`);
  }
  const titulo = document.getElementById('pf-addTitle').value.trim();
  const desc = document.getElementById('pf-addDescription').value.trim();
  const link = document.getElementById('pf-addLink').value.trim();
  const imagen = document.getElementById('pf-addImage').value.trim();
  const cat = document.getElementById('pf-addCategory')?.value || pfCurrentCategory;
  // Recoger campos extra dinámicos
  const extraData = {};
  const cfg = CAT_CONFIG[cat];
  if(cfg && cfg.extras) {
    cfg.extras.forEach(f => {
      const el = document.getElementById(f.id);
      if(el && el.value.trim()) extraData[f.id.replace('pf-ex-','')] = el.value.trim();
    });
  }
  // Recoger medias adicionales slots 2-4 (opcionales)
  const imagesExtra = [
    document.getElementById('pf-addImage2')?.value.trim() || '',
    document.getElementById('pf-addImage3')?.value.trim() || '',
    document.getElementById('pf-addImage4')?.value.trim() || '',
  ].filter(u => u.length > 0);

  const bad = PF_BANNED.find(k => new RegExp('\\b'+k+'\\b','i').test(titulo.toLowerCase()));
  if(bad) return toast(`🚫 Palabra prohibida: "${bad}"`);
  const vLink = pfAnalizarLink(link);
  if(vLink.ok === false) return toast(vLink.msg);
  if(!titulo || !link) return toast('⚠️ Completa Título y Enlace.');
  if(!imagen) return toast('⚠️ La portada es obligatoria. Agrega al menos una imagen o video.');
  // Validar que sea URL válida de imagen o video (acepta URLs sin extensión como Google Drive, Imgur, etc.)
  function esMediaValida(url) {
    if(!url) return false;
    try { new URL(url); } catch(_) { return false; }
    // Extensión de imagen
    if(/\.(jpg|jpeg|png|webp|gif|avif|svg)(\?.*)?$/i.test(url)) return true;
    // Extensión de video
    if(ugEsVideoArchivo(url)) return true;
    // URLs de servicios conocidos que no terminan en extensión
    const knownHosts = ['imgur.com','i.imgur.com','drive.google.com','lh3.googleusercontent.com',
      'googleusercontent.com','pbs.twimg.com','cdn.discordapp.com','media.discordapp.net',
      'i.redd.it','preview.redd.it','images.unsplash.com','raw.githubusercontent.com',
      'user-images.githubusercontent.com','postimg.cc','i.postimg.cc','ibb.co','i.ibb.co',
      'upload.wikimedia.org','media.tenor.com','c.tenor.com','giphy.com','media.giphy.com',
      'cloudinary.com','res.cloudinary.com','media1.tenor.com','media2.tenor.com',
      'via.placeholder.com','placehold.co','picsum.photos'];
    try {
      const host = new URL(url).hostname.replace('www.','');
      if(knownHosts.some(h => host === h || host.endsWith('.'+h))) return true;
    } catch(_) {}
    // Si no reconocemos el host, igual la aceptamos (el creador es responsable)
    return true;
  }
  if(imagen && !esMediaValida(imagen)) return toast('⚠️ El enlace de imagen no parece válido. Usa una URL directa de imagen o video.');

  const token = LS.get('token');
  if(!token) { alert('⚠️ Sesión expirada.'); location.href='./index.html'; return; }

  const btn = document.getElementById('pf-subirBtn');
  // Nexus revisa rápido (sin IA) antes de enviar, salvo que ya lo hayas revisado con estos datos
  const firma = [titulo, link, imagen, desc.length].join('|');
  let rev = _pfNx && _pfNx.firma === firma ? _pfNx.res : null;
  if(!rev) {
    btn.innerHTML = '<span class="pf-nexus-ic">✦</span> Nexus está revisando…'; btn.disabled = true;
    rev = await pfRevisarConNexus(false);
    btn.innerHTML = '<ion-icon name="cloud-upload"></ion-icon> ENVIAR A REVISIÓN'; btn.disabled = false;
  }
  if(rev && rev.problemas > 0) {
    const lista = rev.hechos.filter(h => h.tipo === 'bad').map(h => '• ' + h.texto).join('\n');
    if(!confirm(`Nexus encontró ${rev.problemas} problema(s) que harían que rechacen tu publicación:\n\n${lista}\n\n¿Publicar igualmente?`)) return;
  }
  btn.textContent = 'Enviando...'; btn.disabled = true;
  try {
    const res = await fetch(`${PF_API}/items/add`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
      body: JSON.stringify({ title:titulo, description:desc, link, image:imagen, images:imagesExtra, category:cat, extraData, usuario:pfUser, status:'pendiente' })
    });
    if(res.ok) {
      LS.set('ultima_publicacion', Date.now().toString());
      window.dispatchEvent(new CustomEvent('ug:guia', { detail: 'publicar' }));
      toast('✅ Publicado. Aparecerá como "En revisión" hasta verificar el enlace.');
      document.getElementById('pf-addTitle').value='';
      document.getElementById('pf-addDescription').value='';
      document.getElementById('pf-addLink').value='';
      document.getElementById('pf-addImage').value='';
      ['pf-addImage2','pf-addImage3','pf-addImage4'].forEach(id=>{
        const el=document.getElementById(id); if(el) el.value='';
      });
      [0,1,2,3].forEach(i=>{
        const p=document.getElementById('pf-slot-prev-'+i); if(p) p.classList.remove('show');
      });
      pfUpdatePreview();
      pfLoadHistorial();
      pfLoadUserData();
    } else {
      const err = await res.json();
      toast('❌ ' + (err.error || err.message || 'Error al publicar'));
    }
  } catch(e) { toast('❌ Error de conexión'); }
  finally { btn.innerHTML='<ion-icon name="cloud-upload"></ion-icon> ENVIAR A REVISIÓN'; btn.disabled=false; }
}

// ── Historial ──
// ── Utilidades de imagen ──────────────────────────────────
function ugEsc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
/**
 * Entrega optimizada de Cloudinary: tamaño justo + formato automático.
 * Las fotos de iPhone (HEIC) no se ven en Chrome/Android y las de 4000px
 * pesan varios MB: con f_auto,q_auto y un ancho fijo cargan rápido y en todos lados.
 */
function cldOpt(url, t) {
  const u = String(url || '');
  if (!/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(u)) return u;
  // Ya trae transformaciones (recorte del widget, q_auto…): no anteponer otra o el recorte se descuadra
  if (/\/image\/upload\/(?!v\d+\/)[a-z]{1,3}_[^/]*\//.test(u)) return u.replace(/\.(heic|heif)(\?|$)/i, '.jpg$2');
  return u.replace('/image/upload/', `/image/upload/${t}/`).replace(/\.(heic|heif)(\?|$)/i, '.jpg$2');
}
const CLD_BANNER = 'c_fill,g_auto,w_1500,h_500,q_auto,f_auto';
const CLD_AVATAR = 'c_fill,g_face,w_400,h_400,q_auto,f_auto';
const CLD_TILE   = 'c_fill,g_auto,w_420,h_420,q_auto,f_auto';
const UG_VIDEO_RE = { test: u => ugEsVideoArchivo(u) };   // portadas que en realidad son video

// ── Publicaciones del perfil: cuadrícula tipo Instagram ──
let _pfMisItems = [];
function pfTileHTML(item, i) {
  const isVideo   = item.category === 'Video';
  const isPending = item.status === 'pendiente' || item.status === 'pending';
  const ls        = item.linkStatus || 'online';
  const img       = item.image && !UG_VIDEO_RE.test(item.image) ? cldOpt(item.image, CLD_TILE) : '';
  const n         = isVideo ? (item.descargasEfectivas || 0) : (item.descargasEfectivas || 0);
  return `<button type="button" class="pf2-tile${img ? '' : ' no-img'}" onclick="pfOpenPostSheet(${i})" aria-label="${ugEsc(item.title || 'Publicación')}">
      ${img ? `<img src="${ugEsc(img)}" alt="" loading="lazy" onerror="this.remove();this.parentElement.classList.add('no-img')">` : ''}
      <span class="pf2-tile-ph"><ion-icon name="${isVideo ? 'play' : 'game-controller'}"></ion-icon><em>${ugEsc(item.title || '')}</em></span>
      ${isPending ? '<span class="pf2-tile-badge">Pendiente</span>' : ''}
      ${!isPending && ls !== 'online' ? `<span class="pf2-tile-badge ${ls === 'caido' ? 'bad' : 'warn'}">${ls === 'caido' ? 'Link caído' : 'Revisión'}</span>` : ''}
      ${isVideo ? '<span class="pf2-tile-type"><ion-icon name="play"></ion-icon></span>' : ''}
      <span class="pf2-tile-meta"><ion-icon name="${isVideo ? 'eye-outline' : 'cloud-download-outline'}"></ion-icon>${pfFmt ? pfFmt(n) : n}</span>
    </button>`;
}

async function pfLoadHistorial() {
  const cont      = document.getElementById('pf-showContent');
  const vidCont   = document.getElementById('pf-showVideos');
  const vidCount  = document.getElementById('pf-hist-vid-count');
  if(!cont || !pfUser) return;
  const skel = '<div class="pf2-grid">' + '<span class="pf2-tile pf2-skel"></span>'.repeat(6) + '</div>';
  cont.innerHTML = skel; if (vidCont) vidCont.innerHTML = skel;
  try {
    const token = LS.get('token');
    const res = await fetch(`${PF_API}/items/user/${encodeURIComponent(pfUser)}`, {
      headers: token ? { Authorization:`Bearer ${token}` } : {}
    });
    const data = await res.json();
    // Lo más reciente primero (como Instagram/TikTok)
    _pfMisItems = (Array.isArray(data) ? data : [])
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const up = document.getElementById('pf-stat-uploads');
    if (up) up.textContent = _pfMisItems.filter(i => i.status === 'aprobado').length;

    const idx = it => _pfMisItems.indexOf(it);
    const juegos = _pfMisItems.filter(i => i.category !== 'Video');
    const videos = _pfMisItems.filter(i => i.category === 'Video');

    cont.innerHTML = juegos.length
      ? `<div class="pf2-grid">${juegos.map(it => pfTileHTML(it, idx(it))).join('')}</div>`
      : `<div class="pf2-empty"><ion-icon name="images-outline"></ion-icon><h4>Aún no tienes publicaciones</h4><p>Comparte tu primer juego, mod o app con la comunidad.</p><button type="button" class="pf2-btn pf2-btn-primary" onclick="pfOpenPublish(true)">Crear publicación</button></div>`;

    if (vidCount) { vidCount.textContent = videos.length; vidCount.style.display = videos.length ? 'inline-flex' : 'none'; }
    if (vidCont) vidCont.innerHTML = videos.length
      ? `<div class="pf2-grid">${videos.map(it => pfTileHTML(it, idx(it))).join('')}</div>`
      : `<div class="pf2-empty"><ion-icon name="videocam-outline"></ion-icon><h4>Aún no tienes videos</h4><p>Sube tutoriales, gameplays o reviews.</p><button type="button" class="pf2-btn pf2-btn-primary" onclick="pfOpenPublish(true);pfOnCategoryChange && pfOnCategoryChange('Video', document.querySelector('.pf-cat-btn[data-cat=&quot;Video&quot;]'))">Subir video</button></div>`;
  } catch(e) {
    cont.innerHTML='<div class="pf2-empty"><ion-icon name="cloud-offline-outline"></ion-icon><h4>No se pudieron cargar tus publicaciones</h4><button type="button" class="pf2-btn" onclick="pfLoadHistorial()">Reintentar</button></div>';
  }
}

// ── Hoja de acciones al tocar una publicación propia ──
function pfOpenPostSheet(i) {
  const item = _pfMisItems[i];
  if (!item) return;
  const isVideo   = item.category === 'Video';
  const isPending = item.status === 'pendiente' || item.status === 'pending';
  const isRejected = item.status === 'rechazado';
  const ls = item.linkStatus || 'online';
  const lsTxt = ls === 'online' ? '🟢 Online' : ls === 'revision' ? '🟡 En revisión' : '🔴 Caído';
  const img = item.image && !UG_VIDEO_RE.test(item.image) ? cldOpt(item.image, 'c_fill,g_auto,w_900,h_506,q_auto,f_auto') : '';
  const m = item.nexusMentor;
  const mentorHTML = m && (m.analisis || (m.mejoras || []).length) ? `<div class="pf2-nexus">
      <div class="pf2-nexus-h"><span class="pf2-nexus-ic">✦</span><b>Consejos de Nexus</b>${m.puntuacion != null ? `<span class="pf2-nexus-score">${ugEsc(Number(m.puntuacion).toFixed(1))}/10</span>` : ''}</div>
      ${m.analisis ? `<p>${ugEsc(String(m.analisis).slice(0, 400))}</p>` : ''}
      ${(m.mejoras || []).length ? `<ul>${m.mejoras.slice(0, 4).map(x => `<li>${ugEsc(x)}</li>`).join('')}</ul>` : ''}
      ${(m.alertas || []).length ? `<div class="pf2-nexus-alert">⚠️ ${ugEsc(m.alertas.slice(0, 2).join(' · '))}</div>` : ''}
    </div>` : '';
  let ov = document.getElementById('pf2-sheet');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'pf2-sheet'; ov.className = 'pf2-sheet-ov';
    ov.addEventListener('click', e => { if (e.target === ov) pfClosePostSheet(); });
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="pf2-sheet" role="dialog" aria-modal="true" aria-label="${ugEsc(item.title)}">
      <span class="pf2-sheet-grab"></span>
      ${img ? `<img class="pf2-sheet-img" src="${ugEsc(img)}" alt="" onerror="this.remove()">` : ''}
      <div class="pf2-sheet-body">
        <div class="pf2-sheet-cat">${ugEsc(catLabel(item.category))} · <span class="${isRejected ? 'bad' : isPending ? 'warn' : 'ok'}">${isRejected ? 'Rechazado' : isPending ? 'Pendiente de revisión' : 'Aprobado'}</span></div>
        <h3>${ugEsc(item.title || 'Sin título')}</h3>
        <div class="pf2-sheet-stats">
          <div><b>${item.descargasEfectivas || 0}</b><span>${isVideo ? 'Vistas' : 'Descargas'}</span></div>
          <div><b>${item.likesCount || 0}</b><span>Likes</span></div>
          <div><b style="color:${(item.reportes || 0) >= 3 ? '#ff4343' : 'inherit'}">${item.reportes || 0}</b><span>Reportes</span></div>
          <div><b style="font-size:.78rem">${lsTxt}</b><span>Enlace</span></div>
        </div>
        ${isRejected ? `<div class="pf2-rechazo"><b>Motivo del rechazo:</b> ${ugEsc(item.motivoRechazo || 'No cumple las normas de publicación.')}<br><small>Corrígelo con Editar o publícalo de nuevo.</small></div>` : ''}
        ${mentorHTML}
        <button type="button" class="pf2-btn pf2-btn-nexus" onclick="pfClosePostSheet();nexusPreguntar(${ugEsc(JSON.stringify(`¿Cómo puedo mejorar mi publicación "${item.title}" para conseguir más descargas?`))})"><span class="pf2-nexus-ic">✦</span> Pedir consejo a Nexus</button>
        ${isPending ? `<div class="pf2-destacar" id="pf2-prioridad">${item.prioridadDesde
          ? `<span>⚡ <b>Revisión prioritaria activa</b>: va primera en la fila${item.prioridadReembolso ? ' (te devolvimos los UpCoins por la espera)' : ''}</span>`
          : `<span>⚡ <b>Revisión prioritaria</b>: pasa al frente de la fila por 🪙 <b data-ugx-precio="prioridad">30</b> UC. Si no se revisa en 24 h, te devolvemos los UpCoins.</span><button type="button" class="pf2-btn" onclick="UGX.prioridad('${item._id}', this)">Priorizar</button>`}</div>` : ''}
        ${!isPending && !isRejected ? `<div class="pf2-destacar" id="pf2-destacar">${item.destacadoHasta && new Date(item.destacadoHasta) > new Date()
          ? `<span>🚀 Destacada hasta el ${new Date(item.destacadoHasta).toLocaleString('es-CO')}</span><button type="button" class="pf2-btn" onclick="pfDestacar('${item._id}')">Extender 24 h</button>`
          : `<span>🚀 <b>Destácala 24 h</b> arriba en el inicio por 🪙 50 UC</span><button type="button" class="pf2-btn" onclick="pfDestacar('${item._id}')">Destacar</button>`}</div><div id="pf2-destacar-pago"></div>` : ''}
        <div class="pf2-sheet-actions">
          ${!isPending && !isRejected ? `<button type="button" class="pf2-btn pf2-btn-primary" onclick="pfVerPublicacion(${i})"><ion-icon name="open-outline"></ion-icon> Ver publicación</button>` : ''}
          <button type="button" class="pf2-btn" onclick="pfClosePostSheet();${isVideo ? `pfOpenEditVideoModal('${item._id}')` : `pfOpenEditModal('${item._id}')`}"><ion-icon name="create-outline"></ion-icon> Editar</button>
          <button type="button" class="pf2-btn pf2-btn-danger" onclick="pfClosePostSheet();${isVideo ? `pfEliminarVideo('${item._id}')` : `pfEliminar('${item._id}')`}"><ion-icon name="trash-outline"></ion-icon> Borrar</button>
        </div>
      </div>
    </div>`;
  ov.classList.add('show');
  document.body.style.overflow = 'hidden';
}
// Destacar una publicación propia con UpCoins (sale arriba marcada como "Promocionado")
async function pfDestacar(id) {
  const caja = document.getElementById('pf2-destacar-pago'); if (!caja) return;
  caja.innerHTML = '<div class="eco-spin"><ion-icon name="sync-outline"></ion-icon></div>';
  try { await ugPagosListo(); window.UGPagos.pagar(caja, { producto: `impulso:${id}`, alExito: () => { pfClosePostSheet(); ugContadorUC(); pfLoadHistorial(); } }); }
  catch (_) { caja.innerHTML = ''; toast('No se pudo cargar el pago'); }
}
function pfClosePostSheet() {
  const ov = document.getElementById('pf2-sheet');
  if (ov) ov.classList.remove('show');
  document.body.style.overflow = '';
}
function pfVerPublicacion(i) {
  const item = _pfMisItems[i];
  pfClosePostSheet();
  if (item && typeof window.openDetail === 'function') window.openDetail(todosLosItems.find(x => x._id === item._id) || item);
}

// ── Eliminar Video ──
async function pfEliminarVideo(id) {
  const ok = await customConfirm({
    icon: '🎬',
    title: '¿Eliminar este video?',
    msg: 'Se eliminará de la plataforma y de Cloudinary. No se puede deshacer.',
    okText: 'Eliminar',
    okDanger: true
  });
  if(!ok) return;
  const token = LS.get('token');
  if(!token) { toast('⚠️ Sesión expirada'); location.href='./index.html'; return; }
  try {
    const res = await fetch(`${PF_API}/items/${id}/video`, {
      method: 'DELETE',
      headers: { Authorization:`Bearer ${token}` }
    });
    if(res.ok) { toast('✅ Video eliminado.'); pfLoadHistorial(); pfLoadUserData(); }
    else { const e = await res.json(); toast('❌ '+(e.error||'Error al eliminar')); }
  } catch(e) { toast('❌ Error de conexión'); }
}

// ── Abrir modal editar video ──
let pfCurrentEditVideoId = null;
async function pfOpenEditVideoModal(itemId) {
  pfCurrentEditVideoId = itemId;
  try {
    const token = LS.get('token');
    const res = await fetch(`${PF_API}/items/user/${pfUser}`, {
      headers: token ? { Authorization:`Bearer ${token}` } : {}
    });
    const data = await res.json();
    const item = data.find(i => i._id === itemId);
    if(!item) { toast('❌ Video no encontrado'); return; }
    document.getElementById('pf-edit-vid-id').value    = item._id;
    document.getElementById('pf-edit-vid-title').value = item.title||'';
    document.getElementById('pf-edit-vid-desc').value  = item.description||'';
    document.getElementById('pf-edit-vid-thumb').value = item.image||'';
    const durEl = document.getElementById('pf-edit-vid-duracion');
    if(durEl) durEl.value = item.extraData?.duracion || '';
    const prevImg = document.getElementById('pf-edit-vid-thumb-prev');
    if(prevImg && item.image) { prevImg.src=item.image; prevImg.style.display='block'; }
    const currentType = item.videoType||'Tutorial';
    document.querySelectorAll('.pf-edit-vid-type-btn').forEach(b=>{
      b.classList.toggle('active', b.dataset.type===currentType);
    });
    document.getElementById('pf-edit-vid-type').value = currentType;
    document.getElementById('pf-editVideoModal').classList.add('show');
    document.body.style.overflow='hidden';
  } catch(e) { toast('❌ Error al cargar video'); }
}
function pfCloseEditVideoModal() {
  document.getElementById('pf-editVideoModal').classList.remove('show');
  document.body.style.overflow='';
  pfCurrentEditVideoId = null;
}
function pfEditVidSelectType(type, btn) {
  document.querySelectorAll('.pf-edit-vid-type-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('pf-edit-vid-type').value = type;
}
async function pfSaveEditVideo() {
  if(!pfCurrentEditVideoId) return;
  const title    = document.getElementById('pf-edit-vid-title').value.trim();
  const desc     = document.getElementById('pf-edit-vid-desc').value.trim();
  const thumb    = document.getElementById('pf-edit-vid-thumb').value.trim();
  const type     = document.getElementById('pf-edit-vid-type').value;
  const duracion = document.getElementById('pf-edit-vid-duracion')?.value.trim() || '';
  if(!title) { toast('⚠️ El título es obligatorio'); return; }
  const token = LS.get('token');
  if(!token) { toast('⚠️ Sesión expirada'); return; }
  const btn = document.getElementById('pf-edit-vid-save-btn');
  btn.textContent = 'Guardando...'; btn.disabled = true;
  try {
    const res = await fetch(`${PF_API}/items/${pfCurrentEditVideoId}`, {
      method: 'PUT',
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
      body: JSON.stringify({
        title, description:desc, image:thumb, videoType:type, category:'Video',
        extraData: duracion ? { duracion } : {}
      })
    });
    if(res.ok) { toast('✅ Video actualizado'); pfCloseEditVideoModal(); pfLoadHistorial(); }
    else { const e=await res.json(); toast('❌ '+(e.error||'Error al guardar')); }
  } catch(e) { toast('❌ Error de conexión'); }
  finally { btn.innerHTML='<ion-icon name="checkmark-circle"></ion-icon> GUARDAR CAMBIOS'; btn.disabled=false; }
}

async function pfEliminar(id) {
  if(!confirm('¿Eliminar este archivo de la nube?')) return;
  const token = LS.get('token');
  if(!token) { alert('Sesión expirada'); location.href='./index.html'; return; }
  try {
    const res = await fetch(`${PF_API}/items/${id}`,{
      method:'DELETE', headers:{'Authorization':`Bearer ${token}`}
    });
    if(res.ok) { toast('✅ Eliminado.'); pfLoadHistorial(); pfLoadUserData(); }
    else { const e=await res.json(); toast('❌ '+(e.mensaje||e.error||'Error')); }
  } catch(e) { toast('❌ Error de conexión'); }
}

// ── Edit Modal ──
async function pfOpenEditModal(itemId) {
  pfCurrentEditId = itemId;
  try {
    const token = LS.get('token');
    const res = await fetch(`${PF_API}/items/user/${pfUser}`,{
      headers: token ? { Authorization:`Bearer ${token}` } : {}
    });
    const data = await res.json();
    const item = data.find(i => i._id === itemId);
    if(!item) { toast('❌ Item no encontrado'); return; }
    document.getElementById('pf-edit-id').value = item._id;
    document.getElementById('pf-edit-title').value = item.title||'';
    document.getElementById('pf-edit-description').value = item.description||'';
    document.getElementById('pf-edit-link').value = item.link||'';
    document.getElementById('pf-edit-image').value = item.image||'';
    document.getElementById('pf-edit-category').value = item.category||'Juego';
    // Cargar medias adicionales (images[])
    const imgs = item.images || [];
    ['pf-edit-image2','pf-edit-image3','pf-edit-image4'].forEach((id, i) => {
      const el = document.getElementById(id);
      if(el) el.value = imgs[i] || '';
    });
    document.getElementById('pf-editModal').classList.add('show');
    document.body.style.overflow='hidden';
  } catch(e) { toast('❌ Error al cargar'); }
}
function pfCloseEditModal() {
  document.getElementById('pf-editModal').classList.remove('show');
  document.body.style.overflow='';
  pfCurrentEditId = null;
  // Reset validation states
  ['pf-edit-title','pf-edit-link','pf-edit-image','pf-edit-image2','pf-edit-image3','pf-edit-image4'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) { el.classList.remove('valid','invalid'); el.value=''; }
  });
  ['pf-edit-title-hint','pf-edit-link-hint','pf-edit-image-hint'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.textContent='';
  });
  document.querySelectorAll('.pf-tooltip').forEach(t=>t.classList.remove('active'));
}
// ── Edit Modal field validators ──
function pfValidateEditTitle() {
  const el = document.getElementById('pf-edit-title');
  const hint = document.getElementById('pf-edit-title-hint');
  if(!el) return;
  const txt = el.value;
  const bad = PF_BANNED_VISUAL.some(k => new RegExp('\\b'+k+'\\b','i').test(txt));
  if(bad && txt.length > 0) {
    el.classList.add('invalid'); el.classList.remove('valid');
    if(hint) hint.innerHTML='<span style="color:#ff4343">🚫 Palabra prohibida detectada</span>';
  } else if(txt.length > 0) {
    el.classList.remove('invalid'); el.classList.add('valid');
    if(hint) hint.textContent = '';
  } else {
    el.classList.remove('invalid','valid');
    if(hint) hint.textContent = '';
  }
}
function pfValidateEditLink() {
  const el = document.getElementById('pf-edit-link');
  const hint = document.getElementById('pf-edit-link-hint');
  if(!el) return;
  const val = el.value.trim();
  if(!val) { el.classList.remove('valid','invalid'); if(hint) hint.textContent=''; return; }
  const r = pfAnalizarLink(val);
  el.classList.toggle('valid', r.ok === true);
  el.classList.toggle('invalid', r.ok === false);
  if(hint) hint.innerHTML = r.ok === false ? `<span style="color:#ff4343">${r.msg}</span>` : r.ok === true ? '<span style="color:var(--g)">✅ Plataforma permitida</span>' : '';
}
function pfValidateEditImage() {
  const el = document.getElementById('pf-edit-image');
  const hint = document.getElementById('pf-edit-image-hint');
  if(!el) return;
  const val = el.value.trim();
  if(!val) { el.classList.remove('valid','invalid'); if(hint) hint.textContent=''; return; }
  // Acepta imagen, video, y URLs conocidas sin extensión
  const ok = /\.(jpg|jpeg|png|webp|gif|avif|svg|mp4|webm|mov)(\?.*)?$/i.test(val) || val.length > 10;
  el.classList.toggle('valid', ok);
  el.classList.toggle('invalid', !ok);
  if(hint) hint.innerHTML = !ok ? '<span style="color:#ffcc00">⚠️ Debe terminar en .jpg .png .webp o .gif</span>' : '';
}

async function pfSaveEdit() {
  if(!pfCurrentEditId) return;
  const upd = {
    title: document.getElementById('pf-edit-title').value.trim(),
    description: document.getElementById('pf-edit-description').value.trim(),
    link: document.getElementById('pf-edit-link').value.trim(),
    image: document.getElementById('pf-edit-image').value.trim(),
    images: [
      document.getElementById('pf-edit-image2')?.value.trim(),
      document.getElementById('pf-edit-image3')?.value.trim(),
      document.getElementById('pf-edit-image4')?.value.trim(),
    ].filter(u => u && u.length > 0),
    category: document.getElementById('pf-edit-category').value
  };
  const vl = pfAnalizarLink(upd.link);
  if(vl.ok===false) { toast(vl.msg); return; }
  if(!upd.title||!upd.link) { toast('⚠️ Título y enlace requeridos'); return; }
  const bad = PF_BANNED.find(k => new RegExp('\\b'+k+'\\b','i').test(upd.title.toLowerCase()));
  if(bad) { toast(`🚫 Palabra prohibida: "${bad}"`); return; }
  // La imagen puede ser cualquier URL válida (imagen, video, CDN sin extensión)
  const token = LS.get('token');
  if(!token) { toast('Sesión expirada'); return; }
  try {
    const res = await fetch(`${PF_API}/items/${pfCurrentEditId}`,{
      method:'PUT',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
      body: JSON.stringify(upd)
    });
    if(res.ok) { toast('✅ Actualizado'); pfCloseEditModal(); pfLoadHistorial(); }
    else { const e=await res.json(); toast('❌ '+(e.error||'Error')); }
  } catch(e) { toast('❌ Error de conexión'); }
}

// ── Bóveda ──
async function pfLoadBoveda() {
  const cont = document.getElementById('pf-vaultContent');
  if(!cont||!pfUser) return;
  cont.innerHTML='<div class="pf-empty"><ion-icon name="sync-outline"></ion-icon><p>Cargando...</p></div>';
  try {
    const res = await fetch(`${PF_API}/favoritos/${pfUser}`);
    const data = await res.json();
    const favs = Array.isArray(data) ? data : [];
    if(!favs.length) {
      cont.innerHTML='<div class="pf-empty"><ion-icon name="heart-dislike-outline"></ion-icon><p>Tu bóveda está vacía.<br>Agrega favoritos desde la biblioteca.</p></div>';
      return;
    }
    cont.innerHTML='';
    favs.forEach(item => {
      if(!item) return;
      const card = document.createElement('div');
      card.className='pf-vault-card';
      card.innerHTML=`
        <img src="${item.image||window.UG_PH}" alt="${item.title||''}" onerror="this.onerror=null;this.src=window.UG_PH">
        <div class="pf-vault-info">
          <div class="pf-vault-title">${(item.title||'Sin título').substring(0,40)}</div>
          <div class="pf-vault-user">@${escH(item.usuario||'Anónimo')}</div>
          <div class="pf-vault-actions">
            <button class="pf-vault-btn access" onclick="window.open('puente.html?id=${item._id}','_blank')"><ion-icon name="cloud-download"></ion-icon> Acceder</button>
            <button class="pf-vault-btn remove" onclick="pfRemoveFav('${item._id}')"><ion-icon name="trash"></ion-icon> Quitar</button>
          </div>
        </div>`;
      cont.appendChild(card);
    });
  } catch(e) { cont.innerHTML='<div class="pf-empty" style="color:#ff4343"><p>Error al cargar favoritos</p></div>'; }
}
async function pfRemoveFav(itemId) {
  const ok = await customConfirm({
    icon: '💔',
    title: '¿Quitar de tu bóveda?',
    msg: 'Este contenido se eliminará de tus favoritos guardados.',
    okText: 'Quitar',
    okDanger: true
  });
  if(!ok) return;
  try {
    const token = LS.get('token');
    const res = await fetch(`${PF_API}/favoritos/remove`,{
      method:'DELETE',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
      body: JSON.stringify({ itemId })
    });
    const d = await res.json();
    if(d.success||d.ok) { toast('💔 Eliminado de favoritos'); pfLoadBoveda(); }
    else toast('❌ '+(d.error||'Error'));
  } catch(e) { toast('❌ Error de conexión'); }
}

// ── Reportes ──
async function pfLoadReportes() {
  const cont = document.getElementById('pf-reportesContent');
  if(!cont||!pfUser) return;
  cont.innerHTML='<div class="pf-empty"><ion-icon name="sync-outline"></ion-icon><p>Cargando...</p></div>';
  try {
    const res = await fetch(`${PF_API}/items/mis-reportes/${pfUser}`);
    const data = await res.json();
    if(!data.success||!data.publicaciones||!data.publicaciones.length) {
      cont.innerHTML=`<div class="pf-empty"><ion-icon name="happy-outline"></ion-icon><p>¡Excelente! No tienes publicaciones con reportes activos.</p></div>`;
      return;
    }
    cont.innerHTML='';
    data.publicaciones.forEach(pub => {
      const d = pub.reportesDesglose||{caido:0,viejo:0,malware:0};
      const sColor = pub.linkStatus==='online'?'var(--g)':pub.linkStatus==='revision'?'#ffcc00':'#ff4343';
      const sText = pub.linkStatus==='online'?'🟢 Online':pub.linkStatus==='revision'?'🟡 En Revisión':'🔴 Caído';
      const card = document.createElement('div');
      card.className='pf-reporte-card';
      card.style.borderLeftColor = sColor;
      card.innerHTML=`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div><div class="pf-reporte-title">${escH(pub.title)}</div>
          <div class="pf-reporte-date">${new Date(pub.createdAt).toLocaleDateString('es-ES')}</div></div>
          <div style="text-align:right">
            <div class="pf-reporte-badge">${pub.reportes} Reportes</div>
            <div style="font-size:.65rem;font-weight:700;margin-top:4px;color:${sColor}">${sText}</div>
          </div>
        </div>
        <div class="pf-reporte-motivos">
          <div class="pf-reporte-motivo"><ion-icon name="link-outline" style="color:#ff4343"></ion-icon><span style="font-weight:700;color:#ff4343">${d.caido||0}</span><span>Link caído</span></div>
          <div class="pf-reporte-motivo"><ion-icon name="time-outline" style="color:#ffaa00"></ion-icon><span style="font-weight:700;color:#ffaa00">${d.viejo||0}</span><span>Obsoleto</span></div>
          <div class="pf-reporte-motivo"><ion-icon name="shield-outline" style="color:#ff00ff"></ion-icon><span style="font-weight:700;color:#ff00ff">${d.malware||0}</span><span>Malware</span></div>
        </div>
        <div class="pf-reporte-tip">💡 <strong>Consejo:</strong> Actualiza tu link para mantener tu reputación y tus ganancias.</div>
        <button class="pf-reporte-ver" onclick="window.open('biblioteca.html?id=${pub._id}','_blank')"><ion-icon name="eye-outline"></ion-icon> Ver Publicación</button>`;
      cont.appendChild(card);
    });
  } catch(e) { cont.innerHTML='<div class="pf-empty" style="color:#ff4343"><p>Error al cargar reportes</p></div>'; }
}

// ── Economía ──
// ── polling state ──
let _ecoPollingTimer = null;

function _animateValue(el, from, to, decimals, prefix, duration) {
  if (!el) return;
  const start = performance.now();
  const diff = to - from;
  if (diff === 0) { el.textContent = prefix + to.toFixed(decimals); return; }
  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = from + diff * ease;
    el.textContent = prefix + current.toFixed(decimals);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

async function pfLoadEconomia() {
  const token = LS.get('token');
  if(!token) return;
  try {
    const res = await fetch(`${PF_API}/economia/mi-saldo`,{
      headers:{ Authorization:`Bearer ${token}` }
    });
    if(!res.ok) return;
    const d = await res.json();
    if(d.success) {
      // Saldo — 4 decimales con animacion
      // Todo en UpCoins: total gastable + desglose (retirables = ganados como creador)
      const uc = d.upcoins || { total: (d.monedas || 0) + (d.saldo || 0) / 0.02, ganadas: (d.saldo || 0) / 0.02, compradas: d.monedas || 0, retenidas: (d.saldoRetenido || 0) / 0.02 };
      const saldoEl = document.getElementById('pf-saldo-display');
      const prevSaldo = parseFloat(saldoEl.dataset.val || '0');
      const newSaldo = uc.compradas + uc.ganadas;
      saldoEl.dataset.val = newSaldo;
      _animateValue(saldoEl, prevSaldo, Math.floor(newSaldo * 100) / 100, newSaldo < 100 ? 2 : 0, '🪙 ', 800);
      if (newSaldo >= 100) setTimeout(() => { saldoEl.textContent = '🪙 ' + Math.floor(newSaldo).toLocaleString('es-CO'); }, 850);   // igual que la cabecera (sin redondear hacia arriba)
      const fx = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      fx('eco-retirables', (uc.ganadas || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 }));
      fx('eco-retirables-usd', `(≈ US$${(d.saldo || 0).toFixed(2)})`);
      fx('eco-monedas', (uc.compradas || 0).toLocaleString('es-CO'));
      fx('eco-retenido', (uc.retenidas || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 }));
      ecoPintarRetencion(uc.retenidas || 0, d.retencion);
      window.ugContadorUC?.(uc.total);

      // Descargas totales con animacion
      const dlEl = document.getElementById('pf-descargas-totales');
      const prevDl = parseInt(dlEl.dataset.val || '0', 10);
      const newDl = d.descargasTotales || 0;
      dlEl.dataset.val = newDl;
      _animateValue(dlEl, prevDl, newDl, 0, '', 600);

      // Juegos con ganancias con animacion
      const jgEl = document.getElementById('pf-juegos-elegibles');
      const prevJg = parseInt(jgEl.dataset.val || '0', 10);
      const newJg = d.juegosElegibles || 0;
      jgEl.dataset.val = newJg;
      _animateValue(jgEl, prevJg, newJg, 0, '', 600);

      ecoCobroPintar(d.metodoCobro, d.esperaCobroHasta);
      if(!d.isVerificado||d.verificadoNivel<1) {
        document.getElementById('pf-estado-verificacion').style.display='flex';
      }
      const btnP = document.getElementById('pf-btn-solicitar-pago');
      if(d.solicitudPagoPendiente) {
        document.getElementById('pf-solicitud-pendiente').style.display='flex';
        btnP.disabled=true; btnP.classList.remove('enabled');
      } else if(d.puedeRetirar) {
        btnP.disabled=false; btnP.classList.add('enabled');
      }

      // ── Dashboard update ──
      ecoUpdateDashboard(d);
    }
  } catch(e) { console.error('pfLoadEconomia', e); }
}

function pfStartEcoPolling() {
  pfStopEcoPolling();
  pfLoadEconomia();
  _ecoPollingTimer = setInterval(pfLoadEconomia, 8000);
}

function pfStopEcoPolling() {
  if(_ecoPollingTimer) { clearInterval(_ecoPollingTimer); _ecoPollingTimer = null; }
}

/* ═══════════════════════════════════════════════════════════
   CREATOR STUDIO DASHBOARD — RENDERING ENGINE
═══════════════════════════════════════════════════════════ */
let _ecoPeriodDays  = 7;
// Estadísticas reales de /economia/mis-estadisticas (declaradas aquí: las usa la gráfica)
let _ecoStats = null, _ecoStatsT = 0, _ecoStatsDias = 0, _ecoStatsCargando = false, _ecoPsOrden = 'descargas';
let _ecoLastData    = null;
let _ecoChartTimer  = null;

function ecoSetPeriod(days, btn) {
  _ecoPeriodDays = days;
  ecoCargarStats(true);
  document.querySelectorAll('.eco-period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (_ecoLastData) ecoUpdateDashboard(_ecoLastData);
}

function ecoUpdateDashboard(d) {
  _ecoLastData = d;
  // user_admin es un string plano con el nombre de usuario
  const username = LS.get('user_admin', '');

  // Mis publicaciones: las del servidor (incluye pendientes) o, mientras cargan, las del catálogo
  const allMyContent = _ecoMias();
  ecoCargarStats();

  const totalDl       = d.descargasTotales || 0;
  const saldo         = d.saldo || 0;
  const juegosEleg    = d.juegosElegibles  || 0;
  const totalContent  = allMyContent.length;

  // ── Saldo progress ring toward $10 ──
  const ringPct = Math.min(saldo / 10, 1);
  const circumference = 314.16; // 2π×50
  const ringEl  = document.getElementById('eco-ring-fill');
  const pctEl   = document.getElementById('eco-ring-pct');
  if (ringEl) ringEl.style.strokeDashoffset = circumference * (1 - ringPct);
  if (pctEl)  pctEl.textContent = Math.round(ringPct * 100) + '%';

  // ── Trend badge ──
  const trendTxt = document.getElementById('eco-trend-txt');
  if (trendTxt) trendTxt.textContent = totalDl > 0 ? `${pfFmt(totalDl)} descargas totales` : 'Sin descargas aún';

  // ── RPM (revenue per download) ──
  const rpmEl = document.getElementById('eco-kpi-rpm');
  if (rpmEl) rpmEl.textContent = totalDl > 0 ? (saldo / totalDl / 0.02).toFixed(3) + ' UC' : '0 UC';   // UpCoins por descarga

  // ── Content subtitle ──
  const ctEl = document.getElementById('eco-kpi-content-total');
  if (ctEl) ctEl.textContent = `de ${totalContent} publicaciones`;

  // ── Followers ──
  const flEl = document.getElementById('eco-kpi-followers');
  // (antes usaba `userObj`, que no existía → ReferenceError y el panel se cortaba aquí)
  if (flEl) {
    flEl.textContent = document.getElementById('pf-stat-followers')?.textContent || '0';
    if (username) fetch(`${PF_API}/usuarios/stats-seguimiento/${encodeURIComponent(username)}`)
      .then(r => r.ok ? r.json() : null)
      .then(sd => { if (sd?.stats) flEl.textContent = pfFmt(sd.stats.seguidores || 0); })
      .catch(() => {});
  }

  // ── Period delta for KPI ──
  const dlDeltaEl = document.getElementById('eco-kpi-dl-delta');
  if (dlDeltaEl) {
    // Real (antes: total × días / 365, una estimación)
    dlDeltaEl.textContent = _ecoStats ? `${pfFmt(_ecoStats.totales.descargas)} en ${_ecoStats.dias} días` : '…';
  }

  // ── Chart badge ──
  const chartBadge = document.getElementById('eco-chart-badge');
  if (chartBadge) chartBadge.textContent = pfFmt(totalDl) + ' descargas';

  // ── Render sub-sections ──
  ecoDrawChart(totalDl, _ecoPeriodDays);
  ecoRenderLeaderboard(allMyContent);
  ecoRenderHealth(allMyContent);
  ecoRenderCategories(allMyContent);
  ecoRenderFunnel(totalDl, juegosEleg, saldo);
  ecoRenderGoals(saldo, totalDl, totalContent, juegosEleg);
  ecoRenderContentTable(allMyContent);
}

/* ── Bar Chart ── */
function ecoDrawChart(totalDl, periodDays) {
  const canvas = document.getElementById('eco-bar-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.parentElement.offsetWidth || 320;
  const H = 130;
  canvas.width  = W;
  canvas.height = H;

  // Datos REALES por día (/economia/mis-estadisticas). Antes se repartía el total con números
  // aleatorios: la gráfica cambiaba sola cada 8 s y no reflejaba nada.
  const serie = _ecoStats?.serie || [];
  const n = serie.length || 30;
  const counts = serie.length ? serie.map(x => x.d || 0) : Array(n).fill(0);

  const maxVal = Math.max(...counts, 1);
  const padL   = 34;
  const padR   = 6;
  const padT   = 8;
  const padB   = 20;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barW   = Math.max(2, chartW / n - 2);

  ctx.clearRect(0, 0, W, H);

  // Grid lines + Y-axis labels
  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH / 4) * i;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    const val = Math.round(maxVal * (1 - i / 4));
    ctx.fillStyle = 'rgba(144,144,170,0.55)';
    ctx.font = `9px 'DM Mono', monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + 'K' : val, padL - 4, y + 3);
  }

  // Bars
  const barGrad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
  barGrad.addColorStop(0, 'rgba(50,213,131,.9)');
  barGrad.addColorStop(1, 'rgba(50,213,131,.18)');

  counts.forEach((val, i) => {
    const bH = Math.max(2, (val / maxVal) * chartH);
    const x  = padL + i * (chartW / n);
    const y  = padT + chartH - bH;
    ctx.fillStyle = barGrad;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, barW, bH, 2);
    else ctx.rect(x, y, barW, bH);
    ctx.fill();
  });

  // Trend line (moving average)
  const ma = counts.map((_, i) => {
    const slice = counts.slice(Math.max(0, i - 2), i + 3);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  ctx.strokeStyle = 'rgba(90,200,250,0.55)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ma.forEach((val, i) => {
    const x = padL + i * (chartW / n) + barW / 2;
    const y = padT + chartH - Math.max(2, (val / maxVal) * chartH);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // X-axis date labels
  const now = new Date();
  ctx.fillStyle = 'rgba(144,144,170,0.45)';
  ctx.font = `8px 'DM Mono', monospace`;
  ctx.textAlign = 'center';
  [0, Math.floor(n / 2), n - 1].forEach(i => {
    const d = new Date(now);
    d.setDate(d.getDate() - (n - 1 - i));
    const x = padL + i * (chartW / n) + barW / 2;
    ctx.fillText(`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`, x, H - 4);
  });
}

/* ── Leaderboard ── */
function ecoRenderLeaderboard(items) {
  const el = document.getElementById('eco-leaderboard');
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="eco-empty-mini"><ion-icon name="albums-outline"></ion-icon><p>Sin publicaciones aún</p></div>`;
    return;
  }
  const sorted = [...items].sort((a, b) => (b.descargasEfectivas || 0) - (a.descargasEfectivas || 0)).slice(0, 5);
  const maxDl  = sorted[0]?.descargasEfectivas || 1;
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  const catColor = c => ({ Juego:'var(--g)', Mod:'#ff9800', Apps:'var(--cy)', Video:'#ff4c8b', Software:'#a78bfa', Ajustes:'#ffd700', Optimizacion:'#ff6b6b', ROM:'#fd79a8' }[c] || '#888');

  el.innerHTML = sorted.map((item, i) => {
    const dl  = item.descargasEfectivas || 0;
    const pct = dl / maxDl * 100;
    const col = catColor(item.category || item.categoria);
    return `<div class="eco-lb-row" onclick="ecoAbrir('${ugEsc(String(item._id || ''))}')" style="cursor:pointer">
      <div class="eco-lb-medal">${medals[i]}</div>
      <div class="eco-lb-info">
        <div class="eco-lb-title">${ugEsc(item.title || item.titulo || 'Sin título')}</div>
        <div class="eco-lb-cat" style="color:${col}">${ugEsc(catLabel(item.category || item.categoria || ''))}</div>
        <div class="eco-lb-bar-wrap"><div class="eco-lb-bar" style="width:${pct}%;background:${col}"></div></div>
      </div>
      <div class="eco-lb-stats">
        <div class="eco-lb-dl">${pfFmt(dl)}</div>
        <div class="eco-lb-dl-lbl">descargas</div>
      </div>
    </div>`;
  }).join('');
}

/* ── Health Score ── */
function ecoRenderHealth(items) {
  const totalReports = items.reduce((s, i) => s + (i.reportes || 0), 0);
  const totalDl      = items.reduce((s, i) => s + (i.descargasEfectivas || 0), 0);
  const activeCount  = items.filter(i => (i.descargasEfectivas || 0) > 0).length;
  const caidosCount  = items.filter(i => (i.reportes || 0) > 0).length;

  let score = items.length === 0 ? 0 : 100;
  if (totalDl > 0) score -= Math.min(50, (totalReports / totalDl) * 600);
  score = Math.max(0, Math.round(score));

  const grade = score >= 95 ? 'A+' : score >= 85 ? 'A' : score >= 75 ? 'B+' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';
  const gradeColor = score >= 85 ? 'var(--g)' : score >= 60 ? '#ffd700' : '#ff4343';

  // Semicircle gauge (path total arc length ≈ 163.4)
  const arcLen = 163.4;
  const gaugeEl = document.getElementById('eco-gauge-arc');
  if (gaugeEl) {
    gaugeEl.style.strokeDasharray  = arcLen;
    gaugeEl.style.strokeDashoffset = arcLen - (score / 100) * arcLen;
    gaugeEl.style.stroke = gradeColor;
  }
  const vEl = document.getElementById('eco-health-val');
  const gEl = document.getElementById('eco-health-grade');
  if (vEl) vEl.textContent = score;
  if (gEl) { gEl.textContent = grade; gEl.style.color = gradeColor; }

  const rEl = document.getElementById('eco-h-reports');
  const aEl = document.getElementById('eco-h-active');
  const cEl = document.getElementById('eco-h-caidos');
  if (rEl) { rEl.textContent = totalReports; rEl.className = `eco-hv eco-hv--${totalReports === 0 ? 'good' : totalReports < 3 ? 'warn' : 'bad'}`; }
  if (aEl) { aEl.textContent = `${activeCount}/${items.length}`; aEl.className = 'eco-hv eco-hv--good'; }
  if (cEl) { cEl.textContent = caidosCount; cEl.className = `eco-hv eco-hv--${caidosCount === 0 ? 'good' : 'bad'}`; }
}

/* ── Category Breakdown ── */
function ecoRenderCategories(items) {
  const el = document.getElementById('eco-cat-list');
  if (!el) return;
  if (!items.length) { el.innerHTML = `<div class="eco-empty-mini" style="padding:16px"><ion-icon name="albums-outline"></ion-icon></div>`; return; }

  const cats = {};
  items.forEach(i => { const c = i.category || i.categoria || 'Otro'; cats[c] = (cats[c] || 0) + 1; });
  const total  = items.length;
  const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const colors = { Juego:'var(--g)', Mod:'#ff9800', Apps:'var(--cy)', Video:'#ff4c8b', Software:'#a78bfa', Ajustes:'#ffd700', Optimizacion:'#ff6b6b', ROM:'#fd79a8' };

  el.innerHTML = sorted.map(([cat, count]) => {
    const pct = Math.round(count / total * 100);
    const col = colors[cat] || '#888';
    return `<div class="eco-cat-item">
      <div class="eco-cat-label" style="color:${col}">${catLabel(cat)}</div>
      <div class="eco-cat-bar-wrap"><div class="eco-cat-bar" style="width:${pct}%;background:${col}"></div></div>
      <div class="eco-cat-count">${count} (${pct}%)</div>
    </div>`;
  }).join('');
}

/* ── Conversion Funnel ── */
function ecoRenderFunnel(totalDl, elegibles, saldo) {
  // Vistas, descargas y apoyos reales del periodo (antes: vistas = descargas × 4,2 inventado)
  const t = _ecoStats?.totales || { vistas: 0, descargas: 0, apoyos: 0 };
  const estViews = t.vistas, estInteract = t.descargas;
  totalDl = t.apoyos;
  const maxV = Math.max(estViews, estInteract, 1);

  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  const setW = (id, pct) => { const e = document.getElementById(id); if (e) e.style.width = pct + '%'; };

  set('eco-rv-views',    pfFmt(estViews));
  set('eco-rv-interact', pfFmt(estInteract));
  set('eco-rv-dl',       pfFmt(totalDl));
  set('eco-rv-earn',     pfFmt(elegibles));

  setW('eco-rb-views',    (estViews / maxV) * 100);
  setW('eco-rb-interact', (estInteract / maxV) * 100);
  setW('eco-rb-dl',       (totalDl / maxV) * 100);
  setW('eco-rb-earn',     (elegibles / Math.max(_ecoMias().length, 1)) * 100);

  const cvrEl = document.getElementById('eco-cvr');
  if (cvrEl) cvrEl.textContent = estViews > 0 ? ((estInteract / estViews) * 100).toFixed(1) + '%' : '—%';
  const nota = document.getElementById('eco-funnel-nota');
  if (nota) nota.textContent = _ecoStats ? `Datos reales de los últimos ${_ecoStats.dias} días` : 'Cargando datos…';
}

/* ── Goals & Milestones ── */
function ecoRenderGoals(saldo, totalDl, totalContent, elegibles) {
  const el = document.getElementById('eco-goals');
  if (!el) return;

  const goals = [
    { icon: '💰', label: 'Primer UpCoin ganado',    target: 0.02,  curr: saldo,        fmt: v => '🪙 ' + (v / 0.02).toFixed(1) },
    { icon: '📥', label: '50 descargas',             target: 50,    curr: totalDl,      fmt: v => pfFmt(v) },
    { icon: '📦', label: '5 publicaciones',          target: 5,     curr: totalContent, fmt: v => v },
    { icon: '🚀', label: '100 descargas',            target: 100,   curr: totalDl,      fmt: v => pfFmt(v) },
    { icon: '💸', label: 'Retiro disponible (500 UC)', target: 10,  curr: saldo,        fmt: v => '🪙 ' + Math.floor(v / 0.02) },
    { icon: '🏆', label: '10 publicaciones',         target: 10,    curr: totalContent, fmt: v => v },
    { icon: '⭐', label: '500 descargas',            target: 500,   curr: totalDl,      fmt: v => pfFmt(v) },
    { icon: '🔥', label: '1 000 descargas',          target: 1000,  curr: totalDl,      fmt: v => pfFmt(v) },
    { icon: '👑', label: '10 contenidos monetizados',target: 10,    curr: elegibles,    fmt: v => v },
    { icon: '💎', label: '5 000 descargas',          target: 5000,  curr: totalDl,      fmt: v => pfFmt(v) },
  ];

  el.innerHTML = goals.map(g => {
    const pct  = Math.min(100, (g.curr / g.target) * 100);
    const done = pct >= 100;
    return `<div class="eco-goal-row ${done ? 'eco-goal-done' : ''}">
      <div class="eco-goal-icon">${g.icon}</div>
      <div class="eco-goal-body">
        <div class="eco-goal-label">${g.label}</div>
        <div class="eco-goal-bar-wrap"><div class="eco-goal-bar" style="width:${pct}%"></div></div>
        <div class="eco-goal-progress">${g.fmt(g.curr)} / ${g.fmt(g.target)}</div>
      </div>
      <div class="eco-goal-check">${done ? '<ion-icon name="checkmark-circle" style="color:var(--g)"></ion-icon>' : ''}</div>
    </div>`;
  }).join('');
}

/* ── All Content Table ── */
function ecoRenderContentTable(items) {
  const el       = document.getElementById('eco-content-table');
  const countEl  = document.getElementById('eco-table-count');
  if (!el) return;
  if (countEl) countEl.textContent = items.length + ' items';

  if (!items.length) {
    el.innerHTML = `<div class="eco-empty-mini"><ion-icon name="albums-outline"></ion-icon><p>Aún no tienes publicaciones</p></div>`;
    return;
  }

  const sorted = [...items].sort((a, b) => (b.descargasEfectivas || 0) - (a.descargasEfectivas || 0));
  const maxDl  = sorted[0]?.descargasEfectivas || 1;
  const colors = { Juego:'var(--g)', Mod:'#ff9800', Apps:'var(--cy)', Video:'#ff4c8b', Software:'#a78bfa', Ajustes:'#ffd700', Optimizacion:'#ff6b6b', ROM:'#fd79a8' };
  const catShort = c => ({ Juego:'JUG', Mod:'MOD', Apps:'APP', Video:'VID', Software:'SW', Ajustes:'HER', Optimizacion:'OPT', ROM:'ROM' }[c] || ugEsc(String(catLabel(c)).slice(0, 3).toUpperCase()));

  el.innerHTML = `
    <div class="eco-table-header">
      <span>CONTENIDO</span><span style="text-align:center">CAT.</span><span style="text-align:center">DL</span><span style="text-align:center">REP.</span>
    </div>
    <div class="eco-table-body">
      ${sorted.map(item => {
        const dl  = item.descargasEfectivas || 0;
        const rep = item.reportes || 0;
        const col = colors[item.categoria] || '#888';
        return `<div class="eco-table-row">
          <div class="eco-table-title-col">
            <div class="eco-table-title">${ugEsc(item.title || item.titulo || '—')}</div>
            <div class="eco-table-bar-wrap"><div class="eco-table-bar" style="width:${(dl/maxDl)*100}%;background:${col}"></div></div>
          </div>
          <div class="eco-table-cat" style="color:${col}">${catShort(item.category || item.categoria)}</div>
          <div class="eco-table-dl">${pfFmt(dl)}</div>
          <div class="eco-table-reps ${rep > 0 ? 'eco-reps-warn' : ''}">${rep}</div>
        </div>`;
      }).join('')}
    </div>`;
}

/* ── Re-draw chart on resize ── */
window.addEventListener('resize', () => {
  clearTimeout(_ecoChartTimer);
  _ecoChartTimer = setTimeout(() => {
    if (_ecoLastData) ecoDrawChart(_ecoLastData.descargasTotales || 0, _ecoPeriodDays);
  }, 200);
});
function pfFmt(n) {
  if(!n) return '0';
  if(n>=1e6) return (n/1e6).toFixed(1)+'M';
  if(n>=1e3) return (n/1e3).toFixed(1)+'K';
  return n.toString();
}
// ── MÉTODO DE COBRO (PayPal, Nequi, Daviplata, banco, Mercado Pago) ──
let _ecoCobroCfg = null;
function ecoCobroPintar(m, espera) {
  const box = document.getElementById('eco-cobro'); if (!box || box.dataset.editando) return;
  const ic = { paypal: '🅿️', nequi: '💜', daviplata: '🔴', banco: '🏦', mercadopago: '🤝' };
  box.innerHTML = m
    ? `<div class="eco-cobro-act"><span class="eco-cobro-ic">${ic[m.tipo] || '💳'}</span><div><b>${escH(m.resumen)}</b>${espera ? `<small>🔒 Por seguridad podrás retirar desde el ${new Date(espera).toLocaleString('es-CO')}</small>` : '<small>Aquí te enviamos tus retiros</small>'}</div><button type="button" class="eco-cobro-btn" onclick="ecoCobroEditar()">Cambiar</button></div>`
    : `<div class="eco-cobro-vacio"><p>Aún no has dicho dónde quieres recibir tu dinero.</p><button type="button" class="eco-cobro-btn p" onclick="ecoCobroEditar()">Configurar método de cobro</button></div>`;
}
async function ecoCobroEditar() {
  const box = document.getElementById('eco-cobro'); if (!box) return;
  try { if (!_ecoCobroCfg) _ecoCobroCfg = await (await fetch(`${PF_API}/economia/metodo-cobro`, { headers: { Authorization: `Bearer ${LS.get('token')}` } })).json(); }
  catch (_) { toast('❌ Error de conexión'); return; }
  const c = _ecoCobroCfg; box.dataset.editando = '1';
  const opt = (arr, sel) => arr.map(x => `<option ${x === sel ? 'selected' : ''}>${escH(x)}</option>`).join('');
  const campos = {
    paypal: `<input name="email" type="email" placeholder="Email de tu cuenta PayPal" autocomplete="email">`,
    nequi: `<input name="celular" inputmode="numeric" placeholder="Celular Nequi (10 dígitos)"><input name="titular" placeholder="Nombre del titular">`,
    daviplata: `<input name="celular" inputmode="numeric" placeholder="Celular Daviplata (10 dígitos)"><input name="titular" placeholder="Nombre del titular">`,
    mercadopago: `<input name="cuenta" placeholder="Email o celular de tu cuenta Mercado Pago"><input name="titular" placeholder="Nombre del titular">`,
    banco: `<select name="banco"><option value="">Banco…</option>${opt(c.bancos)}</select><select name="tipoCuenta"><option value="ahorros">Ahorros</option><option value="corriente">Corriente</option></select>
      <input name="numero" inputmode="numeric" placeholder="Número de cuenta"><input name="titular" placeholder="Titular (como aparece en el banco)">
      <div class="eco-cobro-2"><select name="tipoDoc">${opt(c.tiposDoc, 'CC')}</select><input name="documento" placeholder="Número de documento"></div>`,
  };
  box.innerHTML = `<div class="eco-cobro-form">
    <div class="eco-cobro-tipos">${c.tipos.map((t, i) => `<button type="button" data-t="${t.id}" class="${i === 0 ? 'on' : ''}">${escH(t.nombre)}</button>`).join('')}</div>
    <div class="eco-cobro-campos"></div>
    <input name="password" type="password" placeholder="Tu contraseña de UpGames (para confirmar)" autocomplete="current-password">
    <p class="eco-cobro-nota">🔒 Tus datos se guardan cifrados y solo se usan para enviarte tus retiros. Si cambias un método ya configurado, por seguridad los retiros quedan en espera ${c.esperaHoras} h y te avisamos por email.
      <b>No se puede pagar a un número de tarjeta</b>: si tienes tarjeta débito, usa la cuenta, Nequi o Daviplata asociada.</p>
    <div class="eco-cobro-acc"><button type="button" class="eco-cobro-btn" data-a="cancelar">Cancelar</button><button type="button" class="eco-cobro-btn p" data-a="guardar">Guardar</button></div></div>`;
  let tipo = c.tipos[0].id;
  const pintarCampos = () => { box.querySelector('.eco-cobro-campos').innerHTML = campos[tipo]; };
  pintarCampos();
  box.querySelectorAll('.eco-cobro-tipos button').forEach(b => b.onclick = () => { tipo = b.dataset.t; box.querySelectorAll('.eco-cobro-tipos button').forEach(x => x.classList.toggle('on', x === b)); pintarCampos(); });
  box.querySelector('[data-a="cancelar"]').onclick = () => { delete box.dataset.editando; pfLoadEconomia(); };
  box.querySelector('[data-a="guardar"]').onclick = async e => {
    const datos = {}; box.querySelectorAll('.eco-cobro-campos [name]').forEach(x => datos[x.name] = x.value);
    const password = box.querySelector('[name="password"]').value;
    if (!password) { toast('⚠️ Escribe tu contraseña para confirmar'); return; }
    e.target.disabled = true;
    try {
      const r = await fetch(`${PF_API}/economia/metodo-cobro`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LS.get('token')}` }, body: JSON.stringify({ tipo, datos, password }) });
      const d = await r.json();
      if (d.success) { toast('✅ ' + d.mensaje); delete box.dataset.editando; ecoCobroPintar(d.metodo, d.esperaHasta); pfLoadEconomia(); }
      else { toast('❌ ' + (d.error || 'Error')); e.target.disabled = false; }
    } catch (_) { toast('❌ Error de conexión'); e.target.disabled = false; }
  };
}
async function pfSolicitarPago() {
  const ok = await customConfirm({
    icon: '💸',
    title: 'Solicitar pago',
    msg: '¿Confirmas que deseas retirar tus UpCoins ganados? Te pagamos su valor en dinero al método de cobro que configuraste, normalmente en 24-72 h hábiles.',
    okText: 'Solicitar',
    okDanger: false
  });
  if(!ok) return;
  const token = LS.get('token');
  try {
    const res = await fetch(`${PF_API}/economia/solicitar-pago`,{
      method:'POST', headers:{ Authorization:`Bearer ${token}` }
    });
    const d = await res.json();
    if(d.success) { toast('✅ '+d.mensaje); pfLoadEconomia(); }
    else toast('❌ '+(d.error||'Error'));
  } catch(e) { toast('❌ Error de conexión'); }
}

// ── TARJETAS ──────────────────────────────────────────────
let _tarjetaFormVisible = false;

function _detectarTipoTarjeta(num) {
  const n = num.replace(/\D/g,'');
  if (/^4/.test(n)) return 'visa';
  if (/^5[1-5]/.test(n) || /^2(2[2-9]|[3-6]\d|7[01]\d|720)/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  return 'otro';
}

function _luhnCheck(num) {
  const digits = num.replace(/\D/g,'').split('').reverse().map(Number);
  const sum = digits.reduce((acc, d, i) => {
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    return acc + d;
  }, 0);
  return sum % 10 === 0;
}

function _onCardNumInput(input) {
  const raw = input.value.replace(/\D/g,'').substring(0, 16);
  input.value = raw.replace(/(.{4})/g,'$1 ').trim();
  const tipo = _detectarTipoTarjeta(raw);
  const tipoEl = document.getElementById('pf-tarjeta-tipo-detected');
  if (tipoEl) {
    const names = { visa:'VISA', mastercard:'MC', amex:'AMEX', otro:'' };
    tipoEl.textContent = names[tipo] || '';
    tipoEl.className = `pf-tipo-badge pf-tipo-badge--${tipo}`;
  }
}

function pfMostrarFormTarjeta() {
  const form = document.getElementById('pf-form-tarjeta');
  if (!form) return;
  _tarjetaFormVisible = !_tarjetaFormVisible;
  form.style.display = _tarjetaFormVisible ? 'block' : 'none';
  const btn = document.getElementById('pf-btn-add-tarjeta');
  if (btn) btn.innerHTML = _tarjetaFormVisible
    ? '<ion-icon name="close-outline"></ion-icon> CANCELAR'
    : '<ion-icon name="add-circle-outline"></ion-icon> AGREGAR';
  if (_tarjetaFormVisible) {
    setTimeout(() => form.scrollIntoView({ behavior:'smooth', block:'nearest' }), 100);
  }
}

async function pfLoadTarjetas() {
  const token = LS.get('token');
  if (!token) return;
  const list = document.getElementById('pf-tarjetas-list');
  if (!list) return;
  try {
    const res = await fetch(`${PF_API}/economia/mis-tarjetas`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const d = await res.json();
    if (!d.success || !d.tarjetas?.length) {
      list.innerHTML = `<div class="pf-tarjetas-empty">
        <ion-icon name="card-outline"></ion-icon>
        <p>No tienes tarjetas registradas</p>
      </div>`;
      return;
    }
    const logos = { visa:'VISA', mastercard:'MC', amex:'AMEX', otro:'···' };
    const propLabel = { cobros:'↓ Cobros', pagos:'↑ Pagos', ambos:'↕ Ambos' };
    list.innerHTML = d.tarjetas.map(t => `
      <div class="pf-tarjeta-card${t.esPrincipal ? ' principal' : ''}" data-id="${t._id}">
        <div class="pf-tarjeta-left">
          <div class="pf-tarjeta-logo pf-tarjeta-logo--${t.tipo}">${logos[t.tipo]||'···'}</div>
          <div class="pf-tarjeta-info">
            <div class="pf-tarjeta-num">•••• •••• •••• ${t.ultimos4}</div>
            <div class="pf-tarjeta-titular">${t.titular}</div>
            <div class="pf-tarjeta-meta">
              <span class="pf-tarjeta-exp">Exp: ${t.mesExp}/${t.anioExp}</span>
              <span class="pf-tarjeta-prop pf-tarjeta-prop--${t.proposito}">${propLabel[t.proposito]||'↕ Ambos'}</span>
            </div>
            ${t.alias ? `<div class="pf-tarjeta-alias">${t.alias}</div>` : ''}
          </div>
        </div>
        <div class="pf-tarjeta-actions">
          ${!t.esPrincipal
            ? `<button class="pf-tarjeta-btn principal-btn" onclick="pfSetTarjetaPrincipal('${t._id}')" title="Principal"><ion-icon name="star-outline"></ion-icon></button>`
            : `<span class="pf-tarjeta-principal-badge" title="Tarjeta principal"><ion-icon name="star"></ion-icon></span>`
          }
          <button class="pf-tarjeta-btn del-btn" onclick="pfEliminarTarjeta('${t._id}')" title="Eliminar"><ion-icon name="trash-outline"></ion-icon></button>
        </div>
      </div>`).join('');
  } catch(e) {
    list.innerHTML = `<div class="pf-tarjetas-empty" style="color:#ff4343"><p>Error al cargar tarjetas</p></div>`;
  }
}

async function pfGuardarTarjeta() {
  const numEl   = document.getElementById('pf-input-card-num');
  const titEl   = document.getElementById('pf-input-card-tit');
  const mesEl   = document.getElementById('pf-input-card-mes');
  const anioEl  = document.getElementById('pf-input-card-anio');
  const propEl  = document.getElementById('pf-input-card-prop');
  const aliasEl = document.getElementById('pf-input-card-alias');
  if (!numEl) return;

  const rawNum  = numEl.value.replace(/\D/g,'');
  const titular = titEl.value.trim();
  const mes     = mesEl.value.trim();
  const anio    = anioEl.value.trim();
  const prop    = propEl.value;
  const alias   = aliasEl.value.trim();

  if (rawNum.length < 13 || rawNum.length > 19) { toast('⚠️ Número de tarjeta inválido'); return; }
  if (!_luhnCheck(rawNum)) { toast('⚠️ Número de tarjeta incorrecto'); return; }
  if (!titular) { toast('⚠️ Ingresa el nombre del titular'); return; }
  const mesN = parseInt(mes, 10);
  if (!mes || mesN < 1 || mesN > 12) { toast('⚠️ Mes inválido (01-12)'); return; }
  const anioN = parseInt(anio, 10);
  const now = new Date();
  const nowYear = now.getFullYear() % 100;
  const nowMonth = now.getMonth() + 1;
  if (!anio || anioN < nowYear || (anioN === nowYear && mesN < nowMonth)) { toast('⚠️ Tarjeta vencida'); return; }

  const ultimos4 = rawNum.slice(-4);
  const tipo = _detectarTipoTarjeta(rawNum);
  const token = LS.get('token');

  const btn = document.getElementById('pf-btn-guardar-tarjeta');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  try {
    const res = await fetch(`${PF_API}/economia/agregar-tarjeta`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
      body: JSON.stringify({ ultimos4, titular, mesExp: mes.padStart(2,'0'), anioExp: anio, tipo, proposito: prop, alias })
    });
    const d = await res.json();
    if (d.success) {
      toast('✅ Tarjeta registrada');
      numEl.value=''; titEl.value=''; mesEl.value=''; anioEl.value=''; aliasEl.value=''; propEl.value='ambos';
      const tipoEl = document.getElementById('pf-tarjeta-tipo-detected');
      if (tipoEl) { tipoEl.textContent=''; tipoEl.className='pf-tipo-badge'; }
      if (_tarjetaFormVisible) pfMostrarFormTarjeta();
      await pfLoadTarjetas();
    } else {
      toast('❌ '+(d.error||'Error al guardar'));
    }
  } catch(e) {
    toast('❌ Error de conexión');
  } finally {
    if (btn) { btn.disabled=false; btn.innerHTML='<ion-icon name="save-outline"></ion-icon> GUARDAR TARJETA'; }
  }
}

async function pfEliminarTarjeta(tarjetaId) {
  const ok = await customConfirm({
    icon: '🗑️',
    title: 'Eliminar tarjeta',
    msg: '¿Confirmas que deseas eliminar esta tarjeta?',
    okText: 'Eliminar',
    okDanger: true
  });
  if (!ok) return;
  const token = LS.get('token');
  try {
    const res = await fetch(`${PF_API}/economia/eliminar-tarjeta/${tarjetaId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await res.json();
    if (d.success) { toast('✅ Tarjeta eliminada'); pfLoadTarjetas(); }
    else toast('❌ '+(d.error||'Error'));
  } catch(e) { toast('❌ Error de conexión'); }
}

async function pfSetTarjetaPrincipal(tarjetaId) {
  const token = LS.get('token');
  try {
    const res = await fetch(`${PF_API}/economia/tarjeta-principal/${tarjetaId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await res.json();
    if (d.success) { toast('⭐ Tarjeta principal actualizada'); pfLoadTarjetas(); }
    else toast('❌ '+(d.error||'Error'));
  } catch(e) { toast('❌ Error de conexión'); }
}

// ── Settings Modal ──
// Editar perfil: 3 grupos (Perfil · Estilo · Cuenta) con vista previa en vivo.
// pfOpenSettings('avatar'|'portada'|'bio'|'links'|'nombre'|'email'|'pass'|'repair'|'estilo') sigue funcionando.
const PFX_GRUPO = { avatar: 'perfil', portada: 'perfil', bio: 'perfil', links: 'perfil', estilo: 'estilo', nombre: 'cuenta', email: 'cuenta', pass: 'cuenta', repair: 'cuenta' };
function pfOpenSettings(tab) {
  document.getElementById('pf-settingsModal').classList.add('show');
  document.body.style.overflow='hidden';
  pfSwitchSettings(typeof tab === 'string' ? tab : 'avatar');
  pfxVista();
}
function pfCloseSettings() {
  document.getElementById('pf-settingsModal').classList.remove('show');
  document.body.style.overflow='';
}
function pfxGrupo(g) {
  document.querySelectorAll('#pf-settingsModal .pfx-tabs [data-g]').forEach(b => { const on = b.dataset.g === g; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('#pf-settingsModal .pfx-grupo').forEach(x => x.classList.toggle('on', x.dataset.g === g));
  if (g === 'estilo') window.UGX?.tienda?.(pfxGrupo.tipo || 'pack', document.getElementById('pfx-estilo'));   // abre en Packs (si no hay, en Marcos)
}
function pfSwitchSettings(type, el) {
  const g = PFX_GRUPO[type] || 'perfil';
  pfxGrupo(g);
  const card = document.getElementById(`pf-settings-${type}`);
  if (card?.classList.contains('pfx-plegable')) card.classList.add('abierto');
  if (card && type !== 'avatar') setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  else document.querySelector('#pf-settingsModal .pf-modal-sheet')?.scrollTo({ top: 0 });
}
function pfxPlegar(b) { b.closest('.pfx-plegable')?.classList.toggle('abierto'); }
document.querySelectorAll('#pf-settingsModal .pfx-tabs [data-g]').forEach(b => b.addEventListener('click', () => pfxGrupo(b.dataset.g)));
/** Vista previa: foto, portada o fondo, color del nombre e insignias, tal como te ven los demás. */
async function pfxVista() {
  const yo = LS.get('user_admin', ''); if (!yo) return;
  const av = document.getElementById('pfx-vista-av'), nom = document.getElementById('pfx-vista-nombre'), fondo = document.getElementById('pfx-vista-fondo');
  if (!av) return;
  const img = document.getElementById('pf-avatar-img'), foto = img && img.style.display !== 'none' ? img.getAttribute('src') : '';
  nom.textContent = '@' + yo;
  document.getElementById('pfx-vista-bio').textContent = (document.getElementById('pf-bio')?.textContent || '').replace(/^Sin biografía$/, '').slice(0, 90);
  const banner = document.getElementById('pf-cover')?.style.backgroundImage || '';
  const mio = await window.UGX?.cargarMio?.().catch(() => null), est = mio?.estilo || {};
  window.UGX?.pintarAvatar?.(av, { avatar: foto, estilo: est }, (yo[0] || '?').toUpperCase());
  window.UGX?.aplicarEstilo?.(est, { nombre: nom, fondo });
  fondo.style.backgroundImage = !est.fondo && /url\(/.test(banner) ? banner : '';
  document.getElementById('pfx-vista-ins').innerHTML = window.UGX?.insigniasHTML?.(est.insignias) || '';
}
window.pfxVista = pfxVista;
function pfUpdateAvatarPreview() {
  const url = document.getElementById('pf-input-avatar-url').value;
  const prev = document.getElementById('pf-preview-avatar');
  if(url) { prev.innerHTML=''; const pi=document.createElement('img'); pi.src=url; pi.alt='Avatar'; prev.appendChild(pi); }
  else prev.innerHTML='<ion-icon name="person"></ion-icon>';
}
async function pfSaveAvatar() {
  const url = document.getElementById('pf-input-avatar-url').value.trim();
  if(!url) { toast('⚠️ Ingresa una URL de avatar'); return; }
  try {
    const _avatarToken = LS.get('token');
    const res = await fetch(`${PF_API}/usuarios/update-avatar`,{
      method:'PUT',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${_avatarToken}`},
      body: JSON.stringify({ nuevaFoto:url })
    });
    if(res.ok) {
      toast('✅ Avatar actualizado');
      const img = document.getElementById('pf-avatar-img');
      img.src=url; img.style.display='block';
      document.getElementById('pf-avatar-icon').style.display='none';
      pfCloseSettings();
    } else { const d = await res.json().catch(() => ({})); toast('❌ ' + (d.error || 'Error al actualizar avatar')); }
  } catch(e) { toast('❌ Error de conexión'); }
}

// ══════════════════════════════════════════════════
// PORTADA DEL PERFIL (imagen detrás del avatar)
// ══════════════════════════════════════════════════
const PF_BANNER_RE = /^https:\/\/[^\s"'<>`\\]+$/i;
function pfCssUrl(u) { return `url("${String(u).replace(/["\\\n]/g, '')}")`; }
function pfApplyBanner(url) {
  const cover = document.getElementById('pf-cover');
  const prev  = document.getElementById('pf-preview-banner');
  const rm    = document.getElementById('pf-bn-remove-btn');
  const inp   = document.getElementById('pf-input-banner-url');
  const ok = url && PF_BANNER_RE.test(url);
  const shown = ok ? cldOpt(url, CLD_BANNER) : '';
  if (cover) { cover.style.backgroundImage = ok ? pfCssUrl(shown) : ''; cover.classList.toggle('has-banner', !!ok); }
  if (prev)  { prev.style.backgroundImage  = ok ? pfCssUrl(shown) : ''; prev.classList.toggle('has-banner', !!ok); }
  if (rm) rm.style.display = ok ? '' : 'none';
  if (inp && ok) inp.value = url;
}
function pfPreviewBanner(url) {
  const prev = document.getElementById('pf-preview-banner');
  if (!prev) return;
  const ok = PF_BANNER_RE.test((url || '').trim());
  prev.style.backgroundImage = ok ? pfCssUrl(cldOpt(url.trim(), CLD_BANNER)) : '';
  prev.classList.toggle('has-banner', ok);
}
async function pfSaveBanner(url) {
  url = (url || '').trim();
  if (url && !PF_BANNER_RE.test(url)) { toast('⚠️ La URL debe empezar por https:// y no tener espacios'); return; }
  if (url && ugEsVideoArchivo(url)) { toast('⚠️ La portada debe ser una imagen, no un video'); return; }
  try {
    const res = await fetch(`${PF_API}/usuarios/update-banner`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LS.get('token')}` },
      body: JSON.stringify({ bannerUrl: url })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) { toast('❌ ' + (d.error || 'No se pudo guardar la portada')); return; }
    pfApplyBanner(d.banner || '');
    if (!d.banner) { const inp = document.getElementById('pf-input-banner-url'); if (inp) inp.value = ''; }
    toast(d.banner ? '✅ Portada actualizada' : '🗑️ Portada eliminada');
    pfCloseSettings();
  } catch(e) { toast('❌ Error de conexión'); }
}
function pfRemoveBanner() {
  if (!confirm('¿Quitar tu imagen de portada?')) return;
  pfSaveBanner('');
}
async function pfUploadBanner() {
  const btn = document.getElementById('pf-bn-upload-btn');
  const orig = btn ? btn.innerHTML : '';
  try {
    const url = await pfImageUpload({ aspect: 3, transform: CLD_BANNER, folder: 'banners' });
    if (!url) return;                       // el usuario cerró el widget
    if (btn) { btn.innerHTML = '<ion-icon name="sync-outline" style="animation:spin .8s linear infinite"></ion-icon> Guardando...'; btn.disabled = true; }
    await pfSaveBanner(url);
  } catch(e) {
    toast('❌ ' + e.message);
  } finally {
    if (btn) { btn.innerHTML = orig; btn.disabled = false; }
  }
}

// ══════════════════════════════════════════════════
// SUBIR FOTO DE PERFIL / PORTADAS / MINIATURA
// Todo usa el widget universal (mismo que video)
// ══════════════════════════════════════════════════

// Avatar: cambia entre modo URL y modo Subir
function pfSwitchAvatarMode(mode) {
  const urlDiv = document.getElementById('pf-av-mode-url');
  const upDiv  = document.getElementById('pf-av-mode-upload');
  const tUrl   = document.getElementById('pf-av-tab-url');
  const tUp    = document.getElementById('pf-av-tab-upload');
  if(mode === 'url') {
    urlDiv.style.display = ''; upDiv.style.display = 'none';
    tUrl.classList.add('active'); tUp.classList.remove('active');
  } else {
    urlDiv.style.display = 'none'; upDiv.style.display = '';
    tUrl.classList.remove('active'); tUp.classList.add('active');
  }
}

// Avatar: subir foto vía widget y guardar
async function pfUploadAvatar() {
  const btn = document.getElementById('pf-av-upload-btn');
  const orig = btn ? btn.innerHTML : '';
  try {
    const url = await pfImageUpload({ aspect: 1, transform: CLD_AVATAR, folder: 'avatars' });
    if(!url) return;                        // el usuario cerró el widget
    const data = { success: true, url };
    // preview
    const prev = document.getElementById('pf-preview-avatar');
    if(prev) prev.innerHTML = `<img src="${ugEsc(data.url)}" alt="Avatar">`;
    if(btn) { btn.innerHTML = '<ion-icon name="sync-outline" style="animation:spin .8s linear infinite"></ion-icon> Guardando...'; btn.disabled = true; }
    // guardar en backend
    const token = LS.get('token');
    const res = await fetch(`${PF_API}/usuarios/update-avatar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ nuevaFoto: data.url })
    });
    if(res.ok) {
      toast('✅ Foto de perfil actualizada');
      const img = document.getElementById('pf-avatar-img');
      if(img){ img.src = data.url; img.style.display = 'block'; }
      const icon = document.getElementById('pf-avatar-icon');
      if(icon) icon.style.display = 'none';
      pfCloseSettings();
    } else toast('❌ Error al guardar avatar');
  } catch(e) {
    toast('❌ ' + e.message);
  } finally {
    if(btn) { btn.innerHTML = orig; btn.disabled = false; }
  }
}

// Portadas (slots 0-3): subir imagen o video
async function pfOpenCoverWidget(slot) {
  const ids = ['pf-addImage','pf-addImage2','pf-addImage3','pf-addImage4'];
  const btn = document.querySelector(`[onclick="pfOpenCoverWidget(${slot})"]`);
  const orig = btn ? btn.innerHTML : '';
  if(btn) { btn.innerHTML = '<ion-icon name="sync-outline" style="animation:spin .8s linear infinite"></ion-icon>'; btn.disabled = true; }
  try {
    const data = await pfWidgetUpload();
    if(data.success) {
      const inp = document.getElementById(ids[slot]);
      if(inp) { inp.value = data.url; inp.dispatchEvent(new Event('input')); }
      toast('✅ Media subida a la nube');
    }
  } catch(e) {
    toast('❌ ' + e.message);
  } finally {
    if(btn) { btn.innerHTML = orig; btn.disabled = false; }
  }
}

// Miniatura de video: subir imagen
async function pfOpenThumbnailWidget() {
  const btn = document.querySelector('[onclick="pfOpenThumbnailWidget()"]');
  const orig = btn ? btn.innerHTML : '';
  if(btn) { btn.innerHTML = '<ion-icon name="sync-outline" style="animation:spin .8s linear infinite"></ion-icon>'; btn.disabled = true; }
  try {
    const data = await pfWidgetUpload();
    if(data.success) {
      const inp = document.getElementById('pf-vid-thumbnail');
      if(inp) { inp.value = data.url; inp.dispatchEvent(new Event('input')); }
      toast('✅ Miniatura subida a la nube');
    }
  } catch(e) {
    toast('❌ ' + e.message);
  } finally {
    if(btn) { btn.innerHTML = orig; btn.disabled = false; }
  }
}

// ── EDITAR PUBLICACIÓN: subir imagen/video directo a la nube (no solo links) ──
async function pfOpenEditCoverWidget(slot) {
  const ids = ['pf-edit-image','pf-edit-image2','pf-edit-image3','pf-edit-image4'];
  const btn = document.querySelector(`[onclick="pfOpenEditCoverWidget(${slot})"]`);
  const orig = btn ? btn.innerHTML : '';
  if(btn) { btn.innerHTML = '<ion-icon name="sync-outline" style="animation:spin .8s linear infinite"></ion-icon>'; btn.disabled = true; }
  try {
    const data = await pfWidgetUpload();
    if(data.success) {
      const inp = document.getElementById(ids[slot]);
      if(inp) { inp.value = data.url; inp.dispatchEvent(new Event('input')); }
      toast('✅ Media subida a la nube');
    }
  } catch(e) {
    toast('❌ ' + e.message);
  } finally {
    if(btn) { btn.innerHTML = orig; btn.disabled = false; }
  }
}

// ── EDITAR VIDEO: subir miniatura directo a la nube ──
async function pfOpenEditVideoThumbWidget() {
  const btn = document.querySelector('[onclick="pfOpenEditVideoThumbWidget()"]');
  const orig = btn ? btn.innerHTML : '';
  if(btn) { btn.innerHTML = '<ion-icon name="sync-outline" style="animation:spin .8s linear infinite"></ion-icon>'; btn.disabled = true; }
  try {
    const data = await pfWidgetUpload();
    if(data.success) {
      const inp = document.getElementById('pf-edit-vid-thumb');
      if(inp) { inp.value = data.url; inp.dispatchEvent(new Event('input')); }
      toast('✅ Miniatura subida a la nube');
    }
  } catch(e) {
    toast('❌ ' + e.message);
  } finally {
    if(btn) { btn.innerHTML = orig; btn.disabled = false; }
  }
}
async function pfSaveBio() {
  const bio = document.getElementById('pf-input-bio').value.trim();
  if(!bio) { toast('⚠️ La bio no puede estar vacía'); return; }
  try {
    const _bioToken = LS.get('token');
    const res = await fetch(`${PF_API}/usuarios/update-bio`,{
      method:'PUT',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${_bioToken}`},
      body: JSON.stringify({ bio })
    });
    if(res.ok) {
      toast('✅ Bio actualizada');
      document.getElementById('pf-bio').textContent = bio;
      pfCloseSettings();
    } else toast('❌ Error al actualizar bio');
  } catch(e) { toast('❌ Error de conexión'); }
}

// ── Category info modal ──
function pfOpenCatInfo() {
  document.getElementById('pf-catModal').classList.add('show');
  document.body.style.overflow='hidden';
}
function pfCloseCatInfo() {
  document.getElementById('pf-catModal').classList.remove('show');
  document.body.style.overflow='';
}

// ── Tooltips ──
function pfToggleTooltip(id) {
  document.querySelectorAll('.pf-tooltip').forEach(t => { if(t.id!==id) t.classList.remove('active'); });
  document.getElementById(id)?.classList.toggle('active');
}
function pfCloseTooltip(id) {
  document.getElementById(id)?.classList.remove('active');
}

// ── Logout ──
async function pfLogout() {
  const ok = await customConfirm({
    icon: '👋',
    title: '¿Cerrar sesión?',
    msg: 'Tu sesión local se eliminará. Podrás volver a iniciar sesión en cualquier momento.',
    okText: 'Cerrar sesión',
    okDanger: true
  });
  if(!ok) return;
  ['user_admin','token','RefreshToken','user_avatar','user_verified','user_rol',
   'upgames_items_cache','upgames_users_cache'].forEach(k => LS.remove(k));
  // Limpiar caché del navegador para esta página
  try { localStorage.clear(); } catch(_) {}
  toast('👋 Sesión cerrada');
  // replace() elimina biblioteca.html del historial — el botón "atrás" no puede regresar
  setTimeout(()=>{ location.replace('../index.html'); }, 800);
}

// Close modals on overlay click
['pf-settingsModal','pf-editModal','pf-catModal'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', function(e) {
    if(e.target===this) {
      this.classList.remove('show');
      document.body.style.overflow='';
    }
  });
});
// Escape closes pf modals
document.addEventListener('keydown', e => {
  if(e.key==='Escape') {
    pfCloseSettings(); pfCloseEditModal(); pfCloseCatInfo();
    document.querySelectorAll('.pf-tooltip').forEach(t=>t.classList.remove('active'));
  }
});

// ── Prueba A/B de la bienvenida: cada dispositivo ve siempre la misma versión ──
// A = "ecosistema que no existe en otro lugar" · B = "lo que creas te genera dinero real"
const UG_AB = (() => { try { let v = localStorage.getItem('ug_ab_bienv'); if (v !== 'A' && v !== 'B') { v = Math.random() < 0.5 ? 'A' : 'B'; localStorage.setItem('ug_ab_bienv', v); } return v; } catch (_) { return 'A'; } })();
function ugAB(evento, modo) {
  try {
    const env = JSON.parse(localStorage.getItem('ug_ab_env') || '{}'), k = `${evento}:${modo}`;
    if (env[k]) return; env[k] = Date.now(); localStorage.setItem('ug_ab_env', JSON.stringify(env));
    fetch(`${API_URL}/ab/evento`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exp: 'bienvenida', variante: UG_AB, evento, modo }) }).catch(() => {});
  } catch (_) {}
}

// ── BIENVENIDA — 3 pantallas + términos ───────────────────
(function initOnboarding() {
  const TERMINOS_VERSION = '6.2';   // súbela al cambiar los Términos o la Privacidad
  function avisoTerminosNuevos() {
    const a = document.createElement('div'); a.className = 'ug-terminos-aviso'; a.setAttribute('role', 'status');
    a.innerHTML = `<span>📜 Actualizamos los <a href="./terminos_condiciones.html#moderacion" target="_blank" rel="noopener">Términos (v${TERMINOS_VERSION})</a> y la <a href="./politica-privacidad.html" target="_blank" rel="noopener">Privacidad</a>: referidos, promover lives, repeticiones y moderación automática.</span><button type="button">Entendido</button>`;
    a.querySelector('button').onclick = () => { LS.set('upgames_terms_v', TERMINOS_VERSION); a.remove(); };
    setTimeout(() => document.body.appendChild(a), 2500);
  }
  // Invitados: nada a pantalla completa al entrar (Google penaliza los intersticiales en
  // móvil). Una barra elegante, que no tapa nada, abre la bienvenida con "Crear cuenta".
  if (window.UG_INVITADO) {
    window.ugAbrirBienvenida = () => abrir(true);
    if (!LS.get('ug_bienv_inv')) setTimeout(() => {
      if (!window.UG_INVITADO || document.getElementById('obh-teaser')) return;
      const t = document.createElement('div'); t.id = 'obh-teaser'; t.className = 'obh-teaser'; t.setAttribute('role', 'region'); t.setAttribute('aria-label', 'Bienvenida');
      t.innerHTML = `<span class="obh-teaser-ic">✦</span><span><b>Acabas de entrar a algo que no existe en otro lugar.</b><small>Descargas, videos, lives, red social e IA que te paga, en un solo ecosistema.</small></span><button type="button" data-a="ver">Descúbrelo</button><button type="button" data-a="x" aria-label="Cerrar">✕</button>`;
      t.onclick = e => { const a = e.target.closest('button')?.dataset.a; if (!a) return; LS.set('ug_bienv_inv', '1'); t.remove(); if (a === 'ver') abrir(true); };
      document.body.appendChild(t);
    }, 3500);
    return;
  }
  // Bienvenida UNA vez por versión de los términos (antes volvía cada semana).
  // Quien ya la había aceptado antes solo ve un aviso pequeño de "términos actualizados".
  const aceptada = LS.get('upgames_terms_v');
  if (aceptada === TERMINOS_VERSION) return;
  if (aceptada || LS.getJSON('upgames_terms_seen_ts')) { avisoTerminosNuevos(); return; }
  abrir(false);

  function abrir(invitado) {
  if (abrir.listo) { document.getElementById('onboarding-modal').classList.add('show'); document.body.style.overflow = 'hidden'; return; }
  abrir.listo = true;
  const modal   = document.getElementById('onboarding-modal');
  const track   = document.getElementById('ob-track');
  const footer  = document.getElementById('ob-footer');
  const btnNext = document.getElementById('ob-btn-next');
  const btnAccept = document.getElementById('btn-accept-terms');
  const dots    = document.querySelectorAll('.ob-dot');
  const slides  = document.querySelectorAll('.ob-slide');
  const TOTAL   = slides.length;   // 3
  // Invitado: en la última pantalla, crear cuenta (los términos se aceptan al registrarse) o seguir mirando
  if (invitado) {
    modal.classList.add('modo-inv');
    btnAccept.innerHTML = '✨ Crear mi cuenta gratis';
    const salir = modal.querySelector('.ob-btn-reject');
    if (salir) { salir.textContent = 'Seguir explorando sin cuenta'; salir.onclick = () => { ugAB('saltar', 'inv'); modal.classList.remove('show'); document.body.style.overflow = ''; }; }
  }

  // Fecha real del cierre de la etapa Fundador (y si tu cuenta ya tiene la insignia)
  (async () => {
    if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));   // upgames-extras.js carga después
    const txt = document.getElementById('obh-fundador-txt'); if (!txt || !window.UGX) return;
    const m = invitado ? null : await UGX.cargarMio().catch(() => null);
    const c = m?.catalogo || await UGX.cargarCfg().catch(() => null);
    const f = c?.fundadorHasta ? new Date(c.fundadorHasta).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }) : '';
    if (m?.fundador) txt.textContent = 'Tu cuenta ya la tiene: llegaste en la etapa fundadora. No se vende y no vuelve a salir.';
    else if (f) txt.textContent = `Solo para las cuentas creadas hasta el ${f}. No se vende y no vuelve a salir.`;
  })();

  // Versión B de la prueba A/B (la A es el HTML tal cual)
  if (UG_AB === 'B') {
    const t = modal.querySelector('.obh-titulo'), sub = modal.querySelector('.obh-sub');
    if (t) t.innerHTML = 'Aquí lo que creas, juegas y transmites<br><span>te genera dinero real.</span>';
    if (sub) sub.innerHTML = 'Descargas, videos, lives, red social e IA en <b>un solo ecosistema</b>. Gratis, sin límites… <b>y cada descarga te paga.</b>';
  }
  const modoAB = invitado ? 'inv' : 'usr';
  ugAB('visto', modoAB);

  let current = 0;

  // Mostrar modal
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';

  // Activar primer slide
  slides[0].classList.add('active');
  _syncFooter(0);

  function _goTo(idx) {
    if (idx < 0 || idx >= TOTAL) return;

    // Salir slide actual
    slides[current].classList.remove('active');
    slides[current].classList.add('exit-left');
    setTimeout(() => slides[current].classList.remove('exit-left'), 400);

    current = idx;

    // Entrar slide nuevo
    slides[current].classList.add('active');
    _syncFooter(current);
  }

  function _syncFooter(idx) {
    // Dots
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));

    // Botón siguiente — en el último slide se oculta (usa los botones del slide)
    const isLast = idx === TOTAL - 1;
    footer.classList.toggle('is-last', isLast);

    // Texto del botón
    const saltar = document.getElementById('ob-saltar'); if (saltar) saltar.hidden = isLast;
    if (idx === TOTAL - 2) {
      btnNext.innerHTML = 'Ver reglas <ion-icon name="arrow-forward-outline"></ion-icon>';
    } else {
      btnNext.innerHTML = 'Siguiente <ion-icon name="arrow-forward-outline"></ion-icon>';
    }
  }

  // Dots clickeables (solo hacia adelante — UX intencional)
  dots.forEach((d, i) => {
    d.addEventListener('click', () => { if (i > current) _goTo(i); });
  });

  // Botón Siguiente / Saltar (va directo a las reglas: aceptar sigue siendo obligatorio)
  btnNext.addEventListener('click', () => _goTo(current + 1));
  document.getElementById('ob-saltar')?.addEventListener('click', () => _goTo(TOTAL - 1));

  // Swipe horizontal (touch)
  let _tx = 0;
  modal.addEventListener('touchstart', e => { _tx = e.touches[0].clientX; }, { passive: true });
  modal.addEventListener('touchend', e => {
    const diff = _tx - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0 && current < TOTAL - 1) _goTo(current + 1);
      else if (diff < 0 && current > 0)   _goTo(current - 1);
    }
  }, { passive: true });

  // Teclado
  document.addEventListener('keydown', function _kb(e) {
    if (!modal.classList.contains('show')) { document.removeEventListener('keydown', _kb); return; }
    if (e.key === 'ArrowRight' && current < TOTAL - 1) _goTo(current + 1);
    if (e.key === 'ArrowLeft'  && current > 0)         _goTo(current - 1);
  });

  // Botón Aceptar (última pantalla)
  btnAccept.addEventListener('click', () => {
    ugAB('cta', modoAB);
    if (invitado) { location.href = ugUrlLogin(true); return; }
    LS.setJSON('upgames_terms_seen_ts', Date.now());
    LS.set('upgames_terms_v', TERMINOS_VERSION);
    modal.classList.remove('show');
    document.body.style.overflow = '';
    setTimeout(() => window.UGG?.bienvenida(), 700);   // presenta la Guía de inicio (no bloquea)
  });
  }   // fin abrir()
})();

// ── NEXUS IA (nativa) ────────────────────────────────────
// Nexus vive en el backend de UpGames (/nexus/*): misma base de datos y
// servidor. Aquí solo está el chat: mensajes, tarjetas tocables y botones.
let nxOpen=false, nxExpanded=false;
const NX = { cargado:false, enviando:false, msgs:[] };   // msgs: [{rol, texto, items, acciones}]
const NX_SUGERENCIAS_INV = ['¿Qué me recomiendas descargar hoy?', '¿Cómo gano dinero publicando?', 'Mods populares para Minecraft', '¿Cómo publico mi contenido?'];
const NX_SUGERENCIAS_USR = ['Recomiéndame algo según mis gustos', '¿Cuánto llevo ganado y qué me falta para retirar?', '¿Cómo van mis publicaciones?', '¿Qué está en tendencia ahora?'];
const nxToken = () => { const t = LS.get('token'); return t && t !== 'null' && t.length > 20 ? t : ''; };
const nxHeaders = () => { const h = { 'Content-Type':'application/json' }; const t = nxToken(); if (t) h.Authorization = `Bearer ${t}`; return h; };

function nxToggle() {
  if (!nxOpen && !ugPedirSesion('usar NEXUS IA')) return;
  nxOpen=!nxOpen;
  if (nxOpen) nxCargarCuota();
  document.getElementById('nxPanel').classList.toggle('open',nxOpen);
  document.body.style.overflow = nxOpen && innerWidth < 900 ? 'hidden' : '';   // en escritorio es una ventana flotante
  document.body.classList.toggle('nx-open', nxOpen);
  if (nxOpen) { _clearNxFabBadge(); nxCargar(); setTimeout(() => { if (!matchMedia('(pointer:coarse)').matches) document.getElementById('nxInput')?.focus(); }, 300); }
}
function nxClose() {
  nxOpen=false;
  document.getElementById('nxPanel').classList.remove('open');
  document.body.style.overflow = '';
  document.body.classList.remove('nx-open');
}
function nxExpand() {
  nxExpanded=!nxExpanded;
  document.getElementById('nxPanel').classList.toggle('expanded',nxExpanded);
  const ico=document.getElementById('nxExpBtn');
  ico.innerHTML = nxExpanded
    ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 2v4H2M10 2v4h4M10 14v-4h4M6 14v-4H2"/></svg>'
    : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>';
}

// Historial: con sesión vive en el servidor (cualquier dispositivo); invitado, en este navegador
async function nxCargar() {
  if (NX.cargado) return;
  NX.cargado = true;
  if (nxToken()) {
    try {
      const r = await fetchTimeout(`${API_URL}/nexus/historial`, 8000, { headers: nxHeaders() });
      if (r.ok) NX.msgs = ((await r.json()).historial || []).slice(-24);
    } catch (_) {}
  } else NX.msgs = LS.getJSON('nx_hist_inv', []).slice(-20);
  nxPintar();
}
function nxGuardarLocal() { if (!nxToken()) LS.setJSON('nx_hist_inv', NX.msgs.slice(-20).map(m => ({ rol:m.rol, texto:m.texto, items:m.items||[], acciones:m.acciones||[] }))); }

async function nxNuevaConversacion() {
  if (NX.enviando) return;
  NX.msgs = []; nxGuardarLocal();
  if (nxToken()) fetch(`${API_URL}/nexus/historial`, { method:'DELETE', headers:nxHeaders() }).catch(()=>{});
  nxPintar();
}

// Texto de Nexus → HTML seguro (negritas, listas y saltos de línea)
function nxFormato(t) {
  const lineas = escH(t).split('\n');
  let html = '', enLista = false;
  for (const l of lineas) {
    const m = l.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (m) { if (!enLista) { html += '<ul>'; enLista = true; } html += `<li>${m[1]}</li>`; continue; }
    if (enLista) { html += '</ul>'; enLista = false; }
    html += l.trim() ? `<p>${l}</p>` : '';
  }
  if (enLista) html += '</ul>';
  return html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
}
function nxTarjetas(items) {
  if (!items?.length) return '';
  return `<div class="nx-cards">${items.map(it => {
    const img = it.imagen && !UG_VIDEO_RE.test(it.imagen) ? cldOpt(it.imagen, 'c_fill,g_auto,w_320,h_180,q_auto,f_auto') : '';
    return `<button type="button" class="nx-card" data-nx-item="${escH(it.id)}">
      <span class="nx-card-img">${img ? `<img src="${escH(img)}" alt="" loading="lazy" onerror="this.remove()">` : '<ion-icon name="cube-outline"></ion-icon>'}${it.partes > 1 ? `<span class="nx-card-pts">${escH(it.partes)} partes</span>` : ''}</span>
      <span class="nx-card-t">${escH(it.titulo)}</span>
      <span class="nx-card-m">${escH(catLabel(it.categoria))} · ${escH(it.descargas || 0)} ↓${it.autor ? ` · @${escH(it.autor)}` : ''}</span>
    </button>`; }).join('')}</div>`;
}
function nxBotones(acciones) {
  if (!acciones?.length) return '';
  return `<div class="nx-acts">${acciones.map((a, i) => `<button type="button" class="nx-act" data-nx-act="${i}">${escH(a.etiqueta || a.valor)} <ion-icon name="arrow-forward"></ion-icon></button>`).join('')}</div>`;
}
function nxPintar(pensando = false) {
  const box = document.getElementById('nxMsgs');
  if (!box) return;
  const usuario = LS.get('user_admin');
  let html = '';
  if (!NX.msgs.length) {
    const sug = nxToken() ? NX_SUGERENCIAS_USR : NX_SUGERENCIAS_INV;
    html = `<div class="nx-hola">
      <div class="nx-hola-orb"><span></span></div>
      <h3>${usuario ? `Hola, @${escH(usuario)}` : 'Hola, soy Nexus'}</h3>
      <p>Conozco todo el catálogo de UpGames${usuario ? ', tu cuenta y tus publicaciones' : ''}. Pregúntame lo que quieras.</p>
      <div class="nx-sugs">${sug.map(s => `<button type="button" class="nx-sug" data-nx-sug="${escH(s)}">${escH(s)}</button>`).join('')}</div>
    </div>`;
  }
  html += NX.msgs.map((m, i) => m.rol === 'user'
    ? `<div class="nx-msg nx-yo"><div class="nx-bub">${escH(m.texto).replace(/\n/g, '<br>')}</div></div>`
    : m.upsell ? `<div class="nx-msg nx-ia" data-nx-i="${i}"><div class="nx-bub">${escH(m.texto)}<div class="nx-upsell"><div class="nx-upsell-acc"><button type="button" class="uc" onclick="nxDesbloquear(this)">🪙 Más mensajes con UpCoins</button><button type="button" class="pr" onclick="nxIrPremium()">⭐ Premium: NEXUS ilimitado</button></div><div class="nx-upsell-pago"></div></div></div></div>`
    : `<div class="nx-msg nx-ia${m.error ? ' nx-err' : ''}" data-nx-i="${i}"><div class="nx-bub">${nxFormato(m.texto)}</div>${nxTarjetas(m.items)}${nxBotones(m.acciones)}</div>`).join('');
  if (pensando) html += '<div class="nx-msg nx-ia"><div class="nx-bub nx-typing"><i></i><i></i><i></i></div></div>';
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}

function nxContexto() {
  return {
    pestana: currentTab || 'main',
    categoria: activeCategory || null,
    busqueda: document.getElementById('buscador')?.value?.trim() || null,
    itemId: document.getElementById('detail-sheet')?.classList.contains('open') ? (_viewItemId || null) : null,
  };
}

async function nxEnviar(texto, extra) {
  texto = String(texto || '').trim().slice(0, 1500);
  if (!texto || NX.enviando) return;
  NX.enviando = true;
  window.dispatchEvent(new CustomEvent('ug:guia', { detail: 'nexus' }));
  const historialInv = nxToken() ? undefined : NX.msgs.filter(m => !m.error).slice(-10).map(m => ({ rol:m.rol, texto:m.texto }));
  NX.msgs.push({ rol:'user', texto });
  nxPintar(true);
  const input = document.getElementById('nxInput'), send = document.getElementById('nxSend');
  if (send) send.disabled = true;
  try {
    const r = await fetchTimeout(`${API_URL}/nexus/chat`, 60000, { method:'POST', headers:nxHeaders(), body: JSON.stringify({ mensaje:texto, historial:historialInv, contexto:{ ...nxContexto(), ...(extra || {}) } }) });
    const d = await r.json().catch(() => ({}));
    if (d.cuota) nxPintarCuota(d.cuota);
    if (r.status === 402 && d.code === 'IA_LIMITE') { NX.msgs.pop(); NX.msgs.push({ rol:'assistant', upsell:true, texto:d.error }); return; }
    if (!r.ok || !d.ok) throw new Error(d.error || 'Nexus no pudo responder ahora.');
    NX.msgs.push({ rol:'assistant', texto:d.texto, items:d.items || [], acciones:d.acciones || [] });
  } catch (e) {
    NX.msgs.push({ rol:'assistant', error:true, texto: e.name === 'AbortError' ? 'Tardé demasiado en responder. Inténtalo otra vez.' : (e.message || 'Sin conexión. Inténtalo otra vez.') });
  } finally {
    NX.enviando = false;
    if (send) send.disabled = false;
    nxGuardarLocal();
    nxPintar();
    if (!nxOpen) _showNxFabBadge();
  }
}

// ── Cuota de NEXUS: mensajes gratis del día, créditos y Premium ──
function nxPintarCuota(c) {
  const el = document.getElementById('nxCuota'); if (!el || !c) return;
  el.hidden = false; el.classList.toggle('prem', !!c.premium);
  el.innerHTML = c.premium ? '<span>⭐ <b>Premium</b>: NEXUS ilimitado con el modelo más potente</span>'
    : `<span><b>${c.restantesHoy}</b> de ${c.gratisDia} mensajes gratis hoy${c.creditos ? ` · <b>${c.creditos}</b> extra` : ''}</span><button type="button" onclick="nxIrPremium()">Ilimitado</button>`;
}
function nxCargarCuota() {
  if (!nxToken()) return;
  fetch(`${API_URL}/nexus/cuota`, { headers: nxHeaders() }).then(r => r.ok ? r.json() : null).then(d => d?.ok && nxPintarCuota(d)).catch(() => {});
}
async function nxDesbloquear(btn) {
  const caja = btn.closest('.nx-upsell')?.querySelector('.nx-upsell-pago'); if (!caja) return;
  caja.innerHTML = '<div class="eco-spin"><ion-icon name="sync-outline"></ion-icon></div>';
  try { await ugPagosListo(); window.UGPagos.creditosIA(caja, { alComprar: () => { nxCargarCuota(); ugContadorUC(); } }); }
  catch (_) { caja.innerHTML = '<p style="font-size:.8rem">No se pudo cargar. Inténtalo de nuevo.</p>'; }
}
function nxIrPremium() { nxClose(); switchTab('economia'); setTimeout(() => ecoCargarPlan(true), 300); }

async function nexusAbrirItem(itemId) {
  let item = todosLosItems.find(i => i._id === itemId);
  if (!item) {
    try {
      const r = await fetchTimeout(`${API_URL}/items/${encodeURIComponent(itemId)}`, 8000);
      if (r.ok) item = await r.json();
    } catch(_) {}
  }
  if (!item || !item._id) { toast('No pude abrir ese contenido'); return; }
  nxClose();
  window.openDetail(item);
}
function nxEjecutar(a) {
  if (!a) return;
  nxClose();
  if (a.tipo === 'filtrar_categoria') {
    if (currentTab !== 'main') switchTab('main');
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.cat === a.valor));
    activeCategory = a.valor;
    const b = document.getElementById('buscador'); if (b) b.value = '';
    filteredItems = todosLosItems.filter(i => i.category === a.valor);
    render(filteredItems);
    nexusTrack('category', { categoria: a.valor });
  } else if (a.tipo === 'ir_a') {
    if (['main', 'favs', 'economia', 'profile'].includes(a.valor)) switchTab(a.valor);
  } else if (a.tipo === 'buscar') {
    if (currentTab !== 'main') switchTab('main');
    const b = document.getElementById('buscador');
    if (b) { b.value = a.valor; b.dispatchEvent(new Event('input', { bubbles:true })); }
  }
}

(function nxInitUI() {
  const panel = document.getElementById('nxPanel'), box = document.getElementById('nxMsgs');
  const form = document.getElementById('nxForm'), input = document.getElementById('nxInput');
  if (!panel || !box || !form || !input) return;
  form.addEventListener('submit', e => { e.preventDefault(); const t = input.value; input.value = ''; input.style.height = ''; nxEnviar(t); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = ''; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
  box.addEventListener('click', e => {
    const sug = e.target.closest('[data-nx-sug]'); if (sug) return nxEnviar(sug.dataset.nxSug);
    const card = e.target.closest('[data-nx-item]'); if (card) return nexusAbrirItem(card.dataset.nxItem);
    const act = e.target.closest('[data-nx-act]');
    if (act) { const m = NX.msgs[+act.closest('[data-nx-i]')?.dataset.nxI]; return nxEjecutar(m?.acciones?.[+act.dataset.nxAct]); }
  });
  // Tocar fuera de la hoja (zona oscurecida) la cierra
  panel.addEventListener('click', e => { if (e.target === panel && !nxExpanded && e.clientY < panel.getBoundingClientRect().top) nxClose(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && nxOpen) nxClose(); });
})();

// Abre Nexus y le hace una pregunta en nombre del usuario (botones "Pregúntale a Nexus")
async function nexusPreguntar(texto) {
  if (!ugPedirSesion('preguntarle a NEXUS IA')) return;
  const itemId = document.getElementById('detail-sheet')?.classList.contains('open') ? _viewItemId : null;
  if (typeof closeDetail === 'function' && document.getElementById('detail-sheet')?.classList.contains('open')) { try { closeDetail(); } catch (_) {} }
  if (!nxOpen) nxToggle();
  await nxCargar();
  nxEnviar(texto, itemId ? { itemId } : null);
}
window.nexusPreguntar = nexusPreguntar;

// Punto verde en el botón de Nexus cuando responde con el panel cerrado
let _nxFabBadgeEl = null;
function _showNxFabBadge() {
  const fab = document.querySelector('.nav-nexus') || document.getElementById('nxFab');
  if (!fab || _nxFabBadgeEl) return;
  _nxFabBadgeEl = document.createElement('span');
  _nxFabBadgeEl.className = 'nx-fab-badge';
  fab.style.position = 'relative';
  fab.appendChild(_nxFabBadgeEl);
}
function _clearNxFabBadge() { if (_nxFabBadgeEl) { _nxFabBadgeEl.remove(); _nxFabBadgeEl = null; } }
document.querySelectorAll('.nav-nexus, #nxFab').forEach(b => b.addEventListener('click', _clearNxFabBadge));

// ── TUTORIAL ─────────────────────────────────────────────
// Cada paso puede tener:
//   sel      → selector CSS del elemento a destacar
//   title    → título del tooltip
//   body     → explicación detallada
//   onEnter  → función que se ejecuta al llegar a este paso
//   onExit   → función que se ejecuta al salir de este paso
//   scrollEl → selector del contenedor a hacer scroll (para elementos dentro del sheet)

// Recorrido rápido (opcional, desde Ayuda → "Recorrido de 1 min"). Antes eran 54 pasos que
// arrancaban solos y bloqueaban la pantalla; lo demás se aprende con la Guía de inicio y
// pistas puntuales (upgames-guia.js).
const TUT_STEPS = [
  { sel: '#buscador', title: '🔍 Busca lo que quieras', body: 'Escribe el nombre de un juego, mod, app o creador: los resultados aparecen mientras escribes.' },
  { sel: '#category-row', title: '🏷️ Filtra por categoría', body: 'Juegos, ROMs, mods, apps, software y videos. Desliza para ver más.' },
  { sel: '.game-tile', title: '📦 Abre una publicación', body: 'Toca una tarjeta para ver su detalle: portada, descripción, comentarios y el botón para <strong>descargar</strong>.' },
  { sel: '#hdr-uc, #hdr-entrar', title: '🪙 Tus UpCoins', body: 'La moneda de UpGames. Tócala para recargar y úsala en lives, NEXUS, Premium y el estilo de tu perfil. Si aún no tienes cuenta, aquí entras.' },
  { sel: '#hdr-orb', title: '✨ Menú rápido', body: 'Avisos, lives, subir contenido, Premium y soporte, desplegados en círculo.' },
  { sel: '#bottom-nav', title: '🧭 Navegación', body: '<strong>Explorar</strong>, <strong>Favoritos</strong>, <strong>NEXUS</strong> (tu asistente de IA), <strong>Economía</strong> (ganancias, misiones y UpCoins) y tu <strong>Perfil</strong> (publicar y ajustes).' },
  { sel: '#tut-fab', title: '❔ Ayuda y guía de inicio', body: 'Aquí tienes tu lista de primeros pasos, guías cortas con buscador y acceso a NEXUS y soporte. ¡Listo! 🚀' },
];

let tutIdx=0, tutActive=false, tutLastEl=null;

function startTutorial() {
  tutIdx=0;
  tutActive=true;
  if(nxOpen) nxToggle();
  closeDetail();
  switchTab('main'); // siempre empieza en main
  document.getElementById('btut-lock').classList.add('on');
  document.getElementById('btut-lock').classList.remove('dim');
  document.getElementById('btut-tooltip').style.display='flex';
  document.body.style.overflow='hidden';
  renderTut();
}

function finishTutorial() {
  tutActive=false;
  const lock = document.getElementById('btut-lock');
  lock.classList.remove('on','dim');
  document.getElementById('btut-spotlight').style.display='none';
  document.getElementById('btut-tooltip').style.display='none';
  document.body.style.overflow='';
  clearPulse();
  if(nxOpen) nxToggle();
  closeDetail();
  switchTab('main');
  LS.set('upgames_onboarding_done','1');
}

function renderTut() {
  const s    = TUT_STEPS[tutIdx];
  const lock = document.getElementById('btut-lock');
  const sp   = document.getElementById('btut-spotlight');
  const tip  = document.getElementById('btut-tooltip');

  // Ejecutar onEnter si existe
  if(s.onEnter) s.onEnter();

  // Contenido del tooltip
  document.getElementById('btut-badge').textContent     = `Paso ${tutIdx+1} de ${TUT_STEPS.length}`;
  document.getElementById('btut-title').textContent     = s.title;
  document.getElementById('btut-body').innerHTML        = s.body;
  document.getElementById('btut-next').textContent      = tutIdx === TUT_STEPS.length-1 ? '¡Listo! ✓' : 'Siguiente →';
  document.getElementById('btut-prev').style.visibility = tutIdx === 0 ? 'hidden' : 'visible';

  // Dots (máximo 20 visibles para no desbordar)
  const dotsEl = document.getElementById('btut-dots');
  dotsEl.innerHTML = '';
  const total = TUT_STEPS.length;
  const maxDots = 20;
  if(total <= maxDots) {
    TUT_STEPS.forEach((_,i) => {
      const d = document.createElement('span');
      d.className = 'btut-dot' + (i===tutIdx ? ' on' : '');
      dotsEl.appendChild(d);
    });
  } else {
    // Solo mostrar rango alrededor del actual
    const half = Math.floor(maxDots/2);
    let start = Math.max(0, tutIdx - half);
    let end   = Math.min(total-1, start + maxDots - 1);
    start = Math.max(0, end - maxDots + 1);
    for(let i=start; i<=end; i++){
      const d = document.createElement('span');
      d.className = 'btut-dot' + (i===tutIdx ? ' on' : '');
      dotsEl.appendChild(d);
    }
  }

  clearPulse();
  sp.style.display='none';

  // Delay: si hay onEnter (cambio de tab/sheet) esperamos más
  const delay = s.onEnter ? 900 : 50;

  // Intentar spotlight con reintentos si el elemento no está visible aún
  function trySpot(attempts) {
    if(!tutActive) return;
    const el = s.sel ? document.querySelector(s.sel) : null;
    if(el) {
      const r = el.getBoundingClientRect();
      // Si el elemento no tiene dimensiones aún, reintentamos
      if((r.width === 0 || r.height === 0) && attempts > 0) {
        setTimeout(() => trySpot(attempts-1), 200);
        return;
      }
      lock.classList.remove('dim');
      // Scroll para que sea visible
      try { el.scrollIntoView({behavior:'smooth', block:'center'}); } catch(_){}
      setTimeout(() => {
        if(!tutActive) return;
        const r2 = el.getBoundingClientRect();
        const PAD = 10;
        sp.style.top    = (r2.top    - PAD) + 'px';
        sp.style.left   = (r2.left   - PAD) + 'px';
        sp.style.width  = (r2.width  + PAD*2) + 'px';
        sp.style.height = (r2.height + PAD*2) + 'px';
        sp.style.display = 'block';
        el.classList.add('btut-pulse');
        tutLastEl = el;
        // Tooltip arriba si elemento está en mitad inferior de pantalla
        if(r2.top > window.innerHeight * 0.45) {
          tip.classList.add('at-top');
        } else {
          tip.classList.remove('at-top');
        }
      }, 300);
    } else {
      // Sin selector: fondo oscuro, tooltip centrado abajo
      sp.style.display='none';
      lock.classList.add('dim');
      tip.classList.remove('at-top');
    }
  }

  setTimeout(() => trySpot(5), delay);

  // Animación de entrada del tooltip
  tip.classList.remove('btut-in');
  void tip.offsetWidth;
  tip.classList.add('btut-in');
}

function clearPulse() {
  if(tutLastEl) { tutLastEl.classList.remove('btut-pulse'); tutLastEl=null; }
}

document.getElementById('btut-next').addEventListener('click', () => {
  if(tutIdx < TUT_STEPS.length-1) { tutIdx++; renderTut(); }
  else finishTutorial();
});
document.getElementById('btut-prev').addEventListener('click', () => {
  if(tutIdx > 0) { tutIdx--; renderTut(); }
});
document.getElementById('btut-close').addEventListener('click', finishTutorial);

// ── Enlace directo a Ajustes del perfil: biblioteca.html?ajustes=portada ──
(function abrirPestanaDesdeURL() {
  // Acceso directo de la app instalada: biblioteca.html?tab=perfil
  const t = new URLSearchParams(location.search).get('tab');
  if (t === 'perfil' && LS.get('token')) setTimeout(() => switchTab('profile'), 300);
})();
(function abrirAjustesDesdeURL() {
  const tab = new URLSearchParams(location.search).get('ajustes');
  if (!tab || !/^[a-z]+$/.test(tab) || !LS.get('token')) return;
  const go = () => {
    switchTab('profile');
    setTimeout(() => pfOpenSettings(tab), 400);
    // Limpiar el parámetro para que recargar no vuelva a abrir el modal
    try { history.replaceState(null, '', location.pathname); } catch(_) {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(go, 300));
  else setTimeout(go, 300);
})();

// ── INIT ─────────────────────────────────────────────────
window.startBibliotecaTutorial = startTutorial;
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', loadContent);
} else { loadContent(); }

// ══════════════════════════════════════════════════════════════════
//  NEXUS APRENDE TUS GUSTOS
//  Lo que miras y las categorías que filtras llegan a /nexus/evento (los
//  favoritos, búsquedas y descargas los registra el servidor). Con eso
//  Nexus personaliza sus recomendaciones y el orden del inicio.
// ══════════════════════════════════════════════════════════════════

function nexusTrack(tipo, datos = {}) {
  const t = nxToken();
  if (!t) return; // sin sesión no hay perfil que construir
  fetch(`${API_URL}/nexus/evento`, { method:'POST', headers:nxHeaders(), body: JSON.stringify({ tipo, ...datos }) }).catch(() => {});
}

// Apertura de detalle → vista (solo si se queda más de 3 s mirando)
const _openDetailOriginal = window.openDetail || openDetail;
let _viewItemId = null, _viewTimer = null;
window.openDetail = function(item) {
  _openDetailOriginal(item);
  _viewItemId = item?._id || null;
  clearTimeout(_viewTimer);
  if (_viewItemId) { const id = _viewItemId; _viewTimer = setTimeout(() => { if (_viewItemId === id) {
    nexusTrack('view', { itemId:id });
    // Vista para las estadísticas del creador (1 por persona y día; el servidor ignora al autor)
    const tk = LS.get('token');
    fetch(`${API_URL}/items/${encodeURIComponent(id)}/vista`, { method: 'POST', keepalive: true, headers: tk ? { Authorization: `Bearer ${tk}` } : {} }).catch(() => {});
  } }, 3000); }
};
const _closeDetailOriginal = window.closeDetail || closeDetail;
window.closeDetail = function() {
  _closeDetailOriginal();
  clearTimeout(_viewTimer);
  _viewItemId = null;
};

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', function() {
    const cat = this.dataset.cat;
    if (cat) nexusTrack('category', { categoria: cat });
  });
});

// Reordena el inicio según los gustos aprendidos (los 3 primeros se quedan fijos)
async function nexusCargarPerfil() {
  if (!nxToken()) return;
  try {
    const r = await fetchTimeout(`${API_URL}/nexus/perfil`, 8000, { headers: nxHeaders() });
    if (!r.ok) return;
    const perfil = await r.json();
    if (perfil?.categorias?.length) nexusAplicarPerfil(perfil);
  } catch(_) {}
}

function nexusAplicarPerfil(perfil) {
  if (!perfil?.categorias?.length || !todosLosItems.length) return;
  const maxCat = perfil.categorias[0].peso || 1, maxTag = perfil.tags?.[0]?.peso || 1;
  const pesoCat = {}, pesoTag = {};
  perfil.categorias.forEach(c => { pesoCat[c.nombre] = (c.peso / maxCat) * 10; });
  (perfil.tags || []).forEach(t => { pesoTag[t.tag] = (t.peso / maxTag) * 5; });
  const recientes = new Set(perfil.recientes || []);
  const TOP_FIJOS = 3;
  const fijos = todosLosItems.slice(0, TOP_FIJOS);
  const resto = todosLosItems.slice(TOP_FIJOS).map(item => ({
    item,
    score: (item.scoreRecomendacion || 0) + (pesoCat[item.category] || 0)
      + (item.tags || []).reduce((acc, t) => acc + (pesoTag[String(t).toLowerCase()] || 0), 0)
      - (recientes.has(item._id) ? 3 : 0),
  })).sort((a, b) => b.score - a.score).map(x => x.item);
  todosLosItems = [...fijos, ...resto];
  const query = document.getElementById('buscador')?.value?.trim() || '';
  if (currentTab === 'main' && !query) {
    filteredItems = activeCategory ? todosLosItems.filter(i => i.category === activeCategory) : todosLosItems.filter(i => i.category !== 'Video');
    render(filteredItems);
  }
}
setTimeout(nexusCargarPerfil, 2000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  AUTOPLAY — SIGUIENTE VIDEO (punto 6)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _autoplayTimer = null;

/**
 * Obtiene hasta 3 videos relacionados (misma categoría Video, excluyendo el actual)
 */
function getRelatedVideos(currentItem, count=3) {
  return todosLosItems
    .filter(i => i.category === 'Video' && i._id !== currentItem._id)
    .sort((a,b) => (b.likesCount||0) - (a.likesCount||0))
    .slice(0, count);
}

/**
 * Adjunta listener al video MP4 inyectado para disparar autoplay al terminar
 */
function attachAutoplayListener(item) {
  const injVid = document.getElementById('ds-injected-vid');
  if(!injVid) return;
  injVid.addEventListener('ended', () => { triggerAutoplay(item); }, { once: true });
}

/**
 * Muestra el panel de autoplay con countdown de 5s
 */
function triggerAutoplay(currentItem) {
  const sheetMedia = document.querySelector('.sheet-media');
  if(!sheetMedia) return;

  const related = getRelatedVideos(currentItem, 3);
  if(!related.length) return;

  const nextItem = related[0];
  let countdown = 5;

  // Crear panel
  const panel = document.createElement('div');
  panel.id = 'autoplay-panel';
  panel.innerHTML = `
    <div class="autoplay-label">A CONTINUACIÓN</div>
    <div class="autoplay-next-title">${escH(nextItem.title)}</div>
    <div class="autoplay-related">
      ${related.map((v,i) => {
        const thumb = v.image || window.UG_PH;
        return `<div class="autoplay-rel-thumb" data-id="${v._id}">
          <img src="${escH(thumb)}" alt="${escH(v.title)}" onerror="this.onerror=null;this.src=window.UG_PH">
          <span>${escH(v.title)}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="autoplay-countdown" id="ap-countdown">${countdown}</div>
    <div class="autoplay-actions">
      <button class="autoplay-btn autoplay-btn--play" id="ap-btn-play">▶ Ver ahora</button>
      <button class="autoplay-btn autoplay-btn--cancel" id="ap-btn-cancel">Cancelar</button>
    </div>
  `;
  sheetMedia.appendChild(panel);
  // forzar reflow para que la transición funcione
  panel.offsetHeight;
  panel.classList.add('show');

  // Clicks en miniaturas relacionadas
  panel.querySelectorAll('.autoplay-rel-thumb').forEach(th => {
    th.onclick = () => {
      if(_autoplayTimer){ clearTimeout(_autoplayTimer); _autoplayTimer=null; }
      panel.remove();
      const v = todosLosItems.find(i => i._id === th.dataset.id);
      if(v) openDetail(v);
    };
  });

  // Botón "Ver ahora"
  document.getElementById('ap-btn-play').onclick = () => {
    if(_autoplayTimer){ clearTimeout(_autoplayTimer); _autoplayTimer=null; }
    panel.remove();
    openDetail(nextItem);
  };

  // Botón cancelar
  document.getElementById('ap-btn-cancel').onclick = () => {
    if(_autoplayTimer){ clearTimeout(_autoplayTimer); _autoplayTimer=null; }
    panel.classList.remove('show');
    setTimeout(() => panel.remove(), 350);
  };

  // Countdown automático
  _autoplayTimer = setInterval(() => {
    countdown--;
    const cdEl = document.getElementById('ap-countdown');
    if(cdEl) cdEl.textContent = countdown;
    if(countdown <= 0) {
      clearInterval(_autoplayTimer); _autoplayTimer = null;
      panel.remove();
      openDetail(nextItem);
    }
  }, 1000);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MODO TEATRO (punto 12)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Crear el overlay de teatro en el DOM (una sola vez)
(function initTheaterOverlay() {
  if(document.getElementById('theater-overlay')) return;
  const ov = document.createElement('div');
  ov.id = 'theater-overlay';
  ov.innerHTML = `
    <div id="theater-player-wrap"></div>
    <div id="theater-info">
      <div id="theater-title"></div>
      <div id="theater-meta"></div>
    </div>
    <button id="theater-close" aria-label="Cerrar modo teatro">
      <ion-icon name="close"></ion-icon>
    </button>
  `;
  document.body.appendChild(ov);
  document.getElementById('theater-close').onclick = closeTheater;
  ov.addEventListener('keydown', e => { if(e.key==='Escape') closeTheater(); });
})();

function openTheater(item) {
  if(!item) return;
  const ov = document.getElementById('theater-overlay');
  const wrap = document.getElementById('theater-player-wrap');
  const titleEl = document.getElementById('theater-title');
  const metaEl  = document.getElementById('theater-meta');
  if(!ov || !wrap) return;

  // Limpiar player anterior
  wrap.innerHTML = '';

  const isYT2  = isYouTubeUrl(item.link);
  const isMp42 = ugEsVideoArchivo(item.link);

  if(isYT2) {
    const ytId = getYouTubeId(item.link);
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${ytId}?autoplay=1&controls=1&rel=0&playsinline=1`;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    wrap.appendChild(iframe);
  } else if(isMp42) {
    const nv = document.createElement('video');
    nv.src = ugVideoSrc(item.link);
    if (ugVideoThumb(item.link)) nv.poster = ugVideoThumb(item.link);
    nv.controls = true;
    nv.autoplay = true;
    nv.playsInline = true;
    nv.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;';
    wrap.appendChild(nv);
    // Autoplay siguiente al terminar
    nv.addEventListener('ended', () => { triggerAutoplay(item); }, { once: true });
  }

  titleEl.textContent = item.title;
  metaEl.innerHTML = `
    <span>@${escH(item.usuario||'Cloud')}</span>
    ${item.videoType ? `<span>· ${escH(item.videoType)}</span>` : ''}
    <span>· ${fmt(item.descargasEfectivas||0)} vistas</span>
    <span>· ${fmt(item.likesCount||0)} likes</span>
  `;

  ov.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeTheater() {
  const ov = document.getElementById('theater-overlay');
  if(!ov) return;
  ov.classList.remove('open');
  document.body.style.overflow = '';
  // Detener video / iframe
  const wrap = document.getElementById('theater-player-wrap');
  if(wrap) wrap.innerHTML = '';
  if(_autoplayTimer){ clearInterval(_autoplayTimer); _autoplayTimer=null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  NOTIFICACIONES — panel Liquid Glass, isla flotante y push al móvil
//  • Panel: agrupado por día, filtros, ajustes de avisos y tarjeta para
//    activar las notificaciones del móvil.
//  • Isla: cuando llega algo con la app abierta (polling o push del service
//    worker), una "isla" flotante arriba; al tocarla te lleva al contenido.
//  • Push: Web Push con claves VAPID del servidor; llega aunque UpGames
//    esté cerrado (en iPhone, con la app instalada en la pantalla de inicio).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const UGN = { lista: [], filtro: 'todas', vistos: new Set(), inicio: Date.now(), abierto: false, ultimoConteo: null, cola: [], islaT: null };
const UGN_TIPOS = {
  nueva_publicacion: { ic: 'cloud-upload', c: '#32D583', cat: 'publicaciones' },
  favorito:   { ic: 'heart', c: '#ff5c7a', cat: 'social' },
  comentario: { ic: 'chatbubble', c: '#5AC8FA', cat: 'social' },
  seguidor:   { ic: 'person-add', c: '#a78bfa', cat: 'social' },
  logro:      { ic: 'trophy', c: '#ffd23f', cat: 'social' },
  descarga:   { ic: 'download', c: '#32D583', cat: 'social' },
};
function ugnMeta(n) {
  const t = n.itemTitle || '';
  if (n.tipo === 'sistema') {
    if (t.startsWith('Mensaje')) return { ic: 'chatbubbles', c: '#5AC8FA', cat: 'mensajes' };
    if (t === 'En vivo') return { ic: 'radio', c: '#ff4d6d', cat: 'social' };
    if (t === 'Verifica tu email') return { ic: 'mail-unread', c: '#ffcc4d', cat: 'anuncios' };
    if (t === 'Tu pase vence' || t === 'Tu Premium vence') return { ic: 'star', c: '#5AC8FA', cat: 'anuncios' };
    if (t === 'Anuncio') return { ic: 'megaphone', c: '#32D583', cat: 'anuncios' };
    if (t === 'Revisión') return { ic: 'shield-checkmark', c: '#ff8a8d', cat: 'anuncios' };
    if (t === 'Equipo') return { ic: 'shield-half', c: '#a78bfa', cat: 'anuncios' };
    return { ic: 'notifications', c: '#8f98a8', cat: 'anuncios' };
  }
  return UGN_TIPOS[n.tipo] || { ic: 'notifications', c: '#8f98a8', cat: 'anuncios' };
}
// Texto plano de una notificación (los mensajes del servidor llegan con HTML escapado)
const ugnPlano = s => { const d = document.createElement('textarea'); d.innerHTML = String(s || '').replace(/<[^>]*>/g, ''); return d.value; };
function ugnTexto(n) {
  if (n._push) return { quien: n._push.title || 'UpGames', accion: '', sub: n._push.body || '', anuncio: true };
  const e = n.emisor ? '@' + n.emisor : 'UpGames', t = n.itemTitle || '', msg = ugnPlano(n.mensaje);
  switch (n.tipo) {
    case 'nueva_publicacion': return { quien: e, accion: 'publicó algo nuevo', sub: t };
    case 'favorito':   return { quien: e, accion: 'guardó tu publicación', sub: t };
    case 'comentario': return { quien: e, accion: 'comentó tu publicación', sub: msg || t };
    case 'seguidor':   return { quien: e, accion: 'empezó a seguirte', sub: 'Toca para ver su perfil' };
    case 'logro':      return { quien: '🏆', accion: msg || '¡Nuevo logro desbloqueado!', sub: t };
    case 'descarga':   return { quien: e, accion: 'descargó tu contenido', sub: t };
  }
  if (t.startsWith('Mensaje')) return { quien: e, accion: 'te envió un mensaje', sub: 'Toca para responder' };
  if (t === 'En vivo') return { quien: e, accion: 'está en vivo 🔴', sub: msg || 'Toca para verlo' };
  if (t === 'Verifica tu email') return { quien: 'Verifica tu email', accion: '', sub: msg.replace(/^📧\s*/, '') };
  if (t === 'Tu pase vence' || t === 'Tu Premium vence') return { quien: 'Tu Premium vence pronto', accion: '', sub: msg.replace(/^⏳\s*/, '') };
  if (t === 'Anuncio') return { quien: 'UpGames', accion: '', sub: msg.replace(/^📢\s*/, ''), anuncio: true };
  if (t === 'Revisión') return { quien: 'Revisión', accion: '', sub: msg, anuncio: true };
  if (t === 'Equipo') return { quien: 'Equipo UpGames', accion: '', sub: msg, anuncio: true };
  return { quien: e, accion: msg || 'Notificación', sub: t };
}
function ugnAvatar(n, meta) {
  const sistema = !n.emisor || n.emisor === 'UpGames' || ugnTexto(n).anuncio;
  const letra = sistema ? '' : escH((n.emisor[0] || '?').toUpperCase());
  let h = 0; for (const ch of n.emisor || 'u') h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<div class="ugn-av" style="${sistema ? '' : `background:linear-gradient(135deg,hsl(${h} 70% 55%),hsl(${(h + 50) % 360} 75% 45%))`}">
      ${sistema ? '<img src="./icons/icon-96.png?v=2" alt="">' : letra}
      <span class="ugn-av-ic" style="background:${meta.c}"><ion-icon name="${meta.ic}"></ion-icon></span></div>`;
}
const ugnAuth = () => ({ Authorization: `Bearer ${LS.get('token')}` });

// ── Botón de campana + panel ─────────────────────────
function _initNotifUI() {
  const hdrActions = document.querySelector('.hdr-actions');
  const radial = document.querySelector('#hdr-radial .ugr-items');   // la campana vive en el menú radial
  if ((!hdrActions && !radial) || document.getElementById('notif-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'notif-btn'; btn.type = 'button'; btn.title = 'Notificaciones'; btn.setAttribute('aria-label', 'Notificaciones');
  if (radial) {
    btn.className = 'ugr-item'; btn.setAttribute('role', 'menuitem');
    btn.innerHTML = '<span class="ugr-bub"><ion-icon name="notifications-outline"></ion-icon><span id="notif-badge" class="ugn-badge" hidden>0</span></span><span class="ugr-lbl">Avisos</span>';
    btn.onclick = e => { e.stopPropagation(); UGR.cerrar(); ugnToggle(); };
    radial.insertBefore(btn, radial.firstChild);
    if (UGR.abierto) UGR.colocar();   // si el menú ya estaba abierto, reacomoda el abanico
  } else {
    btn.className = 'hdr-btn';
    btn.innerHTML = '<ion-icon name="notifications-outline"></ion-icon><span id="notif-badge" class="ugn-badge" hidden>0</span>';
    btn.onclick = e => { e.stopPropagation(); ugnToggle(); };
    hdrActions.insertBefore(btn, hdrActions.firstChild);
  }

  const panel = document.createElement('div');
  panel.id = 'ugn-panel'; panel.className = 'ugn-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Notificaciones');
  panel.innerHTML = `
    <div class="ugn-head">
      <div><h3>Notificaciones</h3><span id="ugn-sub">Al día</span></div>
      <div class="ugn-head-acts">
        <button class="ugn-ib" onclick="ugnMarcarTodas()" title="Marcar todas como leídas"><ion-icon name="checkmark-done"></ion-icon></button>
        <button class="ugn-ib" onclick="ugnAjustes(true)" title="Ajustes de avisos"><ion-icon name="settings-outline"></ion-icon></button>
        <button class="ugn-ib" onclick="ugnCerrar()" title="Cerrar"><ion-icon name="close"></ion-icon></button>
      </div>
    </div>
    <div id="ugn-main">
      <div id="ugn-push"></div>
      <div class="ugn-chips" id="ugn-chips">
        <button data-f="todas" class="on">Todas</button><button data-f="noleidas">Sin leer</button>
        <button data-f="publicaciones">Publicaciones</button><button data-f="mensajes">Mensajes</button>
        <button data-f="social">Social</button><button data-f="anuncios">Anuncios</button>
      </div>
      <div class="ugn-list" id="notif-list"></div>
      <div class="ugn-foot"><button onclick="ugnVaciar()"><ion-icon name="trash-outline"></ion-icon> Vaciar todo</button></div>
    </div>
    <div id="ugn-settings" hidden></div>`;
  document.body.appendChild(panel);
  const scrim = document.createElement('div'); scrim.id = 'ugn-scrim'; scrim.className = 'ugn-scrim'; scrim.onclick = ugnCerrar;
  document.body.appendChild(scrim);
  panel.querySelector('#ugn-chips').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    UGN.filtro = b.dataset.f; panel.querySelectorAll('#ugn-chips button').forEach(x => x.classList.toggle('on', x === b)); ugnPintar();
  });
  panel.querySelector('#notif-list').addEventListener('click', e => {
    const del = e.target.closest('[data-del]'); if (del) { e.stopPropagation(); return ugnEliminar(del.dataset.del); }
    const row = e.target.closest('[data-id]'); if (row) ugnAbrir(UGN.lista.find(n => n._id === row.dataset.id));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && UGN.abierto) ugnCerrar(); });
}
function ugnToggle() { UGN.abierto ? ugnCerrar() : ugnAbrirPanel(); }
function ugnAbrirPanel() {
  const p = document.getElementById('ugn-panel'); if (!p) return;
  UGN.abierto = true; ugnAjustes(false);
  p.classList.add('open'); document.getElementById('ugn-scrim')?.classList.add('open');
  ugnPintarPush(); _cargarNotificaciones();
}
function ugnCerrar() {
  UGN.abierto = false;
  document.getElementById('ugn-panel')?.classList.remove('open'); document.getElementById('ugn-scrim')?.classList.remove('open');
}
const _toggleNotifPanel = ugnToggle;   // compatibilidad

async function _cargarNotificaciones() {
  const usuario = LS.get('user_admin'), token = LS.get('token');
  if (!usuario || !token) return;
  const list = document.getElementById('notif-list');
  if (list && !UGN.lista.length) list.innerHTML = '<div class="ugn-skel"></div><div class="ugn-skel"></div><div class="ugn-skel"></div>';
  try {
    const r = await fetch(`${API_URL}/notificaciones/${encodeURIComponent(usuario)}`, { headers: ugnAuth() });
    const d = r.ok ? await r.json() : null;
    if (!d?.success) return;
    UGN.lista = d.notificaciones || [];
    _updateNotifBadge(d.noLeidas || 0);
    ugnPintar();
    return UGN.lista;
  } catch (_) {}
}
function ugnPintar() {
  const list = document.getElementById('notif-list'); if (!list) return;
  const f = UGN.filtro;
  const items = UGN.lista.filter(n => f === 'todas' || (f === 'noleidas' ? !n.leida : ugnMeta(n).cat === f));
  const sinLeer = UGN.lista.filter(n => !n.leida).length;
  const sub = document.getElementById('ugn-sub'); if (sub) sub.textContent = sinLeer ? `${sinLeer} sin leer` : 'Al día';
  if (!items.length) {
    list.innerHTML = `<div class="ugn-empty"><div class="ugn-empty-ic"><ion-icon name="notifications-off-outline"></ion-icon></div>
      <b>${f === 'todas' ? 'No tienes notificaciones' : 'Nada por aquí'}</b><span>Sigue a creadores para enterarte cuando publiquen.</span></div>`;
    return;
  }
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const grupo = d => { const t = new Date(d).getTime(); return t >= hoy ? 'Hoy' : t >= hoy - 864e5 ? 'Ayer' : t >= hoy - 6 * 864e5 ? 'Esta semana' : 'Antes'; };
  let actual = '', html = '';
  for (const n of items) {
    const g = grupo(n.fecha); if (g !== actual) { actual = g; html += `<div class="ugn-group">${g}</div>`; }
    const meta = ugnMeta(n), tx = ugnTexto(n);
    const img = /^https?:\/\//.test(n.itemImage || '') && !ugEsVideoArchivo(n.itemImage) ? n.itemImage : '';
    html += `<div class="ugn-item ${n.leida ? '' : 'unread'} ${tx.anuncio ? 'anuncio' : ''}" data-id="${escH(n._id)}" role="button" tabindex="0">
      ${ugnAvatar(n, meta)}
      <div class="ugn-body">
        <div class="ugn-line"><b>${escH(tx.quien)}</b> ${escH(tx.accion)}</div>
        ${tx.sub ? `<div class="ugn-subl ${tx.anuncio ? 'full' : ''}">${escH(tx.sub)}</div>` : ''}
        <div class="ugn-time">${_timeAgo(new Date(n.fecha))}</div>
      </div>
      ${img ? `<img class="ugn-thumb" src="${escH(img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      ${n.leida ? '' : '<span class="ugn-dot"></span>'}
      <button class="ugn-del" data-del="${escH(n._id)}" title="Eliminar" aria-label="Eliminar"><ion-icon name="close"></ion-icon></button>
    </div>`;
  }
  list.innerHTML = html;
}

// ── Abrir el contenido de una notificación ───────────
async function ugnAbrir(n) {
  if (!n) return;
  if (!n.leida) {
    n.leida = true; ugnPintar(); _updateNotifBadge(UGN.lista.filter(x => !x.leida).length);
    fetch(`${API_URL}/notificaciones/leida/${n._id}`, { method: 'PUT', headers: ugnAuth() }).catch(() => {});
  }
  const t = n.itemTitle || '';
  if (n.tipo === 'sistema' && t.startsWith('Mensaje')) { location.href = `./chats.html?usuario=${encodeURIComponent(n.emisor || '')}`; return; }
  if (n.tipo === 'sistema' && t === 'Verifica tu email') { ugnCerrar(); window.ugVerifMostrar?.(); return; }
  if (n.tipo === 'sistema' && (t === 'Tu pase vence' || t === 'Tu Premium vence')) { ugnCerrar(); switchTab('economia'); setTimeout(() => ecoCargarPlan(true), 500); return; }
  if (n.tipo === 'sistema' && t === 'En vivo') { location.href = `./live.html?u=${encodeURIComponent(n.emisor || '')}`; return; }
  if (n.tipo === 'seguidor') { location.href = `./perfil-publico.html?u=${encodeURIComponent(n.emisor || '')}`; return; }
  if (t === 'Revisión') { ugnCerrar(); switchTab('profile'); return; }
  if (ugnTexto(n).anuncio) return;   // el anuncio ya se lee completo en la tarjeta
  if (n.itemId) { ugnCerrar(); _abrirItemDesdeNotif(n.itemId); }
}
async function _abrirItemDesdeNotif(itemId) {
  if (!itemId) return;
  ugnCerrar();
  if (typeof currentTab !== 'undefined' && currentTab !== 'main' && typeof switchTab === 'function') switchTab('main');
  const item = todosLosItems.find(i => i._id === itemId);
  if (item) return openDetail(item);
  try { const r = await fetch(`${API_URL}/items/${itemId}`, { headers: LS.get('token') ? ugnAuth() : {} }); if (r.ok) { const d = await r.json(); if (d && d._id) openDetail(d); else toast('Esa publicación ya no está disponible'); } } catch (_) {}
}
async function ugnMarcarTodas() {
  const usuario = LS.get('user_admin'); if (!usuario) return;
  UGN.lista.forEach(n => { n.leida = true; }); ugnPintar(); _updateNotifBadge(0);
  fetch(`${API_URL}/notificaciones/marcar-leidas/${encodeURIComponent(usuario)}`, { method: 'PUT', headers: ugnAuth() }).catch(() => {});
}
const _marcarTodasLeidas = ugnMarcarTodas;
async function ugnEliminar(id) {
  const row = document.querySelector(`#notif-list [data-id="${CSS.escape(id)}"]`);
  if (row) { row.classList.add('bye'); }
  UGN.lista = UGN.lista.filter(n => n._id !== id);
  setTimeout(ugnPintar, 220); _updateNotifBadge(UGN.lista.filter(x => !x.leida).length);
  fetch(`${API_URL}/notificaciones/${id}`, { method: 'DELETE', headers: ugnAuth() }).catch(() => {});
}
async function ugnVaciar() {
  const usuario = LS.get('user_admin'); if (!usuario || !UGN.lista.length) return;
  if (!confirm('¿Borrar todas tus notificaciones?')) return;
  UGN.lista = []; ugnPintar(); _updateNotifBadge(0);
  fetch(`${API_URL}/notificaciones/todas/${encodeURIComponent(usuario)}`, { method: 'DELETE', headers: ugnAuth() }).catch(() => {});
}

function _updateNotifBadge(count) {
  for (const id of ['notif-badge', 'hdr-orb-badge']) {   // el orbe del menú también muestra el número
    const b = document.getElementById(id);
    if (b) { b.hidden = !(count > 0); b.textContent = count > 99 ? '99+' : count; }
  }
  document.getElementById('hdr-orb')?.setAttribute('aria-label', count > 0 ? `Abrir menú rápido · ${count} notificaciones sin leer` : 'Abrir menú rápido');
  try { if ('setAppBadge' in navigator) count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge(); } catch (_) {}
}
// Conteo periódico: si sube, trae las nuevas y las muestra en la isla
async function _pollNotifBadge() {
  const usuario = LS.get('user_admin'), token = LS.get('token');
  if (!usuario || !token) return;
  try {
    const r = await fetch(`${API_URL}/notificaciones/count/${encodeURIComponent(usuario)}`, { headers: ugnAuth() });
    const d = r.ok ? await r.json() : null; if (!d?.success) return;
    const c = d.noLeidas || 0;
    _updateNotifBadge(c);
    if (UGN.ultimoConteo !== null && c > UGN.ultimoConteo) {
      const lista = await _cargarNotificaciones();
      (lista || []).filter(n => !n.leida && !UGN.vistos.has(n._id) && new Date(n.fecha).getTime() > UGN.inicio - 5000)
        .slice(0, 3).reverse().forEach(n => ugnIsla(n));
    }
    if (UGN.ultimoConteo === null) { const l = await _cargarNotificaciones(); (l || []).forEach(n => UGN.vistos.add(n._id)); }
    UGN.ultimoConteo = c;
  } catch (_) {}
}
function _timeAgo(date) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)} d`;
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

// ── Isla flotante ─────────────────────────────────────
function ugnIsla(n) {
  if (!n || UGN.vistos.has(n._id || n.id)) return;
  UGN.vistos.add(n._id || n.id);
  UGN.cola.push(n);
  if (!document.getElementById('ugn-island')?.classList.contains('show')) ugnSiguienteIsla();
}
function ugnSiguienteIsla() {
  const n = UGN.cola.shift(); if (!n) return;
  let isla = document.getElementById('ugn-island');
  if (!isla) {
    isla = document.createElement('div'); isla.id = 'ugn-island'; isla.className = 'ugn-island'; isla.setAttribute('role', 'status');
    document.body.appendChild(isla);
    let y0 = null;
    isla.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
    isla.addEventListener('touchend', e => { if (y0 !== null && e.changedTouches[0].clientY - y0 < -25) ugnOcultarIsla(); y0 = null; }, { passive: true });
  }
  const meta = ugnMeta(n), tx = ugnTexto(n);
  isla.innerHTML = `${ugnAvatar(n, meta)}
    <div class="ugn-isla-tx"><b>${escH(tx.anuncio ? tx.quien : `${tx.quien} ${tx.accion}`)}</b><span>${escH(tx.sub || 'Toca para verla')}</span></div>
    <button class="ugn-isla-x" aria-label="Cerrar"><ion-icon name="close"></ion-icon></button><i class="ugn-isla-bar"></i>`;
  isla.onclick = e => {
    if (e.target.closest('.ugn-isla-x')) return ugnOcultarIsla();
    ugnOcultarIsla();
    if (n._onClick) return n._onClick();
    const real = n._id && UGN.lista.find(x => x._id === n._id);
    if (real) return ugnAbrir(real);
    const url = n._push?.url; if (url) location.href = url;
  };
  isla.classList.remove('show'); void isla.offsetWidth; isla.classList.add('show');
  if (navigator.vibrate) try { navigator.vibrate(30); } catch (_) {}
  clearTimeout(UGN.islaT); UGN.islaT = setTimeout(ugnOcultarIsla, 5500);
}
function ugnOcultarIsla() {
  const isla = document.getElementById('ugn-island'); clearTimeout(UGN.islaT);
  if (!isla) return; isla.classList.remove('show');
  setTimeout(ugnSiguienteIsla, 450);
}

// ── Push al móvil ─────────────────────────────────────
const ugnPushSoportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const ugnEsIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const ugnInstalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function ugnClaveBytes(b64) { const p = '='.repeat((4 - b64.length % 4) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); }
async function ugnSuscribir(silencioso) {
  try {
    if (!ugnPushSoportado() || !LS.get('token')) return false;
    if (Notification.permission !== 'granted') {
      if (silencioso) return false;
      const p = await Notification.requestPermission();
      if (p !== 'granted') { ugnPintarPush(); return false; }
    }
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await (await fetch(`${API_URL}/push/clave`)).json();
    if (!publicKey) return false;
    let sub = await reg.pushManager.getSubscription();
    // Si el servidor cambió de clave, la suscripción vieja ya no sirve
    if (sub && sub.options?.applicationServerKey) {
      const actual = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (actual !== publicKey) { await sub.unsubscribe().catch(() => {}); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ugnClaveBytes(publicKey) });
    const r = await fetch(`${API_URL}/push/suscribir`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ugnAuth() }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    LS.set('ugn_push_on', r.ok ? '1' : '');
    ugnPintarPush();
    return r.ok;
  } catch (e) { console.warn('[push]', e); ugnPintarPush(); return false; }
}
async function ugnDesuscribir() {
  try {
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) { fetch(`${API_URL}/push/desuscribir`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ugnAuth() }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe(); }
  } catch (_) {}
  LS.set('ugn_push_on', ''); ugnPintarPush(); ugnAjustes(true);
}
function ugnPintarPush() {
  const box = document.getElementById('ugn-push'); if (!box) return;
  const activo = ugnPushSoportado() && Notification.permission === 'granted' && LS.get('ugn_push_on') === '1';
  if (activo) { box.innerHTML = ''; return; }
  let txt, btn = '<button class="ugn-push-btn" onclick="ugnSuscribir(false)">Activar</button>';
  if (ugnEsIOS() && !ugnInstalada()) { txt = 'En iPhone: toca <b>Compartir → Añadir a pantalla de inicio</b> y abre UpGames desde ahí para recibir avisos.'; btn = ''; }
  else if (!ugnPushSoportado()) { txt = 'Tu navegador no admite avisos push. Prueba con Chrome.'; btn = ''; }
  else if (Notification.permission === 'denied') { txt = 'Bloqueaste los avisos. Actívalos en el candado 🔒 de la barra de direcciones → Notificaciones → Permitir.'; btn = ''; }
  else txt = 'Entérate al instante cuando un creador que sigues publique, te escriban o haya novedades, aunque no estés en UpGames.';
  box.innerHTML = `<div class="ugn-push"><div class="ugn-push-ic"><ion-icon name="phone-portrait-outline"></ion-icon></div><div class="ugn-push-tx"><b>Avisos en tu móvil</b><span>${txt}</span></div>${btn}</div>`;
}
async function ugnAjustes(mostrar) {
  const main = document.getElementById('ugn-main'), set = document.getElementById('ugn-settings'); if (!main || !set) return;
  main.hidden = !!mostrar; set.hidden = !mostrar;
  if (!mostrar) return;
  set.innerHTML = '<div class="ugn-skel"></div>';
  let prefs = { publicaciones: true, mensajes: true, social: true, anuncios: true }, dispositivos = 0;
  try { const d = await (await fetch(`${API_URL}/push/prefs`, { headers: ugnAuth() })).json(); if (d.success) { prefs = d.prefs; dispositivos = d.dispositivos; } } catch (_) {}
  const activo = ugnPushSoportado() && Notification.permission === 'granted' && LS.get('ugn_push_on') === '1';
  const fila = (k, ic, t, s) => `<label class="ugn-set"><ion-icon name="${ic}"></ion-icon><span><b>${t}</b><small>${s}</small></span><input type="checkbox" data-k="${k}" ${prefs[k] !== false ? 'checked' : ''}><i class="ugn-sw"></i></label>`;
  set.innerHTML = `<button class="ugn-back" onclick="ugnAjustes(false)"><ion-icon name="chevron-back"></ion-icon> Notificaciones</button>
    <div class="ugn-set-card ${activo ? 'on' : ''}"><ion-icon name="${activo ? 'notifications' : 'notifications-off-outline'}"></ion-icon>
      <div><b>${activo ? 'Avisos activados en este dispositivo' : 'Avisos desactivados en este dispositivo'}</b><small>${dispositivos} dispositivo(s) recibiendo avisos</small></div></div>
    <div class="ugn-set-row">${activo ? '<button onclick="ugnProbar()">Enviar aviso de prueba</button><button class="ghost" onclick="ugnDesuscribir()">Desactivar aquí</button>' : '<button onclick="ugnSuscribir(false).then(()=>ugnAjustes(true))">Activar avisos aquí</button>'}</div>
    <div class="ugn-group">Qué quieres recibir en el móvil</div>
    ${fila('publicaciones', 'cloud-upload-outline', 'Nuevas publicaciones', 'Cuando un creador que sigues sube algo')}
    ${fila('mensajes', 'chatbubbles-outline', 'Mensajes', 'Mensajes privados del chat')}
    ${fila('social', 'heart-outline', 'Actividad social', 'Seguidores, me gusta, comentarios y logros')}
    ${fila('anuncios', 'megaphone-outline', 'Anuncios de UpGames', 'Novedades y actualizaciones')}
    <p class="ugn-note">Los avisos sobre la revisión de tus publicaciones siempre se envían.</p>`;
  set.querySelectorAll('input[data-k]').forEach(i => i.addEventListener('change', () =>
    fetch(`${API_URL}/push/prefs`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...ugnAuth() }, body: JSON.stringify({ [i.dataset.k]: i.checked }) }).then(() => toast('✓ Preferencias guardadas')).catch(() => {})));
}
async function ugnProbar() {
  try { const d = await (await fetch(`${API_URL}/push/prueba`, { method: 'POST', headers: ugnAuth() })).json(); toast(d.enviados ? '🔔 Aviso de prueba enviado' : 'No hay dispositivos suscritos'); } catch (_) {}
}
// Invitación suave (una vez por semana) para activar los avisos del móvil
function ugnInvitarPush() {
  if (!ugnPushSoportado() || Notification.permission !== 'default' || LS.get('ugn_push_on') === '1') return;
  if (Date.now() - parseInt(LS.get('ugn_push_ask') || '0') < 7 * 864e5) return;
  LS.set('ugn_push_ask', Date.now().toString());
  ugnIsla({ id: 'push-invite', _push: { title: 'Avisos en tu móvil', body: '🔔 ¿Te avisamos cuando tus creadores publiquen? Toca para activarlo.' }, _onClick: () => ugnSuscribir(false) });
}

// Mensajes del service worker: push recibido con la app abierta → isla
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
  if (e.data?.type !== 'UG_PUSH') return;
  const d = e.data.data || {};
  ugnIsla({ id: d.id || 'p' + Date.now(), _id: d.id || undefined, tipo: 'sistema', _push: d });
  _pollNotifBadge();
});

// Inicializar cuando el usuario esté logueado
function ugnArrancar() {
  if (!LS.get('user_admin') || !LS.get('token')) return;
  _initNotifUI(); _pollNotifBadge();
  if (!UGN.timer) UGN.timer = setInterval(() => { if (!document.hidden) _pollNotifBadge(); }, 30000);
  if (ugnPushSoportado() && Notification.permission === 'granted') ugnSuscribir(true);   // re-sincroniza la suscripción
  else setTimeout(ugnInvitarPush, 25000);
}
window.addEventListener('load', () => setTimeout(ugnArrancar, 1200));
document.addEventListener('visibilitychange', () => { if (!document.hidden && UGN.timer) _pollNotifBadge(); });
const _origSwitchTab = window.switchTab;
window.switchTab = function (tab) {
  if (typeof _origSwitchTab === 'function') _origSwitchTab(tab);
  if (tab === 'main') setTimeout(() => { if (!document.getElementById('notif-btn')) ugnArrancar(); }, 300);
};
Object.assign(window, { ugnSuscribir, ugnDesuscribir, ugnAjustes, ugnProbar, ugnMarcarTodas, ugnVaciar, ugnCerrar });

// ═══════════════════════════════════════════════════════════════
// SISTEMA DE DETECCIÓN DE JUEGOS — UpGames
// clientDetectGame() funciona sin depender de datos del servidor.
// ═══════════════════════════════════════════════════════════════

const _GAMESDB = [
  { n:'Grand Theft Auto V',         l:'https://store.steampowered.com/app/271590/',  kw:['gta v','gta5','gta 5','grand theft auto v','grand theft auto 5','gtav'] },
  { n:'GTA San Andreas',            l:'https://store.steampowered.com/app/12120/',   kw:['gta san andreas','san andreas','gtasa','gta sa'] },
  { n:'Red Dead Redemption 2',      l:'https://store.steampowered.com/app/1174180/', kw:['red dead redemption 2','rdr2','red dead 2','red dead'] },
  { n:'Dark Souls Remastered',      l:'https://store.steampowered.com/app/570940/',  kw:['dark souls','darksouls'] },
  { n:'Dark Souls II',              l:'https://store.steampowered.com/app/335300/',  kw:['dark souls 2','dark souls ii','ds2'] },
  { n:'Dark Souls III',             l:'https://store.steampowered.com/app/374320/',  kw:['dark souls 3','dark souls iii','ds3'] },
  { n:'Elden Ring',                 l:'https://store.steampowered.com/app/1245620/', kw:['elden ring','eldenring'] },
  { n:'Sekiro',                     l:'https://store.steampowered.com/app/814380/',  kw:['sekiro'] },
  { n:'NFS Most Wanted 2005',       l:'https://store.steampowered.com/app/13520/',   kw:['need for speed most wanted','nfsmw','nfs most wanted','nfs mw','most wanted 2005'] },
  { n:'NFS Underground 2',          l:'https://www.ea.com/games/need-for-speed/need-for-speed-underground-2', kw:['nfs underground 2','nfsu2','underground 2','need for speed underground'] },
  { n:'NFS Heat',                   l:'https://store.steampowered.com/app/1222680/', kw:['nfs heat','need for speed heat'] },
  { n:'NFS Unbound',                l:'https://store.steampowered.com/app/1846380/', kw:['nfs unbound','need for speed unbound'] },
  { n:'Minecraft',                  l:'https://www.minecraft.net/en-us/store/minecraft-java-bedrock-edition-pc', kw:['minecraft'] },
  { n:'pixARK',                     l:'https://store.steampowered.com/app/593380/',  kw:['pixark','pix ark'] },
  { n:'ARK Survival Evolved',       l:'https://store.steampowered.com/app/346110/',  kw:['ark survival evolved','ark survival','ark evolved'] },
  { n:'ARK Survival Ascended',      l:'https://store.steampowered.com/app/2399830/', kw:['ark survival ascended','ark ascended'] },
  { n:'Project Zomboid',            l:'https://store.steampowered.com/app/108600/',  kw:['project zomboid','zomboid','zomdroid'] },
  { n:'Terraria',                   l:'https://store.steampowered.com/app/105600/',  kw:['terraria'] },
  { n:'Stardew Valley',             l:'https://store.steampowered.com/app/413150/',  kw:['stardew valley','stardew'] },
  { n:'Valheim',                    l:'https://store.steampowered.com/app/892970/',  kw:['valheim'] },
  { n:'Rust',                       l:'https://store.steampowered.com/app/252490/',  kw:['rust survival','rust game'] },
  { n:'7 Days to Die',              l:'https://store.steampowered.com/app/251570/',  kw:['7 days to die','7dtd'] },
  { n:'Cyberpunk 2077',             l:'https://store.steampowered.com/app/1091500/', kw:['cyberpunk 2077','cyberpunk','cp2077'] },
  { n:'Skyrim',                     l:'https://store.steampowered.com/app/489830/',  kw:['skyrim','elder scrolls v','tesv'] },
  { n:'The Witcher 3',              l:'https://store.steampowered.com/app/292030/',  kw:['witcher 3','the witcher 3'] },
  { n:'Hogwarts Legacy',            l:'https://store.steampowered.com/app/990080/',  kw:['hogwarts legacy','harry potter game'] },
  { n:'Fortnite',                   l:'https://www.epicgames.com/fortnite/en-US/download', kw:['fortnite'] },
  { n:'PUBG',                       l:'https://store.steampowered.com/app/578080/',  kw:['pubg battlegrounds','pubg pc','pubg game'] },
  { n:'Valorant',                   l:'https://playvalorant.com/en-us/download/',    kw:['valorant'] },
  { n:'Counter-Strike 2',           l:'https://store.steampowered.com/app/730/',     kw:['counter-strike','cs2','csgo','cs go'] },
  { n:'Call of Duty',               l:'https://store.steampowered.com/app/2602690/', kw:['call of duty','cod warzone','warzone','modern warfare'] },
  { n:'Apex Legends',               l:'https://store.steampowered.com/app/1172470/', kw:['apex legends'] },
  { n:'Overwatch 2',                l:'https://playoverwatch.com/en-us/download/',   kw:['overwatch 2','overwatch'] },
  { n:'League of Legends',          l:'https://signup.leagueoflegends.com/en-us/signup/', kw:['league of legends'] },
  { n:'Dota 2',                     l:'https://store.steampowered.com/app/570/',     kw:['dota 2','dota2'] },
  { n:'Forza Horizon 5',            l:'https://store.steampowered.com/app/1551360/', kw:['forza horizon','fh5','forza 5'] },
  { n:'EA Sports FC',               l:'https://store.steampowered.com/app/2195250/', kw:['ea sports fc','ea fc','fifa','fc 25','fc25'] },
  { n:'BeamNG.drive',               l:'https://store.steampowered.com/app/284160/',  kw:['beamng','beam ng'] },
  { n:'Resident Evil',              l:'https://store.steampowered.com/franchise/residentevil', kw:['resident evil','re village','re4','re2','re3'] },
  { n:'Hollow Knight',              l:'https://store.steampowered.com/app/367520/',  kw:['hollow knight'] },
  { n:'Among Us',                   l:'https://store.steampowered.com/app/945360/',  kw:['among us'] },
  { n:'PUBG Mobile',                l:'https://play.google.com/store/apps/details?id=com.tencent.ig', kw:['pubg mobile'] },
  { n:'COD Mobile',                 l:'https://play.google.com/store/apps/details?id=com.activision.callofduty.shooter', kw:['cod mobile','codm','call of duty mobile'] },
  { n:'Mobile Legends',             l:'https://play.google.com/store/apps/details?id=com.mobile.legends', kw:['mobile legends','mlbb'] },
  { n:'Free Fire',                  l:'https://play.google.com/store/apps/details?id=com.dts.freefireth', kw:['free fire','freefire','garena free fire'] },
  { n:'Genshin Impact',             l:'https://genshin.hoyoverse.com/en/download',   kw:['genshin impact','genshin'] },
];

function clientDetectGame(title, description) {
  if (!title) return null;
  var text = (title + ' ' + (description || '')).toLowerCase();
  for (var i = 0; i < _GAMESDB.length; i++) {
    var g = _GAMESDB[i];
    for (var j = 0; j < g.kw.length; j++) {
      if (text.indexOf(g.kw[j]) !== -1) {
        return { gameName: g.n, purchaseLink: g.l };
      }
    }
  }
  return null;
}

function showBuyModal(itemId, gameName, purchaseLink) {
  var existing = document.getElementById('buy-modal-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'buy-modal-overlay';

  var storeName = 'Tienda Oficial';
  if (purchaseLink.indexOf('steampowered.com') !== -1) storeName = 'Steam';
  else if (purchaseLink.indexOf('epicgames.com') !== -1) storeName = 'Epic Games';
  else if (purchaseLink.indexOf('rockstargames.com') !== -1) storeName = 'Rockstar Games';
  else if (purchaseLink.indexOf('play.google.com') !== -1) storeName = 'Google Play';
  else if (purchaseLink.indexOf('playstation.com') !== -1) storeName = 'PlayStation Store';
  else if (purchaseLink.indexOf('xbox.com') !== -1) storeName = 'Xbox Store';
  else if (purchaseLink.indexOf('minecraft.net') !== -1) storeName = 'Minecraft.net';

  overlay.innerHTML =
    '<div class="buy-modal">' +
      '<button class="buy-modal-close" onclick="document.getElementById(\'buy-modal-overlay\').remove()">' +
        '<ion-icon name="close"></ion-icon>' +
      '</button>' +
      '<div class="buy-modal-header">' +
        '<div class="buy-modal-icon">🎮</div>' +
        '<h2 class="buy-modal-title">' + gameName + '</h2>' +
        '<p class="buy-modal-sub">Disponible en <strong>' + storeName + '</strong></p>' +
      '</div>' +
      '<div class="buy-modal-benefits">' +
        '<div class="buy-modal-benefit"><ion-icon name="shield-checkmark"></ion-icon> Version 100% original y segura</div>' +
        '<div class="buy-modal-benefit"><ion-icon name="headset"></ion-icon> Soporte oficial del desarrollador</div>' +
        '<div class="buy-modal-benefit"><ion-icon name="refresh-circle"></ion-icon> Actualizaciones garantizadas</div>' +
        '<div class="buy-modal-benefit"><ion-icon name="heart"></ion-icon> Apoya a los creadores del juego</div>' +
      '</div>' +
      '<div class="buy-modal-actions">' +
        '<button class="buy-modal-btn-cancel" onclick="document.getElementById(\'buy-modal-overlay\').remove()">Cancelar</button>' +
        '<button class="buy-modal-btn-go" onclick="window.open(\'' + purchaseLink + '\',\'_blank\');document.getElementById(\'buy-modal-overlay\').remove();">' +
          '<ion-icon name="cart"></ion-icon> Ir a ' + storeName +
        '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
}

// ═══════════════════════════════════════════════════════════
// PAGOS TAB — historial de retiros del creador
// ═══════════════════════════════════════════════════════════
let _pagosLoaded = false;
async function pfLoadHistorialPagos() {
  if(_pagosLoaded) return;
  _pagosLoaded = true;
  const el = document.getElementById('pf-pagos-content');
  if(!el) return;
  const token = LS.get('token');
  if(!token) { el.innerHTML = '<div class="pf-empty"><ion-icon name="lock-closed"></ion-icon><p>Inicia sesión para ver tus retiros</p></div>'; return; }
  try {
    const r = await fetch(`${PF_API}/economia/historial-pagos`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if(!d.success || !d.historial.length) {
      el.innerHTML = '<div class="pf-empty"><ion-icon name="cash-outline"></ion-icon><p>Aún no tienes solicitudes de retiro</p></div>';
      return;
    }
    const colorEstado = { completado:'#32D583', pendiente:'#ffd23f', rechazado:'#ff4d6d', procesado:'#5AC8FA' };
    el.innerHTML = `
      <div style="display:grid;gap:10px;padding:4px 0">
        ${d.historial.map(p => `
          <div style="background:#1a1a28;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:700;font-size:16px;color:#f0f0f8">$${parseFloat(p.monto).toFixed(2)} <span style="font-size:11px;color:#60607a">USD</span></div>
              <div style="font-size:11px;color:#60607a;margin-top:3px">${new Date(p.fecha).toLocaleDateString('es-ES',{year:'numeric',month:'short',day:'numeric'})}</div>
              ${(p.resumen || p.paypalEmail) ? `<div style="font-size:11px;color:#60607a">→ ${escH(p.resumen || p.paypalEmail)}</div>` : ''}
              ${p.referencia ? `<div style="font-size:11px;color:#32D583">Comprobante: ${escH(p.referencia)}</div>` : ''}
              ${p.notas ? `<div style="font-size:11px;color:#a0a0b8;margin-top:4px">${escH(p.notas)}</div>` : ''}
            </div>
            <span style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;background:rgba(0,0,0,.3);color:${colorEstado[p.estado]||'#aaa'};border:1px solid ${colorEstado[p.estado]||'#aaa'}">${(p.estado||'').toUpperCase()}</span>
          </div>`).join('')}
      </div>`;
  } catch(e) {
    el.innerHTML = '<div class="pf-empty"><ion-icon name="warning"></ion-icon><p>Error al cargar historial</p></div>';
    _pagosLoaded = false;
  }
}

// ═══════════════════════════════════════════════════════════
// LOGROS TAB — gamificación (XP, badges, level)
// ═══════════════════════════════════════════════════════════
let _logrosLoaded = false;
async function pfLoadLogros() {
  if(_logrosLoaded) return;
  _logrosLoaded = true;
  const el = document.getElementById('pf-logros-content');
  if(!el) return;
  const token = LS.get('token');
  const user  = LS.get('user_admin');
  if(!token || !user) { el.innerHTML = '<div class="pf-empty"><ion-icon name="lock-closed"></ion-icon><p>Inicia sesión para ver tus logros</p></div>'; return; }
  try {
    const r = await fetch(`${PF_API}/gamification/profile/${encodeURIComponent(user)}`, { headers: { Authorization: `Bearer ${token}` } });
    if(!r.ok) throw new Error('no-data');
    const d = await r.json();
    const g = d.gamification || d;
    const xp = g.xp || 0;
    const nivel = g.nivel || 1;
    const xpNext = nivel * 500;
    const pct = Math.min(100, Math.round((xp % xpNext) / xpNext * 100));
    const badges = g.badges || [];
    el.innerHTML = `
      <div style="display:grid;gap:16px;padding:4px 0">
        <div style="background:linear-gradient(135deg,#1a1a28,#0f0f18);border:1px solid rgba(50,213,131,.2);border-radius:14px;padding:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div>
              <div style="font-size:11px;color:#60607a;letter-spacing:.1em">NIVEL</div>
              <div style="font-size:32px;font-weight:900;color:#32D583">${nivel}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:11px;color:#60607a">XP TOTAL</div>
              <div style="font-size:20px;font-weight:700;color:#f0f0f8">${xp.toLocaleString()}</div>
            </div>
          </div>
          <div style="background:rgba(255,255,255,.06);border-radius:8px;height:8px;overflow:hidden">
            <div style="background:linear-gradient(90deg,#32D583,#5AC8FA);height:100%;width:${pct}%;border-radius:8px;transition:width .5s"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:#60607a">
            <span>${xp % xpNext} XP</span><span>${xpNext} XP para nivel ${nivel+1}</span>
          </div>
        </div>
        ${g.racha > 0 ? `
        <div class="pf-info-box" style="border-color:rgba(255,210,63,.3)">
          <ion-icon name="flame" style="color:#ffd23f;font-size:28px"></ion-icon>
          <div><h4 style="color:#ffd23f">Racha: ${g.racha} días</h4><p>¡Sigue así! Cada día de actividad suma XP extra.</p></div>
        </div>` : ''}
        ${badges.length > 0 ? `
        <div class="pf-section-title"><ion-icon name="medal"></ion-icon> BADGES DESBLOQUEADOS (${badges.length})</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px">
          ${badges.map(b => `
            <div style="background:#1a1a28;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px 8px;text-align:center" title="${b.descripcion||b.id}">
              <div style="font-size:26px">${b.emoji||'🏅'}</div>
              <div style="font-size:10px;color:#a0a0b8;margin-top:4px;word-break:break-word">${b.nombre||b.id}</div>
            </div>`).join('')}
        </div>` : '<div class="pf-empty"><ion-icon name="medal-outline"></ion-icon><p>Aún no tienes badges. ¡Sube contenido y participa!</p></div>'}
      </div>`;
  } catch(e) {
    el.innerHTML = '<div class="pf-empty"><ion-icon name="trophy-outline"></ion-icon><p>Logros no disponibles aún.</p></div>';
    _logrosLoaded = false;
  }
}

// ═══════════════════════════════════════════════════════════
// SEARCH AUTOCOMPLETE
// ═══════════════════════════════════════════════════════════
(function initAutocomplete() {
  const input = document.getElementById('buscador');
  const drop  = document.getElementById('autocomplete-dropdown');
  if(!input || !drop) return;

  let _acTimer = null;

  function closeDropdown() { drop.style.display = 'none'; drop.innerHTML = ''; }

  input.addEventListener('input', function() {
    const q = this.value.trim();
    clearTimeout(_acTimer);
    if(q.length < 2) { closeDropdown(); return; }
    _acTimer = setTimeout(async () => {
      try {
        const r = await fetch(`${API_URL}/search/autocomplete?q=${encodeURIComponent(q)}&limit=6`);
        if(!r.ok) return;
        const d = await r.json();
        const sugs = d.suggestions || d.results || d.items || [];
        if(!sugs.length) { closeDropdown(); return; }
        // Construido con DOM: los títulos vienen de usuarios (antes se insertaban como HTML → XSS)
        drop.replaceChildren(...sugs.map(s => {
          const titulo = String((s && s.title) || s || '');
          const row = document.createElement('div');
          row.className = 'ac-item';
          row.style.cssText = 'padding:10px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,.05);transition:background .15s';
          row.onmouseover = () => { row.style.background = 'rgba(50,213,131,.07)'; };
          row.onmouseout  = () => { row.style.background = ''; };
          row.onclick = () => {
            const b = document.getElementById('buscador');
            b.value = titulo; b.dispatchEvent(new Event('input'));
            drop.style.display = 'none';
          };
          const img = s && /^https:\/\//i.test(s.image || '') ? Object.assign(document.createElement('img'), { src: s.image, onerror() { this.style.display = 'none'; } }) : null;
          if (img) img.style.cssText = 'width:32px;height:32px;border-radius:6px;object-fit:cover';
          const ico = img || Object.assign(document.createElement('ion-icon'), { name: 'search-outline' });
          if (!img) ico.style.cssText = 'color:#60607a;font-size:18px';
          const txt = document.createElement('div');
          const t = document.createElement('div'); t.style.cssText = 'font-size:13px;color:#f0f0f8'; t.textContent = titulo;
          txt.appendChild(t);
          if (s && s.category) { const c = document.createElement('div'); c.style.cssText = 'font-size:10px;color:#60607a'; c.textContent = s.category; txt.appendChild(c); }
          row.append(ico, txt);
          return row;
        }));
        drop.style.display = 'block';
      } catch(_) {}
    }, 250);
  });

  document.addEventListener('click', function(e) {
    if(!drop.contains(e.target) && e.target !== input) closeDropdown();
  });

  input.addEventListener('keydown', function(e) {
    if(e.key === 'Escape') closeDropdown();
  });
})();


// ── Live: punto rojo en el header si hay alguien transmitiendo ──
(function ugLiveDot() {
  const dot = document.getElementById('hdr-live-dot');
  if (!dot) return;
  const revisar = () => {
    if (document.hidden) return;
    const tk = LS.get('token');
    fetch(`${API_URL}/live/activos`, tk ? { headers: { Authorization: `Bearer ${tk}` } } : {}).then(r => r.ok ? r.json() : null).then(d => {
      const n = d?.lives?.length || 0;
      ugPintarVivos(d?.lives || []);
      dot.hidden = !n;
      const orbLive = document.getElementById('hdr-orb-live'); if (orbLive) orbLive.hidden = !n;   // punto rojo también en el orbe
      dot.closest('button')?.setAttribute('aria-label', n ? `Transmisiones en vivo · ${n} en vivo ahora` : 'Transmisiones en vivo');
    }).catch(() => {});
  };
  setTimeout(revisar, 2500);
  setInterval(revisar, 60000);
})();
// Franja "En vivo ahora" en Explorar: los que sigues primero, después por puntaje del servidor
function ugPintarVivos(lives) {
  const box = document.getElementById('ug-vivos'); if (!box) return;
  const l = [...lives].sort((a, b) => (b.sigo - a.sigo) || (b.puntaje - a.puntaje)).slice(0, 12);
  box.hidden = !l.length; if (!l.length) { box.innerHTML = ''; return; }
  const av = x => /^https:\/\//.test(x.avatar || '') ? `style="background-image:url('${ugEsc(x.avatar)}')"` : '';
  box.innerHTML = `<div class="ug-vivos-h"><b>En vivo ahora · ${l.length}</b><a href="./live.html">Ver todos →</a></div>
    <div class="ug-vivos-l">${l.map(x => `<a class="ug-vivo${x.sigo ? ' sigo' : ''}" href="./live.html?u=${encodeURIComponent(x.creador)}">
      ${x.promocionado ? '<i>🚀</i>' : ''}<span class="av" ${av(x)}>${x.avatar ? '' : ugEsc(String(x.creador).slice(0, 1).toUpperCase())}</span>
      <b>@${ugEsc(x.creador)}</b><small>${x.sigo ? '💚 Lo sigues · ' : ''}👁 ${pfFmt(x.espectadores || 0)} · ${ugEsc(x.titulo || '')}</small></a>`).join('')}</div>`;
}


// ── Economía: tienda de UpCoins con tarjeta o PayPal (carga el procesador solo al abrirla) ──
let _ugPagosJs = null;
const ugPagosListo = () => (_ugPagosJs = _ugPagosJs || new Promise((ok, ko) => {
  if (window.UGPagos) return ok();
  const s = document.createElement('script');
  s.src = './upgames-pagos.js?v=20261028c'; s.onload = ok; s.onerror = () => { _ugPagosJs = null; ko(); };
  document.head.appendChild(s);
}));
function ecoAbrirTienda() {
  window.ecoSec?.('cobros');   // la tienda vive en la sección Cobros
  const box = document.getElementById('eco-tienda');
  if (!box) return;
  if (!LS.get('token')) { ugPedirSesion('conseguir UpCoins'); return; }
  box.innerHTML = '<div class="eco-spin"><ion-icon name="sync-outline"></ion-icon></div>';
  ugPagosListo().then(() => window.UGPagos.tienda(box, {
    alComprar: () => { pfLoadEconomia(); ugContadorUC(); },
  })).catch(() => { box.innerHTML = '<button type="button" class="eco-pay-open" onclick="ecoAbrirTienda()">Reintentar</button>'; });
}


// ── Verificación de email: aviso con reenvío (solo a quien aún no verificó) ──
(function ugVerif() {
  const box = document.getElementById('ug-verif');
  const token = LS.get('token');
  if (!box || !token) return;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const forzado = new URLSearchParams(location.search).get('verificar') === '1';
  let oculto = false; try { oculto = Date.now() - (+localStorage.getItem('ug_verif_oculto') || 0) < 864e5; } catch (_) {}
  function mostrar(email) {
    if (email) document.getElementById('ug-verif-sub').textContent = `Te enviaremos un enlace a ${email} para proteger tu cuenta y desbloquear los retiros.`;
    box.hidden = false;
    if (forzado) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  window.ugVerifMostrar = () => fetch(`${API_URL}/auth/email-estado`, { headers: H }).then(r => r.json()).then(d => { if (d.success && !d.verificado) mostrar(d.email); else if (d.verificado && forzado) toast('✅ Tu email ya está verificado'); }).catch(() => {});   // el aviso solo si vino a verificar
  if (!oculto || forzado) setTimeout(window.ugVerifMostrar, 1800);
  document.getElementById('ug-verif-x').onclick = () => { box.hidden = true; try { localStorage.setItem('ug_verif_oculto', String(Date.now())); } catch (_) {} };
  document.getElementById('ug-verif-btn').onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Enviando…';
    try {
      const d = await fetch(`${API_URL}/auth/email-reenviar`, { method: 'POST', headers: H }).then(r => r.json());
      if (d.yaVerificado) { box.hidden = true; toast('✅ Tu email ya estaba verificado'); return; }
      if (!d.success) throw new Error(d.error);
      box.classList.add('ok');
      document.getElementById('ug-verif-sub').textContent = `Listo: revisa ${d.email} (también la carpeta de spam) y toca el enlace.`;
      b.textContent = 'Enviado ✓';
      setTimeout(() => { b.disabled = false; b.textContent = 'Reenviar'; }, 120000);
    } catch (err) { toast(err.message || 'No se pudo enviar el correo'); b.disabled = false; b.textContent = 'Reintentar'; }
  };
  // Volver de verificar: avisar y ocultar
  if (new URLSearchParams(location.search).get('verif') === 'ok') { toast('✅ ¡Email verificado!'); box.hidden = true; }
})();


// ── Mi Premium (ver, renovar, cambiar, recordatorio, historial) ──
const ECO_METODO = { tarjeta_mp: 'Tarjeta', paypal: 'PayPal', saldo: 'UpCoins', monedas: 'UpCoins', upcoins: 'UpCoins', '': '—' };
async function ecoCargarPlan(desplazar) {
  const box = document.getElementById('eco-plan');
  if (!box || !LS.get('token')) return;
  try {
    await ugPagosListo();
    const d = await window.UGPagos.api('/tienda/mi-plan');
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fecha = f => new Date(f).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
    const p = d.plan;
    try { p ? localStorage.setItem('ug_pase_hasta', localStorage.getItem('user_admin') + '|' + (+new Date(p.hasta))) : localStorage.removeItem('ug_pase_hasta'); } catch (_) {}   // la página puente no carga anuncios con pase
    const concepto = h => h.tipo === 'plan' ? (d.planes.find(x => x.id === h.planId)?.nombre || 'Premium') : h.tipo === 'acceso' ? 'Acceso directo a un enlace'
      : /^ia:/.test(h.planId || '') ? 'Mensajes de NEXUS IA' : /^impulso:/.test(h.planId || '') ? 'Publicación destacada' : `${h.monedas} UpCoins`;
    const monto = h => ['monedas', 'saldo', 'upcoins'].includes(h.metodo) ? `🪙 ${h.monedas || Math.round((h.usd || 0) / 0.02)} UC` : `US$${(h.usd || 0).toFixed(2)}`;
    box.innerHTML = `
      <div class="eco-plan-h">
        <div class="eco-plan-ic">⭐</div>
        <div><b>${p ? esc(p.nombre) : 'No eres Premium'}</b><small>${p ? `Vence el ${fecha(p.hasta)} · ${p.diasRestantes} día${p.diasRestantes === 1 ? '' : 's'}` : (d.vencido ? `Tu ${esc(d.vencido.nombre || 'Premium')} venció el ${fecha(d.vencido.hasta)}` : 'Sin anuncios, NEXUS ilimitado y más visibilidad para tus publicaciones')}</small></div>
        <span class="eco-plan-estado ${p ? 'on' : 'off'}">${p ? 'ACTIVO' : 'INACTIVO'}</span>
      </div>
      ${p ? `<div class="eco-plan-bar"><i style="width:${Math.max(4, Math.min(100, p.diasRestantes / p.dias * 100))}%"></i></div>` : ''}
      ${`<ul class="eco-plan-ventajas">${(d.beneficios || []).map(x => `<li>✓ ${esc(x)}</li>`).join('')}<li>💚 Los creadores siguen cobrando por cada descarga</li></ul>`}
      <div class="eco-plan-acc">
        ${p ? `<button class="p" data-a="renovar">Renovar (+${p.dias} días)</button><button class="s" data-a="cambiar">Cambiar de plan</button>` : `<button class="p" data-a="cambiar">${d.vencido ? 'Renovar Premium' : 'Hazte Premium'}</button>`}
      </div>
      <div id="eco-plan-pago"></div>
      ${p ? `<div class="eco-plan-stats"><div><b>${d.descargasConPase30d}</b><small>Enlaces abiertos con Premium (30 días)</small></div><div><b>${d.accesosComprados}</b><small>Accesos directos comprados</small></div></div>` : ''}
      <label class="eco-plan-row"><span>Avisarme 2 días antes de que venza</span><input type="checkbox" id="eco-plan-rec" ${d.recordatorio ? 'checked' : ''}></label>
      <p class="eco-plan-nota">🔁 <b>Sin cobros automáticos:</b> nunca te cobramos sin que lo pidas. Renovar o cambiar de plan suma los días al vencimiento actual; si no renuevas, Premium simplemente vence y vuelves al modo gratuito.</p>
      ${d.historial.length ? `<details class="eco-plan-hist"><summary>Historial de compras (${d.historial.length})</summary><ul>${d.historial.map(h => `<li class="${h.estado === 'revertida' ? 'rev' : ''}"><span>${fecha(h.fecha)} · ${esc(concepto(h))} · ${esc(ECO_METODO[h.metodo] || h.metodo || '—')}</span><span>${monto(h)}</span></li>`).join('')}</ul></details>` : ''}`;
    const pago = document.getElementById('eco-plan-pago');
    const alComprar = () => { ecoCargarPlan(); pfLoadEconomia(); ugContadorUC(); };
    box.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      box.querySelectorAll('[data-a]').forEach(x => x.classList.toggle('s', x !== b));
      if (b.dataset.a === 'renovar') window.UGPagos.pagar(pago, { producto: `plan:${p.id}`, estado: d, alExito: alComprar });
      else window.UGPagos.planes(pago, { estado: d, alComprar });
      pago.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    document.getElementById('eco-plan-rec').onchange = e => window.UGPagos.api('/tienda/mi-plan/recordatorio', { method: 'PUT', body: { activo: e.target.checked } })
      .then(() => toast(e.target.checked ? 'Te avisaremos antes de que venza' : 'Recordatorio desactivado')).catch(() => toast('No se pudo guardar'));
    if (desplazar) { window.ecoSec?.('cobros'); setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }   // Mi Premium vive en Cobros
  } catch (e) {
    box.innerHTML = '<p style="font-size:.82rem;color:#A3A8B6;text-align:center">No se pudo cargar tu plan. <a href="#" onclick="ecoCargarPlan();return false" style="color:#5AC8FA">Reintentar</a></p>';
  }
}
// Enlace directo a Mi plan: biblioteca.html?plan=1 (desde el puente o el aviso de vencimiento)
if (new URLSearchParams(location.search).get('plan') === '1') {
  setTimeout(() => { try { switchTab('economia'); } catch (_) {} setTimeout(() => ecoCargarPlan(true), 600); }, 1500);
}

// ── ?q=búsqueda (buscador de Google y enlaces compartidos) ──
(function buscarDesdeURL() {
  const q = (new URLSearchParams(location.search).get('q') || '').slice(0, 80);
  if (!q) return;
  const go = () => { const i = document.getElementById('buscador'); if (!i) return; i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(go, 800)); else setTimeout(go, 800);
})();


/* ═══════════════════════════════════════════════════════════
   ECONOMÍA — submenú por secciones + estadísticas reales
═══════════════════════════════════════════════════════════ */
const _ecoDiasStats = () => (_ecoPeriodDays === 7 ? 7 : _ecoPeriodDays === 30 ? 30 : 90);   // se guardan hasta 90 días por publicación

function _ecoMias() {
  const yo = LS.get('user_admin', '');
  const cat = (typeof todosLosItems !== 'undefined' ? todosLosItems : []).filter(i => i.usuario === yo);
  if (!_ecoStats) return cat;
  const rep = Object.fromEntries(cat.map(i => [i._id, i.reportes || 0]));
  return _ecoStats.publicaciones.map(p => ({ _id: p.id, title: p.title, category: p.category, image: p.image, status: p.status, descargasEfectivas: p.totalDescargas, reportes: rep[p.id] || 0 }));
}

async function ecoCargarStats(forzar) {
  const dias = _ecoDiasStats(), tok = LS.get('token');
  if (!tok || _ecoStatsCargando) return;
  if (!forzar && _ecoStats && _ecoStatsDias === dias && Date.now() - _ecoStatsT < 60000) return;
  _ecoStatsCargando = true;
  try {
    const r = await fetch(`${API_URL}/economia/mis-estadisticas?dias=${dias}`, { headers: { Authorization: `Bearer ${tok}` } });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.success) {
      _ecoStats = d; _ecoStatsT = Date.now(); _ecoStatsDias = dias;
      if (_ecoLastData) ecoUpdateDashboard(_ecoLastData);
      ecoRenderPubStats();
    }
  } catch (_) {} finally { _ecoStatsCargando = false; }
}

function ecoSec(nombre) {
  const nav = document.getElementById('eco-subnav'); if (!nav) return;
  if (!nav.querySelector(`[data-sec="${nombre}"]`)) nombre = 'resumen';
  nav.querySelectorAll('button').forEach(b => { const on = b.dataset.sec === nombre; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('#economia-view .eco-sec').forEach(x => x.classList.toggle('active', x.dataset.sec === nombre));
  try { localStorage.setItem('ug_eco_sec', nombre); } catch (_) {}
  if (nombre === 'resumen' && _ecoLastData) setTimeout(() => ecoDrawChart(0, _ecoPeriodDays), 30);   // el canvas oculto mide 0 de ancho
  if (nombre === 'publicaciones') ecoRenderPubStats();
}
window.ecoSec = ecoSec;
document.getElementById('eco-subnav')?.addEventListener('click', e => {
  const b = e.target.closest('button[data-sec]'); if (!b) return;
  ecoSec(b.dataset.sec);
  const nav = document.getElementById('eco-subnav'), top = nav.getBoundingClientRect().top;
  if (top < 0 || top > innerHeight * .6) nav.scrollIntoView({ block: 'start', behavior: 'smooth' });
});
try { const q = new URLSearchParams(location.search).get('eco'), g = q || localStorage.getItem('ug_eco_sec'); if (g) ecoSec(g); } catch (_) {}   // ?eco=cobros abre directo esa sección
// El anillo "Meta retiro" lleva a Cobros (donde se pide el retiro)
document.querySelector('#economia-view .eco-hero-right')?.addEventListener('click', () => { ecoSec('cobros'); document.getElementById('pf-btn-solicitar-pago')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });

function ecoAbrir(id) {
  const it = (typeof todosLosItems !== 'undefined' ? todosLosItems : []).find(x => x._id === id);
  if (it && typeof window.openDetail === 'function') window.openDetail(it);
}

function ecoPintarRetencion(uc, r) {
  const box = document.getElementById('eco-hero-extra'); if (!box) return;
  let info = document.getElementById('eco-ret-info');
  if (!uc) { info?.remove(); return; }
  if (!info) { info = document.createElement('div'); info.id = 'eco-ret-info'; info.className = 'eco-ret-info'; box.after(info); }
  const nombres = { regalo: 'regalos en lives', superchat: 'Super Chat', apoyo: 'apoyos', acceso: 'accesos directos y Premium' };
  const de = Object.entries(r?.origen || {}).filter(([, v]) => v > 0).map(([k, v]) => `${nombres[k] || k} ${v.toLocaleString('es-CO', { maximumFractionDigits: 2 })}`).join(' · ');
  const cuando = r?.proxima ? new Date(r.proxima).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  info.innerHTML = `<details><summary>🔒 Pasan solos a retirables en ${r?.dias || 7} días${cuando ? ` · próxima: <b>${ugEsc(cuando)}</b>` : ''} <span style="opacity:.6">ⓘ</span></summary>
    <div style="margin-top:4px">Lo que ganas con ${de ? ugEsc(de) : 'regalos, Super Chat, apoyos y accesos'} (UC) espera ${r?.dias || 7} días por seguridad, por si un pago se devuelve. No tienes que hacer nada.${cuando ? ` El próximo ingreso (${(r.proximaUC || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })} UC) se libera el ${ugEsc(cuando)}.` : ''}</div></details>`;
}

function ecoRenderPubStats() {
  const el = document.getElementById('eco-pubstats'); if (!el) return;
  const badge = document.getElementById('eco-pub-rango');
  if (!_ecoStats) { if (!LS.get('token')) el.innerHTML = '<div class="eco-ps-vacio">Inicia sesión para ver tus estadísticas</div>'; return; }
  if (badge) badge.textContent = `${_ecoStats.dias} días`;
  const reps = Object.fromEntries(_ecoMias().map(i => [i._id, i.reportes || 0]));
  const ps = _ecoStats.publicaciones.map(p => ({ ...p, reportes: reps[p.id] || 0 }));
  if (!ps.length) { el.innerHTML = '<div class="eco-ps-vacio">Publica tu primer contenido y aquí verás sus vistas, descargas, apoyos y ganancias día a día.</div>'; return; }
  const clave = { descargas: 'descargas', vistas: 'vistas', ganancias: 'gananciaUsd', apoyos: 'apoyos' }[_ecoPsOrden];
  const orden = [...ps].sort((a, b) => (b[clave] - a[clave]) || (b.totalDescargas - a.totalDescargas));
  const t = _ecoStats.totales, f = n => pfFmt(Math.round(n || 0)), uc = usd => (usd / 0.02).toLocaleString('es-CO', { maximumFractionDigits: usd < 0.2 ? 2 : 0 });
  const estado = { pendiente: ' · ⏳ en revisión', rechazado: ' · rechazada' };
  el.innerHTML = `
    <div class="eco-ps-m" style="padding:0 14px 10px">
      <div><b>${f(t.vistas)}</b><small>Vistas</small></div><div><b>${f(t.descargas)}</b><small>Descargas</small></div>
      <div><b>${f(t.apoyos)}</b><small>Apoyos</small></div><div class="gan"><b>${uc(t.gananciaUsd)}</b><small>UC ganados</small></div>
    </div>
    <div class="eco-ps-ord">${[['descargas', 'Más descargadas'], ['vistas', 'Más vistas'], ['ganancias', 'Más ganancias'], ['apoyos', 'Más apoyadas']].map(([k, l]) => `<button type="button" data-o="${k}" class="${k === _ecoPsOrden ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div class="eco-ps-list">${orden.slice(0, 50).map(p => {
      const mx = Math.max(...p.serie, 1), conv = p.vistas ? Math.round(p.descargas / p.vistas * 100) : null;
      return `<div class="eco-ps" data-id="${ugEsc(p.id)}">
        ${p.image ? `<img src="${ugEsc(p.image)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;eco-ps-ph&quot;>📦</span>'">` : '<span class="eco-ps-ph">📦</span>'}
        <div style="min-width:0"><div class="eco-ps-t">${ugEsc(p.title || 'Sin título')}</div>
          <div class="eco-ps-c">${ugEsc(catLabel(p.category))} · ${f(p.totalDescargas)} descargas en total${conv !== null ? ` · ${conv}% de las vistas descargan` : ''}${estado[p.status] || ''}${p.reportes ? ` · <span style="color:#ff6b6b">⚠ ${p.reportes} reporte(s)</span>` : ''}</div></div>
        <div class="eco-ps-m" style="grid-column:1/-1">
          <div><b>${f(p.vistas)}</b><small>Vistas</small></div><div><b>${f(p.descargas)}</b><small>Descargas</small></div>
          <div><b>${f(p.apoyos)}</b><small>Apoyos</small></div><div class="gan"><b>${uc(p.gananciaUsd)}</b><small>UC</small></div>
        </div>
        <div class="eco-ps-spark" title="Descargas por día"${p.serie.some(Boolean) ? '' : ' hidden'}>${p.serie.slice(-30).map(n => `<i style="height:${Math.max(6, n / mx * 100)}%;${n ? '' : 'opacity:.18'}"></i>`).join('')}</div>
      </div>`; }).join('')}</div>
    <p class="eco-ps-vacio" style="padding-top:0">Las vistas y descargas se cuentan una vez por persona al día. Las ganancias incluyen lo que aún está en retención.</p>`;
  el.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { _ecoPsOrden = b.dataset.o; ecoRenderPubStats(); });
  el.querySelectorAll('.eco-ps').forEach(x => x.onclick = () => ecoAbrir(x.dataset.id));
}


// ── Referidos: enlace de invitación ?ref=usuario (se recuerda 30 días para el registro) ──
(function ugRef() {
  try {
    const ref = (new URLSearchParams(location.search).get('ref') || '').replace(/[^\w.-]/g, '').slice(0, 40);
    if (!ref) return;
    localStorage.setItem('ug_ref', JSON.stringify({ c: ref, t: Date.now() }));
    if (window.UG_INVITADO) setTimeout(() => toast(`🎁 @${ref} te invitó: crea tu cuenta gratis y recibe UpCoins de bienvenida`, 5000), 2500);
  } catch (_) {}
})();
