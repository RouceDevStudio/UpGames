// Malla de media arista (half-edge), sin Three.js (se prueba con Node en test/studio.test.mjs).
//
// Todo en arreglos planos de enteros para que sea rápido y fácil de copiar:
// - vértices:      pos[v*3..], vHe[v] (una media arista que sale de v)
// - medias aristas: heV (vértice de origen), heNext, hePrev, heTwin (-1 en el borde), heFace, heEdge
//                   y por esquina heUV[h*2..] y, si hay, heCol[h*3..]
// - caras:          fHe[f]
// - aristas:        eHe[e]
// Cada media arista pertenece a una cara (los bordes no tienen media arista propia).

export class MallaHE {
  constructor() {
    this.pos = []; this.vHe = [];
    this.heV = []; this.heNext = []; this.hePrev = []; this.heTwin = []; this.heFace = []; this.heEdge = [];
    this.heUV = []; this.heCol = null;
    this.fHe = []; this.eHe = [];
  }

  get nV() { return this.vHe.length; }
  get nF() { return this.fHe.length; }
  get nE() { return this.eHe.length; }
  get nHE() { return this.heV.length; }

  // pos: [x,y,z,...]; caras: [[v0,v1,v2,...], ...] en sentido antihorario visto desde fuera.
  // uvs/colores (opcionales): por cara, un arreglo por esquina ([[u,v], ...] / [[r,g,b], ...]).
  static desdePoligonos(pos, caras, { uvs = null, colores = null } = {}) {
    const m = new MallaHE();
    m.pos = Array.from(pos);
    m.vHe = new Array(pos.length / 3).fill(-1);
    if (colores) m.heCol = [];
    const abiertas = new Map(); // "a,b" → media arista a→b todavía sin gemela
    caras.forEach((cara, ci) => {
      const f = m.fHe.length, base = m.heV.length, n = cara.length;
      m.fHe.push(base);
      for (let i = 0; i < n; i++) {
        const h = base + i, a = cara[i], b = cara[(i + 1) % n];
        m.heV.push(a);
        m.heNext.push(base + (i + 1) % n);
        m.hePrev.push(base + (i + n - 1) % n);
        m.heFace.push(f);
        m.heTwin.push(-1);
        const uv = uvs ? uvs[ci][i] : [0, 0];
        m.heUV.push(uv[0], uv[1]);
        if (colores) { const c = colores[ci][i]; m.heCol.push(c[0], c[1], c[2]); }
        if (m.vHe[a] < 0) m.vHe[a] = h;
        const gem = abiertas.get(`${b},${a}`);
        if (gem !== undefined) {
          abiertas.delete(`${b},${a}`);
          m.heTwin[h] = gem; m.heTwin[gem] = h;
          m.heEdge.push(m.heEdge[gem]);
        } else {
          m.heEdge.push(m.eHe.length);
          m.eHe.push(h);
          // si la arista ya está abierta en el mismo sentido (no manifold), queda como borde
          if (!abiertas.has(`${a},${b}`)) abiertas.set(`${a},${b}`, h);
        }
      }
    });
    return m;
  }

