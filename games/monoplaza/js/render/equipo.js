// Mecánicos de boxes animados y escombros (ruedas y alerones que salen volando).

import * as THREE from 'three';
import { COCHE } from '../config.js';

// ─── Mecánico: una sola malla (traje del color del equipo) más casco ─────────
let geoCuerpo = null, geoCasco = null, geoPistola = null;
function geometrias() {
  if (geoCuerpo) return;
  const partes = [];
  const add = (g, x, y, z) => { g.translate(x, y, z); partes.push(g.toNonIndexed()); };
  add(new THREE.CylinderGeometry(0.09, 0.08, 0.85, 8), -0.0, 0.43, -0.11);     // piernas
  add(new THREE.CylinderGeometry(0.09, 0.08, 0.85, 8), 0.0, 0.43, 0.11);
  add(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 10), 0, 1.15, 0);           // torso
  add(new THREE.CylinderGeometry(0.055, 0.05, 0.62, 8).rotateZ(1.1), 0.22, 1.12, -0.24);  // brazos hacia delante
  add(new THREE.CylinderGeometry(0.055, 0.05, 0.62, 8).rotateZ(1.1), 0.22, 1.12, 0.24);
  for (const g of partes) for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  geoCuerpo = mergeSimple(partes); geoCuerpo.computeVertexNormals();
  geoCasco = new THREE.SphereGeometry(0.15, 12, 10); geoCasco.translate(0, 1.6, 0);
  geoPistola = new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8); geoPistola.rotateZ(Math.PI / 2); geoPistola.translate(0.45, 1.0, 0);
}
function mergeSimple(lista) {
  const n = lista.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3); let o = 0;
  for (const g of lista) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

function mecanico(matTraje, matCasco, conPistola) {
  geometrias();
  const g = new THREE.Group();
  const cuerpo = new THREE.Mesh(geoCuerpo, matTraje); cuerpo.castShadow = true; g.add(cuerpo);
  const casco = new THREE.Mesh(geoCasco, matCasco); casco.castShadow = true; g.add(casco);
  if (conPistola) { const p = new THREE.Mesh(geoPistola, new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6, roughness: 0.4 })); g.add(p); }
  return g;
}

// Una parada en boxes: 15 mecánicos alrededor del coche, gatos, cambio de las cuatro ruedas
class Parada {
  constructor(scene, car, modelo, color, duracion, morro) {
    this.scene = scene; this.car = car; this.modelo = modelo; this.duracion = duracion; this.morro = morro;
    this.t = 0; this.fin = false; this.tFin = 0;
    this.grupo = new THREE.Group();
    const matTraje = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
    const matCasco = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.3 });
    const A = COCHE.wheelbase * (1 - COCHE.repartoDel), B = COCHE.wheelbase * COCHE.repartoDel;
    this.puestos = [];
    // por rueda: pistola, quita y pone
    const ruedas = [[A, -1], [A, 1], [-B, -1], [-B, 1]];
    ruedas.forEach(([x, lado], k) => {
      const via = (k < 2 ? COCHE.viaDel : COCHE.viaTras) / 2;
      for (const [dx, dz, pistola, rol] of [[0, 0.75, true, 'pistola'], [-0.55, 1.05, false, 'quita'], [0.55, 1.05, false, 'pone']]) {
        const m = mecanico(matTraje, matCasco, pistola);
        const pos = new THREE.Vector3(x + dx, 0, lado * (via + dz));
        m.position.copy(pos); m.rotation.y = lado > 0 ? Math.PI / 2 : -Math.PI / 2;
        this.grupo.add(m);
        this.puestos.push({ m, rol, k, pos, lado });
      }
    });
    // gatos delantero y trasero, y el del semáforo/piruleta
    const gD = mecanico(matTraje, matCasco, false); gD.position.set(3.6, 0, 0); gD.rotation.y = Math.PI; this.grupo.add(gD);
    const gT = mecanico(matTraje, matCasco, false); gT.position.set(-3.1, 0, 0); this.grupo.add(gT);
    this.gatoD = gD; this.gatoT = gT;
    const jefe = mecanico(matTraje, matCasco, false); jefe.position.set(4.6, 0, 1.4); jefe.rotation.y = Math.PI; this.grupo.add(jefe);
    this.semaforo = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 3, side: THREE.DoubleSide }));
    this.semaforo.position.set(4.3, 1.9, 1.4); this.semaforo.rotation.y = Math.PI / 2; this.grupo.add(this.semaforo);
    // neumáticos sueltos que se llevan / traen
    const geoN = new THREE.CylinderGeometry(0.36, 0.36, 0.34, 18); geoN.rotateX(Math.PI / 2);
    const matN = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    this.viejos = []; this.nuevos = [];
    for (let k = 0; k < 4; k++) {
      const v = new THREE.Mesh(geoN, matN), n = new THREE.Mesh(geoN, matN);
      v.visible = false; n.visible = false; v.castShadow = n.castShadow = true;
      this.grupo.add(v); this.grupo.add(n); this.viejos.push(v); this.nuevos.push(n);
    }
    this.grupo.position.set(car.x, car.y, car.z);
    this.grupo.rotation.y = -car.psi;
    scene.add(this.grupo);
  }

  actualizar(dt) {
    this.t += dt;
    const D = this.duracion, t = this.t, u = Math.min(1, t / D);
    const md = this.modelo;
    const A = COCHE.wheelbase * (1 - COCHE.repartoDel), B = COCHE.wheelbase * COCHE.repartoDel;
    if (!this.fin) {
      // gatos: suben el coche al principio y lo bajan al final
      const sube = Math.min(1, u / 0.1), baja = u > 0.88 ? Math.max(0, 1 - (u - 0.88) / 0.08) : 1;
      md.elevar = 0.07 * sube * baja;
      this.gatoD.position.x = 3.6 - 0.6 * sube * baja; this.gatoT.position.x = -3.1 + 0.5 * sube * baja;
      const fuera = u > 0.14 && u < 0.5;
      for (let k = 0; k < 4; k++) {
        md.ruedaOculta[k] = fuera;
        const lado = k % 2 ? 1 : -1, x = k < 2 ? A : -B, via = (k < 2 ? COCHE.viaDel : COCHE.viaTras) / 2;
        // el viejo sale hacia fuera y el nuevo entra
        const v = this.viejos[k], n = this.nuevos[k];
        v.visible = u > 0.14 && u < 0.75;
        const pv = Math.min(1, (u - 0.14) / 0.2);
        v.position.set(x - 0.55 * pv, 0.36 + 0.4 * pv, lado * (via + 0.2 + 0.9 * pv));
        n.visible = u > 0.2 && u <= 0.5;
        const pn = Math.min(1, Math.max(0, (u - 0.25) / 0.22));
        n.position.set(x + 0.55 * (1 - pn), 0.36 + 0.35 * (1 - pn) + md.elevar, lado * (via + 0.2 + 0.9 * (1 - pn)));
      }
      // los de la pistola se agachan durante el cambio
      for (const p of this.puestos) {
        const agachado = p.rol === 'pistola' && u > 0.08 && u < 0.6;
        p.m.scale.y = agachado ? 0.72 : 1;
      }
      this.semaforo.material.emissive.setHex(u > 0.92 ? 0x20ff40 : 0xff2020);
      if (t >= D) { this.fin = true; md.elevar = 0; md.ruedaOculta = [false, false, false, false]; }
    } else {
      this.tFin += dt;
      // el equipo vuelve al garaje
      this.grupo.children.forEach(o => { if (o !== this.semaforo) o.position.z += Math.sign(o.position.z || 1) * dt * 2.2; });
      for (const v of this.viejos) v.visible = false;
      if (this.tFin > 3) { this.scene.remove(this.grupo); return false; }
    }
    return true;
  }
}

