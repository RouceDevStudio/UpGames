// ========================================
// 🎮 GAMIFICACIÓN - UPGAMES
// ========================================
//
// Sistema completo de engagement:
//   - XP y niveles (1-100)
//   - Badges/Achievements desbloqueables
//   - Leaderboards globales
//   - Racha diaria (streak)
//   - Misiones diarias/semanales
//
// Todo almacenado en Mongoose. Integra con el esquema Usuario existente
// usando una collection separada para no modificar el schema original.
// ========================================

const mongoose = require('mongoose');
const logger   = require('./logger');
const cache    = require('./cache');

// ======================================================================
// SCHEMAS
// ======================================================================

const GamificacionSchema = new mongoose.Schema({
    usuario:       { type: String, required: true, unique: true, index: true, lowercase: true },
    xp:            { type: Number, default: 0, min: 0 },
    nivel:         { type: Number, default: 1, min: 1, max: 100 },
    badges:        { type: [String], default: [] },
    rachaActual:   { type: Number, default: 0 },
    rachaMaxima:   { type: Number, default: 0 },
    ultimoLogin:   { type: Date, default: null },
    misionesCompletadas: { type: [String], default: [] },
    stats: {
        totalDescargas:   { type: Number, default: 0 },
        totalUploads:     { type: Number, default: 0 },
        totalComentarios: { type: Number, default: 0 },
        totalFavoritos:   { type: Number, default: 0 },
        totalSeguidores:  { type: Number, default: 0 },
        totalGanado:      { type: Number, default: 0 }
    }
}, { collection: 'gamificacion', timestamps: true });

GamificacionSchema.index({ xp: -1 });
GamificacionSchema.index({ nivel: -1 });
GamificacionSchema.index({ 'stats.totalDescargas': -1 });

const Gamificacion = mongoose.model('Gamificacion', GamificacionSchema);

// ======================================================================
// CATÁLOGO DE BADGES
// ======================================================================

