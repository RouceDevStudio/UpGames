/**
 * Tests de la tienda: productos (parsear/precioUsd) y cobro con Mercado Pago
 * (modulos/mercadopago.js) con un transporte simulado.
 * Autónomo: `node test/tienda.test.js` (o `npm test`).
 */
'use strict';

const assert = require('assert');
const MP = require('../modulos/mercadopago');
const { parsear, precioUsd, PLANES } = require('../rutas/tienda');

let passed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const env = { MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-x', MERCADOPAGO_PUBLIC_KEY: 'APP_USR-pk', MERCADOPAGO_TASA_USD: '3900' };
function cliente(respuestas, e = env) {
    const llamadas = [];
    const mp = MP.crear({ env: e, transporte: async (m, path, body, extra) => {
        llamadas.push({ m, path, body, extra });
        return respuestas[`${m} ${path}`] || { status: 404, data: {} };
    } });
    return { mp, llamadas };
}
const yo = { 'GET /users/me': { status: 200, data: { site_id: 'MCO' } } };

(async () => {
    await test('parsear: productos válidos', () => {
        assert.strictEqual(parsear('monedas:p100').tipo, 'monedas');
        assert.strictEqual(parsear('acceso:' + 'a'.repeat(24)).tipo, 'acceso');
        assert.strictEqual(parsear('plan:pase30').plan.dias, 30);
    });
    await test('parsear: productos inventados → null', () => {
        for (const p of ['', 'plan:gratis', 'monedas:p999', 'acceso:123', 'acceso:' + 'z'.repeat(24), 'plan:pase30;x', null]) assert.strictEqual(parsear(p), null, p);
    });
    await test('precioUsd: acceso US$1, planes a su precio', () => {
        assert.strictEqual(precioUsd(parsear('acceso:' + 'b'.repeat(24)), 'tarjeta'), 1);
        for (const p of PLANES) assert.strictEqual(precioUsd(parsear(`plan:${p.id}`), 'tarjeta'), p.usd);
    });
    await test('precioUsd: monedas con saldo cuestan su valor nominal (sin comisión)', () => {
        const p = parsear('monedas:p100');
        assert.ok(precioUsd(p, 'saldo') <= precioUsd(p, 'tarjeta'));
    });
    await test('sin configurar → sin_configurar e inactivo', async () => {
        const { mp } = cliente(yo, {});
        assert.strictEqual((await mp.verificar()).motivo, 'sin_configurar');
        assert.strictEqual(mp.activo(), false);
    });
    await test('credenciales válidas → activo en COP', async () => {
        const { mp } = cliente(yo);
        const e = await mp.verificar();
        assert.ok(e.ok); assert.strictEqual(e.moneda, 'COP'); assert.ok(mp.activo());
    });
    await test('token rechazado → credenciales_invalidas', async () => {
        const { mp } = cliente({ 'GET /users/me': { status: 401, data: {} } });
        assert.strictEqual((await mp.verificar()).motivo, 'credenciales_invalidas');
        assert.strictEqual(mp.activo(), false);
    });
    await test('montoLocal: COP redondeado hacia arriba a la centena', async () => {
        const { mp } = cliente(yo); await mp.verificar();
        assert.strictEqual(mp.montoLocal(1), 3900);
        assert.strictEqual(mp.montoLocal(4.99), 19500);   // 19461 → 19500
    });
    await test('pagar: envía monto del servidor y clave de idempotencia', async () => {
        const { mp, llamadas } = cliente({ ...yo, 'POST /v1/payments': { status: 201, data: { id: 77, status: 'approved', transaction_amount: 3900, external_reference: 'ref1' } } });
        await mp.verificar();
        const r = await mp.pagar({ formData: { token: 't', payment_method_id: 'visa', transaction_amount: 1 }, monto: 3900, descripcion: 'x', referencia: 'ref1', idempotencia: 'k1' });
        assert.strictEqual(r.status, 'approved'); assert.strictEqual(r.id, '77');
        const c = llamadas.find(l => l.path === '/v1/payments');
        assert.strictEqual(c.body.transaction_amount, 3900);
        assert.strictEqual(c.extra['X-Idempotency-Key'], 'k1');
    });
    await test('pagar sin token de tarjeta → 400 sin llamar a Mercado Pago', async () => {
        const { mp, llamadas } = cliente(yo);
        await assert.rejects(mp.pagar({ formData: {}, monto: 1 }), e => e.status === 400);
        assert.ok(!llamadas.some(l => l.path === '/v1/payments'));
    });
    await test('error de la API → 402 con mensaje claro', async () => {
        const { mp } = cliente({ 'POST /v1/payments': { status: 400, data: { cause: [{ code: 2006 }] } } });
        await assert.rejects(mp.pagar({ formData: { token: 't', payment_method_id: 'visa' }, monto: 1, descripcion: 'x' }), e => e.status === 402 && /vencieron/.test(e.message));
    });
    await test('traducirRechazo: motivos conocidos y desconocidos', () => {
        assert.match(MP.traducirRechazo('cc_rejected_insufficient_amount'), /fondos/);
        assert.match(MP.traducirRechazo('otra_cosa'), /rechazado/);
    });

    console.log(`\n${passed} pruebas OK`);
})();
