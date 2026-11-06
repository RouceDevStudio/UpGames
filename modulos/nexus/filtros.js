/**
 * ══════════════════════════════════════════════════════════════════
 *  nexus/filtros.js — Nexus en la barra de búsqueda
 *
 *  "juegos de carreras que corran en 3 GB de RAM para android"
 *     → { categoria:'Juego', plataforma:'Android', terminos:['carreras','racing',…],
 *         ramMaxGB:3, orden:'relevancia' }
 *  y busca en TODO el catálogo (la portada solo carga 100 publicaciones).
 *
 *  interpretar(q)   IA (Groq, modelo rápido) con respaldo por reglas
 *  porReglas(q)     sin IA: categorías, plataformas, RAM, tamaño, orden y palabras
 *  buscar(f, deps)  consulta + puntuación; nunca devuelve el enlace de descarga
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const llm = require('./llm');

const CATEGORIAS = ['Juego', 'Mod', 'Apps', 'Software', 'Ajustes', 'Optimizacion', 'Video'];
const PLATAFORMAS = ['Android', 'PC', 'iOS', 'PlayStation', 'Xbox', 'Nintendo Switch'];
const ORDENES = ['relevancia', 'descargas', 'recientes', 'likes'];
const VISIBLE = { status: 'aprobado', linkStatus: { $in: ['online', 'revision'] } };

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const escRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const VACIAS = new Set(('de la el los las un una unos unas y o en para por con sin del al que se me mi tu su es son como mas muy quiero busco buscar dame encuentra '
    + 'algo alguno alguna algun hay tengo tienen tiene sea sean corra corran funcione funcionen ande anden juegos juego apps app mods mod gb mb ram memoria '
    + 'menos maximo hasta pesen pese pesado ligero ligeros ligeras livianos liviano bajos recursos gama baja media alta celular telefono movil android pc '
    + 'mejores mejor nuevos nuevo nuevas recientes populares descargados the for and with of').split(' '));

// Sinónimos frecuentes de la comunidad (las búsquedas se hacen en español; los títulos suelen ir en inglés)
const SINONIMOS = {
    carreras: ['racing', 'race', 'carros', 'autos', 'drift', 'f1', 'formula'], carros: ['racing', 'cars', 'autos'], autos: ['cars', 'racing'],
    terror: ['horror', 'survival horror', 'miedo', 'resident evil', 'silent hill', 'outlast'], miedo: ['horror', 'terror'],
    disparos: ['shooter', 'fps', 'tiros'], shooter: ['fps', 'disparos'], futbol: ['football', 'soccer', 'fifa', 'pes', 'efootball'],
    pelea: ['fighting', 'lucha', 'mortal kombat', 'tekken'], lucha: ['fighting', 'pelea'], mundo: ['open world'], abierto: ['open world'],
    zombies: ['zombie', 'zomboid'], estrategia: ['strategy', 'rts'], aventura: ['adventure'], accion: ['action'], rol: ['rpg'],
    emulador: ['emulator', 'emu', 'winlator', 'mobox', 'gamehub', 'ppsspp', 'aethersx2', 'retroarch'], emuladores: ['emulator', 'emulador', 'winlator'],
    port: ['ported', 'porteado', 'mobile'], ports: ['port', 'ported'], graficos: ['graphics', 'texturas', 'reshade'], rendimiento: ['fps', 'optimizado', 'performance', 'lite'],
};

/** Interpretación sin IA. */
function porReglas(q) {
    const s = norm(q);
    const f = { categoria: null, plataforma: null, terminos: [], ramMaxGB: null, tamanoMaxGB: null, orden: 'relevancia' };
    if (/\bvideos?\b|tutorial|gameplay/.test(s)) f.categoria = 'Video';
    else if (/\bmods?\b|modpack/.test(s)) f.categoria = 'Mod';
    else if (/optimiza|mas fps|\blag\b|rendimiento/.test(s) && !/juego/.test(s)) f.categoria = 'Optimizacion';
    else if (/\bapps?\b|aplicacion|emulador/.test(s)) f.categoria = 'Apps';
    else if (/software|programa/.test(s)) f.categoria = 'Software';
    else if (/herramienta|script|plugin|config/.test(s)) f.categoria = 'Ajustes';
    else if (/juego|game/.test(s)) f.categoria = 'Juego';
    if (/android|celular|telefono|movil|mobile/.test(s)) f.plataforma = 'Android';
    else if (/\bpc\b|windows|computador|portatil/.test(s)) f.plataforma = 'PC';
    else if (/\bios\b|iphone|ipad/.test(s)) f.plataforma = 'iOS';
    const ram = s.match(/(\d+(?:[.,]\d+)?)\s*(?:gb|g)\s*(?:de\s*)?(?:ram|memoria)/) || s.match(/(?:ram|memoria)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*(?:gb|g)/);
    if (ram) f.ramMaxGB = +ram[1].replace(',', '.');
    else if (/gama baja|bajos recursos|pocos recursos|celular viejo/.test(s)) f.ramMaxGB = 3;
    const tam = s.match(/(?:pese|pesen|peso|tamano|menos de|maximo|hasta)\s*(\d+(?:[.,]\d+)?)\s*(gb|mb)\b(?!\s*(?:de\s*)?(?:ram|memoria))/);
    if (tam) f.tamanoMaxGB = +tam[1].replace(',', '.') / (tam[2] === 'mb' ? 1024 : 1);
    else if (/ligero|liviano|poco peso|pesen poco/.test(s)) f.tamanoMaxGB = 1;
    if (/mas descargad|populares|top\b|mas bajad/.test(s)) f.orden = 'descargas';
    else if (/nuevo|reciente|ultimo|recien/.test(s)) f.orden = 'recientes';
    else if (/mejor valorad|mas gustad|likes/.test(s)) f.orden = 'likes';
    const base = s.replace(/\d+(?:[.,]\d+)?\s*(gb|mb|g)\b/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !VACIAS.has(w) && !/^\d+$/.test(w));
    const terminos = [];
    for (const w of base) { terminos.push(w); (SINONIMOS[w] || []).forEach(x => terminos.push(x)); }
    f.terminos = [...new Set(terminos)].slice(0, 10);
    return f;
}

