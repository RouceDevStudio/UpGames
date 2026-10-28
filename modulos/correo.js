/**
 * Envío de correos (verificación, recuperar contraseña, avisos de seguridad).
 *
 * Railway bloquea el SMTP saliente (puertos 25/465/587) en los planes Free, Trial
 * y Hobby: con Gmail por SMTP los correos nunca salían. Por eso se envía por una
 * API HTTPS, que funciona en todos los planes (se usa el primero configurado):
 *   1. Resend  — RESEND_API_KEY + dominio verificado (upgames.games). EMAIL_FROM p. ej.
 *                no-reply@upgames.games. Gratis hasta 3.000 correos/mes (100/día).
 *   2. Brevo   — BREVO_API_KEY. Permite un Gmail verificado como remitente.
 *   3. SMTP    — GMAIL_USER + GMAIL_APP_PASSWORD (solo si el plan permite SMTP).
 * Remitente: EMAIL_FROM (o GMAIL_USER). Nombre: EMAIL_FROM_NAME (por defecto UpGames).
 */
'use strict';

const https = require('https');

function postJSON(hostname, path, headers, body, timeout = 15000) {
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const r = https.request({ hostname, path, method: 'POST', timeout,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { let j = {}; try { j = d ? JSON.parse(d) : {}; } catch (_) {} resolve({ status: res.statusCode, data: j }); });
        });
        r.on('timeout', () => r.destroy(new Error('el proveedor de correo no respondió a tiempo')));
        r.on('error', reject);
        r.end(payload);
    });
}
function getJSON(hostname, path, headers, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const r = https.request({ hostname, path, method: 'GET', timeout, headers: { Accept: 'application/json', ...headers } }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { let j = {}; try { j = d ? JSON.parse(d) : {}; } catch (_) {} resolve({ status: res.statusCode, data: j }); });
        });
        r.on('timeout', () => r.destroy(new Error('sin respuesta')));
        r.on('error', reject);
        r.end();
    });
}

function crear({ env = process.env, nodemailer, logger, transporte } = {}) {
    const limpio = v => String(v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    const remitente = () => limpio(env.EMAIL_FROM || env.GMAIL_USER);
    const nombre = () => limpio(env.EMAIL_FROM_NAME) || 'UpGames';
    const proveedor = limpio(env.RESEND_API_KEY) ? 'resend' : limpio(env.BREVO_API_KEY) ? 'brevo'
        : (limpio(env.GMAIL_USER) && limpio(env.GMAIL_APP_PASSWORD)) ? 'smtp' : null;
    let smtp = null;
    if (proveedor === 'smtp' && nodemailer) {
        smtp = nodemailer.createTransport({ service: 'gmail', auth: { user: limpio(env.GMAIL_USER), pass: limpio(env.GMAIL_APP_PASSWORD) },
            connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000 });
    }
    const post = transporte || postJSON;
    let estado = { ok: null, proveedor, detalle: '' };

    async function enviar({ to, subject, html }) {
        if (!proveedor) { logger?.warn?.(`[Email] Sin proveedor configurado — no se envió a ${to}`); return false; }
        if (!remitente()) { logger?.error?.('[Email] Falta EMAIL_FROM (o GMAIL_USER): el remitente de los correos'); return false; }
        try {
            if (proveedor === 'brevo') {
                const r = await post('api.brevo.com', '/v3/smtp/email', { 'api-key': limpio(env.BREVO_API_KEY) },
                    { sender: { name: nombre(), email: remitente() }, to: [{ email: to }], subject, htmlContent: html });
                if (r.status >= 300) throw new Error(`Brevo HTTP ${r.status}: ${r.data?.message || r.data?.code || ''}`);
            } else if (proveedor === 'resend') {
                const r = await post('api.resend.com', '/emails', { Authorization: `Bearer ${limpio(env.RESEND_API_KEY)}` },
                    { from: `${nombre()} <${remitente()}>`, to: [to], subject, html });
                if (r.status >= 300) throw new Error(`Resend HTTP ${r.status}: ${r.data?.message || r.data?.name || ''}`);
            } else {
                await smtp.sendMail({ from: `"${nombre()}" <${remitente()}>`, to, subject, html });
            }
            logger?.info?.(`[Email] Enviado (${proveedor}) a ${to} — ${subject}`);
            estado = { ...estado, ok: true, detalle: '' };
            return true;
        } catch (e) {
            const msg = String(e.message || e);
            const bloqueado = proveedor === 'smtp' && /timeout|ETIMEDOUT|ENETUNREACH|unreachable|ECONNREFUSED/i.test(msg);
            estado = { ...estado, ok: false, detalle: bloqueado ? 'SMTP bloqueado por el hosting: configura RESEND_API_KEY' : msg.slice(0, 200) };
            logger?.error?.(`[Email] Error enviando a ${to} (${proveedor}): ${msg}${bloqueado ? ' — Railway bloquea SMTP en el plan Hobby: usa RESEND_API_KEY' : ''}`);
            return false;
        }
    }

    /** Comprueba la configuración al arrancar (sin enviar ningún correo). */
    async function verificar() {
        if (!proveedor) return (estado = { ok: false, proveedor: null, detalle: 'Sin proveedor: define RESEND_API_KEY y EMAIL_FROM' });
        try {
            if (proveedor === 'brevo') {
                const r = await getJSON('api.brevo.com', '/v3/account', { 'api-key': limpio(env.BREVO_API_KEY) });
                estado = r.status === 200 ? { ok: true, proveedor, detalle: '' } : { ok: false, proveedor, detalle: `Brevo rechazó BREVO_API_KEY (HTTP ${r.status})` };
            } else if (proveedor === 'resend') {
                // Una clave solo de envío no puede listar dominios: Resend responde 401 "restricted_api_key",
                // lo que igual confirma que la clave existe. Cualquier otro 401/403 = clave inválida.
                const r = await getJSON('api.resend.com', '/domains', { Authorization: `Bearer ${limpio(env.RESEND_API_KEY)}` });
                const valida = r.status === 200 || r.data?.name === 'restricted_api_key';
                const dominio = remitente().split('@')[1] || '';
                const d = r.status === 200 && Array.isArray(r.data?.data) ? r.data.data.find(x => x.name === dominio) : null;
                estado = !valida ? { ok: false, proveedor, detalle: `Resend rechazó RESEND_API_KEY (HTTP ${r.status})` }
                    : d && d.status !== 'verified' ? { ok: false, proveedor, detalle: `El dominio ${dominio} aún no está verificado en Resend (${d.status})` }
                    : { ok: true, proveedor, detalle: '' };
            } else if (proveedor === 'smtp' && smtp) {
                await smtp.verify();
                estado = { ok: true, proveedor, detalle: '' };
            } else estado = { ok: true, proveedor, detalle: '' };
        } catch (e) {
            const bloqueado = /timeout|ETIMEDOUT|ENETUNREACH|unreachable|ECONNREFUSED/i.test(e.message);
            estado = { ok: false, proveedor, detalle: bloqueado ? 'El hosting bloquea SMTP (Railway Hobby). Configura RESEND_API_KEY.' : e.message.slice(0, 200) };
        }
        return estado;
    }

    return { enviar, verificar, estado: () => ({ ...estado, remitente: remitente() ? remitente().replace(/^(.{2})[^@]*/, '$1•••') : '' }), proveedor };
}

module.exports = { crear };
