// UPSTAR (nombre provisional) — prototipo 1: un sistema estelar generado por fórmula a partir de
// sus coordenadas, planetas que se ven desde el espacio y en los que se aterriza sin pantallas de
// carga, nave con física arcade y estilo de dibujo cyberpunk. Funciona en navegador y en Android.

import * as THREE from 'three';
import { sistema, nombre } from './universo.js';
import { hash } from './ruido.js';
import { Planeta, estadisticasHilos } from './planeta.js';
import { Nave } from './nave.js';
import { Controles } from './controles.js';

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const movil = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

// ─── Render ──────────────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: $('#lienzo'), antialias: !movil, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
let escalaRes = 1;
const dpr = () => Math.min(devicePixelRatio || 1, movil ? 1.5 : 2) * escalaRes;
renderer.setPixelRatio(dpr()); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const ESPACIO = new THREE.Color('#07040f');
scene.background = ESPACIO.clone();
const camara = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.3, 4e6);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camara.aspect = innerWidth / innerHeight; camara.updateProjectionMatrix(); });

const luzSol = new THREE.DirectionalLight(0xffffff, 2.6);
const hemi = new THREE.HemisphereLight(0x8a7dff, 0x1a0f2e, 0.55);
scene.add(luzSol, luzSol.target, hemi);

