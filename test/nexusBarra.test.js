/**
 * Nexus en la barra de búsqueda (filtros.js) y "¿Funciona en mi celular?" (compatibilidad.js).
 * Autónomo y sin red: `node test/nexusBarra.test.js`.
 */
'use strict';
delete process.env.GROQ_API_KEY;
const assert = require('assert');
const F = require('../modulos/nexus/filtros');
const C = require('../modulos/nexus/compatibilidad');

let passed = 0;
async function test(n, fn) { try { await fn(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.stack}`); process.exitCode = 1; } }

const items = [
    { _id: '1', title: 'Asphalt 8 Lite', description: 'Carreras arcade. Requisitos: 2 GB de RAM', category: 'Juego', extraData: { plataforma: 'Android', size: '900 MB' }, descargasEfectivas: 50, createdAt: '2026-01-01' },
    { _id: '2', title: 'Need for Speed Most Wanted port', description: 'Racing en Winlator, 6 GB de RAM', category: 'Juego', extraData: { plataforma: 'Android', size: '4 GB' }, descargasEfectivas: 900, createdAt: '2026-02-01' },
    { _id: '3', title: 'F1 2014 PC', description: 'Formula 1 racing', category: 'Juego', extraData: { plataforma: 'PC', size: '12 GB' }, descargasEfectivas: 300, createdAt: '2026-03-01' },
    { _id: '4', title: 'Resident Evil 4 mod', description: 'terror', category: 'Mod', extraData: {}, descargasEfectivas: 10, createdAt: '2026-04-01' },
];
// Juego falso: aplica categoría y $or por regex como Mongo
const Juego = { find: q => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => items.filter(it => {
    if (typeof q.category === 'string' && it.category !== q.category) return false;
    if (q.category?.$ne && it.category === q.category.$ne) return false;
    if (q.$or) { const re = q.$or[0].title; return re.test(it.title) || re.test(it.description); }
    return true;
}) }) }) }) }) };

(async () => {
    console.log('nexus · barra de búsqueda');
    await test('reglas: categoría, plataforma, RAM, orden y sinónimos', () => {
        const f = F.porReglas('juegos de carreras que corran en 3 GB de RAM para android');
        assert.strictEqual(f.categoria, 'Juego'); assert.strictEqual(f.plataforma, 'Android'); assert.strictEqual(f.ramMaxGB, 3);
        assert.ok(f.terminos.includes('carreras') && f.terminos.includes('racing'));
        assert.ok(!f.terminos.includes('android') && !f.terminos.includes('ram'));
        assert.strictEqual(F.porReglas('los mods más descargados').orden, 'descargas');
        assert.strictEqual(F.porReglas('juegos ligeros que pesen menos de 500 mb').tamanoMaxGB, 500 / 1024);
        assert.strictEqual(F.porReglas('juegos para gama baja').ramMaxGB, 3);
    });
    await test('sanear descarta valores inventados por la IA', () => {
        const f = F.sanear({ categoria: 'Hack', plataforma: 'Nokia', terminos: ['Racing', '<script>', 'x'.repeat(80)], ramMaxGB: 999, orden: 'random' });
        assert.strictEqual(f.categoria, null); assert.strictEqual(f.plataforma, null); assert.strictEqual(f.ramMaxGB, null); assert.strictEqual(f.orden, 'relevancia');
        assert.deepStrictEqual(f.terminos, ['racing', 'script']);
    });
    await test('busca en el catálogo: filtra RAM/plataforma y ordena por relevancia', async () => {
        const r = await F.buscar(F.porReglas('juegos de carreras que corran en 3 GB de RAM para android'), { Juego });
        assert.deepStrictEqual(r.map(x => x._id), ['1']);   // NFS pide 6 GB, F1 es de PC
        const todos = await F.buscar(F.porReglas('juegos de carreras'), { Juego });
        assert.strictEqual(todos.length, 3);
        assert.ok(todos.every(x => !('link' in x)));
    });
    await test('interpretar sin IA usa las reglas y lo resume', async () => {
        const r = await F.interpretar('mods de terror más descargados');
        assert.strictEqual(r.filtros.categoria, 'Mod'); assert.strictEqual(r.fuente, null);
        assert.deepStrictEqual(F.resumen(r.filtros), ['Mods', 'más descargados']);
    });

    console.log('nexus · ¿funciona en mi celular?');
    await test('gama de GPU', () => {
        assert.strictEqual(C.gamaGPU('Adreno (TM) 740'), 4); assert.strictEqual(C.gamaGPU('Adreno (TM) 650'), 3);
        assert.strictEqual(C.gamaGPU('Adreno (TM) 610'), 1); assert.strictEqual(C.gamaGPU('Mali-G57 MC2'), 2);
        assert.strictEqual(C.gamaGPU('Mali-G710 MC10'), 3); assert.strictEqual(C.gamaGPU('PowerVR Rogue GE8320'), 1);
        assert.strictEqual(C.gamaGPU(''), null); assert.strictEqual(C.gamaGPU('Google SwiftShader'), null);
    });
    const tope = { so: 'android', gpu: 'Adreno (TM) 740', ramGB: 8, nucleos: 8 };
    const baja = { so: 'android', gpu: 'PowerVR Rogue GE8320', ramGB: 2, nucleos: 8 };
    await test('port de PC por Winlator: sí en gama alta Adreno, no en gama baja', () => {
        const a = C.evaluar(items[1], tope), b = C.evaluar(items[1], baja);
        assert.strictEqual(a.veredicto, 'si'); assert.strictEqual(b.veredicto, 'no');
        assert.ok(a.ajustes.some(x => /Turnip/.test(x)));
    });
    await test('juego ligero: funciona incluso en gama baja', () => assert.ok(['si', 'probable'].includes(C.evaluar(items[0], baja).veredicto)));
    await test('Mali en un port de PC baja la nota', () => assert.ok(C.evaluar(items[1], { ...tope, gpu: 'Mali-G710 MC10' }).puntuacion < C.evaluar(items[1], tope).puntuacion));
    await test('APK en iPhone → no; en PC → no aplica; videos → no aplica', () => {
        assert.strictEqual(C.evaluar(items[0], { so: 'ios', gpu: 'Apple GPU' }).veredicto, 'no');
        assert.strictEqual(C.evaluar(items[0], { so: 'windows', gpu: 'NVIDIA GeForce RTX 3060' }).veredicto, 'no_aplica');
        assert.strictEqual(C.evaluar({ title: 'x', category: 'Video' }, tope).veredicto, 'no_aplica');
    });
    await test('juego de PC visto desde Android: explica que necesita Winlator', () => {
        const r = C.evaluar(items[2], tope);
        assert.ok(r.razones.some(x => /Winlator/.test(x)));
    });
    await test('limpia datos del navegador', () => {
        const d = C.dispositivo({ so: 'hack', gpu: '<img onerror=x>'.repeat(20), ramGB: 9999, nucleos: 'a' });
        assert.strictEqual(d.so, 'otro'); assert.ok(!/[<>=]/.test(d.gpu) && d.gpu.length <= 80); assert.strictEqual(d.ramGB, null); assert.strictEqual(d.nucleos, null);
    });
    console.log(`\nnexus barra: ${passed} pruebas OK`);
})();
