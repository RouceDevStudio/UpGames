// Sesión: parrilla, semáforo, cronometraje por sectores, posiciones, DRS,
// rebufo, contactos entre coches y fantasma de la mejor vuelta.

import { EQUIPOS, COCHE } from './config.js';
import { Monoplaza } from './physics/monoplaza.js';
import { PilotoIA } from './ai.js';

const DT = 1 / 300;
const HABILIDAD = { facil: [0.885, 0.92], normal: [0.935, 0.965], dificil: [0.965, 0.99], extremo: [0.985, 1.0] };

export class Sesion {
  constructor(circuito, opc) {
    this.c = circuito;
    this.modo = opc.modo;           // 'carrera' | 'contrarreloj' | 'practica'
    this.vueltasTotales = opc.vueltas || 5;
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

    const rivales = this.modo === 'carrera' ? Math.min(opc.rivales ?? 7, EQUIPOS.length - 1) : 0;
    const total = rivales + 1;
    const posJugador = this.modo === 'carrera' ? Math.min(total, opc.posSalida || Math.ceil(total * 0.6)) : 1;
    const [hMin, hMax] = HABILIDAD[opc.dificultad || 'normal'];
    const combustible = this.modo === 'carrera' ? 12 + this.vueltasTotales * 1.45 : 20;
    let iaIdx = 1;
    for (let k = 0; k < total; k++) {
      const esJugador = k === posJugador - 1;
      const eq = esJugador ? EQUIPOS[0] : EQUIPOS[iaIdx++];
      const coche = new Monoplaza(circuito, {
        ia: !esJugador,
        reglaje: esJugador ? opc.reglaje : { compuesto: opc.reglaje?.compuesto || 'medio' },
        ayudas: esJugador ? opc.ayudas : { tc: 2, abs: true, cambioAuto: true },
        combustible,
      });
      // rivales más rápidos delante en la parrilla
      const hab = esJugador ? 1 : hMax - (hMax - hMin) * (k / Math.max(1, total - 1)) + (Math.random() - 0.5) * 0.008;
      const p = {
        coche, equipo: eq, nombre: esJugador ? (opc.nombre || 'Tú') : eq.piloto,
        jugador: esJugador,
        ia: esJugador ? null : new PilotoIA(coche, circuito, hab, 0.3 + Math.random() * 0.6),
        vuelta: 0, tVuelta: 0, tiempos: [], mejor: Infinity, sectores: [null, null, null],
        mejoresSectores: [Infinity, Infinity, Infinity], tSector: 0, sector: 0,
        valida: true, terminado: false, tTotal: 0, posicion: k + 1, distancia: 0, drsHabil: false,
        sAnterior: 0, ultimaVuelta: null,
      };
      if (this.modo === 'carrera') {
        const s = circuito.largo - 14 - 8 * k;
        coche.colocar(s, k % 2 === 0 ? -2.6 : 2.6);
      } else {
        // vuelta de salida lanzada
        const s = circuito.largo - 700;
        coche.colocar(s, 0);
        coche.vx = 55; for (const w of coche.ruedas) w.omega = 55 / w.radio;
        coche.marcha = 5; coche.rpm = 11000;
        p.vuelta = 0;
      }
      p.sAnterior = coche.proj.s;
      this.participantes.push(p);
    }
    this.jugador = this.participantes.find(p => p.jugador);
    this.mejorVueltaSesion = Infinity;
    this.mejoresSectoresSesion = [Infinity, Infinity, Infinity];
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
    this._aerodinamicaRelativa();
    for (const p of lista) {
      if (p.ia) {
        p.ia.conducir(dt, coches);
        if (p.terminado) { p.coche.mandos.acelerador *= 0.5; p.coche.mandos.drs = false; }
      }
      p.coche.paso(dt);
    }
    this._contactos();
    for (const p of lista) this._cronometrar(p, dt);
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
      c.drsPermitido = enZona && habil;
      c.zonaDrs = enZona;
    }
  }

  // Contactos coche-coche: cada coche son tres círculos a lo largo de su eje
  _contactos() {
    const lista = this.participantes;
    const R = 0.95, offs = [1.9, 0, -1.9];
    for (let a = 0; a < lista.length; a++) {
      for (let b = a + 1; b < lista.length; b++) {
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
            if (-vn > 8) {
              if (Math.abs(oa) > 1) A.danoAleron = Math.min(1, A.danoAleron + 0.08 * (-vn - 8));
              if (Math.abs(ob) > 1) B.danoAleron = Math.min(1, B.danoAleron + 0.08 * (-vn - 8));
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
    p.tVuelta += dt; p.tSector += dt;
    if (c.limitesExcedidos && p.vuelta > 0) {
      if (p.valida) this.eventos.push({ tipo: 'limites', jugador: p.jugador });
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
        if (p.vuelta > this.vueltasTotales || (this.banderaFinal && !p.terminado)) {
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
      if (a.terminado && b.terminado) return a.tTotal - b.tTotal;
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
