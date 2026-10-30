// Cámaras: persecución, cercana, T-cam (sobre la toma de aire) y cabina.

import * as THREE from 'three';

export const MODOS_CAMARA = ['persecucion', 'cercana', 'tcam', 'cabina', 'cara', 'tv'];
export const NOMBRES_CAMARA = { persecucion: 'Persecución', cercana: 'Cercana', tcam: 'T-Cam', cabina: 'Cabina', cara: 'Cara del piloto', tv: 'TV y boxes' };

export class Camara {
  constructor(aspecto) {
    this.cam = new THREE.PerspectiveCamera(62, aspecto, 0.08, 9000);
    this.modo = 'persecucion';
    this.pos = new THREE.Vector3();
    this.rumbo = 0;
    this.iniciada = false;
    this.fovBase = 62;
    this.tiempo = 0;
    this.mirarAtras = false;
  }

  siguiente() {
    const i = MODOS_CAMARA.indexOf(this.modo);
    this.modo = MODOS_CAMARA[(i + 1) % MODOS_CAMARA.length];
    return this.modo;
  }

  actualizar(dt, car, modelo) {
    this.tiempo += dt;
    const v = car.velocidad;
    const cam = this.cam;
    const cos = Math.cos(car.psi), sin = Math.sin(car.psi);
    // vibración por bordillos, hierba y velocidad
    const vib = car.vibracion * 0.02 + Math.min(1, v / 90) * 0.0025;
    const t = this.tiempo;
    const sx = (Math.sin(t * 61) + Math.sin(t * 97)) * vib, sy = (Math.sin(t * 73) + Math.sin(t * 41)) * vib;

    if (this.modo === 'orbita') {
      // garaje: vuelta lenta alrededor del coche parado
      this.angulo = (this.angulo ?? 2.4) + dt * 0.22;
      const r = 6.2;
      cam.position.set(car.x + Math.cos(car.psi + this.angulo) * r, car.y + 1.7 + Math.sin(this.tiempo * 0.3) * 0.3, car.z + Math.sin(car.psi + this.angulo) * r);
      cam.up.set(0, 1, 0);
      cam.lookAt(car.x, car.y + 0.45, car.z);
      cam.near = 0.1;
      cam.fov += (50 - cam.fov) * Math.min(1, dt * 3);
      // el panel del garaje ocupa la derecha: el coche se dibuja desplazado a la izquierda
      const w = innerWidth, h = innerHeight;
      cam.setViewOffset(w, h, w * 0.22, 0, w, h);
      cam.updateProjectionMatrix();
      return;
    }
    if (cam.view?.enabled) cam.clearViewOffset();
    if (this.modo === 'tv' && this.tv) {
      // en la calle de boxes, cámara fija junto al garaje; en pista, las cámaras de TV
      const c = this.tv.c;
      if (c.uPit(car.proj.s) >= 0) {
        const m = c.muestra(car.proj.s + 9), i = m.i;
        const d = c.semiAncho[i] + c.pit.ancho - 1.2;
        cam.position.set(m.x - m.tz * d, m.y + 2.3, m.z + m.tx * d);
        cam.up.set(0, 1, 0);
        cam.lookAt(car.x, car.y + 0.5, car.z);
        cam.fov += (48 - cam.fov) * Math.min(1, dt * 3); cam.near = 0.1;
      } else this.tv.actualizar(cam, car, 'tv', dt);
      cam.updateProjectionMatrix();
      this.iniciada = false;
      return;
    }
    if (this.modo === 'persecucion' || this.modo === 'cercana') {
      const cerca = this.modo === 'cercana';
      const dist = cerca ? 4.6 : 6.8, alto = cerca ? 1.45 : 2.05;
      // rumbo suavizado: la cámara se queda algo atrás en los giros
      let d = car.psi - this.rumbo;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.rumbo += d * Math.min(1, dt * (cerca ? 7 : 5.5));
      if (!this.iniciada) this.rumbo = car.psi;
      const sentido = this.mirarAtras ? -1 : 1;
      const cr = Math.cos(this.rumbo), sr = Math.sin(this.rumbo);
      const obj = new THREE.Vector3(car.x - cr * dist * sentido, car.y + alto, car.z - sr * dist * sentido);
      if (!this.iniciada) { this.pos.copy(obj); this.iniciada = true; }
      // la posición sigue al coche de forma rígida (el retraso lo da el rumbo suavizado);
      // solo la altura se suaviza para absorber baches y cambios de rasante
      const ky = 1 - Math.exp(-dt * 8);
      this.pos.x = obj.x; this.pos.z = obj.z;
      this.pos.y += (obj.y - this.pos.y) * ky;
      // no atravesar el suelo
      if (this.pos.y < car.y + 0.6) this.pos.y = car.y + 0.6;
      cam.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
      cam.up.set(0, 1, 0);
      cam.lookAt(car.x + cos * 3.5 * sentido, car.y + 0.75, car.z + sin * 3.5 * sentido);
      cam.near = 0.1;
    } else {
      // cámaras a bordo: siguen el cabeceo y balanceo de la carrocería
      const cara = this.modo === 'cara';
      const local = this.modo === 'tcam' ? new THREE.Vector3(-0.32, 1.13, 0) : cara ? new THREE.Vector3(0.60, 0.94, 0) : new THREE.Vector3(0.16, 0.90, 0);
      const mirar = this.modo === 'tcam' ? new THREE.Vector3(30, 0.4, 0) : cara ? new THREE.Vector3(0.0, 0.83, 0) : new THREE.Vector3(30, -0.2, 0);
      // en la cabina la vista acompaña el giro de la cabeza del piloto hacia la curva
      if (this.modo === 'cabina' && modelo.mirada) mirar.applyAxisAngle(new THREE.Vector3(0, 1, 0), modelo.mirada * 0.85);
      if (this.mirarAtras) { mirar.x = -30; local.x = this.modo === 'tcam' ? -0.6 : -0.1; local.y += 0.1; }
      modelo.raiz.updateMatrixWorld(true);
      const m = modelo.carroceria.matrixWorld;
      cam.position.copy(local.applyMatrix4(m));
      cam.position.x += sx * 0.3; cam.position.y += sy * 0.5;
      const up = new THREE.Vector3(0, 1, 0).transformDirection(m);
      cam.up.copy(up);
      cam.lookAt(mirar.applyMatrix4(m));
      cam.near = 0.05;
      this.iniciada = false;
    }
    // el campo de visión se abre con la velocidad
    const fov = this.modo === 'cara' ? 56 : this.fovBase + Math.min(14, v * 0.13) + (this.modo === 'cabina' ? 6 : 0);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    cam.updateProjectionMatrix();
  }
}
