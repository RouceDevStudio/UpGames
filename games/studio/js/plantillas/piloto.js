// Plantilla «Piloto»: piloto de Fórmula 1 de pie, con la mano derecha sujetando el volante y la
// izquierda en la cadera. Modelado con las herramientas de Studio: tubos por articulaciones
// (piernas, brazos, torso, correas), elipsoides (casco, manos, hombros), loft (botas) y cajas.
// Medidas en metros (1,80 m de alto, 1,84 m con casco). Mira hacia +z; x > 0 es su izquierda.
import { caja, barra, cilindroX, elipsoide, loft, tubo } from './forma.js';

const MONO = 0xd8141f, NEGRO = 0x17191d, GRIS = 0x3a3e45, CASCO = 0xffd23f, BLANCO = 0xf1f2f4, VISERA = 0x0d1a2b;

export function construirPiloto() {
  const piezas = [];
  const add = (m) => { piezas.push(m); return m; };

  // ---------- piernas: cadera → rodilla → tobillo ----------
  const piernas = { der: [[-0.10, 0.93, 0.0], [-0.115, 0.70, 0.02], [-0.125, 0.50, 0.035], [-0.13, 0.30, 0.0], [-0.135, 0.11, -0.01]],
                    izq: [[0.10, 0.93, 0.0], [0.12, 0.70, 0.01], [0.135, 0.50, 0.02], [0.15, 0.30, -0.01], [0.165, 0.11, -0.03]] };
  const grosorPierna = [[0.095, 0.10], [0.078, 0.085], [0.06, 0.065], [0.058, 0.064], [0.045, 0.05]];
  for (const [lado, pts] of Object.entries(piernas)) {
    add(tubo(`pierna_${lado}`, MONO, pts.map((p, i) => [...p, ...grosorPierna[i]])));
    // rodillera (costura del mono)
    const [x, , z] = pts[2];
    add(elipsoide(`rodilla_${lado}`, [0.11, 0.09, 0.07], [x, 0.51, z + 0.035], [0, 0, 0], MONO));
    // bota: loft a lo largo del pie, con suela negra
    const [ax, , az] = pts[4];
    add(loft(`bota_${lado}`, NEGRO, [
      [az + 0.20, ax, 0.035, 0.035, 0.03],
      [az + 0.13, ax, 0.05, 0.048, 0.045],
      [az + 0.03, ax, 0.075, 0.05, 0.07],
      [az - 0.06, ax, 0.08, 0.045, 0.075],
    ], 2.4));
    add(tubo(`bota_cana_${lado}`, NEGRO, [[ax, 0.06, az - 0.01, 0.05, 0.055], [ax, 0.17, az - 0.01, 0.047, 0.052]], { sub: 1 }));
    add(caja(`suela_${lado}`, [0.10, 0.015, 0.29], [ax, 0.008, az + 0.065], [0, 0, 0], GRIS));
  }

  // ---------- torso: de la pelvis al cuello (secciones horizontales) ----------
  add(tubo('torso', MONO, [
    [0, 0.86, 0, 0.165, 0.115],
    [0, 0.95, 0, 0.18, 0.125],
    [0, 1.05, 0.005, 0.16, 0.115],
    [0, 1.22, 0.01, 0.185, 0.13],
    [0, 1.36, 0.0, 0.20, 0.125],
    [0, 1.45, -0.01, 0.17, 0.105],
    [0, 1.50, -0.01, 0.075, 0.07],
  ]));
  for (const s of [1, -1]) add(elipsoide(`hombro_${s > 0 ? 'izq' : 'der'}`, [0.13, 0.12, 0.13], [0.195 * s, 1.43, -0.005], [0, 0, 0], MONO));
  // cuello alto del mono
  add(tubo('cuello', MONO, [[0, 1.48, -0.005, 0.07, 0.068], [0, 1.56, 0.0, 0.062, 0.06]], { sub: 1 }));

  // ---------- arnés: dos correas del hombro al cinturón, cinturón y hebilla ----------
  for (const s of [1, -1]) {
    add(tubo(`arnes_correa_${s > 0 ? 'izq' : 'der'}`, NEGRO, [
      [0.11 * s, 1.49, -0.06, 0.028, 0.008], [0.10 * s, 1.44, 0.115, 0.03, 0.008], [0.085 * s, 1.30, 0.137, 0.03, 0.008],
      [0.07 * s, 1.15, 0.128, 0.03, 0.008], [0.055 * s, 1.03, 0.122, 0.03, 0.008],
    ]));
    add(caja(`arnes_ajuste_${s > 0 ? 'izq' : 'der'}`, [0.07, 0.03, 0.012], [0.093 * s, 1.34, 0.14], [-6, 0, 0], GRIS));
  }
  add(tubo('cinturon', NEGRO, anillo(0, 1.00, 0.0, 0.175, 0.128, 24).map((p) => [...p, 0.022, 0.008]), { sub: 1 }));
  add(cilindroX('hebilla', [0, 1.0, 0.133], 0.04, 0.025, GRIS)).rotation.set(0, Math.PI / 2, Math.PI / 2);
  add(tubo('arnes_entrepierna', NEGRO, [[0, 0.98, 0.125, 0.02, 0.008], [0, 0.90, 0.12, 0.02, 0.008]], { sub: 1 }));

  // ---------- brazo derecho: cuelga y sujeta el volante ----------
  add(tubo('brazo_der', MONO, [
    [-0.215, 1.43, -0.005, 0.058], [-0.235, 1.30, 0.0, 0.055], [-0.25, 1.16, 0.02, 0.046],
    [-0.26, 1.03, 0.045, 0.045], [-0.27, 0.93, 0.065, 0.036],
  ]));
  add(tubo('guante_puno_der', NEGRO, [[-0.27, 0.95, 0.062, 0.043], [-0.273, 0.90, 0.07, 0.038]], { sub: 1 }));
  add(elipsoide('mano_der', [0.085, 0.10, 0.075], [-0.277, 0.855, 0.078], [0, 0, 0], NEGRO));
  // volante colgando de la mano por su agarre; la cara (pantalla y botones) mira hacia delante y fuera
  const C = [-0.30, 0.73, 0.12], ang = 45, cara = [-Math.SQRT1_2, 0, Math.SQRT1_2], ancho = [Math.SQRT1_2, 0, Math.SQRT1_2];
  const en = (dn, dw, dy) => [C[0] + cara[0] * dn + ancho[0] * dw, C[1] + dy, C[2] + cara[2] * dn + ancho[2] * dw];
  add(caja('volante', [0.045, 0.27, 0.17], C, [0, ang, 0], NEGRO));
  add(caja('volante_pantalla', [0.012, 0.075, 0.095], en(0.026, 0, 0.03), [0, ang, 0], 0x1f6fff));
  for (let i = 0; i < 8; i++) {
    const dw = (i % 2 ? 1 : -1) * 0.065, dy = -0.075 + Math.floor(i / 2) * 0.04;
    add(cilindroX(`volante_boton_${i}`, en(0.027, dw, dy), 0.01, 0.014, [0xffd23f, 0xff3b3b, 0x2fe07a, BLANCO][i % 4]))
      .rotation.set(0, ang * Math.PI / 180, Math.PI / 2);
  }
  for (const dw of [-0.1, 0.1]) add(barra(`volante_agarre_${dw < 0 ? 'a' : 'b'}`, en(0, dw, 0.11), en(0, dw, -0.11), 0.022, NEGRO));

  // ---------- brazo izquierdo: mano en la cadera, codo hacia fuera y atrás ----------
  add(tubo('brazo_izq', MONO, [
    [0.215, 1.43, -0.005, 0.058], [0.29, 1.31, -0.04, 0.054], [0.355, 1.19, -0.07, 0.047],
    [0.30, 1.08, -0.02, 0.045], [0.235, 1.01, 0.02, 0.036],
  ]));
  add(tubo('guante_puno_izq', NEGRO, [[0.25, 1.025, 0.012, 0.043], [0.215, 0.99, 0.03, 0.038]], { sub: 1 }));
  add(elipsoide('mano_izq', [0.06, 0.11, 0.095], [0.19, 0.965, 0.055], [0, 0, -18], NEGRO));

  // ---------- casco, visera, alerón y HANS ----------
  add(elipsoide('casco', [0.27, 0.29, 0.31], [0, 1.69, 0.005], [0, 0, 0], CASCO));
  add(elipsoide('casco_barbilla', [0.23, 0.15, 0.24], [0, 1.60, 0.03], [8, 0, 0], CASCO));
  add(elipsoide('casco_franja', [0.272, 0.05, 0.312], [0, 1.73, 0.004], [0, 0, 0], BLANCO));
  add(elipsoide('visera', [0.215, 0.075, 0.12], [0, 1.68, 0.115], [-6, 0, 0], VISERA));
  add(caja('casco_aleron', [0.15, 0.025, 0.10], [0, 1.83, -0.08], [12, 0, 0], NEGRO));
  for (const s of [1, -1]) add(caja(`casco_aleron_lateral_${s > 0 ? 'izq' : 'der'}`, [0.012, 0.05, 0.08], [0.075 * s, 1.815, -0.08], [12, 0, 0], NEGRO));
  // HANS: collarín sobre los hombros y placa detrás de la nuca
  add(tubo('hans_collarin', GRIS, anillo(0, 1.505, -0.02, 0.15, 0.12, 20).filter(([, , z]) => z < 0.06).map((p) => [...p, 0.035, 0.018]), { sub: 2 }));
  add(caja('hans_placa', [0.16, 0.13, 0.025], [0, 1.57, -0.135], [-12, 0, 0], GRIS));
  for (const s of [1, -1]) add(barra(`hans_correa_${s > 0 ? 'izq' : 'der'}`, [0.08 * s, 1.60, -0.13], [0.12 * s, 1.62, -0.02], 0.008, NEGRO));

  return piezas;
}

// Puntos de un óvalo horizontal (para cinturón y collarín), cerrado.
function anillo(cx, y, cz, rx, rz, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.sin(a) * rx, y, cz + Math.cos(a) * rz]);
  }
  return pts;
}
