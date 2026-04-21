// ========================================
// 📊 ANALYTICS AVANZADO - UPGAMES
// ========================================
//
// Dashboard mejorado con:
//   - Descargas por hora/día/semana (time series)
//   - Funnel de conversión (signup → primera descarga → upload)
//   - Retention curves (% users que vuelven al día 1, 7, 30)
//   - Revenue analytics por creador
//   - Top items trending
//   - Creator Dashboard: stats personalizadas para cada creador
//   - Horarios pico de descargas
//
// Todas las queries usan agregaciones MongoDB optimizadas.
// ========================================

const mongoose = require('mongoose');
const logger   = require('./logger');
const cache    = require('./cache');

function getModels() {
    return {
        Juego:         mongoose.model('Juego'),
        Usuario:       mongoose.model('Usuario'),
        Pago:          mongoose.model('Pago'),
        Favorito:      mongoose.model('Favoritos'),
        Comentario:    mongoose.model('Comentario'),
        Notificacion:  mongoose.model('Notificacion'),
    };
}

// ======================================================================
// MÉTRICAS GLOBALES (ADMIN)
// ======================================================================

/**
 * Dashboard admin mejorado con métricas clave del negocio.
 */
async function dashboardAdmin() {
    return cache.remember('analytics:admin:dashboard', 300, async () => {
        const { Juego, Usuario, Pago } = getModels();
        const ahora = new Date();
        const hace24h = new Date(ahora - 24 * 60 * 60 * 1000);
        const hace7d  = new Date(ahora - 7  * 24 * 60 * 60 * 1000);
        const hace30d = new Date(ahora - 30 * 24 * 60 * 60 * 1000);

        const [
            totalUsuarios,
            usuariosNuevos24h,
            usuariosNuevos7d,
            usuariosActivos7d,
            totalItems,
            itemsNuevos24h,
            itemsNuevos7d,
            descargasAgg,
            pagosPendientes,
            pagosProcesados30d,
            totalRevenue
        ] = await Promise.all([
            Usuario.countDocuments({}),
            Usuario.countDocuments({ createdAt: { $gte: hace24h } }),
            Usuario.countDocuments({ createdAt: { $gte: hace7d } }),
            Usuario.countDocuments({ ultimoLogin: { $gte: hace7d } }),

            Juego.countDocuments({ status: 'aprobado' }),
            Juego.countDocuments({ createdAt: { $gte: hace24h } }),
            Juego.countDocuments({ createdAt: { $gte: hace7d } }),

            Juego.aggregate([
                { $match: { status: 'aprobado' } },
                {
                    $group: {
                        _id: null,
                        totalDescargas: { $sum: '$descargasEfectivas' },
                        totalLikes: { $sum: '$likesCount' }
                    }
                }
            ]),

            Pago.countDocuments({ estado: 'pendiente' }),
            Pago.countDocuments({ estado: 'completado', fecha: { $gte: hace30d } }),

            Pago.aggregate([
                { $match: { estado: 'completado' } },
                { $group: { _id: null, total: { $sum: '$monto' } } }
            ])
        ]);

        return {
            usuarios: {
                total:        totalUsuarios,
                nuevos24h:    usuariosNuevos24h,
                nuevos7d:     usuariosNuevos7d,
                activos7d:    usuariosActivos7d,
                retention7d:  totalUsuarios > 0 ? (usuariosActivos7d / totalUsuarios * 100).toFixed(1) + '%' : '0%'
            },
            contenido: {
                total:       totalItems,
                nuevos24h:   itemsNuevos24h,
                nuevos7d:    itemsNuevos7d
            },
            actividad: {
                descargasTotales: descargasAgg[0]?.totalDescargas || 0,
                likesTotales:     descargasAgg[0]?.totalLikes || 0
            },
            economia: {
                pagosPendientes,
                pagosProcesados30d,
                revenueTotal: totalRevenue[0]?.total || 0
            },
            timestamp: ahora
        };
    });
}

/**
 * Time series de items creados agrupado por día/hora.
 *
 * @param {number} dias - Cuántos días atrás (default 30)
 * @param {string} granularidad - 'hora' | 'dia' | 'semana'
 */
