// Plantilla «Piloto»: piloto de Fórmula 1 de pie, con la mano derecha sujetando el volante y la
// izquierda en la cadera. El cuerpo (mono, guantes y botas) es una sola malla hecha con modelado
// de caja, subdivisión, pintura y escultura (ver cuerpo.js). El casco sale de una esfera editada
// (barbilla, visera recortada de la carcasa, franjas pintadas) y el volante de una caja
// subdividida. Medidas en metros (1,80 m; 1,84 m con casco). Mira hacia +z; x > 0 es su izquierda.
import * as THREE from 'three';
import { caja, barra, cilindroX, tubo, objetoDeMalla } from './forma.js';
import { cuerpoPiloto, ESQUELETO } from './cuerpo.js';
import { mallas } from '../escena.js';
import { MallaHE } from '../malla/mediaArista.js';
import { moverVertices, borrarCaras } from '../malla/operaciones.js';
import { subdividir } from '../malla/subdividir.js';
import { solidificar } from '../malla/modificadores.js';

const NEGRO = 0x17191d, GRIS = 0x3a3e45, CASCO = 0xffd23f, BLANCO = 0xf1f2f4;

export function construirPiloto() {
  const piezas = [];
  const add = (m) => { piezas.push(m); return m; };

  // ---------- mono, guantes y botas: una sola pieza ----------
  const cuerpo = cuerpoPiloto();
  const ref = cuerpo.clone(); // objetoDeMalla centra la malla del objeto: se consulta una copia
  const frente = (x, y) => superficie(ref, x, y, 'z') + 0.006;
  const espalda = (x, y) => -superficie(ref, x, y, '-z') - 0.006;
  const mono = add(objetoDeMalla(cuerpo, 'mono', 0xffffff, mallas));
  mono.material.roughness = 0.75;

  // ---------- arnés: correas delante (al cinturón) y detrás (en X), cinturón y hebilla ----------
  for (const s of [1, -1]) {
    add(tubo(`arnes_correa_${s > 0 ? 'izq' : 'der'}`, NEGRO, [
      [0.11 * s, 1.50, -0.06, 0.028, 0.008], [0.10 * s, 1.47, frente(0.10 * s, 1.47) - 0.02, 0.03, 0.008],
      [0.095 * s, 1.40, frente(0.095 * s, 1.40), 0.03, 0.008], [0.085 * s, 1.30, frente(0.085 * s, 1.30), 0.03, 0.008],
      [0.07 * s, 1.15, frente(0.07 * s, 1.15), 0.03, 0.008], [0.055 * s, 1.03, frente(0.055 * s, 1.03), 0.03, 0.008],
    ]));
    add(caja(`arnes_ajuste_${s > 0 ? 'izq' : 'der'}`, [0.07, 0.03, 0.012], [0.09 * s, 1.34, frente(0.09 * s, 1.34) + 0.006], [-6, 0, 0], GRIS));
    add(tubo(`arnes_espalda_${s > 0 ? 'izq' : 'der'}`, NEGRO, [
      [0.11 * s, 1.50, -0.06, 0.028, 0.008], [0.09 * s, 1.40, espalda(0.09 * s, 1.40), 0.03, 0.008],
      [0.0, 1.26, espalda(0, 1.26) - 0.002, 0.03, 0.008], [-0.08 * s, 1.08, espalda(-0.08 * s, 1.08), 0.03, 0.008],
    ]));
  }
  const zc = frente(0, 1.0);
  add(tubo('cinturon', NEGRO, contorno(ref, 1.0, 40, 0.009).map((p) => [...p, 0.008, 0.024]), { sub: 1 })); // cinta vertical pegada al cuerpo
  add(cilindroX('hebilla', [0, 1.0, zc + 0.008], 0.042, 0.025, GRIS)).rotation.set(0, Math.PI / 2, Math.PI / 2);
  add(cilindroX('hebilla_centro', [0, 1.0, zc + 0.022], 0.02, 0.008, BLANCO)).rotation.set(0, Math.PI / 2, Math.PI / 2);
  add(tubo('arnes_entrepierna', NEGRO, [[0, 0.98, frente(0, 0.98), 0.02, 0.008], [0, 0.90, frente(0, 0.90), 0.02, 0.008]], { sub: 1 }));

  // ---------- casco y HANS ----------
  piezas.push(...casco());
  add(tubo('hans_collarin', GRIS, anillo(0, 1.505, -0.02, 0.15, 0.12, 20).filter(([, , z]) => z < 0.06).map((p) => [...p, 0.035, 0.018]), { sub: 2 }));
  add(caja('hans_placa', [0.16, 0.13, 0.025], [0, 1.57, -0.135], [-12, 0, 0], GRIS));
  for (const s of [1, -1]) add(barra(`hans_correa_${s > 0 ? 'izq' : 'der'}`, [0.08 * s, 1.60, -0.13], [0.12 * s, 1.62, -0.02], 0.008, NEGRO));

  // ---------- volante en la mano derecha ----------
  piezas.push(...volante());
  return piezas;
}

