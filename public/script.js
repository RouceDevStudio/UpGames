
// ═══════════════════════════════════════════════════════════
// UPGAMES — BIBLIOTECA REDESIGN v3.0
// Mobile-first · App Store style
// ═══════════════════════════════════════════════════════════

const API_URL = "https://upgames-production.up.railway.app";

// ── SAFE LOCALSTORAGE (modo incógnito estricto no rompe la app) ──────────
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

  function afterPreloader() {
    if(LS.getJSON('upgames_terms_seen_ts') && !LS.get('upgames_onboarding_done')) {
      setTimeout(startTutorial, 600);
    }
  }

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

// ── WAKE UP BACKEND ───────────────────────────────────────
try{fetch(`${API_URL}/items`,{mode:'no-cors'});}catch(_){}

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
function isVideoUrl(url) {
  if(!url) return false;
  return /\.(mp4|webm|mov|avi)(\?.*)?$/i.test(url) || isYouTubeUrl(url);
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
      `<span class="tile-extra-badge"><ion-icon name="${b.icon}"></ion-icon>${b.text}</span>`
    ).join('')}
  </div>`;
}

// ── CREATE TILE ───────────────────────────────────────────
function createTile(item, isFeatured=false) {
  const ls = item.linkStatus || (item.reportes>=3?'revision':'online');
  const isOnline = ls==='online';
  const statusLabel = ls==='online'?'Online':ls==='revision'?'Revisión':'Caído';
  const cat = item.category || 'General';
  const isVideo = cat === 'Video';

  // Para video: la imagen es la miniatura, el link es el video real
  const imgSrc = item.image || '';
  const isVid = !isVideo && /\.(mp4|webm|mov)$/i.test(imgSrc);
  const media = isVid
    ? `<video data-src="${imgSrc}" muted loop playsinline preload="none" class="lazy-vid"></video>`
    : `<img src="${imgSrc}" alt="${item.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/300x170/12121f/555570?text=Sin+imagen'">`;

  const favIds = LS.getJSON('favoritos', []);
  const isFav = favIds.includes(item._id);
  const dl = item.descargasEfectivas||0;
  const lk = item.likesCount||0;
  const extraBadges = getTileExtras(item);

  if(isFeatured) {
    const el = document.createElement('div');
    el.className='featured-tile';
    el.dataset.id=item._id;
    const ftMedia = isVid
      ? `<video data-src="${imgSrc}" muted loop playsinline preload="none" class="lazy-vid"></video>`
      : `<img src="${imgSrc}" alt="${item.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/600x260/12121f/555570?text=Sin+imagen'">`;
    el.innerHTML=`
      <div class="thumb-wrap">${ftMedia}
        ${isVideo?'<div class="tile-video-overlay"><ion-icon name="play-circle"></ion-icon></div>':''}
      </div>
      <div class="ft-info">
        <div class="ft-badge">${isVideo?'▶ '+( item.videoType||'Video'):'⭐ Destacado'}</div>
        <div class="ft-title">${item.title}</div>
        <div class="ft-meta">
          <div class="ft-user">@${item.usuario||'Cloud'}${getBadge(item.usuario)}</div>
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
        ${item.videoType?`<div class="tile-vid-type-badge">${item.videoType}</div>`:''}
        ${duracion?`<div class="tile-duration-badge">${duracion}</div>`:''}
      </div>
      <div class="tile-info tile-info--yt">
        <div class="tile-yt-avatar">${avatarLetter(item.usuario)}</div>
        <div class="tile-yt-body">
          <div class="tile-title">${item.title}</div>
          <div class="tile-yt-meta">
            <span class="tile-user">@${item.usuario||'Cloud'}${getBadge(item.usuario)}</span>
            ${dl?`<span class="tile-yt-dot">·</span><span class="tile-yt-views"><ion-icon name="eye-outline"></ion-icon>${fmt(dl)}</span>`:''}
            ${lk?`<span class="tile-yt-dot">·</span><span class="tile-yt-likes"><ion-icon name="heart"></ion-icon>${fmt(lk)}</span>`:''}
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
        <div class="tile-cat">${cat}</div>
        ${extraBadges}
        <div class="tile-title">${item.title}</div>
        <div class="tile-meta">
          <div class="tile-avatar">${avatarLetter(item.usuario)}</div>
          <div class="tile-user">@${item.usuario||'Cloud'}</div>
          ${lk?`<div class="tile-downloads"><ion-icon name="heart"></ion-icon>${fmt(lk)}</div>`:''}
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
    const isMp4 = /\.(mp4|webm|mov)(\?.*)?$/i.test(item.image);
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
      ? `<div class="hero-vid-type">${item.videoType}</div>`
      : '';

    slide.innerHTML = `
      <img src="${mediaSrc}" alt="${item.title}" loading="${i===0?'eager':'lazy'}"
           onerror="this.src='https://via.placeholder.com/600x260/12121f/555570?text=UpGames'">
      ${isYT || isMp4 || isVideoMode ? '<div class="yt-play-badge large"><ion-icon name="play-circle"></ion-icon></div>' : ''}
      <div class="hero-info">
        ${badgeHTML}
        ${vidTypeHTML}
        <div class="hero-title">${item.title}</div>
        <div class="hero-meta">
          <span class="hero-user">@${item.usuario||'Cloud'}${getBadge(item.usuario)}</span>
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
      <a href="./perfil.html" class="empty-action">Subir Ahora</a>
    </div>`;
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

  // ── PASO 2: Wake-up paralelo del backend (Render duerme) ──
  // Lanzar dos pings simultáneos para despertar más rápido
  fetch(`${API_URL}/items`, {mode:'no-cors'}).catch(()=>{});
  fetch(`${API_URL}/auth/users/public`, {mode:'no-cors'}).catch(()=>{});

  // ── PASO 3: Actualizar desde la red en background ──
  try {
    try {
      const ru = await fetchTimeout(`${API_URL}/auth/users/public`, 8000);
      const users = await ru.json();
      cacheSet(CACHE_KEY_USERS, users);
      users.forEach(u=>{ mapaUsuarios[u.usuario]=u.verificadoNivel||0; });
    } catch(_){}

    const r = await fetchTimeout(`${API_URL}/items`, 12000);
    const data = await r.json();
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
    if(sid) {
      setTimeout(()=>{
        const item = todosLosItems.find(i=>i._id===sid);
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
function openDetail(item) {
  currentItem = item;
  const ls = item.linkStatus||(item.reportes>=3?'revision':'online');
  const isVideoItem = item.category === 'Video';

  // Para videos: el link ES el video; para otros: medias son imágenes/previews
  const rawMedias = [item.image, ...(item.images||[])].filter(m=>m&&m.trim());
  const allMedias = isVideoItem && item.link
    ? [item.link, ...rawMedias.filter(m=>m!==item.link)]
    : rawMedias;

  const firstVideo = isVideoItem
    ? (item.link || allMedias[0] || '')
    : (allMedias.find(m=>isYouTubeUrl(m)||/\.(mp4|webm|mov|avi)(\?.*)?$/i.test(m)) || allMedias[0] || '');
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
    const isMp42 = /\.(mp4|webm|mov|avi)(\?.*)?$/i.test(mediaUrl);

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
        nv.src = mediaUrl;
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
          'border:1px solid rgba(0,242,255,.35)','border-radius:8px',
          'color:#00f2ff','font-size:1.05rem',
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
      img2.onerror = () => { img2.src = 'https://via.placeholder.com/600x340/12121f/555570?text=Sin+imagen'; };
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
      const isMp4t=/\.(mp4|webm|mov|avi)(\?.*)?$/i.test(m);

      if(isMp4t) {
        // Punto 9: auto-capturar frame del video via canvas
        th.innerHTML=`<img src="https://via.placeholder.com/72x52/12121f/5EFF43?text=▶" alt="media ${i+1}">
          <div class="gallery-yt-icon"><ion-icon name="play-circle"></ion-icon></div>`;
        // Intentar captura de frame en segundo plano
        const tmpVid = document.createElement('video');
        tmpVid.src = m; tmpVid.crossOrigin = 'anonymous';
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
      } else {
        const tSrc=isYTt?getYouTubeThumbnail(m):m;
        th.innerHTML=`<img src="${tSrc}" alt="media ${i+1}" onerror="this.src='https://via.placeholder.com/72x52/12121f/555570?text=?'">
          ${isYTt?'<div class="gallery-yt-icon"><ion-icon name="play-circle"></ion-icon></div>':''}`;
      }
      th.onclick=()=>{
        document.querySelectorAll('.gallery-thumb').forEach(t2=>t2.classList.remove('active'));
        th.classList.add('active'); loadSheetMedia(m);
      };
      galleryEl.appendChild(th);
    });
  } else { galleryEl.style.display='none'; galleryEl.innerHTML=''; }

  document.getElementById('ds-cat').textContent=item.category||'General';
  document.getElementById('ds-title').textContent=item.title;
  document.getElementById('ds-dl').textContent=fmt(item.descargasEfectivas||0);
  document.getElementById('ds-rep').textContent=item.reportes||0;
  document.getElementById('ds-desc').textContent=item.description||'Sin descripción.';

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
  document.getElementById('ds-author-name').innerHTML=`@${item.usuario||'Cloud'} ${getBadge(item.usuario)}`;
  document.getElementById('ds-author').onclick=()=>visitarPerfil(item.usuario);

  // Status
  const sb = document.getElementById('ds-status');
  const st = document.getElementById('ds-status-text');
  sb.className='sheet-status-bar '+ls;
  st.textContent=ls==='online'?'✓ Link Activo':ls==='revision'?'⚠️ En Revisión':'✗ Link Caído';

  // Download / Ver video
  const dlBtn = document.getElementById('ds-download');
  if(isVideoItem) {
    // Video: el player está embebido arriba — el botón de descarga no aplica
    dlBtn.style.display = 'none';
    dlBtn.onclick = null;
  } else {
    dlBtn.style.display = '';
    const _puenteMedia = [item.image, ...(item.images||[])].filter(m=>m&&m.trim()).find(m=>
      /youtu/i.test(m)||/\.mp4|\.webm|\.mov/i.test(m)
    ) || item.image || '';
    const _puenteTitle = encodeURIComponent(item.title||'');
    const _puenteMediaEnc = encodeURIComponent(_puenteMedia);
    dlBtn.href = `puente.html?id=${item._id}&media=${_puenteMediaEnc}&title=${_puenteTitle}`;
    dlBtn.innerHTML = '<ion-icon name="cloud-download-outline"></ion-icon> ACCEDER A LA NUBE';
    dlBtn.onclick = function(e) {
      if(ls === 'caido') {
        e.preventDefault();
        if(confirm('⚠️ Este link está reportado como caído.\n¿Deseas intentar acceder de todas formas?')) {
          window.open(`puente.html?id=${item._id}&media=${_puenteMediaEnc}&title=${_puenteTitle}`, '_blank');
        }
      }
    };
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
             onerror="this.src='https://via.placeholder.com/72x50/12121f/555570?text=?'">
        <div class="ds-featured-info">
          <div class="ds-featured-cat">${cat}</div>
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
      <div class="comment-item">
        <div class="comment-head">
          <div class="comment-avatar">${avatarLetter(c.usuario)}</div>
          <div class="comment-user">@${c.usuario}${getBadge(c.usuario)}</div>
          <div class="comment-time">${timeAgo(c.fecha)}</div>
        </div>
        <div class="comment-text">${c.texto}</div>
      </div>`).join('');
  } catch(e) {
    list.innerHTML='<div class="no-comments" style="color:#ff4343">Error al cargar</div>';
  }
}

async function postComment(id) {
  const user = LS.get('user_admin');
  if(!user) { toast('⚠️ Debes iniciar sesión para comentar'); return; }
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
    }
  } catch(e) { toast('❌ Error al comentar'); }
}

// ── FAVORITES ────────────────────────────────────────────
async function fav(id) {
  const user = LS.get('user_admin');
  if(!user) { toast('⚠️ Inicia sesión para guardar favoritos'); return; }
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
      let local=LS.getJSON('favoritos', []);
      if(!local.includes(id)){local.push(id); LS.setJSON('favoritos', local);}
      // Notify author — usa el endpoint real
      const item=todosLosItems.find(i=>i._id===id);
      if(item&&item.usuario!==user) {
        fetch(`${API_URL}/notificaciones`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            usuario:   item.usuario,
            tipo:      'favorito',
            emisor:    user,
            itemId:    item._id,
            itemTitle: item.title,
            itemImage: item.image||'',
            mensaje:   `@${user} guardó tu contenido: "${item.title}"`
          })
        }).catch(()=>{});
      }
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
      headers:{'Content-Type':'application/json'},
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
  if(t==='upload') t='profile';
  currentTab=t;
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
  if(t==='economia') { renderEconomia(); pfStartEcoPolling(); }
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
      <p>Necesitas una cuenta para guardar favoritos</p>
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
        <img src="${item.image||'https://via.placeholder.com/300x170?text=Sin+Imagen'}" alt="${item.title||''}" onerror="this.src='https://via.placeholder.com/300x170?text=Sin+Imagen'">
        <div class="pf-vault-info">
          <div class="pf-vault-title">${(item.title||'Sin título').substring(0,40)}</div>
          <div class="pf-vault-user">@${item.usuario||'Anónimo'}</div>
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
        <p>Necesitas una cuenta para ver tu economía</p>
      </div>`;
    return;
  }
  // Setear pfUser si aún no está seteado
  if(!pfUser) pfUser = user;
  // Registrar listeners de botones (por si es la primera vez que se abre esta vista)
  const btnPaypal = document.getElementById('pf-btn-guardar-paypal');
  const btnPago   = document.getElementById('pf-btn-solicitar-pago');
  if(btnPaypal && !btnPaypal._listenerAdded) {
    btnPaypal.addEventListener('click', pfGuardarPaypal);
    btnPaypal._listenerAdded = true;
  }
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
    pfLoadUserData();
    pfLoadHistorial();
    pfLoadEconomia();
    return;
  }
  pfInitialized = true;
  pfLoadUserData();
  pfLoadHistorial();
  pfLoadBoveda();
  pfLoadEconomia();
  pfInitForm();
}

