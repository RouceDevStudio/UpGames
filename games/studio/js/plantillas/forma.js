// Herramientas de forma de las plantillas: piezas hechas con las primitivas de Studio, colocadas,
// giradas, escaladas y con los vértices editados (loft por secciones, tubo por articulaciones).
import * as THREE from 'three';
import { crearPrimitiva } from '../primitivas.js';
import { aGeometria } from '../malla/aGeometria.js';

export const D2R = Math.PI / 180;

export function material(color, rugosidad = 0.45, metal = 0.1) {
  return new THREE.MeshStandardMaterial({ color, roughness: rugosidad, metalness: metal });
}

// Deja el origen del objeto en el centro de su geometría (para girarlo y moverlo desde ahí).
export function centrar(m) {
  m.geometry.computeBoundingBox();
  const c = m.geometry.boundingBox.getCenter(new THREE.Vector3());
  m.geometry.translate(-c.x, -c.y, -c.z);
  m.position.copy(c);
  m.geometry.computeBoundingSphere();
  return m;
}

export function pieza(tipo, nombre, color, opciones) {
  const m = crearPrimitiva(tipo, opciones);
  m.name = nombre;
  m.material = material(color);
  m.userData.tipo = tipo;
  return m;
}

// Caja centrada en pos, de tamaño tam, girada rot (grados) en x, y, z. En x > 0 el borde de
// delante (+z) baja: los alerones de un F1 llevan el borde de salida más alto.
export function caja(nombre, tam, pos, rot, color) {
  const m = centrar(pieza('cubo', nombre, color));
  m.position.set(...pos);
  m.scale.set(...tam);
  m.rotation.set(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R);
  return m;
}

export function esfera(nombre, r, pos, color) {
  const m = centrar(pieza('esfera', nombre, color));
  m.position.set(...pos);
  m.scale.setScalar(r * 2);
  return m;
}

// Cilindro con el eje en x (llantas, tuercas).
export function cilindroX(nombre, pos, r, largo, color) {
  const m = centrar(pieza('cilindro', nombre, color));
  m.position.set(...pos);
  m.scale.set(r * 2, largo, r * 2);
  m.rotation.z = Math.PI / 2;
  return m;
}

// Barra (cilindro fino) de p1 a p2: girada para apuntar de un punto al otro.
export function barra(nombre, p1, p2, r, color) {
  const m = centrar(pieza('cilindro', nombre, color, { radiales: 10 }));
  const a = new THREE.Vector3(...p1), b = new THREE.Vector3(...p2), d = b.clone().sub(a);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.scale.set(r * 2, d.length(), r * 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

// Loft: un cilindro con un segmento por sección, deformado para que cada anillo sea la sección
// dada (superelipse de exponente n: 2 = elipse, más alto = más cuadrada). Entre secciones se
// interpola con Catmull-Rom para que la superficie quede curva y suave.
export function loft(nombre, color, secciones, n = 2.5, sub = 4) {
  const S = suavizar(secciones, sub);
  const m = pieza('cilindro', nombre, color, { radiales: 40, segmentos: S.length - 1 });
  const p = m.geometry.attributes.position, filas = S.length - 1;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), x = p.getX(i) * 2, z = p.getZ(i) * 2; // x, z en el círculo unidad
    const fila = Math.round(y * filas);
    const [sz, cx, cy, rx, ry] = S[filas - fila];          // y = 0 es la última sección (la de atrás)
    const r = Math.hypot(x, z);
    const ux = r > 1e-6 ? Math.sign(x) * Math.abs(x) ** (2 / n) : 0;
    const uz = r > 1e-6 ? Math.sign(z) * Math.abs(z) ** (2 / n) : 0;
    p.setXYZ(i, cx + rx * ux, cy - ry * uz, sz); // (x, y, z) → (x, −z, y): giro, no espejo
  }
  m.geometry.computeVertexNormals();
  return centrar(m);
}

