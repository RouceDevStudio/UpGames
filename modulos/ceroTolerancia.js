/**
 * ══════════════════════════════════════════════════════════════════
 *  Cero tolerancia (NEXUS) — contenido que se reporta a las autoridades
 *
 *  Categorías (en cualquier parte de UpGames: chats privados, grupos,
 *  comunidades, comentarios, publicaciones, historias y lives):
 *    • menores   → cualquier contenido sexual o sexualizado con menores de edad
 *    • zoofilia  → contenido sexual con animales
 *    • abuso     → violación, abuso sexual o actos sin consentimiento, tortura, trata
 *    • gore      → gore real: muertes, mutilaciones, cadáveres, violencia real extrema
 *
 *  El contenido para adultos ENTRE ADULTOS que consienten no es de esta lista:
 *  se permite en grupos y comunidades marcados +18 (en lo público lo frena
 *  modulos/moderacion.js como siempre).
 *
 *  Qué pasa cuando NEXUS detecta algo:
 *    1. El mensaje / publicación se bloquea o se oculta al instante.
 *    2. Se abre un INCIDENTE (colección incidentes_seguridad, sin caducidad) con la
 *       evidencia y los datos de la cuenta para entregarlos a las autoridades:
 *       usuario, correo, IPs, navegador, métodos de cobro registrados, pagos e historial.
 *    3. Aviso inmediato al administrador: notificación en la app, push y correo.
 *    4. Si la visión de NEXUS lo confirma con confianza alta, la cuenta queda
 *       RESTRINGIDA (no puede enviar mensajes ni publicar) hasta que un admin lo revise.
 *  Nadie tiene que revisar nada a mano para que funcione.
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const mongoose = require('mongoose');
const llm = require('./nexus/llm');

const P = s => new RegExp(`(?<![\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`, 'iu');
const normal = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/\$/g, 's')
    .replace(/(\p{L})[.\-_*·]+(?=\p{L})/gu, '$1')
    .replace(/(\p{L})\1{2,}/gu, '$1$1');

// Para la regla combinada solo cuentan palabras inequívocamente sexuales y referencias claras a menores
// (sin jerga ambigua como "bebé", "nena", "caliente" o "hot": son apodos de pareja o de juegos)
const SEXUAL = 'porno?s?|pornografi\\w*|xxx|desnud[oa]s?|nudes?|sexo|sexual(?:es|mente)?|follar\\w*|cogiendo|culiando|violad[oa]s?|violar|nsfw|hentai|onlyfans|packs? (?:de|xxx)|masturb\\w*';
const MENOR = 'menor(es)? de edad|nin[oa]s?|nin[oa]s? de \\d+|infantil(es)?|prepuber\\w*|underage|child(ren)?|minors?|(?<!\\d)(?:[4-9]|1[0-7]) ?(?:anos|años|yo|y\\/o|añitos|anitos)(?! de (?:experiencia|casad|juego|carrera))';

const REGLAS = {
    // Términos que por sí solos ya indican material de abuso infantil
    menores: P('pthc|(?:packs?|links?|videos?|grupos?) (?:de )?cp|pedo ?(porn|xxx|videos?|fotos?|packs?)|cp (?:videos?|links?|packs?|fotos?)|child ?porn\\w*|child sex\\w*|kiddie ?porn|jailbait|loli(con)? (?:xxx|porn\\w*|hentai|desnud\\w*)|shota(con)? (?:xxx|porn\\w*|hentai)|'
        + 'pornografia infantil|porno infantil|abuso (sexual )?infantil|explotacion sexual infantil|material de abuso (sexual )?infantil|csam|'
        + 'vendo (videos?|fotos?|packs?) de (?:' + MENOR + ')'),
    // Combinación sexual + menor en el mismo mensaje (en cualquier orden, cerca)
    menoresCombo: [new RegExp(`(?:${SEXUAL})[^.\\n]{0,40}(?:${MENOR})`, 'iu'), new RegExp(`(?:${MENOR})[^.\\n]{0,40}(?:${SEXUAL})`, 'iu')],
    zoofilia: P('zoofili\\w*|bestialit\\w*|zoo ?(porn\\w*|xxx|sex\\w*)|animal ?(porn\\w*|sex\\w*|xxx)|'
        + 'sexo con (?:un |una |mi |el |la )?(?:perr[oa]s?|caballos?|yeguas?|burr[oa]s?|cabras?|animal(es)?|gat[oa]s?|vacas?|cerd[oa]s?|mascotas?)|'
        + '(?:perr[oa]|caballo|animal) (?:cogiendo|follando|violando) (?:a )?(?:una|un)? ?(?:mujer|hombre|chica|chico)'),
    abuso: P('violacion real|violaciones reales|rape (?:video|real|porn)|real rape|snuff|'
        + '(?:video|videos|fotos?) de (?:una )?violacion|abuso sexual (?:real|grabado|en video)|sin consentimiento (?:xxx|porn\\w*|video)|non ?consent\\w* (?:porn|video|xxx)|'
        + 'drogada y (?:violada|abusada)|trata de (?:personas|blancas)|vendo (?:mujeres|personas|chicas)|tortura real|videos? de tortura'),
    gore: P('gore real|gore (?:extremo|xxx)|real gore|videos? (?:de )?gore|fotos? (?:de )?gore|grupo (?:de )?gore|'
        + 'muertes? reales?|muerte en vivo|cadaver(es)? reales?|desmembrad\\w* real|decapitacion(es)? reales?|decapitad[oa]s? reales?|'
        + 'videos? de (?:asesinatos?|decapitacion(es)?|ejecuciones?|suicidios?|desmembramientos?|accidentes? fatales?)|'
        + 'bestgore|theync|kaotic|documentingreality|liveleak gore|crimes? reales? sin censura'),
};
const MOTIVO = {
    menores: 'Contenido sexual con menores de edad',
    zoofilia: 'Contenido sexual con animales',
    abuso: 'Abuso, violación o actos sin consentimiento',
    gore: 'Gore o violencia real extrema',
};
// Frases que NO son el delito sino hablar en contra de él (no se reportan)
const CONTRA = /\b(denunci\w*|report\w*|no (?:se )?permit\w*|prohib\w*|campana contra|luchar contra|prevenir|prevencion|proteger a los ninos|te protejo|ley contra|delito de|educacion sexual)\b/iu;

/**
 * Revisión instantánea de un texto (sin red).
 * → { grave: true, categoria, motivo } | { grave: false }
 */
