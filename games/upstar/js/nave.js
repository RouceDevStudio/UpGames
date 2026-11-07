// Nave: tres modelos de dibujo (caza, carguero, explorador) y un vuelo pensado para que se
// entienda siempre qué hace la nave:
// - El ACELERADOR es una palanca que se queda donde la dejas (de −30 % reversa a 100 % avance);
//   la velocidad hacia delante tiende a la que marca, con aceleración y frenada limitadas.
// - El morro manda: la nave va hacia donde apunta (con algo de deriva en el espacio y casi nada en
//   el aire), así que girar es intuitivo.
// - En la atmósfera: gravedad, sustentación según la velocidad y el alabeo, rozamiento ∝ v²,
//   alabeo automático al girar (como un avión) y propulsores de vuelo estacionario a baja
//   velocidad para bajar despacio y aterrizar.
// - Golpes contra el suelo: rebote y daño según la velocidad; aterrizaje si se llega despacio.

import * as THREE from 'three';
import { materialToon } from './planeta.js';

export const MODELOS = {
  caza:       { nombre: 'Caza Vex', vmax: 1, giro: 1.15, casco: 1, combustible: 1, precio: 0, desc: 'Rápido y ágil. Dos cañones.' },
  explorador: { nombre: 'Explorador Lyra', vmax: 0.95, giro: 1, casco: 1, combustible: 1.6, precio: 2500, desc: 'Más alcance de pulso y escáner.' },
  carguero:   { nombre: 'Carguero Ox', vmax: 0.78, giro: 0.75, casco: 1.7, combustible: 1.2, precio: 4000, desc: 'Lento pero blindado. Doble bodega.' },
};

export function modeloNave(tipo = 'caza', colores = { casco: '#2a2f45', acento: '#ff2e88', luz: '#00f0ff' }) {
  const g = new THREE.Group();
  const casco = materialToon({ color: colores.casco });
  const acento = materialToon({ color: colores.acento });
  const cristal = materialToon({ color: '#0b1020', emissive: new THREE.Color(colores.luz), emissiveIntensity: 0.3 }, 0.3);
  const luz = new THREE.MeshBasicMaterial({ color: colores.luz });
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
  const largo = tipo === 'explorador' ? 8 : tipo === 'carguero' ? 6 : 6.5;
  const ancho = tipo === 'carguero' ? 1.9 : 1.25;
  // fuselaje (la nave mira a −z)
  const f = new THREE.CylinderGeometry(0.55, 1.15, largo, 6, 1); f.rotateX(-Math.PI / 2); f.scale(ancho, tipo === 'carguero' ? 0.9 : 0.55, 1);
  add(f, casco);
  add(new THREE.ConeGeometry(0.55 * ancho, tipo === 'explorador' ? 2.6 : 1.6, 6).rotateX(-Math.PI / 2).scale(1, 0.55, 1), casco, 0, 0, -largo / 2 - (tipo === 'explorador' ? 1.3 : 0.8));
  const cab = new THREE.SphereGeometry(0.75, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2); cab.scale(0.9, 0.7, 1.9);
  add(cab, cristal, 0, tipo === 'carguero' ? 0.6 : 0.3, -largo * 0.22);
  if (tipo === 'carguero') { add(new THREE.BoxGeometry(2.6, 1.2, 2.6), casco, 0, 0.2, 1.4); add(new THREE.BoxGeometry(2.7, 0.12, 2.7), acento, 0, 0.85, 1.4); }
  const envergadura = tipo === 'carguero' ? 2.6 : tipo === 'explorador' ? 4.2 : 3.6;
  for (const s of [-1, 1]) {
    const ala = new THREE.BoxGeometry(envergadura, 0.14, 2.2); ala.translate(s * envergadura / 2, 0, 0);
    const pos = ala.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, pos.getZ(i) + Math.abs(x) * 0.55); }
    ala.computeVertexNormals();
    add(ala, casco, s * 0.6, -0.1, 0.9);
    add(new THREE.BoxGeometry(0.1, 1.1, 1.3), acento, s * (envergadura + 0.3), 0.35, 0.9 + envergadura * 0.45, 0.25, 0, 0);
    add(new THREE.BoxGeometry(envergadura * 0.85, 0.05, 0.18), acento, s * (0.6 + envergadura * 0.45), 0.0, 0.2);
    add(new THREE.CylinderGeometry(0.42, 0.5, 2.2, 10).rotateX(Math.PI / 2), casco, s * 1.35, -0.05, 2.3);
    add(new THREE.CircleGeometry(0.36, 14), luz, s * 1.35, -0.05, 3.42);
    // cañones en la punta de las alas
    add(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 6).rotateX(Math.PI / 2), acento, s * (envergadura * 0.75), -0.05, -0.2);
  }
  if (tipo === 'explorador') { add(new THREE.CylinderGeometry(0.42, 0.5, 2.2, 10).rotateX(Math.PI / 2), casco, 0, 0.55, 2.6); add(new THREE.CircleGeometry(0.36, 14), luz, 0, 0.55, 3.72); }
  const llamas = [];
  const motores = tipo === 'explorador' ? [[-1.35, -0.05], [1.35, -0.05], [0, 0.55]] : [[-1.35, -0.05], [1.35, -0.05]];
  for (const [x, y] of motores) {
    const geo = new THREE.ConeGeometry(0.34, 2.4, 10, 1, true); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, 1.2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colores.luz, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(x, y, tipo === 'explorador' && x === 0 ? 3.75 : 3.45); g.add(m); llamas.push(m);
  }
  g.userData = { llamas, canones: [new THREE.Vector3(-envergadura * 0.75, -0.05, -1.1), new THREE.Vector3(envergadura * 0.75, -0.05, -1.1)], escape: new THREE.Vector3(0, 0, 3.6) };
  return g;
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4();
const EJE_X = new THREE.Vector3(1, 0, 0), EJE_Y = new THREE.Vector3(0, 1, 0), EJE_Z = new THREE.Vector3(0, 0, 1);

