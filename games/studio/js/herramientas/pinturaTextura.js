// Pintar sobre textura (mejora 4): el pincel pinta píxeles de una textura (mucho más nítido que
// pintar por vértice), con capas (cada una un lienzo; se componen en la textura del material) y
// calcomanías (una imagen, un texto o un número estampados sobre la superficie donde tocas).
// Necesita UV sin solapes: si el objeto no tiene, se le aplica el UV automático.
import * as THREE from 'three';
import { mallaDe, ponerMalla } from '../edicion.js';
import { uvAutomatico } from '../malla/uv.js';

const LADO = 1024;

export class PinturaTextura {
  constructor({ historial }) {
    this.historial = historial;
    this.obj = null;
    this.herramienta = 'pincel'; // 'pincel' | 'calco'
    this.calco = null;           // { datos: ImageData, ancho, alto }
  }

  // Prepara el objeto: UV automático (si hace falta), capa base con el color actual (y la pintura
  // por vértice horneada) y la textura compuesta en el material.
  activar(obj) {
    this.obj = obj;
    if (obj.userData.capasPintura) { this.componer(); return; }
    if (!obj.userData.uvAuto) {
      ponerMalla(obj, uvAutomatico(mallaDe(obj)).malla);
      obj.userData.uvAuto = true;
    }
    const base = nuevaCapa('Base');
    const g = base.ctx, m = obj.material;
    g.fillStyle = `#${m.color.getHexString()}`; g.fillRect(0, 0, LADO, LADO);
    if (m.map?.image) { try { g.drawImage(m.map.image, 0, 0, LADO, LADO); } catch { /* imagen no dibujable */ } }
    if (obj.geometry.attributes.color && m.vertexColors) this.hornearColores(base);
    obj.userData.capasPintura = [base];
    obj.userData.capaActiva = 0;
    const lienzo = document.createElement('canvas'); lienzo.width = lienzo.height = LADO;
    const tex = new THREE.CanvasTexture(lienzo);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.flipY = true;
    obj.material = obj.material.clone();
    obj.material.map = tex; obj.material.color.setHex(0xffffff); obj.material.vertexColors = false; obj.material.needsUpdate = true;
    obj.userData.lienzoPintura = lienzo;
    this.prepararTriangulos();
    this.componer();
  }

  desactivar() { this.obj = null; this.tris = null; }

  get capas() { return this.obj?.userData.capasPintura || []; }
  get activa() { return this.capas[this.obj.userData.capaActiva] || this.capas[0]; }

  anadirCapa() { const c = nuevaCapa(`Capa ${this.capas.length}`); this.capas.push(c); this.obj.userData.capaActiva = this.capas.length - 1; this.componer(); }
  borrarCapa(i) { if (i === 0 || !this.capas[i]) return; this.capas.splice(i, 1); this.obj.userData.capaActiva = Math.min(this.obj.userData.capaActiva, this.capas.length - 1); this.componer(); }

  componer() {
    const o = this.obj, l = o.userData.lienzoPintura, g = l.getContext('2d');
    g.clearRect(0, 0, LADO, LADO);
    for (const c of this.capas) if (c.visible) { g.globalAlpha = c.opacidad ?? 1; g.drawImage(c.lienzo, 0, 0); }
    g.globalAlpha = 1;
    o.material.map.needsUpdate = true;
  }

