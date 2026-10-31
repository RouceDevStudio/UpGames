// Modo edición: seleccionar vértices, aristas y caras de la malla de media arista y moverlos,
// girarlos o escalarlos con el gizmo (con deshacer).
import * as THREE from 'three';
import { MallaHE } from './malla/mediaArista.js';
import { aGeometria, posicionesEsquinas, normalesEsquinas } from './malla/aGeometria.js';
import { mallas } from './escena.js';
import * as OP from './malla/operaciones.js';
import { subdividir } from './malla/subdividir.js';
import { evaluar } from './malla/modificadores.js';

// Contexto de los modificadores (las booleanas piden los polígonos de otros objetos a main.js).
let ctxMods = {};
export function contextoModificadores(c) { ctxMods = c; }
const tieneMods = (obj) => (obj.userData.modificadores || []).some((x) => x.visible);
// Lo que se dibuja: en modo Editar la malla base; si no, el resultado de la pila de modificadores.
function mallaVisible(obj, m) {
  if (obj.userData.editando || !tieneMods(obj)) return m;
  return evaluar(m, obj.userData.modificadores, { poligonosDe: (id) => ctxMods.poligonosDe?.(id, obj) });
}

// Vuelve a construir lo que se ve de un objeto (tras cambiar sus modificadores o salir de Editar).
export function refrescarObjeto(obj) {
  const m = mallaDe(obj), vieja = obj.geometry;
  obj.geometry = geometriaDe(mallaVisible(obj, m));
  vieja.dispose();
}

const NARANJA = new THREE.Color(0xff8a1f);
const OSCURO = new THREE.Color(0x14171f);
const CIAN = new THREE.Color(0x00d2ff); // aristas fijadas (pliegue)
const RADIO_TOQUE = 26; // px

// Malla de media arista del objeto (se crea la primera vez y la geometría pasa a ser la suya).
export function mallaDe(obj) {
  let m = mallas.get(obj);
  if (m) return m;
  const g = obj.geometry;
  m = MallaHE.desdeTriangulos(g.attributes.position.array, g.index ? g.index.array : null, {
    uvs: g.attributes.uv?.array, colores: g.attributes.color?.array, cuads: obj.userData.tipo !== 'ico',
  });
  mallas.set(obj, m);
  obj.geometry = geometriaDe(m);
  g.dispose();
  return m;
}

