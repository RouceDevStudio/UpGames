// Carrera completa sin gráficos (el jugador también lo conduce la IA).
import { Circuito } from '../js/track.js';
import { Sesion } from '../js/race.js';
import { PilotoIA } from '../js/ai.js';
const c = new Circuito();
const s = new Sesion(c, { modo: 'carrera', vueltas: +(process.argv[2] || 3), rivales: 7, dificultad: 'dificil' });
const ia = new PilotoIA(s.jugador.coche, c, 0.97, 0.6);
s.jugador.coche.esIA = true;
const fuera = new Map(); const prevF = new Map();
let t = 0, contactos = 0, golpes = 0;
while (t < 900) {
  if (s.estado !== 'parrilla') ia.conducir(1 / 60, s.coches);
  s.actualizar(1 / 60); t += 1 / 60;
  for (const e of s.eventos) {
    if (e.tipo === 'contacto') contactos++;
    if (e === 'salida') console.log('¡Salida! t=', t.toFixed(1));
    if (e.tipo === 'vuelta' && e.p.jugador) console.log('vuelta jugador', e.t.toFixed(3), e.valida ? '' : '(inválida)', 'pos', e.p.posicion);
  }
  s.eventos.length = 0;
  for (const p of s.participantes) { if (p.coche.impacto > 4) golpes++;
    const f = p.coche.limitesExcedidos; if (f && !prevF.get(p)) { fuera.set(p, (fuera.get(p)||[]).concat(Math.round(p.coche.proj.s))); } prevF.set(p, f); }
  if (s.participantes.every(p => p.terminado)) break;
}
for (const p of s.orden) console.log(p.posicion, p.nombre.padEnd(12), p.terminado ? (p.tTotal.toFixed(2) + 's') : 'DNF', 'mejor', p.mejor.toFixed(3), 'hab', p.ia ? p.ia.habilidad.toFixed(3) : '-', 'fuera en', (fuera.get(p)||[]).join(','));
console.log('contactos', contactos, 'golpes muro (pasos)', golpes);
