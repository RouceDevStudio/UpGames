// Partículas (humo de neumáticos, polvo, chispas del fondo) y marcas de goma.

import * as THREE from 'three';
import { texturaHumo } from './texturas.js';
import { SUP_ASFALTO, SUP_BORDILLO, SUP_ESCAPE, SUP_GRAVA } from '../track.js';

const VERT = `
attribute float tam; attribute float alfa; attribute vec3 tono;
varying float vAlfa; varying vec3 vTono;
uniform float escala;
void main(){
  vAlfa = alfa; vTono = tono;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = tam * escala / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D mapa; varying float vAlfa; varying vec3 vTono;
void main(){
  vec4 t = texture2D(mapa, gl_PointCoord);
  gl_FragColor = vec4(vTono, t.a * vAlfa);
  #include <colorspace_fragment>
}`;

class Particulas {
  constructor(scene, max, aditivo) {
    this.max = max;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.tam = new Float32Array(max); this.alfa = new Float32Array(max); this.tono = new Float32Array(max * 3);
    this.vida = new Float32Array(max); this.vidaMax = new Float32Array(max); this.crece = new Float32Array(max);
    this.alfa0 = new Float32Array(max);
    this.sig = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tam', new THREE.BufferAttribute(this.tam, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alfa', new THREE.BufferAttribute(this.alfa, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tono', new THREE.BufferAttribute(this.tono, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { mapa: { value: texturaHumo() }, escala: { value: 600 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: aditivo ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.malla = new THREE.Points(g, this.mat);
    this.malla.frustumCulled = false;
    scene.add(this.malla);
  }

  emitir(x, y, z, vx, vy, vz, tam, alfa, vida, crece, r, g, b) {
    const i = this.sig; this.sig = (this.sig + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.tam[i] = tam; this.alfa[i] = alfa; this.alfa0[i] = alfa;
    this.vida[i] = vida; this.vidaMax[i] = vida; this.crece[i] = crece;
    this.tono[i * 3] = r; this.tono[i * 3 + 1] = g; this.tono[i * 3 + 2] = b;
  }

  actualizar(dt, gravedad = 0, arrastre = 1.5) {
    const k = Math.exp(-arrastre * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.vida[i] <= 0) { this.alfa[i] = 0; continue; }
      this.vida[i] -= dt;
      this.v[i * 3] *= k; this.v[i * 3 + 2] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - gravedad * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.tam[i] += this.crece[i] * dt;
      const t = this.vida[i] / this.vidaMax[i];
      this.alfa[i] = this.alfa0[i] * Math.min(1, t * 1.6) * Math.min(1, (1 - t) * 8 + 0.2);
    }
    const a = this.malla.geometry.attributes;
    a.position.needsUpdate = a.tam.needsUpdate = a.alfa.needsUpdate = a.tono.needsUpdate = true;
  }
}

class Marcas {
  constructor(scene, max) {
    this.max = max;
    this.pos = new Float32Array(max * 6 * 3);
    this.col = new Float32Array(max * 6 * 4);
    this.sig = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.malla = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.malla.frustumCulled = false;
    this.malla.renderOrder = 1;
    scene.add(this.malla);
    this.ult = new Map();
  }

  anadir(clave, x, y, z, dirx, dirz, ancho, intensidad, color = 0.02) {
    const prev = this.ult.get(clave);
    this.ult.set(clave, { x, y, z, a: intensidad });
    if (!prev) return;
    const dx = x - prev.x, dz = z - prev.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 9) return;           // salto (reaparición)
    if (d2 < 0.09) { this.ult.set(clave, prev); return; }
    const nx = -dirz * ancho / 2, nz = dirx * ancho / 2;
    const i = this.sig; this.sig = (this.sig + 1) % this.max;
    const v = [
      prev.x - nx, prev.y, prev.z - nz, prev.x + nx, prev.y, prev.z + nz, x + nx, y, z + nz,
      prev.x - nx, prev.y, prev.z - nz, x + nx, y, z + nz, x - nx, y, z - nz,
    ];
    this.pos.set(v, i * 18);
    const a0 = prev.a * 0.6, a1 = intensidad * 0.6;
    const al = [a0, a0, a1, a0, a1, a1];
    for (let k = 0; k < 6; k++) this.col.set([color, color, color, al[k]], i * 24 + k * 4);
    const g = this.malla.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }

  cortar(clave) { this.ult.delete(clave); }
}

