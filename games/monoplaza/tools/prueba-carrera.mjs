// Carrera completa sin gráficos (el jugador también lo conduce la IA).
import { Circuito } from '../js/track.js';
import { Sesion } from '../js/race.js';
import { PilotoIA } from '../js/ai.js';
const c = new Circuito();
const s = new Sesion(c, { modo: 'carrera', vueltas: +(process.argv[2] || 3), rivales: +(process.argv[3] || 7), dificultad: 'dificil' });
let paradas = 0, abandonos = 0;
const ia = new PilotoIA(s.jugador.coche, c, 0.97, 0.6);
s.jugador.coche.esIA = true;
const fuera = new Map(); const prevF = new Map();
let t = 0, contactos = 0, golpes = 0;
while (t < 3000) {
  if (s.estado !== 'parrilla') ia.conducir(1 / 60, s.coches);
  s.actualizar(1 / 60); t += 1 / 60;
  for (const e of s.eventos) {
    if (e.tipo === 'contacto') contactos++;
    if (e.tipo === 'paradaFin') { paradas++; console.log(`parada de ${e.p.nombre}: ${e.duracion.toFixed(1)} s, compuesto ${e.p.coche.reglaje.compuesto}`); }
    if (e.tipo === 'abandono') { abandonos++; console.log('abandono', e.p.nombre, e.motivo, 'vuelta', e.p.vuelta, 's', e.p.coche.proj.s.toFixed(0), 'desg', Math.max(...e.p.coche.ruedas.map(w=>w.neum.desgaste)).toFixed(2), 'box', !!e.p.box, e.p.solicitudBox, JSON.stringify(e.p.coche.debugGolpe)); }
    if (e.tipo === 'vuelta' && e.p.jugador && e.p.vuelta === 2 && process.env.BOX) s.pedirBox(e.p, 'duro');
    if (e === 'salida') console.log('¡Salida! t=', t.toFixed(1));
    if (e.tipo === 'vuelta' && e.p.jugador) console.log('vuelta jugador', e.t.toFixed(3), e.valida ? '' : '(inválida)', 'pos', e.p.posicion);
  }
  s.eventos.length = 0;
  for (const p of s.participantes) { if (p.coche.impacto > 4) golpes++;
    const f = p.coche.limitesExcedidos; if (f && !prevF.get(p)) { fuera.set(p, (fuera.get(p)||[]).concat(Math.round(p.coche.proj.s))); } prevF.set(p, f); }
  if (s.participantes.every(p => p.terminado || p.abandono)) break;
}
for (const p of s.orden) console.log(p.posicion, p.nombre.padEnd(12), p.terminado ? (p.tTotal.toFixed(2) + 's') : 'DNF'), 'paradas', p.paradas, ('', 'mejor', p.mejor.toFixed(3), 'hab', p.ia ? p.ia.habilidad.toFixed(3) : '-', 'fuera en', (fuera.get(p)||[]).join(','));
console.log('contactos', contactos, 'golpes muro (pasos)', golpes, 'paradas', paradas, 'abandonos', abandonos);
