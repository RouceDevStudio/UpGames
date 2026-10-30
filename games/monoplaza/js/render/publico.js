// Público en 3D para las gradas: cada espectador es un cuerpo y una cabeza instanciados
// (miles con dos llamadas de dibujo). Se mueven en la GPU: respiran, se balancean, saltan
// cuando pasan los coches cerca y de vez en cuando hacen la ola.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ROPA = [0xe8202a, 0x0d47ff, 0xffd23f, 0xffffff, 0x111318, 0xff7a00, 0x16a34a, 0x7c3aed, 0x00b8d9, 0xf472b6, 0x9ca3af, 0x1e3a8a];
const PIEL = [0xf1c7a5, 0xd9a07a, 0xb47a55, 0x8a5a3c, 0x5c3a25, 0xe8b896];

// Animación en el vértice: la fase sale de la posición de cada espectador; `animo` (0..1)
// por grada sube cuando hay coches cerca. La ola recorre las gradas a lo largo.
function animar(mat, u, cabeza) {
  mat.customProgramCacheKey = () => 'publico' + (cabeza ? 'C' : 'B');
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tiempo = u.tiempo; sh.uniforms.foco = u.foco; sh.uniforms.ola = u.ola;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      uniform float tiempo; uniform vec3 foco; uniform float ola;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 base = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      float h = hash(base.xz);
      float cerca = 1.0 - smoothstep(30.0, 140.0, distance(base.xz, foco.xz));
      float olaF = ola * smoothstep(0.7, 1.0, sin(base.x * 0.045 + base.z * 0.045 - tiempo * 3.0));
      float salto = max(0.0, sin(tiempo * (7.0 + h * 4.0) + h * 30.0)) * (0.06 + 0.22 * cerca) + olaF * 0.45;
      transformed.y += (0.015 * sin(tiempo * 1.7 + h * 20.0)) + salto * step(0.25, h + cerca);
      transformed.x += sin(tiempo * 1.1 + h * 9.0) * 0.04 * (transformed.y);
      ${cabeza ? 'transformed.z += sin(tiempo * 0.7 + h * 13.0) * 0.03;' : ''}`);
  };
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
    const sep = this.calidad >= 2 ? 0.66 : 0.95, lleno = this.calidad >= 2 ? 0.82 : 0.62;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    // miran hacia la pista (−lado en z local)
    const giro = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), lado > 0 ? 0 : Math.PI);
    for (let f = 0; f < filas; f++) {
      if (f % 2) continue;                                          // en los escalones con asientos
      const y = alto + f * alto, z = lado * f * fondo;
      for (let x = -L / 2 + 0.6; x < L / 2 - 0.6; x += sep) {
        if (Math.random() > lleno) continue;
        const e = 0.92 + Math.random() * 0.16;
        p.set(x + (Math.random() - 0.5) * 0.15, y, z + (Math.random() - 0.5) * 0.2);
        q.copy(giro).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.5));
        s.set(e, e * (0.95 + Math.random() * 0.12), e);
        m.compose(p, q, s).premultiply(grupo.matrixWorld);
        lista.push(m.clone());
      }
    }
  }

  construir(scene) {
    // pocos polígonos por persona (son miles): torso con brazos, piernas y cabeza facetada
    const torso = new THREE.BoxGeometry(0.5, 0.52, 0.24); torso.translate(0, 0.42, 0);
    const piernas = new THREE.BoxGeometry(0.36, 0.16, 0.42); piernas.translate(0, 0.12, -0.14);
    const cuerpo = mergeGeometries([torso, piernas]);
    const cabezaG = new THREE.IcosahedronGeometry(0.12, this.calidad >= 3 ? 1 : 0); cabezaG.translate(0, 0.82, 0);
    const matC = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const matH = new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true });
    animar(matC, this.u, false); animar(matH, this.u, true);
    const col = new THREE.Color();
    this.n = 0;
    for (const lista of this.gradas) {
    const n = lista.length;
    if (!n) continue;
    this.n += n;
    const ic = new THREE.InstancedMesh(cuerpo, matC, n), ih = new THREE.InstancedMesh(cabezaG, matH, n);
    for (let k = 0; k < n; k++) {
      ic.setMatrixAt(k, lista[k]); ih.setMatrixAt(k, lista[k]);
      ic.setColorAt(k, col.setHex(ROPA[Math.floor(Math.random() * ROPA.length)]).multiplyScalar(0.75 + Math.random() * 0.3));
      // gorras y pelo: algunas cabezas oscuras o de colores
      const r = Math.random();
      ih.setColorAt(k, col.setHex(r < 0.18 ? 0x1a1410 : r < 0.3 ? ROPA[Math.floor(Math.random() * ROPA.length)] : PIEL[Math.floor(Math.random() * PIEL.length)]));
    }
    for (const im of [ic, ih]) {
      im.computeBoundingSphere(); im.boundingSphere.radius += 1.5;   // margen para los saltos
      im.castShadow = false; im.receiveShadow = this.calidad >= 2; scene.add(im);
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
