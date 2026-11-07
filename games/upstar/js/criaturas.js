// Criaturas generadas por piezas. Cada planeta tiene 6 especies (de su semilla: cuerpo, patas,
// cabeza, cuernos, cola, ojos, colores, tamaño, si vuela y su temperamento). Dónde aparecen
// también sale de una fórmula: la superficie se divide en celdas de ~140 m y cada celda decide
// (con su hash) cuántas criaturas tiene y de qué especie. Solo existen las de alrededor del
// jugador; al volver, vuelven a estar las mismas.
import * as THREE from 'three';
import { hash, azar } from './ruido.js';
import { materialToon } from './planeta.js';

function construir(es) {
  const g = new THREE.Group(), t = es.tam;
  const piel = materialToon({ color: es.color }), acc = materialToon({ color: es.acento, emissive: new THREE.Color(es.acento), emissiveIntensity: 0.4 }, 0.3);
  const ojo = new THREE.MeshBasicMaterial({ color: es.acento });
  const altoPatas = es.patas ? t * 0.55 : 0;
  const cuerpo = new THREE.Mesh(new THREE.SphereGeometry(t * 0.5, 12, 9), piel);
  cuerpo.scale.set(es.cuerpo[0], es.cuerpo[1], es.cuerpo[2] * 1.3); cuerpo.position.y = altoPatas + t * 0.3; g.add(cuerpo);
  const cabeza = new THREE.Group(); cabeza.position.set(0, altoPatas + t * (0.45 + es.cuello), -t * 0.6 * es.cuerpo[2]); g.add(cabeza);
  cabeza.add(new THREE.Mesh(new THREE.SphereGeometry(t * es.cabeza, 10, 8), piel));
  for (let k = 0; k < es.ojos; k++) { const o = new THREE.Mesh(new THREE.SphereGeometry(t * 0.07, 6, 5), ojo); o.position.set((k - (es.ojos - 1) / 2) * t * 0.16, t * es.cabeza * 0.3, -t * es.cabeza * 0.85); cabeza.add(o); }
  if (es.cuernos) for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(t * 0.06, t * 0.45, 5), acc); c.position.set(s * t * 0.15, t * es.cabeza * 0.9, 0); c.rotation.z = -s * 0.4; cabeza.add(c); }
  if (es.cola) { const c = new THREE.Mesh(new THREE.ConeGeometry(t * 0.12, t * 0.9, 6), acc); c.rotation.x = -Math.PI / 2 - 0.4; c.position.set(0, altoPatas + t * 0.35, t * 0.75 * es.cuerpo[2]); g.add(c); }
  // franja luminosa en el lomo (identidad de neón)
  const fr = new THREE.Mesh(new THREE.BoxGeometry(t * 0.08, t * 0.05, t * es.cuerpo[2] * 0.9), acc); fr.position.y = altoPatas + t * (0.3 + 0.5 * es.cuerpo[1]); g.add(fr);
  const patas = [];
  for (let k = 0; k < es.patas; k++) {
    const p = new THREE.Group(), fila = Math.floor(k / 2), s = k % 2 ? 1 : -1;
    p.position.set(s * t * 0.32 * es.cuerpo[0], altoPatas + t * 0.15, (fila - (es.patas / 2 - 1) / 2) * t * 0.55 * es.cuerpo[2]);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(t * 0.06, t * 0.04, altoPatas + t * 0.15, 5), piel); m.position.y = -(altoPatas + t * 0.15) / 2; p.add(m);
    g.add(p); patas.push(p);
  }
  const alas = [];
  if (es.vuela) for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(s * t * 0.3, t * 0.35, 0);
    const a = new THREE.Mesh(new THREE.PlaneGeometry(t * 1.4, t * 0.7), new THREE.MeshBasicMaterial({ color: es.acento, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    a.rotation.x = -Math.PI / 2; a.position.x = s * t * 0.7; p.add(a); g.add(p); alas.push(p);
  }
  g.userData = { patas, alas, cabeza };
  return g;
}

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), ARRIBA = new THREE.Vector3(0, 1, 0);

export class Criaturas {
  constructor(scene) { this.scene = scene; this.activas = new Map(); this.pl = null; }

  /** Cambia de planeta: se van todas. */
  _limpiar() { for (const c of this.activas.values()) this.scene.remove(c.obj); this.activas.clear(); }

