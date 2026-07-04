/* ============================================================================
   pb2proxy.js — Emulador táctil universal para juegos web (UpGames)
   ----------------------------------------------------------------------------
   Reservir un juego web (HTML5/Flash-port) same-origin bajo el dominio de
   UpGames e inyectarle una capa de controles táctiles (public/pb2-touch.*),
   de modo que cualquier juego "de este tipo" sea jugable en el celular.

   Por qué un proxy: el navegador PROHÍBE inyectar toques/teclas en un <iframe>
   de otro dominio (cross-origin). Al pasar el juego por nuestro servidor todo
   queda en el mismo origen y la capa táctil puede hablarle con sus propios
   eventos (pointermove / onmousedown / onkeydown / wheel).

   Rutas:
     GET /games/_pb2t/pb2-touch.(js|css)  -> capa táctil compartida
     GET /games/pb2                       -> atajo a Plazma Burst 2 (H5)
     GET /games/pb2/asset/*               -> assets de PB2
     GET /games/emu/u/<host>/<path...>    -> emulador universal (cualquier URL)

   Seguridad: el emulador universal sólo acepta http/https públicos y bloquea
   hosts privados/loopback/metadata (anti-SSRF), con tope de tamaño de respuesta.
   ============================================================================ */
'use strict';
const https = require('https');
const http = require('http');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const net = require('net');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const TOUCH_BASE = '/games/_pb2t';
const MAX_BODY = 12 * 1024 * 1024;

// ---------- Plazma Burst 2 (atajo con autodescubrimiento de versión) ----------
const PB2_HOST = 'www.plazmaburst2.com';
const PB2_FALLBACK = 'v1769098419';
let pb2Version = PB2_FALLBACK, pb2CheckedAt = 0;
const PB2_TTL = 30 * 60 * 1000;

// ---------- caché de assets ----------
const assetCache = new Map();
const ASSET_TTL = 60 * 60 * 1000;
const ASSET_MAX = 500;

