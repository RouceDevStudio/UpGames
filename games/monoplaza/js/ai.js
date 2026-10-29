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
    if (v < 2 && car.tiempoParado > 2.5 && !car.retenido) {
      car.recolocar();
      car.tiempoParado = 0;
    }
  }
}

// Conduce el coche por la calle de boxes: entra, frena en su garaje, espera la parada y sale.
export class PilotoBox {
  constructor(coche, circuito, sBox, { duracion = 2.5, alParar = null, alTerminar = null } = {}) {
    this.coche = coche; this.c = circuito; this.sBox = sBox;
    this.duracion = duracion; this.alParar = alParar; this.alTerminar = alTerminar;
    this.estado = 'entrada'; this.t = 0;
    this._o = { x: 0, z: 0 };
  }

  conducir(dt) {
    const car = this.coche, c = this.c, m = car.mandos;
    const s = car.proj.s, v = car.velocidad;
    if (this.estado === 'parada') {
      this.t += dt;
      m.acelerador = 0; m.freno = 1; m.direccion = 0; m.drs = false;
      car.retenido = true;   // los gatos levantan el coche: ni avanza ni engrana la reversa
      if (this.t >= this.duracion) { this.estado = 'salida'; car.retenido = false; this.alTerminar?.(); }
      return;
    }
    const L = c.largo;
    const aBox = c.envolver(this.sBox - s);          // metros hasta el garaje
    const cercaBox = this.estado === 'entrada' && aBox < 40;
    // objetivo lateral: el carril y, junto al garaje, un poco hacia la puerta
    const mirar = clamp(4 + v * 0.35, 5, 22);
    const sT = s + mirar;
    let dT = c.dCarrilPit(sT);
    if (cercaBox) dT += 2.2 * (1 - aBox / 40);
    const i = Math.floor(c.envolver(sT) / c.paso) % c.n;
    const f = c.envolver(sT) / c.paso - Math.floor(c.envolver(sT) / c.paso);
    const j = (i + 1) % c.n;
    const x = c.x[i] + (c.x[j] - c.x[i]) * f, z = c.z[i] + (c.z[j] - c.z[i]) * f;
    const ox = x - c.tz[i] * dT, oz = z + c.tx[i] * dT;
    const cos = Math.cos(car.psi), sin = Math.sin(car.psi);
    const lx = (ox - car.x) * cos + (oz - car.z) * sin, ly = -(ox - car.x) * sin + (oz - car.z) * cos;
    const beta = v > 4 ? Math.atan2(car.vy, car.vx) : 0;
    const delta = Math.atan(COCHE.wheelbase * 2 * ly / Math.max(1, lx * lx + ly * ly)) + beta * 0.5;
    m.direccion = clamp(delta / COCHE.angMaxRueda, -1, 1);
    // velocidad: llegar al limitador a 80 km/h y parar justo en el garaje
    const lim = c.pit.limite * 0.96;
    const aLim = c.envolver(c.pit.limiteIni - s);
    let vObj = c.uPit(s) >= 0 && aLim > L / 2 ? lim : Math.min(70, Math.sqrt(lim * lim + 2 * 13 * Math.max(0, aLim - 5)));
    // antes de la entrada se respeta la velocidad de paso por curva
    if (c.uPit(s) < 0) vObj = Math.min(vObj, c.perfil[car.proj.i] * 0.93, Math.sqrt(26 * 26 + 2 * 11 * Math.max(0, c.envolver(c.pit.entrada - s) - 5)));
    else if (aLim < L / 2) vObj = Math.min(vObj, 26);   // rampa de entrada al carril
    if (this.estado === 'entrada') {
      if (aBox < L / 2) vObj = Math.min(vObj, Math.sqrt(2 * 7 * Math.max(0, aBox - 0.6)));
      if ((aBox < 0.9 || aBox > L - 3) && v < 1.5) { this.estado = 'parada'; this.t = 0; this.alParar?.(); return; }
    } else if (c.uPit(s) < 0) { this.estado = 'fin'; return; }
    else if (!c.enLimitador(s, c.dCarrilPit(s)) && c.envolver(s - c.pit.limiteFin) < 200) vObj = 75;
    const err = vObj - v;
    m.acelerador = err > 0 ? clamp(0.3 + err * 0.4, 0, 1) : 0;
    m.freno = err < -0.5 ? clamp(-err * 0.25, 0, 1) : 0;
    m.drs = false;
  }
}
