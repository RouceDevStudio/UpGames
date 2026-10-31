// Dinámica del monoplaza.
// Ejes del coche: x hacia delante, y hacia la derecha. Rumbo ψ: el vector delantero
// en el mundo es (cos ψ, sin ψ) en el plano (x, z). Guiñada positiva = giro a la derecha.

import { COCHE, COMPUESTOS, G, RHO_AIRE, REGLAJE_DEF, efectosMejoras, factorAgua } from '../config.js';
import { SUPERFICIES, SUP_ASFALTO, SUP_BORDILLO, SUP_ESCAPE, SUP_GRAVA, BARRERAS } from '../track.js';
import { Neumatico, fuerzasNeumatico, muCarga } from './neumatico.js';

// altura del centro de giro del coche cuando vuela o vuelca (el modelo gira alrededor de él)
export const PIVOTE_VUELO = 0.45;
// mezcla de combustible (desde el volante): potencia, consumo y desgaste del motor
export const MEZCLA_POT = [0.955, 1, 1.025], MEZCLA_GASTO = [0.82, 1, 1.15], MEZCLA_MOTOR = [0.8, 1, 1.35];
export const MEZCLA_NOMBRES = ['AHORRO', 'NORMAL', 'RICA'];

const RPM_A_RAD = Math.PI / 30;
const tmpF = { fx: 0, fy: 0, sigma: 0 };
const tmpF2 = { fx: 0, fy: 0, sigma: 0 };

function parMotor(rpm) {
  const c = COCHE.curvaPar;
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
    }
  }
  return 0;
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export class Rueda {
  constructor(idx, px, py, radio, delantera) {
    this.idx = idx;
    this.px = px; this.py = py;
    this.radio = radio;
    this.delantera = delantera;
    this.izquierda = py < 0;
    this.omega = 0;
    this.angulo = 0;          // giro de dirección
    this.giro = 0;            // ángulo acumulado de rotación (para dibujar)
    this.tanAlfa = 0;         // deriva con longitud de relajación
    this.kappa = 0;
    this.fz = 0; this.fx = 0; this.fy = 0;
    this.vLong = 0; this.vLat = 0;
    this.deslizamiento = 0;   // velocidad de deslizamiento (m/s) para humo y sonido
    this.sigma = 0;
    this.sup = SUP_ASFALTO;
    this.d = 0;               // desplazamiento lateral sobre la pista
    this.tFreno = 450;
    this.factorAbs = 1;
    this.wx = 0; this.wz = 0; this.wy = 0;
    this.neum = null;
    this.compresion = 0;
  }
}

export class Monoplaza {
  constructor(circuito, opciones = {}) {
    this.circuito = circuito;
    this.reglaje = { ...REGLAJE_DEF, ...(opciones.reglaje || {}) };
    this.ayudas = { tc: 2, abs: true, cambioAuto: true, direccion: true, estabilidad: false, ...(opciones.ayudas || {}) };
    this.esIA = !!opciones.ia;
    const a = COCHE.wheelbase * (1 - COCHE.repartoDel);
    const b = COCHE.wheelbase * COCHE.repartoDel;
    this.a = a; this.b = b;
    this.ruedas = [
      new Rueda(0, a, -COCHE.viaDel / 2, COCHE.radioDel, true),
      new Rueda(1, a, COCHE.viaDel / 2, COCHE.radioDel, true),
      new Rueda(2, -b, -COCHE.viaTras / 2, COCHE.radioTras, false),
      new Rueda(3, -b, COCHE.viaTras / 2, COCHE.radioTras, false),
    ];
    // mejoras compradas con UpCoins (factores acotados, ver config.js)
    this.ef = efectosMejoras(opciones.mejoras);
    this.ponerCompuesto(this.reglaje.compuesto);
    this.combustible = opciones.combustible ?? 40;
    this.tAmb = opciones.tAmbiente ?? 26;
    this.reiniciarEstado();
    this.mandos = { direccion: 0, acelerador: 0, freno: 0, drs: false, ersModo: 1, mezcla: 1, bb: 0 };   // mezcla: 0 ahorro, 1 normal, 2 rica
    this.rebufo = 0;
    this.aireSucio = 0;
    this.drsPermitido = false;
    this.danoAleron = 0;
    this.eventos = [];
    this.repararTodo();
  }

  // Daños: alerones (0..1), suspensión doblada por rueda (0..1), pinchazos y ruedas sueltas
  repararTodo() {
    this.danoAleron = 0;
    // fondo/pontones (pierden carga), motor (pierde potencia) y piezas sueltas visibles
    // zona: daño acumulado por lado (cada golpe suma; las piezas de esa zona se rompen poco a poco)
    // abolladuras: dónde y cuánto se ha hundido la carrocería (las dibuja el modelo)
    this.dano = { aleronTras: 0, susp: [0, 0, 0, 0], pinchazo: [false, false, false, false], suelta: [false, false, false, false], fondo: 0, motor: 0, piezas: 0,
      zona: { del: 0, tras: 0, izq: 0, der: 0 }, abolladuras: [] };
    this.terminal = false; this.abandono = false; this.motivoAbandono = ''; this.tTerminal = 0;
    this.desgasteMotor = 0; this.humoMotor = 0; this.cajaBloqueada = false; this.ersAveriado = 0;
  }

  /**
   * Averías mecánicas: el motor se gasta con las vueltas altas y los golpes; la caja de cambios
   * puede quedarse bloqueada en una marcha y el ERS sobrecalentarse en modo ataque.
   * tasa: 1 = realista (pocas por carrera), 0 = sin averías. Devuelve el tipo de avería o null.
   */
  averias(dt, tasa = 1, azar = Math.random) {
    if (!(tasa > 0) || this.abandono || this.terminal) return null;
    const rpm = this.rpm / 12500;
    this.desgasteMotor += dt * rpm * rpm * 1.1e-4 * (1 + 2 * (this.dano.motor || 0)) * MEZCLA_MOTOR[this.mandos.mezcla ?? 1];
    const pMotor = 1.8e-5 * Math.pow(rpm, 4) * (1 + 30 * Math.pow(this.desgasteMotor, 3)) * (1 + 3 * (this.dano.motor || 0));
    if (azar() < pMotor * dt * tasa) {
      // humo, pérdida de potencia y, a los pocos segundos, motor roto
      this.dano.motor = 1; this.humoMotor = 1; this.terminal = true; this.tTerminal = -4; this.motivoAbandono = 'Motor roto';
      return 'motor';
    }
    if (!this.cajaBloqueada && this.marcha >= 3 && azar() < 3e-5 * dt * tasa * (1 + 2 * (this.dano.motor || 0))) {
      this.cajaBloqueada = true; return 'caja';
    }
    if (!(this.ersAveriado > 0) && azar() < (this.mandos.ersModo === 2 ? 1.2e-4 : 3e-5) * dt * tasa) {
      this.ersAveriado = 25; return 'ers';
    }
    return null;
  }

  // Un golpe en el punto (ex, ey) del coche con velocidad normal vn (m/s)
  /** Fuerza del último golpe fuerte durante medio segundo (para animaciones y la repetición). */
  get picoGolpe() { return this.reloj - (this._tGolpe ?? -9) < 0.5 ? this._vGolpe || 0 : 0; }

