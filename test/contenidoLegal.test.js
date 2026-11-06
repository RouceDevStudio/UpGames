/** Reglas de contenido legal en el servidor (modulos/contenidoLegal.js). `node test/contenidoLegal.test.js` */
'use strict';
const assert = require('assert');
const { revisar } = require('../modulos/contenidoLegal');
const { detectGame } = require('../modulos/gameDetector');
let passed = 0;
function test(n, fn) { try { fn(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } }
const g = { detectGame };
console.log('contenidoLegal');
test('bloquea piratería evidente en título o descripción', () => {
    for (const t of ['Photoshop crack 2026', 'Juego X APK FULL', 'Spotify premium desbloqueado', 'pack prod.keys yuzu', 'BIOS PS2 scph-70012', 'keygen office'])
        assert.ok(revisar({ title: t, category: 'Apps' }, g).bloquear, t);
});
test('no bloquea palabras legítimas parecidas', () => {
    for (const t of ['Crackdown mod de texturas', 'Mi app de notas', 'Mod de FPS para mi juego', 'Pack de texturas HD', 'Emulador PS2 (sin BIOS)'])
        assert.ok(!revisar({ title: t, category: 'Mod' }, g).bloquear, t);
});
test('juego comercial reconocido → revisión humana', () => {
    const r = revisar({ title: 'Red Dead Redemption', category: 'Juego', link: 'https://www.mediafire.com/x.apks' }, g);
    assert.ok(r.revisionHumana || !detectGame('Red Dead Redemption', ''), JSON.stringify(r));
});
test('videos y mods no requieren revisión por el título', () => {
    assert.deepStrictEqual(revisar({ title: 'Gameplay de mi juego indie', category: 'Video' }, g), {});
    assert.deepStrictEqual(revisar({ title: 'Mi herramienta de backups', category: 'Ajustes' }, g), {});
});
console.log(`\ncontenidoLegal: ${passed} pruebas OK`);
