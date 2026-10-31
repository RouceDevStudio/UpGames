// Cuerpo del piloto por modelado de caja (box modeling) con las herramientas de Studio:
// 1) caja con cortes para el torso, con forma por anillos (pecho y glúteos con su volumen);
// 2) extrusiones articulación a articulación para piernas, botas, brazos, manos (con pulgar) y
//    cuello, cada una girada hacia el siguiente hueso y escalada a su sección (elíptica);
// 3) subdivisión Catmull-Clark (una sola pieza orgánica);
// 4) pintura por vértice (mono, franjas, guantes, botas) y escultura con los pinceles de Studio
//    (rodilleras, costuras y arrugas).
import * as THREE from 'three';
import { MallaHE } from '../malla/mediaArista.js';
import { extruirCaras, moverVertices } from '../malla/operaciones.js';
import { subdividir } from '../malla/subdividir.js';
import { Pincel } from '../herramientas/pincel.js';

const JAULA = 1.16; // la subdivisión encoge: la jaula se hace algo mayor que la forma final

// Anillos del torso de abajo arriba: [y, semiancho, fondo delante, fondo detrás]
const TORSO = [
  [0.84, 0.150, 0.098, 0.118],
  [0.92, 0.176, 0.108, 0.135],
  [1.01, 0.158, 0.104, 0.108],
  [1.11, 0.160, 0.114, 0.104],
  [1.22, 0.180, 0.130, 0.110],
  [1.32, 0.192, 0.130, 0.112],
  [1.41, 0.194, 0.114, 0.106],
  [1.48, 0.150, 0.085, 0.085],
];

// Recorridos: [x, y, z, radio de lado, radio de frente]
const PIERNA = (s) => [
  [0.100 * s, 0.76, 0.0, 0.085, 0.090], [0.115 * s, 0.64, 0.006, 0.077, 0.082], [0.127 * s, 0.53, 0.016, 0.060, 0.064],
  [0.134 * s, 0.47, 0.010, 0.056, 0.060], [0.143 * s, 0.36, -0.006, 0.059, 0.068], [0.152 * s, 0.24, -0.02, 0.049, 0.053],
  [0.160 * s, 0.135, -0.03, 0.044, 0.047],
];
const PIE = (s, x) => [[x, 0.075, -0.042, 0.048, 0.055], [x + 0.004 * s, 0.055, 0.05, 0.047, 0.042], [x + 0.008 * s, 0.045, 0.15, 0.042, 0.032]];
const BRAZO_IZQ = [ // en jarra: mano en la cadera, codo hacia fuera y atrás
  [0.252, 1.37, -0.015, 0.060, 0.064], [0.292, 1.29, -0.040, 0.056, 0.058], [0.333, 1.205, -0.064, 0.050, 0.052],
  [0.348, 1.165, -0.07, 0.047, 0.049], [0.318, 1.095, -0.042, 0.045, 0.046], [0.275, 1.04, -0.008, 0.040, 0.042],
  [0.24, 1.008, 0.018, 0.034, 0.031],
];
const MANO_IZQ = [[0.212, 0.985, 0.048, 0.022, 0.044], [0.198, 0.962, 0.085, 0.019, 0.041], [0.19, 0.935, 0.118, 0.016, 0.037]];
const BRAZO_DER = [ // colgando, con el volante en la mano
  [-0.25, 1.37, -0.005, 0.060, 0.064], [-0.247, 1.27, 0.0, 0.056, 0.058], [-0.25, 1.18, 0.014, 0.050, 0.052],
  [-0.252, 1.15, 0.022, 0.047, 0.049], [-0.258, 1.06, 0.040, 0.045, 0.046], [-0.264, 0.99, 0.054, 0.040, 0.042],
  [-0.27, 0.935, 0.064, 0.034, 0.031],
];
const MANO_DER = [[-0.276, 0.89, 0.074, 0.024, 0.043], [-0.283, 0.848, 0.092, 0.022, 0.041], [-0.276, 0.818, 0.118, 0.021, 0.037]];
const CUELLO = [[0, 1.522, -0.01, 0.070, 0.066], [0, 1.578, 0.0, 0.062, 0.060]];

