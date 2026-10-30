// Paradas en boxes con el equipo completo (personas articuladas de personas.js), y
// escombros (ruedas y alerones que salen volando).
//
// Equipo de una parada, como en la F1 actual: 4 pistoleros arrodillados, 4 que quitan y
// 4 que ponen ruedas, gato delantero y trasero, 2 estabilizadores en los pontones, 2 en
// el alerón delantero (cambian el morro si hace falta) y el jefe de parada, con el
// semáforo en un pórtico sobre el coche. Llegan antes que el coche y esperan en posición.

import * as THREE from 'three';
import { COCHE, COMPUESTOS } from '../config.js';
import { Persona } from './personas.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Un grupo de piezas fijas → una malla por material
function fundir(grupo) {
  const porMat = new Map();
  grupo.updateMatrixWorld(true);
  for (const m of grupo.children) {
    if (!m.isMesh) continue;
    m.updateMatrix();
    const g = m.geometry.clone().applyMatrix4(m.matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const gi = g.index ? g.toNonIndexed() : g;
    if (!porMat.has(m.material)) porMat.set(m.material, []);
    porMat.get(m.material).push(gi);
  }
  const out = new THREE.Group();
  for (const [mat, l] of porMat) { const f = new THREE.Mesh(mergeGeometries(l, false), mat); f.castShadow = true; out.add(f); }
  return out;
}

const A = COCHE.wheelbase * (1 - COCHE.repartoDel), B = COCHE.wheelbase * COCHE.repartoDel;
const RUEDAS = [[A, -1, COCHE.viaDel / 2], [A, 1, COCHE.viaDel / 2], [-B, -1, COCHE.viaTras / 2], [-B, 1, COCHE.viaTras / 2]];
const entre = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const suave = (t) => t * t * (3 - 2 * t);

// Geometrías y materiales del material de boxes (compartidos)
let EQ = null;
function equipamiento() {
  if (EQ) return EQ;
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.85, roughness: 0.3 });
  const negro = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
  const goma = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
  const llanta = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.35 });
  const neum = new THREE.CylinderGeometry(0.36, 0.36, 0.34, 24); neum.rotateX(Math.PI / 2);
  const rin = new THREE.CylinderGeometry(0.24, 0.24, 0.35, 18); rin.rotateX(Math.PI / 2);
  const manta = new THREE.CylinderGeometry(0.385, 0.385, 0.36, 24, 1, true); manta.rotateX(Math.PI / 2);
  const tapaManta = new THREE.CircleGeometry(0.385, 24);
  // pistola neumática: cuerpo, empuñadura, vaso y manguera corta
  const pist = new THREE.Group();
  const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.26, 12).rotateZ(Math.PI / 2), metal); cuerpo.position.set(0.1, -0.08, 0);
  const vaso = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 10).rotateZ(Math.PI / 2), negro); vaso.position.set(0.27, -0.08, 0);
  const asa = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.04), negro); asa.position.set(0, -0.04, 0);
  const asa2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.2), negro); asa2.position.set(0.08, -0.02, 0);
  const mang = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 6), negro); mang.position.set(-0.15, -0.4, 0); mang.rotation.z = 0.5;
  pist.add(cuerpo, vaso, asa, asa2, mang);
  // gato delantero: barra larga con ruedecitas y cabezal bajo el morro
  const gatoD = new THREE.Group();
  const barra = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.06), metal); barra.position.set(0.95, 0.12, 0); gatoD.add(barra);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.5), negro); cab.position.set(0, 0.12, 0); gatoD.add(cab);
  const mango = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), negro); mango.position.set(1.9, 0.12, 0); gatoD.add(mango);
  for (const z of [-0.2, 0.2]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10).rotateX(Math.PI / 2), goma); r.position.set(0.25, 0.06, z); gatoD.add(r); }
  // pórtico con el semáforo de salida
  const portico = new THREE.Group();
  for (const z of [-1.5, 1.5]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.1, 0.1), negro); p.position.set(0, 1.55, z); portico.add(p); }
  const trav = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 3.1), negro); trav.position.set(0, 3.1, 0); portico.add(trav);
  const caja = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.9), negro); caja.position.set(0, 2.8, 0); portico.add(caja);
  EQ = { metal, negro, goma, llanta, neum, rin, manta, tapaManta, pist: fundir(pist), gatoD: fundir(gatoD), portico: fundir(portico) };
  return EQ;
}

