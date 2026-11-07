// Combate y minería: láseres de la nave (y de la herramienta a pie), piratas del Sindicato que
// aparecen en el espacio según la facción del sistema, explosiones y botín. El mismo láser mina
// cristales, rocas y plantas (y se cobra recursos).
import * as THREE from 'three';
import { modeloNave } from './nave.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const ray = new THREE.Raycaster();

export class Combate {
  constructor(scene, part, audio) {
    this.scene = scene; this.part = part; this.audio = audio;
    this.rayos = []; this.piratas = []; this.tPiratas = 40 + Math.random() * 60;
    this.geoRayo = new THREE.BoxGeometry(0.18, 0.18, 14); this.geoRayo.translate(0, 0, -7);
    this.matJ = new THREE.MeshBasicMaterial({ color: '#00f0ff' }); this.matP = new THREE.MeshBasicMaterial({ color: '#ff3b3b' });
    this.cadencia = 0;
  }

  /** Dispara desde una posición en una dirección. dueño: 'j' (jugador) o un pirata. */
  disparar(desde, dir, dueno, velBase) {
    const m = new THREE.Mesh(this.geoRayo, dueno === 'j' ? this.matJ : this.matP);
    m.position.copy(desde); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    this.scene.add(m);
    this.rayos.push({ m, dir: dir.clone(), vel: 1100 + (velBase || 0), vida: 1.6, dueno });
  }

