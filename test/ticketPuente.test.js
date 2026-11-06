/**
 * Ticket de la página puente (modulos/ticketPuente.js). `node test/ticketPuente.test.js`
 */
'use strict';
const assert = require('assert');
const T = require('../modulos/ticketPuente');
let passed = 0;
function test(n, fn) { try { fn(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } }
const S = 'secreto', ID = 'a'.repeat(24), IP = '1.2.3.4', t0 = 1_800_000_000_000;

console.log('ticketPuente');
test('después de la espera, válido', () => { const { ticket } = T.emitir(S, ID, IP, t0); assert.ok(T.verificar(S, ticket, ID, IP, t0 + T.ESPERA_MS).ok); });
test('antes de la espera → pronto, con segundos restantes', () => { const { ticket } = T.emitir(S, ID, IP, t0); const r = T.verificar(S, ticket, ID, IP, t0 + 10e3); assert.strictEqual(r.motivo, 'pronto'); assert.strictEqual(r.esperaRestante, 15); });
test('otra publicación, otra IP o firma alterada → inválido', () => {
    const { ticket } = T.emitir(S, ID, IP, t0), luego = t0 + 60e3;
    assert.strictEqual(T.verificar(S, ticket, 'b'.repeat(24), IP, luego).motivo, 'invalido');
    assert.strictEqual(T.verificar(S, ticket, ID, '9.9.9.9', luego).motivo, 'invalido');
    assert.strictEqual(T.verificar(S, ticket.slice(0, -1) + (ticket.endsWith('A') ? 'B' : 'A'), ID, IP, luego).motivo, 'invalido');
    assert.strictEqual(T.verificar('otro', ticket, ID, IP, luego).motivo, 'invalido');
});
test('fecha manipulada al pasado → inválido (la hora va firmada)', () => {
    const { ticket } = T.emitir(S, ID, IP, t0); const [, f] = ticket.split('.');
    assert.strictEqual(T.verificar(S, `${(t0 - 60e3).toString(36)}.${f}`, ID, IP, t0).motivo, 'invalido');
});
test('pasada media hora → vencido; sin ticket → falta', () => {
    const { ticket } = T.emitir(S, ID, IP, t0);
    assert.strictEqual(T.verificar(S, ticket, ID, IP, t0 + 31 * 60e3).motivo, 'vencido');
    assert.strictEqual(T.verificar(S, undefined, ID, IP, t0).motivo, 'falta');
});
console.log(`\nticketPuente: ${passed} pruebas OK`);
