// Fotos → malla 3D, sin Three.js (se prueba con Node en test/studio.test.js).
//
// - Una foto: se recorta el objeto del fondo y su silueta se «infla» como un cojín
//   (relieve), con la misma foto como textura por delante y por detrás.
// - Dos fotos (frente y lado): casco visual. Cada vóxel sobrevive solo si cae dentro
//   de la silueta en las dos vistas; la superficie se saca con «surface nets».
//
// Las imágenes entran como { data: Uint8ClampedArray RGBA, width, height } (ImageData).

// ---------- Silueta ----------

// Color de fondo: mediana de los píxeles del borde de la imagen.
function colorDeFondo(img) {
  const { data, width: w, height: h } = img;
  const r = [], g = [], b = [];
  const tomar = (x, y) => { const i = (y * w + x) * 4; r.push(data[i]); g.push(data[i + 1]); b.push(data[i + 2]); };
  for (let x = 0; x < w; x++) { tomar(x, 0); tomar(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { tomar(0, y); tomar(w - 1, y); }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(r), med(g), med(b)];
}

// Máscara del objeto (1 = objeto). Se rellena el fondo desde los bordes con los píxeles
// parecidos al color de fondo; lo que no se alcanza es el objeto (así los huecos interiores
// del mismo color no se pierden). Se queda con la mancha más grande.
// tolerancia: 0..1 (distancia de color relativa). Píxeles transparentes cuentan como fondo.
export function mascaraDesdeImagen(img, { tolerancia = 0.18 } = {}) {
  const { data, width: w, height: h } = img;
  const fondo = colorDeFondo(img);
  const lim = (tolerancia * 441.7) ** 2; // 441.7 ≈ distancia máxima en RGB
  const esFondo = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const dr = data[i] - fondo[0], dg = data[i + 1] - fondo[1], db = data[i + 2] - fondo[2];
    esFondo[p] = data[i + 3] < 128 || dr * dr + dg * dg + db * db <= lim ? 1 : 0;
  }
  const visto = new Uint8Array(w * h);
  const pila = [];
  const sembrar = (p) => { if (esFondo[p] && !visto[p]) { visto[p] = 1; pila.push(p); } };
  for (let x = 0; x < w; x++) { sembrar(x); sembrar((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { sembrar(y * w); sembrar(y * w + w - 1); }
  while (pila.length) {
    const p = pila.pop(), x = p % w, y = (p / w) | 0;
    if (x > 0) sembrar(p - 1);
    if (x < w - 1) sembrar(p + 1);
    if (y > 0) sembrar(p - w);
    if (y < h - 1) sembrar(p + w);
  }
  const m = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) m[p] = visto[p] ? 0 : 1;
  return manchaMayor(m, w, h);
}

// Máscara para planos/renders (fondo liso oscuro o claro y, a veces, una cuadrícula de suelo):
// 1) lo que se separa del fondo en brillo, 2) fuera las líneas de la cuadrícula (filas o columnas
// casi enteras y finas), 3) se rellenan los huecos de sombra del objeto, pero no los que tienen el
// color del fondo (p. ej. el hueco entre el alerón y la carrocería), 4) la mancha más grande.
export function mascaraDePlano(img, { contraste = 18, grosorLinea = 4 } = {}) {
  const { data, width: w, height: h } = img;
  const lum = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const fondoRGB = colorDeFondo(img), fondo = 0.299 * fondoRGB[0] + 0.587 * fondoRGB[1] + 0.114 * fondoRGB[2];
  const m = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) m[p] = Math.abs(lum[p] - fondo) > contraste ? 1 : 0;
  // líneas de cuadrícula
  const filaLinea = new Uint8Array(h), colLinea = new Uint8Array(w);
  for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) c += m[y * w + x]; filaLinea[y] = c > w * 0.5 ? 1 : 0; }
  for (let x = 0; x < w; x++) { let c = 0; for (let y = 0; y < h; y++) c += m[y * w + x]; colLinea[x] = c > h * 0.5 ? 1 : 0; }
  const quitar = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (!m[p]) continue;
    if (filaLinea[y]) { // ¿fino en vertical?
      let a = y, b = y;
      while (a > 0 && m[(a - 1) * w + x] && y - a <= grosorLinea) a--;
      while (b < h - 1 && m[(b + 1) * w + x] && b - y <= grosorLinea) b++;
      if (b - a + 1 <= grosorLinea) { quitar.push(p); continue; }
    }
    if (colLinea[x]) { // ¿fino en horizontal?
      let a = x, b = x;
      while (a > 0 && m[p - (x - a) - 1] && x - a <= grosorLinea) a--;
      while (b < w - 1 && m[p + (b - x) + 1] && b - x <= grosorLinea) b++;
      if (b - a + 1 <= grosorLinea) quitar.push(p);
    }
  }
  for (const p of quitar) m[p] = 0;
  // huecos: manchas sin objeto que no tocan el borde; se rellenan salvo que sean color de fondo
  const etiqueta = new Int32Array(w * h).fill(-1), pila = [];
  for (let s = 0; s < w * h; s++) {
    if (m[s] || etiqueta[s] >= 0) continue;
    const comp = [], id = s;
    let toca = false, suma = 0;
    etiqueta[s] = id; pila.push(s);
    while (pila.length) {
      const p = pila.pop(), x = p % w, y = (p / w) | 0;
      comp.push(p); suma += lum[p];
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) toca = true;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !m[q] && etiqueta[q] < 0) { etiqueta[q] = id; pila.push(q); }
      }
    }
    if (!toca && Math.abs(suma / comp.length - fondo) > 5) for (const p of comp) m[p] = 1;
  }
  // cierra grietas finas (líneas oscuras de despiece) y se queda con las piezas grandes
  // (las ruedas pueden quedar sueltas de la carrocería)
  return manchasGrandes(abrir(cerrar(m, w, h, 2), w, h, 1), w, h, 0.01);
}

