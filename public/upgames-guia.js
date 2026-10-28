/* ═══════════════════════════════════════════════════════════════
   UpGames · Cómo aprender a usar UpGames (UGG)
   Reemplaza al tutorial de 54 pasos que bloqueaba la pantalla:
   1) Guía de inicio: lista corta de primeros pasos con "Llévame"; se marca sola.
   2) Pistas: una burbuja pequeña la PRIMERA vez que llegas a algo (no bloquea).
   3) Centro de ayuda (botón ?): guías cortas con buscador, NEXUS y soporte.
   4) Recorrido rápido opcional (7 pasos) para quien lo pida.
   El progreso se guarda en localStorage 'ug_guia' (cualquier página puede marcar).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const API = (window.UG_CONFIG && window.UG_CONFIG.API_URL) || 'https://upgames-production.up.railway.app';
  const LSx = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };
  const tok = () => { try { return localStorage.getItem('token'); } catch (_) { return null; } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Métricas anónimas (admin → "dónde se atascan"): un evento por paso y dispositivo ──
  const modo = () => tok() ? 'usr' : 'inv';
  function enviar(paso, accion) {
    const env = LSx.get('ug_guia_env', {}), k = `${modo()}:${paso}:${accion}`;
    if (env[k]) return; env[k] = 1; LSx.set('ug_guia_env', env);
    try { fetch(`${API}/guia/evento`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paso, accion, modo: modo() }) }).catch(() => {}); } catch (_) {}
  }
  /** Reporta lo completado que aún no se envió (pasos marcados en el perfil público o en un live). */
  function reportar() {
    if (!document.getElementById('tut-fab')) return;   // solo desde la biblioteca, donde vive la guía
    enviar('_inicio', 'completo');
    const g = hecho(), p = pasos();
    p.forEach(x => { if (g[x.id]) enviar(x.id, 'completo'); });
    if (p.every(x => g[x.id])) enviar('_fin', 'completo');
  }

  // ── Progreso ─────────────────────────────────────────────────────────────
  const hecho = () => LSx.get('ug_guia', {});
  function marcar(k) {
    const g = hecho(); if (g[k]) return;
    g[k] = Date.now(); LSx.set('ug_guia', g);
    pintarFab(); reportar();
    const p = pasos(), n = p.filter(x => g[x.id]).length;
    if (n === p.length && !g._fin) { g._fin = 1; LSx.set('ug_guia', g); setTimeout(() => window.UGX?.fiesta?.('🎉', '¡Guía de inicio completa!'), 400); }
  }
  window.addEventListener('ug:guia', e => marcar(e.detail));

  const irInicio = () => { window.closeDetail?.(); window.switchTab?.('main'); };
  const PASOS_INV = [
    { id: 'explorar', ic: '🔎', t: 'Explora el catálogo', d: 'Toca una categoría o busca un juego, mod o app.', ir: () => { irInicio(); pista('#category-row', 'Toca una categoría o usa el buscador de arriba 🔎', 'guia'); } },
    { id: 'abrir', ic: '📦', t: 'Abre una publicación', d: 'Mira el detalle, la portada y cómo descargar.', ir: () => { irInicio(); setTimeout(() => pista('.game-tile', 'Toca cualquier publicación para ver su detalle', 'guia'), 350); } },
    { id: 'cuenta', ic: '👤', t: 'Crea tu cuenta gratis', d: 'Para guardar favoritos, comentar, publicar y ganar.', ir: () => window.ugPedirSesion?.('guardar tu progreso') },
  ];
  const PASOS_USR = [
    { id: 'email', ic: '✉️', t: 'Verifica tu email', d: 'Protege tu cuenta y habilita retiros y recompensas.', ir: () => { irInicio(); const v = document.getElementById('ug-verif'); v && !v.hidden ? pista('#ug-verif', 'Toca aquí para reenviar el correo de verificación', 'guia') : window.toast?.('📬 Revisa tu bandeja (y Spam) para el correo de verificación'); } },
    { id: 'abrir', ic: '📦', t: 'Abre una publicación', d: 'Mira el detalle y cómo descargar.', ir: PASOS_INV[1].ir },
    { id: 'favorito', ic: '❤️', t: 'Guarda un favorito', d: 'Abre una publicación y toca "Favorito".', ir: () => { irInicio(); setTimeout(() => pista('.game-tile', 'Abre una publicación y toca ❤️ Favorito', 'guia'), 350); } },
    { id: 'seguir', ic: '👥', t: 'Sigue a un creador', d: 'Te avisamos cuando publique o esté en vivo.', ir: () => { irInicio(); setTimeout(() => pista('.game-tile', 'Abre una publicación, toca el nombre del creador y luego "Seguir"', 'guia'), 350); } },
    { id: 'nexus', ic: '✦', t: 'Pregúntale algo a NEXUS', d: 'Recomendaciones, dudas y ayuda para publicar.', ir: () => { irInicio(); window.nexusPreguntar ? window.nexusPreguntar('¿Qué puedo hacer en UpGames?') : window.nxToggle?.(); } },
    { id: 'live', ic: '🔴', t: 'Mira un live', d: 'Gameplay en directo con chat y regalos.', ir: () => { location.href = './live.html'; } },
    { id: 'upcoins', ic: '🪙', t: 'Conoce tus UpCoins', d: 'Misiones, estilo del perfil y Premium.', ir: () => { window.switchTab?.('economia'); setTimeout(() => pista('#ugx-hub', 'Aquí reclamas misiones y usas tus UpCoins', 'guia'), 900); } },
    { id: 'publicar', ic: '☁️', t: 'Publica tu primer contenido', d: 'Gana 50 UpCoins por cada 1.000 descargas.', ir: () => window.switchTab?.('upload') },
  ];
  const pasos = () => tok() ? PASOS_USR : PASOS_INV;

  // Datos que solo sabe el servidor (email verificado, si ya publicó)
  let sincronizado = false;
  async function sincronizar() {
    if (sincronizado || !tok()) return; sincronizado = true;
    try {
      const h = { Authorization: `Bearer ${tok()}` };
      const [s, it] = await Promise.all([
        fetch(`${API}/economia/mi-saldo`, { headers: h }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API}/items/user/${encodeURIComponent(localStorage.getItem('user_admin') || '')}`, { headers: h }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (s?.emailVerificado) marcar('email');
      if (Array.isArray(it) && it.length) marcar('publicar');
      if ((LSx.get('favoritos', []) || []).length) marcar('favorito');
    } catch (_) {}
  }

  // ── Botón de ayuda (antes "?" que relanzaba el tutorial) ─────────────────
  function pintarFab() {
    const f = document.getElementById('tut-fab'); if (!f) return;
    const g = hecho(), p = pasos(), n = p.filter(x => g[x.id]).length, faltan = p.length - n;
    f.onclick = e => { e.preventDefault(); ayuda(); };
    f.title = faltan ? `Guía de inicio: ${n}/${p.length}` : 'Ayuda';
    f.setAttribute('aria-label', f.title);
    f.innerHTML = faltan ? `<svg class="ugg-anillo" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5"/><circle cx="18" cy="18" r="15.5" class="v" style="stroke-dasharray:${(n / p.length * 97.4).toFixed(1)} 97.4"/></svg><span>?</span><b class="ugg-faltan">${faltan}</b>` : '<span>?</span>';
    f.classList.toggle('ugg-pendiente', !!faltan);
  }

  // ── Pistas (una burbuja, una vez, sin bloquear) ──────────────────────────
  let ultimaPista = 0, pistaActual = null;
  const vistas = () => LSx.get('ug_pistas', {});
  const bloqueado = () => document.getElementById('onboarding-modal')?.classList.contains('show') || document.querySelector('.ugx-ov') || document.getElementById('btut-lock')?.classList.contains('on');
  function cerrarPista() { if (!pistaActual) return; pistaActual.b.remove(); pistaActual.r.remove(); pistaActual = null; removeEventListener('scroll', cerrarPista, true); removeEventListener('resize', cerrarPista); }
  /** Muestra una pista junto a `sel`. `id` evita repetirla (salvo 'guia', que es a pedido). */
  function pista(sel, texto, id, opts = {}) {
    if (bloqueado()) return false;
    if (id !== 'guia') { if (vistas()[id] || Date.now() - ultimaPista < 25000) return false; }
    // Visible = tiene caja en pantalla (offsetParent es null en elementos position:fixed como el botón de ayuda)
    const el = typeof sel === 'string' ? [...document.querySelectorAll(sel)].find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }) : sel;
    if (!el) return false;
    if (opts.sinScroll) { const r0 = el.getBoundingClientRect(); if (r0.top < 0 || r0.bottom > innerHeight) return false; }   // p. ej. en un live: no mover el video
    cerrarPista();
    if (!opts.sinScroll) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => {
      const r = el.getBoundingClientRect(), PAD = 6;
      const ring = document.createElement('div'); ring.className = 'ugg-ring';
      Object.assign(ring.style, { top: `${r.top - PAD}px`, left: `${r.left - PAD}px`, width: `${r.width + PAD * 2}px`, height: `${r.height + PAD * 2}px` });
      const b = document.createElement('div'); b.className = 'ugg-pista'; b.setAttribute('role', 'status');
      b.innerHTML = `<p>${esc(texto)}</p><button type="button">Entendido</button>`;
      document.body.append(ring, b);
      const bw = Math.min(300, innerWidth - 24), abajo = r.bottom + 120 < innerHeight;
      Object.assign(b.style, { width: `${bw}px`, left: `${Math.max(12, Math.min(innerWidth - bw - 12, r.left + r.width / 2 - bw / 2))}px`, top: abajo ? `${r.bottom + 12}px` : 'auto', bottom: abajo ? 'auto' : `${innerHeight - r.top + 12}px` });
      b.classList.add(abajo ? 'abajo' : 'arriba');
      b.style.setProperty('--fx', `${Math.max(16, Math.min(bw - 16, r.left + r.width / 2 - parseFloat(b.style.left)))}px`);
      pistaActual = { b, r: ring };
      b.querySelector('button').onclick = cerrarPista;
      setTimeout(() => { addEventListener('scroll', cerrarPista, { capture: true, passive: true }); addEventListener('resize', cerrarPista); }, 600);
      setTimeout(() => { if (pistaActual?.b === b) cerrarPista(); }, 12000);
    }, 380);
    if (id && id !== 'guia') { const v = vistas(); v[id] = Date.now(); LSx.set('ug_pistas', v); ultimaPista = Date.now(); }   // las pedidas desde la guía no cuentan
    return true;
  }

  // Pistas automáticas: cada una se muestra una sola vez en la vida del usuario
  window.addEventListener('ug:detalle', e => {
    marcar('abrir');
    const n = (LSx.get('ug_guia_detalles', 0) || 0) + 1; LSx.set('ug_guia_detalles', n);
    setTimeout(() => {
      if (!pista('#ds-download', 'Toca aquí para ir a la descarga: pasas por la página puente (30 s) o usas el acceso directo sin esperar', 'descargar') && n >= 3 && tok())
        pista('#ugx-apoyar', '¿Te gustó? Apoya al creador con UpCoins: recibe el 25 % como ganancia', 'apoyar');
    }, 900);
  });
  window.addEventListener('ug:tab', e => {
    const t = e.detail;
    if (t === 'economia') { marcar('upcoins'); setTimeout(() => pista('#ugx-hub', 'Aquí reclamas tus misiones semanales y usas tus UpCoins', 'economia'), 1400); }
    if (t === 'profile' && tok()) setTimeout(() => pista('#pf-create-btn', 'Publica aquí juegos, mods, apps o videos y gana UpCoins por cada descarga', 'publicar'), 1200);
  });
  // Cosas que se hacen fuera de la biblioteca o en otros módulos
  window.addEventListener('storage', e => { if (e.key === 'ug_guia') pintarFab(); });

  /** Tras aceptar la bienvenida: presenta la guía y el menú, sin bloquear. */
  function bienvenida() {
    pintarFab();
    setTimeout(() => pista('#tut-fab', 'Tu guía de inicio está aquí: unos pocos pasos para aprovechar UpGames. Tócala cuando quieras', 'guia-fab'), 600);
    setTimeout(() => pista('#hdr-orb', 'Menú rápido: avisos, lives, subir contenido, Premium y soporte', 'orbe'), 26000);
  }

  // ── Centro de ayuda ──────────────────────────────────────────────────────
  // Búsqueda tolerante: sin tildes y por raíz ("retirar" encuentra "Retira", "publicación" encuentra "publicar")
  const norm = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const raiz = w => w.slice(0, Math.max(4, w.length - 3));
  const coincide = (txt, q) => norm(q).split(/\s+/).filter(Boolean).every(w => norm(txt).includes(w.length > 4 ? raiz(w) : w));
  const GUIAS = [
    ['📥', 'Descargar', ['Abre una publicación y toca "Obtener link".', 'Pasas por la página puente: espera 30 s y toca "Obtener enlace". Así el creador gana por tu descarga.', 'Con el acceso directo (US$1 o 50 UpCoins) o con Premium te saltas la espera y los anuncios.', 'Si un enlace no funciona, toca "Reportar" en el detalle.']],
    ['☁️', 'Publicar y ganar', ['Ve a Perfil → Crear publicación: título, categoría, portada y un enlace de una plataforma permitida (MediaFire, MEGA, Drive…).', 'NEXUS revisa tu publicación y el equipo la aprueba antes de salir en el inicio. Con la revisión prioritaria pasa al frente de la fila.', 'Ganas 50 UpCoins por cada 1.000 descargas verificadas, más el 25 % de regalos, Super Chats y apoyos.', 'Retira desde 500 UC ganados (US$10) con PayPal, Nequi, Daviplata, banco o Mercado Pago. Necesitas verificación (100 seguidores) y email verificado.']],
    ['🪙', 'UpCoins y Premium', ['1 UpCoin = US$0,02. Recárgalos con tarjeta o PayPal en Economía.', 'Úsalos en regalos y Super Chat en lives, apoyos, NEXUS, Premium, destacar tu publicación y el estilo de tu perfil.', 'Lo que ganas como creador se retira como dinero; lo que compras o te regalan se usa dentro de UpGames.', 'Premium: sin anuncios ni espera, NEXUS ilimitado y más visibilidad. Es prepago: no hay cobros automáticos.']],
    ['🎯', 'Misiones y estilo', ['Cada semana tienes misiones (comentar, seguir creadores, mirar un live…) que dan UpCoins de regalo o insignias.', 'Reclámalas en Economía → Usa tus UpCoins (necesitas el email verificado). Se reinician cada lunes.', 'En "Estilo del perfil" compras marcos animados, color del nombre, fondos e insignias: son tuyos para siempre.']],
    ['🔴', 'Lives', ['Toca el menú rápido (arriba a la derecha) → En vivo.', 'Para transmitir: comparte tu pantalla desde el PC o usa la cámara del móvil.', 'Los espectadores chatean, dan likes, envían regalos y Super Chats; tú recibes el 25 %.']],
    ['✦', 'NEXUS IA', ['El asistente de UpGames: recomienda contenido real, resuelve dudas y te ayuda a publicar.', '10 mensajes gratis al día; más con UpCoins o ilimitado con Premium.', 'Si no sabe algo, te lo dice: no inventa títulos.']],
    ['🔐', 'Cuenta y seguridad', ['Verifica tu email desde el aviso del inicio o en Ajustes.', 'Cambia avatar, portada, bio, nombre y contraseña en Perfil → Editar perfil.', 'Activa las notificaciones push desde la campana → Ajustes.', 'Reporta abuso o contenido ilegal con "Reportar" o escribiendo a soporte.']],
  ];
  function ayuda() {
    const g = hecho(), p = pasos(), n = p.filter(x => g[x.id]).length;
    const html = `<div class="ugg-guia"><div class="ugg-guia-h"><b>🚀 Guía de inicio</b><span>${n}/${p.length}</span></div><div class="ugx-bar"><i style="width:${Math.round(n / p.length * 100)}%"></i></div>
        <div class="ugg-pasos">${p.map(x => `<div class="ugg-paso ${g[x.id] ? 'ok' : ''}"><span class="ugg-ic">${g[x.id] ? '✓' : x.ic}</span><div><b>${esc(x.t)}</b><small>${esc(x.d)}</small></div>${g[x.id] ? '' : `<button type="button" class="ugx-btn sec" data-ir="${x.id}">Llévame</button>`}</div>`).join('')}</div></div>
      <input class="ugx-in" id="ugg-buscar" placeholder="Busca: retirar, publicar, Premium, live…" autocomplete="off" style="margin:14px 0 10px">
      <div id="ugg-temas">${GUIAS.map(([ic, t, l], i) => `<details class="ugg-tema" data-txt="${esc((t + ' ' + l.join(' ')).toLowerCase())}"${i ? '' : ''}><summary>${ic} ${esc(t)}</summary><ul>${l.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>`).join('')}</div>
      <p class="ugx-sub" id="ugg-nada" hidden>No encontramos eso en las guías. Pregúntale a NEXUS 👇</p>
      <div class="ugg-acc"><button type="button" class="ugx-btn" id="ugg-nexus">✦ Preguntar a NEXUS</button><button type="button" class="ugx-btn sec" id="ugg-tour">⏱ Recorrido de 1 min</button><button type="button" class="ugx-btn sec" id="ugg-soporte">✉️ Soporte</button>${window.ugAbrirBienvenida ? '<button type="button" class="ugx-btn sec" id="ugg-descubre">✦ Descubre UpGames</button>' : ''}</div>`;
    const b = window.UGX?.hoja ? window.UGX.hoja('❔ Ayuda', html) : null;
    if (!b) return;
    b.querySelectorAll('[data-ir]').forEach(x => x.onclick = () => { enviar(x.dataset.ir, 'llevame'); window.UGX.cerrarHoja(); setTimeout(() => p.find(y => y.id === x.dataset.ir)?.ir(), 260); });
    const q = b.querySelector('#ugg-buscar');
    q.oninput = () => {
      const v = q.value.trim().toLowerCase(); let vis = 0;
      b.querySelectorAll('.ugg-tema').forEach(d => { const m = !v || coincide(d.dataset.txt, v); d.hidden = !m; if (m) vis++; d.open = !!v && m; });
      b.querySelector('#ugg-nada').hidden = vis > 0;
    };
    b.querySelector('#ugg-nexus').onclick = () => { const v = q.value.trim(); window.UGX.cerrarHoja(); irInicio(); setTimeout(() => window.nexusPreguntar ? window.nexusPreguntar(v || '¿Cómo funciona UpGames?') : window.nxToggle?.(), 260); };
    b.querySelector('#ugg-tour').onclick = () => { window.UGX.cerrarHoja(); setTimeout(() => window.startTutorial?.(), 260); };
    b.querySelector('#ugg-soporte').onclick = () => window.handleMail?.();
    const d = b.querySelector('#ugg-descubre'); if (d) d.onclick = () => { window.UGX.cerrarHoja(); setTimeout(() => window.ugAbrirBienvenida(), 260); };
    sincronizar();
  }

  function iniciar() {
    if (!document.getElementById('tut-fab')) return;   // otras páginas (live) solo usan las pistas
    pintarFab(); sincronizar(); reportar();
    // Quien ya aceptó la bienvenida pero nunca vio la guía: preséntala una vez, sin bloquear
    if (localStorage.getItem('upgames_terms_v') && !vistas()['guia-fab']) setTimeout(() => pista('#tut-fab', 'Nuevo: tu guía de inicio y la ayuda están aquí. Tócala cuando quieras', 'guia-fab'), 6000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  window.UGG = { marcar, pista, ayuda, bienvenida, pintarFab };
})();
