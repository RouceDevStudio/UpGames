// Choque rueda con rueda en recta: el de atrás debe despegar y el de delante perder el control.
import { Circuito } from '../js/track.js';
import { Sesion } from '../js/race.js';
const c = new Circuito('valle');
const lat = +(process.argv[2] ?? 1.2), dv = +(process.argv[3] ?? 2);
const s = new Sesion(c, { modo: 'carrera', vueltas: 3, rivales: 1 });
const [A, B] = s.participantes.map(p => p.coche);
s.estado = 'carrera'; for (const p of s.participantes) p.ia = null;
B.colocar(300, 0); A.colocar(293.5, lat);
B.vx = 70; A.vx = 70 + dv;
for (const k of [A, B]) { k.marcha = 7; k.rpm = 13000; k.mandos.acelerador = 0.6; for (const w of k.ruedas) w.omega = k.vx / w.radio; }
let maxH = 0, maxCab = 0, maxBal = 0, desp = false, rB = 0;
for (let t = 0; t < 8; t += 1 / 300) {
  s.actualizar(1 / 300);
  for (const e of s.eventos) if (e.tipo === 'despegue') desp = true;
  s.eventos.length = 0;
  const h = A.y - c.y[A.proj.i];
  maxH = Math.max(maxH, h); maxCab = Math.max(maxCab, Math.abs(A.giroCab)); maxBal = Math.max(maxBal, Math.abs(A.giroBal));
  rB = Math.max(rB, Math.abs(B.r));
  if (Math.abs(t - Math.round(t)) < 1 / 600) console.log('t', t.toFixed(1), 'A h', h.toFixed(2), 'cab', A.giroCab.toFixed(2), 'bal', A.giroBal.toFixed(2), 'v', A.velocidad.toFixed(1), 'vuelo', !!A.vuelo, 'volc', !!A.volcado, '| B v', B.velocidad.toFixed(1), 'r', B.r.toFixed(2));
}
console.log({ desp, maxH: maxH.toFixed(2), maxCab: maxCab.toFixed(2), maxBal: maxBal.toFixed(2), rB: rB.toFixed(2), motivoA: A.motivoAbandono, abandonoA: A.abandono });