export class Nave {
  constructor(scene, E) {
    this.scene = scene; this.E = E;
    this.raiz = new THREE.Group(); scene.add(this.raiz);
    this.pos = this.raiz.position; this.quat = this.raiz.quaternion;
    this.cambiarModelo();
    this.vel = new THREE.Vector3(); this.rot = new THREE.Vector3();    // velocidad angular (cabeceo, guiñada, alabeo)
    this.acelerador = 0; this.vf = 0;
    this.estado = 'espacio';     // espacio | atmosfera | aterrizada
    this.altitud = Infinity; this.velocidad = 0; this.pulso = false; this.turbo = false;
    this.autoAterrizar = false; this.vVert = 0;
  }
  cambiarModelo() {
    if (this.modelo) this.raiz.remove(this.modelo);
    this.tipo = this.E.nave.modelo; this.stats = MODELOS[this.tipo] || MODELOS.caza;
    this.modelo = modeloNave(this.tipo, this.E.nave.colores); this.raiz.add(this.modelo);
  }
  delante(out = _v) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  arriba(out = _w) { return out.set(0, 1, 0).applyQuaternion(this.quat); }

  /**
   * m: { acelerador (−0.3..1), cabeceo, guinada, alabeo (−1..1), turbo, pulso }
   * amb: { pl, up (vector arriba del planeta), g, atm (0..1 densidad), hSuelo }
   */
  actualizar(dt, m, amb) {
    const st = this.stats, E = this.E;
    const enAtm = amb.atm > 0.02, up = amb.up;
    if (!enAtm) this.autoAterrizar = false;
    if (this.estado === 'aterrizada') {
      this.vel.set(0, 0, 0); this.rot.set(0, 0, 0); this.vf = 0; this.velocidad = 0;
      if (m.acelerador > 0.15 || m.despegar) { this.estado = 'atmosfera'; this.vel.copy(up).multiplyScalar(14); this.pos.addScaledVector(up, 2); this.acelerador = 0.25; this.autoAterrizar = false; }
      this._llamas(0.05); return;
    }
    this.acelerador = m.acelerador;
    // ── giro ──
    const dano = E.casco < 30 ? 0.7 : 1;
    const giro = st.giro * dano * (this.pulso ? 0.25 : 1);
    const obj = _v.set(m.cabeceo * 1.5 * giro, -m.guinada * 1.05 * giro, -m.alabeo * 2.4 * giro);
    if (enAtm && up) {
      // alabeo automático: se inclina hacia el giro y se endereza al soltar. El ángulo de alabeo se
      // mide con atan2 (también sirve boca abajo) y se corrige girando en sentido contrario.
      const der = _w.set(1, 0, 0).applyQuaternion(this.quat);
      const arribaNave = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
      const alabeo = Math.atan2(der.dot(up), arribaNave.dot(up));     // >0: ala derecha arriba
      const deseado = -m.guinada * 0.55;
      if (Math.abs(m.alabeo) < 0.1) obj.z += -(alabeo - deseado) * 2.6;
    }
    if (this.autoAterrizar && up) {
      // piloto automático de aterrizaje: nivela la nave
      const fw = this.delante(), der = _w.set(1, 0, 0).applyQuaternion(this.quat);
      const arribaNave = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
      obj.x = -fw.dot(up) * 3; obj.z = -Math.atan2(der.dot(up), arribaNave.dot(up)) * 3; obj.y = 0;
    }
    this.rot.lerp(obj, Math.min(1, dt * 6));
    _q.setFromAxisAngle(EJE_X, this.rot.x * dt); this.quat.multiply(_q);
    _q.setFromAxisAngle(EJE_Y, this.rot.y * dt); this.quat.multiply(_q);
    _q.setFromAxisAngle(EJE_Z, this.rot.z * dt); this.quat.multiply(_q);
    this.quat.normalize();

    // ── velocidad hacia delante: tiende a la que marca el acelerador ──
    const fw = this.delante(new THREE.Vector3());
    this.turbo = !!m.turbo && E.casco > 15;
    const lejos = !amb.pl || amb.alt > amb.pl.R * 0.9;
    this.pulso = !!m.pulso && !enAtm && lejos && E.combustible > 0;
    let vmax = (enAtm ? (amb.alt < 250 ? 170 : 280) : 480) * st.vmax * (E.casco < 30 ? 0.7 : 1);
    if (this.turbo) vmax *= enAtm ? 1.55 : 2.6;
    let objetivo = Math.max(-0.3, this.autoAterrizar ? 0 : this.acelerador) * vmax, acel = this.turbo ? 160 : 60, freno = 110;
    if (this.pulso) { objetivo = 14000 * st.vmax; acel = 4500; E.combustible = Math.max(0, E.combustible - dt * 1.2 / st.combustible); }
    else if (this.vf > vmax * 1.05) freno = this.vf > 2000 ? 6000 : 400;     // salir del pulso: frena rápido
    this.vf = fw.dot(this.vel);
    const dv = objetivo - this.vf;
    this.vf += Math.max(-freno * dt, Math.min(acel * dt, dv));
    // deriva lateral: casi nada en el aire, algo en el espacio
    const lat = _v.copy(this.vel).addScaledVector(fw, -fw.dot(this.vel));
    lat.multiplyScalar(Math.exp(-dt * (enAtm ? 3 : 0.8)));
    this.vel.copy(fw).multiplyScalar(this.vf).add(lat);

    // ── atmósfera: gravedad, sustentación y vuelo estacionario ──
    if (enAtm && up) {
      const der = _w.set(1, 0, 0).applyQuaternion(this.quat);
      const nivel = Math.max(0, 1 - Math.abs(der.dot(up)) * 1.2);
      const sust = Math.min(1, Math.max(0, this.vf) / 60) * nivel;
      const estac = Math.abs(this.vf) < 45 && amb.alt < 900;          // propulsores de vuelo estacionario
      let soporte = Math.max(sust, estac ? 1 : 0);
      if (estac && (this.acelerador < -0.05 || this.autoAterrizar)) soporte = 0.55;   // bajar despacio
      const vRad = this.vel.dot(up);
      this.vel.addScaledVector(up, -amb.g * (1 - soporte) * dt);
      // aterrizaje automático: baja a ~25 m/s y frena a 5 m/s en los últimos 40 m
      if (this.autoAterrizar) { const obj = -(amb.alt > 40 ? 25 : 5); this.vel.addScaledVector(up, (obj - vRad) * Math.min(1, dt * 2.5) + amb.g * (1 - soporte) * dt); }
      else if (estac) this.vel.addScaledVector(up, -vRad * Math.min(1, dt * 1.5));
      // rozamiento ∝ v² (más denso cuanto más abajo)
      const sp = this.vel.length();
      this.vel.multiplyScalar(1 / (1 + 0.0004 * amb.atm * sp * dt));
    } else if (amb.pl && up && !this.pulso) this.vel.addScaledVector(up, -amb.g * 0.25 * dt);

    this.pos.addScaledVector(this.vel, dt);
    this.velocidad = this.vel.length();
    this.vVert = up ? this.vel.dot(up) : 0;
    this._llamas(this.pulso ? 2.6 : 0.2 + Math.max(0, this.acelerador) * (this.turbo ? 1.8 : 1));
    this.estado = enAtm ? 'atmosfera' : 'espacio';
  }