export const ESQUELETO = { PIERNA, PIE, BRAZO_IZQ, MANO_IZQ, BRAZO_DER, MANO_DER, CUELLO, TORSO };

// Pose de la plantilla: mano izquierda en la cadera y el volante en la derecha.
export const POSE_JARRA = { pierna: PIERNA, pie: PIE, brazos: [[1, BRAZO_IZQ, MANO_IZQ, [0, 0, -1]], [-1, BRAZO_DER, MANO_DER, [0, 0, 1]]], cuello: CUELLO };

// Pose de reposo para los personajes de APEX GP: piernas rectas y brazos colgando, con las
// articulaciones donde las tiene el esqueleto de los personajes del juego (hombro a 1,48 m, codo a
// 1,19 m, muñeca a 0,94 m, cadera a 0,93 m, rodilla a 0,49 m), para poder animarlo.
const brazoReposo = (s) => [
  [0.238 * s, 1.40, 0.0, 0.060, 0.064], [0.242 * s, 1.30, 0.0, 0.056, 0.058], [0.245 * s, 1.215, 0.003, 0.050, 0.052],
  [0.246 * s, 1.19, 0.004, 0.047, 0.049], [0.246 * s, 1.07, 0.006, 0.045, 0.046], [0.245 * s, 0.99, 0.008, 0.040, 0.042],
  [0.244 * s, 0.95, 0.010, 0.034, 0.031],
];
const manoReposo = (s) => [[0.243 * s, 0.90, 0.012, 0.022, 0.044], [0.24 * s, 0.855, 0.014, 0.019, 0.041], [0.237 * s, 0.81, 0.016, 0.016, 0.037]];
const piernaReposo = (s) => [
  [0.095 * s, 0.80, 0.0, 0.085, 0.090], [0.096 * s, 0.66, 0.004, 0.077, 0.082], [0.097 * s, 0.52, 0.012, 0.060, 0.064],
  [0.097 * s, 0.46, 0.008, 0.056, 0.060], [0.097 * s, 0.34, -0.006, 0.059, 0.068], [0.097 * s, 0.22, -0.02, 0.049, 0.053],
  [0.097 * s, 0.12, -0.03, 0.044, 0.047],
];
export const POSE_REPOSO = { pierna: piernaReposo, pie: PIE, brazos: [[1, brazoReposo(1), manoReposo(1), [0, 0, 1]], [-1, brazoReposo(-1), manoReposo(-1), [0, 0, 1]]], cuello: CUELLO };

export const COLORES = { traje: 0xd8141f, franja: 0xf2f2f2, guante: 0x17191d, bota: 0x17191d, suela: 0xe8e8e8, cuello: 0x17191d };

