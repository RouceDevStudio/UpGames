// Cuerpo escaneado (el mismo modelo del piloto de pie, con su casco y mono) para las Personas:
// mecánicos del equipo y el piloto cuando sale del coche. Se ata al esqueleto de la Persona:
// las articulaciones se colocan donde están en el escaneo y el esqueleto se enlaza en la pose
// del escaneo (brazos colgando a los lados), así todas las poses de la Persona
// (pistola, gato, empujar, celebrar…) lo mueven. Los pesos se reparten por cercanía a cada hueso
// y por regiones medidas sobre la superficie (la mano apoyada en la cadera sigue siendo mano).
//
// El modelo (modelos/piloto_pie.glb) está con los pies en y=0, mirando a +x y 1,75 m de alto.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// articulaciones del escaneo (m)
export const J = {
  cadera: V(0, 0.821, 0), tronco: V(0, 1.0, 0), cuello: V(0, 1.43, 0), cabeza: V(0, 1.48, 0), cima: V(0.01, 1.75, 0),
  hD: V(0, 1.375, 0.205), cD: V(0, 1.089, 0.259), mD: V(0, 0.857, 0.277), dD: V(0.018, 0.732, 0.268),
  hI: V(0, 1.375, -0.205), cI: V(0, 1.089, -0.259), mI: V(0, 0.857, -0.277), dI: V(0.018, 0.732, -0.268),
  kD: V(0, 0.75, 0.107), rD: V(-0.018, 0.393, 0.116), tD: V(-0.054, 0.089, 0.125), pD: V(0.107, 0.0, 0.125),
  kI: V(0, 0.75, -0.107), rI: V(-0.018, 0.393, -0.116), tI: V(-0.054, 0.089, -0.125), pI: V(0.107, 0.0, -0.125),
};
// segmento de cada hueso para los pesos: [desde, hasta, radio]
const SEG = {
  cadera: [V(0, 0.70, 0), V(0, 1.0, 0), 0.13], tronco: [V(0, 1.0, 0), V(0, 1.36, 0), 0.15], cuello: [V(0, 1.36, 0), V(0, 1.45, 0), 0.07],
  cabeza: [J.cabeza, J.cima, 0.13],
  hD: [J.hD, J.cD, 0.05], cD: [J.cD, J.mD, 0.042], mD: [J.mD, J.dD, 0.035],
  hI: [J.hI, J.cI, 0.05], cI: [J.cI, J.mI, 0.042], mI: [J.mI, J.dI, 0.035],
  kD: [J.kD, J.rD, 0.075], rD: [J.rD, J.tD, 0.058], tD: [J.tD, J.pD, 0.045],
  kI: [J.kI, J.rI, 0.075], rI: [J.rI, J.tI, 0.058], tI: [J.tI, J.pI, 0.045],
};
const BRAZO_D = ['hD', 'cD', 'mD'], BRAZO_I = ['hI', 'cI', 'mI'];
const PIERNA_D = ['kD', 'rD', 'tD'], PIERNA_I = ['kI', 'rI', 'tI'];
// a qué articulación apunta cada hueso (para la pose de enlace)
const HIJO = { hD: 'cD', cD: 'mD', hI: 'cI', cI: 'mI', kD: 'rD', rD: 'tD', kI: 'rI', rI: 'tI' };

let dat = null, carga = null;
export function cargarCuerpoEscaneado() {
  if (!carga) carga = new GLTFLoader().loadAsync(new URL('../../modelos/piloto_pie.glb', import.meta.url).href)
    .then(preparar).catch(e => { console.warn('cuerpo escaneado no disponible', e); return null; });
  return carga;
}
export const cuerpoEscaneadoListo = () => !!dat;