  aplicarGolpe(ex, ey, vn, azar = Math.random) {
    if (vn < 4) return;
    // un mismo choque toca varios puntos a la vez: cuenta una sola vez (salvo que sea más fuerte)
    if (this.reloj - (this._tGolpe ?? -9) < 0.3 && vn <= (this._vGolpe || 0) + 3) return;
    this._tGolpe = this.reloj; this._vGolpe = vn; this._exG = ex; this._eyG = ey;
    const d = this.dano;
    const delante = ex > 1.2, detras = ex < -1.4;
    const k = (ex > 0 ? 0 : 2) + (ey > 0 ? 1 : 0);   // rueda más cercana
    const avisar = (e) => this.eventos.push('dano:' + e);
    // Cada golpe daña la zona donde pega y SUMA a lo que ya tenía: un primer golpe dobla o
    // rompe algo, el segundo rompe más y el tercero deja el coche destrozado. Antes un solo
    // golpe fuerte llevaba todas las piezas al máximo y los siguientes ya no hacían nada.
    const z = d.zona || (d.zona = { del: 0, tras: 0, izq: 0, der: 0 });
    const f = Math.max(0, vn - 4);
    if (delante) z.del += f * 0.04;
    if (detras) z.tras += f * 0.04;
    if (Math.abs(ey) > 0.3) z[ey > 0 ? 'izq' : 'der'] += f * (delante || detras ? 0.025 : 0.045);
    d.piezas = Math.min(1, Math.max(z.izq, z.der, z.del * 0.8, z.tras * 0.8));
    // abolladura visible donde ha pegado (la profundidad crece con la fuerza; se acumulan)
    if (vn > 6) {
      const ab = d.abolladuras || (d.abolladuras = []);
      if (ab.length < 32) ab.push({ x: Math.max(-2.3, Math.min(3.0, ex)), z: Math.max(-0.9, Math.min(0.9, ey)), prof: Math.min(0.2, (vn - 5) * 0.013), r: Math.min(0.8, 0.3 + vn * 0.014), sem: (this.reloj * 997) % 1 });
    }
    // golpe brutal (o el tercero muy fuerte en la misma zona): el coche se parte y solo queda
    // la célula de supervivencia con el piloto; la parte trasera y sus ruedas salen despedidas
    if (!d.desintegrado && (vn > 28 || (vn > 16 && Math.max(z.tras, z.izq, z.der) > 2.2))) this.desintegrar(ex, ey, vn);
    // fondo y pontones: cada golpe fuerte les quita carga
    if (vn > 4.5) {
      const antes = d.fondo;
      d.fondo = Math.min(1, d.fondo + (vn - 4.5) * 0.022);
      if (antes < 0.35 && d.fondo >= 0.35) avisar('fondo');
    }
    if (delante && vn > 4.5) {
      const antes = this.danoAleron;
      this.danoAleron = Math.min(1, this.danoAleron + (vn - 4.5) * 0.055);
      if (antes < 1 && this.danoAleron >= 1) avisar('aleronDel');
      else if (antes < 0.3 && this.danoAleron >= 0.3) avisar('aleronDelTocado');
    }
    if (detras && vn > 5.5) {
      const antes = d.aleronTras;
      d.aleronTras = Math.min(1, d.aleronTras + (vn - 5.5) * 0.05);
      if (antes < 0.5 && d.aleronTras >= 0.5) avisar('aleronTras');
      // un golpe trasero fuerte toca la caja de cambios y el motor
      if (vn > 9) { const am = d.motor; d.motor = Math.min(1, d.motor + (vn - 9) * 0.06); if (am < 0.3 && d.motor >= 0.3) avisar('motor'); }
    }
    // la rueda del lado del golpe: suspensión, pinchazo o arrancada
    const lateral = Math.abs(ey) > 0.8 || Math.abs(ex - this.ruedas[k].px) < 0.8;
    if (!lateral && !delante && !detras) return;
    if (d.suelta[k]) return;
    if (vn > 7) {
      d.susp[k] = Math.min(1, d.susp[k] + (vn - 7) * 0.10);
      if (d.susp[k] > 0.25) avisar('susp' + k);
    }
    if (vn > 15 || d.susp[k] >= 1) {
      d.suelta[k] = true; d.pinchazo[k] = true;
      this.terminal = true; this.motivoAbandono = 'Rueda arrancada'; this.debugGolpe = { fuente: this.fuenteGolpe, vn, v: this.velocidad, s: this.proj.s, d: this.proj.d };
      this.eventos.push('rueda:' + k);
    } else if (!d.pinchazo[k] && vn > 5 && azar() < Math.min(0.7, (vn - 5) * 0.08)) {
      d.pinchazo[k] = true; avisar('pinchazo' + k);
    }
  }

  desintegrar(ex = -2, ey = 0, vn = 30) {
    const d = this.dano;
    d.desintegrado = true;
    d.suelta[2] = d.suelta[3] = true; d.pinchazo[2] = d.pinchazo[3] = true;
    d.aleronTras = 1; d.fondo = 1; d.motor = 1; d.piezas = 1;
    this.danoAleron = Math.max(this.danoAleron, vn > 34 ? 1 : 0.7);
    if (d.zona) for (const k in d.zona) d.zona[k] = Math.max(d.zona[k], 1.5);
    // la célula queda muy abollada donde ha pegado
    const ab = d.abolladuras || (d.abolladuras = []);
    for (let i = 0; i < 4; i++) ab.push({ x: Math.max(-0.3, Math.min(2.8, ex > 0 ? ex - i * 0.4 : 0.5 + i * 0.5)), z: (ey || (i % 2 ? 0.9 : -0.9)) * (i % 2 ? 1 : -1), prof: 0.16, r: 0.6, sem: Math.random() });
    if (!this.terminal) { this.terminal = true; this.tTerminal = 0; }
    this.motivoAbandono = 'Coche destrozado';
    this.eventos.push('desintegrado');
  }

  // En boxes: neumáticos nuevos, alerones nuevos (la suspensión doblada no se arregla en una parada)
  repararEnBoxes(compuesto, { susp = false, alaDel = 0 } = {}) {
    this.danoAleron = 0;
    // suspensión nueva en las esquinas que aún tienen rueda (brazos, bieletas y convergencia)
    if (susp) this.dano.susp = this.dano.susp.map((d, k) => this.dano.suelta[k] ? d : 0);
    // ajuste del flap del alerón delantero con la llave, como en las paradas reales
    if (alaDel) this.reglaje.aleronDel = Math.max(1, Math.min(11, this.reglaje.aleronDel + alaDel));
    // morro nuevo: desaparecen sus golpes (los del resto de la carrocería siguen ahí)
    if (this.dano.zona) this.dano.zona.del = 0;
    if (this.dano.abolladuras) this.dano.abolladuras = this.dano.abolladuras.filter(a => a.x < 1.2);
    this.dano.aleronTras = 0;
    this.dano.pinchazo = this.dano.pinchazo.map((_, k) => this.dano.suelta[k]);
    if (compuesto) this.reglaje.compuesto = compuesto;
    const c = COMPUESTOS[this.reglaje.compuesto] || COMPUESTOS.medio;
    for (const w of this.ruedas) { w.neum = new Neumatico(c, this.reglaje.presion); w.neum.tSup = 82; w.neum.tNucleo = 80; this._mejorarNeum(w.neum); }
  }

  _mejorarNeum(n) { n.mejoraMu = this.ef.mu; n.mejoraDesgaste = this.ef.desgaste * (this.multDesgaste || 1); }

  // En carreras cortas el desgaste se acelera para que la estrategia de boxes cuente
  ponerMultDesgaste(m) { this.multDesgaste = m; for (const w of this.ruedas) this._mejorarNeum(w.neum); }

  ponerCompuesto(nombre) {
    this.reglaje.compuesto = nombre;
    const c = COMPUESTOS[nombre] || COMPUESTOS.medio;
    for (const w of this.ruedas) {
      if (!w.neum) w.neum = new Neumatico(c, this.reglaje.presion);
      else w.neum.ponerCompuesto(c, this.reglaje.presion);
      this._mejorarNeum(w.neum);
    }
  }

  reiniciarEstado() {
    this.x = 0; this.z = 0; this.y = 0; this.psi = 0;
    this.vx = 0; this.vy = 0; this.r = 0;
    this.ax = 0; this.ay = 0; this.axF = 0; this.ayF = 0;
    this.marcha = 1; this.rpm = COCHE.rpmRalenti;
    this.cambioT = 0; this.cambioDestino = 1;
    this.ers = COCHE.ersCapacidad * 0.75;
    this.ersDesplegado = 0; this.ersRecuperado = 0; this.ersPotenciaActual = 0;
    this.drsAbierto = false;
    this.tc = 1;
    this.alturaDel = 0.03; this.alturaTras = 0.07;
    this.cabeceo = 0; this.balanceo = 0; this.vCabeceo = 0; this.vBalanceo = 0;
    this.fondoToca = 0;
    this.vuelo = null; this.volcado = null; this.giroCab = 0; this.giroBal = 0;
    this.proj = { i: -1 };
    this.fueraPista = false;
    this.tiempoParado = 0;
    this.reloj = 0;
    this.embragueAbierto = false;
    this.impacto = 0;
    this.carga = { del: 0, tras: 0, drag: 0 };
    this.vibracion = 0;
    for (const w of this.ruedas) { w.omega = 0; w.tanAlfa = 0; w.kappa = 0; w.factorAbs = 1; }
  }