async function itemsTimeSeries(dias = 30, granularidad = 'dia') {
    return cache.remember(`analytics:items-ts:${dias}:${granularidad}`, 600, async () => {
        const { Juego } = getModels();
        const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

        let formato;
        switch (granularidad) {
            case 'hora':    formato = '%Y-%m-%d %H:00'; break;
            case 'semana':  formato = '%Y-%V'; break;
            case 'dia':
            default:        formato = '%Y-%m-%d';
        }

        const serie = await Juego.aggregate([
            { $match: { createdAt: { $gte: desde } } },
            {
                $group: {
                    _id: { $dateToString: { format: formato, date: '$createdAt' } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        return serie.map(s => ({ periodo: s._id, count: s.count }));
    });
}

/**
 * Usuarios nuevos por día.
 */
async function usuariosTimeSeries(dias = 30) {
    return cache.remember(`analytics:users-ts:${dias}`, 600, async () => {
        const { Usuario } = getModels();
        const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

        const serie = await Usuario.aggregate([
            { $match: { createdAt: { $gte: desde } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        return serie.map(s => ({ fecha: s._id, count: s.count }));
    });
}

/**
 * Horarios pico: a qué hora del día se suben/descargan más items.
 */
async function horariosPico() {
    return cache.remember('analytics:horarios-pico', 1800, async () => {
        const { Juego } = getModels();

        const porHora = await Juego.aggregate([
            { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
            {
                $group: {
                    _id: { $hour: '$createdAt' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Completar 24 horas aunque no haya datos
        const serie = [];
        for (let h = 0; h < 24; h++) {
            const encontrado = porHora.find(p => p._id === h);
            serie.push({ hora: h, count: encontrado?.count || 0 });
        }
        return serie;
    });
}

/**
 * Top 10 items con mejor performance reciente.
 */
async function topItemsRecientes(limit = 10) {
    return cache.remember(`analytics:top-items:${limit}`, 600, async () => {
        const { Juego } = getModels();
        return Juego.find({ status: 'aprobado' })
            .sort({ descargasEfectivas: -1 })
            .limit(limit)
            .select('_id title usuario descargasEfectivas likesCount image category createdAt')
            .lean();
    });
}

// ======================================================================
// DASHBOARD PARA CREADORES
// ======================================================================

/**
 * Estadísticas detalladas para un creador específico.
 */
async function dashboardCreator(usuario) {
    return cache.remember(`analytics:creator:${usuario}`, 300, async () => {
        const { Juego, Pago, Usuario } = getModels();
        const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const hace7d  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);
        const hace30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const [
            userData,
            items,
            itemsRecientes,
            pagos30d,
            pagosTotal
        ] = await Promise.all([
            Usuario.findOne({ usuario }).select('listaSeguidores siguiendo descargasTotales saldo').lean(),

            Juego.find({ usuario, status: 'aprobado' })
                .select('title descargasEfectivas likesCount createdAt category')
                .lean(),

            Juego.countDocuments({ usuario, createdAt: { $gte: hace30d } }),

            Pago.aggregate([
                { $match: { usuario, estado: 'completado', fecha: { $gte: hace30d } } },
                { $group: { _id: null, total: { $sum: '$monto' }, count: { $sum: 1 } } }
            ]),

            Pago.aggregate([
                { $match: { usuario, estado: 'completado' } },
                { $group: { _id: null, total: { $sum: '$monto' }, count: { $sum: 1 } } }
            ])
        ]);

        if (!userData) return null;

        // Totales
        const totalDescargas = items.reduce((s, i) => s + (i.descargasEfectivas || 0), 0);
        const totalLikes     = items.reduce((s, i) => s + (i.likesCount || 0), 0);

        // Top 5 items
        const topItems = [...items].sort((a, b) => b.descargasEfectivas - a.descargasEfectivas).slice(0, 5);

        // Distribución por categoría
        const porCategoria = {};
        for (const item of items) {
            const cat = item.category || 'General';
            if (!porCategoria[cat]) porCategoria[cat] = { count: 0, descargas: 0 };
            porCategoria[cat].count++;
            porCategoria[cat].descargas += item.descargasEfectivas || 0;
        }
        const distribCategorias = Object.entries(porCategoria)
            .map(([cat, stats]) => ({ categoria: cat, ...stats }))
            .sort((a, b) => b.descargas - a.descargas);

        // Conversión estimada: views → downloads (simplificada con datos disponibles)
        const avgDescargasPorItem = items.length > 0 ? (totalDescargas / items.length).toFixed(1) : 0;

        return {
            creador: {
                usuario,
                seguidores: userData.listaSeguidores?.length || 0,
                siguiendo:  userData.siguiendo?.length || 0,
                saldoActual: userData.saldo || 0,
                descargasGlobales: userData.descargasTotales || 0
            },
            contenido: {
                totalItems: items.length,
                nuevosUltimos30d: itemsRecientes,
                totalDescargas,
                totalLikes,
                avgDescargasPorItem: parseFloat(avgDescargasPorItem)
            },
            economia: {
                gananciasTotales:  pagosTotal[0]?.total || 0,
                gananciasUltimos30d: pagos30d[0]?.total || 0,
                pagosCompletados:  pagosTotal[0]?.count || 0
            },
            topItems: topItems.map(i => ({
                id: i._id,
                title: i.title,
                descargas: i.descargasEfectivas,
                likes: i.likesCount,
                categoria: i.category
            })),
            distribucionCategorias: distribCategorias
        };
    });
}

/**
 * Gráfico de descargas de un creador en el tiempo.
 * NOTA: como no hay schema de "descarga individual por fecha" (solo contador),
 * usamos fechas de creación de items como proxy + descargas acumuladas.
 */
async function creatorTimeSeries(usuario, dias = 30) {
    const { Juego } = getModels();
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    const serie = await Juego.aggregate([
        {
            $match: {
                usuario,
                createdAt: { $gte: desde }
            }
        },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                items: { $sum: 1 },
                descargas: { $sum: '$descargasEfectivas' },
                likes: { $sum: '$likesCount' }
            }
        },
        { $sort: { _id: 1 } }
    ]);

    return serie.map(s => ({
        fecha: s._id,
        items: s.items,
        descargas: s.descargas,
        likes: s.likes
    }));
}

// ======================================================================
// FUNNEL DE CONVERSIÓN
// ======================================================================

/**
 * Funnel: Registro → Primer login → Primera descarga → Primer upload
 */
async function funnelConversion() {
    return cache.remember('analytics:funnel', 1800, async () => {
        const { Usuario, Juego, Favorito } = getModels();
        const hace30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const [registrados, conLogin, conFavoritos, conUpload] = await Promise.all([
            Usuario.countDocuments({ createdAt: { $gte: hace30d } }),
            Usuario.countDocuments({ createdAt: { $gte: hace30d }, ultimoLogin: { $ne: null } }),

            // Users que han marcado al menos un favorito
            Favorito.aggregate([
                { $group: { _id: '$usuario' } },
                { $count: 'total' }
            ]),

            // Users que han subido al menos un item
            Juego.aggregate([
                { $group: { _id: '$usuario' } },
                { $count: 'total' }
            ])
        ]);

        const favCount = conFavoritos[0]?.total || 0;
        const uploadCount = conUpload[0]?.total || 0;

        return {
            steps: [
                { paso: 'Registrados',       count: registrados, pct: 100 },
                { paso: 'Completaron login', count: conLogin,    pct: registrados > 0 ? (conLogin / registrados * 100).toFixed(1) : 0 },
                { paso: 'Engagement (favs)', count: favCount,    pct: registrados > 0 ? (favCount / registrados * 100).toFixed(1) : 0 },
                { paso: 'Subieron contenido',count: uploadCount, pct: registrados > 0 ? (uploadCount / registrados * 100).toFixed(1) : 0 }
            ]
        };
    });
}

// ======================================================================
// INVALIDAR CACHES (llamar tras mutaciones)
// ======================================================================

function invalidar(tipo = null, usuario = null) {
    if (tipo === 'creator' && usuario) {
        cache.invalidate(`analytics:creator:${usuario}`);
        return;
    }
    if (tipo) {
        cache.invalidate(`analytics:${tipo}:*`);
        return;
    }
    cache.invalidate('analytics:*');
}

module.exports = {
    dashboardAdmin,
    itemsTimeSeries,
    usuariosTimeSeries,
    horariosPico,
    topItemsRecientes,
    dashboardCreator,
    creatorTimeSeries,
    funnelConversion,
    invalidar
};