// ── Load user data (badge, bio, avatar, stats) ──
async function pfLoadUserData() {
  if(!pfUser) return;
  document.getElementById('pf-username').textContent = '@' + pfUser;

  try {
    const res = await fetch(`${PF_API}/auth/users/public`);
    const users = await res.json();
    const ud = users.find(u => u.usuario === pfUser);
    if(!ud) return;

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
      img.src = ud.avatar; img.style.display='block'; ico.style.display='none';
      const prev = document.getElementById('pf-preview-avatar');
      if(prev) prev.innerHTML=`<img src="${ud.avatar}" alt="Avatar">`;
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

  try {
    const ir = await fetch(`${PF_API}/items/user/${pfUser}`);
    if(ir.ok) {
      const id = await ir.json();
      const aprobados = Array.isArray(id) ? id.filter(i => i.status === 'aprobado').length : 0;
      document.getElementById('pf-stat-uploads').textContent = aprobados;
    }
  } catch(e) {}
}

// ── Inner tab switching ──
function pfSwitchTab(tabName, el) {
  document.querySelectorAll('.perfil-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.perfil-tab-content').forEach(c => c.classList.remove('active'));
  if(el) el.classList.add('active');
  else document.querySelector(`[data-pftab="${tabName}"]`)?.classList.add('active');
  const tc = document.getElementById(`pf-tab-${tabName}`);
  if(tc) tc.classList.add('active');
  if(tabName === 'historial') pfLoadHistorial();
  if(tabName === 'boveda') pfLoadBoveda();
  if(tabName === 'reportes') pfLoadReportes();
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
  document.getElementById('pf-btn-guardar-paypal')?.addEventListener('click', pfGuardarPaypal);
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
  'pixeldrain.com','1fichier.com','qiwi.gg','krakenfiles.com','dropbox.com','github.com','sto.romsfast.com'];

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
  img.onerror = () => { img.src = 'https://via.placeholder.com/100x44/12121f/555570?text=?'; };
  prev.classList.add('show');
}

function pfUpdatePreview() {
  const t = document.getElementById('pf-addTitle')?.value || 'Título del Proyecto';
  const c = document.getElementById('pf-addCategory')?.value || 'Categoría';
  const i = document.getElementById('pf-addImage')?.value || 'https://via.placeholder.com/300x150?text=Esperando+Imagen';
  document.getElementById('pf-prev-title').textContent = t;
  document.getElementById('pf-prev-tag').textContent = c.toUpperCase();
  document.getElementById('pf-prev-img').src = i;
  const linkEl = document.getElementById('pf-addLink');
  if(linkEl && linkEl.value.trim()) {
    const r = pfAnalizarLink(linkEl.value.trim());
    linkEl.classList.toggle('valid', r.ok === true);
    linkEl.classList.toggle('invalid', r.ok === false);
  } else if(linkEl) { linkEl.classList.remove('valid','invalid'); }
}

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
        <img src="${item.image || 'https://via.placeholder.com/50x35/12121f/555570?text=?'}"
             alt="" loading="lazy"
             onerror="this.src='https://via.placeholder.com/50x35/12121f/555570?text=?'">
        <div class="pf-featured-item-info">
          <div class="pf-featured-item-cat">${item.category || 'General'}</div>
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
  img.src = image || 'https://via.placeholder.com/56x40/12121f/555570?text=?';
  img.onerror = () => { img.src = 'https://via.placeholder.com/56x40/12121f/555570?text=?'; };
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