// Casco: esfera editada (alargada, barbilla hacia delante, base plana), franjas pintadas por
// vértice; visera = la ventana de la carcasa, recortada (borrar caras), un poco por fuera y con
// grosor (solidificar); alerón, toma de aire y pivotes de la visera.
function casco() {
  const C = new THREE.Vector3(0, 1.69, 0.005);
  const g = new THREE.SphereGeometry(0.5, 48, 32);
  const forma = ([x, y, z]) => {
    const X = x * 0.27; let Y = y * 0.29, Z = z * 0.31;
    if (Y < -0.03 && Z > -0.05) { const k = Math.min(1, (-0.03 - Y) / 0.12); Z += k * 0.05; Y -= k * 0.015; } // barbilla
    if (Y < -0.12) Y = -0.12 + (Y + 0.12) * 0.35;                                                          // base más plana
    if (Z < -0.08 && Y < -0.02) Y -= 0.02 * Math.min(1, (-0.08 - Z) / 0.06);                                 // nuca algo más baja
    return [X, Y, Z];
  };
  const esfera = () => MallaHE.desdeTriangulos(g.attributes.position.array, g.index.array, { uvs: g.attributes.uv.array });
  const m = moverVertices(esfera(), [...Array(esfera().nV).keys()], (p) => forma(p)).malla;
  // franjas: amarillo con franja central blanca y filetes negros, y la base negra
  const col = [], am = new THREE.Color(CASCO), bl = new THREE.Color(BLANCO), ng = new THREE.Color(NEGRO);
  for (let h = 0; h < m.nHE; h++) {
    const v = m.heV[h], x = m.pos[v * 3], y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2];
    let c = am;
    if (y > 0.02 && Math.abs(x) < 0.022) c = bl;
    else if (y > 0.02 && Math.abs(x) < 0.034) c = ng;
    else if (y < -0.105) c = ng;
    col.push(c.r, c.g, c.b);
  }
  m.heCol = col;
  const cascoObj = objetoDeMalla(m, 'casco', 0xffffff, mallas);
  cascoObj.position.add(C);
  Object.assign(cascoObj.material, { roughness: 0.25, metalness: 0.1 });
  // visera: la ventana delantera de una carcasa igual, un 2 % mayor, con grosor
  let v = moverVertices(esfera(), [...Array(esfera().nV).keys()], (p) => forma(p).map((q) => q * 1.02)).malla;
  const fuera = [];
  for (let f = 0; f < v.nF; f++) {
    const vs = v.vertsDeCara(f), c = [0, 1, 2].map((d) => vs.reduce((s, q) => s + v.pos[q * 3 + d], 0) / vs.length);
    if (!(c[2] > 0 && Math.abs(Math.atan2(c[0], c[2])) < 1.05 && c[1] > -0.035 && c[1] < 0.055)) fuera.push(f);
  }
  v = solidificar(borrarCaras(v, fuera).malla, 0.006);
  const visera = objetoDeMalla(v, 'visera', 0x101c2e, mallas);
  visera.position.add(C);
  Object.assign(visera.material, { roughness: 0.05, metalness: 0.6 });
  const piezas = [cascoObj, visera,
    caja('casco_aleron', [0.15, 0.022, 0.09], [C.x, C.y + 0.135, C.z - 0.085], [14, 0, 0], NEGRO),
    caja('casco_aleron_lat_izq', [0.012, 0.05, 0.08], [C.x + 0.075, C.y + 0.12, C.z - 0.085], [14, 0, 0], NEGRO),
    caja('casco_aleron_lat_der', [0.012, 0.05, 0.08], [C.x - 0.075, C.y + 0.12, C.z - 0.085], [14, 0, 0], NEGRO),
    caja('casco_toma_aire', [0.07, 0.02, 0.05], [C.x, C.y + 0.135, C.z + 0.07], [-25, 0, 0], NEGRO),
  ];
  for (const s of [1, -1]) piezas.push(cilindroX(`visera_pivote_${s > 0 ? 'izq' : 'der'}`, [C.x + 0.137 * s, C.y + 0.005, C.z + 0.02], 0.016, 0.012, NEGRO));
  return piezas;
}

