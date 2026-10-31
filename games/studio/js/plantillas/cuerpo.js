// Cuerpo del piloto por modelado de caja (box modeling), como en Blender: una caja con cortes
// para el torso, se le da forma por anillos, se extruyen piernas, brazos y cuello articulación a
// articulación (cada extrusión se lleva a su sitio, se gira hacia el siguiente hueso y se escala a
// su grosor) y al final se subdivide con Catmull-Clark para que quede una sola pieza orgánica.
// Todo con las operaciones del modo Editar de Studio (malla/operaciones.js y malla/subdividir.js).
import * as THREE from 'three';
import { MallaHE } from '../malla/mediaArista.js';
import { extruirCaras, moverVertices } from '../malla/operaciones.js';
import { subdividir } from '../malla/subdividir.js';

const JAULA = 1.14; // la subdivisión encoge: la jaula se hace algo mayor que la forma final

// Anillos del torso de abajo arriba: [y, semiancho, semifondo, desplazamiento en z]
const TORSO = [
  [0.86, 0.150, 0.110, 0.00],
  [0.95, 0.175, 0.122, 0.00],
  [1.05, 0.155, 0.112, 0.005],
  [1.17, 0.172, 0.122, 0.01],
  [1.29, 0.188, 0.128, 0.01],
  [1.40, 0.192, 0.122, 0.0],
  [1.48, 0.150, 0.100, -0.01],
];

// Recorridos [x, y, z, radio]
const PIERNAS = {
  izq: [[0.105, 0.74, 0.0, 0.088], [0.125, 0.60, 0.01, 0.074], [0.135, 0.50, 0.02, 0.062], [0.148, 0.32, -0.01, 0.06], [0.165, 0.12, -0.03, 0.047]],
  der: [[-0.105, 0.74, 0.0, 0.088], [-0.115, 0.60, 0.02, 0.074], [-0.125, 0.50, 0.035, 0.062], [-0.13, 0.32, 0.0, 0.06], [-0.135, 0.12, -0.01, 0.047]],
};
const BRAZOS = {
  izq: [[0.255, 1.375, -0.015, 0.062], [0.30, 1.29, -0.04, 0.056], [0.345, 1.20, -0.065, 0.05], [0.355, 1.17, -0.07, 0.048], [0.30, 1.08, -0.025, 0.046], [0.24, 1.015, 0.018, 0.037]],
  der: [[-0.25, 1.375, -0.005, 0.062], [-0.245, 1.28, 0.0, 0.056], [-0.25, 1.18, 0.015, 0.05], [-0.252, 1.15, 0.022, 0.048], [-0.262, 1.04, 0.045, 0.045], [-0.27, 0.94, 0.064, 0.037]],
};
const CUELLO = [[0, 1.525, -0.01, 0.072], [0, 1.575, 0.0, 0.064]];

export function cuerpoPiloto({ niveles = 2 } = {}) {
  // 1) caja de 4 × 6 × 2 cortes (ancho × alto × fondo)
  const caja = new THREE.BoxGeometry(1, 1, 1, 4, TORSO.length - 1, 2);
  let m = MallaHE.desdeTriangulos(caja.attributes.position.array, caja.index.array, { uvs: caja.attributes.uv.array });
  // 2) cada anillo a su altura, ancho y fondo
  m = moverVertices(m, [...Array(m.nV).keys()], ([x, y, z]) => {
    const fila = Math.round((y + 0.5) * (TORSO.length - 1));
    const [ty, hw, hd, dz] = TORSO[fila];
    return [x * 2 * hw * JAULA, ty, z * 2 * hd * JAULA + dz];
  }).malla;
  // 3) piernas desde la base (2 × 2 caras de cada lado)
  for (const [lado, s] of [['izq', 1], ['der', -1]]) {
    const base = carasDonde(m, (c, n) => n[1] < -0.9 && c[0] * s > 0);
    m = extruirRecorrido(m, base, PIERNAS[lado]);
  }
  // 4) brazos desde el costado, a la altura de los hombros (las 2 filas de arriba)
  for (const [lado, s] of [['izq', 1], ['der', -1]]) {
    const hombro = carasDonde(m, (c, n) => n[0] * s > 0.6 && c[1] > TORSO[4][0] - 0.01);
    m = extruirRecorrido(m, hombro, BRAZOS[lado]);
  }
  // 5) cuello desde arriba (las 2 × 2 caras del centro)
  const arriba = carasDonde(m, (c, n) => n[1] > 0.9 && Math.abs(c[0]) < TORSO[6][1] * JAULA * 0.55);
  m = extruirRecorrido(m, arriba, CUELLO);
  // 6) subdivisión: una sola pieza suave
  return subdividir(m, niveles).malla;
}

// Caras cuyo centro c y normal n cumplen la condición.
function carasDonde(m, cond) {
  const r = [];
  for (let f = 0; f < m.nF; f++) {
    const vs = m.vertsDeCara(f), c = [0, 1, 2].map((d) => vs.reduce((s, v) => s + m.pos[v * 3 + d], 0) / vs.length);
    const n = m.normalCara(f), l = Math.hypot(...n) || 1;
    if (cond(c, n.map((x) => x / l))) r.push(f);
  }
  return r;
}

// Extruye la región por cada punto del recorrido: la lleva al punto, la gira hacia la dirección del
// hueso y la escala a su radio.
function extruirRecorrido(m, region, recorrido) {
  let caras = region, previo = null;
  for (const [x, y, z, r] of recorrido) {
    const res = extruirCaras(m, caras, 0.001);
    m = res.malla; caras = res.caras;
    const verts = [...new Set(caras.flatMap((f) => m.vertsDeCara(f)))];
    const P = (v) => new THREE.Vector3(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]);
    const c = verts.reduce((s, v) => s.add(P(v)), new THREE.Vector3()).divideScalar(verts.length);
    const n = caras.reduce((s, f) => s.add(new THREE.Vector3(...m.normalCara(f))), new THREE.Vector3()).normalize();
    const destino = new THREE.Vector3(x, y, z);
    const dir = destino.clone().sub(previo || c).normalize();
    const giro = new THREE.Quaternion().setFromUnitVectors(n, dir);
    const dist = verts.map((v) => P(v).distanceTo(c)).sort((a, b) => b - a);
    const rActual = dist.slice(0, 8).reduce((s, d) => s + d, 0) / Math.min(8, dist.length) || 1;
    const k = (r * JAULA * 1.08) / rActual;
    m = moverVertices(m, verts, (p) => {
      const q = new THREE.Vector3(...p).sub(c).applyQuaternion(giro).multiplyScalar(k).add(destino);
      return [q.x, q.y, q.z];
    }).malla;
    previo = destino;
  }
  return m;
}