  /** Jugador: cañones de la nave. Además mina lo que haya delante (hasta 300 m). */
  dispararNave(nave, pl, E) {
    if (this.cadencia > 0) return null;
    this.cadencia = 0.14;
    const fw = nave.delante(new THREE.Vector3());
    const can = nave.modelo.userData.canones[this._lado = 1 - (this._lado || 0)];
    this.disparar(can.clone().applyQuaternion(nave.quat).add(nave.pos), fw, 'j', Math.max(0, nave.vf));
    this.audio.laser();
    return pl ? this.minar(nave.pos, fw, pl, 300, E, 0.35) : null;
  }
  /** A pie: la herramienta mina y aturde (alcance corto). */
  herramienta(desde, dir, pl, E) {
    if (this.cadencia > 0) return null;
    this.cadencia = 0.09;
    this.part.emitir(desde.clone().addScaledVector(dir, 1.2), dir.clone().multiplyScalar(30), new THREE.Color('#00f0ff'), 0.3, 0.25, 3);
    this.audio.minar();
    return this.minar(desde, dir, pl, 45, E, 0.2);
  }
  minar(desde, dir, pl, alcance, E, dano) {
    ray.set(desde, dir); ray.far = alcance;
    const lista = [...pl.minables].filter(m => m.visible);
    const hit = ray.intersectObjects(lista, false)[0];
    if (!hit) return null;
    const im = hit.object, i = hit.instanceId, ud = im.userData;
    ud.vida[i] -= dano;
    const c = new THREE.Color(ud.tipo === 0 ? '#00f0ff' : ud.tipo === 1 ? '#ffb347' : '#7dff6b');
    for (let k = 0; k < 4; k++) this.part.emitir(hit.point, _v.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5).multiplyScalar(8), c, 0.5, 0.5, 2);
    if (ud.vida[i] > 0) return { minando: true };
    im.getMatrixAt(i, _m); _m.scale(_w.set(0, 0, 0)); im.setMatrixAt(i, _m); im.instanceMatrix.needsUpdate = true;
    const n = 1 + Math.floor(Math.random() * 3);
    this.part.explosion(hit.point, c, 18, 10, 1.2);
    this.audio.recoger();
    return { recurso: ud.recurso, n };
  }

  /** Piratas: aparecen en el espacio según la facción; persiguen, rodean y disparan. */
  actualizar(dt, nave, enEspacio, faccion, E, alMorir, alDano) {
    this.cadencia = Math.max(0, this.cadencia - dt);
    // rayos
    for (let k = this.rayos.length - 1; k >= 0; k--) {
      const r = this.rayos[k];
      r.vida -= dt; const paso = r.vel * dt;
      if (r.dueno === 'j') {
        for (const p of this.piratas) {
          if (p.vida <= 0) continue;
          _v.copy(p.obj.position).sub(r.m.position);
          const a = _v.dot(r.dir);
          if (a > -2 && a < paso + 4 && _v.addScaledVector(r.dir, -a).length() < 4.5) { p.vida -= 14; r.vida = 0; this.part.explosion(r.m.position, '#ffb347', 8, 12, 1); this.audio.golpe(0.4); }
        }
      } else if (!nave.oculta) {
        _v.copy(nave.pos).sub(r.m.position);
        const a = _v.dot(r.dir);
        if (a > -2 && a < paso + 4 && _v.addScaledVector(r.dir, -a).length() < 4) { r.vida = 0; alDano(9, r.m.position); }
      }
      r.m.position.addScaledVector(r.dir, paso);
      if (r.vida <= 0) { this.scene.remove(r.m); this.rayos.splice(k, 1); }
    }
    // aparición
    if (enEspacio && !nave.pulso) {
      this.tPiratas -= dt * (0.4 + faccion.piratas * 1.6);
      if (this.tPiratas <= 0 && this.piratas.length === 0) {
        this.tPiratas = 70 + Math.random() * 90;
        const n = 1 + Math.floor(Math.random() * (faccion.id === 'sind' ? 3 : 2));
        for (let i = 0; i < n; i++) {
          const obj = modeloNave('caza', { casco: '#2b0d14', acento: '#ff3b3b', luz: '#ff3b3b' }); obj.scale.setScalar(0.9);
          obj.position.copy(nave.pos).add(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1400));
          this.scene.add(obj);
          this.piratas.push({ obj, vida: 40, vel: new THREE.Vector3(), tDisparo: 2 + Math.random() * 2, lado: Math.random() < 0.5 ? -1 : 1 });
        }
        this.alAviso?.('¡PIRATAS!', `${n} cazas del Sindicato de Datos se acercan`);
      }
    }
    for (let k = this.piratas.length - 1; k >= 0; k--) {
      const p = this.piratas[k], o = p.obj;
      if (p.vida <= 0) {
        this.part.explosion(o.position, '#ff5a36', 90, 45, 4); this.audio.explosion(0.8);
        this.scene.remove(o); this.piratas.splice(k, 1); alMorir(o.position); continue;
      }
      // perseguir: apunta por delante del jugador y lo rodea a 250-600 m
      const objetivo = _v.copy(nave.pos).addScaledVector(nave.vel, 0.8);
      const d = o.position.distanceTo(nave.pos);
      const lateral = _w.set(0, 1, 0).applyQuaternion(nave.quat).multiplyScalar(p.lado * 220);
      if (d < 350) objetivo.add(lateral);
      const dir = objetivo.sub(o.position).normalize();
      const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(o.quaternion);
      fw.lerp(dir, Math.min(1, dt * 1.6)).normalize();
      _m.lookAt(new THREE.Vector3(), fw, new THREE.Vector3(0, 1, 0)); o.quaternion.setFromRotationMatrix(_m);
      const vObj = d > 600 ? 420 : d < 200 ? 160 : 300;
      p.vel.lerp(fw.multiplyScalar(vObj), Math.min(1, dt * 1.5));
      o.position.addScaledVector(p.vel, dt);
      p.tDisparo -= dt;
      const alineado = new THREE.Vector3(0, 0, -1).applyQuaternion(o.quaternion).dot(_v.copy(nave.pos).sub(o.position).normalize());
      if (p.tDisparo <= 0 && d < 1000 && alineado > 0.985 && !nave.oculta) { p.tDisparo = 0.55 + Math.random() * 0.5; this.disparar(o.position.clone(), _v.copy(nave.pos).sub(o.position).normalize().clone(), p, p.vel.length()); this.audio.laserEnemigo(); }
      if (d > 6000) { this.scene.remove(o); this.piratas.splice(k, 1); }
    }
  }
  limpiar() { for (const p of this.piratas) this.scene.remove(p.obj); for (const r of this.rayos) this.scene.remove(r.m); this.piratas = []; this.rayos = []; }
}
