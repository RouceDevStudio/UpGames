// Subdivisión Catmull-Clark: cada cara de n lados se convierte en n cuadriláteros y la superficie
// se suaviza (como el modificador «Subdivision Surface» de Blender, aplicado). Los bordes abiertos
// usan las reglas de borde (curva B-spline). Las UV y colores se interpolan sin suavizar.
import { aPoligonos, dePoligonos } from './operaciones.js';

export function subdividir(m, niveles = 1) {
  let malla = m;
  for (let n = 0; n < niveles; n++) malla = unNivel(malla);
  return { malla };
}

function unNivel(m) {
  const { pos, caras, uvs, colores } = aPoligonos(m);
  const nV = pos.length / 3;
  const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const suma = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const esc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const clave = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  // puntos de cara
  const pc = caras.map((c) => esc(c.reduce((s, v) => suma(s, P(v)), [0, 0, 0]), 1 / c.length));
  // aristas: caras vecinas
  const aristas = new Map();
  caras.forEach((c, f) => c.forEach((a, i) => {
    const b = c[(i + 1) % c.length], k = clave(a, b);
    if (!aristas.has(k)) aristas.set(k, { a, b, caras: [] });
    aristas.get(k).caras.push(f);
  }));
  // puntos de arista
  const out = [];
  const nuevo = (p) => { out.push(p[0], p[1], p[2]); return out.length / 3 - 1; };
  // primero los vértices originales (se recolocan después) para conservar su numeración
  for (let v = 0; v < nV; v++) out.push(0, 0, 0);
  const idCara = pc.map((p) => nuevo(p));
  const idArista = new Map();
  for (const [k, e] of aristas) {
    const medio = esc(suma(P(e.a), P(e.b)), 0.5);
    const p = e.caras.length === 2 ? esc(suma(suma(P(e.a), P(e.b)), suma(pc[e.caras[0]], pc[e.caras[1]])), 0.25) : medio;
    idArista.set(k, nuevo(p));
  }
  // vértices originales: interior (F + 2R + (n−3)P)/n ; borde (B1 + B2 + 6P)/8
  const carasDe = Array.from({ length: nV }, () => []), aristasDe = Array.from({ length: nV }, () => []);
  caras.forEach((c, f) => c.forEach((v) => carasDe[v].push(f)));
  for (const e of aristas.values()) { aristasDe[e.a].push(e); aristasDe[e.b].push(e); }
  for (let v = 0; v < nV; v++) {
    const es = aristasDe[v];
    if (!es.length) continue;
    const borde = es.filter((e) => e.caras.length !== 2);
    let p;
    if (borde.length >= 2) {
      const otros = borde.slice(0, 2).map((e) => P(e.a === v ? e.b : e.a));
      p = esc(suma(suma(otros[0], otros[1]), esc(P(v), 6)), 1 / 8);
    } else {
      const n = es.length;
      const F = esc(carasDe[v].reduce((s, f) => suma(s, pc[f]), [0, 0, 0]), 1 / carasDe[v].length);
      const R = esc(es.reduce((s, e) => suma(s, esc(suma(P(e.a), P(e.b)), 0.5)), [0, 0, 0]), 1 / n);
      p = esc(suma(suma(F, esc(R, 2)), esc(P(v), n - 3)), 1 / n);
    }
    out[v * 3] = p[0]; out[v * 3 + 1] = p[1]; out[v * 3 + 2] = p[2];
  }
  // caras nuevas: un cuadrilátero por esquina (vértice, punto de arista siguiente, centro, punto de arista anterior)
  const C = [], U = [], K = colores ? [] : null;
  const mezcla = (l) => l[0].map((_, j) => l.reduce((s, x) => s + x[j], 0) / l.length);
  caras.forEach((c, f) => {
    const n = c.length, us = uvs[f], ks = colores && colores[f];
    const uvC = mezcla(us), kC = ks && mezcla(ks);
    for (let i = 0; i < n; i++) {
      const a = c[i], sig = c[(i + 1) % n], ant = c[(i + n - 1) % n];
      C.push([a, idArista.get(clave(a, sig)), idCara[f], idArista.get(clave(ant, a))]);
      U.push([us[i], mezcla([us[i], us[(i + 1) % n]]), uvC, mezcla([us[(i + n - 1) % n], us[i]])]);
      if (K) K.push([ks[i], mezcla([ks[i], ks[(i + 1) % n]]), kC, mezcla([ks[(i + n - 1) % n], ks[i]])]);
    }
  });
  return dePoligonos({ pos: out, caras: C, uvs: U, colores: K }).malla;
}
