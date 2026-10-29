// Modelo 3D procedural de un monoplaza moderno (efecto suelo, halo, ruedas de 18").
// Ejes del modelo: +X hacia delante, +Y arriba, +Z a la derecha. Origen bajo el CG, a nivel del suelo.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COCHE, COMPUESTOS } from '../config.js';
import { texturaCarbono } from './texturas.js';
import { proyectarUV, dibujarLibrea, materialLibrea, texturaCasco } from './librea.js';

const A = COCHE.wheelbase * (1 - COCHE.repartoDel); // eje delantero
const B = COCHE.wheelbase * COCHE.repartoDel;       // eje trasero

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
  g.computeVertexNormals();
  return g;
}

// Perfil alar extruido a lo largo de Z (envergadura)
function ala(cuerda, espesor, envergadura, curvatura = 0.06, angulo = 0) {
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
  const g = new THREE.ExtrudeGeometry(sh, { depth: envergadura, bevelEnabled: false, steps: 1 });
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

// Volante de F1: aro con empuñaduras, pantalla, LEDs de cambio, botones y levas
function crearVolante(conPantalla) {
  const g = new THREE.Group();
  const carbono = matComun('carbono');
  const negro = matComun('negro');
  const sh = new THREE.Shape();
  // contorno en el plano (z, y): ancho 0,28 m, alto 0,16 m, con empuñaduras redondeadas
  sh.moveTo(-0.14, 0.02); sh.quadraticCurveTo(-0.15, 0.08, -0.10, 0.085); sh.lineTo(0.10, 0.085);
  sh.quadraticCurveTo(0.15, 0.08, 0.14, 0.02); sh.lineTo(0.13, -0.06); sh.quadraticCurveTo(0.12, -0.085, 0.09, -0.08);
  sh.lineTo(0.06, -0.05); sh.lineTo(-0.06, -0.05); sh.lineTo(-0.09, -0.08); sh.quadraticCurveTo(-0.12, -0.085, -0.13, -0.06); sh.closePath();
  const cuerpo = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 });
  cuerpo.rotateY(Math.PI / 2); cuerpo.translate(-0.0175, 0, 0);
  g.add(new THREE.Mesh(cuerpo, carbono));
  // empuñaduras de goma
  const goma = matComun('goma');
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.09, 4, 8), goma);
    e.position.set(-0.005, -0.005, s * 0.125); g.add(e);
  }
  // pantalla
  let pantalla = null;
  const geoP = new THREE.PlaneGeometry(0.105, 0.055);
  if (conPantalla) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    pantalla = { cv, ctx: cv.getContext('2d'), tex: new THREE.CanvasTexture(cv) };
    pantalla.tex.colorSpace = THREE.SRGBColorSpace;
  }
  const mp = new THREE.Mesh(geoP, conPantalla ? new THREE.MeshBasicMaterial({ map: pantalla.tex, toneMapped: false }) : negro);
  mp.rotation.y = -Math.PI / 2; mp.position.set(-0.024, 0.02, 0); g.add(mp);
  // LEDs de cambio sobre la pantalla
  const leds = [];
  const geoL = new THREE.BoxGeometry(0.006, 0.008, 0.01);
  for (let k = 0; k < 15; k++) {
    const col = k < 5 ? 0x22e05c : k < 10 ? 0xff2a2a : 0x3a7bff;
    const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 0 });
    const l = new THREE.Mesh(geoL, m); l.position.set(-0.022, 0.066, -0.07 + k * 0.01); g.add(l); leds.push(m);
  }
  // botones de colores y selectores giratorios
  const colores = [0xe8202a, 0xf5c518, 0x2f7bff, 0x2fe07a, 0xffffff, 0xff7a00, 0xb84dff, 0x00e5ff];
  const geoB = new THREE.CylinderGeometry(0.008, 0.008, 0.01, 10); geoB.rotateZ(Math.PI / 2);
  const posB = [[0.045, -0.085], [0.045, 0.085], [0.025, -0.1], [0.025, 0.1], [-0.01, -0.105], [-0.01, 0.105], [-0.035, -0.05], [-0.035, 0.05]];
  posB.forEach(([y, z], k) => { const b = new THREE.Mesh(geoB, new THREE.MeshStandardMaterial({ color: colores[k], roughness: 0.4 })); b.position.set(-0.024, y, z); g.add(b); });
  const geoR = new THREE.CylinderGeometry(0.012, 0.012, 0.012, 14); geoR.rotateZ(Math.PI / 2);
  for (const [y, z] of [[-0.03, -0.015], [-0.03, 0.015], [-0.055, 0]]) { const r = new THREE.Mesh(geoR, matComun('metal')); r.position.set(-0.026, y, z); g.add(r); }
  // levas de cambio detrás
  for (const s of [-1, 1]) { const lv = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.07, 0.05), carbono); lv.position.set(0.03, 0.01, s * 0.1); g.add(lv); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { g, pantalla, leds };
}

