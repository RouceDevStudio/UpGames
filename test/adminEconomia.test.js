/**
 * Tests de la clasificación de ventas del panel admin → Economía (rutas/adminEconomia.js).
 * Autónomo: `node test/adminEconomia.test.js` (o `npm test`).
 */
'use strict';

const assert = require('assert');
const { clasificar } = require('../rutas/adminEconomia');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

test('paquete de UpCoins con tarjeta o PayPal = venta con dinero', () => {
    assert.deepStrictEqual(clasificar({ tipo: 'compra', metodo: 'tarjeta_mp', monedas: 250 }), { producto: 'paquete', conDinero: true });
    assert.deepStrictEqual(clasificar({ tipo: 'compra', metodo: '', monedas: 100 }), { producto: 'paquete', conDinero: true });   // compras antiguas por PayPal
});
test('Premium: con dinero es ingreso; con UpCoins es consumo', () => {
    assert.deepStrictEqual(clasificar({ tipo: 'plan', metodo: 'paypal', planId: 'pase30' }), { producto: 'premium', conDinero: true });
    for (const metodo of ['upcoins', 'saldo', 'monedas']) assert.strictEqual(clasificar({ tipo: 'plan', metodo, planId: 'pase7' }).conDinero, false, metodo);
});
test('NEXUS y destacar siempre son consumo de UpCoins', () => {
    assert.deepStrictEqual(clasificar({ tipo: 'compra', metodo: 'upcoins', planId: 'ia:ia25', monedas: 20 }), { producto: 'nexus', conDinero: false });
    assert.deepStrictEqual(clasificar({ tipo: 'compra', metodo: 'upcoins', planId: 'impulso:abc', monedas: 50 }), { producto: 'destacar', conDinero: false });
});
test('acceso directo: con dinero (0 UC) vs con UpCoins (50 UC, también registros antiguos sin método)', () => {
    assert.strictEqual(clasificar({ tipo: 'acceso', metodo: 'tarjeta_mp', monedas: 0 }).conDinero, true);
    assert.strictEqual(clasificar({ tipo: 'acceso', metodo: '', monedas: 50 }).conDinero, false);
    assert.strictEqual(clasificar({ tipo: 'acceso', metodo: 'upcoins', monedas: 50 }).conDinero, false);
    assert.strictEqual(clasificar({ tipo: 'acceso', metodo: 'pase', monedas: 0 }).producto, 'apertura_premium');
});
test('regalos en lives nunca cuentan como ingreso nuevo', () => {
    assert.deepStrictEqual(clasificar({ tipo: 'regalo', metodo: '', monedas: 500 }), { producto: 'regalo', conDinero: false });
});

console.log(`\n${passed} pruebas OK`);
