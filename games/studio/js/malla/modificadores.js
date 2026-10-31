// Modificadores no destructivos (sprint 4): la malla base no cambia; lo que se dibuja y se
// exporta es el resultado de aplicar la pila en orden. Cada uno se puede ocultar, quitar o aplicar.
// Sin Three.js (se prueban con Node). Las booleanas reciben los polígonos del otro objeto ya en
// coordenadas locales de este (ctx.poligonosDe(id)).
import { aPoligonos, dePoligonos } from './operaciones.js';
import { subdividir } from './subdividir.js';
import { poligonosDeMalla, mallaDePoligonos, union, resta, interseccion } from './csg.js';

export const TIPOS = {
  espejo: { nombre: 'Espejo', defecto: () => ({ eje: 'x', coser: true }) },
  subdivision: { nombre: 'Subdivisión', defecto: () => ({ niveles: 2 }) },
  matriz: { nombre: 'Matriz', defecto: () => ({ cantidad: 3, x: 1.1, y: 0, z: 0, relativo: true }) },
  solidificar: { nombre: 'Solidificar', defecto: () => ({ grosor: 0.05 }) },
  booleana: { nombre: 'Booleana', defecto: () => ({ operacion: 'resta', objeto: null }) },
};

export function nuevoModificador(tipo) {
  return { tipo, visible: true, ...TIPOS[tipo].defecto() };
}

// Resultado de la pila (o hasta el índice `hasta`, sin incluirlo).
export function evaluar(base, mods = [], ctx = {}, hasta = mods.length) {
  let m = base;
  for (let i = 0; i < hasta; i++) {
    const mod = mods[i];
    if (!mod.visible) continue;
    const r = aplicarUno(m, mod, ctx);
    if (r) m = r;
  }
  return m;
}

export function aplicarUno(m, mod, ctx = {}) {
  switch (mod.tipo) {
    case 'espejo': return espejo(m, mod.eje, mod.coser);
    case 'subdivision': return m.nF * 4 ** mod.niveles > 300000 ? null : subdividir(m, Math.max(0, Math.min(4, mod.niveles | 0))).malla;
    case 'matriz': return matriz(m, mod);
    case 'solidificar': return solidificar(m, mod.grosor);
    case 'booleana': {
      const otro = mod.objeto && ctx.poligonosDe ? ctx.poligonosDe(mod.objeto) : null;
      if (!otro || !otro.length) return null;
      const op = { union, resta, interseccion }[mod.operacion] || resta;
      const r = op(poligonosDeMalla(m), otro);
      return r.length ? mallaDePoligonos(r) : null;
    }
    default: return null;
  }
}

// Espejo en un eje: copia reflejada de todas las caras; los vértices sobre el plano se cosen.
export function espejo(m, eje = 'x', coser = true, tol = 1e-4) {
  const P = aPoligonos(m), k = { x: 0, y: 1, z: 2 }[eje] ?? 0, n = P.pos.length / 3;
  const par = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const c = P.pos[v * 3 + k];
    if (coser && Math.abs(c) < tol) { P.pos[v * 3 + k] = 0; par[v] = v; continue; }
    const p = [P.pos[v * 3], P.pos[v * 3 + 1], P.pos[v * 3 + 2]];
    p[k] = -p[k];
    par[v] = P.pos.length / 3; P.pos.push(...p);
  }
  const nc = P.caras.length;
  for (let f = 0; f < nc; f++) {
    P.caras.push(P.caras[f].map((v) => par[v]).reverse());
    P.uvs.push(P.uvs[f].slice().reverse());
    if (P.colores) P.colores.push(P.colores[f].slice().reverse());
  }
  return dePoligonos(P).malla;
}

// Matriz: `cantidad` copias desplazadas (relativo = en múltiplos del tamaño del objeto).
export function matriz(m, { cantidad = 3, x = 1.1, y = 0, z = 0, relativo = true }) {
  const P = aPoligonos(m), n = P.pos.length / 3, nc = P.caras.length;
  let d = [x, y, z];
  if (relativo) {
    const tam = [0, 1, 2].map((k) => { let a = Infinity, b = -Infinity; for (let v = 0; v < n; v++) { a = Math.min(a, P.pos[v * 3 + k]); b = Math.max(b, P.pos[v * 3 + k]); } return b - a; });
    d = d.map((v, k) => v * tam[k]);
  }
  for (let c = 1; c < Math.max(1, cantidad | 0); c++) {
    const base = P.pos.length / 3;
    for (let v = 0; v < n; v++) P.pos.push(P.pos[v * 3] + d[0] * c, P.pos[v * 3 + 1] + d[1] * c, P.pos[v * 3 + 2] + d[2] * c);
    for (let f = 0; f < nc; f++) {
      P.caras.push(P.caras[f].map((v) => v + base)); P.uvs.push(P.uvs[f].slice());
      if (P.colores) P.colores.push(P.colores[f].slice());
    }
  }
  return dePoligonos(P).malla;
}

// Solidificar: una segunda capa desplazada por las normales hacia dentro y, en los bordes abiertos,
// caras que cierran el canto (para dar grosor a planos, carrocerías finas, alerones…).
export function solidificar(m, grosor = 0.05) {
  const P = aPoligonos(m), n = P.pos.length / 3, nc = P.caras.length;
  const nr = new Float64Array(n * 3);
  for (const c of P.caras) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < c.length; i++) {
      const a = c[i] * 3, b = c[(i + 1) % c.length] * 3;
      nx += (P.pos[a + 1] - P.pos[b + 1]) * (P.pos[a + 2] + P.pos[b + 2]);
      ny += (P.pos[a + 2] - P.pos[b + 2]) * (P.pos[a] + P.pos[b]);
      nz += (P.pos[a] - P.pos[b]) * (P.pos[a + 1] + P.pos[b + 1]);
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const v of c) { nr[v * 3] += nx / l; nr[v * 3 + 1] += ny / l; nr[v * 3 + 2] += nz / l; }
  }
  for (let v = 0; v < n; v++) {
    const l = Math.hypot(nr[v * 3], nr[v * 3 + 1], nr[v * 3 + 2]) || 1;
    P.pos.push(P.pos[v * 3] - (nr[v * 3] / l) * grosor, P.pos[v * 3 + 1] - (nr[v * 3 + 1] / l) * grosor, P.pos[v * 3 + 2] - (nr[v * 3 + 2] / l) * grosor);
  }
  const dir = new Set();
  for (let f = 0; f < nc; f++) P.caras[f].forEach((a, i, c) => dir.add(`${a},${c[(i + 1) % c.length]}`));
  for (let f = 0; f < nc; f++) {
    const c = P.caras[f];
    P.caras.push(c.map((v) => v + n).reverse()); P.uvs.push(P.uvs[f].slice().reverse());
    if (P.colores) P.colores.push(P.colores[f].slice().reverse());
    c.forEach((a, i) => {
      const b = c[(i + 1) % c.length];
      if (dir.has(`${b},${a}`)) return; // arista interior
      P.caras.push([b, a, a + n, b + n]);
      P.uvs.push([P.uvs[f][(i + 1) % c.length], P.uvs[f][i], P.uvs[f][i], P.uvs[f][(i + 1) % c.length]]);
      if (P.colores) { const k = P.colores[f][i]; P.colores.push([k, k, k, k]); }
    });
  }
  return dePoligonos(P).malla;
}