function pintarPantalla(p, car) {
  const x = p.ctx;
  x.fillStyle = '#05070a'; x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#ffd23f'; x.font = '900 72px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(car.marcha === -1 ? 'R' : car.marcha === 0 ? 'N' : String(car.marcha), 128, 60);
  x.font = '700 28px Arial'; x.fillStyle = '#fff';
  x.textAlign = 'left'; x.fillText(String(Math.round(car.velocidad * 3.6)), 10, 28);
  x.textAlign = 'right'; x.fillText(String(Math.round(car.rpm / 100) * 100), 246, 28);
  // ERS y DRS
  x.fillStyle = '#333'; x.fillRect(10, 104, 236, 14);
  x.fillStyle = '#2fe07a'; x.fillRect(10, 104, 236 * Math.max(0, car.ers / 4e6), 14);
  x.font = '800 20px Arial'; x.textAlign = 'left'; x.fillStyle = car.drsAbierto ? '#2fe07a' : car.drsPermitido ? '#fff' : '#444';
  x.fillText('DRS', 10, 86);
  x.textAlign = 'right'; x.fillStyle = car.limitadorPit ? '#2f7bff' : '#444'; x.fillText('PIT', 246, 86);
  p.tex.needsUpdate = true;
}

// Brazo: cilindro entre dos puntos (se recoloca cada fotograma)
function colocarCilindro(m, a, b) {
  const d = b.clone().sub(a); const L = d.length();
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.scale.set(1, L, 1);
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

  // Monocasco, morro y cubierta motor
  geo.librea.push(loft([
    { x: 2.98, w: 0.07, h: 0.05, yc: 0.21 }, { x: 2.75, w: 0.11, h: 0.08, yc: 0.24 }, { x: 2.30, w: 0.16, h: 0.12, yc: 0.31 },
    { x: 1.80, w: 0.21, h: 0.16, yc: 0.39 }, { x: 1.25, w: 0.26, h: 0.20, yc: 0.44 }, { x: 0.70, w: 0.34, h: 0.23, yc: 0.47 },
    { x: 0.25, w: 0.40, h: 0.25, yc: 0.49 }, { x: -0.25, w: 0.42, h: 0.30, yc: 0.53 }, { x: -0.85, w: 0.35, h: 0.27, yc: 0.51 },
    { x: -1.40, w: 0.24, h: 0.21, yc: 0.44 }, { x: -1.90, w: 0.14, h: 0.15, yc: 0.36 }, { x: -2.28, w: 0.09, h: 0.10, yc: 0.31 },
  ], 22));
  for (const sg of [-1, 1]) {
    geo.librea.push(loft([
      { x: 0.42, w: 0.17, h: 0.15, yc: 0.40, n: 3.5 }, { x: 0.20, w: 0.24, h: 0.19, yc: 0.40, n: 3.5 },
      { x: -0.40, w: 0.26, h: 0.19, yc: 0.38, n: 3.0 }, { x: -1.00, w: 0.21, h: 0.15, yc: 0.33, n: 2.6 }, { x: -1.55, w: 0.09, h: 0.08, yc: 0.27 },
    ], 16, sg * 0.60));
    geo.negro.push(caja(0.02, 0.24, 0.30, 0.43, 0.42, sg * 0.60));
    // retrovisores
    geo.librea.push(caja(0.06, 0.06, 0.14, 0.72, 0.68, sg * 0.46));
    geo.carbono.push(barra([0.72, 0.6, sg * 0.32], [0.72, 0.66, sg * 0.42], 0.01));
  }
  geo.librea.push(loft([
    { x: 0.02, w: 0.10, h: 0.10, yc: 0.86 }, { x: -0.25, w: 0.13, h: 0.12, yc: 0.84 },
    { x: -0.65, w: 0.08, h: 0.08, yc: 0.74 }, { x: -1.0, w: 0.03, h: 0.04, yc: 0.62 },
  ], 14));
  geo.negro.push(caja(0.02, 0.15, 0.17, 0.03, 0.86, 0));
  {
    const sh = new THREE.Shape();
    sh.moveTo(-0.5, 0.80); sh.lineTo(-1.75, 0.62); sh.lineTo(-1.80, 0.40); sh.lineTo(-0.5, 0.55);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.015, bevelEnabled: false }); g.translate(0, 0, -0.0075);
    geo.librea.push(g);
  }
  // habitáculo (interior negro) y reposacabezas
  geo.negro.push(loft([{ x: 0.62, w: 0.20, h: 0.03, yc: 0.71 }, { x: 0.30, w: 0.27, h: 0.035, yc: 0.735 }, { x: -0.05, w: 0.25, h: 0.035, yc: 0.79 }], 14));
  geo.negro.push(caja(0.18, 0.12, 0.42, -0.05, 0.74, 0));
  // halo de titanio
  {
    const curva = new THREE.CatmullRomCurve3([
      [-0.20, 0.62, -0.32], [-0.08, 0.82, -0.36], [0.30, 0.90, -0.30], [0.58, 0.88, -0.05],
      [0.58, 0.88, 0.05], [0.30, 0.90, 0.30], [-0.08, 0.82, 0.36], [-0.20, 0.62, 0.32],
    ].map(p => new THREE.Vector3(...p)));
    geo.negro.push(new THREE.TubeGeometry(curva, 40, 0.028, 8, false));
    geo.negro.push(barra([0.85, 0.56, 0], [0.60, 0.88, 0], 0.03));
  }
  // fondo plano con efecto suelo y difusor
  {
    const sh = new THREE.Shape();
    sh.moveTo(1.35, -0.25); sh.lineTo(0.70, -0.92); sh.lineTo(-1.30, -0.92); sh.lineTo(-1.70, -0.60);
    sh.lineTo(-2.30, -0.50); sh.lineTo(-2.30, 0.50); sh.lineTo(-1.70, 0.60); sh.lineTo(-1.30, 0.92);
    sh.lineTo(0.70, 0.92); sh.lineTo(1.35, 0.25);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false });
    g.rotateX(Math.PI / 2); g.translate(0, 0.075, 0);
    geo.carbono.push(g);
    for (const sg of [-1, 1]) geo.carbono.push(caja(1.9, 0.06, 0.02, -0.3, 0.1, sg * 0.92));
    for (let k = -2; k <= 2; k++) geo.carbono.push(caja(0.55, 0.22, 0.012, -2.05, 0.17, k * 0.2, 0, 0, -0.35));
  }
  geo.carbono.push(ala(0.18, 0.12, 0.9, 0.04, 0.12).translate(-2.25, 0.48, 0));
  geo.carbono.push(caja(0.06, 0.48, 0.03, -2.12, 0.66, 0, 0, 0, 0.25));
  // suspensión
  for (const [x, z, del] of [[A, -COCHE.viaDel / 2, true], [A, COCHE.viaDel / 2, true], [-B, -COCHE.viaTras / 2, false], [-B, COCHE.viaTras / 2, false]]) {
    const sg = Math.sign(z);
    const zi = sg * (del ? 0.22 : 0.18), zo = z - sg * (del ? 0.17 : 0.20);
    const r = del ? COCHE.radioDel : COCHE.radioTras;
    geo.carbono.push(barra([x + 0.22, r + 0.04, zi], [x, r + 0.14, zo]), barra([x - 0.22, r + 0.04, zi], [x, r + 0.14, zo]),
      barra([x + 0.28, r - 0.12, zi], [x, r - 0.10, zo]), barra([x - 0.28, r - 0.12, zi], [x, r - 0.10, zo]),
      barra([x - 0.05, r - 0.10, zo * 0.95], [x - 0.05, r + 0.18, zi * 0.9], 0.010));
  }

  const carroceria = new THREE.Group();
  carroceria.add(unir(geo.librea, pintura, true));
  carroceria.add(unir(geo.carbono, carbono));
  carroceria.add(unir(geo.negro, negro));

  // Alerón delantero (pieza aparte: se deforma y se desprende)
  const alaDel = new THREE.Group();
  {
    const env = 1.90, lib = [], carb = [];
    carb.push(ala(0.36, 0.08, env, 0.05, 0.08).translate(2.80, 0.10, 0));
    lib.push(ala(0.22, 0.10, env * 0.92, 0.07, 0.30).translate(2.55, 0.16, 0));
    lib.push(ala(0.16, 0.10, env * 0.86, 0.07, 0.48).translate(2.40, 0.23, 0));
    for (const sg of [-1, 1]) { lib.push(caja(0.55, 0.26, 0.018, 2.62, 0.17, sg * env / 2)); carb.push(caja(0.35, 0.12, 0.02, 2.82, 0.16, sg * 0.06)); }
    const piv = new THREE.Vector3(2.9, 0.2, 0);
    const mL = unir(lib, pintura, true), mC = unir(carb, carbono);
    for (const m of [mL, mC]) { m.position.sub(piv); alaDel.add(m); }
    alaDel.position.copy(piv);
  }
  carroceria.add(alaDel);

  // Alerón trasero con DRS
  const alaTras = new THREE.Group();
  const pivDrs = new THREE.Group();
  {
    const envT = 1.0, lib = [];
    lib.push(ala(0.32, 0.10, envT, 0.07, 0.18).translate(-2.25, 0.86, 0));
    for (const sg of [-1, 1]) {
      const sh = new THREE.Shape();
      sh.moveTo(-1.92, 0.50); sh.lineTo(-1.88, 1.06); sh.lineTo(-2.48, 1.10); sh.lineTo(-2.50, 0.52);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.018, bevelEnabled: false }); g.translate(0, 0, sg * envT / 2 - 0.009);
      lib.push(g);
    }
    const piv = new THREE.Vector3(-2.15, 0.55, 0);
    const m = unir(lib, pintura, true); m.position.sub(piv); alaTras.add(m);
    pivDrs.position.set(-2.06 - piv.x, 1.0 - piv.y, 0);
    const flapGeo = ala(0.22, 0.10, envT, 0.06, 0).translate(-0.11, 0, 0);
    // el flap usa su propia proyección (con su posición real en el coche)
    const flapProy = flapGeo.index ? flapGeo.toNonIndexed() : flapGeo.clone(); flapProy.translate(-2.06, 1.0, 0); proyectarUV(flapProy); flapProy.translate(2.06, -1.0, 0);
    const flap = new THREE.Mesh(flapProy, pintura); flap.castShadow = true;
    pivDrs.add(flap); pivDrs.rotation.z = 0.45;
    alaTras.add(pivDrs);
    alaTras.position.copy(piv);
  }
  carroceria.add(alaTras);

  // Luz trasera (parpadea al recuperar energía)
  const luzLluvia = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.12), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0 }));
  luzLluvia.position.set(-2.31, 0.33, 0);
  carroceria.add(luzLluvia);

  // Piloto: hombros, brazos, guantes y casco
  const traje = new THREE.MeshStandardMaterial({ color: colores.base, roughness: 0.75 });
  const guante = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  const piloto = new THREE.Group();
  const hombros = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.2, 4, 8), traje); hombros.rotation.x = Math.PI / 2; hombros.position.set(0.05, 0.64, 0);
  piloto.add(hombros);
  const casco = new THREE.Group();
  const matCasco = new THREE.MeshPhysicalMaterial({ map: texturaCasco(eq.casco || 'clasico', eq.cascoColores || { base: colores.tercero, acento: colores.base }), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
  const esfera = new THREE.Mesh(new THREE.SphereGeometry(0.135, 24, 16), matCasco); esfera.scale.set(1.12, 1, 1); esfera.rotation.y = Math.PI;
  casco.add(esfera);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.138, 20, 8, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.2),
    new THREE.MeshPhysicalMaterial({ color: 0x0b0b10, metalness: 0.6, roughness: 0.05, clearcoat: 1, iridescence: 0.7 }));
  visor.rotation.y = Math.PI / 2; visor.scale.set(1.12, 1, 1); casco.add(visor);
  const mentonera = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.12), matCasco); mentonera.position.set(0.12, -0.07, 0); casco.add(mentonera);
  casco.position.set(0.08, 0.80, 0);
  piloto.add(casco);
  const geoBrazo = new THREE.CylinderGeometry(0.026, 0.022, 1, 8);
  const brazos = [];
  for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(geoBrazo, traje); m.castShadow = true; piloto.add(m); brazos.push(m); }
  const manos = [new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), guante), new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), guante)];
  manos.forEach(m => piloto.add(m));
  piloto.traverse(o => { if (o.isMesh) o.castShadow = true; });
  carroceria.add(piloto);

  // Volante en la columna de dirección
  const volante = crearVolante(cabina);
  const columna = new THREE.Group();
  columna.position.set(0.47, 0.67, 0);
  columna.rotation.z = -0.5;          // inclinado hacia el piloto
  const giroVolante = new THREE.Group();
  giroVolante.add(volante.g);
  columna.add(giroVolante);
  carroceria.add(columna);

  // Ruedas
  const cmp = COMPUESTOS[compuesto] || COMPUESTOS.medio;
  const ruedas = [];
  const pos = [[A, -COCHE.viaDel / 2, COCHE.radioDel, 0.305], [A, COCHE.viaDel / 2, COCHE.radioDel, 0.305],
    [-B, -COCHE.viaTras / 2, COCHE.radioTras, 0.405], [-B, COCHE.viaTras / 2, COCHE.radioTras, 0.405]];
  const grupo = new THREE.Group();
  const geoNeum = new Map();
  const matTapa = new THREE.MeshStandardMaterial({ map: texturaTapacubos(cmp.color), roughness: 0.5, metalness: 0.2 });
  for (const [x, z, r, w] of pos) {
    const giro = new THREE.Group(); giro.position.set(x, r, z);
    const rot = new THREE.Group(); giro.add(rot);
    const clave = `${r}|${w}|${calidad}`;
    if (!geoNeum.has(clave)) {
      const perfil = [];
      const ri = r * 0.60, re = r, hw = w / 2, rb = 0.055;
      perfil.push(new THREE.Vector2(ri, -hw + 0.01));
      for (let k = 0; k <= 6; k++) { const a = -Math.PI / 2 + k / 6 * Math.PI / 2; perfil.push(new THREE.Vector2(re - rb + Math.cos(a) * rb, -hw + rb + Math.sin(a) * rb)); }
      for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI / 2; perfil.push(new THREE.Vector2(re - rb + Math.cos(a) * rb, hw - rb + Math.sin(a) * rb)); }
      perfil.push(new THREE.Vector2(ri, hw - 0.01));
      const gT = new THREE.LatheGeometry(perfil, calidad >= 2 ? 40 : 24); gT.rotateX(Math.PI / 2);
      geoNeum.set(clave, gT);
    }
    const neum = new THREE.Mesh(geoNeum.get(clave), goma); neum.castShadow = true; neum.receiveShadow = true;
    rot.add(neum);
    const sg = Math.sign(z);
    const tapa = new THREE.Mesh(new THREE.CircleGeometry(r * 0.985, 32), matTapa);
    tapa.position.z = sg * (w / 2 + 0.002); if (sg < 0) tapa.rotation.y = Math.PI;
    rot.add(tapa);
    const tapaIn = new THREE.Mesh(new THREE.CircleGeometry(r * 0.6, 20), metal);
    tapaIn.position.z = -sg * (w / 2 - 0.01); if (sg > 0) tapaIn.rotation.y = Math.PI;
    rot.add(tapaIn);
    grupo.add(giro);
    ruedas.push({ giro, rot, neum, tapa, base: new THREE.Vector3(x, r, z), radio: r, ancho: w, suelta: false });
  }

  const raiz = new THREE.Group();
  raiz.add(carroceria); raiz.add(grupo);

  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), eje = new THREE.Vector3();
  let tPantalla = 0;
  const estadoDanos = { alaDel: false, alaTras: false };
  const modelo = {
    raiz, carroceria, ruedas, pivDrs, luzLluvia, pintura, alaDel, alaTras, casco, compuesto,
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
        const sd = d?.susp[k] || 0;
        m.giro.rotation.x = sd * 0.16 * (w.izquierda ? -1 : 1);
        m.giro.position.y = m.base.y - (pin ? m.radio * 0.1 : 0) - sd * 0.04 + this.elevar;
        if (d?.suelta[k] && !m.suelta) { m.suelta = true; this.alDesprender?.('rueda', m.giro, k); }
        m.giro.visible = !m.suelta && !this.ruedaOculta[k];
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
      alaDel.visible = !estadoDanos.alaDel;
      const dt2 = d?.aleronTras || 0;
      alaTras.rotation.set(dt2 * 0.15, 0, dt2 * 0.35);
      if (dt2 >= 0.95 && !estadoDanos.alaTras) { estadoDanos.alaTras = true; this.alDesprender?.('alaTras', alaTras); }
      if (dt2 < 0.05 && estadoDanos.alaTras) estadoDanos.alaTras = false;
      alaTras.visible = !estadoDanos.alaTras;
      const objDrs = car.drsAbierto ? 1.05 : 0.45;
      pivDrs.rotation.z += (objDrs - pivDrs.rotation.z) * Math.min(1, dt * 18);
      luzLluvia.material.emissiveIntensity = car.ersPotenciaActual < -1000 ? (Math.sin(performance.now() / 70) > 0 ? 6 : 0) : 0;
      // volante: ~9 vueltas de volante por radián de rueda (bloqueo ≈ ±170°)
      const angVol = -(car.anguloVolante || 0) * 9;
      giroVolante.rotation.x = angVol;
      // la cabeza se inclina con la aceleración lateral
      casco.rotation.x = Math.max(-0.25, Math.min(0.25, -(car.ayF || 0) * 0.012));
      casco.rotation.z = Math.max(-0.15, Math.min(0.2, (car.axF || 0) * 0.006));
      // brazos hasta las empuñaduras del volante
      columna.updateMatrix(); giroVolante.updateMatrix();
      eje.set(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), columna.rotation.z);
      for (let s = 0; s < 2; s++) {
        const lado = s ? 1 : -1;
        vA.set(0.0, 0, lado * 0.125).applyAxisAngle(new THREE.Vector3(1, 0, 0), angVol).applyAxisAngle(new THREE.Vector3(0, 0, 1), columna.rotation.z).add(columna.position);
        const hombro = vB.set(0.06, 0.66, lado * 0.17);
        const codo = vC.copy(hombro).lerp(vA, 0.5); codo.y -= 0.05; codo.z += lado * 0.06;
        colocarCilindro(brazos[s * 2], hombro, codo);
        colocarCilindro(brazos[s * 2 + 1], codo, vA);
        manos[s].position.copy(vA);
      }
      // LEDs y pantalla del volante
      const nOn = Math.max(0, Math.min(15, Math.floor((car.rpm - 10500) / 4200 * 15)));
      const flash = car.rpm > 14550 && car.marcha > 0 && car.marcha < 8 && Math.floor(performance.now() / 70) % 2 === 0;
      volante.leds.forEach((m, k) => { m.emissiveIntensity = flash ? (k >= 10 ? 4 : 0) : k < nOn ? 3 : 0; });
      if (volante.pantalla) {
        tPantalla += dt;
        if (tPantalla > 0.1) { tPantalla = 0; pintarPantalla(volante.pantalla, car); }
      }
    },
    // al salir de boxes con un juego nuevo se repinta la banda del compuesto
    cambiarCompuesto(nombre) {
      const c = COMPUESTOS[nombre] || COMPUESTOS.medio;
      matTapa.map = texturaTapacubos(c.color); matTapa.needsUpdate = true;
      this.compuesto = nombre;
    },
    reponerPiezas() {
      for (const m of ruedas) { m.suelta = false; }
      estadoDanos.alaDel = false; estadoDanos.alaTras = false;
    },
  };
  return modelo;
}

const cacheTex = new Map();

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