  colocar(s, d = 0) {
    const c = this.circuito;
    const m = c.muestra(s);
    const nx = -m.tz, nz = m.tx;
    this.x = m.x + nx * d; this.z = m.z + nz * d;
    this.psi = Math.atan2(m.tz, m.tx);
    this.vx = this.vy = this.r = 0;
    this.vuelo = null; this.volcado = null; this.giroCab = 0; this.giroBal = 0;
    this.proj = c.proyectar(this.x, this.z, -1, {});
    this.y = m.y;
    for (const w of this.ruedas) w.omega = 0;
  }

  get masa() { return COCHE.masaSeca - this.ef.kg + this.combustible; }
  get velocidad() { return Math.hypot(this.vx, this.vy); }

  // --- Aerodinámica ---------------------------------------------------------
  _aero() {
    const rg = this.reglaje;
    let clDel = 1.50 + 0.07 * rg.aleronDel;
    let clTras = 2.15 + 0.10 * rg.aleronTras;
    let cdA = 0.80 + 0.03 * rg.aleronTras + 0.012 * rg.aleronDel;
    if (this.drsAbierto) { clTras *= 0.78; cdA -= 0.14; }
    // efecto suelo: sensibilidad a la altura y al cabeceo
    const hDelRef = 0.020 + 0.003 * rg.alturaDel, hTrasRef = 0.055 + 0.004 * rg.alturaTras;
    const hMedia = (this.alturaDel + this.alturaTras) / 2;
    let suelo = clamp(1 + 2.6 * (0.045 - hMedia), 0.86, 1.10);
    if (Math.min(this.alturaDel, this.alturaTras) < 0.004) suelo *= 0.93; // pérdida por contacto del fondo
    clDel *= suelo * clamp(1 + 3.0 * (hDelRef - this.alturaDel), 0.85, 1.18);
    clTras *= suelo * clamp(1 + 1.6 * (hTrasRef - this.alturaTras), 0.88, 1.12);
    clDel *= (1 - 0.35 * this.danoAleron) * this.ef.cl;
    clTras *= (1 - 0.55 * this.dano.aleronTras) * this.ef.cl;
    // fondo y pontones rotos: hasta un 30 % menos de carga y más resistencia
    clDel *= 1 - 0.22 * (this.dano.fondo || 0); clTras *= 1 - 0.30 * (this.dano.fondo || 0);
    cdA = cdA * this.ef.cd + 0.06 * this.dano.aleronTras + 0.03 * this.danoAleron + 0.05 * (this.dano.fondo || 0);
    // aire sucio y rebufo
    clDel *= 1 - 0.24 * this.aireSucio; clTras *= 1 - 0.14 * this.aireSucio;
    cdA *= 1 - 0.28 * this.rebufo;
    // viento: la aerodinámica trabaja con la velocidad del aire, no con la del coche
    const cs = Math.cos(this.psi), sn = Math.sin(this.psi), wv = this.viento;
    const vaL = this.vx - (wv ? wv.x * cs + wv.z * sn : 0);          // de cara: más carga y más resistencia
    const vaT = this.vy - (wv ? -wv.x * sn + wv.z * cs : 0);         // de lado: empuja y quita carga
    this.vientoLat = vaT;
    const guinada = Math.atan2(Math.abs(vaT), Math.max(5, Math.abs(vaL)));
    const perdida = 1 - Math.min(0.25, 2.2 * guinada * guinada);
    // efecto suelo a alta velocidad: con el coche bajo el fondo rebota (porpoising)
    const bajo = Math.max(0, 0.03 - Math.min(this.alturaDel, this.alturaTras)) / 0.03;
    const rebote = 1 + Math.sin(this.reloj * 2 * Math.PI * 3.2) * 0.06 * bajo * Math.max(0, Math.min(1, (vaL - 70) / 20));
    this.porpoising = (rebote - 1) * 10;
    const v = Math.max(0, vaL);
    const q = 0.5 * RHO_AIRE * v * v;
    this.carga.del = q * clDel * perdida * rebote; this.carga.tras = q * clTras * perdida * rebote; this.carga.drag = 0.5 * RHO_AIRE * cdA * vaL * Math.abs(vaL);
    this.carga.balance = clDel / (clDel + clTras);
  }

