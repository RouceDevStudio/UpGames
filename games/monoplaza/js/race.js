// Sesión: parrilla, semáforo, cronometraje por sectores, posiciones, DRS,
// rebufo, contactos entre coches y fantasma de la mejor vuelta.

import { EQUIPOS, COCHE, compuestoParaAgua } from './config.js';
import { Monoplaza } from './physics/monoplaza.js';
import { PilotoIA, PilotoBox } from './ai.js';
import { Clima } from './clima.js';

const AVISOS_LIMITES = 3;          // a la cuarta salida de pista, +5 s
const PENALIZACION = 5;

const DT = 1 / 300;
// sitio frente a su garaje para los coches que ya terminaron
const c0Retiro = (c, p) => c.pit.garajes[(p.indiceEquipo ?? 0) % c.pit.garajes.length] + (p.numeroPiloto ? -6 : 0);
const HABILIDAD = { facil: [0.9, 0.93], normal: [0.94, 0.97], dificil: [0.97, 1.0], extremo: [1.0, 1.03] };

export class Sesion {
  constructor(circuito, opc) {
    this.c = circuito;
    this.modo = opc.modo;           // 'carrera' | 'contrarreloj' | 'practica'
    this.vueltasTotales = opc.vueltas || 5;
    // resistencia: carrera por tiempo (s); termina cuando el líder cruza la meta tras agotarse
    this.tiempoLimite = this.modo === 'carrera' && opc.tiempoLimite ? opc.tiempoLimite : 0;
    if (this.tiempoLimite) this.vueltasTotales = Math.ceil(this.tiempoLimite / Math.max(40, circuito.def.ritmoIA || 80)) + 2;
    this.tiempo = 0;
    this.acumulado = 0;
    this.estado = this.modo === 'carrera' ? 'parrilla' : 'pista';
    this.luces = 0;
    this.tLuces = 0;
    this.eventos = [];
    this.participantes = [];
    this.fantasma = opc.fantasma || null;
    this.grabacion = [];
    this.tGrab = 0;
    // clima (determinista con la semilla) y estado de la pista
    this.clima = new Clima(opc.clima || 'seco', opc.semilla ?? Math.floor(Math.random() * 1e9));
    circuito.agua = this.clima.agua;
    // banderas: amarillas por zona, coche de seguridad virtual y sanciones
    this.amarillas = [];           // { s, hasta }
    this.vsc = false; this.tVsc = 0;
    this.permitirVsc = opc.vsc !== false && this.modo === 'carrera';
    this.tasaAverias = this.modo === 'carrera' && !opc.multijugador ? (opc.averias ?? 1) : 0;

    const mp = opc.multijugador || null;
    this.mp = mp;
    // coche de seguridad real, bandera roja y vuelta de formación (sólo contra la IA)
    this.permitirSc = this.permitirVsc && !mp;
    this.sc = null;
    this.abandonosRecientes = [];
    this.formacion = this.modo === 'carrera' && !mp && !!opc.formacion;
    if (this.formacion) this.estado = 'formacion';
    // en resistencia se reposta en cada parada: se sale con el depósito para ~25 vueltas
    this.depositoMax = this.tiempoLimite ? Math.min(110, 12 + 25 * 1.45) : 0;
    const combustible = this.tiempoLimite ? this.depositoMax : this.modo === 'carrera' ? 12 + this.vueltasTotales * 1.45 : 20;
    const plantilla = () => ({
      vuelta: 0, tVuelta: 0, tiempos: [], mejor: Infinity, sectores: [null, null, null],
      mejoresSectores: [Infinity, Infinity, Infinity], tSector: 0, sector: 0,
      valida: true, terminado: false, abandono: false, tTotal: 0, posicion: 1, distancia: 0, drsHabil: false,
      sAnterior: 0, ultimaVuelta: null, box: null, solicitudBox: null, paradas: 0,
      avisosLimites: 0, penalizacion: 0, tUltimaSancion: -99,
    });
    const colocarParrilla = (coche, k) => {
      if (this.modo === 'carrera') coche.colocar(circuito.largo - 12 - 7 * k, k % 2 === 0 ? -2.6 : 2.6);
      else {
        // vuelta de salida lanzada
        coche.colocar(circuito.largo - 700, 0);
        coche.vx = 55; for (const w of coche.ruedas) w.omega = 55 / w.radio;
        coche.marcha = 5; coche.rpm = 11000;
      }
    };
    if (mp) {
      // multijugador: un coche local y los demás llegan por la red
      mp.parrilla.forEach((id, k) => {
        // pilotos de la IA de la partida rápida: los simula el anfitrión y los demás los reciben por la red
        const bot = (mp.bots || []).find(b => b.id === id);
        if (bot) {
          const ie = bot.k % EQUIPOS.length, ip = Math.floor(bot.k / EQUIPOS.length) % 2;
          const coche = new Monoplaza(circuito, { reglaje: { compuesto: this.clima.agua > 0.13 ? compuestoParaAgua(this.clima.agua) : 'medio' }, ayudas: { tc: 2, abs: true, cambioAuto: true }, combustible, ia: true });
          const p = { ...plantilla(), coche, equipo: EQUIPOS[ie], indiceEquipo: ie, numeroPiloto: ip, nombre: EQUIPOS[ie].pilotos[ip], jugador: false, bot: true,
            remoto: !mp.soyHost, idRed: id, ia: mp.soyHost ? new PilotoIA(coche, circuito, bot.hab, 0.3 + Math.random() * 0.5) : null, hab: bot.hab, posicion: k + 1 };
          colocarParrilla(coche, k);
          p.sAnterior = coche.proj.s;
          this.participantes.push(p);
          return;
        }
        const j = mp.jugadores.find(x => x.id === id);
        if (!j) return;
        const local = id === mp.yo;
        const eq = { ...EQUIPOS[k % EQUIPOS.length], nombre: j.nombre, corto: j.nombre.replace('@', '').slice(0, 3).toUpperCase(),
          base: j.equipado?.colores?.base || EQUIPOS[k % EQUIPOS.length].base, acento: j.equipado?.colores?.acento || EQUIPOS[k % EQUIPOS.length].acento,
          tercero: j.equipado?.colores?.tercero || '#ffffff' };
        const coche = new Monoplaza(circuito, {
          reglaje: local ? opc.reglaje : {}, ayudas: local ? opc.ayudas : {}, combustible,
          mejoras: mp.mejoras ? j.mejoras : {}, ia: !local,
        });
        const p = { ...plantilla(), coche, equipo: eq, equipado: j.equipado, nombre: j.nombre, jugador: local, remoto: !local, idRed: id, ia: null, posicion: k + 1 };
        colocarParrilla(coche, k);
        p.sAnterior = coche.proj.s;
        this.participantes.push(p);
      });
    } else if (opc.pilotos) {
      // parrilla decidida fuera (clasificación o campeonato): cada piloto con su equipo y habilidad
      opc.pilotos.forEach((d, k) => {
        const eq = EQUIPOS[d.ie];
        const coche = new Monoplaza(circuito, {
          ia: !d.jugador,
          reglaje: d.jugador ? opc.reglaje : { compuesto: this.clima.agua > 0.13 ? compuestoParaAgua(this.clima.agua) : (opc.reglaje?.compuesto && !['inter', 'lluvia'].includes(opc.reglaje.compuesto) ? opc.reglaje.compuesto : 'medio') },
          ayudas: d.jugador ? opc.ayudas : { tc: 2, abs: true, cambioAuto: true },
          mejoras: d.jugador ? opc.mejoras : {},
          combustible,
        });
        const p = {
          ...plantilla(), coche, equipo: eq, indiceEquipo: d.ie, numeroPiloto: d.ip, idPiloto: d.id,
          equipado: d.jugador ? opc.equipado : null, nombre: d.jugador ? (opc.nombre || 'Tú') : d.nombre,
          jugador: !!d.jugador, posicion: k + 1,
          ia: d.jugador ? null : new PilotoIA(coche, circuito, d.hab, 0.3 + Math.random() * 0.6),
        };
        colocarParrilla(coche, k);
        p.sAnterior = coche.proj.s;
        this.participantes.push(p);
      });
    } else {
      const rivales = this.modo === 'carrera' ? Math.min(opc.rivales ?? 7, EQUIPOS.length * 2 - 1) : 0;
      const total = rivales + 1;
      const posJugador = this.modo === 'carrera' ? Math.min(total, opc.posSalida || Math.ceil(total * 0.6)) : 1;
      const [hMin, hMax] = HABILIDAD[opc.dificultad || 'normal'];
      // asientos: el jugador en el equipo que eligió; los rivales llenan primero un coche por equipo
      const ej = Math.max(0, Math.min(EQUIPOS.length - 1, opc.equipoJugador | 0));
      const asientos = [];
      for (let k = 0; k < EQUIPOS.length; k++) if (k !== ej) asientos.push([k, 0]);
      asientos.push([ej, 1]);
      for (let k = 0; k < EQUIPOS.length; k++) if (k !== ej) asientos.push([k, 1]);
      let iaIdx = 0;
      for (let k = 0; k < total; k++) {
        const esJugador = k === posJugador - 1;
        const [ie, ip] = esJugador ? [ej, 0] : asientos[iaIdx++];
        const eq = EQUIPOS[ie];
        const coche = new Monoplaza(circuito, {
          ia: !esJugador,
          reglaje: esJugador ? opc.reglaje : { compuesto: this.clima.agua > 0.13 ? compuestoParaAgua(this.clima.agua) : (opc.reglaje?.compuesto && !['inter', 'lluvia'].includes(opc.reglaje.compuesto) ? opc.reglaje.compuesto : 'medio') },
          ayudas: esJugador ? opc.ayudas : { tc: 2, abs: true, cambioAuto: true },
          mejoras: esJugador ? opc.mejoras : {},
          combustible,
        });
        // rivales más rápidos delante en la parrilla
        const hab = esJugador ? 1 : hMax - (hMax - hMin) * (k / Math.max(1, total - 1)) + (Math.random() - 0.5) * 0.008;
        const p = {
          ...plantilla(), coche, equipo: eq, indiceEquipo: ie, numeroPiloto: ip,
          equipado: esJugador ? opc.equipado : null,
          nombre: esJugador ? (opc.nombre || 'Tú') : eq.pilotos[ip],
          jugador: esJugador, posicion: k + 1,
          ia: esJugador ? null : new PilotoIA(coche, circuito, hab, 0.3 + Math.random() * 0.6),
        };
        colocarParrilla(coche, k);
        p.sAnterior = coche.proj.s;
        this.participantes.push(p);
      }
    }
    this.participantes.forEach((p, k) => { p.coche.id = k; });
    // desgaste proporcional a la distancia: una carrera da para ~1,5 juegos de neumáticos
    this.multDesgaste = this.modo === 'carrera' ? Math.max(1, Math.min(3, 30 / this.vueltasTotales)) : 1;
    for (const p of this.participantes) p.coche.ponerMultDesgaste(this.multDesgaste);
    // espectador: no hay coche propio; se sigue a uno cualquiera (el 'foco' de la cámara)
    this.jugador = this.participantes.find(p => p.jugador) || this.participantes[0];
    this.espectador = !!mp?.espectador;
    this.mejorVueltaSesion = Infinity;
    this.mejoresSectoresSesion = [Infinity, Infinity, Infinity];
    // vuelta de formación: cada coche recuerda su casilla de salida
    if (this.formacion) {
      [...this.participantes].sort((a, b) => b.coche.proj.s - a.coche.proj.s).forEach((p, k) => {
        p.slot = k; p.slotS = p.coche.proj.s; p.slotD = p.coche.proj.d;
      });
    }
  }

