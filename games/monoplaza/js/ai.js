// Piloto automático para los rivales: persecución pura sobre la trazada ideal,
// perfil de velocidad con margen según habilidad y maniobras de adelantamiento.

import { COCHE, factorAgua } from './config.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export class PilotoIA {
  constructor(coche, circuito, habilidad = 0.97, agresividad = 0.5) {
    this.coche = coche;
    this.c = circuito;
    this.habilidad = habilidad;
    this.agresividad = agresividad;
    // personalidad: constancia (errores), reflejos en la salida y gusto por el riesgo
    this.constancia = 0.6 + Math.random() * 0.4;
    this.reaccion = 0.15 + Math.random() * 0.12;
    this.desvio = 0;          // desplazamiento lateral sobre la trazada
    this.desvioObj = 0;
    this.ataque = null;       // { lado, rival, hasta } maniobra de adelantamiento comprometida
    this.defensa = 0;         // lado al que se cubre (0 = ninguno)
    this.error = null;        // { hasta, extra } curva en la que se pasará de frenada
    this.curvaRevisada = -1;
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
    const k = Math.min(1.02, agarre / 4 / 1.76);
    // daños y aire sucio quitan carga aerodinámica: se pasa más lento por curva
    const aero = 1 - 0.05 * this.coche.danoAleron - 0.04 * (this.coche.dano?.aleronTras || 0);
    // detrás de otro coche (o con el alerón roto) se usa el perfil de tráfico
    const w = Math.min(1, this.coche.aireSucio * 2.5 + (this.enTrafico ? 0.6 : 0) + this.coche.danoAleron);
    const limpio = c.perfil[i] * (1 - w) + c.perfilSucio[i] * w;
    const frio = c.perfilFrio[i] * (1 - w) + c.perfilFrioSucio[i] * w;
    // interpolación según el agarre real de las ruedas (1 = en ventana, 0,85 = frías)
    const g = (1 - k) / 0.15;
    const base = limpio + (frio - limpio) * Math.max(0, g);
    // pista mojada: el perfil entero escala con la raíz del agarre que queda (y algo de prudencia)
    let mojado = 1;
    const agua = c.agua || 0;
    this.agarreMojado = 1;
    if (agua > 0) {
      let fa = 0;
      for (const w of this.coche.ruedas) fa += factorAgua(w.neum.c, agua);
      this.agarreMojado = fa / 4;
      // margen de prudencia en mojado (el agarre cambia de una curva a otra y hay charcos)
      mojado = c.perfilAgarre(fa / 4 * (1 - 0.14 * Math.min(1, agua * 4)))[i] / c.perfil[i];
    }
    return base * this.habilidad * Math.sqrt(aero) * mojado;
  }

  // ¿Viene recta? (curvatura baja en los próximos `m` metros)
  _recta(s, m) {
    const c = this.c;
    for (let k = 0; k < m; k += 10) if (Math.abs(c.trazada.curv[Math.floor(c.envolver(s + k) / c.paso) % c.n]) > 1 / 300) return false;
    return true;
  }

  // Lado del interior de la próxima curva (+1 derecha, −1 izquierda)
  _interior(s) {
    const c = this.c;
    let suma = 0;
    for (let k = 20; k < 260; k += 10) suma += c.curv[Math.floor(c.envolver(s + k) / c.paso) % c.n];
    return suma >= 0 ? 1 : -1;
  }

  conducir(dt, rivales = []) {
    const car = this.coche, c = this.c;
    this.tiempo += dt;
    const p = car.proj;
    if (p.i < 0) return;
    const v = car.velocidad;
    const L = c.largo;
    // salida: cada piloto reacciona a su ritmo al apagarse el semáforo
    if (this.tiempo < this.reaccion && v < 3) { car.mandos.acelerador = 0.3; car.mandos.freno = 0; car.mandos.direccion = 0; return; }

    const recta = this._recta(p.s, 160);
    const iAdel = Math.floor(c.envolver(p.s + 40) / c.paso) % c.n;
    const curvaCerca = Math.abs(c.trazada.curv[p.i]) > 1 / 180 || Math.abs(c.trazada.curv[iAdel]) > 1 / 180;
    let vTrafico = Infinity;
    let delante = null, detras = null, apar = [];
    for (const o of rivales) {
      if (o === car || o.proj.i < 0 || o.abandono && o.velocidad < 1 && Math.abs(o.proj.d) > c.semiAncho[o.proj.i] + 1) continue;
      let ds = o.proj.s - p.s;
      if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L;
      const dd = o.proj.d - p.d;
      if (ds > 0 && ds < 150) {
        if (!delante || ds < delante.ds) delante = { o, ds, dd };
        // distancia de frenada hasta un coche más lento en nuestro carril
        if (Math.abs(dd) < 2.3) {
          const agarre = this.agarreMojado ?? 1;      // en mojado se frena menos y se deja más hueco
          const hueco = (5 + v * 0.13) / Math.sqrt(agarre);
          // frenada prudente hasta el coche lento y, ya cerca, seguirlo a su ritmo
          const vo = Math.max(0, o.vx);
          let vt = Math.sqrt(vo * vo + 2 * 8 * agarre * Math.max(0, ds - hueco));
          if (ds < hueco + 30) vt = Math.min(vt, vo + (ds - hueco) * 0.7);
          vTrafico = Math.min(vTrafico, vt);
        }
      } else if (ds <= 0 && ds > -40) {
        if (!detras || ds > detras.ds) detras = { o, ds, dd };
      }
      if (Math.abs(ds) < 5.5) apar.push({ o, ds, dd });
    }

    this.enTrafico = !!(delante && delante.ds < 35) || apar.length > 0;
    // ── Adelantamiento comprometido ──────────────────────────────────────
    if (this.ataque) {
      const a = this.ataque;
      let ds = a.rival.proj.s - p.s; if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L;
      // la maniobra se abandona si llega la curva y aún no vamos emparejados
      if (ds < -7 || this.tiempo > a.hasta || ds > 60 || (curvaCerca && ds > 3 && !a.lento)) this.ataque = null;
    }
    // en los primeros segundos de carrera cada uno mantiene su carril (salida limpia)
    const salida = this.tiempo < 9;
    if (!this.ataque && !salida && delante && delante.ds < 40 && Math.abs(delante.dd) < 2.6) {
      const o = delante.o;
      const cierre = car.vx - o.vx;
      const rebufo = delante.ds < 30;
      const lento = o.vx < v * 0.6 || o.abandono;       // coche dañado o parado: esquivarlo ya
      if (lento || (recta && (cierre > 0.4 || rebufo) && Math.random() < dt * (1 + this.agresividad * 2))) {
        // por el interior de la siguiente curva, salvo que esté tapado
        let lado = this._interior(p.s);
        const libre = (l) => !rivales.some(x => x !== car && x !== o && Math.abs(c.envolver(x.proj.s - p.s + L / 2) - L / 2) < 12 && Math.sign(x.proj.d - o.proj.d) === l && Math.abs(x.proj.d - o.proj.d) < 4.5);
        if (!libre(lado)) lado = -lado;
        if (libre(lado) || lento) this.ataque = { lado, rival: o, hasta: this.tiempo + 5, lento };
      }
    }
    // ── Defensa: cubrir el interior antes de la frenada, una sola vez ─────
    if (detras && !salida && !this.ataque && detras.ds > -14 && (detras.o.vx - car.vx) > 0.5 && recta && Math.random() < dt * this.agresividad) this.defensa = this._interior(p.s);
    if (!detras || detras.ds < -30 || curvaCerca) this.defensa = 0;

    // ── Desplazamiento lateral objetivo ────────────────────────────────────
    const hw = c.semiAncho[p.i];
    const offTraz = c.trazada.off[p.i];
    let dObj = offTraz;                                     // en coordenada d de la pista
    if (this.ataque) dObj = this.ataque.rival.proj.d + this.ataque.lado * 3.4;
    else if (this.defensa) dObj = this.defensa * (hw - 2.2);
    // lado a lado en curva: cada uno conserva su línea (nada de cerrar la puerta)
    if (curvaCerca && apar.some(a => Math.abs(a.dd) < 4)) dObj = p.d;
    // lado a lado: mantener al menos 3,2 m entre centros
    for (const a of apar) {
      if (Math.abs(a.dd) < 3.2) {
        const lejos = a.dd > 0 ? a.o.proj.d - 3.3 : a.o.proj.d + 3.3;
        dObj = a.dd > 0 ? Math.min(dObj, lejos) : Math.max(dObj, lejos);
      }
    }
    dObj = clamp(dObj, -hw + 1.2, hw - 1.2);
    this.desvioObj = dObj - offTraz;
    const kDes = this.ataque || apar.length ? 1.6 : curvaCerca ? 1.3 : 1.0;
    this.desvio += (this.desvioObj - this.desvio) * Math.min(1, dt * kDes);

    // ── Dirección: persecución pura ────────────────────────────────────────
    const mirar = clamp(5 + v * 0.32, 7, 34);
    const obj = this._puntoTrazada(p.s + mirar, this.desvio, this._o || (this._o = {}));
    const cos = Math.cos(car.psi), sin = Math.sin(car.psi);
    const dx = obj.x - car.x, dz = obj.z - car.z;
    const lx = dx * cos + dz * sin, ly = -dx * sin + dz * cos;
    const curv = 2 * ly / Math.max(1, lx * lx + ly * ly);
    let delta = Math.atan(COCHE.wheelbase * curv);
    const beta = v > 4 ? Math.atan2(car.vy, car.vx) : 0;
    delta += beta * 0.55;                                   // contravolante
    if (lx < 0) delta = Math.sign(ly || 1) * COCHE.angMaxRueda;
    car.mandos.direccion = clamp(delta / COCHE.angMaxRueda, -1, 1);

    // ── Errores humanos: a veces se pasa de frenada en una curva ──────────
    const iFren = Math.floor(c.envolver(p.s + 120) / c.paso) % c.n;
    if (c.perfil[iFren] < v * 0.75 && iFren !== this.curvaRevisada && !this.error) {
      this.curvaRevisada = iFren;
      // errores pequeños (pasarse de frenada, abrirse en la salida); los graves son raros
      const prob = (1.02 - this.habilidad) * 0.5 * (1.4 - this.constancia);
      if (Math.random() < prob) this.error = { hasta: this.tiempo + 3, extra: 1.02 + Math.random() * Math.random() * 0.05 };
    }
    if (this.error && this.tiempo > this.error.hasta) this.error = null;

    // ── Velocidad ──────────────────────────────────────────────────────────
    let vObj = this.velocidadObjetivo(p.s + v * 0.12);
    if (this.error) vObj *= this.error.extra;
    if (this.ataque && recta) vObj *= 1.01;               // en el ataque se apura algo más la frenada
    // fuera de la trazada la curva es más cerrada: hay que ir más despacio
    if (curvaCerca) vObj *= 1 - Math.min(0.25, 0.04 * Math.abs(this.desvio));
    // si el coche se abre hacia el exterior de la curva, levantar el pie (como un piloto)
    const kc = c.trazada.curv[p.i];
    const abierto = (p.d - dObj) * -Math.sign(kc || 1);    // > 0: desplazado hacia fuera
    if (Math.abs(kc) > 1 / 600 && abierto > 1.2) vObj = Math.min(vObj, v * (1 - Math.min(0.08, (abierto - 1.2) * 0.02)));
    vObj = Math.min(vObj, vTrafico);
    if (car.enTierra) vObj = Math.min(vObj, 25);
    const err = vObj - v;
    let ac = 0, fr = 0;
    if (err > 0) ac = clamp(0.35 + err * 0.35, 0, 1);
    else if (err > -1.2) ac = clamp(0.35 + err * 0.3, 0, 1);
    else fr = clamp(-err * 0.16, 0, 1);
    if (Math.abs(beta) > 0.12) ac *= 0.5;
    this.dbg = { vObj, beta, w: car.aireSucio, d: p.d, desvio: this.desvio, dObj };
    car.mandos.acelerador = ac;
    car.mandos.freno = fr;
    car.mandos.drs = true;
    // ERS: todo para atacar o defenderse; recargar si queda poca batería y no hay pelea
    const pelea = this.ataque || this.defensa || (delante && delante.ds < 25) || (detras && detras.ds > -15);
    car.mandos.ersModo = pelea && car.ers > 0.6e6 ? 2 : car.ers < 1.0e6 ? 0 : 1;

    // atasco: recolocar en pista
    // atasco: volver a la pista, pero solo si no viene nadie lanzado por detrás
    if (v < 2 && car.tiempoParado > 2.5 && !car.retenido) {
      const viene = rivales.some(o => { if (o === car) return false; const ds = c.envolver(p.s - o.proj.s); return ds < 160 && o.velocidad > 8; });
      if (!viene) { car.recolocar(); car.tiempoParado = 0; }
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
    // el ingeniero conduce con todas las ayudas (las del jugador vuelven al salir)
    this.ayudasPiloto = coche.ayudas;
    coche.ayudas = { tc: 2, abs: true, cambioAuto: true, direccion: false, estabilidad: true };
    coche.pilotoAuto = true;
  }

  _devolver() { if (this.coche.pilotoAuto) { this.coche.ayudas = this.ayudasPiloto; this.coche.pilotoAuto = false; } }

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
    // velocidad: llegar al limitador a 80 km/h y parar justo en el garaje (con agua, todo más suave)
    let fa = 1;
    if (c.agua > 0) { fa = 0; for (const w of car.ruedas) fa += factorAgua(w.neum.c, c.agua) / 4; fa *= 0.92; }
    const g = Math.sqrt(fa);
    const lim = c.pit.limite * 0.96;
    const aLim = c.envolver(c.pit.limiteIni - s);
    let vObj = c.uPit(s) >= 0 && aLim > L / 2 ? lim : Math.min(70, Math.sqrt(lim * lim + 2 * 13 * fa * Math.max(0, aLim - 5)));
    // antes de la entrada se respeta la velocidad de paso por curva
    if (c.uPit(s) < 0) vObj = Math.min(vObj, c.perfil[car.proj.i] * 0.93 * g, Math.sqrt((26 * g) ** 2 + 2 * 11 * fa * Math.max(0, c.envolver(c.pit.entrada - s) - 5)));
    else if (aLim < L / 2) vObj = Math.min(vObj, 26 * g);   // rampa de entrada al carril
    if (this.estado === 'entrada') {
      if (aBox < L / 2) vObj = Math.min(vObj, Math.sqrt(2 * 7 * fa * Math.max(0, aBox - 0.6)));
      // se pasó un poco del garaje (pista resbaladiza): frena del todo y paran ahí mismo
      const pasado = aBox > L - 25;
      if (pasado) vObj = 0;
      if ((aBox < 0.9 || pasado) && v < 1.5) { this.estado = 'parada'; this.t = 0; this.alParar?.(); return; }
      // si por lo que sea sale de la calle de boxes sin parar, se anula la parada
      if (c.uPit(s) < 0 && this.dentro) { this.estado = 'fin'; this._devolver(); return; }
      if (c.uPit(s) >= 0) this.dentro = true;
    } else if (c.uPit(s) < 0) { this.estado = 'fin'; this._devolver(); return; }
    else if (!c.enLimitador(s, c.dCarrilPit(s)) && c.envolver(s - c.pit.limiteFin) < 200) vObj = 75;
    const err = vObj - v;
    m.acelerador = err > 0 ? clamp(0.3 + err * 0.4, 0, 1) : 0;
    m.freno = err < -0.5 ? clamp(-err * 0.25, 0, 1) : 0;
    // con el morro lejos del objetivo, gas suave para no hacer trompos
    const desvio = Math.abs(Math.atan2(ly, Math.max(0.1, lx)));
    if (desvio > 0.45) m.acelerador = Math.min(m.acelerador, 0.25);
    m.drs = false;
  }
}
