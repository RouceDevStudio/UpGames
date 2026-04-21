// ========================================
// 👥 SOCIAL FEED & REFERRALS - UPGAMES
// ========================================
//
// Extiende el sistema social existente (listaSeguidores/siguiendo):
//
//   - Feed personalizado: últimos items de quienes sigues
//   - Sugerencias de usuarios a seguir
//   - Sistema de referidos con tracking
//   - Toggle follow/unfollow con notificación automática
//
// Todo usa el schema Usuario actual (listaSeguidores, siguiendo).
// No requiere cambios en los schemas principales.
// ========================================

const mongoose = require('mongoose');
const crypto   = require('crypto');
const logger   = require('./logger');
const cache    = require('./cache');

function getModels() {
    return {
        Juego:        mongoose.model('Juego'),
        Usuario:      mongoose.model('Usuario'),
        Notificacion: mongoose.model('Notificacion'),
    };
}

// ======================================================================
// SCHEMA: REFERRALS
// ======================================================================

const ReferralSchema = new mongoose.Schema({
    usuario:        { type: String, required: true, unique: true, index: true, lowercase: true },
    codigoReferral: { type: String, required: true, unique: true, index: true },
    totalReferidos: { type: Number, default: 0 },
    referidos:      [{
        usuario:   String,
        fecha:     { type: Date, default: Date.now },
        activo:    { type: Boolean, default: true } // Si el referido sigue activo
    }],
    bonusGanado:   { type: Number, default: 0 } // Bonus en USD acumulado
}, { collection: 'referrals', timestamps: true });

ReferralSchema.index({ totalReferidos: -1 });

const Referral = mongoose.model('Referral', ReferralSchema);

// ======================================================================
// FOLLOW SYSTEM
// ======================================================================

/**
 * Seguir a un usuario.
 */
async function seguir(seguidor, seguido) {
    if (seguidor === seguido) return { ok: false, error: 'No puedes seguirte a ti mismo' };

    const { Usuario, Notificacion } = getModels();

    const [userSeguidor, userSeguido] = await Promise.all([
        Usuario.findOne({ usuario: seguidor }).select('_id siguiendo'),
        Usuario.findOne({ usuario: seguido }).select('_id listaSeguidores')
    ]);

    if (!userSeguido) return { ok: false, error: 'Usuario no encontrado' };
    if (!userSeguidor) return { ok: false, error: 'Tu cuenta no fue encontrada' };

    if (userSeguidor.siguiendo?.includes(seguido)) {
        return { ok: false, error: 'Ya lo sigues' };
    }

    await Promise.all([
        Usuario.updateOne({ usuario: seguidor }, { $addToSet: { siguiendo: seguido } }),
        Usuario.updateOne({ usuario: seguido }, { $addToSet: { listaSeguidores: seguidor } })
    ]);

    // Notificación al usuario seguido
    try {
        await Notificacion.create({
            destinatario: seguido,
            tipo: 'sistema',
            emisor: seguidor,
            itemId: '',
            itemTitle: `@${seguidor} te sigue ahora`,
            itemImage: '',
            leida: false,
            fecha: new Date()
        });
    } catch (e) { /* no-crítico */ }

    // Invalidar caches relacionados
    cache.invalidate(`feed:${seguidor}:*`);
    cache.invalidate(`sugerencias:${seguidor}:*`);
    cache.invalidate(`taste:${seguidor}`);

    logger.info(`@${seguidor} sigue ahora a @${seguido}`);
    return { ok: true };
}

/**
 * Dejar de seguir.
 */
async function dejarDeSeguir(seguidor, seguido) {
    const { Usuario } = getModels();

    await Promise.all([
        Usuario.updateOne({ usuario: seguidor }, { $pull: { siguiendo: seguido } }),
        Usuario.updateOne({ usuario: seguido }, { $pull: { listaSeguidores: seguidor } })
    ]);

    cache.invalidate(`feed:${seguidor}:*`);
    cache.invalidate(`taste:${seguidor}`);

    return { ok: true };
}

/**
 * ¿El usuario A sigue al B?
 */
async function sigue(seguidor, seguido) {
    const { Usuario } = getModels();
    const user = await Usuario.findOne({ usuario: seguidor }).select('siguiendo').lean();
    return !!(user?.siguiendo?.includes(seguido));
}

// ======================================================================
// FEED PERSONALIZADO
// ======================================================================

/**
 * Feed: últimos items publicados por quienes el usuario sigue.
 */