  // --- Paso de integración -------------------------------------------------
  paso(dt) {
    this.reloj += dt;
    if (this.vuelo || this.volcado) { this._pasoSinRuedas(dt); return; }
    const c = this.circuito;
    const m = this.masa;
    const cos = Math.cos(this.psi), sin = Math.sin(this.psi);
    const p = c.proyectar(this.x, this.z, this.proj.i, this.proj);
    const mand = this.mandos;
    const v = this.velocidad;

    // DRS: se cierra al frenar
    if (mand.freno > 0.08 || !this.drsPermitido) this.drsAbierto = false;
    else if (mand.drs && this.drsPermitido) this.drsAbierto = true;

    // el depósito va detrás del centro de gravedad: lleno, el coche carga más atrás
    { const L0 = COCHE.wheelbase, rep = (COCHE.repartoDel * (m - this.combustible) + (COCHE.repartoDel - 0.25 / L0) * this.combustible) / m;
      this.b = L0 * rep; this.a = L0 * (1 - rep); }
    this._aero();

    // --- Cargas verticales ------------------------------------------------
    // componente vertical incluyendo cambios de rasante
    const pendCoche = p.pendiente * (cos * p.tx + sin * p.tz);
    const gVert = m * (G + Math.max(-G * 0.8, this.vx * this.vx * p.curvVert));
    const L = COCHE.wheelbase;
    const fzDelEst = gVert * this.b / L, fzTrasEst = gVert * this.a / L;
    const h = COCHE.alturaCG;
    const transLong = m * this.axF * h / L; // positiva al acelerar (carga atrás)
    const kDel = 0.35 + 0.065 * this.reglaje.barraDel, kTras = 0.35 + 0.065 * this.reglaje.barraTras;
    const repBal = kDel / (kDel + kTras);
    const hRc = (COCHE.centroBalanceoDel * this.b + COCHE.centroBalanceoTras * this.a) / L;
    const fLat = m * this.ayF;
    // ay > 0 (aceleración a la derecha) carga las ruedas izquierdas
    const dLatDel = fLat * (COCHE.centroBalanceoDel * this.b / L + (h - hRc) * repBal) / COCHE.viaDel;
    const dLatTras = fLat * (COCHE.centroBalanceoTras * this.a / L + (h - hRc) * (1 - repBal)) / COCHE.viaTras;
    const ejeDel = fzDelEst + this.carga.del - transLong;
    const ejeTras = fzTrasEst + this.carga.tras + transLong;
    const fz = [ejeDel / 2 + dLatDel, ejeDel / 2 - dLatDel, ejeTras / 2 + dLatTras, ejeTras / 2 - dLatTras];

    // Alturas libres (heave + cabeceo) a partir de la carga añadida en cada eje
    const rg = this.reglaje;
    const h0Del = 0.020 + 0.003 * rg.alturaDel, h0Tras = 0.055 + 0.004 * rg.alturaTras;
    const extraDel = ejeDel - m * G * this.b / L, extraTras = ejeTras - m * G * this.a / L;
    const objDel = h0Del - extraDel / COCHE.muelleDel;
    const objTras = h0Tras - extraTras / COCHE.muelleTras;
    const kSusp = Math.min(1, dt / 0.045);
    this.alturaDel += (objDel - this.alturaDel) * kSusp;
    this.alturaTras += (objTras - this.alturaTras) * kSusp;
    this.fondoToca = 0;
    let rozFondo = 0;
    if (this.dano.pinchazo.some((x, k) => x && !this.dano.suelta[k]) && v > 25) this.fondoToca = Math.max(this.fondoToca, 0.35); // llanta rozando
    if (this.alturaDel < 0.002 || this.alturaTras < 0.002) {
      const pen = Math.max(0.002 - this.alturaDel, 0.002 - this.alturaTras);
      this.fondoToca = Math.min(1, pen * 300);
      rozFondo = 0.35 * Math.min(m * G, pen * 400000);
      this.alturaDel = Math.max(0, this.alturaDel); this.alturaTras = Math.max(0, this.alturaTras);
    }
    // ángulos visibles de cabeceo y balanceo (oscilador amortiguado)
    // el cabeceo sale de la diferencia de alturas de los ejes (más un poco de flexión del chasis):
    // un F1 apenas se inclina 1-2° al frenar; más haría que el morro tocara el suelo
    const objCab = clamp(-(this.axF * m * h) / COCHE.rigidezCabeceo * 0.25 + (this.alturaTras - this.alturaDel - (h0Tras - h0Del)) / L, -0.02, 0.026);
    const objBal = (this.ayF * m * (h - hRc)) / COCHE.rigidezBalanceoTotal / ((kDel + kTras) / 1.1);
    this.vCabeceo += ((objCab - this.cabeceo) * 900 - this.vCabeceo * 38) * dt;
    this.cabeceo += this.vCabeceo * dt;
    this.vBalanceo += ((objBal - this.balanceo) * 700 - this.vBalanceo * 34) * dt;
    this.balanceo += this.vBalanceo * dt;

    // --- Dirección --------------------------------------------------------
    let dir = clamp(mand.direccion, -1, 1);
    let angMax = COCHE.angMaxRueda;
    if (this.ayudas.direccion && !this.esIA) {
      // limita el giro al ángulo útil para la velocidad (evita sobrevirar con el móvil)
      const kA = 0.5 * RHO_AIRE * 4.6 / m;
      const aLat = 1.7 * (G + kA * v * v);
      const util = COCHE.wheelbase * aLat / Math.max(1, v * v) + 0.075;
      angMax = Math.min(angMax, Math.max(0.05, util));
    }
    let delta = dir * angMax;
    if (this.ayudas.estabilidad && this.vx > 5) {
      const beta = Math.atan2(this.vy, this.vx);
      delta += clamp(beta * 0.6, -0.1, 0.1);
    }
    const ack = COCHE.ackermann * delta * Math.abs(delta) / Math.max(1e-3, COCHE.angMaxRueda);
    this.ruedas[0].angulo = delta + (delta > 0 ? -ack : ack) * 0.5;
    this.ruedas[1].angulo = delta + (delta > 0 ? ack : -ack) * 0.5;
    this.ruedas[2].angulo = 0; this.ruedas[3].angulo = 0;
    // suspensión doblada: la rueda queda torcida (el coche tira hacia un lado)
    for (const w of this.ruedas) { const sd = this.dano.susp[w.idx]; if (sd > 0) w.angulo += sd * 0.04 * (w.izquierda ? 1 : -1); }
    this.anguloVolante = delta;

    // --- Tren motriz ------------------------------------------------------
    let acel = clamp(mand.acelerador, 0, 1);
    let freno = clamp(mand.freno, 0, 1);
    this._cajaAutomatica(dt, acel, freno, v);
    if (this.marcha === -1) { const t = acel; acel = freno * 0.35; freno = t * 0.6; }
    if (this.ayudas.estabilidad && Math.abs(Math.atan2(this.vy, Math.max(1, this.vx))) > 0.14) acel *= 0.6;
    acel *= this.tc;
    // limitador de velocidad de la calle de boxes (80 km/h)
    if (this.limitadorPit) acel = Math.min(acel, clamp((this.limitePit - this.vx) * 0.6, 0, 1));
    if (this.limiteVsc > 0) acel = Math.min(acel, clamp((this.limiteVsc - this.vx) * 0.4, 0, 1));
    // ritmo neutralizado (VSC, Safety Car, formación): frena solo si va claramente por encima
    if (this.limiteVsc > 0 && this.vx > this.limiteVsc + 2) freno = Math.max(freno, clamp((this.vx - this.limiteVsc - 2) * 0.2, 0, 1));
    const relacion = this.marcha > 0 ? COCHE.relaciones[this.marcha - 1] : (this.marcha < 0 ? COCHE.relacionReversa : 0);
    const rl = this.ruedas[2], rr = this.ruedas[3];
    const omegaEje = (rl.omega + rr.omega) / 2;
    const rpmRuedas = omegaEje * relacion / RPM_A_RAD;
    const cambiando = this.cambioT > 0;
    let parCig = 0; let embragado = false;
    if (relacion !== 0 && !cambiando) {
      if (rpmRuedas >= COCHE.rpmEmbrague) {
        embragado = true;
        this.rpm = rpmRuedas;
      } else if (acel > 0.02) {
        // embrague patinando (salida / muy baja velocidad)
        const objetivo = COCHE.rpmEmbrague + 3500 * acel;
        this.rpm += (objetivo - this.rpm) * Math.min(1, dt * 8);
      } else {
        this.rpm += (COCHE.rpmRalenti - this.rpm) * Math.min(1, dt * 4);
      }
    } else {
      const objetivo = COCHE.rpmRalenti + (COCHE.rpmLimite - COCHE.rpmRalenti) * acel;
      this.rpm += (objetivo - this.rpm) * Math.min(1, dt * (acel > 0 ? 9 : 3));
      if (cambiando && relacion !== 0) this.rpm = Math.max(COCHE.rpmRalenti, rpmRuedas);
    }
    this.limitador = false;
    if (relacion !== 0 && !cambiando && (embragado || acel > 0.02)) {
      const pT = parMotor(this.rpm) * this.ef.potencia * (1 - 0.35 * (this.dano.motor || 0)) * MEZCLA_POT[mand.mezcla ?? 1];
      const fm = COCHE.frenoMotor[0] + COCHE.frenoMotor[1] * this.rpm;
      parCig = pT * acel - fm * (1 - acel) * (embragado ? 1 : 0);
      if (this.rpm > COCHE.rpmLimite) { parCig = Math.min(parCig, -fm); this.limitador = true; }
    }
    // ERS (MGU-K): despliegue y recuperación
    this.ersPotenciaActual = 0;
    const wCig = Math.max(100, this.rpm * RPM_A_RAD);
    const modo = mand.ersModo ?? 1; // 0 recarga, 1 normal, 2 adelantar
    // en modo normal se guarda una reserva para poder adelantar o defenderse
    const reserva = modo === 2 ? 0 : COCHE.ersCapacidad * 0.2;
    // ERS averiado (sobrecalentado): no despliega hasta que se enfría
    if (this.ersAveriado > 0) this.ersAveriado -= dt;
    if (!(this.ersAveriado > 0) && acel > 0.9 && this.marcha >= 2 && embragado && this.ers > reserva && this.ersDesplegado < COCHE.ersDespliegueVuelta && modo > 0) {
      const pot = COCHE.ersPotencia * this.ef.ers * (modo === 2 ? 1 : 0.5);
      const par = Math.min(COCHE.ersParMax, pot / wCig);
      parCig += par;
      const e = par * wCig * dt;
      this.ers -= e; this.ersDesplegado += e; this.ersPotenciaActual = par * wCig;
    }
    let parRecuperacion = 0;
    if (freno > 0.05 && this.vx > 8 && this.ers < COCHE.ersCapacidad && this.ersRecuperado < COCHE.ersRecuperacionVuelta * this.ef.recuperacion) {
      const pot = COCHE.ersPotencia * Math.min(1, freno * 1.6);
      parRecuperacion = Math.min(1000, pot / Math.max(5, omegaEje));
      const e = parRecuperacion * omegaEje * dt * 0.9;
      this.ers += e; this.ersRecuperado += e; this.ersPotenciaActual = -parRecuperacion * omegaEje;
    } else if (modo === 0 && acel > 0.3 && embragado && this.ers < COCHE.ersCapacidad && this.ersRecuperado < COCHE.ersRecuperacionVuelta * this.ef.recuperacion) {
      const pot = 60000;
      const par = Math.min(120, pot / wCig);
      parCig -= par;
      const e = par * wCig * dt * 0.85;
      this.ers += e; this.ersRecuperado += e; this.ersPotenciaActual = -pot;
    }
    this.ers = clamp(this.ers, 0, COCHE.ersCapacidad);
    // combustible
    this.combustible = Math.max(0, this.combustible - COCHE.consumoMax * Math.max(0.03, acel) * (this.rpm / COCHE.rpmLimite) * MEZCLA_GASTO[this.mandos.mezcla ?? 1] * dt);
    if (this.combustible <= 0) parCig = Math.min(parCig, 0);
    const parEntrada = parCig * relacion * COCHE.eficiencia;
    const inerciaReflejada = embragado ? COCHE.inerciaMotor * relacion * relacion * 0.5 : 0;

    // --- Frenos -----------------------------------------------------------
    // reparto de frenada: el del reglaje más el ajuste que haga el piloto desde el volante
    const reparto = Math.max(45, Math.min(70, rg.repartoFreno + (mand.bb || 0))) / 100;
    const parFreno = COCHE.parFrenoMax * this.ef.freno * freno;

    // --- Ruedas -----------------------------------------------------------
    let fxT = 0, fyT = 0, mzT = 0;
    let deslizMax = 0, bordillo = 0, fuera = 0, superficieMala = 0, salchicha = 0, charcoFuerte = 0, planos = 0;
    const bajoRueda = Math.max(0, 0.03 - Math.min(this.alturaDel, this.alturaTras)) / 0.03;
    const kRelax = 0.38;
    // diferencial autoblocante
    const dOmega = rl.omega - rr.omega;
    const rampa = (parEntrada >= 0 ? rg.difTraccion : rg.difRetencion) / 100;
    const capacidad = 60 + rampa * Math.abs(parEntrada) * 0.9;
    const parDif = clamp(dOmega * 350, -capacidad, capacidad);
    let maxKappaTras = 0;
    const nx = -p.tz, nz = p.tx;
    // agua donde está el coche (la lluvia puede caer solo en una parte del circuito)
    const aguaAqui = (c.agua || 0) * (c.factorAgua ? c.factorAgua(p.s / c.largo) : 1);
    this.aguaAqui = aguaAqui;
    for (let k = 0; k < 4; k++) {
      const w = this.ruedas[k];
      w.fz = Math.max(0, fz[k]);
      // posición en el mundo y superficie
      const ox = cos * w.px - sin * w.py, oz = sin * w.px + cos * w.py;
      w.wx = this.x + ox; w.wz = this.z + oz;
      const along = ox * p.tx + oz * p.tz;
      w.d = p.d + ox * nx + oz * nz;
      const iw = (p.i + Math.round(along / c.paso) + c.n) % c.n;
      w.sup = c.superficie(iw, w.d);
      w.wy = c.y[iw] + c.caida(iw, w.d);
      if (c.enSalchicha?.(iw, w.d)) { salchicha++; w.wy += 0.07; }
      const sp = SUPERFICIES[w.sup];
      if (w.sup !== SUP_ASFALTO && w.sup !== SUP_BORDILLO) fuera++;
      if (w.sup === SUP_BORDILLO) bordillo++;
      if (w.sup > SUP_ESCAPE) superficieMala++;
      // baches de bordillo: carga fluctuante
      if (sp.vib > 0 && v > 3) {
        const fase = Math.sin((p.s + k * 0.7) * (w.sup === SUP_BORDILLO ? 2.6 : 5.1));
        w.fz *= 1 + 0.22 * sp.vib * fase;
      }
      // baches del asfalto: a alta velocidad, con el coche pegado al suelo, se notan mucho más
      if (c.bache && v > 30 && w.sup === SUP_ASFALTO) {
        const b = c.bache(p.s + w.px, w.d), f = Math.min(1, ((v - 30) / 55) ** 2);
        w.fz *= 1 + b * 0.22 * f * (1 + bajoRueda);
        if (b > 0.75 && v > 70 && Math.min(this.alturaDel, this.alturaTras) < 0.018) this.fondoToca = Math.max(this.fondoToca, 0.5 * b);
      }
      // un plano golpea una vez por vuelta de la rueda
      if (w.neum.bloqueo > 0.05 && v > 5) { planos = Math.max(planos, w.neum.bloqueo); w.fz *= 1 + 0.18 * w.neum.bloqueo * Math.sin(w.giro); }
      // velocidad del punto de contacto en ejes coche
      const vcx = this.vx - this.r * w.py;
      const vcy = this.vy + this.r * w.px;
      const ca = Math.cos(w.angulo), sa = Math.sin(w.angulo);
      const vl = vcx * ca + vcy * sa;
      const vt = -vcx * sa + vcy * ca;
      w.vLong = vl; w.vLat = vt;
      // deriva con relajación
      const tanSS = vt / Math.max(Math.abs(vl), 1.0);
      const kr = Math.min(1, (Math.abs(vl) + 1.5) / kRelax * dt);
      w.tanAlfa += (tanSS - w.tanAlfa) * kr;
      const nm = w.neum;
      let mu = muCarga(nm.c.mu, w.fz) * nm.factorAgarre() * sp.mu;
      // agua en la pista (fuera del asfalto, la hierba mojada es una pista de hielo)
      const agua = aguaAqui;
      if (agua > 0) mu *= factorAgua(nm.c, agua) * (w.sup > SUP_ESCAPE ? 1 - 0.35 * agua : 1);
      // neumáticos sucios tras pisar hierba o grava: se limpian rodando unos cientos de metros
      if (w.sup > SUP_ESCAPE && Math.abs(vl) > 2) { w.suciedad = Math.min(1, (w.suciedad || 0) + dt * 1.2); w.sucioHierba = w.sup === SUP_GRAVA ? 0.1 : 0.7; }
      else if (w.suciedad > 0) w.suciedad = Math.max(0, w.suciedad - Math.abs(vl) * dt / (w.sup === SUP_ASFALTO ? 200 : 800));
      if (w.suciedad > 0) mu *= 1 - 0.15 * w.suciedad;
      // la pista gana goma con las vueltas (más agarre en la trazada) y la lluvia se la lleva
      if (w.sup === SUP_ASFALTO) mu *= 0.975 + 0.04 * (c.goma ?? 0.6);
      // canicas fuera de la trazada en seco: casi como pisar rodamientos
      if (w.sup === SUP_ASFALTO && agua < 0.2 && c.enCanicas?.(iw, w.d)) mu *= 0.86;
      // charco: aquaplaning que crece con la velocidad y la profundidad (y menos con los de lluvia)
      w.charco = c.charco ? c.charco(iw, w.d, agua) : 0;
      if (w.charco > 0) {
        const vAqua = nm.c.nombre === 'Lluvia' ? 62 : nm.c.nombre === 'Intermedio' ? 50 : 38;
        const aqua = Math.min(0.88, w.charco * Math.max(0, (v - vAqua * 0.5) / (vAqua * 0.6)) ** 1.6);
        mu *= 1 - aqua;
        if (aqua > 0.3) charcoFuerte = Math.max(charcoFuerte, aqua);
      }
      const den = Math.max(Math.abs(vl), 3);
      let R = w.radio;
      const d = this.dano;
      if (d.susp[k] > 0) mu *= 1 - 0.12 * d.susp[k];
      // pinchazo: llanta casi sin goma, menos radio y mucha resistencia
      if (d.pinchazo[k]) { mu *= 0.38; R *= 0.88; }
      if (!d.pinchazo[k] && nm.desgaste >= 0.985) { d.pinchazo[k] = true; this.eventos.push('dano:pinchazo' + k); }
      if (d.suelta[k]) {
        // sin rueda: la esquina del coche arrastra por el suelo
        const vcx2 = this.vx - this.r * w.py, vcy2 = this.vy + this.r * w.px;
        const vv = Math.hypot(vcx2, vcy2);
        const fr = vv > 0.05 ? Math.min(0.9 * Math.max(0, w.fz), vv * 4000) : 0;
        const fxc = vv > 0.05 ? -vcx2 / vv * fr : 0, fyc = vv > 0.05 ? -vcy2 / vv * fr : 0;
        fxT += fxc; fyT += fyc; mzT += w.px * fyc - w.py * fxc;
        w.fx = 0; w.fy = 0; w.omega = 0; w.deslizamiento = vv; w.sigma = 0;
        if (vv > 8) this.fondoToca = Math.max(this.fondoToca, 0.8);
        continue;
      }
      // pares en la rueda
      let parMotriz = 0, parFr = 0;
      if (!w.delantera) {
        parMotriz = parEntrada / 2 + (k === 2 ? -parDif : parDif);
        parFr = parFreno * (1 - reparto) / 2 + parRecuperacion / 2;
      } else {
        parFr = parFreno * reparto / 2;
      }
      // ABS
      if (this.ayudas.abs && parFr > 0) {
        const lim = -nm.picoKappa * 1.05;
        if (w.kappa < lim) w.factorAbs = Math.max(0.2, w.factorAbs - dt * 25);
        else w.factorAbs = Math.min(1, w.factorAbs + dt * 10);
        parFr *= w.factorAbs;
      }
      // fading por temperatura de los discos
      const tf = w.tFreno;
      const fade = tf < COCHE.frenoTempOpt[0] ? 0.72 + 0.28 * tf / COCHE.frenoTempOpt[0]
        : tf > COCHE.frenoTempOpt[1] ? Math.max(0.6, 1 - (tf - COCHE.frenoTempOpt[1]) / 900) : 1;
      parFr *= fade;
      // resistencia a la rodadura como par resistente
      parFr += w.fz * (COCHE.rodadura + sp.rod + (d.pinchazo[k] ? 0.07 : 0)) * R;
      const iEff = COCHE.inerciaRueda + (w.delantera ? 0 : inerciaReflejada);
      // fuerza y su derivada respecto a ω (rueda semi-implícita)
      w.kappa = clamp((w.omega * R - vl) / den, -1, 4);
      fuerzasNeumatico(w.kappa, w.tanAlfa, w.fz, mu, nm.picoKappa, nm.picoAlfa, tmpF);
      const eps = 0.002;
      fuerzasNeumatico(w.kappa + eps, w.tanAlfa, w.fz, mu, nm.picoKappa, nm.picoAlfa, tmpF2);
      const kOm = Math.max(0, (tmpF2.fx - tmpF.fx) / eps * R / den);
      const dEn = iEff + dt * R * kOm;
      const omLibre = w.omega + dt * (parMotriz - tmpF.fx * R) / dEn;
      const dFr = parFr * dt / dEn;
      let omNueva;
      if (Math.abs(omLibre) <= dFr) omNueva = 0;
      else omNueva = omLibre - Math.sign(omLibre) * dFr;
      let fxw = tmpF.fx + kOm * (omNueva - w.omega); // linealización
      const lim = mu * w.fz;
      fxw = clamp(fxw, -lim, lim);
      const fyw = tmpF.fy;
      w.omega = omNueva;
      w.sigma = tmpF.sigma;
      w.giro += w.omega * dt;
      w.fx = fxw; w.fy = fyw;
      // temperatura de frenos
      const potFreno = parFr * Math.abs(w.omega);
      // detrás de otro coche entra aire caliente y menos caudal: los frenos se recalientan
      // los discos de carbono se calientan en una frenada fuerte y tardan en enfriarse (masa
      // grande, poco aire en las curvas lentas): siguen al rojo un buen rato tras frenar
      w.tFreno += (potFreno * 1.15 - (12 + 1.1 * v) * 0.95 * this.ef.refrigeracion * (1 - 0.45 * this.aireSucio) * (w.tFreno - this.tAmb)) / 1500 * dt;
      // potencia disipada en el contacto
      const vDesl = Math.hypot(w.omega * R - vl, vt);
      w.deslizamiento = vDesl;
      if (vDesl > deslizMax && w.sigma > 1.0) deslizMax = vDesl;
      // el agua enfría la goma: los lisos en mojado no llegan a temperatura y los de lluvia en seco se cuecen
      nm.termico(dt, Math.abs(fxw) * Math.abs(w.omega * R - vl) + Math.abs(fyw * vt), w.fz, Math.abs(vl), this.tAmb - 12 * agua, agua);
      if (!w.delantera) maxKappaTras = Math.max(maxKappaTras, w.kappa / nm.picoKappa);
      // plano: rueda bloqueada (gira casi nada) arrastrándose por el asfalto
      if (v > 12 && Math.abs(w.omega * R) < 0.15 * Math.abs(vl) && w.sup <= SUP_BORDILLO && w.fz > 500) {
        const antes = nm.bloqueo;
        nm.bloqueo = Math.min(1, nm.bloqueo + dt * Math.abs(vl) * 0.0045 * (1 - 0.6 * agua));
        if (antes < 0.25 && nm.bloqueo >= 0.25) this.eventos.push('plano' + k);
      }
      // a ejes del coche
      const fxc = fxw * ca - fyw * sa;
      const fyc = fxw * sa + fyw * ca;
      fxT += fxc; fyT += fyc;
      mzT += w.px * fyc - w.py * fxc;
    }
    // control de tracción: limita el deslizamiento de las traseras
    if (this.ayudas.tc > 0) {
      const umbral = 1.0 + 0.35 * (3 - this.ayudas.tc);
      if (maxKappaTras > umbral) this.tc = Math.max(0.15, this.tc - dt * 14);
      else this.tc = Math.min(1, this.tc + dt * 3.5);
    } else this.tc = 1;

    // --- Fuerzas externas ---------------------------------------------------
    fxT -= this.carga.drag;
    fxT -= m * G * pendCoche;
    // viento lateral: empuja el coche y lo gira (el centro de presión va detrás del de gravedad)
    if (this.viento) { const fv = -0.5 * RHO_AIRE * 1.9 * this.vientoLat * Math.abs(this.vientoLat); fyT += fv; mzT += fv * -0.35; }
    if (rozFondo > 0) fxT -= Math.sign(this.vx) * rozFondo;
    // --- Integración ------------------------------------------------------
    const axc = fxT / m, ayc = fyT / m;
    this.vx += (axc + this.r * this.vy) * dt;
    this.vy += (ayc - this.r * this.vx) * dt;
    this.r += mzT / COCHE.inerciaYaw * dt;
    // un monoplaza en trompo no pasa de ~1 vuelta por segundo (con una rueda arrancada el modelo se dispara)
    if (this.r > 6) this.r = 6; else if (this.r < -6) this.r = -6;
    // a muy baja velocidad sin gas: el coche se detiene del todo
    if (v < 0.4 && acel < 0.02 && freno > 0.05) { this.vx *= 0.9; this.vy *= 0.9; this.r *= 0.9; }
    if (this.retenido || this.abandono) { this.vx *= 0.8; this.vy *= 0.8; this.r *= 0.8; }
    this.x += (this.vx * cos - this.vy * sin) * dt;
    this.z += (this.vx * sin + this.vy * cos) * dt;
    this.psi += this.r * dt;
    this.ax = axc; this.ay = ayc;
    const kf = Math.min(1, dt / 0.07);
    this.axF += (axc - this.axF) * kf;
    this.ayF += (ayc - this.ayF) * kf;

    // altura del coche (media de las ruedas)
    let ys = 0; for (const w of this.ruedas) ys += w.wy; this.y = ys / 4;
    this.fueraPista = fuera === 4;
    this.limitesExcedidos = fuera === 4;
    this.enBordillo = bordillo > 0;
    this.enTierra = superficieMala > 0;
    if (charcoFuerte > 0 && !this._aquaplaning) this.eventos.push('aquaplaning');
    this._aquaplaning = charcoFuerte > 0;
    this.deslizMax = deslizMax;
    this.vibracion = bordillo * 0.25 + superficieMala * 0.2 + this.fondoToca + salchicha * 0.5 + planos * 0.35;
    // bordillo alto (salchicha): el coche salta, se descoloca y, deprisa, rompe el fondo
    this._tSalchicha = Math.max(0, (this._tSalchicha || 0) - dt);
    if (salchicha && this._tSalchicha <= 0 && v > 6) {
      this._tSalchicha = 0.14;
      const f = Math.min(1, v / 45);
      this.r += (Math.random() - 0.5) * 0.9 * f;
      this.vy += (Math.random() - 0.5) * 2.2 * f;
      this.vx *= 1 - 0.03 * f;
      if (v > 28) { this.fuenteGolpe = 'salchicha'; this.aplicarGolpe(0.2, 0, 3.5 + v * 0.08); }
      this.eventos.push('golpe:' + (2 + f * 4).toFixed(1));
    }

    this._muros(dt);
    if (this.r > 6) this.r = 6; else if (this.r < -6) this.r = -6;

    if (v < 0.5) this.tiempoParado += dt; else this.tiempoParado = 0;
    if (this.terminal && !this.abandono) {
      this.tTerminal += dt;
      if (v < 3 || this.tTerminal > 5) { this.abandono = true; this.eventos.push('abandono'); }
    }
  }

