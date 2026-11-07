// Partículas sencillas (chispas, humo, explosiones, lluvia de restos) en un único objeto Points
// con color y tamaño por partícula: una sola llamada de dibujo para todo.
import * as THREE from 'three';

export class Particulas {
  constructor(scene, max = 3000) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vida = new Float32Array(max); this.vida0 = new Float32Array(max); this.tam = new Float32Array(max); this.arr = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tam', new THREE.BufferAttribute(this.tam, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      vertexShader: `attribute float tam; varying vec3 vC;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() { vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = tam * 300.0 / max(1.0, -mv.z); gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `varying vec3 vC;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vC * (1.0 - d * 1.6), 1.0); }`,
    });
    this.pts = new THREE.Points(g, m); this.pts.frustumCulled = false; scene.add(this.pts);
  }
  emitir(p, v, color, tam, vida, arrastre = 1) {
    const i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.vida[i] = this.vida0[i] = vida; this.tam[i] = tam; this.arr[i] = arrastre;
  }
  explosion(p, color, n = 60, fuerza = 30, tam = 3) {
    const v = new THREE.Vector3(), c = new THREE.Color(color), b = new THREE.Color('#ffffff');
    for (let k = 0; k < n; k++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(fuerza * (0.3 + Math.random()));
      this.emitir(p, v, k % 4 ? c : b, tam * (0.5 + Math.random()), 0.6 + Math.random() * 0.9, 1.5);
    }
  }
  actualizar(dt) {
    let i = 0;
    while (i < this.n) {
      this.vida[i] -= dt;
      if (this.vida[i] <= 0) {
        // la última ocupa su hueco
        const j = --this.n;
        for (const a of [this.pos, this.vel, this.col]) { a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2]; }
        this.vida[i] = this.vida[j]; this.vida0[i] = this.vida0[j]; this.tam[i] = this.tam[j]; this.arr[i] = this.arr[j];
        continue;
      }
      const f = Math.exp(-dt * this.arr[i]);
      for (let k = 0; k < 3; k++) { this.vel[i * 3 + k] *= f; this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; }
      const u = this.vida[i] / this.vida0[i];
      this.col[i * 3] *= 0.985 + 0.015 * u; this.col[i * 3 + 1] *= 0.98; this.col[i * 3 + 2] *= 0.98;
      i++;
    }
    const g = this.pts.geometry;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.tam.needsUpdate = true;
  }
}