function revisarTexto(texto) {
    const t = normal(texto);
    if (!t.trim()) return { grave: false };
    // Sin el cambio de números a letras (p0rn0 → porno), para no romper edades como "12 años"
    const t2 = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const contra = CONTRA.test(t);
    for (const cat of ['menores', 'zoofilia', 'abuso', 'gore']) {
        if (REGLAS[cat].test(t) && !contra) return { grave: true, categoria: cat, motivo: MOTIVO[cat] };
    }
    if (!contra && REGLAS.menoresCombo.some(re => re.test(t) || re.test(t2))) return { grave: true, categoria: 'menores', motivo: MOTIVO.menores };
    return { grave: false };
}

// ── Visión de NEXUS para imágenes (chat, grupos, historias, portadas) ──────
const MODELOS_VISION = (process.env.NEXUS_VISION_MODELOS || 'meta-llama/llama-4-scout-17b-16e-instruct,meta-llama/llama-4-maverick-17b-128e-instruct').split(',').map(s => s.trim()).filter(Boolean);
const SISTEMA_VISION = `Eres el sistema de seguridad infantil y de contenido ilegal de UpGames. Mira la imagen y responde SOLO JSON:
{"categoria":"ok|menores|zoofilia|abuso|gore","confianza":0.0-1.0,"motivo":"frase corta"}
- "menores": cualquier persona que parezca menor de 18 años en contexto sexual, desnuda o sexualizada (también dibujos o IA).
- "zoofilia": actos sexuales con animales.
- "abuso": violación, abuso sexual, tortura o violencia sexual real.
- "gore": muertes reales, cadáveres, mutilaciones o sangre real extrema (NO cuentan videojuegos, películas ni efectos especiales evidentes).
- "ok": todo lo demás, incluido contenido para adultos entre adultos, violencia de videojuegos o capturas de juegos.`;
/** img: URL https o data URL → { categoria, confianza, motivo } | null (sin IA) */
async function revisarImagen(img) {
    if (!llm.disponible() || !img) return null;
    const r = await llm.completar({ modelos: MODELOS_VISION, json: true, temperatura: 0, maxTokens: 120, timeout: 20000, mensajes: [
        { role: 'system', content: SISTEMA_VISION },
        { role: 'user', content: [{ type: 'text', text: 'Clasifica esta imagen.' }, { type: 'image_url', image_url: { url: img } }] },
    ] }).catch(() => null);
    const o = llm.parsearJSON ? llm.parsearJSON(r?.mensaje?.content) : null;
    if (!o || typeof o.categoria !== 'string') return null;
    const categoria = MOTIVO[o.categoria] ? o.categoria : 'ok';
    return { categoria, confianza: Math.max(0, Math.min(1, Number(o.confianza) || 0)), motivo: String(o.motivo || MOTIVO[categoria] || '').slice(0, 160), modelo: r.modelo };
}
const UMBRAL_IMAGEN = 0.7;        // ocultar y abrir incidente
const UMBRAL_RESTRINGIR = 0.85;   // además, restringir la cuenta hasta que un admin la revise

