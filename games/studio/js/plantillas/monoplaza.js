// Plantilla «Monoplaza F1»: un coche de Fórmula 1 (reglamento 2022+) modelado pieza a pieza con
// las herramientas de Studio: primitivas con segmentos, mover, girar, escalar, color y edición de
// vértices (dar forma por secciones, como un «loft» de Blender). Medidas en metros, tomadas de
// planos de lado, frente, atrás y arriba: batalla 3,62 m, largo 5,58 m, ancho 2,00 m, ruedas de
// 0,72 m. Ejes: x = ancho (x > 0 a la izquierda del piloto), y = alto, z = largo con el morro
// hacia +z. Las piezas llevan los nombres que entiende APEX GP (rueda_del_izq, aleron_trasero…).
import * as THREE from 'three';
import { D2R, material, centrar, pieza, caja, esfera, cilindroX, barra, loft } from './forma.js';

const ROJO = 0xd8141f, CARBONO = 0x17191d, BLANCO = 0xf1f2f4, GOMA = 0x101113, LLANTA = 0x2b2e34, ORO = 0xc9a227, CASCO = 0xffd23f;

const BATALLA = 3.62, EJE_DEL = BATALLA / 2, EJE_TRA = -BATALLA / 2;

export function construirMonoplaza() {
  const piezas = [];
  const add = (m) => { piezas.push(m); return m; };

  // ---------- carrocería: secciones transversales (z, centro x, centro y, semiancho, semialto) ----------
  // Morro + chasis: de la punta (sobre el alerón) a la parte de atrás del cockpit.
  add(loft('morro_chasis', ROJO, [
    [3.04, 0, 0.215, 0.09, 0.045],
    [2.58, 0, 0.27, 0.14, 0.095],
    [2.20, 0, 0.385, 0.18, 0.135],
    [1.80, 0, 0.49, 0.23, 0.16],
    [1.30, 0, 0.54, 0.30, 0.21],
    [0.90, 0, 0.545, 0.34, 0.225],
    [0.10, 0, 0.55, 0.34, 0.23],
  ], 2.6));
  // Cubierta del motor: de la toma de aire a la caja de cambios.
  add(loft('cubierta_motor', ROJO, [
    [0.12, 0, 0.70, 0.22, 0.36],
    [-0.55, 0, 0.69, 0.23, 0.34],
    [-1.00, 0, 0.62, 0.21, 0.27],
    [-1.45, 0, 0.55, 0.17, 0.20],
    [-1.90, 0, 0.475, 0.12, 0.125],
    [-2.18, 0, 0.43, 0.075, 0.07],
  ], 2.3));
  // Pontones (izquierdo y derecho): entrada de aire delante y forma de botella de Coca-Cola atrás.
  for (const s of [1, -1]) {
    add(loft(`ponton_${s > 0 ? 'izq' : 'der'}`, ROJO, [
      [0.98, 0.52 * s, 0.42, 0.19, 0.17],
      [0.72, 0.55 * s, 0.40, 0.23, 0.22],
      [0.20, 0.55 * s, 0.38, 0.23, 0.24],
      [-0.40, 0.50 * s, 0.34, 0.20, 0.21],
      [-0.90, 0.40 * s, 0.30, 0.14, 0.16],
      [-1.38, 0.27 * s, 0.26, 0.07, 0.10],
    ], 2.4));
    // boca de la entrada de aire (negra) en la cara delantera
    add(caja(`entrada_aire_${s > 0 ? 'izq' : 'der'}`, [0.26, 0.17, 0.02], [0.52 * s, 0.43, 0.982], [0, 0, 0], CARBONO));
  }
  // Fondo plano y difusor (carbono).
  add(loft('fondo', CARBONO, [
    [1.25, 0, 0.045, 0.42, 0.018],
    [0.85, 0, 0.045, 0.78, 0.018],
    [-1.20, 0, 0.045, 0.80, 0.018],
    [-1.62, 0, 0.05, 0.62, 0.018],
  ], 8));
  add(caja('difusor', [0.98, 0.025, 0.55], [0, 0.17, -2.12], [24, 0, 0], CARBONO));
  for (const s of [1, -1]) add(caja(`difusor_valla_${s > 0 ? 'izq' : 'der'}`, [0.02, 0.22, 0.5], [0.48 * s, 0.14, -2.1], [0, 0, 0], CARBONO));

  // ---------- cockpit, halo, toma de aire, retrovisores, piloto ----------
  add(caja('cockpit_hueco', [0.46, 0.03, 0.78], [0, 0.775, 0.52], [0, 0, 0], CARBONO));
  add(esfera('casco_piloto', 0.135, [0, 0.82, 0.38], CASCO));
  add(caja('visera', [0.20, 0.05, 0.02], [0, 0.84, 0.51], [0, 0, 0], CARBONO));
  add(halo());
  add(barra('halo_pilar', [0, 0.77, 1.10], [0, 0.94, 1.0], 0.03, CARBONO));
  for (const s of [1, -1]) add(barra(`halo_anclaje_${s > 0 ? 'izq' : 'der'}`, [0.30 * s, 0.74, 0.20], [0.28 * s, 0.83, 0.27], 0.03, CARBONO));
  // toma de aire sobre la cabeza del piloto: redondeada, con la boca negra
  add(loft('toma_aire', ROJO, [
    [0.17, 0, 1.06, 0.12, 0.12],
    [0.05, 0, 1.06, 0.15, 0.15],
    [-0.12, 0, 1.00, 0.15, 0.17],
    [-0.30, 0, 0.92, 0.13, 0.16],
  ], 3));
  add(loft('toma_aire_boca', CARBONO, [
    [0.178, 0, 1.065, 0.09, 0.085],
    [0.172, 0, 1.065, 0.09, 0.085],
  ], 3, 1));
  add(barra('camara_mastil', [0, 1.18, 0.0], [0, 1.30, 0.0], 0.015, CARBONO));
  add(caja('camara_t', [0.34, 0.035, 0.07], [0, 1.31, 0.0], [0, 0, 0], CARBONO));
  for (const s of [1, -1]) {
    add(caja(`retrovisor_${s > 0 ? 'izq' : 'der'}`, [0.15, 0.065, 0.045], [0.62 * s, 0.74, 0.82], [0, 0, 0], CARBONO));
    add(barra(`retrovisor_brazo_${s > 0 ? 'izq' : 'der'}`, [0.33 * s, 0.66, 0.86], [0.56 * s, 0.73, 0.83], 0.012, CARBONO));
  }

  // ---------- alerón delantero ----------
  add(caja('aleron_delantero_plano', [1.90, 0.025, 0.34], [0, 0.085, 2.80], [5, 0, 0], CARBONO));
  add(caja('aleron_delantero_flap1', [1.82, 0.02, 0.22], [0, 0.15, 2.57], [18, 0, 0], BLANCO));
  add(caja('aleron_delantero_flap2', [1.74, 0.02, 0.17], [0, 0.225, 2.42], [30, 0, 0], ROJO));
  for (const s of [1, -1]) {
    add(caja(`aleron_delantero_deriva_${s > 0 ? 'izq' : 'der'}`, [0.02, 0.21, 0.44], [0.965 * s, 0.15, 2.64], [0, 0, 0], CARBONO));
    add(barra(`morro_soporte_${s > 0 ? 'izq' : 'der'}`, [0.05 * s, 0.19, 2.75], [0.06 * s, 0.10, 2.78], 0.012, CARBONO));
  }

  // ---------- alerón trasero ----------
  add(caja('aleron_trasero_plano', [1.12, 0.03, 0.30], [0, 0.885, -2.33], [8, 0, 0], CARBONO));
  add(caja('aleron_trasero_flap', [1.12, 0.025, 0.21], [0, 0.99, -2.18], [28, 0, 0], ROJO));
  add(caja('aleron_trasero_viga', [0.92, 0.02, 0.18], [0, 0.42, -2.30], [6, 0, 0], CARBONO));
  for (const s of [1, -1]) add(caja(`aleron_trasero_deriva_${s > 0 ? 'izq' : 'der'}`, [0.02, 0.56, 0.50], [0.57 * s, 0.78, -2.27], [0, 0, 0], CARBONO));
  add(caja('aleron_trasero_pilar', [0.035, 0.45, 0.09], [0, 0.70, -2.12], [12, 0, 0], CARBONO));
  add(caja('luz_lluvia', [0.08, 0.06, 0.02], [0, 0.30, -2.47], [0, 0, 0], 0xff3333));

  // ---------- ruedas y suspensión ----------
  const ruedas = [
    ['del', EJE_DEL, 0.34, 0.83],
    ['tra', EJE_TRA, 0.405, 0.80],
  ];
  for (const [eje, z, ancho, via] of ruedas) {
    for (const s of [1, -1]) {
      const lado = s > 0 ? 'izq' : 'der', x = via * s;
      add(rueda(`rueda_${eje}_${lado}`, [x, 0.36, z], 0.36, ancho));
      add(cilindroX(`rueda_${eje}_${lado}_llanta`, [x + s * (ancho / 2 + 0.002), 0.36, z], 0.235, 0.012, LLANTA));
      add(cilindroX(`rueda_${eje}_${lado}_tuerca`, [x + s * (ancho / 2 + 0.02), 0.36, z], 0.05, 0.04, ORO));
      // trapecios superior e inferior (dos brazos cada uno) y empujador
      const cubo = x - s * (ancho / 2 - 0.05);
      const xi = eje === 'del' ? 0.17 * s : 0.22 * s;
      add(barra(`susp_${eje}_${lado}_sup_a`, [xi, 0.52, z + 0.22], [cubo, 0.50, z], 0.013, CARBONO));
      add(barra(`susp_${eje}_${lado}_sup_b`, [xi, 0.50, z - 0.22], [cubo, 0.50, z], 0.013, CARBONO));
      add(barra(`susp_${eje}_${lado}_inf_a`, [xi, 0.30, z + 0.25], [cubo, 0.22, z], 0.013, CARBONO));
      add(barra(`susp_${eje}_${lado}_inf_b`, [xi, 0.28, z - 0.25], [cubo, 0.22, z], 0.013, CARBONO));
      add(barra(`susp_${eje}_${lado}_empujador`, [xi, 0.58, z - 0.05], [cubo, 0.24, z + 0.02], 0.012, CARBONO));
      // conducto de freno (tapa de la rueda por dentro)
      add(caja(`freno_${eje}_${lado}`, [0.05, 0.22, 0.26], [x - s * (ancho / 2 + 0.03), 0.36, z], [0, 0, 0], CARBONO));
    }
  }
  return piezas;
}

