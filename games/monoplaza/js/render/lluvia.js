// Lluvia: gotas en trazos alrededor de la cámara, cielo cubierto, asfalto mojado
// que brilla y niebla más cerrada. Todo escala con la intensidad (0..1).

import * as THREE from 'three';

export class Lluvia {
  constructor(scene, escenario, calidad) {
    this.esc = escenario;
    this.n = calidad >= 2 ? 5000 : calidad >= 1 ? 2600 : 1300;
    const pos = new Float32Array(this.n * 6);
    this.base = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) {
      this.base[i * 3] = (Math.random() - 0.5) * 70;
      this.base[i * 3 + 1] = Math.random() * 30;
      this.base[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0, depthWrite: false });
    this.lineas = new THREE.LineSegments(g, this.mat);
    this.lineas.frustumCulled = false;
    scene.add(this.lineas);
    this.scene = scene;
    this.t = 0;
    // valores de seco para volver a ellos
    this.fogColor = scene.fog.color.clone();
    this.fogFar = scene.fog.far;
    this.sol = escenario.luzSol.intensity;
    this.exp = null;
    const m = escenario.matAsfalto;
    this.asf = m ? { rough: m.roughness, color: m.color.clone() } : null;
    this.intensidad = -1;
  }

  actualizar(dt, camPos, lluvia, agua, renderer) {
    this.t += dt;
    const on = lluvia > 0.02;
    this.lineas.visible = on;
    if (on) {
      const p = this.lineas.geometry.attributes.position.array;
      const caida = 22, largo = 0.55 + lluvia * 0.5;
      for (let i = 0; i < this.n; i++) {
        let y = this.base[i * 3 + 1] - ((this.t * caida + i * 0.37) % 30);
        if (y < 0) y += 30;
        const x = camPos.x + this.base[i * 3], z = camPos.z + this.base[i * 3 + 2], yy = camPos.y - 8 + y;
        p[i * 6] = x; p[i * 6 + 1] = yy; p[i * 6 + 2] = z;
        p[i * 6 + 3] = x + 0.06; p[i * 6 + 4] = yy + largo; p[i * 6 + 5] = z + 0.04;
      }
      this.lineas.geometry.attributes.position.needsUpdate = true;
      this.mat.opacity = 0.18 + lluvia * 0.35;
    }
    // ambiente: solo se recalcula cuando cambia algo
    const clave = Math.round(lluvia * 50) + Math.round(agua * 50) * 100;
    if (clave === this.intensidad) return;
    this.intensidad = clave;
    const nube = Math.min(1, lluvia * 1.4 + agua * 0.3);
    this.scene.fog.color.copy(this.fogColor).lerp(new THREE.Color(0x6f7a86), nube);
    this.scene.fog.far = this.fogFar * (1 - 0.55 * lluvia);
    this.esc.luzSol.intensity = this.sol * (1 - 0.7 * nube);
    if (this.esc.hemi) this.esc.hemi.intensity = 0.55 + 0.35 * nube;
    if (renderer) renderer.toneMappingExposure = 0.92 - 0.12 * nube;
    if (this.asf) {
      // asfalto mojado: más oscuro y con reflejos
      const m = this.esc.matAsfalto;
      m.roughness = this.asf.rough * (1 - 0.62 * agua);
      m.metalness = 0.12 * agua;
      m.color.copy(this.asf.color).multiplyScalar(1 - 0.35 * agua);
    }
  }

  quitar() { this.scene.remove(this.lineas); this.lineas.geometry.dispose(); this.mat.dispose(); }
}
