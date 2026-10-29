// Repetición: graba el estado visual de todos los coches a 15 Hz (los últimos
// 5 minutos) y lo reproduce con cámaras de TV, helicóptero o a bordo.

import * as THREE from 'three';

export const HZ = 15;
const CAMPOS = 16;
const MAX_SEG = 300;

export class Grabadora {
  constructor(n) {
    this.n = n;
    this.max = HZ * MAX_SEG;
    this.datos = new Float32Array(this.max * n * CAMPOS);
    this.cuantos = 0;      // fotogramas guardados
    this.inicio = 0;       // índice circular del primero
    this.t = 0;
    this.tiempos = new Float32Array(this.max);
  }

  // estado de cada coche → 16 números
  grabar(dt, coches, tiempo) {
    this.t += dt;
    if (this.t < 1 / HZ) return;
    this.t -= 1 / HZ;
    const idx = (this.inicio + this.cuantos) % this.max;
    if (this.cuantos < this.max) this.cuantos++; else this.inicio = (this.inicio + 1) % this.max;
    this.tiempos[idx] = tiempo;
    let o = idx * this.n * CAMPOS;
    const d = this.datos;
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
    }
  }

  get duracion() { return this.cuantos / HZ; }

  /** Rellena `proxies` (uno por coche) con el estado interpolado en u (0..1 de lo grabado). */
  leer(u, proxies) {
    if (this.cuantos < 2) return;
    const f = Math.max(0, Math.min(this.cuantos - 1.001, u * (this.cuantos - 1)));
    const a = Math.floor(f), t = f - a;
    const ia = (this.inicio + a) % this.max, ib = (this.inicio + a + 1) % this.max;
    const d = this.datos;
    for (let k = 0; k < this.n; k++) {
      const p = proxies[k]; if (!p) continue;
      const oa = (ia * this.n + k) * CAMPOS, ob = (ib * this.n + k) * CAMPOS;
      const L = (j) => d[oa + j] + (d[ob + j] - d[oa + j]) * t;
      p.x = L(0); p.y = L(1); p.z = L(2);
      let dpsi = d[ob + 3] - d[oa + 3]; dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi));
      p.psi = d[oa + 3] + dpsi * t;
      p.anguloVolante = L(4);
      const ang = L(5);
      let giro = d[ob + 6] - d[oa + 6]; if (Math.abs(giro) > 3) giro = 0;
      p.ruedas.forEach((w, r) => { w.angulo = r < 2 ? ang : 0; w.giro = d[oa + 6] + giro * t; });
      p.cabeceo = L(7); p.balanceo = L(8); p.rpm = L(9); p.marcha = d[oa + 10]; p.velocidad = L(11);
      p.drsAbierto = d[oa + 12] > 0.5; p.danoAleron = d[oa + 13];
      const bits = d[oa + 15];
      p.dano.aleronTras = d[oa + 14];
      for (let r = 0; r < 4; r++) { p.dano.pinchazo[r] = !!(bits & (1 << r)); p.dano.suelta[r] = !!(bits & (16 << r)); }
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
    x: c.x, y: c.y, z: c.z, psi: c.psi, anguloVolante: 0, cabeceo: 0, balanceo: 0, rpm: 6000, marcha: 1, velocidad: 0,
    drsAbierto: false, danoAleron: 0, ersPotenciaActual: 0, ayF: 0, axF: 0, vibracion: 0,
    alturaDel: c.alturaDel ?? 0.032, alturaTras: c.alturaTras ?? 0.075, mandos: { acelerador: 0, ersModo: 1 },
    dano: { pinchazo: [false, false, false, false], suelta: [false, false, false, false], susp: [0, 0, 0, 0], aleronTras: 0 },
    ruedas: c.ruedas.map(w => ({ angulo: 0, giro: 0, izquierda: w.izquierda, neum: w.neum })),
    reglaje: c.reglaje, proj: { i: 0 }, combustible: c.combustible, ers: c.ers, drsPermitido: false, limitador: false, limitadorPit: false,
  };
}

export const CAMARAS_REPE = ['tv', 'helicoptero', 'persecucion', 'cabina', 'tcam'];
export const NOMBRES_REPE = { tv: 'Cámaras de TV', helicoptero: 'Helicóptero', persecucion: 'Persecución', cabina: 'Cabina', tcam: 'T-Cam' };

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
