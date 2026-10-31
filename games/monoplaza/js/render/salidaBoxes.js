// Salida desde el garaje (práctica y clasificación), como en la tele: el piloto llega andando
// y se mete en el coche, un mecánico le ajusta los cinturones y le pone el volante, el del
// gato trasero baja el coche y el del cartel («piruleta») le da la salida. Todo en el sistema
// de coordenadas del coche (x hacia delante, z hacia la derecha del piloto).

import * as THREE from 'three';
import { Persona } from './personas.js';

const entre = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const suave = (t) => t * t * (3 - 2 * t);
export const DURACION_SALIDA = 9.2;

function texturaCartel(txt, fondo, letra) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160;
  const x = cv.getContext('2d');
  x.fillStyle = fondo; x.fillRect(0, 0, 256, 160);
  x.strokeStyle = '#111'; x.lineWidth = 10; x.strokeRect(5, 5, 246, 150);
  x.fillStyle = letra; x.font = '900 46px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const l = txt.split('\n'); l.forEach((s, i) => x.fillText(s, 128, 80 + (i - (l.length - 1) / 2) * 50));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class SalidaBoxes {
  constructor(scene, modelo, equipo, calidad = 1) {
    this.scene = scene; this.m = modelo; this.t = 0; this.hecho = false;
    const texto = equipo?.corto === 'UPG' ? 'UPGAMES' : (equipo?.nombre || 'UPGAMES').split(' ')[0].toUpperCase();
    const color = equipo?.base || '#0d47ff';
    this.grupo = new THREE.Group();
    modelo.raiz.add(this.grupo);          // se mueve con el coche (y en su sistema de coordenadas)
    const persona = (rol, numero) => { const p = new Persona({ color, texto, numero, rol, calidad }); this.grupo.add(p.raiz); return p; };
    // el piloto, con su casco, entra por la izquierda
    this.piloto = persona('piloto', 1);
    if (modelo.piloto?.casco) { const c = modelo.piloto.casco.clone(); c.position.set(0.035, 0.06, 0); c.scale.setScalar(1.08); this.piloto.cabeza.add(c); }
    this.piloto.raiz.rotation.y = -Math.PI / 2;
    // mecánico de los cinturones y el volante (lleva el volante en la mano derecha)
    this.mec = persona('mecanico', 21);
    this.mec.raiz.position.set(0.72, 0, -0.98); this.mec.raiz.rotation.y = -Math.PI / 2 + 0.5;
    this.volanteMano = modelo.volanteG ? modelo.volanteG.clone() : null;
    if (this.volanteMano) { this.volanteMano.rotation.set(0, 0, 0); this.volanteMano.position.set(0.05, -0.1, 0.12); this.mec.manoDerecha().add(this.volanteMano); }
    // el del cartel, delante del morro, mirando al coche
    this.paleta = persona('mecanico', 1);
    this.paleta.raiz.position.set(3.3, 0, 0.1); this.paleta.raiz.rotation.y = Math.PI;
    const cartel = new THREE.Group();
    const asta = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0xb8bec6, metalness: 0.8, roughness: 0.35 }));
    asta.position.y = 0.55; cartel.add(asta);
    this.texFreno = texturaCartel('FRENOS\n1.ª MARCHA', '#e8202a', '#ffffff');
    this.texSal = texturaCartel('¡VAMOS!', '#2fe07a', '#06210f');
    this.matCartel = new THREE.MeshStandardMaterial({ map: this.texFreno, side: THREE.DoubleSide, roughness: 0.6 });
    const placa = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), this.matCartel); placa.position.y = 1.2; placa.rotation.y = Math.PI / 2; cartel.add(placa);
    cartel.position.set(0.32, 0.55, 0); this.paleta.raiz.add(cartel); this.cartel = cartel;
    // el del gato trasero, con la barra bajo la caja de cambios
    this.gatoM = persona('mecanico', 2);
    this.gatoM.raiz.position.set(-3.55, 0, 0); this.gatoM.raiz.rotation.y = 0;
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.85, roughness: 0.3 });
    const gato = new THREE.Group();
    const barra = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.05), metal); barra.position.set(0.575, 0.12, 0); gato.add(barra);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.42), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 })); cab.position.set(1.15, 0.12, 0); gato.add(cab);
    gato.position.set(-3.3, 0, 0); this.grupo.add(gato); this.gato = gato;
    for (const p of [this.mec, this.paleta, this.gatoM]) p.poner('preparado', 0.01);
    this.gatoM.poner('gato', 0.01);
    this.grupo.traverse(o => { if (o.isMesh) o.castShadow = calidad >= 1; });
    // estado inicial del coche: sin piloto, sin volante y con la trasera en el gato
    if (modelo.piloto?.grupo) modelo.piloto.grupo.visible = false;
    if (modelo.volanteG) modelo.volanteG.visible = false;
    modelo.elevar = 0.055;
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
  }

  /** Devuelve true mientras dura. cam: cámara a la que dar el plano de cada momento. */
  actualizar(dt, cam) {
    if (this.hecho) return false;
    this.t += dt;
    const t = this.t, m = this.m;
    // 1) el piloto llega andando por la izquierda y trepa al habitáculo
    const anda = entre(t, 0, 1.4), trepa = entre(t, 1.4, 2.6), baja = entre(t, 2.6, 3.3);
    const pi = this.piloto;
    if (t < 3.3) {
      if (anda < 1) { pi.poner('de_pie', 0.2); pi.andar = 1.3; pi.raiz.position.set(-1.3 + 1.45 * anda, 0, -2.2 + 1.4 * anda); }
      else if (trepa < 1) { pi.andar = 0; pi.poner('trepa', 0.25); pi.raiz.position.set(0.15, 0.55 * suave(trepa), -0.8 + 0.45 * suave(trepa)); }
      else { pi.poner('sentado', 0.2); pi.raiz.position.set(0.12 - 0.1 * baja, 0.55 - 0.25 * baja, -0.35 + 0.35 * suave(baja)); pi.raiz.rotation.y = -Math.PI / 2 + (Math.PI / 2) * suave(baja); }
      pi.actualizar(dt);
    } else if (pi.raiz.visible) {
      pi.raiz.visible = false;
      if (m.piloto?.grupo) m.piloto.grupo.visible = true;
    }
    // 2) cinturones: el mecánico se inclina sobre la cabina; luego coloca el volante
    const cint = entre(t, 3.3, 5.6), pone = entre(t, 5.6, 6.3);
    if (cint > 0 && cint < 1) {
      this.mec.poner('apoya', 0.25);
      this.mec.extra.hD = [0, 0, Math.sin(t * 11) * 0.25]; this.mec.extra.hI = [0, 0, Math.sin(t * 9 + 1) * 0.2];
    } else if (pone > 0 && pone < 1 && this.volanteMano) {
      this.mec.extra.hD = [0, 0, 0.6 * suave(pone)]; this.mec.extra.hI = [0, 0, 0];
      // el volante va de su mano a la columna
      if (!this._volLibre) {
        this._volLibre = true;
        this.volanteMano.getWorldPosition(this._v);
        this.mec.manoDerecha().remove(this.volanteMano); this.grupo.add(this.volanteMano);
        this.grupo.worldToLocal(this._v); this.volanteMano.position.copy(this._v);
        this._volIni = this._v.clone();
      }
      m.volanteG.getWorldPosition(this._w); this.grupo.worldToLocal(this._w);
      this.volanteMano.position.lerpVectors(this._volIni, this._w, suave(pone));
      this.volanteMano.rotation.set(0, 0, -0.32 * suave(pone));
    } else if (pone >= 1 && this.volanteMano?.visible) {
      this.volanteMano.visible = false; if (m.volanteG) m.volanteG.visible = true;
      this.mec.poner('de_pie', 0.3); this.mec.extra.hD = [0, 0, 0];
    }
    if (t > 6.6) { this.mec.andar = 1; this.mec.raiz.position.z -= dt * 1.0; this.mec.raiz.rotation.y = Math.PI; }
    this.mec.actualizar(dt);
    // 3) gato trasero: baja el coche (rebota en los neumáticos) y el mecánico se lo lleva
    const bajaGato = entre(t, 6.6, 7.0);
    if (t < 6.6) m.elevar = 0.055;
    else if (t < 7.6) m.elevar = 0.055 * (1 - suave(bajaGato)) - (bajaGato >= 1 ? 0.012 * Math.exp(-(t - 7) * 8) * Math.sin((t - 7) * 30) : 0);
    else m.elevar = 0;
    if (t > 6.9) { this.gatoM.poner('de_pie', 0.3); const a = Math.min(1, (t - 6.9) * 1.4); this.gatoM.raiz.position.x = -3.55 - a * 1.4; this.gato.position.x = -3.3 - a * 1.4; this.gatoM.andar = a < 1 ? 1.2 : 0; }
    this.gato.rotation.z = t < 6.6 ? 0.1 : 0.1 * (1 - bajaGato);
    this.gatoM.actualizar(dt);
    // 4) el del cartel: lo baja delante del morro («frenos, primera») y lo levanta para salir
    const sube = entre(t, 7.9, 8.3);
    this.cartel.rotation.z = -0.15 + 1.5 * suave(sube);
    if (sube > 0.5 && this.matCartel.map !== this.texSal) { this.matCartel.map = this.texSal; this.matCartel.needsUpdate = true; }
    this.paleta.poner(sube > 0 ? 'senala' : 'preparado', 0.2);
    this.paleta.actualizar(dt);
    // cámara: primero desde fuera (el piloto entrando) y luego la vista del piloto
    if (cam) {
      m.raiz.updateMatrixWorld(true);
      cam.up.set(0, 1, 0);
      if (t < 6.7) {
        // plano de tres cuartos desde delante a la izquierda: se ve entrar al piloto, al mecánico
        // con el volante y al del cartel; se acerca despacio
        const k = suave(entre(t, 0, 6.7));
        cam.position.set(2.7 - 0.6 * k, 1.55 - 0.15 * k, -2.5 + 0.5 * k).applyMatrix4(m.raiz.matrixWorld);
        cam.lookAt(this._v.set(0.25, 0.72, -0.15).applyMatrix4(m.raiz.matrixWorld));
      } else {
        // la vista del piloto: el cartel delante del morro, que se levanta para salir
        const mc = m.carroceria.matrixWorld;
        cam.position.set(0.16, 0.86, 0).applyMatrix4(mc);
        cam.lookAt(this._v.set(30, -0.24, 0).applyMatrix4(mc));
      }
    }
    return t < DURACION_SALIDA;
  }

  /** Termina (o salta) la secuencia: el piloto dentro, el volante puesto y el coche en el suelo. */
  quitar() {
    this.hecho = true;
    const m = this.m;
    if (m.piloto?.grupo) m.piloto.grupo.visible = true;
    if (m.volanteG) m.volanteG.visible = true;
    m.elevar = 0;
    m.raiz.remove(this.grupo);
  }
}