  // Boxes: el jugador o la IA piden parar; se entra la próxima vez que se pase por la entrada
  pedirBox(p, compuesto) { if (!p.coche.abandono) p.solicitudBox = compuesto || p.coche.reglaje.compuesto; }
  cancelarBox(p) { if (!p.box) p.solicitudBox = null; }

  _garajeDe(p) {
    const g = this.c.pit.garajes;
    const ie = p.indiceEquipo ?? (this.participantes.indexOf(p) % g.length);
    return g[ie % g.length] + (p.numeroPiloto ? -6 : 0);
  }

  _gestionarBoxes(p) {
    const car = p.coche, c = this.c;
    car.limitadorPit = c.enLimitador(car.proj.s, car.proj.d);
    car.limitePit = c.pit.limite;
    if (p.box) {
      if (p.box.estado === 'fin') { p.box = null; p.solicitudBox = null; p.porClima = false; }
      return;
    }
    // si el jugador mete el coche en el carril sin pedir parada, el equipo le espera igual
    const u = c.uPit(car.proj.s);
    const enCarril = u >= 0 && u < 140 && car.proj.d > c.semiAncho[car.proj.i] + 1.2;
    if (!p.solicitudBox && enCarril && !car.abandono && !p.remoto && this.modo !== 'contrarreloj') p.solicitudBox = car.reglaje.compuesto;
    if (!p.solicitudBox || car.abandono) return;
    // el ingeniero toma el coche con margen para frenar en recta (desde 300 km/h hacen falta ~300 m)
    const antes = c.envolver(c.pit.entrada - car.proj.s);
    const margen = Math.min(380, 30 + car.velocidad * car.velocidad / 22);
    if (!enCarril && (antes > margen || antes < 2)) return;
    // solo con el coche encarrilado (tras un trompo, primero hay que recuperarlo)
    const rumbo = Math.atan2(car.proj.tz, car.proj.tx);
    let err = car.psi - rumbo; err = Math.atan2(Math.sin(err), Math.cos(err));
    if (!enCarril && (Math.abs(err) > 0.5 || car.velocidad < 8)) return;
    const compuesto = p.solicitudBox;
    // trabajo de la parada: neumáticos siempre; morro nuevo si está dañado
    const morro = car.danoAleron > 0.12 || car.dano.aleronTras > 0.2;
    const duracion = 2.1 + Math.random() * 0.7 + (morro ? 6.5 + Math.random() * 1.5 : 0) + (Math.random() < 0.06 ? 2.5 : 0);
    p.box = new PilotoBox(car, c, this._garajeDe(p), {
      duracion,
      alParar: () => { p.paradaInfo = { inicio: this.tiempo, duracion, morro, compuesto }; this.eventos.push({ tipo: 'paradaIni', p, duracion, morro }); },
      alTerminar: () => {
        car.repararEnBoxes(compuesto); p.paradas++;
        if (this.depositoMax) car.combustible = this.depositoMax;      // repostaje (resistencia)
        this.eventos.push({ tipo: 'paradaFin', p, duracion });
        p.paradaInfo = null;
      },
    });
    this.eventos.push({ tipo: 'entraBoxes', p });
  }

