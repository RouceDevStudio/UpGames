/**
 * Tests de UpGames Studio (games/studio): pila de deshacer y fotos → malla 3D.
 * Autónomo: `node test/studio.test.mjs` (o `npm test`).
 */
import assert from 'assert';
import { Historial } from '../games/studio/js/deshacer.js';
import { mascaraDesdeImagen, mascaraDePlano, cajaDeMascara, relieveDesdeMascara, cascoVisual, cascoPlanos, volumen } from '../games/studio/js/foto/fotoA3D.js';
import { MallaHE } from '../games/studio/js/malla/mediaArista.js';
import { aGeometria } from '../games/studio/js/malla/aGeometria.js';
import { extruirCaras, insetCaras, cortarBucle, borrarCaras, fusionarVertices, simetriaX, suavizarVertices } from '../games/studio/js/malla/operaciones.js';
import { subdividir } from '../games/studio/js/malla/subdividir.js';
import { evaluar, nuevoModificador, espejo, matriz, solidificar } from '../games/studio/js/malla/modificadores.js';
import { poligonosDeMalla, mallaDePoligonos, union, resta, interseccion } from '../games/studio/js/malla/csg.js';
import { uvAutomatico } from '../games/studio/js/malla/uv.js';
import * as THREE from '../games/studio/lib/three.module.min.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; }
}

// Imagen sintética: fondo blanco y una figura de color donde dentro(x, y) es verdadero.
function imagen(w, h, dentro, color = [200, 30, 40]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, c = dentro(x, y) ? color : [250, 250, 248];
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

// Cada arista debe estar en exactamente dos triángulos, una vez en cada sentido.
function esCerrada(idx) {
  const aristas = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + (e + 1) % 3];
    const k = `${a},${b}`;
    if (aristas.has(k)) return false;
    aristas.set(k, 1);
  }
  for (const k of aristas.keys()) { const [a, b] = k.split(','); if (!aristas.has(`${b},${a}`)) return false; }
  return true;
}

console.log('UpGames Studio');

test('deshacer y rehacer en orden; un comando nuevo borra el futuro', () => {
  const v = [];
  const h = new Historial();
  const poner = (x) => ({ nombre: 'poner', hacer: () => v.push(x), deshacer: () => v.pop() });
  h.hacer(poner(1)); h.hacer(poner(2)); h.hacer(poner(3));
  assert.deepStrictEqual(v, [1, 2, 3]);
  h.deshacer(); h.deshacer();
  assert.deepStrictEqual(v, [1]);
  h.rehacer();
  assert.deepStrictEqual(v, [1, 2]);
  h.hacer(poner(9));
  assert.strictEqual(h.puedeRehacer, false);
  assert.deepStrictEqual(v, [1, 2, 9]);
  while (h.deshacer());
  assert.deepStrictEqual(v, []);
  assert.strictEqual(h.deshacer(), null);
});

test('comando ya hecho (gizmo) no se ejecuta dos veces', () => {
  let n = 0;
  const h = new Historial();
  h.hacer({ hacer: () => n++, deshacer: () => n-- }, { yaHecho: true });
  assert.strictEqual(n, 0);
  h.deshacer(); assert.strictEqual(n, -1);
  h.rehacer(); assert.strictEqual(n, 0);
});

test('límite de la pila', () => {
  const h = new Historial({ limite: 5 });
  for (let i = 0; i < 20; i++) h.hacer({ hacer() {}, deshacer() {} });
  assert.strictEqual(h.pasado.length, 5);
});

test('silueta: recorta el fondo, conserva huecos interiores y se queda con la mancha mayor', () => {
  // anillo grande con agujero blanco + punto suelto pequeño
  const img = imagen(80, 60, (x, y) => {
    const d = Math.hypot(x - 40, y - 30);
    return (d < 22 && d > 0) || (x >= 2 && x <= 3 && y >= 2 && y <= 3);
  });
  const mk = mascaraDesdeImagen(img);
  const caja = cajaDeMascara(mk);
  assert.ok(Math.abs(caja.w - 43) <= 2 && Math.abs(caja.h - 43) <= 2, JSON.stringify(caja));
  assert.strictEqual(mk.mascara[2 * 80 + 2], 0, 'el punto suelto se descarta');
  assert.strictEqual(mk.mascara[30 * 80 + 40], 1);
});

