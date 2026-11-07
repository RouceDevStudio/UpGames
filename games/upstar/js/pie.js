// A pie: astronauta de dibujo que camina sobre la esfera del planeta con su gravedad (en los
// planetas ligeros se salta más), salta, usa el jetpack (con combustible que se recarga en el
// suelo) y el doble salto si tiene el implante. Cámara en tercera persona que gira con el dedo
// o el ratón.
import * as THREE from 'three';
import { materialToon } from './planeta.js';

function modeloAstronauta(color = '#e8ecf5', luz = '#00f0ff') {
  const g = new THREE.Group();
  const traje = materialToon({ color }), oscuro = materialToon({ color: '#20243a' });
  const visor = new THREE.MeshBasicMaterial({ color: luz });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.CapsuleGeometry(0.32, 0.55, 4, 10), traje, 0, 1.0, 0);                    // torso
  const casco = add(new THREE.SphereGeometry(0.3, 14, 10), traje, 0, 1.68, 0);
  const v = add(new THREE.SphereGeometry(0.22, 12, 8, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.35), visor, 0, 1.7, -0.1); v.rotation.y = Math.PI;
  add(new THREE.BoxGeometry(0.5, 0.6, 0.28), oscuro, 0, 1.1, 0.33);                        // mochila
  const piernas = [-1, 1].map(s => { const p = new THREE.Group(); p.position.set(s * 0.15, 0.6, 0); const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.4, 3, 8), traje); m.position.y = -0.3; p.add(m); g.add(p); return p; });
  const brazos = [-1, 1].map(s => { const p = new THREE.Group(); p.position.set(s * 0.42, 1.3, 0); const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 3, 8), traje); m.position.y = -0.28; p.add(m); g.add(p); return p; });
  const llama = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 8, 1, true), new THREE.MeshBasicMaterial({ color: luz, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  llama.rotation.x = Math.PI; llama.position.set(0, 0.6, 0.35); g.add(llama);
  g.userData = { piernas, brazos, llama, casco };
  return g;
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4();

export class Astronauta {
  constructor(scene, E) {
    this.E = E; this.modelo = modeloAstronauta(); this.modelo.visible = false; scene.add(this.modelo);
    this.pos = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
    this.adelante = new THREE.Vector3(0, 0, -1);     // dirección de la cámara en el plano del suelo
    this.camPitch = 0.25; this.vVert = 0; this.suelo = true; this.saltos = 0; this.fase = 0; this.velPlano = 0;
  }
  bajar(pos, up, adelante) {
    this.pos.copy(pos); this.up.copy(up); this.adelante.copy(adelante).projectOnPlane(up).normalize(); this.vVert = 0; this.modelo.visible = true;
  }
  ocultar() { this.modelo.visible = false; }

  /** m: { x, z (movimiento), girar, mirar (cámara), saltar, jetpack, correr } · pl: planeta */
  actualizar(dt, m, pl) {
    const E = this.E, c = pl.grupo.position;
    this.up.copy(this.pos).sub(c).normalize();
    // la cámara gira en el plano del suelo
    if (m.girar) this.adelante.applyAxisAngle(this.up, -m.girar);
    this.adelante.projectOnPlane(this.up).normalize();
    this.camPitch = Math.max(-0.5, Math.min(1.1, this.camPitch + (m.mirar || 0)));
    const der = _w.crossVectors(this.adelante, this.up).normalize();
    const vel = (m.correr ? 9 : 4.6) * (E.traje < 20 ? 0.6 : 1);
    const mov = _v.set(0, 0, 0).addScaledVector(this.adelante, -m.z || 0).addScaledVector(der, m.x || 0);
    const l = mov.length(); if (l > 1) mov.divideScalar(l);
    this.velPlano = Math.min(1, l) * vel;
    this.pos.addScaledVector(mov, vel * dt * (this.suelo ? 1 : 0.8));
    // gravedad, salto y jetpack
    const g = pl.p.gravedad;
    if (m.saltar) {
      if (this.suelo) { this.vVert = Math.sqrt(2 * g * 1.6); this.suelo = false; this.saltos = 1; }
      else if (E.implantes.dobleSalto && this.saltos === 1) { this.vVert = Math.sqrt(2 * g * 1.4); this.saltos = 2; }
    }
    const usaJet = m.jetpack && !this.suelo && E.jetpack > 0;
    if (usaJet) { this.vVert += g * 1.7 * dt; E.jetpack = Math.max(0, E.jetpack - dt * 28); }
    else if (this.suelo) E.jetpack = Math.min(100, E.jetpack + dt * 30);
    this.vVert -= g * dt;
    this.pos.addScaledVector(this.up, this.vVert * dt);
    const hS = pl.suelo(this.pos, _v), r = this.pos.distanceTo(c), alt = r - pl.R - hS;
    if (alt <= 0) { this.pos.addScaledVector(this.up, -alt); if (this.vVert < -16) this.golpe = (-this.vVert - 16) * 2; this.vVert = 0; this.suelo = true; this.saltos = 0; }
    else if (alt > 0.15) this.suelo = false;
    this.altitud = alt;
    // modelo: de pie sobre el suelo, mirando hacia donde camina (o a la cámara si está quieto)
    const mira = l > 0.05 ? mov : this.adelante;
    _m.lookAt(new THREE.Vector3(), mira, this.up);
    this.modelo.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(_m), Math.min(1, dt * 10));
    this.modelo.position.copy(this.pos);
    this.fase += dt * this.velPlano * 1.6;
    const a = Math.sin(this.fase) * Math.min(1, this.velPlano / 4) * 0.7, ud = this.modelo.userData;
    ud.piernas[0].rotation.x = a; ud.piernas[1].rotation.x = -a; ud.brazos[0].rotation.x = -a; ud.brazos[1].rotation.x = a;
    ud.llama.visible = usaJet; ud.llama.scale.y = 0.8 + Math.random() * 0.5;
    return usaJet;
  }

  /** Cámara en tercera persona detrás del astronauta. */
  camara(cam, dt) {
    const atras = _v.copy(this.adelante).multiplyScalar(-4.6 * Math.cos(this.camPitch));
    const obj = _w.copy(this.pos).addScaledVector(this.up, 1.8 + 4.6 * Math.sin(this.camPitch)).sub(atras.negate());
    obj.copy(this.pos).addScaledVector(this.up, 1.8 + 4.6 * Math.sin(this.camPitch)).addScaledVector(this.adelante, -4.6 * Math.cos(this.camPitch));
    cam.position.lerp(obj, Math.min(1, dt * 12));
    cam.up.copy(this.up);
    cam.lookAt(_v.copy(this.pos).addScaledVector(this.up, 1.5).addScaledVector(this.adelante, 3));
  }
  /** Punto de mira de la herramienta (desde el pecho hacia donde mira la cámara). */
  mira(cam, out) { return out.set(0, 0, -1).applyQuaternion(cam.quaternion); }
}