  /**
   * Choque rueda con rueda: la rueda de atrás trepa por la de delante y el coche sale despedido.
   * vh: velocidad vertical (m/s); wCab, wBal, wYaw: giros (rad/s) de cabeceo, balanceo y guiñada.
   */
  despegar(vh, wCab, wBal, wYaw = 0) {
    if (this.volcado) return;
    if (this.vuelo) { this.vuelo.vh = Math.max(this.vuelo.vh, vh); return; }
    this.vuelo = { h: 0.02, vh, cab: 0, wCab, bal: 0, wBal, botes: 0 };
    this.r += wYaw;
    this.eventos.push('despegue');
  }

  // En el aire (o volcado, arrastrándose sobre el morro y el arco antivuelco): sin agarre de
  // los neumáticos; solo gravedad, aire y el roce con el suelo al caer.
  _pasoSinRuedas(dt) {
    const c = this.circuito, f = this.vuelo, vol = this.volcado;
    const v = this.velocidad;
    // aire (frena poco) y, en el suelo, el roce de la carrocería contra el asfalto
    let dec = 0.5 * RHO_AIRE * 1.3 * v / this.masa;
    const enSuelo = !f || f.h <= 0.02;
    if (enSuelo && v > 0.01) dec += (vol ? 5.5 : 3.5) / v;
    const k = Math.max(0, 1 - dec * dt);
    this.vx *= k; this.vy *= k;
    this.r *= 1 - Math.min(1, (enSuelo ? 2.5 : 0.25) * dt);
    const vx0 = this.vx;
    this.vx += this.r * this.vy * dt;
    this.vy -= this.r * vx0 * dt;
    const cos = Math.cos(this.psi), sin = Math.sin(this.psi);
    this.x += (this.vx * cos - this.vy * sin) * dt;
    this.z += (this.vx * sin + this.vy * cos) * dt;
    this.psi += this.r * dt;
    this.ax = this.ay = 0;
    this.axF *= 0.9; this.ayF *= 0.9;
    this.proj = c.proyectar(this.x, this.z, this.proj.i, this.proj);
    const suelo = c.y[this.proj.i] + c.caida(this.proj.i, this.proj.d);
    // las ruedas siguen girando en el aire y el motor, sin carga, se revoluciona
    for (const w of this.ruedas) { w.omega *= 1 - 0.4 * dt; w.giro = (w.giro + w.omega * dt) % (Math.PI * 2); w.wy = suelo; }
    const acel = this.mandos.acelerador || 0;
    this.rpm += ((this.abandono ? 0 : acel > 0.1 ? COCHE.rpmLimite : COCHE.rpmRalenti) - this.rpm) * Math.min(1, dt * 6);
    this.vibracion = enSuelo ? 0.6 : 0;
    this.fueraPista = false; this.enBordillo = false; this.enTierra = false;
    if (f) {
      f.vh -= G * dt; f.h += f.vh * dt;
      f.cab += f.wCab * dt; f.bal += f.wBal * dt;
      // la carrocería frena un poco los giros en el aire
      f.wCab *= 1 - 0.15 * dt; f.wBal *= 1 - 0.15 * dt;
      if (f.h <= 0 && f.vh < 0) this._aterrizar(f);
      if (this.vuelo) { this.giroCab = f.cab; this.giroBal = f.bal; }
      // h es la holgura del punto más bajo: girado, el morro o el costado bajan más que las ruedas
      const sc = Math.abs(Math.sin(f.cab)), cc = Math.abs(Math.cos(f.cab)), sb = Math.abs(Math.sin(f.bal)), cb = Math.abs(Math.cos(f.bal));
      this.y = suelo + Math.max(0, f.h) + (2.4 * sc + 0.9 * sb * cc + 0.45 * cc * cb) - PIVOTE_VUELO;
    } else {
      this.giroCab = vol.cab; this.giroBal = vol.bal;
      this.y = suelo + 0.1;
    }
    this._muros(dt);
    if (this.r > 6) this.r = 6; else if (this.r < -6) this.r = -6;
    const v2 = this.velocidad;
    if (v2 < 0.5) this.tiempoParado += dt; else this.tiempoParado = 0;
    if (this.terminal && !this.abandono) {
      this.tTerminal += dt;
      if (!this.vuelo && (v2 < 3 || this.tTerminal > 6)) { this.abandono = true; this.eventos.push('abandono'); }
    }
  }