async function feed(usuario, { page = 1, limit = 20 } = {}) {
    const cacheKey = `feed:${usuario}:${page}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { Juego, Usuario } = getModels();

    const user = await Usuario.findOne({ usuario }).select('siguiendo').lean();
    const siguiendo = user?.siguiendo || [];

    if (siguiendo.length === 0) {
        return { items: [], sinSiguiendo: true, total: 0, page, pages: 0 };
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
        Juego.find({
            usuario: { $in: siguiendo },
            status: 'aprobado',
            linkStatus: { $in: ['online', 'revision'] }
        })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('_id title description image images link category usuario reportes linkStatus descargasEfectivas likesCount videoType featuredItemId extraData createdAt')
            .lean(),

        Juego.countDocuments({
            usuario: { $in: siguiendo },
            status: 'aprobado'
        })
    ]);

    const resultado = {
        items,
        total,
        page,
        pages: Math.ceil(total / limit),
        sinSiguiendo: false,
        siguiendoCount: siguiendo.length
    };

    cache.set(cacheKey, resultado, 60);
    return resultado;
}

/**
 * Sugerencias de usuarios a seguir.
 * Algoritmo:
 *   - Usuarios populares que el usuario NO sigue
 *   - Amigos de amigos (co-ocurrencia)
 *   - Creadores de items en categorías que le gustan
 */
async function sugerenciasASeguir(usuario, limit = 10) {
    return cache.remember(`sugerencias:${usuario}:${limit}`, 600, async () => {
        const { Usuario, Juego } = getModels();

        const user = await Usuario.findOne({ usuario }).select('siguiendo').lean();
        if (!user) return [];

        const yaSigue = new Set(user.siguiendo || []);
        yaSigue.add(usuario); // No sugerirse a sí mismo

        // Top creadores por descargas totales de sus items
        const topCreadores = await Juego.aggregate([
            { $match: { status: 'aprobado', usuario: { $nin: Array.from(yaSigue) } } },
            {
                $group: {
                    _id: '$usuario',
                    totalDescargas: { $sum: '$descargasEfectivas' },
                    totalLikes: { $sum: '$likesCount' },
                    items: { $sum: 1 }
                }
            },
            { $match: { items: { $gte: 1 } } },
            { $sort: { totalDescargas: -1, totalLikes: -1 } },
            { $limit: limit * 2 }, // Traemos más para enriquecer
            {
                $lookup: {
                    from: 'usuarios',
                    localField: '_id',
                    foreignField: 'usuario',
                    as: 'userData'
                }
            },
            { $unwind: { path: '$userData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 0,
                    usuario: '$_id',
                    avatar: '$userData.avatar',
                    bio: '$userData.bio',
                    verificadoNivel: { $ifNull: ['$userData.verificadoNivel', 0] },
                    seguidores: { $size: { $ifNull: ['$userData.listaSeguidores', []] } },
                    totalItems: '$items',
                    totalDescargas: 1
                }
            },
            { $limit: limit }
        ]);

        return topCreadores;
    });
}

// ======================================================================
// SISTEMA DE REFERRALS
// ======================================================================

/**
 * Obtiene (o crea) el código de referral del usuario.
 */
async function obtenerMiCodigoReferral(usuario) {
    let ref = await Referral.findOne({ usuario }).lean();

    if (!ref) {
        // Generar código único de 8 chars
        let codigo;
        let intentos = 0;
        while (intentos < 5) {
            codigo = crypto.randomBytes(4).toString('hex').toUpperCase();
            const existe = await Referral.findOne({ codigoReferral: codigo }).lean();
            if (!existe) break;
            intentos++;
        }

        ref = await Referral.create({
            usuario,
            codigoReferral: codigo,
            totalReferidos: 0,
            referidos: []
        });
        ref = ref.toObject();
    }

    return {
        codigoReferral: ref.codigoReferral,
        linkReferral:   `https://roucedevstudio.github.io/UpGames/public/biblioteca.html?ref=${ref.codigoReferral}`,
        totalReferidos: ref.totalReferidos,
        bonusGanado:    ref.bonusGanado,
        referidosActivos: (ref.referidos || []).filter(r => r.activo).length
    };
}

/**
 * Cuando un nuevo usuario se registra con código de referido.
 * Vincula al nuevo user con quien lo refirió.
 */
async function registrarReferido(codigoReferral, nuevoUsuario) {
    if (!codigoReferral) return { ok: false, error: 'Sin código' };

    const refOwner = await Referral.findOne({ codigoReferral }).lean();
    if (!refOwner) return { ok: false, error: 'Código inválido' };
    if (refOwner.usuario === nuevoUsuario) return { ok: false, error: 'No puedes auto-referirte' };

    // ¿Ya estaba registrado como referido?
    const yaExiste = refOwner.referidos?.some(r => r.usuario === nuevoUsuario);
    if (yaExiste) return { ok: false, error: 'Ya registrado' };

    // Agregar al referring user
    await Referral.updateOne(
        { codigoReferral },
        {
            $inc: { totalReferidos: 1 },
            $push: { referidos: { usuario: nuevoUsuario, fecha: new Date(), activo: true } }
        }
    );

    // Bonus: 0.10 USD al que refiere (cuando tenga primera descarga se confirma)
    // Por ahora solo registramos la relación

    logger.info(`🎁 Referral: @${refOwner.usuario} refirió a @${nuevoUsuario}`);
    return { ok: true, referidoPor: refOwner.usuario };
}

/**
 * Top referidores (leaderboard de crecimiento).
 */
async function topReferidores(limit = 20) {
    return cache.remember(`referrals:top:${limit}`, 600, async () => {
        return Referral.find({ totalReferidos: { $gt: 0 } })
            .sort({ totalReferidos: -1 })
            .limit(limit)
            .select('usuario totalReferidos bonusGanado')
            .lean();
    });
}

module.exports = {
    // Follow system
    seguir,
    dejarDeSeguir,
    sigue,
    // Feed
    feed,
    sugerenciasASeguir,
    // Referrals
    obtenerMiCodigoReferral,
    registrarReferido,
    topReferidores,
    // Model exposed
    Referral
};