// ── Incidentes ────────────────────────────────────────────────────────────
const col = () => mongoose.connection.collection('incidentes_seguridad');
let indices = false;
let deps = { avisar: null, logger: console };
/** index.js inyecta cómo avisar al admin (notificación + push + correo). */
function configurar(d) { deps = { ...deps, ...d }; }

function ipDe(req) {
    if (!req) return '';
    return String(req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64);
}

/** Expediente de la cuenta para las autoridades (lo que UpGames tenga). */
async function expediente(usuario) {
    const U = mongoose.models.Usuario, Pago = mongoose.models.Pago;
    const u = U ? await U.findOne({ usuario }).select('usuario email paypalEmail registrationIP ultimaIp ipsVistas fecha ultimoLogin cobro.tipo cobro.resumen tarjetas.titular tarjetas.ultimos4 tarjetas.tipo listaSeguidores siguiendo suspendido strikesModeracion').lean().catch(() => null) : null;
    const pagos = Pago ? await Pago.find({ usuario }).select('monto metodo resumen paypalEmail estado fecha referencia').sort({ fecha: -1 }).limit(30).lean().catch(() => []) : [];
    if (!u) return { usuario, existe: false };
    return {
        usuario: u.usuario, email: u.email, creada: u.fecha || null, ultimoAcceso: u.ultimoLogin || null,
        ipRegistro: u.registrationIP || '', ultimaIp: u.ultimaIp || '', ipsVistas: u.ipsVistas || [],
        cobro: { paypal: u.paypalEmail || '', tipo: u.cobro?.tipo || '', resumen: u.cobro?.resumen || '', nota: u.cobro?.tipo ? 'Datos bancarios completos cifrados: el dueño los puede exportar con /admin/seguridad/incidentes/:id/expediente' : '' },
        tarjetas: (u.tarjetas || []).map(t => ({ titular: t.titular, ultimos4: t.ultimos4, tipo: t.tipo })),
        pagos: pagos.map(p => ({ monto: p.monto, metodo: p.metodo, resumen: p.resumen || p.paypalEmail || '', estado: p.estado, fecha: p.fecha, referencia: p.referencia || '' })),
        seguidores: (u.listaSeguidores || []).length, siguiendo: (u.siguiendo || []).length,
        strikes: u.strikesModeracion || 0,
    };
}

/**
 * Abre un incidente y avisa al admin. Nunca lanza.
 * @param {object} o { usuario, categoria, motivo, fuente, donde, ref, texto, imagen, confianza, req, restringir }
 */