test('una foto: relieve cerrado, con volumen positivo y alto 1', () => {
  const img = imagen(120, 90, (x, y) => Math.hypot((x - 60) / 40, (y - 45) / 30) < 1);
  const m = relieveDesdeMascara(mascaraDesdeImagen(img), { res: 48, grosor: 0.4 });
  assert.ok(m && m.indices.length > 100);
  assert.ok(esCerrada(m.indices), 'malla cerrada');
  assert.ok(volumen(m.posiciones, m.indices) > 0, 'caras hacia fuera');
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 1; i < m.posiciones.length; i += 3) { ymin = Math.min(ymin, m.posiciones[i]); ymax = Math.max(ymax, m.posiciones[i]); }
  assert.ok(Math.abs(ymin) < 1e-2 && Math.abs(ymax - 1) < 1e-2, `${ymin} ${ymax}`); // el suavizado mueve el borde muy poco
  for (const u of m.uvs) assert.ok(u >= 0 && u <= 1);
});

test('dos fotos: un cuadrado de frente y de lado da una caja cerrada de volumen ≈ 1', () => {
  const cuadro = imagen(100, 100, (x, y) => x >= 20 && x < 80 && y >= 20 && y < 80);
  const mk = mascaraDesdeImagen(cuadro);
  const m = cascoVisual(mk, mk, { res: 40, suavizado: 0 });
  assert.ok(m && esCerrada(m.indices), 'malla cerrada');
  const v = volumen(m.posiciones, m.indices);
  assert.ok(v > 0.8 && v < 1.05, `volumen ${v}`);
});

test('dos fotos: círculo de frente + cuadrado de lado ≈ cilindro (π/4)', () => {
  const circulo = mascaraDesdeImagen(imagen(100, 100, (x, y) => Math.hypot(x - 50, y - 50) < 30));
  const cuadro = mascaraDesdeImagen(imagen(100, 100, (x, y) => x >= 20 && x < 80 && y >= 20 && y < 80));
  // el frente es el círculo: el cilindro va a lo largo de z
  const m = cascoVisual(circulo, cuadro, { res: 48, suavizado: 2 });
  const v = volumen(m.posiciones, m.indices);
  assert.ok(Math.abs(v - Math.PI / 4) < 0.08, `volumen ${v}`);
  assert.strictEqual(m.uvFrente.length, (m.posiciones.length / 3) * 2);
});

test('una foto con profundidad (IA): lo cercano sobresale más y la malla sigue cerrada', () => {
  const w = 120, h = 90;
  const img = imagen(w, h, (x, y) => x >= 20 && x < 100 && y >= 15 && y < 75);
  // profundidad: la mitad izquierda cerca (1), la derecha lejos (0)
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = x < 60 ? 1 : 0;
  const mk = mascaraDesdeImagen(img);
  const m = relieveDesdeMascara(mk, { res: 40, grosor: 0.5, profundidad: { data, width: w, height: h }, pesoProfundidad: 1 });
  assert.ok(esCerrada(m.indices) && volumen(m.posiciones, m.indices) > 0);
  let zi = 0, zd = 0;
  for (let v = 0; v < m.posiciones.length; v += 3) {
    const x = m.posiciones[v], z = m.posiciones[v + 2];
    if (x < -0.2) zi = Math.max(zi, z); else if (x > 0.2) zd = Math.max(zd, z);
  }
  assert.ok(zi > zd * 3, `izquierda ${zi} derecha ${zd}`);
});

