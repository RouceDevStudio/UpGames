// Línea de tiempo (etapa 2), sin Three.js: claves por propiedad con curvas de suavizado.
// Una animación: { duracion, fps, bucle, pistas: { [id]: { [prop]: [{ t, v: [...], curva }] } } }
// id: el uuid de un objeto, o «rig:hueso» para los huesos de un esqueleto. prop: pos, rot
// (cuaternión x, y, z, w), esc o color (r, g, b).

export const CURVAS = {
  lineal: { nombre: 'Lineal', f: (t) => t },
  suave: { nombre: 'Suave', f: (t) => t * t * (3 - 2 * t) },
  entrada: { nombre: 'Acelera', f: (t) => t * t * t },
  salida: { nombre: 'Frena', f: (t) => 1 - (1 - t) ** 3 },
  rebote: { nombre: 'Rebote', f: (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; } },
  elastico: { nombre: 'Elástico', f: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1) },
  escalon: { nombre: 'Escalón', f: (t) => (t < 1 ? 0 : 1) },
};

export function nuevaAnimacion() { return { duracion: 3, fps: 30, bucle: true, pistas: {} }; }

const cerca = (a, b) => Math.abs(a - b) < 1e-4;

// Pone (o sustituye) la clave en el instante t. curva: cómo se llega desde esta clave a la siguiente.
export function ponerClave(anim, id, prop, t, v, curva = 'suave') {
  const pista = (anim.pistas[id] ||= {});
  const claves = (pista[prop] ||= []);
  const i = claves.findIndex((c) => cerca(c.t, t));
  const clave = { t: Math.max(0, t), v: [...v], curva };
  if (i >= 0) claves[i] = clave; else { claves.push(clave); claves.sort((a, b) => a.t - b.t); }
  return clave;
}

export function quitarClave(anim, id, t, prop = null) {
  const pista = anim.pistas[id];
  if (!pista) return 0;
  let n = 0;
  for (const p of prop ? [prop] : Object.keys(pista)) {
    const antes = pista[p]?.length || 0;
    if (!pista[p]) continue;
    pista[p] = pista[p].filter((c) => !cerca(c.t, t));
    n += antes - pista[p].length;
    if (!pista[p].length) delete pista[p];
  }
  if (!Object.keys(pista).length) delete anim.pistas[id];
  return n;
}

// Instantes con clave (de un id o de todos), ordenados y sin repetir.
export function instantes(anim, id = null) {
  const ts = [];
  for (const [k, pista] of Object.entries(anim.pistas)) {
    if (id && k !== id && !k.startsWith(`${id}:`)) continue;
    for (const claves of Object.values(pista)) for (const c of claves) if (!ts.some((x) => cerca(x, c.t))) ts.push(c.t);
  }
  return ts.sort((a, b) => a - b);
}

// Valor de una propiedad en t (null si no tiene claves). Los cuaterniones se interpolan con slerp.
export function evaluar(anim, id, prop, t) {
  const claves = anim.pistas[id]?.[prop];
  if (!claves?.length) return null;
  if (t <= claves[0].t) return [...claves[0].v];
  const u = claves[claves.length - 1];
  if (t >= u.t) return [...u.v];
  let i = 0;
  while (claves[i + 1].t < t) i++;
  const a = claves[i], b = claves[i + 1];
  const k = (CURVAS[a.curva] || CURVAS.suave).f((t - a.t) / (b.t - a.t || 1));
  return prop === 'rot' ? slerp(a.v, b.v, k) : a.v.map((x, j) => x + (b.v[j] - x) * k);
}

export function slerp(a, b, t) {
  let [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let ka = 1 - t, kb = t;
  if (cos < 0.9995) { const th = Math.acos(cos), s = Math.sin(th); ka = Math.sin((1 - t) * th) / s; kb = Math.sin(t * th) / s; }
  const q = [ax * ka + bx * kb, ay * ka + by * kb, az * ka + bz * kb, aw * ka + bw * kb];
  const l = Math.hypot(...q) || 1;
  return q.map((x) => x / l);
}

// Muestrea una pista a fps fijos (para exportar en GLB, que solo interpola en línea recta).
export function muestrear(anim, id, prop) {
  const claves = anim.pistas[id]?.[prop];
  if (!claves?.length) return null;
  const n = Math.max(2, Math.round(anim.duracion * anim.fps) + 1), tiempos = [], valores = [];
  for (let i = 0; i < n; i++) { const t = (i / (n - 1)) * anim.duracion; tiempos.push(t); valores.push(...evaluar(anim, id, prop, t)); }
  return { tiempos, valores };
}

// Copia profunda (para deshacer)
export const copiarAnim = (a) => JSON.parse(JSON.stringify(a));
