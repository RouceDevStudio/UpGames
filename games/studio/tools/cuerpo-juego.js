// Convierte el cuerpo del piloto de Studio (pose de reposo) al formato de los personajes de
// APEX GP: espacio del personaje (+x delante, +y arriba, +z a su derecha), una malla indexada por
// parte (mono, franja, guante, bota, suela, cuello) y pesos de piel a sus huesos.
import * as THREE from 'three';
import { cuerpoPiloto, POSE_REPOSO, COLORES } from '../js/plantillas/cuerpo.js';
import { aGeometria } from '../js/malla/aGeometria.js';

const PARTES = ['traje', 'franja', 'guante', 'bota', 'suela', 'cuello'];
const HUESOS = ['cadera', 'tronco', 'cuello', 'hI', 'cI', 'mI', 'hD', 'cD', 'mD', 'kI', 'rI', 'tI', 'kD', 'rD', 'tD'];

// Huesos del personaje (en reposo) como segmentos con su grosor, en el espacio del personaje.
// Lado izquierdo (I) en z < 0.
function segmentos() {
  const S = { cadera: [[0, 0.80, 0], [0, 1.0, 0], 0.17], tronco: [[0, 1.0, 0], [0, 1.46, 0], 0.19], cuello: [[0, 1.47, 0], [0, 1.64, 0], 0.07] };
  for (const [l, z] of [['I', -1], ['D', 1]]) {
    S['h' + l] = [[0, 1.46, 0.215 * z], [0, 1.19, 0.246 * z], 0.06];
    S['c' + l] = [[0, 1.19, 0.246 * z], [0, 0.95, 0.244 * z], 0.047];
    S['m' + l] = [[0, 0.95, 0.244 * z], [0.016, 0.79, 0.236 * z], 0.04];
    S['k' + l] = [[0, 0.93, 0.095 * z], [0, 0.49, 0.097 * z], 0.085];
    S['r' + l] = [[0, 0.49, 0.097 * z], [0, 0.11, 0.097 * z], 0.06];
    S['t' + l] = [[-0.04, 0.08, 0.097 * z], [0.17, 0.03, 0.1 * z], 0.05];
  }
  return HUESOS.map((h) => ({ a: new THREE.Vector3(...S[h][0]), b: new THREE.Vector3(...S[h][1]), r: S[h][2] }));
}

function convertir(m) {
  const g = aGeometria(m), nC = g.posiciones.length / 3;
  const pal = PARTES.map((p) => new THREE.Color(COLORES[p]));
  const parteDe = (c) => { let mejor = 0, d = Infinity; pal.forEach((q, i) => { const dd = (q.r - c[0]) ** 2 + (q.g - c[1]) ** 2 + (q.b - c[2]) ** 2; if (dd < d) { d = dd; mejor = i; } }); return mejor; };
  // esquinas → vértices soldados por posición, normal y parte
  const clave = new Map(), pos = [], nor = [], parte = [], remap = new Int32Array(nC);
  const q = (x, k = 1e4) => Math.round(x * k);
  for (let c = 0; c < nC; c++) {
    // de Studio (+z delante, +x izquierda) al personaje (+x delante, +z derecha)
    const x = g.posiciones[c * 3 + 2], y = g.posiciones[c * 3 + 1], z = -g.posiciones[c * 3];
    const nx = g.normales[c * 3 + 2], ny = g.normales[c * 3 + 1], nz = -g.normales[c * 3];
    const p = parteDe([g.colores[c * 3], g.colores[c * 3 + 1], g.colores[c * 3 + 2]]);
    const k = `${q(x)},${q(y)},${q(z)},${q(nx, 50)},${q(ny, 50)},${q(nz, 50)},${p}`;
    let i = clave.get(k);
    if (i === undefined) { i = pos.length / 3; clave.set(k, i); pos.push(x, y, z); nor.push(nx, ny, nz); parte.push(p); }
    remap[c] = i;
  }
  // triángulos agrupados por parte (la de su primera esquina)
  const porParte = PARTES.map(() => []);
  for (let t = 0; t < g.indices.length; t += 3) {
    const a = remap[g.indices[t]], b = remap[g.indices[t + 1]], c = remap[g.indices[t + 2]];
    // giro de ejes (z → x, x → −z) conserva la orientación: no hay que invertir triángulos
    porParte[parte[a]].push(a, b, c);
  }
  // pesos de piel: los dos huesos más cercanos (distancia relativa a su grosor), mezcla suave
  const segs = segmentos(), nV = pos.length / 3, hueso = new Uint8Array(nV * 4), peso = new Uint8Array(nV * 4);
  const P = new THREE.Vector3(), Q = new THREE.Vector3();
  for (let v = 0; v < nV; v++) {
    P.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    const d = segs.map((s, i) => {
      const ab = Q.copy(s.b).sub(s.a), t = Math.max(0, Math.min(1, P.clone().sub(s.a).dot(ab) / ab.lengthSq()));
      return [P.distanceTo(s.a.clone().addScaledVector(ab, t)) / s.r, i];
    }).sort((u, w) => u[0] - w[0]);
    const e1 = Math.exp(-7 * d[0][0]), e2 = Math.exp(-7 * d[1][0]), w1 = e1 / (e1 + e2);
    hueso[v * 4] = d[0][1]; hueso[v * 4 + 1] = d[1][1];
    peso[v * 4] = Math.round(w1 * 255); peso[v * 4 + 1] = 255 - peso[v * 4];
  }
  const b64 = (ta) => { const u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  return {
    vertices: nV,
    pos: b64(new Float32Array(pos)), nor: b64(new Float32Array(nor)), hueso: b64(hueso), peso: b64(peso),
    partes: Object.fromEntries(PARTES.map((p, i) => [p, b64(new Uint32Array(porParte[i]))])),
  };
}

export function generar() {
  const t0 = performance.now();
  const lods = {
    1: convertir(cuerpoPiloto({ niveles: 1, detalles: false, pose: POSE_REPOSO })),
    2: convertir(cuerpoPiloto({ niveles: 2, detalles: true, pose: POSE_REPOSO })),
  };
  return { formato: 'upgames-cuerpo', version: 1, huesos: HUESOS, partes: PARTES, lods, ms: Math.round(performance.now() - t0) };
}

document.getElementById('b').onclick = () => {
  const d = generar();
  const url = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: 'cuerpo-personaje.json' }).click();
  document.getElementById('s').textContent = `Listo en ${d.ms} ms: ${d.lods[1].vertices} y ${d.lods[2].vertices} vértices`;
};
window.generarCuerpo = generar;
