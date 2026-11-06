// Neumático y llanta de 18" hechos por código (sustituyen a los neumáticos escaneados, que eran
// ovalados, el doble de anchos que los de verdad y tenían manchas sin textura en la banda).
//
// - Neumático: perfil de revolución con flanco bajo y algo abombado, hombro redondeado y banda
//   apenas bombeada. Dos grupos de material: 0 = flancos (rotulación «UP GAMES» y franja del
//   compuesto, proyectados en plano como un disco: nada se estira) y 1 = banda de rodadura
//   (u alrededor, v de 0,3 a 0,7: la goma con desgaste que pinta cocheModelo.js).
// - Llanta: cara con radios (textura), labio metálico y tambor interior.
//
// Ejes: el eje de giro es z, centrado en el origen (como los neumáticos de antes).

import * as THREE from 'three';
import { COMPUESTOS } from '../config.js';

/** Proporción del radio de la llanta (18") respecto al del neumático (720 mm de diámetro). */
export const LLANTA = 0.64;

const cacheGeo = new Map();
/**
 * Geometría del neumático (radio r, ancho w) con dos grupos: flancos (0) y banda (1).
 * Compartida: no se debe modificar.
 */
export function geoNeumatico(r, w, seg = 64) {
  const clave = `${r.toFixed(4)}|${w.toFixed(4)}|${seg}`;
  if (cacheGeo.has(clave)) return cacheGeo.get(clave);
  const hw = w / 2, ri = r * LLANTA, rb = Math.min(0.048, hw * 0.32);
  // perfiles (radio, z) de cada tira, de dentro (z < 0) hacia fuera (z > 0)
  const flanco = (sg) => {
    const p = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      // del talón (pegado a la llanta) al hombro: sube recto y se abomba un poco hacia fuera
      p.push([ri + t * (r - rb - ri), sg * (hw - 0.016 * (1 - t) ** 1.5 + 0.006 * Math.sin(Math.PI * t))]);
    }
    return sg > 0 ? p.reverse() : p;          // siempre de -z a +z
  };
  const banda = [];
  for (let k = 0; k <= 8; k++) { const a = Math.PI / 2 * (1 - k / 8); banda.push([r - rb + rb * Math.cos(a), -(hw - rb + rb * Math.sin(a))]); }
  for (let k = 1; k < 8; k++) { const z = -(hw - rb) + (2 * (hw - rb)) * k / 8; banda.push([r + 0.003 * (1 - (z / (hw - rb)) ** 2), z]); }
  for (let k = 0; k <= 8; k++) { const a = Math.PI / 2 * k / 8; banda.push([r - rb + rb * Math.cos(a), hw - rb + rb * Math.sin(a)]); }
  const tiras = [{ p: flanco(-1), g: 0, lado: -1 }, { p: flanco(1), g: 0, lado: 1 }, { p: banda, g: 1 }];

  const pos = [], nor = [], uv = [], idx = [[], []];
  // normales del perfil: perpendicular a la tangente, hacia fuera de la sección
  const normales = (p) => p.map((q, k) => {
    const a = p[Math.max(0, k - 1)], b = p[Math.min(p.length - 1, k + 1)];
    let nr = b[1] - a[1], nz = -(b[0] - a[0]);
    const cr = (ri + r) / 2;
    if (nr * (q[0] - cr) + nz * q[1] < 0) { nr = -nr; nz = -nz; }
    const l = Math.hypot(nr, nz) || 1; return [nr / l, nz / l];
  });
  for (const t of tiras) {
    const n = normales(t.p), base = pos.length / 3, m = t.p.length;
    // en la banda, v según la distancia recorrida por el perfil (0,3 → 0,7)
    const largo = [0]; for (let k = 1; k < m; k++) largo.push(largo[k - 1] + Math.hypot(t.p[k][0] - t.p[k - 1][0], t.p[k][1] - t.p[k - 1][1]));
    for (let i = 0; i <= seg; i++) {
      const f = i / seg * Math.PI * 2, s = Math.sin(f), c = Math.cos(f);
      for (let k = 0; k < m; k++) {
        const [rad, z] = t.p[k], [nr, nz] = n[k];
        const x = rad * s, y = -rad * c;
        pos.push(x, y, z); nor.push(nr * s, -nr * c, nz);
        if (t.g === 1) uv.push(i / seg, 0.3 + 0.4 * largo[k] / largo[m - 1]);
        else uv.push(0.5 + t.lado * x / (2 * r), 0.5 + y / (2 * r));   // disco plano (el de dentro, en espejo)
      }
    }
    for (let i = 0; i < seg; i++) for (let k = 0; k < m - 1; k++) {
      const a = base + i * m + k, b = a + m, c2 = b + 1, d = a + 1;
      idx[t.g].push(a, b, d, b, c2, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...idx[0], ...idx[1]]);
  g.addGroup(0, idx[0].length, 0);
  g.addGroup(idx[0].length, idx[1].length, 1);
  g.computeBoundingSphere();
  g.userData.compartida = true;
  cacheGeo.set(clave, g);
  return g;
}

