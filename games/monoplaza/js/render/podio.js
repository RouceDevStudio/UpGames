// Podio tras la carrera: tres escalones con su fondo de patrocinadores, los tres primeros sin
// casco y con gorra, el himno (ovación), el champán que se rocían y confeti. Se monta fuera de
// la pista, junto a la recta de meta, y tiene su propia cámara que da vueltas lentamente.

import * as THREE from 'three';
import { Persona } from './personas.js';

const ALTOS = [1.0, 0.72, 0.5];             // 1.º, 2.º y 3.º
const LADO = [0, -1.45, 1.45];               // posición en el escalón (x local)

function texturaNumero(n, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#0d0f14'; x.fillRect(0, 0, 256, 128);
  x.fillStyle = color; x.fillRect(0, 0, 256, 10);
  x.fillStyle = '#ffffff'; x.font = '900 italic 84px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(n), 128, 70);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function texturaFondo() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 384;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 384); g.addColorStop(0, '#101a33'); g.addColorStop(1, '#05070c');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 384);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) {
    x.fillStyle = (k + j) % 2 ? 'rgba(255,255,255,0.10)' : 'rgba(232,32,42,0.18)';
    x.font = '900 italic 40px Arial'; x.fillText((k + j) % 2 ? 'UPGAMES' : 'APEX GP', 128 + k * 256, 70 + j * 120);
  }
  x.fillStyle = '#e8202a'; x.fillRect(0, 360, 1024, 24);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Podio {
  /** top: [{ equipo, numero }] en orden (1.º, 2.º, 3.º); pos: {x, y, z, ang} del centro. */
  constructor(scene, top, pos, calidad = 1) {
    this.scene = scene; this.t = 0; this.grupo = new THREE.Group();
    this.grupo.position.set(pos.x, pos.y, pos.z); this.grupo.rotation.y = pos.ang;
    const matEsc = new THREE.MeshStandardMaterial({ color: 0x1a1d25, roughness: 0.5, metalness: 0.2 });
    // escalones con su número delante
    top.forEach((p, k) => {
      const h = ALTOS[k];
      const caja = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 1.2), matEsc); caja.position.set(LADO[k], h / 2, 0); caja.receiveShadow = caja.castShadow = true; this.grupo.add(caja);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshBasicMaterial({ map: texturaNumero(k + 1, p.equipo.base) }));
      num.position.set(LADO[k], h * 0.5, 0.605); this.grupo.add(num);
    });
    // tarima y fondo
    const base = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.12, 3.2), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.8 }));
    base.position.set(0, 0.06, -0.4); base.receiveShadow = true; this.grupo.add(base);
    const fondo = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.6), new THREE.MeshStandardMaterial({ map: texturaFondo(), roughness: 0.7 }));
    fondo.position.set(0, 2.4, -1.7); this.grupo.add(fondo);
    // los pilotos: sin casco, con gorra del equipo, botella de champán en la mano derecha
    const matBot = new THREE.MeshStandardMaterial({ color: 0x14361f, roughness: 0.15, metalness: 0.3 });
    const matOro = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.9 });
    this.pilotos = top.map((p, k) => {
      const per = new Persona({ color: p.equipo.base, texto: p.equipo.corto === 'UPG' ? 'UPGAMES' : p.equipo.nombre.split(' ')[0].toUpperCase(), numero: p.numero || k + 1, rol: 'piloto', calidad, podio: true });
      per.raiz.position.set(LADO[k], ALTOS[k] + 0.02, 0); per.raiz.rotation.y = -Math.PI / 2;    // de cara a la cámara (+z)
      per.poner('de_pie', 0.01);
      const bot = new THREE.Group();
      const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.26, 12), matBot); bot.add(cuerpo);
      const cuello = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.04, 0.12, 10), matBot); cuello.position.y = 0.19; bot.add(cuello);
      const capsula = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8), matOro); capsula.position.y = 0.25; bot.add(capsula);
      bot.position.set(0.02, -0.12, 0.06); bot.rotation.z = -0.3; per.manoDerecha().add(bot);
      per.botella = bot;
      this.grupo.add(per.raiz);
      return per;
    });
    // trofeo del ganador
    const trofeo = new THREE.Group();
    const copa = new THREE.Mesh(new THREE.LatheGeometry([0.02, 0.08, 0.1, 0.11, 0.1, 0.06, 0.03, 0.03, 0.07].map((r, i) => new THREE.Vector2(r, i * 0.05)), 16), matOro);
    trofeo.add(copa); trofeo.position.set(-0.05, -0.1, -0.08); this.trofeo = trofeo;
    this.pilotos[0].mI.add(trofeo);
    this.grupo.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(this.grupo);
    this._p = new THREE.Vector3();
  }

  /** Avanza la ceremonia: devuelve false al terminar (unos 13 s). */
  actualizar(dt, efectos, cam) {
    this.t += dt;
    const t = this.t;
    this.pilotos.forEach((per, k) => {
      // 0-2 s: saludan; 2-4 s: el ganador levanta el trofeo; 4-11 s: champán para todos
      if (t < 2) per.poner(k === 0 ? 'celebra' : 'senala', 0.3);
      else if (t < 4) per.poner(k === 0 ? 'celebra' : 'de_pie', 0.3);
      else if (t < 11) {
        per.poner('senala', 0.25);
        // rocía: la botella apunta a los otros y sacude
        per.extra.hD = [0, Math.sin(t * 9 + k) * 0.25, Math.sin(t * 13 + k * 2) * 0.15];
        if (efectos && Math.random() < 0.9) {
          per.botella.getWorldPosition(this._p);
          const dir = new THREE.Vector3(k === 1 ? 1 : k === 2 ? -1 : (Math.sin(t * 2) > 0 ? 1 : -1), 1.1, 0.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.grupo.rotation.y);
          for (let i = 0; i < 5; i++) {
            const v = 3 + Math.random() * 2.5;
            efectos.humo.emitir(this._p.x, this._p.y + 0.2, this._p.z, dir.x * v + (Math.random() - 0.5), dir.y * v + Math.random(), dir.z * v + (Math.random() - 0.5),
              0.2 + Math.random() * 0.15, 0.85, 0.8 + Math.random() * 0.6, 2.2, 1, 0.98, 0.88);
          }
        }
      } else { per.poner('celebra', 0.4); per.extra.hD = [0, 0, 0]; }
      per.salto = t > 0.5 && t < 2.5 && k === 0 ? 0.5 : 0;
      per.actualizar(dt);
    });
    // confeti al principio, de los colores del ganador
    if (efectos && t < 6 && Math.random() < 0.7) {
      this._p.set((Math.random() - 0.5) * 5, 4.5, (Math.random() - 0.3) * 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.grupo.rotation.y).add(this.grupo.position);
      const c = new THREE.Color().setHSL(Math.random(), 0.8, 0.6);
      for (let i = 0; i < 4; i++) efectos.piedras.emitir(this._p.x, this._p.y, this._p.z, (Math.random() - 0.5) * 2, -0.5, (Math.random() - 0.5) * 2, 0.05, 1, 2.5, 0, c.r, c.g, c.b);
    }
    // cámara: de frente, dando la vuelta despacio y acercándose
    if (cam) {
      const a = this.grupo.rotation.y + Math.sin(t * 0.22) * 0.5, r = 6.2 - Math.min(2.2, t * 0.22);
      cam.position.set(this.grupo.position.x + Math.sin(a) * r, this.grupo.position.y + 2.0, this.grupo.position.z + Math.cos(a) * r);
      cam.lookAt(this.grupo.position.x, this.grupo.position.y + 1.75, this.grupo.position.z);
    }
    return t < 13;
  }

  quitar() { this.scene.remove(this.grupo); }
}
