// Público en 3D para las gradas, con estilo de dibujo animado (cel shading): figuras redondeadas
// con camiseta, piel, pantalón y gorra de colores, sombreado de tres tonos y un oscurecimiento en
// los bordes que hace de contorno. Miles de espectadores instanciados (una llamada de dibujo por
// grada, más otra para las banderas) y todo se anima en la GPU:
// - respiran y se balancean; cuando pasan los coches cerca saltan y levantan los brazos;
// - algunos aplauden; de vez en cuando la grada hace la ola (brazos arriba al pasar);
// - unos cuantos llevan una bandera de su equipo que ondea y levantan al animar.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ROPA = [0xe8202a, 0x0d47ff, 0xffd23f, 0xffffff, 0x1b1d24, 0xff7a00, 0x16a34a, 0x7c3aed, 0x00b8d9, 0xf472b6, 0x9ca3af, 0x1e3a8a, 0x00a19c, 0xc8102e];
const PIEL = [0xf1c7a5, 0xe2b08a, 0xc68b62, 0x9a6845, 0x6e4a31, 0xf3d2b6];
const PANTALON = [0x1f2a44, 0x2b2f38, 0x3b4a6b, 0x5b4636, 0x6b7280, 0x111318];
const BANDERA = [0xe8202a, 0x0d47ff, 0xffd23f, 0x16a34a, 0xff7a00, 0x00b8d9, 0xffffff];

// Tres tonos de luz (cel shading)
let _rampa = null;
function rampa() {
  if (_rampa) return _rampa;
  const d = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  _rampa = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  _rampa.minFilter = _rampa.magFilter = THREE.NearestFilter; _rampa.needsUpdate = true;
  return _rampa;
}

/** Marca cada vértice de una pieza: zona (0 piel, 1 camiseta, 2 pantalón, 3 gorra) y brazo (-1, 0, 1). */
function pieza(g, zona, brazo = 0) {
  const n = g.attributes.position.count;
  g.setAttribute('zona', new THREE.Float32BufferAttribute(new Float32Array(n).fill(zona), 1));
  g.setAttribute('brazo', new THREE.Float32BufferAttribute(new Float32Array(n).fill(brazo), 1));
  return g;
}

function geometriaPersona(calidad) {
  const r = calidad >= 2 ? 1 : 0;
  const cap = (rad, largo, x, y, z, zona, brazo = 0, sx = 1, sz = 1) => { const g = new THREE.CapsuleGeometry(rad, largo, 2 + r, 6 + r * 2); g.scale(sx, 1, sz); g.translate(x, y, z); return pieza(g, zona, brazo); };
  const partes = [
    cap(0.066, 0.2, -0.08, 0.17, 0, 2), cap(0.066, 0.2, 0.08, 0.17, 0, 2),                       // piernas
    cap(0.15, 0.2, 0, 0.5, 0, 1, 0, 1, 0.72),                                                     // torso
    cap(0.046, 0.22, -0.205, 0.53, 0, 1, -1), cap(0.046, 0.22, 0.205, 0.53, 0, 1, 1),             // brazos (cuelgan del hombro)
  ];
  for (const s of [-1, 1]) { const m = new THREE.SphereGeometry(0.05, 6 + r * 2, 4 + r * 2); m.translate(s * 0.205, 0.38, 0); partes.push(pieza(m, 0, s)); }  // manos
  const cab = new THREE.SphereGeometry(0.115, 10 + r * 4, 8 + r * 2); cab.scale(1, 1.05, 1); cab.translate(0, 0.84, 0); partes.push(pieza(cab, 0));
  // gorra: casquete y visera (se esconde en quien no lleva)
  const casq = new THREE.SphereGeometry(0.122, 10 + r * 4, 5, 0, Math.PI * 2, 0, Math.PI * 0.5); casq.translate(0, 0.86, 0); partes.push(pieza(casq, 3));
  const vis = new THREE.CylinderGeometry(0.1, 0.1, 0.012, 10, 1, false, -Math.PI * 0.5, Math.PI); vis.scale(1, 1, 0.9); vis.translate(0, 0.875, -0.07); partes.push(pieza(vis, 3));
  for (const g of partes) { g.deleteAttribute('uv'); }
  return mergeGeometries(partes.map(g => g.index ? g.toNonIndexed() : g));
}

// Bandera en un palo: el palo sale de la mano derecha; la tela tiene cortes para ondear
function geometriaBandera() {
  const palo = new THREE.CylinderGeometry(0.008, 0.008, 0.9, 4); palo.translate(0.205, 0.38 + 0.45, 0);
  pieza(palo, 4, 1);
  const tela = new THREE.PlaneGeometry(0.55, 0.34, 8, 2); tela.translate(0.205 + 0.275, 0.38 + 0.72, 0);
  pieza(tela, 5, 1);
  for (const g of [palo, tela]) g.deleteAttribute('uv');
  return mergeGeometries([palo.toNonIndexed(), tela.toNonIndexed()]);
}

