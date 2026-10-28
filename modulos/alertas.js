/**
 * Avisos de errores en tiempo real.
 *
 *   • Cada logger.error del servidor y cada error de JavaScript de los visitantes
 *     (POST /errores/cliente) se agrupa por "firma" en la colección `errores`
 *     (cuántas veces, primera y última vez, ejemplo, página).
 *   • Un error NUEVO o un pico (≥ 20 en 10 min) manda un correo a ALERTAS_EMAIL
 *     (o al primer OWNER_EMAIL), máximo 1 por firma cada 6 h y 12 al día.
 *   • Si existe SENTRY_DSN, también se envía a Sentry (plan gratis) sin instalar nada.
 *
 * La caída total de la API la vigila .github/workflows/uptime.yml desde fuera
 * (abre un issue en GitHub y GitHub te avisa por correo).
 */
'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');
const os = require('os');

let enviarCorreo = null, log = console, instalado = false;
const col = () => mongoose.connection.collection('errores');
const destino = () => (process.env.ALERTAS_EMAIL || process.env.OWNER_EMAIL || 'jhonatandavidcastrogalviz@gmail.com').split(',')[0].trim();

// Firma: el mensaje sin números, ids ni rutas variables (para agrupar el mismo error)
const firma = (origen, msg) => crypto.createHash('sha1').update(origen + '|' + String(msg).replace(/[a-f\d]{24}/gi, ':id').replace(/\d+/g, '#').replace(/https?:\/\/\S+/g, ':url').slice(0, 300)).digest('hex').slice(0, 16);

const correosHoy = { dia: '', n: 0 };
const ultimoCorreo = new Map();
async function avisar(doc, motivo) {
    try {
        if (!enviarCorreo) return;
        const hoy = new Date().toISOString().slice(0, 10);
        if (correosHoy.dia !== hoy) { correosHoy.dia = hoy; correosHoy.n = 0; }
        if (correosHoy.n >= 12 || Date.now() - (ultimoCorreo.get(doc._id) || 0) < 6 * 3600e3) return;
        correosHoy.n++; ultimoCorreo.set(doc._id, Date.now());
        const e = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
        await enviarCorreo({
            to: destino(), subject: `🚨 UpGames: ${motivo} (${doc.origen})`,
            html: `<div style="font-family:system-ui,sans-serif;max-width:620px"><h2 style="margin:0 0 8px">🚨 ${e(motivo)}</h2>
              <p><b>Dónde:</b> ${e(doc.origen === 'navegador' ? 'en el navegador de los usuarios' : 'en el servidor')}${doc.pagina ? ' · ' + e(doc.pagina) : ''}</p>
              <p><b>Error:</b> ${e(doc.mensaje)}</p><p><b>Veces:</b> ${doc.n} · primera ${e(new Date(doc.primera).toLocaleString('es-CO'))}</p>
              ${doc.stack ? `<pre style="background:#111;color:#eee;padding:10px;border-radius:8px;white-space:pre-wrap;font-size:12px">${e(String(doc.stack).slice(0, 1500))}</pre>` : ''}
              <p style="color:#666;font-size:13px">Lo ves todo en el panel admin → API Test → Errores recientes. Este aviso no se repite para el mismo error durante 6 horas.</p></div>`,
        });
    } catch (_) {}
}

// ── Sentry (opcional, por HTTP: sin dependencias) ──
function sentry(origen, mensaje, stack, extra = {}) {
    const dsn = process.env.SENTRY_DSN; if (!dsn) return;
    try {
        const u = new URL(dsn), proyecto = u.pathname.replace(/\//g, ''), clave = u.username;
        const ev = { event_id: crypto.randomUUID().replace(/-/g, ''), timestamp: Date.now() / 1000, platform: origen === 'navegador' ? 'javascript' : 'node', level: 'error',
            server_name: os.hostname(), environment: process.env.NODE_ENV || 'production', tags: { origen }, extra,
            exception: { values: [{ type: 'Error', value: String(mensaje).slice(0, 500), stacktrace: stack ? { frames: String(stack).split('\n').slice(1, 20).reverse().map(l => ({ function: l.trim().slice(0, 200) })) } : undefined }] } };
        const sobre = `${JSON.stringify({ event_id: ev.event_id, sent_at: new Date().toISOString(), dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(ev)}`;
        fetch(`${u.protocol}//${u.host}/api/${proyecto}/envelope/`, { method: 'POST', body: sobre, headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${clave}, sentry_client=upgames/1.0` } }).catch(() => {});
    } catch (_) {}
}

/** Guarda (agrupado) y avisa si es nuevo o un pico. */
async function registrar({ origen = 'servidor', mensaje, stack = '', pagina = '', navegador = '' }) {
    try {
        if (!mensaje || mongoose.connection.readyState !== 1) return;
        const id = firma(origen, mensaje), ahora = new Date();
        const r = await col().findOneAndUpdate({ _id: id }, {
            $inc: { n: 1 }, $set: { ultima: ahora, mensaje: String(mensaje).slice(0, 500), ...(stack ? { stack: String(stack).slice(0, 4000) } : {}), ...(pagina ? { pagina: String(pagina).slice(0, 200) } : {}), ...(navegador ? { navegador: String(navegador).slice(0, 200) } : {}) },
            $setOnInsert: { origen, primera: ahora }, $push: { recientes: { $each: [ahora], $slice: -30 } },
        }, { upsert: true, returnDocument: 'after' });
        const doc = r?.value !== undefined ? r.value : r;
        if (!doc) return;
        sentry(origen, mensaje, stack, { pagina, navegador });
        const pico = (doc.recientes || []).filter(t => ahora - new Date(t) < 10 * 60000).length;
        if (doc.n === 1) avisar(doc, 'Error nuevo');
        else if (pico >= 20 && !doc.silenciado) avisar(doc, `Pico de errores (${pico} en 10 min)`);
    } catch (_) {}
}

/** Engancha logger.error y los errores del proceso. */
function instalar(logger, { sendEmail } = {}) {
    if (instalado) return; instalado = true;
    enviarCorreo = sendEmail; log = logger;
    col().createIndex({ ultima: 1 }, { expireAfterSeconds: 30 * 86400 }).catch(() => {});
    const orig = logger.error.bind(logger);
    logger.error = (m, ...resto) => {
        const r = orig(m, ...resto);
        const texto = m instanceof Error ? m.message : String(m);
        registrar({ origen: 'servidor', mensaje: texto, stack: m instanceof Error ? m.stack : '' });
        return r;
    };
}

async function recientes(limite = 50) {
    return col().find({}).project({ recientes: 0 }).sort({ ultima: -1 }).limit(Math.min(200, limite)).toArray();
}

module.exports = { instalar, registrar, recientes, firma };
