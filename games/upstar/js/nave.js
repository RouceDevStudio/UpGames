// Nave: modelo de dibujo (cel shading) con motores de neón y un vuelo arcade con física:
// empuje, inercia, rozamiento del aire dentro de la atmósfera, gravedad del planeta cercano,
// asistente que nivela la nave sobre el suelo, aterrizaje suave y despegue.

import * as THREE from 'three';
import { materialToon } from './planeta.js';

export function modeloNave(colores = { casco: '#2a2f45', acento: '#ff2e88', luz: '#00f0ff' }) {
  const g = new THREE.Group();
  const casco = materialToon({ color: colores.casco });
  const acento = materialToon({ color: colores.acento });
  const cristal = materialToon({ color: '#0b1020', emissive: new THREE.Color(colores.luz), emissiveIntensity: 0.25 }, 0.3);
  const luz = new THREE.MeshBasicMaterial({ color: colores.luz });
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
  // fuselaje en cuña (la nave mira a −z)
  const f = new THREE.CylinderGeometry(0.55, 1.15, 6.5, 6, 1); f.rotateX(-Math.PI / 2); f.scale(1.25, 0.55, 1);
  add(f, casco, 0, 0, 0);
  add(new THREE.ConeGeometry(0.55 * 1.25, 1.6, 6).rotateX(-Math.PI / 2).scale(1, 0.55, 1), casco, 0, 0, -4.05);
  // cabina
  const cab = new THREE.SphereGeometry(0.75, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2); cab.scale(0.9, 0.7, 1.9);
  add(cab, cristal, 0, 0.3, -1.4);
  // alas en flecha y derivas
  for (const s of [-1, 1]) {
    const ala = new THREE.BoxGeometry(3.6, 0.14, 2.2); ala.translate(s * 1.8, 0, 0);
    const pos = ala.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, pos.getZ(i) + Math.abs(x) * 0.55); if (Math.abs(x) > 3) pos.setZ(i, pos.getZ(i) * 0.5 + 0.6); }
    ala.computeVertexNormals();
    add(ala, casco, s * 0.6, -0.1, 0.9);
    add(new THREE.BoxGeometry(0.1, 1.1, 1.3), acento, s * 3.9, 0.35, 2.4, 0.25, 0, 0);
    add(new THREE.BoxGeometry(3.2, 0.05, 0.18), acento, s * 2.2, 0.0, 0.2);           // franja de neón
    // motor
    add(new THREE.CylinderGeometry(0.42, 0.5, 2.2, 10).rotateX(Math.PI / 2), casco, s * 1.35, -0.05, 2.3);
    const tobera = add(new THREE.CircleGeometry(0.36, 14), luz, s * 1.35, -0.05, 3.42);
    tobera.userData.tobera = true;
  }
  // llamas de los motores (crecen con el empuje)
  const llamas = [];
  for (const s of [-1, 1]) {
    const geo = new THREE.ConeGeometry(0.34, 2.4, 10, 1, true); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, 1.2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colores.luz, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(s * 1.35, -0.05, 3.45); g.add(m); llamas.push(m);
  }
  g.userData.llamas = llamas;
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return g;
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _arriba = new THREE.Vector3(), _ad = new THREE.Vector3();
const EJE_X = new THREE.Vector3(1, 0, 0), EJE_Y = new THREE.Vector3(0, 1, 0), EJE_Z = new THREE.Vector3(0, 0, 1);

export class Nave {
  constructor(scene) {
    this.modelo = modeloNave();
    scene.add(this.modelo);
    this.pos = this.modelo.position; this.quat = this.modelo.quaternion;
    this.vel = new THREE.Vector3();
    this.empuje = 0;            // 0..1 (acelerador)
    this.estado = 'espacio';    // espacio | atmosfera | aterrizada
    this.altitud = Infinity; this.velocidad = 0; this.pulso = false;
  }

  delante(out = _v) { return out.set(0, 0, -1).applyQuaternion(this.quat); }

