/**
 * Tests del cobro con PayPal (modulos/paypal.js) con un transporte simulado:
 * verificación de dueño, producto y monto ANTES de cobrar, idempotencia y rechazos.
 * Autónomo: `node test/paypal.test.js` (o `npm test`).
 */
'use strict';

const assert = require('assert');
const PayPal = require('../modulos/paypal');

let passed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const cfg = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'sec', PAYPAL_MODE: 'sandbox' };
function cliente(orden, captura) {
    const llamadas = [];
    const pp = PayPal.crear(cfg, async () => 'tok', { transporte: async (m, path, body) => {
        llamadas.push(`${m} ${path}`);
        if (m === 'POST' && path === '/v2/checkout/orders') return { status: 201, data: { id: 'ORDEN123456' } };
        if (m === 'GET') return orden;
        return captura;
    } });
    return { pp, llamadas };
}
const ordenDe = (extra = {}, pu = {}) => ({ status: 200, data: { status: 'APPROVED', purchase_units: [{ reference_id: 'acceso:abc', custom_id: 'ana', amount: { currency_code: 'USD', value: '1.00' }, ...pu }], ...extra } });
const capturaOk = { status: 201, data: { purchase_units: [{ payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value: '1.00' } }] } }] } };
const opts = { usuario: 'ana', validarRef: r => r === 'acceso:abc', usd: 1 };

(async () => {
    console.log('paypal');
    await test('crearOrden devuelve el id', async () => {
        const { pp } = cliente();
        assert.strictEqual(await pp.crearOrden({ usuario: 'ana', referencia: 'p500', usd: 5.49, descripcion: 'x' }), 'ORDEN123456');
    });
    await test('captura correcta: verifica y cobra', async () => {
        const { pp, llamadas } = cliente(ordenDe(), capturaOk);
        const r = await pp.capturar('ORDEN123456', opts);
        assert.strictEqual(r.captura.id, 'CAP1');
        assert.deepStrictEqual(llamadas, ['GET /v2/checkout/orders/ORDEN123456', 'POST /v2/checkout/orders/ORDEN123456/capture']);
    });
    await test('orden de OTRO usuario → 403 y NO se cobra', async () => {
        const { pp, llamadas } = cliente(ordenDe({}, { custom_id: 'luis' }), capturaOk);
        await assert.rejects(pp.capturar('ORDEN123456', opts), e => e.status === 403);
        assert.ok(!llamadas.some(l => l.includes('capture')));
    });
    await test('orden de OTRO producto → 403 y NO se cobra', async () => {
        const { pp, llamadas } = cliente(ordenDe({}, { reference_id: 'acceso:otro' }), capturaOk);
        await assert.rejects(pp.capturar('ORDEN123456', opts), e => e.status === 403);
        assert.ok(!llamadas.some(l => l.includes('capture')));
    });
    await test('monto manipulado → 400 y NO se cobra', async () => {
        const { pp, llamadas } = cliente(ordenDe({}, { amount: { currency_code: 'USD', value: '0.01' } }), capturaOk);
        await assert.rejects(pp.capturar('ORDEN123456', opts), e => e.status === 400);
        assert.ok(!llamadas.some(l => l.includes('capture')));
    });
    await test('ya capturada (reintento) → no vuelve a cobrar', async () => {
        const { pp, llamadas } = cliente(ordenDe({ status: 'COMPLETED' }, { payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value: '1.00' } }] } }));
        assert.strictEqual((await pp.capturar('ORDEN123456', opts)).captura.id, 'CAP1');
        assert.ok(!llamadas.some(l => l.includes('capture')));
    });
    await test('tarjeta rechazada → 402 con reintentar', async () => {
        const { pp } = cliente(ordenDe(), { status: 422, data: { details: [{ issue: 'INSTRUMENT_DECLINED' }] } });
        await assert.rejects(pp.capturar('ORDEN123456', opts), e => e.status === 402 && e.reintentar === true);
    });
    await test('captura pendiente → 402 sin entregar', async () => {
        const { pp } = cliente(ordenDe(), { status: 201, data: { purchase_units: [{ payments: { captures: [{ id: 'C', status: 'PENDING', amount: { value: '1.00' } }] } }] } });
        await assert.rejects(pp.capturar('ORDEN123456', opts), e => e.status === 402);
    });
    await test('id de orden con formato inválido → 400', async () => {
        const { pp } = cliente();
        await assert.rejects(pp.capturar('../../x', opts), e => e.status === 400);
    });
    await test('activo() depende de las credenciales', async () => {
        assert.ok(PayPal.crear(cfg, async () => '').activo());
        assert.ok(!PayPal.crear({}, async () => '').activo());
    });
    console.log(`\n${passed} pruebas OK`);
})();
