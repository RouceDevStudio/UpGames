// ========================================
// 🔍 BÚSQUEDA AVANZADA - UPGAMES
// ========================================
//
// Búsqueda tipo Elasticsearch pero usando MongoDB (sin dependencias extras).
// Features:
//   - Búsqueda full-text con scoring de relevancia
//   - Búsqueda fuzzy (tolera typos)
//   - Filtros: categoría, creador, rating mínimo, rango de descargas, fecha
//   - Autocomplete (sugerencias mientras escribes)
//   - Facets (contadores por categoría/creador para UI)
//   - Ordenamiento: relevancia, popular, reciente, más descargado
//
// Uso:
//   const results = await search.buscar({
//       q: 'gta san',
//       categoria: 'Juegos',
//       minLikes: 10,
//       orden: 'popular',
//       limit: 20
//   });
// ========================================

const mongoose = require('mongoose');
const logger   = require('./logger');
const cache    = require('./cache');

function getModels() {
    return {
        Juego:   mongoose.model('Juego'),
        Usuario: mongoose.model('Usuario'),
    };
}

// ======================================================================
// HELPERS
// ======================================================================

/**
 * Normaliza query: lowercase, sin acentos, sin chars especiales (pero conserva espacios).
 */
function normalize(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Quita acentos
        .replace(/[^a-z0-9\s]/g, ' ')     // Solo alfanum + espacios
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Escapa caracteres especiales de RegExp.
 */
function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Construye un regex fuzzy simple que tolera un typo cada 4 chars.
 * Ejemplo: "gta" → /g.?t.?a/i
 */
function buildFuzzyRegex(term) {
    const safe = escapeRegExp(term);
    if (safe.length < 4) return new RegExp(safe, 'i');
    const chars = safe.split('');
    return new RegExp(chars.join('.?'), 'i');
}

// ======================================================================
// BÚSQUEDA PRINCIPAL
// ======================================================================

/**
 * Búsqueda avanzada con filtros y scoring.
 *
 * @param {Object} opts
 * @param {string} opts.q              Query de búsqueda (opcional)
 * @param {string} opts.categoria      Filtrar por categoría
 * @param {string} opts.usuario        Filtrar por creador
 * @param {number} opts.minLikes       Mínimo de likes
 * @param {number} opts.minDescargas   Mínimo de descargas
 * @param {string} opts.desde          Fecha mínima (ISO)
 * @param {string} opts.hasta          Fecha máxima (ISO)
 * @param {string[]} opts.tags         Tags a incluir
 * @param {string} opts.orden          'relevancia' | 'popular' | 'reciente' | 'descargas' | 'likes'
 * @param {number} opts.page           Página (empieza en 1)
 * @param {number} opts.limit          Resultados por página (max 50)
 * @returns {Promise<{items, total, page, pages, facets}>}
 */
async function buscar(opts = {}) {
    const {
        q            = '',
        categoria    = null,
        usuario      = null,
        minLikes     = 0,
        minDescargas = 0,
        desde        = null,
        hasta        = null,
        tags         = null,
        orden        = 'relevancia',
        page         = 1,
        limit        = 20,
        incluirFacets = false
    } = opts;

    const { Juego } = getModels();

    // Cache key: si es búsqueda común y sin filtros personalizados, cachear 60s
    const cacheKey = `search:${JSON.stringify(opts)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    // ========== CONSTRUIR FILTRO BASE ==========
    const filtro = {
        status: 'aprobado',
        linkStatus: { $in: ['online', 'revision'] }
    };

    if (categoria && categoria !== 'Todo') filtro.category = categoria;
    if (usuario) filtro.usuario = usuario;
    if (minLikes > 0) filtro.likesCount = { $gte: minLikes };
    if (minDescargas > 0) filtro.descargasEfectivas = { $gte: minDescargas };

    if (desde || hasta) {
        filtro.createdAt = {};
        if (desde) filtro.createdAt.$gte = new Date(desde);
        if (hasta) filtro.createdAt.$lte = new Date(hasta);
    }

    if (Array.isArray(tags) && tags.length > 0) {
        filtro.tags = { $in: tags };
    }

    // ========== BÚSQUEDA POR TEXTO ==========
    const qNorm = normalize(q);
    const tieneQuery = qNorm.length > 0;

    let pipeline = [];

    if (tieneQuery) {
        // Términos individuales para scoring de relevancia
        const terminos = qNorm.split(' ').filter(t => t.length >= 2);

        const orConditions = [];
        for (const t of terminos) {
            const regex = buildFuzzyRegex(t);
            orConditions.push({ title: { $regex: regex } });
            orConditions.push({ description: { $regex: regex } });
            orConditions.push({ category: { $regex: regex } });
            orConditions.push({ usuario: { $regex: regex } });
            orConditions.push({ tags: { $in: [regex] } });
        }

        filtro.$or = orConditions;

        pipeline.push({ $match: filtro });

        // Scoring: peso por campo donde matchea
        pipeline.push({
            $addFields: {
                _relevance: {
                    $add: terminos.flatMap(t => {
                        const r = escapeRegExp(t);
                        return [
                            // Match exacto en título pesa más
                            { $cond: [{ $regexMatch: { input: { $ifNull: ['$title', ''] }, regex: r, options: 'i' } }, 100, 0] },
                            // Match en categoría
                            { $cond: [{ $regexMatch: { input: { $ifNull: ['$category', ''] }, regex: r, options: 'i' } }, 40, 0] },
                            // Match en usuario/creador
                            { $cond: [{ $regexMatch: { input: { $ifNull: ['$usuario', ''] }, regex: r, options: 'i' } }, 30, 0] },
                            // Match en descripción
                            { $cond: [{ $regexMatch: { input: { $ifNull: ['$description', ''] }, regex: r, options: 'i' } }, 15, 0] }
                        ];
                    })
                }
            }
        });
    } else {
        pipeline.push({ $match: filtro });
    }

    // ========== ORDENAMIENTO ==========
    let sortStage;
    switch (orden) {
        case 'popular':
            sortStage = { scoreRecomendacion: -1, descargasEfectivas: -1 };
            break;
        case 'reciente':
            sortStage = { createdAt: -1 };
            break;
        case 'descargas':
            sortStage = { descargasEfectivas: -1 };
            break;
        case 'likes':
            sortStage = { likesCount: -1 };
            break;
        case 'relevancia':
        default:
            sortStage = tieneQuery
                ? { _relevance: -1, scoreRecomendacion: -1 }
                : { scoreRecomendacion: -1, createdAt: -1 };
    }
    pipeline.push({ $sort: sortStage });

    // ========== PAGINACIÓN ==========
    const pageNum  = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 20));
    const skip     = (pageNum - 1) * limitNum;

    // Para saber el total, contamos aparte (más eficiente que $facet cuando hay muchos resultados)
    const totalPromise = Juego.countDocuments(filtro);

    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limitNum });
    pipeline.push({
        $project: {
            title: 1, description: 1, image: 1, images: 1, link: 1,
            category: 1, tags: 1, usuario: 1, reportes: 1, linkStatus: 1,
            descargasEfectivas: 1, likesCount: 1, videoType: 1,
            featuredItemId: 1, extraData: 1, createdAt: 1,
            _relevance: 1
        }
    });

    const [items, total] = await Promise.all([
        Juego.aggregate(pipeline),
        totalPromise
    ]);

    // ========== FACETS (opcional, útil para filtros UI) ==========
    let facets = null;
    if (incluirFacets) {
        facets = await calcularFacets(filtro);
    }

    const resultado = {
        items,
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        limit: limitNum,
        query: q || null,
        orden,
        facets
    };

    cache.set(cacheKey, resultado, 60); // 1 min cache
    return resultado;
}

/**
 * Calcula contadores por categoría y top creadores para UI de filtros.
 */
async function calcularFacets(filtroBase) {
    const { Juego } = getModels();

    // Usamos el filtro SIN categoría ni usuario para que los facets muestren todas las opciones disponibles
    const filtroSinFacet = { ...filtroBase };
    delete filtroSinFacet.category;
    delete filtroSinFacet.usuario;

    const [porCategoria, porCreador] = await Promise.all([
        Juego.aggregate([
            { $match: filtroSinFacet },
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 20 }
        ]),
        Juego.aggregate([
            { $match: filtroSinFacet },
            { $group: { _id: '$usuario', count: { $sum: 1 }, totalDescargas: { $sum: '$descargasEfectivas' } } },
            { $sort: { totalDescargas: -1 } },
            { $limit: 20 }
        ])
    ]);

    return {
        categorias: porCategoria.map(c => ({ categoria: c._id, count: c.count })),
        creadores:  porCreador.map(c => ({ usuario: c._id, count: c.count, totalDescargas: c.totalDescargas }))
    };
}

// ======================================================================
// AUTOCOMPLETE
// ======================================================================

/**
 * Sugerencias mientras escribes. Devuelve títulos, creadores y categorías.
 * Ej: "gta" → ["GTA San Andreas", "GTA V Mods", categoria "Acción", ...]
 */
async function autocomplete(q, limit = 8) {
    const qNorm = normalize(q);
    if (qNorm.length < 2) return { items: [], creadores: [], categorias: [] };

    return cache.remember(`autocomplete:${qNorm}:${limit}`, 120, async () => {
        const { Juego, Usuario } = getModels();
        const regex = new RegExp('^' + escapeRegExp(qNorm), 'i');
        const regexGlobal = new RegExp(escapeRegExp(qNorm), 'i');

        const [items, creadores, categoriasRaw] = await Promise.all([
            // Top items cuyo título empieza con el query
            Juego.find({
                title: { $regex: regex },
                status: 'aprobado',
                linkStatus: { $in: ['online', 'revision'] }
            })
                .select('title image category descargasEfectivas')
                .sort({ descargasEfectivas: -1 })
                .limit(limit)
                .lean(),

            // Creadores cuyo username contiene el query
            Usuario.find({ usuario: { $regex: regexGlobal } })
                .select('usuario avatar verificadoNivel descargasTotales')
                .sort({ descargasTotales: -1 })
                .limit(5)
                .lean(),

            // Categorías únicas que contienen el query
            Juego.aggregate([
                { $match: { status: 'aprobado', category: { $regex: regexGlobal } } },
                { $group: { _id: '$category', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 3 }
            ])
        ]);

        return {
            items: items.map(i => ({
                _id: i._id,
                title: i.title,
                image: i.image,
                category: i.category,
                descargas: i.descargasEfectivas
            })),
            creadores: creadores.map(u => ({
                usuario: u.usuario,
                avatar: u.avatar,
                verificado: u.verificadoNivel > 0,
                descargas: u.descargasTotales
            })),
            categorias: categoriasRaw.map(c => ({ categoria: c._id, count: c.count }))
        };
    });
}

// ======================================================================
// BÚSQUEDAS POPULARES / TRENDING SEARCHES
// ======================================================================

const busquedasRecientes = new Map();
const MAX_BUSQUEDAS = 1000;

/**
 * Registra una búsqueda para estadísticas.
 */
function registrarBusqueda(q) {
    const qNorm = normalize(q);
    if (qNorm.length < 2) return;

    const actual = busquedasRecientes.get(qNorm) || { count: 0, lastSeen: Date.now() };
    actual.count++;
    actual.lastSeen = Date.now();
    busquedasRecientes.set(qNorm, actual);

    // Limpiar si crece mucho
    if (busquedasRecientes.size > MAX_BUSQUEDAS) {
        // Quedarse solo con las 500 más recientes
        const entries = Array.from(busquedasRecientes.entries())
            .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
            .slice(0, 500);
        busquedasRecientes.clear();
        for (const [k, v] of entries) busquedasRecientes.set(k, v);
    }
}

/**
 * Devuelve las búsquedas más populares de la última hora.
 */
function busquedasPopulares(limit = 10) {
    const haceUnaHora = Date.now() - 60 * 60 * 1000;
    return Array.from(busquedasRecientes.entries())
        .filter(([_, v]) => v.lastSeen >= haceUnaHora)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, limit)
        .map(([q, v]) => ({ query: q, count: v.count }));
}

module.exports = {
    buscar,
    autocomplete,
    registrarBusqueda,
    busquedasPopulares,
    calcularFacets,
    normalize
};