export function cuerpoPiloto({ niveles = 2, detalles = true, pose = POSE_JARRA } = {}) {
  // 1) caja 4 × 7 × 2 y anillos
  const caja = new THREE.BoxGeometry(1, 1, 1, 4, TORSO.length - 1, 2);
  let m = MallaHE.desdeTriangulos(caja.attributes.position.array, caja.index.array, { uvs: caja.attributes.uv.array });
  m = moverVertices(m, [...Array(m.nV).keys()], ([x, y, z]) => {
    const [ty, hw, hf, hb] = TORSO[Math.round((y + 0.5) * (TORSO.length - 1))];
    return [x * 2 * hw * JAULA, ty, z * 2 * (z > 0 ? hf : hb) * JAULA];
  }).malla;
  // qué caras de la jaula son guante, bota o cuello (se pintan antes de subdividir)
  const parte = new Map();
  const marcar = (desde, hasta, caps, tipo) => { for (let f = desde; f < hasta; f++) parte.set(f, tipo); for (const f of caps) parte.set(f, tipo); };
  // 2) piernas y botas desde la base
  for (const s of [1, -1]) {
    const pierna = pose.pierna(s);
    let r = extruirRecorrido(m, carasDonde(m, (c, n) => n[1] < -0.9 && c[0] * s > 0), pierna);
    const f0 = r.malla.nF - 8; // laterales del último tramo de la pierna: la caña de la bota
    r = extruirRecorrido(r.malla, r.caras, pose.pie(s, pierna[pierna.length - 1][0]));
    m = r.malla;
    marcar(f0, m.nF, r.caras, 'bota');
  }
  // brazos desde el costado (dos filas de arriba), manos y pulgares
  for (const [s, brazo, mano, dedoGordo] of pose.brazos) {
    let r = extruirRecorrido(m, carasDonde(m, (c, n) => n[0] * s > 0.6 && c[1] > TORSO[5][0] - 0.01), brazo);
    const f0 = r.malla.nF - 8; // laterales del último tramo del brazo: el puño del guante
    r = extruirRecorrido(r.malla, r.caras, mano.slice(0, 1));
    // pulgar: desde la cara lateral de la palma que más mira hacia donde va el pulgar
    const palma = r.malla, lados = [...Array(8).keys()].map((i) => palma.nF - 8 + i);
    const cp = centro(palma, r.caras);
    const lado = lados.reduce((a, b) => (dirCara(palma, b, cp).dot(new THREE.Vector3(...dedoGordo)) > dirCara(palma, a, cp).dot(new THREE.Vector3(...dedoGordo)) ? b : a));
    const base = centro(palma, [lado]);
    const d = new THREE.Vector3(...dedoGordo);
    const recorridoPulgar = [
      [base.x + d.x * 0.02 - s * 0.004, base.y - 0.012, base.z + d.z * 0.02, 0.013, 0.014],
      [base.x + d.x * 0.038 - s * 0.008, base.y - 0.03, base.z + d.z * 0.035, 0.011, 0.012],
    ];
    const pul = extruirRecorrido(palma, [lado], recorridoPulgar, 1.25);
    // dedos: el resto de la mano (bloque de cuatro dedos, curvado)
    r = extruirRecorrido(pul.malla, r.caras, mano.slice(1));
    m = r.malla;
    marcar(f0, m.nF, r.caras, 'guante');
  }
  // cuello desde arriba
  const fc = m.nF;
  const rc = extruirRecorrido(m, carasDonde(m, (c, n) => n[1] > 0.9 && Math.abs(c[0]) < TORSO[7][1] * JAULA * 0.55), pose.cuello);
  m = rc.malla;
  marcar(fc + 4, m.nF, rc.caras, 'cuello'); // el primer anillo del cuello sigue siendo mono
  // pintura de la jaula (por cara) y subdivisión: los colores se interpolan con la malla
  m = pintarJaula(m, parte);
  m = subdividir(m, niveles).malla;
  // la suela, plana y en el suelo
  m = moverVertices(m, [...Array(m.nV).keys()].filter((v) => m.pos[v * 3 + 1] < 0.03), ([x, y, z]) => [x, Math.max(0, y - 0.012), z]).malla;
  // 4) franjas y suela, y escultura
  pintarDetalles(m);
  if (detalles) esculpir(m, pose);
  return m;
}

// ---------- modelado ----------

function carasDonde(m, cond) {
  const r = [];
  for (let f = 0; f < m.nF; f++) {
    const vs = m.vertsDeCara(f), c = [0, 1, 2].map((d) => vs.reduce((s, v) => s + m.pos[v * 3 + d], 0) / vs.length);
    const n = m.normalCara(f), l = Math.hypot(...n) || 1;
    if (cond(c, n.map((x) => x / l))) r.push(f);
  }
  return r;
}
const P = (m, v) => new THREE.Vector3(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]);
function centro(m, caras) {
  const vs = [...new Set(caras.flatMap((f) => m.vertsDeCara(f)))];
  return vs.reduce((s, v) => s.add(P(m, v)), new THREE.Vector3()).divideScalar(vs.length);
}
const dirCara = (m, f, c) => centro(m, [f]).sub(c).normalize();