// Volante: caja de 3 × 2 cortes con el centro de abajo recogido y subdividida (cuerpo
// redondeado), con agarres, pantalla, botones, selectores y levas detrás. Cuelga de la mano
// derecha por un agarre; la cara mira hacia delante y hacia fuera.
function volante() {
  const mano = ESQUELETO.MANO_DER[1];
  const ang = 45, cara = new THREE.Vector3(-Math.SQRT1_2, 0, Math.SQRT1_2), ancho = new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2);
  const C = new THREE.Vector3(mano[0], mano[1] - 0.085, mano[2]).addScaledVector(ancho, -0.105);
  const en = (dn, dw, dy) => C.clone().addScaledVector(cara, dn).addScaledVector(ancho, dw).add(new THREE.Vector3(0, dy, 0)).toArray();
  const g = new THREE.BoxGeometry(0.27, 0.165, 0.05, 3, 2, 1);
  let m = MallaHE.desdeTriangulos(g.attributes.position.array, g.index.array, { uvs: g.attributes.uv.array });
  m = moverVertices(m, [...Array(m.nV).keys()], ([x, y, z]) => [x, y < -0.05 && Math.abs(x) < 0.05 ? y + 0.035 : y, z]).malla;
  m = subdividir(m, 2).malla;
  const cuerpo = objetoDeMalla(m, 'volante', NEGRO, mallas);
  cuerpo.position.copy(C);
  cuerpo.rotation.y = -ang * Math.PI / 180; // la caja mira hacia +z: girada, su cara mira hacia delante y fuera
  Object.assign(cuerpo.material, { roughness: 0.4, metalness: 0.2 });
  const giro = [0, ang, 0], piezas = [cuerpo];
  piezas.push(caja('volante_pantalla', [0.012, 0.065, 0.1], en(0.027, 0, 0.025), giro, 0x1f6fff));
  for (const dw of [-0.112, 0.112]) piezas.push(barra(`volante_agarre_${dw < 0 ? 'a' : 'b'}`, en(-0.004, dw, 0.075), en(-0.004, dw, -0.075), 0.024, 0x26282d));
  const tonos = [0xffd23f, 0xff3b3b, 0x2fe07a, BLANCO, 0x2f7bff, 0xff7a2f];
  for (let i = 0; i < 8; i++) {
    const b = cilindroX(`volante_boton_${i}`, en(0.028, (i % 2 ? 1 : -1) * 0.07, -0.045 + Math.floor(i / 2) * 0.024), 0.0085, 0.012, tonos[i % tonos.length]);
    b.rotation.set(0, ang * Math.PI / 180, Math.PI / 2);
    piezas.push(b);
  }
  for (const dw of [-0.035, 0.035]) {
    const s = cilindroX(`volante_selector_${dw < 0 ? 'a' : 'b'}`, en(0.03, dw, -0.035), 0.016, 0.014, GRIS);
    s.rotation.set(0, ang * Math.PI / 180, Math.PI / 2);
    piezas.push(s);
  }
  for (const dw of [-0.06, 0.06]) piezas.push(caja(`volante_leva_${dw < 0 ? 'a' : 'b'}`, [0.006, 0.07, 0.05], en(-0.034, dw, 0.03), giro, 0x8a8f99));
  return piezas;
}

// Punto más saliente del cuerpo cerca de (x, y): 'z' = delante (máximo z), '-z' = espalda
// (máximo −z), 'x' = el costado (máximo |x| a esa altura).
function superficie(m, x, y, eje, ventana = 0.025) {
  let mejor = -Infinity;
  for (let v = 0; v < m.nV; v++) {
    const px = m.pos[v * 3], py = m.pos[v * 3 + 1], pz = m.pos[v * 3 + 2];
    if (Math.abs(py - y) > ventana) continue;
    if (eje === 'z') { if (Math.abs(px - x) < ventana * 1.2 && pz > mejor) mejor = pz; }
    else if (eje === '-z') { if (Math.abs(px - x) < ventana * 1.2 && -pz > mejor) mejor = -pz; }
    else if (Math.abs(pz) < 0.06 && Math.abs(px) < 0.185 && Math.abs(px) > mejor) mejor = Math.abs(px); // sin las manos
  }
  return Number.isFinite(mejor) ? mejor : ventana < 0.2 ? superficie(m, x, y, eje, ventana * 2) : 0;
}

// Contorno del cuerpo a la altura y (sin las manos): por cada ángulo, el vértice más alejado del
// eje; separado `aire` hacia fuera y suavizado. Cerrado.
function contorno(m, y, n, aire) {
  const r = new Array(n).fill(0);
  for (let v = 0; v < m.nV; v++) {
    const px = m.pos[v * 3], py = m.pos[v * 3 + 1], pz = m.pos[v * 3 + 2];
    if (Math.abs(py - y) > 0.02 || Math.abs(px) > 0.19) continue;
    const k = Math.round(((Math.atan2(px, pz) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * n) % n;
    r[k] = Math.max(r[k], Math.hypot(px, pz));
  }
  for (let k = 0; k < n; k++) if (!r[k]) r[k] = r[(k + n - 1) % n] || r[(k + 1) % n];
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const i = k % n, rr = (r[(i + n - 1) % n] + 2 * r[i] + r[(i + 1) % n]) / 4 + aire, a = (i / n) * Math.PI * 2;
    pts.push([Math.sin(a) * rr, y, Math.cos(a) * rr]);
  }
  return pts;
}

// Puntos de un óvalo horizontal (cinturón, collarín), cerrado. e > 2 lo hace más cuadrado
// (superelipse), como la sección del torso.
function anillo(cx, y, cz, rx, rz, n, e = 2) {
  const pts = [], f = (t) => Math.sign(t) * Math.abs(t) ** (2 / e);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + f(Math.sin(a)) * rx, y, cz + f(Math.cos(a)) * rz]);
  }
  return pts;
}