  /** Choque con el suelo: alt (m sobre el terreno, ya con la nave movida). Devuelve el daño. */
  suelo(alt, up) {
    if (this.estado === 'aterrizada' || alt >= 0) return 0;
    const vRad = this.vel.dot(up);
    this.pos.addScaledVector(up, -alt);
    const fw = this.delante(), nivel = Math.abs(fw.dot(up)) < 0.35;
    if ((this.velocidad < 32 && vRad > -14 && nivel) || (this.autoAterrizar && this.velocidad < 45)) {
      this.estado = 'aterrizada'; this.autoAterrizar = false;
      const fwp = fw.clone().projectOnPlane(up).normalize();
      _m4.lookAt(new THREE.Vector3(), fwp, up);
      this.quat.setFromRotationMatrix(_m4);
      this.vel.set(0, 0, 0);
      return -1;     // aterrizaje
    }
    const imp = this.velocidad;
    this.vel.addScaledVector(up, -vRad * 1.5).multiplyScalar(0.45);
    this.rot.multiplyScalar(-0.5);
    return Math.max(4, (imp - 12) * 0.55);
  }

  _llamas(f) {
    for (const l of this.modelo.userData.llamas) { l.scale.set(1, 1, Math.max(0.05, f * (0.9 + Math.random() * 0.2))); l.material.opacity = Math.min(0.9, 0.25 + f * 0.35); }
  }
}
