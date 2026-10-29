/**
 * ══════════════════════════════════════════════════════════════════
 *  revisionIA.js — Recomendación de Nexus para revisar publicaciones
 *
 *  Reúne datos verificables de una publicación en revisión y emite una
 *  recomendación (aprobar / revisar / rechazar) con sus razones:
 *    1. Comprobaciones reales: el enlace responde y el archivo existe,
 *       la portada carga y es imagen, dominio permitido, palabras de
 *       piratería, duplicados, juego comercial detectado.
 *    2. Historial del autor: antigüedad, verificación, publicaciones
 *       caídas/rechazadas, reportes, lista negra, suspensión.
 *    3. Opinión de la IA: Nexus (Groq) recibe todos esos hechos; si no
 *       responde, Groq directo; si no hay IA, quedan las reglas.
 *
 *  Las reglas duras (enlace muerto o no permitido, piratería explícita,
 *  autor suspendido) mandan sobre la IA: la IA nunca puede aprobar algo
 *  que las comprobaciones reales dan por roto.
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const dns = require('dns').promises;
const net = require('net');

const PIRATERIA = /\b(crack(ed|eado|eo)?|pirat(a|eado|ear|eria)|keygen|warez|serial(es)? (gratis|crack)|activador|full gratis|premium gratis|repack)\b/i;
// ROMs, ISOs y ports: aunque estén modificados (skins, parches) suelen llevar dentro el
// juego original, así que nunca se aprueban solos: siempre pasan por una persona.
const SENSIBLE = /\b(roms?|iso|isos|ports?|portado|porteado)\b/i;
const CEBO = /\b(gratis|free|full|100% ?real|sin virus|descarga directa)\b/i;
const ARCHIVO_MUERTO = [
    /Invalid or Deleted File/i, /file you attempted to download.{0,40}(removed|deleted)/i, /The key you provided for file download was invalid/i,
    /el archivo que has solicitado no existe/i, /the file you have requested does not exist/i,
    /File Not Found|This file does not exist|has been removed|ha sido eliminado|was deleted/i,
];
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36';

function ipPrivada(ip) {
    if (net.isIPv6(ip)) return /^(::1|fc|fd|fe80|::ffff:(10\.|127\.|192\.168\.|169\.254\.))/i.test(ip) || ip === '::';
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
async function hostPublico(host) {
    try {
        if (net.isIP(host)) return !ipPrivada(host);
        const r = await dns.lookup(host, { all: true });
        return r.length > 0 && r.every(x => !ipPrivada(x.address));
    } catch (_) { return false; }
}

/**
 * Descarga (como mucho 200 KB) siguiendo hasta 4 redirecciones, sin tocar
 * nunca IPs privadas. Devuelve { ok, status, finalUrl, tipo, texto, ms, error }.
 */
async function sondear(url, { leerTexto = false, timeout = 9000 } = {}) {
    const t0 = Date.now();
    let actual = url;
    for (let salto = 0; salto < 5; salto++) {
        let u;
        try { u = new URL(actual); } catch (_) { return { ok: false, error: 'URL inválida', ms: Date.now() - t0 }; }
        if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'Protocolo no permitido', ms: Date.now() - t0 };
        if (!(await hostPublico(u.hostname))) return { ok: false, error: 'El dominio no resuelve a una IP pública', ms: Date.now() - t0 };
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeout);
        try {
            const r = await fetch(actual, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'es,en;q=0.8' } });
            if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
                actual = new URL(r.headers.get('location'), actual).href;
                r.body?.cancel?.().catch?.(() => {});
                continue;
            }
            const tipo = r.headers.get('content-type') || '';
            let texto = '';
            if (leerTexto && /text|html|json/i.test(tipo) && r.body) {
                const reader = r.body.getReader(); let leido = 0; const partes = [];
                while (leido < 200000) { const { done, value } = await reader.read(); if (done) break; partes.push(value); leido += value.length; }
                reader.cancel().catch(() => {});
                texto = Buffer.concat(partes.map(p => Buffer.from(p))).toString('utf8');
            } else r.body?.cancel?.().catch?.(() => {});
            return { ok: r.ok, status: r.status, finalUrl: actual, tipo, texto, ms: Date.now() - t0, tamano: +r.headers.get('content-length') || null };
        } catch (e) {
            return { ok: false, error: e.name === 'AbortError' ? 'Tiempo de espera agotado' : e.message, ms: Date.now() - t0 };
        } finally { clearTimeout(to); }
    }
    return { ok: false, error: 'Demasiadas redirecciones', ms: Date.now() - t0 };
}

const escRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ytId = u => (String(u || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/))([-\w]{11})/i) || [])[1] || null;

async function opinionIA({ ia, item, hechos }) {
    const contexto = hechos.map(h => `- [${h.tipo.toUpperCase()}] ${h.texto}`).join('\n').slice(0, 3500);
    const sistema = 'Eres NEXUS, el moderador de UpGames (plataforma de mods, juegos indie, ROMs homebrew, apps y videos). Recomiendas al administrador si APROBAR, REVISAR o RECHAZAR una publicación. Basa tu juicio en los HECHOS verificados que te doy (son fiables) y en el contenido. Rechaza piratería de juegos comerciales, enlaces rotos, spam o engaños. Responde SOLO JSON: {"decision":"aprobar|revisar|rechazar","confianza":0-1,"razones":["..."],"sugerencias":["..."],"riesgo_spam":0-1,"riesgo_malware":0-1,"calidad_estimada":0-10,"resumen":"una frase"}';
    const usuario = `PUBLICACIÓN\nTítulo: ${item.title}\nCategoría: ${item.category}\nEtiquetas: ${(item.tags || []).join(', ') || '(ninguna)'}\nDescripción: ${String(item.description || '').slice(0, 1500) || '(vacía)'}\nEnlace: ${item.link}\n\nHECHOS VERIFICADOS\n${contexto}`;
    const a = await ia.json(sistema, usuario, { maxTokens: 700 });
    if (!a || !['aprobar', 'revisar', 'rechazar'].includes(a.decision)) return null;
    const { _fuente, ...resto } = a;
    return { ...resto, fuente: _fuente || 'Nexus' };
}

/**
 * Analiza una publicación. deps: { Juego, Usuario, errorLinkPublicacion, gameDetector, logger, ia? (por defecto modulos/nexus/llm) }
 */
