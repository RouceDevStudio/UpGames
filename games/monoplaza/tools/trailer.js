// Tráiler cinematográfico de APEX GP rodado con el propio juego (index.html?trailer).
//
// Una carrera de exhibición (todos los coches con la IA) y una lista de planos sincronizados con
// la música (tools/trailer_musica.mp3, «There Is No Way Out», sin copyright): parrilla al
// amanecer, las luces que se encienden con cada golpe, la salida en el «drop», tomas a ras de
// suelo, de frente a lo Need for Speed, montadas en la rueda, a bordo, teleobjetivo, dron, de
// noche y bajo la lluvia, cámara lenta en el corte y el cierre con el logotipo.
//
// Encima, una capa 2D con los títulos (estilo motion graphics): «UPGAMES presenta», «APEX GP»,
// tarjetas de características y la llamada final.
//
// Dos formas de verlo:
// - En el navegador: index.html?trailer y tocar «Reproducir» (tiempo real, con la música).
// - Fotograma a fotograma (vídeo final): tools/rodar-trailer.cjs controla el reloj del juego
//   (window.__virtual) y guarda cada fotograma; la música se mezcla después con ffmpeg.

const T = window.apexTrailer;
const DUR = 76;                 // s de vídeo
const MUSICA_DESDE = 0;         // s de la canción en los que empieza el vídeo

// ─── Reloj ─────────────────────────────────────────────────────────────────────────────────
const V = window.__virtual || null;               // rodaje: reloj controlado desde fuera
let audio = null, t0Real = null;
const tVideo = () => V ? V.tVideo : audio && !audio.paused ? audio.currentTime - MUSICA_DESDE : t0Real != null ? (performance.now() - t0Real) / 1000 : -1;
/** Velocidad del juego respecto al vídeo (cámara lenta en el corte de la música). */
const escalaJuego = (t) => (t > 64.85 && t < 67.2) ? 0.22 : 1;
window.__escalaJuego = escalaJuego;

// ─── Utilidades de cámara ──────────────────────────────────────────────────────────────────
const THREE = T.THREE;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4();
const suave = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
function local(c, adel, lado, alto, out = _a) {
  const cs = Math.cos(c.psi), sn = Math.sin(c.psi);
  return out.set(c.x + cs * adel - sn * lado, c.y + alto, c.z + sn * adel + cs * lado);
}
/** Punto en coordenadas de la carrocería del modelo (sigue el balanceo y el cabeceo). */
function enCoche(m, x, y, z, out = _a) { m.carroceria.updateMatrixWorld(true); return out.set(x, y, z).applyMatrix4(m.carroceria.matrixWorld); }
const coche = (k) => { const s = T.sesion; const p = (s.orden && s.orden[k]) || s.participantes[k]; return p.coche; };
const modeloDe = (c) => T.modelos[T.sesion.participantes.findIndex(p => p.coche === c)];
const fijos = new Map();         // planos con cámara fija: la posición se decide al empezar el plano