// Extruye la región por el recorrido: en cada punto la gira hacia el hueso y la escala a su sección
// elíptica (radio de lado y de frente, en un marco que sigue al hueso).
function extruirRecorrido(m, region, recorrido, jaula = JAULA) {
  let caras = region, previo = null;
  for (const [x, y, z, rl, rf] of recorrido) {
    const res = extruirCaras(m, caras, 0.001);
    m = res.malla; caras = res.caras;
    const verts = [...new Set(caras.flatMap((f) => m.vertsDeCara(f)))];
    const c = verts.reduce((s, v) => s.add(P(m, v)), new THREE.Vector3()).divideScalar(verts.length);
    const n = caras.reduce((s, f) => s.add(new THREE.Vector3(...m.normalCara(f))), new THREE.Vector3()).normalize();
    const destino = new THREE.Vector3(x, y, z);
    const T = destino.clone().sub(previo || c).normalize();
    const giro = new THREE.Quaternion().setFromUnitVectors(n, T);
    const ref = Math.abs(T.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const N = ref.addScaledVector(T, -ref.dot(T)).normalize(), B = new THREE.Vector3().crossVectors(T, N);
    const off = verts.map((v) => P(m, v).sub(c).applyQuaternion(giro));
    const maxN = Math.max(...off.map((o) => Math.abs(o.dot(N)))) || 1, maxB = Math.max(...off.map((o) => Math.abs(o.dot(B)))) || 1;
    const kN = (rl * jaula) / maxN, kB = (rf * jaula) / maxB;
    const nuevo = new Map(verts.map((v, i) => {
      const o = off[i], q = destino.clone().addScaledVector(N, o.dot(N) * kN).addScaledVector(B, o.dot(B) * kB);
      return [v, [q.x, q.y, q.z]];
    }));
    m = moverVertices(m, verts, (_, v) => nuevo.get(v)).malla;
    previo = destino;
  }
  return { malla: m, caras };
}

// ---------- pintura ----------

// Cada cara de la jaula con el color de su parte (mono por defecto).
function pintarJaula(m, parte) {
  const col = new Array(m.nHE * 3);
  for (let f = 0; f < m.nF; f++) {
    const c = new THREE.Color(COLORES[parte.get(f) || 'traje']);
    for (const h of m.mediasDeCara(f)) { col[h * 3] = c.r; col[h * 3 + 1] = c.g; col[h * 3 + 2] = c.b; }
  }
  const out = m.clone();
  out.heCol = col;
  return out;
}

// Sobre la malla ya subdividida: franja blanca en el costado (piernas y torso) y suela clara.
function pintarDetalles(m) {
  const nv = normalesVertice(m), rojo = new THREE.Color(COLORES.traje), franja = new THREE.Color(COLORES.franja), suela = new THREE.Color(COLORES.suela);
  for (let h = 0; h < m.nHE; h++) {
    const v = m.heV[h], x = m.pos[v * 3], y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2], n = nv[v];
    const c = [m.heCol[h * 3], m.heCol[h * 3 + 1], m.heCol[h * 3 + 2]];
    const esRojo = Math.abs(c[0] - rojo.r) + Math.abs(c[1] - rojo.g) + Math.abs(c[2] - rojo.b) < 0.08;
    let nuevo = null;
    if (esRojo && Math.abs(n.x) > 0.86 && y > 0.2 && y < 1.36 && Math.abs(z) < 0.06 && Math.sign(n.x) === Math.sign(x)) nuevo = franja;
    if (y < 0.016) nuevo = suela;
    if (nuevo) { m.heCol[h * 3] = nuevo.r; m.heCol[h * 3 + 1] = nuevo.g; m.heCol[h * 3 + 2] = nuevo.b; }
  }
}

function normalesVertice(m) {
  const n = Array.from({ length: m.nV }, () => new THREE.Vector3()), t = [0, 0, 0];
  for (let f = 0; f < m.nF; f++) { m.normalCara(f, t); for (const v of m.vertsDeCara(f)) n[v].x += t[0], n[v].y += t[1], n[v].z += t[2]; }
  for (const v of n) v.normalize();
  return n;
}

// ---------- escultura con los pinceles de Studio ----------

