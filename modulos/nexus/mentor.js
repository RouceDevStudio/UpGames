/**
 * nexus/mentor.js — Consejos de Nexus para cada publicación nueva.
 * Se guarda en Juego.nexusMentor y el autor lo ve en su perfil.
 * Con IA: análisis redactado. Sin IA: consejos por reglas (siempre hay algo útil).
 */
'use strict';

const llm = require('./llm');

function porReglas(item) {
    const mejoras = [], alertas = [];
    const desc = String(item.description || '').trim();
    const imgs = [item.image, ...(item.images || [])].filter(Boolean).length;
    let p = 5;
    if (desc.length < 60) mejoras.push('Escribe una descripción más completa: qué incluye, versión compatible y cómo instalarlo.'); else p += 1.5;
    if (desc.length > 250) p += 0.5;
    if (!item.image) alertas.push('Sin portada: las publicaciones sin imagen casi no reciben descargas.'); else p += 1;
    if (imgs < 2 && item.category !== 'Video') mejoras.push('Añade capturas adicionales para que la gente vea el resultado antes de descargar.'); else p += 0.5;
    if (!(item.tags || []).length) mejoras.push('Añade etiquetas (juego, género, versión) para aparecer en más búsquedas.'); else p += 0.5;
    if (String(item.title || '').length < 8) mejoras.push('Usa un título más descriptivo, con el nombre del juego y lo que aporta.');
    if (item.title && item.title === item.title.toUpperCase() && /[A-Z]{6}/.test(item.title)) mejoras.push('Evita el título todo en mayúsculas: se ve como spam.');
    return { puntuacion: Math.min(10, +p.toFixed(1)), analisis: mejoras.length ? 'Tu publicación puede rendir más con unos ajustes.' : '¡Buena publicación! Está completa y clara.', mejoras: mejoras.slice(0, 4), alertas, fuente: 'Nexus · reglas' };
}

async function mentor(item) {
    const base = porReglas(item);
    const ia = await llm.json(
        'Eres NEXUS, el mentor de creadores de UpGames (comunidad de mods, juegos indie, ROMs homebrew, apps y videos; los creadores ganan por descarga). Evalúa la publicación y da consejos concretos y accionables para conseguir más descargas. Responde en español SOLO JSON: {"puntuacion":0-10,"analisis":"2 frases","mejoras":["máx 4 consejos concretos"],"alertas":["problemas graves, si los hay"],"tags_sugeridos":["máx 5"]}',
        `Título: ${item.title}\nCategoría: ${item.category}\nDescripción: ${String(item.description || '(vacía)').slice(0, 1200)}\nEtiquetas: ${(item.tags || []).join(', ') || '(ninguna)'}\nImágenes: ${[item.image, ...(item.images || [])].filter(Boolean).length}\nHechos detectados: ${[...base.alertas, ...base.mejoras].join(' | ') || 'ninguno'}`,
        { rapido: true, maxTokens: 500 },
    ).catch(() => null);
    const arr = (v, n) => (Array.isArray(v) ? v.map(x => String(x).slice(0, 220)).filter(Boolean).slice(0, n) : []);
    const r = ia && typeof ia.puntuacion !== 'undefined'
        ? { puntuacion: Math.max(0, Math.min(10, +ia.puntuacion || base.puntuacion)), analisis: String(ia.analisis || base.analisis).slice(0, 500), mejoras: arr(ia.mejoras, 4), alertas: arr(ia.alertas, 3), tags_sugeridos: arr(ia.tags_sugeridos, 5), fuente: ia._fuente }
        : base;
    return { ...r, fecha: new Date() };
}

module.exports = { mentor, porReglas };
