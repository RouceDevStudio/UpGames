/**
 * Moderación automática (NEXUS): comentarios, chat de los lives, publicaciones y lives.
 *
 *   1. Reglas instantáneas (sin red): contenido sexual explícito, insultos fuertes, odio y
 *      spam evidente se frenan ANTES de publicarse.
 *   2. NEXUS (Groq) revisa después, en segundo plano, lo que las reglas dejaron pasar
 *      (contexto, ironía, palabras disfrazadas). Si es contenido sexual, odio, acoso, insultos
 *      o spam con confianza alta, se quita solo: sin preguntar.
 *   3. Visión: portadas de publicaciones y fotogramas de los lives (cada ~90 s desde el
 *      estudio del navegador). Contenido sexual → la publicación se rechaza / el live se cierra.
 *
 * Todo queda en la colección `moderacion_log` (panel admin → Moderación) y suma un
 * "strike" a la cuenta. Si la IA no está disponible, quedan las reglas: nunca se borra
 * nada por un error de la IA.
 */
'use strict';

const mongoose = require('mongoose');
const llm = require('./nexus/llm');

// Fronteras de palabra que entienden acentos y ñ (\b de JS solo conoce ASCII)
const P = s => new RegExp(`(?<![\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`, 'iu');
const normal = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/\$/g, 's')   // p0rn0, s3x0, put@
    .replace(/(\p{L})[.\-_*·]+(?=\p{L})/gu, '$1')                                                           // p.o.r.n.o
    .replace(/(\p{L})\1{2,}/gu, '$1$1');                                                                   // puuuuta → puuta

const REGLAS = {
    sexual: P('porno?s?|pornografi\\w*|porn(hub)?|xvideos?|xnxx|xhamster|hentai|rule ?34|nsfw|x{3}|onlyfans|only fans|fansly|desnud[oa]s?|nudes?|semi ?desnud\\w*|'
        + 'packs? (de )?(fotos|videos|nudes)|vendo (mi )?pack|fotos? intimas?|videos? intimos?|sexo (explicito|en vivo|gratis|oral|anal)|contenido (para adultos|\\+ ?18|sexual)|'
        + '\\+ ?18 (xxx|hot|caliente)|camgirl|webcam (xxx|sexual|hot)|follar|follando|mamada|chupamela|chupala|pajear\\w*|masturb\\w*|culiando|pechos? desnud\\w*|'
        + 'pene erecto|vagina abierta|dick pic|nude pics?|sex tape|sexting'),
    menores: P('pedo(filia|filo)s?|child porn|menores? (desnud\\w*|sexy|xxx)|loli(con)?|shota(con)?|jailbait'),
    odio: P('nigg(er|a)s?|sudaca de mierda|negro de mierda|indio de mierda|maric[oa]s? de mierda|muerte a los \\w+|hay que matar a|heil hitler|sieg heil|kill all \\w+'),
    // Solo insultos fuertes: la jerga ("marica", "qué gonorrea", "de puta madre") la decide la IA por contexto
    insulto: P('hijo ?de ?(puta|perra)|hijueputa|hp de mierda|malparid[oa]s?|careverga|carechimba|subnormal(es)?|mongolic[oa]s?|put[oa]s?|maricon(es)?|'
        + 'mamaguevo|mamahuevo|come ?mierda|chupapija|pelotud[oa]s?|fuck (you|off)|motherfucker|bitch(es)?|asshole|cunt|kys|matate|suicidate|ojala te mueras'),
    spam: P('gana(r)? (dinero|plata|\\$+) (facil|rapido|desde casa)|invierte (ya|ahora)|duplica tu dinero|bitcoin gratis|forex|criptomoneda gratis|seguidores gratis|'
        + 'sigueme y te sigo|follow ?for ?follow|f4f|sub ?4 ?sub|escribeme al (whatsapp|wsp|telegram)|t\\.me/\\w+|wa\\.me/\\d+|bit\\.ly/\\w+|cutt\\.ly|tinyurl'),
};
const LEVES = P('mierda|idiota|tont[oa]s?|basura|asco|maldit[oa]|joder|carajo|verga|chimba|chingad[oa]|pendej[oa]s?|imbeciles?|estupid[oa]s?|retrasad[oa]s?|gonorreas?|'
    + 'marica|perras?|zorras?|cabron(es|a)?|culer[oa]s?|tetas|wtf|shit|damn|crap|stupid|idiot|loser|retard(ed)?|dumbass');