export class GestorBoxes {
  constructor(scene) { this.scene = scene; this.paradas = []; }
  empezar(car, modelo, color, duracion, morro) { this.paradas.push(new Parada(this.scene, car, modelo, color, duracion, morro)); }
  actualizar(dt) { this.paradas = this.paradas.filter(p => p.actualizar(dt)); }
  limpiar() { for (const p of this.paradas) this.scene.remove(p.grupo); this.paradas = []; }
}

// ─── Escombros con física simple: rebotan en el suelo y ruedan ───────────────
export class Escombros {
  constructor(scene, sueloY) { this.scene = scene; this.sueloY = sueloY; this.lista = []; }

  // `origen` es un Object3D del coche: se clona con su transformación en el mundo
  lanzar(origen, vel, extra = {}) {
    origen.updateMatrixWorld(true);
    const obj = origen.clone(true);
    obj.visible = true;
    origen.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
    this.scene.add(obj);
    const r = Math.random;
    this.lista.push({
      obj, v: new THREE.Vector3(vel.x + (r() - 0.5) * 6, 3 + r() * 6 + (extra.alto || 0), vel.z + (r() - 0.5) * 6),
      w: new THREE.Vector3((r() - 0.5) * 18, (r() - 0.5) * 10, (r() - 0.5) * 18), radio: extra.radio || 0.2, vida: 40,
    });
    if (this.lista.length > 30) { const v = this.lista.shift(); this.scene.remove(v.obj); }
  }

  // trozos de fibra de carbono
  esquirlas(pos, vel, n = 8) {
    const geo = new THREE.BoxGeometry(0.25, 0.02, 0.15);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(geo, mat); m.position.copy(pos); m.castShadow = true;
      m.scale.setScalar(0.5 + Math.random());
      this.scene.add(m);
      this.lista.push({ obj: m, v: new THREE.Vector3(vel.x * 0.6 + (Math.random() - 0.5) * 10, 2 + Math.random() * 5, vel.z * 0.6 + (Math.random() - 0.5) * 10), w: new THREE.Vector3(Math.random() * 20, Math.random() * 20, 0), radio: 0.03, vida: 20 });
    }
  }

  actualizar(dt) {
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    this.lista = this.lista.filter(p => {
      p.vida -= dt;
      if (p.vida <= 0) { this.scene.remove(p.obj); return false; }
      const o = p.obj;
      p.v.y -= 9.81 * dt;
      o.position.addScaledVector(p.v, dt);
      const suelo = this.sueloY(o.position.x, o.position.z) + p.radio;
      if (o.position.y < suelo) {
        o.position.y = suelo;
        if (p.v.y < 0) p.v.y = -p.v.y * 0.35;
        p.v.x *= 0.82; p.v.z *= 0.82; p.w.multiplyScalar(0.8);
        if (Math.abs(p.v.y) < 0.6) p.v.y = 0;
      }
      e.set(p.w.x * dt, p.w.y * dt, p.w.z * dt); q.setFromEuler(e); o.quaternion.multiply(q);
      return true;
    });
  }
}
