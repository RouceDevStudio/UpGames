/**
 * Cero tolerancia (modulos/ceroTolerancia.js) y registro de grupos (rutas/grupos.js).
 * Autónomo: `node test/ceroTolerancia.test.js` (o `npm test`).
 */
'use strict';
const assert = require('assert');
const C = require('../modulos/ceroTolerancia');
const M = require('../modulos/moderacion');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const cat = t => C.revisarTexto(t).categoria || 'ok';

console.log('Cero tolerancia');
test('menores: términos y combinaciones sexual + menor', () => {
    for (const t of ['vendo videos de niñas desnudas', 'pack de cp barato', 'pthc links', 'tengo 15 años y quiero sexo', 'pasa nudes de tu hermana de 12 años', 'pornografía infantil gratis', 'p0rn0 con n1ñas'])
        assert.strictEqual(cat(t), 'menores', t);
});
test('zoofilia, abuso y gore real', () => {
    assert.strictEqual(cat('tengo videos de zoofilia'), 'zoofilia');
    assert.strictEqual(cat('sexo con mi perro'), 'zoofilia');
    assert.strictEqual(cat('fotos de violacion real'), 'abuso');
    assert.strictEqual(cat('grupo de gore real'), 'gore');
    assert.strictEqual(cat('video de decapitacion'), 'gore');
});
test('no confunde jerga, juegos ni adultos', () => {
    for (const t of ['hola bebe te extraño', 'este juego está caliente para niños', 'descarga hot wheels para niños', 'me encanta el gore de mortal kombat', 'sexo con mi novia de 25 años',
        'tengo 12 años de experiencia', 'educación sexual para niños', 'niño jugando free fire', 'juego para niños de 8 años', 'pack de skins cp2077', 'contenido +18 entre adultos', 'juego de zombies con mucha sangre'])
        assert.strictEqual(cat(t), 'ok', t);
});
test('hablar en contra (denunciar) no se reporta', () => {
    assert.strictEqual(cat('hay que denunciar la pornografia infantil'), 'ok');
    assert.strictEqual(cat('la zoofilia está prohibida aquí'), 'ok');
});
test('la moderación general bloquea y marca como grave', () => {
    const r = M.reglas('vendo videos de niñas desnudas', 'comentario');
    assert.ok(r.bloquear && r.grave && r.cero); assert.strictEqual(r.categoria, 'menores');
    assert.ok(M.MENSAJE.menores && M.MENSAJE.gore);
});
test('ipDe toma la IP de express o del encabezado', () => {
    assert.strictEqual(C.ipDe({ ip: '1.2.3.4' }), '1.2.3.4');
    assert.strictEqual(C.ipDe({ headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.1' } }), '5.6.7.8');
    assert.strictEqual(C.ipDe(null), '');
});

console.log('Grupos');
test('registra todas las rutas sin errores', () => {
    const rutas = [];
    const app = new Proxy({}, { get: (_, m) => (path) => rutas.push(`${m.toUpperCase()} ${path}`) });
    const noop = () => {};
    require('../rutas/grupos').registrar(app, { verificarToken: noop, Usuario: {}, Notificacion: {}, push: {}, urlImagenSegura: noop, Moderacion: M, CeroTolerancia: C, Limites: {}, logger: console });
    for (const r of ['GET /grupos/mios', 'GET /grupos/explorar', 'POST /grupos', 'POST /grupos/:id/unirse', 'GET /grupos/:id/mensajes', 'POST /grupos/:id/mensajes', 'POST /grupos/:id/mensajes/:mid/reportar', 'POST /grupos/:id/miembros/:usuario'])
        assert.ok(rutas.includes(r), r);
    // Las rutas fijas van antes que /grupos/:id (si no, "mios" se tomaría como id)
    assert.ok(rutas.indexOf('GET /grupos/mios') < rutas.indexOf('GET /grupos/:id'));
    assert.ok(rutas.indexOf('GET /grupos/explorar') < rutas.indexOf('GET /grupos/:id'));
});

console.log(`\n${passed} pruebas correctas`);