// Cierre (dilatar y erosionar) y apertura (erosionar y dilatar) con un cuadrado de lado 2r+1.
function cerrar(m, w, h, r) { return morfologia(m, w, h, r, [1, 0]); }
function abrir(m, w, h, r) { return morfologia(m, w, h, r, [0, 1]); }
function morfologia(m, w, h, r, pasos) {
  const dilatar = (src, valor) => { // valor 1: dilata; valor 0: erosiona (dilata el fondo)
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { // horizontal
      let c = 0;
      for (let x = -r; x < w; x++) {
        const xe = x + r; if (xe < w && src[y * w + xe] === valor) c++;
        const xs = x - r - 1; if (xs >= 0 && src[y * w + xs] === valor) c--;
        if (x >= 0) tmp[y * w + x] = c > 0 ? valor : 1 - valor;
      }
    }
    for (let x = 0; x < w; x++) { // vertical
      let c = 0;
      for (let y = -r; y < h; y++) {
        const ye = y + r; if (ye < h && tmp[ye * w + x] === valor) c++;
        const ys = y - r - 1; if (ys >= 0 && tmp[ys * w + x] === valor) c--;
        if (y >= 0) out[y * w + x] = c > 0 ? valor : 1 - valor;
      }
    }
    return out;
  };
  return dilatar(dilatar(m, pasos[0]), pasos[1]);
}

// Todas las manchas con al menos `fraccion` del área de la mayor.
function manchasGrandes(m, w, h, fraccion) {
  const etiqueta = new Int32Array(w * h), tam = [0], pila = [];
  let n = 0;
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || etiqueta[s]) continue;
    n++; let t = 0;
    etiqueta[s] = n; pila.push(s);
    while (pila.length) {
      const p = pila.pop(), x = p % w, y = (p / w) | 0; t++;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && m[q] && !etiqueta[q]) { etiqueta[q] = n; pila.push(q); }
      }
    }
    tam.push(t);
  }
  const mayor = Math.max(...tam), r = new Uint8Array(w * h);
  let area = 0;
  for (let p = 0; p < w * h; p++) if (etiqueta[p] && tam[etiqueta[p]] >= mayor * fraccion) { r[p] = 1; area++; }
  return { mascara: r, width: w, height: h, area };
}

// Máscara de la IA: se queda con la mancha más grande y le rellena los agujeros.
export function limpiarMascara({ mascara, width: w, height: h }) {
  const fuera = new Uint8Array(w * h), pila = [];
  const sembrar = (p) => { if (!mascara[p] && !fuera[p]) { fuera[p] = 1; pila.push(p); } };
  for (let x = 0; x < w; x++) { sembrar(x); sembrar((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { sembrar(y * w); sembrar(y * w + w - 1); }
  while (pila.length) {
    const p = pila.pop(), x = p % w;
    if (x > 0) sembrar(p - 1);
    if (x < w - 1) sembrar(p + 1);
    if (p >= w) sembrar(p - w);
    if (p < w * (h - 1)) sembrar(p + w);
  }
  const m = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) m[p] = fuera[p] ? 0 : 1;
  return manchaMayor(m, w, h);
}

function manchaMayor(m, w, h) {
  const etiqueta = new Int32Array(w * h);
  let mejor = 0, mejorTam = 0, n = 0;
  const pila = [];
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || etiqueta[s]) continue;
    n++; let tam = 0;
    etiqueta[s] = n; pila.push(s);
    while (pila.length) {
      const p = pila.pop(), x = p % w, y = (p / w) | 0; tam++;
      const vec = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of vec) if (q >= 0 && m[q] && !etiqueta[q]) { etiqueta[q] = n; pila.push(q); }
    }
    if (tam > mejorTam) { mejorTam = tam; mejor = n; }
  }
  const r = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) r[p] = etiqueta[p] === mejor && mejor ? 1 : 0;
  return { mascara: r, width: w, height: h, area: mejorTam };
}

// Copia de la imagen donde los píxeles de fondo toman el color del objeto más cercano
// (crece `pasos` píxeles). Así la textura no deja un borde del color del fondo.
export function sangrar(img, { mascara }, pasos = 6) {
  const { width: w, height: h } = img;
  const out = new Uint8ClampedArray(img.data);
  let lleno = Uint8Array.from(mascara);
  for (let s = 0; s < pasos; s++) {
    const nuevo = lleno.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x; if (lleno[p]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const q = Y * w + X; if (!lleno[q]) continue;
        r += out[q * 4]; g += out[q * 4 + 1]; b += out[q * 4 + 2]; n++;
      }
      if (n) { out[p * 4] = r / n; out[p * 4 + 1] = g / n; out[p * 4 + 2] = b / n; out[p * 4 + 3] = 255; nuevo[p] = 1; }
    }
    lleno = nuevo;
  }
  return { data: out, width: w, height: h };
}

