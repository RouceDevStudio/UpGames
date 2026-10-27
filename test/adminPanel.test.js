/**
 * Tests de los roles exclusivos del panel admin (rutas/adminPanel.js).
 * Autónomo: `node test/adminPanel.test.js` (o `npm test`).
 */
'use strict';

const assert = require('assert');
const { permisoRequerido, limiteRevision, normalizarPermisos, ROLES, PERMISOS } = require('../rutas/adminPanel');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// ¿Un sub-admin con estos permisos puede usar la ruta?
const puede = (permisos, m, p) => { const r = permisoRequerido(m, p); return r === null || (Array.isArray(r) && r.some(x => permisos.includes(x))); };

console.log('permisoRequerido');
const casos = [
    ['GET', '/admin/equipo', 'owner'], ['PUT', '/admin/equipo/pepe', 'owner'], ['POST', '/admin/equipo-emergencia', 'owner'],
    ['GET', '/admin/auditoria', 'owner'], ['GET', '/admin/auth/me', null],
    ['POST', '/admin/sistema/anuncio', ['anuncios']], ['GET', '/admin/sistema/diagnostico', ['sistema']],
    ['GET', '/admin/stats/dashboard', ['estadisticas']], ['GET', '/analytics/admin/funnel', ['estadisticas']],
    ['POST', '/admin/finanzas/procesar-pago/1', ['finanzas']], ['PUT', '/admin/users/ajustar-saldo/1', ['finanzas']],
    ['PUT', '/admin/users/suspender/1', ['sanciones']], ['DELETE', '/auth/users/1', ['sanciones']], ['DELETE', '/admin/users/1/items', ['sanciones']],
    ['GET', '/auth/users', ['usuarios', 'sanciones', 'finanzas']], ['PUT', '/admin/users/lista-negra/1', ['usuarios']],
    ['PUT', '/auth/admin/verificacion/pepe', ['usuarios']], ['DELETE', '/comentarios/1', ['comentarios']],
    ['DELETE', '/items/1', ['contenido']], ['PUT', '/admin/items/1', ['revision', 'contenido']], ['GET', '/admin/items', ['revision', 'contenido']],
    ['GET', '/admin/ruta-desconocida', ['sistema']],
];
for (const [m, p, e] of casos) test(`${m} ${p}`, () => assert.deepStrictEqual(permisoRequerido(m, p), e));

console.log('roles exclusivos');
test('Tesorero solo ve finanzas', () => {
    const t = ROLES.tesorero.permisos;
    assert.ok(puede(t, 'POST', '/admin/finanzas/procesar-pago/1'));
    for (const [m, p] of [['GET', '/admin/items'], ['DELETE', '/comentarios/1'], ['GET', '/admin/stats/dashboard'], ['PUT', '/admin/users/suspender/1'], ['POST', '/admin/sistema/anuncio']])
        assert.ok(!puede(t, m, p), `${m} ${p}`);
});
test('Revisor no puede borrar ni ver usuarios', () => {
    const r = ROLES.revisor.permisos;
    assert.ok(puede(r, 'PUT', '/admin/items/1'));
    assert.ok(!puede(r, 'DELETE', '/items/1'));
    assert.ok(!puede(r, 'GET', '/auth/users'));
});
test('Moderador solo comentarios', () => {
    const r = ROLES.moderador.permisos;
    assert.ok(puede(r, 'DELETE', '/comentarios/1'));
    assert.ok(!puede(r, 'GET', '/admin/items'));
});
test('todas las plantillas usan permisos existentes', () => {
    for (const [k, r] of Object.entries(ROLES)) if (r.permisos) r.permisos.forEach(p => assert.ok(PERMISOS[p], `${k}: ${p}`));
});

console.log('limiteRevision');
const rq = (method, path, body) => ({ method, path, body });
test('revisor puede cambiar estado', () => assert.strictEqual(limiteRevision(rq('PUT', '/admin/items/1', { status: 'aprobado', linkStatus: 'online', reportes: 0 })), null));
test('revisor no puede cambiar el enlace', () => assert.ok(limiteRevision(rq('PUT', '/admin/items/1', { link: 'https://x' }))));
test('revisor no puede eliminar en lote', () => assert.ok(limiteRevision(rq('PUT', '/admin/items/bulk-action', { action: 'eliminar' }))));
test('revisor puede aprobar en lote', () => assert.strictEqual(limiteRevision(rq('PUT', '/admin/items/bulk-action', { action: 'aprobar' })), null));

console.log('normalizarPermisos');
test('permisos de la v1 se amplían', () => assert.deepStrictEqual(normalizarPermisos({ adminPermisos: ['contenido'] }).sort(), ['comentarios', 'contenido', 'estadisticas', 'revision']));
test('permisos v2 se respetan tal cual', () => assert.deepStrictEqual(normalizarPermisos({ adminPermisos: ['finanzas'], adminPermisosV: 2 }), ['finanzas']));
test('descarta permisos desconocidos', () => assert.deepStrictEqual(normalizarPermisos({ adminPermisos: ['finanzas', 'hack'], adminPermisosV: 2 }), ['finanzas']));

console.log(`\n${passed} pruebas OK`);
