/* ═══════════════════════════════════════════════════════════════
   UpGames · Videos en scroll infinito vertical (estilo feed corto)
   ───────────────────────────────────────────────────────────────
   Al entrar a la categoría Video (o abrir un video) se abre un feed a
   pantalla completa: un video por pantalla, deslizar para el siguiente,
   reproducción automática y lista infinita (al llegar al final se vuelve
   a mezclar el catálogo de videos y sigue).
   • Toque: pausa / reproduce · Doble toque: me gusta con corazones.
   • Pantalla tipo consola UpGames: autor (+ seguir) junto al título y
     barra inferior con me gusta, comentarios, compartir, publicación
     destacada, progreso arrastrable y tiempo.
   • Solo el video visible y sus vecinos tienen el archivo cargado.
   • Atrás del celular, Escape o ✕ cierran el feed.
   Depende de script.js: API_URL, LS, todosLosItems, fav(), registrarVista(),
   getYouTubeId(), ugVideoSrc(), ugVideoThumb(), ugEsVideoArchivo(), toast().
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const API = (typeof API_URL !== 'undefined' && API_URL) || 'https://upgames-production.up.railway.app';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = n => { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'K' : String(n); };
  const yo = () => (typeof LS !== 'undefined' ? LS.get('user_admin', '') : '');
  const tok = () => (typeof LS !== 'undefined' ? LS.get('token', '') : '');
  const vistas = it => (it.vistas || 0) + (it.descargasEfectivas || 0);
  const esYT = it => typeof getYouTubeId === 'function' && !!getYouTubeId(it.link || '');
  const esArchivo = it => typeof ugEsVideoArchivo === 'function' && ugEsVideoArchivo(it.link || '');
  const poster = it => {
    if (it.image && !/\.(mp4|webm|mov)(\?|$)|\/video\/upload\//i.test(it.image)) return it.image;
    if (esYT(it)) return `https://i.ytimg.com/vi/${getYouTubeId(it.link)}/hqdefault.jpg`;
    return (typeof ugVideoThumb === 'function' && ugVideoThumb(it.link)) || '';
  };

  let raiz, lista, slides = [], base = [], orden = 'parati', activo = -1, abierto = false, sonido = true;
  let musicaSonaba = false, io = null, siguiendo = new Map();

  /* ── Construcción ── */
  function montar() {
    if (raiz) return;
    raiz = document.createElement('div');
    raiz.id = 'ugv'; raiz.setAttribute('role', 'dialog'); raiz.setAttribute('aria-label', 'Videos');
    raiz.innerHTML = `
      <div class="ugv-top">
        <button type="button" class="ugv-ic ugv-cerrar" aria-label="Cerrar videos"><ion-icon name="chevron-back"></ion-icon></button>
        <div class="ugv-canal">
          <div class="ugv-tabs" role="tablist"><button type="button" class="on" data-o="parati" role="tab">Para ti</button><button type="button" data-o="populares" role="tab">Top</button></div>
          <div class="ugv-hud" aria-hidden="true"><i></i>UP//VIDEO <span class="ugv-cnt">#01</span></div>
        </div>
        <button type="button" class="ugv-ic ugv-son" aria-label="Sonido"><ion-icon name="volume-high"></ion-icon></button>
      </div>
      <div class="ugv-lista" tabindex="0"></div>
      <div class="ugv-avisoson" hidden><ion-icon name="volume-mute"></ion-icon> Toca para activar el sonido</div>
      <div class="ugv-com" aria-hidden="true">
        <div class="ugv-com-fondo"></div>
        <div class="ugv-com-hoja">
          <div class="ugv-com-h"><b>Comentarios</b><span class="ugv-com-n"></span><button type="button" class="ugv-ic ugv-com-x" aria-label="Cerrar comentarios"><ion-icon name="close"></ion-icon></button></div>
          <div class="ugv-com-lista"></div>
          <form class="ugv-com-in"><input type="text" maxlength="500" placeholder="Añade un comentario…" aria-label="Comentario"><button type="submit" aria-label="Enviar"><ion-icon name="send"></ion-icon></button></form>
        </div>
      </div>`;
    document.body.appendChild(raiz);
    lista = $('.ugv-lista', raiz);
    $('.ugv-cerrar', raiz).onclick = () => cerrar();
    $('.ugv-son', raiz).onclick = () => setSonido(!sonido);
    $('.ugv-avisoson', raiz).onclick = () => setSonido(true);
    raiz.querySelectorAll('.ugv-tabs [data-o]').forEach(b => b.onclick = () => { if (b.dataset.o !== orden) { orden = b.dataset.o; raiz.querySelectorAll('.ugv-tabs [data-o]').forEach(x => x.classList.toggle('on', x === b)); reiniciar(); } });
    $('.ugv-com-fondo', raiz).onclick = () => comentarios(false);
    $('.ugv-com-x', raiz).onclick = () => comentarios(false);
    $('.ugv-com-in', raiz).onsubmit = e => { e.preventDefault(); comentar(); };
    io = new IntersectionObserver(ents => {
      ents.forEach(en => { if (en.isIntersecting && en.intersectionRatio >= .6) activar(+en.target.dataset.i); });
    }, { root: lista, threshold: [.6] });
    lista.addEventListener('scroll', () => { if (activo >= slides.length - 3) agregarRonda(); }, { passive: true });
    document.addEventListener('keydown', e => {
      if (!abierto || /input|textarea/i.test(e.target.tagName)) return;
      if (e.key === 'Escape') { if (raiz.classList.contains('com-on')) comentarios(false); else cerrar(); }
      else if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); ir(activo + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); ir(activo - 1); }
      else if (e.key === ' ') { e.preventDefault(); alternar(); }
      else if (e.key === 'm') setSonido(!sonido);
    });
    addEventListener('popstate', () => { if (abierto) cerrar(true); });
    document.addEventListener('visibilitychange', () => { if (!abierto) return; const s = slides[activo]; if (!s) return; document.hidden ? pausar(s) : reproducir(s); });
  }

  /* ── Datos ── */
  async function cargarVideos() {
    let todos = (typeof todosLosItems !== 'undefined' && Array.isArray(todosLosItems) ? todosLosItems : []).filter(i => i && i.category === 'Video');
    try {
      const r = await fetch(`${API}/items?categoria=Video`);
      if (r.ok) { const d = await r.json(); const m = new Map(todos.map(i => [i._id, i])); (Array.isArray(d) ? d : []).forEach(i => { if (i.category === 'Video' && !m.has(i._id)) m.set(i._id, i); }); todos = [...m.values()]; }
    } catch (_) {}
    return todos.filter(i => i.link && (esYT(i) || esArchivo(i)));
  }
  function mezclar(arr) {
    const a = [...arr];
    if (orden === 'populares') return a.sort((x, y) => (vistas(y) + (y.likesCount || 0) * 5) - (vistas(x) + (x.likesCount || 0) * 5));
    // "Para ti": mezcla ponderada por calidad (más vistas/likes y más recientes, más arriba), con azar
    return a.map(i => ({ i, k: Math.random() * (1 + Math.log10(1 + vistas(i) + (i.likesCount || 0) * 5)) * (Date.now() - new Date(i.createdAt || 0) < 14 * 864e5 ? 1.6 : 1) }))
      .sort((x, y) => y.k - x.k).map(x => x.i);
  }
  function agregarRonda() {
    if (!base.length) return;
    let ronda = mezclar(base);
    const ult = slides[slides.length - 1]?.item;
    if (ult && ronda.length > 1 && ronda[0]._id === ult._id) ronda.push(ronda.shift());   // nunca el mismo video dos veces seguidas
    if (orden === 'populares' && slides.length) ronda = mezclar(base).sort(() => Math.random() - .5);   // tras la primera ronda, mezcla
    ronda.forEach(it => crearSlide(it));
  }

  /* ── Slides ── */
  function crearSlide(it) {
    const i = slides.length, autor = String(it.usuario || 'upgames');
    const el = document.createElement('section');
    el.className = 'ugv-s'; el.dataset.i = i;
    const p = poster(it);
    el.innerHTML = `
      <div class="ugv-fondo" style="${p ? `background-image:url('${esc(p)}')` : ''}"></div>
      <div class="ugv-pantalla">
        <div class="ugv-media"></div>
        <div class="ugv-velo"></div>
        <i class="ugv-esq" aria-hidden="true"></i>
      </div>
      <div class="ugv-play" aria-hidden="true"><ion-icon name="play"></ion-icon><b>Pausa</b></div>
      <div class="ugv-info">
        <div class="ugv-quien">
          <button type="button" class="ugv-av" data-a="perfil" aria-label="Perfil de @${esc(autor)}"><span class="ugv-av-hx">${esc(autor[0].toUpperCase())}</span></button>
          <button type="button" class="ugv-autor" data-a="perfil">@${esc(autor)}</button>
          <button type="button" class="ugv-seg" data-a="seguir">Seguir</button>
        </div>
        <div class="ugv-tit">${esc(it.title || '')}</div>
        ${it.description ? `<div class="ugv-desc">${esc(it.description)}</div>` : ''}
        <div class="ugv-meta">${it.videoType ? `<span class="ugv-tag">${esc(it.videoType)}</span>` : ''}<span><ion-icon name="eye"></ion-icon>${nf(vistas(it))}</span></div>
      </div>
      <nav class="ugv-dock" aria-label="Acciones del video">
        <div class="ugv-prog"><i></i></div>
        <button type="button" class="ugv-btn ugv-like" data-a="like" aria-label="Me gusta"><ion-icon name="heart"></ion-icon><b>${nf(it.likesCount)}</b></button>
        <button type="button" class="ugv-btn" data-a="com" aria-label="Comentarios"><ion-icon name="chatbubble-ellipses"></ion-icon><b class="ugv-ncom">·</b></button>
        <button type="button" class="ugv-btn" data-a="compartir" aria-label="Compartir"><ion-icon name="arrow-redo"></ion-icon></button>
        ${it.featuredItemId ? `<button type="button" class="ugv-btn ugv-bajar" data-a="destacada" aria-label="Ver publicación"><ion-icon name="cloud-download"></ion-icon><b>Obtener</b></button>` : ''}
        <span class="ugv-t">${esYT(it) ? 'YT' : '0:00'}</span>
      </nav>`;
    lista.appendChild(el);
    const s = { el, item: it, media: null, video: null, yt: null, cargado: false, pausadoUsuario: false };
    slides.push(s);
    pintarLike(s);
    el.addEventListener('click', e => accion(e, s));
    // toque / doble toque sobre el video
    let ultimo = 0, tmr = null;
    el.addEventListener('pointerup', e => {
      if (e.target.closest('.ugv-dock, .ugv-info button, .ugv-desc')) return;
      const ahora = Date.now();
      if (ahora - ultimo < 280) { clearTimeout(tmr); ultimo = 0; corazones(s, e.clientX, e.clientY); if (!esFav(it._id)) darLike(s); return; }
      ultimo = ahora; tmr = setTimeout(() => alternar(), 280);
    });
    $('.ugv-desc', el)?.addEventListener('click', ev => { ev.stopPropagation(); ev.currentTarget.classList.toggle('abierta'); });
    progreso(s);
    io.observe(el);
    return s;
  }

  function cargar(s) {
    if (s.cargado) return; s.cargado = true;
    const m = $('.ugv-media', s.el), it = s.item;
    if (esYT(it)) {
      const id = getYouTubeId(it.link);
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=0&mute=1&controls=0&loop=1&playlist=${id}&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&iv_load_policy=3`;
      f.allow = 'autoplay; encrypted-media; picture-in-picture'; f.title = it.title || 'Video';
      m.appendChild(f); s.yt = f;
    } else {
      const v = document.createElement('video');
      v.playsInline = true; v.loop = true; v.preload = 'auto'; v.muted = true;
      v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      const p = poster(it); if (p) v.poster = p;
      v.src = ugVideoSrc(it.link);
      const t = $('.ugv-t', s.el), mmss = x => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
      v.addEventListener('timeupdate', () => { const b = $('.ugv-prog i', s.el); if (b && v.duration) { b.style.transform = `scaleX(${v.currentTime / v.duration})`; t.textContent = `${mmss(v.currentTime)} / ${mmss(v.duration)}`; } });
      v.addEventListener('waiting', () => s.el.classList.add('cargando')); v.addEventListener('playing', () => s.el.classList.remove('cargando'));
      m.appendChild(v); s.video = v;
    }
  }
  function descargar(s) {
    if (!s.cargado) return; s.cargado = false;
    if (s.video) { s.video.pause(); s.video.removeAttribute('src'); s.video.load(); }
    $('.ugv-media', s.el).innerHTML = ''; s.video = null; s.yt = null;
  }
  const ytCmd = (s, func, args = []) => { try { s.yt?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*'); } catch (_) {} };
  function reproducir(s) {
    if (!s || s.pausadoUsuario) return;
    s.el.classList.remove('pausado');
    if (s.video) {
      s.video.muted = !sonido;
      s.video.play().catch(() => { s.video.muted = true; s.video.play().catch(() => {}); if (sonido) avisoSonido(true); });
    } else if (s.yt) {
      const go = () => { ytCmd(s, sonido ? 'unMute' : 'mute'); ytCmd(s, 'playVideo'); };
      go(); s.yt.addEventListener('load', go, { once: true });
    }
  }
  function pausar(s) { if (!s) return; s.video?.pause(); ytCmd(s, 'pauseVideo'); }
  function alternar() {
    const s = slides[activo]; if (!s) return;
    s.pausadoUsuario = !s.pausadoUsuario;
    s.el.classList.toggle('pausado', s.pausadoUsuario);
    s.el.classList.remove('pulso'); void s.el.offsetWidth; s.el.classList.add('pulso');
    s.pausadoUsuario ? pausar(s) : reproducir(s);
  }

  function activar(i) {
    if (i === activo || !slides[i]) return;
    const prev = slides[activo];
    if (prev) { pausar(prev); prev.el.classList.remove('activo'); if (prev.video) prev.video.currentTime = 0; }
    activo = i;
    const s = slides[i];
    // solo el actual y sus vecinos tienen el video cargado
    slides.forEach((x, k) => { if (Math.abs(k - i) <= 1) cargar(x); else if (Math.abs(k - i) > 2) descargar(x); });
    s.pausadoUsuario = false;
    s.el.classList.add('activo');
    $('.ugv-cnt', raiz).textContent = '#' + String(i + 1).padStart(2, '0');
    reproducir(s);
    if (typeof registrarVista === 'function') registrarVista(s.item);
    contarComentarios(s); estadoSeguir(s);
    try { history.replaceState(history.state, '', `${location.pathname}?v=${encodeURIComponent(s.item._id)}`); } catch (_) {}
    if (i >= slides.length - 3) agregarRonda();
  }
  function ir(i) { const s = slides[Math.max(0, i)]; if (s) lista.scrollTo({ top: s.el.offsetTop, behavior: 'smooth' }); }

  /* ── Sonido ── */
  function setSonido(on) {
    sonido = on; try { localStorage.setItem('ugv_son', on ? '1' : '0'); } catch (_) {}
    $('.ugv-son ion-icon', raiz).setAttribute('name', on ? 'volume-high' : 'volume-mute');
    avisoSonido(false);
    const s = slides[activo]; if (!s) return;
    if (s.video) { s.video.muted = !on; if (on) s.video.play().catch(() => {}); }
    ytCmd(s, on ? 'unMute' : 'mute');
  }
  function avisoSonido(on) { const a = $('.ugv-avisoson', raiz); if (a) a.hidden = !on; }

  /* ── Acciones ── */
  const esFav = id => (typeof LS !== 'undefined' ? LS.getJSON('favoritos', []) : []).includes(id);
  function pintarLike(s) { const b = $('.ugv-like', s.el); b.classList.toggle('on', esFav(s.item._id)); $('b', b).textContent = nf(s.item.likesCount); }
  async function darLike(s) {
    if (!yo()) { if (typeof ugPedirSesion === 'function') ugPedirSesion('dar me gusta'); return; }
    const id = s.item._id, antes = esFav(id), mismos = slides.filter(x => x.item._id === id);
    // al instante en pantalla; fav() (script.js) confirma con el servidor y actualiza el resto de la app
    mismos.forEach(x => { const b = $('.ugv-like', x.el); b.classList.toggle('on', !antes); $('b', b).textContent = nf((s.item.likesCount || 0) + (antes ? -1 : 1)); });
    const b = $('.ugv-like', s.el); b.classList.remove('salta'); void b.offsetWidth; b.classList.add('salta');
    const delCatalogo = (typeof todosLosItems !== 'undefined' ? todosLosItems : []).find(x => x._id === id);
    if (typeof fav === 'function') { try { await fav(id); } catch (_) {} }
    const ahora = esFav(id);
    // fav() ya ajustó el contador si el video es el mismo objeto del catálogo; si no, se ajusta aquí
    if (ahora !== antes && delCatalogo !== s.item) s.item.likesCount = Math.max(0, (s.item.likesCount || 0) + (ahora ? 1 : -1));
    mismos.forEach(pintarLike);
  }
  function corazones(s, x, y) {
    for (let k = 0; k < 7; k++) {
      const h = document.createElement('i'); h.className = 'ugv-corazon' + (k ? ' chispa' : ''); if (!k) h.innerHTML = '<ion-icon name="heart"></ion-icon><span></span>';
      h.style.left = x + 'px'; h.style.top = y + 'px';
      h.style.setProperty('--dx', ((Math.random() - .5) * 220).toFixed(0) + 'px'); h.style.setProperty('--dy', (-120 - Math.random() * 200).toFixed(0) + 'px');
      h.style.setProperty('--r', ((Math.random() - .5) * 60).toFixed(0) + 'deg'); h.style.animationDelay = (k * 40) + 'ms';
      if (k === 0) h.classList.add('grande');
      raiz.appendChild(h); setTimeout(() => h.remove(), 1400);
    }
  }
  async function estadoSeguir(s) {
    const autor = String(s.item.usuario || '').toLowerCase(), b = $('.ugv-seg', s.el);
    if (!b) return;
    if (!yo() || autor === yo().toLowerCase()) { b.hidden = !!yo(); return; }
    if (!siguiendo.has(autor)) {
      try { const r = await fetch(`${API}/usuarios/verifica-seguimiento/${encodeURIComponent(yo())}/${encodeURIComponent(autor)}`); siguiendo.set(autor, !!(await r.json()).estaSiguiendo); } catch (_) { siguiendo.set(autor, false); }
    }
    slides.filter(x => String(x.item.usuario || '').toLowerCase() === autor).forEach(x => { const bb = $('.ugv-seg', x.el); if (bb) { bb.classList.toggle('ok', siguiendo.get(autor)); bb.textContent = siguiendo.get(autor) ? 'Siguiendo' : 'Seguir'; } });
  }
  async function seguir(s) {
    if (!yo()) { if (typeof ugPedirSesion === 'function') ugPedirSesion('seguir a creadores'); return; }
    const autor = String(s.item.usuario || '').toLowerCase();
    try {
      const r = await fetch(`${API}/usuarios/toggle-seguir/${encodeURIComponent(yo())}/${encodeURIComponent(autor)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo');
      siguiendo.set(autor, !!d.siguiendo); estadoSeguir(s);
      if (typeof toast === 'function') toast(d.siguiendo ? `✅ Sigues a @${autor}` : `Dejaste de seguir a @${autor}`);
    } catch (e) { if (typeof toast === 'function') toast('❌ ' + e.message); }
  }
  async function compartir(s) {
    const url = `${location.origin}${location.pathname}?id=${encodeURIComponent(s.item._id)}`;
    try { if (navigator.share) { await navigator.share({ title: s.item.title, text: `Mira este video de @${s.item.usuario} en UpGames`, url }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); if (typeof toast === 'function') toast('🔗 Enlace copiado'); } catch (_) { prompt('Copia el enlace:', url); }
  }
  function accion(e, s) {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    e.stopPropagation();
    if (a === 'like') darLike(s);
    else if (a === 'com') comentarios(true);
    else if (a === 'compartir') compartir(s);
    else if (a === 'seguir') seguir(s);
    else if (a === 'perfil') { cerrar(); location.href = `./perfil-publico.html?usuario=${encodeURIComponent(s.item.usuario)}`; }
    else if (a === 'destacada') {
      const id = s.item.featuredItemId, it = (typeof todosLosItems !== 'undefined' ? todosLosItems : []).find(x => x._id === id);
      cerrar();
      if (it && typeof openDetail === 'function') setTimeout(() => openDetail(it), 350);
      else location.href = `./biblioteca.html?id=${encodeURIComponent(id)}`;
    }
  }

  /* ── Comentarios ── */
  async function contarComentarios(s) {
    if (s.ncom != null) return;
    try { const r = await fetch(`${API}/comentarios/${s.item._id}`); const d = await r.json(); s.coms = Array.isArray(d) ? d : []; s.ncom = s.coms.length; } catch (_) { s.ncom = 0; s.coms = []; }
    $('.ugv-ncom', s.el).textContent = nf(s.ncom);
  }
  function pintarComentarios(s) {
    const L = $('.ugv-com-lista', raiz);
    $('.ugv-com-n', raiz).textContent = s.ncom ? nf(s.ncom) : '';
    L.innerHTML = !s.coms?.length ? '<div class="ugv-com-vacio"><ion-icon name="chatbubbles-outline"></ion-icon>Sé el primero en comentar</div>'
      : s.coms.map(c => `<div class="ugv-c"><span class="ugv-c-av">${esc(String(c.usuario || '?')[0].toUpperCase())}</span><div><b>@${esc(c.usuario)}</b><p>${esc(c.texto)}</p>${c.fecha && typeof timeAgo === 'function' ? `<small>${esc(timeAgo(c.fecha))}</small>` : ''}</div></div>`).join('');
  }
  async function comentarios(on) {
    raiz.classList.toggle('com-on', on); $('.ugv-com', raiz).setAttribute('aria-hidden', !on);
    if (!on) return;
    const s = slides[activo]; if (!s) return;
    s.ncom = null; await contarComentarios(s); pintarComentarios(s);
  }
  async function comentar() {
    const s = slides[activo], inp = $('.ugv-com-in input', raiz), texto = inp.value.trim();
    if (!s || !texto) return;
    if (!yo()) { if (typeof ugPedirSesion === 'function') ugPedirSesion('comentar'); return; }
    try {
      const r = await fetch(`${API}/comentarios`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` }, body: JSON.stringify({ itemId: s.item._id, texto }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo publicar');
      inp.value = ''; s.ncom = null; await contarComentarios(s); pintarComentarios(s);
    } catch (e) { if (typeof toast === 'function') toast('❌ ' + e.message); }
  }

  /* ── Barra de progreso arrastrable ── */
  function progreso(s) {
    const bar = $('.ugv-prog', s.el);
    const mover = e => { const v = s.video; if (!v || !v.duration) return; const r = bar.getBoundingClientRect(); v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * v.duration; };
    bar.addEventListener('pointerdown', e => { e.stopPropagation(); bar.setPointerCapture(e.pointerId); bar.classList.add('arrastre'); mover(e); });
    bar.addEventListener('pointermove', e => { if (bar.classList.contains('arrastre')) mover(e); });
    bar.addEventListener('pointerup', e => { e.stopPropagation(); bar.classList.remove('arrastre'); });
  }

  /* ── Abrir / cerrar ── */
  async function abrir(inicioId) {
    montar();
    if (!abierto) { try { history.pushState({ ugv: 1 }, ''); } catch (_) {} }
    abierto = true;
    try { sonido = localStorage.getItem('ugv_son') !== '0'; } catch (_) {}
    $('.ugv-son ion-icon', raiz).setAttribute('name', sonido ? 'volume-high' : 'volume-mute');
    musicaSonaba = !!window.UGMusica?.sonando; if (musicaSonaba) window.UGMusica.pausar(.5);
    document.documentElement.classList.add('ugv-abierto');
    raiz.classList.add('on');
    if (!base.length) { lista.innerHTML = '<div class="ugv-carga"><span></span>Cargando videos…</div>'; base = await cargarVideos(); }
    reiniciar(inicioId);
  }
  function reiniciar(inicioId) {
    slides.forEach(s => { io.unobserve(s.el); descargar(s); });
    slides = []; activo = -1; lista.innerHTML = '';
    if (!base.length) { lista.innerHTML = '<div class="ugv-carga">Todavía no hay videos. ¡Sube el primero desde tu perfil!</div>'; return; }
    const ini = inicioId && base.find(i => i._id === inicioId);
    if (ini) crearSlide(ini);
    agregarRonda();
    if (ini && slides[1]?.item._id === ini._id) { io.unobserve(slides[1].el); slides[1].el.remove(); slides.splice(1, 1); slides.forEach((s, k) => s.el.dataset.i = k); }
    lista.scrollTop = 0;
    requestAnimationFrame(() => activar(0));
  }
  function cerrar(desdeAtras) {
    if (!abierto) return;
    abierto = false;
    slides.forEach(pausar);
    raiz.classList.remove('on', 'com-on');
    document.documentElement.classList.remove('ugv-abierto');
    if (musicaSonaba) window.UGMusica?.play();
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
    if (!desdeAtras) { try { if (history.state?.ugv) history.back(); } catch (_) {} }
    setTimeout(() => { if (!abierto) { slides.forEach(descargar); } }, 400);
  }
  window.UGVideos = { abrir, cerrar };

  /* ── Puntos de entrada ── */
  document.addEventListener('click', e => {
    const chip = e.target.closest('#category-row .chip[data-cat="Video"]');
    if (chip) setTimeout(() => abrir(), 60);
  }, true);
  // Abrir un video (detalle o modo teatro) → el feed, empezando por ese video
  const envolver = nombre => { const f = window[nombre]; if (typeof f !== 'function') return; window[nombre] = function (it) { if (it && it.category === 'Video' && it.link) return abrir(it._id); return f.apply(this, arguments); }; };
  envolver('openDetail'); envolver('openTheater');
  // Enlace directo ?v=<id>
  const v = new URLSearchParams(location.search).get('v');
  if (v && /^[a-f\d]{24}$/i.test(v)) addEventListener('load', () => setTimeout(() => abrir(v), 900));
})();
