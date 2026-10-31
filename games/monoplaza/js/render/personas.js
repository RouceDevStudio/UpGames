// Personas del equipo: un esqueleto articulado (cadera, columna, pecho, cuello, cabeza,
// hombros, codos, muñecas, caderas, rodillas y tobillos) con mallas suaves (tornos y
// cápsulas), mono ignífugo con texturas del equipo y patrocinadores, casco con visera,
// guantes, botas y auriculares. Se anima mezclando poses (de pie, agachado con la
// pistola, cargando rueda, gato, estabilizador, celebrar…) y ciclos procedurales
// (andar, respirar, correr, saltar).
//
// Ejes de cada persona: +x hacia delante, +y arriba, +z a su derecha.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cuerpoListo, geometriasCuerpo } from './cuerpoStudio.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const suave = (t) => t * t * (3 - 2 * t);

// ─── Texturas ────────────────────────────────────────────────────────────────
const cacheTex = new Map();

function lienzo(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function aTex(cv, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function oscurecer(hex, f) {
  const c = new THREE.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString();
}

// Tejido del mono: trama fina en el mapa de normales (luz rasante en las arrugas del Nomex)
function normalTela() {
  if (cacheTex.has('normalTela')) return cacheTex.get('normalTela');
  const n = 128, cv = lienzo(n, n), x = cv.getContext('2d'), img = x.createImageData(n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = Math.sin(i * Math.PI / 2) * 0.5, b = Math.sin(j * Math.PI / 2) * 0.5;
    const k = (j * n + i) * 4;
    img.data[k] = 128 + a * 50; img.data[k + 1] = 128 + b * 50; img.data[k + 2] = 240; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = aTex(cv, false); t.repeat.set(10, 10);
  cacheTex.set('normalTela', t);
  return t;
}

// Pliegues del mono de piloto (como el modelo esculpido de referencia): arrugas grandes y
// alargadas que siguen las extremidades, más las costuras acolchadas. Mapa de normales.
export function normalPliegues() {
  if (cacheTex.has('pliegues')) return cacheTex.get('pliegues');
  const n = 256, cv = lienzo(n, n), x = cv.getContext('2d'), img = x.createImageData(n, n);
  const H = new Float32Array(n * n);
  let sem = 7; const r = () => { sem = (sem * 16807) % 2147483647; return sem / 2147483647; };
  const ondas = Array.from({ length: 22 }, () => ({ fx: Math.floor(r() * 7) - 3, fy: 2 + Math.floor(r() * 7), f: r() * 6.28, a: 0.25 + r() * 0.5, d: (r() - 0.5) * 4 }));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = i / n * Math.PI * 2, v = j / n * Math.PI * 2;
    let h = 0;
    for (const o of ondas) h += o.a * Math.pow(Math.abs(Math.sin(o.fy * v + o.fx * u + o.d * Math.sin(u * 2 + o.f) + o.f)), 3);
    // costuras del acolchado (líneas finas que dan la vuelta)
    if (j % 64 < 2) h -= 1.2;
    H[j * n + i] = h;
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const hx = H[j * n + (i + 1) % n] - H[j * n + (i - 1 + n) % n], hy = H[((j + 1) % n) * n + i] - H[((j - 1 + n) % n) * n + i];
    const k = (j * n + i) * 4, nx = -hx * 0.55, ny = -hy * 0.55, nz = 1, l = Math.hypot(nx, ny, nz);
    img.data[k] = 128 + nx / l * 127; img.data[k + 1] = 128 + ny / l * 127; img.data[k + 2] = 128 + nz / l * 127; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = aTex(cv, false); t.repeat.set(2, 2);
  cacheTex.set('pliegues', t);
  return t;
}

// Bota de piloto: piel lisa con cordones cruzados delante
function texturaBota() {
  if (cacheTex.has('bota')) return cacheTex.get('bota');
  const cv = lienzo(128, 128), x = cv.getContext('2d');
  x.fillStyle = '#1c1c1e'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#d8d8dc'; x.lineWidth = 2.2;
  for (let k = 0; k < 7; k++) { const y = 18 + k * 14; x.beginPath(); x.moveTo(48, y); x.lineTo(80, y + 10); x.moveTo(80, y); x.lineTo(48, y + 10); x.stroke(); }
  x.fillStyle = '#555'; x.fillRect(0, 118, 128, 10);          // suela
  const t = aTex(cv); cacheTex.set('bota', t); return t;
}

// Mono del equipo: color base, laterales oscuros, vivos claros, patrocinadores delante y detrás.
// El torso es un torno: u da la vuelta al cuerpo (u = 0.25 delante, 0.75 detrás), v sube.
function texturaMono(color, texto, numero) {
  const clave = 'mono' + color + texto + numero;
  if (cacheTex.has(clave)) return cacheTex.get(clave);
  const W = 1024, H = 512, cv = lienzo(W, H), x = cv.getContext('2d');
  const claro = new THREE.Color(color).getHSL({}).l > 0.6;
  x.fillStyle = color; x.fillRect(0, 0, W, H);
  // laterales en un tono más oscuro y vivos reflectantes
  x.fillStyle = oscurecer(color, 0.55);
  for (const u of [0, 0.5]) x.fillRect((u - 0.06) * W, 0, 0.12 * W, H), x.fillRect((u + 1 - 0.06) * W, 0, 0.12 * W, H);
  x.fillStyle = claro ? '#1a1a1a' : '#f4f4f4';
  for (const u of [0.06, 0.44, 0.56, 0.94]) x.fillRect(u * W - 3, 0, 6, H);
  // cinturón
  x.fillStyle = oscurecer(color, 0.35); x.fillRect(0, H * 0.06, W, H * 0.07);
  // patrocinadores
  const tinta = claro ? '#111' : '#fff';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = tinta; x.font = '900 italic 64px Arial, sans-serif';
  x.fillText(texto, 0.25 * W, H * 0.62);
  x.font = '900 italic 52px Arial, sans-serif';
  x.fillText(texto, 0.75 * W, H * 0.7);
  x.font = '800 30px Arial, sans-serif';
  x.fillText('UPCOINS', 0.25 * W, H * 0.4);
  x.fillText('APEX GP', 0.75 * W, H * 0.45);
  // número del mecánico en la espalda
  x.font = '900 120px Arial, sans-serif';
  x.globalAlpha = 0.9; x.fillText(String(numero), 0.75 * W, H * 0.25); x.globalAlpha = 1;
  // pequeñas costuras
  x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 2;
  for (let k = 0; k < 6; k++) { x.beginPath(); x.moveTo(0, H * (0.15 + k * 0.15)); x.lineTo(W, H * (0.15 + k * 0.15) + 3); x.stroke(); }
  const t = aTex(cv);
  cacheTex.set(clave, t);
  return t;
}

// Mangas y perneras: color con una franja lateral
function texturaManga(color) {
  const clave = 'manga' + color;
  if (cacheTex.has(clave)) return cacheTex.get(clave);
  const cv = lienzo(256, 128), x = cv.getContext('2d');
  const claro = new THREE.Color(color).getHSL({}).l > 0.6;
  x.fillStyle = color; x.fillRect(0, 0, 256, 128);
  x.fillStyle = oscurecer(color, 0.55); x.fillRect(0, 0, 40, 128); x.fillRect(216, 0, 40, 128);
  x.fillStyle = claro ? '#222' : '#f2f2f2'; x.fillRect(38, 0, 4, 128); x.fillRect(214, 0, 4, 128);
  const t = aTex(cv);
  cacheTex.set(clave, t);
  return t;
}

// Casco de mecánico: color del equipo, franja, número y logotipo
function texturaCasco(color) {
  const clave = 'casco' + color;
  if (cacheTex.has(clave)) return cacheTex.get(clave);
  const cv = lienzo(512, 256), x = cv.getContext('2d');
  const claro = new THREE.Color(color).getHSL({}).l > 0.6;
  x.fillStyle = color; x.fillRect(0, 0, 512, 256);
  x.fillStyle = claro ? '#1c1c1c' : '#ffffff';
  x.fillRect(0, 70, 512, 18);
  x.font = '900 italic 40px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('UPGAMES', 384, 40); x.fillText('UPGAMES', 128, 40);
  const t = aTex(cv);
  cacheTex.set(clave, t);
  return t;
}

// Piel con algo de variación (rostros de los ingenieros sin casco)
function texturaPiel(tono) {
  const clave = 'piel' + tono;
  if (cacheTex.has(clave)) return cacheTex.get(clave);
  const cv = lienzo(256, 128), x = cv.getContext('2d');
  x.fillStyle = tono; x.fillRect(0, 0, 256, 128);
  for (let k = 0; k < 900; k++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '90,50,40' : '255,230,210'},0.05)`; x.fillRect(Math.random() * 256, Math.random() * 128, 2, 2); }
  // la cara mira hacia u = 0.25 (x = 64 en el lienzo): sombras suaves, cejas, ojos, labios y barba
  const cx = 64;
  const sombra = (x0, y0, r, col) => { const g = x.createRadialGradient(x0, y0, 0, x0, y0, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(x0 - r, y0 - r, 2 * r, 2 * r); };
  sombra(cx - 11, 60, 9, 'rgba(70,40,30,.28)'); sombra(cx + 11, 60, 9, 'rgba(70,40,30,.28)');   // cuencas
  sombra(cx - 16, 78, 10, 'rgba(200,90,80,.12)'); sombra(cx + 16, 78, 10, 'rgba(200,90,80,.12)'); // mejillas
  sombra(cx, 96, 22, 'rgba(60,40,30,.18)');                                                         // barba de unos días
  x.strokeStyle = 'rgba(45,28,20,.9)'; x.lineWidth = 2.6; x.lineCap = 'round';
  for (const sg of [-1, 1]) { x.beginPath(); x.moveTo(cx + sg * 4, 52); x.quadraticCurveTo(cx + sg * 11, 48, cx + sg * 18, 53); x.stroke(); }
  for (const sg of [-1, 1]) {
    x.fillStyle = '#f3efe8'; x.beginPath(); x.ellipse(cx + sg * 11, 60, 5, 2.6, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#4a3020'; x.beginPath(); x.arc(cx + sg * 11, 60, 2.2, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#111'; x.beginPath(); x.arc(cx + sg * 11, 60, 1, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(40,25,20,.6)'; x.lineWidth = 1; x.beginPath(); x.ellipse(cx + sg * 11, 59.5, 5.2, 2.8, 0, Math.PI, 0); x.stroke();
  }
  x.fillStyle = 'rgba(150,70,65,.85)'; x.beginPath(); x.ellipse(cx, 87, 7, 2.2, 0, 0, Math.PI * 2); x.fill();
  x.strokeStyle = 'rgba(90,40,35,.7)'; x.lineWidth = 1; x.beginPath(); x.moveTo(cx - 7, 87); x.lineTo(cx + 7, 87); x.stroke();
  const t = aTex(cv);
  cacheTex.set(clave, t);
  return t;
}

// ─── Geometrías compartidas ──────────────────────────────────────────────────
let G = null;
function torno(perfil, seg = 14) {
  seg = Math.round(seg * 1.5);              // más lados: cuerpos redondos, no facetados
  const g = new THREE.LatheGeometry(perfil.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.computeVertexNormals();
  return g;
}
function geometrias() {
  if (G) return G;
  G = {
    // pelvis y torso (el torso se aplana con scale.z en la malla)
    pelvis: torno([[0.001, -0.06], [0.15, -0.05], [0.17, 0.04], [0.155, 0.12], [0.001, 0.13]]),
    torso: torno([[0.001, 0], [0.15, 0.0], [0.155, 0.12], [0.165, 0.26], [0.19, 0.38], [0.2, 0.44], [0.15, 0.5], [0.06, 0.53], [0.001, 0.535]], 18),
    cuello: torno([[0.001, 0], [0.055, 0], [0.05, 0.09], [0.001, 0.1]], 10),
    craneo: new THREE.SphereGeometry(0.1, 16, 12),
    // extremidades: tornos estrechándose hacia abajo (eje -y)
    brazo: torno([[0.001, 0.02], [0.055, 0.0], [0.058, -0.06], [0.05, -0.2], [0.045, -0.29], [0.04, -0.3], [0.001, -0.31]], 12),
    antebrazo: torno([[0.001, 0.01], [0.047, 0], [0.045, -0.08], [0.036, -0.24], [0.001, -0.26]], 10),
    mano: new THREE.CapsuleGeometry(0.035, 0.08, 4, 8),
    muslo: torno([[0.001, 0.02], [0.085, 0], [0.083, -0.1], [0.065, -0.38], [0.058, -0.44], [0.001, -0.45]], 12),
    pierna: torno([[0.001, 0.01], [0.058, 0], [0.06, -0.1], [0.045, -0.38], [0.04, -0.43], [0.001, -0.44]], 12),
    pie: new THREE.BoxGeometry(0.26, 0.08, 0.1, 2, 1, 1),
    // casco de boxes: cúpula + visera + mentonera
    casco: new THREE.SphereGeometry(0.145, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
    visera: new THREE.SphereGeometry(0.15, 18, 10, -Math.PI * 0.3, Math.PI * 0.6, Math.PI * 0.33, Math.PI * 0.28),
    mentonera: new THREE.TorusGeometry(0.115, 0.03, 8, 16, Math.PI * 0.9),
    gorra: new THREE.SphereGeometry(0.108, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
    visor: new THREE.CylinderGeometry(0.12, 0.12, 0.012, 14, 1, false, -Math.PI * 0.4, Math.PI * 0.8),
    cascos: new THREE.TorusGeometry(0.115, 0.012, 6, 16, Math.PI),
    orejera: new THREE.CylinderGeometry(0.045, 0.045, 0.035, 12),
    nariz: new THREE.ConeGeometry(0.017, 0.034, 8),
    oreja: new THREE.SphereGeometry(0.026, 8, 6),
    pelo: new THREE.SphereGeometry(0.104, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    hombro: new THREE.SphereGeometry(0.057, 18, 14),
    codo: new THREE.SphereGeometry(0.041, 16, 12),
    rodilla: new THREE.SphereGeometry(0.064, 16, 12),
  };
  // piezas del piloto (guantes, botas, arnés)
  G.puno = new THREE.CylinderGeometry(0.045, 0.04, 0.07, 12);
  G.palma = new THREE.BoxGeometry(0.035, 0.08, 0.085); G.palma.translate(0, 0, 0);
  G.dedos = new THREE.CapsuleGeometry(0.02, 0.05, 3, 8); G.dedos.scale(0.85, 1, 2.0);
  G.pulgar = new THREE.CapsuleGeometry(0.012, 0.035, 3, 6);
  G.hombrera = new THREE.BoxGeometry(0.11, 0.02, 0.07);
  G.cana = new THREE.CylinderGeometry(0.052, 0.048, 0.16, 14);
  G.zapato = new THREE.CapsuleGeometry(0.045, 0.16, 4, 10); G.zapato.rotateZ(Math.PI / 2); G.zapato.scale(1, 0.75, 1.05);
  G.rodillera = new THREE.SphereGeometry(0.05, 12, 8); G.rodillera.scale(0.45, 1.15, 0.9);
  G.cintaHombro = new THREE.BoxGeometry(0.012, 0.36, 0.05);
  G.ajuste = new THREE.BoxGeometry(0.012, 0.035, 0.06);
  G.cinturon = new THREE.TorusGeometry(0.17, 0.022, 6, 24); G.cinturon.rotateX(Math.PI / 2);
  G.hebilla = new THREE.CylinderGeometry(0.035, 0.035, 0.016, 18);
  G.cintaPierna = new THREE.BoxGeometry(0.012, 0.16, 0.045);
  G.cuelloMono = new THREE.CylinderGeometry(0.065, 0.075, 0.05, 14, 1, true);
  G.nariz.rotateZ(-Math.PI / 2 - 0.35);
  G.pie.translate(0.06, -0.035, 0);
  G.mano.translate(0, -0.06, 0);
  G.mentonera.rotateY(Math.PI / 2); G.mentonera.rotateX(Math.PI / 2 + 0.25);
  G.orejera.rotateX(Math.PI / 2);
  return G;
}

// ─── Poses ───────────────────────────────────────────────────────────────────
// Cada pose: altura de la cadera (y) e inclinaciones en radianes por hueso [x, y, z].
// Recordatorio: rotación z positiva en un brazo o muslo lo lleva hacia delante; en la
// rodilla, negativa la dobla hacia atrás; en el tronco, negativa lo inclina hacia delante.
const P = {
  de_pie: { y: 0.95, tronco: [0, 0, 0.02], cabeza: [0, 0, 0], hI: [0.08, 0, 0.05], hD: [-0.08, 0, 0.05], cI: [0, 0, 0.18], cD: [0, 0, 0.18], mI: [0, 0, 0], mD: [0, 0, 0], kI: [0, 0, 0.04], kD: [0, 0, 0.04], rI: [0, 0, -0.06], rD: [0, 0, -0.06] },
  preparado: { y: 0.82, tronco: [0, 0, -0.35], cabeza: [0, 0, 0.3], hI: [0.15, 0, 0.7], hD: [-0.15, 0, 0.7], cI: [0, 0, 0.5], cD: [0, 0, 0.5], kI: [0.05, 0, 0.6], kD: [-0.05, 0, 0.6], rI: [0, 0, -0.95], rD: [0, 0, -0.95] },
  // de rodillas con la pistola en la tuerca: rodilla izquierda en el suelo
  pistola: { y: 0.5, tronco: [0, 0, -0.45], cabeza: [0, 0, 0.35], hI: [0.15, 0.2, 1.25], hD: [-0.2, -0.1, 1.05], cI: [0, 0, 0.35], cD: [0, 0, 0.45], mI: [0, 0, 0], mD: [0, 0, -0.2], kI: [0.1, 0, 0.1], kD: [-0.1, 0, 1.45], rI: [0, 0, -2.0], rD: [0, 0, -1.55] },
  // agachado sujetando una rueda delante del pecho
  rueda: { y: 0.78, tronco: [0, 0, -0.3], cabeza: [0, 0, 0.2], hI: [0.35, 0, 0.9], hD: [-0.35, 0, 0.9], cI: [0.5, 0, 0.9], cD: [-0.5, 0, 0.9], kI: [0.05, 0, 0.75], kD: [-0.05, 0, 0.75], rI: [0, 0, -1.1], rD: [0, 0, -1.1] },
  // rueda sujeta en alto, caminando hacia atrás
  ruedaAlta: { y: 0.92, tronco: [0, 0, 0.08], cabeza: [0, 0, 0], hI: [0.4, 0, 1.25], hD: [-0.4, 0, 1.25], cI: [0.4, 0, 1.0], cD: [-0.4, 0, 1.0], kI: [0, 0, 0.1], kD: [0, 0, 0.1], rI: [0, 0, -0.2], rD: [0, 0, -0.2] },
  // operario del gato: empuja la palanca hacia abajo con las dos manos
  gato: { y: 0.85, tronco: [0, 0, -0.6], cabeza: [0, 0, 0.45], hI: [0.15, 0, 1.15], hD: [-0.15, 0, 1.15], cI: [0, 0, 0.15], cD: [0, 0, 0.15], kI: [0.05, 0, 0.75], kD: [-0.05, 0, 0.2], rI: [0, 0, -0.75], rD: [0, 0, -0.35] },
  // estabilizador: inclinado sujetando el pontón
  estabiliza: { y: 0.7, tronco: [0, 0, -0.7], cabeza: [0, 0, 0.5], hI: [0.2, 0, 1.3], hD: [-0.2, 0, 1.3], cI: [0, 0, 0.3], cD: [0, 0, 0.3], kI: [0.1, 0, 1.0], kD: [-0.1, 0, 0.6], rI: [0, 0, -1.5], rD: [0, 0, -0.9] },
  // ingeniero sentado en el muro, mirando las pantallas
  sentado: { y: 0.62, tronco: [0, 0, -0.08], cabeza: [0, 0, 0.1], hI: [0.1, 0, 0.55], hD: [-0.1, 0, 0.55], cI: [0, 0, 1.1], cD: [0, 0, 1.1], kI: [0.08, 0, 1.5], kD: [-0.08, 0, 1.5], rI: [0, 0, -1.5], rD: [0, 0, -1.5] },
  // celebración: brazos arriba
  celebra: { y: 0.95, tronco: [0, 0, 0.1], cabeza: [0, 0, -0.25], hI: [1.0, 0, 2.6], hD: [-1.0, 0, 2.6], cI: [0, 0, 0.3], cD: [0, 0, 0.3], kI: [0, 0, 0.05], kD: [0, 0, 0.05], rI: [0, 0, -0.05], rD: [0, 0, -0.05] },
  // el de la piruleta / señalero con el brazo derecho estirado
  senala: { y: 0.95, tronco: [0, 0, 0], cabeza: [0, 0, 0], hI: [0.08, 0, 0.1], hD: [-0.2, 0, 1.55], cI: [0, 0, 0.2], cD: [0, 0, 0.05], kI: [0, 0, 0.03], kD: [0, 0, 0.03], rI: [0, 0, -0.05], rD: [0, 0, -0.05] },
  // manos en la cintura, esperando
  lamento: { y: 0.95, tronco: [0, 0, -0.18], cabeza: [0, 0, 0.4], hI: [0.55, 0, 2.35], hD: [-0.55, 0, 2.35], cI: [0, 0, 2.1], cD: [0, 0, 2.1], kI: [0, 0, 0.04], kD: [0, 0, 0.04], rI: [0, 0, -0.06], rD: [0, 0, -0.06] },
  // salir del monoplaza: de pie dentro del habitáculo apoyado en el halo, y pasando una pierna
  apoya: { y: 0.9, tronco: [0, 0, -0.32], cabeza: [0, 0, 0.15], hI: [0.25, 0, 1.1], hD: [-0.25, 0, 1.1], cI: [0, 0, 0.55], cD: [0, 0, 0.55], kI: [0.04, 0, 0.35], kD: [-0.04, 0, 0.35], rI: [0, 0, -0.5], rD: [0, 0, -0.5] },
  trepa: { y: 0.88, tronco: [0, 0, -0.25], cabeza: [0, 0, 0.1], hI: [0.35, 0, 0.6], hD: [-0.1, 0, 1.0], cI: [0, 0, 0.4], cD: [0, 0, 0.6], kI: [0.35, 0, 1.25], kD: [0, 0, 0.1], rI: [0, 0, -1.4], rD: [0, 0, -0.15] },
  quita_volante: { y: 0.62, tronco: [0, 0, -0.05], cabeza: [0, 0, 0.2], hI: [0.15, 0, 1.35], hD: [-0.15, 0, 1.35], cI: [0, 0, 0.5], cD: [0, 0, 0.5], kI: [0.08, 0, 1.5], kD: [-0.08, 0, 1.5], rI: [0, 0, -1.5], rD: [0, 0, -1.5] },
  jarra: { y: 0.95, tronco: [0, 0, 0.02], cabeza: [0, 0.15, 0.02], hI: [0.78, 0.6, 0.05], hD: [-0.12, 0, 0.12], cI: [0, 0, -1.62], cD: [0, 0, 0.35], kI: [0.06, 0, 0.03], kD: [-0.04, 0, 0.05], rI: [0, 0, -0.04], rD: [0, 0, -0.05] },
  espera: { y: 0.95, tronco: [0, 0, 0], cabeza: [0, 0, 0.05], hI: [0.35, 0, -0.2], hD: [-0.35, 0, -0.2], cI: [-0.6, 0, 1.6], cD: [0.6, 0, 1.6], kI: [0.05, 0, 0.03], kD: [-0.05, 0, -0.05], rI: [0, 0, -0.04], rD: [0, 0, -0.04] },
};
const HUESOS = ['tronco', 'cabeza', 'hI', 'hD', 'cI', 'cD', 'mI', 'mD', 'kI', 'kD', 'rI', 'rD'];

/**
 * opc: { color, texto, numero, rol: 'mecanico' | 'ingeniero' | 'piloto', piel, alto }
 */
export class Persona {
  constructor({ color = '#0d47ff', texto = 'UPGAMES', numero = 1, rol = 'mecanico', piel = '#c9967a', alto = 1, calidad = 2, podio = false } = {}) {
    const g = geometrias();
    this.rol = rol;
    const piloto = rol === 'piloto';
    // el mono del piloto lleva los pliegues marcados del Nomex (como el modelo de referencia)
    const normal = piloto && calidad >= 1 ? normalPliegues() : calidad >= 2 ? normalTela() : null;
    const escN = piloto ? 0.6 : 0.35;
    const tela = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.85, normalMap: normal, normalScale: new THREE.Vector2(escN, escN) });
    const matTorso = tela(texturaMono(color, texto, numero));
    const matManga = tela(texturaManga(color));
    const matNegro = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7 });
    const matBota = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.5, metalness: 0.05 });
    const matPiel = new THREE.MeshStandardMaterial({ map: texturaPiel(piel), roughness: 0.6 });

    const R = this.raiz = new THREE.Group();
    // las piezas se cuelgan de los huesos mientras se construye; al final se funden en una
    // sola malla con esqueleto (cada pieza sigue rígidamente a su hueso): ~6 llamadas de
    // dibujo por persona en vez de ~30
    const huesos = [], piezas = [];
    const BASE = new THREE.Group(); R.add(BASE);
    const malla = (geo, mat, padre, x = 0, y = 0, z = 0) => {
      const m = new THREE.Object3D(); m.position.set(x, y, z); padre.add(m);
      piezas.push({ geo, mat, m, hueso: padre });
      return m;
    };
    const hueso = (padre, x, y, z, nombre = '') => { const h = new THREE.Bone(); h.name = nombre; h.position.set(x, y, z); (padre || BASE).add(h); huesos.push(h); return h; };
    // cuerpo de UpGames Studio (una malla suave con mono, guantes y botas) si está cargado;
    // si no, las piezas de siempre
    const nuevo = cuerpoListo();

    // cadera (raíz animada) y pelvis
    const cadera = this.cadera = hueso(null, 0, 0.95, 0, 'cadera');
    if (!nuevo) malla(g.pelvis, matTorso, cadera).scale.set(1, 1, 1.15);
    // tronco
    const tronco = this.tronco = hueso(cadera, 0, 0.1, 0, 'tronco');
    if (!nuevo) { const mt = malla(g.torso, matTorso, tronco); mt.scale.set(piloto ? 0.9 : 0.8, 1, piloto ? 1.18 : 1.1); }
    const matCuello = new THREE.MeshStandardMaterial({ color: piel, roughness: 0.6 });
    const cuello = hueso(tronco, 0.01, 0.49, 0, 'cuello');
    if (!nuevo) malla(g.cuello, rol === 'mecanico' ? matNegro : matCuello, cuello).scale.set(1, 0.75, 1);   // verdugo ignífugo
    const cabeza = this.cabeza = hueso(cuello, 0.01, 0.06, 0, 'cabeza');
    if (rol === 'mecanico') {
      const matCasco = new THREE.MeshStandardMaterial({ map: texturaCasco(color), roughness: 0.25, metalness: 0.1 });
      malla(g.craneo, matNegro, cabeza, 0, 0.09, 0);
      malla(g.casco, matCasco, cabeza, 0, 0.1, 0);
      const vis = malla(g.visera, new THREE.MeshStandardMaterial({ color: 0x0c1016, roughness: 0.05, metalness: 0.8 }), cabeza, 0, 0.1, 0);
      vis.rotation.y = Math.PI;
      malla(g.mentonera, matCasco, cabeza, 0.02, 0.06, 0);
    } else if (piloto && !podio) {
      // cabeza bajo el casco (el casco se pone aparte): solo el sotocasco ignífugo
      malla(g.craneo, matNegro, cabeza, 0.01, 0.1, 0).scale.set(0.95, 1.1, 0.88);
    } else {
      const cr = malla(g.craneo, matPiel, cabeza, 0.01, 0.1, 0); cr.scale.set(0.95, 1.12, 0.88); cr.rotation.y = Math.PI / 2;
      malla(g.nariz, matCuello, cabeza, 0.098, 0.09, 0);
      for (const z of [-0.088, 0.088]) malla(g.oreja, matCuello, cabeza, 0.0, 0.1, z).scale.set(0.7, 1.2, 0.45);
      const colPelo = ['#2a1a10', '#3b2414', '#141110', '#6b4a2a'][Math.floor(Math.random() * 4)];
      malla(g.pelo, new THREE.MeshStandardMaterial({ color: colPelo, roughness: 0.95 }), cabeza, -0.012, 0.115, 0).scale.set(1.0, 1.0, 0.92);
      // gorra del equipo y auriculares de radio
      const matGorra = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
      malla(g.gorra, matGorra, cabeza, 0, 0.14, 0).scale.set(1.02, 0.85, 0.95);
      malla(g.visor, matGorra, cabeza, 0.03, 0.15, 0).rotation.y = Math.PI / 2;
      if (rol === 'ingeniero') {
        malla(g.cascos, matNegro, cabeza, 0, 0.12, 0).rotation.y = Math.PI / 2;
        for (const z of [-0.1, 0.1]) malla(g.orejera, matNegro, cabeza, 0, 0.1, z);
      }
    }
    if (piloto) {
      const matCinta = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.7 });
      const matMetal = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 1, roughness: 0.3 });
      // con el cuerpo de Studio el pecho y la cintura son más finos: el arnés se ajusta a ellos
      const f = nuevo ? 0.86 : 1, yc = nuevo ? -0.05 : 0.03;
      for (const l of [-1, 1]) {
        malla(G.cintaHombro, matCinta, tronco, 0.135 * f, 0.25, l * 0.07).rotation.x = -l * 0.12;     // tirantes
        malla(G.ajuste, matMetal, tronco, 0.15 * f, 0.38, l * 0.075);                                 // hebillas de ajuste
      }
      malla(G.cinturon, matCinta, tronco, 0, yc, 0).scale.set(nuevo ? 0.68 : 0.82, 1, nuevo ? 0.98 : 1.12); // cinturón abdominal
      malla(G.hebilla, matMetal, tronco, nuevo ? 0.118 : 0.165, yc + 0.01, 0).rotation.z = Math.PI / 2;     // cierre rotatorio
      malla(G.cintaPierna, matCinta, tronco, nuevo ? 0.112 : 0.16, yc - 0.09, 0);                       // la de la entrepierna
      if (!nuevo) malla(G.cuelloMono, matManga, cuello, 0, 0.0, 0);                                     // cuello del mono
    }
    // brazos: hombro → codo → muñeca
    const brazo = (lado) => {
      const z = lado * 0.21;
      const l = lado < 0 ? 'I' : 'D';
      const h = hueso(tronco, 0, 0.43, z, 'h' + l);
      const c = hueso(h, 0, -0.29, 0, 'c' + l);
      const m = hueso(c, 0, -0.25, 0, 'm' + l);
      if (nuevo) return { h, c, m };
      const gr = piloto ? 1.28 : 1;            // el mono ignífugo es holgado
      malla(g.hombro, matManga, h).scale.setScalar(gr);
      malla(g.brazo, matManga, h).scale.set(gr, 1, gr);
      malla(g.codo, matManga, c).scale.setScalar(gr);
      malla(g.antebrazo, matManga, c).scale.set(gr, 1, gr);
      if (piloto) {
        // guante de piloto: puño largo, palma, dedos juntos y pulgar; hombrera del mono
        const matGuante = matNegro;
        malla(G.puno, matGuante, m, 0, 0.02, 0);
        malla(G.palma, matGuante, m, 0, -0.055, 0);
        malla(G.dedos, matGuante, m, 0.008, -0.125, 0);
        malla(G.pulgar, matGuante, m, 0.03, -0.07, lado * 0.03).rotation.z = 0.5;
        malla(G.hombrera, matManga, h, 0, 0.05, 0);
      } else malla(g.mano, matNegro, m);              // guantes
      return { h, c, m };
    };
    const bI = brazo(-1), bD = brazo(1);
    this.hI = bI.h; this.cI = bI.c; this.mI = bI.m;
    this.hD = bD.h; this.cD = bD.c; this.mD = bD.m;
    // piernas: cadera → rodilla → tobillo
    const pierna = (lado) => {
      const l = lado < 0 ? 'I' : 'D';
      const k = hueso(cadera, 0, -0.02, lado * 0.095, 'k' + l);
      const r = hueso(k, 0, -0.44, 0, 'r' + l);
      const t = hueso(r, 0, -0.43, 0, 't' + l);
      if (nuevo) return { k, r, t };
      const gp = piloto ? 1.22 : 1;
      malla(g.muslo, matManga, k).scale.set(gp, 1, gp);
      malla(g.rodilla, matManga, r).scale.setScalar(gp);
      malla(g.pierna, matManga, r).scale.set(gp, 1, gp);
      if (piloto) {
        // botas altas de piloto con cordones y rodillera acolchada
        const matB = new THREE.MeshStandardMaterial({ map: texturaBota(), roughness: 0.45 });
        malla(G.cana, matB, t, 0, 0.06, 0);
        malla(G.zapato, matB, t, 0.05, -0.04, 0);
        malla(G.rodillera, matManga, r, 0.045, 0, 0);
      } else malla(g.pie, matBota, t);
      return { k, r, t };
    };
    const pI = pierna(-1), pD = pierna(1);
    this.kI = pI.k; this.rI = pI.r; this.tI = pI.t;
    this.kD = pD.k; this.rD = pD.r; this.tD = pD.t;

    // fundir las piezas en una malla con esqueleto, agrupadas por material
    BASE.updateMatrixWorld(true);
    const porMat = new Map();
    const inv = new THREE.Matrix4().copy(BASE.matrixWorld).invert(), mtx = new THREE.Matrix4();
    for (const p of piezas) {
      p.m.updateMatrixWorld(true);
      const geo = p.geo.index ? p.geo.clone() : p.geo.clone();
      geo.applyMatrix4(mtx.multiplyMatrices(inv, p.m.matrixWorld));
      const n = geo.attributes.position.count, bi = huesos.indexOf(p.hueso);
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((v, i) => i % 4 === 0 ? bi : 0), 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((v, i) => i % 4 === 0 ? 1 : 0), 4));
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(k)) geo.deleteAttribute(k);
      if (!porMat.has(p.mat)) porMat.set(p.mat, []);
      porMat.get(p.mat).push(geo);
      p.m.removeFromParent();
    }
    if (nuevo) {
      // el cuerpo de Studio: cada parte con su material (el mono, del color del equipo)
      const partes = geometriasCuerpo(piloto && calidad >= 1 ? 2 : 1, huesos.map((h) => h.name));
      const matMono = new THREE.MeshStandardMaterial({ color, roughness: 0.82 });
      const matFranja = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
      const matSuela = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.6 });
      const matDe = { traje: matMono, franja: matFranja, guante: matNegro, bota: matBota, suela: matSuela, cuello: matNegro };
      for (const [p, geo] of Object.entries(partes)) {
        const mat = matDe[p] || matMono;
        if (!porMat.has(mat)) porMat.set(mat, []);
        porMat.get(mat).push(geo);
      }
    }
    const mats = [...porMat.keys()];
    const fusion = mergeGeometries(mats.map(m => mergeGeometries(porMat.get(m), false)), true);
    const cuerpo = this.malla = new THREE.SkinnedMesh(fusion, mats);
    cuerpo.castShadow = calidad >= 1;
    BASE.removeFromParent();
    cuerpo.add(cadera);
    cuerpo.bind(new THREE.Skeleton(huesos));
    R.add(cuerpo);
    R.scale.setScalar(alto);
    // el piloto puede llevar el volante en la mano derecha (al salir del coche)
    if (piloto) {
      const v = this.volante = new THREE.Group();
      const matV = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, metalness: 0.2 });
      const cuerpoV = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.27), matV); v.add(cuerpoV);
      for (const l of [-1, 1]) { const asa = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.09, 3, 8), matV); asa.position.set(0, -0.02, l * 0.15); v.add(asa); }
      const pantalla = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.055), new THREE.MeshStandardMaterial({ color: 0x0a2a1a, emissive: 0x2fe07a, emissiveIntensity: 0.6 }));
      pantalla.position.set(0.017, 0.02, 0); pantalla.rotation.y = Math.PI / 2; v.add(pantalla);
      v.position.set(0.02, -0.13, 0.12); v.rotation.set(0, 0, 0.2);
      v.visible = false;
      this.mD.add(v);
    }

    // estado de animación
    this.pose = 'de_pie'; this.mezcla = 1; this.velMezcla = 6;
    this.t = Math.random() * 10;
    this.andar = 0;          // velocidad al andar (m/s), 0 = quieto
    this.salto = 0;
    this.extra = {};          // giros añadidos por hueso (p. ej. el retroceso de la pistola)
    // muelles por hueso: el cuerpo tiene inercia (arranca, se pasa un poco y se asienta)
    this.muelles = Object.fromEntries(HUESOS.map(h => [h, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ok: false }]));
    this.semilla = Math.random() * 100;
    this._dt = 0;
    this.aplicar();
  }

  /** Cambia de pose con una transición (s). */
  poner(pose, transicion = 0.18) {
    if (pose === this.pose) return;
    this._snap = this._fotografia();
    this.pose = pose; this.mezcla = 0; this.velMezcla = 1 / Math.max(0.01, transicion);
  }

  _fotografia() {
    const f = { y: this.cadera.position.y };
    for (const h of HUESOS) f[h] = [this[h].rotation.x, this[h].rotation.y, this[h].rotation.z];
    return f;
  }

  actualizar(dt) {
    this.t += dt;
    if (this.mezcla < 1) this.mezcla = Math.min(1, this.mezcla + dt * this.velMezcla);
    this._dt = Math.min(dt, 1 / 20);
    this.aplicar();
  }

  // muelle algo subamortiguado hacia la pose objetivo (los brazos más sueltos que el tronco)
  _muelles() {
    const dt = this._dt;
    for (const h of HUESOS) {
      const m = this.muelles[h], r = this[h].rotation;
      if (!m.ok || dt <= 0) { m.x = r.x; m.y = r.y; m.z = r.z; m.vx = m.vy = m.vz = 0; m.ok = true; continue; }
      const k = h[0] === 'h' || h[0] === 'c' || h[0] === 'm' ? 260 : 420, amort = 2 * Math.sqrt(k) * 0.72;
      // integración semi-implícita en pasos pequeños (estable con FPS bajos)
      const n = Math.ceil(dt / 0.012), d = dt / n;
      for (let q = 0; q < n; q++) {
        m.vx += ((r.x - m.x) * k - m.vx * amort) * d; m.x += m.vx * d;
        m.vy += ((r.y - m.y) * k - m.vy * amort) * d; m.y += m.vy * d;
        m.vz += ((r.z - m.z) * k - m.vz * amort) * d; m.z += m.vz * d;
      }
      r.set(m.x, m.y, m.z);
    }
  }

  aplicar() {
    const a = this._snap || P.de_pie, b = P[this.pose] || P.de_pie, k = suave(this.mezcla);
    const L = (va, vb) => va + (vb - va) * k;
    const val = (p, h) => p[h] || [0, 0, 0];
    for (const h of HUESOS) {
      const va = val(a, h), vb = val(b, h), e = this.extra[h];
      this[h].rotation.set(L(va[0], vb[0]) + (e?.[0] || 0), L(va[1], vb[1]) + (e?.[1] || 0), L(va[2], vb[2]) + (e?.[2] || 0));
    }
    let y = L(a.y ?? 0.95, b.y);
    // respiración (el pecho sube y baja) y pequeño balanceo del peso
    const t = this.t;
    this.tronco.rotation.z += Math.sin(t * 1.6) * 0.015;
    // en espera nadie está quieto del todo: pasa el peso de una pierna a otra y mueve las manos
    if ((this.pose === 'de_pie' || this.pose === 'espera') && this.andar <= 0.05) {
      const ws = Math.sin(t * 0.42 + this.semilla), mano = Math.sin(t * 0.9 + this.semilla * 2);
      this.tronco.rotation.x += ws * 0.035; this.cadera.rotation.x = ws * 0.03;
      this.kI.rotation.z -= Math.max(0, ws) * 0.12; this.rI.rotation.z += Math.max(0, ws) * 0.2;
      this.kD.rotation.z -= Math.max(0, -ws) * 0.12; this.rD.rotation.z += Math.max(0, -ws) * 0.2;
      this.cI.rotation.z += mano * 0.08; this.cD.rotation.z -= mano * 0.06;
      // de vez en cuando mira a otro lado
      this.cabeza.rotation.y += Math.max(0, Math.sin(t * 0.21 + this.semilla) - 0.7) * 1.4 * Math.sign(Math.sin(this.semilla * 7) || 1);
    } else this.cadera.rotation.x = 0;
    this.cabeza.rotation.y += Math.sin(t * 0.37) * 0.12 * (this.pose === 'de_pie' || this.pose === 'espera' ? 1 : 0.2);
    // ciclo de andar o correr
    if (this.andar > 0.05) {
      const f = this.andar * 1.6, fase = t * f * 2.2, amp = clamp(this.andar / 3, 0.3, 0.75);
      const s = Math.sin(fase), c = Math.cos(fase);
      this.kI.rotation.z += s * amp; this.kD.rotation.z -= s * amp;
      this.rI.rotation.z += -Math.max(0, -c) * amp * 1.4; this.rD.rotation.z += -Math.max(0, c) * amp * 1.4;
      if (this.pose === 'de_pie') { this.hI.rotation.z -= s * amp * 0.8; this.hD.rotation.z += s * amp * 0.8; this.cI.rotation.z += 0.3; this.cD.rotation.z += 0.3; }
      this.tronco.rotation.z -= this.andar * 0.04;
      this.tronco.rotation.y += s * amp * 0.12;              // los hombros contrarrotan con la zancada
      y += Math.abs(Math.sin(fase)) * 0.035 - 0.02;
    }
    this._muelles();
    // la cadera baja lo justo para que la pierna más baja (pie o rodilla apoyada) toque el suelo
    const bajo = (k, r) => {
      const a1 = k.rotation.z, a2 = a1 + r.rotation.z;
      const rodilla = -0.44 * Math.cos(a1), tobillo = rodilla - 0.43 * Math.cos(a2);
      return Math.min(rodilla - 0.06, tobillo - 0.075);
    };
    y = 0.02 - Math.min(bajo(this.kI, this.rI), bajo(this.kD, this.rD)) + (y - L(a.y ?? 0.95, b.y));
    // salto (celebración)
    if (this.salto > 0) y += Math.max(0, Math.sin(t * 7)) * 0.25 * this.salto;
    this.cadera.position.y = y;
    // los pies siempre planos en el suelo: compensa el giro acumulado de cadera y rodilla
    this.tI.rotation.z = -(this.kI.rotation.z + this.rI.rotation.z) - this.tronco.rotation.z * 0;
    this.tD.rotation.z = -(this.kD.rotation.z + this.rD.rotation.z);
    if (this.pose === 'pistola') this.tI.rotation.z += 1.2;    // la rodilla apoyada: el pie de punta
  }

  /** Punto de la mano derecha en coordenadas del mundo (para colgar la pistola o una rueda). */
  manoDerecha() { return this.mD; }
  manoIzquierda() { return this.mI; }
}

export { P as POSES };
