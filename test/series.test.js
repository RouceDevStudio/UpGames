/**
 * Tests de la detección de publicaciones por partes (modulos/series.js).
 * Autónomo: `node test/series.test.js` (o `npm test`).
 */
'use strict';

const assert = require('assert');
const { detectarParte, serieDe } = require('../modulos/series');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('detectarParte');
const casos = [
    ['GTA 5 mod rendimiento parte 1', 'GTA 5 mod rendimiento', 1, null],
    ['GTA 5 mod rendimiento - Part 10 of 12', 'GTA 5 mod rendimiento', 10, 12],
    ['Final Fantasy VII CD 2', 'Final Fantasy VII', 2, null],
    ['Pack texturas (3/8)', 'Pack texturas', 3, 8],
    ['Mod gráfico [2 de 5]', 'Mod gráfico', 2, 5],
    ['Juego X Parte II', 'Juego X', 2, null],
    ['Mega pack p3', 'Mega pack', 3, null],
];
for (const [t, base, parte, total] of casos)
    test(t, () => assert.deepStrictEqual(detectarParte(t), { base, parte, total }));
for (const t of ['GTA V', 'Windows 10/11 activador', 'Resident Evil 2 mod', 'FIFA 23', 'Kill Bill parte', 'Parte 1', 'Mod (5/2)'])
    test(`no es una parte: ${t}`, () => assert.strictEqual(detectarParte(t), null));

console.log('serieDe');
test('misma serie aunque cambien mayúsculas, tildes y separadores', () =>
    assert.strictEqual(serieDe('GTA 5 Mod Rendimiento parte 1', 'Kero').clave, serieDe('gta 5 mod rendimiento – PARTE 7', 'kero').clave));
test('autores distintos → series distintas', () =>
    assert.notStrictEqual(serieDe('Pack parte 1', 'ana').clave, serieDe('Pack parte 2', 'luis').clave));
test('títulos normales no son serie', () => assert.strictEqual(serieDe('Texturas HD', 'ana'), null));

console.log(`\n${passed} pruebas OK`);
