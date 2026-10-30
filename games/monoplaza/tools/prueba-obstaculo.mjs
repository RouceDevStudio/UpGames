// Un coche parado en mitad de la pista: los que llegan detrás tienen que esquivarlo, no hacer cola.
import { Circuito } from '../js/track.js';
import { Sesion } from '../js/race.js';
const c = new Circuito(process.env.CIRCUITO || 'veloz');
const s = new Sesion(c, { modo: 'carrera', vueltas: 3, rivales: 6, dificultad: 'normal', clima: 'seco', semilla: 5 });
s.estado = 'carrera';
const [roto, ...resto] = s.participantes.filter(p => !p.jugador);
const J = s.jugador.coche; J.colocar(c.largo * 0.9, 0); J.retenido = true;     // el jugador, aparcado lejos
const s0 = 900;
roto.coche.colocar(s0, 0); roto.coche.terminal = true; roto.coche.abandono = true; roto.abandono = true; roto.ia = null; roto.tAbandono = 1e9;
resto.forEach((p, k) => { p.coche.colocar(s0 - 120 - k * 14, (k % 2 ? 1.5 : -1.5)); p.coche.vx = 30; });
for (let t = 0; t < 40; t += 1 / 60) { s.actualizar(1 / 60); s.eventos.length = 0; }
const pasaron = resto.filter(p => p.coche.proj.s > s0 + 20).length;
console.log(`pasaron el coche parado: ${pasaron}/${resto.length}`);
for (const p of resto) if (p.coche.proj.s <= s0 + 20) console.log("  no pasó:", p.nombre, "s", p.coche.proj.s.toFixed(0), "d", p.coche.proj.d.toFixed(1), "v", p.coche.velocidad.toFixed(1), "abandono", p.abandono, "ancho", c.semiAncho[p.coche.proj.i].toFixed(1), "roto d", roto.coche.proj.d.toFixed(1));
process.exit(pasaron === resto.length ? 0 : 1);
