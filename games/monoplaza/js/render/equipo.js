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
  empezar(car, modelo, duracion, morro, trabajo = {}) {
    this.car = car; this.modelo = modelo; this.D = duracion; this.morro = morro;
    this.trabajo = trabajo || {}; this.extra = this.trabajo.extra || 0;
    this.estado = 'trabajo'; this.t = 0;
    // morro: copia del alerón dañado (sale en brazos) y otra intacta (entra), con el del coche oculto
    if (morro && modelo?.alaDel) {
      const a = modelo.alaDel;
      modelo.raiz.updateMatrixWorld(true); this.grupo.updateMatrixWorld(true);
      const pos = a.getWorldPosition(new THREE.Vector3()); this.grupo.worldToLocal(pos);
      this.alaVieja = a.clone(); this.alaVieja.position.copy(pos); this.hayVieja = a.visible; this.alaVieja.visible = a.visible;   // si se desprendió, no hay nada que quitar
      this.alaNueva = a.clone(); this.alaNueva.rotation.set(0, 0, 0); this.alaNueva.visible = true;
      this.alaMontada = pos.clone(); this.alaMontada.y += (0.2 - a.position.y);      // altura sin daño
      this.alaNueva.position.set(A + 1.6, 0.85, 3.2);
      this.grupo.add(this.alaVieja, this.alaNueva);
      this._alaCoche = a;
    }
    // botella de agua para el piloto (blanca con pajita) y briznas en la toma del pontón
    if (this.trabajo.bebida && this.estab.length > 1) {
      const e = equipamiento();
      const b = new THREE.Group();
      b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.4 })));
      const paj = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.18, 5), e.negro); paj.position.set(0.05, 0.14, 0); paj.rotation.z = -0.6; b.add(paj);
      b.visible = false; this.grupo.add(b); this.botella = b;
    }
    if (this.trabajo.limpiar && this.estab.length) {
      const brizna = new THREE.MeshStandardMaterial({ color: 0x5f8a3a, roughness: 0.9, side: THREE.DoubleSide });
      const pasto = new THREE.Group();
      for (let k = 0; k < 9; k++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.02), brizna); p.position.set(Math.random() * 0.1, Math.random() * 0.12, (Math.random() - 0.5) * 0.1); p.rotation.set(Math.random() * 3, Math.random() * 3, 0); pasto.add(p); }
      pasto.position.set(0.82, 0.42, 0.62); this.grupo.add(pasto); this.pasto = pasto;
    }
    // suspensión: una pieza de recambio (brazo de carbono) por cada esquina rota
    if (this.trabajo.susp) {
      const e = equipamiento();
      this.brazos = this.trabajo.susp.map((rota, k) => {
        if (!rota) return null;
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.05), e.negro);
        const r = this.ruedas[k]; b.position.set(r.x + 0.4, 0.62, r.lado * (r.via + 0.62)); b.visible = false;
        this.grupo.add(b); return b;
      });
    }
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
    const Dn = this.D - (this.extra || 0), rapida = Dn < 2.6, lenta = Dn > 4;
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
    // al bajar de los gatos el coche rebota sobre los neumáticos
    if (this.modelo && this.tFin < 0.6) this.modelo.elevar = -0.018 * Math.exp(-this.tFin * 7) * Math.sin(this.tFin * 32);
    else if (this.modelo && this.modelo.elevar && this.tFin < 0.7) this.modelo.elevar = 0;
    if (this.tFin > 5 + (rapida || lenta ? 1.6 : 0)) { this.scene.remove(this.grupo); return false; }
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
    const t = this.t, D = this.D, md = this.modelo, tr = this.trabajo || {};
    // tiempos de una parada de ~2,2 s; las ruedas van a su ritmo aunque haya morro o suspensión
    // (el trabajo extra se hace con el coche en los gatos y las ruedas se montan al final)
    const k = Math.max(1, (D - this.extra - 0.35) / 1.85);
    const T = (x) => x * k;
    const tm = tr.susp ? D - 0.9 * k - 0.15 : T(0.62);       // empiezan a montar las nuevas
    // gatos: suben al principio y bajan al final
    const sube = suave(entre(t, 0, 0.28)), baja = 1 - suave(entre(t, D - 0.32, D - 0.08));
    const elev = 0.07 * sube * baja;
    if (md) md.elevar = elev;
    this.gD.poner(t < D - 0.3 ? 'gato' : 'preparado', 0.1); this.gT.poner(t < D - 0.3 ? 'gato' : 'preparado', 0.1);
    this.gatoD.rotation.z = -0.12 * sube * baja; this.gatoT.rotation.z = 0.12 * sube * baja;
    if (t < 0.05 && !this._sonoGato) { this._sonoGato = true; this.alEvento?.('gato', this.grupo.position); }
    this.ruedas.forEach((r, i) => {
      // pistola: afloja, se aparta mientras cambian la rueda, aprieta y levanta el brazo
      const afloja = t > T(0.1) && t < T(0.42), aprieta = t > tm + 0.43 * k && t < tm + 0.83 * k;
      r.pis.extra.hD = (afloja || aprieta) ? [0, 0, Math.sin(t * 90) * 0.04] : [0, 0, 0];
      r.pis.extra.tronco = (afloja || aprieta) ? [0, 0, Math.sin(t * 70) * 0.02] : [0, 0, 0];
      if ((afloja && !r.s1) || (aprieta && !r.s2)) { if (afloja) r.s1 = true; else r.s2 = true; this.alEvento?.('pistola', this.grupo.position); }
      r.pis.extra.hI = t > tm + 0.86 * k ? [0, 0, 1.9] : [0, 0, 0];      // ¡rueda lista! (brazo arriba)
      // la vieja sale en arco con el que la quita y se deja en el suelo, tumbada
      const fuera = entre(t, T(0.42), T(0.78));
      r.vieja.visible = fuera > 0;
      if (fuera > 0) {
        r.quita.poner(fuera < 1 ? 'rueda' : 'preparado', 0.08);
        const ini = new THREE.Vector3(r.x, 0.36 + elev, r.lado * (r.via + 0.12)), fin = new THREE.Vector3(r.x - 0.75, 0.36, r.lado * (r.via + 1.35));
        const u = suave(fuera);
        r.vieja.position.lerpVectors(ini, fin, u); r.vieja.position.y += Math.sin(Math.PI * u) * 0.28;
        r.vieja.rotation.set(0, r.lado * 0.5 * u, r.lado * 0.15 * Math.sin(Math.PI * u));
        if (fuera >= 1) { r.vieja.position.y = 0.17; r.vieja.rotation.set(Math.PI / 2, 0, 0); }   // en el suelo
        r.quita.raiz.position.copy(r.quita.base).add(new THREE.Vector3(-0.2 * fuera, 0, r.lado * 0.25 * fuera));
      }
      if (md) md.ruedaOculta[i] = t > T(0.42) && t < tm + 0.4 * k;
      // suspensión: el que quitó la rueda trae el brazo nuevo, se arrodilla en el buje y lo atornilla
      const brazo = this.brazos?.[i];
      if (brazo) {
        const llega = entre(t, T(0.8), T(0.8) + 0.9), monta = entre(t, T(0.8) + 0.9, tm - 0.3);
        brazo.visible = llega > 0 && monta < 1;
        if (llega > 0 && llega < 1) { r.quita.poner('rueda', 0.15); brazo.position.set(r.x - 0.5 + 0.5 * llega, 0.62, r.lado * (r.via + 1.1 - 0.5 * llega)); }
        if (monta > 0 && monta < 1) {
          r.quita.poner('pistola', 0.2);
          r.quita.raiz.position.set(r.x - 0.1, 0, r.lado * (r.via + 0.55)); r.quita.raiz.rotation.y = r.lado > 0 ? Math.PI / 2 : -Math.PI / 2;
          r.quita.extra.hD = [0, 0, Math.sin(t * 9) * 0.25];           // llave dinamométrica
          r.quita.extra.hI = [0, 0, Math.sin(t * 7 + 1) * 0.12];
          brazo.position.set(r.x, 0.3 + elev, r.lado * (r.via * 0.62)); brazo.rotation.set(0, Math.PI / 2, r.lado * 0.12);
        }
        if (monta >= 1 && !r.finSusp) { r.finSusp = true; r.quita.extra.hD = [0, 0, 0]; r.quita.extra.hI = [0, 0, 0]; r.quita.poner('preparado', 0.2); }
      }
      // la nueva entra (también en un pequeño arco, el mecánico la empuja hasta el buje)
      const dentro = entre(t, tm, tm + 0.4 * k);
      if (dentro > 0) { r.pone.poner('preparado', 0.12); this._colocarUna(r, dentro, elev); }
      r.prog = t > tm + 0.83 * k ? 1 : dentro * 0.8;
      if (dentro >= 1) r.nueva.visible = false;          // ya es la rueda del coche
    });
    // morro: dos mecánicos lo desatornillan, se lo llevan y traen el nuevo
    if (this.alaVieja) {
      const fin = D - 1.4;
      const suelta = entre(t, 0.4, 1.5), sale = entre(t, 1.5, 2.6), entra = entre(t, 2.8, fin - 1.0), aprieta = t > fin - 1.0 && t < fin;
      if (this._alaCoche) this._alaCoche.visible = false;
      if (md) md.ocultarAla = t < fin;
      const v = this.alaVieja, n = this.alaNueva, m = this.alaMontada;
      if (sale > 0) { const u = suave(sale); v.position.set(m.x + 0.4 + u * 1.2, m.y + Math.sin(Math.PI * Math.min(1, u * 1.4)) * 0.6 + u * 0.3, m.z + u * 3.2); v.visible = this.hayVieja && sale < 1; }
      if (entra > 0) { const u = suave(entra); n.position.set(m.x + 1.6 * (1 - u), m.y + 0.65 * (1 - u) + Math.sin(Math.PI * u) * 0.2, m.z + 3.2 * (1 - u)); }
      if (t >= fin) { n.visible = false; if (this._alaCoche) this._alaCoche.visible = true; if (md) md.ocultarAla = false; }
      this.alero.forEach((p, j) => {
        const lado = j ? 1 : -1;
        const pieza = sale > 0 && sale < 1 ? v : entra > 0 && entra < 1 ? n : null;
        if (pieza) { p.poner('rueda', 0.15); p.raiz.position.set(pieza.position.x + 0.1, 0, pieza.position.z + lado * 0.85); p.raiz.rotation.y = lado > 0 ? Math.PI / 2 : -Math.PI / 2; }
        else if ((suelta > 0 && suelta < 1) || aprieta) { p.poner('pistola', 0.2); p.raiz.position.copy(p.base); p.raiz.rotation.y = p.rotBase; p.extra.hD = [0, 0, Math.sin(t * 40 + j) * 0.08]; }
        else { p.poner('preparado', 0.2); p.extra.hD = [0, 0, 0]; }
      });
    } else if (tr.alaDel) {
      // ajuste del flap: arrodillados en cada extremo del alerón, giran la llave unas vueltas
      const ajusta = t > 0.35 && t < Math.min(D - 0.4, 0.35 + 1.4 * k);
      for (const [j, p] of this.alero.entries()) {
        p.poner(ajusta ? 'pistola' : 'preparado', 0.18);
        p.extra.hD = ajusta ? [0, 0, Math.sin(t * 14 + j) * 0.3] : [0, 0, 0];
      }
    }
    // limpieza de la toma del pontón derecho: mete la mano y saca las briznas, que caen al suelo
    if (this.pasto) {
      const p = this.estab[this.estab.length - 1], lim = entre(t, 0.25, Math.min(D - 0.5, 1.6));
      if (lim > 0 && lim < 1) { p.poner('estabiliza', 0.15); p.extra.hD = [0, 0, Math.sin(t * 18) * 0.35]; p.extra.hI = [0, 0, Math.sin(t * 15 + 1) * 0.2]; }
      else if (lim >= 1) { p.extra.hD = [0, 0, 0]; p.extra.hI = [0, 0, 0]; }
      if (lim > 0.5) { this.pasto.position.y = Math.max(0.01, 0.42 - (lim - 0.5) * 1.6); this.pasto.position.z = 0.62 + (lim - 0.5) * 0.9; }
    }
    // agua para el piloto: se acerca por la izquierda, le acerca la botella al casco y se la retira
    if (this.botella) {
      const p = this.estab[0], u = entre(t, 0.3, Math.max(0.9, D - 0.5));
      this.botella.visible = u > 0 && u < 1;
      if (u > 0 && u < 1) {
        const ida = Math.min(1, u * 3), vuelta = Math.max(0, (u - 0.75) * 4), k = suave(ida) * (1 - suave(vuelta));
        p.poner('de_pie', 0.15); p.extra.hD = [0, 0, 1.3 * k];
        this.botella.position.set(0.12 + 0.1 * k, 0.75 + 0.2 * k, -(1.05 - 0.75 * k));
        this.botella.rotation.x = 0.9 * k;
      } else if (u >= 1) p.extra.hD = [0, 0, 0];
    }
    // semáforo: verde al bajar los gatos
    const verde = t > D - 0.12;
    this.luz.material.emissive.setHex(verde ? 0x20ff40 : 0xff1a1a);
    if (verde && !this._verde) { this._verde = true; for (const p of this.estab) p.poner('de_pie', 0.15); this.jefe.poner('senala', 0.15); }
    // el jefe mira el trabajo y, al final, da la salida con el brazo
    this.jefe.extra.hD = verde ? [0, 0, -0.3 + Math.min(1, (t - D + 0.12) * 6) * 0.3] : [0, 0, 0];
    if (t >= D) {
      this.estado = 'fin';
      if (md) { md.elevar = 0; md.ruedaOculta = [false, false, false, false]; md.ocultarAla = false; }
      if (this._alaCoche) this._alaCoche.visible = true;
      for (const r of this.ruedas) r.nueva.visible = false;
    }
    return true;
  }

  _colocarUna(r, u, elevar) {
    const brazos = new THREE.Vector3(r.x + 0.5, 0.62, r.lado * (r.via + 0.62));
    const montada = new THREE.Vector3(r.x, 0.36 + elevar, r.lado * (r.via + 0.12));
    const w = suave(u);
    r.nueva.position.lerpVectors(brazos, montada, w); r.nueva.position.y += Math.sin(Math.PI * w) * 0.06;
    r.nueva.rotation.set(0, r.lado * 0.25 * (1 - w), 0);
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
  empezar(id, car, modelo, { color, texto, compuesto, duracion, morro, trabajo }) {
    if (!this.paradas.has(id)) this.preparar(id, { color, texto, compuesto, posicion: { x: car.x, y: car.y, z: car.z, psi: car.psi } });
    this.paradas.get(id).empezar(car, modelo, duracion, morro, trabajo);
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
  /** En la repetición: los restos solo se ven desde el momento en que se rompieron. */
  verHasta(t) { for (const e of this.lista) e.obj.visible = !(e.t > t); }

  lanzar(origen, vel, extra = {}) {
    origen.updateMatrixWorld(true);
    const obj = origen.clone(true);
    obj.visible = true;
    origen.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
    this.scene.add(obj);
    const r = Math.random;
    this.lista.push({
      obj, v: new THREE.Vector3(vel.x + (r() - 0.5) * 6, 3 + r() * 6 + (extra.alto || 0), vel.z + (r() - 0.5) * 6),
      w: new THREE.Vector3((r() - 0.5) * 18, (r() - 0.5) * 10, (r() - 0.5) * 18), radio: extra.radio || 0.2, vida: 40, t: this.reloj ?? 0,
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
      this.lista.push({ obj: m, v: new THREE.Vector3(vel.x * 0.6 + (Math.random() - 0.5) * 10, 2 + Math.random() * 5, vel.z * 0.6 + (Math.random() - 0.5) * 10), w: new THREE.Vector3(Math.random() * 20, Math.random() * 20, 0), radio: 0.03, vida: 20, t: this.reloj ?? 0 });
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
