/**
 * Tests del mapa de permisos del panel admin (rutas/adminPanel.js).
 * Autónomo: `node test/adminPanel.test.js` (o `npm test`).
 */
'use strict';

const assert = require('assert');
const { permisoRequerido } = require('../rutas/adminPanel');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const casos = [
    ['GET', '/admin/equipo', 'owner'],
    ['PUT', '/admin/equipo/pepe', 'owner'],
    ['GET', '/admin/auditoria', 'owner'],
    ['POST', '/admin/sistema/anuncio', 'usuarios'],
    ['GET', '/admin/sistema/diagnostico', 'sistema'],
    ['POST', '/admin/cache/clear', 'sistema'],
    ['POST', '/admin/finanzas/procesar-pago/1', 'finanzas'],
    ['PUT', '/admin/users/ajustar-saldo/1', 'finanzas'],
    ['PUT', '/admin/users/1/reset-saldo', 'finanzas'],
    ['DELETE', '/admin/users/1/items', 'contenido'],
    ['PUT', '/admin/users/lista-negra/1', 'usuarios'],
    ['PUT', '/admin/users/suspender/1', 'usuarios'],
    ['GET', '/auth/users', 'usuarios'],
    ['DELETE', '/auth/users/1', 'usuarios'],
    ['PUT', '/auth/admin/verificacion/pepe', 'usuarios'],
    ['GET', '/admin/items', 'contenido'],
    ['DELETE', '/items/1', 'contenido'],
    ['DELETE', '/comentarios/1', 'contenido'],
    ['GET', '/admin/stats/dashboard', null],
    ['GET', '/analytics/admin/funnel', null],
    ['GET', '/admin/ruta-nueva-desconocida', 'sistema'],
];

console.log('permisoRequerido');
for (const [m, p, esperado] of casos)
    test(`${m} ${p} → ${esperado}`, () => assert.strictEqual(permisoRequerido(m, p), esperado));

console.log(`\n${passed} pruebas OK`);