const BADGES = {
    // Primeros pasos
    NEWBIE:        { id: 'NEWBIE',        emoji: '👋', titulo: 'Bienvenido',          descripcion: 'Te registraste en UpGames',               xp: 50 },
    FIRST_DL:      { id: 'FIRST_DL',      emoji: '📥', titulo: 'Primera descarga',   descripcion: 'Descargaste tu primer item',              xp: 100 },
    FIRST_UPLOAD:  { id: 'FIRST_UPLOAD',  emoji: '📤', titulo: 'Creator',             descripcion: 'Subiste tu primer contenido',             xp: 200 },
    FIRST_FAV:     { id: 'FIRST_FAV',     emoji: '❤️', titulo: 'Coleccionista',       descripcion: 'Marcaste tu primer favorito',            xp: 50 },
    FIRST_COMMENT: { id: 'FIRST_COMMENT', emoji: '💬', titulo: 'Comunicador',         descripcion: 'Dejaste tu primer comentario',           xp: 75 },

    // Descargas
    GAMER_10:   { id: 'GAMER_10',   emoji: '🎮', titulo: 'Gamer',           descripcion: 'Descargaste 10 items',                     xp: 200 },
    GAMER_50:   { id: 'GAMER_50',   emoji: '🕹️', titulo: 'Hardcore Gamer',   descripcion: 'Descargaste 50 items',                     xp: 500 },
    GAMER_100:  { id: 'GAMER_100',  emoji: '👾', titulo: 'Gamer Supremo',   descripcion: 'Descargaste 100 items',                   xp: 1000 },
    GAMER_500:  { id: 'GAMER_500',  emoji: '💎', titulo: 'Gamer Legendario', descripcion: 'Descargaste 500 items',                   xp: 3000 },

    // Creator
    CREATOR_5:     { id: 'CREATOR_5',     emoji: '⭐', titulo: 'Creator Activo',       descripcion: 'Subiste 5 items',                    xp: 300 },
    CREATOR_25:    { id: 'CREATOR_25',    emoji: '🌟', titulo: 'Creator Popular',      descripcion: 'Subiste 25 items',                   xp: 800 },
    CREATOR_100:   { id: 'CREATOR_100',   emoji: '💫', titulo: 'Creator Legendario',   descripcion: 'Subiste 100 items',                  xp: 2500 },
    VIRAL_100:     { id: 'VIRAL_100',     emoji: '🔥', titulo: 'Viral',                descripcion: 'Un item tuyo alcanzó 100 descargas', xp: 500 },
    VIRAL_1000:    { id: 'VIRAL_1000',    emoji: '🚀', titulo: 'Mega Viral',           descripcion: 'Un item tuyo alcanzó 1000 descargas', xp: 2000 },

    // Sociales
    FOLLOWED_10:   { id: 'FOLLOWED_10',   emoji: '👥', titulo: 'Influencer',           descripcion: 'Tienes 10 seguidores',               xp: 300 },
    FOLLOWED_100:  { id: 'FOLLOWED_100',  emoji: '🎤', titulo: 'Mega Influencer',      descripcion: 'Tienes 100 seguidores',             xp: 1500 },
    COMMENTATOR:   { id: 'COMMENTATOR',   emoji: '📝', titulo: 'Crítico',              descripcion: 'Dejaste 10 comentarios',             xp: 300 },

    // Economía
    FIRST_PAYOUT:  { id: 'FIRST_PAYOUT',  emoji: '💵', titulo: 'Primer Pago',          descripcion: 'Retiraste por primera vez',          xp: 500 },
    BIG_EARNER:    { id: 'BIG_EARNER',    emoji: '💰', titulo: 'Buen Creador',         descripcion: 'Ganaste $50 USD totales',            xp: 1000 },
    MILLIONAIRE:   { id: 'MILLIONAIRE',   emoji: '🤑', titulo: 'Creador Millonario',   descripcion: 'Ganaste $500 USD totales',           xp: 3000 },

    // Racha
    STREAK_7:      { id: 'STREAK_7',      emoji: '🔥', titulo: 'Racha Semanal',        descripcion: '7 días seguidos en UpGames',         xp: 400 },
    STREAK_30:     { id: 'STREAK_30',     emoji: '🌋', titulo: 'Racha Mensual',        descripcion: '30 días seguidos en UpGames',        xp: 2000 },
    STREAK_100:    { id: 'STREAK_100',    emoji: '⚡', titulo: 'Racha Épica',          descripcion: '100 días seguidos en UpGames',       xp: 5000 },

    // Verificación
    VERIFIED:      { id: 'VERIFIED',      emoji: '✅', titulo: 'Verificado',           descripcion: 'Cuenta verificada por el equipo',    xp: 1000 }
};

// Tabla de XP necesario por nivel (curva cuadrática suave)
function xpParaNivel(nivel) {
    if (nivel <= 1) return 0;
    return Math.floor(100 * Math.pow(nivel - 1, 1.8));
}

function nivelDesdeXP(xp) {
    for (let n = 100; n >= 1; n--) {
        if (xp >= xpParaNivel(n)) return n;
    }
    return 1;
}

// ======================================================================
// API PÚBLICO
// ======================================================================

/**
 * Obtiene (o crea) el registro de gamificación de un usuario.
 */
async function obtenerGamificacion(usuario) {
    let g = await Gamificacion.findOne({ usuario }).lean();
    if (!g) {
        g = await Gamificacion.create({
            usuario,
            xp: 50,
            nivel: 1,
            badges: ['NEWBIE']
        });
        g = g.toObject();
    }

    // Enriquecer con datos útiles para la UI
    const xpActual    = g.xp;
    const nivelActual = g.nivel;
    const xpNivelActual = xpParaNivel(nivelActual);
    const xpProximoNivel = xpParaNivel(nivelActual + 1);
    const progresoNivel = xpProximoNivel > xpNivelActual
        ? Math.floor((xpActual - xpNivelActual) / (xpProximoNivel - xpNivelActual) * 100)
        : 100;

    return {
        ...g,
        xpNivelActual,
        xpProximoNivel,
        xpParaProximoNivel: xpProximoNivel - xpActual,
        progresoNivel,
        badgesDesbloqueados: (g.badges || []).map(id => BADGES[id]).filter(Boolean),
        badgesTotales: Object.keys(BADGES).length
    };
}

