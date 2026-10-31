/**
 * Tests de UpGames Studio (games/studio): pila de deshacer y fotos → malla 3D.
 * Autónomo: `node test/studio.test.mjs` (o `npm test`).
 */
import assert from 'assert';
import { Historial } from '../games/studio/js/deshacer.js';
import { mascaraDesdeImagen, mascaraDePlano, cajaDeMascara, relieveDesdeMascara, cascoVisual, cascoPlanos, volumen } from '../games/studio/js/foto/fotoA3D.js';

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

console.log(`\n${passed} pruebas correctas`);