export class Efectos {
  constructor(scene, calidad) {
    this.calidad = calidad;
    this.humo = new Particulas(scene, calidad >= 2 ? 900 : 350, false);
    this.chispas = new Particulas(scene, calidad >= 2 ? 400 : 150, true);
    this.marcas = new Marcas(scene, calidad >= 2 ? 6000 : 2500);
    this.acum = 0;
  }

  ajustarEscala(alturaPx, fovGrados) {
    const e = alturaPx / (2 * Math.tan(fovGrados * Math.PI / 360));
    this.humo.mat.uniforms.escala.value = e;
    this.chispas.mat.uniforms.escala.value = e;
  }

  actualizar(dt, coches, camPos) {
    const rnd = Math.random;
    for (const car of coches) {
      const lejos = (car.x - camPos.x) ** 2 + (car.z - camPos.z) ** 2 > 350 * 350;
      const cos = Math.cos(car.psi), sin = Math.sin(car.psi);
      const v = car.velocidad;
      for (const w of car.ruedas) {
        const clave = car.id * 4 + w.idx;
        const desl = w.deslizamiento;
        const enAsfalto = w.sup === SUP_ASFALTO || w.sup === SUP_BORDILLO || w.sup === SUP_ESCAPE;
        // marcas: bloqueo o derrape fuerte sobre asfalto
        const marca = enAsfalto && w.fz > 500 && desl > 4.5 && w.sigma > 1.25;
        const tierra = !enAsfalto && v > 6;
        if (marca || tierra) {
          const dirx = cos * Math.cos(w.angulo) - sin * Math.sin(w.angulo), dirz = sin * Math.cos(w.angulo) + cos * Math.sin(w.angulo);
          const inten = tierra ? 0.5 : Math.min(1, (desl - 4.5) / 10 + 0.35);
          this.marcas.anadir(clave, w.wx, w.wy + 0.012, w.wz, dirx, dirz, w.delantera ? 0.3 : 0.4, inten, tierra ? 0.12 : 0.02);
        } else this.marcas.cortar(clave);
        if (lejos) continue;
        // humo de goma
        if (enAsfalto && desl > 6 && w.sigma > 1.3 && rnd() < Math.min(1, (desl - 6) / 12) * (this.calidad >= 2 ? 1 : 0.5)) {
          const l = 0.8 + rnd() * 0.15;
          this.humo.emitir(w.wx, w.wy + 0.2, w.wz, car.vx * cos * 0.15 + (rnd() - 0.5), 0.6 + rnd(), car.vx * sin * 0.15 + (rnd() - 0.5), 0.8, 0.45, 1.8 + rnd(), 2.2, l, l, l);
        }
        // polvo o grava
        if (tierra && rnd() < Math.min(1, v / 30)) {
          const grava = w.sup === SUP_GRAVA;
          this.humo.emitir(w.wx, w.wy + 0.2, w.wz, (rnd() - 0.5) * 2, 0.8 + rnd(), (rnd() - 0.5) * 2, 0.9, grava ? 0.5 : 0.25, 1.4 + rnd(), 2.6,
            grava ? 0.72 : 0.42, grava ? 0.64 : 0.4, grava ? 0.5 : 0.25);
        }
      }
      // chispas de los patines de titanio bajo el fondo
      if (!lejos && car.fondoToca > 0 && v > 35) {
        const n = 2 + Math.floor(car.fondoToca * 6);
        for (let k = 0; k < n; k++) {
          const off = -0.5 + rnd() * 1.0;
          const px = car.x + cos * off, pz = car.z + sin * off;
          this.chispas.emitir(px, car.y + 0.04, pz, -cos * v * (0.25 + rnd() * 0.3) + (rnd() - 0.5) * 3, 0.6 + rnd() * 2.5, -sin * v * (0.25 + rnd() * 0.3) + (rnd() - 0.5) * 3,
            0.07, 1, 0.25 + rnd() * 0.3, -0.05, 1, 0.75, 0.35);
        }
      }
      // chispas al golpear el muro
      if (!lejos && car.impacto > 3) {
        for (let k = 0; k < 20; k++) {
          this.chispas.emitir(car.x, car.y + 0.4, car.z, (rnd() - 0.5) * 12, rnd() * 5, (rnd() - 0.5) * 12, 0.08, 1, 0.4, 0, 1, 0.8, 0.4);
        }
      }
    }
    this.humo.actualizar(dt, -0.3, 1.2);
    this.chispas.actualizar(dt, 9.8, 0.6);
  }
}
