// Repetición: graba el estado visual de todos los coches a 15 Hz durante toda la carrera
// (hasta ~40 MB: una hora con pocos coches, ~25 min con 22) en bloques de un minuto que se
// reservan según hacen falta, y apunta los momentos clave (salida, adelantamientos,
// choques, abandonos, vuelta rápida, meta) para el resumen automático.

import * as THREE from 'three';

export const HZ = 15;
const CAMPOS = 22;
const MAX_SEG = 3600;
const BLOQUE = HZ * 60;                    // fotogramas por bloque de memoria
const MEMORIA = 40e6;                      // bytes como mucho para la repetición

export class Grabadora {
  constructor(n) {
    this.n = n;
    const porFoto = n * CAMPOS * 4;
    this.max = Math.max(BLOQUE, Math.min(HZ * MAX_SEG, Math.floor(MEMORIA / porFoto / BLOQUE) * BLOQUE));
    this.bloques = [];                     // Float32Array de BLOQUE fotogramas cada uno
    this.cuantos = 0;      // fotogramas guardados
    this.inicio = 0;       // índice circular del primero
    this.t = 0;
    this.tiempos = new Float32Array(this.max);
    this.marcas = [];      // { t, tipo, coche, texto }
  }

  // bloque y desplazamiento de un fotograma (índice circular)
  _foto(idx) {
    const b = Math.floor(idx / BLOQUE);
    if (!this.bloques[b]) this.bloques[b] = new Float32Array(BLOQUE * this.n * CAMPOS);
    return [this.bloques[b], (idx - b * BLOQUE) * this.n * CAMPOS];
  }

  /** Apunta un momento para el resumen (t: tiempo de sesión). */
  marcar(t, tipo, coche, texto) {
    const ult = this.marcas[this.marcas.length - 1];
    if (ult && ult.tipo === tipo && ult.coche === coche && t - ult.t < 4) return;   // sin repetir
    this.marcas.push({ t, tipo, coche, texto });
    if (this.marcas.length > 300) this.marcas.shift();
  }

  /** Posición (0..1) de la repetición para un tiempo de sesión. */
  uDeTiempo(t) {
    if (this.cuantos < 2) return 0;
    let lo = 0, hi = this.cuantos - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.tiempos[(this.inicio + m) % this.max] < t) lo = m + 1; else hi = m; }
    return lo / (this.cuantos - 1);
  }

  // estado de cada coche → 16 números
  grabar(dt, coches, tiempo) {
    this.t += dt;
    if (this.t < 1 / HZ) return;
    this.t -= 1 / HZ;
    const idx = (this.inicio + this.cuantos) % this.max;
    if (this.cuantos < this.max) this.cuantos++; else this.inicio = (this.inicio + 1) % this.max;
    this.tiempos[idx] = tiempo;
    let [d, o] = this._foto(idx);
    for (let k = 0; k < this.n; k++, o += CAMPOS) {
      const c = coches[k];
      if (!c) continue;
      const dn = c.dano || {};
      let bits = 0;
      for (let r = 0; r < 4; r++) { if (dn.pinchazo?.[r]) bits |= 1 << r; if (dn.suelta?.[r]) bits |= 16 << r; }
      d[o] = c.x; d[o + 1] = c.y; d[o + 2] = c.z; d[o + 3] = c.psi;
      d[o + 4] = c.anguloVolante || 0; d[o + 5] = c.ruedas[0].angulo; d[o + 6] = c.ruedas[2].giro;
      d[o + 7] = c.cabeceo || 0; d[o + 8] = c.balanceo || 0; d[o + 9] = c.rpm; d[o + 10] = c.marcha;
      d[o + 11] = c.velocidad; d[o + 12] = c.drsAbierto ? 1 : 0; d[o + 13] = c.danoAleron || 0;
      d[o + 14] = dn.aleronTras || 0; d[o + 15] = bits;
      // para el sonido de la repetición
      d[o + 16] = c.mandos?.acelerador || 0; d[o + 17] = c.mandos?.freno || 0; d[o + 18] = c.fondoToca || 0; d[o + 19] = Math.max(c.impacto || 0, c.picoGolpe || 0);
      // vuelos y vuelcos (choque rueda con rueda)
      d[o + 20] = c.giroCab || 0; d[o + 21] = c.giroBal || 0;
    }
  }

  get duracion() { return this.cuantos / HZ; }

  /** Rellena `proxies` (uno por coche) con el estado interpolado en u (0..1 de lo grabado). */
  leer(u, proxies) {
    if (this.cuantos < 2) return;
    const f = Math.max(0, Math.min(this.cuantos - 1.001, u * (this.cuantos - 1)));
    const a = Math.floor(f), t = f - a;
    const ia = (this.inicio + a) % this.max, ib = (this.inicio + a + 1) % this.max;
    const [da, ba] = this._foto(ia), [db, bb] = this._foto(ib);
    for (let k = 0; k < this.n; k++) {
      const p = proxies[k]; if (!p) continue;
      const oa = ba + k * CAMPOS, ob = bb + k * CAMPOS;
      const L = (j) => da[oa + j] + (db[ob + j] - da[oa + j]) * t;
      p.x = L(0); p.y = L(1); p.z = L(2);
      let dpsi = db[ob + 3] - da[oa + 3]; dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi));
      p.psi = da[oa + 3] + dpsi * t;
      p.anguloVolante = L(4);
      const ang = L(5);
      let giro = db[ob + 6] - da[oa + 6]; if (Math.abs(giro) > 3) giro = 0;
      p.ruedas.forEach((w, r) => { w.angulo = r < 2 ? ang : 0; w.giro = da[oa + 6] + giro * t; });
      p.cabeceo = L(7); p.balanceo = L(8); p.rpm = L(9); p.marcha = da[oa + 10]; p.velocidad = L(11);
      p.drsAbierto = da[oa + 12] > 0.5; p.danoAleron = da[oa + 13];
      const bits = da[oa + 15];
      p.dano.aleronTras = da[oa + 14];
      for (let r = 0; r < 4; r++) { p.dano.pinchazo[r] = !!(bits & (1 << r)); p.dano.suelta[r] = !!(bits & (16 << r)); }
      p.mandos.acelerador = L(16); p.mandos.freno = L(17); p.fondoToca = da[oa + 18]; p.impacto = Math.max(da[oa + 19], db[ob + 19]);
      // los giros en el aire pasan de -π a π: se interpolan por el camino corto
      const angG = (j) => { let d = db[ob + j] - da[oa + j]; d = Math.atan2(Math.sin(d), Math.cos(d)); return da[oa + j] + d * t; };
      p.giroCab = angG(20); p.giroBal = angG(21);
    }
  }

  tiempoEn(u) {
    if (this.cuantos < 1) return 0;
    const a = Math.round(u * (this.cuantos - 1));
    return this.tiempos[(this.inicio + a) % this.max];
  }
}

