// Objetos de la escena, selección y los comandos que los cambian (todos con deshacer).
import * as THREE from 'three';

// Malla de media arista de cada objeto que ya se editó (ver edicion.js).
export const mallas = new WeakMap();

export class Escena {
  constructor(scene, historial) {
    this.scene = scene;
    this.historial = historial;
    this.raiz = new THREE.Group();
    this.raiz.name = 'Escena';
    scene.add(this.raiz);
    this.seleccion = null;
    this.oyentes = new Set();
  }

  get objetos() { return this.raiz.children; }

  alCambiar(fn) { this.oyentes.add(fn); }
  avisar() { for (const fn of this.oyentes) fn(this); }

  seleccionar(obj) {
    if (this.seleccion === obj) return;
    this.seleccion = obj && obj.parent === this.raiz ? obj : null;
    this.avisar();
  }

  nombreLibre(base) {
    const usados = new Set(this.objetos.map((o) => o.name));
    if (!usados.has(base)) return base;
    for (let i = 1; ; i++) { const n = `${base}.${String(i).padStart(3, '0')}`; if (!usados.has(n)) return n; }
  }

  // ---------- comandos ----------

  anadir(obj, nombre = 'Añadir') {
    obj.name = this.nombreLibre(obj.name || 'Objeto');
    const antes = this.seleccion;
    this.historial.hacer({
      nombre,
      hacer: () => { this.raiz.add(obj); this.seleccionar(obj); this.avisar(); },
      deshacer: () => { this.raiz.remove(obj); this.seleccionar(antes === obj ? null : antes); this.avisar(); },
    });
    return obj;
  }

  // Varias piezas de una vez (p. ej. una plantilla): un solo paso de deshacer.
  anadirVarios(objs, nombre = 'Añadir') {
    for (const o of objs) o.name = this.nombreLibre(o.name || 'Objeto');
    const antes = this.seleccion;
    this.historial.hacer({
      nombre,
      hacer: () => { for (const o of objs) this.raiz.add(o); this.seleccionar(objs[0]); this.avisar(); },
      deshacer: () => { for (const o of objs) this.raiz.remove(o); this.seleccionar(objs.includes(antes) ? null : antes); this.avisar(); },
    });
    return objs;
  }

  borrar(obj = this.seleccion) {
    if (!obj) return;
    const pos = this.objetos.indexOf(obj);
    this.historial.hacer({
      nombre: 'Borrar',
      hacer: () => { if (this.seleccion === obj) this.seleccionar(null); this.raiz.remove(obj); this.avisar(); },
      deshacer: () => {
        this.raiz.add(obj);
        // volver a su sitio en la lista
        this.raiz.children.splice(this.raiz.children.indexOf(obj), 1);
        this.raiz.children.splice(pos, 0, obj);
        this.seleccionar(obj); this.avisar();
      },
    });
  }

  duplicar(obj = this.seleccion) {
    if (!obj) return null;
    const copia = obj.clone();
    copia.geometry = obj.geometry.clone();
    if (mallas.has(obj)) mallas.set(copia, mallas.get(obj).clone());
    for (const c of copia.children.filter((h) => h.userData.capa)) copia.remove(c); // capas del modo edición
    copia.material = obj.material.clone();
    copia.userData.bloqueado = false;
    copia.position.x += 0.3; copia.position.z += 0.3;
    copia.name = obj.name.replace(/\.\d{3}$/, '');
    return this.anadir(copia, 'Duplicar');
  }

  // Registra un cambio de transformación que ya ocurrió (gizmo).
  transformado(obj, antes) {
    const despues = estado(obj);
    if (igual(antes, despues)) return;
    this.historial.hacer({
      nombre: 'Transformar',
      hacer: () => { poner(obj, despues); this.avisar(); },
      deshacer: () => { poner(obj, antes); this.avisar(); },
    }, { yaHecho: true });
  }

  propiedad(obj, nombre, leer, escribir, valor) {
    const antes = leer(obj);
    if (antes === valor) return;
    this.historial.hacer({
      nombre,
      hacer: () => { escribir(obj, valor); this.avisar(); },
      deshacer: () => { escribir(obj, antes); this.avisar(); },
    });
  }

  renombrar(obj, nombre) {
    nombre = nombre.trim();
    if (!nombre || nombre === obj.name) return;
    this.propiedad(obj, 'Renombrar', (o) => o.name, (o, v) => { o.name = v; }, this.nombreLibre(nombre));
  }

  colorear(obj, hex) {
    this.propiedad(obj, 'Color', (o) => o.material.color.getHex(), (o, v) => { o.material.color.setHex(v); }, hex);
  }

  alternarVisible(obj) {
    this.propiedad(obj, obj.visible ? 'Ocultar' : 'Mostrar', (o) => o.visible, (o, v) => {
      o.visible = v;
      if (!v && this.seleccion === o) this.seleccionar(null);
    }, !obj.visible);
  }

  alternarBloqueo(obj) {
    this.propiedad(obj, 'Bloquear', (o) => !!o.userData.bloqueado, (o, v) => { o.userData.bloqueado = v; }, !obj.userData.bloqueado);
  }

  // Esfera que envuelve lo seleccionado (o toda la escena) para enfocar la cámara.
  esferaDe(obj) {
    const caja = new THREE.Box3();
    if (obj) caja.setFromObject(obj);
    else for (const o of this.objetos) if (o.visible) caja.expandByObject(o);
    if (caja.isEmpty()) return new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 2);
    return caja.getBoundingSphere(new THREE.Sphere());
  }
}

export const estado = (o) => ({ p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray() });
const poner = (o, e) => { o.position.fromArray(e.p); o.quaternion.fromArray(e.q); o.scale.fromArray(e.s); o.updateMatrixWorld(); };
const igual = (a, b) => ['p', 'q', 's'].every((k) => a[k].every((v, i) => Math.abs(v - b[k][i]) < 1e-7));