function preparar(g) {
  let malla = null; g.scene.traverse(o => { if (o.isMesh && !malla) malla = o; });
  let geo = malla.geometry;
  if (geo.attributes._pesos) geo.deleteAttribute('_pesos');
  geo = geo.toNonIndexed();
  const pos = geo.attributes.position;
  const nombres = Object.keys(SEG), p = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
  const dist = (k, q) => {
    const [a, b, r] = SEG[k]; ab.subVectors(b, a); ap.subVectors(q, a);
    const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.lengthSq()));
    return ap.sub(ab.multiplyScalar(t)).length() - r;
  };
  let region = regiones(geo, dist);
  // fuera los triángulos que unen una mano con la cadera o el muslo (se estirarían como láminas)
  {
    const quedan = [];
    for (let t = 0; t < pos.count; t += 3) {
      const a = region[t], b = region[t + 1], c = region[t + 2];
      if ((a === b && b === c) || Math.min(pos.getY(t), pos.getY(t + 1), pos.getY(t + 2)) > 1.25) quedan.push(t);
    }
    geo = conTriangulos(geo, quedan);
    region = Uint8Array.from(quedan.flatMap(t => [region[t], region[t + 1], region[t + 2]]));
  }
  const P = geo.attributes.position, n = P.count;
  const huesoV = new Uint8Array(n * 4), peso = new Float32Array(n * 4), zona = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(P, i);
    const reg = region[i];
    const permitidos = nombres.filter(k => {
      if (BRAZO_D.includes(k)) return reg === 1;
      if (BRAZO_I.includes(k)) return reg === 2;
      if (reg) return k === 'tronco' && p.y > 1.2;                 // el hombro se mezcla con el pecho
      if (PIERNA_D.includes(k)) return p.y < 0.86 && p.z > -0.02;
      if (PIERNA_I.includes(k)) return p.y < 0.86 && p.z < 0.02;
      return true;
    });
    const d = permitidos.map(k => [k, Math.max(0.006, dist(k, p))]).sort((x, y) => x[1] - y[1]).slice(0, 3);
    let s = 0; const w = d.map(([, x]) => { const v = 1 / x ** 4; s += v; return v; });
    d.forEach(([k], j) => { huesoV[i * 4 + j] = nombres.indexOf(k); peso[i * 4 + j] = w[j] / s; });
    const k0 = d[0][0];
    zona[i] = k0 === 'cabeza' && p.y > 1.42 ? 0 : (k0 === 'mD' || k0 === 'mI') ? 2 : p.y < 0.13 ? 3 : 1;
  }
  geo.setAttribute('zona', new THREE.Float32BufferAttribute(zona, 1));
  geo.computeBoundingSphere();
  dat = { geo, huesoV, peso, nombres, mat: malla.material, cache: new Map() };
  return dat;
}

/** Geometría con los pesos en el orden de huesos de una Persona (se cachea por orden). */
export function geometriaParaPersona(ordenHuesos) {
  const clave = ordenHuesos.join(',');
  if (dat.cache.has(clave)) return dat.cache.get(clave);
  const g = dat.geo.clone(), n = g.attributes.position.count;
  const mapa = dat.nombres.map(k => Math.max(0, ordenHuesos.indexOf(k)));
  const idx = new Uint16Array(n * 4);
  for (let i = 0; i < n * 4; i++) idx[i] = mapa[dat.huesoV[i]];
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(dat.peso, 4));
  dat.cache.set(clave, g);
  return g;
}

/**
 * Coloca los huesos de la Persona en las articulaciones del escaneo (posiciones con giro cero,
 * brazos y piernas colgando rectos como espera la Persona) y devuelve la función que los pone en
 * la pose del escaneo para enlazar la malla.
 */
export function colocarHuesos(per) {
  const pon = (h, padre, j) => { per[h].position.copy(J[j]).sub(J[padre]); };
  per.cadera.position.copy(J.cadera);
  pon('tronco', 'cadera', 'tronco'); pon('cuello', 'tronco', 'cuello'); pon('cabeza', 'cuello', 'cabeza');
  for (const l of ['D', 'I']) {
    per['h' + l].position.copy(J['h' + l]).sub(J.tronco);
    per['c' + l].position.set(0, -J['h' + l].distanceTo(J['c' + l]), 0);
    per['m' + l].position.set(0, -J['c' + l].distanceTo(J['m' + l]), 0);
    per['k' + l].position.copy(J['k' + l]).sub(J.cadera);
    per['r' + l].position.set(0, -J['k' + l].distanceTo(J['r' + l]), 0);
    per['t' + l].position.set(0, -J['r' + l].distanceTo(J['t' + l]), 0);
  }
  per.largoMuslo = J.kD.distanceTo(J.rD); per.largoPierna = J.rD.distanceTo(J.tD);
  // pose del escaneo: cada tramo apunta a su articulación siguiente
  return () => {
    for (const h of Object.keys(per)) if (per[h]?.isBone) per[h].rotation.set(0, 0, 0);
    per.cadera.updateMatrixWorld(true);
    const q = new THREE.Quaternion(), abajo = V(0, -1, 0), raizInv = new THREE.Matrix4();
    for (const h of ['hD', 'cD', 'hI', 'cI', 'kD', 'rD', 'kI', 'rI']) {
      const b = per[h];
      // dirección deseada en el espacio del cuerpo (donde están las articulaciones J)
      const dir = J[HIJO[h]].clone().sub(J[h]).normalize();
      raizInv.copy(per.cadera.parent.matrixWorld).invert();
      b.parent.getWorldQuaternion(q);
      const qRaiz = new THREE.Quaternion().setFromRotationMatrix(per.cadera.parent.matrixWorld);
      const local = dir.applyQuaternion(qRaiz).applyQuaternion(q.invert());
      b.quaternion.setFromUnitVectors(abajo, local);
      b.updateMatrixWorld(true);
    }
  };
}

