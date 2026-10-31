// Malla de media arista → arreglos para BufferGeometry (sin Three.js).
// Un vértice de dibujo por esquina (media arista): así cada esquina lleva su UV, su color y su
// normal (suave o con arista viva según el ángulo). Las caras se triangulan en abanico.

export function aGeometria(m, { angulo = 30 } = {}) {
  const nH = m.nHE;
  const idx = [], triCara = [];
  for (let f = 0; f < m.nF; f++) {
    const hs = m.mediasDeCara(f);
    for (let i = 1; i < hs.length - 1; i++) { idx.push(hs[0], hs[i], hs[i + 1]); triCara.push(f); }
  }
  const r = {
    posiciones: posicionesEsquinas(m),
    normales: normalesEsquinas(m, angulo),
    uvs: Float32Array.from(m.heUV),
    colores: m.heCol ? Float32Array.from(m.heCol) : null,
    indices: nH > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx),
    triCara: Uint32Array.from(triCara),
  };
  return r;
}

export function posicionesEsquinas(m, out = new Float32Array(m.nHE * 3)) {
  const p = m.pos;
  for (let h = 0; h < m.nHE; h++) {
    const v = m.heV[h] * 3;
    out[h * 3] = p[v]; out[h * 3 + 1] = p[v + 1]; out[h * 3 + 2] = p[v + 2];
  }
  return out;
}

// Normal de cada esquina: media (por área) de las caras del vértice cuya normal no se separa
// más de `angulo` grados de la de su cara («suavizado automático» de Blender).
export function normalesEsquinas(m, angulo = 30, out = new Float32Array(m.nHE * 3)) {
  const nF = m.nF, fn = new Float32Array(nF * 3), fu = new Float32Array(nF * 3), t = [0, 0, 0];
  for (let f = 0; f < nF; f++) {
    m.normalCara(f, t);
    fn[f * 3] = t[0]; fn[f * 3 + 1] = t[1]; fn[f * 3 + 2] = t[2];
    const l = Math.hypot(t[0], t[1], t[2]) || 1;
    fu[f * 3] = t[0] / l; fu[f * 3 + 1] = t[1] / l; fu[f * 3 + 2] = t[2] / l;
  }
  // caras de cada vértice (CSR)
  const nV = m.nV, cuenta = new Int32Array(nV + 1);
  for (let h = 0; h < m.nHE; h++) cuenta[m.heV[h] + 1]++;
  for (let v = 0; v < nV; v++) cuenta[v + 1] += cuenta[v];
  const lugar = cuenta.slice(0, nV), caras = new Int32Array(m.nHE);
  for (let h = 0; h < m.nHE; h++) caras[lugar[m.heV[h]]++] = m.heFace[h];
  const cosA = Math.cos((angulo * Math.PI) / 180);
  for (let h = 0; h < m.nHE; h++) {
    const f = m.heFace[h], v = m.heV[h];
    let x = 0, y = 0, z = 0;
    for (let k = cuenta[v]; k < cuenta[v + 1]; k++) {
      const g = caras[k];
      if (g !== f && fu[f * 3] * fu[g * 3] + fu[f * 3 + 1] * fu[g * 3 + 1] + fu[f * 3 + 2] * fu[g * 3 + 2] < cosA) continue;
      x += fn[g * 3]; y += fn[g * 3 + 1]; z += fn[g * 3 + 2];
    }
    const l = Math.hypot(x, y, z) || 1;
    out[h * 3] = x / l; out[h * 3 + 1] = y / l; out[h * 3 + 2] = z / l;
  }
  return out;
}