test('planos: lado + frente + arriba (arriba al revés) → caja cerrada con el morro detectado', () => {
  // objeto de 3 de largo, 1 de ancho y 1 de alto, con un «morro» bajo y estrecho en el primer tercio
  // lado: frente a la izquierda; morro (x < 50) solo la mitad de baja
  const lado = mascaraDesdeImagen(imagen(170, 70, (x, y) => x >= 10 && x < 160 && y >= 10 && y < 60 && (x >= 60 || y >= 35)));
  const frente = mascaraDesdeImagen(imagen(70, 70, (x, y) => x >= 10 && x < 60 && y >= 10 && y < 60));
  // arriba: largo en horizontal, frente a la DERECHA (al revés que el lado); morro estrecho
  const arriba = mascaraDesdeImagen(imagen(170, 70, (x, y) => x >= 10 && x < 160 && y >= 10 && y < 60 && (x < 110 || (y >= 25 && y < 45))));
  const m = cascoPlanos({ lado, frente, arriba }, { res: 90, suavizado: 0 });
  assert.strictEqual(m.arribaInvertido, false, 'frente a la derecha = sin invertir');
  const arribaAlReves = { ...arriba, mascara: arriba.mascara.slice() };
  for (let y = 0; y < 70; y++) for (let x = 0; x < 170; x++) arribaAlReves.mascara[y * 170 + x] = arriba.mascara[y * 170 + 169 - x];
  const m2 = cascoPlanos({ lado, frente, arriba: arribaAlReves }, { res: 90, suavizado: 0 });
  assert.strictEqual(m2.arribaInvertido, true, 'frente a la izquierda = invertido');
  assert.ok(Math.abs(volumen(m2.posiciones, m2.indices) - volumen(m.posiciones, m.indices)) < 0.02);
  assert.ok(esCerrada(m.indices));
  // volumen esperado: 2/3 del largo lleno (2·1·1) + morro de 1 × 0,5 alto × 0,4 ancho
  const v = volumen(m.posiciones, m.indices), esperado = 2 + 0.5 * 0.4;
  assert.ok(Math.abs(v - esperado) < 0.15, `volumen ${v} (esperado ≈ ${esperado})`);
  assert.ok(Math.abs(m.medidas.largo - 3) < 0.1 && Math.abs(m.medidas.ancho - 1) < 0.05);
  // el morro (z > 0,5) es bajo: ningún vértice por encima de 0,55 de alto
  let alto = 0;
  for (let i = 0; i < m.posiciones.length; i += 3) if (m.posiciones[i + 2] > 0.6) alto = Math.max(alto, m.posiciones[i + 1]);
  assert.ok(alto < 0.56, `alto del morro ${alto}`);
});

test('planos de un monoplaza: ruedas medidas como piezas y carrocería sin la franja de los neumáticos', () => {
  // lado: carrocería alta en el centro que tapa las esquinas de dos ruedas que tocan el suelo
  const rueda = (x, y, cx) => Math.hypot(x - cx, y - 60) < 20;
  const lado = mascaraDePlano(imagen(240, 100, (x, y) => rueda(x, y, 50) || rueda(x, y, 190) || (x >= 20 && x < 220 && y >= 30 && y < 70 && (x > 75 && x < 165 || y < 45))));
  const frente = mascaraDePlano(imagen(120, 100, (x, y) => y >= 30 && y < 80 && x >= 10 && x < 110));
  // arriba: ruedas a los lados (separadas) y carrocería estrecha en el centro
  const arriba = mascaraDePlano(imagen(240, 120, (x, y) => (y >= 10 && y < 110 && x >= 20 && x < 220 && (y >= 40 && y < 80)) || ((y >= 10 && y < 30 || y >= 90 && y < 110) && (Math.abs(x - 50) < 20 || Math.abs(x - 190) < 20))));
  const sin = cascoPlanos({ lado, frente, arriba }, { res: 120, suavizado: 0 });
  const con = cascoPlanos({ lado, frente, arriba }, { res: 120, suavizado: 0, monoplaza: true });
  assert.strictEqual(con.ruedas.length, 4, 'cuatro ruedas (dos por eje): ' + JSON.stringify(con.ruedas));
  assert.deepStrictEqual(con.ruedas.map((r) => r.nombre).sort(), ['rueda_del_der', 'rueda_del_izq', 'rueda_tra_der', 'rueda_tra_izq']);
  for (const r of con.ruedas) assert.ok(Math.abs(r.y - r.radio) < 0.05, 'la rueda apoya en el suelo');
  // la carrocería ya no lleva los neumáticos ni sus cajas
  assert.ok(volumen(con.posiciones, con.indices) < volumen(sin.posiciones, sin.indices) * 0.9);
  assert.ok(esCerrada(con.indices));
});