// Animación y colores en el sombreador. Fase por espectador según su posición; `foco` es el coche
// más cercano a la cámara (saltan y levantan los brazos al pasar), `ola` la ola de la grada.
function material(u, bandera) {
  const mat = new THREE.MeshToonMaterial({ gradientMap: rampa(), side: bandera ? THREE.DoubleSide : THREE.FrontSide });
  mat.customProgramCacheKey = () => 'publicoToon' + (bandera ? 'B' : 'P');
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tiempo = u.tiempo; sh.uniforms.foco = u.foco; sh.uniforms.ola = u.ola;
    const comun = `
      uniform float tiempo; uniform vec3 foco; uniform float ola;
      attribute float zona; attribute float brazo;
      attribute vec3 iCamisa; attribute vec3 iPiel; attribute vec3 iPantalon; attribute vec4 iGorra;
      varying vec3 vCol;
      float hashP(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec3 baseP() { return vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]); }
      // ánimo del espectador: 0 tranquilo, 1 eufórico (coche cerca u ola)
      float animoP(vec3 b, float h) {
        float cerca = 1.0 - smoothstep(25.0, 130.0, distance(b.xz, foco.xz));
        float olaF = ola * smoothstep(0.75, 1.0, sin(b.x * 0.045 + b.z * 0.045 - tiempo * 3.0));
        return clamp(max(cerca * step(0.3, h + cerca * 0.5), olaF), 0.0, 1.0);
      }
      // giro del brazo alrededor del hombro (en el plano lateral): abajo → arriba
      vec3 girarBrazo(vec3 p, float ang) {
        vec3 hombro = vec3(brazo * 0.205, 0.66, 0.0);
        vec3 d = p - hombro; float c = cos(ang), s = sin(ang);
        return hombro + vec3(d.x * c - d.y * s, d.x * s + d.y * c, d.z);
      }
      float anguloBrazo(float h, float animo) {
        // tranquilo: brazos abajo, alguno aplaude; animado: arriba agitándolos
        float aplaude = step(0.7, h) * (0.6 + 0.25 * sin(tiempo * 14.0 + h * 40.0));
        float arriba = 2.55 + 0.25 * sin(tiempo * 9.0 + h * 25.0 + brazo);
        return brazo * mix(0.12 + aplaude * 0.9, arriba, animo);
      }`;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + comun)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      {
        vec3 b = baseP(); float h = hashP(b.xz); float an = animoP(b, h);
        if (abs(brazo) > 0.5) { float a = anguloBrazo(h, an); float c = cos(a), s = sin(a); objectNormal = vec3(objectNormal.x * c - objectNormal.y * s, objectNormal.x * s + objectNormal.y * c, objectNormal.z); }
      }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 b = baseP(); float h = hashP(b.xz); float an = animoP(b, h);
        ${bandera ? `
        // la tela ondea (más cuanto más lejos del palo) y se levanta con el brazo
        if (zona > 4.5) { float dx = transformed.x - 0.205; transformed.z += sin(dx * 11.0 - tiempo * 9.0 + h * 20.0) * 0.06 * dx / 0.55; transformed.y += sin(dx * 7.0 - tiempo * 6.0) * 0.015; }` : `
        // quien no lleva gorra: el casquete se mete dentro de la cabeza
        if (zona > 2.5 && iGorra.w < 0.5) transformed = mix(vec3(0.0, 0.8, 0.0), transformed, 0.2);`}
        if (abs(brazo) > 0.5) transformed = girarBrazo(transformed, anguloBrazo(h, an));
        float salto = max(0.0, sin(tiempo * (7.0 + h * 4.0) + h * 30.0)) * (0.03 + 0.24 * an);
        transformed.y += 0.012 * sin(tiempo * 1.7 + h * 20.0) + salto;
        transformed.x += sin(tiempo * 1.1 + h * 9.0) * 0.035 * transformed.y;
        vCol = ${bandera ? 'zona < 4.5 ? vec3(0.75) : iCamisa' : 'zona < 0.5 ? iPiel : zona < 1.5 ? iCamisa : zona < 2.5 ? iPantalon : iGorra.rgb'};
      }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vCol;')
      // contorno de dibujo: los bordes de la silueta se oscurecen
      .replace('#include <opaque_fragment>', `{
        float borde = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
        outgoingLight *= 1.0 - 0.6 * smoothstep(0.62, 0.9, borde);
      }
      #include <opaque_fragment>`);
  };
  return mat;
}

export class Publico {
  constructor(calidad = 1) {
    this.calidad = calidad;
    this.gradas = [];           // matrices de cada espectador, por grada (cada una se recorta sola fuera de cámara)
    this.u = { tiempo: { value: 0 }, foco: { value: new THREE.Vector3(1e6, 0, 1e6) }, ola: { value: 0 } };
  }

