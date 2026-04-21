// ========================================
// 🧠 SISTEMA DE RECOMENDACIONES AVANZADO - UPGAMES
// ========================================
//
// Mejora el sistema actual (scoreBase + likesCount) con:
//
//   1. TRENDING: Contenido viral (descargas/likes en últimas 48h)
//   2. PERSONALIZADO: Basado en historial del usuario
//      - Categorías que descarga
//      - Tags que le gustan
//      - Creadores que sigue
//   3. COLABORATIVO: "Usuarios que descargaron X también descargaron Y"
//   4. SIMILAR ITEMS: Contenido parecido al que acabas de ver
//   5. COLD START: Qué mostrar a usuarios nuevos (top trending + variety)
//
// Todo con agregaciones MongoDB para máximo rendimiento.
// ========================================

const mongoose = require('mongoose');
const logger   = require('./logger');
const cache    = require('./cache');

function getModels() {
    return {
        Juego:       mongoose.model('Juego'),
        Usuario:     mongoose.model('Usuario'),
        Favorito:    mongoose.model('Favoritos'),
        Comentario:  mongoose.model('Comentario'),
    };
}

// ======================================================================
// 1. TRENDING: Contenido viral reciente
// ======================================================================

/**
 * Items con más tracción en las últimas 48h.
 * Algoritmo: descargas recientes * 2 + likes recientes + log(total_descargas)
 * Cacheado 5 minutos (trending no cambia cada segundo).
 */
async function getTrending(limit = 20) {
    return cache.remember(`trending:${limit}`, 300, async () => {
        const { Juego } = getModels();
        const hace48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

        const items = await Juego.aggregate([
            {
                $match: {
                    status: 'aprobado',
                    linkStatus: { $in: ['online', 'revision'] },
                    updatedAt: { $gte: hace48h }
                }
            },
            {
                $addFields: {
                    // Score trending: pondera actividad reciente vs total
                    trendingScore: {
                        $add: [
                            { $multiply: ['$descargasEfectivas', 2] },
                            { $multiply: ['$likesCount', 3] },
                            { $ln: { $add: ['$descargasEfectivas', 1] } }
                        ]
                    }
                }
            },
            { $sort: { trendingScore: -1 } },
            { $limit: limit },
            {
                $project: {
                    title: 1, description: 1, image: 1, images: 1, link: 1,
                    category: 1, usuario: 1, reportes: 1, linkStatus: 1,
                    descargasEfectivas: 1, likesCount: 1, videoType: 1,
                    featuredItemId: 1, extraData: 1, trendingScore: 1,
                    createdAt: 1
                }
            }
        ]);

        return items;
    });
}

// ======================================================================
// 2. PERSONALIZADO: Basado en perfil del usuario
// ======================================================================

/**
 * Analiza qué categorías/tags/creadores le gustan al usuario.
 * Devuelve un "perfil de gustos" usado para scoring.
 */
async function getUserTasteProfile(usuario) {
    return cache.remember(`taste:${usuario}`, 600, async () => {
        const { Favorito, Juego, Usuario } = getModels();

        // 1. Favoritos del usuario → qué items le gustan
        const favs = await Favorito.find({ usuario })
            .populate('itemId', 'category tags usuario')
            .lean();

        // 2. Info del usuario (a quién sigue)
        const userData = await Usuario.findOne({ usuario })
            .select('siguiendo')
            .lean();

        const siguiendo = userData?.siguiendo || [];

        // 3. Contar categorías, tags y creadores preferidos
        const categoryCount = {};
        const tagCount = {};
        const creatorCount = {};

        for (const fav of favs) {
            if (!fav.itemId) continue;
            const item = fav.itemId;

            if (item.category) {
                categoryCount[item.category] = (categoryCount[item.category] || 0) + 1;
            }
            if (Array.isArray(item.tags)) {
                for (const tag of item.tags) {
                    tagCount[tag] = (tagCount[tag] || 0) + 1;
                }
            }
            if (item.usuario) {
                creatorCount[item.usuario] = (creatorCount[item.usuario] || 0) + 1;
            }
        }

        // Bonus para creadores seguidos
        for (const seg of siguiendo) {
            creatorCount[seg] = (creatorCount[seg] || 0) + 3;
        }

        return {
            favoriteCategories: Object.entries(categoryCount).sort((a,b) => b[1]-a[1]).slice(0, 5),
            favoriteTags:       Object.entries(tagCount).sort((a,b) => b[1]-a[1]).slice(0, 10),
            favoriteCreators:   Object.entries(creatorCount).sort((a,b) => b[1]-a[1]).slice(0, 10),
            siguiendo,
            totalFavs: favs.length
        };
    });
}