// Neumático completo (goma + llanta), opcionalmente con su manta calentadora
function ruedaSuelta(color, compuesto, conManta) {
  const e = equipamiento(), g = new THREE.Group();
  g.add(new THREE.Mesh(e.neum, e.goma), new THREE.Mesh(e.rin, e.llanta));
  if (conManta) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const x = cv.getContext('2d');
    x.fillStyle = '#1d1f24'; x.fillRect(0, 0, 256, 64);
    x.fillStyle = color; x.fillRect(0, 0, 256, 18); x.fillRect(0, 46, 256, 18);
    x.fillStyle = COMPUESTOS[compuesto]?.color || '#ffd23f'; x.fillRect(0, 26, 256, 12);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1);
    const m = new THREE.Mesh(e.manta, new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide }));
    m.name = 'manta';
    for (const z of [-0.18, 0.18]) { const tapa = new THREE.Mesh(e.tapaManta, new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.9 })); tapa.position.z = z; tapa.rotation.y = z > 0 ? 0 : Math.PI; tapa.name = 'manta'; g.add(tapa); }
    g.add(m);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

class Parada {
  /** car: estado del coche; posicion: {x, y, z, psi} del sitio de parada (el coche aún no ha llegado). */
  constructor(scene, { color, texto, compuesto, calidad, posicion, alEvento }) {
    this.scene = scene; this.alEvento = alEvento;
    this.color = color; this.compuesto = compuesto || 'medio';
    this.estado = 'espera'; this.t = 0; this.tFin = 0;
    this.grupo = new THREE.Group();
    this.equipo = [];
    const e = equipamiento();
    const persona = (rol, x, z, rotY, pose, num) => {
      const p = new Persona({ color, texto, numero: num, rol: 'mecanico', calidad, alto: 0.95 + Math.random() * 0.1 });
      p.raiz.position.set(x, 0, z); p.raiz.rotation.y = rotY; p.base = new THREE.Vector3(x, 0, z); p.rotBase = rotY;
      p.poner(pose, 0.01); p.rolParada = rol; p.t = Math.random() * 5; p.posePuesto = pose;
      // salen del garaje (lado +z) andando hasta su puesto
      p.raiz.position.set(x + (Math.random() - 0.5) * 1.5, 0, 5.5 + Math.random() * 1.5);
      p.raiz.rotation.y = Math.PI / 2; p.andar = 2; p.poner('de_pie', 0.01); p.llego = false;
      this.grupo.add(p.raiz); this.equipo.push(p);
      return p;
    };
    // por rueda: pistolero arrodillado, el que quita y el que pone (lleva la nueva con su manta)
    this.ruedas = RUEDAS.map(([x, lado, via], k) => {
      const mira = lado > 0 ? Math.PI / 2 : -Math.PI / 2;     // de cara al coche
      const pis = persona('pistola', x, lado * (via + 0.62), mira, 'preparado', 10 + k);
      const pistola = e.pist.clone(); pistola.position.set(0.02, -0.1, 0); pistola.rotation.z = -1.2; pis.mD.add(pistola);
      const quita = persona('quita', x - 0.62, lado * (via + 0.95), mira + lado * 0.35, 'preparado', 20 + k);
      const pone = persona('pone', x + 0.62, lado * (via + 0.95), mira - lado * 0.35, 'rueda', 30 + k);
      const nueva = ruedaSuelta(color, this.compuesto, true);
      this.grupo.add(nueva);
      const vieja = ruedaSuelta(color, this.compuesto, false); vieja.visible = false; this.grupo.add(vieja);
      return { x, lado, via, pis, quita, pone, nueva, vieja, puesta: false };
    });
    // gatos
    this.gD = persona('gatoD', A + 2.95, 0, Math.PI, 'preparado', 1);
    this.gT = persona('gatoT', -B - 1.75, 0, 0, 'preparado', 2);
    this.gatoD = e.gatoD.clone(); this.gatoD.position.set(A + 1.0, 0, 0); this.grupo.add(this.gatoD);
    this.gatoT = e.gatoD.clone(); this.gatoT.scale.set(-0.6, 1, 1); this.gatoT.position.set(-B - 0.6, 0, 0); this.grupo.add(this.gatoT);
    // estabilizadores y alerón delantero
    // (en calidad baja se omiten para no cargar el móvil)
    this.estab = calidad >= 1 ? [-1, 1].map(l => persona('estab', 0.2, l * 1.15, l > 0 ? Math.PI / 2 : -Math.PI / 2, 'espera', 40 + l)) : [];
    this.alero = calidad >= 1 ? [-1, 1].map(l => persona('alero', A + 1.25, l * 1.25, l > 0 ? Math.PI / 2 + 0.6 : -Math.PI / 2 - 0.6, 'espera', 50 + l)) : [];
    // jefe de parada, junto al pórtico, que hace señas al coche para que entre
    this.jefe = persona('jefe', A + 3.4, 1.9, Math.PI + 0.5, 'senala', 3);
    this.portico = e.portico.clone(); this.portico.position.set(A + 1.6, 0, 0); this.grupo.add(this.portico);
    this.luz = new THREE.Mesh(new THREE.CircleGeometry(0.17, 16), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 4 }));
    this.luz.position.set(A + 1.48, 2.8, 0); this.luz.rotation.y = -Math.PI / 2; this.grupo.add(this.luz);
    this._colocarNuevas(0);
    this.grupo.traverse(o => { if (o.isMesh) o.castShadow = calidad >= 1; });
    this.ponerEn(posicion);
    scene.add(this.grupo);
  }

  ponerEn(p) { this.grupo.position.set(p.x, p.y, p.z); this.grupo.rotation.y = -p.psi; }

  // las ruedas nuevas en brazos del que las pone (u = 0) o ya montadas (u = 1)
  _colocarNuevas(u, elevar = 0) {
    for (const r of this.ruedas) {
      const brazos = new THREE.Vector3(r.x + 0.5, 0.62, r.lado * (r.via + 0.62));
      const montada = new THREE.Vector3(r.x, 0.36 + elevar, r.lado * (r.via + 0.12));
      r.nueva.position.lerpVectors(brazos, montada, suave(u));
      r.nueva.traverse(o => { if (o.name === 'manta') o.visible = u < 0.15; });
    }
  }

  /** El coche ha llegado: empieza el trabajo (duración en s, morro: cambiar el alerón). */
  empezar(car, modelo, duracion, morro) {
    this.car = car; this.modelo = modelo; this.D = duracion; this.morro = morro;
    this.estado = 'trabajo'; this.t = 0;
    this._llegar(0, true);
    this.ponerEn({ x: car.x, y: car.y, z: car.z, psi: car.psi });
    this.jefe.poner('espera', 0.3);
    for (const r of this.ruedas) { r.pis.poner('pistola', 0.12); r.quita.poner('preparado', 0.1); }
    for (const p of this.estab) p.poner('estabiliza', 0.2);
    for (const p of this.alero) p.poner('preparado', 0.2);
    this.alEvento?.('gato', this.grupo.position);
  }

  /** Progreso de cada rueda (para el marcador de la parada): 0 sin empezar, 1 montada. */
  progreso() { return this.ruedas.map(r => r.prog || 0); }

  actualizar(dt) {
    this.t += dt;
    const e = this.equipo;
    for (const p of e) p.actualizar(dt);
    this._llegar(dt);
    if (this.estado === 'espera') {
      // el jefe hace señas con el brazo para que el coche venga a su sitio
      if (this.jefe.llego) this.jefe.extra.hD = [0, 0, Math.sin(this.t * 6) * 0.35];
      return true;
    }
    if (this.estado === 'trabajo') return this._trabajo(dt);
    // terminado: el equipo recoge y vuelve al garaje andando
    this.tFin += dt;
    // reacción a la parada: rápida (< 2,6 s) se celebra con saltos; lenta (> 4 s), manos a la cabeza
    const rapida = this.D < 2.6, lenta = this.D > 4 && !this.morro;
    const tReac = rapida || lenta ? 1.6 : 0;
    for (const p of e) {
      if ((rapida || lenta) && this.tFin < tReac && !p.reacciona) {
        p.reacciona = true; p.andar = 0;
        p.poner(rapida ? 'celebra' : 'lamento', 0.25 + Math.random() * 0.15);
        if (rapida) p.salto = 0.6 + Math.random() * 0.5;
      }
      if (this.tFin >= tReac && p.reacciona && !p.vuelve) { p.salto = 0; }
      if (this.tFin < tReac) continue;
      if (this.tFin > tReac + 0.25 + (p.base.x + 4) * 0.04 && !p.vuelve) { p.vuelve = true; p.poner(p.rolParada === 'pone' || p.rolParada === 'quita' ? 'ruedaAlta' : 'de_pie', 0.3); p.andar = 1.6; p.raiz.rotation.y = 0; }
      if (p.vuelve) { p.raiz.position.z += dt * 1.6; p.raiz.rotation.y = -Math.PI / 2; }
    }
    if (this.tFin > 5 + (this.D < 2.6 || this.D > 4 ? 1.6 : 0)) { this.scene.remove(this.grupo); return false; }
    return true;
  }

  // camino del garaje a cada puesto (si el coche llega antes, se colocan de golpe)
  _llegar(dt, ya = false) {
    for (const p of this.equipo) {
      if (p.llego) continue;
      const d = new THREE.Vector3().subVectors(p.base, p.raiz.position); d.y = 0;
      const L = d.length(), paso = dt * 2.6;
      if (ya || L <= paso) {
        p.raiz.position.copy(p.base); p.raiz.rotation.y = p.rotBase; p.andar = 0; p.llego = true;
        p.poner(p.posePuesto, 0.25);
      } else {
        p.raiz.position.addScaledVector(d, paso / L);
        p.raiz.rotation.y = Math.atan2(-d.z, d.x);
      }
    }
  }

  _trabajo(dt) {
    const t = this.t, D = this.D, md = this.modelo;
    // tiempos de una parada de ~2,2 s; si la parada es más lenta (o hay morro) se estiran
    const k = Math.max(1, (D - 0.35) / 1.85);
    const T = (x) => x * k;
    // gatos: suben al principio y bajan al final
    const sube = suave(entre(t, 0, 0.28)), baja = 1 - suave(entre(t, D - 0.32, D - 0.08));
    const elev = 0.07 * sube * baja;
    if (md) md.elevar = elev;
    this.gD.poner(t < D - 0.3 ? 'gato' : 'preparado', 0.1); this.gT.poner(t < D - 0.3 ? 'gato' : 'preparado', 0.1);
    this.gatoD.rotation.z = -0.12 * sube * baja; this.gatoT.rotation.z = 0.12 * sube * baja;
    if (t < 0.05 && !this._sonoGato) { this._sonoGato = true; this.alEvento?.('gato', this.grupo.position); }
    for (const r of this.ruedas) {
      // pistola: afloja, se aparta mientras cambian la rueda, aprieta y levanta el brazo
      const afloja = t > T(0.1) && t < T(0.42), aprieta = t > T(1.05) && t < T(1.45);
      r.pis.extra.hD = (afloja || aprieta) ? [0, 0, Math.sin(t * 90) * 0.04] : [0, 0, 0];
      if ((afloja && !r.s1) || (aprieta && !r.s2)) { if (afloja) r.s1 = true; else r.s2 = true; this.alEvento?.('pistola', this.grupo.position); }
      if (t > T(1.48)) r.pis.extra.hI = [0, 0, 1.9];      // ¡rueda lista! (brazo arriba)
      // la vieja sale con el que la quita
      const fuera = entre(t, T(0.42), T(0.78));
      r.vieja.visible = fuera > 0;
      if (fuera > 0) {
        r.quita.poner('rueda', 0.08);
        const ini = new THREE.Vector3(r.x, 0.36 + elev, r.lado * (r.via + 0.12)), fin = new THREE.Vector3(r.x - 0.75, 0.6, r.lado * (r.via + 1.25));
        r.vieja.position.lerpVectors(ini, fin, suave(fuera));
        r.quita.raiz.position.copy(r.quita.base).add(new THREE.Vector3(-0.2 * fuera, 0, r.lado * 0.25 * fuera));
      }
      if (md) md.ruedaOculta[RUEDAS.indexOf(RUEDAS.find(q => q[0] === r.x && q[1] === r.lado))] = t > T(0.42) && t < T(1.02);
      // la nueva entra
      const dentro = entre(t, T(0.62), T(1.02));
      if (dentro > 0) { r.pone.poner('preparado', 0.12); this._colocarUna(r, dentro, elev); }
      r.prog = t > T(1.45) ? 1 : dentro * 0.8;
      if (dentro >= 1) r.nueva.visible = false;          // ya es la rueda del coche
    }
    // estabilizadores y alerón: si hay morro, cambian el alerón delantero entero
    if (this.morro) for (const p of this.alero) p.poner(t > 0.4 && t < D - 1.5 ? 'rueda' : 'preparado', 0.2);
    // semáforo: verde al bajar los gatos
    const verde = t > D - 0.12;
    this.luz.material.emissive.setHex(verde ? 0x20ff40 : 0xff1a1a);
    if (verde && !this._verde) { this._verde = true; for (const p of this.estab) p.poner('de_pie', 0.15); this.jefe.poner('senala', 0.15); }
    if (t >= D) {
      this.estado = 'fin';
      if (md) { md.elevar = 0; md.ruedaOculta = [false, false, false, false]; }
      for (const r of this.ruedas) r.nueva.visible = false;
    }
    return true;
  }

  _colocarUna(r, u, elevar) {
    const brazos = new THREE.Vector3(r.x + 0.5, 0.62, r.lado * (r.via + 0.62));
    const montada = new THREE.Vector3(r.x, 0.36 + elevar, r.lado * (r.via + 0.12));
    r.nueva.position.lerpVectors(brazos, montada, suave(u));
    r.nueva.traverse(o => { if (o.name === 'manta') o.visible = u < 0.12; });
  }

  quitar() { this.scene.remove(this.grupo); }
}

