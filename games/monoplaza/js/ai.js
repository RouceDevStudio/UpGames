// Piloto automático para los rivales: persecución pura sobre la trazada ideal,
// perfil de velocidad con margen según habilidad y maniobras de adelantamiento.

import { COCHE } from './config.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export class PilotoIA {
  constructor(coche, circuito, habilidad = 0.97, agresividad = 0.5) {
    this.coche = coche;
    this.c = circuito;
    this.habilidad = habilidad;
    this.agresividad = agresividad;
    this.desvio = 0;        // desplazamiento lateral sobre la trazada
    this.desvioObj = 0;
    this.errorPrevio = 0;
    this.atascado = 0;
    this.ruido = Math.random() * 100;
    this.tiempo = 0;
  }

  _puntoTrazada(s, desvio, out) {
    const c = this.c, t = c.trazada;
    s = c.envolver(s);
    const f = s / c.paso, i = Math.floor(f) % c.n, j = (i + 1) % c.n, u = f - Math.floor(f);
    const off = t.off[i] + (t.off[j] - t.off[i]) * u + desvio;
    const lim = c.semiAncho[i] - 1.1;
    const o = clamp(off, -lim, lim);
    const x = c.x[i] + (c.x[j] - c.x[i]) * u, z = c.z[i] + (c.z[j] - c.z[i]) * u;
    out.x = x - c.tz[i] * o; out.z = z + c.tx[i] * o;
    return out;
  }

  velocidadObjetivo(s) {
    const c = this.c;
    const i = Math.floor(c.envolver(s) / c.paso) % c.n;
    // el perfil supone neumáticos blandos en su ventana: se ajusta al agarre real
    let agarre = 0;
    for (const w of this.coche.ruedas) agarre += w.neum.c.mu * w.neum.factorAgarre();
    const k = Math.min(1.02, agarre / 4 / 1.78);
    return c.perfil[i] * this.habilidad * Math.sqrt(k);
  }

  conducir(dt, rivales = []) {
    const car = this.coche, c = this.c;
    this.tiempo += dt;
    const p = car.proj;
    if (p.i < 0) return;
    const v = car.velocidad;
    // adelantamientos y defensa: buscar coches cerca por delante
    this.desvioObj = 0;
    let vTrafico = Infinity;
    // en curva no se cambia de línea: la trazada manda
    const iAdel = Math.floor(c.envolver(p.s + 40) / c.paso) % c.n;
    const curvaCerca = Math.abs(c.trazada.curv[p.i]) > 1 / 180 || Math.abs(c.trazada.curv[iAdel]) > 1 / 180;
    for (const o of rivales) {
      if (o === car || o.proj.i < 0) continue;
      let ds = o.proj.s - p.s;
      if (ds < -c.largo / 2) ds += c.largo; else if (ds > c.largo / 2) ds -= c.largo;
      const dd = o.proj.d - p.d;
      const cierre = car.vx - o.vx;
      if (ds > 0 && ds < 45) {
        if (Math.abs(dd) < 2.3) {
          // mismo carril: buscar hueco si somos más rápidos y hay recta
          if (!curvaCerca && (cierre > 0.3 || ds < 15)) {
            const ladoLibre = o.proj.d > 0 ? -1 : 1;
            this.desvioObj = (o.proj.d + ladoLibre * 3.3) - (p.d - this.desvio);
          }
          // distancia de seguridad
          const hueco = 5.5 + v * 0.12;
          if (ds < hueco + 25) vTrafico = Math.min(vTrafico, o.vx + (ds - hueco) * 0.6);
        }
      } else if (ds > -5.5 && ds <= 0 && Math.abs(dd) < 2.6) {
        // coche a la par: dejar espacio
        this.desvioObj += dd > 0 ? -1.0 : 1.0;
      }
    }
    this.desvioObj = clamp(this.desvioObj, -6, 6);
    const kDes = curvaCerca && this.desvioObj === 0 ? 0.6 : 1.4;
    this.desvio += (this.desvioObj - this.desvio) * Math.min(1, dt * kDes);
    const frenarPorTrafico = vTrafico;

    // dirección: persecución pura
    const mirar = clamp(5 + v * 0.32, 7, 34);
    const obj = this._puntoTrazada(p.s + mirar, this.desvio, this._o || (this._o = {}));
    const cos = Math.cos(car.psi), sin = Math.sin(car.psi);
    const dx = obj.x - car.x, dz = obj.z - car.z;
    const lx = dx * cos + dz * sin, ly = -dx * sin + dz * cos;
    const l2 = lx * lx + ly * ly;
    const curv = 2 * ly / Math.max(1, l2);
    let delta = Math.atan(COCHE.wheelbase * curv);
    // amortiguación de guiñada: corrige el sobreviraje
    const beta = v > 4 ? Math.atan2(car.vy, car.vx) : 0;
    delta += beta * 0.5;
    if (lx < 0) delta = Math.sign(ly || 1) * COCHE.angMaxRueda; // apuntando hacia atrás
    car.mandos.direccion = clamp(delta / COCHE.angMaxRueda, -1, 1);

    // velocidad
    let vObj = this.velocidadObjetivo(p.s + v * 0.12);
    if (Math.abs(this.desvio) > 1.5) vObj *= 0.985;
    vObj = Math.min(vObj, frenarPorTrafico);
    if (car.enTierra) vObj = Math.min(vObj, 25);
    const err = vObj - v;
    let ac = 0, fr = 0;
    if (err > 0) ac = clamp(0.35 + err * 0.35, 0, 1);
    else if (err > -1.2) ac = clamp(0.35 + err * 0.3, 0, 1);
    else fr = clamp(-err * 0.16, 0, 1);
    if (Math.abs(beta) > 0.12) ac *= 0.5;
    car.mandos.acelerador = ac;
    car.mandos.freno = fr;
    car.mandos.drs = true;
    // ERS: adelantar cuando hay un rival cerca por delante
    car.mandos.ersModo = this.desvioObj !== 0 ? 2 : 1;

    // atasco: recolocar en pista
    if (v < 2 && car.tiempoParado > 2.5) {
      car.recolocar();
      car.tiempoParado = 0;
    }
  }
}
