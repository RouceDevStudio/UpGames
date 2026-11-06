/**
 * El enlace de descarga no viaja en las respuestas públicas (modulos/sinEnlace.js).
 * Autónomo: `node test/sinEnlace.test.js`.
 */
'use strict';
const assert = require('assert');
const { middleware, limpiar } = require('../modulos/sinEnlace');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const pub = { _id: 'a1', title: 'GTA mod', category: 'Mod', link: 'https://mega.nz/x', image: 'i.jpg' };
const vid = { _id: 'v1', title: 'Gameplay', category: 'Video', link: 'https://youtu.be/abc' };
function correr(path, cuerpo, { method = 'GET', yo = null } = {}) {
    let enviado; const res = { json: b => { enviado = b; return res; } };
    middleware({ usuarioOpcional: () => yo })({ method, path }, res, () => {});
    res.json(cuerpo); return enviado;
}

console.log('sinEnlace');
test('quita el enlace de publicaciones en listas, objetos y anidados', () => {
    const r = limpiar({ items: [pub, vid], item: pub, serie: { partes: [pub] } });
    assert.ok(!('link' in r.items[0])); assert.ok(!('link' in r.item)); assert.ok(!('link' in r.serie.partes[0]));
    assert.strictEqual(r.items[0].image, 'i.jpg');
});
test('los videos conservan su enlace (es el propio video)', () => assert.strictEqual(limpiar([vid])[0].link, vid.link));
test('no toca objetos que no son publicaciones (acceso directo)', () => assert.strictEqual(limpiar({ desbloqueado: true, link: 'https://mega.nz/x' }).link, 'https://mega.nz/x'));
test('catálogo público: sin enlace', () => assert.ok(!('link' in correr('/items', [pub])[0])));
test('el autor en su propio perfil sí ve sus enlaces', () => assert.strictEqual(correr('/items/user/pepe', [pub], { yo: 'pepe' })[0].link, pub.link));
test('otro usuario viendo ese perfil no', () => assert.ok(!('link' in correr('/items/user/pepe', [pub], { yo: 'otro' })[0])));
test('admin y POST no se modifican', () => {
    assert.strictEqual(correr('/admin/items', [pub])[0].link, pub.link);
    assert.strictEqual(correr('/economia/validar-descarga', { ...pub }, { method: 'POST' }).link, pub.link);
});
console.log(`\nsinEnlace: ${passed} pruebas OK`);
