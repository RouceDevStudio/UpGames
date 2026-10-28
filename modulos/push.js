/**
 * ══════════════════════════════════════════════════════════════════
 *  push.js — Notificaciones push reales (Web Push / VAPID)
 *
 *  Llegan al móvil u ordenador aunque UpGames esté cerrado, como las de
 *  WhatsApp o Instagram. Funciona en Chrome/Edge/Firefox (Android y PC) y
 *  en iPhone con la app instalada en la pantalla de inicio (iOS 16.4+).
 *
 *  • Claves VAPID: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY si existen; si no,
 *    se generan una vez y se guardan en Mongo (colección config), así no
 *    hay que configurar nada y las suscripciones sobreviven a reinicios.
 *  • Cada Notificacion que se guarda dispara su push (hooks en index.js),
 *    respetando las preferencias del usuario (notifPrefs).
 *  • Suscripciones caducadas (404/410) se borran solas.
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const mongoose = require('mongoose');
const webpush = require('web-push');

const PushSub = mongoose.models.PushSub || mongoose.model('PushSub', new mongoose.Schema({
    usuario:  { type: String, required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys:     { p256dh: String, auth: String },
    ua:       { type: String, default: '' },
    creado:   { type: Date, default: Date.now },
    ultimoEnvio: { type: Date, default: null },
}, { collection: 'pushsubs' }));

let listo = null;          // promesa de inicialización
let clavePublica = '';
let logger = console;

async function iniciar(opts = {}) {
    if (opts.logger) logger = opts.logger;
    if (listo) return listo;
    listo = (async () => {
        let pub = (process.env.VAPID_PUBLIC_KEY || '').trim(), priv = (process.env.VAPID_PRIVATE_KEY || '').trim();
        if (!pub || !priv) {
            const col = mongoose.connection.db.collection('config');
            let doc = await col.findOne({ _id: 'vapid' });
            if (!doc) {
                const k = webpush.generateVAPIDKeys();
                try { await col.insertOne({ _id: 'vapid', publicKey: k.publicKey, privateKey: k.privateKey, creado: new Date() }); }
                catch (_) { /* otra instancia se adelantó */ }
                doc = await col.findOne({ _id: 'vapid' });
                logger.info('🔔 Claves VAPID generadas y guardadas en la base de datos');
            }
            pub = doc.publicKey; priv = doc.privateKey;
        }
        const contacto = process.env.VAPID_SUBJECT || `mailto:${(process.env.OWNER_EMAIL || 'jhonatandavidcastrogalviz@gmail.com').split(',')[0].trim()}`;
        webpush.setVapidDetails(contacto, pub, priv);
        clavePublica = pub;
        logger.info('🔔 Push listo (Web Push / VAPID)');
        return true;
    })().catch(e => { listo = null; logger.error(`[push] no se pudo iniciar: ${e.message}`); return false; });
    return listo;
}

const decodificar = s => String(s || '').replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
const recorta = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const BASE = (process.env.APP_URL || 'https://upgames.games').replace(/\/+$/, '') + '/public/';

/** Categoría de preferencias a la que pertenece una notificación (null = no se envía push). */
function categoria(n) {
    if (n.tipo === 'nueva_publicacion') return 'publicaciones';
    if (n.tipo === 'descarga') return null;                       // demasiadas: solo dentro de la app
    if (['seguidor', 'favorito', 'comentario', 'logro'].includes(n.tipo)) return 'social';
    const t = n.itemTitle || '';
    if (t === 'En vivo') return 'publicaciones';
    if (t === 'Verifica tu email' || t === 'Tu pase vence' || t === 'Tu Premium vence') return 'cuenta';
    if (t.startsWith('Mensaje')) return 'mensajes';
    if (t === 'Revisión' || t === 'Equipo') return 'cuenta';      // siempre (importa a tu cuenta)
    return 'anuncios';
}