/** Material del cuerpo escaneado: el gris del escaneo teñido por zonas (casco, mono, guantes, botas). */
export function materialCuerpo(traje = '#0d47ff', casco = '#ffffff') {
  const mat = dat.mat.clone();
  mat.metalness = 0; mat.roughness = 0.75;
  const cT = new THREE.Color(traje).lerp(new THREE.Color(0xffffff), 0.12), cC = new THREE.Color(0xffffff).lerp(new THREE.Color(casco), 0.45);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.cTraje = { value: cT }; sh.uniforms.cCasco = { value: cC };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float zona; varying float vZona;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvZona = zona;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 cTraje; uniform vec3 cCasco; varying float vZona;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 tinte = vZona < 0.5 ? cCasco : vZona < 1.5 ? cTraje : vec3(0.13);
        diffuseColor.rgb *= tinte * 1.45;`);
  };
  mat.customProgramCacheKey = () => 'cuerpoEscaneado';
  return mat;
}

// Regiones por distancia sobre la superficie (Dijkstra en la malla soldada): brazo derecho (1),
// brazo izquierdo (2) y resto (0), sembradas lejos de donde se tocan.
function regiones(geo, dist) {
  const pos = geo.attributes.position, n = pos.count;
  const clave = new Map(), id = new Int32Array(n), P = [];
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos.getX(i) * 2e4) + ',' + Math.round(pos.getY(i) * 2e4) + ',' + Math.round(pos.getZ(i) * 2e4);
    let v = clave.get(k); if (v === undefined) { v = P.length; clave.set(k, v); P.push(new THREE.Vector3().fromBufferAttribute(pos, i)); }
    id[i] = v;
  }
  const m = P.length, vec = Array.from({ length: m }, () => []);
  for (let t = 0; t < n; t += 3) for (let e = 0; e < 3; e++) {
    const a = id[t + e], b = id[t + (e + 1) % 3]; if (a === b) continue;
    const l = P[a].distanceTo(P[b]); vec[a].push(b, l); vec[b].push(a, l);
  }
  const d = new Float64Array(m).fill(Infinity), reg = new Uint8Array(m), heap = [];
  const push = (x, v) => { heap.push([x, v]); let i = heap.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } } return top; };
  const cerca = (v, ks) => Math.min(...ks.map(k => dist(k, P[v])));
  for (let v = 0; v < m; v++) {
    const bD = cerca(v, ['hD', 'cD']), bI = cerca(v, ['hI', 'cI']), cuerpo = cerca(v, ['cadera', 'tronco', 'kD', 'kI', 'rD', 'rI']);
    const mD = dist('mD', P[v]), mI = dist('mI', P[v]);
    let r = -1;
    if ((bD < 0.012 && cuerpo > 0.05 && P[v].y > 0.9) || (mD < 0.02 && cuerpo > 0.045)) r = 1;
    else if ((bI < 0.012 && cuerpo > 0.05 && P[v].y > 0.9) || (mI < 0.02 && cuerpo > 0.045)) r = 2;
    else if (cuerpo < 0 && Math.min(bD, bI) > 0.05) r = 0;
    if (r >= 0) { d[v] = 0; reg[v] = r; push(0, v); }
  }
  while (heap.length) {
    const [x, v] = pop(); if (x > d[v]) continue;
    const a = vec[v];
    for (let j = 0; j < a.length; j += 2) { const w = a[j], nd = x + a[j + 1]; if (nd < d[w]) { d[w] = nd; reg[w] = reg[v]; push(nd, w); } }
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const v = id[i]; out[i] = d[v] < Infinity ? reg[v] : (P[v].z > 0.3 && P[v].y > 0.55 ? 1 : P[v].z < -0.2 && P[v].y > 0.75 ? 2 : 0); }
  return out;
}

function conTriangulos(geo, quedan) {
  const out = new THREE.BufferGeometry();
  for (const [nombre, at] of Object.entries(geo.attributes)) {
    const arr = new at.array.constructor(quedan.length * 3 * at.itemSize);
    quedan.forEach((t, k) => { for (let j = 0; j < 3 * at.itemSize; j++) arr[k * 3 * at.itemSize + j] = at.array[t * at.itemSize + j]; });
    out.setAttribute(nombre, new THREE.BufferAttribute(arr, at.itemSize, at.normalized));
  }
  return out;
}