// Caja del objeto. Las filas y columnas con menos de `minimo` píxeles no cuentan (restos finos
// como una línea suelta no deben estirar la caja, que es la que alinea unas vistas con otras).
export function cajaDeMascara({ mascara, width: w, height: h }, minimo = 3) {
  const filas = new Int32Array(h), cols = new Int32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mascara[y * w + x]) { filas[y]++; cols[x]++; }
  const lim = (v) => Math.min(minimo, Math.max(...v));
  const lf = lim(filas), lc = lim(cols);
  let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
  while (y0 < h && filas[y0] < lf) y0++;
  while (y1 >= 0 && filas[y1] < lf) y1--;
  while (x0 < w && cols[x0] < lc) x0++;
  while (x1 >= 0 && cols[x1] < lc) x1--;
  if (x1 < x0 || y1 < y0 || lf === 0) return null;
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Distancia de cada píxel del objeto al fondo (chaflán 3-4, en píxeles).
export function distanciaAlBorde(m, w, h) {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) d[p] = m[p] ? INF : 0;
  const v = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; if (!d[p]) continue;
    d[p] = Math.min(d[p], v(x - 1, y) + 1, v(x, y - 1) + 1, v(x - 1, y - 1) + 1.414, v(x + 1, y - 1) + 1.414);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const p = y * w + x; if (!d[p]) continue;
    d[p] = Math.min(d[p], v(x + 1, y) + 1, v(x, y + 1) + 1, v(x + 1, y + 1) + 1.414, v(x - 1, y + 1) + 1.414);
  }
  return d;
}

// Reduce la máscara a una rejilla de celdas (como mucho `res` celdas en el lado largo),
// recortada a la caja del objeto con un margen de una celda vacía.
function rejillaDeMascara(mk, res) {
  const caja = cajaDeMascara(mk);
  if (!caja) return null;
  const paso = Math.max(caja.w, caja.h) / res;
  const cw = Math.max(1, Math.round(caja.w / paso)) + 2, ch = Math.max(1, Math.round(caja.h / paso)) + 2;
  const celdas = new Uint8Array(cw * ch);
  for (let j = 1; j < ch - 1; j++) for (let i = 1; i < cw - 1; i++) {
    const px = Math.min(mk.width - 1, Math.floor(caja.x0 + (i - 0.5) * paso));
    const py = Math.min(mk.height - 1, Math.floor(caja.y0 + (j - 0.5) * paso));
    celdas[j * cw + i] = mk.mascara[py * mk.width + px];
  }
  return { celdas, cw, ch, caja, paso };
}

// ---------- Una foto: relieve inflado ----------

// Devuelve { posiciones, uvs, indices } con alto 1 (y de 0 a 1), centrado en x y z.
// grosor: relación entre el espesor máximo y el ancho del objeto (0.05..1).
// profundidad (opcional): { data: 0..1 (1 = cerca), width, height } del tamaño de la máscara, p. ej.
// la de la IA. La cara de delante sigue esa profundidad (mezclada con el inflado según
// pesoProfundidad) y la de atrás es su reflejo.
export function relieveDesdeMascara(mk, { res = 96, grosor = 0.35, profundidad = null, pesoProfundidad = 0.75, suavizado = 4 } = {}) {
  const r = rejillaDeMascara(mk, res);
  if (!r) return null;
  const { celdas, cw, ch, caja, paso } = r;
  // Vértices en las esquinas de las celdas (rejilla (cw+1)×(ch+1)).
  const vw = cw + 1, vh = ch + 1;
  const dentro = (i, j) => i >= 0 && j >= 0 && i < cw && j < ch && celdas[j * cw + i] === 1;
  // Esquina usada si toca alguna celda del objeto; de borde si además toca una vacía.
  const usado = new Uint8Array(vw * vh), interior = new Uint8Array(vw * vh);
  for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
    const n = dentro(i - 1, j - 1) + dentro(i, j - 1) + dentro(i - 1, j) + dentro(i, j);
    usado[j * vw + i] = n > 0 ? 1 : 0;
    interior[j * vw + i] = n === 4 ? 1 : 0;
  }
  // Distancia de las esquinas al borde → altura de inflado (perfil circular). En el borde
  // queda un canto fino (como el grosor de un cartón) que une la cara de delante y la de atrás.
  const dist = distanciaAlBorde(interior, vw, vh);
  let dmax = 0; for (const d of dist) if (d > dmax) dmax = d;
  dmax = Math.max(dmax, 1);
  const anchoCeldas = cw - 2, altoCeldas = ch - 2, escala = 1 / altoCeldas;
  const zMax = grosor * 0.5 * anchoCeldas * escala, canto = Math.max(zMax * 0.08, escala * 0.5);
  const prof = profundidad ? profundidadEnEsquinas(profundidad, usado, vw, vh, caja, paso) : null;
  const pos = [], uv = [], idx = [];
  const frente = new Int32Array(vw * vh).fill(-1), atras = new Int32Array(vw * vh).fill(-1);
  for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
    const k = j * vw + i; if (!usado[k]) continue;
    const t = Math.min(1, dist[k] / dmax);
    let forma = Math.sqrt(1 - (1 - t) * (1 - t));
    if (prof) forma = (1 - pesoProfundidad) * forma + pesoProfundidad * prof[k] * Math.sqrt(t); // el borde sigue cerrando
    const z = canto + (zMax - canto) * forma;
    const x = (i - 1 - anchoCeldas / 2) * escala, y = (altoCeldas - (j - 1)) * escala;
    const u = Math.min(1, Math.max(0, (caja.x0 + (i - 1) * paso) / mk.width));
    const v = Math.min(1, Math.max(0, 1 - (caja.y0 + (j - 1) * paso) / mk.height));
    frente[k] = pos.length / 3; pos.push(x, y, z); uv.push(u, v);
    atras[k] = pos.length / 3; pos.push(x, y, -z); uv.push(u, v);
  }
  // Canto: en el contorno de cada celda, la arista p→q de la cara de delante se une con la de atrás.
  const canto4 = (p, q) => idx.push(frente[q], frente[p], atras[p], frente[q], atras[p], atras[q]);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    if (!dentro(i, j)) continue;
    const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1; // a b arriba, c d abajo (y crece hacia abajo en la imagen)
    idx.push(frente[a], frente[c], frente[b], frente[b], frente[c], frente[d]);
    idx.push(atras[a], atras[b], atras[c], atras[b], atras[d], atras[c]);
    if (!dentro(i, j - 1)) canto4(b, a);
    if (!dentro(i - 1, j)) canto4(a, c);
    if (!dentro(i, j + 1)) canto4(c, d);
    if (!dentro(i + 1, j)) canto4(d, b);
  }
  const posiciones = new Float32Array(pos), indices = new Uint32Array(idx);
  // quita la escalera del contorno y el ruido de la profundidad sin encoger la figura
  taubin(posiciones, indices, suavizado);
  return { posiciones, uvs: new Float32Array(uv), indices };
}