const JERGA = /de puta madre|puta madre|que puta|hijo de puta(?= (jugada|juego|partida|mod))/g;   // expresiones de entusiasmo, no insultos

/**
 * Revisión instantánea por reglas. tipo: 'comentario' | 'chat' | 'publicacion' | 'live'.
 * → { bloquear, categoria, motivo, dudoso }
 */
function reglas(texto, tipo = 'comentario') {
    // Se prueba el texto normalizado (p0rn0, s.e.x.o) y el original en minúsculas (f4f, sub4sub)
    const t = normal(texto).replace(JERGA, ' ') + ' \n ' + String(texto || '').toLowerCase().replace(JERGA, ' ');
    if (!t.trim()) return { bloquear: false, categoria: 'ok' };
    if (REGLAS.menores.test(t)) return { bloquear: true, categoria: 'sexual', grave: true, motivo: 'Contenido sexual con menores' };
    if (REGLAS.sexual.test(t)) return { bloquear: true, categoria: 'sexual', motivo: 'Contenido sexual' };
    if (REGLAS.odio.test(t)) return { bloquear: true, categoria: 'odio', motivo: 'Discurso de odio' };
    if (tipo !== 'publicacion' && REGLAS.insulto.test(t)) return { bloquear: true, categoria: 'insulto', motivo: 'Insultos' };
    if (tipo === 'publicacion' && REGLAS.insulto.test(t)) return { bloquear: false, categoria: 'ok', dudoso: true };   // un título puede citar una palabra fuerte: lo decide la IA
    if (REGLAS.spam.test(t)) return { bloquear: true, categoria: 'spam', motivo: 'Spam' };
    if (tipo === 'comentario' || tipo === 'chat') {
        const enlaces = (String(texto).match(/https?:\/\/|www\.|\.(com|net|xyz|io|me|ly|gg)\b/gi) || []).length;
        if (enlaces >= 2 || (enlaces === 1 && /\b(gana|gratis|promo|descuento|regalo|click|clic)\b/i.test(t))) return { bloquear: true, categoria: 'spam', motivo: 'Enlaces publicitarios' };
        if (/(\d[\s.-]?){9,}/.test(String(texto)) && /\b(whatsapp|wsp|wpp|llama|escribe|telegram)\b/i.test(t)) return { bloquear: true, categoria: 'spam', motivo: 'Números de contacto' };
        const letras = String(texto).replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
        if (letras.length > 25 && letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length / letras.length > 0.85) return { bloquear: false, categoria: 'ok', dudoso: true };
    }
    return { bloquear: false, categoria: 'ok', dudoso: LEVES.test(t) };
}

const SISTEMA = `Eres el moderador automático de UpGames (comunidad de videojuegos, mods, apps, videos y lives; mayoría hispanohablante, hay jóvenes).
Clasifica el texto. Categorías:
- "sexual": contenido sexual explícito, pornografía, desnudos, ofrecer packs/OnlyFans, insinuaciones sexuales a otros.
- "odio": ataques por raza, origen, religión, género u orientación.
- "acoso": amenazas, incitar a hacerse daño, acoso a una persona.
- "insulto": insultos dirigidos a otra persona o al creador.
- "spam": publicidad, estafas, enlaces o contactos para sacar a la gente de UpGames, texto repetido sin sentido.
- "ok": todo lo demás. Las groserías como muletilla o entusiasmo ("está de puta madre", "qué mierda de jugada tan buena") son "ok". Hablar de juegos con violencia ficticia es "ok". Críticas educadas son "ok".
Responde SOLO JSON: {"categoria":"ok|sexual|odio|acoso|insulto|spam","confianza":0.0-1.0,"motivo":"frase corta en español"}`;