// ── Cloudinary Widget ──
function pfOpenCloudinaryWidget() {
  if(!pfCloudinaryWidget) {
    pfCloudinaryWidget = cloudinary.createUploadWidget({
      cloudName: CLOUDINARY_CLOUD_NAME,
      uploadPreset: CLOUDINARY_UPLOAD_PRESET,
      sources: ['local','url'],
      resourceType: 'video',
      maxFileSize: 524288000, // 500MB
      clientAllowedFormats: ['mp4','webm','mov','avi'],
      showAdvancedOptions: false,
      cropping: false,
      multiple: false,
      showSkipCropButton: false,
      styles: {
        palette: {
          window: '#07070f',
          windowBorder: '#5EFF43',
          tabIcon: '#5EFF43',
          menuIcons: '#9090aa',
          textDark: '#f0f0f8',
          textLight: '#f0f0f8',
          link: '#5EFF43',
          action: '#5EFF43',
          inactiveTabIcon: '#555570',
          error: '#ff4343',
          inProgress: '#00f2ff',
          complete: '#5EFF43',
          sourceBg: '#0d0d1a'
        },
        fonts: { default: null, "'Manrope', sans-serif": { url: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;700&display=swap', active: true } }
      }
    }, (error, result) => {
      if(error) {
        toast('❌ Error al subir video: ' + (error.message || error.statusText || 'Error'));
        pfCldShowIdle();
        return;
      }
      if(result.event === 'upload-added') {
        pfCldShowUploading();
      }
      if(result.event === 'progress') {
        const pct = Math.round(result.info.progress || 0);
        const fill = document.getElementById('pf-cld-progress-fill');
        if(fill) fill.style.width = pct + '%';
      }
      if(result.event === 'success') {
        pfVideoUrl = result.info.secure_url;
        document.getElementById('pf-vid-url').value = pfVideoUrl;
        pfCldShowDone(pfVideoUrl);
        toast('✅ Video subido a la nube');
      }
    });
  }
  pfCloudinaryWidget.open();
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
  if(vid) { vid.src = url; }
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
    img.src = pfVideoUrl.replace(/\.(mp4|webm|mov|avi)/i, '.jpg');
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
  const thumbFinal = thumb || vidUrl.replace(/\.(mp4|webm|mov|avi)/i, '.jpg');

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
    if(/\.(mp4|webm|mov|avi)(\?.*)?$/i.test(url)) return true;
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
  btn.textContent = 'Enviando...'; btn.disabled = true;
  try {
    const res = await fetch(`${PF_API}/items/add`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
      body: JSON.stringify({ title:titulo, description:desc, link, image:imagen, images:imagesExtra, category:cat, extraData, usuario:pfUser, status:'pendiente' })
    });
    if(res.ok) {
      LS.set('ultima_publicacion', Date.now().toString());
      toast('✅ Publicado. Esperando aprobación.');
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
async function pfLoadHistorial() {
  const cont      = document.getElementById('pf-showContent');
  const vidCont   = document.getElementById('pf-showVideos');
  const vidCount  = document.getElementById('pf-hist-vid-count');
  if(!cont || !pfUser) return;
  cont.innerHTML = '<div class="pf-empty"><ion-icon name="sync-outline"></ion-icon><p>Cargando...</p></div>';
  try {
    const token = LS.get('token');
    const res = await fetch(`${PF_API}/items/user/${pfUser}`, {
      headers: token ? { Authorization:`Bearer ${token}` } : {}
    });
    const data = await res.json();
    const items = Array.isArray(data) ? data.reverse() : [];

    const juegos = items.filter(i => i.category !== 'Video');
    const videos = items.filter(i => i.category === 'Video');

    // ── Publicaciones (no video) ──
    cont.innerHTML = '';
    if(!juegos.length) {
      cont.innerHTML='<div class="pf-empty"><ion-icon name="cloud-offline-outline"></ion-icon><p>Aún no has publicado nada.</p></div>';
    } else {
      juegos.forEach(item => {
        const isPending = item.status==='pendiente'||item.status==='pending';
        const ls = item.linkStatus||'online';
        const lsText = ls==='online'?'🟢 Online':ls==='revision'?'🟡 Rev.':'🔴 Caído';
        const card = document.createElement('div');
        card.className = 'pf-item-card';
        card.innerHTML = `
          <div class="pf-item-badge ${isPending?'pending':'approved'}">${isPending?'Pendiente':'Aprobado'}</div>
          <img src="${item.image||'https://via.placeholder.com/300x170?text=Sin+Imagen'}" alt="${item.title}" onerror="this.src='https://via.placeholder.com/300x170?text=Sin+Imagen'">
          <div class="pf-item-info">
            <div class="pf-item-title">${item.title||'Sin título'}</div>
            <div class="pf-item-cat">${item.category||'General'}</div>
            <div class="pf-item-stats">
              <div class="pf-item-stat"><div class="pf-item-stat-val">${item.descargasEfectivas||0}</div><div class="pf-item-stat-lbl">DL</div></div>
              <div class="pf-item-stat"><div class="pf-item-stat-val" style="font-size:.62rem">${lsText}</div><div class="pf-item-stat-lbl">LINK</div></div>
              <div class="pf-item-stat"><div class="pf-item-stat-val" style="color:${(item.reportes||0)>=3?'#ff4343':'var(--txt)'}">${item.reportes||0}</div><div class="pf-item-stat-lbl">REP</div></div>
            </div>
            <div class="pf-item-actions">
              <button class="pf-btn-action edit" onclick="pfOpenEditModal('${item._id}')"><ion-icon name="create"></ion-icon> Editar</button>
              <button class="pf-btn-action del" onclick="pfEliminar('${item._id}')"><ion-icon name="trash"></ion-icon> Borrar</button>
            </div>
          </div>`;
        cont.appendChild(card);
      });
    }

    // ── Videos — actualizar badge de count en sub-nav ──
    if(vidCount) {
      if(videos.length > 0) {
        vidCount.textContent = videos.length;
        vidCount.style.display = 'inline-flex';
      } else {
        vidCount.style.display = 'none';
      }
    }
    if(!vidCont) return;
    if(!videos.length) {
      vidCont.innerHTML='<div class="pf-empty"><ion-icon name="videocam-off-outline"></ion-icon><p>Aún no has publicado videos.</p></div>';
      return;
    }
    vidCont.innerHTML = '';
    videos.forEach(item => {
      const isPending = item.status==='pendiente'||item.status==='pending';
      const ls = item.linkStatus||'online';
      const lsText = ls==='online'?'🟢 Online':ls==='revision'?'🟡 Rev.':'🔴 Caído';
      const card = document.createElement('div');
      card.className = 'pf-item-card pf-item-card--video';
      card.innerHTML = `
        <div class="pf-item-badge ${isPending?'pending':'approved'}">${isPending?'Pendiente':'Aprobado'}</div>
        <div style="position:relative">
          <img src="${item.image||'https://via.placeholder.com/300x170/07070f/00f2ff?text=VIDEO'}" alt="${item.title}" style="width:100%;height:100px;object-fit:cover;display:block" onerror="this.src='https://via.placeholder.com/300x170/07070f/00f2ff?text=VIDEO'">
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.3)"><ion-icon name="play-circle" style="font-size:2rem;color:rgba(255,255,255,.9)"></ion-icon></div>
          ${item.videoType?`<div style="position:absolute;bottom:5px;left:5px;background:rgba(0,242,255,.85);color:#000;font-size:.55rem;font-weight:800;padding:2px 7px;border-radius:999px;text-transform:uppercase">${item.videoType}</div>`:''}
        </div>
        <div class="pf-item-info">
          <div class="pf-item-title">${item.title||'Sin título'}</div>
          <div class="pf-item-cat" style="color:var(--cy)">Video</div>
          ${item.featuredItemId ? `
          <div class="pf-vid-featured-row" id="pf-feat-${item._id}">
            <ion-icon name="pin" style="color:var(--cy);font-size:.7rem"></ion-icon>
            <span style="font-size:.68rem;color:var(--txt3)">Cargando entrada destacada…</span>
          </div>` : ''}
          <div class="pf-item-stats">
            <div class="pf-item-stat"><div class="pf-item-stat-val">${item.descargasEfectivas||0}</div><div class="pf-item-stat-lbl">VISTAS</div></div>
            <div class="pf-item-stat"><div class="pf-item-stat-val" style="color:#ff4d6a">${item.likesCount||0}</div><div class="pf-item-stat-lbl">LIKES</div></div>
            <div class="pf-item-stat"><div class="pf-item-stat-val" style="color:${(item.reportes||0)>=3?'#ff4343':'var(--txt)'}">${item.reportes||0}</div><div class="pf-item-stat-lbl">REP</div></div>
          </div>
          <div class="pf-item-actions">
            <button class="pf-btn-action edit" style="background:rgba(0,242,255,.12);border-color:rgba(0,242,255,.3);color:var(--cy)" onclick="pfOpenEditVideoModal('${item._id}')"><ion-icon name="create"></ion-icon> Editar</button>
            <button class="pf-btn-action del" onclick="pfEliminarVideo('${item._id}')"><ion-icon name="trash"></ion-icon> Borrar</button>
          </div>
        </div>`;
      vidCont.appendChild(card);

      // Cargar nombre de la entrada destacada si existe
      if (item.featuredItemId) {
        const rowEl = document.getElementById(`pf-feat-${item._id}`);
        const cached = todosLosItems.find(i => i._id === item.featuredItemId);
        const fillRow = (feat) => {
          if (!rowEl) return;
          rowEl.innerHTML = `
            <ion-icon name="pin" style="color:var(--cy);font-size:.7rem;flex-shrink:0"></ion-icon>
            <img src="${feat.image||''}" alt="" style="width:28px;height:20px;object-fit:cover;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'">
            <span style="font-size:.68rem;color:var(--txt2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${feat.title||'Entrada destacada'}</span>`;
        };
        if (cached) {
          fillRow(cached);
        } else {
          fetch(`${PF_API}/items/${item.featuredItemId}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d && d._id) fillRow(d); else if (rowEl) rowEl.style.display='none'; })
            .catch(() => { if (rowEl) rowEl.style.display='none'; });
        }
      }
      vidCont.appendChild(card);
    });

  } catch(e) {
    cont.innerHTML='<div class="pf-empty" style="color:#ff4343"><p>Error al cargar historial</p></div>';
  }
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
        <img src="${item.image||'https://via.placeholder.com/300x170?text=Sin+Imagen'}" alt="${item.title||''}" onerror="this.src='https://via.placeholder.com/300x170?text=Sin+Imagen'">
        <div class="pf-vault-info">
          <div class="pf-vault-title">${(item.title||'Sin título').substring(0,40)}</div>
          <div class="pf-vault-user">@${item.usuario||'Anónimo'}</div>
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
          <div><div class="pf-reporte-title">${pub.title}</div>
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
      const saldoEl = document.getElementById('pf-saldo-display');
      const prevSaldo = parseFloat(saldoEl.dataset.val || '0');
      const newSaldo = d.saldo || 0;
      saldoEl.dataset.val = newSaldo;
      _animateValue(saldoEl, prevSaldo, newSaldo, 4, '$', 800);

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

      if(d.paypalEmail) document.getElementById('pf-paypal-email-input').value = d.paypalEmail;
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
function pfFmt(n) {
  if(!n) return '0';
  if(n>=1e6) return (n/1e6).toFixed(1)+'M';
  if(n>=1e3) return (n/1e3).toFixed(1)+'K';
  return n.toString();
}
async function pfGuardarPaypal() {
  const email = document.getElementById('pf-paypal-email-input').value.trim();
  if(!email||!email.includes('@')||!email.includes('.')) { toast('⚠️ Email inválido'); return; }
  const token = LS.get('token');
  try {
    const res = await fetch(`${PF_API}/economia/actualizar-paypal`,{
      method:'PUT',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
      body: JSON.stringify({ paypalEmail: email })
    });
    const d = await res.json();
    if(d.success) toast('✅ Email de PayPal actualizado');
    else toast('❌ '+(d.error||'Error'));
  } catch(e) { toast('❌ Error de conexión'); }
}
async function pfSolicitarPago() {
  const ok = await customConfirm({
    icon: '💸',
    title: 'Solicitar pago',
    msg: '¿Confirmas que deseas solicitar un pago? El administrador revisará tu solicitud en 24-72h.',
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

// ── Settings Modal ──
function pfOpenSettings() {
  document.getElementById('pf-settingsModal').classList.add('show');
  document.body.style.overflow='hidden';
}
function pfCloseSettings() {
  document.getElementById('pf-settingsModal').classList.remove('show');
  document.body.style.overflow='';
}
function pfSwitchSettings(type, el) {
  document.querySelectorAll('.pf-stab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pf-scontent').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(`pf-settings-${type}`).classList.add('active');
}
function pfUpdateAvatarPreview() {
  const url = document.getElementById('pf-input-avatar-url').value;
  const prev = document.getElementById('pf-preview-avatar');
  if(url) prev.innerHTML=`<img src="${url}" alt="Avatar">`;
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
    } else toast('❌ Error al actualizar avatar');
  } catch(e) { toast('❌ Error de conexión'); }
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

// ── ONBOARDING MODAL — 5 slides + términos ───────────────
(function initOnboarding() {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000; // 1 semana en ms
  const lastSeen = LS.getJSON('upgames_terms_seen_ts');
  if (lastSeen && (Date.now() - lastSeen) < WEEK_MS) return; // visto hace menos de 1 semana

  const modal   = document.getElementById('onboarding-modal');
  const track   = document.getElementById('ob-track');
  const footer  = document.getElementById('ob-footer');
  const btnNext = document.getElementById('ob-btn-next');
  const btnAccept = document.getElementById('btn-accept-terms');
  const dots    = document.querySelectorAll('.ob-dot');
  const slides  = document.querySelectorAll('.ob-slide');
  const TOTAL   = slides.length;   // 5

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
    if (idx === TOTAL - 2) {
      btnNext.innerHTML = 'Ver términos <ion-icon name="arrow-forward-outline"></ion-icon>';
    } else {
      btnNext.innerHTML = 'Siguiente <ion-icon name="arrow-forward-outline"></ion-icon>';
    }
  }

  // Dots clickeables (solo hacia adelante — UX intencional)
  dots.forEach((d, i) => {
    d.addEventListener('click', () => { if (i > current) _goTo(i); });
  });

  // Botón Siguiente
  btnNext.addEventListener('click', () => _goTo(current + 1));

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

  // Botón Aceptar (slide 5)
  btnAccept.addEventListener('click', () => {
    LS.setJSON('upgames_terms_seen_ts', Date.now());
    modal.classList.remove('show');
    document.body.style.overflow = '';
    if (!LS.get('upgames_onboarding_done')) setTimeout(startTutorial, 600);
  });
})();

// ── NEXUS AI WIDGET ──────────────────────────────────────
let nxOpen=false, nxExpanded=false;
function nxToggle() {
  nxOpen=!nxOpen;
  document.getElementById('nxPanel').classList.toggle('open',nxOpen);
  // Bloquear scroll del body y marcar estado para el CSS
  document.body.style.overflow = nxOpen ? 'hidden' : '';
  document.body.classList.toggle('nx-open', nxOpen);
  if(nxOpen) nxClockStart(); else nxClockStop();
}
function nxClose() {
  nxOpen=false;
  document.getElementById('nxPanel').classList.remove('open');
  document.body.style.overflow = '';
  document.body.classList.remove('nx-open');
  nxClockStop();
}
function nxExpand() {
  nxExpanded=!nxExpanded;
  document.getElementById('nxPanel').classList.toggle('expanded',nxExpanded);
  const ico=document.getElementById('nxExpBtn');
  if(nxExpanded) {
    ico.innerHTML='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 2H2v4M14 6V2h-4M10 14h4v-4M2 10v4h4"/></svg>';
  } else {
    ico.innerHTML='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>';
  }
}
function nxBoot() {
  const boot  = document.getElementById('nxBoot');
  const frame = document.getElementById('nxFrame');

  // Cargar iframe inmediatamente
  frame.src = frame.dataset.src;
  frame.classList.add('loaded');

  // Ocultar boot screen después de 2 segundos sin importar nada
  setTimeout(() => { boot.style.display = 'none'; }, 2000);
}
// Clock — solo activo cuando el panel NEXUS está abierto
let _clockInterval = null;
function nxClockStart() {
  if(_clockInterval) return;
  const el=document.getElementById('nxClk');
  const tick=()=>{
    const n=new Date();
    if(el) el.textContent=n.getHours().toString().padStart(2,'0')+':'+n.getMinutes().toString().padStart(2,'0');
  };
  tick();
  _clockInterval=setInterval(tick,10000); // cada 10s es suficiente para un reloj
}
function nxClockStop() {
  if(_clockInterval){ clearInterval(_clockInterval); _clockInterval=null; }
}

// ── TUTORIAL ─────────────────────────────────────────────
// Cada paso puede tener:
//   sel      → selector CSS del elemento a destacar
//   title    → título del tooltip
//   body     → explicación detallada
//   onEnter  → función que se ejecuta al llegar a este paso
//   onExit   → función que se ejecuta al salir de este paso
//   scrollEl → selector del contenedor a hacer scroll (para elementos dentro del sheet)

const TUT_STEPS = [
  // ── PANTALLA PRINCIPAL ──────────────────────────────────
  {
    sel: null,
    title: '👋 Bienvenido a UpGames',
    body: 'Esta es <strong>La Nube de Contenido</strong>: una biblioteca donde encontrarás juegos, mods, apps y mucho más subido por la comunidad.<br><br>Te voy a mostrar <strong>absolutamente todo</strong> lo que puedes hacer aquí, paso a paso. ¡Vamos!'
  },
  {
    sel: '#app-header',
    title: '📌 La Barra Superior',
    body: 'En la parte de arriba tienes todo lo esencial: el <strong>logo de UpGames</strong>, un <strong>buscador</strong> y dos botones de acción. Ahora los explico uno por uno.'
  },
  {
    sel: '#buscador',
    title: '🔍 Buscador en Tiempo Real',
    body: 'Escribe aquí para buscar <strong>cualquier cosa al instante</strong>: el nombre de un juego, el usuario que lo subió, la categoría, o una etiqueta. Los resultados se filtran <em>mientras escribes</em>, sin necesidad de pulsar Enter.'
  },
  {
    sel: '.hdr-actions .hdr-btn:first-child',
    title: '☁️ Botón Subir Contenido',
    body: 'Este botón con el ícono de nube te lleva directamente a tu <strong>Perfil → pestaña Publicar</strong>. Desde ahí puedes subir juegos, mods, apps y ganar dinero con tus aportes.'
  },
  {
    sel: '.hdr-actions .hdr-btn:last-child',
    title: '🚨 Botón de Soporte',
    body: 'El ícono <strong>ⓘ</strong> abre tu correo para contactar directamente al equipo de UpGames. Úsalo para reportar abuso, contenido ilegal o pedir ayuda. El equipo responde en menos de 72 horas.'
  },
  {
    sel: '#category-row',
    title: '🏷️ Filtros por Categoría',
    body: 'Esta fila de botones te permite filtrar el contenido por tipo. Toca <strong>Juegos</strong> para ver solo juegos, <strong>Mod</strong> para modificaciones, <strong>Apps</strong> para aplicaciones, etc. Desliza hacia la derecha para ver más categorías. Toca <strong>"Todos"</strong> para quitar el filtro.'
  },
  {
    sel: '.featured-tile',
    title: '⭐ Tarjeta Destacada',
    body: 'La primera tarjeta grande (formato ancho 21:9) es el <strong>contenido más destacado</strong> del momento. Muestra la portada a tamaño completo, el título, el creador con su badge de verificación y el contador de descargas. Tócala para abrirla.'
  },
  {
    sel: '.game-tile .tile-status',
    title: '🟢 Badge de Estado del Link',
    body: 'Cada tarjeta tiene este badge en la esquina superior derecha que indica si el enlace funciona:<br>• <strong style="color:#5EFF43">● Online</strong> — funciona perfectamente<br>• <strong style="color:#ffcc00">● Revisión</strong> — se está verificando (3+ reportes)<br>• <strong style="color:#ff4343">● Caído</strong> — el link no funciona<br><br>Evita los que están en "Caído" o repórtalos.'
  },
  {
    sel: '.tile-fav-quick',
    title: '❤️ Corazón de Favoritos',
    body: 'El corazón en la esquina superior <em>izquierda</em> de cada tarjeta te permite guardar ese contenido en tu lista de favoritos <strong>sin necesidad de abrirlo</strong>. Se pone rojo cuando ya está guardado. Para quitarlo, tócalo de nuevo.'
  },
  {
    sel: '.game-tile .tile-title',
    title: '📝 Título del Contenido',
    body: 'El nombre del contenido. Si es muy largo se corta con "…" para que no ocupe demasiado espacio. Para ver el título completo abre la tarjeta tocándola.'
  },
  {
    sel: '.game-tile .tile-meta',
    title: '👤 Autor y Descargas',
    body: 'Debajo del título verás el <strong>avatar y nombre de usuario</strong> del creador, y el <strong>contador de descargas</strong> (el ícono de nube). Más descargas = más confianza en el contenido.'
  },

  // ── DETALLE DE CARD ─────────────────────────────────────
  {
    sel: '.game-tile',
    title: '👆 Abriendo una Tarjeta…',
    body: 'Ahora voy a <strong>abrir una tarjeta</strong> automáticamente para mostrarte todo lo que hay dentro. En tu día a día, simplemente toca cualquier tarjeta para abrirla.',
    onEnter: function() {
      const card = document.querySelector('.game-tile');
      if(card && todosLosItems.length > 0) {
        const item = todosLosItems[1] || todosLosItems[0];
        setTimeout(() => { openDetail(item); }, 500);
      }
    }
  },
  {
    sel: '.sheet-media',
    title: '🖼️ Imagen / Video de Portada',
    body: 'La parte superior del detalle muestra la <strong>imagen o video de portada</strong> del contenido. Si el creador subió un video (.mp4), se reproducirá automáticamente en silencio como preview. La imagen tiene un degradado abajo para que el texto sea legible.'
  },
  {
    sel: '.sheet-header',
    title: '📋 Título, Categoría y Botón Cerrar',
    body: 'Aquí ves:<br>• El <strong>texto azul</strong> = categoría del contenido<br>• El <strong>título grande</strong> = nombre completo<br>• La <strong>X</strong> de la esquina = cierra esta pantalla y te devuelve a la lista principal'
  },
  {
    sel: '#ds-author',
    title: '👤 Fila del Creador',
    body: 'Esta fila muestra quién subió el contenido. Incluye su <strong>inicial en avatar</strong>, nombre de usuario y badge de verificación (✓ bronce/plata/oro según su nivel).<br><br>Toca esta fila para ir a su <strong>perfil público</strong> y ver todos sus aportes.'
  },
  {
    sel: '.sheet-stats',
    title: '📊 Estadísticas del Contenido',
    body: 'Tres números importantes de un vistazo:<br>• <strong>Descargas</strong> — cuántas veces se ha accedido al link<br>• <strong>Reportes</strong> — si tiene 3+, puede estar caído o ser problemático<br>• <strong>Favs</strong> — cuánta gente lo tiene guardado en su lista'
  },
  {
    sel: '#ds-status',
    title: '🔗 Barra de Estado del Enlace',
    body: 'Barra verde/amarilla/roja que confirma si el <strong>link de descarga está activo en este momento</strong>.<br>• 🟢 <strong>Link Activo</strong> — funciona, puedes descargar<br>• 🟡 <strong>En Revisión</strong> — se está revisando<br>• 🔴 <strong>Link Caído</strong> — usa el botón Reportar para notificarlo'
  },
  {
    sel: '#ds-desc',
    title: '📝 Descripción Completa',
    body: 'El creador escribe aquí toda la <strong>información que necesitas saber</strong>: de qué trata el contenido, instrucciones de instalación, versiones compatibles, requisitos del sistema, advertencias, etc.<br><br>⚠️ <strong>Siempre léela antes de descargar.</strong>'
  },
  {
    sel: '.sheet-actions',
    title: '⚡ Botones de Acción',
    body: 'Tres acciones rápidas:<br>• <strong>❤️ Favorito</strong> — guarda este ítem en tu lista personal<br>• <strong>📤 Compartir</strong> — copia el link o comparte por app. El link incluye el ID del ítem para que otros lo abran directamente<br>• <strong>🚩 Reportar</strong> — reporta link caído, contenido viejo o malware'
  },
  {
    sel: '#ds-download',
    title: '⬇️ Botón Principal: Acceder al Contenido',
    body: 'Este botón verde es el <strong>acceso al archivo</strong>. Al tocarlo te lleva a una página puente que registra la descarga y luego te redirige al link del creador (Google Drive, MediaFire, MEGA, etc.).<br><br>UpGames no almacena archivos, solo indexa los metadatos.'
  },
  {
    sel: '.comment-input-area',
    title: '💬 Área de Comentarios',
    body: 'Escribe aquí tu <strong>opinión, pregunta o consejo</strong> sobre el contenido. Puedes:<br>• Avisar si el link funciona o no<br>• Compartir instrucciones que descubriste<br>• Agradecer al creador<br>• Pedir ayuda a la comunidad<br><br>Necesitas iniciar sesión para comentar.',
    scrollEl: '.sheet-scroll'
  },

  // ── NAVEGACIÓN ──────────────────────────────────────────
  {
    sel: '#bottom-nav',
    title: '🧭 Barra de Navegación Principal',
    body: 'La barra fija de abajo te permite moverte entre las 4 grandes secciones de UpGames. El punto verde indica en qué sección estás. Vamos a ver cada una.',
    onEnter: function() { closeDetail(); }
  },
  {
    sel: '[data-tab="main"]',
    title: '🔲 Explorar — Pantalla Principal',
    body: 'El ícono de cuadrícula te devuelve a la <strong>pantalla principal</strong> donde ves todo el contenido de la nube. Es el "inicio" de UpGames. Desde aquí puedes buscar y filtrar.'
  },
  {
    sel: '[data-tab="favs"]',
    title: '❤️ Mis Favoritos',
    body: 'El ícono de corazón abre tu <strong>lista personal de favoritos</strong>. Aquí aparecen todos los ítems que guardaste tocando el ❤️. Se guardan localmente en tu dispositivo, siempre disponibles sin necesidad de buscarlos.'
  },
  {
    sel: '[data-tab="upload"]',
    title: '➕ Subir Contenido (Acceso Rápido)',
    body: 'El ícono + lleva directamente al <strong>formulario de publicación</strong> en tu perfil. ¿Tienes un juego, mod o app que compartir? Tócalo y sube tu aporte. Puedes ganar <strong>$1.00 USD por cada 1,000 descargas</strong>.'
  },
  {
    sel: '[data-tab="profile"]',
    title: '👤 Mi Perfil — Centro de Control',
    body: 'El ícono de persona abre tu perfil completo. Ahora te voy a mostrar <strong>todo lo que hay dentro</strong>. Es el corazón de UpGames para creadores.',
    onEnter: function() { switchTab('profile'); }
  },

  // ── PERFIL: SECCIÓN SUPERIOR ─────────────────────────────
  {
    sel: '.profile-card',
    title: '🪪 Tu Tarjeta de Perfil',
    body: 'Esta tarjeta muestra tu identidad en UpGames: <strong>avatar, nombre de usuario, badge de verificación</strong> y tu bio. El fondo degradado es tu "portada" de perfil.<br><br>Si no has iniciado sesión, verás un mensaje para acceder. Inicia sesión desde la pantalla de login para desbloquear todas las funciones de creador.'
  },
  {
    sel: '.profile-avatar-wrap',
    title: '🖼️ Tu Avatar',
    body: 'Esta es tu foto de perfil. Al tocarlo se abre el modal de <strong>Configuración</strong> donde puedes cambiarla pegando una URL de imagen. También puedes editar tu bio desde ahí.<br><br>Tip: usa Imgur o ImgBB para alojar tu foto gratis.'
  },
  {
    sel: '.profile-stats-row',
    title: '📊 Tus Estadísticas Personales',
    body: 'Tres números que resumen tu actividad:<br>• <strong>Publicaciones</strong> — cuántos aportes aprobados tienes<br>• <strong>Seguidores</strong> — usuarios que te siguen<br>• <strong>Siguiendo</strong> — usuarios que sigues tú'
  },
  {
    sel: '.profile-actions',
    title: '⚙️ Acciones del Perfil',
    body: 'Dos botones principales:<br>• <strong>Editar Perfil</strong> — abre el modal para cambiar avatar y bio<br>• <strong>Cerrar Sesión</strong> (rojo) — cierra tu sesión actual. Si cierras sesión tendrás que volver a hacer login para publicar o comentar.'
  },

  // ── PERFIL: TABS INTERNAS ────────────────────────────────
  {
    sel: '#pf-tabs',
    title: '📑 Las 5 Pestañas de Tu Perfil',
    body: 'Tu perfil tiene 5 secciones que veremos una por una:<br>• ☁️ <strong>Publicar</strong> — sube nuevo contenido<br>• 🕒 <strong>Historial</strong> — gestiona tus publicaciones<br>• 🛡️ <strong>Bóveda</strong> — tus favoritos guardados<br>• 🚩 <strong>Reportes</strong> — publicaciones reportadas<br>• 💰 <strong>Economía</strong> — tus ganancias'
  },

  // ── TAB: PUBLICAR ────────────────────────────────────────
  {
    sel: '[data-pftab="publicar"]',
    title: '☁️ Pestaña: Publicar',
    body: 'Esta pestaña tiene el <strong>formulario para subir nuevo contenido</strong> a la nube. Vamos a ver cada campo.',
    onEnter: function() { pfSwitchTab('publicar', document.querySelector('[data-pftab="publicar"]')); }
  },
  {
    sel: '#pf-addTitle',
    title: '✏️ Campo: Título del Proyecto',
    body: 'Escribe aquí el <strong>nombre de tu contenido</strong>. Importante:<br>• Máximo 80 caracteres<br>• <strong style="color:#ff4343">Palabras prohibidas</strong>: crack, pirata, gratis, free, full, completo, premium, descargar, download<br>• El campo se pone rojo si detecta una palabra prohibida<br>• Toca el <strong>?</strong> junto a la etiqueta para ver la lista completa'
  },
  {
    sel: '#pf-addDescription',
    title: '📝 Campo: Descripción',
    body: 'Descripción <strong>opcional</strong> de tu contenido (máx. 500 caracteres). Aquí puedes explicar:<br>• Qué incluye el archivo<br>• Instrucciones de instalación<br>• Versión y compatibilidad<br>• Requisitos especiales<br><br>Una buena descripción atrae más descargas.'
  },
  {
    sel: '#pf-addLink',
    title: '🔗 Campo: Link de Descarga',
    body: 'Pega aquí el enlace directo al archivo. <strong>Solo se aceptan estas plataformas:</strong><br>MediaFire · MEGA · Google Drive · OneDrive · Dropbox · GitHub · GoFile · PixelDrain · Krakenfiles · Proton Drive · iCloud · pCloud<br><br><strong style="color:#ff4343">❌ Prohibido:</strong> acortadores (bit.ly, t.co…), links directos a .exe o .msi<br><br>Toca el <strong>?</strong> para ver la lista completa de plataformas.'
  },
  {
    sel: '#pf-addImage',
    title: '🖼️ Campo: Imagen de Portada',
    body: 'URL de la imagen o video de portada. Se aceptan imágenes (.jpg, .png, .webp, .gif), videos (.mp4, .webm) y URLs de servicios como Imgur, Google Drive, Discord CDN y otros.<br><br>¿Cómo obtener una imagen de Google?<br>1. Busca en Google Imágenes<br>2. <strong>Móvil:</strong> Mantén presionada → "Abrir en otra pestaña"<br>3. <strong>PC:</strong> Clic derecho → "Abrir imagen en pestaña nueva"<br>4. Copia la URL y pégala aquí'
  },
  {
    sel: '#pf-addCategory',
    title: '🏷️ Campo: Categoría',
    body: 'Elige la categoría que mejor describe tu contenido:<br>• <strong>Juego</strong> — solo si eres el desarrollador original o tienes permiso<br>• <strong>Mod</strong> — modificaciones de juegos existentes<br>• <strong>Optimización</strong> — mejoras de rendimiento, parches FPS<br>• <strong>Ajustes</strong> — utilidades y herramientas<br>• <strong>Apps</strong> — aplicaciones móviles o de escritorio<br>• <strong>Software</strong> — código abierto y herramientas libres<br><br>Toca el badge "VER INFO" para ver la guía completa.'
  },
  {
    sel: '.pf-preview-card',
    title: '👁️ Vista Previa en Tiempo Real',
    body: 'Esta tarjeta muestra <strong>exactamente cómo se verá tu publicación</strong> en la biblioteca mientras la rellenas. Se actualiza automáticamente con el título, categoría e imagen que escribes. Así sabes qué verán los demás antes de publicar.'
  },
  {
    sel: '#pf-subirBtn',
    title: '🚀 Botón Enviar a Revisión',
    body: 'Al tocar este botón tu publicación se envía al <strong>sistema de revisión</strong>. Un moderador o bot la revisa antes de que aparezca en la biblioteca.<br><br>• Si está todo correcto → aparece en 24-48h<br>• Si tiene algo prohibido → se rechaza con motivo<br>• Hay un <strong>cooldown de 30 segundos</strong> entre publicaciones para evitar spam'
  },

  // ── TAB: HISTORIAL ───────────────────────────────────────
  {
    sel: '[data-pftab="historial"]',
    title: '🕒 Pestaña: Historial de Publicaciones',
    body: 'Aquí ves <strong>todo lo que has publicado</strong>, con su estado actual. Si aún no has publicado nada verás un mensaje vacío. Cuando tengas publicaciones, cada una aparece como una tarjeta con sus estadísticas y opciones.',
    onEnter: function() {
      pfSwitchTab('historial', document.querySelector('[data-pftab="historial"]'));
    }
  },
  {
    sel: '#pf-showContent',
    title: '📦 Tus Publicaciones (Tarjetas)',
    body: 'Cada tarjeta de publicación muestra:<br>• Badge <strong style="color:#ffcc00">Pendiente</strong> (en revisión) o <strong style="color:#5EFF43">Aprobado</strong> (visible en la nube)<br>• Imagen de portada<br>• Título y categoría<br>• <strong>DL</strong> = descargas efectivas acumuladas<br>• <strong>LINK</strong> = estado del enlace en tiempo real<br>• <strong>REP</strong> = reportes recibidos (rojo si son 3 o más)<br>• Botones Editar y Borrar'
  },
  {
    sel: '#pf-showContent',
    title: '✏️ Editar y 🗑️ Borrar tus Publicaciones',
    body: 'En cada tarjeta del historial encontrarás:<br><br>• Botón <strong style="color:var(--cy)">✏️ Editar</strong> — abre un modal donde puedes actualizar el título, descripción, enlace, imagen y categoría. Las mismas reglas de palabras prohibidas y plataformas permitidas aplican exactamente igual que al publicar.<br><br>• Botón <strong style="color:#ff4343">🗑️ Borrar</strong> — elimina la publicación permanentemente (pide confirmación). No se puede deshacer.'
  },

  // ── TAB: BÓVEDA ─────────────────────────────────────────
  {
    sel: '[data-pftab="boveda"]',
    title: '🛡️ Pestaña: Bóveda (Favoritos)',
    body: 'Tu <strong>biblioteca personal</strong> de contenido guardado. Aquí aparecen todos los ítems que marcaste con ❤️ desde la biblioteca principal.',
    onEnter: function() { pfSwitchTab('boveda', document.querySelector('[data-pftab="boveda"]')); }
  },
  {
    sel: '#pf-vaultContent',
    title: '💎 Contenido de tu Bóveda',
    body: 'Cada ítem guardado muestra imagen, título y usuario creador. Tienes dos botones:<br>• <strong>Acceder</strong> (verde) — te lleva directamente al link de descarga<br>• <strong>Quitar</strong> (rojo) — elimina el ítem de tu bóveda<br><br>Los favoritos se sincronizan con el servidor, así que están disponibles en cualquier dispositivo donde inicies sesión.'
  },

  // ── TAB: REPORTES ────────────────────────────────────────
  {
    sel: '[data-pftab="reportes"]',
    title: '🚩 Pestaña: Mis Publicaciones Reportadas',
    body: 'Aquí verás las publicaciones tuyas que la comunidad ha reportado. Es importante atenderlas para mantener tu reputación.',
    onEnter: function() { pfSwitchTab('reportes', document.querySelector('[data-pftab="reportes"]')); }
  },
  {
    sel: '#pf-reportesContent',
    title: '⚠️ Detalle de los Reportes',
    body: 'Cada tarjeta de reporte muestra:<br>• Nombre de la publicación<br>• Total de reportes y desglose: <strong style="color:#ff4343">Link caído</strong> · <strong style="color:#ffaa00">Obsoleto</strong> · <strong style="color:#ff00ff">Malware</strong><br>• Estado actual del link (Online / Revisión / Caído)<br><br>Si tienes reportes, actualiza el link desde <strong>Historial → Editar</strong>. Más de 3 reportes ponen el contenido en revisión automáticamente.'
  },

  // ── TAB: ECONOMÍA ────────────────────────────────────────
  {
    sel: '[data-pftab="economia"]',
    title: '💰 Pestaña: Economía (Ganancias)',
    body: 'Aquí gestionas tus <strong>ganancias en UpGames</strong>. Por cada 1,000 descargas efectivas de tus aportes ganas $1.00 USD.',
    onEnter: function() { pfSwitchTab('economia', document.querySelector('[data-pftab="economia"]')); }
  },
  {
    sel: '.pf-saldo-box',
    title: '💵 Tu Saldo Disponible',
    body: 'Muestra tu <strong>saldo acumulado en USD</strong> listo para retirar. Se calcula automáticamente a partir de tus descargas efectivas.<br><br>Fórmula: Descargas ÷ 1000 × $1.00 USD'
  },
  {
    sel: '.pf-eco-stats',
    title: '📈 Estadísticas de Ganancias',
    body: 'Dos métricas clave:<br>• <strong>Descargas Totales</strong> — suma de todas las descargas en todos tus aportes<br>• <strong>Juegos con Ganancias</strong> — aportes que han generado al menos una descarga efectiva'
  },
  {
    sel: '.pf-paypal-row',
    title: '💳 Email de PayPal',
    body: 'Aquí configuras la <strong>cuenta PayPal donde recibirás tus pagos</strong>. Escribe tu email de PayPal y toca Guardar.<br><br>⚠️ Asegúrate de que el email sea el correcto. Los pagos van directamente a esa cuenta y no se pueden redirigir una vez enviados.'
  },
  {
    sel: '#pf-btn-solicitar-pago',
    title: '💸 Solicitar Pago',
    body: 'Cuando cumplas los requisitos, este botón se activará (se pone verde). Para cobrar necesitas:<br>• Saldo mínimo de <strong>$10 USD</strong><br>• Verificación nivel 1 o superior<br>• Al menos 1 aporte con descargas efectivas<br>• Email de PayPal configurado<br><br>Al solicitarlo, el equipo lo revisa en 24-72h y procesa el pago.'
  },
  {
    sel: '.pf-eco-info',
    title: '📋 Resumen de Requisitos',
    body: 'Este recuadro resume todo lo que necesitas para cobrar. Léelo si el botón de solicitar pago aún está desactivado.<br><br>¿Aún no tienes verificación? Sube contenido de calidad, mantén los links activos y evita reportes. El equipo otorga verificaciones automáticamente.'
  },

  // ── NEXUS Y TUTORIAL ────────────────────────────────────
  {
    sel: null,
    title: '🤖 NEXUS IA — Tu Asistente',
    body: 'El <strong>botón hexagonal verde</strong> en la esquina inferior derecha abre la IA integrada de UpGames. Puedes preguntarle:<br>• "¿Qué mods hay para Minecraft?"<br>• "Recomiéndame un juego de terror"<br>• "¿Cómo instalo un mod paso a paso?"<br>• Cualquier duda sobre la plataforma<br><br>Responde en segundos sin salir de la app.',
    onEnter: function() { switchTab('main'); }
  },
  {
    sel: '#nxFab',
    title: '🔮 Botón de NEXUS IA',
    body: 'Este es el botón de NEXUS. El efecto pulsante verde indica que está en línea. Tócalo para abrir el panel de chat con la IA. Puedes expandirlo a pantalla completa con el botón de expandir que aparece en la esquina del panel.'
  },
  {
    sel: '#tut-fab',
    title: '🎉 ¡Tutorial Completado!',
    body: 'Este botón <strong>?</strong> en la esquina inferior izquierda te permite <strong>volver a ver este tutorial</strong> en cualquier momento si necesitas repasar algo.<br><br>Ya conoces <strong>absolutamente todo</strong> lo que puedes hacer en UpGames. ¡Bienvenido a la comunidad! 🚀<br><br>Explora, descarga, sube tu contenido y ¡empieza a ganar!'
  }
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

// ── INIT ─────────────────────────────────────────────────
window.startBibliotecaTutorial = startTutorial;
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', loadContent);
} else { loadContent(); }

// ══════════════════════════════════════════════════════════════════
//  NEXUS ↔ UPGAMES — INTEGRACIÓN REAL
//  NEXUS puede ver lo que el usuario hace y actuar sobre el feed
// ══════════════════════════════════════════════════════════════════

const NEXUS_URL = 'https://nexus-production-781b.up.railway.app';

// ── 1. TRACKER DE EVENTOS ────────────────────────────────
// Envía eventos de comportamiento a NEXUS silenciosamente
function nexusTrack(tipo, datos = {}) {
  const usuario = LS.get('user_admin');
  if (!usuario) return; // sin sesión no hay perfil que construir
  try {
    fetch(`${NEXUS_URL}/api/upgames/evento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, tipo, datos, ts: new Date().toISOString() })
    }).catch(() => {}); // nunca bloquear la UI
  } catch(_) {}
}

// ── 2. INTERCEPTAR BÚSQUEDAS ────────────────────────────
// El input del buscador ya tiene listener con debounce — lo extendemos
const _buscadorEl = document.getElementById('buscador');
if (_buscadorEl) {
  _buscadorEl.addEventListener('input', function() {
    const q = this.value.trim();
    if (q.length > 2) {
      // Trackear búsqueda con debounce extra para no spamear
      clearTimeout(window._nxSearchTimer);
      window._nxSearchTimer = setTimeout(() => nexusTrack('search', { query: q }), 800);
    }
  });
}

// ── 3. INTERCEPTAR APERTURA DE DETALLE (view) ───────────
// Wrappear openDetail para capturar qué item vio el usuario
const _openDetailOriginal = window.openDetail || openDetail;
let _viewStartTime = null;
let _viewItemId    = null;

window.openDetail = function(item) {
  _openDetailOriginal(item);
  _viewStartTime = Date.now();
  _viewItemId    = item._id;
  nexusTrack('view', {
    itemId:   item._id,
    title:    item.title,
    category: item.category || '',
    tags:     item.tags     || []
  });
};

// Cuando cierra el detalle, registrar cuántos segundos estuvo
const _closeDetailOriginal = window.closeDetail || closeDetail;
window.closeDetail = function() {
  _closeDetailOriginal();
  if (_viewItemId && _viewStartTime) {
    const segundos = Math.round((Date.now() - _viewStartTime) / 1000);
    if (segundos > 2) {
      // Actualizar el evento view con el tiempo real
      nexusTrack('view', {
        itemId:  _viewItemId,
        segundos
      });
    }
    _viewItemId = null; _viewStartTime = null;
  }
};

// ── 4. INTERCEPTAR FAVORITOS ─────────────────────────────
const _favOriginal = window.fav || fav;
window.fav = async function(id) {
  await _favOriginal(id);
  // Detectar si se agregó o se quitó leyendo el estado local actualizado
  const favIds = LS.getJSON('favoritos', []);
  const item   = todosLosItems.find(i => i._id === id);
  if (!item) return;
  const tipo = favIds.includes(id) ? 'favorite' : 'unfavorite';
  nexusTrack(tipo, {
    itemId:   item._id,
    title:    item.title,
    category: item.category || '',
    tags:     item.tags     || []
  });
};

// ── 5. INTERCEPTAR CAMBIO DE CATEGORÍA ──────────────────
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', function() {
    const cat = this.dataset.cat;
    if (cat) nexusTrack('category', { category: cat });
  });
});

// ── 6. CARGAR PERFIL Y REORDENAR FEED ───────────────────
// Al cargar la página, consultar a NEXUS el perfil del usuario
// y reordenar el feed manteniendo la jerarquía existente
let _nexusPerfil = null;

async function nexusCargarPerfil() {
  const usuario = LS.get('user_admin');
  if (!usuario) return;
  try {
    const r = await fetch(`${NEXUS_URL}/api/upgames/perfil/${encodeURIComponent(usuario)}`);
    if (!r.ok) return;
    const perfil = await r.json();
    if (!perfil || !perfil.categorias?.length) return;
    _nexusPerfil = perfil;
    nexusAplicarPerfil(perfil);
  } catch(_) {}
}

function nexusAplicarPerfil(perfil) {
  if (!perfil?.categorias?.length || !todosLosItems.length) return;

  // Mapa de peso por categoría (normalizado 0–10)
  const maxPeso = perfil.categorias[0]?.peso || 1;
  const pesoMap = {};
  perfil.categorias.forEach(c => {
    pesoMap[c.nombre] = (c.peso / maxPeso) * 10;
  });

  // Mapa de peso por tag
  const maxTagCount = perfil.tags[0]?.count || 1;
  const tagMap = {};
  perfil.tags.forEach(t => {
    tagMap[t.tag] = (t.count / maxTagCount) * 5;
  });

  // Set de items ya vistos/descargados recientemente (bajarlos en el feed)
  const recientesSet = new Set((perfil.recientes || []).map(r => r.itemId));

  // Reordenar: los top 3 por scoreRecomendacion se quedan fijos (jerarquía)
  // El resto se ordena con puntuación NEXUS
  const TOP_FIJOS = 3;
  const fijos = todosLosItems.slice(0, TOP_FIJOS);
  const resto  = todosLosItems.slice(TOP_FIJOS);

  const restoOrdenado = resto.map(item => {
    const puntoCat  = pesoMap[item.category]       || 0;
    const puntoTags = (item.tags || []).reduce((acc, t) => acc + (tagMap[t] || 0), 0);
    const penalizar = recientesSet.has(item._id) ? -3 : 0; // bajar ya vistos
    return {
      ...item,
      _nexusScore: (item.scoreRecomendacion || 0) + puntoCat + puntoTags + penalizar
    };
  }).sort((a, b) => b._nexusScore - a._nexusScore);

  // Actualizar el array global sin borrar la lista original
  todosLosItems = [...fijos, ...restoOrdenado];

  // Re-renderizar solo si estamos en el tab principal y sin búsqueda activa
  const query = document.getElementById('buscador')?.value?.trim() || '';
  if (currentTab === 'main' && !query) {
    filteredItems = activeCategory
      ? todosLosItems.filter(i => i.category === activeCategory)
      : todosLosItems.filter(i => i.category !== 'Video');
    render(filteredItems);
  }
}

// ── 7. RECEPTOR DE MENSAJES DEL IFRAME DE NEXUS ─────────
// NEXUS puede mandar instrucciones desde el widget al feed
window.addEventListener('message', function(event) {
  // Solo aceptar mensajes del iframe de NEXUS
  if (!event.origin.includes('nexus-production-781b.up.railway.app')) return;
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {

    // NEXUS recomienda reordenar por una categoría específica
    case 'NX_FILTER_CATEGORY': {
      const cat = msg.category;
      if (!cat) return;
      // Activar el chip de categoría visualmente
      document.querySelectorAll('.chip').forEach(c => {
        c.classList.toggle('active', c.dataset.cat === cat);
      });
      activeCategory = cat;
      document.getElementById('buscador').value = '';
      filteredItems = todosLosItems.filter(i => i.category === cat);
      render(filteredItems);
      break;
    }

    // NEXUS pide limpiar filtros y mostrar todo
    case 'NX_SHOW_ALL': {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      activeCategory = '';
      document.getElementById('buscador').value = '';
      filteredItems = todosLosItems.filter(i => i.category !== 'Video');
      render(filteredItems);
      break;
    }

    // NEXUS manda lista de IDs recomendados para mostrar primero
    case 'NX_HIGHLIGHT_ITEMS': {
      const ids = msg.itemIds;
      if (!Array.isArray(ids) || !ids.length) return;
      const idSet = new Set(ids);
      const pool = activeCategory === 'Video'
        ? todosLosItems
        : todosLosItems.filter(i => i.category !== 'Video');
      const destacados = pool.filter(i => idSet.has(i._id));
      const resto       = pool.filter(i => !idSet.has(i._id));
      filteredItems = [...destacados, ...resto];
      render(filteredItems);
      // Toast sutil para el usuario
      toast('🤖 NEXUS personalizó tu feed');
      break;
    }

    // NEXUS pide abrir el detalle de un juego específico
    case 'NX_OPEN_ITEM': {
      const item = todosLosItems.find(i => i._id === msg.itemId);
      if (item) window.openDetail(item);
      break;
    }

    // NEXUS confirma que recibió el perfil del usuario (debug)
    case 'NX_READY':
      console.log('[NEXUS] Widget listo y conectado al feed');
      break;
  }
});

// ── 8. ENVIAR CONTEXTO AL IFRAME + MENSAJE PROACTIVO ────
// Al abrir el widget: (1) enviar contexto del feed,
// (2) pedir a NEXUS que inicie la conversación (una vez por sesión de pestaña)

let _nxSessionGreeted = false; // NEXUS solo saluda una vez por sesión de pestaña

const _nxToggleOriginal = window.nxToggle;
window.nxToggle = function() {
  _nxToggleOriginal();
  if (nxOpen) {
    const usuario = LS.get('user_admin');
    const frame   = document.getElementById('nxFrame');
    if (!frame || !usuario) return;

    const enviarContexto = () => {
      try {
        // (1) Enviar contexto del feed
        frame.contentWindow.postMessage({
          type:     'UPGAMES_CONTEXT',
          usuario,
          feedActual: filteredItems.slice(0, 20).map(i => ({
            _id:       i._id,
            title:     i.title,
            category:  i.category || '',
            tags:      i.tags     || [],
            descargas: i.descargasEfectivas || 0
          })),
          categoriaActiva: activeCategory || null,
          busquedaActiva:  document.getElementById('buscador')?.value?.trim() || null
        }, 'https://nexus-production-781b.up.railway.app');

        // (2) Pedir mensaje proactivo — solo la primera vez en esta pestaña
        if (!_nxSessionGreeted) {
          _nxSessionGreeted = true;
          setTimeout(() => {
            try {
              frame.contentWindow.postMessage(
                { type: 'NX_REQUEST_PROACTIVE' },
                'https://nexus-production-781b.up.railway.app'
              );
            } catch(_) {}
          }, 600);
        }
      } catch(_) {}
    };

    if (frame.contentDocument?.readyState === 'complete') {
      enviarContexto();
    } else {
      frame.addEventListener('load', enviarContexto, { once: true });
    }
  }
};

// ── Escuchar respuesta proactiva de NEXUS y mostrar badge en el FAB ─
window.addEventListener('message', function _nxProactiveReceiver(event) {
  if (!event.origin.includes('nexus-production-781b.up.railway.app')) return;
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'NX_PROACTIVE_SENT' && msg.message) {
    if (!nxOpen) _showNxFabBadge();
  }
});