// Profundidad muestreada en las esquinas de la rejilla, suavizada y normalizada a 0..1 dentro
// del objeto (percentiles 3 y 97 para que un píxel suelto no aplaste el resto).
function profundidadEnEsquinas(pr, usado, vw, vh, caja, paso) {
  const n = vw * vh, d = new Float32Array(n);
  for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
    const x = Math.min(pr.width - 1, Math.max(0, Math.round(caja.x0 + (i - 1) * paso)));
    const y = Math.min(pr.height - 1, Math.max(0, Math.round(caja.y0 + (j - 1) * paso)));
    d[j * vw + i] = pr.data[y * pr.width + x];
  }
  // suavizado 3×3 dentro del objeto (quita el ruido de escalera)
  const s = new Float32Array(n);
  for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
    let a = 0, c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const I = i + di, J = j + dj;
      if (I < 0 || J < 0 || I >= vw || J >= vh || !usado[J * vw + I]) continue;
      a += d[J * vw + I]; c++;
    }
    s[j * vw + i] = c ? a / c : d[j * vw + i];
  }
  const vals = [];
  for (let k = 0; k < n; k++) if (usado[k]) vals.push(s[k]);
  vals.sort((p, q) => p - q);
  const lo = vals[Math.floor(vals.length * 0.03)] ?? 0, hi = vals[Math.floor(vals.length * 0.97)] ?? 1, k1 = 1 / (hi - lo || 1);
  for (let k = 0; k < n; k++) s[k] = Math.min(1, Math.max(0, (s[k] - lo) * k1));
  return s;
}

// ---------- Dos fotos: casco visual ----------