/* ===================== anti-SSRF ===================== */
function isPrivateIP(ip) {
    if (net.isIPv6(ip)) {
        const l = ip.toLowerCase();
        return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.');
    }
    return /^127\./.test(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) ||
           /^169\.254\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
           ip === '0.0.0.0' || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
}
function isBlockedHostname(host) {
    host = (host || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return true;
    if (host === 'metadata.google.internal') return true;
    if (net.isIP(host) && isPrivateIP(host)) return true;
    return false;
}
async function guardHost(hostname) {
    if (isBlockedHostname(hostname)) throw new Error('host bloqueado');
    if (net.isIP(hostname)) return; // ya validado arriba
    try {
        const rec = await dns.lookup(hostname, { all: true });
        for (const r of rec) if (isPrivateIP(r.address)) throw new Error('IP privada bloqueada');
    } catch (e) {
        if (/bloquead/.test(e.message)) throw e; // fallo de DNS real -> dejar que la conexión falle sola
    }
}

/* ===================== fetch genérico ===================== */
async function fetchURL(urlStr, redirects) {
    redirects = redirects || 0;
    let u;
    try { u = new URL(urlStr); } catch (e) { throw new Error('URL inválida'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('esquema no permitido');
    await guardHost(u.hostname);
    const mod = u.protocol === 'https:' ? https : http;
    const options = {
        host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method: 'GET',
        headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': u.origin + '/' },
        timeout: 15000
    };
    return new Promise((resolve, reject) => {
        const req = mod.get(options, (r) => {
            if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects < 5) {
                r.resume();
                const next = new URL(r.headers.location, u).toString();
                return fetchURL(next, redirects + 1).then(resolve, reject);
            }
            const chunks = []; let size = 0;
            r.on('data', c => { size += c.length; if (size > MAX_BODY) { req.destroy(new Error('respuesta demasiado grande')); return; } chunks.push(c); });
            r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}

/* ===================== capa táctil ===================== */
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
let touchJs = null, touchCss = null;
function loadTouch() {
    try { touchJs = fs.readFileSync(path.join(PUBLIC_DIR, 'pb2-touch.js')); } catch (e) { touchJs = Buffer.from('/* pb2-touch.js no encontrado */'); }
    try { touchCss = fs.readFileSync(path.join(PUBLIC_DIR, 'pb2-touch.css')); } catch (e) { touchCss = Buffer.from(''); }
}
loadTouch();

function injectIntoHtml(html, baseHref) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n<base href="${baseHref}">`);
    if (/<meta[^>]*name=["']viewport["']/i.test(html)) {
        html = html.replace(/<meta[^>]*name=["']viewport["'][^>]*>/i,
            '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">');
    } else {
        html = html.replace(/<head[^>]*>/i, (m) => `${m}\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`);
    }
    const inject = `\n<link rel="stylesheet" href="${TOUCH_BASE}/pb2-touch.css">\n<script src="${TOUCH_BASE}/pb2-touch.js" defer></script>\n`;
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, inject + '</body>');
    else html += inject;
    return html;
}

function send(res, status, type, body, cacheSeconds) {
    res.status(status);
    res.setHeader('Content-Type', type || 'application/octet-stream');
    if (cacheSeconds) res.setHeader('Cache-Control', `public, max-age=${cacheSeconds}`);
    try { res.removeHeader('X-Frame-Options'); } catch (e) {}
    res.end(body);
}

/* ===================== PB2 atajo ===================== */
async function pb2CurrentVersion() {
    if (Date.now() - pb2CheckedAt < PB2_TTL) return pb2Version;
    try {
        const up = await fetchURL(`https://${PB2_HOST}/h5/`);
        const m = up.body.toString('utf8').match(/versions\/(v\d+)\//i);
        if (m) pb2Version = m[1];
        pb2CheckedAt = Date.now();
    } catch (e) {}
    return pb2Version;
}

/**
 * Monta las rutas. Llamar ANTES de helmet/rate-limit.
 * @param {import('express').Express} app
 */
function registrar(app) {
    // capa táctil compartida
    app.get(`${TOUCH_BASE}/pb2-touch.js`, (req, res) => {
        if (process.env.NODE_ENV === 'development') loadTouch();
        send(res, 200, 'application/javascript; charset=utf-8', touchJs, 300);
    });
    app.get(`${TOUCH_BASE}/pb2-touch.css`, (req, res) => {
        if (process.env.NODE_ENV === 'development') loadTouch();
        send(res, 200, 'text/css; charset=utf-8', touchCss, 300);
    });

    // ---- Plazma Burst 2 (atajo) ----
    const servePb2 = async (req, res) => {
        try {
            const v = await pb2CurrentVersion();
            const up = await fetchURL(`https://${PB2_HOST}/h5/versions/${v}/`);
            const html = injectIntoHtml(up.body.toString('utf8'), '/games/pb2/asset/');
            send(res, 200, 'text/html; charset=utf-8', Buffer.from(html), 0);
        } catch (e) {
            send(res, 502, 'text/html; charset=utf-8', Buffer.from('<h1>No se pudo cargar el juego</h1>'));
        }
    };
    app.get('/games/pb2', servePb2);
    app.get('/games/pb2/', servePb2);
    app.get('/games/pb2/asset/*', async (req, res) => {
        const rel = req.path.slice('/games/pb2/asset'.length) || '/';
        try {
            const v = await pb2CurrentVersion();
            const key = 'pb2:' + v + rel;
            const hit = assetCache.get(key);
            if (hit && Date.now() - hit.at < ASSET_TTL) return send(res, hit.status, hit.type, hit.body, 3600);
            const up = await fetchURL(`https://${PB2_HOST}/h5/versions/${v}${rel}`);
            const type = up.headers['content-type'] || 'application/octet-stream';
            if (up.status === 200 && up.body.length < 3_000_000) {
                if (assetCache.size >= ASSET_MAX) assetCache.delete(assetCache.keys().next().value);
                assetCache.set(key, { status: up.status, type, body: up.body, at: Date.now() });
            }
            send(res, up.status, type, up.body, 3600);
        } catch (e) { send(res, 502, 'text/plain', Buffer.from('asset error')); }
    });

    // ---- Emulador universal: /games/emu/u/<host>/<path...> ----
    app.get('/games/emu/u/*', async (req, res) => {
        const rest = req.params[0] || '';                 // host/dir/file
        const q = req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?')) : '';
        const target = 'https://' + rest + q;
        try {
            const up = await fetchURL(target);
            const type = up.headers['content-type'] || 'application/octet-stream';
            const isHtml = /text\/html/i.test(type);
            if (isHtml) {
                // base = directorio del recurso bajo nuestro proxy
                let p = req.path; // /games/emu/u/host/dir/  o .../index.html
                const lastSeg = p.split('/').pop();
                let baseDir = lastSeg.indexOf('.') !== -1 ? p.slice(0, p.lastIndexOf('/') + 1) : (p.endsWith('/') ? p : p + '/');
                const html = injectIntoHtml(up.body.toString('utf8'), baseDir);
                return send(res, 200, 'text/html; charset=utf-8', Buffer.from(html), 0);
            }
            // assets: stream con caché
            const key = 'emu:' + rest;
            if (up.status === 200 && up.body.length < 3_000_000) {
                if (assetCache.size >= ASSET_MAX) assetCache.delete(assetCache.keys().next().value);
                assetCache.set(key, { status: up.status, type, body: up.body, at: Date.now() });
            }
            send(res, up.status, type, up.body, 3600);
        } catch (e) {
            send(res, 502, 'text/plain; charset=utf-8', Buffer.from('No se pudo cargar: ' + (e.message || 'error')));
        }
    });
}

module.exports = { registrar };
