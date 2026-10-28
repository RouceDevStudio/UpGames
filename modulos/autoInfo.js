/**
 * AUTO-INFO — UpGames
 * Reconoce el título que escribe el usuario al publicar (juego, mod, ROM,
 * app, herramienta…) y devuelve una imagen y una descripción breve.
 *
 * Fuentes (en orden):
 *   1. Steam Store   → juegos, mods, optimizaciones (imagen horizontal + resumen en español)
 *   2. iTunes Search → apps móviles
 *   3. Wikipedia ES  → todo lo demás (con imagen de Wikipedia EN si ES no tiene)
 *
 * Sin dependencias: usa fetch nativo (Node >= 18). Resultados cacheados 24 h.
 */

const cache        = require('./cache');
const logger       = require('./logger');
const gameDetector = require('./gameDetector');

const UA      = 'UpGamesBot/1.0 (https://upgames.games/)';
const TTL_SEG = 60 * 60 * 24;

// Palabras que no ayudan a identificar el contenido ("GTA V mod realista PC full español")
const RUIDO = [
  'mod','mods','modpack','apk','mod apk','ipa','pc','android','ios','windows','mac','linux',
  'full','espanol','español','spanish','latino','optimizado','optimizada','optimizacion','optimización',
  'portable','repack','gratis','free','descargar','download','mega','mediafire','drive','ultima version',
  'última versión','version','versión','update','actualizado','pack','texturas','graficos','gráficos',
  'realista','remastered edition','fps','boost','lite','pro','premium','rom','roms','iso','nsp','xci',
  'nes','snes','n64','gba','gbc','nds','3ds','psp','ps1','ps2','psx','wii','gamecube','dreamcast','sega',
  'emulador','emulator','herramienta','tool','tools','app','juego','game'
];

const PISTA_WIKI = {
  Juego: 'videojuego', Mod: 'videojuego', Optimizacion: 'videojuego', ROM: 'videojuego',
  Apps: 'aplicación', Software: 'software', Ajustes: 'software'
};

function normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Quita versiones, corchetes y palabras de ruido para quedarse con el nombre. */
function limpiarTitulo(titulo) {
  let t = ' ' + normalizar(titulo)
    .replace(/[\[(][^\])]*[\])]/g, ' ')        // [PC] (v1.2)
    .replace(/\bv?\d+(\.\d+){1,3}\b/g, ' ')     // v1.2.3
    .replace(/[_|+\-–—:]+/g, ' ') + ' ';
  for (const w of RUIDO.map(normalizar).sort((a, b) => b.length - a.length)) {
    t = t.split(' ' + w + ' ').join(' ');
  }
  return t.replace(/\s+/g, ' ').trim();
}

function resumir(texto, max = 260) {
  const limpio = String(texto || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max);
  const punto = corte.lastIndexOf('. ');
  return (punto > max * 0.5 ? corte.slice(0, punto + 1) : corte.replace(/\s+\S*$/, '') + '…');
}