/**
 * Agrega XP a un usuario. Devuelve info sobre level up y badges desbloqueados.
 */
async function agregarXP(usuario, cantidad, motivo = '') {
    try {
        const before = await Gamificacion.findOneAndUpdate(
            { usuario },
            { $setOnInsert: { usuario, xp: 0, nivel: 1, badges: [] } },
            { upsert: true, new: false }
        ).lean();

        const nivelAnterior = before?.nivel || 1;

        const after = await Gamificacion.findOneAndUpdate(
            { usuario },
            { $inc: { xp: cantidad } },
            { new: true }
        ).lean();

        const nivelNuevo = nivelDesdeXP(after.xp);
        const levelUp = nivelNuevo > nivelAnterior;

        if (levelUp) {
            await Gamificacion.updateOne({ usuario }, { $set: { nivel: nivelNuevo } });
            logger.info(`🎉 LEVEL UP: @${usuario} → Nivel ${nivelNuevo} (motivo: ${motivo})`);
        }

        cache.invalidate(`leaderboard:*`);

        return {
            xpGanado: cantidad,
            xpTotal: after.xp,
            nivelAnterior,
            nivelNuevo,
            levelUp,
            motivo
        };
    } catch (err) {
        logger.error(`agregarXP error para @${usuario}: ${err.message}`);
        return null;
    }
}

/**
 * Desbloquea un badge si aún no lo tiene. Suma XP y devuelve el badge si fue nuevo.
 */
async function desbloquearBadge(usuario, badgeId) {
    const badge = BADGES[badgeId];
    if (!badge) return null;

    const result = await Gamificacion.findOneAndUpdate(
        { usuario, badges: { $ne: badgeId } },
        {
            $addToSet: { badges: badgeId },
            $setOnInsert: { usuario }
        },
        { upsert: true, new: true }
    );

    // Si badges ya contenía el id, findOneAndUpdate con el filter $ne habría devuelto null/no-match.
    // Con upsert siempre devuelve doc, pero si ya tenía el badge result.badges no habrá crecido por esta op.
    // Verificamos si realmente se agregó:
    const yaLoTenia = result.badges.filter(b => b === badgeId).length > 1;
    if (yaLoTenia) return null;

    // Suma XP del badge
    await agregarXP(usuario, badge.xp, `Badge: ${badge.titulo}`);

    logger.info(`🏆 BADGE: @${usuario} desbloqueó "${badge.titulo}"`);
    return badge;
}

/**
 * Registra una descarga. Suma XP + revisa badges de descargas.
 */
async function onDescarga(usuario) {
    const g = await Gamificacion.findOneAndUpdate(
        { usuario },
        {
            $inc: { 'stats.totalDescargas': 1, xp: 10 },
            $setOnInsert: { usuario, nivel: 1, badges: [] }
        },
        { upsert: true, new: true }
    );

    const total = g.stats.totalDescargas;
    const unlocked = [];

    if (total === 1)                 unlocked.push(await desbloquearBadge(usuario, 'FIRST_DL'));
    if (total === 10)                unlocked.push(await desbloquearBadge(usuario, 'GAMER_10'));
    if (total === 50)                unlocked.push(await desbloquearBadge(usuario, 'GAMER_50'));
    if (total === 100)               unlocked.push(await desbloquearBadge(usuario, 'GAMER_100'));
    if (total === 500)               unlocked.push(await desbloquearBadge(usuario, 'GAMER_500'));

    return unlocked.filter(Boolean);
}

/**
 * Registra un upload. Suma XP + revisa badges de creator.
 */