// estrellas lejanas (siguen a la cámara: siempre en el infinito)
const estrellas = (() => {
  const n = movil ? 2500 : 5000, p = new Float32Array(n * 3), c = new Float32Array(n * 3), col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1e6);
    p.set([v.x, v.y, v.z], i * 3);
    col.setHSL([0.55, 0.85, 0.12, 0.6][i % 4], 0.8, 0.75 + Math.random() * 0.25).toArray(c, i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true }));
  m.frustumCulled = false; scene.add(m); return m;
})();
// el sol: un disco brillante lejano en la dirección de la luz
const disco = new THREE.Mesh(new THREE.SphereGeometry(16000, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(cv); })(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
halo.scale.setScalar(140000);
scene.add(disco, halo);

// ─── Universo ───────────────────────────────────────────────────────────────────────────
const nave = new Nave(scene);
const ctrl = new Controles();
let sis = null, planetas = [], dirSol = new THREE.Vector3();
let sector = (q.get('sector') || '0,0,0').split(',').map(Number);

function cargarSistema(sec) {
  for (const p of planetas) p.destruir();
  sector = sec;
  sis = sistema(...sec);
  dirSol.set(...sis.estrella.dir).normalize();
  const cs = new THREE.Color(sis.estrella.color);
  luzSol.color.copy(cs).lerp(new THREE.Color(1, 1, 1), 0.5);
  disco.material.color.copy(cs).multiplyScalar(1.6); halo.material.color.copy(cs);
  planetas = sis.planetas.map(p => new Planeta(scene, p, dirSol));
  // llegada: a una distancia de 2,6 radios del primer planeta, mirándolo
  const p0 = planetas[0], dentro = new THREE.Vector3(...p0.p.pos);
  const llegada = dentro.clone().add(new THREE.Vector3(0.35, 0.25, 1).normalize().multiplyScalar(p0.R * 2.6));
  nave.pos.copy(llegada); nave.vel.set(0, 0, 0); nave.estado = 'espacio';
  nave.modelo.lookAt(dentro); nave.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
  nave.modelo.updateMatrix();
  history.replaceState(null, '', `?sector=${sec.join(',')}`);
  $('#sistema').textContent = `Sistema ${sis.nombre}`;
  $('#sector').textContent = `Sector ${sec.join(' · ')}`;
  aviso(`SISTEMA ${sis.nombre.toUpperCase()}`, `${planetas.length} planetas · sector ${sec.join(' · ')}`);
  crearEtiquetas();
}

// ─── Cámara: persecución suave (o cabina) ───────────────────────────────────────────────────
let modoCam = 0;
const camPos = new THREE.Vector3(), camMira = new THREE.Vector3(), _v = new THREE.Vector3(), _up = new THREE.Vector3();
function moverCamara(dt, pl) {
  const off = modoCam === 0 ? _v.set(0, 3.2, 13.5) : _v.set(0, 0.55, -1.0);
  const objetivo = off.applyQuaternion(nave.quat).add(nave.pos);
  if (modoCam === 0) camPos.lerp(objetivo, 1 - Math.exp(-dt * 9)); else camPos.copy(objetivo);
  if (camPos.distanceTo(nave.pos) > 200) camPos.copy(objetivo);
  camara.position.copy(camPos);
  // «arriba» de la cámara: el de la nave, mezclado con el del planeta cerca del suelo
  _up.set(0, 1, 0).applyQuaternion(nave.quat);
  camara.up.copy(_up);
  camMira.copy(nave.delante()).multiplyScalar(modoCam === 0 ? 30 : 100).add(nave.pos);
  camara.lookAt(camMira);
  const fov = 62 + Math.min(18, nave.velocidad / 60) + (nave.pulso ? 14 : 0);
  camara.fov += (fov - camara.fov) * Math.min(1, dt * 3); camara.updateProjectionMatrix();
  nave.modelo.visible = modoCam === 0;
}

// ─── Cielo: del negro del espacio al color de la atmósfera ─────────────────────────────────────
const _c = new THREE.Color();
function cielo(pl) {
  let t = 0, colCielo = ESPACIO;
  if (pl) {
    const atm = pl.R * 0.35;
    t = Math.max(0, Math.min(1, 1 - nave.altitud / atm));
    // de día el cielo toma el color del planeta; de noche se oscurece
    _v.copy(camara.position).sub(pl.grupo.position).normalize();
    const dia = THREE.MathUtils.smoothstep(_v.dot(dirSol), -0.25, 0.35);
    colCielo = _c.set(pl.p.cielo).multiplyScalar(0.16 + 0.46 * dia).lerp(ESPACIO, 1 - dia * 0.85);
  }
  scene.background.copy(ESPACIO).lerp(colCielo, t * t);
  estrellas.material.opacity = 1 - t * 0.95;
  if (t > 0.02) {
    if (!scene.fog) scene.fog = new THREE.Fog(0, 1, 1);
    scene.fog.color.copy(scene.background);
    scene.fog.near = 400; scene.fog.far = THREE.MathUtils.lerp(400000, 9000, t);
  } else scene.fog = null;
}

// ─── Interfaz ─────────────────────────────────────────────────────────────────────────────
let etiquetas = [];
function crearEtiquetas() {
  $('#etiquetas').innerHTML = '';
  etiquetas = planetas.map(p => {
    const e = document.createElement('div'); e.className = 'etq';
    e.innerHTML = `<b>${p.p.nombre}</b><small>${p.p.tipoNombre}</small><span></span>`;
    $('#etiquetas').appendChild(e); return e;
  });
}
function hud(pl, dt) {
  const v = nave.velocidad;
  $('#vel').textContent = v > 9999 ? (v / 1000).toFixed(1) + ' km/s' : Math.round(v * 3.6) + ' km/h';
  $('#alt').textContent = !pl || nave.altitud > 1e5 ? '—' : nave.altitud > 2000 ? (nave.altitud / 1000).toFixed(1) + ' km' : Math.round(nave.altitud) + ' m';
  $('#estado').textContent = nave.pulso ? 'PULSO' : nave.estado === 'aterrizada' ? 'ATERRIZADA' : nave.estado === 'atmosfera' ? 'ATMÓSFERA' : 'ESPACIO';
  $('#estado').className = 'estado ' + (nave.pulso ? 'pulso' : nave.estado);
  $('#acelBar').style.width = Math.round(nave.empuje * 100) + '%';
  if (pl) {
    $('#planeta').innerHTML = `<b>${pl.p.nombre}</b> · ${pl.p.tipoNombre} · g ${pl.p.gravedad.toFixed(1)} m/s²${pl.p.anillos ? ' · anillos' : ''}`;
  }
  // etiquetas de los planetas en pantalla (se ocultan al estar dentro de la atmósfera)
  planetas.forEach((p, k) => {
    const e = etiquetas[k]; if (!e) return;
    _v.copy(p.grupo.position);
    const d = _v.distanceTo(camara.position) - p.R;
    _v.project(camara);
    const visible = _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05 && !(p === pl && nave.altitud < p.R * 0.5);
    e.style.display = visible ? '' : 'none';
    if (visible) {
      e.style.transform = `translate(${(_v.x * 0.5 + 0.5) * innerWidth}px, ${(-_v.y * 0.5 + 0.5) * innerHeight}px)`;
      e.querySelector('span').textContent = d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
    }
  });
  const hs = estadisticasHilos();
  fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    const fps = fpsN / fpsT; fpsN = 0; fpsT = 0;
    $('#fps').textContent = `${fps.toFixed(0)} FPS · ${planetas.reduce((s, p) => s + p.trozos, 0)} trozos · cola ${hs.cola}`;
    // resolución dinámica
    if (fps < 45 && escalaRes > 0.65) { escalaRes -= 0.1; renderer.setPixelRatio(dpr()); }
    else if (fps > 57 && escalaRes < 1) { escalaRes = Math.min(1, escalaRes + 0.05); renderer.setPixelRatio(dpr()); }
  }
}
let fpsN = 0, fpsT = 0, tAviso = 0;
function aviso(t, s = '', dur = 3.5) { $('#aviso').innerHTML = `${t}<small>${s}</small>`; $('#aviso').classList.add('visible'); tAviso = dur; }
nave.alAterrizar = () => { const pl = cercano(); aviso('ATERRIZAJE', pl ? `Bienvenido a ${pl.p.nombre}` : '', 2.5); };

