/**
 * Tests del envío de correos (modulos/correo.js) con un transporte simulado.
 * Autónomo: `node test/correo.test.js` (o `npm test`).
 */
'use strict';

const assert = require('assert');
const C = require('../modulos/correo');
const log = { info() {}, warn() {}, error() {} };

let passed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

(async () => {
    await test('Brevo: envía por la API HTTPS con remitente y destinatario', async () => {
        const llamadas = [];
        const c = C.crear({ env: { BREVO_API_KEY: 'xkeysib-1', EMAIL_FROM: 'yo@gmail.com', GMAIL_USER: 'yo@gmail.com', GMAIL_APP_PASSWORD: 'x' }, logger: log,
            transporte: async (host, path, headers, body) => { llamadas.push({ host, path, headers, body }); return { status: 201, data: { messageId: 'm1' } }; } });
        assert.strictEqual(c.proveedor, 'brevo');   // Brevo tiene prioridad sobre el SMTP bloqueado
        assert.strictEqual(await c.enviar({ to: 'a@b.com', subject: 'Hola', html: '<b>x</b>' }), true);
        assert.strictEqual(llamadas[0].host, 'api.brevo.com'); assert.strictEqual(llamadas[0].headers['api-key'], 'xkeysib-1');
        assert.deepStrictEqual(llamadas[0].body.to, [{ email: 'a@b.com' }]); assert.strictEqual(llamadas[0].body.sender.email, 'yo@gmail.com');
    });
    await test('Brevo: un error de la API devuelve false (no lanza)', async () => {
        const c = C.crear({ env: { BREVO_API_KEY: 'k', EMAIL_FROM: 'yo@gmail.com' }, logger: log, transporte: async () => ({ status: 401, data: { message: 'Key not found' } }) });
        assert.strictEqual(await c.enviar({ to: 'a@b.com', subject: 's', html: 'h' }), false);
        assert.match(c.estado().detalle, /401/);
    });
    await test('Resend: usa Authorization Bearer', async () => {
        let h; const c = C.crear({ env: { RESEND_API_KEY: 're_1', EMAIL_FROM: 'hola@midominio.com' }, logger: log, transporte: async (host, path, headers) => { h = { host, headers }; return { status: 200, data: { id: 'x' } }; } });
        assert.strictEqual(await c.enviar({ to: 'a@b.com', subject: 's', html: 'h' }), true);
        assert.strictEqual(h.host, 'api.resend.com'); assert.strictEqual(h.headers.Authorization, 'Bearer re_1');
    });
    await test('Resend tiene prioridad si también hay clave de Brevo', async () => {
        const c = C.crear({ env: { RESEND_API_KEY: 're_1', BREVO_API_KEY: 'xkeysib-1', EMAIL_FROM: 'no-reply@upgames.games' }, logger: log, transporte: async () => ({ status: 200, data: {} }) });
        assert.strictEqual(c.proveedor, 'resend');
    });
    await test('sin proveedor ni remitente → false con explicación', async () => {
        const c = C.crear({ env: {}, logger: log });
        assert.strictEqual(c.proveedor, null);
        assert.strictEqual(await c.enviar({ to: 'a@b.com', subject: 's', html: 'h' }), false);
        assert.match((await c.verificar()).detalle, /RESEND_API_KEY/);
    });
    await test('SMTP bloqueado por el hosting: lo explica', async () => {
        const nodemailer = { createTransport: () => ({ sendMail: async () => { throw new Error('connect ETIMEDOUT 74.125.0.1:465'); }, verify: async () => { throw new Error('Connection timeout'); } }) };
        const c = C.crear({ env: { GMAIL_USER: 'yo@gmail.com', GMAIL_APP_PASSWORD: 'x' }, nodemailer, logger: log });
        assert.strictEqual(await c.enviar({ to: 'a@b.com', subject: 's', html: 'h' }), false);
        assert.match(c.estado().detalle, /RESEND_API_KEY/);
        assert.match((await c.verificar()).detalle, /bloquea SMTP/);
    });
    console.log(`\n${passed} pruebas OK`);
})();
