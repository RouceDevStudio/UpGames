/**
 * Tests de la Nexus nativa (modulos/nexus/*, rutas/nexus.js).
 * Autónomo: `node test/nexus.test.js` (o `npm test`). Sin red ni base de datos.
 */
'use strict';

const assert = require('assert');
const llm = require('../modulos/nexus/llm');
const H = require('../modulos/nexus/herramientas');
const { limpiarTexto, sistema } = require('../modulos/nexus/cerebro');
const { porReglas } = require('../modulos/nexus/mentor');
const { limitador } = require('../rutas/nexus');

let passed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

(async () => {
    console.log('llm');
    await test('parsea JSON envuelto en ```', () => assert.deepStrictEqual(llm.parsearJSON('```json\n{"a":1}\n```'), { a: 1 }));
    await test('JSON roto → null', () => assert.strictEqual(llm.parsearJSON('{"a":'), null));
    await test('sin GROQ_API_KEY no llama a nadie', async () => {
        const k = process.env.GROQ_API_KEY; delete process.env.GROQ_API_KEY;
        assert.strictEqual(llm.disponible(), false);
        assert.strictEqual(await llm.completar({ mensajes: [] }), null);
        if (k) process.env.GROQ_API_KEY = k;
    });

    console.log('herramientas');
    await test('todas las definiciones tienen ejecutor', () => {
        const { ejecutores } = H.crear({}, { salida: { items: new Map(), acciones: [] } });
        for (const d of H.DEFINICIONES) assert.ok(ejecutores[d.function.name], d.function.name);
    });
    await test('la ficha pública nunca incluye el enlace', () => {
        const l = H.lite({ _id: 'a'.repeat(24), title: 'X', link: 'https://mega.nz/secreto', image: 'javascript:alert(1)', category: 'Mod' });
        assert.ok(!JSON.stringify(l).includes('mega.nz')); assert.strictEqual(l.imagen, '');
    });
    const ctx = () => ({ salida: { items: new Map(), acciones: [] } });
    await test('proponer_accion valida categoría y pestaña', async () => {
        const c = ctx(); const { ejecutores: e } = H.crear({}, c);
        assert.ok((await e.proponer_accion({ tipo: 'filtrar_categoria', valor: 'hack' })).error);
        assert.ok((await e.proponer_accion({ tipo: 'ir_a', valor: 'admin' })).error);
        await e.proponer_accion({ tipo: 'filtrar_categoria', valor: 'mod' });
        await e.proponer_accion({ tipo: 'ir_a', valor: 'economia' });
        assert.deepStrictEqual(c.salida.acciones.map(a => [a.tipo, a.valor]), [['filtrar_categoria', 'Mod'], ['ir_a', 'economia']]);
    });
    await test('máximo 3 acciones y sin duplicados', async () => {
        const c = ctx(); const { ejecutores: e } = H.crear({}, c);
        for (const v of ['Juego', 'Juego', 'Mod', 'ROM', 'Apps']) await e.proponer_accion({ tipo: 'filtrar_categoria', valor: v });
        assert.strictEqual(c.salida.acciones.length, 3);
    });
    await test('cuenta y publicaciones exigen sesión', async () => {
        const { ejecutores: e } = H.crear({}, ctx());
        assert.ok((await e.mi_cuenta()).error); assert.ok((await e.mis_publicaciones({})).error);
    });
    await test('las reglas usan los valores reales de config', async () => {
        const { ejecutores: e } = H.crear({ config: { CPM_VALUE: 1, AUTHOR_PERCENTAGE: 1, MIN_WITHDRAWAL: 10, MAX_DOWNLOADS_PER_IP_PER_DAY: 2 }, LINKS_PERMITIDOS: ['mediafire.com'] }, ctx());
        const r = await e.reglas_upgames({ tema: 'retiros' });
        assert.ok(r.texto.includes('US$10') && r.texto.includes('500 UpCoins'), r.texto.slice(0, 120));
    });

    console.log('cerebro');
    await test('limpia llamadas a herramientas escritas como texto e ids', () => {
        assert.strictEqual(limpiarTexto('<function=buscar>{"q":1}</function> Hola (507f1f77bcf86cd799439011)'), 'Hola');
    });
    await test('el sistema distingue invitado y usuario', () => {
        assert.ok(sistema({ usuario: null }).includes('invitado'));
        assert.ok(sistema({ usuario: 'luis', contexto: { categoria: 'Mod' } }).includes('@luis'));
    });

    console.log('mentor por reglas');
    await test('publicación pobre recibe consejos', () => {
        const m = porReglas({ title: 'mod', description: '', tags: [], image: '' });
        assert.ok(m.mejoras.length >= 2); assert.ok(m.alertas.length >= 1); assert.ok(m.puntuacion < 7);
    });
    await test('publicación completa puntúa alto', () => {
        const m = porReglas({ title: 'Minecraft Castillo Medieval', description: 'x'.repeat(300), tags: ['minecraft'], image: 'https://a/b.jpg', images: ['https://a/c.jpg'], category: 'Mod' });
        assert.ok(m.puntuacion >= 8, String(m.puntuacion));
    });

    console.log('límite de uso');
    await test('bloquea al pasar del límite por minuto', () => {
        const lim = limitador(2, 10);
        assert.strictEqual(lim('a'), null); assert.strictEqual(lim('a'), null); assert.ok(lim('a')); assert.strictEqual(lim('b'), null);
    });

    console.log(`\n${passed} pruebas OK`);
})();