/** Revisión con IA del texto. → { categoria, confianza, motivo } | null si no hay IA */
async function ia(texto, tipo) {
    if (!llm.disponible()) return null;
    const r = await llm.json(SISTEMA, `Tipo: ${tipo}\nTexto: """${String(texto).slice(0, 1500)}"""`, { rapido: true, maxTokens: 120, timeout: 12000 }).catch(() => null);
    if (!r || typeof r.categoria !== 'string') return null;
    return { categoria: r.categoria, confianza: Math.max(0, Math.min(1, Number(r.confianza) || 0)), motivo: String(r.motivo || '').slice(0, 140) };
}
const QUITAR = { sexual: 0.75, odio: 0.8, acoso: 0.8, insulto: 0.85, spam: 0.85 };
const debeQuitar = v => !!v && QUITAR[v.categoria] != null && v.confianza >= QUITAR[v.categoria];

// ── Visión (portadas y fotogramas) ───────────────────────────────────────────
const MODELOS_VISION = (process.env.NEXUS_VISION_MODELOS || 'meta-llama/llama-4-scout-17b-16e-instruct,meta-llama/llama-4-maverick-17b-128e-instruct').split(',').map(s => s.trim()).filter(Boolean);
const SISTEMA_VISION = `Eres el moderador de imágenes de UpGames. Mira la imagen y responde SOLO JSON:
{"sexual":true|false,"confianza":0.0-1.0,"motivo":"frase corta"}
"sexual" = desnudez, genitales, actos sexuales, pornografía o poses sexuales explícitas (también dibujos/hentai). Ropa de baño normal, besos o violencia de videojuegos NO son sexuales.`;
/** img: URL https o data:image/jpeg;base64 → { sexual, confianza, motivo } | null */
async function imagen(img) {
    if (!llm.disponible() || !img) return null;
    const r = await llm.completar({ modelos: MODELOS_VISION, json: true, temperatura: 0, maxTokens: 100, timeout: 20000, mensajes: [
        { role: 'system', content: SISTEMA_VISION },
        { role: 'user', content: [{ type: 'text', text: '¿Es contenido sexual?' }, { type: 'image_url', image_url: { url: img } }] },
    ] }).catch(() => null);
    const o = llm.parsearJSON(r?.mensaje?.content);
    if (!o || typeof o.sexual !== 'boolean') return null;
    return { sexual: o.sexual, confianza: Math.max(0, Math.min(1, Number(o.confianza) || 0)), motivo: String(o.motivo || '').slice(0, 140), modelo: r.modelo };
}

// ── Registro y strikes ───────────────────────────────────────────────────────
const log = () => mongoose.connection.collection('moderacion_log');
let indice = false;
/** Guarda la acción (se borra sola a los 180 días) y suma un strike al autor. */
async function registrar({ tipo, usuario, categoria, motivo, fuente, texto = '', ref = '', accion }) {
    try {
        if (!indice) { indice = true; log().createIndex({ fecha: 1 }, { expireAfterSeconds: 180 * 86400 }).catch(() => {}); }
        await log().insertOne({ fecha: new Date(), tipo, usuario: usuario || '', categoria, motivo: motivo || '', fuente, texto: String(texto).slice(0, 300), ref: String(ref), accion });
        if (usuario && accion !== 'bloqueado-antes') await mongoose.models.Usuario?.updateOne({ usuario }, { $inc: { strikesModeracion: 1 }, $set: { ultimoStrike: new Date() } }).catch(() => {});
    } catch (_) {}
}
async function recientes(limite = 100, filtro = {}) {
    return log().find(filtro).sort({ fecha: -1 }).limit(Math.min(500, limite)).toArray();
}
async function resumen(dias = 7) {
    const desde = new Date(Date.now() - dias * 864e5);
    const r = await log().aggregate([{ $match: { fecha: { $gte: desde } } }, { $group: { _id: { t: '$tipo', c: '$categoria' }, n: { $sum: 1 } } }]).toArray();
    return r.map(x => ({ tipo: x._id.t, categoria: x._id.c, n: x.n }));
}

const MENSAJE = { sexual: 'contiene contenido sexual', odio: 'contiene discurso de odio', acoso: 'contiene acoso o amenazas', insulto: 'contiene insultos', spam: 'parece spam o publicidad' };

module.exports = { reglas, ia, debeQuitar, imagen, registrar, recientes, resumen, MENSAJE, normal, QUITAR };