// ---------- Malla de media arista ----------
const desdeThree = (g, op) => MallaHE.desdeTriangulos(g.attributes.position.array, g.index ? g.index.array : null, { uvs: g.attributes.uv?.array, ...op });
const contar = (m) => { const c = {}; for (let f = 0; f < m.nF; f++) { const n = m.vertsDeCara(f).length; c[n] = (c[n] || 0) + 1; } return c; };
const bordes = (m) => m.heTwin.filter((t) => t < 0).length;

test('cubo de Three → 8 vértices, 12 aristas, 6 cuadriláteros, cerrado (V − E + F = 2)', () => {
  const m = desdeThree(new THREE.BoxGeometry(1, 1, 1));
  assert.deepStrictEqual([m.nV, m.nE, m.nF], [8, 12, 6]);
  assert.deepStrictEqual(contar(m), { 4: 6 });
  assert.strictEqual(bordes(m), 0);
  assert.deepStrictEqual(m.validar(), []);
});

test('esfera, cilindro, toro, cápsula y cono: cerrados, válidos y con cuadriláteros', () => {
  const casos = {
    esfera: [new THREE.SphereGeometry(0.5, 16, 8), 2],
    cilindro: [new THREE.CylinderGeometry(0.5, 0.5, 1, 12), 2],
    toro: [new THREE.TorusGeometry(0.4, 0.15, 8, 16), 0],
    capsula: [new THREE.CapsuleGeometry(0.3, 0.6, 4, 12), 2],
    cono: [new THREE.ConeGeometry(0.5, 1, 12), 2],
  };
  for (const [nombre, [g, euler]] of Object.entries(casos)) {
    const m = desdeThree(g);
    assert.deepStrictEqual(m.validar(), [], nombre);
    assert.strictEqual(bordes(m), 0, `${nombre}: sin bordes`);
    assert.strictEqual(m.nV - m.nE + m.nF, euler, `${nombre}: Euler`);
  }
  assert.deepStrictEqual(contar(desdeThree(new THREE.CylinderGeometry(0.5, 0.5, 1, 12))), { 3: 24, 4: 12 });
  assert.strictEqual(contar(desdeThree(new THREE.TorusGeometry(0.4, 0.15, 8, 16)))[4], 128);
});

test('icoesfera sin unir cuadriláteros y plano con borde', () => {
  const ico = desdeThree(new THREE.IcosahedronGeometry(0.5, 2), { cuads: false });
  assert.deepStrictEqual(contar(ico), { 3: 180 }); // detalle 2 → 20·3²
  assert.strictEqual(ico.nV - ico.nE + ico.nF, 2);
  const plano = desdeThree(new THREE.PlaneGeometry(2, 2, 2, 2));
  assert.deepStrictEqual([plano.nV, plano.nF, bordes(plano)], [9, 4, 8]);
});

test('bucle de aristas: el anillo de un cilindro y el de un toro', () => {
  const cil = desdeThree(new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 3, true)); // abierto, 3 anillos de cuadriláteros
  // una arista vertical de la pared → su bucle da la vuelta horizontal? No: el bucle sigue la dirección de la arista
  const e = [...Array(cil.nE).keys()].find((k) => { const [a, b] = cil.vertsDeArista(k); return Math.abs(cil.pos[a * 3 + 1] - cil.pos[b * 3 + 1]) < 1e-6 && Math.abs(cil.pos[a * 3 + 1]) < 0.3; });
  assert.strictEqual(cil.bucle(e).length, 12, 'anillo horizontal interior de 12 aristas');
  const toro = desdeThree(new THREE.TorusGeometry(0.4, 0.15, 8, 16));
  for (let k = 0; k < 10; k++) { const n = toro.bucle(k).length; assert.ok(n === 8 || n === 16, `bucle ${n}`); }
});