// Badge visual en el FAB de NEXUS cuando tiene algo que decir
let _nxFabBadgeEl = null;
function _showNxFabBadge() {
  const fab = document.getElementById('nxFab');
  if (!fab || _nxFabBadgeEl) return;
  _nxFabBadgeEl = document.createElement('span');
  _nxFabBadgeEl.id = 'nx-fab-badge';
  _nxFabBadgeEl.style.cssText = `
    position:absolute;top:-3px;right:-3px;
    width:14px;height:14px;border-radius:50%;
    background:var(--g,#5EFF43);border:2px solid var(--bg,#07070f);
    animation:nx-badge-pulse 1.5s ease-in-out infinite;
    pointer-events:none;z-index:1;
  `;
  if (!document.getElementById('nx-badge-style')) {
    const st = document.createElement('style');
    st.id = 'nx-badge-style';
    st.textContent = `@keyframes nx-badge-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:.7}}`;
    document.head.appendChild(st);
  }
  fab.style.position = 'relative';
  fab.appendChild(_nxFabBadgeEl);
}
function _clearNxFabBadge() {
  if (_nxFabBadgeEl) { _nxFabBadgeEl.remove(); _nxFabBadgeEl = null; }
}

// Quitar badge al abrir el panel
const _origToggleForBadge = window.nxToggle;
window.nxToggle = function() {
  _origToggleForBadge();
  if (nxOpen) _clearNxFabBadge();
};

