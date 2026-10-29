// Prueba sin gráficos: un piloto automático da vueltas con las físicas reales.
// Uso: node tools/prueba-fisica.mjs [vueltas] [habilidad]
import { Circuito } from '../js/track.js';
import { Monoplaza } from '../js/physics/monoplaza.js';
import { PilotoIA } from '../js/ai.js';

const vueltas = +(process.argv[2] || 3), hab = +(process.argv[3] || 1);
const c = new Circuito();
const car = new Monoplaza(c, { ia: true, ayudas: { tc: 2, abs: true } });
car.colocar(c.largo - 20, 0);
const ia = new PilotoIA(car, c, hab, 0.5);
const dt = 1 / 300;
let t = 0, vuelta = 0, tVuelta = 0, sPrev = car.proj.s, vmax = 0, gmax = 0, fuera = 0, golpes = 0, minv = 1e9;
const tiempos = [];
let fueraAntes = false;
while (vuelta < vueltas && t < 600) {
  ia.conducir(dt, []);
  car.paso(dt);
  t += dt; tVuelta += dt;
  const s = car.proj.s;
  if (sPrev > c.largo - 50 && s < 50) { vuelta++; tiempos.push(tVuelta); 
    const w=car.ruedas; console.log(`vuelta ${vuelta}: ${tVuelta.toFixed(3)} s  vmax ${(vmax*3.6).toFixed(0)}  gLat ${gmax.toFixed(2)}  fuera ${fuera} golpes ${golpes}  neum ${w.map(x=>x.neum.tSup.toFixed(0)+'/'+x.neum.tNucleo.toFixed(0)).join(' ')}  desg ${w.map(x=>(x.neum.desgaste*100).toFixed(1)).join(' ')}%  frenos ${w.map(x=>x.tFreno.toFixed(0)).join(' ')}  ers ${(car.ers/1e6).toFixed(2)}MJ fuel ${car.combustible.toFixed(1)}`);
    tVuelta = 0; vmax = 0; gmax = 0; fuera = 0; golpes = 0; car.nuevaVuelta(); }
  sPrev = s;
  vmax = Math.max(vmax, car.velocidad); gmax = Math.max(gmax, Math.abs(car.ay) / 9.81);
  if (car.fueraPista && !fueraAntes) { fuera++; if (process.env.DBG) console.log('fuera en s=', s.toFixed(0), 'v', (car.velocidad*3.6).toFixed(0)); }
  fueraAntes = car.fueraPista;
  if (car.impacto > 2) golpes++;
  if (process.env.TRAZA && Math.round(t*300) % 150 === 0) console.log(t.toFixed(1), 's', s.toFixed(0), 'd', car.proj.d.toFixed(1), 'v', (car.velocidad*3.6).toFixed(0), 'obj', (ia.velocidadObjetivo(s)*3.6).toFixed(0), 'g', car.marcha, 'rpm', car.rpm.toFixed(0), 'ac', car.mandos.acelerador.toFixed(2), 'fr', car.mandos.freno.toFixed(2), 'beta', Math.atan2(car.vy,car.vx).toFixed(3), 'fz', car.ruedas.map(w=>w.fz.toFixed(0)).join(','));
}
if (!tiempos.length) console.log('no completó ninguna vuelta; s =', car.proj.s.toFixed(0), 'v', car.velocidad.toFixed(1));