  // Desde un BufferGeometry ya leído: posiciones (Float32Array), índices (opcional), uv y color
  // (opcionales). Suelda vértices en la misma posición y une parejas de triángulos en cuadriláteros.
  static desdeTriangulos(posiciones, indices = null, { uvs = null, colores = null, cuads = true } = {}) {
    const nIn = posiciones.length / 3;
    const ids = indices ? Array.from(indices) : Array.from({ length: nIn }, (_, i) => i);
    // soldar
    const clave = new Map(), soldado = new Int32Array(nIn), pos = [];
    const q = (x) => Math.round(x * 1e5);
    for (let i = 0; i < nIn; i++) {
      const k = `${q(posiciones[i * 3])},${q(posiciones[i * 3 + 1])},${q(posiciones[i * 3 + 2])}`;
      let v = clave.get(k);
      if (v === undefined) { v = pos.length / 3; clave.set(k, v); pos.push(posiciones[i * 3], posiciones[i * 3 + 1], posiciones[i * 3 + 2]); }
      soldado[i] = v;
    }
    // triángulos sin degenerados: cada uno guarda sus 3 esquinas originales
    const tris = [];
    for (let t = 0; t < ids.length; t += 3) {
      const c = [ids[t], ids[t + 1], ids[t + 2]], v = c.map((i) => soldado[i]);
      if (v[0] !== v[1] && v[1] !== v[2] && v[0] !== v[2]) tris.push(c);
    }
    const P = (i) => [posiciones[i * 3], posiciones[i * 3 + 1], posiciones[i * 3 + 2]];
    const normal = (c) => {
      const [a, b, d] = c.map(P);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...n) || 1;
      return [n[0] / l, n[1] / l, n[2] / l];
    };
    const largo2 = (i, j) => { const a = P(i), b = P(j); return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; };
    // arista más larga de cada triángulo, si es claramente la más larga (posición k → arista c[k]→c[k+1])
    const masLarga = (c) => {
      const l = [largo2(c[0], c[1]), largo2(c[1], c[2]), largo2(c[2], c[0])];
      const k = l.indexOf(Math.max(...l));
      return l.every((x, j) => j === k || l[k] > x * 1.02) ? k : -1;
    };
    const caras = [];
    if (cuads) {
      const porArista = new Map();
      tris.forEach((c, t) => {
        const k = masLarga(c);
        if (k < 0) return;
        const a = soldado[c[k]], b = soldado[c[(k + 1) % 3]];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        (porArista.get(key) || porArista.set(key, []).get(key)).push([t, k]);
      });
      const usado = new Uint8Array(tris.length);
      for (const par of porArista.values()) {
        if (par.length !== 2) continue;
        const [[t, k], [s, j]] = par;
        const nt = normal(tris[t]), ns = normal(tris[s]);
        if (nt[0] * ns[0] + nt[1] * ns[1] + nt[2] * ns[2] < 0.94) continue;
        const ct = tris[t], cs = tris[s];
        // t: a→b→c (a,b la arista compartida), s: b→a→d → cuadrilátero a, d, b, c
        const a = ct[k], b = ct[(k + 1) % 3], c = ct[(k + 2) % 3], d = cs[(j + 2) % 3];
        if (soldado[cs[j]] !== soldado[b]) continue; // sentidos incompatibles
        caras.push([a, d, b, c]);
        usado[t] = usado[s] = 1;
      }
      tris.forEach((c, t) => { if (!usado[t]) caras.push(c); });
    } else caras.push(...tris);
    return MallaHE.desdePoligonos(pos, caras.map((c) => c.map((i) => soldado[i])), {
      uvs: caras.map((c) => c.map((i) => (uvs ? [uvs[i * 2], uvs[i * 2 + 1]] : [0, 0]))),
      colores: colores ? caras.map((c) => c.map((i) => [colores[i * 3], colores[i * 3 + 1], colores[i * 3 + 2]])) : null,
    });
  }

  clone() {
    const m = new MallaHE();
    for (const k of ['pos', 'vHe', 'heV', 'heNext', 'hePrev', 'heTwin', 'heFace', 'heEdge', 'heUV', 'fHe', 'eHe']) m[k] = this[k].slice();
    m.heCol = this.heCol ? this.heCol.slice() : null;
    return m;
  }

  // ---------- consultas ----------

  mediasDeCara(f) {
    const r = [], h0 = this.fHe[f];
    let h = h0;
    do { r.push(h); h = this.heNext[h]; } while (h !== h0 && r.length < 1e5);
    return r;
  }
  vertsDeCara(f) { return this.mediasDeCara(f).map((h) => this.heV[h]); }
  vertsDeArista(e) { const h = this.eHe[e]; return [this.heV[h], this.heV[this.heNext[h]]]; }

  // Normal sin normalizar (Newell): su largo es el doble del área.
  normalCara(f, out = [0, 0, 0]) {
    out[0] = out[1] = out[2] = 0;
    const p = this.pos;
    for (const h of this.mediasDeCara(f)) {
      const a = this.heV[h] * 3, b = this.heV[this.heNext[h]] * 3;
      out[0] += (p[a + 1] - p[b + 1]) * (p[a + 2] + p[b + 2]);
      out[1] += (p[a + 2] - p[b + 2]) * (p[a] + p[b]);
      out[2] += (p[a] - p[b]) * (p[a + 1] + p[b + 1]);
    }
    return out;
  }

  // Bucle de aristas que pasa por e, cruzando vértices con 4 aristas (como Alt+clic en Blender).
  bucle(e) {
    const r = new Set([e]);
    const avanzar = (h) => {
      // h llega a un vértice; la arista «de enfrente» en un vértice de 4 cuadriláteros
      for (let paso = 0; paso < 1e5; paso++) {
        const v = this.heV[this.heNext[h]];
        if (this.valencia(v) !== 4) return;
        const n = this.heNext[h], t = this.heTwin[n];
        if (t < 0) return;
        const sig = this.heNext[t];
        if (r.has(this.heEdge[sig])) return;
        r.add(this.heEdge[sig]);
        h = sig;
      }
    };
    const h = this.eHe[e];
    avanzar(h);
    if (this.heTwin[h] >= 0) avanzar(this.heTwin[h]); // y en el otro sentido
    return [...r];
  }

  // Número de aristas en v, o -1 si v está en un borde.
  valencia(v) {
    const h0 = this.vHe[v];
    if (h0 < 0) return 0;
    let h = h0, n = 0;
    do {
      const t = this.heTwin[this.hePrev[h]];
      if (t < 0) return -1;
      h = t; n++;
    } while (h !== h0 && n < 1e4);
    return n;
  }

  // Comprobación de la estructura (para pruebas). Devuelve la lista de problemas.
  validar() {
    const err = [];
    for (let h = 0; h < this.nHE; h++) {
      if (this.hePrev[this.heNext[h]] !== h) err.push(`next/prev ${h}`);
      const t = this.heTwin[h];
      if (t >= 0) {
        if (this.heTwin[t] !== h) err.push(`twin ${h}`);
        if (this.heV[t] !== this.heV[this.heNext[h]]) err.push(`twin vértice ${h}`);
        if (this.heEdge[t] !== this.heEdge[h]) err.push(`twin arista ${h}`);
      }
      if (this.heFace[this.heNext[h]] !== this.heFace[h]) err.push(`cara ${h}`);
    }
    for (let v = 0; v < this.nV; v++) if (this.vHe[v] >= 0 && this.heV[this.vHe[v]] !== v) err.push(`vHe ${v}`);
    return err;
  }
}
