/**
 * Tests del puente Nexus↔UpGames (modulos/nexusPublish.js).
 * Autónomo: `node test/nexusPublish.test.js` (o `npm test`).
 * Prueba las funciones puras críticas de seguridad y presentación.
 */
'use strict';

const assert = require('assert');
const { slugify, safeRel, injectOpenGraph, mimeFor } = require('../modulos/nexusPublish');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('slugify');
test('normaliza y limpia', () => assert.strictEqual(slugify('Mi Proyecto Épico #2'), 'mi-proyecto-epico-2'));
test('quita separadores de ruta', () => assert.strictEqual(slugify('../weird//name'), 'weird-name'));
test('vacío → cadena vacía', () => assert.strictEqual(slugify(''), ''));
test('acota a 60 chars', () => assert.ok(slugify('a'.repeat(200)).length <= 60));

console.log('safeRel (seguridad de rutas)');
test('ruta normal', () => assert.strictEqual(safeRel('src/app.js'), 'src/app.js'));
test('bloquea traversal ..', () => assert.strictEqual(safeRel('../../etc/passwd'), null));
test('bloquea traversal anidado', () => assert.strictEqual(safeRel('a/../../b'), null));
test('bloquea dotfiles', () => assert.strictEqual(safeRel('.env'), null));
test('absoluta → relativa contenida', () => assert.strictEqual(safeRel('/etc/passwd'), 'etc/passwd'));
test('normaliza backslashes', () => assert.strictEqual(safeRel('a\\b\\c.js'), 'a/b/c.js'));
test('quita query/hash', () => assert.strictEqual(safeRel('index.html?v=1#top'), 'index.html'));

console.log('mimeFor');
test('html', () => assert.ok(mimeFor('index.html').startsWith('text/html')));
test('js', () => assert.ok(/javascript/.test(mimeFor('app.js'))));
test('desconocido → octet-stream', () => assert.strictEqual(mimeFor('x.bin'), 'application/octet-stream'));

console.log('injectOpenGraph');
test('inyecta og:title en head', () => {
    const out = injectOpenGraph('<html><head><title>x</title></head><body></body></html>', { title: 'Demo', description: 'd', url: 'https://u/x' });
    assert.ok(out.includes('property="og:title"'));
    assert.ok(out.includes('Demo'));
});
test('no duplica si ya existe', () => {
    const html = '<head><meta property="og:title" content="ya"></head>';
    assert.strictEqual(injectOpenGraph(html, { title: 'Demo' }), html);
});
test('escapa comillas/ángulos', () => {
    const out = injectOpenGraph('<head></head>', { title: 'a"<b>' });
    assert.ok(!out.includes('a"<b>'));
    assert.ok(out.includes('&quot;') && out.includes('&lt;'));
});

console.log(`\n${passed} pruebas OK`);