  _aterrizar(f) {
    const golpe = -f.vh;
    const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    f.cab = norm(f.cab); f.bal = norm(f.bal);
    const arriba = Math.cos(f.cab) * Math.cos(f.bal);        // 1 = sobre las ruedas, -1 = boca abajo
    f.h = 0; f.botes++;
    this.fuenteGolpe = 'vuelo';
    this.eventos.push('golpe:' + Math.min(9, 2 + golpe * 0.6).toFixed(1));
    // el golpe contra el suelo se lleva velocidad
    const roce = arriba > 0.5 ? 0.9 : 0.72;
    this.vx *= roce; this.vy *= roce;
    if (arriba > 0.5) {
      // cae sobre las ruedas: suspensión, alerones y fondo sufren según la altura de la caída
      if (golpe > 13 && !this.dano.desintegrado) this.desintegrar(-2, 0, golpe * 2.2);
      this.aplicarGolpe(1.4, f.bal > 0 ? 1 : -1, golpe * 1.4 + 2);
      this.aplicarGolpe(-1.6, f.bal > 0 ? -1 : 1, golpe * 1.2 + 2);
      if (golpe > 3.5 && f.botes < 4) { f.vh = golpe * 0.32; f.wCab *= 0.35; f.wBal *= 0.35; return; }
      // asentado (media vuelta de cabeceo más media de balanceo = de pie mirando hacia atrás)
      if (Math.cos(f.cab) < 0 && Math.cos(f.bal) < 0) { this.psi += Math.PI; this.vx = -this.vx; this.vy = -this.vy; }
      this.vuelo = null; this.giroCab = 0; this.giroBal = 0;
      this.vCabeceo = -golpe * 0.2; this.vBalanceo = f.bal * 3;
      this.r += f.wBal * 0.1;
      return;
    }
    // de lado o boca abajo: el coche está destrozado
    if (!this.terminal) { this.terminal = true; this.tTerminal = 0; this.motivoAbandono = 'Vuelco'; }
    this.danoAleron = 1;
    const d = this.dano;
    d.aleronTras = Math.min(1, d.aleronTras + 0.6); d.fondo = 1; d.piezas = 1;
    if (d.zona) for (const k in d.zona) d.zona[k] = Math.max(d.zona[k], 1.2);
    if (golpe > 2.5 && f.botes < 6) {
      // rebota y sigue dando vueltas
      f.vh = golpe * 0.42; f.wCab *= 0.6; f.wBal = f.wBal * 0.6 + (Math.random() - 0.5) * 3;
      return;
    }
    // queda quieto sobre el arco antivuelco (boca abajo) o vuelve a caer sobre las ruedas
    this.vuelo = null;
    if (arriba < -0.2 && Math.cos(f.cab) < 0 && Math.cos(f.bal) < 0) { this.psi += Math.PI; this.vx = -this.vx; this.vy = -this.vy; }
    if (arriba < -0.2) this.volcado = { cab: Math.abs(f.cab) > Math.PI / 2 ? Math.PI : 0, bal: Math.abs(f.cab) > Math.PI / 2 ? 0 : Math.PI };
    else { this.giroCab = 0; this.giroBal = 0; }
  }

