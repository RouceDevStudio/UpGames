// Uso: node tools/viasCoche.mjs
//
// Corrige las vías del monoplaza escaneado (coche_alto/medio/bajo.glb). El escaneo traía los
// bujes delanteros a ±1,016 m (vía de 2,03 m, demasiado ancha) y los traseros a ±0,78 m (vía de
// 1,56 m, estrecha). En un F1 real el coche mide 2,0 m de ancho por fuera de las ruedas en los
// dos ejes: vía delantera ≈ 1,69 m (neumático de 305 mm) y trasera ≈ 1,60 m (405 mm).
// En unidades del escaneo (que luego el juego escala a la batalla real de 3,6 m) eso son
// bujes a ±0,872 delante y ±0,826 detrás.
//
// Se deforma solo la carrocería, en z y lejos del eje del coche (|z| > 0,30: brazos de
// suspensión, manguetas, frenos y bordes del fondo junto a las ruedas); la deformación se
// desvanece suave a lo largo de x para no tocar pontones, morro ni alerones. Las normales se
// corrigen con la misma escala. Idempotente: guarda en el modelo las vías ya corregidas.

import fs from 'fs';

const DIR = new URL('../modelos/', import.meta.url);
const Z0 = 0.30;
const DEL = { x0: 1.42, x1: 1.52, x2: 2.45, x3: 2.56, de: 1.015875, a: 0.872 };
const TRAS = { x0: -2.2, x1: -2.1, x2: -1.32, x3: -1.2, de: 0.779625, a: 0.826 };

const suave = (t) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const peso = (x, Z) => Math.min(suave((x - Z.x0) / (Z.x1 - Z.x0)), 1 - suave((x - Z.x2) / (Z.x3 - Z.x2)));

/** factor de escala lateral en x (1 = sin cambio) */
function factor(x) {
  for (const Z of [DEL, TRAS]) {
    const w = peso(x, Z);
    if (w > 0) return 1 + w * ((Z.a - Z0) / (Z.de - Z0) - 1);
  }
  return 1;
}

for (const nombre of ['coche_alto.glb', 'coche_medio.glb', 'coche_bajo.glb']) {
  const url = new URL(nombre, DIR);
  const b = fs.readFileSync(url);
  const jl = b.readUInt32LE(12);
  const J = JSON.parse(b.subarray(20, 20 + jl).toString());
  const ex = J.scenes[0].extras?.ruedas;
  if (ex?.viasReales) { console.log(nombre, 'ya corregido'); continue; }
  const binIni = 20 + jl + 8;
  const malla = J.meshes.find(m => m.name === 'cuerpo').primitives[0];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const acc = (i) => { const a = J.accessors[i], bv = J.bufferViews[a.bufferView]; return { a, base: binIni + (bv.byteOffset || 0) + (a.byteOffset || 0), paso: bv.byteStride || 12 }; };
  const P = acc(malla.attributes.POSITION), N = acc(malla.attributes.NORMAL);
  let movidos = 0;
  let zmax = 0, zmin = 0;
  for (let i = 0; i < P.a.count; i++) {
    const o = P.base + i * P.paso, on = N.base + i * N.paso;
    const x = dv.getFloat32(o, true), z = dv.getFloat32(o + 8, true);
    const k = factor(x), az = Math.abs(z);
    if (k !== 1 && az > Z0) {
      dv.setFloat32(o + 8, Math.sign(z) * (Z0 + (az - Z0) * k), true);
      // normal: la escala en z la inclina al revés (n' ∝ (nx, ny, nz / k))
      const nx = dv.getFloat32(on, true), ny = dv.getFloat32(on + 4, true), nz = dv.getFloat32(on + 8, true) / k;
      const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(on, nx / l, true); dv.setFloat32(on + 4, ny / l, true); dv.setFloat32(on + 8, nz / l, true);
      movidos++;
    }
    const zz = dv.getFloat32(o + 8, true); zmax = Math.max(zmax, zz); zmin = Math.min(zmin, zz);
  }
  P.a.max[2] = zmax; P.a.min[2] = zmin;
  Object.assign(ex, { zDel: DEL.a, zTras: TRAS.a, viasReales: true });
  let js = Buffer.from(JSON.stringify(J));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bin = b.subarray(20 + jl);         // cabecera del trozo BIN y sus datos, tal cual
  const cab = Buffer.alloc(20);
  cab.writeUInt32LE(0x46546c67, 0); cab.writeUInt32LE(2, 4); cab.writeUInt32LE(20 + js.length + bin.length, 8);
  cab.writeUInt32LE(js.length, 12); cab.writeUInt32LE(0x4e4f534a, 16);
  fs.writeFileSync(url, Buffer.concat([cab, js, bin]));
  console.log(nombre, movidos, 'vértices movidos; ancho del cuerpo', zmin.toFixed(3), zmax.toFixed(3));
}