function cercano() {
  let mejor = null, dm = Infinity;
  for (const p of planetas) { const d = nave.pos.distanceTo(p.grupo.position) - p.R; if (d < dm) { dm = d; mejor = p; } }
  return mejor && dm < mejor.R * 3 ? mejor : null;
}

// ─── Bucle ─────────────────────────────────────────────────────────────────────────────────
let tPrev = performance.now();
function bucle(ahora) {
  requestAnimationFrame(bucle);
  const dt = Math.min(0.05, (ahora - tPrev) / 1000); tPrev = ahora;
  const { m, ev } = ctrl.leer();
  for (const e of ev) {
    if (e === 'camara') modoCam = (modoCam + 1) % 2;
    if (e === 'saltar') { const s = sector.slice(); s[hash(Date.now()) % 3] += (hash(Date.now(), 1) % 2 ? 1 : -1); cargarSistema(s); }
  }
  const pl = cercano();
  nave.actualizar(dt, m, pl);
  moverCamara(dt, pl);
  for (const p of planetas) p.actualizar(camara.position);
  // sol y luz: siempre en la dirección de la estrella respecto a la cámara
  disco.position.copy(camara.position).addScaledVector(dirSol, 2.5e6);
  halo.position.copy(disco.position);
  estrellas.position.copy(camara.position);
  luzSol.position.copy(camara.position).addScaledVector(dirSol, 1000); luzSol.target.position.copy(camara.position);
  cielo(pl);
  hud(pl, dt);
  if (tAviso > 0) { tAviso -= dt; if (tAviso <= 0) $('#aviso').classList.remove('visible'); }
  renderer.render(scene, camara);
}

cargarSistema(sector);
requestAnimationFrame(bucle);
$('#carga').classList.add('oculta');
window.upstar = { nave, get planetas() { return planetas; }, camara, renderer, scene, cargarSistema };