// frente: máscara vista desde +z; lado: máscara vista desde +x (la izquierda de la foto es el
// frente del objeto). invertirLado da la vuelta a la foto de lado si se tomó desde el otro lado.
// Devuelve { posiciones, normales, indices, uvFrente, uvLado } con alto 1 y base en y = 0.
export function cascoVisual(mkFrente, mkLado, { res = 56, invertirLado = false, suavizado = 3 } = {}) {
  const cf = cajaDeMascara(mkFrente), cl = cajaDeMascara(mkLado);
  if (!cf || !cl) return null;
  const ancho = cf.w / cf.h, fondo = cl.w / cl.h; // en unidades de alto
  const ny = res, nx = Math.max(2, Math.round(res * ancho)), nz = Math.max(2, Math.round(res * fondo));
  const en = (mk, c, u, v) => {
    const px = Math.min(mk.width - 1, Math.max(0, Math.floor(c.x0 + u * c.w)));
    const py = Math.min(mk.height - 1, Math.max(0, Math.floor(c.y0 + v * c.h)));
    return mk.mascara[py * mk.width + px];
  };
  // Campo con un vóxel vacío de margen a cada lado.
  const X = nx + 2, Y = ny + 2, Z = nz + 2;
  let campo = new Float32Array(X * Y * Z);
  const frenteCol = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) frenteCol[j * nx + i] = en(mkFrente, cf, (i + 0.5) / nx, (j + 0.5) / ny);
  for (let k = 0; k < nz; k++) {
    const ul = (k + 0.5) / nz, u = invertirLado ? 1 - ul : ul;
    for (let j = 0; j < ny; j++) {
      if (!en(mkLado, cl, u, (j + 0.5) / ny)) continue;
      for (let i = 0; i < nx; i++) {
        // j crece hacia abajo en la foto; k crece hacia el frente (+z) que está a la izquierda de la foto de lado
        if (frenteCol[j * nx + i]) campo[(i + 1) + X * ((ny - j) + Y * (nz - k))] = 1;
      }
    }
  }
  campo = desenfocar(campo, X, Y, Z);
  const malla = surfaceNets(campo, X, Y, Z, 0.5);
  if (!malla.indices.length) return null;
  for (let s = 0; s < suavizado; s++) laplaciano(malla.posiciones, malla.indices);
  // De coordenadas de rejilla a mundo: alto 1, base en y = 0, centrado en x y z.
  const p = malla.posiciones, esc = 1 / ny;
  let ymin = Infinity;
  for (let v = 0; v < p.length; v += 3) {
    p[v] = (p[v] - 1 - nx / 2) * esc; p[v + 1] = (p[v + 1] - 1) * esc; p[v + 2] = (p[v + 2] - 1 - nz / 2) * esc;
    if (p[v + 1] < ymin) ymin = p[v + 1];
  }
  for (let v = 1; v < p.length; v += 3) p[v] -= ymin;
  const normales = normalesDeVertice(p, malla.indices);
  // Coordenadas para colorear con cada foto (u, v de la textura dentro de la imagen completa).
  const nv = p.length / 3, uvF = new Float32Array(nv * 2), uvL = new Float32Array(nv * 2);
  for (let v = 0; v < nv; v++) {
    const x = p[v * 3] / ancho + 0.5, y = 1 - p[v * 3 + 1], z = 0.5 - p[v * 3 + 2] / fondo;
    uvF[v * 2] = (cf.x0 + x * cf.w) / mkFrente.width; uvF[v * 2 + 1] = 1 - (cf.y0 + y * cf.h) / mkFrente.height;
    const zl = invertirLado ? 1 - z : z;
    uvL[v * 2] = (cl.x0 + zl * cl.w) / mkLado.width; uvL[v * 2 + 1] = 1 - (cl.y0 + y * cl.h) / mkLado.height;
  }
  return { posiciones: p, normales, indices: malla.indices, uvFrente: uvF, uvLado: uvL };
}