  // Estrategia de la IA: parar por desgaste en carreras largas o por daños
  _estrategia(p) {
    if (!p.ia || p.box || p.terminado || p.coche.abandono || this.modo === 'contrarreloj') return;
    const car = p.coche;
    const restantes = this.vueltasTotales - p.vuelta;
    // clima: cada piloto reacciona con su propio umbral (unos arriesgan más que otros)
    const agua = this.clima.agua / (p.umbralClima ??= 0.85 + Math.random() * 0.3);
    const actual = car.reglaje.compuesto, seco = restantes > 12 ? 'duro' : 'medio';
    const esLluvia = c => c === 'inter' || c === 'lluvia';
    let ideal = actual;
    if (!esLluvia(actual) && agua > 0.15) ideal = agua > 0.55 ? 'lluvia' : 'inter';
    else if (actual === 'inter' && (agua < 0.1 || agua > 0.62)) ideal = agua < 0.1 ? seco : 'lluvia';
    else if (actual === 'lluvia' && agua < 0.36) ideal = agua < 0.1 ? seco : 'inter';
    if (ideal !== actual && restantes >= 1) { p.solicitudBox = ideal; p.porClima = true; return; }
    // resistencia: a repostar con margen de dos vueltas
    if (this.depositoMax && car.combustible < 2.6 * 1.45 && !p.solicitudBox && (!this.tiempoLimite || this.tiempo < this.tiempoLimite - 60)) { this.pedirBox(p, actual); return; }
    // si el tiempo cambió antes de llegar a boxes, se cancela la parada por clima
    if (p.solicitudBox && p.porClima && ideal === actual) { p.solicitudBox = null; p.porClima = false; }
    if (p.solicitudBox) return;
    const desg = Math.max(...car.ruedas.map(w => w.neum.desgaste));
    const danado = car.dano.pinchazo.some(Boolean) || car.danoAleron > 0.3 || car.dano.aleronTras > 0.4;
    if (danado && restantes >= 1) this.pedirBox(p, esLluvia(actual) ? actual : seco);
    else if (desg > 0.45 && restantes >= 3 && this.vueltasTotales >= 8) this.pedirBox(p, esLluvia(actual) ? actual : restantes > 15 ? 'duro' : 'medio');
  }

