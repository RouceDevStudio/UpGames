/**
 * ══════════════════════════════════════════════════════════════════
 *  nexus/buscador.js — Motor de búsqueda avanzado de Nexus (panel admin)
 *
 *  El admin escribe lo que busca ("juegos port o emuladores para Android")
 *  y Nexus:
 *   1. Amplía la consulta en varias búsquedas (español e inglés).
 *   2. Busca a la vez en la web, YouTube, TikTok, Facebook, Instagram y Reddit.
 *   3. Junta, quita duplicados y ordena por relevancia (con IA si hay Groq,
 *      por reglas si no).
 *   4. Marca lo que YA está publicado en UpGames → lo que falta es oportunidad.
 *
 *  Motores (se usa el primero que tenga clave; todos son opcionales):
 *   • Web / TikTok / Facebook / Instagram → SERPER_API_KEY (Google) ·
 *     BRAVE_SEARCH_API_KEY · sin clave: DuckDuckGo HTML (más limitado).
 *     Las redes se buscan con "site:" (no tienen API pública de búsqueda).
 *   • YouTube → YOUTUBE_API_KEY (YouTube Data API v3) · sin clave: la página
 *     de resultados de YouTube.
 *   • Reddit → su búsqueda JSON pública · si falla, la web con site:reddit.com.
 *   • TikTok se enriquece con su oEmbed público (título, autor y miniatura).
 *
 *  Todo con tiempo límite: una fuente caída no frena a las demás.
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const llm = require('./llm');

const FUENTES = {
    web:       { nombre: 'Web',       icono: '🌐' },
    youtube:   { nombre: 'YouTube',   icono: '▶️', sitio: 'youtube.com' },
    tiktok:    { nombre: 'TikTok',    icono: '🎵', sitio: 'tiktok.com' },
    facebook:  { nombre: 'Facebook',  icono: '📘', sitio: 'facebook.com' },
    instagram: { nombre: 'Instagram', icono: '📸', sitio: 'instagram.com' },
    reddit:    { nombre: 'Reddit',    icono: '👽', sitio: 'reddit.com' },
};
const PERIODOS = ['semana', 'mes', 'año', 'todo'];
const TIPOS = ['port', 'emulador', 'mod', 'juego', 'app', 'tutorial', 'noticia', 'otro'];
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

const decodificar = s => String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ').trim();
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const VACIAS = new Set(('de la el los las un una y o en para por con sin del al que se mi tu su es son a como mas más the of and or for to in on with how new best top free gratis descargar download '
    + 'video videos tiktok youtube facebook instagram reddit').split(' '));
const palabras = s => norm(s).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !VACIAS.has(w));

/** URL limpia y comparable (sin utm, sin www, sin / final). null si no es http(s). */
function limpiarUrl(u) {
    try {
        const x = new URL(String(u).trim());
        if (!/^https?:$/.test(x.protocol)) return null;
        [...x.searchParams.keys()].forEach(k => { if (/^(utm_|fbclid|gclid|si$|feature$|is_from_webapp|sender_device|_r$|_t$)/i.test(k)) x.searchParams.delete(k); });
        x.hash = '';
        return x.toString().replace(/\/$/, '');
    } catch (_) { return null; }
}
const clave = u => (limpiarUrl(u) || '').replace(/^https?:\/\/(www\.|m\.|mobile\.)?/, '').toLowerCase();

/** Fuente real de un enlace (un resultado de la web puede ser de YouTube o TikTok). */
function fuenteDe(url) {
    const h = (() => { try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; } })();
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(h)) return 'youtube';
    if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok';
    if (/(^|\.)facebook\.com$|(^|\.)fb\.watch$|(^|\.)fb\.com$/.test(h)) return 'facebook';
    if (/(^|\.)instagram\.com$/.test(h)) return 'instagram';
    if (/(^|\.)reddit\.com$|(^|\.)redd\.it$/.test(h)) return 'reddit';
    return 'web';
}

async function pedir(fetchFn, url, opts = {}, ms = 8000) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), ms);
    try {
        const r = await fetchFn(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8', ...(opts.headers || {}) } });
        return r;
    } finally { clearTimeout(to); }
}

