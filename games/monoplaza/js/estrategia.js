// Estrategia de carrera: estima el tiempo total de cada plan de paradas (0, 1 o 2) con el
// ritmo y el desgaste de cada compuesto (medidos con la física en Valle Andino y escalados
// al largo del circuito) y la pérdida de tiempo de pasar por boxes. Lógica pura.

import { COMPUESTOS } from './config.js';

const REF = 4356;                                   // largo de Valle Andino (m)
// segundos que pierde cada compuesto por vuelta respecto al blando nuevo, y % de desgaste por vuelta
const RITMO = { blando: 0, medio: 2.3, duro: 5.0 };
const DESGASTE = { blando: 2.1, medio: 1.35, duro: 0.86 };
const SEG_POR_PCT = 0.11;                           // pérdida por cada 1 % de desgaste
const ACANTILADO = 45;                              // a partir de aquí el neumático se cae

export function desgastePorVuelta(comp, largo) { return DESGASTE[comp] * largo / REF; }

/** Tiempo de un relevo de `n` vueltas con un compuesto (s), sobre la vuelta base T. */
export function tiempoRelevo(comp, n, T, largo) {
  const f = largo / REF, d = desgastePorVuelta(comp, largo);
  let t = 0;
  for (let k = 0; k < n; k++) {
    const w = d * (k + 0.5);
    t += T + RITMO[comp] * f + w * SEG_POR_PCT * f + Math.max(0, w - ACANTILADO) * 0.25 * f + (k === 0 ? 1.2 : 0);   // la primera vuelta, con la goma fría
  }
  return t;
}

/** Vueltas que aguanta un compuesto antes del acantilado. */
export function vida(comp, largo) { return Math.floor(ACANTILADO / desgastePorVuelta(comp, largo)); }

/** Pérdida de pasar por boxes (s): calle a 80 km/h, parada y salida en frío. */
export function perdidaBoxes(circuito) {
  const p = circuito.pit; if (!p) return 22;
  const largoCalle = circuito.envolver(p.salida - p.entrada);
  const vMedia = circuito.largo / (circuito.def.ritmoIA || 80);
  return largoCalle / 22.2 - largoCalle / vMedia + 2.6 + 3;
}

/**
 * Planes ordenados por tiempo total: [{ paradas, relevos: [{ c, vueltas }], total, delta, texto }].
 * Con más de 8 vueltas en seco se exige usar dos compuestos distintos (como en la F1).
 */
export function planes({ vueltas, circuito, T = circuito.def.ritmoIA || 80, lluvia = false }) {
  if (lluvia) return [{ paradas: 0, relevos: [{ c: 'lluvia', vueltas }], total: 0, delta: 0, texto: 'Lluvia: neumáticos de lluvia o intermedios según el agua. El ingeniero te avisa si cambia.' }];
  const largo = circuito.largo, pb = perdidaBoxes(circuito), secos = ['blando', 'medio', 'duro'];
  const exigeDos = vueltas > 8;
  const minimo = vueltas >= 10 ? 3 : 1;              // nada de relevos de una vuelta
  const res = [];
  // sin parar
  for (const c of secos) if (!exigeDos && vueltas * desgastePorVuelta(c, largo) < 70) res.push({ paradas: 0, relevos: [{ c, vueltas }], total: tiempoRelevo(c, vueltas, T, largo) });
  // una parada: el mejor reparto para cada pareja
  for (const a of secos) for (const b of secos) {
    if (exigeDos && a === b) continue;
    let mejor = null;
    for (let n1 = minimo; n1 <= vueltas - minimo; n1++) {
      const t = tiempoRelevo(a, n1, T, largo) + pb + tiempoRelevo(b, vueltas - n1, T, largo);
      if (!mejor || t < mejor.total) mejor = { paradas: 1, relevos: [{ c: a, vueltas: n1 }, { c: b, vueltas: vueltas - n1 }], total: t };
    }
    if (mejor) res.push(mejor);
  }
  // dos paradas (solo en carreras largas)
  if (vueltas >= 12) for (const a of secos) for (const b of secos) for (const c of secos) {
    if (exigeDos && a === b && b === c) continue;
    let mejor = null;
    for (let n1 = minimo; n1 <= vueltas - 2 * minimo; n1++) for (let n2 = minimo; n1 + n2 <= vueltas - minimo; n2++) {
      const t = tiempoRelevo(a, n1, T, largo) + tiempoRelevo(b, n2, T, largo) + tiempoRelevo(c, vueltas - n1 - n2, T, largo) + 2 * pb;
      if (!mejor || t < mejor.total) mejor = { paradas: 2, relevos: [{ c: a, vueltas: n1 }, { c: b, vueltas: n2 }, { c, vueltas: vueltas - n1 - n2 }], total: t };
    }
    if (mejor) res.push(mejor);
  }
  res.sort((x, y) => x.total - y.total);
  // quitar duplicados casi iguales y quedarse con los 4 mejores
  const vistos = new Set(), out = [];
  for (const r of res) {
    const k = r.paradas + ':' + r.relevos.map(x => x.c).sort().join('-');      // el mismo juego de compuestos en otro orden cuenta como uno
    if (vistos.has(k)) continue; vistos.add(k); out.push(r);
    if (out.length >= 4) break;
  }
  const t0 = out[0]?.total || 0;
  for (const r of out) {
    r.delta = r.total - t0;
    let v = 0;
    r.paradasEn = r.relevos.slice(0, -1).map(x => (v += x.vueltas));
    r.texto = r.relevos.map(x => `${COMPUESTOS[x.c].nombre} (${x.vueltas})`).join(' → ');
  }
  return out;
}

/** Vuelta en la que parar según el plan (o null) y el compuesto a poner. */
export function siguienteParada(plan, vueltaActual, paradasHechas) {
  if (!plan) return null;
  const v = plan.paradasEn?.[paradasHechas];
  if (v == null) return null;
  return { vuelta: v, compuesto: plan.relevos[paradasHechas + 1].c };
}