  get coches() { return this.participantes.map(p => p.coche); }

  actualizar(dtFrame) {
    // semáforo de salida
    if (this.estado === 'parrilla') {
      this.tLuces += dtFrame;
      const nuevas = Math.min(5, Math.floor((this.tLuces - 1.5) / 1.0) + 1);
      if (nuevas > this.luces && nuevas >= 1) { this.luces = nuevas; this.eventos.push('luz'); }
      if (this.luces === 5 && !this.tApagar) this.tApagar = this.tLuces + 0.4 + Math.random() * 2.2;
      if (this.tApagar && this.tLuces >= this.tApagar) {
        this.estado = 'carrera'; this.luces = 0; this.eventos.push('salida');
      }
      // coches retenidos: el motor sube de vueltas pero no avanzan
      for (const p of this.participantes) {
        const c = p.coche;
        const ac = p.jugador ? c.mandos.acelerador : (this.luces === 5 ? 0.6 : 0.1);
        c.rpm += ((COCHE.rpmRalenti + ac * 7500) - c.rpm) * Math.min(1, dtFrame * 6);
      }
      return;
    }
    this.acumulado += Math.min(dtFrame, 0.1);
    let pasos = 0;
    while (this.acumulado >= DT && pasos < 40) {
      this._paso(DT);
      this.acumulado -= DT; pasos++;
    }
    if (pasos === 40) this.acumulado = 0;
  }

  _paso(dt) {
    this.tiempo += dt;
    const lista = this.participantes;
    const coches = this.coches;
    this.clima.actualizar(dt);
    this.c.agua = this.clima.agua;
    this._banderas(dt);
    this._moverSc(dt);
    this._neutralizar(dt);
    this._aerodinamicaRelativa();
    for (const p of lista) {
      if (p.remoto) continue;           // lo mueve la red
      this._gestionarBoxes(p);
      const car = p.coche;
      // vuelta de enfriamiento terminada: el coche se retira a boxes y deja la pista libre
      if (p.terminado && this.tiempo - p.tTotal > 25 && !p.jugador && !p.retirado) { p.retirado = true; car.retenido = true; car.colocar(c0Retiro(this.c, p), this.c.semiAncho[0] + this.c.pit.ancho - 1); }
      if (p.retirado) continue;
      if (car.abandono && !p.terminado) {
        car.mandos.acelerador = 0; car.mandos.freno = 1; car.mandos.direccion = 0;
        if (!p.abandono) {
          p.abandono = true; p.tAbandono = this.tiempo;
          this.eventos.push({ tipo: 'abandono', p, motivo: car.motivoAbandono });
          // coche parado en pista: amarilla en la zona y, si está en la trazada, coche de seguridad virtual
          if (this.modo === 'carrera' && this.estado === 'carrera') {
            this.amarilla(car.proj.s, 30);
            this.abandonosRecientes = this.abandonosRecientes.filter(t => this.tiempo - t < 12);
            this.abandonosRecientes.push(this.tiempo);
            const enPista = Math.abs(car.proj.d) < this.c.semiAncho[car.proj.i] + 6 && !this.c.enZonaPit[car.proj.i];
            const lider = this.orden?.[0];
            const quedan = lider ? this.vueltasTotales - lider.vuelta : 0;
            // choque múltiple: bandera roja; coche en la trazada: Safety Car (o VSC)
            if (this.abandonosRecientes.length >= 3 && !this.mp && quedan > 2) this.banderaRoja();
            else if (enPista && this.permitirSc && !this.sc && lider && lider.vuelta >= 1 && quedan > 2 && (car.impacto > 22 || Math.random() < 0.5)) this.desplegarSc();
            else if (enPista && this.permitirVsc && !this.sc) this.ponerVsc(true);
          }
        }
        // la grúa lo retira a los 20 s
        if (p.tAbandono && this.tiempo - p.tAbandono > 20 && !p.retirado && !p.jugador) { p.retirado = true; car.colocar(c0Retiro(this.c, p), this.c.semiAncho[0] + this.c.pit.ancho - 1); car.retenido = true; }
      } else if (p.box) p.box.conducir(dt);
      else if (p.ia && !car.retenido) {
        p.ia.conducir(dt, coches);
        if (p.terminado) { car.mandos.acelerador *= 0.5; car.mandos.drs = false; }
      }
      // coche de seguridad virtual: todos limitados a un ritmo lento (~35 % más lento) sin DRS
      car.limiteVsc = p.box ? 0 : (this._lim.get(p) || (this.vsc ? this.c.perfil[car.proj.i] * 0.64 : 0));
      car.paso(dt);
      // averías mecánicas (solo en carreras contra la IA, si están activadas)
      if (this.tasaAverias > 0 && this.estado === 'carrera') {
        const av = car.averias(dt, this.tasaAverias);
        if (av) this.eventos.push({ tipo: 'averia', p, averia: av });
      }
      // golpe fuerte contra el muro: amarilla en esa zona
      if (car.impacto > 9 && this.modo === 'carrera' && this.estado === 'carrera') this.amarilla(car.proj.s, 10);
    }
    this._contactos();
    for (const p of lista) { if (!p.remoto) { this._cronometrar(p, dt); if (Math.floor(this.tiempo * 2) !== Math.floor((this.tiempo - dt) * 2)) this._estrategia(p); } }
    // fin de carrera cuando todos terminaron o abandonaron
    if (this.modo === 'carrera' && !this.mp && this.banderaFinal && !this.carreraTerminada && lista.every(p => p.terminado || p.abandono)) {
      this.carreraTerminada = true; this.eventos.push({ tipo: 'finCarrera' });
    }
    if (this.modo !== 'carrera') this._grabarFantasma(dt);
    if (this.modo === 'carrera') this._posiciones();
  }