// ─── Planos ──────────────────────────────────────────────────────────────────────────────
// [inicio, fin, tipo, coche (posición en carrera, 0 = líder), opciones]
const PLANOS = [
  [0, 9, 'cielo', 0],
  [9, 14, 'parrillaAerea', 0],
  [14, 16.8, 'ruedaParrilla', 1],
  [16.8, 19.3, 'casco', 0],
  [19.3, 23.8, 'lateralParrilla', 2],
  [23.8, 28.8, 'luces', 0],
  [28.8, 31.8, 'salidaFrontal', 0],
  [31.8, 33.8, 'persecucionBaja', 0],
  [33.8, 35.8, 'ruedaMontada', 1],
  [35.8, 37.8, 'pasoBajo', 0],
  [37.8, 39.8, 'frontalHeroe', 0],
  [39.8, 41.8, 'cabina', 2],
  [41.8, 43.8, 'lateralTele', 1],
  [43.8, 45.8, 'dron', 0],
  [45.8, 47.8, 'persecucionBaja', 1, { hora: 'atardecer' }],
  [47.8, 49.8, 'orbita', 0, { hora: 'atardecer' }],
  [49.8, 51.8, 'pasoBajo', 2, { hora: 'atardecer' }],
  [51.8, 53.8, 'frontalHeroe', 1, { hora: 'atardecer' }],
  [53.8, 55.8, 'ruedaMontada', 0, { hora: 'atardecer' }],
  [55.8, 58.8, 'persecucionBaja', 0, { lluvia: true }],
  [58.8, 61.8, 'lateralTele', 0, { lluvia: true }],
  [61.8, 64.85, 'tcam', 1, { lluvia: true }],
  [64.85, 67.2, 'orbitaCerca', 0],
  [67.2, 72, 'pasoBajo', 0, { hora: 'atardecer', lejos: 38 }],
  [72, DUR, 'dron', 0, { hora: 'atardecer', alto: 20 }],
];