/** Objeto con la forma que necesitan los modelos y la cámara (sin física). */
export function crearProxy(c) {
  return {
    x: c.x, y: c.y, z: c.z, psi: c.psi, giroCab: 0, giroBal: 0, anguloVolante: 0, cabeceo: 0, balanceo: 0, rpm: 6000, marcha: 1, velocidad: 0,
    drsAbierto: false, danoAleron: 0, ersPotenciaActual: 0, ayF: 0, axF: 0, vibracion: 0,
    alturaDel: c.alturaDel ?? 0.032, alturaTras: c.alturaTras ?? 0.075, mandos: { acelerador: 0, freno: 0, ersModo: 1 }, fondoToca: 0, impacto: 0,
    dano: { pinchazo: [false, false, false, false], suelta: [false, false, false, false], susp: [0, 0, 0, 0], aleronTras: 0 },
    ruedas: c.ruedas.map(w => ({ angulo: 0, giro: 0, izquierda: w.izquierda, neum: w.neum })),
    reglaje: c.reglaje, proj: { i: 0 }, combustible: c.combustible, ers: c.ers, drsPermitido: false, limitador: false, limitadorPit: false,
  };
}


/** Cámaras fijas a pie de pista: la más cercana por delante del coche lo sigue con zoom. */
export class CamarasTV {
  constructor(circuito) {
    this.c = circuito;
    this.puestos = [];
    const paso = 170;
    for (let s = 40, k = 0; s < circuito.largo; s += paso, k++) {
      const i = Math.floor(s / circuito.paso) % circuito.n;
      const lado = circuito.curvSuave[i] > 0 ? -1 : circuito.curvSuave[i] < 0 ? 1 : (k % 2 ? 1 : -1);
      const ld = lado > 0 ? 1 : 0;
      const d = lado * (circuito.muro[ld][i] + (lado > 0 && circuito.enZonaPit[i] ? 2 : 6));
      const m = circuito.muestra(s);
      this.puestos.push({ s, pos: new THREE.Vector3(m.x - m.tz * d, m.y + 3.5 + (k % 3) * 1.8, m.z + m.tx * d) });
    }
    this.actual = null;
    this.helice = 0;
  }

  actualizar(cam, car, modo, dt) {
    const c = this.c;
    if (modo === 'helicoptero') {
      this.helice += dt * 0.15;
      const r = 70;
      cam.position.set(car.x - Math.cos(car.psi) * r * 0.7 + Math.sin(this.helice) * 25, car.y + 55, car.z - Math.sin(car.psi) * r * 0.7 + Math.cos(this.helice) * 25);
      cam.up.set(0, 1, 0);
      cam.lookAt(car.x, car.y, car.z);
      cam.fov = 38; cam.near = 0.5; cam.updateProjectionMatrix();
      return;
    }
    // cámara de TV: la última cámara que el coche ha pasado o la siguiente si está cerca
    const p = c.proyectar(car.x, car.z, car.proj?.i ?? -1, {});
    car.proj = car.proj || {}; car.proj.i = p.i;
    let mejor = null, md = Infinity;
    for (const q of this.puestos) {
      let ds = q.s - p.s; if (ds < -c.largo / 2) ds += c.largo; if (ds > c.largo / 2) ds -= c.largo;
      // preferir cámaras un poco por delante (el coche viene hacia la cámara)
      const coste = ds > -40 ? Math.abs(ds - 50) : 1e6;
      if (coste < md) { md = coste; mejor = q; }
    }
    if (!mejor) mejor = this.puestos[0];
    this.actual = mejor;
    cam.position.copy(mejor.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(car.x, car.y + 0.5, car.z);
    const dist = mejor.pos.distanceTo(new THREE.Vector3(car.x, car.y, car.z));
    const fov = THREE.MathUtils.clamp(2 * Math.atan(7 / dist) * 180 / Math.PI, 6, 55);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
    cam.near = 0.5;
    cam.updateProjectionMatrix();
  }
}
