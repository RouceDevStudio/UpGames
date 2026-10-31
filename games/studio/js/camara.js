// Cámara orbital propia (sin OrbitControls) para mandarla con los gestos de gestos.js.
import * as THREE from 'three';

const VISTAS = {
  frente: { yaw: 0, pitch: 0 },
  lado: { yaw: Math.PI / 2, pitch: 0 },
  arriba: { yaw: 0, pitch: Math.PI / 2 - 0.001 },
  persp: { yaw: Math.PI / 5, pitch: 0.42 },
};

export class CamaraOrbital {
  constructor(camara) {
    this.camara = camara;
    this.centro = new THREE.Vector3(0, 0.5, 0);
    this.yaw = VISTAS.persp.yaw;
    this.pitch = VISTAS.persp.pitch;
    this.dist = 7;
    this.meta = null; // animación hacia { centro, yaw, pitch, dist }
    this.aplicar();
  }

  // dx, dy en píxeles
  orbitar(dx, dy) {
    this.meta = null;
    this.yaw -= dx * 0.008;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.008, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
  }

  // f > 1 aleja, f < 1 acerca
  zoom(f) {
    this.meta = null;
    this.dist = THREE.MathUtils.clamp(this.dist * f, 0.15, 400);
  }

  desplazar(dx, dy, altoPantalla) {
    this.meta = null;
    const porPixel = (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camara.fov / 2))) / altoPantalla;
    const der = new THREE.Vector3().setFromMatrixColumn(this.camara.matrix, 0);
    const arr = new THREE.Vector3().setFromMatrixColumn(this.camara.matrix, 1);
    this.centro.addScaledVector(der, -dx * porPixel).addScaledVector(arr, dy * porPixel);
  }

  enfocar(centro, radio) {
    const dist = Math.max(radio, 0.1) / Math.sin(THREE.MathUtils.degToRad(this.camara.fov / 2)) * 1.15;
    this.meta = { centro: centro.clone(), yaw: this.yaw, pitch: this.pitch, dist };
  }

  vista(nombre) {
    const v = VISTAS[nombre];
    if (!v) return;
    // por el camino más corto
    let yaw = v.yaw;
    while (yaw - this.yaw > Math.PI) yaw -= 2 * Math.PI;
    while (yaw - this.yaw < -Math.PI) yaw += 2 * Math.PI;
    this.meta = { centro: this.centro.clone(), yaw, pitch: v.pitch, dist: this.dist };
  }

  actualizar(dt) {
    if (this.meta) {
      const k = 1 - Math.exp(-dt * 12);
      this.centro.lerp(this.meta.centro, k);
      this.yaw += (this.meta.yaw - this.yaw) * k;
      this.pitch += (this.meta.pitch - this.pitch) * k;
      this.dist += (this.meta.dist - this.dist) * k;
      if (Math.abs(this.meta.yaw - this.yaw) + Math.abs(this.meta.pitch - this.pitch) < 1e-4 &&
          Math.abs(this.meta.dist - this.dist) < 1e-3 && this.centro.distanceTo(this.meta.centro) < 1e-3) this.meta = null;
    }
    this.aplicar();
  }

  aplicar() {
    const c = Math.cos(this.pitch);
    this.camara.position.set(
      this.centro.x + this.dist * c * Math.sin(this.yaw),
      this.centro.y + this.dist * Math.sin(this.pitch),
      this.centro.z + this.dist * c * Math.cos(this.yaw),
    );
    this.camara.up.set(0, 1, 0);
    this.camara.lookAt(this.centro);
    this.camara.near = Math.max(0.01, this.dist * 0.01);
    this.camara.far = Math.max(500, this.dist * 50);
    this.camara.updateProjectionMatrix();
    this.camara.updateMatrixWorld();
  }
}
