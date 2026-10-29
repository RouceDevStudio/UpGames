// Modelo 3D procedural de un monoplaza moderno (efecto suelo, halo, ruedas de 18").
// Ejes del modelo: +X hacia delante, +Y arriba, +Z a la derecha. Origen bajo el CG, a nivel del suelo.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COCHE, COMPUESTOS } from '../config.js';
import { texturaCarbono, texturaNumero } from './texturas.js';

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
function matComun(nombre, crear) {
  if (!cacheMat.has(nombre)) cacheMat.set(nombre, crear());
  return cacheMat.get(nombre);
}

export function crearModelo(equipo, numero, compuesto, calidad = 2) {
  const fisico = calidad >= 2;
  const pintura = fisico
    ? new THREE.MeshPhysicalMaterial({ color: equipo.base, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 })
    : new THREE.MeshStandardMaterial({ color: equipo.base, metalness: 0.35, roughness: 0.35 });
  const acento = fisico
    ? new THREE.MeshPhysicalMaterial({ color: equipo.acento, metalness: 0.2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 })
    : new THREE.MeshStandardMaterial({ color: equipo.acento, metalness: 0.2, roughness: 0.35 });
  const carbono = matComun('carbono', () => new THREE.MeshStandardMaterial({ map: texturaCarbono(), roughness: 0.38, metalness: 0.3, color: 0x9a9a9a }));
  const negro = matComun('negro', () => new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.6 }));
  const metal = matComun('metal', () => new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.25, metalness: 1 }));
  const goma = matComun('goma', () => new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.88, metalness: 0 }));

  const geo = { pintura: [], acento: [], carbono: [], negro: [], metal: [] };

  // Monocasco, morro y cubierta motor
  geo.pintura.push(loft([
    { x: 2.98, w: 0.07, h: 0.05, yc: 0.21 },
    { x: 2.75, w: 0.11, h: 0.08, yc: 0.24 },
    { x: 2.30, w: 0.16, h: 0.12, yc: 0.31 },
    { x: 1.80, w: 0.21, h: 0.16, yc: 0.39 },
    { x: 1.25, w: 0.26, h: 0.20, yc: 0.44 },
    { x: 0.70, w: 0.34, h: 0.23, yc: 0.47 },
    { x: 0.25, w: 0.40, h: 0.25, yc: 0.49 },
    { x: -0.25, w: 0.42, h: 0.30, yc: 0.53 },
    { x: -0.85, w: 0.35, h: 0.27, yc: 0.51 },
    { x: -1.40, w: 0.24, h: 0.21, yc: 0.44 },
    { x: -1.90, w: 0.14, h: 0.15, yc: 0.36 },
    { x: -2.28, w: 0.09, h: 0.10, yc: 0.31 },
  ], 22));
  // pontones laterales
  for (const sg of [-1, 1]) {
    geo.pintura.push(loft([
      { x: 0.42, w: 0.17, h: 0.15, yc: 0.40, n: 3.5 },
      { x: 0.20, w: 0.24, h: 0.19, yc: 0.40, n: 3.5 },
      { x: -0.40, w: 0.26, h: 0.19, yc: 0.38, n: 3.0 },
      { x: -1.00, w: 0.21, h: 0.15, yc: 0.33, n: 2.6 },
      { x: -1.55, w: 0.09, h: 0.08, yc: 0.27 },
    ], 16, sg * 0.60));
    // boca del pontón
    geo.negro.push(caja(0.02, 0.24, 0.30, 0.43, 0.42, sg * 0.60));
    // franja de color en el pontón
    geo.acento.push(caja(1.2, 0.03, 0.02, -0.35, 0.47, sg * 0.865, 0, 0, -0.05));
  }
  // toma de aire sobre la cabeza (roll hoop)
  geo.pintura.push(loft([
    { x: 0.02, w: 0.10, h: 0.10, yc: 0.86 },
    { x: -0.25, w: 0.13, h: 0.12, yc: 0.84 },
    { x: -0.65, w: 0.08, h: 0.08, yc: 0.74 },
    { x: -1.0, w: 0.03, h: 0.04, yc: 0.62 },
  ], 14));
  geo.negro.push(caja(0.02, 0.15, 0.17, 0.03, 0.86, 0));
  // aleta de tiburón
  {
    const sh = new THREE.Shape();
    sh.moveTo(-0.5, 0.80); sh.lineTo(-1.75, 0.62); sh.lineTo(-1.80, 0.40); sh.lineTo(-0.5, 0.55);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.015, bevelEnabled: false });
    g.translate(0, 0, -0.0075);
    geo.acento.push(g);
  }
  // hueco del habitáculo y piloto
  geo.negro.push(loft([
    { x: 0.62, w: 0.20, h: 0.03, yc: 0.71 },
    { x: 0.30, w: 0.27, h: 0.035, yc: 0.735 },
    { x: -0.05, w: 0.25, h: 0.035, yc: 0.79 },
  ], 14));
  // casco
  const casco = new THREE.SphereGeometry(0.135, 18, 14); casco.scale(1.12, 1, 1); casco.translate(0.08, 0.80, 0);
  const visor = new THREE.SphereGeometry(0.138, 18, 8, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.38, Math.PI * 0.18);
  visor.rotateY(Math.PI / 2); visor.scale(1.12, 1, 1); visor.translate(0.08, 0.80, 0);
  geo.acento.push(casco);
  geo.negro.push(visor);
  // halo de titanio
  {
    const curva = new THREE.CatmullRomCurve3([
      [-0.20, 0.62, -0.32], [-0.08, 0.82, -0.36], [0.30, 0.90, -0.30], [0.58, 0.88, -0.05],
      [0.58, 0.88, 0.05], [0.30, 0.90, 0.30], [-0.08, 0.82, 0.36], [-0.20, 0.62, 0.32],
    ].map(p => new THREE.Vector3(...p)));
    geo.negro.push(new THREE.TubeGeometry(curva, 40, 0.028, 8, false));
    geo.negro.push(barra([0.85, 0.56, 0], [0.60, 0.88, 0], 0.03));
  }
  // retrovisores
  for (const sg of [-1, 1]) {
    geo.pintura.push(caja(0.06, 0.06, 0.14, 0.72, 0.68, sg * 0.46));
    geo.carbono.push(barra([0.72, 0.6, sg * 0.32], [0.72, 0.66, sg * 0.42], 0.01));
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
    // bordes del fondo levantados
    for (const sg of [-1, 1]) geo.carbono.push(caja(1.9, 0.06, 0.02, -0.3, 0.1, sg * 0.92));
    // difusor
    for (let k = -2; k <= 2; k++) geo.carbono.push(caja(0.55, 0.22, 0.012, -2.05, 0.17, k * 0.2, 0, 0, -0.35));
  }
  // alerón delantero: plano principal y dos flaps, derivas
  {
    const env = 1.90;
    geo.carbono.push(ala(0.36, 0.08, env, 0.05, 0.08).translate(2.80, 0.10, 0));
    const f1 = ala(0.22, 0.10, env * 0.92, 0.07, 0.30); f1.translate(2.55, 0.16, 0); geo.pintura.push(f1);
    const f2 = ala(0.16, 0.10, env * 0.86, 0.07, 0.48); f2.translate(2.40, 0.23, 0); geo.acento.push(f2);
    for (const sg of [-1, 1]) {
      geo.pintura.push(caja(0.55, 0.26, 0.018, 2.62, 0.17, sg * env / 2));
      // soportes al morro
      geo.carbono.push(caja(0.35, 0.12, 0.02, 2.82, 0.16, sg * 0.06));
    }
  }
  // alerón trasero con DRS
  const envT = 1.0;
  geo.pintura.push(ala(0.32, 0.10, envT, 0.07, 0.18).translate(-2.25, 0.86, 0));
  for (const sg of [-1, 1]) {
    // derivas
    const sh = new THREE.Shape();
    sh.moveTo(-1.92, 0.50); sh.lineTo(-1.88, 1.06); sh.lineTo(-2.48, 1.10); sh.lineTo(-2.50, 0.52);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.018, bevelEnabled: false });
    g.translate(0, 0, sg * envT / 2 - 0.009);
    geo.pintura.push(g);
    geo.acento.push(caja(0.55, 0.06, 0.02, -2.2, 1.03, sg * (envT / 2 + 0.005)));
  }
  // viga inferior y cuello de cisne
  geo.carbono.push(ala(0.18, 0.12, 0.9, 0.04, 0.12).translate(-2.25, 0.48, 0));
  geo.carbono.push(caja(0.06, 0.48, 0.03, -2.12, 0.66, 0, 0, 0, 0.25));
  // luz de lluvia / recuperación ERS
  const luzLluvia = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.12), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0 }));
  luzLluvia.position.set(-2.31, 0.33, 0);
  // suspensión (brazos fijos a la carrocería)
  const susp = [];
  for (const [x, z, del] of [[A, -COCHE.viaDel / 2, true], [A, COCHE.viaDel / 2, true], [-B, -COCHE.viaTras / 2, false], [-B, COCHE.viaTras / 2, false]]) {
    const sg = Math.sign(z);
    const zi = sg * (del ? 0.22 : 0.18), zo = z - sg * (del ? 0.17 : 0.20);
    const r = del ? COCHE.radioDel : COCHE.radioTras;
    susp.push(barra([x + 0.22, r + 0.04, zi], [x, r + 0.14, zo]), barra([x - 0.22, r + 0.04, zi], [x, r + 0.14, zo]));
    susp.push(barra([x + 0.28, r - 0.12, zi], [x, r - 0.10, zo]), barra([x - 0.28, r - 0.12, zi], [x, r - 0.10, zo]));
    susp.push(barra([x - 0.05, r - 0.10, zo * 0.95], [x - 0.05, r + 0.18, zi * 0.9], 0.010));
    geo.carbono.push(...susp.splice(0));
  }

  const carroceria = new THREE.Group();
  for (const [k, mat] of [['pintura', pintura], ['acento', acento], ['carbono', carbono], ['negro', negro], ['metal', metal]]) {
    if (!geo[k].length) continue;
    const norm = geo[k].map(g => { const gg = g.index ? g.toNonIndexed() : g; gg.deleteAttribute('uv'); if (!gg.attributes.normal) gg.computeVertexNormals(); return gg; });
    const m = new THREE.Mesh(mergeGeometries(norm, false), mat);
    m.castShadow = true; m.receiveShadow = true;
    carroceria.add(m);
  }
  // número en el morro y en la aleta
  const texNum = texturaNumero(numero, equipo.acento, equipo.base);
  const matNum = new THREE.MeshStandardMaterial({ map: texNum, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2 });
  const numMorro = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), matNum);
  numMorro.rotation.x = -Math.PI / 2; numMorro.rotation.z = -Math.PI / 2; numMorro.position.set(2.05, 0.548, 0);
  numMorro.rotation.order = 'XYZ';
  carroceria.add(numMorro);
  for (const sg of [-1, 1]) {
    const n2 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), matNum);
    n2.position.set(-1.1, 0.62, sg * 0.0085 * 1.01); n2.rotation.y = sg > 0 ? 0 : Math.PI;
    carroceria.add(n2);
  }
  carroceria.add(luzLluvia);

  // flap del DRS (pivota sobre su borde de ataque)
  const pivDrs = new THREE.Group();
  pivDrs.position.set(-2.06, 1.0, 0);
  const flap = new THREE.Mesh(ala(0.22, 0.10, envT, 0.06, 0).translate(-0.11, 0, 0), acento);
  flap.castShadow = true;
  pivDrs.add(flap);
  pivDrs.rotation.z = 0.45;
  carroceria.add(pivDrs);

  // Ruedas
  const c = COMPUESTOS[compuesto] || COMPUESTOS.medio;
  const texTapa = texturaTapacubos(c.color);
  const matTapa = new THREE.MeshStandardMaterial({ map: texTapa, roughness: 0.5, metalness: 0.2 });
  const ruedas = [];
  const pos = [[A, -COCHE.viaDel / 2, COCHE.radioDel, 0.305], [A, COCHE.viaDel / 2, COCHE.radioDel, 0.305],
    [-B, -COCHE.viaTras / 2, COCHE.radioTras, 0.405], [-B, COCHE.viaTras / 2, COCHE.radioTras, 0.405]];
  const grupo = new THREE.Group();
  for (const [x, z, r, w] of pos) {
    const giro = new THREE.Group(); giro.position.set(x, r, z);
    const rot = new THREE.Group(); giro.add(rot);
    // neumático por revolución de un perfil redondeado
    const perfil = [];
    const ri = r * 0.60, re = r, hw = w / 2, rb = 0.055;
    perfil.push(new THREE.Vector2(ri, -hw + 0.01));
    for (let k = 0; k <= 6; k++) { const a = -Math.PI / 2 + k / 6 * Math.PI / 2; perfil.push(new THREE.Vector2(re - rb + Math.cos(a) * rb, -hw + rb + Math.sin(a) * rb)); }
    for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI / 2; perfil.push(new THREE.Vector2(re - rb + Math.cos(a) * rb, hw - rb + Math.sin(a) * rb)); }
    perfil.push(new THREE.Vector2(ri, hw - 0.01));
    const gT = new THREE.LatheGeometry(perfil, calidad >= 2 ? 40 : 24);
    gT.rotateX(Math.PI / 2);
    const neum = new THREE.Mesh(gT, goma); neum.castShadow = true; neum.receiveShadow = true;
    rot.add(neum);
    // tapacubos con la banda de compuesto (exterior)
    const sg = Math.sign(z);
    const tapa = new THREE.Mesh(new THREE.CircleGeometry(re * 0.985, 32), matTapa);
    tapa.position.z = sg * (hw + 0.002);
    if (sg < 0) tapa.rotation.y = Math.PI;
    rot.add(tapa);
    const tapaIn = new THREE.Mesh(new THREE.CircleGeometry(ri, 20), metal);
    tapaIn.position.z = -sg * (hw - 0.01); if (sg > 0) tapaIn.rotation.y = Math.PI;
    rot.add(tapaIn);
    grupo.add(giro);
    ruedas.push({ giro, rot });
  }

  const raiz = new THREE.Group();
  raiz.add(carroceria); raiz.add(grupo);
  return {
    raiz, carroceria, ruedas, pivDrs, luzLluvia, pintura,
    actualizar(car, dt) {
      for (let k = 0; k < 4; k++) {
        const w = car.ruedas[k], m = ruedas[k];
        m.giro.rotation.y = -w.angulo;
        m.rot.rotation.z = -w.giro;
      }
      carroceria.rotation.z = -car.cabeceo;
      carroceria.rotation.x = -car.balanceo;
      carroceria.position.y = ((car.alturaDel + car.alturaTras) / 2 - 0.05) * 0.8;
      const objDrs = car.drsAbierto ? 1.05 : 0.45;
      pivDrs.rotation.z += (objDrs - pivDrs.rotation.z) * Math.min(1, dt * 18);
      luzLluvia.material.emissiveIntensity = car.ersPotenciaActual < -1000 ? (Math.sin(performance.now() / 70) > 0 ? 6 : 0) : 0;
    },
  };
}