/**
 * Recomendaciones personalizadas para un usuario específico.
 * Algoritmo:
 *   - Boost items en sus categorías preferidas
 *   - Boost items con sus tags preferidos
 *   - Boost items de creadores que sigue
 *   - Excluye items que ya tiene en favoritos
 */
async function getPersonalizedFor(usuario, limit = 20) {
    const { Juego, Favorito } = getModels();

    // Perfil de gustos
    const profile = await getUserTasteProfile(usuario);

    // Si el usuario es nuevo, devolver trending (cold start)
    if (profile.totalFavs === 0 && profile.siguiendo.length === 0) {
        return getTrending(limit);
    }

    // IDs que ya tiene en favoritos (para excluir)
    const favsIds = await Favorito.find({ usuario }).select('itemId').lean();
    const excludeIds = favsIds.map(f => f.itemId).filter(Boolean);

    const preferredCategories = profile.favoriteCategories.map(c => c[0]);
    const preferredTags       = profile.favoriteTags.map(t => t[0]);
    const preferredCreators   = profile.favoriteCreators.map(c => c[0]);

    const items = await Juego.aggregate([
        {
            $match: {
                status: 'aprobado',
                linkStatus: { $in: ['online', 'revision'] },
                _id: { $nin: excludeIds },
                usuario: { $ne: usuario } // No recomendarse a sí mismo
            }
        },
        {
            $addFields: {
                personalScore: {
                    $add: [
                        '$scoreRecomendacion',
                        { $cond: [{ $in: ['$category', preferredCategories] }, 5000, 0] },
                        { $cond: [{ $in: ['$usuario', preferredCreators] }, 8000, 0] },
                        {
                            $multiply: [
                                { $size: { $setIntersection: [{ $ifNull: ['$tags', []] }, preferredTags] } },
                                2000
                            ]
                        }
                    ]
                }
            }
        },
        { $sort: { personalScore: -1, createdAt: -1 } },
        { $limit: limit },
        {
            $project: {
                title: 1, description: 1, image: 1, images: 1, link: 1,
                category: 1, tags: 1, usuario: 1, reportes: 1, linkStatus: 1,
                descargasEfectivas: 1, likesCount: 1, videoType: 1,
                featuredItemId: 1, extraData: 1, personalScore: 1,
                createdAt: 1
            }
        }
    ]);

    return items;
}

// ======================================================================
// 3. COLABORATIVO: "Otros usuarios también descargaron..."
// ======================================================================

/**
 * Dado un item, encuentra qué otros items descargan quienes descargan éste.
 * Muy útil para páginas de detalle de item.
 */