async function onUpload(usuario) {
    const g = await Gamificacion.findOneAndUpdate(
        { usuario },
        {
            $inc: { 'stats.totalUploads': 1, xp: 50 },
            $setOnInsert: { usuario, nivel: 1, badges: [] }
        },
        { upsert: true, new: true }
    );

    const total = g.stats.totalUploads;
    const unlocked = [];

    if (total === 1)   unlocked.push(await desbloquearBadge(usuario, 'FIRST_UPLOAD'));
    if (total === 5)   unlocked.push(await desbloquearBadge(usuario, 'CREATOR_5'));
    if (total === 25)  unlocked.push(await desbloquearBadge(usuario, 'CREATOR_25'));
    if (total === 100) unlocked.push(await desbloquearBadge(usuario, 'CREATOR_100'));

    return unlocked.filter(Boolean);
}

/**
 * Registra favorito. Suma XP.
 */
async function onFavorito(usuario) {
    const g = await Gamificacion.findOneAndUpdate(
        { usuario },
        {
            $inc: { 'stats.totalFavoritos': 1, xp: 5 },
            $setOnInsert: { usuario, nivel: 1, badges: [] }
        },
        { upsert: true, new: true }
    );

    if (g.stats.totalFavoritos === 1) {
        const b = await desbloquearBadge(usuario, 'FIRST_FAV');
        return b ? [b] : [];
    }
    return [];
}

/**
 * Registra comentario. Suma XP + badges.
 */
async function onComentario(usuario) {
    const g = await Gamificacion.findOneAndUpdate(
        { usuario },
        {
            $inc: { 'stats.totalComentarios': 1, xp: 20 },
            $setOnInsert: { usuario, nivel: 1, badges: [] }
        },
        { upsert: true, new: true }
    );

    const total = g.stats.totalComentarios;
    const unlocked = [];

    if (total === 1)  unlocked.push(await desbloquearBadge(usuario, 'FIRST_COMMENT'));
    if (total === 10) unlocked.push(await desbloquearBadge(usuario, 'COMMENTATOR'));

    return unlocked.filter(Boolean);
}

/**
 * Registra que el item del creador alcanzó X descargas (viral).
 */
async function onItemViral(usuario, descargasItem) {
    const unlocked = [];
    if (descargasItem >= 100)  unlocked.push(await desbloquearBadge(usuario, 'VIRAL_100'));
    if (descargasItem >= 1000) unlocked.push(await desbloquearBadge(usuario, 'VIRAL_1000'));
    return unlocked.filter(Boolean);
}

/**
 * Registra login diario. Controla streak.
 */
async function onLogin(usuario) {
    const ahora = new Date();
    const ayer = new Date(ahora);
    ayer.setDate(ayer.getDate() - 1);
    const hoyStr  = ahora.toISOString().slice(0, 10);
    const ayerStr = ayer.toISOString().slice(0, 10);

    const g = await Gamificacion.findOne({ usuario }).lean();

    let rachaNueva = 1;
    let otorgarXP = 0;
    let esNuevoDia = true;

    if (g && g.ultimoLogin) {
        const ultimoStr = new Date(g.ultimoLogin).toISOString().slice(0, 10);
        if (ultimoStr === hoyStr) {
            // Mismo día, no hacer nada
            esNuevoDia = false;
            rachaNueva = g.rachaActual;
        } else if (ultimoStr === ayerStr) {
            // Continuó racha
            rachaNueva = (g.rachaActual || 0) + 1;
            otorgarXP = 25;
        } else {
            // Se rompió
            rachaNueva = 1;
            otorgarXP = 25;
        }
    } else {
        otorgarXP = 25;
    }

    if (!esNuevoDia) return { rachaActual: g.rachaActual, esNuevoDia: false, xpGanado: 0, badges: [] };

    const rachaMaxima = Math.max(rachaNueva, g?.rachaMaxima || 0);

    await Gamificacion.findOneAndUpdate(
        { usuario },
        {
            $set: { ultimoLogin: ahora, rachaActual: rachaNueva, rachaMaxima },
            $inc: { xp: otorgarXP },
            $setOnInsert: { usuario }
        },
        { upsert: true }
    );

    const unlocked = [];
    if (rachaNueva === 7)   unlocked.push(await desbloquearBadge(usuario, 'STREAK_7'));
    if (rachaNueva === 30)  unlocked.push(await desbloquearBadge(usuario, 'STREAK_30'));
    if (rachaNueva === 100) unlocked.push(await desbloquearBadge(usuario, 'STREAK_100'));

    return {
        rachaActual: rachaNueva,
        rachaMaxima,
        esNuevoDia: true,
        xpGanado: otorgarXP,
        badges: unlocked.filter(Boolean)
    };
}

