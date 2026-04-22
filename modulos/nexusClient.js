/**
 * ══════════════════════════════════════════════════════════════════
 *  nexusClient.js — UpGames → NEXUS HTTP Client
 *  Archivo: modulos/nexusClient.js
 *
 *  Usa las variables de entorno:
 *    NEXUS_API_URL=https://tu-nexus.up.railway.app   (requerida)
 *    NEXUS_INTERNAL_SECRET=tu_secret_compartido       (opcional, para seguridad intra-servicio)
 *
 *  Métodos:
 *    mentorGame(usuario, gameData)         → Análisis pre-publicación
 *    analyzefraud(usuario, patrones)       → Score de riesgo IA
 *    getCreatorAnalytics(username, token)  → Insights predictivos
 *    sendEvento(usuario, tipo, datos)      → Evento de comportamiento (ya existía)
 * ══════════════════════════════════════════════════════════════════
 */

'use strict';

const axios  = require('axios');
const logger = require('./logger');

const NEXUS_API  = (process.env.NEXUS_API_URL || 'https://nexus-production.up.railway.app').replace(/\/$/, '');
const SECRET     = process.env.NEXUS_INTERNAL_SECRET || '';
const TIMEOUT_MS = 15_000;

/** Headers base para todas las llamadas a Nexus */
function baseHeaders(userJwt = '') {
    const h = { 'Content-Type': 'application/json' };
    if (SECRET) h['x-nexus-secret'] = SECRET;
    if (userJwt) h['Authorization'] = `Bearer ${userJwt}`;
    return h;
}

/**
 * Llama al mentor de creadores de Nexus.
 * @param {string} usuario - Nombre de usuario del creador
 * @param {object} gameData - { titulo, descripcion, tags, categoria, precio, imagenes }
 * @param {string} userJwt  - Token JWT del usuario (para que Nexus valide requireAuth)
 * @returns {Promise<object>} - { ok, mentor, creatorStats } | null en caso de error
 */
async function mentorGame(usuario, gameData, userJwt) {
    try {
        const resp = await axios.post(
            `${NEXUS_API}/api/nexus/creator-mentor`,
            { usuario, gameData },
            { headers: baseHeaders(userJwt), timeout: TIMEOUT_MS }
        );
        return resp.data;
    } catch (err) {
        logger.warn(`[nexusClient] mentorGame falló para "${usuario}": ${err.message}`);
        return null;
    }
}

/**
 * Analiza patrones de fraude con la IA de Nexus.
 * Solo usable desde rutas de admin (el endpoint de Nexus requiere verificarAdmin).
 * @param {string} usuario
 * @param {object} patrones - { descargaVelocidad, reportesPrevios, accountAgeDays,
 *                              ipsDiferentes, actividadNocturna, descargasSinView }
 * @param {string} adminJwt - Token JWT del administrador
 * @returns {Promise<object>} - { ok, analisis } | null
 */
async function analyzeFraud(usuario, patrones, adminJwt) {
    try {
        const resp = await axios.post(
            `${NEXUS_API}/api/nexus/fraud-analyze`,
            { usuario, patrones },
            { headers: baseHeaders(adminJwt), timeout: TIMEOUT_MS }
        );
        return resp.data;
    } catch (err) {
        logger.warn(`[nexusClient] analyzeFraud falló para "${usuario}": ${err.message}`);
        return null;
    }
}

/**
 * Obtiene analytics predictivos de un creador desde Nexus.
 * @param {string} username
 * @param {string} userJwt
 * @returns {Promise<object>} - { ok, statsReales, actividad, insights } | null
 */
async function getCreatorAnalytics(username, userJwt) {
    try {
        const resp = await axios.get(
            `${NEXUS_API}/api/nexus/creator-analytics/${encodeURIComponent(username)}`,
            { headers: baseHeaders(userJwt), timeout: TIMEOUT_MS }
        );
        return resp.data;
    } catch (err) {
        logger.warn(`[nexusClient] getCreatorAnalytics falló para "${username}": ${err.message}`);
        return null;
    }
}

/**
 * Envía un evento de comportamiento a Nexus (reemplaza llamadas directas al endpoint).
 * Llama de forma fire-and-forget para no bloquear la respuesta al usuario.
 * @param {string} usuario
 * @param {'search'|'view'|'download'|'favorite'|'unfavorite'|'category'} tipo
 * @param {object} datos - { itemId?, title?, category?, tags?, query? }
 */
function sendEvento(usuario, tipo, datos = {}) {
    if (!usuario || !tipo) return;
    axios.post(
        `${NEXUS_API}/api/upgames/evento`,
        { usuario, tipo, datos, ts: new Date().toISOString() },
        { headers: baseHeaders(), timeout: 6_000 }
    ).catch(err => logger.debug(`[nexusClient] sendEvento: ${err.message}`));
}

/**
 * Obtiene el perfil de gustos calculado por Nexus para un usuario.
 * @param {string} usuario
 * @returns {Promise<object>} - { categorias, tags, recientes, totalEventos }
 */
async function getUserProfile(usuario) {
    try {
        const resp = await axios.get(
            `${NEXUS_API}/api/upgames/perfil/${encodeURIComponent(usuario)}`,
            { headers: baseHeaders(), timeout: 8_000 }
        );
        return resp.data;
    } catch (err) {
        logger.warn(`[nexusClient] getUserProfile falló para "${usuario}": ${err.message}`);
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
