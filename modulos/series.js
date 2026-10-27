/**
 * ══════════════════════════════════════════════════════════════════
 *  series.js — Publicaciones divididas en partes
 *
 *  Un mod de 100 GB se sube como "GTA 5 mod rendimiento parte 1",
 *  "… parte 2", etc. Aquí se reconoce el número de parte en el título y
 *  se agrupan en una SERIE (mismo autor + mismo título base):
 *    • El catálogo muestra solo la primera parte, con "📁 N partes".
 *    • El detalle y el puente de descarga van desbloqueando la siguiente
 *      parte; cada parte sigue siendo una publicación propia, así que
 *      cada descarga cuenta para las ganancias del autor.
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const ROMANOS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

// Orden: primero los formatos más explícitos
const PATRONES = [
    // "parte 2 de 10", "part 2/10", "pt. 3", "parte II", "disco 2", "cd 3", "vol 2"
    /(?:^|[\s\-–—_:|([])(?:parte|part|pt|disco|disc|cd|vol(?:umen|ume)?)\.?\s*#?\s*(\d{1,3}|[ivx]{1,4})(?:\s*(?:de|of|\/)\s*(\d{1,3}))?(?=$|[\s\-–—_:|)\].,])/i,
    // "(2/10)", "[2 de 10]", "2/10" al final
    /[([]\s*(\d{1,3})\s*(?:\/|de|of)\s*(\d{1,3})\s*[)\]]/i,
    // "p2" / "p.2" al final
    /(?:^|[\s\-–—_])p\.?\s?(\d{1,3})\s*$/i,
];

const normalizar = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Detecta la parte en un título.
 * @returns {{ base: string, parte: number, total: number|null } | null}
 */
function detectarParte(titulo) {
    const t = String(titulo || '');
    for (const re of PATRONES) {
        const m = re.exec(t);
        if (!m) continue;
        const raw = String(m[1]).toLowerCase();
        const parte = /^\d+$/.test(raw) ? parseInt(raw, 10) : ROMANOS[raw];
        if (!parte || parte < 1 || parte > 500) continue;
        const total = m[2] ? parseInt(m[2], 10) : null;
        if (total && total < parte) continue;
        const base = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length))
            .replace(/[\s\-–—_:|([\]),.]+$/g, '').replace(/^[\s\-–—_:|]+/, '').replace(/\s{2,}/g, ' ').trim();
        if (normalizar(base).length < 3) continue;
        return { base, parte, total };
    }
    return null;
}

/** Campo `serie` para guardar en el documento (o null si no es una parte). */
function serieDe(titulo, usuario) {
    const d = detectarParte(titulo);
    if (!d) return null;
    return { clave: `${String(usuario || '').toLowerCase()}::${normalizar(d.base)}`, base: d.base, parte: d.parte, total: d.total };
}

/**
 * Agrupa las series de un listado: deja solo la primera parte de cada serie
 * (la de número menor en TODO el catálogo visible, no solo en esta página)
 * y le añade `serieInfo`. Las series de una sola parte se muestran normal.
 */
async function colapsar(items, Juego, filtroVisible) {
    const claves = [...new Set(items.filter(i => i.serie?.clave).map(i => i.serie.clave))];
    if (!claves.length) return items;
    const grupos = await Juego.aggregate([
        { $match: { ...filtroVisible, 'serie.clave': { $in: claves } } },
        { $sort: { 'serie.parte': 1, createdAt: 1 } },
        { $group: { _id: '$serie.clave', primero: { $first: '$_id' }, partes: { $sum: 1 }, descargas: { $sum: '$descargasEfectivas' }, maxParte: { $max: '$serie.parte' } } },
    ]);
    const porClave = new Map(grupos.map(g => [g._id, g]));
    const faltan = grupos.filter(g => g.partes > 1 && !items.some(i => String(i._id) === String(g.primero))).map(g => g.primero);
    const extra = faltan.length ? await Juego.find({ _id: { $in: faltan } }).lean() : [];
    const docs = new Map([...items, ...extra].map(i => [String(i._id), i]));

    const vistos = new Set(), out = [];
    for (const it of items) {
        const g = it.serie?.clave && porClave.get(it.serie.clave);
        if (!g || g.partes < 2) { out.push(it); continue; }
        if (vistos.has(g._id)) continue;
        vistos.add(g._id);
        const rep = docs.get(String(g.primero)) || it;
        out.push({ ...rep, serieInfo: { partes: g.partes, descargas: g.descargas, base: rep.serie?.base || '', maxParte: g.maxParte } });
    }
    return out;
}

module.exports = { detectarParte, serieDe, colapsar, normalizar };
