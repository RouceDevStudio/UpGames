// Modelo 3D procedural de un monoplaza moderno (efecto suelo, halo, ruedas de 18").
// Ejes del modelo: +X hacia delante, +Y arriba, +Z a la derecha. Origen bajo el CG, a nivel del suelo.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COCHE, COMPUESTOS } from '../config.js';
import { texturaCarbono } from './texturas.js';
import { proyectarUV, dibujarLibrea, materialLibrea } from './librea.js';
import { normalPliegues } from './personas.js';
import { crearPiloto } from './piloto.js';

const A = COCHE.wheelbase * (1 - COCHE.repartoDel); // eje delantero
const B = COCHE.wheelbase * COCHE.repartoDel;       // eje trasero

// Las caras tienen que mirar hacia fuera: si las secciones van del morro hacia atrás el giro de
// los triángulos queda al revés y se ve el interior de la pieza (el coche parecía transparente,
// con la pintura por dentro). Con el volumen con signo se detecta y se corrige.
function orientarFuera(g) {
  const p = g.attributes.position, ix = g.index.array;
  let vol = 0;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3, P = p.array;
    vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  if (vol < 0) {
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.index.needsUpdate = true;
  }
  g.computeVertexNormals();
  return g;
}

// Lo mismo para geometrías sin índice (ExtrudeGeometry): si el volumen sale negativo, las caras
// miran hacia dentro; se invierte el orden de cada triángulo y se dan la vuelta las normales
function orientarFueraSinIndice(g) {
  const P = g.attributes.position.array;
  let vol = 0;
  for (let a = 0; a < P.length; a += 9) {
    const b = a + 3, c = a + 6;
    vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  if (vol >= 0) return g;
  for (const nombre of Object.keys(g.attributes)) {
    const at = g.attributes[nombre], n = at.itemSize, A = at.array;
    for (let t = 0; t < at.count; t += 3) for (let k = 0; k < n; k++) { const i1 = (t + 1) * n + k, i2 = (t + 2) * n + k, x = A[i1]; A[i1] = A[i2]; A[i2] = x; }
    if (nombre === 'normal') for (let i = 0; i < A.length; i++) A[i] = -A[i];
    at.needsUpdate = true;
  }
  return g;
}

// Superficie por secciones superelípticas a lo largo de X
function loft(secciones, segs = 20, zc = 0) {
  const pos = [], idx = [], uv = [];
  const anillo = segs;
  secciones.forEach((s, k) => {
    const n = s.n ?? 2.6;
    for (let j = 0; j < anillo; j++) {
      const t = j / anillo * Math.PI * 2;
      const c = Math.cos(t), sn = Math.sin(t);
      const y = (s.yc) + s.h * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n) * (sn < 0 ? (s.base ?? 1) : 1);
      const z = zc + s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      pos.push(s.x, y, z);
      uv.push(j / anillo, k / (secciones.length - 1));
    }
  });
  for (let k = 0; k < secciones.length - 1; k++) {
    for (let j = 0; j < anillo; j++) {
      const a = k * anillo + j, b = k * anillo + (j + 1) % anillo;
      const c = (k + 1) * anillo + j, d = (k + 1) * anillo + (j + 1) % anillo;
      idx.push(a, c, b, b, c, d);
    }
  }
  // tapas
  for (const [k, inv] of [[0, false], [secciones.length - 1, true]]) {
    const s = secciones[k];
    const ci = pos.length / 3;
    pos.push(s.x, s.yc, zc); uv.push(0.5, 0.5);
    for (let j = 0; j < anillo; j++) {
      const a = k * anillo + j, b = k * anillo + (j + 1) % anillo;
      if (inv) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return orientarFuera(g);
}

// Perfil alar extruido a lo largo de Z (envergadura)
function ala(cuerda, espesor, envergadura, curvatura = 0.06, angulo = 0, cortes = 1) {
  const sh = new THREE.Shape();
  const N = 14;
  const sup = [], inf = [];
  for (let i = 0; i <= N; i++) {
    const x = 1 - i / N;
    const xx = x * x * (3 - 2 * x);
    const yt = 5 * espesor * (0.2969 * Math.sqrt(xx) - 0.126 * xx - 0.3516 * xx * xx + 0.2843 * xx ** 3 - 0.1015 * xx ** 4);
    const yc = curvatura * 4 * xx * (1 - xx);
    sup.push([xx, yc + yt]); inf.push([xx, yc - yt]);
  }
  // borde de ataque en x = 0 → hacia delante (+X)
  const pts = sup.concat(inf.reverse());
  sh.moveTo(-pts[0][0] * cuerda, pts[0][1] * cuerda);
  for (const [x, y] of pts.slice(1)) sh.lineTo(-x * cuerda, y * cuerda);
  const g = new THREE.ExtrudeGeometry(sh, { depth: envergadura, bevelEnabled: false, steps: cortes });
  g.translate(cuerda / 2, 0, -envergadura / 2);
  g.rotateZ(angulo);
  return g;
}

function caja(sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function barra(p1, p2, r = 0.012) {
  const a = new THREE.Vector3(...p1), b = new THREE.Vector3(...p2);
  const dir = b.clone().sub(a); const L = dir.length();
  const g = new THREE.CylinderGeometry(r, r, L, 6);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}


// Superficie por secciones con alto arriba y abajo independientes y centro lateral propio:
// { x, w (semiancho), yt (techo), yb (suelo), n (forma de arriba), nb (forma de abajo), z }
function loftS(secciones, segs = 24) {
  const pos = [], idx = [];
  const anillo = segs;
  for (const s of secciones) {
    const yc = (s.yt + s.yb) / 2, h = (s.yt - s.yb) / 2;
    for (let j = 0; j < anillo; j++) {
      const t = j / anillo * Math.PI * 2;
      const c = Math.cos(t), sn = Math.sin(t);
      const n = sn >= 0 ? s.n : s.nb;
      pos.push(s.x, yc + h * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n), s.z + s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n));
    }
  }
  for (let k = 0; k < secciones.length - 1; k++) {
    for (let j = 0; j < anillo; j++) {
      const a = k * anillo + j, b = k * anillo + (j + 1) % anillo;
      const c = (k + 1) * anillo + j, d = (k + 1) * anillo + (j + 1) % anillo;
      idx.push(a, c, b, b, c, d);
    }
  }
  for (const [k, inv] of [[0, false], [secciones.length - 1, true]]) {
    const s = secciones[k];
    const ci = pos.length / 3;
    pos.push(s.x, (s.yt + s.yb) / 2, s.z);
    for (let j = 0; j < anillo; j++) {
      const a = k * anillo + j, b = k * anillo + (j + 1) % anillo;
      if (inv) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return orientarFuera(g);
}

// Tubo de sección ovalada a lo largo de una curva; radios(t) → [ancho (horizontal), alto]
function barridoOval(curva, segs, radial, radios) {
  const pos = [], idx = [];
  const T = new THREE.Vector3(), lado = new THREE.Vector3(), arriba = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curva.getPointAt(t, P); curva.getTangentAt(t, T);
    lado.crossVectors(T, Y); if (lado.lengthSq() < 1e-6) lado.set(0, 0, 1); lado.normalize();
    arriba.crossVectors(lado, T).normalize();
    const [a, b] = radios(t);
    for (let j = 0; j < radial; j++) {
      const ang = j / radial * Math.PI * 2;
      pos.push(P.x + lado.x * Math.cos(ang) * a + arriba.x * Math.sin(ang) * b, P.y + lado.y * Math.cos(ang) * a + arriba.y * Math.sin(ang) * b, P.z + lado.z * Math.cos(ang) * a + arriba.z * Math.sin(ang) * b);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = i * radial + (j + 1) % radial, c = (i + 1) * radial + j, d = (i + 1) * radial + (j + 1) % radial;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // las caras hacia fuera (mismo criterio que el resto de piezas)
  const p = g.attributes.position, n = g.attributes.normal, ii = g.index.array;
  let fuera = 0;
  for (let k = 0; k < p.count; k += 7) { curva.getPointAt(Math.min(1, Math.floor(k / radial) / segs), P); fuera += (p.getX(k) - P.x) * n.getX(k) + (p.getY(k) - P.y) * n.getY(k) + (p.getZ(k) - P.z) * n.getZ(k); }
  if (fuera < 0) { for (let k = 0; k < ii.length; k += 3) { const tt = ii[k + 1]; ii[k + 1] = ii[k + 2]; ii[k + 2] = tt; } g.computeVertexNormals(); }
  return g;
}

// Perfil alar con muchos cortes a lo largo de la envergadura para poder curvarlo
function alaCurva(cuerda, espesor, envergadura, curvatura = 0.06, angulo = 0, deformar = null) {
  const g = ala(cuerda, espesor, envergadura, curvatura, angulo, 24);
  if (deformar) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const [x, y, z] = deformar(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, x, y, z); }
    g.computeVertexNormals();
  }
  return g;
}

// Brazo de suspensión de sección aplanada (perfil aerodinámico)
function barraAero(p1, p2, r = 0.016) {
  const a = new THREE.Vector3(...p1), b = new THREE.Vector3(...p2);
  const dir = b.clone().sub(a); const L = dir.length();
  const g = new THREE.CylinderGeometry(r, r, L, 8);
  g.scale(2.4, 1, 0.55);          // ancho en la marcha, fino en vertical
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

// Ondas de aire caliente (se desplazan hacia arriba)
let texCalor = null;
function texturaCalor() {
  if (texCalor) return texCalor;
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
  const x = cv.getContext('2d');
  for (let y = 0; y < 128; y += 2) {
    const a = 0.25 + 0.25 * Math.sin(y * 0.35);
    const g = x.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,230,200,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(Math.sin(y * 0.2) * 8, y, 64, 1);
  }
  texCalor = new THREE.CanvasTexture(cv); texCalor.wrapS = texCalor.wrapT = THREE.RepeatWrapping;
  return texCalor;
}

// Mono ignífugo con los colores del equipo y publicidad
const cacheMono = new Map();
function texturaMono(col) {
  const k = `${col.base}|${col.acento}|${col.tercero}`;
  if (cacheMono.has(k)) return cacheMono.get(k);
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = col.base; x.fillRect(0, 0, 512, 256);
  // tejido ignífugo: trama fina y algo de variación de tono
  for (let k = 0; k < 2600; k++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${0.025 + Math.random() * 0.03})`; x.fillRect(Math.random() * 512, Math.random() * 256, 2, 1); }
  for (let y = 0; y < 256; y += 3) { x.fillStyle = 'rgba(0,0,0,0.035)'; x.fillRect(0, y, 512, 1); }
  x.fillStyle = col.acento; x.fillRect(0, 108, 512, 28);
  x.fillStyle = col.tercero; x.fillRect(0, 140, 512, 8);
  // costuras acolchadas y cremallera
  x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1.5; x.setLineDash([4, 3]);
  for (const yy of [40, 104, 152, 210]) { x.beginPath(); x.moveTo(0, yy); x.lineTo(512, yy); x.stroke(); }
  x.setLineDash([]);
  x.fillStyle = 'rgba(30,30,30,0.6)'; x.fillRect(250, 0, 12, 256);
  for (let y = 4; y < 256; y += 8) { x.fillStyle = '#9aa0a6'; x.fillRect(252, y, 8, 3); }
  // parches de patrocinadores
  const parche = (px, py, w, h, fondo, texto, color) => { x.fillStyle = fondo; x.fillRect(px, py, w, h); x.fillStyle = color; x.font = `900 italic ${h * 0.62}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(texto, px + w / 2, py + h / 2 + 1); };
  parche(40, 44, 170, 50, 'rgba(255,255,255,0.95)', 'UPGAMES', '#0d47ff');
  parche(302, 44, 170, 50, 'rgba(255,255,255,0.95)', 'UPGAMES', '#0d47ff');
  parche(60, 164, 130, 34, '#0b0b14', 'NEXUS IA', '#00e5ff');
  parche(322, 164, 130, 34, '#0b0b14', 'APEX GP', '#ffd23f');
  x.fillStyle = '#ffffff'; x.font = '700 22px Arial'; x.textAlign = 'center'; x.fillText('upgames.games', 256, 228);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  cacheMono.set(k, t);
  return t;
}

// Goma del neumático (u: alrededor, v: del flanco interior al exterior pasando por la banda).
// Nueva: negra y lisa. Gastada: la banda se aclara y se marca con surcos; graining: bolitas
// de goma pegadas; ampollas: cráteres oscuros donde la goma ha reventado.
function pintarGoma(cv, desgaste, graining, ampollas, semilla = 0, suciedad = 0, verde = 0) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height;
  let s = 1234 + semilla * 97; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  x.fillStyle = '#151516'; x.fillRect(0, 0, W, H);
  // banda de rodadura (centro del perfil)
  const y0 = H * 0.3, y1 = H * 0.7;
  const tono = Math.round(22 + desgaste * 34);
  x.fillStyle = `rgb(${tono},${tono},${tono + 2})`; x.fillRect(0, y0, W, y1 - y0);
  // surcos del desgaste a lo largo de la banda
  for (let i = 0; i < 6 + desgaste * 30; i++) {
    const y = y0 + r() * (y1 - y0), a = 0.08 + desgaste * 0.25;
    x.fillStyle = `rgba(${r() < 0.5 ? '70,70,72' : '8,8,9'},${a})`; x.fillRect(0, y, W, 0.6 + r() * 1.4);
  }
  // graining: bolitas de goma
  for (let i = 0; i < graining * 900; i++) {
    const g = 50 + r() * 40;
    x.fillStyle = `rgba(${g},${g},${g},${0.5 + r() * 0.4})`; x.fillRect(r() * W, y0 + r() * (y1 - y0), 1 + r() * 2, 1 + r() * 1.5);
  }
  // ampollas: cráteres
  for (let i = 0; i < ampollas * 60; i++) {
    const cx = r() * W, cy = y0 + 3 + r() * (y1 - y0 - 6), rr = 1.5 + r() * 3.5;
    x.fillStyle = 'rgba(0,0,0,0.85)'; x.beginPath(); x.ellipse(cx, cy, rr * 1.6, rr, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(90,90,92,0.6)'; x.fillRect(cx - rr * 1.6, cy - rr - 0.5, rr * 3.2, 0.8);
  }
  // tierra y hierba pegadas tras salirse (se van limpiando al rodar por el asfalto)
  for (let i = 0; i < suciedad * 700; i++) {
    const enBanda = r() < 0.75, yy = enBanda ? y0 + r() * (y1 - y0) : r() * H;
    const tono = r() < verde ? `rgba(${60 + r() * 30},${95 + r() * 40},${35 + r() * 20},${0.6 + r() * 0.3})` : `rgba(${95 + r() * 40},${70 + r() * 25},${45 + r() * 20},${0.55 + r() * 0.35})`;
    x.fillStyle = tono; x.fillRect(r() * W, yy, 1.5 + r() * 4, 1 + r() * 2.5);
  }
  // letras del flanco (marca del neumático, más clara)
  x.fillStyle = 'rgba(200,200,205,0.55)'; x.font = 'bold 9px Arial';
  for (let i = 0; i < 4; i++) { x.fillText('UPGAMES', i * 64 + 6, H * 0.18); x.fillText('UPGAMES', i * 64 + 30, H * 0.92); }
}

// Máscara del brillo del disco visto a través de la llanta: el aro entre tapacubos y neumático
// con huecos entre los radios (blanco = brilla)
let _brilloLlanta = null;
function texturaBrilloLlanta() {
  if (_brilloLlanta) return _brilloLlanta;
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 128, 128); x.translate(64, 64);
  const g = x.createRadialGradient(0, 0, 36, 0, 0, 50);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.35, 'rgba(255,255,255,1)'); g.addColorStop(0.8, 'rgba(255,200,160,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, 50, 0, Math.PI * 2); x.fill();
  // los radios tapan parte del disco
  x.fillStyle = '#000';
  for (let k = 0; k < 10; k++) { x.save(); x.rotate(k * Math.PI / 5); x.fillRect(34, -2.5, 18, 5); x.restore(); }
  _brilloLlanta = new THREE.CanvasTexture(cv);
  return _brilloLlanta;
}

function texturaTapacubos(colorCompuesto) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = '#141416'; x.fillRect(0, 0, 256, 256);
  x.translate(128, 128);
  // banda de color del compuesto y rotulación en el flanco
  x.strokeStyle = colorCompuesto; x.lineWidth = 9;
  x.beginPath(); x.arc(0, 0, 104, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#e6e6e6'; x.font = 'bold 22px Arial'; x.textAlign = 'center';
  for (const a of [0, Math.PI]) {
    x.save(); x.rotate(a);
    'APEX'.split('').forEach((ch, i) => { x.save(); x.rotate((i - 1.5) * 0.16); x.fillText(ch, 0, -114 + 22); x.restore(); });
    x.restore();
  }
  // tapacubos de carbono
  const g = x.createRadialGradient(0, 0, 10, 0, 0, 72);
  g.addColorStop(0, '#3a3b40'); g.addColorStop(1, '#16171a');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, 72, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#555'; x.lineWidth = 3;
  for (let k = 0; k < 6; k++) { x.rotate(Math.PI / 3); x.beginPath(); x.moveTo(20, 0); x.lineTo(68, 0); x.stroke(); }
  x.fillStyle = '#c9a227'; x.beginPath(); x.arc(0, 0, 14, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cacheMat = new Map();
const CREAR_MAT = {
  carbono: () => new THREE.MeshStandardMaterial({ map: texturaCarbono(), roughness: 0.38, metalness: 0.3, color: 0x9a9a9a }),
  negro: () => new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.6 }),
  metal: () => new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.25, metalness: 1 }),
  goma: () => new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.88, metalness: 0 }),
  // el neumático es un perfil abierto (se ve también su cara interior junto a la llanta)
  gomaNeum: () => new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.88, metalness: 0, side: THREE.DoubleSide }),
};
function matComun(nombre, crear = CREAR_MAT[nombre]) {
  if (!cacheMat.has(nombre)) cacheMat.set(nombre, crear());
  return cacheMat.get(nombre);
}

