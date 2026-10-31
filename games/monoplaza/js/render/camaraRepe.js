// Cámaras de la repetición y del modo cine: montadas en el coche, a pie de pista,
// dron, travelling lateral, órbita y cámara libre, más un "director" que va
// cortando entre planos como una retransmisión.

import * as THREE from 'three';

export const CAMARAS_REPE = ['director', 'tv', 'grua', 'cable', 'helicoptero', 'dron', 'lateral', 'suelo', 'persecucion', 'cercana',
  'cabina', 'cara', 'tcam', 'morro', 'rueda', 'ruedaTras', 'trasera', 'orbita', 'libre'];
export const NOMBRES_REPE = {
  director: 'Director (automática)', tv: 'Cámaras de TV', grua: 'Grúa de TV', cable: 'Cámara aérea (cable)', helicoptero: 'Helicóptero', dron: 'Dron', lateral: 'Travelling lateral',
  suelo: 'A ras de suelo', persecucion: 'Persecución', cercana: 'Cercana', cabina: 'Cabina', cara: 'Cara del piloto', tcam: 'T-Cam',
  morro: 'Morro', rueda: 'Rueda delantera', ruedaTras: 'Rueda trasera', trasera: 'Alerón trasero', orbita: 'Órbita (arrastra)', libre: 'Cámara libre',
};
// planos que el director usa para montar la secuencia, con duración (s)
const PLANOS_DIRECTOR = [['tv', 6], ['grua', 5], ['cable', 5], ['lateral', 5], ['suelo', 4], ['dron', 6], ['rueda', 4], ['ruedaTras', 4], ['helicoptero', 5], ['persecucion', 5], ['morro', 4], ['trasera', 4], ['cara', 3.5]];
// cámaras fijadas a la carrocería: posición y punto al que miran en ejes del coche (x adelante, y arriba, z lateral)
const MONTADAS = {
  morro: { pos: [2.55, 0.42, 0], mira: [40, 0.2, 0], fov: 70 },
  rueda: { pos: [0.35, 0.62, 1.12], mira: [30, 0.15, 0.4], fov: 62 },
  trasera: { pos: [-2.55, 1.18, 0], mira: [6, 0.55, 0], fov: 58 },
  // en el lateral del pontón mirando hacia atrás: la rueda trasera, el difusor y lo que viene detrás
  ruedaTras: { pos: [-0.35, 0.78, 0.82], mira: [-30, 0.05, 1.3], fov: 64 },
};
const _v = new THREE.Vector3(), _m = new THREE.Vector3(), _up = new THREE.Vector3();

export class CamaraRepe {
  constructor(circuito, camarasTV, camaraJuego) {
    this.c = circuito;
    this.tv = camarasTV;
    this.juego = camaraJuego;
    this.libre = { pos: new THREE.Vector3(), yaw: 0, pitch: -0.15, iniciada: false };
    this.orbita = { ang: 2.6, alto: 0.25, dist: 7, auto: true };
    this.suelo = null;
    this.dir = { plano: 'tv', t: 0, dur: 5, k: 0 };
    this.fovExtra = 0;          // zoom del usuario (grados)
    this.alabeo = 0;            // giro de la imagen (rad), para planos holandeses
    this.sacudida = 1;          // vibración de las cámaras a bordo
    this.teclas = new Set();
  }