test('a geometría: una esquina por media arista, triángulos en abanico y normales vivas en el cubo', () => {
  const m = desdeThree(new THREE.BoxGeometry(1, 1, 1));
  const g = aGeometria(m);
  assert.strictEqual(g.posiciones.length, m.nHE * 3);
  assert.strictEqual(g.indices.length, 12 * 3);
  assert.strictEqual(g.triCara.length, 12);
  // en un cubo (90° > 30°) cada esquina lleva la normal de su cara
  for (let h = 0; h < m.nHE; h++) {
    const n = m.normalCara(m.heFace[h]); const l = Math.hypot(...n);
    assert.ok(Math.abs(g.normales[h * 3] - n[0] / l) + Math.abs(g.normales[h * 3 + 1] - n[1] / l) + Math.abs(g.normales[h * 3 + 2] - n[2] / l) < 1e-5);
  }
  // mover un vértice cambia todas sus esquinas
  m.pos[0] += 1;
  const g2 = aGeometria(m);
  let cambiadas = 0;
  for (let h = 0; h < m.nHE; h++) if (g2.posiciones[h * 3] !== g.posiciones[h * 3]) cambiadas++;
  assert.strictEqual(cambiadas, 3);
});

test('las UV de cada esquina se conservan al soldar (costuras)', () => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const m = desdeThree(g);
  const usadas = new Set();
  for (let h = 0; h < m.nHE; h++) usadas.add(`${m.heUV[h * 2]},${m.heUV[h * 2 + 1]}`);
  assert.deepStrictEqual([...usadas].sort(), ['0,0', '0,1', '1,0', '1,1']);
});

test('modelo desde foto → malla de media arista válida', () => {
  const img = imagen(120, 90, (x, y) => Math.hypot((x - 60) / 40, (y - 45) / 30) < 1);
  const r = relieveDesdeMascara(mascaraDesdeImagen(img), { res: 32 });
  const m = MallaHE.desdeTriangulos(r.posiciones, r.indices, { uvs: r.uvs });
  assert.deepStrictEqual(m.validar(), []);
  assert.strictEqual(bordes(m), 0);
});

// ---------- Operaciones de modelado (sprint 3) ----------
const cubo = () => desdeThree(new THREE.BoxGeometry(1, 1, 1));
const cerrada = (m) => m.validar().length === 0 && bordes(m) === 0;
const vol = (m) => { const g = aGeometria(m); return volumen(g.posiciones, g.indices); };
const caraArriba = (m) => [...Array(m.nF).keys()].find((f) => m.vertsDeCara(f).every((v) => Math.abs(m.pos[v * 3 + 1] - 0.5) < 1e-6));

test('extruir la cara de arriba de un cubo: 12 vértices, 10 caras, cerrada y con más volumen', () => {
  const m = cubo();
  const r = extruirCaras(m, [caraArriba(m)], 0.5);
  assert.deepStrictEqual([r.malla.nV, r.malla.nF], [12, 10]);
  assert.ok(cerrada(r.malla));
  assert.ok(Math.abs(vol(r.malla) - 1.5) < 1e-6, `volumen ${vol(r.malla)}`);
  assert.ok(r.malla.vertsDeCara(r.caras[0]).every((v) => Math.abs(r.malla.pos[v * 3 + 1] - 1) < 1e-6), 'la cara sale a y = 1');
  assert.strictEqual(m.nV, 8, 'la malla original no cambia (para deshacer)');
});

test('extruir dos caras vecinas como región: sin caras internas', () => {
  const m = cubo();
  const arriba = caraArriba(m);
  const lado = [...Array(m.nF).keys()].find((f) => m.vertsDeCara(f).every((v) => Math.abs(m.pos[v * 3] - 0.5) < 1e-6));
  const r = extruirCaras(m, [arriba, lado], 0.2);
  assert.ok(cerrada(r.malla));
  assert.strictEqual(r.malla.nF, 6 + 6, 'cada arista del borde de la región da una cara lateral (6)');
});