function camaraPlano(cam, t) {
  const pl = PLANOS.find(p => t >= p[0] && t < p[1]) || PLANOS[PLANOS.length - 1];
  const [i0, i1, tipo, k, op = {}] = pl;
  const u = (t - i0) / (i1 - i0);
  const c = coche(k), m = modeloDe(c);
  let fov = 50;
  cam.up.set(0, 1, 0);
  const clave = pl;
  switch (tipo) {
    case 'cielo': {        // negro y cielo: amanecer sobre la recta, la cámara sube despacio
      local(c, 20, -6, 2.5 + 4 * u, _a); cam.position.copy(_a); local(c, 600, -120, 260 - 140 * suave(u), _b); cam.lookAt(_b); fov = 42; break;
    }
    case 'parrillaAerea': local(c, 28 - 10 * u, 22, 20 - 9 * suave(u)); cam.position.copy(_a); local(c, -25, 0, 0, _b); cam.lookAt(_b); fov = 45; break;
    case 'ruedaParrilla': local(c, 3.2 + 0.4 * u, 1.75, 0.32); cam.position.copy(_a); local(c, 1.75, 0.85, 0.36, _b); cam.lookAt(_b); fov = 38; break;
    case 'casco': enCoche(m, 0.5 - 0.06 * u, 0.98, 0.06); cam.position.copy(_a); enCoche(m, 0.05, 0.77, 0, _b); cam.lookAt(_b); fov = 42; break;
    case 'lateralParrilla': local(c, 8 - 20 * u, 4.5, 0.9); cam.position.copy(_a); local(c, 4 - 20 * u, 0, 0.5, _b); cam.lookAt(_b); fov = 34; break;
    case 'luces': local(c, -9, 2.2, 1.9); cam.position.copy(_a); local(c, 60, 0, 5.5, _b); cam.lookAt(_b); fov = 30 - 5 * u; break;
    case 'salidaFrontal': {
      if (!fijos.has(clave)) fijos.set(clave, local(c, 75, 1.5, 0.45).clone());
      cam.position.copy(fijos.get(clave)); local(c, 0, 0, 0.5, _b); cam.lookAt(_b); fov = 30; break;
    }
    case 'persecucionBaja': local(c, -5.2, 0.15 * Math.sin(t * 0.7), 0.62); cam.position.copy(_a); local(c, 25, 0, 0.3, _b); cam.lookAt(_b); fov = 74; break;
    case 'ruedaMontada': enCoche(m, 0.25, 0.62, 0.64); cam.position.copy(_a); enCoche(m, 30, 0.15, 0.9, _b); cam.lookAt(_b); fov = 64; break;
    case 'pasoBajo': {
      if (!fijos.has(clave)) {
        const circ = T.circuito, s = circ.envolver(c.proj.s + (op.lejos || 55)), mm = circ.muestra(s), lado = Math.sign(c.proj.d || 1) || 1, d = -lado * (circ.semiAncho[mm.i] + 0.8);
        fijos.set(clave, new THREE.Vector3(mm.x - mm.tz * d, mm.y + 0.28, mm.z + mm.tx * d));
      }
      cam.position.copy(fijos.get(clave)); local(c, 2, 0, 0.45, _b); cam.lookAt(_b);
      const dist = cam.position.distanceTo(_b); fov = Math.max(18, Math.min(68, 2 * Math.atan(5.5 / dist) * 57.3)); break;
    }
    case 'frontalHeroe': local(c, 7.5 + 0.8 * Math.sin(t * 0.9), 0.6 * Math.sin(t * 0.5), 0.7); cam.position.copy(_a); local(c, 0, 0, 0.45, _b); cam.lookAt(_b); fov = 36; break;
    case 'cabina': { const cm = m.camaras || {}; enCoche(m, ...(cm.cabina || [0.17, 0.8, 0])); cam.position.copy(_a); enCoche(m, ...(cm.mirarCabina || [30, -0.2, 0]), _b); cam.lookAt(_b); fov = 72; break; }
    case 'tcam': { const cm = m.camaras || {}; enCoche(m, ...(cm.tcam || [-0.06, 1.05, 0])); cam.position.copy(_a); enCoche(m, ...(cm.mirarTcam || [30, 0.4, 0]), _b); cam.lookAt(_b); fov = 68; break; }
    case 'lateralTele': local(c, -2 + 4 * u, 15, 1.4); cam.position.copy(_a); local(c, 0, 0, 0.5, _b); cam.lookAt(_b); fov = 21; break;
    case 'dron': { const h = op.alto || 14; local(c, -11 - 4 * u, 7 - 14 * u, h); cam.position.copy(_a); local(c, 6, 0, 0, _b); cam.lookAt(_b); fov = 46; break; }
    case 'orbita': case 'orbitaCerca': {
      const r = tipo === 'orbita' ? 9 : 5.2, a = -1.1 + u * (tipo === 'orbita' ? 2.2 : 1.1);
      local(c, Math.cos(a) * r, Math.sin(a) * r, tipo === 'orbita' ? 2.2 : 0.9); cam.position.copy(_a); local(c, 0.3, 0, 0.5, _b); cam.lookAt(_b); fov = tipo === 'orbita' ? 40 : 46; break;
    }
  }
  // un temblor suave de cámara al hombro / montada (más cuanto más rápido)
  const temb = Math.min(1, (c.velocidad || 0) / 80) * (['persecucionBaja', 'ruedaMontada', 'cabina', 'tcam', 'frontalHeroe'].includes(tipo) ? 0.012 : 0.003);
  cam.position.y += Math.sin(t * 37) * temb; cam.position.x += Math.sin(t * 29 + 1) * temb;
  cam.fov = fov; cam.near = 0.05; cam.updateProjectionMatrix();
  return { tipo, op };
}

// ─── Estado de la escena según el plano ──────────────────────────────────────────────────────
let horaActual = null;
function ambiente(t, op) {
  const hora = op.hora || (t < 28.8 ? 'atardecer' : 'dia');
  if (hora !== horaActual) { T.aplicarHora(hora); horaActual = hora; }
  const cl = T.sesion.clima;
  if (op.lluvia) { cl.lluvia = 0.75; cl.agua = 0.4; } else { cl.lluvia = 0; cl.agua = 0; }
  // semáforo: las luces se encienden una a una con los golpes de la música y se apagan en el drop
  const s = T.sesion;
  if (s.estado === 'parrilla') {
    s.tLuces = t < 22.3 ? 0 : t - 22.3;
    s.tApagar = 6.5;
    T.escenario.semaforo?.poner(s.luces || 0);
  } else T.escenario.semaforo?.poner(0);
}

