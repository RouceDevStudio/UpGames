// Estación espacial del sistema (comercio, reparaciones, mejoras, astillero, misiones y terminal
// para hackear) y su circuito de anillos de neón para hacer carreras de naves contra el reloj.
import * as THREE from 'three';
import { materialToon } from './planeta.js';

export class Estacion {
  constructor(scene, sis) {
    this.scene = scene; this.sis = sis;
    const c = sis.faccion.color;
    const g = this.obj = new THREE.Group(); g.position.set(...sis.estacion.pos);
    const casco = materialToon({ color: '#2a2f45' }), neon = new THREE.MeshBasicMaterial({ color: c }), rosa = new THREE.MeshBasicMaterial({ color: '#ff2e88' });
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(60, 80, 260, 12), casco));
    const anillo = new THREE.Mesh(new THREE.TorusGeometry(260, 22, 10, 48), casco); anillo.rotation.x = Math.PI / 2; this.anillo = anillo; g.add(anillo);
    const neonA = new THREE.Mesh(new THREE.TorusGeometry(260, 4, 6, 64), neon); neonA.rotation.x = Math.PI / 2; neonA.position.y = 23; anillo.add(neonA);
    for (let k = 0; k < 4; k++) { const r = new THREE.Mesh(new THREE.BoxGeometry(260, 12, 12), casco); r.rotation.y = k * Math.PI / 4; anillo.add(r); }
    // hangar con su boca iluminada (por aquí se atraca)
    const bahia = new THREE.Mesh(new THREE.BoxGeometry(110, 50, 70), casco); bahia.position.set(0, -150, 0); g.add(bahia);
    const boca = new THREE.Mesh(new THREE.PlaneGeometry(80, 30), rosa); boca.position.set(0, -150, 35.5); g.add(boca);
    const baliza = new THREE.Mesh(new THREE.SphereGeometry(10, 10, 8), neon); baliza.position.y = 150; g.add(baliza); this.baliza = baliza;
    this.puerta = new THREE.Vector3(0, -150, 140).add(g.position);
    scene.add(g);
    // circuito de anillos
    this.anillos = sis.anillos.map((a, k) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(55, 3, 8, 40), new THREE.MeshBasicMaterial({ color: k === 0 ? '#39ff88' : '#ff2e88', transparent: true, opacity: 0.85 }));
      m.position.set(...a.pos); m.lookAt(m.position.clone().add(new THREE.Vector3(...a.dir))); scene.add(m);
      return m;
    });
    this.carrera = null;
  }
  destruir() { this.scene.remove(this.obj); for (const a of this.anillos) this.scene.remove(a); }

  actualizar(dt, nave) {
    this.anillo.rotation.z += dt * 0.05;
    this.baliza.material.color.offsetHSL(0, 0, Math.sin(performance.now() / 300) * 0.002);
    // carrera de anillos: empieza al cruzar el primero (verde) y se pasa por todos en orden
    const sig = this.carrera ? this.carrera.sig : 0, a = this.anillos[sig];
    if (!a) return null;
    const d = a.position.distanceTo(nave.pos);
    let evento = null;
    if (d < 55) {
      if (!this.carrera) { this.carrera = { t: 0, sig: 1 }; evento = { tipo: 'inicio' }; }
      else { this.carrera.sig++; evento = { tipo: 'anillo', n: this.carrera.sig - 1 };
        if (this.carrera.sig >= this.anillos.length) { evento = { tipo: 'fin', t: this.carrera.t }; this.carrera = null; } }
      this.anillos.forEach((m, k) => m.material.color.set(this.carrera ? (k === this.carrera.sig ? '#39ff88' : k < this.carrera.sig ? '#333a55' : '#ff2e88') : (k === 0 ? '#39ff88' : '#ff2e88')));
    }
    if (this.carrera) { this.carrera.t += dt; if (this.carrera.t > 240) { this.carrera = null; evento = { tipo: 'abandono' }; this.anillos.forEach((m, k) => m.material.color.set(k === 0 ? '#39ff88' : '#ff2e88')); } }
    return evento;
  }
  /** Siguiente anillo (para la flecha del HUD). */
  siguiente() { return this.carrera ? this.anillos[this.carrera.sig] : null; }
}