  actualizar(dt, pl, foco, jugador, cerca) {
    if (pl !== this.pl) { this._limpiar(); this.pl = pl; }
    if (!pl || !cerca) { if (this.activas.size) this._limpiar(); return; }
    const c = pl.grupo.position, R = pl.R, d = _v.copy(foco).sub(c).normalize();
    const delta = 140 / R, lat = Math.asin(d.y), lon = Math.atan2(d.z, d.x);
    const i0 = Math.floor(lat / delta), j0 = Math.floor(lon * Math.cos(lat) / delta);
    const vivas = new Set();
    for (let i = i0 - 3; i <= i0 + 3; i++) for (let j = j0 - 3; j <= j0 + 3; j++) {
      const hc = hash(pl.p.semilla, i, j, 11), r = azar(hc), n = r() < 0.45 ? 0 : 1 + Math.floor(r() * 2.5);
      for (let k = 0; k < n; k++) {
        const id = `${i}:${j}:${k}`; vivas.add(id);
        if (this.activas.has(id)) continue;
        if (this.activas.size > 26) continue;
        const es = pl.p.especies[Math.floor(r() * pl.p.especies.length)];
        const la = (i + r()) * delta, lo = (j + r()) * delta / Math.max(0.2, Math.cos(la));
        const dir = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo));
        const h = pl.altura(dir.x, dir.y, dir.z);
        if (pl.p.agua && h < pl.p.nivelMar * pl.p.amplitud + 1 && !es.vuela) continue;     // no nadan
        const obj = construir(es); this.scene.add(obj);
        this.activas.set(id, { id, es, obj, dir, rumbo: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).projectOnPlane(dir).normalize(), fase: r() * 6, t: r() * 4, alto: es.vuela ? 12 + r() * 25 : 0, huye: 0, clave: `c:${pl.p.semilla}:${pl.p.especies.indexOf(es)}` });
      }
    }
    let dano = 0;
    for (const [id, cr] of this.activas) {
      if (!vivas.has(id)) { this.scene.remove(cr.obj); this.activas.delete(id); continue; }
      // comportamiento
      const pos = cr.obj.position, dj = jugador ? pos.distanceTo(jugador) : 1e9, es = cr.es;
      cr.t -= dt;
      let vel = es.velocidad * 0.35;
      if (cr.t <= 0) { cr.t = 2 + Math.random() * 5; cr.rumbo.applyAxisAngle(cr.dir, (Math.random() - 0.5) * 2.5); cr.parada = Math.random() < 0.35; }
      if (cr.parada) vel = 0;
      if (jugador && dj < 22 && es.temperamento === 'huidiza') { cr.rumbo.copy(pos).sub(jugador).projectOnPlane(cr.dir).normalize(); vel = es.velocidad * 1.6; }
      if (jugador && dj < 35 && es.temperamento === 'agresiva') {
        cr.rumbo.copy(jugador).sub(pos).projectOnPlane(cr.dir).normalize(); vel = es.velocidad * 1.3;
        if (dj < 2 + es.tam * 0.6) { vel = 0; dano += dt * 9; if (Math.random() < dt) this.alSonido?.(); }
      }
      // moverse sobre la esfera: girar la dirección hacia el rumbo
      const ang = vel * dt / R;
      if (ang > 0) { const eje = _v.crossVectors(cr.dir, cr.rumbo).normalize(); cr.dir.applyAxisAngle(eje, ang).normalize(); cr.rumbo.applyAxisAngle(eje, ang).projectOnPlane(cr.dir).normalize(); }
      let h = pl.altura(cr.dir.x, cr.dir.y, cr.dir.z); if (pl.p.agua) h = Math.max(h, pl.p.nivelMar * pl.p.amplitud);
      cr.fase += dt * (es.vuela ? 9 : vel * 2.2 + 0.5);
      pos.copy(c).addScaledVector(cr.dir, R + h + cr.alto + (es.vuela ? Math.sin(cr.fase * 0.2) * 3 : 0));
      _m.lookAt(new THREE.Vector3(), cr.rumbo, cr.dir);
      cr.obj.quaternion.setFromRotationMatrix(_m);
      const ud = cr.obj.userData, a = Math.sin(cr.fase) * (vel > 0 ? 0.6 : 0.05);
      ud.patas.forEach((p, k) => { p.rotation.x = (k % 2 ? a : -a) * (Math.floor(k / 2) % 2 ? -1 : 1); });
      ud.alas.forEach((p, k) => { p.rotation.z = Math.sin(cr.fase) * 0.7 * (k ? -1 : 1); });
      ud.cabeza.rotation.y = Math.sin(cr.fase * 0.3) * 0.4;
    }
    return dano;
  }

  /** Las criaturas a menos de `radio` metros de un punto. */
  cerca(p, radio) { const out = []; for (const c of this.activas.values()) if (c.obj.position.distanceTo(p) < radio) out.push(c); return out; }
}