/**
 * Registra pago recibido (retiro procesado).
 */
async function onPagoRecibido(usuario, monto) {
    const g = await Gamificacion.findOneAndUpdate(
        { usuario },
        {
            $inc: { 'stats.totalGanado': monto, xp: Math.floor(monto * 10) },
            $setOnInsert: { usuario }
        },
        { upsert: true, new: true }
    );

    const unlocked = [];
    const totalGanado = g.stats.totalGanado;

    if (!g.badges.includes('FIRST_PAYOUT'))             unlocked.push(await desbloquearBadge(usuario, 'FIRST_PAYOUT'));
    if (totalGanado >= 50  && !g.badges.includes('BIG_EARNER'))  unlocked.push(await desbloquearBadge(usuario, 'BIG_EARNER'));
    if (totalGanado >= 500 && !g.badges.includes('MILLIONAIRE')) unlocked.push(await desbloquearBadge(usuario, 'MILLIONAIRE'));

    return unlocked.filter(Boolean);
}

// ======================================================================
// LEADERBOARDS
// ======================================================================

async function leaderboardTopXP(limit = 100) {
    return cache.remember(`leaderboard:xp:${limit}`, 300, async () => {
        return Gamificacion.find({})
            .sort({ xp: -1 })
            .limit(limit)
            .select('usuario xp nivel badges stats')
            .lean();
    });
}

async function leaderboardTopDescargas(limit = 100) {
    return cache.remember(`leaderboard:dl:${limit}`, 300, async () => {
        return Gamificacion.find({})
            .sort({ 'stats.totalDescargas': -1 })
            .limit(limit)
            .select('usuario xp nivel stats.totalDescargas')
            .lean();
    });
}

async function leaderboardTopCreadores(limit = 100) {
    return cache.remember(`leaderboard:creators:${limit}`, 300, async () => {
        return Gamificacion.find({ 'stats.totalUploads': { $gt: 0 } })
            .sort({ 'stats.totalGanado': -1, 'stats.totalUploads': -1 })
            .limit(limit)
            .select('usuario xp nivel stats')
            .lean();
    });
}

/**
 * Posición del usuario en un leaderboard específico.
 */
async function miPosicion(usuario, tipo = 'xp') {
    const g = await Gamificacion.findOne({ usuario }).lean();
    if (!g) return null;

    let filtro = {};
    let campo = '';

    switch (tipo) {
        case 'descargas': filtro = { 'stats.totalDescargas': { $gt: g.stats.totalDescargas } }; campo = 'descargas'; break;
        case 'uploads':   filtro = { 'stats.totalUploads':   { $gt: g.stats.totalUploads } };   campo = 'uploads';   break;
        case 'ganado':    filtro = { 'stats.totalGanado':    { $gt: g.stats.totalGanado } };    campo = 'ganado';    break;
        case 'xp':
        default:          filtro = { xp: { $gt: g.xp } }; campo = 'xp';
    }

    const mejoresQueYo = await Gamificacion.countDocuments(filtro);
    const posicion = mejoresQueYo + 1;

    return { posicion, tipo, miValor: g[campo] || g.stats?.[`total${campo[0].toUpperCase() + campo.slice(1)}`] };
}

module.exports = {
    BADGES,
    xpParaNivel,
    nivelDesdeXP,
    obtenerGamificacion,
    agregarXP,
    desbloquearBadge,
    onDescarga,
    onUpload,
    onFavorito,
    onComentario,
    onItemViral,
    onLogin,
    onPagoRecibido,
    leaderboardTopXP,
    leaderboardTopDescargas,
    leaderboardTopCreadores,
    miPosicion,
    Gamificacion
};