test('inset: la cara se reduce hacia dentro con un anillo de cuadriláteros', () => {
  const m = cubo();
  const r = insetCaras(m, [caraArriba(m)], 0.3);
  assert.deepStrictEqual([r.malla.nV, r.malla.nF], [12, 10]);
  assert.ok(cerrada(r.malla));
  assert.ok(Math.abs(vol(r.malla) - 1) < 1e-9);
});

test('corte en bucle por el centro del cubo: anillo de 4 caras partido', () => {
  const m = cubo();
  const e = [...Array(m.nE).keys()].find((x) => { const [a, b] = m.vertsDeArista(x); return Math.abs(m.pos[a * 3 + 1] - m.pos[b * 3 + 1]) > 0.9; }); // arista vertical
  const r = cortarBucle(m, e, 0.5);
  assert.deepStrictEqual([r.malla.nV, r.malla.nF], [12, 10]);
  assert.strictEqual(r.aristas.length, 4);
  assert.ok(cerrada(r.malla));
  for (const x of r.aristas) for (const v of r.malla.vertsDeArista(x)) assert.ok(Math.abs(r.malla.pos[v * 3 + 1]) < 1e-9, 'el corte cae en y = 0');
});

test('Catmull-Clark: cubo → 24 cuadriláteros, 26 vértices, cerrado y más redondo', () => {
  const r = subdividir(cubo(), 1).malla;
  assert.deepStrictEqual([r.nV, r.nF], [26, 24]);
  assert.ok(cerrada(r));
  assert.strictEqual(r.nV - r.nE + r.nF, 2);
  const r2 = subdividir(cubo(), 3).malla;
  // tiende a una esfera: los radios se igualan
  let mn = Infinity, mx = 0;
  for (let v = 0; v < r2.nV; v++) { const d = Math.hypot(r2.pos[v * 3], r2.pos[v * 3 + 1], r2.pos[v * 3 + 2]); mn = Math.min(mn, d); mx = Math.max(mx, d); }
  assert.ok(mx / mn < 1.25, `radios ${mn} … ${mx}`);
});

test('Catmull-Clark respeta los bordes abiertos (plano)', () => {
  const r = subdividir(desdeThree(new THREE.PlaneGeometry(2, 2, 1, 1)), 1).malla;
  assert.deepStrictEqual([r.nV, r.nF], [9, 4]);
  assert.deepStrictEqual(r.validar(), []);
});

test('simetría en X: se refleja el lado derecho y se cose el centro', () => {
  const m = cubo();
  const e = [...Array(m.nE).keys()].find((x) => { const [a, b] = m.vertsDeArista(x); return Math.abs(m.pos[a * 3] - m.pos[b * 3]) > 0.9; }); // arista en x
  let r = cortarBucle(m, e, 0.5).malla;                       // corte en x = 0
  r = simetriaX(r).malla;
  assert.ok(cerrada(r));
  assert.deepStrictEqual([r.nV, r.nF], [12, 10]);
  assert.ok(Math.abs(vol(r) - 1) < 1e-9);
});

test('borrar, fusionar y suavizar', () => {
  const m = cubo();
  const b = borrarCaras(m, [caraArriba(m)]).malla;
  assert.deepStrictEqual([b.nF, bordes(b)], [5, 4]);
  const arriba = m.vertsDeCara(caraArriba(m));
  const f = fusionarVertices(m, arriba).malla;                // pirámide
  assert.deepStrictEqual([f.nV, f.nF], [5, 5]);
  assert.ok(cerrada(f));
  const s = suavizarVertices(subdividir(m, 1).malla, [], 0.5, 3).malla;
  assert.ok(cerrada(s));
});

// ---------- Modificadores (sprint 4) ----------
const volP = (pols) => { let v = 0; for (const p of pols) for (let i = 1; i < p.v.length - 1; i++) { const [a, b, c] = [p.v[0], p.v[i], p.v[i + 1]]; v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); } return v / 6; };
const cuboEn = (x, y, z, l = 1) => desdeThree(new THREE.BoxGeometry(l, l, l).translate(x, y, z));