// ── Motores web ─────────────────────────────────────────────────
const MOTORES_WEB = [
    {
        id: 'serper', nombre: 'Google (Serper)', activo: () => !!process.env.SERPER_API_KEY,
        async buscar(f, q, o) {
            const body = { q, num: o.n };
            if (o.idioma === 'es') Object.assign(body, { hl: 'es', gl: 'co' });
            if (o.idioma === 'en') Object.assign(body, { hl: 'en', gl: 'us' });
            const tbs = { semana: 'qdr:w', mes: 'qdr:m', año: 'qdr:y' }[o.periodo]; if (tbs) body.tbs = tbs;
            const r = await pedir(f, 'https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!r.ok) throw new Error(`Serper HTTP ${r.status}`);
            const j = await r.json();
            return [...(j.organic || []), ...(j.videos || [])].map(x => ({ titulo: x.title, url: x.link, descripcion: x.snippet || '', fecha: x.date || '', miniatura: x.imageUrl || x.thumbnailUrl || '' }));
        },
    },
    {
        id: 'brave', nombre: 'Brave Search', activo: () => !!process.env.BRAVE_SEARCH_API_KEY,
        async buscar(f, q, o) {
            const p = new URLSearchParams({ q, count: String(Math.min(o.n, 20)) });
            const fr = { semana: 'pw', mes: 'pm', año: 'py' }[o.periodo]; if (fr) p.set('freshness', fr);
            if (o.idioma !== 'todos') p.set('search_lang', o.idioma);
            const r = await pedir(f, `https://api.search.brave.com/res/v1/web/search?${p}`, { headers: { 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY, Accept: 'application/json' } });
            if (!r.ok) throw new Error(`Brave HTTP ${r.status}`);
            const j = await r.json();
            return [...(j.web?.results || []), ...(j.videos?.results || [])].map(x => ({ titulo: x.title, url: x.url, descripcion: decodificar(x.description || ''), fecha: x.age || x.page_age || '', miniatura: x.thumbnail?.src || '' }));
        },
    },
    {
        id: 'duckduckgo', nombre: 'DuckDuckGo (sin clave)', activo: () => true,
        async buscar(f, q, o) {
            const p = new URLSearchParams({ q, kl: { es: 'es-es', en: 'us-en' }[o.idioma] || 'wt-wt' });
            const df = { semana: 'w', mes: 'm', año: 'y' }[o.periodo]; if (df) p.set('df', df);
            const r = await pedir(f, `https://html.duckduckgo.com/html/?${p}`);
            if (!r.ok) throw new Error(`DuckDuckGo HTTP ${r.status}`);
            return parsearDuckDuckGo(await r.text()).slice(0, o.n);
        },
    },
];

function parsearDuckDuckGo(html) {
    const out = [];
    const partes = String(html || '').split(/class="result__a"/).slice(1);
    for (const p of partes) {
        const href = ((p.match(/href="([^"]+)"/) || [])[1] || '').replace(/&amp;/g, '&');
        let url = href;
        const ud = href.match(/[?&]uddg=([^&"]+)/); if (ud) { try { url = decodeURIComponent(ud[1]); } catch (_) {} }
        if (url.startsWith('//')) url = 'https:' + url;
        const titulo = decodificar((p.match(/>([\s\S]*?)<\/a>/) || [])[1]);
        const descripcion = decodificar((p.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
        if (/^https?:\/\//.test(url) && !/duckduckgo\.com\/y\.js/.test(url) && titulo) out.push({ titulo, url, descripcion });
    }
    return out;
}

/** Busca en la web con el primer motor que funcione. Devuelve { items, motor }. */
async function buscarWeb(f, q, o) {
    let ultimoError = null;
    for (const m of MOTORES_WEB) {
        if (!m.activo()) continue;
        try {
            const items = await m.buscar(f, q, o);
            if (items.length || m.id === 'duckduckgo') return { items, motor: m.nombre };
        } catch (e) { ultimoError = e; }
    }
    throw ultimoError || new Error('ningún motor web respondió');
}

// ── YouTube ─────────────────────────────────────────────────────
const fmtNum = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' K' : String(n);
function isoDuracion(iso) {
    const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if (!m) return '';
    const [h, mi, s] = [+(m[1] || 0), +(m[2] || 0), +(m[3] || 0)];
    return (h ? `${h}:${String(mi).padStart(2, '0')}` : `${mi}`) + ':' + String(s).padStart(2, '0');
}
async function youtubeAPI(f, q, o) {
    const p = new URLSearchParams({ part: 'snippet', type: 'video', q, maxResults: String(Math.min(o.n, 25)), key: process.env.YOUTUBE_API_KEY, order: 'relevance' });
    const dias = { semana: 7, mes: 31, año: 366 }[o.periodo]; if (dias) p.set('publishedAfter', new Date(Date.now() - dias * 864e5).toISOString());
    if (o.idioma !== 'todos') p.set('relevanceLanguage', o.idioma);
    const r = await pedir(f, `https://www.googleapis.com/youtube/v3/search?${p}`);
    if (!r.ok) throw new Error(`YouTube API HTTP ${r.status}`);
    const j = await r.json();
    const items = (j.items || []).filter(x => x.id?.videoId).map(x => ({
        id: x.id.videoId, titulo: decodificar(x.snippet?.title), url: `https://www.youtube.com/watch?v=${x.id.videoId}`, descripcion: decodificar(x.snippet?.description),
        autor: x.snippet?.channelTitle || '', fecha: x.snippet?.publishedAt || '', miniatura: x.snippet?.thumbnails?.medium?.url || x.snippet?.thumbnails?.default?.url || '',
    }));
    // Vistas y duración (1 unidad de cuota por llamada)
    if (items.length) try {
        const s = await pedir(f, `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${items.map(i => i.id).join(',')}&key=${process.env.YOUTUBE_API_KEY}`);
        if (s.ok) { const sj = await s.json(); const m = new Map((sj.items || []).map(v => [v.id, v])); items.forEach(i => { const v = m.get(i.id); if (v) { i.vistasN = +v.statistics?.viewCount || 0; i.vistas = fmtNum(i.vistasN); i.duracion = isoDuracion(v.contentDetails?.duration); } }); }
    } catch (_) {}
    return items;
}
/** Recorre ytInitialData y saca los videoRenderer. */
function parsearYouTube(html) {
    const m = String(html || '').match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) || String(html || '').match(/ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/);
    if (!m) return [];
    let data; try { data = JSON.parse(m[1]); } catch (_) { return []; }
    const out = [], pila = [data];
    while (pila.length && out.length < 40) {
        const n = pila.pop();
        if (!n || typeof n !== 'object') continue;
        if (n.videoRenderer?.videoId) {
            const v = n.videoRenderer, txt = t => t?.simpleText || (t?.runs || []).map(r => r.text).join('') || '';
            const vistasTxt = txt(v.viewCountText), vistasN = +String(vistasTxt).replace(/\D/g, '') || 0;
            out.push({ id: v.videoId, titulo: txt(v.title), url: `https://www.youtube.com/watch?v=${v.videoId}`, descripcion: (v.detailedMetadataSnippets?.[0]?.snippetText?.runs || []).map(r => r.text).join(''),
                autor: txt(v.ownerText), fecha: txt(v.publishedTimeText), vistas: vistasN ? fmtNum(vistasN) : vistasTxt, vistasN, duracion: txt(v.lengthText),
                miniatura: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg` });
            continue;
        }
        for (const k of Object.keys(n)) if (n[k] && typeof n[k] === 'object') pila.push(n[k]);
    }
    return out.reverse();   // la pila invierte el orden
}
async function youtubeWeb(f, q, o) {
    const sp = { semana: 'EgIIAw%3D%3D', mes: 'EgIIBA%3D%3D', año: 'EgIIBQ%3D%3D' }[o.periodo];
    const r = await pedir(f, `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}${sp ? '&sp=' + sp : ''}&hl=${o.idioma === 'en' ? 'en' : 'es'}`);
    if (!r.ok) throw new Error(`YouTube HTTP ${r.status}`);
    return parsearYouTube(await r.text()).slice(0, o.n);
}

// ── Reddit ──────────────────────────────────────────────────────
async function redditJSON(f, q, o) {
    const t = { semana: 'week', mes: 'month', año: 'year' }[o.periodo] || 'all';
    const r = await pedir(f, `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&t=${t}&limit=${Math.min(o.n, 25)}&raw_json=1`, { headers: { 'User-Agent': 'UpGamesNexus/1.0 (busqueda de contenido)' } });
    if (!r.ok) throw new Error(`Reddit HTTP ${r.status}`);
    const j = await r.json();
    return (j.data?.children || []).map(c => c.data).filter(Boolean).map(d => ({
        titulo: d.title, url: `https://www.reddit.com${d.permalink}`, descripcion: String(d.selftext || '').slice(0, 280), autor: `r/${d.subreddit}`,
        fecha: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : '', vistas: d.score ? `${fmtNum(d.score)} votos` : '', vistasN: d.score || 0,
        miniatura: /^https?:\/\//.test(d.thumbnail || '') ? d.thumbnail : '',
    }));
}

// ── TikTok: título, autor y miniatura con su oEmbed público ─────
async function enriquecerTikTok(f, items) {
    await Promise.all(items.slice(0, 8).map(async it => {
        if (!/tiktok\.com\/@[^/]+\/video\/\d+/.test(it.url)) return;
        try {
            const r = await pedir(f, `https://www.tiktok.com/oembed?url=${encodeURIComponent(limpiarUrl(it.url) || it.url)}`, {}, 5000);
            if (!r.ok) return;
            const j = await r.json();
            if (j.title) it.titulo = decodificar(j.title).slice(0, 160) || it.titulo;
            if (j.author_unique_id || j.author_name) it.autor = '@' + String(j.author_unique_id || j.author_name).replace(/^@/, '');
            if (j.thumbnail_url) it.miniatura = j.thumbnail_url;
        } catch (_) {}
    }));
}

/** Busca una consulta en una fuente. Devuelve { items, motor }. */
async function buscarEnFuente(f, fuente, q, o) {
    if (fuente === 'youtube') {
        if (process.env.YOUTUBE_API_KEY) try { return { items: await youtubeAPI(f, q, o), motor: 'YouTube Data API' }; } catch (_) {}
        try { return { items: await youtubeWeb(f, q, o), motor: 'YouTube (página de resultados)' }; } catch (_) {}
        const w = await buscarWeb(f, `${q} site:youtube.com`, o); return { items: w.items, motor: w.motor + ' · site:' };
    }
    if (fuente === 'reddit') {
        try { const it = await redditJSON(f, q, o); if (it.length) return { items: it, motor: 'Reddit' }; } catch (_) {}
        const w = await buscarWeb(f, `${q} site:reddit.com`, o); return { items: w.items, motor: w.motor + ' · site:' };
    }
    const sitio = FUENTES[fuente]?.sitio;
    const w = await buscarWeb(f, sitio ? `${q} site:${sitio}` : q, o);
    if (fuente === 'tiktok') await enriquecerTikTok(f, w.items.filter(i => fuenteDe(i.url) === 'tiktok'));
    return { items: w.items, motor: w.motor + (sitio ? ' · site:' : '') };
}

// ── Nexus: ampliar la consulta ──────────────────────────────────
function consultasPorReglas(q) {
    const base = String(q).replace(/^\s*(busca(me|r)?|encuentra(me)?|quiero|dame)\s+/i, '').trim();
    const out = [base];
    if (/android|m[oó]vil|celular/i.test(base) && !/apk/i.test(base)) out.push(`${base} apk`);
    if (/\bport/i.test(base)) out.push(base.replace(/juegos?\s+port(s)?/i, 'PC game port').replace(/para android/i, 'android'));
    if (/emulador/i.test(base)) out.push(base.replace(/emuladores?/i, 'emulator').replace(/para android/i, 'android'));
    return [...new Set(out.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 3);
}
async function ampliar(q) {
    const r = await llm.json(`Eres NEXUS, el buscador de contenido de UpGames (mods, ports de PC a Android, emuladores, juegos indie, apps y herramientas).
Convierte el pedido del administrador en búsquedas efectivas para buscadores y redes (YouTube, TikTok, Facebook, Instagram, Reddit).
Devuelve SOLO JSON: {"consultas": ["...", "...", "..."], "intencion": "una frase"}
Reglas: máximo 3 consultas, cortas (3 a 7 palabras), sin "site:", sin comillas. La primera en el idioma del pedido; incluye al menos una en inglés si ayuda.
Usa los términos que usa la comunidad (port, apk, mod, emulator, winlator, gamehub, mobox, 60fps, low end…) cuando correspondan.`,
    `Pedido: ${q}`, { rapido: true, maxTokens: 220, temperatura: 0.3 }).catch(() => null);
    const cs = (Array.isArray(r?.consultas) ? r.consultas : []).filter(x => typeof x === 'string').map(x => x.replace(/site:\S+/gi, '').replace(/["“”]/g, '').trim().slice(0, 90)).filter(Boolean);
    return cs.length ? { consultas: [...new Set(cs)].slice(0, 3), intencion: String(r.intencion || '').slice(0, 200), fuente: r._fuente } : { consultas: consultasPorReglas(q), intencion: '', fuente: null };
}

// ── Orden ───────────────────────────────────────────────────────
function puntuarPorReglas(it, terminos) {
    const t = new Set(palabras(`${it.titulo} ${it.descripcion} ${it.autor || ''}`));
    const coinc = terminos.filter(w => t.has(w)).length;
    let p = terminos.length ? (coinc / terminos.length) * 70 : 35;
    if (it.vistasN) p += Math.min(20, Math.log10(it.vistasN + 1) * 4);
    if (it.miniatura) p += 4;
    if (/\b(apk|port|mod|emulador|emulator|descargar|download|gameplay|tutorial)\b/i.test(it.titulo)) p += 6;
    return Math.max(1, Math.min(99, Math.round(p)));
}
function tipoPorReglas(it) {
    const s = norm(`${it.titulo} ${it.descripcion}`);
    if (/emulador|emulator|winlator|mobox|gamehub|yuzu|ppsspp|aethersx2|retroarch|dolphin|citra|exagear/.test(s)) return 'emulador';
    if (/\bport(ed|ado)?\b/.test(s)) return 'port';
    if (/\bmod(s|pack)?\b/.test(s)) return 'mod';
    if (/tutorial|como instalar|how to|guia|guide/.test(s)) return 'tutorial';
    if (/\bapp\b|aplicacion|herramienta|tool/.test(s)) return 'app';
    if (/noticia|news|anuncia|announce|trailer/.test(s)) return 'noticia';
    if (/juego|game|gameplay/.test(s)) return 'juego';
    return 'otro';
}
async function ordenarConIA(consulta, items) {
    if (!llm.disponible() || !items.length) return null;
    const lista = items.slice(0, 50).map((it, i) => ({ i, f: it.fuente, t: it.titulo.slice(0, 120), d: String(it.descripcion || '').slice(0, 160), a: it.autor || '', v: it.vistas || '', fe: it.fecha || '' }));
    const r = await llm.json(`Eres NEXUS, curador de contenido de UpGames (mods, ports a Android, emuladores, juegos indie, apps).
Te paso resultados de varias redes para el pedido del administrador. Evalúa cada uno y devuelve SOLO JSON:
{"resumen":"2-3 frases: qué hay, qué destaca y qué tendencia ves","resultados":[{"i":0,"relevancia":0-100,"tipo":"${TIPOS.join('|')}","nota":"por qué sirve, máx 14 palabras"}],"ideas":["oportunidad concreta para UpGames", "..."]}
Reglas: relevancia alta solo si responde EXACTAMENTE al pedido. Baja la relevancia a spam, clickbait, estafas ("gratis 100% real", "hack de monedas"), piratería de juegos de pago y contenido viejo o repetido.
Máximo 3 ideas, prácticas (qué publicar, a qué creador contactar, qué falta en UpGames). No inventes datos que no estén en los resultados.`,
    `Pedido: ${consulta}\n\nResultados (JSON):\n${JSON.stringify(lista)}`, { maxTokens: 2200, temperatura: 0.2, timeout: 40000 }).catch(() => null);
    if (!r || !Array.isArray(r.resultados)) return null;
    return r;
}

// ── ¿Ya está en UpGames? ────────────────────────────────────────
let catalogo = { t: 0, items: [] };
async function catalogoUpGames(Juego) {
    if (!Juego) return [];
    if (Date.now() - catalogo.t < 10 * 60e3) return catalogo.items;
    const docs = await Juego.find({ status: 'aprobado' }).select('_id title category').sort({ createdAt: -1 }).limit(6000).lean();
    catalogo = { t: Date.now(), items: docs.map(d => ({ id: String(d._id), titulo: d.title, categoria: d.category, p: new Set(palabras(d.title)) })) };
    return catalogo.items;
}
function coincidenciaUpGames(it, cat) {
    const p = palabras(it.titulo);
    if (p.length < 2) return null;
    let mejor = null, mejorS = 0;
    for (const c of cat) {
        if (c.p.size < 1) continue;
        let n = 0; for (const w of c.p) if (p.includes(w)) n++;
        const s = n / Math.max(2, c.p.size);   // qué parte del título de UpGames aparece en el resultado
        if (n >= 2 && s > mejorS) { mejorS = s; mejor = c; }
    }
    return mejor && mejorS >= 0.6 ? { id: mejor.id, titulo: mejor.titulo, categoria: mejor.categoria } : null;
}

// ── Caché de búsquedas (30 min) ─────────────────────────────────
const cache = new Map();
const CACHE_MS = 30 * 60e3;

/**
 * Búsqueda completa.
 * @param {object} p { consulta, fuentes[], periodo, idioma, porFuente }
 * @param {object} deps { fetch, Juego, logger }
 */
async function buscar(p, deps = {}) {
    const f = deps.fetch || globalThis.fetch;
    const consulta = String(p.consulta || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (consulta.length < 3) throw Object.assign(new Error('Escribe al menos 3 letras'), { status: 400 });
    const fuentes = (Array.isArray(p.fuentes) && p.fuentes.length ? p.fuentes : Object.keys(FUENTES)).filter(x => FUENTES[x]);
    if (!fuentes.length) throw Object.assign(new Error('Elige al menos una red'), { status: 400 });
    const periodo = PERIODOS.includes(p.periodo) ? p.periodo : 'todo';
    const idioma = ['es', 'en', 'todos'].includes(p.idioma) ? p.idioma : 'todos';
    const n = Math.max(4, Math.min(15, +p.porFuente || 8));

    const kc = JSON.stringify([norm(consulta), [...fuentes].sort(), periodo, idioma, n]);
    const c = cache.get(kc);
    if (c && !p.forzar && Date.now() - c.t < CACHE_MS) return { ...c.r, cache: true };

    const t0 = Date.now();
    const amp = await ampliar(consulta);
    const o = { periodo, idioma, n };

    // Cada fuente con hasta 2 consultas; todas en paralelo
    const porFuente = {}, crudos = [];
    await Promise.all(fuentes.map(async fu => {
        const est = porFuente[fu] = { ok: false, n: 0, motor: null, error: null };
        const qs = amp.consultas.slice(0, fu === 'web' ? 3 : 2);
        const rs = await Promise.allSettled(qs.map(q => buscarEnFuente(f, fu, q, o)));
        for (const r of rs) {
            if (r.status === 'fulfilled') { est.ok = true; est.motor = r.value.motor; est.n += r.value.items.length; r.value.items.forEach(it => crudos.push({ ...it, fuente: fu === 'web' ? fuenteDe(it.url) : fu, buscadoEn: fu })); }
            else est.error = String(r.reason?.message || r.reason).slice(0, 140);
        }
        if (est.ok) est.error = null;
    }));

    // Limpiar y quitar duplicados (el mismo video puede salir en "web" y en "youtube")
    const vistos = new Map();
    for (const it of crudos) {
        const url = limpiarUrl(it.url); if (!url || !it.titulo) continue;
        const k = clave(url);
        const previo = vistos.get(k);
        const nuevo = { titulo: decodificar(it.titulo).slice(0, 200), url, descripcion: decodificar(it.descripcion).slice(0, 400), fuente: it.fuente, autor: it.autor || '', fecha: it.fecha || '',
            vistas: it.vistas || '', vistasN: it.vistasN || 0, duracion: it.duracion || '', miniatura: /^https:\/\//.test(it.miniatura || '') ? it.miniatura : '' };
        if (!previo) vistos.set(k, nuevo);
        else for (const [a, v] of Object.entries(nuevo)) if (!previo[a] && v) previo[a] = v;   // completa lo que faltaba
    }
    let items = [...vistos.values()];

    // Orden: IA si hay; si no, reglas
    const terminos = [...new Set(palabras(amp.consultas.join(' ')))];
    items.forEach(it => { it.relevancia = puntuarPorReglas(it, terminos); it.tipo = tipoPorReglas(it); });
    const ia = await ordenarConIA(consulta, items.sort((a, b) => b.relevancia - a.relevancia));
    if (ia) {
        const top = items.slice(0, 50);
        for (const x of ia.resultados) {
            const it = top[+x.i]; if (!it) continue;
            if (Number.isFinite(+x.relevancia)) it.relevancia = Math.max(0, Math.min(100, Math.round(+x.relevancia)));
            if (TIPOS.includes(x.tipo)) it.tipo = x.tipo;
            if (x.nota) it.nota = String(x.nota).slice(0, 140);
        }
    }
    items.sort((a, b) => b.relevancia - a.relevancia || (b.vistasN || 0) - (a.vistasN || 0));
    items = items.slice(0, 80);

    // ¿Ya está en UpGames?
    try {
        const cat = await catalogoUpGames(deps.Juego);
        if (cat.length) items.forEach(it => { const m = coincidenciaUpGames(it, cat); if (m) it.enUpGames = m; });
    } catch (e) { deps.logger?.warn?.(`[nexus buscador] catálogo: ${e.message}`); }

    const resumenReglas = () => {
        if (!items.length) return 'No encontré resultados con esa búsqueda. Prueba con menos palabras, otro periodo o en inglés.';
        const cuenta = Object.entries(items.reduce((a, i) => (a[i.fuente] = (a[i.fuente] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} en ${FUENTES[k]?.nombre || k}`).join(', ');
        const faltan = items.filter(i => !i.enUpGames && i.relevancia >= 50).length;
        return `Encontré ${items.length} resultados (${cuenta}). ${faltan ? `${faltan} relevantes todavía no están en UpGames.` : ''}`.trim();
    };
    const r = {
        consulta, consultas: amp.consultas, intencion: amp.intencion, periodo, idioma, fuentes,
        resumen: ia?.resumen ? String(ia.resumen).slice(0, 700) : resumenReglas(),
        ideas: (Array.isArray(ia?.ideas) ? ia.ideas : []).filter(x => typeof x === 'string').slice(0, 3).map(x => x.slice(0, 220)),
        fuenteIA: ia ? (ia._fuente || amp.fuente) : null,
        porFuente, resultados: items, ms: Date.now() - t0, generado: new Date(),
        motores: { web: MOTORES_WEB.find(m => m.activo()).nombre, youtube: process.env.YOUTUBE_API_KEY ? 'YouTube Data API' : 'YouTube (sin clave)' },
    };
    cache.set(kc, { t: Date.now(), r });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return { ...r, cache: false };
}

/** Qué motores hay configurados (para mostrarlo en el panel). */
const estado = () => ({
    web: MOTORES_WEB.filter(m => m.activo()).map(m => m.nombre),
    youtube: process.env.YOUTUBE_API_KEY ? 'YouTube Data API' : 'YouTube (página de resultados, sin clave)',
    ia: llm.disponible(),
    sugerencia: !process.env.SERPER_API_KEY && !process.env.BRAVE_SEARCH_API_KEY ? 'Configura SERPER_API_KEY (o BRAVE_SEARCH_API_KEY) en Railway para buscar con Google en TikTok, Facebook e Instagram. Sin clave se usa DuckDuckGo, que trae menos resultados de redes.' : null,
});

module.exports = { buscar, estado, FUENTES, PERIODOS, parsearDuckDuckGo, parsearYouTube, limpiarUrl, fuenteDe, consultasPorReglas, coincidenciaUpGames, palabras, _cache: cache, _catalogo: () => catalogo };
