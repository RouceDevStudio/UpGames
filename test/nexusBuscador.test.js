/**
 * Tests del buscador avanzado de Nexus (modulos/nexus/buscador.js).
 * Autónomo: `node test/nexusBuscador.test.js`. Sin red: fetch simulado.
 */
'use strict';

const assert = require('assert');
['GROQ_API_KEY', 'SERPER_API_KEY', 'BRAVE_SEARCH_API_KEY', 'YOUTUBE_API_KEY'].forEach(k => delete process.env[k]);
const B = require('../modulos/nexus/buscador');

let passed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.stack || e.message}`); process.exitCode = 1; }
}
const resp = (cuerpo, status = 200) => ({ ok: status < 400, status, text: async () => typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), json: async () => typeof cuerpo === 'string' ? JSON.parse(cuerpo) : cuerpo });

const DDG = q => `<div><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(`https://www.tiktok.com/@port/video/123?is_from_webapp=1`)}&amp;rut=x">GTA <b>San Andreas</b> port Android</a>
  <a class="result__snippet" href="#">Así corre el <b>port</b> en Winlator &amp; Mobox</a></div>
  <div><a class="result__a" href="https://www.youtube.com/watch?v=abc123&amp;utm_source=x">Mejor emulador PS2 Android 2026 (${q.slice(0, 10)})</a><a class="result__snippet">AetherSX2 y NetherSX2</a></div>`;
const YT = `<script>var ytInitialData = ${JSON.stringify({ contents: { a: [{ videoRenderer: { videoId: 'abc123', title: { runs: [{ text: 'Mejor emulador PS2 Android' }] }, ownerText: { runs: [{ text: 'CanalX' }] }, viewCountText: { simpleText: '1.234.567 vistas' }, lengthText: { simpleText: '12:01' }, publishedTimeText: { simpleText: 'hace 2 días' } } }, { videoRenderer: { videoId: 'zzz999', title: { runs: [{ text: 'Winlator tutorial' }] } } }] } })};</script>`;

function fetchFalso(log = []) {
    return async (url) => {
        log.push(url);
        if (url.includes('duckduckgo.com')) return resp(DDG(decodeURIComponent(url)));
        if (url.includes('youtube.com/results')) return resp(YT);
        if (url.includes('reddit.com/search.json')) return resp({ data: { children: [{ data: { title: 'Emuladores para Android: lista 2026', permalink: '/r/EmulationOnAndroid/comments/1/x/', subreddit: 'EmulationOnAndroid', score: 1500, created_utc: 1760000000 } }] } });
        if (url.includes('tiktok.com/oembed')) return resp({ title: 'GTA SA port en Android 🔥', author_unique_id: 'portmaster', thumbnail_url: 'https://p16.tiktokcdn.com/x.jpg' });
        return resp('', 404);
    };
}

(async () => {
    console.log('nexus buscador');
    await test('DuckDuckGo: decodifica el enlace real, el título y el resumen', () => {
        const r = B.parsearDuckDuckGo(DDG('x'));
        assert.strictEqual(r.length, 2);
        assert.ok(r[0].url.startsWith('https://www.tiktok.com/@port/video/123'));
        assert.strictEqual(r[0].titulo, 'GTA San Andreas port Android');
        assert.strictEqual(r[0].descripcion, 'Así corre el port en Winlator & Mobox');
    });
    await test('YouTube sin clave: lee ytInitialData en orden', () => {
        const r = B.parsearYouTube(YT);
        assert.deepStrictEqual(r.map(x => x.id), ['abc123', 'zzz999']);
        assert.strictEqual(r[0].autor, 'CanalX'); assert.strictEqual(r[0].duracion, '12:01'); assert.strictEqual(r[0].vistasN, 1234567);
    });
    await test('limpia utm/tracking y reconoce la red de cada enlace', () => {
        assert.strictEqual(B.limpiarUrl('https://www.youtube.com/watch?v=a&utm_source=x&si=y'), 'https://www.youtube.com/watch?v=a');
        assert.strictEqual(B.limpiarUrl('javascript:alert(1)'), null);
        assert.strictEqual(B.fuenteDe('https://m.youtube.com/watch?v=1'), 'youtube');
        assert.strictEqual(B.fuenteDe('https://vm.tiktok.com/x'), 'tiktok');
        assert.strictEqual(B.fuenteDe('https://fb.watch/x'), 'facebook');
        assert.strictEqual(B.fuenteDe('https://upgames.games'), 'web');
    });
    await test('sin IA amplía la consulta por reglas (es + en)', () => {
        const c = B.consultasPorReglas('busca juegos port o emuladores para Android');
        assert.ok(c[0].startsWith('juegos port'));
        assert.ok(c.length >= 2 && c.length <= 3);
        assert.ok(c.some(x => /apk|PC game port|emulator/.test(x)));
    });
    await test('marca lo que ya está en UpGames y no confunde títulos distintos', () => {
        const cat = [{ id: '1', titulo: 'GTA San Andreas mod', categoria: 'Mod', p: new Set(B.palabras('GTA San Andreas mod')) }, { id: '2', titulo: 'Silent Hill 2', categoria: 'Juego', p: new Set(B.palabras('Silent Hill 2')) }];
        assert.strictEqual(B.coincidenciaUpGames({ titulo: 'GTA San Andreas port Android' }, cat)?.id, '1');
        assert.strictEqual(B.coincidenciaUpGames({ titulo: 'Mejor emulador PS2 Android' }, cat), null);
    });
    await test('búsqueda completa: varias redes, sin duplicados, ordenada y con oEmbed de TikTok', async () => {
        const log = [];
        const Juego = { find: () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [{ _id: 'j1', title: 'GTA San Andreas mod', category: 'Mod' }] }) }) }) }) };
        const r = await B.buscar({ consulta: 'juegos port o emuladores para Android', fuentes: ['web', 'youtube', 'tiktok', 'reddit'], periodo: 'mes', idioma: 'es' }, { fetch: fetchFalso(log), Juego });
        const urls = r.resultados.map(x => x.url);
        assert.strictEqual(new Set(urls).size, urls.length, 'sin duplicados');
        assert.strictEqual(urls.filter(u => u.includes('watch?v=abc123')).length, 1, 'el mismo video de web y YouTube se une');
        const tt = r.resultados.find(x => x.fuente === 'tiktok');
        assert.ok(tt && tt.autor === '@portmaster' && tt.miniatura.startsWith('https://'), 'TikTok enriquecido');
        assert.ok(!tt.url.includes('is_from_webapp'), 'sin parámetros de rastreo');
        assert.ok(tt.enUpGames && tt.enUpGames.id === 'j1', 'detecta que ya está en UpGames');
        assert.ok(r.resultados.some(x => x.fuente === 'reddit'));
        assert.ok(r.porFuente.youtube.ok && r.porFuente.reddit.ok && r.porFuente.tiktok.ok);
        assert.ok(log.some(u => u.includes('site%3Atiktok.com') || u.includes('site:tiktok.com')), 'TikTok se busca con site:');
        assert.ok(log.some(u => u.includes('df=m')), 'aplica el periodo');
        for (let i = 1; i < r.resultados.length; i++) assert.ok(r.resultados[i - 1].relevancia >= r.resultados[i].relevancia, 'ordenado');
        assert.ok(r.resumen.length > 10);
        // Segunda vez: sale de la caché sin pedir nada
        const antes = log.length;
        const r2 = await B.buscar({ consulta: 'juegos port o emuladores para Android', fuentes: ['web', 'youtube', 'tiktok', 'reddit'], periodo: 'mes', idioma: 'es' }, { fetch: fetchFalso(log), Juego });
        assert.strictEqual(r2.cache, true); assert.strictEqual(log.length, antes);
    });
    await test('una red caída no rompe la búsqueda', async () => {
        const f = async url => { if (url.includes('reddit')) throw new Error('ECONNRESET'); if (url.includes('duckduckgo')) return resp(DDG('y')); return resp('', 500); };
        const r = await B.buscar({ consulta: 'mods para project zomboid', fuentes: ['web', 'reddit'] }, { fetch: f });
        assert.ok(r.porFuente.web.ok);
        assert.ok(r.resultados.length > 0);
    });
    await test('valida la consulta y las redes', async () => {
        await assert.rejects(() => B.buscar({ consulta: 'a' }, { fetch: fetchFalso() }), /3 letras/);
        await assert.rejects(() => B.buscar({ consulta: 'emuladores', fuentes: ['myspace'] }, { fetch: fetchFalso() }), /al menos una red/);
    });

    console.log(`\nnexus buscador: ${passed} pruebas OK`);
})();
