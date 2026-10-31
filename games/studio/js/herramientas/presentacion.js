// Modo «Presentación» (mejora 7): render de calidad para enseñar y compartir el modelo. Luz de
// estudio de tres puntos, sombras suaves en alta resolución, oclusión ambiental (GTAO), fondo
// degradado, sin rejilla ni gizmos, giro automático y captura PNG al doble de resolución.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class Presentacion {
  constructor({ renderer, scene, camara, ocultar, sol }) {
    Object.assign(this, { renderer, scene, camara, ocultar, sol });
    this.activa = false; this.girar = true; this.ao = true;
    this.luces = new THREE.Group();
    const clave = new THREE.DirectionalLight(0xfff2e6, 1.6); clave.position.set(-4, 6, 5);
    const relleno = new THREE.DirectionalLight(0xdfe8ff, 0.6); relleno.position.set(5, 3, 4);
    const contra = new THREE.DirectionalLight(0xffffff, 1.4); contra.position.set(0, 5, -6);
    this.luces.add(clave, relleno, contra);
    this.fondo = this.texturaFondo();
  }

  texturaFondo() {
    const c = document.createElement('canvas'); c.width = 16; c.height = 512;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#3a4252'); gr.addColorStop(0.55, '#1c212c'); gr.addColorStop(1, '#0b0e14');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  activar(objetivo) {
    if (this.activa) return;
    this.activa = true;
    this.antes = { fondo: this.scene.background, env: this.scene.environmentIntensity, mapa: this.sol.shadow.mapSize.x, pr: this.renderer.getPixelRatio(), exp: this.renderer.toneMappingExposure };
    for (const o of this.ocultar()) { o.userData._visibleAntes = o.visible; o.visible = false; }
    this.scene.background = this.fondo;
    this.scene.environmentIntensity = 0.9;
    this.renderer.toneMappingExposure = 1.05;
    this.sol.shadow.mapSize.set(4096, 4096); this.sol.shadow.radius = 4; this.sol.shadow.map?.dispose(); this.sol.shadow.map = null;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.add(this.luces);
    this.objetivo = objetivo;
    this.crearComposer();
  }

  crearComposer() {
    const w = this.renderer.domElement.clientWidth || innerWidth, h = this.renderer.domElement.clientHeight || innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camara));
    try {
      this.gtao = new GTAOPass(this.scene, this.camara, w, h);
      this.gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1.2 });
      this.gtao.enabled = this.ao;
      this.composer.addPass(this.gtao);
    } catch (e) { console.warn('sin oclusión ambiental', e); this.gtao = null; }
    this.composer.addPass(new OutputPass());
    this.composer.setSize(w, h);
  }

  desactivar() {
    if (!this.activa) return;
    this.activa = false;
    for (const o of this.ocultar()) if (o.userData._visibleAntes !== undefined) { o.visible = o.userData._visibleAntes; delete o.userData._visibleAntes; }
    this.scene.background = this.antes.fondo;
    this.scene.environmentIntensity = this.antes.env;
    this.renderer.toneMappingExposure = this.antes.exp;
    this.sol.shadow.mapSize.set(this.antes.mapa, this.antes.mapa); this.sol.shadow.radius = 1; this.sol.shadow.map?.dispose(); this.sol.shadow.map = null;
    this.renderer.setPixelRatio(this.antes.pr);
    this.scene.remove(this.luces);
    this.composer?.dispose?.(); this.composer = null; this.gtao = null;
  }

  ajustar(w, h) { this.composer?.setSize(w, h); }

  // devuelve true si ya ha dibujado el cuadro
  dibujar(dt, camOrb) {
    if (!this.activa) return false;
    if (this.girar && camOrb && !camOrb.meta) camOrb.yaw += dt * 0.35;
    if (this.gtao) this.gtao.enabled = this.ao;
    this.composer.render(dt);
    return true;
  }

  // captura PNG al doble del tamaño de la pantalla (máx. 4096 px)
  async capturar(nombre = 'upgames-studio') {
    const el = this.renderer.domElement, w = el.clientWidth, h = el.clientHeight;
    const k = Math.min(2, 4096 / Math.max(w, h)), pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(k); this.composer.setPixelRatio?.(k); this.composer.setSize(w, h);
    this.composer.render(0);
    // en el mismo paso que el dibujo (el lienzo no conserva el cuadro después)
    const url64 = el.toDataURL('image/png');
    const blob = await (await fetch(url64)).blob();
    this.renderer.setPixelRatio(pr); this.composer.setPixelRatio?.(pr); this.composer.setSize(w, h);
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `${nombre}.png` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return blob.size;
  }
}