  _cajaAutomatica(dt, acel, freno, v) {
    if (this.cambioT > 0) {
      this.cambioT -= dt;
      if (this.cambioT <= 0) { this.marcha = this.cambioDestino; this.cambioT = 0; this.eventos.push('cambio'); }
      return;
    }
    // marcha atrás automática: freno mantenido con el coche parado
    if (this.ayudas.cambioAuto || this.esIA) {
      if (this.marcha === -1) {
        if (acel > 0.1 && v < 2) { this.marcha = 1; }
        return;
      }
      if (v < 0.6 && freno > 0.5 && acel < 0.05 && this.vx < 0.5 && !this.retenido && !this.abandono && !this.esIA) {
        this._tReversa = (this._tReversa || 0) + dt;
        if (this._tReversa > 0.8) { this.marcha = -1; this._tReversa = 0; return; }
      } else this._tReversa = 0;
      if (this.marcha < 1) { this.marcha = 1; return; }
      const rpm = this.rpm;
      const patina = Math.max(this.ruedas[2].kappa, this.ruedas[3].kappa) > 0.3;
      if (rpm > 14650 && this.marcha < 8 && acel > 0.2 && !patina) this.cambiar(1);
      else if (this.marcha > 1) {
        const rpmAbajo = rpm * COCHE.relaciones[this.marcha - 2] / COCHE.relaciones[this.marcha - 1];
        const umbral = freno > 0.1 ? 13600 : 12200;
        if (rpmAbajo < umbral && rpm < 11000) this.cambiar(-1);
      }
    }
  }

