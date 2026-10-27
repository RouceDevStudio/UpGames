/**
 * Tests de la recomendación de Nexus para revisar publicaciones (modulos/revisionIA.js).
 * Autónomo y sin red: `node test/revisionIA.test.js` (o `npm test`).
 */
'use strict';

const assert = require('assert');
const { analizar, ipPrivada, PIRATERIA } = require('../modulos/revisionIA');

let passed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// Modelos falsos con la misma forma de consulta que Mongoose
const q = v => ({ select() { return this; }, limit() { return this; }, lean: async () => v });
function deps({ autor = {}, previas = 0, iaRespuesta = null, errLink = null } = {}) {
    return {
        Juego: { find: () => q([]), countDocuments: async () => previas, aggregate: async () => [{ r: 0, m: 0 }] },
        Usuario: { findOne: () => q({ usuario: 'ana', fecha: new Date(Date.now() - 400 * 864e5), verificadoNivel: 2, emailVerificado: true, listaSeguidores: [], ...autor }) },
        errorLinkPublicacion: () => errLink,
        gameDetector: { detectGame: () => null },
        nexusClient: { moderarItem: async () => (iaRespuesta ? { ok: true, analisis: iaRespuesta } : null) },
        logger: { warn() {} },
    };
}
const item = (extra = {}) => ({ _id: 'x', usuario: 'ana', title: 'Pack de texturas HD', description: 'Texturas en alta resolución para el modo creativo, con instrucciones de instalación paso a paso y compatibilidad con la versión 1.20.', link: 'https://no-existe.invalid/archivo.zip', image: '', images: [], category: 'Mod', createdAt: new Date(), ...extra });

(async () => {
    console.log('ipPrivada');
    await test('bloquea redes privadas', () => ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.1.1', '169.254.169.254', '::1'].forEach(ip => assert.ok(ipPrivada(ip), ip)));
    await test('permite IPs públicas', () => ['8.8.8.8', '140.82.112.3'].forEach(ip => assert.ok(!ipPrivada(ip), ip)));

    console.log('piratería');
    await test('detecta crack/keygen', () => { assert.ok(PIRATERIA.test('GTA V Full Crack')); assert.ok(PIRATERIA.test('incluye keygen')); });
    await test('no confunde palabras normales', () => assert.ok(!PIRATERIA.test('Pack de texturas HD para Minecraft')));

    console.log('decisión');
    await test('enlace no permitido → rechazar aunque la IA diga aprobar', async () => {
        const a = await analizar(item(), deps({ errLink: 'Plataforma no permitida', iaRespuesta: { decision: 'aprobar', confianza: 0.99 } }));
        assert.strictEqual(a.decision, 'rechazar'); assert.ok(a.motivosDuros.length);
    });
    await test('piratería en el título → rechazar', async () => {
        const a = await analizar(item({ title: 'Juego Full Crack' }), deps({ errLink: null }));
        assert.strictEqual(a.decision, 'rechazar');
    });
    await test('autor suspendido → rechazar', async () => {
        const a = await analizar(item(), deps({ autor: { suspendido: true } }));
        assert.strictEqual(a.decision, 'rechazar');
    });
    await test('sin IA: usa reglas y lo indica', async () => {
        const a = await analizar(item(), deps());
        assert.strictEqual(a.ia, null); assert.ok(['aprobar', 'revisar', 'rechazar'].includes(a.decision));
    });
    await test('IA y reglas de acuerdo → más confianza', async () => {
        const sin = await analizar(item(), deps());
        const con = await analizar(item(), deps({ iaRespuesta: { decision: sin.reglas, confianza: 0.9, razones: ['ok'] } }));
        assert.strictEqual(con.decision, sin.reglas); assert.ok(con.confianza >= sin.confianza);
        assert.strictEqual(con.ia.fuente, 'Nexus IA');
    });
    await test('IA dice rechazar con mucha confianza → no aprueba', async () => {
        const a = await analizar(item(), deps({ iaRespuesta: { decision: 'rechazar', confianza: 0.9, razones: ['parece spam'] } }));
        assert.notStrictEqual(a.decision, 'aprobar');
    });
    await test('respuesta "IA no disponible" de Nexus se ignora', async () => {
        const a = await analizar(item(), deps({ iaRespuesta: { decision: 'revisar', razones: ['IA no disponible: requiere revisión manual'] } }));
        assert.ok(!a.ia || a.ia.fuente !== 'Nexus IA');
    });
    await test('enlace a host inexistente queda como no verificable, no como muerto', async () => {
        const a = await analizar(item(), deps());
        assert.strictEqual(a.enlace.estado, 'no_verificable');
    });

    console.log(`\n${passed} pruebas OK`);
})();