async function analizar(item, deps) {
    const { Juego, Usuario, errorLinkPublicacion, gameDetector, logger } = deps;
    const hechos = [];       // { tipo: ok|info|warn|bad, area, texto, peso }
    const duros = [];        // motivos de rechazo seguro
    const add = (tipo, area, texto, peso = 0) => hechos.push({ tipo, area, texto, peso });
    const esVideo = item.category === 'Video' || !!item.videoType;

    // ── 1. Enlace ────────────────────────────────────────────────
    const errLink = errorLinkPublicacion(item.link, item.category);
    let enlace = { estado: 'desconocido' };
    if (errLink) { add('bad', 'enlace', `Enlace no permitido: ${errLink}`, -40); duros.push('El enlace no está en la lista de plataformas permitidas'); enlace.estado = 'no_permitido'; }
    else {
        const yt = ytId(item.link);
        const s = await sondear(yt ? `https://www.youtube.com/oembed?url=${encodeURIComponent(item.link)}&format=json` : item.link, { leerTexto: true });
        enlace = { estado: 'desconocido', status: s.status || null, ms: s.ms, host: (() => { try { return new URL(s.finalUrl || item.link).hostname; } catch (_) { return ''; } })(), tamano: s.tamano };
        const muerto = s.texto && ARCHIVO_MUERTO.some(r => r.test(s.texto));
        if (s.status === 404 || s.status === 410 || muerto) {
            enlace.estado = 'muerto';
            add('bad', 'enlace', muerto ? 'La página de descarga dice que el archivo fue eliminado o no existe' : `El enlace responde ${s.status} (no encontrado)`, -45);
            duros.push('El archivo del enlace no existe');
        } else if (s.ok) {
            enlace.estado = 'vivo';
            add('ok', 'enlace', `El enlace responde correctamente (${s.status}, ${s.ms} ms)${s.tamano && s.tamano > 1e6 ? ` · archivo de ${(s.tamano / 1e6).toFixed(1)} MB` : ''}`, 18);
            if (/mega\.(nz|co\.nz)|gofile\.io/i.test(enlace.host)) add('info', 'enlace', 'MEGA/GoFile cargan el archivo con JavaScript: no se puede confirmar al 100 % que exista; ábrelo tú para asegurarte', 0);
        } else {
            enlace.estado = 'no_verificable';
            add('warn', 'enlace', `No se pudo verificar el enlace (${s.status || s.error || 'sin respuesta'}): puede ser protección anti-bots del sitio; ábrelo manualmente`, -6);
        }
        if (/\.(exe|msi|bat|scr|apk)(\?|$)/i.test(s.finalUrl || '') && !/\.apk/i.test(item.link || '')) add('warn', 'enlace', 'La redirección termina en un ejecutable directo', -10);
    }

    // ── 2. Portada / medios ─────────────────────────────────────
    let portada = { estado: 'sin_imagen' };
    if (!item.image) add('warn', 'medios', 'No tiene portada', -8);
    else {
        const yt = ytId(item.image);
        const s = yt ? { ok: true, tipo: 'image/jpeg' } : await sondear(item.image, { timeout: 7000 });
        if (s.ok && (/image|video/i.test(s.tipo) || yt)) { portada.estado = 'ok'; add('ok', 'medios', yt ? 'La portada es un video de YouTube' : 'La portada carga y es una imagen válida', 6); }
        else { portada.estado = 'rota'; add('warn', 'medios', `La portada no carga (${s.status || s.error || 'error'})`, -10); }
    }
    const extra = (item.images || []).filter(Boolean).length;
    if (extra) add('ok', 'medios', `${extra} imagen(es) o video(s) adicionales en la galería`, 3);

    // ── 3. Texto ────────────────────────────────────────────────
    const texto = `${item.title || ''} ${item.description || ''}`;
    const piratTitulo = PIRATERIA.exec(item.title || '');
    if (piratTitulo) { add('bad', 'texto', `El título contiene "${piratTitulo[0]}" (piratería)`, -35); duros.push('Lenguaje de piratería en el título'); }
    else if (PIRATERIA.test(item.description || '')) add('bad', 'texto', 'La descripción menciona cracks, keygens o piratería', -25);
    if (CEBO.test(item.title || '')) add('warn', 'texto', 'El título usa palabras cebo (gratis, full, free…) que el bot de metadata prohíbe', -8);
    const largo = String(item.description || '').trim().length;
    if (largo < 20) add('warn', 'texto', `Descripción muy corta (${largo} caracteres): el usuario no sabe qué descarga`, -8);
    else if (largo >= 120) add('ok', 'texto', `Descripción completa (${largo} caracteres)`, 6);
    else add('info', 'texto', `Descripción breve (${largo} caracteres)`, 0);
    if (/https?:\/\/(bit\.ly|tinyurl|cutt\.ly|shorturl|adf\.ly|ouo\.io|linkvertise)/i.test(texto)) add('bad', 'texto', 'La descripción incluye acortadores o enlaces con publicidad', -20);
    if (/(.)\1{6,}/.test(item.title || '') || /[A-ZÁÉÍÓÚ]{12,}/.test(item.title || '')) add('warn', 'texto', 'Título con letras repetidas o todo en mayúsculas (estilo spam)', -5);

    // ── 4. Juego comercial ──────────────────────────────────────
    const det = item.extraData?.detectedGame || gameDetector.detectGame(item.title, item.description);
    if (det && !esVideo) {
        if (/^(mod|mods)$/i.test(item.category || '') || /\bmod\b|shader|texture|skin|mapa|parche|traducci/i.test(texto))
            add('info', 'derechos', `Relacionado con "${det.gameName}" (juego comercial), pero parece un mod o complemento: normalmente permitido`, 0);
        else add('bad', 'derechos', `Parece el juego comercial completo "${det.gameName}" (${det.platform || 'comercial'}): riesgo de piratería y de derechos de autor`, -30);
    }

    const sensible = !esVideo && (/^rom$/i.test(item.category || '') || SENSIBLE.exec(texto));
    if (sensible) add('warn', 'derechos', `Es ${sensible === true ? 'una ROM' : `"${sensible[0]}"`}: revisa a mano que no incluya el juego comercial original (una ROM o un port modificado sigue llevando el juego). Se permiten mods, parches, archivos de optimización y homebrew sin los archivos del juego.`, -5);

    // ── 5. Duplicados ───────────────────────────────────────────
    const [mismoLink, mismoTitulo] = await Promise.all([
        // Solo cuentan las publicaciones ANTERIORES: la original no es duplicado de su copia
        Juego.find({ _id: { $ne: item._id }, link: item.link, createdAt: { $lt: item.createdAt || new Date() } }).select('title usuario status').limit(3).lean(),
        Juego.find({ _id: { $ne: item._id }, createdAt: { $lt: item.createdAt || new Date() }, title: { $regex: `^${escRegex(String(item.title || '').trim())}$`, $options: 'i' } }).select('title usuario').limit(3).lean(),
    ]);
    const ajenos = [...new Set(mismoLink.filter(j => j.usuario !== item.usuario).map(j => '@' + j.usuario))];
    if (ajenos.length) add('bad', 'duplicado', `El mismo enlace ya está publicado por ${ajenos.join(', ')} (posible copia de contenido ajeno)`, -25);
    else if (mismoLink.length) add('warn', 'duplicado', `El autor ya usó este mismo enlace en ${mismoLink.length} publicación(es) anterior(es)`, -8);
    else if (mismoTitulo.some(j => j.usuario !== item.usuario)) add('warn', 'duplicado', `Ya existe otra publicación con el mismo título (de ${mismoTitulo.map(j => '@' + j.usuario).join(', ')})`, -10);
    else if (mismoTitulo.length) add('info', 'duplicado', 'El autor ya tiene otra publicación con este título (¿actualización?)', -3);
    else add('ok', 'duplicado', 'No hay duplicados', 3);

    // ── 6. Autor ────────────────────────────────────────────────
    const u = await Usuario.findOne({ usuario: item.usuario }).select('usuario fecha createdAt verificadoNivel emailVerificado listaNegraAdmin suspendido listaSeguidores descargasTotales').lean();
    const autor = { usuario: item.usuario };
    if (!u) { add('bad', 'autor', 'La cuenta del autor ya no existe', -20); }
    else {
        const dias = Math.floor((Date.now() - new Date(u.fecha || u.createdAt || Date.now())) / 864e5);
        const [total, caidas, rechazadas, reportes] = await Promise.all([
            Juego.countDocuments({ usuario: u.usuario }),
            Juego.countDocuments({ usuario: u.usuario, linkStatus: 'caido' }),
            Juego.countDocuments({ usuario: u.usuario, status: 'rechazado' }),
            Juego.aggregate([{ $match: { usuario: u.usuario } }, { $group: { _id: null, r: { $sum: '$reportes' }, m: { $sum: '$reportesDesglose.malware' } } }]),
        ]);
        const rep = reportes[0] || { r: 0, m: 0 };
        Object.assign(autor, { dias, verificado: u.verificadoNivel || 0, total, caidas, rechazadas, reportes: rep.r, malware: rep.m, seguidores: (u.listaSeguidores || []).length, emailVerificado: !!u.emailVerificado });
        if (u.suspendido) { add('bad', 'autor', 'El autor está SUSPENDIDO', -40); duros.push('Autor suspendido'); }
        if (u.listaNegraAdmin) add('bad', 'autor', 'El autor está en la lista negra del equipo', -20);
        if (u.verificadoNivel >= 2) add('ok', 'autor', `Autor verificado nivel ${['', 'Bronce', 'Oro', 'Élite'][u.verificadoNivel]}`, 15);
        else if (u.verificadoNivel === 1) add('ok', 'autor', 'Autor verificado (Bronce)', 8);
        if (dias < 2) add('warn', 'autor', `Cuenta creada hace ${dias === 0 ? 'menos de un día' : '1 día'}`, -8);
        else if (dias > 60) add('ok', 'autor', `Cuenta con ${dias} días de antigüedad`, 5);
        if (!u.emailVerificado) add('info', 'autor', 'El autor no ha verificado su email', -2);
        const previas = total - 1;
        if (previas > 0) {
            const tasaMala = (caidas + rechazadas) / previas;
            if (tasaMala >= 0.5 && caidas + rechazadas >= 2) add('bad', 'autor', `${caidas + rechazadas} de sus ${previas} publicaciones anteriores están caídas o rechazadas`, -18);
            else if (tasaMala === 0 && previas >= 3) add('ok', 'autor', `Historial limpio: ${previas} publicaciones anteriores sin problemas`, 10);
            else add('info', 'autor', `${previas} publicaciones anteriores (${caidas} caídas, ${rechazadas} rechazadas)`, 0);
        } else add('info', 'autor', 'Es su primera publicación', -2);
        if (rep.m > 0) add('bad', 'autor', `Sus publicaciones acumulan ${rep.m} reporte(s) de malware`, -20);
        else if (rep.r >= 5) add('warn', 'autor', `Sus publicaciones acumulan ${rep.r} reportes`, -8);
    }
    if ((item.reportes || 0) > 0) add('warn', 'reportes', `Esta publicación ya tiene ${item.reportes} reporte(s) de usuarios`, -6 * Math.min(item.reportes, 5));

    // ── 7. Puntuación por reglas ────────────────────────────────
    const puntos = Math.max(0, Math.min(100, 55 + hechos.reduce((a, h) => a + h.peso, 0)));
    let reglas = duros.length ? 'rechazar' : puntos >= 70 ? 'aprobar' : puntos < 40 ? 'rechazar' : 'revisar';

    // ── 8. IA ───────────────────────────────────────────────────
    const ia = deps.sinIA ? null : await opinionIA({ ia: deps.ia || require('./nexus/llm'), item, hechos }).catch(e => { logger?.warn?.(`[revisionIA] ${e.message}`); return null; });
    let decision = reglas, confianza;
    if (duros.length) { decision = 'rechazar'; confianza = 0.95; }
    else if (ia) {
        const c = Math.max(0, Math.min(1, Number(ia.confianza) || 0.5));
        if (ia.decision === reglas) { decision = reglas; confianza = Math.min(0.97, 0.55 + c * 0.4); }
        else if (ia.decision === 'rechazar' && c >= 0.7) { decision = puntos >= 75 ? 'revisar' : 'rechazar'; confianza = 0.6; }
        else if (ia.decision === 'aprobar' && reglas === 'revisar' && puntos >= 58 && c >= 0.7) { decision = 'aprobar'; confianza = 0.6; }
        else { decision = 'revisar'; confianza = 0.5; }
    } else confianza = reglas === 'revisar' ? 0.5 : Math.min(0.9, 0.5 + Math.abs(puntos - 55) / 90);
    if (sensible && decision === 'aprobar') { decision = 'revisar'; confianza = 0.5; }   // ROM/ISO/port: siempre revisión humana

    const resumenes = { aprobar: 'Todo indica que es una publicación legítima y funcional.', revisar: 'Hay señales mixtas: revisa los puntos marcados antes de decidir.', rechazar: 'Hay problemas serios que justifican rechazarla.' };
    return {
        decision, confianza: +confianza.toFixed(2), puntos,
        resumen: duros.length ? `Motivos: ${duros.join(' · ')}.` : (ia?.resumen || resumenes[decision]),
        motivosDuros: duros, reglas, hechos,
        ia: ia ? { fuente: ia.fuente, decision: ia.decision, confianza: ia.confianza, razones: (ia.razones || []).slice(0, 6), sugerencias: (ia.sugerencias || []).slice(0, 5), riesgo_spam: ia.riesgo_spam, riesgo_malware: ia.riesgo_malware, calidad_estimada: ia.calidad_estimada } : null,
        enlace, portada, autor,
        fecha: new Date(),
    };
}

module.exports = { analizar, sondear, hostPublico, ipPrivada, PIRATERIA, SENSIBLE };
