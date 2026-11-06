/**
 * Ticket de la página puente: la espera y los anuncios ya no dependen solo del navegador.
 *
 * Al abrirse, puente.html pide POST /economia/ticket → el servidor firma (HMAC) el id de la
 * publicación, la hora y la IP. Al pedir el enlace (POST /economia/validar-descarga) hay que
 * devolver ese ticket y haber esperado al menos ESPERA_MS. Un script que llame directo a
 * validar-descarga ya no se lleva el enlace ni cuenta descargas.
 *
 * Transición: hasta OBLIGATORIO_DESDE (o PUENTE_TICKET_OBLIGATORIO=1) una petición SIN ticket
 * recibe el enlace pero NO cuenta la descarga, para no romper puentes viejos en caché.
 */
'use strict';
const crypto = require('crypto');

const ESPERA_MS = 25e3;          // la página muestra 30 s; 5 s de margen por la red
const VIGENCIA_MS = 30 * 60e3;   // un ticket sirve 30 min
const OBLIGATORIO_DESDE = Date.parse('2026-11-14T00:00:00Z');

const huellaIp = ip => crypto.createHash('sha256').update(String(ip || '')).digest('base64url').slice(0, 10);
const firma = (secreto, id, t, ip) => crypto.createHmac('sha256', secreto).update(`${id}|${t}|${huellaIp(ip)}`).digest('base64url').slice(0, 32);

function emitir(secreto, juegoId, ip, ahora = Date.now()) {
    return { ticket: `${ahora.toString(36)}.${firma(secreto, String(juegoId), ahora, ip)}`, esperaMs: ESPERA_MS };
}

/** → { ok:true } | { ok:false, motivo:'falta'|'invalido'|'vencido'|'pronto', esperaRestante?: s } */
function verificar(secreto, ticket, juegoId, ip, ahora = Date.now()) {
    if (!ticket || typeof ticket !== 'string') return { ok: false, motivo: 'falta' };
    const [t36, f] = ticket.split('.');
    const t = parseInt(t36, 36);
    if (!Number.isFinite(t) || !f) return { ok: false, motivo: 'invalido' };
    const esperada = firma(secreto, String(juegoId), t, ip);
    if (f.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(f), Buffer.from(esperada))) return { ok: false, motivo: 'invalido' };
    if (t > ahora + 5e3 || ahora - t > VIGENCIA_MS) return { ok: false, motivo: 'vencido' };
    if (ahora - t < ESPERA_MS) return { ok: false, motivo: 'pronto', esperaRestante: Math.ceil((ESPERA_MS - (ahora - t)) / 1000) };
    return { ok: true };
}

const obligatorio = (ahora = Date.now()) => process.env.PUENTE_TICKET_OBLIGATORIO === '1' || ahora >= OBLIGATORIO_DESDE;

module.exports = { emitir, verificar, obligatorio, ESPERA_MS };