/** Valida y limpia lo que devuelve la IA (o las reglas). */
function sanear(o) {
    const f = { categoria: null, plataforma: null, terminos: [], ramMaxGB: null, tamanoMaxGB: null, orden: 'relevancia' };
    if (CATEGORIAS.includes(o?.categoria)) f.categoria = o.categoria;
    if (PLATAFORMAS.includes(o?.plataforma)) f.plataforma = o.plataforma;
    if (Array.isArray(o?.terminos)) f.terminos = [...new Set(o.terminos.filter(t => typeof t === 'string').map(t => norm(t).replace(/[^a-z0-9 .:+-]/g, '').trim()).filter(t => t.length > 1 && t.length <= 40))].slice(0, 12);
    const num = (v, a, b) => { const n = +v; return Number.isFinite(n) && n >= a && n <= b ? Math.round(n * 10) / 10 : null; };
    f.ramMaxGB = num(o?.ramMaxGB, 0.5, 64);
    f.tamanoMaxGB = num(o?.tamanoMaxGB, 0.01, 500);
    if (ORDENES.includes(o?.orden)) f.orden = o.orden;
    return f;
}

/** ¿Vale la pena preguntarle a la IA? (frases, no un simple título) */
const esFrase = q => norm(q).split(/\s+/).filter(Boolean).length >= 3;