// ─── Capa de títulos (motion graphics) ─────────────────────────────────────────────────────────
const lienzo = document.createElement('canvas');
lienzo.id = 'trailerCapa';
Object.assign(lienzo.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: 200, pointerEvents: 'none' });
document.body.appendChild(lienzo);
const g = lienzo.getContext('2d');
const est = document.createElement('style');
est.textContent = `body.trailer > *:not(#lienzo):not(#capaCamara):not(#trailerCapa):not(#trailerPlay) { display: none !important; }
#trailerPlay { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; background: #000; color: #fff; font: 900 22px system-ui; letter-spacing: 3px; border: 0; cursor: pointer; }`;
document.head.appendChild(est);

const ROJO = '#e1141e', BLANCO = '#f4f6fa';
const fuente = (peso, px, it = false) => `${it ? 'italic ' : ''}${peso} ${px}px "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
function texto(t, x, y, px, { peso = 900, a = 1, color = BLANCO, al = 'center', esp = 0, it = false, sombra = true } = {}) {
  g.save(); g.globalAlpha = Math.max(0, Math.min(1, a)); g.font = fuente(peso, px, it); g.textAlign = al; g.textBaseline = 'middle'; g.fillStyle = color;
  if (sombra) { g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = px * 0.35; }
  if ('letterSpacing' in g) g.letterSpacing = esp + 'px';
  g.fillText(t, x, y); g.restore();
}
const entra = (t, a, d = 0.5) => suave((t - a) / d);
const sale = (t, b, d = 0.5) => 1 - suave((t - (b - d)) / d);
const ventana = (t, a, b, d = 0.45) => Math.min(entra(t, a, d), sale(t, b, d));

function logoApex(x, y, h, a = 1, brillo = 0) {
  g.save(); g.globalAlpha = a;
  texto('APEX', x - h * 0.06, y, h, { it: true, esp: h * 0.02, al: 'right' });
  texto('GP', x + h * 0.08, y, h, { it: true, color: ROJO, al: 'left' });
  // trazo de velocidad bajo el logotipo
  g.fillStyle = ROJO; g.globalAlpha = a * 0.9;
  g.beginPath(); g.moveTo(x - h * 1.9, y + h * 0.62); g.lineTo(x + h * 1.6, y + h * 0.62); g.lineTo(x + h * 1.5, y + h * 0.7); g.lineTo(x - h * 1.95, y + h * 0.7); g.fill();
  if (brillo > 0) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = brillo * 0.5; texto('APEX GP', x, y, h, { it: true, color: '#ff8a8a' }); }
  g.restore();
}
function tarjeta(t, a, b, titulo, sub, W, H) {
  const v = ventana(t, a, b, 0.35); if (v <= 0) return;
  const x = W * 0.06 + (1 - entra(t, a, 0.35)) * -60, y = H * 0.74, w = Math.min(W * 0.46, 620), h = H * 0.1;
  g.save(); g.globalAlpha = v;
  g.fillStyle = 'rgba(8,10,16,.72)'; g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, 6) : g.rect(x, y, w, h); g.fill();
  g.fillStyle = ROJO; g.fillRect(x, y, 5, h);
  // barra de progreso que se llena mientras está la tarjeta (detalle «SaaS»)
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + 5, y + h - 3, w - 5, 3);
  g.fillStyle = ROJO; g.fillRect(x + 5, y + h - 3, (w - 5) * Math.min(1, (t - a) / (b - a)), 3);
  g.restore();
  texto(titulo, x + 22, y + h * 0.4, h * 0.34, { a: v, al: 'left', it: true, esp: 0.5 });
  texto(sub, x + 22, y + h * 0.74, h * 0.2, { a: v * 0.8, al: 'left', peso: 600, color: '#b9c2d0', sombra: false });
}

function capa(t) {
  const W = lienzo.width = innerWidth * (devicePixelRatio || 1), H = lienzo.height = innerHeight * (devicePixelRatio || 1);
  g.clearRect(0, 0, W, H);
  if (t < 0) return;
  // fundidos: desde negro al principio y a negro al final
  const negro = Math.max(1 - suave((t - 0.2) / 3.6), suave((t - (DUR - 1.6)) / 1.4));
  // franjas de cine (2,39:1)
  const fr = Math.max(0, (H - W / 2.39) / 2);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, fr); g.fillRect(0, H - fr, W, fr);
  const cx = W / 2, cy = H / 2, u = H / 720;
  // ── 0-9: UPGAMES presenta ──
  if (t < 9.2) {
    g.fillStyle = `rgba(0,0,0,${Math.min(1, 0.55 + negro)})`; g.fillRect(0, 0, W, H);
    const lin = suave((t - 0.6) / 3.8);
    g.fillStyle = ROJO; g.fillRect(cx - 260 * u * lin, cy + 34 * u, 520 * u * lin, 2 * u);
    if (t >= 4.8) {
      const golpe = Math.max(0, 1 - (t - 4.8) / 0.6);
      texto('UPGAMES', cx, cy - 6 * u, 74 * u * (1 + golpe * 0.06), { esp: 14 * u, a: sale(t, 9.1, 0.6) });
      if (golpe > 0) { g.fillStyle = `rgba(255,255,255,${golpe * 0.35})`; g.fillRect(0, 0, W, H); }
      texto('p r e s e n t a', cx, cy + 66 * u, 20 * u, { peso: 500, a: ventana(t, 6.2, 9.1, 0.8), color: '#c8ced8', esp: 4 * u, sombra: false });
    } else texto('UPGAMES', cx, cy - 6 * u, 74 * u, { esp: 14 * u, a: suave((t - 2.6) / 2.2) * 0.18 });
  }
  // ── 9-28,8: frases cortas en el tercio inferior (la narración va por encima) ──
  texto('Cada milésima cuenta.', W * 0.08, H - fr - 60 * u, 30 * u, { al: 'left', it: true, a: ventana(t, 10.2, 13.8) });
  texto('22 pilotos. Una sola línea.', W * 0.08, H - fr - 60 * u, 30 * u, { al: 'left', it: true, a: ventana(t, 19.6, 23.4) });
  // luces de salida en pantalla: se encienden con los golpes y se apagan en el drop
  if (t >= 23.6 && t < 28.95) {
    const n = Math.min(5, Math.floor(t - 23.8) + 1);
    for (let k = 0; k < 5; k++) {
      const x = cx + (k - 2) * 46 * u, y = fr + 46 * u, on = k < n && t < 28.8;
      g.beginPath(); g.arc(x, y, 15 * u, 0, Math.PI * 2); g.fillStyle = on ? '#ff1a1a' : 'rgba(30,6,6,.85)'; g.shadowColor = '#ff1a1a'; g.shadowBlur = on ? 26 * u : 0; g.fill(); g.shadowBlur = 0;
    }
  }
  // ── 28,8: APEX GP ──
  if (t >= 28.8 && t < 31.6) {
    const k = (t - 28.8), golpe = Math.max(0, 1 - k / 0.35);
    if (golpe > 0) { g.fillStyle = `rgba(255,255,255,${golpe * 0.55})`; g.fillRect(0, 0, W, H); }
    logoApex(cx, cy, 96 * u * (1.18 - 0.18 * suave(k / 0.5)), sale(t, 31.6, 0.6), golpe);
    texto('S I M U L A D O R   D E   M O N O P L A Z A S', cx, cy + 92 * u, 15 * u, { peso: 600, a: ventana(t, 29.3, 31.6, 0.5), color: '#d8dde6', sombra: false });
  }
  // ── tarjetas de características ──
  const tj = [
    [32.1, 35.6, 'Física real a 300 Hz', 'Neumáticos Pacejka · efecto suelo · transferencia de pesos'],
    [36.1, 39.6, 'El aire también corre', 'Rebufo · aire sucio · densidad del aire · viento'],
    [40.1, 43.6, '22 pilotos con IA humana', 'Frenan distinto, se equivocan, defienden y atacan'],
    [44.1, 47.6, 'Daños de verdad', 'Abolladuras, pintura que salta y piezas que vuelan'],
    [48.1, 51.6, 'Día, atardecer y noche', '13 circuitos · editor de trazados · resistencia 24 h'],
    [52.1, 55.6, 'Multijugador en línea', 'Duelos 1 vs 1 · salas de 22 · rankings mundiales'],
    [56.1, 60.6, 'La lluvia lo cambia todo', 'Agua que se acumula · spray · intermedios y de lluvia'],
    [61.0, 64.6, 'Campeonato y carrera profesional', 'Contrarreloj · fantasmas · repeticiones de cine'],
  ];
  for (const [a, b, ti, su] of tj) tarjeta(t, a, b, ti, su, W, H);
  // ── corte: cámara lenta ──
  texto('¿Estás listo?', cx, cy, 34 * u, { it: true, a: ventana(t, 65.1, 67.1, 0.4), peso: 700 });
  // ── 72: cierre ──
  if (t >= 71.8) {
    const k = t - 72, golpe = Math.max(0, 1 - k / 0.35);
    g.fillStyle = `rgba(0,0,0,${0.45 * suave((t - 71.8) / 0.4)})`; g.fillRect(0, 0, W, H);
    if (golpe > 0 && k > 0) { g.fillStyle = `rgba(255,255,255,${golpe * 0.5})`; g.fillRect(0, 0, W, H); }
    logoApex(cx, cy - 30 * u, 92 * u, entra(t, 72, 0.3), golpe);
    texto('Juega gratis en  upgames.games', cx, cy + 62 * u, 26 * u, { peso: 800, a: entra(t, 72.6, 0.5) });
    texto('ANDROID  ·  NAVEGADOR  ·  MULTIJUGADOR', cx, cy + 100 * u, 13 * u, { peso: 600, a: entra(t, 73.1, 0.5), color: '#c8ced8', esp: 3 * u, sombra: false });
    texto('UPGAMES', cx, H - fr - 28 * u, 14 * u, { peso: 800, a: entra(t, 73.4, 0.5) * 0.8, esp: 6 * u, sombra: false });
  }
  if (negro > 0.001) { g.fillStyle = `rgba(0,0,0,${negro})`; g.fillRect(0, 0, W, H); }
}

// ─── Arranque ──────────────────────────────────────────────────────────────────────────────
async function preparar() {
  while (!T.circuito || !T.sesion || !document.querySelector('#menu.visible')) await new Promise(r => setTimeout(r, 200));
  document.body.classList.add('trailer');
  T.carrera({ rivales: 11, vueltas: 3, clima: 'seco', dificultad: 'dificil' });
  const camJ = T.camara;
  // el juego llama a camara.actualizar cada fotograma: aquí manda el guion de planos
  camJ.actualizar = function (dt) {
    const t = Math.max(0, tVideo());
    const { op } = camaraPlano(this.cam, Math.min(DUR - 0.01, t));
    ambiente(t, op);
  };
  window.__trailerListo = true;
  if (!V) {
    const b = document.createElement('button'); b.id = 'trailerPlay'; b.textContent = '▶  REPRODUCIR TRÁILER'; document.body.appendChild(b);
    b.onclick = () => { audio = new Audio(new URL('./trailer_musica.mp3', import.meta.url).href); audio.currentTime = MUSICA_DESDE; audio.play().catch(() => { t0Real = performance.now(); }); b.remove(); };
  }
  const pintar = () => { requestAnimationFrame(pintar); capa(tVideo()); };
  pintar();
}
preparar();
