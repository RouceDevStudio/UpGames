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

export function cajaDeMascara({ mascara, width: w, height: h }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mascara[y * w + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
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
export function relieveDesdeMascara(mk, { res = 96, grosor = 0.35, profundidad = null, pesoProfundidad = 0.75 } = {}) {
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
  return { posiciones: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(idx) };
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