  // triángulos (posición local y UV en píxeles) con su esfera envolvente, para buscar rápido
  prepararTriangulos() {
    const g = this.obj.geometry, P = g.attributes.position.array, U = g.attributes.uv.array, I = g.index.array;
    const n = I.length / 3, tris = new Float32Array(n * 15), esf = new Float32Array(n * 4);
    for (let t = 0; t < n; t++) {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) {
        const i = I[t * 3 + k];
        tris.set([P[i * 3], P[i * 3 + 1], P[i * 3 + 2], U[i * 2] * LADO, (1 - U[i * 2 + 1]) * LADO], t * 15 + k * 5);
        cx += P[i * 3] / 3; cy += P[i * 3 + 1] / 3; cz += P[i * 3 + 2] / 3;
      }
      let r = 0;
      for (let k = 0; k < 3; k++) r = Math.max(r, Math.hypot(tris[t * 15 + k * 5] - cx, tris[t * 15 + k * 5 + 1] - cy, tris[t * 15 + k * 5 + 2] - cz));
      esf.set([cx, cy, cz, r], t * 4);
    }
    this.tris = tris; this.esf = esf; this.nTris = n;
  }

  // recorre los píxeles de los triángulos cerca de c (local) y llama a fn(x, y, px, py, pz)
  recorrer(c, alcance, fn) {
    const { tris, esf } = this;
    const caja = [Infinity, Infinity, -Infinity, -Infinity];
    const tocados = [];
    for (let t = 0; t < this.nTris; t++) {
      const d = Math.hypot(esf[t * 4] - c.x, esf[t * 4 + 1] - c.y, esf[t * 4 + 2] - c.z);
      if (d > alcance + esf[t * 4 + 3]) continue;
      tocados.push(t);
      for (let k = 0; k < 3; k++) { const x = tris[t * 15 + k * 5 + 3], y = tris[t * 15 + k * 5 + 4]; caja[0] = Math.min(caja[0], x); caja[1] = Math.min(caja[1], y); caja[2] = Math.max(caja[2], x); caja[3] = Math.max(caja[3], y); }
    }
    if (!tocados.length) return null;
    const x0 = Math.max(0, Math.floor(caja[0]) - 2), y0 = Math.max(0, Math.floor(caja[1]) - 2), x1 = Math.min(LADO, Math.ceil(caja[2]) + 2), y1 = Math.min(LADO, Math.ceil(caja[3]) + 2);
    if (x1 <= x0 || y1 <= y0) return null;
    const ctx = this.activa.ctx, img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), w = x1 - x0;
    for (const t of tocados) {
      const o = t * 15;
      const ax = tris[o + 3], ay = tris[o + 4], bx = tris[o + 8], by = tris[o + 9], cx2 = tris[o + 13], cy2 = tris[o + 14];
      const den = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2);
      if (Math.abs(den) < 1e-9) continue;
      // margen de 1,5 px para que no queden grietas en las costuras de la UV
      const mx = Math.max(Math.hypot(bx - ax, by - ay), Math.hypot(cx2 - bx, cy2 - by), Math.hypot(ax - cx2, ay - cy2)), eps = 1.5 / Math.max(mx, 1);
      const tx0 = Math.max(x0, Math.floor(Math.min(ax, bx, cx2) - 1)), tx1 = Math.min(x1 - 1, Math.ceil(Math.max(ax, bx, cx2) + 1));
      const ty0 = Math.max(y0, Math.floor(Math.min(ay, by, cy2) - 1)), ty1 = Math.min(y1 - 1, Math.ceil(Math.max(ay, by, cy2) + 1));
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
        const qx = x + 0.5, qy = y + 0.5;
        const l1 = ((by - cy2) * (qx - cx2) + (cx2 - bx) * (qy - cy2)) / den, l2 = ((cy2 - ay) * (qx - cx2) + (ax - cx2) * (qy - cy2)) / den, l3 = 1 - l1 - l2;
        if (l1 < -eps || l2 < -eps || l3 < -eps) continue;
        const px = l1 * tris[o] + l2 * tris[o + 5] + l3 * tris[o + 10], py = l1 * tris[o + 1] + l2 * tris[o + 6] + l3 * tris[o + 11], pz = l1 * tris[o + 2] + l2 * tris[o + 7] + l3 * tris[o + 12];
        fn(img.data, ((y - y0) * w + (x - x0)) * 4, px, py, pz);
      }
    }
    ctx.putImageData(img, x0, y0);
    return [x0, y0, x1, y1];
  }

  // un golpe de pincel: color con caída suave
  golpe(c, r, color, fuerza) {
    const R = color.r * 255, G = color.g * 255, B = color.b * 255, k = Math.min(1, fuerza * 0.7);
    return this.recorrer(c, r, (d, i, x, y, z) => {
      const dist = Math.hypot(x - c.x, y - c.y, z - c.z);
      if (dist > r) return;
      const t = 1 - dist / r, a = t * t * (3 - 2 * t) * k;
      d[i] += (R - d[i]) * a; d[i + 1] += (G - d[i + 1]) * a; d[i + 2] += (B - d[i + 2]) * a; d[i + 3] += (255 - d[i + 3]) * a;
    });
  }

  // calcomanía: proyección plana sobre la superficie, centrada en c, mirando por n, con «arriba»
  estampar(c, n, arriba, tam) {
    if (!this.calco) return null;
    const { datos, ancho, alto } = this.calco, asp = ancho / alto;
    const N = n.clone().normalize(), up = arriba.clone().addScaledVector(N, -arriba.dot(N)).normalize(), der = new THREE.Vector3().crossVectors(up, N);
    const hx = tam * (asp >= 1 ? 1 : asp) / 2, hy = tam * (asp >= 1 ? 1 / asp : 1) / 2; // el lado largo mide tam
    return this.recorrer(c, Math.hypot(hx, hy), (d, i, x, y, z) => {
      const q = new THREE.Vector3(x - c.x, y - c.y, z - c.z);
      if (Math.abs(q.dot(N)) > Math.max(hx, hy)) return;           // no atraviesa al otro lado
      const u = q.dot(der) / (2 * hx) + 0.5, v = 0.5 - q.dot(up) / (2 * hy);
      if (u < 0 || u > 1 || v < 0 || v > 1) return;
      const px = Math.min(ancho - 1, Math.floor(u * ancho)), py = Math.min(alto - 1, Math.floor(v * alto)), j = (py * ancho + px) * 4;
      const a = datos.data[j + 3] / 255;
      if (!a) return;
      d[i] += (datos.data[j] - d[i]) * a; d[i + 1] += (datos.data[j + 1] - d[i + 1]) * a; d[i + 2] += (datos.data[j + 2] - d[i + 2]) * a; d[i + 3] = Math.max(d[i + 3], a * 255);
    });
  }

  // pintura por vértice (heCol) → capa base
  hornearColores(capa) {
    const g = this.obj.geometry, C = g.attributes.color.array, U = g.attributes.uv.array, I = g.index.array, ctx = capa.ctx;
    const img = ctx.getImageData(0, 0, LADO, LADO), d = img.data;
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]].map((i) => [U[i * 2] * LADO, (1 - U[i * 2 + 1]) * LADO, C[i * 3], C[i * 3 + 1], C[i * 3 + 2]]);
      const den = (v[1][1] - v[2][1]) * (v[0][0] - v[2][0]) + (v[2][0] - v[1][0]) * (v[0][1] - v[2][1]);
      if (Math.abs(den) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(v[0][0], v[1][0], v[2][0]) - 1)), x1 = Math.min(LADO - 1, Math.ceil(Math.max(v[0][0], v[1][0], v[2][0]) + 1));
      const y0 = Math.max(0, Math.floor(Math.min(v[0][1], v[1][1], v[2][1]) - 1)), y1 = Math.min(LADO - 1, Math.ceil(Math.max(v[0][1], v[1][1], v[2][1]) + 1));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const l1 = ((v[1][1] - v[2][1]) * (x + 0.5 - v[2][0]) + (v[2][0] - v[1][0]) * (y + 0.5 - v[2][1])) / den;
        const l2 = ((v[2][1] - v[0][1]) * (x + 0.5 - v[2][0]) + (v[0][0] - v[2][0]) * (y + 0.5 - v[2][1])) / den, l3 = 1 - l1 - l2;
        if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
        const i = (y * LADO + x) * 4, lin = (k) => l1 * v[0][k] + l2 * v[1][k] + l3 * v[2][k];
        const srgb = (c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
        d[i] = srgb(lin(2)); d[i + 1] = srgb(lin(3)); d[i + 2] = srgb(lin(4)); d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---------- deshacer por trazo (solo la zona tocada) ----------
  empezarTrazo() { this.copia = this.activa.ctx.getImageData(0, 0, LADO, LADO); this.caja = null; this.capaTrazo = this.activa; }
  ampliar(c) { if (!c) return; this.caja = this.caja ? [Math.min(this.caja[0], c[0]), Math.min(this.caja[1], c[1]), Math.max(this.caja[2], c[2]), Math.max(this.caja[3], c[3])] : c; }
  terminarTrazo(nombre) {
    const capa = this.capaTrazo, caja = this.caja, copia = this.copia;
    this.copia = null;
    if (!caja || !copia) return;
    const [x0, y0, x1, y1] = caja, w = x1 - x0, h = y1 - y0;
    const antes = new ImageData(w, h);
    for (let y = 0; y < h; y++) antes.data.set(copia.data.subarray(((y0 + y) * LADO + x0) * 4, ((y0 + y) * LADO + x1) * 4), y * w * 4);
    const despues = capa.ctx.getImageData(x0, y0, w, h), obj = this.obj;
    const poner = (img) => { capa.ctx.putImageData(img, x0, y0); if (this.obj === obj) this.componer(); else componerEn(obj); };
    this.historial.hacer({ nombre, hacer: () => poner(despues), deshacer: () => poner(antes) }, { yaHecho: true });
  }
}