const cache = new Map();
async function interpretar(q, { conIA = true } = {}) {
    const consulta = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const k = norm(consulta);
    if (cache.has(k)) return cache.get(k);
    const reglas = porReglas(consulta);
    let r = { filtros: reglas, fuente: null };
    if (conIA && esFrase(consulta) && llm.disponible()) {
        const ia = await llm.json(`Eres NEXUS, el buscador de UpGames (juegos, mods, apps, software, herramientas, optimizaciones y videos).
Convierte lo que escribe el usuario en filtros. Devuelve SOLO JSON:
{"categoria": ${JSON.stringify(CATEGORIAS)} o null, "plataforma": ${JSON.stringify(PLATAFORMAS)} o null, "terminos": ["..."], "ramMaxGB": número o null, "tamanoMaxGB": número o null, "orden": ${JSON.stringify(ORDENES)}, "explicacion": "frase corta de lo que entendiste"}
Reglas:
- "terminos": palabras clave para buscar en títulos y descripciones, en español E inglés, incluye sinónimos y nombres de juegos o sagas que encajan (p. ej. carreras → racing, need for speed, f1, asphalt). Máximo 10, en minúscula. No pongas palabras de relleno ni la plataforma.
- "gama baja" ≈ ramMaxGB 3; "gama media" ≈ 6. Solo pon ramMaxGB/tamanoMaxGB si el usuario habla de memoria/RAM, gama o peso.
- Si no menciona categoría, deja null (salvo que sea obvio: "juegos" → Juego, "emuladores" → Apps).
- orden: "descargas" si pide populares/más descargados, "recientes" si pide nuevos, "likes" si pide mejor valorados; si no, "relevancia".`,
        `Usuario: ${consulta}`, { rapido: true, maxTokens: 260, temperatura: 0.1, timeout: 9000 }).catch(() => null);
        if (ia) {
            const f = sanear(ia);
            if (!f.terminos.length) f.terminos = reglas.terminos;
            r = { filtros: f, explicacion: String(ia.explicacion || '').slice(0, 160), fuente: ia._fuente };
        }
    }
    cache.set(k, r);
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return r;
}

// ── Datos de la publicación ─────────────────────────────────────
/** Tamaño en GB a partir de "25 GB", "800 MB"… (null si no hay) */
function tamanoGB(it) {
    const s = norm(`${it.extraData?.size || ''} ${it.extraData?.tamano || ''}`) || '';
    const m = s.match(/(\d+(?:[.,]\d+)?)\s*(gb|mb|kb)/) || norm(it.description).match(/(?:tamano|peso|size)\D{0,12}(\d+(?:[.,]\d+)?)\s*(gb|mb)/);
    if (!m) return null;
    const n = +m[1].replace(',', '.');
    return m[2] === 'gb' ? n : m[2] === 'mb' ? n / 1024 : n / 1048576;
}
/** RAM mínima pedida en la descripción/requisitos ("4 GB de RAM", "RAM: 6GB") */
function ramGB(it) {
    const s = norm(`${it.extraData?.requisitos || ''} ${it.description || ''}`);
    const m = s.match(/(\d+(?:[.,]\d+)?)\s*gb\s*(?:de\s*)?(?:ram|memoria)/) || s.match(/(?:ram|memoria)\s*:?\s*(?:minim[oa]\s*)?(\d+(?:[.,]\d+)?)\s*gb/);
    return m ? +m[1].replace(',', '.') : null;
}
function plataformaDe(it) {
    const ex = `${it.extraData?.plataforma || ''} ${it.extraData?.so || ''}`;
    if (ex.trim()) return norm(ex);
    return norm(`${it.title} ${it.description || ''}`).match(/android|apk|windows|\bpc\b|ios|iphone/)?.[0] || '';
}
function encajaPlataforma(it, p) {
    if (!p) return true;
    const pl = plataformaDe(it);
    if (!pl) return true;   // sin dato: no se descarta
    if (/multi/.test(pl)) return true;
    if (p === 'Android') return /android|apk/.test(pl);
    if (p === 'PC') return /pc|windows|linux|mac/.test(pl);
    if (p === 'iOS') return /ios|iphone/.test(pl);
    return pl.includes(norm(p));
}