// ── 9. INIT: cargar perfil al arrancar (500ms de delay para no
//    interferir con la carga inicial del feed)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  NEXUS MASCOT — Activar widget al cargar UpGames
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
setTimeout(nexusCargarPerfil, 2000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  NEXUS MASCOT — Activar widget al cargar UpGames
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(function notifyNexusMascot() {
  function doNotify() {
    const frame = document.getElementById('nxFrame');
    if (!frame) return;
    function send() {
      try {
        frame.contentWindow.postMessage(
          { type: 'upgames_active', context: 'biblioteca' },
          'https://nexus-production-781b.up.railway.app'
        );
      } catch(_) {}
    }
    if (frame.contentDocument && frame.contentDocument.readyState === 'complete') {
      send();
    } else {
      frame.addEventListener('load', send, { once: true });
    }
  }
  // Ejecutar al cargar la página
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doNotify);
  } else {
    doNotify();
  }
  // También disparar cuando el usuario abre el panel de NEXUS
  const _origNxToggle = window.nxToggle;
  if (typeof _origNxToggle === 'function') {
    window.nxToggle = function() {
      _origNxToggle.apply(this, arguments);
      setTimeout(doNotify, 800);
    };
  }
})();

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
    <div class="autoplay-next-title">${nextItem.title}</div>
    <div class="autoplay-related">
      ${related.map((v,i) => {
        const thumb = v.image || 'https://via.placeholder.com/88x50/07070f/00f2ff?text=▶';
        return `<div class="autoplay-rel-thumb" data-id="${v._id}">
          <img src="${thumb}" alt="${v.title}" onerror="this.src='https://via.placeholder.com/88x50/07070f/00f2ff?text=▶'">
          <span>${v.title}</span>
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
  const isMp42 = /\.(mp4|webm|mov|avi)(\?.*)?$/i.test(item.link);

  if(isYT2) {
    const ytId = getYouTubeId(item.link);
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${ytId}?autoplay=1&controls=1&rel=0&playsinline=1`;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    wrap.appendChild(iframe);
  } else if(isMp42) {
    const nv = document.createElement('video');
    nv.src = item.link;
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
    <span>@${item.usuario||'Cloud'}</span>
    ${item.videoType ? `<span>· ${item.videoType}</span>` : ''}
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
//  SISTEMA DE NOTIFICACIONES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _notifPanel = null;
let _notifBadge = null;

// Crear el botón y panel de notificaciones en el DOM
function _initNotifUI() {
  // Botón de campana en el header
  const hdrActions = document.querySelector('.hdr-actions');
  if (!hdrActions || document.getElementById('notif-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'hdr-btn';
  btn.id = 'notif-btn';
  btn.title = 'Notificaciones';
  btn.setAttribute('aria-label', 'Notificaciones');
  btn.innerHTML = `
    <ion-icon name="notifications-outline"></ion-icon>
    <span id="notif-badge" style="
      display:none;position:absolute;top:2px;right:2px;
      background:#5EFF43;color:#000;font-size:9px;font-weight:900;
      border-radius:50%;width:16px;height:16px;
      line-height:16px;text-align:center;pointer-events:none;
    ">0</span>
  `;
  btn.style.position = 'relative';
  btn.onclick = () => _toggleNotifPanel();
  hdrActions.insertBefore(btn, hdrActions.firstChild);
  _notifBadge = document.getElementById('notif-badge');

  // Panel desplegable
  const panel = document.createElement('div');
  panel.id = 'notif-panel';
  panel.style.cssText = `
    display:none;position:fixed;top:56px;right:12px;
    width:min(340px,calc(100vw - 24px));
    max-height:420px;overflow-y:auto;
    background:#111;border:1px solid #222;border-radius:16px;
    box-shadow:0 8px 32px rgba(0,0,0,.6);z-index:999;
    font-family:inherit;
  `;
  panel.innerHTML = `
    <div style="padding:12px 14px 10px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1e1e1e;gap:8px;">
      <span style="font-size:.82rem;font-weight:700;color:#fff;letter-spacing:.5px;">NOTIFICACIONES</span>
      <div style="display:flex;gap:6px;align-items:center;">
        <button onclick="_marcarTodasLeidas()" style="background:none;border:none;color:#5EFF43;font-size:.7rem;cursor:pointer;font-weight:700;padding:4px 8px;border-radius:7px;transition:background .15s;" onmouseover="this.style.background='rgba(94,255,67,.1)'" onmouseout="this.style.background='none'">✓ Leídas</button>
        <button onclick="_eliminarTodasNotif()" style="background:none;border:none;color:#ff4343;font-size:.7rem;cursor:pointer;font-weight:700;padding:4px 8px;border-radius:7px;transition:background .15s;" onmouseover="this.style.background='rgba(255,67,67,.1)'" onmouseout="this.style.background='none'">🗑 Vaciar</button>
      </div>
    </div>
    <div id="notif-list" style="padding:8px 0;"></div>
  `;
  document.body.appendChild(panel);
  _notifPanel = panel;

  // Cerrar al tocar fuera
  document.addEventListener('click', (e) => {
    if (_notifPanel && _notifPanel.style.display !== 'none') {
      if (!_notifPanel.contains(e.target) && e.target.id !== 'notif-btn' && !btn.contains(e.target)) {
        _notifPanel.style.display = 'none';
      }
    }
  });
}

function _toggleNotifPanel() {
  if (!_notifPanel) return;
  const visible = _notifPanel.style.display !== 'none';
  _notifPanel.style.display = visible ? 'none' : 'block';
  if (!visible) _cargarNotificaciones();
}

async function _cargarNotificaciones() {
  const usuario = LS.get('user_admin');
  const token   = LS.get('token');
  if (!usuario || !token) return;

  try {
    const r = await fetch(`${API_URL}/notificaciones/${usuario}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return;
    const data = await r.json();
    if (!data.success) return;

    // Actualizar badge
    _updateNotifBadge(data.noLeidas || 0);

    // Renderizar lista
    const list = document.getElementById('notif-list');
    if (!list) return;

    if (!data.notificaciones || data.notificaciones.length === 0) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:#555;font-size:.8rem;">Sin notificaciones</div>`;
      return;
    }

    list.innerHTML = data.notificaciones.map(n => {
      const timeAgo = _timeAgo(new Date(n.fecha));
      const unread  = !n.leida;
      const nId     = n._id || '';
      return `
        <div style="
            display:flex;align-items:center;gap:10px;
            padding:10px 14px;
            background:${unread ? 'rgba(94,255,67,.05)' : 'transparent'};
            border-left:${unread ? '3px solid #5EFF43' : '3px solid transparent'};
            transition:background .2s;
            position:relative;
          "
          onmouseover="this.style.background='rgba(255,255,255,.04)';this.querySelector('.notif-del-btn').style.opacity='1'"
          onmouseout="this.style.background='${unread ? 'rgba(94,255,67,.05)' : 'transparent'}';this.querySelector('.notif-del-btn').style.opacity='0'">
          <div onclick="_abrirItemDesdeNotif('${n.itemId}')" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer;">
            ${n.itemImage
              ? `<img src="${n.itemImage}" style="width:44px;height:32px;object-fit:cover;border-radius:6px;flex-shrink:0;"
                  onerror="this.style.display='none'">`
              : `<div style="width:44px;height:32px;background:#1a1a1a;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
                   <ion-icon name="game-controller" style="color:#555;font-size:.9rem;"></ion-icon>
                 </div>`
            }
            <div style="flex:1;min-width:0;">
              <div style="font-size:.78rem;color:${unread ? '#fff' : '#aaa'};font-weight:${unread ? '600' : '400'};
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${n.tipo === 'sistema' && n.itemTitle?.startsWith('Mensaje')
                  ? `<span style="color:#00f2ff">@${n.emisor}</span> te envió un mensaje`
                  : `<span style="color:#5EFF43">@${n.emisor}</span> publicó`}
              </div>
              <div style="font-size:.74rem;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${n.itemTitle || 'Nueva publicación'}
              </div>
            </div>
            <span style="font-size:.68rem;color:#444;flex-shrink:0;margin-right:4px;">${timeAgo}</span>
          </div>
          <button class="notif-del-btn" onclick="event.stopPropagation();_eliminarNotif('${nId}',this)" 
            title="Eliminar notificación"
            style="opacity:0;flex-shrink:0;background:rgba(255,67,67,.12);border:none;color:#ff4343;
              width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:.75rem;
              display:flex;align-items:center;justify-content:center;transition:opacity .2s,background .15s;"
            onmouseover="this.style.background='rgba(255,67,67,.25)'"
            onmouseout="this.style.background='rgba(255,67,67,.12)'">✕</button>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.warn('[Notif] Error cargando:', err);
  }
}

async function _marcarTodasLeidas() {
  const usuario = LS.get('user_admin');
  const token   = LS.get('token');
  if (!usuario || !token) return;
  try {
    await fetch(`${API_URL}/notificaciones/marcar-leidas/${usuario}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    _updateNotifBadge(0);
    _cargarNotificaciones();
  } catch (err) {
    console.warn('[Notif] Error marcando leídas:', err);
  }
}

// Eliminar una notificación individual
async function _eliminarNotif(notifId, btnEl) {
  if (!notifId) return;
  const usuario = LS.get('user_admin');
  const token   = LS.get('token');
  if (!usuario || !token) return;
  try {
    // Animación de salida
    const row = btnEl.parentElement;
    row.style.transition = 'opacity .2s, max-height .25s';
    row.style.opacity = '0';
    row.style.maxHeight = '0';
    row.style.overflow = 'hidden';
    await fetch(`${API_URL}/notificaciones/${notifId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    setTimeout(() => { row.remove(); }, 260);
    // Actualizar badge
    _pollNotifBadge();
  } catch (err) {
    console.warn('[Notif] Error eliminando:', err);
  }
}

// Vaciar todas las notificaciones
async function _eliminarTodasNotif() {
  const usuario = LS.get('user_admin');
  const token   = LS.get('token');
  if (!usuario || !token) return;
  const list = document.getElementById('notif-list');
  if (list) {
    list.style.transition = 'opacity .2s';
    list.style.opacity = '0';
  }
  try {
    await fetch(`${API_URL}/notificaciones/todas/${usuario}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    _updateNotifBadge(0);
    setTimeout(() => {
      if (list) {
        list.style.opacity = '1';
        list.innerHTML = `<div style="padding:24px;text-align:center;color:#555;font-size:.8rem;">Sin notificaciones</div>`;
      }
    }, 220);
  } catch (err) {
    console.warn('[Notif] Error vaciando:', err);
    if (list) list.style.opacity = '1';
  }
}

async function _abrirItemDesdeNotif(itemId) {
  if (!itemId) return;
  if (_notifPanel) _notifPanel.style.display = 'none';
  // Buscar en items cargados
  const item = todosLosItems.find(i => i._id === itemId);
  if (item) {
    openDetail(item);
    return;
  }
  // Si no está en caché, fetch directo
  try {
    const r = await fetch(`${API_URL}/items/${itemId}`);
    if (r.ok) {
      const data = await r.json();
      if (data && data._id) openDetail(data);
    }
  } catch (err) { console.warn('[Notif] Error abriendo item:', err); }
}

function _updateNotifBadge(count) {
  if (!_notifBadge) return;
  if (count > 0) {
    _notifBadge.style.display = 'block';
    _notifBadge.textContent = count > 99 ? '99+' : count;
  } else {
    _notifBadge.style.display = 'none';
  }
}

async function _pollNotifBadge() {
  const usuario = LS.get('user_admin');
  const token   = LS.get('token');
  if (!usuario || !token) return;
  try {
    const r = await fetch(`${API_URL}/notificaciones/count/${usuario}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (r.ok) {
      const data = await r.json();
      if (data.success) _updateNotifBadge(data.noLeidas || 0);
    }
  } catch (_) {}
}

function _timeAgo(date) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60)     return 'ahora';
  if (diff < 3600)   return `${Math.floor(diff/60)}m`;
  if (diff < 86400)  return `${Math.floor(diff/3600)}h`;
  return `${Math.floor(diff/86400)}d`;
}

// Inicializar notificaciones cuando el usuario esté logueado
window.addEventListener('load', () => {
  setTimeout(() => {
    const usuario = LS.get('user_admin');
    if (usuario) {
      _initNotifUI();
      _pollNotifBadge();
      // Polling cada 60 segundos
      setInterval(_pollNotifBadge, 60000);
    }
  }, 1500);
});

// También inicializar si el tab de perfil se activa (por si acaba de hacer login)
const _origSwitchTab = window.switchTab;
window.switchTab = function(tab) {
  if (typeof _origSwitchTab === 'function') _origSwitchTab(tab);
  if (tab === 'main') {
    setTimeout(() => {
      if (!document.getElementById('notif-btn') && LS.get('user_admin')) {
        _initNotifUI();
        _pollNotifBadge();
      }
    }, 300);
  }
};