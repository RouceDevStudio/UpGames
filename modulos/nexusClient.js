/**
 * ══════════════════════════════════════════════════════════════════
 *  nexusClient.js — UpGames → NEXUS HTTP Client
 *  Archivo: modulos/nexusClient.js
 *
 *  Usa https nativo (sin dependencias extra).
 *
 *  Variables de entorno:
 *    NEXUS_API_URL=https://tu-nexus.up.railway.app   (requerida)
 *    NEXUS_INTERNAL_SECRET=tu_secret_compartido       (opcional)
 *
 *  Métodos:
 *    mentorGame(usuario, gameData, userJwt)
 *    analyzeFraud(usuario, patrones, adminToken)
 *    getCreatorAnalytics(username, userJwt)
 *    sendEvento(usuario, tipo, datos)
 *    getUserProfile(usuario)
 * ══════════════════════════════════════════════════════════════════
 */

'use strict';

const https  = require('https');
const http   = require('http');
const logger = require('./logger');

const NEXUS_API  = (process.env.NEXUS_API_URL || 'https://nexus-production.up.railway.app').replace(/\/$/, '');
const SECRET     = process.env.NEXUS_INTERNAL_SECRET || '';
const TIMEOUT_MS = 15_000;

// ── Helper: petición HTTP/HTTPS con timeout ───────────────────────

function request(method, urlStr, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        let url;
        try { url = new URL(urlStr); } catch (e) { return reject(new Error(`URL inválida: ${urlStr}`)); }

        const isHttps = url.protocol === 'https:';
        const lib     = isHttps ? https : http;
        const payload = body ? JSON.stringify(body) : null;

        const headers = {
            'Content-Type': 'application/json',
            ...extraHeaders,
        };
        if (SECRET) headers['x-nexus-secret'] = SECRET;
        if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

        const options = {
            hostname: url.hostname,
            port:     url.port || (isHttps ? 443 : 80),
            path:     url.pathname + url.search,
            method,
            headers,
            timeout: TIMEOUT_MS,
        };

        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve({ _raw: data, _status: res.statusCode }); }
            });
        });

        req.on('timeout', () => { req.destroy(new Error('Nexus timeout')); });
        req.on('error', reject);

        if (payload) req.write(payload);
        req.end();
    });
}

function authHeader(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Métodos públicos ──────────────────────────────────────────────

/**
 * Llama al mentor de creadores de Nexus.
 * Fire-and-forget seguro: retorna null si Nexus no está disponible.
 */
async function mentorGame(usuario, gameData, userJwt) {
    try {
        return await request(
            'POST',
            `${NEXUS_API}/api/nexus/creator-mentor`,
            { usuario, gameData },
            authHeader(userJwt)
        );
    } catch (err) {
        logger.warn(`[nexusClient] mentorGame: ${err.message}`);
        return null;
    }
}

/**
 * Análisis de fraude con IA. Solo desde rutas de admin.
 */
async function analyzeFraud(usuario, patrones, adminToken) {
    try {
        return await request(
            'POST',
            `${NEXUS_API}/api/nexus/fraud-analyze`,
            { usuario, patrones },
            authHeader(adminToken)
        );
    } catch (err) {
        logger.warn(`[nexusClient] analyzeFraud: ${err.message}`);
        return null;
    }
}

/**
 * Insights predictivos del creador.
 */
async function getCreatorAnalytics(username, userJwt) {
    try {
        return await request(
            'GET',
            `${NEXUS_API}/api/nexus/creator-analytics/${encodeURIComponent(username)}`,
            null,
            authHeader(userJwt)
        );
    } catch (err) {
        logger.warn(`[nexusClient] getCreatorAnalytics: ${err.message}`);
        return null;
    }
}

/**
 * Envía evento de comportamiento a Nexus. Fire-and-forget puro.
 */
function sendEvento(usuario, tipo, datos = {}) {
    if (!usuario || !tipo) return;
    request(
        'POST',
        `${NEXUS_API}/api/upgames/evento`,
        { usuario, tipo, datos, ts: new Date().toISOString() }
    ).catch(err => logger.debug(`[nexusClient] sendEvento: ${err.message}`));
}

/**
 * Perfil de gustos calculado por Nexus.
 */
async function getUserProfile(usuario) {
    try {
        return await request(
            'GET',
            `${NEXUS_API}/api/upgames/perfil/${encodeURIComponent(usuario)}`
        );
    } catch (err) {
        logger.warn(`[nexusClient] getUserProfile: ${err.message}`);
        return { categorias: [], tags: [], recientes: [], totalEventos: 0 };
    }
}

module.exports = {
    mentorGame,
    analyzeFraud,
    getCreatorAnalytics,
    sendEvento,
    getUserProfile,
};
