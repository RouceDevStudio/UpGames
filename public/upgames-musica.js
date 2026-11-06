/* ═══════════════════════════════════════════════════════════════
   UpGames · Música de fondo
   ───────────────────────────────────────────────────────────────
   • Cada sesión arranca con una canción distinta a la de la sesión
     anterior y sigue con las demás en orden aleatorio.
   • Los navegadores no dejan sonar audio sin un toque del usuario:
     se intenta al cargar y, si se bloquea, empieza con el primer toque
     o tecla, entrando suave (fundido de 3 s).
   • Volumen de fondo (las pistas están normalizadas a −16 LUFS en
     public/audio/); el usuario lo ajusta o lo silencia y se recuerda.
   • Al pasar de página (biblioteca ↔ perfil) sigue donde iba.
   • Se baja sola cuando suena un video y vuelve al terminar; se pausa
     si la pestaña queda en segundo plano.
   • No suena con "Ahorro de datos" activo hasta que el usuario la pida.
   Música: Infraction (sin copyright).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const BASE = (document.currentScript?.src || location.href).replace(/[^/]*$/, '') + 'audio/';
  const PISTAS = [
    { f: 'there-is-no-way-out.mp3', t: 'There Is No Way Out' },
    { f: 'dead-network.mp3', t: 'Dead Network' },
    { f: 'just-evil.mp3', t: 'Just Evil' },
    { f: 'if-you-open-up.mp3', t: 'If You Open Up' },
  ];
  const AUTOR = 'Infraction';
  const VOL_DEF = 0.42;            // sobre pistas a −16 LUFS → fondo presente pero no invasivo
  const FUNDIDO_ENTRADA = 3, FUNDIDO_SALIDA = 0.9;

  const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
  const ss = { get: k => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (_) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };

  let silencio = ls.get('ug_mus_off', '0') === '1';
  let volumen = Math.max(0, Math.min(1, parseFloat(ls.get('ug_mus_vol', VOL_DEF)) || VOL_DEF));
  const ahorro = !!navigator.connection?.saveData;
  if (ahorro && ls.get('ug_mus_off', null) === null) silencio = true;

  // Orden de la sesión: empieza por una canción distinta a la última sesión
  let ses = ss.get('ug_mus');
  if (!ses || !Array.isArray(ses.orden)) {
    const ult = parseInt(ls.get('ug_mus_ult', '-1'), 10);
    const resto = PISTAS.map((_, i) => i).filter(i => i !== ult).sort(() => Math.random() - 0.5);
    const orden = [...resto, ...(ult >= 0 && ult < PISTAS.length ? [ult] : [])];
    ses = { orden, pos: 0, t: 0 };
    ls.set('ug_mus_ult', String(orden[0]));
    ss.set('ug_mus', ses);
  }

  const audio = new Audio();
  audio.preload = 'auto';
  let ctx = null, gain = null, sonando = false, ducking = 0, intentoHecho = false;

  const pista = () => PISTAS[ses.orden[ses.pos % ses.orden.length]];
  function cargar(t = 0) {
    audio.src = BASE + pista().f;
    if (t > 0) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = Math.min(t, (audio.duration || t + 1) - 1); } catch (_) {} }, { once: true });
    pintar();
  }
  // Web Audio para fundidos suaves (iOS ignora audio.volume)
  function grafo() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ctx = new AC(); const src = ctx.createMediaElementSource(audio); gain = ctx.createGain(); gain.gain.value = 0; src.connect(gain).connect(ctx.destination); }
    catch (_) { ctx = null; gain = null; }
  }
  const objetivo = () => (silencio ? 0 : volumen * (ducking > 0 ? 0.12 : 1));
  function rampa(v, seg) {
    if (gain && ctx) { const n = ctx.currentTime; gain.gain.cancelScheduledValues(n); gain.gain.setValueAtTime(gain.gain.value, n); gain.gain.linearRampToValueAtTime(v, n + seg); }
    else { // sin Web Audio: fundido con el volumen del elemento
      const ini = audio.volume, t0 = performance.now();
      (function paso(ts) { const k = Math.min(1, (ts - t0) / (seg * 1000)); audio.volume = ini + (v - ini) * k; if (k < 1) requestAnimationFrame(paso); })(t0);
    }
  }
  async function play(seg = FUNDIDO_ENTRADA) {
    if (silencio || document.hidden) return false;
    grafo();
    try { if (ctx && ctx.state === 'suspended') await ctx.resume(); } catch (_) {}
    if (!gain) audio.volume = 0;
    try { await audio.play(); } catch (_) { return false; }
    sonando = true; rampa(objetivo(), seg); pintar();
    return true;
  }
  function pausar(seg = FUNDIDO_SALIDA) {
    if (!sonando) return;
    sonando = false; rampa(0, seg);
    setTimeout(() => { if (!sonando) audio.pause(); }, seg * 1000 + 60);
    pintar();
  }
  function siguiente() {
    ses.pos = (ses.pos + 1) % ses.orden.length; ses.t = 0; ss.set('ug_mus', ses);
    const seguia = sonando || !silencio;
    cargar(0);
    if (seguia) play(1.5);
  }
  audio.addEventListener('ended', siguiente);
  // Recordar dónde iba (para seguir en la próxima página de la sesión)
  setInterval(() => { if (sonando) { ses.t = audio.currentTime || 0; ss.set('ug_mus', ses); } }, 2000);
  addEventListener('pagehide', () => { ses.t = audio.currentTime || ses.t; ss.set('ug_mus', ses); });

  // Arranque: intento directo y, si el navegador lo bloquea, al primer gesto
  function alPrimerGesto() {
    const go = e => {
      if (e.target?.closest?.('.ugm')) return;   // el propio control decide
      quitar(); if (!sonando) play();
    };
    const quitar = () => ['pointerdown', 'keydown', 'touchend'].forEach(ev => removeEventListener(ev, go, true));
    ['pointerdown', 'keydown', 'touchend'].forEach(ev => addEventListener(ev, go, true));
  }
  function iniciar() {
    cargar(ses.t || 0);
    if (silencio) return;
    play().then(ok => { intentoHecho = true; if (!ok) alPrimerGesto(); });
  }

  // Videos: la música se aparta
  const esOtro = el => el && el !== audio && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') && !el.muted;
  document.addEventListener('play', e => { if (esOtro(e.target)) { ducking++; e.target._ugDuck = true; if (sonando) rampa(objetivo(), 0.6); } }, true);
  const fin = e => { if (e.target._ugDuck) { e.target._ugDuck = false; ducking = Math.max(0, ducking - 1); if (sonando) rampa(objetivo(), 1.5); } };
  document.addEventListener('pause', fin, true); document.addEventListener('ended', fin, true);
  document.addEventListener('volumechange', e => { if (e.target !== audio && e.target.tagName === 'VIDEO' && e.target.muted) fin(e); }, true);
  // Modo teatro con YouTube (iframe: no emite eventos) → se aparta mientras esté abierto
  function vigilarTeatro() {
    const ov = document.getElementById('theater-overlay'); if (!ov) return;
    let dentro = false;
    new MutationObserver(() => {
      const abierto = ov.classList.contains('open');
      if (abierto === dentro) return; dentro = abierto;
      ducking = Math.max(0, ducking + (abierto ? 1 : -1));
      if (sonando) rampa(objetivo(), abierto ? 0.6 : 1.5);
    }).observe(ov, { attributes: true, attributeFilter: ['class'] });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (sonando) { pausar(0.4); ses.pausaOculta = true; } }
    else if (ses.pausaOculta) { ses.pausaOculta = false; play(1.8); }
  });

  // ── Control flotante ──
  let ui = null;
  function pintar() {
    if (!ui) return;
    ui.classList.toggle('on', sonando && !silencio);
    ui.classList.toggle('muted', silencio);
    const t = ui.querySelector('.ugm-t'); if (t) t.textContent = pista().t;
    const r = ui.querySelector('.ugm-vol'); if (r && document.activeElement !== r) r.value = Math.round(volumen * 100);
    const b = ui.querySelector('.ugm-btn'); if (b) b.setAttribute('aria-label', silencio || !sonando ? 'Activar música de fondo' : 'Opciones de música');
    const pp = ui.querySelector('[data-a="pp"]'); if (pp) pp.innerHTML = sonando ? '❚❚' : '▶';
  }
  function montar() {
    if (ui || !document.body) return;
    ui = document.createElement('div');
    ui.className = 'ugm';
    ui.innerHTML = `<button type="button" class="ugm-btn" aria-label="Música de fondo" aria-expanded="false"><span class="ugm-eq"><i></i><i></i><i></i><i></i></span></button>
      <div class="ugm-panel" role="dialog" aria-label="Música de fondo">
        <div class="ugm-h"><span class="ugm-disco"></span><div><b class="ugm-t"></b><small>${AUTOR} · música de fondo</small></div></div>
        <div class="ugm-row"><button type="button" data-a="pp" aria-label="Reproducir o pausar">▶</button><button type="button" data-a="sig" aria-label="Siguiente canción">⏭</button>
          <input type="range" class="ugm-vol" min="0" max="100" step="1" aria-label="Volumen"><button type="button" data-a="mute" class="ugm-mute" aria-label="Silenciar"></button></div>
      </div>`;
    document.body.appendChild(ui);
    const btn = ui.querySelector('.ugm-btn');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (silencio || !sonando) { silencio = false; ls.set('ug_mus_off', '0'); play(1.2); return; }
      const ab = ui.classList.toggle('abierto'); btn.setAttribute('aria-expanded', ab);
    });
    ui.querySelector('.ugm-panel').addEventListener('click', e => {
      e.stopPropagation();
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'pp') { if (sonando) { pausar(); } else { silencio = false; ls.set('ug_mus_off', '0'); play(1.2); } }
      if (a === 'sig') siguiente();
      if (a === 'mute') { silencio = true; ls.set('ug_mus_off', '1'); pausar(); ui.classList.remove('abierto'); }
      pintar();
    });
    ui.querySelector('.ugm-vol').addEventListener('input', e => { volumen = e.target.value / 100; ls.set('ug_mus_vol', String(volumen)); if (sonando) rampa(objetivo(), 0.15); });
    document.addEventListener('click', () => { ui.classList.remove('abierto'); btn.setAttribute('aria-expanded', 'false'); });
    pintar();
  }

  window.UGMusica = { play: () => { silencio = false; ls.set('ug_mus_off', '0'); return play(1.2); }, pausar, siguiente, get sonando() { return sonando; }, PISTAS };
  const listo = () => { montar(); vigilarTeatro(); iniciar(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', listo); else listo();
})();
