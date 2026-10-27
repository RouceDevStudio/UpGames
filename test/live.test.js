/**
 * Tests de las reglas de UpGames Live (modulos/live.js): reparto de regalos,
 * paquetes, claves de transmisión, auth de MediaMTX y limpieza del chat.
 * Autónomo: `node test/live.test.js` (o `npm test`).
 */
'use strict';

const assert = require('assert');
const L = require('../modulos/live');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('reparto');
test('100 monedas = $1: 70% creador, 30% plataforma', () =>
    assert.deepStrictEqual(L.reparto(100, 0.30), { bruto: 1, creador: 0.7, plataforma: 0.3 }));
test('las partes siempre suman el bruto (sin deriva de centavos)', () => {
    for (const m of [10, 50, 300, 999, 5000, 123457]) {
        const r = L.reparto(m, 0.3);
        assert.ok(Math.abs(r.creador + r.plataforma - r.bruto) < 1e-9, `${m}`);
    }
});
test('comisión 0 → todo para el creador', () => assert.strictEqual(L.reparto(500, 0).creador, 5));

console.log('catálogo');
test('cada paquete cuesta al menos su valor nominal (cubre la comisión de PayPal)', () => {
    for (const p of L.PAQUETES) assert.ok(p.usd >= p.monedas * L.MONEDA_USD * 0.9, p.id);
});
test('ids únicos de regalos y paquetes', () => {
    assert.strictEqual(new Set(L.REGALOS.map(r => r.id)).size, L.REGALOS.length);
    assert.strictEqual(new Set(L.PAQUETES.map(p => p.id)).size, L.PAQUETES.length);
});
test('regalo/paquete inexistente → null', () => { assert.strictEqual(L.regalo('nada'), null); assert.strictEqual(L.paquete('__proto__'), null); });

console.log('claves de transmisión');
test('clave nueva de 32 hex', () => assert.match(L.nuevaClave(), /^[a-f0-9]{32}$/));
test('claveValida acepta la correcta y rechaza el resto', () => {
    const k = L.nuevaClave();
    assert.ok(L.claveValida(k, k));
    assert.ok(!L.claveValida(k, L.nuevaClave()));
    assert.ok(!L.claveValida(k, ''));
    assert.ok(!L.claveValida(null, k));
    assert.ok(!L.claveValida(k, k + 'x'));
});

console.log('MediaMTX');
test('ruta live/<usuario>', () => {
    assert.strictEqual(L.usuarioDeRuta('live/Kero_99'), 'kero_99');
    for (const p of ['live/a', 'live/../x', 'otra/kero', 'live/kero/extra', '', null]) assert.strictEqual(L.usuarioDeRuta(p), null, String(p));
});
test('clave desde contraseña, token WHIP o ?key= de OBS', () => {
    assert.strictEqual(L.claveDeAuth({ password: 'abc' }), 'abc');
    assert.strictEqual(L.claveDeAuth({ token: 'tok' }), 'tok');
    assert.strictEqual(L.claveDeAuth({ query: 'key=xyz&otro=1' }), 'xyz');
    assert.strictEqual(L.claveDeAuth({}), '');
});
test('proveedor: p2p sin variables, mediamtx con MEDIAMTX_PUBLIC_URL', () => {
    assert.strictEqual(L.proveedor({}).tipo, 'p2p');
    const p = L.proveedor({ MEDIAMTX_PUBLIC_URL: 'https://hls.x.app/', MEDIAMTX_WHIP_URL: 'https://whip.x.app', MEDIAMTX_RTMP_URL: 'rtmp://x.proxy.rlwy.net:1234' });
    assert.strictEqual(p.tipo, 'mediamtx');
    assert.strictEqual(p.hls, 'https://hls.x.app/live/{u}/index.m3u8');
    assert.strictEqual(p.whip, 'https://whip.x.app/live/{u}/whip');
    assert.strictEqual(p.rtmp, 'rtmp://x.proxy.rlwy.net:1234/live');
});
test('ICE: STUN siempre, TURN solo si está configurado', () => {
    assert.strictEqual(L.iceServers({}).length, 1);
    const t = L.iceServers({ TURN_URL: 'turn:a:3478, turns:a:5349', TURN_USER: 'u', TURN_PASS: 'p' });
    assert.deepStrictEqual(t[1], { urls: ['turn:a:3478', 'turns:a:5349'], username: 'u', credential: 'p' });
});

console.log('chat');
test('limpia control, espacios y recorta', () => {
    assert.strictEqual(L.limpiarChat('  hola\n\n  mundo\u0000 '), 'hola mundo');
    assert.strictEqual(L.limpiarChat('x'.repeat(500)).length, 200);
    assert.strictEqual(L.limpiarChat('   '), null);
    assert.strictEqual(L.limpiarChat(null), null);
    assert.strictEqual(L.limpiarChat('a‮b'), 'a b');
});
test('limitador: ráfaga permitida y luego bloquea', () => {
    const lim = L.limitador(3, 0.001);
    assert.deepStrictEqual([lim('u'), lim('u'), lim('u'), lim('u')], [true, true, true, false]);
    assert.ok(lim('otro'));
});

console.log(`\n${passed} pruebas OK`);
