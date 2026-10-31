// Esculpir y pintar (sprint 7). Un pincel que se arrastra sobre la superficie:
// - esculpir: inflar, alisar, pellizcar, arrastrar, aplanar y máscara (lo enmascarado no se mueve);
// - pintar: color por vértice directamente sobre el modelo.
// Simetría en X, radio y fuerza. Cada trazo es un paso de deshacer. «Más detalle» subdivide la
// malla para tener más vértices que esculpir (con un límite para no saturar el móvil).
import * as THREE from 'three';
import { mallaDe, refrescarGeometria, ponerMalla, refrescarObjeto } from '../edicion.js';
import { subdividir } from '../malla/subdividir.js';

export const PINCELES = {
  inflar: 'Inflar', alisar: 'Alisar', pellizcar: 'Pellizcar', arrastrar: 'Arrastrar', aplanar: 'Aplanar', mascara: 'Máscara',
};

export class Pincel {
  constructor({ camara, lienzo, historial, escena }) {
    Object.assign(this, { camara, lienzo, historial, escena });
    this.obj = null; this.modo = 'esculpir';
    this.tipo = 'inflar'; this.radio = 0.12; this.fuerza = 0.5; this.restar = false; this.simetria = true;
    this.color = new THREE.Color(0xd8141f);
    this.ray = new THREE.Raycaster();
    this.mascaras = new WeakMap(); // malla → Float32Array (0 libre, 1 enmascarado)
    this.cursor = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false, side: THREE.DoubleSide }));
    this.cursor.renderOrder = 5; this.cursor.visible = false; this.cursor.raycast = () => {};
  }

  get activo() { return !!this.obj; }

  entrar(obj, modo) {
    this.salir();
    this.obj = obj; this.modo = modo;
    this.malla = mallaDe(obj);
    obj.userData.editando = true; // se esculpe la malla base (sin modificadores)
    refrescarObjeto(obj);
    if (modo === 'pintar') this.prepararColor();
    obj.parent.parent.add(this.cursor);
  }

  salir() {
    if (!this.obj) return;
    delete this.obj.userData.editando;
    if (!this.malla.heCol && this.obj.material.vertexColors) { this.obj.material.vertexColors = false; this.obj.material.needsUpdate = true; } // quitar la vista de la máscara
    refrescarObjeto(this.obj);
    this.cursor.removeFromParent();
    this.obj = null; this.malla = null;
  }

  // pintar necesita colores por esquina: si no los hay, se parte del color del material
  prepararColor() {
    const o = this.obj, m = this.malla;
    if (!m.heCol) {
      const c = o.material.color;
      m.heCol = new Array(m.nHE * 3);
      for (let h = 0; h < m.nHE; h++) { m.heCol[h * 3] = c.r; m.heCol[h * 3 + 1] = c.g; m.heCol[h * 3 + 2] = c.b; }
      o.material = o.material.clone();
      o.material.color.setHex(0xffffff); o.material.vertexColors = true; o.material.needsUpdate = true;
      ponerMalla(o, m);
    }
  }

  // ---------- trazo ----------

  tocar(x, y) {
    const r = this.lienzo.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camara);
    return this.ray.intersectObject(this.obj, false)[0] || null;
  }

  empezar(x, y) {
    if (!this.obj) return false;
    const hit = this.tocar(x, y);
    if (!hit) return false;
    const m = this.malla;
    this.antes = { pos: m.pos.slice(), col: m.heCol ? m.heCol.slice() : null, mascara: this.mascara().slice() };
    this.prepararMalla(m);
    this.obj.updateMatrixWorld();
    this.inv = this.obj.matrixWorld.clone().invert();
    this.escala = this.obj.matrixWorld.getMaxScaleOnAxis();
    this.ultimo = null;
    if (this.tipo === 'arrastrar' && this.modo === 'esculpir') this.iniciarArrastre(hit);
    this.aplicarEn(hit);
    return true;
  }

  mover(x, y) {
    if (!this.antes) return;
    if (this.tipo === 'arrastrar' && this.modo === 'esculpir') return this.arrastrar(x, y);
    const hit = this.tocar(x, y);
    if (!hit) { this.cursor.visible = false; return; }
    // muestras a lo largo del trazo, separadas un cuarto del radio
    const p = hit.point, paso = this.radio * 0.25;
    if (this.ultimo) {
      const d = p.distanceTo(this.ultimo.point), n = Math.min(12, Math.floor(d / paso));
      for (let i = 1; i <= n; i++) {
        const q = this.tocarEn(this.ultimo.point.clone().lerp(p, i / n));
        if (q) this.aplicarEn(q, false);
      }
    }
    this.aplicarEn(hit);
  }

  terminar() {
    if (!this.antes) return;
    const obj = this.obj, m = this.malla, antes = this.antes, despues = { pos: m.pos.slice(), col: m.heCol ? m.heCol.slice() : null, mascara: this.mascara().slice() };
    this.antes = null; this.cursor.visible = false;
    const poner = (e) => {
      m.pos = e.pos.slice(); if (e.col) m.heCol = e.col.slice();
      this.mascaras.set(m, Float32Array.from(e.mascara));
      if (e.col) ponerMalla(obj, m); else refrescarGeometria(obj);
    };
    const nombre = this.modo === 'pintar' ? 'Pintar' : `Esculpir: ${PINCELES[this.tipo]}`;
    this.historial.hacer({ nombre, hacer: () => poner(despues), deshacer: () => poner(antes) }, { yaHecho: true });
  }

  // impacto en un punto del mundo (para interpolar el trazo): se lanza el rayo desde la cámara
  tocarEn(pMundo) {
    this.ray.set(this.camara.position, pMundo.clone().sub(this.camara.position).normalize());
    return this.ray.intersectObject(this.obj, false)[0] || null;
  }

  aplicarEn(hit, refrescar = true) {
    this.colocarCursor(hit);
    const c = hit.point.clone().applyMatrix4(this.inv);
    const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    const r = this.radio / this.escala;
    this.golpe(c, n, r);
    if (this.simetria) this.golpe(new THREE.Vector3(-c.x, c.y, c.z), new THREE.Vector3(-n.x, n.y, n.z), r, true);
    this.ultimo = hit;
    if (refrescar) this.refrescar();
  }

  // un golpe de pincel centrado en c (coordenadas locales)
  golpe(c, n, r, espejo = false) {
    const m = this.malla, p = m.pos, mask = this.mascara(), r2 = r * r;
    const signo = this.restar ? -1 : 1, f = this.fuerza;
    const afectados = [];
    for (let v = 0; v < m.nV; v++) {
      const dx = p[v * 3] - c.x, dy = p[v * 3 + 1] - c.y, dz = p[v * 3 + 2] - c.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const t = 1 - Math.sqrt(d2) / r, caida = t * t * (3 - 2 * t); // suave en el borde
      afectados.push([v, caida * (this.modo === 'esculpir' && this.tipo !== 'mascara' ? 1 - mask[v] : 1)]);
    }
    if (this.modo === 'pintar') {
      const col = m.heCol, k = Math.min(1, f * 0.6);
      for (const [v, w] of afectados) for (const h of this.esquinas[v]) {
        col[h * 3] += (this.color.r - col[h * 3]) * w * k; col[h * 3 + 1] += (this.color.g - col[h * 3 + 1]) * w * k; col[h * 3 + 2] += (this.color.b - col[h * 3 + 2]) * w * k;
      }
      return;
    }
    if (this.tipo === 'mascara') { for (const [v, w] of afectados) mask[v] = Math.max(0, Math.min(1, mask[v] + signo * w * f)); return; }
    // normal media de la zona (para inflar y aplanar)
    const nz = new THREE.Vector3();
    for (const [v, w] of afectados) nz.addScaledVector(this.normales[v], w);
    if (nz.lengthSq() < 1e-12) nz.copy(n); nz.normalize();
    const paso = r * 0.06 * f * signo;
    if (this.tipo === 'inflar') {
      for (const [v, w] of afectados) { const nv = this.normales[v]; p[v * 3] += nv.x * paso * w; p[v * 3 + 1] += nv.y * paso * w; p[v * 3 + 2] += nv.z * paso * w; }
    } else if (this.tipo === 'alisar') {
      const nuevo = afectados.map(([v, w]) => {
        const vs = this.vecinos[v]; if (!vs.length) return null;
        let x = 0, y = 0, z = 0; for (const u of vs) { x += p[u * 3]; y += p[u * 3 + 1]; z += p[u * 3 + 2]; }
        const k = Math.min(1, w * f);
        return [v, p[v * 3] + (x / vs.length - p[v * 3]) * k, p[v * 3 + 1] + (y / vs.length - p[v * 3 + 1]) * k, p[v * 3 + 2] + (z / vs.length - p[v * 3 + 2]) * k];
      });
      for (const q of nuevo) if (q) { p[q[0] * 3] = q[1]; p[q[0] * 3 + 1] = q[2]; p[q[0] * 3 + 2] = q[3]; }
    } else if (this.tipo === 'pellizcar') {
      for (const [v, w] of afectados) {
        const k = 0.15 * f * w * signo;
        // hacia el centro del pincel, sin salirse de la superficie
        const d = new THREE.Vector3(c.x - p[v * 3], c.y - p[v * 3 + 1], c.z - p[v * 3 + 2]);
        d.addScaledVector(nz, -d.dot(nz));
        p[v * 3] += d.x * k; p[v * 3 + 1] += d.y * k; p[v * 3 + 2] += d.z * k;
      }
    } else if (this.tipo === 'aplanar') {
      // plano por el centro de la zona con la normal media
      let cx = 0, cy = 0, cz = 0, sw = 0;
      for (const [v, w] of afectados) { cx += p[v * 3] * w; cy += p[v * 3 + 1] * w; cz += p[v * 3 + 2] * w; sw += w; }
      if (!sw) return;
      cx /= sw; cy /= sw; cz /= sw;
      for (const [v, w] of afectados) {
        const dist = (p[v * 3] - cx) * nz.x + (p[v * 3 + 1] - cy) * nz.y + (p[v * 3 + 2] - cz) * nz.z, k = Math.min(1, w * f * 0.5);
        p[v * 3] -= nz.x * dist * k; p[v * 3 + 1] -= nz.y * dist * k; p[v * 3 + 2] -= nz.z * dist * k;
      }
    }
  }

  // arrastrar: los vértices bajo el pincel siguen al dedo por un plano frente a la cámara
  iniciarArrastre(hit) {
    const m = this.malla, c = hit.point.clone().applyMatrix4(this.inv), r = this.radio / this.escala, mask = this.mascara();
    const elegir = (cc) => {
      const out = [];
      for (let v = 0; v < m.nV; v++) {
        const d = Math.hypot(m.pos[v * 3] - cc.x, m.pos[v * 3 + 1] - cc.y, m.pos[v * 3 + 2] - cc.z);
        if (d < r) { const t = 1 - d / r; out.push([v, t * t * (3 - 2 * t) * (1 - mask[v]), m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]]); }
      }
      return out;
    };
    this.agarre = { pesos: elegir(c), espejo: this.simetria ? elegir(new THREE.Vector3(-c.x, c.y, c.z)) : [], origen: hit.point.clone(),
      plano: new THREE.Plane().setFromNormalAndCoplanarPoint(this.camara.getWorldDirection(new THREE.Vector3()), hit.point) };
    this.colocarCursor(hit);
  }
  arrastrar(x, y) {
    const a = this.agarre; if (!a) return;
    const r = this.lienzo.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camara);
    const q = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(a.plano, q)) return;
    const dMundo = q.sub(a.origen);
    const dl = dMundo.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(this.inv));
    const p = this.malla.pos, k = this.fuerza * 1.6;
    for (const [v, w, x0, y0, z0] of a.pesos) { p[v * 3] = x0 + dl.x * w * k; p[v * 3 + 1] = y0 + dl.y * w * k; p[v * 3 + 2] = z0 + dl.z * w * k; }
    for (const [v, w, x0, y0, z0] of a.espejo) { p[v * 3] = x0 - dl.x * w * k; p[v * 3 + 1] = y0 + dl.y * w * k; p[v * 3 + 2] = z0 + dl.z * w * k; }
    this.refrescar();
  }

  // ---------- utilidades ----------

  // vecinos, esquinas y normales por vértice (para alisar, pintar rápido e inflar). También lo
  // usan las plantillas para esculpir por código con los mismos pinceles.
  prepararMalla(m) {
    this.malla = m;
    this.vecinos = Array.from({ length: m.nV }, () => []);
    for (let e = 0; e < m.nE; e++) { const [a, b] = m.vertsDeArista(e); this.vecinos[a].push(b); this.vecinos[b].push(a); }
    this.esquinas = Array.from({ length: m.nV }, () => []);
    for (let h = 0; h < m.nHE; h++) this.esquinas[m.heV[h]].push(h);
    this.normales = this.normalesVertice();
  }

  mascara() {
    let k = this.mascaras.get(this.malla);
    if (!k || k.length !== this.malla.nV) { k = new Float32Array(this.malla.nV); this.mascaras.set(this.malla, k); }
    return k;
  }
  limpiarMascara() { this.mascaras.set(this.malla, new Float32Array(this.malla.nV)); this.refrescar(); }

  normalesVertice() {
    const m = this.malla, n = Array.from({ length: m.nV }, () => new THREE.Vector3()), t = [0, 0, 0];
    for (let f = 0; f < m.nF; f++) { m.normalCara(f, t); for (const v of m.vertsDeCara(f)) n[v].x += t[0], n[v].y += t[1], n[v].z += t[2]; }
    for (const v of n) v.normalize();
    return n;
  }

  colocarCursor(hit) {
    const n = hit.face ? hit.face.normal.clone().transformDirection(this.obj.matrixWorld) : new THREE.Vector3(0, 1, 0);
    this.cursor.position.copy(hit.point).addScaledVector(n, 0.002);
    this.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.cursor.scale.setScalar(this.radio);
    this.cursor.material.color.set(this.modo === 'pintar' ? this.color : this.restar ? 0x7fb3ff : 0xffffff);
    this.cursor.visible = true;
  }

  refrescar() {
    if (this.modo === 'pintar') {
      const g = this.obj.geometry, col = g.attributes.color;
      if (col) { col.array.set(this.malla.heCol); col.needsUpdate = true; }
      return;
    }
    refrescarGeometria(this.obj);
    this.mostrarMascara();
  }

  // lo enmascarado se oscurece (color por esquina solo en pantalla)
  mostrarMascara() {
    const g = this.obj.geometry, mask = this.mascara();
    if (!mask.some((x) => x > 0) && !g.attributes.color) return;
    if (this.malla.heCol) return; // con pintura, la máscara no se dibuja para no tapar los colores
    let col = g.attributes.color;
    if (!col) { col = new THREE.BufferAttribute(new Float32Array(this.malla.nHE * 3), 3); g.setAttribute('color', col); this.obj.material.vertexColors = true; this.obj.material.needsUpdate = true; }
    for (let h = 0; h < this.malla.nHE; h++) {
      const k = 1 - 0.65 * mask[this.malla.heV[h]];
      col.array[h * 3] = k; col.array[h * 3 + 1] = k; col.array[h * 3 + 2] = k;
    }
    col.needsUpdate = true;
  }

  masDetalle() {
    const m = this.malla;
    if (m.nF * 4 > 120000) return false;
    const antes = m, despues = subdividir(m, 1).malla, obj = this.obj;
    const poner = (x) => { ponerMalla(obj, x); if (this.obj === obj) this.malla = x; };
    this.historial.hacer({ nombre: 'Más detalle', hacer: () => poner(despues), deshacer: () => poner(antes) });
    return true;
  }
}