function puntuar(it, terminos) {
    if (!terminos.length) return 1;
    const t = norm(it.title), d = norm(it.description), ex = norm(Object.values(it.extraData || {}).filter(v => typeof v === 'string').join(' ')), tags = norm((it.tags || []).join(' '));
    let p = 0;
    for (const w of terminos) {
        const re = new RegExp(`(^|[^a-z0-9])${escRegex(w)}`);
        if (re.test(t)) p += 10; else if (re.test(tags) || re.test(ex)) p += 5; else if (re.test(d)) p += 2;
    }
    return p;
}

const CAMPOS = '_id title description image images category usuario linkStatus descargasEfectivas vistas likesCount extraData createdAt serie videoType';

/** Busca con los filtros. Devuelve publicaciones SIN enlace (salvo videos, cuyo enlace es el propio video). */
async function buscar(f, { Juego }) {
    const q = { ...VISIBLE };
    if (f.categoria) q.category = f.categoria; else q.category = { $ne: 'Video' };
    if (f.terminos.length) {
        const re = new RegExp(f.terminos.map(escRegex).join('|'), 'i');
        q.$or = [{ title: re }, { description: re }, { tags: re }, { 'extraData.juego-base': re }, { 'extraData.consola': re }, { 'extraData.detectedGame.gameName': re }];
    }
    const docs = await Juego.find(q).select(CAMPOS + (f.categoria === 'Video' ? ' link' : '')).sort({ descargasEfectivas: -1 }).limit(500).lean();
    let r = docs.filter(it => encajaPlataforma(it, f.plataforma))
        .filter(it => { if (f.ramMaxGB == null) return true; const n = ramGB(it); return n == null || n <= f.ramMaxGB; })
        .filter(it => { if (f.tamanoMaxGB == null) return true; const n = tamanoGB(it); return n == null || n <= f.tamanoMaxGB; })
        .map(it => ({ ...it, _p: puntuar(it, f.terminos) }))
        .filter(it => it._p > 0);
    const orden = {
        relevancia: (a, b) => b._p - a._p || (b.descargasEfectivas || 0) - (a.descargasEfectivas || 0),
        descargas: (a, b) => (b.descargasEfectivas || 0) - (a.descargasEfectivas || 0),
        recientes: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
        likes: (a, b) => (b.likesCount || 0) - (a.likesCount || 0),
    }[f.orden] || ((a, b) => b._p - a._p);
    r.sort(orden);
    return r.slice(0, 60).map(({ _p, link, ...it }) => (it.category === 'Video' ? { ...it, link } : it));
}

/** Texto corto de lo entendido, para la barra ("Juegos · Android · ≤ 3 GB RAM · racing, f1…") */
function resumen(f) {
    const CAT = { Juego: 'Juegos', Mod: 'Mods', Apps: 'Apps', Software: 'Software', Ajustes: 'Herramientas', Optimizacion: 'Optimización', Video: 'Videos' };
    const p = [];
    if (f.categoria) p.push(CAT[f.categoria]);
    if (f.plataforma) p.push(f.plataforma);
    if (f.ramMaxGB) p.push(`≤ ${f.ramMaxGB} GB RAM`);
    if (f.tamanoMaxGB) p.push(`≤ ${f.tamanoMaxGB >= 1 ? f.tamanoMaxGB + ' GB' : Math.round(f.tamanoMaxGB * 1024) + ' MB'}`);
    if (f.orden !== 'relevancia') p.push({ descargas: 'más descargados', recientes: 'más nuevos', likes: 'mejor valorados' }[f.orden]);
    return p;
}

module.exports = { porReglas, interpretar, buscar, sanear, resumen, esFrase, tamanoGB, ramGB, encajaPlataforma, puntuar, CATEGORIAS };
