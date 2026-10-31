// Operaciones de modelado sobre la malla de media arista (sin Three.js; se prueban con Node).
// Cada operación trabaja sobre polígonos (posiciones + caras + datos por esquina), devuelve una
// malla NUEVA (la original queda intacta para deshacer) y la selección resultante.
import { MallaHE } from './mediaArista.js';

// ---------- de malla a polígonos y vuelta ----------

export function aPoligonos(m) {
  const caras = [], uvs = [], colores = m.heCol ? [] : null;
  for (let f = 0; f < m.nF; f++) {
    const hs = m.mediasDeCara(f);
    caras.push(hs.map((h) => m.heV[h]));
    uvs.push(hs.map((h) => [m.heUV[h * 2], m.heUV[h * 2 + 1]]));
    if (colores) colores.push(hs.map((h) => [m.heCol[h * 3], m.heCol[h * 3 + 1], m.heCol[h * 3 + 2]]));
  }
  return { pos: m.pos.slice(), caras, uvs, colores };
}

// Quita vértices sin usar, esquinas repetidas seguidas y caras de menos de 3 vértices.
export function dePoligonos({ pos, caras, uvs, colores }) {
  const C = [], U = [], K = colores ? [] : null;
  caras.forEach((c, f) => {
    const vs = [], us = [], ks = [];
    c.forEach((v, i) => {
      if (vs.length && vs[vs.length - 1] === v) return;
      vs.push(v); us.push(uvs[f][i]); if (K) ks.push(colores[f][i]);
    });
    while (vs.length > 1 && vs[0] === vs[vs.length - 1]) { vs.pop(); us.pop(); if (K) ks.pop(); }
    if (new Set(vs).size < 3) return;
    C.push(vs); U.push(us); if (K) K.push(ks);
  });
  const nuevo = new Int32Array(pos.length / 3).fill(-1), P = [];
  for (const c of C) for (const v of c) if (nuevo[v] < 0) { nuevo[v] = P.length / 3; P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
  return { malla: MallaHE.desdePoligonos(P, C.map((c) => c.map((v) => nuevo[v])), { uvs: U, colores: K }), remapa: nuevo, indiceCara: C };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const P3 = (pos, v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
function normalPoligono(pos, c) {
  const n = [0, 0, 0];
  for (let i = 0; i < c.length; i++) {
    const a = P3(pos, c[i]), b = P3(pos, c[(i + 1) % c.length]);
    n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}
const media = (lista) => lista.reduce((s, x) => s.map((v, i) => v + x[i]), lista[0].map(() => 0)).map((v) => v / lista.length);
const nuevoVertice = (pos, p) => { pos.push(p[0], p[1], p[2]); return pos.length / 3 - 1; };

// ---------- extruir caras (como región) ----------
// Las caras se separan de su entorno, se desplazan por la normal media de cada vértice y se cosen
// con caras laterales. distancia: cuánto salen. Devuelve { malla, caras } (la región, ya fuera).
export function extruirCaras(m, seleccion, distancia) {
  const P = aPoligonos(m), R = new Set(seleccion);
  if (!R.size) return null;
  // normal media por vértice de la región
  const nv = new Map();
  for (const f of R) {
    const n = norm(normalPoligono(P.pos, P.caras[f]));
    for (const v of P.caras[f]) { const a = nv.get(v) || [0, 0, 0]; nv.set(v, [a[0] + n[0], a[1] + n[1], a[2] + n[2]]); }
  }
  if (distancia === undefined) distancia = largoMedioAristas(P, R) * 0.6;
  const copia = new Map();
  for (const [v, n] of nv) {
    const d = norm(n), p = P3(P.pos, v);
    copia.set(v, nuevoVertice(P.pos, [p[0] + d[0] * distancia, p[1] + d[1] * distancia, p[2] + d[2] * distancia]));
  }
  // aristas de borde de la región: dirigidas u→v de una cara de la región cuya gemela no está en ella
  const dirigida = new Map();
  P.caras.forEach((c, f) => c.forEach((u, i) => dirigida.set(`${u},${c[(i + 1) % c.length]}`, f)));
  const lados = [];
  for (const f of R) {
    const c = P.caras[f];
    c.forEach((u, i) => {
      const v = c[(i + 1) % c.length], g = dirigida.get(`${v},${u}`);
      if (g === undefined || !R.has(g)) lados.push([u, v, P.uvs[f][i], P.uvs[f][(i + 1) % c.length], f, i]);
    });
  }
  for (const f of R) P.caras[f] = P.caras[f].map((v) => copia.get(v));
  for (const [u, v, uu, uv, f, i] of lados) {
    P.caras.push([u, v, copia.get(v), copia.get(u)]);
    P.uvs.push([uu, uv, uv, uu]);
    if (P.colores) { const k = P.colores[f][i]; P.colores.push([k, k, k, k]); }
  }
  const r = dePoligonos(P);
  return { malla: r.malla, caras: [...R] };
}

function largoMedioAristas(P, R) {
  let s = 0, n = 0;
  for (const f of R) {
    const c = P.caras[f];
    c.forEach((u, i) => { const a = P3(P.pos, u), b = P3(P.pos, c[(i + 1) % c.length]); s += Math.hypot(...sub(a, b)); n++; });
  }
  return n ? s / n : 0.1;
}

// ---------- inset (cada cara hacia dentro) ----------
// t: fracción hacia el centro de la cara (0..1). Devuelve las caras interiores seleccionadas.
export function insetCaras(m, seleccion, t = 0.25) {
  const P = aPoligonos(m);
  for (const f of seleccion) {
    const c = P.caras[f], uv = P.uvs[f], cen = media(c.map((v) => P3(P.pos, v))), cuv = media(uv);
    const w = c.map((v) => { const p = P3(P.pos, v); return nuevoVertice(P.pos, [p[0] + (cen[0] - p[0]) * t, p[1] + (cen[1] - p[1]) * t, p[2] + (cen[2] - p[2]) * t]); });
    const wuv = uv.map((u) => [u[0] + (cuv[0] - u[0]) * t, u[1] + (cuv[1] - u[1]) * t]);
    for (let i = 0; i < c.length; i++) {
      const j = (i + 1) % c.length;
      P.caras.push([c[i], c[j], w[j], w[i]]);
      P.uvs.push([uv[i], uv[j], wuv[j], wuv[i]]);
      if (P.colores) P.colores.push([P.colores[f][i], P.colores[f][j], P.colores[f][j], P.colores[f][i]]);
    }
    P.caras[f] = w; P.uvs[f] = wuv;
  }
  return { malla: dePoligonos(P).malla, caras: [...seleccion] };
}

// ---------- corte en bucle ----------
// Parte en dos el anillo de cuadriláteros que cruza la arista e (como Ctrl+R en Blender).
// t: dónde cae el corte en cada arista (0..1). Devuelve las aristas nuevas del bucle.
export function cortarBucle(m, e, t = 0.5) {
  const anillo = anilloDeAristas(m, e);
  const P = aPoligonos(m);
  const clave = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const medio = new Map(); // arista → vértice nuevo
  const enAnillo = new Set(anillo.map((x) => { const [a, b] = m.vertsDeArista(x); return clave(a, b); }));
  // la dirección del corte se fija con la primera arista y se propaga por el anillo
  const punto = (a, b, tt) => { const p = P3(P.pos, a), q = P3(P.pos, b); return [p[0] + (q[0] - p[0]) * tt, p[1] + (q[1] - p[1]) * tt, p[2] + (q[2] - p[2]) * tt]; };
  const orientado = new Map(); // clave → [a, b] en el sentido del corte (t medido desde a)
  {
    const [a0, b0] = m.vertsDeArista(anillo[0]);
    orientado.set(clave(a0, b0), [a0, b0]);
    // en cada cuadrilátero a,b,c,d con ab y cd en el anillo: a↔d y b↔c quedan del mismo lado
    let cambio = true;
    while (cambio) {
      cambio = false;
      for (const c of P.caras) {
        if (c.length !== 4) continue;
        for (let i = 0; i < 4; i++) {
          const a = c[i], b = c[(i + 1) % 4], cc = c[(i + 2) % 4], d = c[(i + 3) % 4];
          const k1 = clave(a, b), k2 = clave(cc, d);
          if (!enAnillo.has(k1) || !enAnillo.has(k2)) continue;
          if (orientado.has(k1) && !orientado.has(k2)) { const [x] = orientado.get(k1); orientado.set(k2, x === a ? [d, cc] : [cc, d]); cambio = true; }
          if (orientado.has(k2) && !orientado.has(k1)) { const [x] = orientado.get(k2); orientado.set(k1, x === d ? [a, b] : [b, a]); cambio = true; }
        }
      }
    }
  }
  for (const k of enAnillo) {
    const [a, b] = orientado.get(k) || k.split(',').map(Number);
    medio.set(k, nuevoVertice(P.pos, punto(a, b, t)));
  }
  const uvEn = (us, i, j, tt) => [us[i][0] + (us[j][0] - us[i][0]) * tt, us[i][1] + (us[j][1] - us[i][1]) * tt];
  const C = [], U = [], K = P.colores ? [] : null;
  P.caras.forEach((c, f) => {
    const us = P.uvs[f], ks = P.colores && P.colores[f];
    if (c.length === 4) {
      for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4], cc = c[(i + 2) % 4], d = c[(i + 3) % 4];
        const k1 = clave(a, b), k2 = clave(cc, d);
        if (!enAnillo.has(k1) || !enAnillo.has(k2)) continue;
        const m1 = medio.get(k1), m2 = medio.get(k2);
        const t1 = orientado.get(k1)[0] === a ? t : 1 - t, t2 = orientado.get(k2)[0] === d ? t : 1 - t;
        const uv1 = uvEn(us, i, (i + 1) % 4, t1), uv2 = uvEn(us, (i + 3) % 4, (i + 2) % 4, t2);
        C.push([a, m1, m2, d], [m1, b, cc, m2]);
        U.push([us[i], uv1, uv2, us[(i + 3) % 4]], [uv1, us[(i + 1) % 4], us[(i + 2) % 4], uv2]);
        if (K) K.push([ks[i], ks[i], ks[(i + 3) % 4], ks[(i + 3) % 4]], [ks[(i + 1) % 4], ks[(i + 1) % 4], ks[(i + 2) % 4], ks[(i + 2) % 4]]);
        return;
      }
    }
    // cara no cruzada: si toca una arista del anillo, se le añade el vértice nuevo (sin agujeros)
    const vs = [], uu = [], kk = [];
    c.forEach((a, i) => {
      vs.push(a); uu.push(us[i]); if (K) kk.push(ks[i]);
      const b = c[(i + 1) % c.length], k = clave(a, b);
      if (enAnillo.has(k)) {
        const tt = orientado.get(k)[0] === a ? t : 1 - t;
        vs.push(medio.get(k)); uu.push(uvEn(us, i, (i + 1) % c.length, tt)); if (K) kk.push(ks[i]);
      }
    });
    C.push(vs); U.push(uu); if (K) K.push(kk);
  });
  const r = dePoligonos({ pos: P.pos, caras: C, uvs: U, colores: K });
  // aristas nuevas: las que unen dos vértices nuevos
  const nuevos = new Set([...medio.values()].map((v) => r.remapa[v]));
  const aristas = [];
  for (let x = 0; x < r.malla.nE; x++) { const [a, b] = r.malla.vertsDeArista(x); if (nuevos.has(a) && nuevos.has(b)) aristas.push(x); }
  return { malla: r.malla, aristas };
}

// Aristas «enfrentadas» a través de cuadriláteros (el anillo que corta un loop cut).
export function anilloDeAristas(m, e) {
  const res = new Set([e]);
  const recorrer = (h) => {
    for (let paso = 0; paso < 1e5; paso++) {
      if (m.mediasDeCara(m.heFace[h]).length !== 4) return;
      const op = m.heNext[m.heNext[h]];
      if (res.has(m.heEdge[op]) && paso > 0) return;
      res.add(m.heEdge[op]);
      const t = m.heTwin[op];
      if (t < 0) return;
      h = t;
    }
  };
  const h = m.eHe[e];
  recorrer(h);
  if (m.heTwin[h] >= 0) recorrer(m.heTwin[h]);
  return [...res];
}

// ---------- borrar, fusionar, suavizar, simetría ----------

export function borrarCaras(m, caras) {
  const P = aPoligonos(m), quitar = new Set(caras);
  const keep = (_, f) => !quitar.has(f);
  return { malla: dePoligonos({ pos: P.pos, caras: P.caras.filter(keep), uvs: P.uvs.filter(keep), colores: P.colores && P.colores.filter(keep) }).malla };
}

// Caras que tocan algún vértice / arista de la selección (para borrar en esos modos).
export function carasDeVertices(m, verts) {
  const s = new Set(verts), r = [];
  for (let f = 0; f < m.nF; f++) if (m.vertsDeCara(f).some((v) => s.has(v))) r.push(f);
  return r;
}
export function carasDeAristas(m, aristas) {
  const r = new Set();
  for (const e of aristas) { const h = m.eHe[e]; r.add(m.heFace[h]); if (m.heTwin[h] >= 0) r.add(m.heFace[m.heTwin[h]]); }
  return [...r];
}

// Junta los vértices en su centro (Alt+M «en el centro»). Devuelve el vértice resultante.
export function fusionarVertices(m, verts) {
  if (verts.length < 2) return null;
  const P = aPoligonos(m), s = new Set(verts), destino = verts[0];
  const c = media(verts.map((v) => P3(P.pos, v)));
  P.pos[destino * 3] = c[0]; P.pos[destino * 3 + 1] = c[1]; P.pos[destino * 3 + 2] = c[2];
  P.caras = P.caras.map((cc) => cc.map((v) => (s.has(v) ? destino : v)));
  const r = dePoligonos(P);
  return { malla: r.malla, vertices: [r.remapa[destino]] };
}

// Suaviza (promedio con los vecinos) los vértices dados. Mantiene la topología.
export function suavizarVertices(m, verts, fuerza = 0.5, pasadas = 2) {
  const out = m.clone(), s = verts.length ? new Set(verts) : null;
  const vec = Array.from({ length: m.nV }, () => new Set());
  for (let x = 0; x < m.nE; x++) { const [a, b] = m.vertsDeArista(x); vec[a].add(b); vec[b].add(a); }
  for (let k = 0; k < pasadas; k++) {
    const p = out.pos.slice();
    for (let v = 0; v < m.nV; v++) {
      if ((s && !s.has(v)) || !vec[v].size) continue;
      const c = [0, 0, 0];
      for (const u of vec[v]) { c[0] += p[u * 3]; c[1] += p[u * 3 + 1]; c[2] += p[u * 3 + 2]; }
      for (let d = 0; d < 3; d++) out.pos[v * 3 + d] = p[v * 3 + d] + fuerza * (c[d] / vec[v].size - p[v * 3 + d]);
    }
  }
  return { malla: out };
}

// Simetría en X: se queda el lado x ≥ 0, lo refleja y cose el centro (lo que en Blender es el
// modificador espejo aplicado). tol: vértices con |x| < tol se pegan al plano x = 0.
export function simetriaX(m, tol = 1e-4) {
  const P = aPoligonos(m);
  for (let v = 0; v < P.pos.length / 3; v++) if (Math.abs(P.pos[v * 3]) < tol) P.pos[v * 3] = 0;
  const lado = (c) => media(c.map((v) => P3(P.pos, v)))[0] >= -tol;
  const caras = [], uvs = [], col = P.colores ? [] : null;
  P.caras.forEach((c, f) => { if (lado(c)) { caras.push(c); uvs.push(P.uvs[f]); if (col) col.push(P.colores[f]); } });
  const espejo = new Map();
  const reflejo = (v) => {
    if (P.pos[v * 3] === 0) return v;
    if (!espejo.has(v)) espejo.set(v, nuevoVertice(P.pos, [-P.pos[v * 3], P.pos[v * 3 + 1], P.pos[v * 3 + 2]]));
    return espejo.get(v);
  };
  const n = caras.length;
  for (let f = 0; f < n; f++) {
    caras.push(caras[f].map(reflejo).reverse());
    uvs.push(uvs[f].slice().reverse());
    if (col) col.push(col[f].slice().reverse());
  }
  return { malla: dePoligonos({ pos: P.pos, caras, uvs, colores: col }).malla };
}

// Mueve vértices (para recetas y pruebas): fn(p) → nueva posición.
export function moverVertices(m, verts, fn) {
  const out = m.clone();
  for (const v of verts) {
    const q = fn([out.pos[v * 3], out.pos[v * 3 + 1], out.pos[v * 3 + 2]], v);
    out.pos[v * 3] = q[0]; out.pos[v * 3 + 1] = q[1]; out.pos[v * 3 + 2] = q[2];
  }
  return { malla: out };
}