function nuevaCapa(nombre) {
  const lienzo = document.createElement('canvas'); lienzo.width = lienzo.height = LADO;
  return { nombre, lienzo, ctx: lienzo.getContext('2d', { willReadFrequently: true }), visible: true, opacidad: 1 };
}

function componerEn(o) {
  const l = o.userData.lienzoPintura; if (!l) return;
  const g = l.getContext('2d'); g.clearRect(0, 0, LADO, LADO);
  for (const c of o.userData.capasPintura) if (c.visible) { g.globalAlpha = c.opacidad ?? 1; g.drawImage(c.lienzo, 0, 0); }
  g.globalAlpha = 1; o.material.map.needsUpdate = true;
}

// Calcomanía a partir de un texto o número (p. ej. el dorsal o un patrocinador).
export function calcoDeTexto(texto, { color = '#ffffff', fondo = null, borde = '#000000' } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = 'italic 900 160px system-ui, sans-serif';
  const w = Math.ceil(g.measureText(texto).width) + 60;
  c.width = Math.max(64, w); c.height = 220;
  if (fondo) { g.fillStyle = fondo; g.fillRect(0, 0, c.width, c.height); }
  g.font = 'italic 900 160px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 14; g.strokeStyle = borde; g.lineJoin = 'round';
  if (borde) g.strokeText(texto, c.width / 2, c.height / 2 + 8);
  g.fillStyle = color; g.fillText(texto, c.width / 2, c.height / 2 + 8);
  return { datos: g.getImageData(0, 0, c.width, c.height), ancho: c.width, alto: c.height };
}

export async function calcoDeImagen(archivo) {
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, c.width, c.height);
  return { datos: g.getImageData(0, 0, c.width, c.height), ancho: c.width, alto: c.height };
}
