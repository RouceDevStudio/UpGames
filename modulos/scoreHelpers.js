// ========================================
// ⭐ SCORE HELPERS - SISTEMA DE RECOMENDACIÓN OPTIMIZADO
// ========================================
//
// OPTIMIZACIONES vs versión anterior:
//  - calcularScoreRecomendacion: 2 queries → 1 aggregation con $lookup
//  - recalcularScoresUsuario: N queries → 1 aggregation + 1 bulkWrite
//  - recalcularTodosLosScores: 2N queries → 1 aggregation + 1 bulkWrite
//    (para 1000 juegos: de ~2000 queries → 2 operaciones)
// ========================================

const mongoose = require('mongoose');
const logger   = require('./logger');

// ── Lazy-load de modelos para evitar circular deps ──────────────────────────
function getModels() {
    return {
        Juego:   mongoose.model('Juego'),
        Usuario: mongoose.model('Usuario'),
    };
}

// ── Tabla de puntos base por nivel ──────────────────────────────────────────
const NIVEL_BASE = { 0: 0, 1: 10000, 2: 100000, 3: 1000000 };

/**
 * calcularScoreRecomendacion(juegoId)
 *
 * Versión optimizada: resuelve juego + usuario en 1 aggregation con $lookup.
 * La llamada es async pero el caller no necesita awaitar si no le importa el
 * resultado (fire & forget desde /favoritos/add, /favoritos/remove, /items/add).
 */
async function calcularScoreRecomendacion(juegoId) {
    try {
        const { Juego } = getModels();

        const [result] = await Juego.aggregate([
            { $match: { _id: new mongoose.Types.ObjectId(String(juegoId)) } },
            {
                $lookup: {
                    from:         'usuarios',
                    localField:   'usuario',
                    foreignField: 'usuario',
                    as:           '_autor',
                    pipeline: [{ $project: { verificadoNivel: 1, _id: 0 } }]
                }
            },
            {
                $project: {
                    title:         1,
                    likesCount:    1,
                    nivelVerif: { $ifNull: [{ $arrayElemAt: ['$_autor.verificadoNivel', 0] }, 0] }
                }
            }
        ]);

        if (!result) return;

        const scoreBase  = NIVEL_BASE[result.nivelVerif] ?? 0;
        const scoreFinal = scoreBase + (result.likesCount || 0);

        await Juego.findByIdAndUpdate(juegoId, { scoreRecomendacion: scoreFinal });

        logger.info(`Score → "${result.title}" | Nivel ${result.nivelVerif} | Likes ${result.likesCount || 0} | Score ${scoreFinal}`);
    } catch (err) {
        logger.error(`calcularScoreRecomendacion error: ${err.message}`);
    }
}

/**
 * recalcularScoresUsuario(nombreUsuario)
 *
 * Recalcula todos los scores de las publicaciones de un usuario en 2 ops:
 *  1. 1 aggregation para obtener nivel del usuario + likesCount de cada juego
 *  2. 1 bulkWrite para actualizar todos a la vez
 *
 * Usado cuando el nivel de verificación del usuario cambia (JOB 6, panel admin).
 */
async function recalcularScoresUsuario(nombreUsuario) {
    try {
        const { Juego, Usuario } = getModels();

        // Obtener nivel del usuario en 1 query
        const user = await Usuario.findOne({ usuario: nombreUsuario })
            .select('verificadoNivel')
            .lean();

        const nivelVerif = user?.verificadoNivel ?? 0;
        const scoreBase  = NIVEL_BASE[nivelVerif] ?? 0;

        // Obtener todos sus juegos (solo los campos necesarios)
        const juegos = await Juego.find({ usuario: nombreUsuario })
            .select('_id likesCount')
            .lean();

        if (juegos.length === 0) return;

        // bulkWrite: 1 round-trip para actualizar todos
        const ops = juegos.map(j => ({
            updateOne: {
                filter: { _id: j._id },
                update: { $set: { scoreRecomendacion: scoreBase + (j.likesCount || 0) } }
            }
        }));

        await Juego.bulkWrite(ops, { ordered: false });
        logger.info(`recalcularScoresUsuario @${nombreUsuario}: ${juegos.length} publicaciones actualizadas`);
    } catch (err) {
        logger.error(`recalcularScoresUsuario error: ${err.message}`);
    }
}

/**
 * recalcularTodosLosScores()
 *
 * Recalcula el score de TODAS las publicaciones aprobadas.
 * Versión optimizada: 2 queries + 1 bulkWrite (sin importar cuántos juegos haya).
 *
 * Algoritmo:
 *  1. Traer todos los usuarios con su nivel (1 query, solo usuario + nivel)
 *  2. Traer todos los juegos aprobados (1 query, solo _id + usuario + likesCount)
 *  3. Join en memoria (O(n) con Map) → 1 bulkWrite con todos los updates
 */
async function recalcularTodosLosScores() {
    try {
        const { Juego, Usuario } = getModels();

        // 1. Mapa usuario → nivelVerif
        const usuariosRaw = await Usuario.find({})
            .select('usuario verificadoNivel')
            .lean();

        const nivelMap = new Map();
        for (const u of usuariosRaw) {
            nivelMap.set(u.usuario, u.verificadoNivel ?? 0);
        }

        // 2. Juegos aprobados
        const juegos = await Juego.find({ status: 'aprobado' })
            .select('_id usuario likesCount')
            .lean();

        if (juegos.length === 0) {
            logger.info('recalcularTodosLosScores: sin juegos aprobados');
            return;
        }

        // 3. Calcular y acumular ops
        const ops = juegos.map(j => {
            const nivel     = nivelMap.get(j.usuario) ?? 0;
            const scoreBase = NIVEL_BASE[nivel] ?? 0;
            return {
                updateOne: {
                    filter: { _id: j._id },
                    update: { $set: { scoreRecomendacion: scoreBase + (j.likesCount || 0) } }
                }
            };
        });

        // 4. Un solo round-trip a MongoDB
        const resultado = await Juego.bulkWrite(ops, { ordered: false });
        logger.info(`recalcularTodosLosScores: ${resultado.modifiedCount}/${juegos.length} scores actualizados`);
    } catch (err) {
        logger.error(`recalcularTodosLosScores error: ${err.message}`);
    }
}

module.exports = {
    calcularScoreRecomendacion,
    recalcularScoresUsuario,
    recalcularTodosLosScores,
};