function esculpir(m, pose) {
  const PIERNA = pose.pierna, brazos = pose.brazos.map((b) => b[1]);
  const pc = new Pincel({ camara: new THREE.PerspectiveCamera(), lienzo: null, historial: null, escena: null });
  pc.modo = 'esculpir';
  pc.prepararMalla(m);
  const cercano = (pt) => {
    let mejor = -1, d = Infinity;
    for (let v = 0; v < m.nV; v++) { const dd = (m.pos[v * 3] - pt[0]) ** 2 + (m.pos[v * 3 + 1] - pt[1]) ** 2 + (m.pos[v * 3 + 2] - pt[2]) ** 2; if (dd < d) { d = dd; mejor = v; } }
    return mejor;
  };
  // un trazo: muestras cada 0,3 radios por la línea, cada una apoyada en el vértice más cercano
  const trazo = (tipo, pts, { r = 0.03, f = 0.5, restar = false, simetria = false } = {}) => {
    pc.tipo = tipo; pc.fuerza = f; pc.restar = restar;
    for (let i = 0; i < pts.length - 1 || i === 0; i++) {
      const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (r * 0.3)));
      for (let k = 0; k <= n; k++) {
        const t = k / n, pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const v = cercano(pt), c = P(m, v);
        pc.golpe(c, pc.normales[v], r);
        if (simetria) { const w = cercano([-pt[0], pt[1], pt[2]]); pc.golpe(P(m, w), pc.normales[w], r); }
      }
      if (pts.length === 1) break;
    }
    pc.normales = normalesVertice(m);
  };
  // rodilleras
  for (const s of [1, -1]) { const [x, , z] = PIERNA(s)[2]; trazo('inflar', [[x, 0.55, z + 0.07], [x, 0.505, z + 0.07]], { r: 0.05, f: 1 }); trazo('inflar', [[x, 0.53, z + 0.075]], { r: 0.04, f: 1 }); }
  // costuras (pellizcar) por el costado de las piernas, la cintura y los hombros
  for (const s of [1, -1]) {
    trazo('pellizcar', PIERNA(s).map(([x, y, z, rl]) => [x + s * rl, y, z]).slice(1), { r: 0.022, f: 0.9 });
    trazo('pellizcar', [[0.12 * s, 1.46, 0.0], [0.2 * s, 1.43, 0.0]], { r: 0.02, f: 0.4 });
  }
  trazo('pellizcar', [[-0.15, 1.0, 0.1], [0, 1.0, 0.11], [0.15, 1.0, 0.1]], { r: 0.02, f: 0.4 });
  // arrugas (hundir): corvas, ingles, codos, cintura y pliegues de las piernas
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
  for (const s of [1, -1]) {
    const pierna = PIERNA(s);
    for (let i = 0; i < 3; i++) { const y = 0.5 + i * 0.022, [x] = pierna[3]; trazo('inflar', [[x - 0.04, y, -0.04], [x + 0.04, y - 0.01, -0.045]], { r: 0.02, f: 1, restar: true }); }
    for (let i = 0; i < 10; i++) { // pliegues sueltos delante y detrás de la pierna
      const k = 1 + Math.floor(azar() * 4), [x, y, z, rl, rf] = pierna[k], lado = azar() > 0.5 ? 1 : -1, dy = (azar() - 0.5) * 0.06;
      trazo('inflar', [[x - rl * 0.7, y + dy, z + lado * rf], [x + rl * 0.7, y + dy - 0.012, z + lado * rf]], { r: 0.02, f: 1, restar: true });
    }
    trazo('inflar', [[0.04 * s, 0.86, 0.09], [0.13 * s, 0.82, 0.07]], { r: 0.022, f: 1, restar: true }); // ingle
  }
  for (const brazo of brazos) { // codo por dentro
    const [x, y, z] = brazo[3];
    for (let i = 0; i < 2; i++) trazo('inflar', [[x - 0.025, y + 0.02 - i * 0.02, z + 0.04], [x + 0.025, y + 0.01 - i * 0.02, z + 0.04]], { r: 0.018, f: 1, restar: true });
  }
  for (let i = 0; i < 3; i++) trazo('inflar', [[-0.12, 1.06 + i * 0.03, 0.105], [0.12, 1.07 + i * 0.03, 0.11]], { r: 0.018, f: 0.8, restar: true }); // vientre
  // puños del guante y caña de la bota (un poco abultados)
  for (const brazo of brazos) { const [x, y, z] = brazo[brazo.length - 2]; trazo('inflar', [[x, y, z]], { r: 0.05, f: 0.6 }); }
  for (const s of [1, -1]) { const [x, , z] = PIERNA(s)[6]; trazo('inflar', [[x, 0.17, z]], { r: 0.05, f: 0.5 }); }
}
