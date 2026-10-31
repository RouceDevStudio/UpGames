// Booleanas (CSG) con árboles BSP, al estilo de csg.js de Evan Wallace (MIT), sin Three.js.
// Trabaja con polígonos convexos { v: [[x,y,z], ...], uv: [[u,v], ...] }.
import { MallaHE } from './mediaArista.js';

const EPS = 1e-5;

class Plano {
  constructor(n, w) { this.n = n; this.w = w; }
  static de(a, b, c) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n);
    if (l < 1e-12) return null;
    n = n.map((x) => x / l);
    return new Plano(n, n[0] * a[0] + n[1] * a[1] + n[2] * a[2]);
  }
  invertir() { this.n = this.n.map((x) => -x); this.w = -this.w; }
  clone() { return new Plano(this.n.slice(), this.w); }
  // reparte el polígono en las listas según el lado del plano (cortándolo si cruza)
  partir(p, copDel, copDet, del, det) {
    const COP = 0, DEL = 1, DET = 2, CRUZA = 3;
    let tipo = 0;
    const tipos = p.v.map((v) => {
      const t = this.n[0] * v[0] + this.n[1] * v[1] + this.n[2] * v[2] - this.w;
      const k = t < -EPS ? DET : t > EPS ? DEL : COP;
      tipo |= k;
      return k;
    });
    if (tipo === COP) (this.n[0] * p.plano.n[0] + this.n[1] * p.plano.n[1] + this.n[2] * p.plano.n[2] > 0 ? copDel : copDet).push(p);
    else if (tipo === DEL) del.push(p);
    else if (tipo === DET) det.push(p);
    else {
      const f = [], b = [], fu = [], bu = [];
      for (let i = 0; i < p.v.length; i++) {
        const j = (i + 1) % p.v.length, ti = tipos[i], tj = tipos[j], vi = p.v[i], vj = p.v[j], ui = p.uv[i], uj = p.uv[j];
        if (ti !== DET) { f.push(vi); fu.push(ui); }
        if (ti !== DEL) { b.push(vi); bu.push(ui); }
        if ((ti | tj) === CRUZA) {
          const d = [vj[0] - vi[0], vj[1] - vi[1], vj[2] - vi[2]];
          const t = (this.w - (this.n[0] * vi[0] + this.n[1] * vi[1] + this.n[2] * vi[2])) / (this.n[0] * d[0] + this.n[1] * d[1] + this.n[2] * d[2]);
          const v = [vi[0] + d[0] * t, vi[1] + d[1] * t, vi[2] + d[2] * t], u = [ui[0] + (uj[0] - ui[0]) * t, ui[1] + (uj[1] - ui[1]) * t];
          f.push(v); b.push(v); fu.push(u); bu.push(u);
        }
      }
      if (f.length >= 3) del.push(poligono(f, fu, p.plano));
      if (b.length >= 3) det.push(poligono(b, bu, p.plano));
    }
  }
}

function poligono(v, uv, plano) { return { v, uv, plano: plano || Plano.de(v[0], v[1], v[2]) }; }
const invertirP = (p) => { p.v.reverse(); p.uv.reverse(); p.plano = p.plano.clone(); p.plano.invertir(); };

class Nodo {
  constructor(pols) { this.plano = null; this.del = null; this.det = null; this.pols = []; if (pols) this.construir(pols); }
  invertir() {
    for (const p of this.pols) invertirP(p);
    this.plano.invertir();
    if (this.del) this.del.invertir();
    if (this.det) this.det.invertir();
    [this.del, this.det] = [this.det, this.del];
  }
  recortarPols(pols) {
    if (!this.plano) return pols.slice();
    let del = [], det = [];
    for (const p of pols) this.plano.partir(p, del, det, del, det);
    if (this.del) del = this.del.recortarPols(del);
    det = this.det ? this.det.recortarPols(det) : [];
    return del.concat(det);
  }
  recortarCon(bsp) {
    this.pols = bsp.recortarPols(this.pols);
    if (this.del) this.del.recortarCon(bsp);
    if (this.det) this.det.recortarCon(bsp);
  }
  todos() { return this.pols.concat(this.del ? this.del.todos() : [], this.det ? this.det.todos() : []); }
  construir(pols) {
    // iterativo para no desbordar la pila con mallas grandes
    const pila = [[this, pols]];
    while (pila.length) {
      const [nodo, ps] = pila.pop();
      if (!ps.length) continue;
      if (!nodo.plano) nodo.plano = ps[0].plano.clone();
      const del = [], det = [];
      for (const p of ps) nodo.plano.partir(p, nodo.pols, nodo.pols, del, det);
      if (del.length) { if (!nodo.del) nodo.del = new Nodo(); pila.push([nodo.del, del]); }
      if (det.length) { if (!nodo.det) nodo.det = new Nodo(); pila.push([nodo.det, det]); }
    }
  }
}

const copia = (pols) => pols.map((p) => ({ v: p.v.map((x) => x.slice()), uv: p.uv.map((x) => x.slice()), plano: p.plano.clone() }));

export function union(A, B) {
  const a = new Nodo(copia(A)), b = new Nodo(copia(B));
  a.recortarCon(b); b.recortarCon(a); b.invertir(); b.recortarCon(a); b.invertir();
  a.construir(b.todos());
  return a.todos();
}
export function resta(A, B) {
  const a = new Nodo(copia(A)), b = new Nodo(copia(B));
  a.invertir(); a.recortarCon(b); b.recortarCon(a); b.invertir(); b.recortarCon(a); b.invertir();
  a.construir(b.todos()); a.invertir();
  return a.todos();
}
export function interseccion(A, B) {
  const a = new Nodo(copia(A)), b = new Nodo(copia(B));
  a.invertir(); b.recortarCon(a); b.invertir(); a.recortarCon(b); b.recortarCon(a);
  a.construir(b.todos()); a.invertir();
  return a.todos();
}

// Malla de media arista → polígonos (se trocean en triángulos si no son planos y convexos).
export function poligonosDeMalla(m, transformar = null) {
  const out = [];
  for (let f = 0; f < m.nF; f++) {
    const hs = m.mediasDeCara(f);
    const v = hs.map((h) => { const i = m.heV[h] * 3, p = [m.pos[i], m.pos[i + 1], m.pos[i + 2]]; return transformar ? transformar(p) : p; });
    const uv = hs.map((h) => [m.heUV[h * 2], m.heUV[h * 2 + 1]]);
    for (let i = 1; i < v.length - 1; i++) {
      const pl = Plano.de(v[0], v[i], v[i + 1]);
      if (pl) out.push({ v: [v[0], v[i], v[i + 1]], uv: [uv[0], uv[i], uv[i + 1]], plano: pl });
    }
  }
  return out;
}

// Polígonos → malla de media arista (soldando vértices en la misma posición).
export function mallaDePoligonos(pols) {
  const clave = new Map(), pos = [], caras = [], uvs = [];
  const q = (x) => Math.round(x * 1e5);
  for (const p of pols) {
    const c = p.v.map((v) => {
      const k = `${q(v[0])},${q(v[1])},${q(v[2])}`;
      let i = clave.get(k);
      if (i === undefined) { i = pos.length / 3; clave.set(k, i); pos.push(v[0], v[1], v[2]); }
      return i;
    });
    const sinRep = c.filter((x, i) => x !== c[(i + 1) % c.length]);
    if (new Set(sinRep).size < 3) continue;
    caras.push(sinRep);
    uvs.push(p.uv.filter((_, i) => c[i] !== c[(i + 1) % c.length]));
  }
  return MallaHE.desdePoligonos(pos, caras, { uvs });
}
