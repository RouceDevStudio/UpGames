/**
 * Detector de juegos comerciales: palabras completas, sin falsos positivos con juegos propios.
 * Autónomo: `node test/gameDetector.test.js` (o `npm test`).
 */
'use strict';
const assert = require('assert');
const { detectGame } = require('../modulos/gameDetector');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; } }

test('APEX GP no es Apex Legends', () => {
  assert.strictEqual(detectGame('APEX GP', 'APEX GP se presenta como el simulador de carreras definitivo de UPGAMES. Formula racing, apex de cada curva.'), null);
});
test('Apex Legends se sigue detectando', () => {
  assert.strictEqual(detectGame('Apex Legends PC', '')?.gameKey, 'Apex Legends');
  assert.strictEqual(detectGame('apex-legends v2', '')?.gameKey, 'Apex Legends');
});
test('las claves no saltan dentro de otras palabras', () => {
  assert.strictEqual(detectGame('Border Patrol', 'un juego de la liga local, lol'), null);
  assert.strictEqual(detectGame('Arkanoid remake', 'mi juego de codigo abierto'), null);
});
test('tildes y signos no impiden detectar', () => {
  assert.strictEqual(detectGame('GTA: San Andreas', '')?.gameKey, 'GTA San Andreas');
  assert.strictEqual(detectGame('Pokémon? no, Minecraft!', '')?.gameKey, 'Minecraft');
});
console.log(`\n${passed} test(s) OK`);
