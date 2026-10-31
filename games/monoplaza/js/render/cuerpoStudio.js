// Cuerpo de los personajes hecho en UpGames Studio (plantilla «Piloto», pose de reposo): una sola
// malla suave con mono, franjas, guantes y botas, con pesos de piel para el esqueleto de Persona.
// Se genera con games/studio/tools/cuerpo-juego.html y se guarda en modelos/cuerpo-personaje.json.
import * as THREE from 'three';

let datos = null;
const cache = new Map();

export async function cargarCuerpo(url = './modelos/cuerpo-personaje.json') {
  if (datos) return true;
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    const d = await r.json();
    if (d.formato !== 'upgames-cuerpo') return false;
    datos = d;
    return true;
  } catch { return false; }
}

export const cuerpoListo = () => !!datos;

const deB64 = (s, Tipo) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Tipo(u.buffer); };

// Geometrías del cuerpo por parte, con skinIndex según el orden de huesos que se pida.
// ordenHuesos: nombres de huesos en el orden del esqueleto de la Persona.
export function geometriasCuerpo(lod, ordenHuesos) {
  const l = datos.lods[lod] || datos.lods[1];
  const clave = lod + '|' + ordenHuesos.join(',');
  if (cache.has(clave)) return cache.get(clave);
  const pos = deB64(l.pos, Float32Array), nor = deB64(l.nor, Float32Array), hueso = deB64(l.hueso, Uint8Array), peso = deB64(l.peso, Uint8Array);
  const n = l.vertices, idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
  const mapa = datos.huesos.map((h) => Math.max(0, ordenHuesos.indexOf(h)));
  for (let i = 0; i < n * 4; i++) { idx[i] = mapa[hueso[i]]; w[i] = peso[i] / 255; }
  // cada parte con solo sus vértices (al fundir con las demás piezas no se repite nada)
  const partes = {};
  for (const [p, b64] of Object.entries(l.partes)) {
    const tri = deB64(b64, Uint32Array);
    if (!tri.length) continue;
    const nuevo = new Int32Array(n).fill(-1), usados = [];
    for (const v of tri) if (nuevo[v] < 0) { nuevo[v] = usados.length; usados.push(v); }
    const m = usados.length, P = new Float32Array(m * 3), N = new Float32Array(m * 3), I = new Uint16Array(m * 4), W = new Float32Array(m * 4);
    usados.forEach((v, i) => {
      P.set(pos.subarray(v * 3, v * 3 + 3), i * 3); N.set(nor.subarray(v * 3, v * 3 + 3), i * 3);
      I.set(idx.subarray(v * 4, v * 4 + 4), i * 4); W.set(w.subarray(v * 4, v * 4 + 4), i * 4);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(m * 2), 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(I, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(W, 4));
    g.setIndex(new THREE.BufferAttribute(m > 65535 ? Uint32Array.from(tri, (v) => nuevo[v]) : Uint16Array.from(tri, (v) => nuevo[v]), 1));
    partes[p] = g;
  }
  cache.set(clave, partes);
  return partes;
}