// ─── Flanco: rotulación y franja del compuesto ──────────────────────────────────────────────
function textoEnArco(x, texto, radio, centro, abajo) {
  // letras sobre un arco centrado en `centro` (rad); abajo: se leen de izquierda a derecha con
  // el pie hacia fuera, como en los neumáticos de verdad
  const anchos = [...texto].map(ch => x.measureText(ch).width + radio * 0.012);
  const total = anchos.reduce((a, b) => a + b, 0) / radio;
  let a = centro + (abajo ? total / 2 : -total / 2);
  [...texto].forEach((ch, k) => {
    const da = anchos[k] / radio;
    a += abajo ? -da / 2 : da / 2;
    x.save(); x.rotate(a);
    x.translate(0, -radio); if (abajo) x.rotate(Math.PI);
    x.fillText(ch, 0, 0); x.restore();
    a += abajo ? -da / 2 : da / 2;
  });
}

const cacheFlanco = new Map();
/** Material de los flancos del compuesto (compartido). */
export function matFlanco(compuesto, calidad = 2) {
  const clave = compuesto + '|' + (calidad >= 2 ? 2 : 1);
  if (cacheFlanco.has(clave)) return cacheFlanco.get(clave);
  const color = (COMPUESTOS[compuesto] || COMPUESTOS.medio).color;
  const N = calidad >= 2 ? 1024 : 512, R = N / 2;
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const x = cv.getContext('2d');
  x.fillStyle = '#111113'; x.fillRect(0, 0, N, N);
  x.translate(R, R);
  // goma con un leve degradado (el flanco recibe algo más de luz arriba del abombado)
  const g = x.createRadialGradient(0, 0, R * LLANTA, 0, 0, R);
  g.addColorStop(0, '#0d0d0f'); g.addColorStop(0.45, '#19191c'); g.addColorStop(0.8, '#141416'); g.addColorStop(1, '#0f0f11');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.fill();
  // protector de la llanta: dos aros finos en relieve junto al talón
  x.strokeStyle = 'rgba(60,60,66,0.9)'; x.lineWidth = R * 0.008;
  for (const k of [0.675, 0.705]) { x.beginPath(); x.arc(0, 0, R * k, 0, Math.PI * 2); x.stroke(); }
  // franjas del compuesto a los lados (como las de los neumáticos de F1)
  x.strokeStyle = color; x.lineWidth = R * 0.05; x.lineCap = 'round';
  for (const c of [0, Math.PI]) { x.beginPath(); x.arc(0, 0, R * 0.80, c - 0.62, c + 0.62); x.stroke(); }
  // rotulación arriba y abajo
  x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `italic 900 ${Math.round(R * 0.115)}px Arial, Helvetica, sans-serif`;
  textoEnArco(x, 'UP GAMES', R * 0.80, 0, false);
  textoEnArco(x, 'UP GAMES', R * 0.80, Math.PI, true);
  // letra pequeña del tamaño
  x.fillStyle = 'rgba(205,205,210,0.75)'; x.font = `bold ${Math.round(R * 0.045)}px Arial, Helvetica, sans-serif`;
  textoEnArco(x, 'APEX GP  18"', R * 0.735, Math.PI / 2, false);
  textoEnArco(x, (COMPUESTOS[compuesto]?.nombre || '').toUpperCase(), R * 0.735, -Math.PI / 2, false);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.78, metalness: 0 });
  cacheFlanco.set(clave, m);
  return m;
}

// ─── Llanta ────────────────────────────────────────────────────────────────────────────────
/** Número de radios de la llanta (la máscara del brillo del freno usa los mismos huecos). */
export const RADIOS = 10;

