/**
 * Tests de UpGames Studio (games/studio): pila de deshacer y fotos → malla 3D.
 * Autónomo: `node test/studio.test.mjs` (o `npm test`).
 */
import assert from 'assert';
import { Historial } from '../games/studio/js/deshacer.js';
import { mascaraDesdeImagen, cajaDeMascara, relieveDesdeMascara, cascoVisual, volumen } from '../games/studio/js/foto/fotoA3D.js';

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
  assert.ok(Math.abs(ymin) < 1e-6 && Math.abs(ymax - 1) < 1e-6, `${ymin} ${ymax}`);
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

console.log(`\n${passed} pruebas correctas`);