async function incidente(o) {
    try {
        if (mongoose.connection.readyState !== 1) return null;
        if (!indices) { indices = true; col().createIndex({ fecha: -1 }).catch(() => {}); col().createIndex({ usuario: 1, fecha: -1 }).catch(() => {}); }
        const exp = await expediente(o.usuario);
        const doc = {
            fecha: new Date(), estado: 'abierto',
            usuario: o.usuario, categoria: o.categoria, motivo: o.motivo || MOTIVO[o.categoria] || '',
            fuente: o.fuente || 'reglas', confianza: o.confianza ?? null,
            donde: o.donde || '', ref: String(o.ref || ''),
            evidencia: { texto: String(o.texto || '').slice(0, 4000), imagen: o.imagen || '' },
            conexion: { ip: ipDe(o.req), navegador: String(o.req?.headers?.['user-agent'] || '').slice(0, 300), origen: String(o.req?.headers?.origin || '').slice(0, 120) },
            expediente: exp,
            restringida: !!o.restringir,
        };
        const r = await col().insertOne(doc);
        if (o.restringir && mongoose.models.Usuario) await mongoose.models.Usuario.updateOne({ usuario: o.usuario }, { $set: { restriccionSeguridad: true, restriccionMotivo: doc.motivo, restriccionFecha: new Date() } }).catch(() => {});
        try { await deps.avisar?.({ ...doc, _id: r.insertedId }); } catch (e) { deps.logger?.warn?.(`[cero-tolerancia] aviso: ${e.message}`); }
        deps.logger?.warn?.(`[cero-tolerancia] incidente ${r.insertedId}: @${o.usuario} · ${o.categoria} · ${o.donde}`);
        return r.insertedId;
    } catch (e) { deps.logger?.error?.(`[cero-tolerancia] no se pudo registrar: ${e.message}`); return null; }
}

/** ¿La cuenta está restringida por seguridad? */
async function restringido(usuario) {
    const U = mongoose.models.Usuario; if (!U) return false;
    return !!(await U.exists({ usuario, restriccionSeguridad: true }).catch(() => null));
}

/**
 * Atajo para rutas: revisa texto; si es grave abre el incidente y devuelve el error para el usuario.
 * → null (todo bien) | { status, error, code }
 */
async function frenarTexto({ texto, usuario, donde, ref, req }) {
    if (await restringido(usuario)) return { status: 403, error: 'Tu cuenta está restringida mientras el equipo de seguridad revisa un reporte.', code: 'RESTRINGIDO' };
    const v = revisarTexto(texto);
    if (!v.grave) return null;
    incidente({ usuario, categoria: v.categoria, motivo: v.motivo, fuente: 'NEXUS reglas', donde, ref, texto, req });
    return { status: 400, error: `No se envió: ${v.motivo.toLowerCase()} está prohibido en UpGames y se reporta a las autoridades.`, code: 'CERO_TOLERANCIA' };
}

/**
 * Revisa una imagen en segundo plano; si es grave llama a ocultar() y abre el incidente.
 */
function vigilarImagen({ imagen, usuario, donde, ref, texto = '', req, ocultar }) {
    if (!imagen) return;
    const ctx = { ip: ipDe(req), headers: { 'user-agent': req?.headers?.['user-agent'], origin: req?.headers?.origin } };
    setImmediate(async () => {
        const url = /^https:\/\/res\.cloudinary\.com\//.test(imagen) ? imagen.replace('/upload/', '/upload/w_768,q_auto,f_jpg/') : imagen;
        const v = await revisarImagen(url).catch(() => null);
        if (!v || v.categoria === 'ok' || v.confianza < UMBRAL_IMAGEN) return;
        try { await ocultar?.(); } catch (_) {}
        incidente({ usuario, categoria: v.categoria, motivo: v.motivo || MOTIVO[v.categoria], fuente: `NEXUS visión (${v.modelo || 'IA'})`, confianza: v.confianza, donde, ref, texto, imagen, req: ctx, restringir: v.confianza >= UMBRAL_RESTRINGIR });
    });
}

async function listar({ limite = 100, estado } = {}) {
    const f = estado ? { estado } : {};
    return col().find(f).sort({ fecha: -1 }).limit(Math.min(500, limite)).toArray();
}

module.exports = { revisarTexto, revisarImagen, incidente, expediente, restringido, frenarTexto, vigilarImagen, listar, configurar, col, MOTIVO, normal, ipDe, UMBRAL_IMAGEN, UMBRAL_RESTRINGIR };