// ---------- Planos: vistas ortográficas (lado, frente, arriba y, si hay, atrás) ----------
//
// Como calcar planos en Blender: cada vista es una proyección sin perspectiva. Un vóxel queda si
// cae dentro de la silueta en todas las vistas. Ejes del resultado: x = ancho, y = alto,
// z = largo con el frente (morro) hacia +z, base en y = 0 y alto 1.
// - lado: visto desde +x, con el frente a la IZQUIERDA de la imagen.
// - frente: visto desde +z.  - atrás (opcional): visto desde −z.
// - arriba: visto desde +y, con el largo en horizontal y el frente a la derecha o a la izquierda:
//   se detecta solo comparando su perfil con el de la vista de lado (ruedas, alerones…).
// ruedas: para vehículos. Las siluetas no pueden redondear una rueda si otras piezas (morro,
// alerón, fondo) tapan sus esquinas en la vista de lado: queda una caja. Con esta opción se buscan
// las ruedas (lo único que toca el suelo), se mide su radio y su ancho y se recortan en cilindro.
export function cascoPlanos(vistas, { res = 256, suavizado = 4, ruedas = false } = {}) {
  const { lado, frente, arriba, atras } = vistas;
  const cl = cajaDeMascara(lado), cf = cajaDeMascara(frente), ca = arriba ? cajaDeMascara(arriba) : null, cb = atras ? cajaDeMascara(atras) : null;
  if (!cl || !cf) return null;
  const largo = cl.w / cl.h, ancho = cf.w / cf.h; // en unidades de alto
  const nz = res, ny = Math.max(8, Math.round(res / largo)), nx = Math.max(8, Math.round(ny * ancho));
  // máscaras remuestreadas a la rejilla: lado[z][y], frente[x][y], arriba[z][x]
  const muestra = (mk, c, u, v) => {
    const px = Math.min(mk.width - 1, Math.max(0, Math.floor(c.x0 + u * c.w)));
    const py = Math.min(mk.height - 1, Math.max(0, Math.floor(c.y0 + v * c.h)));
    return mk.mascara[py * mk.width + px];
  };
  const L = new Uint8Array(nz * ny), F = new Uint8Array(nx * ny), B = new Uint8Array(nx * ny), A = new Uint8Array(nz * nx);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) L[k * ny + j] = muestra(lado, cl, 1 - (k + 0.5) / nz, 1 - (j + 0.5) / ny);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    F[i * ny + j] = muestra(frente, cf, (i + 0.5) / nx, 1 - (j + 0.5) / ny);
    B[i * ny + j] = cb ? muestra(atras, cb, 1 - (i + 0.5) / nx, 1 - (j + 0.5) / ny) : 1;
  }
  let arribaInvertido = false;
  if (ca) {
    // perfil a lo largo: columnas ocupadas en la vista de lado y en la de arriba (normal y al revés)
    const pl = new Float32Array(nz), pa = new Float32Array(nz), pr = new Float32Array(nz);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) pl[k] += L[k * ny + j];
      for (let i = 0; i < nx; i++) {
        pa[k] += muestra(arriba, ca, (k + 0.5) / nz, (i + 0.5) / nx);
        pr[k] += muestra(arriba, ca, 1 - (k + 0.5) / nz, (i + 0.5) / nx);
      }
    }
    arribaInvertido = correlacion(pl, pr) > correlacion(pl, pa);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const u = (k + 0.5) / nz;
      A[k * nx + i] = muestra(arriba, ca, arribaInvertido ? 1 - u : u, (i + 0.5) / nx);
    }
  } else A.fill(1);
  const X = nx + 2, Y = ny + 2, Z = nz + 2;
  let campo = new Float32Array(X * Y * Z);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    if (!L[k * ny + j]) continue;
    for (let i = 0; i < nx; i++) {
      if (F[i * ny + j] && B[i * ny + j] && A[k * nx + i]) campo[(i + 1) + X * ((j + 1) + Y * (k + 1))] = 1;
    }
  }
  const ruedasHalladas = ruedas ? redondearRuedas(campo, X, Y, lado, cl, A, nx, ny, nz) : [];
  campo = desenfocar(campo, X, Y, Z);
  const malla = surfaceNets(campo, X, Y, Z, 0.5);
  if (!malla.indices.length) return null;
  const p = malla.posiciones, esc = 1 / ny;
  for (let v = 0; v < p.length; v += 3) {
    p[v] = (p[v] - 1 - nx / 2) * esc; p[v + 1] = (p[v + 1] - 1) * esc; p[v + 2] = (p[v + 2] - 1 - nz / 2) * esc;
  }
  taubin(p, malla.indices, suavizado);
  let ymin = Infinity;
  for (let v = 1; v < p.length; v += 3) if (p[v] < ymin) ymin = p[v];
  for (let v = 1; v < p.length; v += 3) p[v] -= ymin;
  const normales = normalesDeVertice(p, malla.indices);
  // dónde cae cada vértice en cada imagen (0..1 de la imagen completa, v hacia arriba como las UV)
  const nv = p.length / 3, uv = { lado: new Float32Array(nv * 2), frente: new Float32Array(nv * 2), arriba: new Float32Array(nv * 2), atras: new Float32Array(nv * 2) };
  const anchoM = nx * esc, largoM = nz * esc;
  const poner = (dst, mk, c, v, u, w) => {
    if (!mk) return;
    dst[v * 2] = (c.x0 + u * c.w) / mk.width;
    dst[v * 2 + 1] = 1 - (c.y0 + w * c.h) / mk.height;
  };
  for (let v = 0; v < nv; v++) {
    const x = p[v * 3] / anchoM + 0.5, y = 1 - p[v * 3 + 1], z = p[v * 3 + 2] / largoM + 0.5;
    poner(uv.lado, lado, cl, v, 1 - z, y);
    poner(uv.frente, frente, cf, v, x, y);
    poner(uv.atras, atras, cb, v, 1 - x, y);
    poner(uv.arriba, arriba, ca, v, arribaInvertido ? 1 - z : z, x);
  }
  return { posiciones: p, normales, indices: malla.indices, uv, arribaInvertido, ruedas: ruedasHalladas, medidas: { ancho: anchoM, alto: 1, largo: largoM } };
}