  /** Rellena una grada: `grupo` ya colocado; filas de escalones de `paso` m de fondo y `alto` m. */
  agregarGrada(grupo, L, filas, lado, { fondo = 1.6, alto = 0.9 } = {}) {
    grupo.updateMatrixWorld(true);
    const lista = []; this.gradas.push(lista);
    const sep = this.calidad >= 2 ? 0.62 : 0.9, lleno = this.calidad >= 2 ? 0.85 : 0.65;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    // miran hacia la pista (−lado en z local)
    const giro = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), lado > 0 ? 0 : Math.PI);
    const eje = new THREE.Vector3(0, 1, 0), q2 = new THREE.Quaternion();
    for (let f = 0; f < filas; f++) {
      if (f % 2) continue;                                          // en los escalones con asientos
      const y = alto + f * alto, z = lado * f * fondo;
      for (let x = -L / 2 + 0.6; x < L / 2 - 0.6; x += sep) {
        if (Math.random() > lleno) continue;
        const e = 1.2 + Math.random() * 0.2;
        p.set(x + (Math.random() - 0.5) * 0.15, y, z + (Math.random() - 0.5) * 0.2);
        q.copy(giro).multiply(q2.setFromAxisAngle(eje, (Math.random() - 0.5) * 0.5));
        s.set(e * (0.92 + Math.random() * 0.16), e, e);
        m.compose(p, q, s).premultiply(grupo.matrixWorld);
        lista.push(m.clone());
      }
    }
  }

  construir(scene) {
    const geoP = geometriaPersona(this.calidad), geoB = geometriaBandera();
    const matP = material(this.u, false), matB = material(this.u, true);
    const col = new THREE.Color(), elegir = (l) => col.setHex(l[Math.floor(Math.random() * l.length)]);
    this.n = 0;
    for (const lista of this.gradas) {
      const n = lista.length;
      if (!n) continue;
      this.n += n;
      const camisa = new Float32Array(n * 3), piel = new Float32Array(n * 3), pant = new Float32Array(n * 3), gorra = new Float32Array(n * 4);
      const conBandera = [];
      // los de cada tramo de grada tiran hacia los mismos colores (aficiones de un equipo)
      const fav = ROPA[Math.floor(Math.random() * ROPA.length)];
      for (let k = 0; k < n; k++) {
        (Math.random() < 0.35 ? col.setHex(fav) : elegir(ROPA)).multiplyScalar(0.85 + Math.random() * 0.2).toArray(camisa, k * 3);
        elegir(PIEL).toArray(piel, k * 3);
        elegir(PANTALON).toArray(pant, k * 3);
        (Math.random() < 0.5 ? col.setHex(fav) : elegir(ROPA)).toArray(gorra, k * 4); gorra[k * 4 + 3] = Math.random() < 0.4 ? 1 : 0;
        if (Math.random() < 0.06) conBandera.push(k);
      }
      const ip = new THREE.InstancedMesh(geoP, matP, n);
      ip.geometry = geoP.clone();
      ip.geometry.setAttribute('iCamisa', new THREE.InstancedBufferAttribute(camisa, 3));
      ip.geometry.setAttribute('iPiel', new THREE.InstancedBufferAttribute(piel, 3));
      ip.geometry.setAttribute('iPantalon', new THREE.InstancedBufferAttribute(pant, 3));
      ip.geometry.setAttribute('iGorra', new THREE.InstancedBufferAttribute(gorra, 4));
      for (let k = 0; k < n; k++) ip.setMatrixAt(k, lista[k]);
      const mallas = [ip];
      if (conBandera.length) {
        const nb = conBandera.length, ib = new THREE.InstancedMesh(geoB.clone(), matB, nb);
        const cb = new Float32Array(nb * 3), z3 = new Float32Array(nb * 3), z4 = new Float32Array(nb * 4);
        conBandera.forEach((k, j) => { ib.setMatrixAt(j, lista[k]); elegir(BANDERA).toArray(cb, j * 3); });
        ib.geometry.setAttribute('iCamisa', new THREE.InstancedBufferAttribute(cb, 3));
        ib.geometry.setAttribute('iPiel', new THREE.InstancedBufferAttribute(z3, 3));
        ib.geometry.setAttribute('iPantalon', new THREE.InstancedBufferAttribute(z3, 3));
        ib.geometry.setAttribute('iGorra', new THREE.InstancedBufferAttribute(z4, 4));
        mallas.push(ib);
      }
      for (const im of mallas) {
        im.computeBoundingSphere(); im.boundingSphere.radius += 2;   // margen para saltos, brazos y banderas
        im.castShadow = false; im.receiveShadow = false; scene.add(im);
      }
    }
    this.gradas = [];
  }

  /** foco: posición del coche más cercano a la cámara (para que salten al pasar). */
  actualizar(dt, foco) {
    this.u.tiempo.value = (this.u.tiempo.value + dt) % 1000;
    if (foco) this.u.foco.value.set(foco.x, foco.y || 0, foco.z);
    // la ola aparece de vez en cuando y dura unos segundos
    const t = this.u.tiempo.value;
    this.u.ola.value = Math.max(0, Math.sin(t * 0.06) - 0.75) * 4;
  }
}
