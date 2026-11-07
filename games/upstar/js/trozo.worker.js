// Hilo aparte: calcula la malla de un trozo de planeta (relieve, normales, colores y flora) sin
// frenar el juego. Recibe la cara del cubo y el cuadrado (u0, v0, tam) dentro de ella.
import { crearRelieve, colorSuelo } from './universo.js';
import { azar, hash } from './ruido.js';

const relieves = new Map();
const CARAS = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
/** Punto del cubo → dirección de la esfera (cubo «esferizado»: celdas casi iguales). */
function dir(cara, u, v, out) {
  const [n, a, b] = CARAS[cara], s = u * 2 - 1, t = v * 2 - 1;
  const x = n[0] + a[0] * s + b[0] * t, y = n[1] + a[1] * s + b[1] * t, z = n[2] + a[2] * s + b[2] * t;
  const x2 = x * x, y2 = y * y, z2 = z * z;
  out[0] = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + y2 * z2 / 3);
  out[1] = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + z2 * x2 / 3);
  out[2] = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + x2 * y2 / 3);
  return out;
}

onmessage = (e) => {
  const { id, p, cara, u0, v0, tam, N, flora } = e.data;
  if (!relieves.has(p.semilla)) relieves.set(p.semilla, crearRelieve(p));
  const altura = relieves.get(p.semilla), R = p.radio;
  // rejilla ampliada en un borde (para normales sin costuras entre trozos)
  const M = N + 3, d = new Float64Array(3);
  const P = new Float64Array(M * M * 3), H = new Float64Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    dir(cara, u0 + (i - 1) / N * tam, v0 + (j - 1) / N * tam, d);
    let h = altura(d[0], d[1], d[2]);
    const mar = p.nivelMar * p.amplitud;
    const k = j * M + i; H[k] = h;
    if (p.agua && h < mar - 2) h = mar - 2 - (mar - 2 - h) * 0.25;   // fondo marino suave (lo tapa el agua)
    const r = R + h;
    P[k * 3] = d[0] * r; P[k * 3 + 1] = d[1] * r; P[k * 3 + 2] = d[2] * r;
  }
  // centro del trozo (las posiciones van relativas a él: precisión)
  dir(cara, u0 + tam / 2, v0 + tam / 2, d);
  const hc = altura(d[0], d[1], d[2]), c = [d[0] * (R + hc), d[1] * (R + hc), d[2] * (R + hc)];
  const nV = (N + 1) * (N + 1), nF = 4 * N;            // vértices de la rejilla y del faldón
  const pos = new Float32Array((nV + nF + 4) * 3), nor = new Float32Array((nV + nF + 4) * 3), col = new Float32Array((nV + nF + 4) * 3);
  const tmp = [0, 0, 0];
  let w = 0;
  const pon = (i, j, bajar) => {
    const k = (j + 1) * M + (i + 1);
    // normal por diferencias con los vecinos
    const ax = P[(k + 1) * 3] - P[(k - 1) * 3], ay = P[(k + 1) * 3 + 1] - P[(k - 1) * 3 + 1], az = P[(k + 1) * 3 + 2] - P[(k - 1) * 3 + 2];
    const bx = P[(k + M) * 3] - P[(k - M) * 3], by = P[(k + M) * 3 + 1] - P[(k - M) * 3 + 1], bz = P[(k + M) * 3 + 2] - P[(k - M) * 3 + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const px = P[k * 3], py = P[k * 3 + 1], pz = P[k * 3 + 2], rl = Math.hypot(px, py, pz);
    if (nx * px + ny * py + nz * pz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const pend = 1 - (nx * px + ny * py + nz * pz) / rl;
    const f = bajar ? (rl - tam * R * 0.03) / rl : 1;   // faldón: tapa las grietas entre niveles
    pos[w * 3] = px * f - c[0]; pos[w * 3 + 1] = py * f - c[1]; pos[w * 3 + 2] = pz * f - c[2];
    nor[w * 3] = nx; nor[w * 3 + 1] = ny; nor[w * 3 + 2] = nz;
    colorSuelo(p, H[k], pend * 4, py / rl, tmp);
    col[w * 3] = tmp[0]; col[w * 3 + 1] = tmp[1]; col[w * 3 + 2] = tmp[2];
    w++;
  };
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pon(i, j, false);
  for (let i = 0; i < N; i++) pon(i, 0, true);
  for (let j = 0; j < N; j++) pon(N, j, true);
  for (let i = N; i > 0; i--) pon(i, N, true);
  for (let j = N; j > 0; j--) pon(0, j, true);
  // flora: en los trozos más cercanos, puntos deterministas (misma semilla → mismas plantas)
  let fl = null;
  if (flora) {
    const r = azar(hash(p.semilla, cara, Math.round(u0 * 1e6), Math.round(v0 * 1e6)));
    // (en los desiertos y volcanes hay menos vida y más roca)
    const lista = [];
    const n = Math.floor(flora * (0.5 + r()));
    for (let q = 0; q < n; q++) {
      const uu = r(), vv = r();
      dir(cara, u0 + uu * tam, v0 + vv * tam, d);
      const h = altura(d[0], d[1], d[2]);
      if (p.agua && h < p.nivelMar * p.amplitud + 1) continue;
      const rr = R + h;
      const tipo = r() < 0.45 ? 0 : r() < 0.6 ? 1 : 2;     // 0 cristal · 1 roca · 2 planta
      lista.push(d[0] * rr - c[0], d[1] * rr - c[1], d[2] * rr - c[2], d[0], d[1], d[2], 0.6 + r() * 1.8, r(), tipo);
    }
    fl = new Float32Array(lista);
  }
  postMessage({ id, centro: c, pos, nor, col, fl }, [pos.buffer, nor.buffer, col.buffer, ...(fl ? [fl.buffer] : [])]);
};