// Une geometrías en una sola malla por material (menos llamadas de dibujo)
function unir(lista, mat, uvLibrea = false) {
  const norm = lista.map(g => {
    const gg = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') gg.deleteAttribute(k);
    if (!gg.attributes.normal) gg.computeVertexNormals();
    if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
    return gg;
  });
  const geo = mergeGeometries(norm, false);
  if (uvLibrea) proyectarUV(geo);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// Volante de F1 actual: placa de carbono con frontal rotulado, pantalla en su marco, tira de
// LEDs de cambio y de banderas, botones con capuchón de color, selectores giratorios
// moleteados, empuñaduras de goma con hueco para los dedos, levas de cambio y de embrague
// y el buje de suelta rápida detrás.
const BOTONES_VOL = [   // [y, z, color, rótulo]
  [0.050, -0.090, 0xe8202a, 'PIT'], [0.024, -0.098, 0xf5c518, 'DRS'], [-0.004, -0.098, 0x2f7bff, 'RADIO'], [-0.034, -0.088, 0xffffff, 'N'],
  [0.050, 0.090, 0x2fe07a, 'OK'], [0.024, 0.098, 0xff7a00, 'BB+'], [-0.004, 0.098, 0xb84dff, 'BB-'], [-0.034, 0.088, 0x00e5ff, 'MARK'],
  [-0.074, -0.040, 0x222222, 'PL'], [-0.074, 0.040, 0x222222, 'TOW'],
];
const ROTATIVOS_VOL = [[-0.036, -0.048, 'ERS'], [-0.036, 0.048, 'MIX'], [-0.060, -0.016, 'DIFF'], [-0.060, 0.016, 'BAL']];
let texFrontalVol = null;
function texturaFrontalVolante() {
  if (texFrontalVol) return texFrontalVol;
  const W = 1024, H = 614, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const px = (z) => (z + 0.15) / 0.30 * W, py = (y) => (1 - (y + 0.09) / 0.18) * H, esc = W / 0.30;
  // sarga de carbono
  x.fillStyle = '#16171b'; x.fillRect(0, 0, W, H);
  for (let i = 0; i < W; i += 8) for (let j = 0; j < H; j += 8) {
    x.fillStyle = ((i + j) / 8) % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.25)';
    x.fillRect(i, j, 8, 4); x.fillRect(i + 4, j + 4, 4, 4);
  }
  // panel central mate alrededor de la pantalla
  x.fillStyle = '#0c0d10'; x.beginPath(); x.roundRect(px(-0.08), py(0.062), 0.16 * esc, 0.09 * esc, 18); x.fill();
  x.font = `bold ${Math.round(0.0062 * esc)}px Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  // rótulos de los botones (debajo de cada uno) y aro claro alrededor
  for (const [y, z, , txt] of BOTONES_VOL) {
    x.strokeStyle = 'rgba(200,200,205,0.55)'; x.lineWidth = 3;
    x.beginPath(); x.arc(px(z), py(y), 0.0105 * esc, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#e9edf2'; x.fillText(txt, px(z), py(y - 0.0155));
  }
  // escala de los selectores: 12 posiciones con sus números
  x.font = `bold ${Math.round(0.0042 * esc)}px Arial, sans-serif`;
  for (const [y, z, txt] of ROTATIVOS_VOL) {
    for (let k = 0; k < 12; k++) {
      const a = -Math.PI * 0.75 + k * Math.PI * 1.5 / 11, r0 = 0.0145 * esc, r1 = 0.0172 * esc;
      x.strokeStyle = k === 0 ? '#ffd23f' : '#c9ced6'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(px(z) + Math.sin(a) * r0, py(y) - Math.cos(a) * r0); x.lineTo(px(z) + Math.sin(a) * r1, py(y) - Math.cos(a) * r1); x.stroke();
      if (k % 2 === 0) { x.fillStyle = '#9aa1ab'; x.fillText(String(k + 1), px(z) + Math.sin(a) * 0.0205 * esc, py(y) - Math.cos(a) * 0.0205 * esc); }
    }
    x.fillStyle = '#ffd23f'; x.font = `bold ${Math.round(0.0052 * esc)}px Arial, sans-serif`;
    x.fillText(txt, px(z), py(y + 0.0235)); x.font = `bold ${Math.round(0.0042 * esc)}px Arial, sans-serif`;
  }
  // logotipo y tornillos de la placa
  x.fillStyle = '#ffffff'; x.font = `900 ${Math.round(0.0075 * esc)}px Arial, sans-serif`;
  x.fillText('APEX GP', px(0), py(-0.083));
  x.fillStyle = '#8d939c';
  for (const [y, z] of [[0.072, -0.11], [0.072, 0.11], [-0.07, -0.072], [-0.07, 0.072], [0.03, -0.068], [0.03, 0.068]]) { x.beginPath(); x.arc(px(z), py(y), 5, 0, Math.PI * 2); x.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.repeat.set(1 / 0.30, 1 / 0.18); t.offset.set(0.5, 0.5);
  return (texFrontalVol = t);
}
const matsBoton = new Map();
const matBoton = (col) => { if (!matsBoton.has(col)) matsBoton.set(col, new THREE.MeshStandardMaterial({ color: col, roughness: 0.35 })); return matsBoton.get(col); };
let matFrontalVol = null;
function crearVolante(conPantalla) {
  const g = new THREE.Group();
  const carbono = matComun('carbono');
  const negro = matComun('negro');
  const metal = matComun('metal');
  const goma = matComun('goma');
  const contorno = () => {
    // forma en el plano (z, y): alas arriba, empuñaduras a los lados y la parte de abajo recortada
    const sh = new THREE.Shape();
    sh.moveTo(-0.148, 0.03); sh.bezierCurveTo(-0.152, 0.075, -0.13, 0.092, -0.10, 0.09);
    sh.bezierCurveTo(-0.05, 0.084, 0.05, 0.084, 0.10, 0.09); sh.bezierCurveTo(0.13, 0.092, 0.152, 0.075, 0.148, 0.03);
    sh.lineTo(0.14, -0.05); sh.bezierCurveTo(0.137, -0.082, 0.112, -0.092, 0.092, -0.084);
    sh.bezierCurveTo(0.075, -0.078, 0.066, -0.07, 0.055, -0.082); sh.bezierCurveTo(0.03, -0.094, -0.03, -0.094, -0.055, -0.082);
    sh.bezierCurveTo(-0.066, -0.07, -0.075, -0.078, -0.092, -0.084); sh.bezierCurveTo(-0.112, -0.092, -0.137, -0.082, -0.14, -0.05);
    sh.closePath();
    return sh;
  };
  // cuerpo de carbono con canto biselado
  const cuerpo = new THREE.ExtrudeGeometry(contorno(), { depth: 0.03, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.005, bevelSegments: 3, curveSegments: 14 });
  cuerpo.rotateY(Math.PI / 2); cuerpo.translate(-0.015, 0, 0); orientarFueraSinIndice(cuerpo);
  g.add(new THREE.Mesh(cuerpo, carbono));
  // frontal rotulado (algo más pequeño que el cuerpo, delante de él)
  const frontal = new THREE.ShapeGeometry(contorno(), 14);
  frontal.scale(0.97, 0.95, 1); frontal.rotateY(-Math.PI / 2); frontal.translate(-0.0205, 0, 0);
  matFrontalVol ??= new THREE.MeshStandardMaterial({ map: texturaFrontalVolante(), roughness: 0.55, metalness: 0.15 });
  g.add(new THREE.Mesh(frontal, matFrontalVol));
  // empuñaduras: goma moldeada con hueco para cada dedo, un poco abiertas hacia arriba
  const perfil = [];
  for (let k = 0; k <= 24; k++) {
    const u = k / 24, y = -0.06 + u * 0.12;
    const dedos = u > 0.15 && u < 0.85 ? 0.0022 * Math.cos((u - 0.15) / 0.7 * Math.PI * 8) : 0;
    perfil.push(new THREE.Vector2(0.0205 * Math.sin(Math.PI * Math.min(1, 0.12 + u * 0.88)) ** 0.35 + dedos, y));
  }
  const geoEmp = new THREE.LatheGeometry(perfil, 18); geoEmp.scale(1.05, 1, 0.85);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(geoEmp, goma); e.position.set(-0.002, -0.006, s * 0.127); e.rotation.x = s * 0.1; g.add(e);
    // costura y remate de aluminio arriba y abajo
    for (const y of [-0.064, 0.058]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0025, 6, 16), metal); r.rotation.x = Math.PI / 2; r.position.set(-0.002, y - 0.006, s * (0.127 + s * y * 0.1)); g.add(r); }
  }
  // pantalla en un marco hundido
  let pantalla = null;
  const geoP = new THREE.PlaneGeometry(0.13, 0.068);
  if (conPantalla) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 268;
    pantalla = { cv, ctx: cv.getContext('2d'), tex: new THREE.CanvasTexture(cv) };
    pantalla.tex.colorSpace = THREE.SRGBColorSpace;
  }
  const marco = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.078, 0.142), negro); marco.position.set(-0.021, 0.018, 0); g.add(marco);
  const mp = new THREE.Mesh(geoP, conPantalla ? new THREE.MeshBasicMaterial({ map: pantalla.tex, toneMapped: false }) : new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.15, metalness: 0.3 }));
  mp.rotation.y = -Math.PI / 2; mp.position.set(-0.0245, 0.018, 0); g.add(mp);
  // tira de LEDs de cambio en su carcasa, y LEDs de banderas a cada lado
  const leds = [];
  const carcasa = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.014, 0.162), negro); carcasa.position.set(-0.02, 0.066, 0); g.add(carcasa);
  const geoL = new THREE.BoxGeometry(0.004, 0.007, 0.0085);
  for (let k = 0; k < 15; k++) {
    const col = k < 5 ? 0x22e05c : k < 10 ? 0xff2a2a : 0x3a7bff;
    const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 0 });
    const l = new THREE.Mesh(geoL, m); l.position.set(-0.0245, 0.066, -0.07 + k * 0.01); g.add(l); leds.push(m);
  }
  const geoF = new THREE.BoxGeometry(0.004, 0.009, 0.006);
  const matsF = [0xffc400, 0x2a6bff].map(c => matBoton(0x1a1a10 + c));   // banderas amarilla y azul
  matsF.forEach((m, k) => { m.emissive.setHex(k ? 0x2a6bff : 0xffc400); m.emissiveIntensity = 0.25; });
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const l = new THREE.Mesh(geoF, matsF[k === 1 ? 1 : 0]);
    l.position.set(-0.023, 0.046 - k * 0.013, s * 0.075); g.add(l);
  }
  // botones: base metálica y capuchón de color
  const geoBase = new THREE.CylinderGeometry(0.0092, 0.0098, 0.004, 16); geoBase.rotateZ(Math.PI / 2);
  const geoCap = new THREE.CylinderGeometry(0.0072, 0.0078, 0.006, 16); geoCap.rotateZ(Math.PI / 2);
  for (const [y, z, col] of BOTONES_VOL) {
    const b0 = new THREE.Mesh(geoBase, metal); b0.position.set(-0.022, y, z); g.add(b0);
    const b = new THREE.Mesh(geoCap, matBoton(col)); b.position.set(-0.026, y, z); g.add(b);
  }
  // selectores giratorios: corona moleteada (dientes), tapa y una marca blanca
  const dientes = new THREE.CylinderGeometry(0.0118, 0.0118, 0.011, 28, 1); dientes.rotateZ(Math.PI / 2);
  { const p = dientes.attributes.position; for (let i = 0; i < p.count; i++) { const yy = p.getY(i), zz = p.getZ(i), r = Math.hypot(yy, zz); if (r > 0.005) { const a = Math.atan2(zz, yy), f = (Math.round(a / (Math.PI / 14)) % 2 ? 0.9 : 1); p.setY(i, yy * f); p.setZ(i, zz * f); } } dientes.computeVertexNormals(); }
  const tapa = new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 20); tapa.rotateZ(Math.PI / 2);
  const geoMarca = new THREE.BoxGeometry(0.002, 0.0075, 0.0016);
  const matMarca = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const [y, z] of ROTATIVOS_VOL) {
    const r = new THREE.Mesh(dientes, matComun('negro')); r.position.set(-0.026, y, z); g.add(r);
    const tp = new THREE.Mesh(tapa, metal); tp.position.set(-0.032, y, z); g.add(tp);
    const mk = new THREE.Mesh(geoMarca, matMarca); mk.position.set(-0.0345, y + 0.0045, z); mk.rotation.x = (z > 0 ? -1 : 1) * 0.6; g.add(mk);
  }
  // interruptores de palanca arriba, entre las alas
  for (const s of [-1, 1]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.01, 0.012), metal); base.position.set(-0.021, 0.08, s * 0.045); g.add(base);
    const pal = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0022, 0.014, 6), metal); pal.position.set(-0.028, 0.084, s * 0.045); pal.rotation.z = Math.PI / 2 - 0.5; g.add(pal);
  }
  // levas detrás: cambio arriba (grandes, con punta de aluminio) y embrague abajo
  for (const s of [-1, 1]) {
    const lv = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.07, 0.055), carbono); lv.position.set(0.026, 0.035, s * 0.098); lv.rotation.x = s * 0.25; g.add(lv);
    const punta = new THREE.Mesh(new THREE.BoxGeometry(0.0055, 0.018, 0.02), metal); punta.position.set(0.026, 0.068, s * 0.122); punta.rotation.x = s * 0.25; g.add(punta);
    const emb = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.05, 0.045), carbono); emb.position.set(0.028, -0.045, s * 0.088); emb.rotation.x = -s * 0.35; g.add(emb);
  }
  // buje de suelta rápida y conector de datos
  const buje = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.03, 20).rotateZ(Math.PI / 2), metal); buje.position.set(0.03, 0, 0); g.add(buje);
  const anillo = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.004, 8, 20), matComun('negro')); anillo.rotation.y = Math.PI / 2; anillo.position.set(0.04, 0, 0); g.add(anillo);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), negro); cable.position.set(0.035, -0.04, 0.02); cable.rotation.x = 0.6; g.add(cable);
  // en los coches de los rivales todo lo fijo va en una malla por material (menos llamadas)
  if (!conPantalla) {
    const porMat = new Map(), fijos = g.children.filter(m => m.isMesh && !leds.includes(m.material));
    for (const m of fijos) {
      m.updateMatrix();
      const gg = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      gg.applyMatrix4(m.matrix);
      for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k);
      if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
      if (!porMat.has(m.material)) porMat.set(m.material, []);
      porMat.get(m.material).push(gg); g.remove(m);
    }
    for (const [mat, l] of porMat) g.add(new THREE.Mesh(mergeGeometries(l, false), mat));
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { g, pantalla, leds };
}

// Pantalla del volante: en la cámara de cabina es el tablero completo del piloto
function pintarPantalla(p, car, info = {}) {
  const x = p.ctx, W = 512, H = 268;
  x.fillStyle = '#05070a'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#1b2230'; x.lineWidth = 3; x.strokeRect(2, 2, W - 4, H - 4);
  x.textBaseline = 'middle';
  // marcha grande en el centro
  x.fillStyle = car.limitador ? '#3a7bff' : '#ffd23f'; x.font = '900 150px Arial'; x.textAlign = 'center';
  x.fillText(car.marcha === -1 ? 'R' : car.marcha === 0 ? 'N' : String(car.marcha), W / 2, 112);
  x.fillStyle = '#fff'; x.font = '800 44px Arial';
  x.fillText(String(Math.round(car.velocidad * 3.6)), W / 2, 214);
  x.font = '700 18px Arial'; x.fillStyle = '#8a94a6'; x.fillText('KM/H', W / 2, 246);
  // izquierda: posición, vuelta, tiempo y delta
  x.textAlign = 'left';
  x.fillStyle = '#fff'; x.font = '900 46px Arial'; x.fillText(info.pos ? `P${info.pos}` : '', 14, 42);
  x.font = '700 22px Arial'; x.fillStyle = '#8a94a6'; x.fillText(info.vuelta || '', 14, 84);
  x.fillStyle = '#fff'; x.font = '800 30px Arial'; x.fillText(info.tiempo || '', 14, 122);
  if (info.delta != null) { x.fillStyle = info.delta <= 0 ? '#2fe07a' : '#ff3b3b'; x.fillText((info.delta > 0 ? '+' : '') + info.delta.toFixed(2), 14, 158); }
  // ERS y modos
  x.fillStyle = '#222a36'; x.fillRect(14, 186, 150, 16);
  x.fillStyle = '#2fe07a'; x.fillRect(14, 186, 150 * Math.max(0, car.ers / 4e6), 16);
  x.font = '800 18px Arial'; x.fillStyle = '#8a94a6'; x.fillText(['ERS RECARGA', 'ERS NORMAL', 'ERS ATAQUE'][car.mandos.ersModo ?? 1], 14, 220);
  x.fillStyle = car.drsAbierto ? '#2fe07a' : car.drsPermitido ? '#fff' : '#3a4250'; x.font = '900 24px Arial'; x.fillText('DRS', 14, 250);
  x.fillStyle = car.limitadorPit ? '#3a7bff' : '#3a4250'; x.fillText('PIT', 84, 250);
  // combustible: kg, vueltas que da y mezcla
  x.font = '800 17px Arial'; x.fillStyle = (info.vueltasFuel ?? 99) < (info.vueltasQuedan ?? 0) ? '#ff3b3b' : '#cfd6e2';
  x.fillText(`FUEL ${(car.combustible ?? 0).toFixed(1)}kg${info.vueltasFuel != null ? ` · ${info.vueltasFuel.toFixed(1)}v` : ''}`, 170, 220);
  x.fillStyle = ['#2fe07a', '#8a94a6', '#ff9a3c'][car.mandos.mezcla ?? 1]; x.fillText(`MIX ${['AHORRO', 'NORMAL', 'RICA'][car.mandos.mezcla ?? 1]}`, 170, 250);
  x.fillStyle = car.mandos.bb ? '#ffd23f' : '#cfd6e2'; x.fillText(`BB ${((car.reglaje?.repartoFreno ?? 57) + (car.mandos.bb || 0)).toFixed(1)}`, 300, 250);
  x.fillStyle = (car.mandos.fm ?? 1) !== 1 ? '#ffd23f' : '#cfd6e2'; x.fillText(`EB ${(car.mandos.fm ?? 1) + 1}`, 392, 250);
  // cupo de Overtake (línea magenta bajo la batería; brilla si está activo)
  x.fillStyle = '#2a1830'; x.fillRect(14, 204, 150, 5);
  x.fillStyle = car.mandos.overtake ? '#ff3df5' : '#9a3b93'; x.fillRect(14, 204, 150 * Math.max(0, (car.otEnergia ?? 0) / 1e6), 5);
  // derecha: neumáticos (temperatura y desgaste) y daños
  const opt = car.ruedas[0].neum.c.tOpt;
  const col = (t) => t < opt - 35 ? '#2f7bff' : t < opt - 15 ? '#36c4ff' : t < opt + 15 ? '#2fe07a' : t < opt + 30 ? '#ffd23f' : '#ff3b3b';
  car.ruedas.forEach((w, k) => {
    const cx = W - 140 + (k % 2) * 66, cy = 24 + Math.floor(k / 2) * 74;
    x.fillStyle = car.dano?.suelta[k] ? '#222' : car.dano?.pinchazo[k] ? '#ff3b3b' : col(w.neum.tSup);
    x.fillRect(cx, cy, 56, 64);
    x.fillStyle = '#03140a'; x.font = '900 24px Arial'; x.textAlign = 'center';
    x.fillText(String(Math.round(w.neum.tSup)), cx + 28, cy + 26);
    x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(cx + 6, cy + 48, 44, 8);
    x.fillStyle = '#03140a'; x.fillRect(cx + 6, cy + 48, 44 * (1 - w.neum.desgaste), 8);
  });
  x.textAlign = 'right'; x.font = '800 18px Arial';
  const avisos = [];
  if (car.danoAleron > 0.05) avisos.push('ALERÓN DEL');
  if (car.dano?.aleronTras > 0.05) avisos.push('ALERÓN TRAS');
  if (car.dano?.pinchazo.some(Boolean)) avisos.push('PINCHAZO');
  if (info.box) avisos.push('BOX BOX');
  // gráfica del delta a lo largo de la vuelta (verde = ganando a tu mejor vuelta)
  if (info.frac != null && info.delta != null) {
    const N = 64, h = p.hist ??= { d: new Float32Array(N).fill(NaN), ult: 0 };
    const k = Math.min(N - 1, Math.floor(info.frac * N));
    if (k < h.ult - 8) h.d.fill(NaN);                       // vuelta nueva
    h.d[k] = info.delta; h.ult = k;
    const gx = W - 140, gy = 170, gw = 128, gh = 34, esc = 1 / Math.max(0.3, ...Array.from(h.d).filter(v => v === v).map(Math.abs));
    x.fillStyle = '#0c111a'; x.fillRect(gx, gy, gw, gh);
    x.strokeStyle = '#2a3242'; x.lineWidth = 1; x.beginPath(); x.moveTo(gx, gy + gh / 2); x.lineTo(gx + gw, gy + gh / 2); x.stroke();
    for (let i = 0; i < N; i++) {
      const v = h.d[i]; if (v !== v) continue;
      const bh = Math.max(1, Math.abs(v) * esc * gh / 2);
      x.fillStyle = v <= 0 ? '#2fe07a' : '#ff3b3b';
      x.fillRect(gx + i * gw / N, v <= 0 ? gy + gh / 2 - bh : gy + gh / 2, Math.max(1, gw / N - 0.5), bh);
    }
    x.fillStyle = '#ffd23f'; x.fillRect(gx + k * gw / N, gy, 2, gh);
  }
  x.fillStyle = '#ff3b3b';
  avisos.slice(0, 1).forEach((t, i) => x.fillText(t, W - 14, 226 + i * 26));
  // temperatura del motor (en el rebufo sube): verde, amarilla desde 112 °C y roja desde 120 °C
  const tm = car.tMotor ?? 90;
  x.fillStyle = tm >= 120 ? '#ff3b3b' : tm >= 112 ? '#ffd23f' : '#8a94a6'; x.font = '800 17px Arial'; x.fillText(`MOT ${Math.round(tm)}°`, W - 14, 252);
  p.tex.needsUpdate = true;
}

/**
 * Crea el modelo de un monoplaza.
 * opc: { equipo, equipado: { patron, acabado, casco, colores, cascoColores, numero }, imagen, compuesto, calidad, cabina }
 */
export function crearModelo(opc) {
  const { equipo, compuesto = 'medio', calidad = 2, cabina = false } = opc;
  const eq = opc.equipado || {};
  const fisico = calidad >= 2;
  const colores = { base: equipo.base, acento: equipo.acento, tercero: equipo.tercero || '#ffffff', ...(eq.colores || {}) };
  const numero = eq.numero ?? opc.numero ?? 7;
  // textura de la librea (compartida entre los dos coches de un equipo de la IA)
  const tam = calidad >= 2 ? 1024 : 512;
  const claveTex = opc.imagen ? null : `${eq.patron || equipo.patron || 'franjas'}|${colores.base}|${colores.acento}|${colores.tercero}|${numero}|${tam}`;
  let tex = claveTex && cacheTex.get(claveTex);
  if (!tex) {
    const cv = document.createElement('canvas'); cv.width = tam; cv.height = tam;
    dibujarLibrea(cv, { patron: eq.patron || equipo.patron || 'franjas', colores, numero, imagen: opc.imagen || null });
    tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    if (claveTex) cacheTex.set(claveTex, tex);
  }
  const pintura = materialLibrea(tex, eq.acabado || 'brillo', fisico);
  const carbono = matComun('carbono');
  const negro = matComun('negro');
  const metal = matComun('metal');
  const goma = matComun('goma');

  const geo = { librea: [], carbono: [], negro: [], metal: [] };
  let forroCabina = null;
  const piezas = [];

  // ── Carrocería de un monoplaza de efecto suelo (secciones medidas sobre un coche real) ──
  // Monocasco, morro y cubierta motor: [x, semiancho, alto arriba, alto abajo, forma arriba, forma abajo]
  const S = (x, w, yt, yb, n = 3, nb = 2.4, z = 0) => ({ x, w, yt, yb, n, nb, z });
  const morro = [
    S(3.06, 0.030, 0.245, 0.195, 2, 2), S(3.00, 0.055, 0.262, 0.172, 2.3, 2.2), S(2.86, 0.078, 0.287, 0.160, 2.6, 2.4),
    S(2.62, 0.098, 0.322, 0.160, 2.8, 2.6), S(2.32, 0.120, 0.368, 0.168, 3.0, 2.8), S(2.02, 0.142, 0.425, 0.180, 3.2, 3.0),
    S(1.72, 0.168, 0.490, 0.188, 3.4, 3.2), S(1.42, 0.198, 0.555, 0.186, 3.6, 3.4), S(1.12, 0.228, 0.612, 0.176, 3.8, 3.6),
    S(0.86, 0.254, 0.648, 0.162, 4.0, 3.8), S(0.68, 0.270, 0.655, 0.150, 4.2, 4.0),
    // habitáculo: el techo baja (asiento) y los lados quedan como bordes
    S(0.60, 0.278, 0.600, 0.142, 4.4, 4.0), S(0.30, 0.292, 0.600, 0.128, 4.4, 4.0), S(0.02, 0.300, 0.605, 0.122, 4.4, 4.0),
    S(-0.06, 0.300, 0.700, 0.122, 4.2, 4.0),
    S(-0.30, 0.282, 0.768, 0.128, 3.6, 3.6), S(-0.62, 0.238, 0.735, 0.142, 3.2, 3.4), S(-0.95, 0.188, 0.655, 0.160, 3.0, 3.0),
    S(-1.28, 0.145, 0.565, 0.178, 2.8, 2.8), S(-1.60, 0.110, 0.480, 0.192, 2.6, 2.6), S(-1.90, 0.083, 0.412, 0.205, 2.5, 2.5),
    S(-2.12, 0.064, 0.368, 0.215, 2.4, 2.4), S(-2.26, 0.050, 0.340, 0.225, 2.2, 2.2),
  ];
  geo.librea.push(loftS(morro, fisico ? 40 : 26));
  // bordes del habitáculo y reposacabezas acolchado
  for (const sg of [-1, 1]) {
    geo.librea.push(loftS([S(0.72, 0.012, 0.662, 0.60, 2, 2, sg * 0.262), S(0.55, 0.030, 0.705, 0.60, 2.2, 2, sg * 0.262), S(0.20, 0.034, 0.722, 0.60, 2.2, 2, sg * 0.272),
      S(-0.04, 0.034, 0.735, 0.60, 2.2, 2, sg * 0.278), S(-0.10, 0.020, 0.72, 0.62, 2, 2, sg * 0.278)], 10));
    geo.negro.push(loftS([S(0.08, 0.05, 0.74, 0.60, 3, 2, sg * 0.20), S(-0.06, 0.06, 0.76, 0.60, 3, 2, sg * 0.20)], 10));
  }
  // interior: asiento, piso y salpicadero oscuros
  {
    // tapa del hueco de las piernas (por delante del pecho, sin cortar el cuerpo del piloto)
    const sh = new THREE.Shape();
    sh.moveTo(0.66, -0.20); sh.quadraticCurveTo(0.72, 0, 0.66, 0.20); sh.lineTo(0.15, 0.25); sh.quadraticCurveTo(0.10, 0, 0.15, -0.25); sh.closePath();
    const g = new THREE.ShapeGeometry(sh, 12); g.rotateX(-Math.PI / 2); g.translate(0, 0.609, 0);   // mirando hacia arriba (se ve desde la cabina y la cámara de la cara)
    // es la parte de arriba del monocasco sobre las piernas: va pintada como el resto del coche
    geo.librea.push(g);
    // bañera: forro acolchado oscuro por dentro del habitáculo (paredes y suelo), para que por
    // ningún hueco entre el piloto y los bordes se vea la pista
    const forro = [];
    const pared = (x0, x1, y0, y1, z) => { const p = new THREE.PlaneGeometry(x1 - x0, y1 - y0); p.translate((x0 + x1) / 2, (y0 + y1) / 2, z); return p; };
    for (const sg of [-1, 1]) { const p = pared(-0.08, 0.74, 0.46, 0.70, sg * 0.262); p.rotateY(0); forro.push(p); }
    { const p = new THREE.PlaneGeometry(0.82, 0.524); p.rotateX(-Math.PI / 2); p.translate(0.33, 0.47, 0); forro.push(p); }          // suelo
    { const p = new THREE.PlaneGeometry(0.524, 0.24); p.rotateY(Math.PI / 2); p.translate(0.735, 0.58, 0); forro.push(p); }        // frente
    { const p = new THREE.PlaneGeometry(0.524, 0.28); p.rotateY(Math.PI / 2); p.translate(-0.08, 0.6, 0); forro.push(p); }          // respaldo
    const matForro = matComun('forroCabina', () => new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.92, side: THREE.DoubleSide }));
    forroCabina = unir(forro, matForro); forroCabina.receiveShadow = true;
    geo.negro.push(caja(0.04, 0.10, 0.44, 0.64, 0.64, 0, 0, 0, -0.3));      // salpicadero
  }
  // toma de aire sobre la cabeza, arco de seguridad y aleta de tiburón
  geo.librea.push(loftS([S(0.02, 0.105, 0.98, 0.79, 3.5, 3), S(-0.10, 0.12, 0.985, 0.77, 3.2, 3), S(-0.35, 0.115, 0.95, 0.74, 3, 3),
    S(-0.70, 0.07, 0.86, 0.70, 2.6, 2.6), S(-1.05, 0.03, 0.76, 0.64, 2.2, 2.2)], 18));
  geo.negro.push(loftS([S(0.035, 0.085, 0.965, 0.80, 4, 4), S(0.02, 0.09, 0.97, 0.80, 4, 4)], 14));
  geo.carbono.push(barra([-0.04, 0.99, 0], [-0.08, 1.05, 0], 0.02));
  {
    const sh = new THREE.Shape();
    sh.moveTo(-0.55, 0.86); sh.quadraticCurveTo(-1.2, 0.86, -1.75, 0.62); sh.lineTo(-1.80, 0.45); sh.lineTo(-0.60, 0.70);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false }); g.translate(0, 0, -0.006);
    geo.librea.push(g);
  }
  // pontones con boca de entrada, rampa descendente y rebaje inferior (undercut)
  for (const sg of [-1, 1]) {
    const pont = [
      S(0.80, 0.130, 0.52, 0.30, 6, 3, sg * 0.555), S(0.70, 0.175, 0.545, 0.268, 5.5, 2.4, sg * 0.575), S(0.50, 0.205, 0.556, 0.250, 5, 2.2, sg * 0.59),
      S(0.20, 0.218, 0.548, 0.238, 4.5, 2, sg * 0.585), S(-0.15, 0.212, 0.520, 0.226, 4, 2, sg * 0.56), S(-0.50, 0.190, 0.476, 0.214, 3.4, 2, sg * 0.51),
      S(-0.85, 0.155, 0.420, 0.204, 3, 2, sg * 0.44), S(-1.18, 0.112, 0.360, 0.196, 2.6, 2, sg * 0.35), S(-1.48, 0.068, 0.300, 0.192, 2.4, 2, sg * 0.26),
      S(-1.70, 0.035, 0.260, 0.195, 2.2, 2, sg * 0.20),
    ];
    geo.librea.push(loftS(pont, fisico ? 28 : 18));
    // boca de entrada (oscura y hundida)
    geo.negro.push(loftS([S(0.805, 0.112, 0.50, 0.318, 6, 6, sg * 0.555), S(0.79, 0.112, 0.50, 0.318, 6, 6, sg * 0.555)], 16));
    // retrovisores sobre el pontón y deflectores laterales (bargeboards): piezas que se rompen
    piezas.push({ tipo: 'espejo', sg, lib: [loftS([S(0.80, 0.045, 0.705, 0.665, 3, 3, sg * 0.50), S(0.76, 0.062, 0.712, 0.656, 3, 3, sg * 0.50), S(0.72, 0.062, 0.712, 0.656, 3, 3, sg * 0.50)], 12)],
      carb: [barra([0.76, 0.55, sg * 0.46], [0.76, 0.665, sg * 0.49], 0.007), barra([0.70, 0.60, sg * 0.30], [0.75, 0.68, sg * 0.45], 0.006)], centro: [0.76, 0.66, sg * 0.48] });
    piezas.push({ tipo: 'deflector', sg, lib: [], carb: [0, 1, 2].map(k => caja(0.34 - k * 0.06, 0.20 - k * 0.04, 0.008, 1.10 - k * 0.12, 0.17, sg * (0.40 + k * 0.07), 0, sg * 0.10, 0)), centro: [1.0, 0.17, sg * 0.47] });
  }
  // fondo plano con bordes curvados, difusor y vigas de soporte
  {
    const sh = new THREE.Shape();
    const borde = [[1.52, 0.26], [1.30, 0.58], [1.05, 0.88], [0.80, 0.95], [-1.20, 0.95], [-1.45, 0.80], [-1.70, 0.62], [-2.05, 0.55], [-2.22, 0.52]];
    sh.moveTo(borde[0][0], -borde[0][1]);
    for (const [x, z] of borde.slice(1)) sh.lineTo(x, -z);
    for (const [x, z] of borde.slice().reverse()) sh.lineTo(x, z);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: false });
    g.rotateX(Math.PI / 2); g.translate(0, 0.074, 0);
    geo.carbono.push(g);
    for (const sg of [-1, 1]) {
      // borde del fondo enrollado hacia arriba
      geo.carbono.push(loftS([S(0.95, 0.01, 0.10, 0.06, 2, 2, sg * 0.945), S(0.6, 0.03, 0.14, 0.06, 2, 2, sg * 0.96), S(-0.6, 0.03, 0.15, 0.06, 2, 2, sg * 0.96), S(-1.2, 0.015, 0.12, 0.06, 2, 2, sg * 0.95)], 8));
      // vallas del fondo bajo la entrada de los pontones
      for (let k = 0; k < 4; k++) geo.carbono.push(caja(0.45, 0.10 - k * 0.012, 0.007, 1.10 - k * 0.04, 0.12, sg * (0.18 + k * 0.08), 0, sg * 0.05, 0));
    }
    // difusor: canales que suben hacia atrás y paredes
    for (let k = -3; k <= 3; k++) geo.carbono.push(caja(0.62, 0.24, 0.010, -1.98, 0.17, k * 0.15, 0, 0, -0.33));
    const dif = new THREE.PlaneGeometry(0.66, 1.0); dif.rotateX(Math.PI / 2);   // mira hacia abajo: se ve desde atrás y desde el suelo
    dif.rotateZ(-0.33); dif.translate(-1.98, 0.17, 0);
    geo.carbono.push(dif);
  }
  // halo de titanio (elevado para despejar la vista del piloto) con su pilar central
  {
    const curva = new THREE.CatmullRomCurve3([
      // patas apoyadas sobre la carrocería tras el habitáculo (y = superficie en x = −0,26) y el
      // aro a la altura del casco, como en un monoplaza real
      [-0.27, 0.655, -0.245], [-0.15, 0.80, -0.29], [0.07, 0.885, -0.285], [0.31, 0.93, -0.19], [0.46, 0.94, -0.06],
      [0.46, 0.94, 0.06], [0.31, 0.93, 0.19], [0.07, 0.885, 0.285], [-0.15, 0.80, 0.29], [-0.27, 0.655, 0.245],
    ].map(p => new THREE.Vector3(...p)));
    // como el modelo de referencia: aro de sección ovalada (más ancho que alto), patas traseras
    // que se ensanchan al unirse a la carrocería, pilar delantero en forma de pala con su base
    // atornillada sobre el morro
    geo.librea.push(barridoOval(curva, fisico ? 72 : 40, fisico ? 16 : 10, (t) => {
      const pie = Math.max(0, 1 - Math.min(t, 1 - t) / 0.12);          // ensanche en las patas
      return [0.030 + pie * 0.035, 0.021 + pie * 0.022];
    }));
    // el pilar entra dentro del aro (antes acababa justo en su borde y se veía el corte en V)
    const pilar = new THREE.CatmullRomCurve3([[0.82, 0.635, 0], [0.70, 0.77, 0], [0.57, 0.905, 0], [0.48, 0.938, 0], [0.43, 0.945, 0]].map(p => new THREE.Vector3(...p)));
    geo.librea.push(barridoOval(pilar, fisico ? 24 : 14, fisico ? 14 : 8, (t) => {
      const base = Math.max(0, 1 - t / 0.25);
      return [0.016 + base * 0.02, 0.03 + base * 0.035];               // pala: estrecha de lado, larga de frente
    }));
    // unión soldada del pilar con el aro: una pieza que tapa el encuentro por arriba y por abajo
    { const u = new THREE.SphereGeometry(0.036, 16, 10); u.scale(1.25, 0.72, 1.35); u.translate(0.462, 0.939, 0); geo.librea.push(u); }
    // pies de las patas: carenado que funde el halo con la carrocería
    for (const sg of [-1, 1]) {
      const pie = new THREE.SphereGeometry(0.06, 16, 10); pie.scale(1.6, 0.55, 1.0); pie.translate(-0.265, 0.655, sg * 0.245); geo.librea.push(pie);
    }
    // placa de anclaje del pilar sobre el morro (con sus tornillos)
    geo.negro.push(caja(0.12, 0.012, 0.075, 0.84, 0.632, 0, 0, 0, -0.32));
    for (const [dx, dz] of [[-0.035, -0.025], [-0.035, 0.025], [0.035, -0.025], [0.035, 0.025]]) {
      const t = new THREE.CylinderGeometry(0.006, 0.006, 0.008, 8); t.translate(0.84 + dx, 0.641 - dx * 0.33, dz); geo.metal.push(t);
    }
  }
  // suspensión: triángulos y bieletas con perfil aerodinámico
  const xr = -B;
  for (const sg of [-1, 1]) {
    const zu = sg * 0.66;
    // delantera (empuje)
    geo.carbono.push(
      barraAero([A + 0.22, 0.44, sg * 0.15], [A, 0.50, zu]), barraAero([A - 0.20, 0.44, sg * 0.15], [A, 0.50, zu]),
      barraAero([A + 0.30, 0.25, sg * 0.12], [A - 0.01, 0.22, zu]), barraAero([A - 0.25, 0.25, sg * 0.12], [A - 0.01, 0.22, zu]),
      barraAero([A - 0.06, 0.22, zu * 0.96], [A - 0.10, 0.50, sg * 0.17], 0.010),
      barraAero([A + 0.10, 0.36, sg * 0.15], [A + 0.08, 0.36, zu], 0.008),
    );
    // trasera (tracción)
    geo.carbono.push(
      barraAero([xr + 0.26, 0.40, sg * 0.12], [xr, 0.46, zu]), barraAero([xr - 0.18, 0.42, sg * 0.10], [xr, 0.46, zu]),
      barraAero([xr + 0.30, 0.22, sg * 0.12], [xr, 0.20, zu]), barraAero([xr - 0.20, 0.22, sg * 0.10], [xr, 0.20, zu]),
      barraAero([xr - 0.05, 0.46, zu * 0.95], [xr + 0.05, 0.22, sg * 0.14], 0.010),
      barraAero([xr - 0.12, 0.32, sg * 0.10], [xr - 0.12, 0.32, zu], 0.008),
    );
    // portamanguetas y conductos de freno
    geo.negro.push(caja(0.10, 0.30, 0.05, A, 0.36, sg * 0.67), caja(0.10, 0.30, 0.05, xr, 0.34, sg * 0.65));
  }
  // caja de cambios, escapes y estructura de choque trasera
  geo.carbono.push(loftS([S(-1.6, 0.11, 0.36, 0.14, 3, 3), S(-2.0, 0.08, 0.34, 0.16, 3, 3), S(-2.30, 0.05, 0.32, 0.20, 2.6, 2.6)], 14));
  geo.metal.push(loftS([S(-2.25, 0.035, 0.42, 0.37, 2, 2), S(-2.36, 0.04, 0.425, 0.365, 2, 2)], 12));
  const carroceria = new THREE.Group();
  if (forroCabina) carroceria.add(forroCabina);
  const cuerpo = unir(geo.librea, pintura, true);
  carroceria.add(cuerpo);
  const mCarbono = unir(geo.carbono, carbono), mNegro = unir(geo.negro, negro);
  carroceria.add(mCarbono); carroceria.add(mNegro);
  const mMetal = geo.metal.length ? unir(geo.metal, metal) : null;
  if (mMetal) carroceria.add(mMetal);
  // piezas sueltas (con su pivote en el centro para que salgan volando al romperse)
  const matEspejo = matComun('espejo', () => new THREE.MeshStandardMaterial({ color: 0xaab6c4, metalness: 1, roughness: 0.04 }));
  const espejos = [];       // el coche del jugador los convierte en espejos de verdad (main.js)
  const gruposPieza = piezas.map(pz => {
    const g = new THREE.Group();
    const c = new THREE.Vector3(...pz.centro);
    if (pz.lib.length) { const m = unir(pz.lib, pintura, true); m.position.sub(c); g.add(m); }
    if (pz.carb.length) { const m = unir(pz.carb, carbono); m.position.sub(c); g.add(m); }
    if (pz.tipo === 'espejo') {
      const espejo = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.045), matEspejo);
      espejo.rotation.y = -Math.PI / 2; espejo.position.set(0.715 - c.x, 0.684 - c.y, pz.sg * 0.50 - c.z);
      espejo.userData.lado = pz.sg;
      g.add(espejo); espejos.push(espejo);
    }
    g.position.copy(c);
    carroceria.add(g);
    return { ...pz, g, rota: false };
  });

  // Alerón delantero de cuatro elementos que suben y se curvan hacia los extremos
  const alaDel = new THREE.Group();
  {
    const env = 1.94, lib = [], carb = [];
    const curvar = (sube, atras) => (x, y, z) => { const f = Math.min(1, Math.abs(z) / (env / 2)); const g = Math.max(0, (f - 0.22) / 0.78); return [x - atras * g * g, y + sube * Math.pow(g, 1.6), z]; };
    carb.push(alaCurva(0.34, 0.07, env, 0.05, 0.06, curvar(0.03, 0.02)).translate(2.86, 0.080, 0));
    lib.push(alaCurva(0.22, 0.09, env * 0.97, 0.07, 0.22, curvar(0.10, 0.16)).translate(2.70, 0.125, 0));
    lib.push(alaCurva(0.17, 0.09, env * 0.95, 0.07, 0.38, curvar(0.14, 0.24)).translate(2.58, 0.17, 0));
    carb.push(alaCurva(0.13, 0.09, env * 0.93, 0.07, 0.55, curvar(0.17, 0.30)).translate(2.48, 0.215, 0));
    for (const sg of [-1, 1]) {
      // placas laterales curvadas
      const sh = new THREE.Shape();
      sh.moveTo(3.02, 0.055); sh.lineTo(2.50, 0.05); sh.quadraticCurveTo(2.40, 0.20, 2.46, 0.34); sh.lineTo(2.62, 0.33); sh.quadraticCurveTo(2.90, 0.18, 3.02, 0.055);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1 }); g.translate(0, 0, sg * (env / 2) - 0.01);
      lib.push(g);
      // soportes del morro
      carb.push(caja(0.28, 0.10, 0.012, 2.92, 0.15, sg * 0.05));
    }
    const piv = new THREE.Vector3(2.9, 0.2, 0);
    const mL = unir(lib, pintura, true), mC = unir(carb, carbono);
    for (const m of [mL, mC]) { m.position.sub(piv); alaDel.add(m); }
    alaDel.position.copy(piv);
  }
  carroceria.add(alaDel);

  // Alerón trasero en forma de cuchara, con placas laterales, ala inferior (beam wing) y DRS
  const alaTras = new THREE.Group();
  const pivDrs = new THREE.Group();
  {
    const envT = 1.0, lib = [], carb = [];
    const cuchara = (x, y, z) => { const f = Math.abs(z) / (envT / 2); return [x, y - 0.035 * (1 - f * f), z]; };
    lib.push(alaCurva(0.34, 0.10, envT, 0.08, 0.16, cuchara).translate(-2.24, 0.88, 0));
    carb.push(alaCurva(0.20, 0.10, envT * 0.62, 0.07, 0.25).translate(-2.12, 0.40, 0));
    for (const sg of [-1, 1]) {
      const sh = new THREE.Shape();
      sh.moveTo(-1.95, 0.52); sh.quadraticCurveTo(-1.88, 0.80, -1.96, 1.07); sh.lineTo(-2.46, 1.10); sh.quadraticCurveTo(-2.54, 0.80, -2.42, 0.50); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.026, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 }); g.translate(0, 0, sg * envT / 2 - 0.013);
      lib.push(g);
    }
    // pilón central (cuello de cisne)
    carb.push(barraAero([-2.0, 0.36, 0], [-2.18, 0.92, 0], 0.016));
    const piv = new THREE.Vector3(-2.15, 0.55, 0);
    const m = unir(lib, pintura, true), mc = unir(carb, carbono);
    for (const x of [m, mc]) { x.position.sub(piv); alaTras.add(x); }
    pivDrs.position.set(-2.08 - piv.x, 1.0 - piv.y, 0);
    const flapGeo = alaCurva(0.22, 0.10, envT * 0.98, 0.06, 0, cuchara).translate(-0.11, 0, 0);
    // el flap usa su propia proyección (con su posición real en el coche)
    const flapProy = flapGeo.index ? flapGeo.toNonIndexed() : flapGeo.clone(); flapProy.translate(-2.08, 1.0, 0); proyectarUV(flapProy); flapProy.translate(2.08, -1.0, 0);
    const flap = new THREE.Mesh(flapProy, pintura); flap.castShadow = true;
    pivDrs.add(flap); pivDrs.rotation.z = 0.45;
    alaTras.add(pivDrs);
    alaTras.position.copy(piv);
  }
  carroceria.add(alaTras);

  // Luz trasera (parpadea al recuperar energía)
  const luzLluvia = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.11), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0 }));
  luzLluvia.position.set(-2.31, 0.27, 0);
  carroceria.add(luzLluvia);
  // su reflejo en el asfalto mojado: una estela roja alargada hacia la cámara (como en la tele)
  const reflejoLuz = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.16), new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  reflejoLuz.rotation.x = -Math.PI / 2; reflejoLuz.position.set(-3.4, 0.015, 0); reflejoLuz.visible = false; reflejoLuz.renderOrder = 2;

  // Volante en la columna de dirección
  const volante = crearVolante(cabina);
  const columna = new THREE.Group();
  columna.position.set(0.47, 0.70, 0);
  columna.rotation.z = -0.32;          // inclinado hacia el piloto
  const giroVolante = new THREE.Group();
  giroVolante.add(volante.g);
  columna.add(giroVolante);
  carroceria.add(columna);

  // Piloto: modelo aparte (render/piloto.js), sentado en la carrocería
  const piloto = crearPiloto({ traje: new THREE.MeshStandardMaterial({ map: texturaMono(colores), roughness: 0.78, normalMap: calidad >= 1 ? normalPliegues() : null, normalScale: new THREE.Vector2(0.6, 0.6) }), guante: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.8 }),
    matNegro: matComun('negro'), equipado: eq, colores, columna, calidad });
  piloto.grupo.position.y = -0.04;          // sentado bajo, como en un monoplaza real
  carroceria.add(piloto.grupo);
  const casco = piloto.casco, cuello = piloto.cuello;

  // Ruedas de 18" con perfil bajo, tapacubos aerodinámico y conducto de freno
  const cmp = COMPUESTOS[compuesto] || COMPUESTOS.medio;
  const ruedas = [];
  const pos = [[A, -COCHE.viaDel / 2, COCHE.radioDel, 0.305], [A, COCHE.viaDel / 2, COCHE.radioDel, 0.305],
    [-B, -COCHE.viaTras / 2, COCHE.radioTras, 0.405], [-B, COCHE.viaTras / 2, COCHE.radioTras, 0.405]];
  const grupo = new THREE.Group();
  const geoNeum = new Map();
  // tapa de la llanta: el aro entre el tapacubos y el neumático deja ver el disco, que brilla al
  // rojo cuando está caliente (se ve desde fuera y desde cualquier ángulo); una por eje
  const brilloLlanta = texturaBrilloLlanta();
  const nuevaTapa = () => new THREE.MeshStandardMaterial({ map: texturaTapacubos(cmp.color), roughness: 0.45, metalness: 0.25, emissive: new THREE.Color(0xff5a14), emissiveMap: brilloLlanta, emissiveIntensity: 0 });
  const matTapaDel = nuevaTapa(), matTapaTras = nuevaTapa();
  const matFreno = matComun('freno', () => new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.5, metalness: 0.4 }));
  for (const [k, [x, z, r, w]] of pos.entries()) {
    const giro = new THREE.Group(); giro.position.set(x, r, z);
    const rot = new THREE.Group(); giro.add(rot);
    const clave = `${r}|${w}|${calidad}`;
    if (!geoNeum.has(clave)) {
      // flanco bajo y abombado, banda de rodadura plana con hombros redondeados
      const perfil = [];
      const ri = r * 0.655, re = r, hw = w / 2, rb = 0.06;
      perfil.push(new THREE.Vector2(ri, -hw + 0.02));
      perfil.push(new THREE.Vector2(ri + 0.02, -hw - 0.004));
      for (let k = 0; k <= 8; k++) { const a = -Math.PI / 2 + k / 8 * Math.PI / 2; perfil.push(new THREE.Vector2(re - rb + Math.cos(a) * rb, -hw + rb + Math.sin(a) * rb)); }
      for (let k = 0; k <= 8; k++) { const a = k / 8 * Math.PI / 2; perfil.push(new THREE.Vector2(re - rb + Math.cos(a) * rb, hw - rb + Math.sin(a) * rb)); }
      perfil.push(new THREE.Vector2(ri + 0.02, hw + 0.004));
      perfil.push(new THREE.Vector2(ri, hw - 0.02));
      const gT = new THREE.LatheGeometry(perfil, calidad >= 2 ? 48 : 28); gT.rotateX(Math.PI / 2);
      geoNeum.set(clave, gT);
    }
    // cada neumático con su goma: el desgaste, el graining y las ampollas se ven en la banda
    const cvGoma = document.createElement('canvas'); cvGoma.width = 256; cvGoma.height = 64;
    const texGoma = new THREE.CanvasTexture(cvGoma); texGoma.colorSpace = THREE.SRGBColorSpace; texGoma.wrapS = THREE.RepeatWrapping;
    pintarGoma(cvGoma, 0, 0, 0, k);
    const matGoma = new THREE.MeshStandardMaterial({ map: texGoma, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
    const neum = new THREE.Mesh(geoNeum.get(clave), calidad >= 1 ? matGoma : matComun('gomaNeum')); neum.castShadow = true; neum.receiveShadow = true;
    rot.add(neum);
    const sg = Math.sign(z);
    const tapa = new THREE.Mesh(new THREE.CircleGeometry(r * 0.985, 40), k < 2 ? matTapaDel : matTapaTras);
    tapa.position.z = sg * (w / 2 + 0.006); if (sg < 0) tapa.rotation.y = Math.PI;
    rot.add(tapa);
    const tapaIn = new THREE.Mesh(new THREE.CircleGeometry(r * 0.64, 24), metal);
    tapaIn.position.z = -sg * (w / 2 - 0.01); if (sg > 0) tapaIn.rotation.y = Math.PI;
    rot.add(tapaIn);
    // conducto y disco de freno (no giran con la rueda)
    // cada conducto con su material: el disco de carbono se pone al rojo al frenar fuerte
    const matF = matFreno.clone(); matF.emissive = new THREE.Color(0xff3a08); matF.emissiveIntensity = 0;
    const conducto = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.62, 0.12, 20, 1, true), matF);
    conducto.rotation.x = Math.PI / 2; conducto.position.z = -sg * (w / 2 - 0.02);
    giro.add(conducto);
    grupo.add(giro);
    const disco = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.48, r * 0.48, 0.035, 24), matF);
    disco.rotation.x = Math.PI / 2; disco.position.z = -sg * (w / 2 - 0.07);
    giro.add(disco);
    // a alta velocidad los radios de la llanta se ven como un disco borroso (como en la tele)
    const borroso = new THREE.Mesh(new THREE.CircleGeometry(r * 0.975, 40), matBorroso(cmp.color));
    borroso.position.z = sg * (w / 2 + 0.009); if (sg < 0) borroso.rotation.y = Math.PI;
    giro.add(borroso);
    ruedas.push({ giro, rot, neum, tapa, borroso, matFreno: matF, base: new THREE.Vector3(x, r, z), radio: r, ancho: w, suelta: false, cvGoma, texGoma, claveGoma: '' });
  }

  // calor del escape: una lámina translúcida que ondula detrás del coche cuando el motor empuja
  const matCalor = new THREE.MeshBasicMaterial({ map: texturaCalor(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const calor = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.45), matCalor);
  calor.position.set(-2.55, 0.52, 0); calor.rotation.y = Math.PI / 2;
  carroceria.add(calor);
  const raiz = new THREE.Group();
  raiz.add(carroceria); raiz.add(grupo);
  // sombra de contacto: oscurece el asfalto bajo el coche (sin ella parece que flota)
  const sombraC = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 5.8), matSombraContacto(calidad));
  sombraC.rotation.x = -Math.PI / 2; sombraC.position.set(-0.15, 0.015, 0); sombraC.renderOrder = -1;
  raiz.add(sombraC); raiz.add(reflejoLuz);

  // Abolladuras: hunde la carrocería donde ha pegado cada golpe (se acumulan). Las caras que se
  // mueven toman la normal de su triángulo: el carbono roto se ve arrugado, con aristas.
  let nAbol = 0, posOrig = null, nrmOrig = null;
  function abollar(lista) {
    if (lista.length === nAbol) return;
    const g = cuerpo.geometry, p = g.attributes.position, nr = g.attributes.normal, P = p.array, N = nr.array;
    if (!posOrig) { posOrig = P.slice(); nrmOrig = N.slice(); }
    if (lista.length < nAbol) { P.set(posOrig); N.set(nrmOrig); nAbol = 0; }
    const tocados = new Uint8Array(p.count);
    for (let k = nAbol; k < lista.length; k++) {
      const a = lista[k];
      const lateral = Math.abs(a.z) > 0.3 && a.x > -2.0 && a.x < 2.6;
      for (let i = 0; i < p.count; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        let dist;
        if (lateral) { if (z * a.z <= 0.02) continue; dist = Math.hypot(x - a.x, (y - 0.38) * 1.4); }
        else dist = Math.hypot(x - a.x, (y - 0.3) * 1.2, (z - a.z * 0.4) * 0.8);
        if (dist >= a.r) continue;
        const h = Math.sin(i * 12.9898 + a.sem * 78.233) * 43758.5453;
        // arrugas: ruido por vértice más pliegues a lo largo del coche
        const ruido = 0.55 + 0.9 * (h - Math.floor(h)) + 0.35 * Math.sin(x * 38 + a.sem * 9) * Math.sin(y * 31);
        const f = (1 - dist / a.r) ** 2 * a.prof * ruido;
        if (lateral) P[i * 3 + 2] -= Math.sign(z) * f * Math.min(1, Math.abs(z) / 0.25);
        else P[i * 3] -= Math.sign(a.x) * f;
        P[i * 3 + 1] -= f * 0.25 * (ruido - 1);
        tocados[i] = 1;
      }
    }
    // normales de cara en los triángulos tocados
    const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    for (let t = 0; t < p.count; t += 3) {
      if (!tocados[t] && !tocados[t + 1] && !tocados[t + 2]) continue;
      v0.fromArray(P, t * 3); v1.fromArray(P, t * 3 + 3); v2.fromArray(P, t * 3 + 6);
      v1.sub(v0); v2.sub(v0); v1.cross(v2).normalize();
      for (let q = 0; q < 3; q++) { N[(t + q) * 3] = v1.x; N[(t + q) * 3 + 1] = v1.y; N[(t + q) * 3 + 2] = v1.z; }
    }
    p.needsUpdate = true; nr.needsUpdate = true;
    g.computeBoundingSphere();
    nAbol = lista.length;
  }

  // Desintegración: todo lo que queda por detrás del asiento (x < CORTE) se separa en varios
  // trozos que salen despedidos; la célula se queda con un borde roto e irregular.
  const CORTE = -0.32;
  let desintegrado = false;
  function partir(modelo3d) {
    const mallas = [cuerpo, mCarbono, mNegro, mMetal].filter(Boolean);
    for (const malla of mallas) {
      const g = malla.geometry, p = g.attributes.position, P = p.array;
      if (!malla.userData.orig) malla.userData.orig = (malla === cuerpo && posOrig) ? posOrig.slice() : P.slice();
      const trozos = [[], [], []];          // pontones/cubierta, caja de cambios, difusor y escape
      for (let t = 0; t < p.count; t += 3) {
        const cx = (P[t * 3] + P[t * 3 + 3] + P[t * 3 + 6]) / 3;
        if (cx >= CORTE) {
          // borde roto: los vértices que pasan del corte se quedan en él, con dientes
          for (let q = 0; q < 3; q++) { const i = (t + q) * 3; if (P[i] < CORTE) P[i] = CORTE - 0.04 * Math.abs(Math.sin(P[i + 2] * 41 + P[i + 1] * 17)); }
          continue;
        }
        trozos[cx > -1.2 ? 0 : cx > -1.9 ? 1 : 2].push(t);
      }
      for (const lista of trozos) {
        if (!lista.length) continue;
        const pos = new Float32Array(lista.length * 9), nrm = new Float32Array(lista.length * 9), uv = new Float32Array(lista.length * 6);
        const N = g.attributes.normal.array, U = g.attributes.uv?.array;
        lista.forEach((t, j) => {
          pos.set(P.subarray(t * 3, t * 3 + 9), j * 9); nrm.set(N.subarray(t * 3, t * 3 + 9), j * 9);
          if (U) uv.set(U.subarray(t * 2, t * 2 + 6), j * 6);
          for (let q = 0; q < 9; q++) P[t * 3 + q] = 0;           // fuera de la célula: triángulo vacío
        });
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); gg.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); gg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        gg.computeBoundingSphere();
        // centrado en su propio centro para que gire sobre sí mismo al volar
        const c = gg.boundingSphere.center.clone(); gg.translate(-c.x, -c.y, -c.z);
        const trozo = new THREE.Mesh(gg, malla.material); trozo.position.copy(c); trozo.castShadow = true;
        carroceria.add(trozo);
        modelo3d.alDesprender?.('motor', trozo);
        carroceria.remove(trozo);
      }
      p.needsUpdate = true; g.computeBoundingSphere();
    }
    alaTras.visible = false; estadoDanos.alaTras = true;
    for (const gp of gruposPieza) gp.g.visible = false;
    calor.visible = false; pivDrs.visible = false; luzLluvia.visible = false;
  }
  function recomponer() {
    for (const malla of [cuerpo, mCarbono, mNegro, mMetal].filter(Boolean)) {
      if (!malla.userData.orig) continue;
      malla.geometry.attributes.position.array.set(malla.userData.orig); malla.geometry.attributes.position.needsUpdate = true;
    }
    calor.visible = true; pivDrs.visible = true; luzLluvia.visible = true;
    if (posOrig) cuerpo.geometry.attributes.normal.array.set(nrmOrig);
    cuerpo.geometry.attributes.normal.needsUpdate = true;
    posOrig = null; nrmOrig = null; nAbol = 0;          // las abolladuras se vuelven a tomar desde el coche entero
  }

  let tPantalla = 0;
  const estadoDanos = { alaDel: false, alaTras: false };
  const modelo = {
    raiz, carroceria, ruedas, pivDrs, luzLluvia, pintura, alaDel, alaTras, casco, cuello, piloto, compuesto, espejos, volanteG: giroVolante, columna,
    mirada: 0,                     // giro de la cabeza (rad) para la cámara de cabina
    alDesprender: null,            // (tipo, objeto3D) → efectos de escombros
    elevar: 0,                     // gatos de boxes
    ruedaOculta: [false, false, false, false],
    actualizar(car, dt) {
      const d = car.dano;
      for (let k = 0; k < 4; k++) {
        const w = car.ruedas[k], m = ruedas[k];
        m.giro.rotation.y = -w.angulo;
        m.rot.rotation.z = -w.giro;
        // pinchazo: neumático aplastado; suspensión doblada: rueda caída y torcida
        const pin = d?.pinchazo[k] && !d.suelta[k];
        m.neum.scale.set(1, pin ? 0.9 : 1, pin ? 1.08 : 1);
        const om = Math.abs(car.velocidad || 0) / m.radio;
        m.borroso.material.opacity = Math.min(0.9, Math.max(0, (om - 25) / 50));
        m.borroso.visible = m.borroso.material.opacity > 0.02 && !m.suelta && !this.ruedaOculta[k];
        const sd = d?.susp[k] || 0;
        m.giro.rotation.x = sd * 0.16 * (w.izquierda ? -1 : 1);
        m.giro.position.y = m.base.y - (pin ? m.radio * 0.1 : 0) - sd * 0.04 + this.elevar;
        if (d?.suelta[k] && !m.suelta) { m.suelta = true; this.alDesprender?.('rueda', m.giro, k); }
        else if (!d?.suelta[k] && m.suelta) m.suelta = false;      // coche reparado (o la repetición vuelve atrás)
        m.giro.visible = !m.suelta && !this.ruedaOculta[k];
        // la goma cambia de aspecto con el desgaste (solo se repinta cuando cambia algo)
        const nm = w.neum;
        if (calidad >= 1 && nm && nm.desgaste != null) {
          const su = w.suciedad || 0;
          const cl = `${Math.round(nm.desgaste * 20)}|${Math.round((nm.graining || 0) * 8)}|${Math.round((nm.ampollas || 0) * 8)}|${Math.round(su * 6)}`;
          if (cl !== m.claveGoma) { m.claveGoma = cl; pintarGoma(m.cvGoma, nm.desgaste, nm.graining || 0, nm.ampollas || 0, k, su, w.sucioHierba ?? 0.5); m.texGoma.needsUpdate = true; }
          // mojado: la goma brilla con el agua de la pista
          m.neum.material.roughness = 0.88 - 0.45 * Math.min(1, car.aguaAqui || 0);
        }
      }
      carroceria.rotation.z = -car.cabeceo;
      carroceria.rotation.x = -car.balanceo;
      carroceria.position.y = ((car.alturaDel + car.alturaTras) / 2 - 0.05) * 0.8 + this.elevar;
      // alerones dañados: se doblan y, rotos del todo, se desprenden
      const da = car.danoAleron || 0;
      alaDel.rotation.set(0, da * 0.12, -da * 0.22);
      alaDel.position.y = 0.2 - da * 0.06;
      if (da >= 1 && !estadoDanos.alaDel) { estadoDanos.alaDel = true; this.alDesprender?.('alaDel', alaDel); }
      if (da < 0.05 && estadoDanos.alaDel) estadoDanos.alaDel = false;   // morro nuevo en boxes
      alaDel.visible = !estadoDanos.alaDel && !this.ocultarAla;
      const dt2 = d?.aleronTras || 0;
      alaTras.rotation.set(dt2 * 0.15, 0, dt2 * 0.35);
      if (dt2 >= 0.95 && !estadoDanos.alaTras) { estadoDanos.alaTras = true; this.alDesprender?.('alaTras', alaTras); }
      if (dt2 < 0.05 && estadoDanos.alaTras) estadoDanos.alaTras = false;
      alaTras.visible = !estadoDanos.alaTras;
      // espejos y deflectores se rompen según el daño acumulado en SU lado: el primer golpe
      // en la izquierda puede llevarse el espejo izquierdo; el segundo, los deflectores
      const zn = d?.zona;
      gruposPieza.forEach((g) => {
        const lado = zn ? (g.sg > 0 ? zn.izq : zn.der) + (g.tipo === 'deflector' ? zn.del * 0.35 : 0) : (d?.piezas || 0);
        const umbral = g.tipo === 'espejo' ? 0.45 : 0.8;
        if (lado >= umbral && !g.rota) { g.rota = true; this.alDesprender?.(g.tipo, g.g); }
        if (lado < 0.05 && (d?.piezas || 0) < 0.05 && g.rota) g.rota = false;
        g.g.visible = !g.rota;
        // antes de romperse se tuerce
        if (!g.rota) g.g.rotation.set(lado * 0.25 * g.sg, 0, -lado * 0.3);
      });
      if (d?.desintegrado && !desintegrado) { desintegrado = true; partir(this); }
      else if (!d?.desintegrado && desintegrado) { desintegrado = false; recomponer(); }
      if (d?.abolladuras) abollar(d.abolladuras);
      // frenos al rojo (por encima de ~550 °C): el disco y su brillo a través de la llanta
      for (let k = 0; k < 4; k++) {
        const tf = car.ruedas[k]?.tFreno ?? 0;
        ruedas[k].matFreno.emissiveIntensity = Math.max(0, Math.min(3.5, (tf - 550) / 160));
      }
      const tfD = Math.max(car.ruedas[0]?.tFreno ?? 0, car.ruedas[1]?.tFreno ?? 0), tfT = Math.max(car.ruedas[2]?.tFreno ?? 0, car.ruedas[3]?.tFreno ?? 0);
      matTapaDel.emissiveIntensity = Math.max(0, Math.min(7, (tfD - 560) / 70));
      matTapaTras.emissiveIntensity = Math.max(0, Math.min(7, (tfT - 560) / 70));
      // también en el disco borroso de la llanta a alta velocidad (si no, lo tapaba)
      for (let k = 0; k < 4; k++) ruedas[k].borroso.material.emissiveIntensity = (k < 2 ? matTapaDel : matTapaTras).emissiveIntensity;
      // calor del escape con el acelerador a fondo
      const acelM = car.mandos?.acelerador ?? 0;
      matCalor.opacity += (acelM * 0.14 - matCalor.opacity) * Math.min(1, dt * 4);
      if (matCalor.map) { matCalor.map.offset.y = (matCalor.map.offset.y + dt * 1.7) % 1; calor.scale.x = 1 + Math.sin(performance.now() / 60) * 0.06; }
      const objDrs = car.drsAbierto ? 1.05 : 0.45;
      pivDrs.rotation.z += (objDrs - pivDrs.rotation.z) * Math.min(1, dt * 18);
      // luz trasera: parpadea al recuperar energía; fija de noche y con lluvia
      const fija = this.luzTrasera?.() ? 2 : 0;
      luzLluvia.material.emissiveIntensity = car.ersPotenciaActual < -1000 ? (Math.sin(performance.now() / 70) > 0 ? 6 : 0.5) : fija;
      // reflejo en el agua: solo con la pista mojada; tiembla un poco con las ondas del agua
      const mojada = Math.min(1, Math.max(0, ((this.aguaPista?.() ?? 0) - 0.08) / 0.3));
      reflejoLuz.visible = mojada > 0.02 && luzLluvia.material.emissiveIntensity > 0.4 && luzLluvia.visible && !car.vuelo && !car.volcado;
      if (reflejoLuz.visible) { reflejoLuz.material.opacity = mojada * Math.min(1, luzLluvia.material.emissiveIntensity / 3) * (0.45 + 0.1 * Math.sin(performance.now() / 45)); reflejoLuz.scale.x = 0.85 + 0.2 * mojada; }
      // volante y piloto: el piloto lo lleva (o lo suelta y cruza los brazos en un golpe fuerte)
      const angVol = piloto.actualizar(car, dt);
      giroVolante.rotation.x = angVol;
      this.mirada = piloto.mirada;
      // LEDs y pantalla del volante
      const nOn = Math.max(0, Math.min(15, Math.floor((car.rpm - 10500) / 4200 * 15)));
      const flash = car.rpm > 14550 && car.marcha > 0 && car.marcha < 8 && Math.floor(performance.now() / 70) % 2 === 0;
      volante.leds.forEach((m, k) => { m.emissiveIntensity = flash ? (k >= 10 ? 4 : 0) : k < nOn ? 3 : 0; });
      if (volante.pantalla) {
        tPantalla += dt;
        if (tPantalla > 0.1) { tPantalla = 0; pintarPantalla(volante.pantalla, car, this.info); }
      }
    },
    // al salir de boxes con un juego nuevo se repinta la banda del compuesto
    cambiarCompuesto(nombre) {
      const c = COMPUESTOS[nombre] || COMPUESTOS.medio;
      const tx = texturaTapacubos(c.color);
      for (const mt of [matTapaDel, matTapaTras]) { mt.map = tx; mt.needsUpdate = true; }
      this.compuesto = nombre;
    },
    reponerPiezas() {
      for (const m of ruedas) { m.suelta = false; }
      estadoDanos.alaDel = false; estadoDanos.alaTras = false;
      for (const g of gruposPieza) g.rota = false;
    },
  };
  return modelo;
}

const cacheTex = new Map();

// disco de llanta "en movimiento": anillos concéntricos difuminados con el color del compuesto
const cacheBorroso = new Map();
function matBorroso(color) {
  if (cacheBorroso.has(color)) return cacheBorroso.get(color).clone();
  const n = 128, cv = document.createElement('canvas'); cv.width = cv.height = n;
  const x = cv.getContext('2d'), c = n / 2;
  const g = x.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, '#2b2e33'); g.addColorStop(0.16, '#8a9099'); g.addColorStop(0.2, '#30343a');
  g.addColorStop(0.6, '#3a3e45'); g.addColorStop(0.64, '#22252a'); g.addColorStop(0.9, '#1b1d21');
  g.addColorStop(0.93, color); g.addColorStop(0.97, color); g.addColorStop(1, '#151515');
  x.fillStyle = g; x.beginPath(); x.arc(c, c, c, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, opacity: 0, roughness: 0.5, metalness: 0.3, depthWrite: false, emissive: new THREE.Color(0xff5a14), emissiveMap: texturaBrilloLlanta(), emissiveIntensity: 0 });
  cacheBorroso.set(color, m);
  return m.clone();
}

// sombra de contacto suave (gradiente elíptico) compartida por todos los coches
let matSombraC = null;
function matSombraContacto(calidad) {
  if (matSombraC) return matSombraC;
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
  const x = cv.getContext('2d');
  x.scale(1, 2);
  const g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  matSombraC = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: calidad >= 1 ? 0.6 : 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color: 0x000000 });
  return matSombraC;
}

// Plantilla de la librea: el contorno real de cada pieza sobre el atlas, para pintarla en cualquier editor
export function dibujarPlantilla(tam = 2048) {
  const m = crearModelo({ equipo: { base: '#cccccc', acento: '#999999', tercero: '#ffffff' }, calidad: 0 });
  const cv = document.createElement('canvas'); cv.width = cv.height = tam;
  const x = cv.getContext('2d');
  x.fillStyle = '#1a1d24'; x.fillRect(0, 0, tam, tam);
  // bandas de las tres vistas
  x.fillStyle = '#20242d'; x.fillRect(0, tam / 2, tam, tam / 4);
  x.fillStyle = '#1d2129'; x.fillRect(0, tam * 3 / 4, tam, tam / 4);
  x.lineWidth = Math.max(1, tam / 1400);
  m.raiz.updateMatrixWorld(true);
  m.raiz.traverse(o => {
    if (!o.isMesh || !o.geometry.attributes.uv || !(o.material.map && o.material.map.image?.width >= 256)) return;
    const uv = o.geometry.attributes.uv;
    x.strokeStyle = 'rgba(255,255,255,0.22)'; x.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < uv.count; i += 3) {
      x.beginPath();
      for (let k = 0; k < 3; k++) { const px = uv.getX(i + k) * tam, py = (1 - uv.getY(i + k)) * tam; k ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.closePath(); x.fill(); x.stroke();
    }
  });
  x.fillStyle = 'rgba(255,255,255,0.75)'; x.font = `700 ${tam / 40}px Arial`;
  x.fillText('ARRIBA · morro a la derecha →', tam * 0.02, tam * 0.035);
  x.fillText('LADO DERECHO · morro a la derecha →', tam * 0.02, tam * 0.52);
  x.fillText('← morro a la izquierda · LADO IZQUIERDO', tam * 0.02, tam * 0.77);
  x.font = `600 ${tam / 70}px Arial`; x.fillStyle = 'rgba(255,255,255,0.5)';
  x.fillText('APEX GP · plantilla de librea · pinta sobre las piezas y sube la imagen (cuadrada) en el Garaje', tam * 0.02, tam * 0.985);
  return cv;
}