// Neumático: cilindro de 40 lados con los cantos redondeados editando sus vértices (los de los
// bordes se recogen hacia dentro, como el hombro de un neumático de carreras).
function rueda(nombre, pos, r, ancho) {
  const m = pieza('cilindro', nombre, GOMA, { radiales: 40, segmentos: 6 });
  m.material = material(GOMA, 0.85, 0);
  const p = m.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), x = p.getX(i), z = p.getZ(i);  // y de 0 a 1 (eje), x, z en el radio 0,5
    const t = Math.abs(y - 0.5) * 2;                     // 0 en el centro de la banda, 1 en el flanco
    const rad = Math.hypot(x, z);
    const hombro = 1 - 0.14 * Math.max(0, (t - 0.55) / 0.45) ** 2; // radio menor cerca de los flancos
    const k = rad > 1e-6 ? hombro : 1;
    p.setXYZ(i, x * k, y, z * k);
  }
  m.geometry.computeVertexNormals();
  centrar(m);
  m.position.set(...pos);
  m.scale.set(r * 2, ancho, r * 2);
  m.rotation.z = Math.PI / 2;
  return m;
}

// Halo: toro cuyo tubo se adelgaza editando los vértices (cada uno se acerca al centro de su
// anillo), escalado a un óvalo y apoyado sobre el cockpit.
function halo() {
  const m = pieza('toro', 'halo', CARBONO, { radiales: 64, anillos: 12 });
  const p = m.geometry.attributes.position;
  m.geometry.computeBoundingBox();
  const y0 = (m.geometry.boundingBox.min.y + m.geometry.boundingBox.max.y) / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i) - y0, z = p.getZ(i), rad = Math.hypot(x, z);
    const cxr = (x / rad) * 0.4, czr = (z / rad) * 0.4, k = 0.03 / 0.15; // tubo de 3 cm
    p.setXYZ(i, cxr + (x - cxr) * k, y0 + y * k, czr + (z - czr) * k);
  }
  m.geometry.computeVertexNormals();
  centrar(m);
  m.position.set(0, 0.885, 0.62);
  m.scale.set(0.30 / 0.4, 1, 0.38 / 0.4);
  m.rotation.x = -9 * D2R; // más alto delante, baja hacia los anclajes de atrás
  return m;
}