function geometriaDe(m) {
  const r = aGeometria(m);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.posiciones, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(r.normales, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(r.uvs, 2));
  if (r.colores) g.setAttribute('color', new THREE.BufferAttribute(r.colores, 3));
  g.setIndex(new THREE.BufferAttribute(r.indices, 1));
  g.userData.triCara = r.triCara;
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// Cambia la malla de un objeto por otra (tras una operación que cambia la topología).
export function ponerMalla(obj, m) {
  mallas.set(obj, m);
  const vieja = obj.geometry;
  obj.geometry = geometriaDe(mallaVisible(obj, m));
  vieja.dispose();
}

// Vuelve a escribir posiciones y normales después de mover vértices.
export function refrescarGeometria(obj) {
  if (!obj.userData.editando && tieneMods(obj)) return refrescarObjeto(obj);
  const m = mallas.get(obj), g = obj.geometry;
  posicionesEsquinas(m, g.attributes.position.array);
  normalesEsquinas(m, 30, g.attributes.normal.array);
  g.attributes.position.needsUpdate = true;
  g.attributes.normal.needsUpdate = true;
  g.computeBoundingBox(); g.computeBoundingSphere();
}

export class ModoEdicion {
  constructor({ scene, camara, lienzo, historial, gizmo, alCambiar }) {
    Object.assign(this, { scene, camara, lienzo, historial, gizmo, alCambiar });
    this.obj = null; this.malla = null;
    this.tipo = 'v';
    this.sel = new Set();
    this.anadir = false;  // tocar suma/quita de la selección
    this.rayosX = false;
    this.pivote = new THREE.Object3D();
    this.pivote.name = 'pivote';
    scene.add(this.pivote);
    this.ray = new THREE.Raycaster();
    gizmo.edicion = this;
  }

  get activo() { return !!this.obj; }

  // ---------- operaciones de modelado (sprint 3), cada una con deshacer ----------
  // fn(malla, modo) → { malla, caras | aristas | vertices } o null si no aplica.
  operar(nombre, fn) {
    const obj = this.obj, antes = this.malla, selAntes = { tipo: this.tipo, sel: [...this.sel] };
    let r;
    try { r = fn(antes, this); } catch (e) { console.error(e); return false; }
    if (!r || !r.malla) return false;
    const selDespues = r.caras ? { tipo: 'f', sel: r.caras } : r.aristas ? { tipo: 'e', sel: r.aristas } : r.vertices ? { tipo: 'v', sel: r.vertices } : { tipo: this.tipo, sel: [] };
    const poner = (m, s) => {
      ponerMalla(obj, m);
      if (this.obj === obj) this.recrear(m, s);
    };
    this.historial.hacer({ nombre, hacer: () => poner(r.malla, selDespues), deshacer: () => poner(antes, selAntes) });
    return true;
  }

  recrear(m, s) {
    this.malla = m;
    for (const c of [this.puntos, this.lineas, this.caras]) { this.obj.remove(c); c.geometry.dispose(); }
    this.crearCapas();
    this.aplicarRayosX();
    this.tipo = s.tipo;
    this.sel = new Set(s.sel);
    this.actualizar();
  }

  carasAfectadas(m = this.malla) {
    if (this.tipo === 'f') return [...this.sel];
    if (this.tipo === 'e') return OP.carasDeAristas(m, [...this.sel]);
    return OP.carasDeVertices(m, [...this.sel]);
  }

  extruir() { return this.tipo === 'f' && this.sel.size && this.operar('Extruir', (m) => OP.extruirCaras(m, [...this.sel])); }
  inset() { return this.tipo === 'f' && this.sel.size && this.operar('Inset', (m) => OP.insetCaras(m, [...this.sel], 0.25)); }
  cortarBucle() { return this.tipo === 'e' && this.sel.size && this.operar('Corte en bucle', (m) => OP.cortarBucle(m, [...this.sel].pop(), 0.5)); }
  subdividir() { return this.operar('Subdividir', (m) => (m.nF * 4 > 200000 ? null : subdividir(m, 1))); }
  suavizar() { return this.operar('Suavizar', (m) => OP.suavizarVertices(m, [...this.vertsSeleccionados()], 0.5, 2)); }
  fusionar() { return this.tipo === 'v' && this.sel.size > 1 && this.operar('Fusionar', (m) => OP.fusionarVertices(m, [...this.sel])); }
  borrar() { return this.sel.size && this.operar('Borrar', (m) => OP.borrarCaras(m, this.carasAfectadas(m))); }
  simetria() { return this.operar('Simetría X', (m) => OP.simetriaX(m)); }
  biselar() { return this.tipo === 'e' && this.sel.size && this.operar('Biselar', (m) => OP.biselarAristas(m, [...this.sel], this.anchoBisel())); }
  pliegue() { return this.tipo === 'e' && this.sel.size && this.operar('Fijar borde', (m) => OP.alternarPliegues(m, [...this.sel])); }
  rellenar() { return this.operar('Rellenar agujero', (m) => OP.rellenarAgujeros(m, this.sel.size ? [...this.vertsSeleccionados()] : null)); }
  puente() { return this.tipo === 'f' && this.sel.size >= 2 && this.operar('Puente', (m) => OP.puenteCaras(m, [...this.sel])); }

  // Cuchillo: dos toques en la pantalla marcan la línea; el plano pasa por ella y por el ojo de la
  // cámara. Corta las caras seleccionadas (o todas si no hay selección).
  empezarCuchillo() { this.cuchillo = []; this.alCambiar(); }
  puntoCuchillo(x, y) {
    const r = this.lienzo.getBoundingClientRect();
    this.cuchillo.push(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1));
    if (this.cuchillo.length < 2) { this.alCambiar(); return true; }
    const [a, b] = this.cuchillo.map((n) => new THREE.Vector3(n.x, n.y, 0.5).unproject(this.camara));
    const ojo = this.camara.position.clone();
    const nMundo = new THREE.Vector3().crossVectors(a.clone().sub(ojo), b.clone().sub(ojo)).normalize();
    this.cuchillo = null;
    // plano al espacio local del objeto
    this.obj.updateMatrixWorld();
    const inv = this.obj.matrixWorld.clone().invert();
    const pl = new THREE.Vector3().copy(ojo).applyMatrix4(inv), nl = nMundo.clone().transformDirection(inv);
    const caras = this.tipo === 'f' && this.sel.size ? [...this.sel] : null;
    const ok = this.operar('Cuchillo', (m) => OP.cortarPlano(m, pl.toArray(), nl.toArray(), caras));
    this.alCambiar();
    return ok;
  }

  // medidas de lo seleccionado (en metros, con la escala del objeto)
  medidas() {
    const m = this.malla, s = this.obj.matrixWorld, P = (v) => new THREE.Vector3(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]).applyMatrix4(s);
    const sel = [...this.sel];
    if (this.tipo === 'v' && sel.length === 2) return `distancia ${P(sel[0]).distanceTo(P(sel[1])).toFixed(3)} m`;
    if (this.tipo === 'e' && sel.length) { const l = sel.reduce((t, e) => { const [a, b] = m.vertsDeArista(e); return t + P(a).distanceTo(P(b)); }, 0); return `${sel.length > 1 ? 'largo total' : 'largo'} ${l.toFixed(3)} m`; }
    const vs = this.vertsSeleccionados();
    if (vs.size > 1) { const c = new THREE.Box3(); for (const v of vs) c.expandByPoint(P(v)); const t = c.getSize(new THREE.Vector3()); return `caja ${t.x.toFixed(3)} × ${t.y.toFixed(3)} × ${t.z.toFixed(3)} m`; }
    return '';
  }
  // ancho del bisel: un quinto de la arista seleccionada más corta (como el arrastre inicial de Blender)
  anchoBisel() {
    const m = this.malla, P = (v) => [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]];
    return Math.min(...[...this.sel].map((e) => { const [a, b] = m.vertsDeArista(e); return Math.hypot(...[0, 1, 2].map((k) => P(a)[k] - P(b)[k])); })) * (this.factorBisel || 0.2);
  }

  entrar(obj) {
    this.salir();
    this.obj = obj;
    this.malla = mallaDe(obj);
    obj.userData.editando = true;
    if (tieneMods(obj)) refrescarObjeto(obj); // en Editar se ve y se toca la malla base
    this.sel.clear();
    const mat = obj.material;
    this.matAntes = { po: mat.polygonOffset, pf: mat.polygonOffsetFactor, pu: mat.polygonOffsetUnits, tr: mat.transparent, op: mat.opacity };
    Object.assign(mat, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.crearCapas();
    this.aplicarRayosX();
    this.actualizar();
  }

  salir() {
    if (!this.obj) return;
    const mat = this.obj.material, a = this.matAntes;
    Object.assign(mat, { polygonOffset: a.po, polygonOffsetFactor: a.pf, polygonOffsetUnits: a.pu, transparent: a.tr, opacity: a.op, depthWrite: true });
    mat.needsUpdate = true;
    for (const c of [this.puntos, this.lineas, this.caras]) { this.obj.remove(c); c.geometry.dispose(); }
    delete this.obj.userData.editando;
    if (tieneMods(this.obj)) refrescarObjeto(this.obj);
    this.obj = null; this.malla = null; this.sel.clear();
    this.gizmo.pivote = null; this.gizmo.sincronizar();
    this.alCambiar();
  }

  // ---------- capas de dibujo (hijas del objeto: heredan su transformación) ----------

  crearCapas() {
    const m = this.malla;
    const gp = new THREE.BufferGeometry();
    gp.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.nV * 3), 3));
    gp.setAttribute('color', new THREE.BufferAttribute(new Float32Array(m.nV * 3), 3));
    this.puntos = new THREE.Points(gp, new THREE.PointsMaterial({ size: matchMedia('(pointer: coarse)').matches ? 9 : 7, sizeAttenuation: false, vertexColors: true }));
    const gl = new THREE.BufferGeometry();
    gl.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.nE * 6), 3));
    gl.setAttribute('color', new THREE.BufferAttribute(new Float32Array(m.nE * 6), 3));
    this.lineas = new THREE.LineSegments(gl, new THREE.LineBasicMaterial({ vertexColors: true }));
    const gc = new THREE.BufferGeometry();
    gc.setAttribute('position', this.obj.geometry.attributes.position);
    this.caras = new THREE.Mesh(gc, new THREE.MeshBasicMaterial({ color: NARANJA, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    for (const c of [this.puntos, this.lineas, this.caras]) { c.renderOrder = 3; c.raycast = () => {}; c.userData.capa = true; this.obj.add(c); }
  }

  aplicarRayosX() {
    if (!this.obj) return;
    const mat = this.obj.material;
    Object.assign(mat, { transparent: this.rayosX || this.matAntes.tr, opacity: this.rayosX ? 0.45 : this.matAntes.op, depthWrite: !this.rayosX });
    mat.needsUpdate = true;
    for (const c of [this.puntos, this.lineas]) { c.material.depthTest = !this.rayosX; c.material.needsUpdate = true; }
  }

  // Vértices afectados por la selección actual.
  vertsSeleccionados() {
    const m = this.malla, r = new Set();
    if (this.tipo === 'v') for (const v of this.sel) r.add(v);
    else if (this.tipo === 'e') for (const e of this.sel) for (const v of m.vertsDeArista(e)) r.add(v);
    else for (const f of this.sel) for (const v of m.vertsDeCara(f)) r.add(v);
    return r;
  }

  // Redibuja capas, colores y coloca el pivote del gizmo.
  actualizar() {
    const m = this.malla, p = m.pos, vs = this.vertsSeleccionados();
    const pp = this.puntos.geometry.attributes.position, pc = this.puntos.geometry.attributes.color;
    for (let v = 0; v < m.nV; v++) {
      pp.setXYZ(v, p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
      const c = vs.has(v) ? NARANJA : OSCURO;
      pc.setXYZ(v, c.r, c.g, c.b);
    }
    pp.needsUpdate = pc.needsUpdate = true;
    this.puntos.visible = this.tipo === 'v';
    const lp = this.lineas.geometry.attributes.position, lc = this.lineas.geometry.attributes.color;
    const caraSel = this.tipo === 'f' ? this.sel : null;
    for (let e = 0; e < m.nE; e++) {
      const [a, b] = m.vertsDeArista(e);
      lp.setXYZ(e * 2, p[a * 3], p[a * 3 + 1], p[a * 3 + 2]);
      lp.setXYZ(e * 2 + 1, p[b * 3], p[b * 3 + 1], p[b * 3 + 2]);
      let si;
      if (this.tipo === 'e') si = this.sel.has(e);
      else if (caraSel) { const h = m.eHe[e], t = m.heTwin[h]; si = caraSel.has(m.heFace[h]) || (t >= 0 && caraSel.has(m.heFace[t])); }
      else si = vs.has(a) && vs.has(b);
      const c = si ? NARANJA : m.esPliegue(a, b) ? CIAN : OSCURO;
      lc.setXYZ(e * 2, c.r, c.g, c.b); lc.setXYZ(e * 2 + 1, c.r, c.g, c.b);
    }
    lp.needsUpdate = lc.needsUpdate = true;
    this.lineas.geometry.computeBoundingSphere();
    this.puntos.geometry.computeBoundingSphere();
    // caras seleccionadas: los triángulos de esas caras
    const tri = this.obj.geometry.userData.triCara, ind = this.obj.geometry.index.array, idx = [];
    if (this.tipo === 'f' && this.sel.size) for (let t = 0; t < tri.length; t++) if (this.sel.has(tri[t])) idx.push(ind[t * 3], ind[t * 3 + 1], ind[t * 3 + 2]);
    this.caras.geometry.setIndex(idx);
    this.caras.visible = idx.length > 0;
    this.colocarPivote(vs);
    this.alCambiar();
  }

  colocarPivote(vs = this.vertsSeleccionados()) {
    if (!vs.size) { this.gizmo.pivote = null; this.gizmo.sincronizar(); return; }
    const c = new THREE.Vector3(), p = this.malla.pos;
    for (const v of vs) c.x += p[v * 3], c.y += p[v * 3 + 1], c.z += p[v * 3 + 2];
    c.divideScalar(vs.size);
    this.obj.updateMatrixWorld();
    this.pivote.position.copy(c.applyMatrix4(this.obj.matrixWorld));
    this.pivote.quaternion.identity(); this.pivote.scale.set(1, 1, 1);
    this.pivote.updateMatrixWorld();
    this.gizmo.pivote = this.pivote; this.gizmo.sincronizar();
  }

  // ---------- selección ----------

  ponerTipo(t) {
    if (t === this.tipo) return;
    const vs = this.vertsSeleccionados(), m = this.malla;
    this.tipo = t;
    this.sel.clear();
    // convertir: lo que quede con todos sus vértices seleccionados
    if (t === 'v') for (const v of vs) this.sel.add(v);
    else if (t === 'e') { for (let e = 0; e < m.nE; e++) if (m.vertsDeArista(e).every((v) => vs.has(v))) this.sel.add(e); }
    else for (let f = 0; f < m.nF; f++) if (m.vertsDeCara(f).every((v) => vs.has(v))) this.sel.add(f);
    this.actualizar();
  }

  seleccionarTodo() {
    const n = this.tipo === 'v' ? this.malla.nV : this.tipo === 'e' ? this.malla.nE : this.malla.nF;
    if (this.sel.size === n) this.sel.clear();
    else for (let i = 0; i < n; i++) this.sel.add(i);
    this.actualizar();
  }

  seleccionarBucle() {
    if (this.tipo !== 'e' || !this.sel.size) return false;
    const ultima = [...this.sel].pop();
    for (const e of this.malla.bucle(ultima)) this.sel.add(e);
    this.actualizar();
    return true;
  }

  tocar(x, y, sumar = false) {
    if (this.cuchillo) return this.puntoCuchillo(x, y);
    const elem = this.elegir(x, y);
    const sumando = sumar || this.anadir;
    if (elem < 0) { if (!sumando) { this.sel.clear(); this.actualizar(); } return; }
    if (sumando) { if (this.sel.has(elem)) this.sel.delete(elem); else this.sel.add(elem); }
    else { this.sel.clear(); this.sel.add(elem); }
    // al final del Set queda la última tocada (para el bucle)
    if (this.sel.has(elem)) { this.sel.delete(elem); this.sel.add(elem); }
    this.actualizar();
  }

  // Elemento bajo el dedo (−1 si nada).
  elegir(x, y) {
    const r = this.lienzo.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camara);
    const hit = this.ray.intersectObject(this.obj, false)[0];
    if (this.tipo === 'f') return hit ? this.obj.geometry.userData.triCara[hit.faceIndex] : -1;
    const m = this.malla, p = m.pos, M = this.obj.matrixWorld;
    const aPantalla = (v, out) => {
      out.set(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]).applyMatrix4(M).project(this.camara);
      return out.z < 1 && out.z > -1 ? [(out.x + 1) / 2 * r.width, (1 - out.y) / 2 * r.height] : null;
    };
    const tx = x - r.left, ty = y - r.top, t = new THREE.Vector3(), cand = [];
    if (this.tipo === 'v') {
      for (let v = 0; v < m.nV; v++) {
        const s = aPantalla(v, t); if (!s) continue;
        const d = Math.hypot(s[0] - tx, s[1] - ty);
        if (d < RADIO_TOQUE) cand.push([d, v, [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]]);
      }
    } else {
      const sa = new Array(m.nV);
      for (let e = 0; e < m.nE; e++) {
        const [a, b] = m.vertsDeArista(e);
        const A = sa[a] !== undefined ? sa[a] : (sa[a] = aPantalla(a, t));
        const B = sa[b] !== undefined ? sa[b] : (sa[b] = aPantalla(b, t));
        if (!A || !B) continue;
        const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy || 1;
        const k = Math.max(0, Math.min(1, ((tx - A[0]) * dx + (ty - A[1]) * dy) / l2));
        const d = Math.hypot(A[0] + k * dx - tx, A[1] + k * dy - ty);
        if (d < RADIO_TOQUE * 0.8) cand.push([d, e, [0, 1, 2].map((i) => p[a * 3 + i] + k * (p[b * 3 + i] - p[a * 3 + i]))]);
      }
    }
    cand.sort((u, w) => u[0] - w[0]);
    for (const [, id, local] of cand.slice(0, 12)) if (this.rayosX || this.visible(local)) return id;
    return -1;
  }

  // ¿El punto (local del objeto) se ve desde la cámara, sin la propia malla delante?
  visible(local) {
    const w = new THREE.Vector3(...local).applyMatrix4(this.obj.matrixWorld);
    const o = this.camara.position, dir = w.clone().sub(o), dist = dir.length();
    this.ray.set(o, dir.normalize());
    const hit = this.ray.intersectObject(this.obj, false)[0];
    return !hit || hit.distance > dist - Math.max(1e-3, dist * 2e-3);
  }

  enfoque() {
    const vs = this.vertsSeleccionados();
    if (!vs.size) return null;
    const caja = new THREE.Box3(), p = this.malla.pos, t = new THREE.Vector3();
    for (const v of vs) caja.expandByPoint(t.set(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]).applyMatrix4(this.obj.matrixWorld));
    const s = caja.getBoundingSphere(new THREE.Sphere());
    s.radius = Math.max(s.radius, 0.25);
    return s;
  }

  // ---------- gizmo sobre los componentes ----------

  empezar() {
    this.obj.updateMatrixWorld();
    this.pivote.updateMatrixWorld();
    this.mover0 = {
      verts: [...this.vertsSeleccionados()],
      W: this.obj.matrixWorld.clone(),
      Winv: this.obj.matrixWorld.clone().invert(),
      P0inv: this.pivote.matrixWorld.clone().invert(),
    };
    this.mover0.antes = this.mover0.verts.map((v) => this.malla.pos.slice(v * 3, v * 3 + 3));
    // imán a vértices: candidatos = los vértices no seleccionados de este objeto y los de los demás
    if (this.ajusteVertices) {
      const sel = new Set(this.mover0.verts), cand = [], t = new THREE.Vector3();
      const m = this.malla;
      for (let v = 0; v < m.nV; v++) if (!sel.has(v)) cand.push(t.set(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]).applyMatrix4(this.mover0.W).toArray());
      this.obj.parent.children.forEach((o) => {
        if (o === this.obj || !o.visible || !o.isMesh) return;
        o.updateMatrixWorld();
        const a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i += Math.max(1, Math.floor(a.count / 4000))) cand.push(t.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld).toArray());
      });
      this.mover0.candidatos = cand;
      this.mover0.centro = this.pivote.position.clone();
    }
  }

  mover() {
    const s = this.mover0; if (!s) return;
    if (s.candidatos && this.gizmo.tc.mode === 'translate') {
      // el centro de la selección se pega al vértice más cercano (dentro de un radio en pantalla)
      const p = this.pivote.position, lim = this.camara.position.distanceTo(p) * 0.04;
      let mejor = null, d = lim;
      for (const q of s.candidatos) { const dd = Math.hypot(q[0] - p.x, q[1] - p.y, q[2] - p.z); if (dd < d) { d = dd; mejor = q; } }
      if (mejor) p.set(...mejor);
    }
    this.pivote.updateMatrixWorld();
    // local' = W⁻¹ · P · P0⁻¹ · W · local
    const T = s.Winv.clone().multiply(this.pivote.matrixWorld).multiply(s.P0inv).multiply(s.W);
    const p = this.malla.pos, t = new THREE.Vector3();
    s.verts.forEach((v, i) => {
      t.fromArray(s.antes[i]).applyMatrix4(T);
      p[v * 3] = t.x; p[v * 3 + 1] = t.y; p[v * 3 + 2] = t.z;
    });
    refrescarGeometria(this.obj);
    this.actualizarCapasRapido();
  }

  soltar() {
    const s = this.mover0; this.mover0 = null;
    if (!s) return;
    const obj = this.obj, m = this.malla;
    const despues = s.verts.map((v) => m.pos.slice(v * 3, v * 3 + 3));
    if (despues.every((d, i) => d.every((x, k) => Math.abs(x - s.antes[i][k]) < 1e-9))) return;
    const poner = (vals) => {
      s.verts.forEach((v, i) => { m.pos[v * 3] = vals[i][0]; m.pos[v * 3 + 1] = vals[i][1]; m.pos[v * 3 + 2] = vals[i][2]; });
      refrescarGeometria(obj);
      if (this.obj === obj) this.actualizar();
    };
    this.historial.hacer({ nombre: 'Mover componentes', hacer: () => poner(despues), deshacer: () => poner(s.antes) }, { yaHecho: true });
    this.actualizar();
  }

  // Durante el arrastre: solo posiciones de puntos y líneas.
  actualizarCapasRapido() {
    const m = this.malla, p = m.pos;
    const pp = this.puntos.geometry.attributes.position;
    for (const v of this.mover0.verts) pp.setXYZ(v, p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
    pp.needsUpdate = true;
    const lp = this.lineas.geometry.attributes.position;
    for (let e = 0; e < m.nE; e++) {
      const [a, b] = m.vertsDeArista(e);
      lp.setXYZ(e * 2, p[a * 3], p[a * 3 + 1], p[a * 3 + 2]);
      lp.setXYZ(e * 2 + 1, p[b * 3], p[b * 3 + 1], p[b * 3 + 2]);
    }
    lp.needsUpdate = true;
  }
}
