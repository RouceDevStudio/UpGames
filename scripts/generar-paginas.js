#!/usr/bin/env node
/**
 * Escribe public/p/<slug>-<id>.html para cada publicación aprobada (ver modulos/seo.js).
 * Lo corre a diario .github/workflows/sitemap.yml. Borra las páginas de publicaciones
 * que ya no están (eliminadas o rechazadas) para no dejar páginas huérfanas indexadas.
 *
 *   node scripts/generar-paginas.js [archivo.json | URL]
 */
'use strict';
const fs = require('fs'), path = require('path');
const Seo = require('../modulos/seo');

(async () => {
    const fuente = process.argv[2] || 'https://upgames-production.up.railway.app/seo/paginas.json';
    const data = /^https?:/.test(fuente) ? await (await fetch(fuente)).json() : JSON.parse(fs.readFileSync(fuente, 'utf8'));
    if (!data?.success || !Array.isArray(data.items)) throw new Error('Respuesta inválida del backend');
    const dir = path.join(__dirname, '..', 'public', 'p');
    fs.mkdirSync(dir, { recursive: true });
    const quedan = new Set();
    for (const it of data.items) {
        if (!/^[a-f\d]{24}$/i.test(it.id) || !it.title) continue;
        const f = Seo.archivo(it); quedan.add(f);
        const html = Seo.pagina(it), ruta = path.join(dir, f);
        if (!fs.existsSync(ruta) || fs.readFileSync(ruta, 'utf8') !== html) fs.writeFileSync(ruta, html);
    }
    let borradas = 0;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.html') && !quedan.has(f)) { fs.unlinkSync(path.join(dir, f)); borradas++; }
    console.log(`Páginas: ${quedan.size} · borradas: ${borradas}`);
})().catch(e => { console.error(e.message); process.exit(1); });