  /** Cambia de cámara: la libre arranca donde estaba la anterior. */
  poner(modo, cam) {
    if (modo === 'libre') {
      const l = this.libre;
      l.pos.copy(cam.position);
      cam.getWorldDirection(_v);
      l.yaw = Math.atan2(_v.z, _v.x); l.pitch = Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1));
    }
    if (modo === 'director') this.dir.t = 1e9;
    this.suelo = null;
    this.juego.iniciada = false;
  }

  /** Arrastre (dx, dy en píxeles) y pellizco/rueda (dz > 0 acerca). */
  arrastrar(modo, dx, dy) {
    if (modo === 'libre') { this.libre.yaw += dx * 0.004; this.libre.pitch = THREE.MathUtils.clamp(this.libre.pitch - dy * 0.004, -1.45, 1.45); }
    else if (modo === 'orbita') { const o = this.orbita; o.auto = false; o.ang -= dx * 0.008; o.alto = THREE.MathUtils.clamp(o.alto + dy * 0.004, -0.05, 1.35); }
  }
  acercar(modo, dz) {
    if (modo === 'libre') this._mover(dz * 0.05, 0, 0);
    else if (modo === 'orbita') this.orbita.dist = THREE.MathUtils.clamp(this.orbita.dist * (1 - dz * 0.002), 2.6, 60);
    else this.fovExtra = THREE.MathUtils.clamp(this.fovExtra - dz * 0.03, -45, 30);
  }
  /** Desplaza la cámara libre en sus ejes: adelante, lado, arriba (m). */
  _mover(adel, lado, arriba) {
    const l = this.libre, cy = Math.cos(l.yaw), sy = Math.sin(l.yaw), cp = Math.cos(l.pitch);
    l.pos.x += cy * cp * adel - sy * lado;
    l.pos.z += sy * cp * adel + cy * lado;
    l.pos.y += Math.sin(l.pitch) * adel + arriba;
  }

  actualizar(cam, car, modelo, modo, dt) {
    let m = modo;
    if (modo === 'director') m = this._director(car, dt);
    cam.up.set(0, 1, 0);
    let fov = 50;
    if (['persecucion', 'cercana', 'cabina', 'cara', 'tcam'].includes(m)) {
      this.juego.modo = m;
      this.juego.actualizar(dt, this.sacudida ? car : { ...car, vibracion: 0, velocidad: 0 }, modelo);
      fov = cam.fov;
    } else if ((m === 'grua' || m === 'cable') && this._equipoUtil(m, car)) {
      this._planoEquipo(cam, car, m, dt);
      fov = m === 'grua' ? 34 : 42;
    } else if (m === 'tv' || m === 'helicoptero' || m === 'grua' || m === 'cable') {
      // grúa y cable solo sirven en la recta principal: lejos de ella, cámaras de TV
      if (m === 'grua' || m === 'cable') m = 'tv';
      this.tv.actualizar(cam, car, m, dt);
      fov = cam.fov;
    } else if (MONTADAS[m]) {
      const d = MONTADAS[m];
      modelo.raiz.updateMatrixWorld(true);
      const mw = modelo.carroceria.matrixWorld;
      cam.position.copy(_v.fromArray(d.pos).applyMatrix4(mw));
      if (this.sacudida && car.velocidad > 5) { const t = performance.now() / 1000, a = 0.004 + (car.vibracion || 0) * 0.01; cam.position.y += Math.sin(t * 67) * a; }
      cam.up.copy(_up.set(0, 1, 0).transformDirection(mw));
      cam.lookAt(_m.fromArray(d.mira).applyMatrix4(mw));
      fov = d.fov; cam.near = 0.05;
    } else if (m === 'dron') {
      // sigue al coche desde detrás y arriba, girando despacio a su alrededor
      this.tDron = (this.tDron || 0) + dt;
      const a = car.psi + Math.PI + Math.sin(this.tDron * 0.18) * 0.9, r = 14 + Math.sin(this.tDron * 0.11) * 4;
      const obj = _v.set(car.x + Math.cos(a) * r, car.y + 6 + Math.sin(this.tDron * 0.23) * 2.5, car.z + Math.sin(a) * r);
      if (!this._dron || this._dron.distanceTo(obj) > 60) this._dron = obj.clone();
      this._dron.lerp(obj, 1 - Math.exp(-dt * 2.2));
      cam.position.copy(this._dron);
      cam.lookAt(car.x + Math.cos(car.psi) * 4, car.y + 0.4, car.z + Math.sin(car.psi) * 4);
      fov = 46; cam.near = 0.2;
    } else if (m === 'lateral') {
      // travelling: un coche cámara va al lado a la misma velocidad, con teleobjetivo
      const lado = this._ladoLibre(car);
      const nx = -Math.sin(car.psi) * lado, nz = Math.cos(car.psi) * lado;
      const obj = _v.set(car.x + nx * 11 - Math.cos(car.psi) * 1.5, car.y + 1.1, car.z + nz * 11 - Math.sin(car.psi) * 1.5);
      if (!this._lat || this._lat.distanceTo(obj) > 30) this._lat = obj.clone();
      this._lat.lerp(obj, 1 - Math.exp(-dt * 6));
      cam.position.copy(this._lat);
      cam.lookAt(car.x, car.y + 0.45, car.z);
      fov = 32; cam.near = 0.2;
    } else if (m === 'suelo') {
      // cámara casi en el asfalto junto al bordillo, por delante; el coche pasa rozándola
      const c = this.c;
      const s = car.proj?.s ?? c.proyectar(car.x, car.z, -1, {}).s;
      let ds = this.suelo ? c.envolver(this.suelo.s - s) : -1;
      if (!this.suelo || (ds > c.largo / 2 && c.largo - ds > 25) || ds > 160) {
        const s2 = c.envolver(s + 70), mm = c.muestra(s2), lado = c.curvSuave[mm.i] > 0 ? 1 : -1;
        const d = lado * (c.semiAncho[mm.i] + 0.6);
        this.suelo = { s: s2, pos: new THREE.Vector3(mm.x - mm.tz * d, mm.y + 0.28, mm.z + mm.tx * d) };
      }
      cam.position.copy(this.suelo.pos);
      cam.lookAt(car.x, car.y + 0.35, car.z);
      const dist = this.suelo.pos.distanceTo(_v.set(car.x, car.y, car.z));
      fov = THREE.MathUtils.clamp(2 * Math.atan(5 / dist) * 180 / Math.PI, 14, 72); cam.near = 0.05;
    } else if (m === 'orbita') {
      const o = this.orbita;
      if (o.auto) o.ang += dt * 0.25;
      const a = car.psi + o.ang, ch = Math.cos(o.alto);
      cam.position.set(car.x + Math.cos(a) * o.dist * ch, car.y + 0.45 + Math.sin(o.alto) * o.dist, car.z + Math.sin(a) * o.dist * ch);
      if (cam.position.y < car.y + 0.12) cam.position.y = car.y + 0.12;
      cam.lookAt(car.x, car.y + 0.45, car.z);
      fov = 45; cam.near = 0.05;
    } else if (m === 'libre') {
      const l = this.libre, k = (this.teclas.has('shift') ? 60 : 15) * dt;
      const T = (a) => this.teclas.has(a);
      this._mover(((T('w') || T('arrowup')) - (T('s') || T('arrowdown'))) * k, ((T('d') || T('arrowright')) - (T('a') || T('arrowleft'))) * k, (T('e') - T('q')) * k);
      const suelo = this.c.y[this.c.proyectar(l.pos.x, l.pos.z, -1, {}).i] + 0.15;
      if (l.pos.y < suelo) l.pos.y = suelo;
      cam.position.copy(l.pos);
      cam.lookAt(l.pos.x + Math.cos(l.yaw) * Math.cos(l.pitch), l.pos.y + Math.sin(l.pitch), l.pos.z + Math.sin(l.yaw) * Math.cos(l.pitch));
      fov = 55; cam.near = 0.05;
    }
    this.planoActual = m;
    if (this.alabeo) cam.rotateZ(this.alabeo);
    cam.fov = THREE.MathUtils.clamp(fov + this.fovExtra, 4, 110);
    cam.updateProjectionMatrix();
  }

  /** ¿Está el coche cerca de la grúa o bajo el cable? */
  _equipoUtil(m, car) {
    const e = this.equipoTV;
    if (!e) return false;
    if (m === 'grua') return e.grua && Math.hypot(car.x - e.grua.pos.x, car.z - e.grua.pos.z) < 130;
    const { a, b } = e.cable, ab = _v.subVectors(b, a), L2 = ab.lengthSq();
    const u = ((car.x - a.x) * ab.x + (car.z - a.z) * ab.z) / L2;
    return u > -0.1 && u < 1.1;
  }

  /** Mueve la grúa o el carro del cable hacia el coche y pone la cámara en su cabeza. */
  _planoEquipo(cam, car, m, dt) {
    const e = this.equipoTV;
    if (m === 'grua') {
      const g = e.grua;
      g.base.updateMatrixWorld(true);
      // el brazo gira hacia el coche y se inclina para seguirlo
      const loc = g.base.worldToLocal(_v.set(car.x, car.y, car.z));
      const yaw = Math.atan2(-loc.z, loc.x);
      g.giro.rotation.y += (yaw - g.giro.rotation.y) * Math.min(1, dt * 3);
      const dist = Math.hypot(loc.x, loc.z);
      g.brazo.rotation.z += (Math.atan2(1.5 - 4.8, Math.max(4, dist - 8)) * 0.6 - g.brazo.rotation.z) * Math.min(1, dt * 2);
      g.cabeza.updateMatrixWorld(true);
      cam.position.setFromMatrixPosition(g.cabeza.matrixWorld); cam.position.y -= 0.35;
    } else {
      const { a, b, dolly } = e.cable, ab = _m.subVectors(b, a), L2 = ab.lengthSq();
      // el carro corre por el cable un poco por detrás del coche
      const u = THREE.MathUtils.clamp(((car.x - a.x) * ab.x + (car.z - a.z) * ab.z) / L2 - 12 / Math.sqrt(L2), 0, 1);
      const obj = _v.copy(a).addScaledVector(ab, u);
      dolly.position.lerp(obj, Math.min(1, dt * 2.5));
      cam.position.copy(dolly.position); cam.position.y -= 0.5;
    }
    cam.lookAt(car.x, car.y + 0.4, car.z);
    cam.near = 0.1;
  }

  // lado de la pista con más sitio para el travelling (el exterior en las curvas)
  _ladoLibre(car) {
    const i = car.proj?.i ?? 0;
    const k = this.c.curvSuave[i];
    if (Math.abs(k) > 0.002) this._ladoLat = k > 0 ? -1 : 1;
    return this._ladoLat ?? 1;
  }

  _director(car, dt) {
    const d = this.dir;
    d.t += dt;
    if (d.t > d.dur) {
      // el siguiente plano: aleatorio, distinto al anterior; más TV si el coche va lento
      let k;
      do k = Math.floor(Math.random() * PLANOS_DIRECTOR.length); while (k === d.k);
      if (car.velocidad < 15 && Math.random() < 0.6) k = 0;
      d.k = k; d.plano = PLANOS_DIRECTOR[k][0]; d.dur = PLANOS_DIRECTOR[k][1] * (0.8 + Math.random() * 0.5); d.t = 0;
      this.suelo = null; this._dron = null; this._lat = null; this.juego.iniciada = false;
    }
    return d.plano;
  }
}
