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
    let vivas = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.vida[i] <= 0) { this.alfa[i] = 0; continue; }
      vivas++;
      this.vida[i] -= dt;
      this.v[i * 3] *= k; this.v[i * 3 + 2] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - gravedad * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.tam[i] += this.crece[i] * dt;
      const t = this.vida[i] / this.vidaMax[i];
      this.alfa[i] = this.alfa0[i] * Math.min(1, t * 1.6) * Math.min(1, (1 - t) * 8 + 0.2);
    }
    // sin partículas vivas (ni en el cuadro anterior) no hace falta subir nada a la GPU
    if (!vivas && !this._vivas) return;
    this._vivas = vivas;
    this.malla.visible = vivas > 0;
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
    // piedras de grava y terrones de hierba que salen despedidos (caen con gravedad, no brillan)
    this.piedras = new Particulas(scene, calidad >= 2 ? 300 : 120, false);
    this.marcas = new Marcas(scene, calidad >= 2 ? 6000 : 2500);
    this.acum = 0;
    this.agua = 0;             // agua en la pista: spray detrás de los coches
  }

  ajustarEscala(alturaPx, fovGrados) {
    const e = alturaPx / (2 * Math.tan(fovGrados * Math.PI / 360));
    this.humo.mat.uniforms.escala.value = e;
    this.chispas.mat.uniforms.escala.value = e;
    this.piedras.mat.uniforms.escala.value = e;
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
        // piedras y terrones lanzados por las ruedas fuera de la pista
        if (tierra && v > 14 && rnd() < Math.min(0.9, v / 45) * (this.calidad >= 1 ? 1 : 0.5)) {
          const grava = w.sup === SUP_GRAVA;
          for (let k = 0; k < (grava ? 3 : 1); k++) {
            const tono = grava ? 0.55 + rnd() * 0.2 : 0.22 + rnd() * 0.1;
            this.piedras.emitir(w.wx, w.wy + 0.1, w.wz, cos * v * (0.2 + rnd() * 0.3) + (rnd() - 0.5) * 4, 1.5 + rnd() * 4, sin * v * (0.2 + rnd() * 0.3) + (rnd() - 0.5) * 4,
              grava ? 0.06 + rnd() * 0.05 : 0.12 + rnd() * 0.1, 1, 0.8 + rnd() * 0.6, 0, tono, tono * (grava ? 0.95 : 1.4), tono * (grava ? 0.85 : 0.6));
          }
        }
        // buje sin rueda arrastrando por el asfalto: chorro de chispas
        if (car.dano?.suelta?.[w.idx] && v > 4 && enAsfalto) {
          for (let k = 0; k < 3; k++) this.chispas.emitir(w.wx, w.wy + 0.05, w.wz, -cos * v * (0.3 + rnd() * 0.4) + (rnd() - 0.5) * 3, 0.5 + rnd() * 2, -sin * v * (0.3 + rnd() * 0.4) + (rnd() - 0.5) * 3,
            0.07, 1, 0.3 + rnd() * 0.3, -0.05, 1, 0.7, 0.3);
        }
        // polvo o grava
        if (tierra && rnd() < Math.min(1, v / 30)) {
          const grava = w.sup === SUP_GRAVA;
          this.humo.emitir(w.wx, w.wy + 0.2, w.wz, (rnd() - 0.5) * 2, 0.8 + rnd(), (rnd() - 0.5) * 2, 0.9, grava ? 0.5 : 0.25, 1.4 + rnd(), 2.6,
            grava ? 0.72 : 0.42, grava ? 0.64 : 0.4, grava ? 0.5 : 0.25);
        }
      }
      // spray: cortina de agua que levantan las ruedas traseras y el difusor
      if (this.agua > 0.06 && !lejos && v > 15 && rnd() < this.agua * 1.6 * (this.calidad >= 2 ? 1 : 0.55)) {
        for (const w of [car.ruedas[2], car.ruedas[3]]) {
          const l = 0.82 + rnd() * 0.12;
          this.humo.emitir(w.wx - cos * 0.6, w.wy + 0.3, w.wz - sin * 0.6, cos * v * 0.25 + (rnd() - 0.5) * 2, 0.8 + rnd() * 1.5, sin * v * 0.25 + (rnd() - 0.5) * 2,
            0.7 + this.agua, 0.22 + this.agua * 0.3, 0.7 + rnd() * 0.6, 3.2, l, l, l * 1.03);
        }
      }
      // humo del motor roto (sale de la parte trasera)
      if (car.humoMotor > 0 && !lejos && rnd() < 0.8) {
        const k = 0.35 + rnd() * 0.25;
        this.humo.emitir(car.x - cos * 2.3, car.y + 0.6, car.z - sin * 2.3, -cos * v * 0.1 + (rnd() - 0.5), 1 + rnd() * 1.5, -sin * v * 0.1 + (rnd() - 0.5), 1.0, 0.55, 2.2 + rnd(), 2.8, k, k, k);
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
      // coche volcado o cayendo tras volar: arrastra el arco antivuelco y el morro por el suelo
      if (!lejos && (car.volcado || (car.vuelo && car.vuelo.h < 0.15)) && v > 3) {
        const n = Math.min(14, 3 + Math.floor(v / 4));
        for (let k = 0; k < n; k++) this.chispas.emitir(car.x + (rnd() - 0.5) * 2, car.y + 0.1, car.z + (rnd() - 0.5) * 2, -cos * v * 0.4 + (rnd() - 0.5) * 6, rnd() * 3, -sin * v * 0.4 + (rnd() - 0.5) * 6,
          0.08, 1, 0.3 + rnd() * 0.4, -0.05, 1, 0.72, 0.32);
        if (rnd() < 0.5) this.humo.emitir(car.x, car.y + 0.3, car.z, (rnd() - 0.5) * 2, 0.6 + rnd(), (rnd() - 0.5) * 2, 1.4, 0.35, 1.6 + rnd(), 2.4, 0.5, 0.48, 0.45);
      }
      // roce entre coches: chispas de carbono y metal en el punto de contacto
      if (!lejos && car.picoGolpe > 4 && car.fuenteGolpe === 'coche' && car._chispaCoche !== car._tGolpe) {
        car._chispaCoche = car._tGolpe;
        for (let k = 0; k < 16; k++) this.chispas.emitir(car.x + (rnd() - 0.5) * 3, car.y + 0.3, car.z + (rnd() - 0.5) * 3, (rnd() - 0.5) * 8 + cos * v * 0.3, rnd() * 4, (rnd() - 0.5) * 8 + sin * v * 0.3,
          0.07, 1, 0.3 + rnd() * 0.3, -0.05, 1, 0.85, 0.5);
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
    this.piedras.actualizar(dt, 9.8, 0.4);
  }
}