test('espejo: media caja abierta en x = 0 → caja cerrada y cosida del doble de volumen', () => {
  const m = cuboEn(0.5, 0, 0);
  const izq = [...Array(m.nF).keys()].find((f) => m.vertsDeCara(f).every((v) => Math.abs(m.pos[v * 3]) < 1e-6));
  const media = borrarCaras(m, [izq]).malla;
  const r = espejo(media, 'x');
  assert.ok(cerrada(r));
  assert.strictEqual(r.nV, 12);
  assert.ok(Math.abs(vol(r) - 2) < 1e-9);
});

test('matriz: 3 copias en fila, relativo al tamaño', () => {
  const r = matriz(cubo(), { cantidad: 3, x: 1.5, y: 0, z: 0, relativo: true });
  assert.deepStrictEqual([r.nV, r.nF], [24, 18]);
  let mx = -Infinity; for (let v = 0; v < r.nV; v++) mx = Math.max(mx, r.pos[v * 3]);
  assert.ok(Math.abs(mx - 3.5) < 1e-9, `x máx ${mx}`);
});

test('solidificar: un plano de 2 × 2 con grosor 0,1 → caja cerrada de volumen 0,4', () => {
  const r = solidificar(desdeThree(new THREE.PlaneGeometry(2, 2)), 0.1);
  assert.ok(cerrada(r));
  assert.ok(Math.abs(Math.abs(vol(r)) - 0.4) < 1e-6, `${vol(r)}`);
});

test('booleanas: resta, unión e intersección de dos cubos solapados', () => {
  const A = poligonosDeMalla(cubo()), B = poligonosDeMalla(cuboEn(0.5, 0.5, 0.5)); // solapan 0,125
  assert.ok(Math.abs(volP(resta(A, B)) - 0.875) < 1e-6, `resta ${volP(resta(A, B))}`);
  assert.ok(Math.abs(volP(union(A, B)) - 1.875) < 1e-6);
  assert.ok(Math.abs(volP(interseccion(A, B)) - 0.125) < 1e-6);
  const m = mallaDePoligonos(resta(A, B));
  assert.deepStrictEqual(m.validar(), []);
});

test('pila de modificadores: espejo + subdivisión, oculto y booleana con el otro objeto', () => {
  const m = cuboEn(0.5, 0, 0);
  const mods = [nuevoModificador('espejo'), nuevoModificador('subdivision')];
  mods[1].niveles = 1;
  const r = evaluar(m, mods);
  assert.ok(r.nF > m.nF * 4);
  mods[1].visible = false;
  assert.strictEqual(evaluar(m, mods).nF, m.nF * 2, 'oculto no cuenta');
  const bool = { ...nuevoModificador('booleana'), objeto: 'otro' };
  const res = evaluar(cubo(), [bool], { poligonosDe: () => poligonosDeMalla(cuboEn(0.5, 0.5, 0.5)) });
  assert.ok(Math.abs(vol(res) - 0.875) < 1e-6);
  assert.strictEqual(m.nV, 8, 'la base no cambia');
});

// ---------- UV automático (sprint 5) ----------
test('UV automático: todas las UV dentro de 0..1 y las 6 caras del cubo sin solaparse', () => {
  const r = uvAutomatico(cubo()).malla;
  for (const u of r.heUV) assert.ok(u >= -1e-9 && u <= 1 + 1e-9);
  const cajas = [...Array(r.nF).keys()].map((f) => { const hs = r.mediasDeCara(f); const us = hs.map((h) => r.heUV[h * 2]), vs = hs.map((h) => r.heUV[h * 2 + 1]); return [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)]; });
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    const a = cajas[i], b = cajas[j];
    assert.ok(a[2] <= b[0] + 1e-9 || b[2] <= a[0] + 1e-9 || a[3] <= b[1] + 1e-9 || b[3] <= a[1] + 1e-9, `caras ${i} y ${j} se solapan`);
  }
});

console.log(`\n${passed} pruebas correctas`);
