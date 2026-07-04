/* ============================================================================
   pb2proxy.js — Proxy same-origin de Plazma Burst 2 (H5) con controles táctiles
   ----------------------------------------------------------------------------
   Reservir el port HTML5 oficial de Plazma Burst 2 bajo el dominio de UpGames
   e inyectarle una capa de controles táctiles (public/pb2-touch.*), de modo que
   el juego original sea 100% jugable en el celular con joystick y botones.

   Por qué un proxy: el navegador PROHÍBE inyectar toques/teclas en un <iframe>
   de otro dominio (seguridad cross-origin). Al pasar el juego por nuestro
   servidor, todo queda en el mismo origen y la capa táctil puede hablarle al
   juego con sus propios eventos (pointermove / onmousedown / onkeydown).

   Nota: el juego es propiedad de Eric Gurt (plazmaburst2.com). Esto es un
   envoltorio de accesibilidad que reenvía el juego original en vivo; la
   campaña single-player funciona, el multijugador puede no conectar (su
   servidor puede rechazar el Origin). Si el juego original deja de estar
   disponible, este proxy también dejará de funcionar.
   ============================================================================ */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const UPSTREAM_HOST = 'www.plazmaburst2.com';
const H5_INDEX_PATH = '/h5/';
const FALLBACK_VERSION = 'v1769098419';
const MOUNT = '/games/pb2';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

// ---- caché de versión (descubre versions/vXXXX/ desde /h5/) ----
let cachedVersion = FALLBACK_VERSION;
let versionCheckedAt = 0;
const VERSION_TTL = 30 * 60 * 1000; // 30 min

// ---- caché en memoria de assets (acotada) para aliviar el upstream ----
const assetCache = new Map(); // path -> {status, type, body, at}
const ASSET_TTL = 60 * 60 * 1000;
const ASSET_CACHE_MAX = 400;

function fetchUpstream(reqPath) {
    return new Promise((resolve, reject) => {
        const options = {
            host: UPSTREAM_HOST, path: reqPath, method: 'GET',
            headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': `https://${UPSTREAM_HOST}/h5/` },
            timeout: 15000
        };
        const req = https.get(options, (r) => {
            if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
                const loc = r.headers.location.replace(/^https?:\/\/[^/]+/, '');
                r.resume();
                return fetchUpstream(loc).then(resolve, reject);
            }
            const chunks = [];
            r.on('data', c => chunks.push(c));
            r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
        });
        req.on('timeout', () => { req.destroy(new Error('upstream timeout')); });
        req.on('error', reject);
    });
}

async function currentVersion() {
    if (Date.now() - versionCheckedAt < VERSION_TTL) return cachedVersion;
    try {
        const up = await fetchUpstream(H5_INDEX_PATH);
        const m = up.body.toString('utf8').match(/versions\/(v\d+)\//i);
        if (m) cachedVersion = m[1];
        versionCheckedAt = Date.now();
    } catch (e) { /* mantener versión previa/fallback */ }
    return cachedVersion;
}

function gameDir(version) { return `/h5/versions/${version}`; }

// ---- lectura de la capa táctil desde public/ (con caché) ----
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
let touchJs = null, touchCss = null;
function loadTouch() {
    try { touchJs = fs.readFileSync(path.join(PUBLIC_DIR, 'pb2-touch.js')); } catch (e) { touchJs = Buffer.from('/* pb2-touch.js no encontrado */'); }
    try { touchCss = fs.readFileSync(path.join(PUBLIC_DIR, 'pb2-touch.css')); } catch (e) { touchCss = Buffer.from(''); }
}
loadTouch();

function injectIntoHtml(html) {
    // base para que TODAS las URLs relativas del juego pasen por el proxy
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n<base href="${MOUNT}/asset/">`);
    // viewport táctil a pantalla completa
    if (!/viewport/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (m) => `${m}\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`);
    } else {
        html = html.replace(/<meta[^>]*name=["']viewport["'][^>]*>/i,
            '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">');
    }
    // capa táctil (rutas absolutas: no dependen del <base>)
    const inject = `\n<link rel="stylesheet" href="${MOUNT}/pb2-touch.css">\n<script src="${MOUNT}/pb2-touch.js" defer></script>\n`;
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, inject + '</body>');
    else html += inject;
    return html;
}

function sendBuffer(res, status, type, body, cacheSeconds) {
    res.status(status);
    res.setHeader('Content-Type', type || 'application/octet-stream');
    if (cacheSeconds) res.setHeader('Cache-Control', `public, max-age=${cacheSeconds}`);
    // el juego es autónomo; permitir que corra en un iframe del frontend
    res.removeHeader && res.removeHeader('X-Frame-Options');
    res.end(body);
}

/**
 * Monta las rutas del proxy. Llamar ANTES de helmet/rate-limit para que los
 * ~90 archivos del juego no consuman el límite de peticiones ni CSP.
 * @param {import('express').Express} app
 */
function registrar(app) {
    // capa táctil (siempre fresca en dev; cacheada en cliente)
    app.get(`${MOUNT}/pb2-touch.js`, (req, res) => {
        if (process.env.NODE_ENV === 'development') loadTouch();
        sendBuffer(res, 200, 'application/javascript; charset=utf-8', touchJs, 300);
    });
    app.get(`${MOUNT}/pb2-touch.css`, (req, res) => {
        if (process.env.NODE_ENV === 'development') loadTouch();
        sendBuffer(res, 200, 'text/css; charset=utf-8', touchCss, 300);
    });

    // página principal del juego (HTML inyectado)
    const serveIndex = async (req, res) => {
        try {
            const version = await currentVersion();
            const up = await fetchUpstream(gameDir(version) + '/');
            let html = up.body.toString('utf8');
            html = injectIntoHtml(html);
            sendBuffer(res, 200, 'text/html; charset=utf-8', Buffer.from(html), 0);
        } catch (e) {
            sendBuffer(res, 502, 'text/html; charset=utf-8',
                Buffer.from('<h1>No se pudo cargar el juego</h1><p>El servidor original no respondió. Intenta de nuevo en un momento.</p>'));
        }
    };
    app.get(MOUNT, serveIndex);
    app.get(`${MOUNT}/`, serveIndex);

    // assets del juego (proxy transparente con caché)
    app.get(`${MOUNT}/asset/*`, async (req, res) => {
        const rel = req.path.slice(`${MOUNT}/asset`.length) || '/'; // '/scripts/main.js'
        try {
            const version = await currentVersion();
            const key = version + rel;
            const hit = assetCache.get(key);
            if (hit && Date.now() - hit.at < ASSET_TTL) {
                return sendBuffer(res, hit.status, hit.type, hit.body, 3600);
            }
            const up = await fetchUpstream(gameDir(version) + rel);
            const type = up.headers['content-type'] || 'application/octet-stream';
            if (up.status === 200 && up.body.length < 3_000_000) {
                if (assetCache.size >= ASSET_CACHE_MAX) assetCache.delete(assetCache.keys().next().value);
                assetCache.set(key, { status: up.status, type, body: up.body, at: Date.now() });
            }
            sendBuffer(res, up.status, type, up.body, 3600);
        } catch (e) {
            sendBuffer(res, 502, 'text/plain', Buffer.from('asset proxy error'));
        }
    });
}

module.exports = { registrar, MOUNT };
