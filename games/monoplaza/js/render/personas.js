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
    hombro: new THREE.SphereGeometry(0.057, 12, 10),
    codo: new THREE.SphereGeometry(0.041, 10, 8),
    rodilla: new THREE.SphereGeometry(0.064, 10, 8),
  };
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
  espera: { y: 0.95, tronco: [0, 0, 0], cabeza: [0, 0, 0.05], hI: [0.35, 0, -0.2], hD: [-0.35, 0, -0.2], cI: [-0.6, 0, 1.6], cD: [0.6, 0, 1.6], kI: [0.05, 0, 0.03], kD: [-0.05, 0, -0.05], rI: [0, 0, -0.04], rD: [0, 0, -0.04] },
};
const HUESOS = ['tronco', 'cabeza', 'hI', 'hD', 'cI', 'cD', 'mI', 'mD', 'kI', 'kD', 'rI', 'rD'];

/**
 * opc: { color, texto, numero, rol: 'mecanico' | 'ingeniero' | 'piloto', piel, alto }
 */
export class Persona {
  constructor({ color = '#0d47ff', texto = 'UPGAMES', numero = 1, rol = 'mecanico', piel = '#c9967a', alto = 1, calidad = 2 } = {}) {
    const g = geometrias();
    this.rol = rol;
    const normal = calidad >= 2 ? normalTela() : null;
    const tela = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.85, normalMap: normal, normalScale: new THREE.Vector2(0.35, 0.35) });
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
    const hueso = (padre, x, y, z) => { const h = new THREE.Bone(); h.position.set(x, y, z); (padre || BASE).add(h); huesos.push(h); return h; };

    // cadera (raíz animada) y pelvis
    const cadera = this.cadera = hueso(null, 0, 0.95, 0);
    malla(g.pelvis, matTorso, cadera).scale.set(1, 1, 1.15);
    // tronco
    const tronco = this.tronco = hueso(cadera, 0, 0.1, 0);
    const mt = malla(g.torso, matTorso, tronco); mt.scale.set(0.8, 1, 1.1);
    const matCuello = new THREE.MeshStandardMaterial({ color: piel, roughness: 0.6 });
    const cuello = hueso(tronco, 0.01, 0.49, 0);
    malla(g.cuello, rol === 'mecanico' ? matNegro : matCuello, cuello).scale.set(1, 0.75, 1);   // verdugo ignífugo
    const cabeza = this.cabeza = hueso(cuello, 0.01, 0.06, 0);
    if (rol === 'mecanico') {
      const matCasco = new THREE.MeshStandardMaterial({ map: texturaCasco(color), roughness: 0.25, metalness: 0.1 });
      malla(g.craneo, matNegro, cabeza, 0, 0.09, 0);
      malla(g.casco, matCasco, cabeza, 0, 0.1, 0);
      const vis = malla(g.visera, new THREE.MeshStandardMaterial({ color: 0x0c1016, roughness: 0.05, metalness: 0.8 }), cabeza, 0, 0.1, 0);
      vis.rotation.y = Math.PI;
      malla(g.mentonera, matCasco, cabeza, 0.02, 0.06, 0);
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
    // brazos: hombro → codo → muñeca
    const brazo = (lado) => {
      const z = lado * 0.21;
      const h = hueso(tronco, 0, 0.43, z);
      malla(g.hombro, matManga, h);
      malla(g.brazo, matManga, h);
      const c = hueso(h, 0, -0.29, 0);
      malla(g.codo, matManga, c);
      malla(g.antebrazo, matManga, c);
      const m = hueso(c, 0, -0.25, 0);
      malla(g.mano, matNegro, m);                     // guantes
      return { h, c, m };
    };
    const bI = brazo(-1), bD = brazo(1);
    this.hI = bI.h; this.cI = bI.c; this.mI = bI.m;
    this.hD = bD.h; this.cD = bD.c; this.mD = bD.m;
    // piernas: cadera → rodilla → tobillo
    const pierna = (lado) => {
      const k = hueso(cadera, 0, -0.02, lado * 0.095);
      malla(g.muslo, matManga, k);
      const r = hueso(k, 0, -0.44, 0);
      malla(g.rodilla, matManga, r);
      malla(g.pierna, matManga, r);
      const t = hueso(r, 0, -0.43, 0);
      malla(g.pie, matBota, t);
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
    const mats = [...porMat.keys()];
    const fusion = mergeGeometries(mats.map(m => mergeGeometries(porMat.get(m), false)), true);
    const cuerpo = this.malla = new THREE.SkinnedMesh(fusion, mats);
    cuerpo.castShadow = calidad >= 1;
    BASE.removeFromParent();
    cuerpo.add(cadera);
    cuerpo.bind(new THREE.Skeleton(huesos));
    R.add(cuerpo);
    R.scale.setScalar(alto);

    // estado de animación
    this.pose = 'de_pie'; this.mezcla = 1; this.velMezcla = 6;
    this.t = Math.random() * 10;
    this.andar = 0;          // velocidad al andar (m/s), 0 = quieto
    this.salto = 0;
    this.extra = {};          // giros añadidos por hueso (p. ej. el retroceso de la pistola)
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
    this.aplicar();
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
    this.cabeza.rotation.y += Math.sin(t * 0.37) * 0.12 * (this.pose === 'de_pie' || this.pose === 'espera' ? 1 : 0.2);
    // ciclo de andar o correr
    if (this.andar > 0.05) {
      const f = this.andar * 1.6, fase = t * f * 2.2, amp = clamp(this.andar / 3, 0.3, 0.75);
      const s = Math.sin(fase), c = Math.cos(fase);
      this.kI.rotation.z += s * amp; this.kD.rotation.z -= s * amp;
      this.rI.rotation.z += -Math.max(0, -c) * amp * 1.4; this.rD.rotation.z += -Math.max(0, c) * amp * 1.4;
      if (this.pose === 'de_pie') { this.hI.rotation.z -= s * amp * 0.8; this.hD.rotation.z += s * amp * 0.8; this.cI.rotation.z += 0.3; this.cD.rotation.z += 0.3; }
      this.tronco.rotation.z -= this.andar * 0.04;
      y += Math.abs(Math.sin(fase)) * 0.035 - 0.02;
    }
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