  cambiar(dir) {
    if (this.cambioT > 0 || this.cajaBloqueada) return;
    if (dir > 0 && this.marcha < 8) {
      if (this.marcha === -1) { this.marcha = 1; return; }
      this.cambioDestino = this.marcha + 1; this.cambioT = COCHE.tiempoCambioSubir;
    } else if (dir < 0) {
      if (this.marcha === 1) {
        if (this.velocidad < 1) this.marcha = -1;
        return;
      }
      if (this.marcha <= 0) return;
      // protección contra pasarse de vueltas al reducir
      const rpmAbajo = this.rpm * COCHE.relaciones[this.marcha - 2] / COCHE.relaciones[this.marcha - 1];
      if (rpmAbajo > COCHE.rpmLimite - 150) { this.eventos.push('reduccionDenegada'); return; }
      this.cambioDestino = this.marcha - 1; this.cambioT = COCHE.tiempoCambioBajar;
    }
  }

  // Colisión con los muros: rectángulo del coche contra los límites laterales
  _muros(dt) {
    const c = this.circuito;
    const cos = Math.cos(this.psi), sin = Math.sin(this.psi);
    const p = this.proj;
    const nx = -p.tz, nz = p.tx;
    const esquinas = [[2.75, -0.95], [2.75, 0.95], [-2.4, -0.85], [-2.4, 0.85], [0.6, -1.0], [0.6, 1.0]];
    this.impacto = 0;
    this._peor = null;
    if (!this.golpesMuro || this.golpesMuro.length > 20) this.golpesMuro = [];
    for (const [ex, ey] of esquinas) {
      const ox = cos * ex - sin * ey, oz = sin * ex + cos * ey;
      const along = ox * p.tx + oz * p.tz;
      const d = p.d + ox * nx + oz * nz;
      const i = (p.i + Math.round(along / c.paso) + c.n) % c.n;
      const lado = d >= 0 ? 1 : 0;
      const lim = c.muro[lado][i];
      let pen = Math.abs(d) - lim;
      let sg = d >= 0 ? -1 : 1;            // normal hacia el interior de la pista
      // muro de boxes entre la pista y el carril (se choca desde los dos lados)
      if (c.hayMuroPit(i)) {
        const hw = c.semiAncho[i], m0 = hw + c.pit.muroDe, m1 = hw + c.pit.muroA;
        if (p.d < (m0 + m1) / 2) { if (d - m0 > pen) { pen = d - m0; sg = -1; } }
        else if (m1 - d > pen) { pen = m1 - d; sg = 1; }
      }
      if (pen <= 0) continue;
      const wnx = nx * sg, wnz = nz * sg;
      this.x += wnx * pen; this.z += wnz * pen;
      // velocidad del punto en el mundo
      const vwx = this.vx * cos - this.vy * sin, vwz = this.vx * sin + this.vy * cos;
      const pvx = vwx - this.r * oz, pvz = vwz + this.r * ox;
      const vn = pvx * wnx + pvz * wnz;
      if (vn >= 0) continue;
      const m = this.masa, I = COCHE.inerciaYaw;
      const rxn = ox * wnz - oz * wnx;
      // tipo de barrera: neumáticos y TecPro absorben el golpe; el hormigón rebota
      const bar = BARRERAS[c.barrera?.[lado]?.[i] ?? 0] || BARRERAS[0];
      const e = bar.rebote;
      const j = -(1 + e) * vn / (1 / m + rxn * rxn / I);
      // fricción tangencial contra el muro
      const tx = -wnz, tz = wnx;
      const vtg = pvx * tx + pvz * tz;
      const rxt = ox * tz - oz * tx;
      let jt = -vtg / (1 / m + rxt * rxt / I);
      jt = clamp(jt, -0.45 * j, 0.45 * j);
      const jx = wnx * j + tx * jt, jz = wnz * j + tz * jt;
      const nvx = vwx + jx / m, nvz = vwz + jz / m;
      this.r += (ox * jz - oz * jx) / I;
      this.vx = nvx * cos + nvz * sin;
      this.vy = -nvx * sin + nvz * cos;
      const golpe = -vn;
      this.impacto = Math.max(this.impacto, golpe);
      if (golpe > (this._peor?.v || 0)) this._peor = { ex, ey, v: golpe * bar.dano, bruto: golpe, x: this.x + ox, z: this.z + oz, lado, i, tipo: c.barrera?.[lado]?.[i] ?? 0, d: lim * (lado ? 1 : -1) };
    }
    if (this._peor) {
      this.fuenteGolpe = 'muro'; this.aplicarGolpe(this._peor.ex, this._peor.ey, this._peor.v);
      // golpe muy fuerte de lado o de esquina (no de frente): la rueda se clava en el muro y el
      // coche se levanta y da vueltas de campana
      const pe = this._peor;
      if (pe.bruto > 24 && Math.abs(pe.ey) > 0.5 && !this.vuelo && !this.volcado && Math.random() < 0.55) {
        const lado = Math.sign(pe.ey);
        this.despegar(2 + pe.bruto * 0.07, (Math.random() - 0.5) * 2.5, -lado * (2.5 + Math.random() * 3), (Math.random() - 0.5) * 1.5);
      }
      // para los efectos: marca en el muro, neumáticos sueltos de la barrera, chispas
      // (como mucho ~8 por segundo al ir rozando el muro: cada una deforma la barrera)
      if (this._peor.bruto > 2.5 && (this.reloj - (this._tMarca ?? -9) > 0.12 || this._peor.bruto > (this._bMarca || 0) + 3)) {
        this.golpesMuro.push(this._peor); this._tMarca = this.reloj; this._bMarca = this._peor.bruto;
      }
    }
    if (this.impacto > 2) this.eventos.push('golpe:' + this.impacto.toFixed(1));
  }

  nuevaVuelta() { this.ersDesplegado = 0; this.ersRecuperado = 0; }

  // Recoloca el coche en la pista (tras un accidente)
  recolocar() {
    const c = this.circuito;
    const s = this.proj.s;
    const d = clamp(this.proj.d, -c.semiAncho[this.proj.i] + 2, c.semiAncho[this.proj.i] - 2);
    this.colocar(s, d * 0.5);
    this.marcha = 1;
  }
}