export class GestorBoxes {
  constructor(scene, calidad = 2, alEvento = null) { this.scene = scene; this.calidad = calidad; this.alEvento = alEvento; this.paradas = new Map(); }

  /** El coche ha entrado al carril: su equipo sale a esperarlo en el sitio de parada. */
  preparar(id, { color, texto, compuesto, posicion }) {
    if (this.paradas.has(id)) return;
    this.paradas.set(id, new Parada(this.scene, { color, texto, compuesto, calidad: this.calidad, posicion, alEvento: this.alEvento }));
  }

  /** El coche está parado: empieza la parada (si nadie lo esperaba, el equipo aparece ya). */
  empezar(id, car, modelo, { color, texto, compuesto, duracion, morro }) {
    if (!this.paradas.has(id)) this.preparar(id, { color, texto, compuesto, posicion: { x: car.x, y: car.y, z: car.z, psi: car.psi } });
    this.paradas.get(id).empezar(car, modelo, duracion, morro);
  }

  progreso(id) { return this.paradas.get(id)?.progreso() || null; }

  actualizar(dt, camPos = null) {
    for (const [id, p] of this.paradas) {
      if (!p.actualizar(dt)) this.paradas.delete(id);
      // lejos de la cámara no se dibujan (siguen animándose para no saltar al volver)
      else if (camPos) p.grupo.visible = p.grupo.position.distanceToSquared(camPos) < 160 * 160;
    }
  }

  limpiar() { for (const p of this.paradas.values()) p.quitar(); this.paradas.clear(); }
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

  /** Quita todos los restos (al reiniciar o al recibir un coche nuevo). */
  vaciar() { for (const p of this.lista) this.scene.remove(p.obj); this.lista.length = 0; }

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