async function getCollaborative(juegoId, limit = 10) {
    return cache.remember(`collab:${juegoId}:${limit}`, 600, async () => {
        const { Favorito } = getModels();

        // Usuarios que tienen este item en favoritos
        const lovers = await Favorito.find({ itemId: juegoId })
            .select('usuario')
            .lean();

        if (lovers.length === 0) return [];

        const usernames = lovers.map(l => l.usuario);

        // Otros items que esos usuarios también tienen en favoritos
        const coOccurrence = await Favorito.aggregate([
            {
                $match: {
                    usuario: { $in: usernames },
                    itemId: { $ne: new mongoose.Types.ObjectId(String(juegoId)) }
                }
            },
            {
                $group: {
                    _id: '$itemId',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: limit },
            {
                $lookup: {
                    from: 'juegos',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'juego'
                }
            },
            { $unwind: '$juego' },
            {
                $match: {
                    'juego.status': 'aprobado',
                    'juego.linkStatus': { $in: ['online', 'revision'] }
                }
            },
            {
                $project: {
                    _id: '$juego._id',
                    title:       '$juego.title',
                    description: '$juego.description',
                    image:       '$juego.image',
                    images:      '$juego.images',
                    link:        '$juego.link',
                    category:    '$juego.category',
                    usuario:     '$juego.usuario',
                    descargasEfectivas: '$juego.descargasEfectivas',
                    likesCount:  '$juego.likesCount',
                    videoType:   '$juego.videoType',
                    coOccurrences: '$count'
                }
            }
        ]);

        return coOccurrence;
    });
}

// ======================================================================
// 4. SIMILAR ITEMS: Contenido parecido
// ======================================================================

/**
 * Items similares por categoría + tags + rango de popularidad.
 */
async function getSimilar(juegoId, limit = 8) {
    return cache.remember(`similar:${juegoId}:${limit}`, 900, async () => {
        const { Juego } = getModels();

        const base = await Juego.findById(juegoId).select('category tags usuario').lean();
        if (!base) return [];

        const items = await Juego.aggregate([
            {
                $match: {
                    _id: { $ne: new mongoose.Types.ObjectId(String(juegoId)) },
                    status: 'aprobado',
                    linkStatus: { $in: ['online', 'revision'] }
                }
            },
            {
                $addFields: {
                    similarityScore: {
                        $add: [
                            { $cond: [{ $eq: ['$category', base.category] }, 100, 0] },
                            { $cond: [{ $eq: ['$usuario', base.usuario] }, 50, 0] },
                            {
                                $multiply: [
                                    { $size: { $setIntersection: [{ $ifNull: ['$tags', []] }, base.tags || []] } },
                                    30
                                ]
                            },
                            { $divide: ['$likesCount', 10] }
                        ]
                    }
                }
            },
            { $match: { similarityScore: { $gt: 0 } } },
            { $sort: { similarityScore: -1 } },
            { $limit: limit },
            {
                $project: {
                    title: 1, description: 1, image: 1, images: 1, link: 1,
                    category: 1, usuario: 1, descargasEfectivas: 1,
                    likesCount: 1, videoType: 1, similarityScore: 1
                }
            }
        ]);

        return items;
    });
}

// ======================================================================
// 5. FEED PERSONALIZADO: Mix óptimo
// ======================================================================

/**
 * Feed óptimo para un usuario:
 *   - 60% personalizado
 *   - 25% trending
 *   - 15% discovery (diversidad, categorías que NO suele ver)
 */
async function getFeed(usuario, limit = 30) {
    try {
        const [personalized, trending] = await Promise.all([
            getPersonalizedFor(usuario, Math.ceil(limit * 0.6)),
            getTrending(Math.ceil(limit * 0.25))
        ]);

        // Discovery: categorías diferentes a las que el usuario suele ver
        const profile = await getUserTasteProfile(usuario);
        const conocidas = new Set(profile.favoriteCategories.map(c => c[0]));
        const { Juego } = getModels();

        const discovery = await Juego.aggregate([
            {
                $match: {
                    status: 'aprobado',
                    linkStatus: { $in: ['online', 'revision'] },
                    category: { $nin: Array.from(conocidas) }
                }
            },
            { $sort: { scoreRecomendacion: -1 } },
            { $limit: Math.ceil(limit * 0.15) },
            {
                $project: {
                    title: 1, description: 1, image: 1, images: 1, link: 1,
                    category: 1, usuario: 1, descargasEfectivas: 1,
                    likesCount: 1, videoType: 1
                }
            }
        ]);

        // Mezclar evitando duplicados por _id
        const seen = new Set();
        const merged = [];
        for (const arr of [personalized, trending, discovery]) {
            for (const item of arr) {
                const idStr = String(item._id);
                if (!seen.has(idStr)) {
                    seen.add(idStr);
                    merged.push(item);
                }
            }
        }

        return merged.slice(0, limit);
    } catch (err) {
        logger.error(`getFeed error: ${err.message}`);
        return getTrending(limit);
    }
}

// ======================================================================
// 6. INVALIDACIÓN DE CACHES
// ======================================================================

/**
 * Llamar tras acciones que afectan recomendaciones:
 *   - Nuevo favorito: invalidateUserCache(usuario)
 *   - Nueva descarga: invalidateItemCache(juegoId)
 *   - Nuevo item: invalidate trending
 */
function invalidateUserCache(usuario) {
    cache.invalidate(`taste:${usuario}`);
}

function invalidateItemCache(juegoId) {
    cache.invalidate(`collab:${juegoId}:*`);
    cache.invalidate(`similar:${juegoId}:*`);
}

function invalidateTrending() {
    cache.invalidate('trending:*');
}

module.exports = {
    getTrending,
    getPersonalizedFor,
    getCollaborative,
    getSimilar,
    getFeed,
    getUserTasteProfile,
    invalidateUserCache,
    invalidateItemCache,
    invalidateTrending
};