async function getJSON(url, ms = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Similitud por palabras compartidas (coeficiente de Dice, 0..1). */
function similitud(a, b) {
  const A = new Set(normalizar(a).split(/\W+/).filter(Boolean));
  const B = new Set(normalizar(b).split(/\W+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let comunes = 0;
  A.forEach(w => { if (B.has(w)) comunes++; });
  return (2 * comunes) / (A.size + B.size);
}

// ── Steam ────────────────────────────────────────────────
async function buscarSteam(q, appIdConocido) {
  let appId = appIdConocido;
  if (!appId) {
    const s = await getJSON(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=spanish&cc=CO`);
    const mejor = (s?.items || [])
      .filter(i => i.type === 'app')
      .map(i => ({ id: i.id, score: similitud(q, i.name) }))
      .sort((a, b) => b.score - a.score)[0];
    if (!mejor || mejor.score < 0.75) return null; // evita falsos positivos ("Minecraft" ≠ "Minecraft Dungeons")
    appId = mejor.id;
  }
  const d = await getJSON(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=spanish&filters=basic`);
  const data = d?.[appId]?.data;
  if (!data) return null;
  return {
    name:        data.name,
    description: resumir(data.short_description),
    image:       data.header_image || '',
    source:      'Steam',
    sourceUrl:   `https://store.steampowered.com/app/${appId}/`
  };
}

// ── iTunes (apps) ────────────────────────────────────────
async function buscarApp(q) {
  const r = await getJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=software&country=co&lang=es_es&limit=1`);
  const a = r?.results?.[0];
  if (!a) return null;
  return {
    name:        a.trackName,
    description: resumir(a.description),
    image:       a.artworkUrl512 || a.artworkUrl100 || '',
    source:      'App Store',
    sourceUrl:   a.trackViewUrl || ''
  };
}

// ── Wikipedia ────────────────────────────────────────────
async function buscarWikipedia(q, cat) {
  const pista = PISTA_WIKI[cat] || '';
  const url = 'https://es.wikipedia.org/w/api.php?action=query&format=json&redirects=1'
    + '&generator=search&gsrlimit=5&gsrsearch=' + encodeURIComponent((q + ' ' + pista).trim())
    + '&prop=pageimages%7Cextracts%7Clanglinks&exintro=1&explaintext=1&exsentences=3&exlimit=max'
    + '&piprop=thumbnail&pithumbsize=640&lllang=en&lllimit=max';
  const r = await getJSON(url);
  const pages = Object.values(r?.query?.pages || {});
  if (!pages.length) return null;

  const pistaN = normalizar(pista);
  pages.forEach(p => {
    p._score = similitud(q, p.title) * 3
      + (pistaN && normalizar(p.extract).includes(pistaN) ? 2 : 0)
      - (p.index || 0) * 0.2;
  });
  pages.sort((a, b) => b._score - a._score);
  const p = pages[0];
  if (!p || p._score < 1) return null;

  let image = p.thumbnail?.source || '';
  if (!image && p.langlinks?.[0]?.['*']) {
    const en = await getJSON('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(p.langlinks[0]['*'].replace(/ /g, '_')));
    image = en?.originalimage?.source || en?.thumbnail?.source || '';
  }
  return {
    name:        p.title,
    description: resumir(p.extract),
    image,
    source:      'Wikipedia',
    sourceUrl:   'https://es.wikipedia.org/wiki/' + encodeURIComponent(p.title.replace(/ /g, '_'))
  };
}

/**
 * Busca información para un título.
 * @returns {Promise<null|{name,description,image,source,sourceUrl,detectedGame}>}
 */
async function lookup(titulo, categoria = 'Juego') {
  const det = gameDetector.detectGame(titulo, '');
  const q   = det ? det.gameName : limpiarTitulo(titulo);
  if (!q || q.length < 2) return null;

  const key = `autoinfo:${categoria}:${normalizar(q)}`;
  const hit = cache.get(key);
  if (hit !== null && hit !== undefined) return hit;

  const esJuego = ['Juego', 'Mod', 'Optimizacion'].includes(categoria) || !!det;
  let info = null;
  try {
    if (esJuego) {
      const appId = det?.purchaseLink?.match(/store\.steampowered\.com\/app\/(\d+)/)?.[1];
      // Si el detector conoce el juego pero no está en Steam (ej. Minecraft), ir directo a Wikipedia
      if (appId || !det) info = await buscarSteam(q, appId);
    }
    if (!info && categoria === 'Apps') info = await buscarApp(q);
    if (!info) info = await buscarWikipedia(q, categoria);
    // Steam como último recurso para ROMs / herramientas con nombre de juego
    if (!info && !esJuego) info = await buscarSteam(q);
  } catch (err) {
    logger.warn(`[autoInfo] ${err.message}`);
  }

  const res = info ? {
    ...info,
    detectedGame: det ? { gameName: det.gameName, purchaseLink: det.purchaseLink, platform: det.platform } : null
  } : null;
  cache.set(key, res || false, info ? TTL_SEG : 600);
  return res;
}

module.exports = { lookup, limpiarTitulo };
