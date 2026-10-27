/**
 * UpGames Live — reglas puras (sin BD ni red) para poder probarlas solas.
 *
 * Economía:
 *   - El espectador compra MONEDAS con dinero real (PayPal). 1 moneda = MONEDA_USD.
 *   - Un regalo cuesta N monedas. El creador recibe N × MONEDA_USD × (1 − comisión)
 *     en `saldoRetenido`; pasa a `saldo` (retirable) tras LIVE_RETENCION_DIAS para
 *     cubrir contracargos (compra con tarjeta robada → regalo → retiro).
 *   - Los paquetes cuestan algo más que su valor nominal: cubren la comisión fija
 *     de PayPal, que en compras pequeñas se comería el regalo entero.
 *
 * Video: proveedor intercambiable.
 *   - 'p2p'      : WebRTC directo navegador→espectadores con señalización por
 *                  Socket.IO. No necesita infraestructura; pocos espectadores.
 *   - 'mediamtx' : servidor de medios propio (OBS por RTMP / navegador por WHIP,
 *                  reproducción LL-HLS). Se activa con MEDIAMTX_* (ver mediamtx/README.md).
 */
'use strict';

const crypto = require('crypto');

const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

const MONEDA_USD     = 0.01;
const COMISION       = Math.min(0.9, Math.max(0, num(process.env.LIVE_COMISION, 0.30)));
const RETENCION_DIAS = Math.max(0, num(process.env.LIVE_RETENCION_DIAS, 7));
const P2P_MAX        = Math.max(1, Math.round(num(process.env.LIVE_P2P_MAX_VIEWERS, 12)));

const REGALOS = [
    { id: 'corazon',  nombre: 'Corazón',  emoji: '❤️', monedas: 10 },
    { id: 'gg',       nombre: 'GG',       emoji: '🎮', monedas: 50 },
    { id: 'fuego',    nombre: 'Fuego',    emoji: '🔥', monedas: 100 },
    { id: 'corona',   nombre: 'Corona',   emoji: '👑', monedas: 300 },
    { id: 'trofeo',   nombre: 'Trofeo',   emoji: '🏆', monedas: 500 },
    { id: 'diamante', nombre: 'Diamante', emoji: '💎', monedas: 1000 },
    { id: 'cohete',   nombre: 'Cohete',   emoji: '🚀', monedas: 5000 },
];

const PAQUETES = [
    { id: 'p100',  monedas: 100,  usd: 1.29 },
    { id: 'p500',  monedas: 500,  usd: 5.49 },
    { id: 'p1100', monedas: 1100, usd: 10.99, extra: '+10%' },
    { id: 'p2800', monedas: 2800, usd: 26.99, extra: '+12%' },
    { id: 'p6000', monedas: 6000, usd: 54.99, extra: '+20%' },
];

const regalo  = id => REGALOS.find(r => r.id === id) || null;
const paquete = id => PAQUETES.find(p => p.id === id) || null;
const redondear = n => Math.round(n * 10000) / 10000;   // 4 decimales: sumas de centavos sin deriva

/** Reparto de un regalo en USD. */
function reparto(monedas, comision = COMISION) {
    const bruto = redondear(monedas * MONEDA_USD);
    const creador = redondear(bruto * (1 - comision));
    return { bruto, creador, plataforma: redondear(bruto - creador) };
}

/** Clave de transmisión: 32 hex. La comparación es en tiempo constante. */
const nuevaClave = () => crypto.randomBytes(16).toString('hex');
function claveValida(guardada, recibida) {
    if (typeof guardada !== 'string' || typeof recibida !== 'string' || guardada.length !== 32 || recibida.length !== 32) return false;
    return crypto.timingSafeEqual(Buffer.from(guardada), Buffer.from(recibida));
}

/** Ruta de MediaMTX → usuario. Solo `live/<usuario>`. */
function usuarioDeRuta(path) {
    const m = /^live\/([a-z0-9_.-]{3,20})$/.exec(String(path || '').toLowerCase());
    return m ? m[1] : null;
}

/** Clave de la petición de auth de MediaMTX: contraseña, o ?key= en la URL (OBS). */
function claveDeAuth(body = {}) {
    if (body.password) return String(body.password);
    if (body.token) return String(body.token);            // WHIP: Authorization: Bearer <clave>
    const q = new URLSearchParams(String(body.query || ''));
    return q.get('key') || q.get('k') || '';
}

/** Texto de chat: sin control, colapsado, recortado. Null si queda vacío. */
function limpiarChat(t, max = 200) {
    const s = String(t ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, max) : null;
}

/** Limitador de ráfagas en memoria (token bucket por clave). */
function limitador(capacidad, porSegundo) {
    const m = new Map();
    return clave => {
        const ahora = Date.now();
        const b = m.get(clave) || { t: capacidad, ts: ahora };
        b.t = Math.min(capacidad, b.t + ((ahora - b.ts) / 1000) * porSegundo);
        b.ts = ahora;
        if (m.size > 20000) m.clear();
        if (b.t < 1) { m.set(clave, b); return false; }
        b.t -= 1; m.set(clave, b); return true;
    };
}

/** Configuración del proveedor de video según el entorno. */
function proveedor(env = process.env) {
    const base = (env.MEDIAMTX_PUBLIC_URL || '').replace(/\/+$/, '');
    if (!base) return { tipo: 'p2p', p2pMax: P2P_MAX };
    const whip = (env.MEDIAMTX_WHIP_URL || '').replace(/\/+$/, '');
    const rtmp = (env.MEDIAMTX_RTMP_URL || '').replace(/\/+$/, '');
    return {
        tipo: 'mediamtx',
        hls:  `${base}/live/{u}/index.m3u8`,
        whip: whip ? `${whip}/live/{u}/whip` : null,
        rtmp: rtmp ? `${rtmp}/live` : null,
        p2pMax: P2P_MAX,
    };
}

/** Servidores ICE para WebRTC (STUN público + TURN opcional). */
function iceServers(env = process.env) {
    const s = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
    if (env.TURN_URL) s.push({ urls: env.TURN_URL.split(',').map(x => x.trim()).filter(Boolean), username: env.TURN_USER || '', credential: env.TURN_PASS || '' });
    return s;
}

module.exports = {
    MONEDA_USD, COMISION, RETENCION_DIAS, P2P_MAX, REGALOS, PAQUETES,
    regalo, paquete, reparto, nuevaClave, claveValida, usuarioDeRuta, claveDeAuth,
    limpiarChat, limitador, proveedor, iceServers,
};