  _aerodinamicaRelativa() {
    const L = this.c.largo;
    for (const p of this.participantes) {
      const c = p.coche;
      let rebufo = 0, sucio = 0;
      for (const o of this.participantes) {
        if (o === p) continue;
        let ds = o.coche.proj.s - c.proj.s;
        if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L;
        if (ds <= 2 || ds > 70) continue;
        const dd = Math.abs(o.coche.proj.d - c.proj.d);
        if (dd < 2.6) rebufo = Math.max(rebufo, (1 - ds / 70) * (1 - dd / 2.6));
        if (dd < 3.5 && ds < 35) sucio = Math.max(sucio, (1 - ds / 35) * (1 - dd / 3.5));
      }
      c.rebufo = rebufo; c.aireSucio = sucio;
      // DRS
      let enZona = false;
      for (const z of this.c.drs) {
        const s = c.proj.s;
        enZona ||= z.ini < z.fin ? (s >= z.ini && s <= z.fin) : (s >= z.ini || s <= z.fin);
      }
      const habil = this.modo !== 'carrera' || (p.drsHabil && p.vuelta >= 3);
      c.drsPermitido = enZona && habil && !this.vsc && !this.sc && this.estado === 'carrera' && !this.enAmarilla(c.proj.s);
      c.zonaDrs = enZona;
    }
  }

  // Contactos coche-coche: cada coche son tres círculos a lo largo de su eje
  _contactos() {
    const lista = this.participantes;
    const R = 0.95, offs = [1.9, 0, -1.9];
    for (let a = 0; a < lista.length; a++) {
      for (let b = a + 1; b < lista.length; b++) {
        if (lista[a].retirado || lista[b].retirado) continue;
        const A = lista[a].coche, B = lista[b].coche;
        const dx0 = B.x - A.x, dz0 = B.z - A.z;
        if (dx0 * dx0 + dz0 * dz0 > 64) continue;
        const ca = Math.cos(A.psi), sa = Math.sin(A.psi), cb = Math.cos(B.psi), sb = Math.sin(B.psi);
        for (const oa of offs) for (const ob of offs) {
          const ax = A.x + ca * oa, az = A.z + sa * oa;
          const bx = B.x + cb * ob, bz = B.z + sb * ob;
          let nx = bx - ax, nz = bz - az;
          const dist = Math.hypot(nx, nz);
          if (dist >= 2 * R || dist < 1e-4) continue;
          nx /= dist; nz /= dist;
          const pen = 2 * R - dist;
          A.x -= nx * pen / 2; A.z -= nz * pen / 2; B.x += nx * pen / 2; B.z += nz * pen / 2;
          // velocidades en el mundo de los puntos de contacto
          const rax = ax - A.x + nx * R, raz = az - A.z + nz * R;
          const rbx = bx - B.x - nx * R, rbz = bz - B.z - nz * R;
          const vax = A.vx * ca - A.vy * sa - A.r * raz, vaz = A.vx * sa + A.vy * ca + A.r * rax;
          const vbx = B.vx * cb - B.vy * sb - B.r * rbz, vbz = B.vx * sb + B.vy * cb + B.r * rbx;
          const vn = (vbx - vax) * nx + (vbz - vaz) * nz;
          if (vn >= 0) continue;
          const I = COCHE.inerciaYaw;
          const raxn = rax * nz - raz * nx, rbxn = rbx * nz - rbz * nx;
          const j = -(1.2) * vn / (1 / A.masa + 1 / B.masa + raxn * raxn / I + rbxn * rbxn / I);
          const jx = nx * j, jz = nz * j;
          this._impulso(A, -jx, -jz, rax, raz);
          this._impulso(B, jx, jz, rbx, rbz);
          if (-vn > 3) {
            this.eventos.push({ tipo: 'contacto', fuerza: -vn, jugador: lista[a].jugador || lista[b].jugador });
            // daños en la zona del contacto de cada coche (lado = proyección de la normal en su eje lateral)
            const latA = nx * -sa + nz * ca, latB = -(nx * -sb + nz * cb);
            // los contactos entre coches rebotan: cuentan algo menos que un muro
            // (entre dos coches de la IA aún menos: no frenan tan fino como una persona en el tráfico)
            A.fuenteGolpe = B.fuenteGolpe = 'coche';
            const fDano = lista[a].jugador || lista[b].jugador || lista[a].remoto || lista[b].remoto ? 0.95 : 0.55;
            A.aplicarGolpe(oa + 0.9 * Math.sign(oa), Math.sign(latA) * (Math.abs(latA) > 0.5 ? 1 : 0.5), -vn * fDano);
            B.aplicarGolpe(ob + 0.9 * Math.sign(ob), Math.sign(latB) * (Math.abs(latB) > 0.5 ? 1 : 0.5), -vn * fDano);
            // quien embiste con el morro la parte trasera o el lateral del otro provoca el choque
            if (-vn > 7 && this.modo === 'carrera') {
              if (oa > 0 && ob <= 0) this.sancionar(lista[a], 'Provocar una colisión');
              else if (ob > 0 && oa <= 0) this.sancionar(lista[b], 'Provocar una colisión');
            }
          }
        }
      }
    }
  }

