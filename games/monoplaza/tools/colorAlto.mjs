// Uso: node tools/colorAlto.mjs
//
// Las texturas del coche en alta (coche_alto.glb) venían del escaneo con la luz y los cortes
// del atlas horneados, y su mapa de normales no era de espacio tangente (colores al azar por
// parche): el coche del jugador se veía con manchas claras y oscuras («camuflaje»). Este
// script le quita las dos texturas y le pone, vértice a vértice, el color limpio del coche
// medio (coche_medio.glb, el mismo escaneo simplificado): para cada vértice del alto se
// promedian los vecinos más cercanos del medio. La geometría fina del alto se conserva.

import fs from 'fs';

const DIR = new URL('../modelos/', import.meta.url);

function leer(nombre) {
  const b = fs.readFileSync(new URL(nombre, DIR));
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString());
  const binIni = 20 + jl + 8, binLen = b.readUInt32LE(20 + jl);
  return { json, bin: b.subarray(binIni, binIni + binLen) };
}

function vista(g, i) {
  const a = g.json.accessors[i], bv = g.json.bufferViews[a.bufferView];
  const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const paso = bv.byteStride ? bv.byteStride / 4 : ncomp;
  if (a.componentType !== 5126) throw new Error('se esperaba float');
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const buf = g.bin.buffer.slice(g.bin.byteOffset, g.bin.byteOffset + g.bin.byteLength);
  const f = new Float32Array(buf);
  return { count: a.count, get: (k, c) => f[base / 4 + k * paso + c] };
}

const alto = leer('coche_alto.glb'), medio = leer('coche_medio.glb');
if (alto.json.meshes.some(m => m.primitives[0].attributes.COLOR_0 !== undefined)) { console.log('coche_alto.glb ya tiene colores'); process.exit(0); }

// colores por pieza
const extra = [];        // { nombre, datos: Uint16Array }
for (const m of alto.json.meshes) {
  const mm = medio.json.meshes.find(x => x.name === m.name);
  const pM = vista(medio, mm.primitives[0].attributes.POSITION), cM = vista(medio, mm.primitives[0].attributes.COLOR_0);
  const pA = vista(alto, m.primitives[0].attributes.POSITION);
  // rejilla espacial del medio
  const T = 0.03, celdas = new Map(), clave = (x, y, z) => `${Math.floor(x / T)},${Math.floor(y / T)},${Math.floor(z / T)}`;
  for (let k = 0; k < pM.count; k++) {
    const c = clave(pM.get(k, 0), pM.get(k, 1), pM.get(k, 2));
    if (!celdas.has(c)) celdas.set(c, []); celdas.get(c).push(k);
  }
  const out = new Uint16Array(pA.count * 4);
  for (let k = 0; k < pA.count; k++) {
    const x = pA.get(k, 0), y = pA.get(k, 1), z = pA.get(k, 2);
    const cx = Math.floor(x / T), cy = Math.floor(y / T), cz = Math.floor(z / T);
    let mejores = [];
    for (let rad = 1; rad <= 6 && mejores.length < 4; rad++) {
      mejores = [];
      for (let i = -rad; i <= rad; i++) for (let j = -rad; j <= rad; j++) for (let l = -rad; l <= rad; l++) {
        const lista = celdas.get(`${cx + i},${cy + j},${cz + l}`); if (!lista) continue;
        for (const q of lista) { const d = (pM.get(q, 0) - x) ** 2 + (pM.get(q, 1) - y) ** 2 + (pM.get(q, 2) - z) ** 2; mejores.push([d, q]); }
      }
    }
    mejores.sort((a, b) => a[0] - b[0]); mejores = mejores.slice(0, 4);
    // media ponderada por cercanía (suaviza sin borrar los cambios de pieza)
    let r = 0, g = 0, bb = 0, w = 0;
    for (const [d, q] of mejores) { const p = 1 / (Math.sqrt(d) + 0.004); r += cM.get(q, 0) * p; g += cM.get(q, 1) * p; bb += cM.get(q, 2) * p; w += p; }
    if (!w) { r = g = bb = 0.5; w = 1; }
    out[k * 4] = Math.round(Math.min(1, r / w) * 65535); out[k * 4 + 1] = Math.round(Math.min(1, g / w) * 65535);
    out[k * 4 + 2] = Math.round(Math.min(1, bb / w) * 65535); out[k * 4 + 3] = 65535;
  }
  extra.push({ malla: m, datos: out, count: pA.count });
  console.log(m.name, pA.count, 'vértices coloreados');
}

// nuevo binario: todas las vistas menos la imagen de color, más los colores
const J = alto.json;
const quitarBV = new Set((J.images || []).map(im => im.bufferView));
const partes = [], mapaBV = new Map(), nuevasBV = [];
let off = 0;
const pon = (buf) => { const pad = (4 - (off % 4)) % 4; if (pad) { partes.push(Buffer.alloc(pad)); off += pad; } const ini = off; partes.push(buf); off += buf.length; return ini; };
J.bufferViews.forEach((bv, i) => {
  if (quitarBV.has(i)) return;
  const ini = pon(Buffer.from(alto.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)));
  mapaBV.set(i, nuevasBV.length); nuevasBV.push({ ...bv, byteOffset: ini });
});
for (const a of J.accessors) if (a.bufferView !== undefined) a.bufferView = mapaBV.get(a.bufferView);
for (const e of extra) {
  const ini = pon(Buffer.from(e.datos.buffer));
  nuevasBV.push({ buffer: 0, byteOffset: ini, byteLength: e.datos.byteLength, byteStride: 8, target: 34962 });
  J.accessors.push({ bufferView: nuevasBV.length - 1, byteOffset: 0, componentType: 5123, normalized: true, count: e.count, type: 'VEC4' });
  e.malla.primitives[0].attributes.COLOR_0 = J.accessors.length - 1;
}
J.bufferViews = nuevasBV;
delete J.images; delete J.textures; delete J.samplers;
delete J.materials[0].pbrMetallicRoughness.baseColorTexture; delete J.materials[0].normalTexture;
const bin = Buffer.concat(partes);
const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
J.buffers = [{ byteLength: binPad.length }];
let js = Buffer.from(JSON.stringify(J));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const cab = Buffer.alloc(12); cab.writeUInt32LE(0x46546c67, 0); cab.writeUInt32LE(2, 4); cab.writeUInt32LE(12 + 8 + js.length + 8 + binPad.length, 8);
const hJ = Buffer.alloc(8); hJ.writeUInt32LE(js.length, 0); hJ.writeUInt32LE(0x4e4f534a, 4);
const hB = Buffer.alloc(8); hB.writeUInt32LE(binPad.length, 0); hB.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(new URL('coche_alto.glb', DIR), Buffer.concat([cab, hJ, js, hB, binPad]));
console.log('coche_alto.glb guardado:', (12 + 16 + js.length + binPad.length) / 1e6, 'MB');
