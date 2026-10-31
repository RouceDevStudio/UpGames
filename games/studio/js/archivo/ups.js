// Formato propio .ups (sprint 6): JSON (comprimido con gzip al guardar) con la malla de media
// arista de cada objeto, su transformación, material, modificadores y estado. Esta parte (malla ↔
// datos) no usa Three.js y se prueba con Node.
import { MallaHE } from '../malla/mediaArista.js';

export const VERSION_UPS = 1;

const redondear = (a, d = 1e5) => Array.from(a, (x) => Math.round(x * d) / d);

export function mallaADatos(m) {
  const cuenta = [], indices = [];
  for (let f = 0; f < m.nF; f++) { const vs = m.vertsDeCara(f); cuenta.push(vs.length); indices.push(...vs); }
  const uv = [], col = m.heCol ? [] : null;
  for (let f = 0; f < m.nF; f++) for (const h of m.mediasDeCara(f)) {
    uv.push(m.heUV[h * 2], m.heUV[h * 2 + 1]);
    if (col) col.push(m.heCol[h * 3], m.heCol[h * 3 + 1], m.heCol[h * 3 + 2]);
  }
  return { pos: redondear(m.pos), cuenta, indices, uv: redondear(uv), col: col && redondear(col, 1e3) };
}

export function datosAMalla(d) {
  const caras = [], uvs = [], colores = d.col ? [] : null;
  let k = 0, c = 0;
  for (const n of d.cuenta) {
    caras.push(d.indices.slice(k, k + n));
    const u = [], cl = [];
    for (let i = 0; i < n; i++) { u.push([d.uv[(c + i) * 2], d.uv[(c + i) * 2 + 1]]); if (colores) cl.push([d.col[(c + i) * 3], d.col[(c + i) * 3 + 1], d.col[(c + i) * 3 + 2]]); }
    uvs.push(u); if (colores) colores.push(cl);
    k += n; c += n;
  }
  return MallaHE.desdePoligonos(d.pos, caras, { uvs, colores });
}

// gzip con CompressionStream (navegadores actuales y Node 18+); sin él, JSON tal cual.
export async function comprimir(texto) {
  if (typeof CompressionStream === 'undefined') return new TextEncoder().encode(texto);
  const s = new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export async function descomprimir(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0x1f && b[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
    const s = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(s).text();
  }
  return new TextDecoder().decode(b);
}