/** Texto e enlace de la notificación del sistema operativo. */
function contenido(n) {
    const e = n.emisor ? '@' + n.emisor : 'UpGames';
    const titulo = decodificar(n.itemTitle);
    const msg = decodificar(n.mensaje);
    const img = /^https:\/\//i.test(n.itemImage || '') && !/\.(mp4|webm|mov)(\?|$)/i.test(n.itemImage) ? n.itemImage : undefined;
    const item = n.itemId && /^[a-f\d]{24}$/i.test(n.itemId) ? `${BASE}biblioteca.html?id=${n.itemId}` : `${BASE}biblioteca.html`;
    switch (n.tipo) {
        case 'nueva_publicacion': return { title: `${e} publicó algo nuevo`, body: recorta(titulo || 'Toca para verlo', 120), url: item, image: img, tag: `pub-${n.itemId}` };
        case 'seguidor':          return { title: `${e} empezó a seguirte`, body: 'Toca para ver su perfil', url: `${BASE}perfil-publico.html?u=${encodeURIComponent(n.emisor)}`, tag: `seg-${n.emisor}` };
        case 'favorito':          return { title: `A ${e} le gustó tu publicación`, body: recorta(titulo, 120), url: item, image: img, tag: `fav-${n.itemId}` };
        case 'comentario':        return { title: `${e} comentó tu publicación`, body: recorta(msg || titulo, 140), url: item, tag: `com-${n.itemId}` };
        case 'logro':             return { title: '🏆 ¡Nuevo logro!', body: recorta(msg || titulo || 'Desbloqueaste un logro', 140), url: `${BASE}biblioteca.html?tab=perfil`, tag: 'logro' };
    }
    const t = n.itemTitle || '';
    if (t.startsWith('Mensaje')) return { title: `Nuevo mensaje de ${e}`, body: recorta(msg || 'Toca para responder', 140), url: `${BASE}chats.html?usuario=${encodeURIComponent(n.emisor)}`, tag: `chat-${n.emisor}`, urgente: true };
    if (t === 'En vivo') return { title: `🔴 ${e} está en vivo`, body: recorta(msg || 'Toca para verlo ahora', 140), url: `${BASE}live.html?u=${encodeURIComponent(n.emisor)}`, tag: `live-${n.emisor}`, urgente: true };
    if (t === 'Verifica tu email') return { title: '📧 Verifica tu email', body: recorta(msg, 160), url: `${BASE}biblioteca.html?verificar=1`, tag: 'verificar-email' };
    if (t === 'Tu pase vence' || t === 'Tu Premium vence') return { title: '⏳ Tu Premium vence pronto', body: recorta(msg.replace(/^⏳\s*/, ''), 180), url: `${BASE}biblioteca.html?plan=1`, tag: 'pase-vence' };
    if (t === 'Anuncio') return { title: '📢 UpGames', body: recorta(msg.replace(/^📢\s*/, ''), 200), url: `${BASE}biblioteca.html`, tag: `anuncio-${Date.now()}` };
    if (t === 'Revisión') return { title: 'Revisión de tu publicación', body: recorta(msg, 200), url: `${BASE}biblioteca.html?tab=perfil`, tag: `rev-${n.itemId}` };
    if (t === 'Equipo') return { title: '🛡️ Equipo UpGames', body: recorta(msg, 200), url: `${BASE}biblioteca.html`, tag: `equipo-${Date.now()}` };
    return { title: 'UpGames', body: recorta(msg || titulo || 'Tienes una notificación nueva', 160), url: item, tag: `n-${n._id || Date.now()}` };
}

async function enviarA(usuarios, payloadDe, { Usuario } = {}) {
    if (!(await iniciar())) return 0;
    const nombres = [...new Set(usuarios)].filter(Boolean);
    if (!nombres.length) return 0;
    const subs = await PushSub.find({ usuario: { $in: nombres } }).lean();
    if (!subs.length) return 0;
    const prefs = new Map();
    const Us = Usuario || mongoose.models.Usuario;
    if (Us) (await Us.find({ usuario: { $in: [...new Set(subs.map(s => s.usuario))] } }).select('usuario notifPrefs').lean()).forEach(u => prefs.set(u.usuario, u.notifPrefs || {}));
    let enviados = 0;
    const cola = subs.slice();
    const trabajador = async () => {
        while (cola.length) {
            const s = cola.shift();
            const p = payloadDe(s.usuario, prefs.get(s.usuario) || {});
            if (!p) continue;
            try {
                await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(p), { TTL: 24 * 3600, urgency: p.urgente ? 'high' : 'normal', topic: (p.tag || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined });
                enviados++;
                PushSub.updateOne({ _id: s._id }, { $set: { ultimoEnvio: new Date() } }).catch(() => {});
            } catch (e) {
                if (e.statusCode === 404 || e.statusCode === 410) PushSub.deleteOne({ _id: s._id }).catch(() => {});
                else logger.warn(`[push] ${e.statusCode || ''} ${String(e.body || e.message).slice(0, 120)}`);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(20, cola.length) }, trabajador));
    return enviados;
}

/** Push para notificaciones recién guardadas (llamado desde los hooks del modelo). */
async function alCrear(notifs) {
    try {
        const porUsuario = new Map();
        for (const n of notifs) {
            const cat = categoria(n);
            if (!cat || !n.destinatario) continue;
            porUsuario.set(n.destinatario, { n, cat });   // si hay varias para el mismo usuario, la última
        }
        if (!porUsuario.size) return;
        await enviarA([...porUsuario.keys()], (usuario, pref) => {
            const { n, cat } = porUsuario.get(usuario);
            if (cat !== 'cuenta' && pref[cat] === false) return null;
            return { ...contenido(n), id: String(n._id || ''), categoria: cat, icon: './icons/icon-192.png?v=2', badge: './icons/icon-96.png?v=2' };
        });
    } catch (e) { logger.warn(`[push] alCrear: ${e.message}`); }
}

module.exports = { iniciar, alCrear, enviarA, contenido, categoria, PushSub, clave: () => clavePublica };