  _impulso(C, jx, jz, rx, rz) {
    const cos = Math.cos(C.psi), sin = Math.sin(C.psi);
    const m = C.masa;
    const vwx = C.vx * cos - C.vy * sin + jx / m;
    const vwz = C.vx * sin + C.vy * cos + jz / m;
    C.vx = vwx * cos + vwz * sin;
    C.vy = -vwx * sin + vwz * cos;
    C.r += (rx * jz - rz * jx) / COCHE.inerciaYaw;
  }

  _cronometrar(p, dt) {
    const c = p.coche, L = this.c.largo, s = c.proj.s;
    // formación: no cuenta vueltas; 'formFinal' = ya cruzó la meta y vuelve a la mitad final de la pista
    if (this.estado === 'formacion') { if (s < L / 2) p.formSalio = true; else if (p.formSalio) p.formFinal = true; p.sAnterior = s; return; }
    p.tVuelta += dt; p.tSector += dt;
    if (c.limitesExcedidos && p.vuelta > 0) {
      if (p.valida) {
        this.eventos.push({ tipo: 'limites', jugador: p.jugador });
        if (this.modo === 'carrera' && !p.box) {
          p.avisosLimites++;
          if (p.avisosLimites > AVISOS_LIMITES) this.sancionar(p, 'Límites de pista');
          else this.eventos.push({ tipo: 'avisoLimites', p, n: p.avisosLimites, bandera: p.avisosLimites === AVISOS_LIMITES });
        }
      }
      p.valida = false;
    }
    // detección del DRS: diferencia con el coche de delante menor de 1 s
    for (const z of this.c.drs) {
      if (this._cruza(p.sAnterior, s, z.deteccion)) p.drsHabil = this._huecoDelante(p) < 1.0;
    }
    // sectores
    const marcas = this.c.sectores;
    for (let k = 0; k < 2; k++) {
      if (this._cruza(p.sAnterior, s, marcas[k]) && p.sector === k) this._cerrarSector(p, k);
    }
    if (p.sAnterior > L - 150 && s < 150) {
      if (p.vuelta > 0) {
        this._cerrarSector(p, 2);
        const t = p.tVuelta;
        p.tiempos.push({ t, valida: p.valida });
        p.ultimaVuelta = { t, valida: p.valida };
        const mejora = p.valida && t < p.mejor;
        if (mejora) p.mejor = t;
        if (p.valida && t < this.mejorVueltaSesion) { this.mejorVueltaSesion = t; this.eventos.push({ tipo: 'vueltaRapida', p }); }
        this.eventos.push({ tipo: 'vuelta', p, t, mejora, valida: p.valida });
        if (p.jugador && this.modo !== 'carrera' && mejora) {
          this.fantasma = { tiempo: t, puntos: this.grabacion };
          this.eventos.push({ tipo: 'nuevoFantasma', fantasma: this.fantasma });
        }
      }
      p.vuelta++;
      p.tVuelta = 0; p.tSector = 0; p.sector = 0; p.valida = true;
      p.sectores = [null, null, null];
      if (p.jugador) { this.grabacion = []; this.tGrab = 0; }
      c.nuevaVuelta();
      if (this.modo === 'carrera') {
        const lider = this.participantes.reduce((a, b) => (a.distancia > b.distancia ? a : b));
        const finTiempo = this.tiempoLimite && this.tiempo >= this.tiempoLimite && p.posicion === 1;
        if (p.vuelta > this.vueltasTotales || finTiempo || (this.banderaFinal && !p.terminado)) {
          if (!p.terminado) {
            p.terminado = true; p.tTotal = this.tiempo;
            this.banderaFinal = true;
            this.eventos.push({ tipo: 'meta', p });
          }
        }
        void lider;
      }
    }
    p.sAnterior = s;
    p.distancia = (p.vuelta - 1) * L + s;
  }