export function suavizar(sec, sub) {
  const out = [];
  for (let i = 0; i < sec.length - 1; i++) {
    const p0 = sec[Math.max(0, i - 1)], p1 = sec[i], p2 = sec[i + 1], p3 = sec[Math.min(sec.length - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      out.push(p1.map((_, j) => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(sec[sec.length - 1].slice());
  return out;
}


// Elipsoide (esfera escalada distinto en cada eje) centrado en pos y girado rot (grados).
export function elipsoide(nombre, tam, pos, rot, color) {
  const m = centrar(pieza('esfera', nombre, color));
  m.position.set(...pos);
  m.scale.set(...tam);
  m.rotation.set(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R);
  return m;
}

// Tubo que sigue una línea de articulaciones (brazos, piernas, torso, correas): un cilindro con un
// segmento por punto cuyos anillos se colocan en cada punto, perpendiculares al recorrido y con su
// grosor. Puntos: [x, y, z, r] o [x, y, z, rLado, rFrente] (sección elíptica). Los marcos se
// transportan a lo largo de la línea para que el tubo no se retuerza.
export function tubo(nombre, color, puntos, { sub = 4, radiales = 24 } = {}) {
  const P = suavizar(puntos.map((p) => (p.length === 4 ? [...p, p[3]] : p)), sub);
  const m = pieza('cilindro', nombre, color, { radiales, segmentos: P.length - 1 });
  const v = (i) => new THREE.Vector3(P[i][0], P[i][1], P[i][2]);
  const T = P.map((_, i) => v(Math.min(P.length - 1, i + 1)).sub(v(Math.max(0, i - 1))).normalize());
  const ref = Math.abs(T[0].x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const N = [ref.clone().addScaledVector(T[0], -ref.dot(T[0])).normalize()];
  for (let i = 1; i < P.length; i++) N.push(N[i - 1].clone().addScaledVector(T[i], -N[i - 1].dot(T[i])).normalize());
  const B = N.map((n, i) => n.clone().cross(T[i])); // (N, T, B) a derechas: el tubo no queda del revés
  const p = m.geometry.attributes.position, filas = P.length - 1;
  for (let k = 0; k < p.count; k++) {
    const i = Math.round(p.getY(k) * filas), ux = p.getX(k) * 2, uz = p.getZ(k) * 2;
    const c = v(i).addScaledVector(N[i], ux * P[i][3]).addScaledVector(B[i], uz * P[i][4]);
    p.setXYZ(k, c.x, c.y, c.z);
  }
  m.geometry.computeVertexNormals();
  return centrar(m);
}

// Objeto de Studio a partir de una malla de media arista (queda registrada para el modo Editar).
export function objetoDeMalla(malla, nombre, color, mallas) {
  const r = aGeometria(malla);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.posiciones, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(r.normales, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(r.uvs, 2));
  if (r.colores) g.setAttribute('color', new THREE.BufferAttribute(r.colores, 3));
  g.setIndex(new THREE.BufferAttribute(r.indices, 1));
  g.userData.triCara = r.triCara;
  const m = new THREE.Mesh(g, material(r.colores ? 0xffffff : color, 0.6, 0.05));
  m.material.vertexColors = !!r.colores; // pintada por vértice
  m.name = nombre;
  m.castShadow = true; m.receiveShadow = true;
  m.userData.tipo = 'malla';
  if (mallas) mallas.set(m, malla);
  return centrarConMalla(m, malla);
}

// Como centrar(), pero moviendo también la malla de media arista para que sigan iguales.
function centrarConMalla(m, malla) {
  m.geometry.computeBoundingBox();
  const c = m.geometry.boundingBox.getCenter(new THREE.Vector3());
  m.geometry.translate(-c.x, -c.y, -c.z);
  for (let v = 0; v < malla.nV; v++) { malla.pos[v * 3] -= c.x; malla.pos[v * 3 + 1] -= c.y; malla.pos[v * 3 + 2] -= c.z; }
  m.position.copy(c);
  m.geometry.computeBoundingSphere();
  return m;
}