// Busca las ruedas en la vista de lado y las deja cilíndricas en el campo de vóxeles.
// Devuelve [{ z, r, anchoIzq, anchoDer }] en unidades de la rejilla.
function redondearRuedas(campo, X, Y, lado, cl, A, nx, ny, nz) {
  const m = lado.mascara, w = lado.width, y1 = cl.y0 + cl.h - 1;
  // columnas que tocan el suelo (el último 1,5 % del alto)
  const toca = new Uint8Array(w);
  for (let y = Math.floor(y1 - cl.h * 0.015); y <= y1; y++) for (let x = cl.x0; x < cl.x0 + cl.w; x++) if (m[y * w + x]) toca[x] = 1;
  const contactos = [];
  for (let x = cl.x0; x < cl.x0 + cl.w; x++) {
    if (!toca[x]) continue;
    const a = x;
    while (x < cl.x0 + cl.w && toca[x]) x++;
    if (x - a >= cl.w * 0.012) contactos.push((a + x - 1) / 2);
  }
  const halladas = [];
  for (const cx of contactos) {
    const c = Math.round(cx);
    let yb = y1;
    while (yb > cl.y0 && !m[yb * w + c]) yb--;
    // radio por la cuerda: (cuerda/2)² = 2·r·h − h²  →  r = ((cuerda/2)² + h²) / (2h)
    const rs = [], centros = [];
    let antes = 0;
    for (let hh = 0; hh < cl.h * 0.6; hh++) {
      const y = yb - hh;
      if (!m[y * w + c]) break;
      let a = c, b = c;
      while (a > 0 && m[y * w + a - 1]) a--;
      while (b < w - 1 && m[y * w + b + 1]) b++;
      const medio = (b - a + 1) / 2;
      if (antes && medio - antes > Math.max(6, cl.h * 0.05)) break; // se juntó con otra pieza
      antes = medio;
      const h = hh + 0.5;
      if (hh >= 4) { rs.push((medio * medio + h * h) / (2 * h)); centros.push((a + b) / 2); }
    }
    if (rs.length < 4) continue;
    const mitad = rs.slice(Math.floor(rs.length / 2)).sort((p, q) => p - q);
    const rPx = mitad[Math.floor(mitad.length / 2)];
    if (rPx < cl.h * 0.12 || rPx > cl.h * 0.7) continue; // no parece una rueda
    const zc = (1 - (centros.reduce((s2, v) => s2 + v, 0) / centros.length - cl.x0) / cl.w) * nz; // frente a la izquierda
    const rz = (rPx / cl.w) * nz, ry = (rPx / cl.h) * ny;
    // ancho del neumático: primer tramo lleno desde cada borde en la vista de arriba
    const anchos = [[], []];
    for (let k = Math.max(0, Math.floor(zc - rz * 0.8)); k <= Math.min(nz - 1, Math.ceil(zc + rz * 0.8)); k++) {
      let i = 0; while (i < nx && !A[k * nx + i]) i++;
      const i0 = i; while (i < nx && A[k * nx + i]) i++;
      if (i0 < nx) anchos[0].push([i0, i]);
      i = nx - 1; while (i >= 0 && !A[k * nx + i]) i--;
      const i1 = i; while (i >= 0 && A[k * nx + i]) i--;
      if (i1 >= 0) anchos[1].push([i + 1, i1 + 1]);
    }
    // solo filas donde el neumático sale separado (si un alerón tapa la fila, el tramo es enorme)
    const med = (v) => v.slice().sort((p, q) => p - q)[Math.floor(v.length / 2)];
    const lados = anchos.map((l) => {
      const ok = l.filter(([p, q]) => q - p < nx * 0.3);
      return ok.length >= 3 ? { ancho: med(ok.map(([p, q]) => q - p)), borde: med(l.map(([p, q]) => (l === anchos[0] ? p : q))) } : { ancho: 0, borde: med(l.map(([p, q]) => (l === anchos[0] ? p : q))) };
    });
    // simétrico: el menor de los dos; sin datos, ≈ 0,9 del radio (proporción típica de un neumático)
    const validos = lados.map((x) => x.ancho).filter((x) => x > 0);
    const ancho = validos.length ? Math.min(...validos) : Math.round(ry * 0.9);
    const banda = [
      lados[0].borde !== undefined ? [lados[0].borde, lados[0].borde + ancho] : null,
      lados[1].borde !== undefined ? [lados[1].borde - ancho, lados[1].borde] : null,
    ];
    // recortar en cilindro (eje x) dentro de la banda de cada neumático
    const jc = ry - 0.5;
    for (const bd of banda) {
      if (!bd) continue;
      for (let k = Math.max(0, Math.floor(zc - rz * 1.04)); k <= Math.min(nz - 1, Math.ceil(zc + rz * 1.04)); k++) {
        for (let j = 0; j <= Math.min(ny - 1, Math.ceil(2 * ry * 1.04)); j++) {
          const dz = (k + 0.5 - zc) / rz, dy = (j + 0.5 - jc) / ry;
          if (dz * dz + dy * dy <= 1) continue;
          for (let i = bd[0]; i < bd[1]; i++) campo[(i + 1) + X * ((j + 1) + Y * (k + 1))] = 0;
        }
      }
    }
    halladas.push({ z: +zc.toFixed(1), r: +rz.toFixed(1), bandas: banda });
  }
  return halladas;
}

function correlacion(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; s += da * db; sa += da * da; sb += db * db; }
  return s / Math.sqrt(sa * sb || 1);
}

function desenfocar(c, X, Y, Z) {
  const r = new Float32Array(c.length);
  for (let k = 1; k < Z - 1; k++) for (let j = 1; j < Y - 1; j++) for (let i = 1; i < X - 1; i++) {
    let s = 0;
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const peso = (di ? 1 : 2) * (dj ? 1 : 2) * (dk ? 1 : 2); // núcleo 1-2-1 separable (suma 64)
      s += peso * c[(i + di) + X * ((j + dj) + Y * (k + dk))];
    }
    r[i + X * (j + Y * k)] = s / 64;
  }
  return r;
}