  // ─── Banderas y sanciones ─────────────────────────────────────────────
  amarilla(s, dur) {
    const z = this.amarillas.find(a => Math.abs(this.c.envolver(a.s - s + this.c.largo / 2) - this.c.largo / 2) < 150);
    if (z) z.hasta = Math.max(z.hasta, this.tiempo + dur);
    else { this.amarillas.push({ s, hasta: this.tiempo + dur }); this.eventos.push({ tipo: 'amarilla', s }); }
  }
  enAmarilla(s) {
    const L = this.c.largo;
    return this.amarillas.some(a => { const ds = this.c.envolver(a.s - s); return ds < 220 || ds > L - 60; });
  }
  ponerVsc(si) {
    if (si === this.vsc) { if (si) this.tVsc = Math.max(this.tVsc, 30); return; }
    this.vsc = si; this.tVsc = si ? 30 : 0;
    this.eventos.push({ tipo: 'vsc', activo: si });
  }
  _banderas(dt) {
    this.amarillas = this.amarillas.filter(a => a.hasta > this.tiempo);
    if (this.vsc) {
      this.tVsc -= dt;
      // termina cuando la grúa ha retirado los coches parados en pista
      const parados = this.participantes.some(p => p.abandono && !p.retirado && !p.jugador);
      if (this.tVsc <= 0 && !parados) this.ponerVsc(false);
    }
  }
  // ─── Safety Car, bandera roja y vuelta de formación ──────────────────
  desplegarSc() {
    if (this.sc || this.estado !== 'carrera') return;
    this.vsc = false; this.tVsc = 0;
    const lider = this.orden?.find(p => !p.abandono && !p.box) || this.participantes[0];
    this.sc = { s: this.c.envolver(lider.coche.proj.s + 200), v: Math.max(25, lider.coche.velocidad * 0.6), t: 0, entra: false, x: 0, y: 0, z: 0, psi: 0 };
    this._moverSc(0);
    this.eventos.push({ tipo: 'sc', activo: true });
  }
  _moverSc(dt) {
    const sc = this.sc;
    if (!sc) return;
    const c = this.c, L = c.largo;
    sc.t += dt;
    const i = Math.floor(sc.s / c.paso) % c.n;
    // espera al líder si va muy lejos para que el pelotón se agrupe
    const lider = this.orden?.find(p => !p.abandono && !p.box && !p.retirado);
    const hueco = lider ? c.envolver(sc.s - lider.coche.proj.s) : 0;
    let vObj = c.perfil[i] * 0.5;
    if (hueco > 220 && hueco < L / 2) vObj *= 0.65;
    sc.v += Math.max(-8 * dt, Math.min(5 * dt, vObj - sc.v));
    const s0 = sc.s;
    sc.s = c.envolver(sc.s + sc.v * dt);
    const m = c.muestra(sc.s), d = c.trazada.off[i] * 0.4;
    sc.x = m.x - m.tz * d; sc.z = m.z + m.tx * d; sc.y = m.y; sc.psi = Math.atan2(m.tz, m.tx);
    const parados = this.participantes.some(p => p.abandono && !p.retirado && !p.jugador);
    if (!sc.entra && sc.t > Math.max(60, c.vueltaTeorica(1) * 1.6) && !parados) { sc.entra = true; this.eventos.push({ tipo: 'sc', entra: true }); }
    if (sc.entra && this._cruza(s0, sc.s, c.pit.entrada)) { this.sc = null; this.eventos.push({ tipo: 'sc', activo: false }); }
  }
  // Ritmo neutralizado: cada coche sigue al de delante (o al SC) sin adelantar
  _neutralizar(dt) {
    const lim = this._lim || (this._lim = new Map());
    lim.clear();
    const form = this.estado === 'formacion', roja = this.estado === 'roja';
    if (!this.sc && !form && !roja) return;
    const c = this.c, L = c.largo;
    if (roja) {
      for (const p of this.participantes) lim.set(p, c.perfil[p.coche.proj.i] * 0.4);
      this.tRoja += dt;
      if (this.tRoja > 8) this._relanzar();
      return;
    }
    const fila = this.participantes.filter(p => !p.abandono && !p.retirado && !p.box && !p.terminado && !p.enSlot && !p.remoto);
    if (form) fila.sort((a, b) => a.slot - b.slot);
    else fila.sort((a, b) => b.distancia - a.distancia);
    let delante = this.sc ? { s: this.sc.s, v: this.sc.v, p: null } : null;
    fila.forEach((p, k) => {
      const car = p.coche;
      let l = c.perfil[car.proj.i] * (form ? (k ? 0.6 : 0.5) : 0.62);
      if (delante) {
        const ds = c.envolver(delante.s - car.proj.s);
        if (ds < L / 2) l = Math.min(l, Math.max(0.5, delante.v + (ds - (delante.p ? 20 : 35)) * 0.3));
      }
      if (form && p.formFinal) {
        const dSlot = c.envolver(p.slotS - car.proj.s);
        if (dSlot < L / 2) l = Math.min(l, Math.max(0.3, Math.sqrt(10 * Math.max(0, dSlot - 1))));
        // en su casilla: se coloca y espera
        if ((dSlot < 2.5 && car.velocidad < 4) || (dSlot > L - 25)) { car.colocar(p.slotS, p.slotD); car.retenido = true; p.enSlot = true; }
      }
      // adelantar con el Safety Car: sanción (sólo al jugador; la IA no adelanta)
      if (this.sc && p.jugador) {
        if (p._delanteSc && fila.indexOf(p._delanteSc) > k) this.sancionar(p, 'Adelantar con Safety Car');
        p._delanteSc = delante?.p || null;
      }
      lim.set(p, l);
      delante = { s: car.proj.s, v: car.velocidad, p };
    });
    if (form && this.participantes.every(p => p.enSlot || p.abandono || p.retirado)) this._finFormacion();
  }
  _finFormacion() {
    for (const p of this.participantes) {
      if (p.retirado) continue;
      p.enSlot = false; p.coche.retenido = false;
      p.sAnterior = p.coche.proj.s; p.tVuelta = 0;
    }
    this.estado = 'parrilla'; this.luces = 0; this.tLuces = 0; this.tApagar = 0;
    this.tiempo = 0; this.amarillas = [];
    this.eventos.push({ tipo: 'finFormacion' });
  }
  banderaRoja() {
    if (this.estado !== 'carrera' || this.mp) return;
    this.estado = 'roja'; this.tRoja = 0;
    this.sc = null; this.vsc = false;
    this.eventos.push({ tipo: 'roja' });
  }
  // Tras la bandera roja: todos a la parrilla en el orden de carrera y salida parada
  _relanzar() {
    const L = this.c.largo;
    const fila = (this.orden || this.participantes).filter(p => !p.abandono && !p.retirado && !p.terminado);
    fila.forEach((p, k) => {
      const car = p.coche;
      if (p.box) { p.box._devolver?.(); p.box = null; }
      car.retenido = false;
      car.colocar(L - 12 - 7 * k, k % 2 === 0 ? -2.6 : 2.6);
      // en la bandera roja se pueden reparar alerones y cambiar ruedas pinchadas
      car.danoAleron = 0; car.dano.aleronTras = 0; car.dano.pinchazo = [false, false, false, false];
      p.valida = false; p.drsHabil = false;
      p.sAnterior = car.proj.s;
      p.distancia = (p.vuelta - 1) * L + car.proj.s;
    });
    this.estado = 'parrilla'; this.luces = 0; this.tLuces = 0; this.tApagar = 0;
    this.amarillas = []; this.abandonosRecientes = [];
    this.eventos.push({ tipo: 'relanzada' });
  }

