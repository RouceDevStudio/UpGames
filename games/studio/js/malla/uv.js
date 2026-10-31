// UV automático (sprint 5): proyección por caras agrupadas según hacia dónde miran (±X, ±Y, ±Z).
// Cada grupo se proyecta sin deformar y se coloca en su celda de una cuadrícula 3 × 2, todas a la
// misma escala para que la textura tenga la misma densidad en todo el modelo. Sin Three.js.
const EJES = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]; // [eje, signo]

export function uvAutomatico(m, margen = 0.02) {
  const out = m.clone();
  const grupo = new Int8Array(m.nF);
  for (let f = 0; f < m.nF; f++) {
    const n = m.normalCara(f), a = n.map(Math.abs);
    const eje = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
    grupo[f] = EJES.findIndex(([e, s]) => e === eje && Math.sign(n[eje] || 1) === s);
  }
  // ejes de proyección (u, v) de cada grupo, orientados para que la imagen no salga en espejo
  const proy = (g, p) => {
    const [e, s] = EJES[g];
    if (e === 0) return [-s * p[2], p[1]];
    if (e === 1) return [p[0], -s * p[2]];
    return [s * p[0], p[1]];
  };
  const caja = Array.from({ length: 6 }, () => [Infinity, Infinity, -Infinity, -Infinity]);
  for (let f = 0; f < m.nF; f++) for (const v of m.vertsDeCara(f)) {
    const [u, w] = proy(grupo[f], [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]]), c = caja[grupo[f]];
    c[0] = Math.min(c[0], u); c[1] = Math.min(c[1], w); c[2] = Math.max(c[2], u); c[3] = Math.max(c[3], w);
  }
  const celda = [1 / 3, 1 / 2];
  let tam = 0;
  for (const c of caja) if (c[2] >= c[0]) tam = Math.max(tam, (c[2] - c[0]) / (celda[0] - 2 * margen), (c[3] - c[1]) / (celda[1] - 2 * margen));
  const k = tam ? 1 / tam : 1;
  for (let f = 0; f < m.nF; f++) {
    const g = grupo[f], c = caja[g], ox = (g % 3) * celda[0] + margen, oy = Math.floor(g / 3) * celda[1] + margen;
    for (const h of m.mediasDeCara(f)) {
      const v = m.heV[h], [u, w] = proy(g, [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]]);
      out.heUV[h * 2] = ox + (u - c[0]) * k;
      out.heUV[h * 2 + 1] = oy + (w - c[1]) * k;
    }
  }
  return { malla: out };
}
