// Uso: node tools/suavizarCoche.mjs
//
// Alisa la superficie del monoplaza escaneado (coche_alto/medio/bajo.glb): el escaneo trae
// ruido (bultos y ondas pequeñas) que con la pintura brillante se veía rugoso y deforme.
//
// - Suavizado de Taubin (paso λ que alisa y paso μ que devuelve el volumen: la pieza no encoge)
//   sobre los vértices soldados por posición, para no abrir las costuras.
// - Bilateral: un vecino cuenta menos cuanto más distinta es su normal, así las aristas vivas
//   (bordes de alerones, cantos de los pontones) se conservan y solo se van los bultos.
// - Los bordes abiertos de la malla no se mueven.
// - Normales nuevas, suaves dentro de cada superficie y separadas en las aristas de más de 50°.
// - El color grabado (que solo decide pintura o carbono) se pasa a gris y se promedia con los
//   vecinos: el escaneo traía sombras horneadas que salían como parches de carbono al azar.
//
// Idempotente: marca el modelo como suavizado.

import fs from 'fs';

const DIR = new URL('../modelos/', import.meta.url);
const PASADAS = { 'coche_alto.glb': 22, 'coche_medio.glb': 12, 'coche_bajo.glb': 5 };
// pasadas de media del color (luminancia): se van las manchas de luz grabadas en el escaneo
const PASADAS_COLOR = { 'coche_alto.glb': 40, 'coche_medio.glb': 18, 'coche_bajo.glb': 8 };
const LAMBDA = 0.5, MU = -0.53, COS_ARISTA = Math.cos(50 * Math.PI / 180);

function trozos(b) {
  const jl = b.readUInt32LE(12);
  return { J: JSON.parse(b.subarray(20, 20 + jl).toString()), jl, binIni: 20 + jl + 8 };
}

