/**
 * Páginas estáticas por publicación (SEO).
 *
 * biblioteca.html?id=… arma el contenido en el navegador: Google tarda en verlo y a veces
 * no lo indexa. Cada día una acción de GitHub (.github/workflows/sitemap.yml) baja la
 * lista de /seo/paginas.json y escribe public/p/<slug>-<id>.html con el título, la imagen,
 * la descripción y los datos estructurados ya listos en el HTML. El botón lleva a la
 * publicación real dentro de UpGames.
 *
 * Lo usan el backend (URL en el sitemap) y scripts/generar-paginas.js (plantilla).
 */
'use strict';

const SITIO = 'https://upgames.games/public';
const esc = v => String(v ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c]));

function slug(t) {
    return String(t || 'publicacion').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'publicacion';
}
const archivo = it => `${slug(it.title)}-${it.id}.html`;
const urlPagina = it => `${SITIO}/p/${archivo(it)}`;

const CAT = { Juego: 'Juego', Mod: 'Mod', Apps: 'App', Software: 'Software', Ajustes: 'Herramienta', Optimizacion: 'Optimización', ROM: 'ROM', Video: 'Video' };
const esImg = u => /^https:\/\//i.test(u || '') && !/\.(mp4|webm|mov|m4v|avi|3gp|3g2|mkv|ogv|mpe?g|wmv|flv)(\?|$)|\/video\/upload\//i.test(u);

/** HTML completo de la página de una publicación. */
function pagina(it) {
    const url = urlPagina(it), app = `${SITIO}/biblioteca.html?id=${it.id}`;
    const cat = CAT[it.category] || it.category || 'Contenido';
    const desc = String(it.description || `${cat} compartido por @${it.usuario} en UpGames.`).replace(/\s+/g, ' ').trim();
    const corta = desc.slice(0, 158) + (desc.length > 158 ? '…' : '');
    const img = esImg(it.image) ? it.image.replace('/upload/', '/upload/w_1200,h_630,c_fill,q_auto,f_jpg/') : `${SITIO}/og-cover.png`;
    const esVideo = it.category === 'Video';
    // Ficha informativa: UpGames indexa metadatos, no aloja archivos (el título no promete "Descargar")
    const titulo = `${it.title} — ${esVideo ? 'Video' : cat} en UpGames`;
    const vistas = (it.vistas || 0) + (esVideo ? it.descargas || 0 : 0);   // videos antiguos guardaban sus vistas en descargas
    const ld = esVideo ? {
        '@context': 'https://schema.org', '@type': 'VideoObject', name: it.title, description: corta, thumbnailUrl: [img], uploadDate: it.fecha,
        url, author: { '@type': 'Person', name: '@' + it.usuario },
        interactionStatistic: { '@type': 'InteractionCounter', interactionType: { '@type': 'WatchAction' }, userInteractionCount: vistas },
    } : {
        '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: it.title, description: corta, image: img, url,
        applicationCategory: ['Juego', 'ROM', 'Mod'].includes(it.category) ? 'GameApplication' : 'UtilitiesApplication',
        operatingSystem: 'Windows, Android', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, author: { '@type': 'Person', name: '@' + it.usuario }, datePublished: it.fecha,
    };
    const migas = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'UpGames', item: `${SITIO}/biblioteca.html` },
        { '@type': 'ListItem', position: 2, name: cat, item: `${SITIO}/biblioteca.html?cat=${encodeURIComponent(it.category || '')}` },
        { '@type': 'ListItem', position: 3, name: it.title, item: url }] };
    const json = o => JSON.stringify(o).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(corta)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="${esVideo ? 'video.other' : 'website'}"><meta property="og:site_name" content="UpGames">
<meta property="og:title" content="${esc(it.title)}"><meta property="og:description" content="${esc(corta)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(it.title)}"><meta name="twitter:image" content="${esc(img)}">
<meta name="theme-color" content="#07080c"><link rel="icon" href="../icons/icon-96.png?v=2">
<script type="application/ld+json">${json(ld)}</script>
<script type="application/ld+json">${json(migas)}</script>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#07080c;color:#e8eaf0;line-height:1.55}
a{color:#32D583}.w{max-width:760px;margin:0 auto;padding:16px}.top{display:flex;align-items:center;justify-content:space-between;padding:6px 0 14px}
.logo{font-weight:900;letter-spacing:2px;font-size:1.2rem;text-decoration:none;color:#fff}.logo span{color:#32D583}
.hero{border-radius:20px;overflow:hidden;background:#11131a;border:1px solid rgba(255,255,255,.07)}.hero img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#1a1d26}
.c{padding:18px}.cat{display:inline-block;padding:3px 10px;border-radius:99px;background:rgba(50,213,131,.12);color:#32D583;font-size:.75rem;font-weight:800}
h1{margin:10px 0 6px;font-size:1.6rem;line-height:1.25}.meta{color:#9aa1af;font-size:.88rem}.st{display:flex;gap:16px;margin:12px 0;color:#c9ced8;font-size:.9rem}
.btn{display:block;text-align:center;margin:16px 0 8px;padding:15px;border-radius:14px;background:linear-gradient(135deg,#32D583,#5AC8FA);color:#06210f;font-weight:900;text-decoration:none;font-size:1.05rem}
.desc{white-space:pre-line;color:#c9ced8}.pie{margin:26px 0 10px;color:#6c7180;font-size:.8rem;text-align:center}
</style></head>
<body><div class="w">
<div class="top"><a class="logo" href="../biblioteca.html"><span>UP</span>GAMES</a><a href="../biblioteca.html">Explorar</a></div>
<article class="hero">
${esImg(it.image) ? `<img src="${esc(it.image.replace('/upload/', '/upload/w_960,q_auto,f_auto/'))}" alt="${esc(it.title)}" width="960" height="540">` : ''}
<div class="c"><span class="cat">${esc(cat)}</span>
<h1>${esc(it.title)}</h1>
<div class="meta">Publicado por <a href="../perfil-publico.html?usuario=${encodeURIComponent(it.usuario)}">@${esc(it.usuario)}</a> · ${esc(new Date(it.fecha).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }))}</div>
<div class="st"><span>${esVideo ? `👁️ ${vistas.toLocaleString('es-CO')} vistas` : `⬇️ ${Number(it.descargas || 0).toLocaleString('es-CO')} descargas efectivas`}</span><span>❤️ ${Number(it.likes || 0).toLocaleString('es-CO')}</span></div>
<a class="btn" href="${esc(app)}">${esVideo ? '▶ Ver el video en UpGames' : 'Ver la ficha completa en UpGames'}</a>
<p class="desc">${esc(desc.slice(0, 3000))}</p>
</div></article>
<p class="pie">UpGames · descargas, videos, lives, red social e IA en un solo lugar · <a href="../terminos_condiciones.html">Términos</a></p>
</div></body></html>
`;
}

module.exports = { SITIO, slug, archivo, urlPagina, pagina };
