// Clima de cada planeta: alterna entre despejado y su clima propio (tormenta de neón con rayos,
// lluvia ácida, ventisca o calor extremo) cada pocos minutos; auroras de noche en los planetas
// fríos y de cristal. Devuelve los efectos sobre la visibilidad y los daños al traje y la nave.
import * as THREE from 'three';

const DUR = 150;     // s de cada fase del clima

export class Clima {
  constructor(scene) {
    this.scene = scene;
    const n = 1400, p = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) { const x = (Math.random() - 0.5) * 120, y = Math.random() * 80 - 20, z = (Math.random() - 0.5) * 120; p.set([x, y, z, x, y - 1.5, z], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.lluvia = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#9adfff', transparent: true, opacity: 0.55, fog: false }));
    this.lluvia.frustumCulled = false; this.lluvia.visible = false; scene.add(this.lluvia);
    this.base = p.slice(); this.t = 0;
    // aurora: cortina de luz en lo alto
    const ga = new THREE.PlaneGeometry(9000, 1500, 60, 1);
    this.aurora = new THREE.Mesh(ga, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { t: { value: 0 }, a: { value: 0 } },
      vertexShader: `varying vec2 vU; uniform float t; void main() { vU = uv; vec3 p = position; p.z += sin(p.x * 0.002 + t * 0.3) * 600.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `varying vec2 vU; uniform float t; uniform float a; void main() { float o = smoothstep(0.0, 0.25, vU.y) * (1.0 - vU.y) * (0.5 + 0.5 * sin(vU.x * 40.0 + t)); gl_FragColor = vec4(mix(vec3(0.1, 1.0, 0.6), vec3(0.8, 0.2, 1.0), vU.y), o * a * 0.7); }`,
    }));
    this.aurora.visible = false; scene.add(this.aurora);
    this.flash = 0; this.tRayo = 5;
  }

  /** Clima actual del planeta. */
  actual(pl) { if (!pl) return 'despejado'; const k = Math.floor((Date.now() / 1000 + (pl.p.semilla % 997)) / DUR) % 2; return pl.p.climas[k]; }

  actualizar(dt, pl, cam, densidad, noche, audio) {
    this.t += dt;
    const cl = densidad > 0.05 ? this.actual(pl) : 'despejado';
    const efecto = { clima: cl, visibilidad: 1, cielo: 1, traje: 0, nave: 0, color: null };
    const llueve = cl === 'tormenta' || cl === 'acido' || cl === 'ventisca';
    this.lluvia.visible = llueve;
    if (llueve) {
      const mat = this.lluvia.material, p = this.lluvia.geometry.attributes.position.array, caida = cl === 'ventisca' ? 6 : 38;
      mat.color.set(cl === 'acido' ? '#c6ff00' : cl === 'ventisca' ? '#ffffff' : '#9adfff');
      const largo = cl === 'ventisca' ? 0.25 : 1.6;
      for (let i = 0; i < p.length; i += 6) {
        p[i + 1] -= caida * dt; if (cl === 'ventisca') { p[i] += Math.sin(this.t + i) * dt * 4; }
        if (p[i + 1] < -20) p[i + 1] += 80;
        p[i + 3] = p[i]; p[i + 4] = p[i + 1] - largo; p[i + 5] = p[i + 2];
      }
      this.lluvia.geometry.attributes.position.needsUpdate = true;
      this.lluvia.position.copy(cam.position); this.lluvia.quaternion.copy(cam.quaternion);
    }
    if (cl === 'tormenta') {
      efecto.visibilidad = 0.45; efecto.cielo = 0.55;
      this.tRayo -= dt;
      if (this.tRayo <= 0) { this.tRayo = 4 + Math.random() * 8; this.flash = 1; setTimeout(() => audio?.trueno(), 400 + Math.random() * 1200); }
    } else if (cl === 'acido') { efecto.visibilidad = 0.55; efecto.cielo = 0.7; efecto.traje = 2.2; efecto.nave = 0.5; efecto.color = '#c6ff00'; }
    else if (cl === 'ventisca') { efecto.visibilidad = 0.22; efecto.cielo = 0.85; efecto.traje = 1.6; efecto.color = '#dfefff'; }
    else if (cl === 'calor') { efecto.traje = noche ? 0 : 1.3; efecto.color = '#ff8a3d'; }
    this.flash = Math.max(0, this.flash - dt * 3);
    efecto.flash = this.flash;
    // auroras en los planetas fríos y de cristal, de noche
    const aur = pl && noche && densidad > 0.3 && ['helado', 'cristal', 'neon'].includes(pl.p.tipo);
    this.aurora.visible = !!aur;
    if (aur) {
      const up = cam.up;
      this.aurora.position.copy(cam.position).addScaledVector(up, 1800).add(new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).cross(up).multiplyScalar(-3000));
      this.aurora.lookAt(cam.position); this.aurora.material.uniforms.t.value = this.t; this.aurora.material.uniforms.a.value = Math.min(1, densidad);
    }
    return efecto;
  }
}