/** Textura de la cara de la llanta (disco de radio = el de la llanta). */
export function texturaLlanta(N = 512) {
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const x = cv.getContext('2d'), R = N / 2;
  x.fillStyle = '#060607'; x.fillRect(0, 0, N, N);
  x.translate(R, R);
  // fondo entre radios: el disco de freno y la mangueta en sombra
  const f = x.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 0.9);
  f.addColorStop(0, '#1d1e22'); f.addColorStop(1, '#0a0a0c');
  x.fillStyle = f; x.beginPath(); x.arc(0, 0, R * 0.9, 0, Math.PI * 2); x.fill();
  // radios: más anchos en el buje, se afinan hacia el aro
  for (let k = 0; k < RADIOS; k++) {
    x.save(); x.rotate(k * Math.PI * 2 / RADIOS);
    const gr = x.createLinearGradient(0, -R * 0.06, 0, R * 0.06);
    gr.addColorStop(0, '#5d6168'); gr.addColorStop(0.45, '#a9aeb6'); gr.addColorStop(1, '#3d4046');
    x.fillStyle = gr;
    x.beginPath(); x.moveTo(R * 0.26, -R * 0.075); x.lineTo(R * 0.9, -R * 0.035); x.lineTo(R * 0.9, R * 0.035); x.lineTo(R * 0.26, R * 0.075); x.closePath(); x.fill();
    x.restore();
  }
  // aro (labio) pulido
  const a = x.createRadialGradient(0, 0, R * 0.86, 0, 0, R);
  a.addColorStop(0, '#2b2d31'); a.addColorStop(0.25, '#9ea3ab'); a.addColorStop(0.6, '#e1e4e8'); a.addColorStop(1, '#6f747b');
  x.fillStyle = a; x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.arc(0, 0, R * 0.88, 0, Math.PI * 2, true); x.fill();
  // buje: tapa de carbono con la tuerca central
  const b = x.createRadialGradient(-R * 0.05, -R * 0.05, R * 0.02, 0, 0, R * 0.3);
  b.addColorStop(0, '#4a4c52'); b.addColorStop(1, '#17181b');
  x.fillStyle = b; x.beginPath(); x.arc(0, 0, R * 0.3, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#7a7f87'; x.lineWidth = R * 0.012; x.beginPath(); x.arc(0, 0, R * 0.3, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#c9a227';
  x.beginPath(); for (let k = 0; k < 6; k++) { const an = k * Math.PI / 3; x.lineTo(Math.cos(an) * R * 0.1, Math.sin(an) * R * 0.1); } x.closePath(); x.fill();
  x.fillStyle = '#8a6e14'; x.beginPath(); x.arc(0, 0, R * 0.045, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Máscara del brillo del disco de freno al rojo visto entre los radios (blanco = brilla). */
export function mascaraBrilloLlanta(N = 128) {
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const x = cv.getContext('2d'), R = N / 2;
  x.fillStyle = '#000'; x.fillRect(0, 0, N, N); x.translate(R, R);
  const g = x.createRadialGradient(0, 0, R * 0.3, 0, 0, R * 0.88);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.3, 'rgba(255,255,255,0.75)'); g.addColorStop(0.85, 'rgba(255,200,160,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, R * 0.88, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#000';
  for (let k = 0; k < RADIOS; k++) {
    x.save(); x.rotate(k * Math.PI * 2 / RADIOS);
    x.beginPath(); x.moveTo(R * 0.26, -R * 0.085); x.lineTo(R * 0.9, -R * 0.045); x.lineTo(R * 0.9, R * 0.045); x.lineTo(R * 0.26, R * 0.085); x.closePath(); x.fill();
    x.restore();
  }
  return new THREE.CanvasTexture(cv);
}

let matsLlanta = null;
function materialesLlanta() {
  if (!matsLlanta) matsLlanta = {
    cara: new THREE.MeshStandardMaterial({ map: texturaLlanta(), roughness: 0.38, metalness: 0.55 }),
    labio: new THREE.MeshStandardMaterial({ color: 0xc9cdd3, roughness: 0.22, metalness: 1 }),
    tambor: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide }),
  };
  return matsLlanta;
}

/**
 * Piezas de la llanta que giran con la rueda (labio y tambor), sin la cara (cada coche usa su
 * propio material de la cara, que brilla con los frenos). lado: +1 la cara mira a +z.
 */