for (const [nombre, pasadas] of Object.entries(PASADAS)) {
  const url = new URL(nombre, DIR);
  const b = fs.readFileSync(url);
  const { J, jl, binIni } = trozos(b);
  const ex = (J.scenes[0].extras ||= {});
  if (ex.suavizado) { console.log(nombre, 'ya suavizado'); continue; }
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (const malla of J.meshes) {
    const pr = malla.primitives[0];
    const acc = (i) => { const a = J.accessors[i], bv = J.bufferViews[a.bufferView]; return { a, base: binIni + (bv.byteOffset || 0) + (a.byteOffset || 0), paso: bv.byteStride || (a.type === 'VEC3' ? 12 : 0) }; };
    const P = acc(pr.attributes.POSITION), N = acc(pr.attributes.NORMAL), I = J.accessors[pr.indices];
    const n = P.a.count;
    const pos = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) pos[i * 3 + c] = dv.getFloat32(P.base + i * P.paso + c * 4, true);
    // índices
    const ibv = J.bufferViews[I.bufferView], ibase = binIni + (ibv.byteOffset || 0) + (I.byteOffset || 0);
    const tamI = I.componentType === 5125 ? 4 : 2, idx = new Uint32Array(I.count);
    for (let k = 0; k < I.count; k++) idx[k] = tamI === 4 ? dv.getUint32(ibase + k * 4, true) : dv.getUint16(ibase + k * 2, true);
    // soldar por posición
    const mapa = new Map(), sold = new Uint32Array(n); let ns = 0;
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
      let s = mapa.get(k); if (s === undefined) { s = ns++; mapa.set(k, s); } sold[i] = s;
    }
    const sp = new Float64Array(ns * 3);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) sp[sold[i] * 3 + c] = pos[i * 3 + c];
    const nt = I.count / 3;
    const tri = new Uint32Array(I.count); for (let k = 0; k < I.count; k++) tri[k] = sold[idx[k]];
    // vecinos y aristas de borde
    const vecSet = Array.from({ length: ns }, () => new Set()), aristas = new Map();
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
      const a = tri[t * 3 + e], c = tri[t * 3 + (e + 1) % 3];
      if (a === c) continue;
      vecSet[a].add(c); vecSet[c].add(a);
      const k = a < c ? a * 4294967296 + c : c * 4294967296 + a; aristas.set(k, (aristas.get(k) || 0) + 1);
    }
    const fijo = new Uint8Array(ns);
    for (const [k, v] of aristas) if (v === 1) { fijo[Math.floor(k / 4294967296)] = 1; fijo[k % 4294967296] = 1; }
    const vec = vecSet.map(s => Uint32Array.from(s));
    // normales por vértice soldado (para el peso bilateral)
    const normalesSold = () => {
      const nn = new Float64Array(ns * 3);
      for (let t = 0; t < nt; t++) {
        const a = tri[t * 3], c = tri[t * 3 + 1], d = tri[t * 3 + 2];
        const ux = sp[c * 3] - sp[a * 3], uy = sp[c * 3 + 1] - sp[a * 3 + 1], uz = sp[c * 3 + 2] - sp[a * 3 + 2];
        const vx = sp[d * 3] - sp[a * 3], vy = sp[d * 3 + 1] - sp[a * 3 + 1], vz = sp[d * 3 + 2] - sp[a * 3 + 2];
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        for (const v of [a, c, d]) { nn[v * 3] += fx; nn[v * 3 + 1] += fy; nn[v * 3 + 2] += fz; }
      }
      for (let v = 0; v < ns; v++) { const l = Math.hypot(nn[v * 3], nn[v * 3 + 1], nn[v * 3 + 2]) || 1; nn[v * 3] /= l; nn[v * 3 + 1] /= l; nn[v * 3 + 2] /= l; }
      return nn;
    };
    const tmp = new Float64Array(ns * 3), pesos = [];
    for (let it = 0; it < pasadas * 2; it++) {
      const f = it % 2 === 0 ? LAMBDA : MU;
      const nn = it % 2 === 0 ? normalesSold() : null;
      if (nn) {
        // pesos bilaterales de esta pasada (la de μ usa los mismos)
        pesos.length = 0;
        for (let v = 0; v < ns; v++) {
          const w = new Float64Array(vec[v].length);
          vec[v].forEach((u, j) => { const d = nn[v * 3] * nn[u * 3] + nn[v * 3 + 1] * nn[u * 3 + 1] + nn[v * 3 + 2] * nn[u * 3 + 2]; w[j] = Math.max(0, d) ** 4; });
          pesos.push(w);
        }
      }
      for (let v = 0; v < ns; v++) {
        tmp[v * 3] = sp[v * 3]; tmp[v * 3 + 1] = sp[v * 3 + 1]; tmp[v * 3 + 2] = sp[v * 3 + 2];
        if (fijo[v] || !vec[v].length) continue;
        let sx = 0, sy = 0, sz = 0, sw = 0;
        const w = pesos[v];
        vec[v].forEach((u, j) => { sx += sp[u * 3] * w[j]; sy += sp[u * 3 + 1] * w[j]; sz += sp[u * 3 + 2] * w[j]; sw += w[j]; });
        if (sw < 1e-6) continue;
        tmp[v * 3] += f * (sx / sw - sp[v * 3]); tmp[v * 3 + 1] += f * (sy / sw - sp[v * 3 + 1]); tmp[v * 3 + 2] += f * (sz / sw - sp[v * 3 + 2]);
      }
      sp.set(tmp);
    }
    // normales nuevas: suaves dentro de cada superficie, separadas en las aristas vivas
    const fn = new Float64Array(nt * 3);
    const carasDe = Array.from({ length: ns }, () => []);
    for (let t = 0; t < nt; t++) {
      const a = tri[t * 3], c = tri[t * 3 + 1], d = tri[t * 3 + 2];
      const ux = sp[c * 3] - sp[a * 3], uy = sp[c * 3 + 1] - sp[a * 3 + 1], uz = sp[c * 3 + 2] - sp[a * 3 + 2];
      const vx = sp[d * 3] - sp[a * 3], vy = sp[d * 3 + 1] - sp[a * 3 + 1], vz = sp[d * 3 + 2] - sp[a * 3 + 2];
      fn[t * 3] = uy * vz - uz * vy; fn[t * 3 + 1] = uz * vx - ux * vz; fn[t * 3 + 2] = ux * vy - uy * vx;
      for (const v of [a, c, d]) carasDe[v].push(t);
    }
    const unit = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
    // caras propias de cada vértice (sin soldar): su referencia de orientación
    const propias = Array.from({ length: n }, () => []);
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) propias[idx[t * 3 + e]].push(t);
    for (let i = 0; i < n; i++) {
      let rx = 0, ry = 0, rz = 0;
      for (const t of propias[i]) { rx += fn[t * 3]; ry += fn[t * 3 + 1]; rz += fn[t * 3 + 2]; }
      if (!propias[i].length) { rx = dv.getFloat32(N.base + i * N.paso, true); ry = dv.getFloat32(N.base + i * N.paso + 4, true); rz = dv.getFloat32(N.base + i * N.paso + 8, true); }
      const [ux, uy, uz] = unit(rx, ry, rz);
      let sx = 0, sy = 0, sz = 0;
      for (const t of carasDe[sold[i]]) {
        const [fx, fy, fz] = unit(fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]);
        if (fx * ux + fy * uy + fz * uz < COS_ARISTA) continue;
        sx += fn[t * 3]; sy += fn[t * 3 + 1]; sz += fn[t * 3 + 2];
      }
      const [nx, ny, nz] = sx || sy || sz ? unit(sx, sy, sz) : [ux, uy, uz];
      const s = sold[i];
      for (let c = 0; c < 3; c++) dv.setFloat32(P.base + i * P.paso + c * 4, sp[s * 3 + c], true);
      dv.setFloat32(N.base + i * N.paso, nx, true); dv.setFloat32(N.base + i * N.paso + 4, ny, true); dv.setFloat32(N.base + i * N.paso + 8, nz, true);
    }
    // color: luminancia promediada entre vecinos soldados
    if (pr.attributes.COLOR_0 !== undefined) {
      const C = acc(pr.attributes.COLOR_0), ca = C.a, flo = ca.componentType === 5126, nc = ca.type === 'VEC4' ? 4 : 3;
      const tc = flo ? 4 : 2, pasoC = J.bufferViews[ca.bufferView].byteStride || nc * tc;
      const leer = (i, c) => flo ? dv.getFloat32(C.base + i * pasoC + c * 4, true) : dv.getUint16(C.base + i * pasoC + c * 2, true) / 65535;
      let lum = new Float64Array(ns), cnt = new Float64Array(ns);
      for (let i = 0; i < n; i++) { lum[sold[i]] += 0.299 * leer(i, 0) + 0.587 * leer(i, 1) + 0.114 * leer(i, 2); cnt[sold[i]]++; }
      for (let v = 0; v < ns; v++) lum[v] /= cnt[v] || 1;
      for (let it = 0; it < PASADAS_COLOR[nombre]; it++) {
        const nl = new Float64Array(ns);
        for (let v = 0; v < ns; v++) { let sm = lum[v], k = 1; for (const u of vec[v]) { sm += lum[u]; k++; } nl[v] = sm / k; }
        lum = nl;
      }
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
        const v = lum[sold[i]];
        if (flo) dv.setFloat32(C.base + i * pasoC + c * 4, v, true); else dv.setUint16(C.base + i * pasoC + c * 2, Math.round(Math.min(1, v) * 65535), true);
      }
    }
    // límites del accesor de posición
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { const v = dv.getFloat32(P.base + i * P.paso + c * 4, true); mn[c] = Math.min(mn[c], v); mx[c] = Math.max(mx[c], v); }
    P.a.min = mn; P.a.max = mx;
    console.log(nombre, malla.name, n, 'vértices,', ns, 'soldados,', pasadas, 'pasadas');
  }
  ex.suavizado = true;
  let js = Buffer.from(JSON.stringify(J));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bin = b.subarray(20 + jl);
  const cab = Buffer.alloc(20);
  cab.writeUInt32LE(0x46546c67, 0); cab.writeUInt32LE(2, 4); cab.writeUInt32LE(20 + js.length + bin.length, 8);
  cab.writeUInt32LE(js.length, 12); cab.writeUInt32LE(0x4e4f534a, 16);
  fs.writeFileSync(url, Buffer.concat([cab, js, bin]));
}