  sancionar(p, motivo) {
    if (this.tiempo - p.tUltimaSancion < 8 || p.terminado) return;
    p.tUltimaSancion = this.tiempo;
    p.penalizacion += PENALIZACION;
    this.eventos.push({ tipo: 'sancion', p, motivo, seg: PENALIZACION, total: p.penalizacion });
  }

  _cruza(s0, s1, marca) {
    if (s1 >= s0) return s0 < marca && s1 >= marca && s1 - s0 < 100;
    return (s0 < marca || s1 >= marca) && s0 - s1 > this.c.largo - 100;
  }

  _cerrarSector(p, k) {
    const t = p.tSector;
    p.sectores[k] = t;
    const personal = t < p.mejoresSectores[k];
    const general = t < this.mejoresSectoresSesion[k];
    if (p.valida) {
      if (personal) p.mejoresSectores[k] = t;
      if (general) this.mejoresSectoresSesion[k] = t;
    }
    if (p.jugador) this.eventos.push({ tipo: 'sector', k, t, color: !p.valida ? 'rojo' : general ? 'morado' : personal ? 'verde' : 'amarillo' });
    p.tSector = 0; p.sector = k + 1;
  }

  _huecoDelante(p) {
    let mejor = Infinity;
    const L = this.c.largo;
    for (const o of this.participantes) {
      if (o === p) continue;
      let ds = o.coche.proj.s - p.coche.proj.s;
      if (ds < 0) ds += L;
      if (ds < mejor) mejor = ds;
    }
    return mejor / Math.max(10, p.coche.velocidad);
  }

  _posiciones() {
    const orden = [...this.participantes].sort((a, b) => {
      if (a.abandono !== b.abandono) return a.abandono ? 1 : -1;
      if (a.terminado && b.terminado) return (a.tTotal + a.penalizacion) - (b.tTotal + b.penalizacion);
      if (a.terminado) return -1;
      if (b.terminado) return 1;
      return b.distancia - a.distancia;
    });
    orden.forEach((p, i) => { p.posicion = i + 1; });
    this.orden = orden;
  }

  // Diferencia con el coche de delante / detrás para el HUD (segundos)
  diferencias(p) {
    const orden = this.orden || this.participantes;
    const i = orden.indexOf(p);
    const v = Math.max(15, p.coche.velocidad);
    const del = i > 0 ? (orden[i - 1].distancia - p.distancia) / v : null;
    const tras = i < orden.length - 1 ? (p.distancia - orden[i + 1].distancia) / v : null;
    return { del, tras };
  }

  _grabarFantasma(dt) {
    this.tGrab += dt;
    if (this.tGrab >= 0.05) {
      this.tGrab -= 0.05;
      const c = this.jugador.coche;
      if (this.jugador.vuelta > 0) this.grabacion.push([+c.x.toFixed(2), +c.z.toFixed(2), +c.y.toFixed(2), +c.psi.toFixed(4)]);
    }
  }

  // Delta en vivo contra el fantasma (segundos, negativo = más rápido)
  delta() {
    const f = this.fantasma, p = this.jugador;
    if (!f || !f.puntos?.length || p.vuelta < 1) return null;
    const c = p.coche;
    // buscar el punto del fantasma más cercano alrededor del índice esperado
    const n = f.puntos.length;
    let i0 = Math.min(n - 1, Math.floor(p.tVuelta / 0.05));
    let best = i0, bd = Infinity;
    for (let k = Math.max(0, i0 - 80); k < Math.min(n, i0 + 80); k++) {
      const q = f.puntos[k];
      const d = (q[0] - c.x) ** 2 + (q[1] - c.z) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    if (bd > 900) return null;
    return p.tVuelta - best * 0.05;
  }
}