export function aroLlanta(r, w, lado = 1, seg = 48) {
  const m = materialesLlanta(), ri = r * LLANTA, g = new THREE.Group();
  const labio = new THREE.Mesh(new THREE.TorusGeometry(ri * 0.985, r * 0.018, 8, seg), m.labio);
  labio.position.z = lado * (w / 2 - HUNDIDO - 0.002);
  const tambor = new THREE.Mesh(new THREE.CylinderGeometry(ri * 0.97, ri * 0.97, w - 0.03, seg, 1, true), m.tambor);
  tambor.rotation.x = Math.PI / 2;
  g.add(labio, tambor);
  return g;
}

/** Profundidad de la cara de la llanta respecto al borde exterior del neumático. */
export const HUNDIDO = 0.014;

/** Neumático montado suelto (estanterías, pila de boxes): eje z, cara de la llanta a +z. */
export function ruedaMontada(compuesto = 'medio', r = 0.36, w = 0.36, calidad = 1) {
  const g = new THREE.Group();
  const neum = new THREE.Mesh(geoNeumatico(r, w, calidad >= 2 ? 56 : 36), [matFlanco(compuesto, calidad), materialGomaLisa(compuesto)]);
  neum.castShadow = true;
  const m = materialesLlanta();
  const cara = new THREE.Mesh(new THREE.CircleGeometry(r * LLANTA, 32), m.cara);
  cara.position.z = w / 2 - HUNDIDO;
  // por detrás: la cara interior de la llanta (sin ella se vería el neumático hueco)
  const dorso = new THREE.Mesh(new THREE.CircleGeometry(r * LLANTA * 0.97, 32), m.tambor);
  dorso.position.z = -(w / 2 - 0.016); dorso.rotation.y = Math.PI;
  g.add(neum, cara, dorso, aroLlanta(r, w, 1, 32));
  return g;
}

/**
 * Dibujo de la banda de los neumáticos de agua (en el lienzo de la goma: x alrededor, la banda
 * entre 0,3 y 0,7 de alto). Intermedio: surcos cortos; lluvia: surcos en flecha profundos.
 */
export function dibujoBanda(x, W, H, compuesto) {
  const c = COMPUESTOS[compuesto];
  if (!c?.lluvia) return;
  const y0 = H * 0.3, y1 = H * 0.7, ym = (y0 + y1) / 2, alto = y1 - y0;
  const n = compuesto === 'lluvia' ? 28 : 22, paso = W / n;
  x.save();
  x.strokeStyle = 'rgba(0,0,0,0.92)'; x.lineCap = 'round';
  x.lineWidth = Math.max(1, (compuesto === 'lluvia' ? 0.06 : 0.04) * alto);
  for (let k = -1; k <= n; k++) {
    const cx = k * paso;
    if (compuesto === 'lluvia') {
      // flecha: del centro hacia los dos hombros, inclinada hacia atrás
      x.beginPath(); x.moveTo(cx, ym); x.lineTo(cx + paso * 0.9, y0 + alto * 0.04); x.stroke();
      x.beginPath(); x.moveTo(cx, ym); x.lineTo(cx + paso * 0.9, y1 - alto * 0.04); x.stroke();
    } else {
      x.beginPath(); x.moveTo(cx, ym - alto * 0.12); x.lineTo(cx + paso * 0.55, y0 + alto * 0.06); x.stroke();
      x.beginPath(); x.moveTo(cx + paso * 0.5, ym + alto * 0.12); x.lineTo(cx + paso * 1.05, y1 - alto * 0.06); x.stroke();
    }
  }
  // surco longitudinal central
  if (compuesto === 'lluvia') { x.fillStyle = 'rgba(0,0,0,0.9)'; x.fillRect(0, ym - alto * 0.025, W, alto * 0.05); }
  x.restore();
}

const gomaLisa = new Map();
function materialGomaLisa(compuesto) {
  if (!gomaLisa.has(compuesto)) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64;
    const x = cv.getContext('2d'); x.fillStyle = '#151516'; x.fillRect(0, 0, 512, 64);
    x.fillStyle = '#1a1a1c'; x.fillRect(0, 64 * 0.3, 512, 64 * 0.4);
    dibujoBanda(x, 512, 64, compuesto);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
    gomaLisa.set(compuesto, new THREE.MeshStandardMaterial({ map: t, roughness: 0.88 }));
  }
  return gomaLisa.get(compuesto);
}