  /**
   * m: mandos { acel (−1..1), cabeceo, guinada, alabeo (−1..1), turbo, pulso, frenar }
   * pl: planeta más cercano (o null)
   */
  actualizar(dt, m, pl) {
    // ── planeta cercano: gravedad, atmósfera y suelo ──
    let gravedad = 0, enAtm = false, hSuelo = 0;
    if (pl) {
      _arriba.copy(this.pos).sub(pl.grupo.position);
      const r = _arriba.length(); _arriba.divideScalar(r);
      hSuelo = pl.suelo(this.pos, _ad);
      this.altitud = r - pl.R - hSuelo;
      const atm = pl.R * 0.35;
      enAtm = this.altitud < atm;
      gravedad = pl.p.gravedad * Math.min(1, (pl.R / r) ** 2);
    } else this.altitud = Infinity;

    // ── aterrizada: quieta sobre el suelo hasta que se acelera ──
    if (this.estado === 'aterrizada') {
      this.vel.set(0, 0, 0); this.empuje = 0;
      if (m.acel > 0.3 || m.turbo) { this.estado = 'atmosfera'; this.vel.copy(_arriba).multiplyScalar(12); this.pos.addScaledVector(_arriba, 1.5); }
      this._llamas(0.1);
      this.velocidad = 0;
      return;
    }

    // ── giro: cabeceo, guiñada y alabeo en los ejes de la nave ──
    const giro = 1.5 * dt, lento = enAtm && this.altitud < 300 ? 0.75 : 1;
    _q.setFromAxisAngle(EJE_X, m.cabeceo * giro * lento); this.quat.multiply(_q);
    _q.setFromAxisAngle(EJE_Y, -m.guinada * giro * 0.8 * lento); this.quat.multiply(_q);
    _q.setFromAxisAngle(EJE_Z, -m.alabeo * giro * 1.3); this.quat.multiply(_q);
    // en la atmósfera, el asistente endereza las alas respecto al suelo (sin quitar el control)
    if (enAtm && Math.abs(m.alabeo) < 0.1) {
      const der = _v.set(1, 0, 0).applyQuaternion(this.quat);
      const inclin = der.dot(_arriba);
      _q.setFromAxisAngle(EJE_Z, inclin * dt * 1.6); this.quat.multiply(_q);
    }
    this.quat.normalize();

    // ── empuje ──
    this.empuje += (Math.max(0, m.acel) - this.empuje) * Math.min(1, dt * 3);
    this.pulso = !!m.pulso && !enAtm && (!pl || this.altitud > pl.R * 0.8);
    const maxV = this.pulso ? 9000 : enAtm ? (m.turbo ? 420 : 220) : (m.turbo ? 1400 : 500);
    const acel = this.pulso ? 2600 : (m.turbo ? 220 : 70) * this.empuje;
    const fw = this.delante();
    this.vel.addScaledVector(fw, acel * dt);
    if (m.acel < -0.1 || m.frenar) this.vel.multiplyScalar(Math.max(0, 1 - dt * 1.8));
    // el morro manda: la velocidad gira hacia donde apunta la nave (más en el aire)
    const sp = this.vel.length();
    if (sp > 1) {
      const alinear = enAtm ? 2.6 : 1.1;
      _v.copy(fw).multiplyScalar(sp * Math.sign(this.vel.dot(fw) || 1));
      this.vel.lerp(_v, Math.min(1, dt * alinear * (this.vel.dot(fw) > 0 ? 1 : 0.2)));
    }
    // aire: rozamiento ∝ v² en la atmósfera (más espeso cuanto más abajo)
    if (enAtm) {
      const dens = Math.exp(-this.altitud / (pl.R * 0.08));
      this.vel.multiplyScalar(1 / (1 + 0.00035 * dens * sp * dt));
      // gravedad (sustentación: cuanto más rápido y nivelado, menos cae)
      const sustent = Math.min(1, sp / 60) * Math.max(0, 1 - Math.abs(fw.dot(_arriba)));
      this.vel.addScaledVector(_arriba, -gravedad * (1 - 0.92 * sustent) * dt);
    } else if (pl) this.vel.addScaledVector(_arriba, -gravedad * 0.35 * dt);
    if (this.vel.length() > maxV) this.vel.setLength(maxV + (this.vel.length() - maxV) * Math.exp(-dt * 2));
    this.pos.addScaledVector(this.vel, dt);
    this.velocidad = this.vel.length();

    // ── suelo: aterrizar o rebotar ──
    if (pl) {
      _arriba.copy(this.pos).sub(pl.grupo.position);
      const r = _arriba.length(); _arriba.divideScalar(r);
      const alt = r - pl.R - hSuelo - 1.2;
      this.altitud = alt;
      if (alt < 0) {
        const vRad = this.vel.dot(_arriba);
        this.pos.addScaledVector(_arriba, -alt);
        if (this.velocidad < 45 && vRad > -18) {
          this.estado = 'aterrizada';
          // posa la nave alineada con el suelo, mirando hacia donde iba
          const fwPlano = this.delante(_ad).projectOnPlane(_arriba).normalize();
          const m4 = new THREE.Matrix4().lookAt(new THREE.Vector3(), fwPlano, _arriba);
          this.quat.setFromRotationMatrix(m4);
          this.vel.set(0, 0, 0);
          this.alAterrizar?.();
        } else {
          this.vel.addScaledVector(_arriba, -vRad * 1.4).multiplyScalar(0.5);   // rebote
          this.alGolpe?.(Math.min(1, this.velocidad / 200));
        }
      }
    }
    this.estado = this.estado === 'aterrizada' ? 'aterrizada' : enAtm ? 'atmosfera' : 'espacio';
    this._llamas(this.pulso ? 2.4 : 0.25 + this.empuje * (m.turbo ? 1.6 : 1));
  }

  _llamas(f) {
    for (const l of this.modelo.userData.llamas) { l.scale.set(1, 1, Math.max(0.05, f * (0.9 + Math.random() * 0.2))); l.material.opacity = Math.min(0.9, 0.25 + f * 0.35); }
  }
}