// Surface nets: un vértice por celda cortada por la superficie (media de los cortes en sus
// aristas) y un cuadrilátero por cada arista de la rejilla que cruza la superficie.
// Las caras miran hacia fuera (donde el campo es menor que iso).
export function surfaceNets(campo, X, Y, Z, iso = 0.5) {
  const at = (i, j, k) => campo[i + X * (j + Y * k)];
  const CX = X - 1, CY = Y - 1;
  const vert = new Int32Array(CX * CY * (Z - 1)).fill(-1);
  const pos = [];
  const esq = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
  const aristas = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const val = new Float32Array(8);
  for (let k = 0; k < Z - 1; k++) for (let j = 0; j < Y - 1; j++) for (let i = 0; i < X - 1; i++) {
    let dentro = 0;
    for (let e = 0; e < 8; e++) { val[e] = at(i + esq[e][0], j + esq[e][1], k + esq[e][2]); if (val[e] > iso) dentro++; }
    if (dentro === 0 || dentro === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of aristas) {
      if ((val[a] > iso) === (val[b] > iso)) continue;
      const t = (iso - val[a]) / (val[b] - val[a]);
      sx += esq[a][0] + t * (esq[b][0] - esq[a][0]);
      sy += esq[a][1] + t * (esq[b][1] - esq[a][1]);
      sz += esq[a][2] + t * (esq[b][2] - esq[a][2]);
      n++;
    }
    vert[i + CX * (j + CY * k)] = pos.length / 3;
    pos.push(i + sx / n, j + sy / n, k + sz / n);
  }
  const c = (i, j, k) => vert[i + CX * (j + CY * k)];
  const idx = [];
  const quad = (a, b, cc, d, hacia) => {
    if (hacia) idx.push(a, b, cc, a, cc, d); else idx.push(a, cc, b, a, d, cc);
  };
  for (let k = 1; k < Z - 1; k++) for (let j = 1; j < Y - 1; j++) for (let i = 0; i < X - 1; i++) {
    const a = at(i, j, k) > iso, b = at(i + 1, j, k) > iso; if (a === b) continue;
    quad(c(i, j - 1, k - 1), c(i, j, k - 1), c(i, j, k), c(i, j - 1, k), a);
  }
  for (let k = 1; k < Z - 1; k++) for (let j = 0; j < Y - 1; j++) for (let i = 1; i < X - 1; i++) {
    const a = at(i, j, k) > iso, b = at(i, j + 1, k) > iso; if (a === b) continue;
    quad(c(i - 1, j, k - 1), c(i - 1, j, k), c(i, j, k), c(i, j, k - 1), a);
  }
  for (let k = 0; k < Z - 1; k++) for (let j = 1; j < Y - 1; j++) for (let i = 1; i < X - 1; i++) {
    const a = at(i, j, k) > iso, b = at(i, j, k + 1) > iso; if (a === b) continue;
    quad(c(i - 1, j - 1, k), c(i, j - 1, k), c(i, j, k), c(i - 1, j, k), a);
  }
  return { posiciones: new Float32Array(pos), indices: new Uint32Array(idx) };
}

// Suavizado de Taubin: un paso que encoge (λ) y otro que infla (μ), así el volumen se mantiene.
export function taubin(p, idx, pasadas = 4, lambda = 0.5, mu = -0.53) {
  const n = p.length / 3, vec = vecinos(idx, n), tmp = new Float32Array(p.length);
  const paso = (f) => {
    for (let v = 0; v < n; v++) {
      const a = vec.inicio[v], b = vec.inicio[v + 1];
      if (a === b) { tmp[v * 3] = p[v * 3]; tmp[v * 3 + 1] = p[v * 3 + 1]; tmp[v * 3 + 2] = p[v * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (let k = a; k < b; k++) { const u = vec.lista[k] * 3; x += p[u]; y += p[u + 1]; z += p[u + 2]; }
      const c = 1 / (b - a);
      tmp[v * 3] = p[v * 3] + f * (x * c - p[v * 3]);
      tmp[v * 3 + 1] = p[v * 3 + 1] + f * (y * c - p[v * 3 + 1]);
      tmp[v * 3 + 2] = p[v * 3 + 2] + f * (z * c - p[v * 3 + 2]);
    }
    p.set(tmp);
  };
  for (let i = 0; i < pasadas; i++) { paso(lambda); paso(mu); }
}

// Vecinos de cada vértice (sin repetir), en formato CSR.
function vecinos(idx, n) {
  const sets = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + (e + 1) % 3];
    sets[a].add(b); sets[b].add(a);
  }
  const inicio = new Int32Array(n + 1);
  for (let v = 0; v < n; v++) inicio[v + 1] = inicio[v] + sets[v].size;
  const lista = new Int32Array(inicio[n]);
  for (let v = 0; v < n; v++) { let k = inicio[v]; for (const u of sets[v]) lista[k++] = u; }
  return { inicio, lista };
}

function laplaciano(p, idx) {
  const n = p.length / 3, suma = new Float32Array(p.length), cuenta = new Uint16Array(n);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + (e + 1) % 3];
    for (let d = 0; d < 3; d++) { suma[a * 3 + d] += p[b * 3 + d]; suma[b * 3 + d] += p[a * 3 + d]; }
    cuenta[a]++; cuenta[b]++;
  }
  for (let v = 0; v < n; v++) if (cuenta[v]) for (let d = 0; d < 3; d++) p[v * 3 + d] = 0.5 * p[v * 3 + d] + 0.5 * suma[v * 3 + d] / cuenta[v];
}

export function normalesDeVertice(p, idx) {
  const nr = new Float32Array(p.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nr[v] += nx; nr[v + 1] += ny; nr[v + 2] += nz; }
  }
  for (let v = 0; v < nr.length; v += 3) {
    const l = Math.hypot(nr[v], nr[v + 1], nr[v + 2]) || 1;
    nr[v] /= l; nr[v + 1] /= l; nr[v + 2] /= l;
  }
  return nr;
}

// Volumen con signo (positivo si las caras miran hacia fuera). Útil para las pruebas.
export function volumen(p, idx) {
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}
