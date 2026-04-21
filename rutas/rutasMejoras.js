// ========================================
// 🔌 RUTAS DE MEJORAS - UPGAMES
// ========================================
//
// Este archivo centraliza TODOS los endpoints de las nuevas mejoras.
// Para integrarlo, en index.js agregar después de la definición de `app`:
//
//     const rutasMejoras = require('./rutas/rutasMejoras');
//     rutasMejoras.registrar(app, { verificarToken, verificarAdmin });
//
// ========================================

const { body, param, query, validationResult } = require('express-validator');

const recommendations = require('../modulos/recommendations');
const search          = require('../modulos/search');
const gamification    = require('../modulos/gamification');
const twoFactor       = require('../modulos/twoFactor');
const analytics       = require('../modulos/analytics');
const socialFeed      = require('../modulos/socialFeed');
const cache           = require('../modulos/cache');
const logger          = require('../modulos/logger');

function registrar(app, { verificarToken, verificarAdmin }) {

    // ==========================================================================
    // 🔍 BÚSQUEDA AVANZADA
    // ==========================================================================

    /**
     * GET /search
     * Búsqueda avanzada con filtros, paginación y facets.
     * Query params: q, categoria, usuario, minLikes, minDescargas, desde, hasta, tags, orden, page, limit, facets
     */
    app.get('/search', async (req, res) => {
        try {
            const {
                q, categoria, usuario, minLikes, minDescargas,
                desde, hasta, tags, orden, page, limit, facets
            } = req.query;

            const opts = {
                q: q || '',
                categoria:    categoria || null,
                usuario:      usuario || null,
                minLikes:     parseInt(minLikes) || 0,
                minDescargas: parseInt(minDescargas) || 0,
                desde:        desde || null,
                hasta:        hasta || null,
                tags:         tags ? (Array.isArray(tags) ? tags : tags.split(',')) : null,
                orden:        orden || 'relevancia',
                page:         parseInt(page) || 1,
                limit:        parseInt(limit) || 20,
                incluirFacets: facets === 'true' || facets === '1'
            };

            const resultado = await search.buscar(opts);
            if (q) search.registrarBusqueda(q);
            res.json(resultado);
        } catch (err) {
            logger.error(`/search error: ${err.message}`);
            res.status(500).json({ error: 'Error en búsqueda' });
        }
    });

    /**
     * GET /search/autocomplete?q=xxx
     * Sugerencias mientras el usuario escribe.
     */
    app.get('/search/autocomplete', async (req, res) => {
        try {
            const { q, limit } = req.query;
            if (!q) return res.json({ items: [], creadores: [], categorias: [] });
            const resultado = await search.autocomplete(q, parseInt(limit) || 8);
            res.json(resultado);
        } catch (err) {
            logger.error(`/search/autocomplete error: ${err.message}`);
            res.status(500).json({ items: [], creadores: [], categorias: [] });
        }
    });

    /**
     * GET /search/trending-queries
     * Búsquedas más populares de la última hora.
     */
    app.get('/search/trending-queries', (req, res) => {
        try {
            const populares = search.busquedasPopulares(parseInt(req.query.limit) || 10);
            res.json(populares);
        } catch (err) {
            res.json([]);
        }
    });

    // ==========================================================================
    // 🧠 RECOMENDACIONES
    // ==========================================================================

    /**
     * GET /recommendations/trending
     */
    app.get('/recommendations/trending', async (req, res) => {
        try {
            const items = await recommendations.getTrending(parseInt(req.query.limit) || 20);
            res.json(items);
        } catch (err) {
            logger.error(`/recommendations/trending error: ${err.message}`);
            res.status(500).json([]);
        }
    });

    /**
     * GET /recommendations/feed
     * Feed personalizado (requiere auth).
     */
    app.get('/recommendations/feed', verificarToken, async (req, res) => {
        try {
            const items = await recommendations.getFeed(req.usuario, parseInt(req.query.limit) || 30);
            res.json(items);
        } catch (err) {
            logger.error(`/recommendations/feed error: ${err.message}`);
            res.status(500).json([]);
        }
    });

    /**
     * GET /recommendations/personalized
     * Recomendaciones personalizadas (requiere auth).
     */
    app.get('/recommendations/personalized', verificarToken, async (req, res) => {
        try {
            const items = await recommendations.getPersonalizedFor(req.usuario, parseInt(req.query.limit) || 20);
            res.json(items);
        } catch (err) {
            logger.error(`/recommendations/personalized error: ${err.message}`);
            res.status(500).json([]);
        }
    });

    /**
     * GET /recommendations/similar/:juegoId
     */
    app.get('/recommendations/similar/:juegoId', [param('juegoId').isMongoId()], async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(400).json([]);
            const items = await recommendations.getSimilar(req.params.juegoId, parseInt(req.query.limit) || 8);
            res.json(items);
        } catch (err) {
            res.status(500).json([]);
        }
    });

    /**
     * GET /recommendations/collaborative/:juegoId
     * "Otros usuarios también descargaron..."
     */
    app.get('/recommendations/collaborative/:juegoId', [param('juegoId').isMongoId()], async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(400).json([]);
            const items = await recommendations.getCollaborative(req.params.juegoId, parseInt(req.query.limit) || 10);
            res.json(items);
        } catch (err) {
            res.status(500).json([]);
        }
    });

    // ==========================================================================
    // 🎮 GAMIFICACIÓN
    // ==========================================================================

    /**
     * GET /gamification/me
     */
    app.get('/gamification/me', verificarToken, async (req, res) => {
        try {
            const g = await gamification.obtenerGamificacion(req.usuario);
            res.json(g);
        } catch (err) {
            logger.error(`/gamification/me error: ${err.message}`);
            res.status(500).json({ error: 'Error' });
        }
    });

    /**
     * GET /gamification/user/:usuario
     * Perfil público de gamificación de otro usuario.
     */
    app.get('/gamification/user/:usuario', async (req, res) => {
        try {
            const g = await gamification.obtenerGamificacion(req.params.usuario);
            // Filtrar datos sensibles si es otro usuario
            res.json({
                usuario: g.usuario,
                nivel: g.nivel,
                xp: g.xp,
                badges: g.badges,
                badgesDesbloqueados: g.badgesDesbloqueados,
                stats: g.stats,
                rachaActual: g.rachaActual,
                rachaMaxima: g.rachaMaxima
            });
        } catch (err) {
            res.status(500).json({ error: 'Error' });
        }
    });

    /**
     * GET /gamification/badges-catalog
     * Catálogo completo de badges disponibles (para mostrar en UI).
     */
    app.get('/gamification/badges-catalog', (req, res) => {
        res.json(gamification.BADGES);
    });

    /**
     * GET /gamification/leaderboard/:tipo
     * tipo: 'xp' | 'descargas' | 'creadores'
     */
    app.get('/gamification/leaderboard/:tipo',
        [param('tipo').isIn(['xp', 'descargas', 'creadores'])],
        async (req, res) => {
            try {
                const errors = validationResult(req);
                if (!errors.isEmpty()) return res.status(400).json([]);
                const limit = Math.min(100, parseInt(req.query.limit) || 50);

                let data;
                switch (req.params.tipo) {
                    case 'xp':         data = await gamification.leaderboardTopXP(limit);        break;
                    case 'descargas':  data = await gamification.leaderboardTopDescargas(limit); break;
                    case 'creadores':  data = await gamification.leaderboardTopCreadores(limit); break;
                }
                res.json(data);
            } catch (err) {
                logger.error(`/gamification/leaderboard error: ${err.message}`);
                res.status(500).json([]);
            }
        }
    );

    /**
     * GET /gamification/my-rank/:tipo
     */
    app.get('/gamification/my-rank/:tipo', verificarToken,
        [param('tipo').isIn(['xp', 'descargas', 'uploads', 'ganado'])],
        async (req, res) => {
            try {
                const rank = await gamification.miPosicion(req.usuario, req.params.tipo);
                res.json(rank || { posicion: null });
            } catch (err) {
                res.status(500).json({ error: 'Error' });
            }
        }
    );

    /**
     * POST /gamification/daily-login
     * Registrar login diario (otorga XP + revisa racha).
     */
    app.post('/gamification/daily-login', verificarToken, async (req, res) => {
        try {
            const result = await gamification.onLogin(req.usuario);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: 'Error' });
        }
    });

    // ==========================================================================
    // 🔐 2FA
    // ==========================================================================

    /**
     * POST /2fa/setup - Iniciar configuración
     */
    app.post('/2fa/setup', verificarToken, async (req, res) => {
        try {
            const setup = await twoFactor.iniciarSetup(req.usuario, req.usuario);
            res.json(setup);
        } catch (err) {
            logger.error(`/2fa/setup error: ${err.message}`);
            res.status(500).json({ error: 'Error configurando 2FA' });
        }
    });

    /**
     * POST /2fa/confirm - Confirmar activación con primer token
     */
    app.post('/2fa/confirm', verificarToken, [body('token').isString().isLength({ min: 6, max: 6 })], async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(400).json({ ok: false, error: 'Token inválido' });
            const result = await twoFactor.confirmarActivacion(req.usuario, req.body.token);
            res.json(result);
        } catch (err) {
            res.status(500).json({ ok: false, error: 'Error' });
        }
    });

    /**
     * POST /2fa/verify - Verificar token en login
     */
    app.post('/2fa/verify', [body('usuario').notEmpty(), body('token').notEmpty()], async (req, res) => {
        try {
            const result = await twoFactor.verificar(req.body.usuario.toLowerCase(), req.body.token);
            res.json(result);
        } catch (err) {
            res.status(500).json({ ok: false });
        }
    });

    /**
     * GET /2fa/status
     */
    app.get('/2fa/status', verificarToken, async (req, res) => {
        try {
            const st = await twoFactor.estado(req.usuario);
            res.json(st);
        } catch (err) {
            res.status(500).json({ activo: false });
        }
    });

    /**
     * POST /2fa/disable
     */
    app.post('/2fa/disable', verificarToken, [body('token').notEmpty()], async (req, res) => {
        try {
            const result = await twoFactor.desactivar(req.usuario, req.body.token);
            res.json(result);
        } catch (err) {
            res.status(500).json({ ok: false });
        }
    });

    /**
     * POST /2fa/regenerate-backup
     */
    app.post('/2fa/regenerate-backup', verificarToken, [body('token').notEmpty()], async (req, res) => {
        try {
            const result = await twoFactor.regenerarBackupCodes(req.usuario, req.body.token);
            res.json(result);
        } catch (err) {
            res.status(500).json({ ok: false });
        }
    });

    // ==========================================================================
    // 📊 ANALYTICS
    // ==========================================================================

    /**
     * GET /analytics/admin/dashboard
     */
    app.get('/analytics/admin/dashboard', verificarAdmin, async (req, res) => {
        try {
            const data = await analytics.dashboardAdmin();
            res.json(data);
        } catch (err) {
            logger.error(`/analytics/admin/dashboard error: ${err.message}`);
            res.status(500).json({ error: 'Error' });
        }
    });

    /**
     * GET /analytics/admin/items-timeseries?dias=30&granularidad=dia
     */
    app.get('/analytics/admin/items-timeseries', verificarAdmin, async (req, res) => {
        try {
            const dias = parseInt(req.query.dias) || 30;
            const gran = req.query.granularidad || 'dia';
            const data = await analytics.itemsTimeSeries(dias, gran);
            res.json(data);
        } catch (err) {
            res.status(500).json([]);
        }
    });

    /**
     * GET /analytics/admin/users-timeseries?dias=30
     */
    app.get('/analytics/admin/users-timeseries', verificarAdmin, async (req, res) => {
        try {
            const dias = parseInt(req.query.dias) || 30;
            const data = await analytics.usuariosTimeSeries(dias);
            res.json(data);
        } catch (err) {
            res.status(500).json([]);
        }
    });

    /**
     * GET /analytics/admin/horarios-pico
     */
    app.get('/analytics/admin/horarios-pico', verificarAdmin, async (req, res) => {
        try {
            const data = await analytics.horariosPico();
            res.json(data);
        } catch (err) {
            res.status(500).json([]);
        }
    });

    /**
     * GET /analytics/admin/funnel
     */
    app.get('/analytics/admin/funnel', verificarAdmin, async (req, res) => {
        try {
            const data = await analytics.funnelConversion();
            res.json(data);
        } catch (err) {
            res.status(500).json({ steps: [] });
        }
    });

    /**
     * GET /analytics/creator/me
     */
    app.get('/analytics/creator/me', verificarToken, async (req, res) => {
        try {
            const data = await analytics.dashboardCreator(req.usuario);
            if (!data) return res.status(404).json({ error: 'Usuario no encontrado' });
            res.json(data);
        } catch (err) {
            logger.error(`/analytics/creator/me error: ${err.message}`);
            res.status(500).json({ error: 'Error' });
        }
    });

    /**
     * GET /analytics/creator/timeseries?dias=30
     */
    app.get('/analytics/creator/timeseries', verificarToken, async (req, res) => {
        try {
            const dias = parseInt(req.query.dias) || 30;
            const data = await analytics.creatorTimeSeries(req.usuario, dias);
            res.json(data);
        } catch (err) {
            res.status(500).json([]);
        }
    });

    // ==========================================================================
    // 👥 SOCIAL
    // ==========================================================================

    /**
     * POST /social/follow/:usuario
     */
    app.post('/social/follow/:usuario', verificarToken, [param('usuario').notEmpty()], async (req, res) => {
        try {
            const result = await socialFeed.seguir(req.usuario, req.params.usuario.toLowerCase());
            res.json(result);
        } catch (err) {
            logger.error(`/social/follow error: ${err.message}`);
            res.status(500).json({ ok: false });
        }
    });

    /**
     * POST /social/unfollow/:usuario
     */
    app.post('/social/unfollow/:usuario', verificarToken, [param('usuario').notEmpty()], async (req, res) => {
        try {
            const result = await socialFeed.dejarDeSeguir(req.usuario, req.params.usuario.toLowerCase());
            res.json(result);
        } catch (err) {
            res.status(500).json({ ok: false });
        }
    });

    /**
     * GET /social/is-following/:usuario
     */
    app.get('/social/is-following/:usuario', verificarToken, async (req, res) => {
        try {
            const sigue = await socialFeed.sigue(req.usuario, req.params.usuario.toLowerCase());
            res.json({ sigue });
        } catch (err) {
            res.status(500).json({ sigue: false });
        }
    });

    /**
     * GET /social/feed?page=1&limit=20
     */
    app.get('/social/feed', verificarToken, async (req, res) => {
        try {
            const page  = parseInt(req.query.page)  || 1;
            const limit = parseInt(req.query.limit) || 20;
            const data = await socialFeed.feed(req.usuario, { page, limit });
            res.json(data);
        } catch (err) {
            logger.error(`/social/feed error: ${err.message}`);
            res.status(500).json({ items: [] });
        }
    });

    /**
     * GET /social/suggestions
     */
    app.get('/social/suggestions', verificarToken, async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 10;
            const data = await socialFeed.sugerenciasASeguir(req.usuario, limit);
            res.json(data);
        } catch (err) {
            res.status(500).json([]);
        }
    });

    /**
     * GET /referrals/my-code
     */
    app.get('/referrals/my-code', verificarToken, async (req, res) => {
        try {
            const data = await socialFeed.obtenerMiCodigoReferral(req.usuario);
            res.json(data);
        } catch (err) {
            res.status(500).json({ error: 'Error' });
        }
    });

    /**
     * POST /referrals/register
     * Se llama tras el registro de un nuevo usuario si viene con ?ref=XXX
     */
    app.post('/referrals/register', [
        body('codigo').notEmpty(),
        body('nuevoUsuario').notEmpty()
    ], async (req, res) => {
        try {
            const result = await socialFeed.registrarReferido(req.body.codigo, req.body.nuevoUsuario.toLowerCase());
            res.json(result);
        } catch (err) {
            res.status(500).json({ ok: false });
        }
    });

    /**
     * GET /referrals/top
     */
    app.get('/referrals/top', async (req, res) => {
        try {
            const data = await socialFeed.topReferidores(parseInt(req.query.limit) || 20);
            res.json(data);
        } catch (err) {
            res.status(500).json([]);
        }
    });

    // ==========================================================================
    // 🚀 CACHE (admin)
    // ==========================================================================

    app.get('/admin/cache/stats', verificarAdmin, (req, res) => {
        res.json(cache.stats());
    });

    app.post('/admin/cache/clear', verificarAdmin, (req, res) => {
        const { pattern } = req.body || {};
        if (pattern) {
            const n = cache.invalidate(pattern);
            res.json({ ok: true, invalidated: n });
        } else {
            const n = cache.clear();
            res.json({ ok: true, cleared: n });
        }
    });

    logger.info('✅ Rutas de mejoras registradas correctamente');
}

module.exports = { registrar };
