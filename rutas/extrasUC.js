/**
 * Usos extra de los UpCoins (ver modulos/extras.js para la configuración):
 *
 *   GET  /extras/catalogo                 precios y catálogo vigentes (público)
 *   GET  /extras/mio                      lo que tengo: cosméticos, estilo equipado, misiones
 *   POST /extras/cosmetico                comprar un cosmético { id, clave }
 *   PUT  /extras/estilo                   equipar { marco, color, fondo, insignias[] }
 *   POST /items/:id/apoyar                propina a una publicación { monto, clave }
 *   POST /items/:id/prioridad             revisión prioritaria { clave }
 *   GET  /misiones                        misiones de la semana
 *   POST /misiones/evento                 { tipo: 'ver_live', liveId } (el resto se cuenta en el servidor)
 *   POST /misiones/:mision/reclamar
 *   GET  /admin/finanzas/extras           configuración + estadísticas
 *   PUT  /admin/finanzas/extras           guardar configuración
 *
 * Super Chat (rutas/live.js), regalar Premium (rutas/tienda.js) y el cambio de nombre
 * inmediato (index.js) usan la misma configuración.
 */
'use strict';

const X = require('../modulos/extras');
const L = require('../modulos/live');
const UC = require('../modulos/upcoins');

const esId = s => /^[a-f\d]{24}$/i.test(String(s || ''));
const claveOk = c => /^[A-Za-z0-9_-]{8,64}$/.test(String(c || ''));
const r2 = n => Math.round(n * 100) / 100;
const HORAS_PRIORIDAD = 24;   // si no se revisa en este plazo, se devuelven los UpCoins

function registrar(app, deps) {
    const { verificarToken, verificarAdmin, Usuario, Juego, LiveTx, Notificacion, logger } = deps;
    const ok = (res, d) => res.json({ success: true, ...d });
    const err = (res, code, error, extra) => res.status(code).json({ success: false, error, ...extra });
    const avisar = (destinatario, itemTitle, mensaje, itemId = '') => Notificacion?.create?.({ destinatario, tipo: 'sistema', emisor: 'UpGames', itemTitle, itemId, mensaje, leida: false, fecha: new Date() }).catch(() => {});
    const totalUC = async u => Math.floor(UC.saldoUC(await Usuario.findOne({ usuario: u }).select('monedas saldo solicitudPagoPendiente').lean() || {}).total);

    /** Cobra `costo` UC con un registro idempotente. Devuelve [status, cuerpo]. */
    async function cobrarConRegistro(usuario, costo, ref, tx) {
        if (await LiveTx.exists({ ref })) return [200, { repetido: true, upcoins: await totalUC(usuario) }];
        const cobro = await UC.cobrar(Usuario, usuario, costo);
        if (!cobro) {
            const motivo = await UC.motivoSinSaldo(Usuario, usuario, costo), tengo = await totalUC(usuario);
            return [/cuenta no puede/.test(motivo) ? 403 : /retiro pendiente/.test(motivo) ? 409 : 402, { error: motivo, monedas: tengo, faltan: Math.max(0, costo - tengo) }];
        }
        try { await LiveTx.create({ ...tx, usuario, monedas: costo, usd: r2(costo * L.MONEDA_USD), ref, metodo: 'upcoins' }); }
        catch (e) { await UC.devolver(Usuario, usuario, cobro); if (e.code === 11000) return [200, { repetido: true, upcoins: await totalUC(usuario) }]; throw e; }
        return [200, { cobro }];
    }

    // ── Catálogo ────────────────────────────────────────────────────────────
    const publicoCfg = c => ({
        activo: c.activo, precios: c.precios,
        cosmeticos: c.cosmeticos.filter(x => x.activo || x.soloMision).map(({ id, tipo, nombre, emoji, precio, soloMision }) => ({ id, tipo, nombre, emoji, precio, soloMision: !!soloMision })),
        misiones: c.activo.misiones ? c.misiones.filter(m => m.activa).map(({ id, titulo, objetivo, uc, insignia }) => ({ id, titulo, objetivo, uc, insignia })) : [],
        prioridadHoras: HORAS_PRIORIDAD, fundadorHasta: X.FUNDADOR_HASTA.toISOString(),
    });
    app.get('/extras/catalogo', async (req, res) => {
        try { res.set('Cache-Control', 'public, max-age=60'); ok(res, publicoCfg(await X.config())); }
        catch (e) { err(res, 500, 'No se pudo cargar el catálogo'); }
    });
    app.get('/extras/mio', verificarToken, async (req, res) => {
        try {
            const [u, c, mis] = await Promise.all([
                Usuario.findOne({ usuario: req.usuario }).select('cosmeticos estilo lastUsernameChange monedas saldo solicitudPagoPendiente fecha createdAt').lean(),
                X.config(), X.estado(req.usuario)]);
            // Insignia Fundador: se entrega sola (y se muestra si hay espacio) a las cuentas creadas a tiempo
            const alta = u?.fecha || u?.createdAt;
            if (u && alta && new Date(alta) <= X.FUNDADOR_HASTA && !(u.cosmeticos || []).includes('ins_fundador')) {
                const ins = u.estilo?.insignias || [];
                await Usuario.updateOne({ usuario: req.usuario }, { $addToSet: { cosmeticos: 'ins_fundador' }, ...(ins.length < 3 ? { $set: { 'estilo.insignias': ['ins_fundador', ...ins] } } : {}) });
                u.cosmeticos = [...(u.cosmeticos || []), 'ins_fundador'];
                if (ins.length < 3) u.estilo = { ...(u.estilo || {}), insignias: ['ins_fundador', ...ins] };
                deps.olvidarPerfil?.(req.usuario);
            }
            const espera = u?.lastUsernameChange ? Math.max(0, Math.ceil(30 - (Date.now() - new Date(u.lastUsernameChange)) / 864e5)) : 0;
            ok(res, { catalogo: publicoCfg(c), cosmeticos: u?.cosmeticos || [], estilo: u?.estilo || {}, misiones: mis, nombreEsperaDias: espera, upcoins: UC.saldoUC(u || {}), fundador: (u?.cosmeticos || []).includes('ins_fundador') });
        } catch (e) { logger.error(`[extras] mio: ${e.message}`); err(res, 500, 'No se pudo cargar'); }
    });

    // ── Estilo del perfil ───────────────────────────────────────────────────
    const enCurso = new Map();
    const unaVez = (k, fn) => { if (!enCurso.has(k)) enCurso.set(k, fn().finally(() => enCurso.delete(k))); return enCurso.get(k); };

    app.post('/extras/cosmetico', verificarToken, async (req, res) => {
        try {
            const c = await X.config();
            if (!c.activo.cosmeticos) return err(res, 409, 'La tienda de estilo está cerrada por ahora');
            const item = c.cosmeticos.find(x => x.id === req.body?.id);
            if (!item || !item.activo || item.soloMision) return err(res, 404, 'Ese artículo no está a la venta');
            if (!claveOk(req.body?.clave)) return err(res, 400, 'Falta la clave del pago');
            const [code, body] = await unaVez(`${req.usuario}:${item.id}`, async () => {
                const yo = await Usuario.findOne({ usuario: req.usuario }).select('cosmeticos estilo').lean();
                if ((yo?.cosmeticos || []).includes(item.id)) return [409, { error: 'Ya tienes este artículo' }];
                // La clave es la de esta compra: "ya lo tienes" (arriba) evita pagar dos veces; con una clave fija por artículo,
                // quien lo perdiera (p. ej. un ajuste del equipo) recibiría "OK" sin el artículo al volver a comprarlo
                const [st, b] = await cobrarConRegistro(req.usuario, item.precio, `cosmetico:${req.usuario}:${item.id}:${req.body.clave}`, { tipo: 'compra', planId: `cosmetico:${item.id}` });
                if (st !== 200 || b.repetido) return [st, b];
                // Se equipa de una vez (las insignias, si hay espacio: máximo 3)
                const set = item.tipo === 'insignia' ? {} : { [`estilo.${item.tipo}`]: item.id };
                const ins = yo?.estilo?.insignias || [];
                if (item.tipo === 'insignia' && ins.length < 3) set['estilo.insignias'] = [...ins, item.id];
                await Usuario.updateOne({ usuario: req.usuario }, { $addToSet: { cosmeticos: item.id }, ...(Object.keys(set).length ? { $set: set } : {}) });
                deps.olvidarPerfil?.(req.usuario);
                logger.info(`[extras] @${req.usuario} compró ${item.id} (${item.precio} UC)`);
                return [200, { comprado: item.id, upcoins: await totalUC(req.usuario) }];
            });
            code === 200 ? ok(res, body) : err(res, code, body.error, { monedas: body.monedas, faltan: body.faltan });
        } catch (e) { logger.error(`[extras] cosmético: ${e.message}`); err(res, 500, 'No se pudo completar la compra'); }
    });

    app.put('/extras/estilo', verificarToken, async (req, res) => {
        try {
            const c = await X.config();
            const yo = await Usuario.findOne({ usuario: req.usuario }).select('cosmeticos').lean();
            const mios = new Set(yo?.cosmeticos || []);
            const estilo = {};
            for (const tipo of ['marco', 'color', 'fondo']) {
                const v = req.body?.[tipo];
                if (v === '' || v === null) { estilo[tipo] = ''; continue; }
                if (v === undefined) continue;
                const item = c.cosmeticos.find(x => x.id === v && x.tipo === tipo);
                if (!item || !mios.has(v)) return err(res, 400, 'No tienes ese artículo');
                estilo[tipo] = v;
            }
            if (req.body?.insignias !== undefined) {
                const l = [...new Set(Array.isArray(req.body.insignias) ? req.body.insignias : [])];
                if (l.length > 3) return err(res, 400, 'Puedes mostrar hasta 3 insignias');
                if (l.some(i => !mios.has(i) || !c.cosmeticos.some(x => x.id === i && x.tipo === 'insignia'))) return err(res, 400, 'No tienes esa insignia');
                estilo.insignias = l;
            }
            const set = Object.fromEntries(Object.entries(estilo).map(([k, v]) => [`estilo.${k}`, v]));
            const u = await Usuario.findOneAndUpdate({ usuario: req.usuario }, { $set: set }, { new: true }).select('estilo').lean();
            deps.olvidarPerfil?.(req.usuario);
            ok(res, { estilo: u?.estilo || {} });
        } catch (e) { logger.error(`[extras] estilo: ${e.message}`); err(res, 500, 'No se pudo guardar tu estilo'); }
    });

    // ── Apoyar una publicación ──────────────────────────────────────────────
    app.post('/items/:id/apoyar', verificarToken, async (req, res) => {
        try {
            const c = await X.config();
            if (!c.activo.apoyar) return err(res, 409, 'Los apoyos están pausados');
            const monto = parseInt(req.body?.monto, 10);
            if (!c.precios.apoyo.includes(monto)) return err(res, 400, 'Monto no válido');
            if (!esId(req.params.id) || !claveOk(req.body?.clave)) return err(res, 400, 'Datos no válidos');
            const j = await Juego.findById(req.params.id).select('usuario title status').lean();
            if (!j || j.status !== 'aprobado') return err(res, 404, 'Publicación no disponible');
            if (j.usuario === req.usuario) return err(res, 400, 'No puedes apoyar tu propia publicación');
            const rep = L.reparto(monto), retener = L.RETENCION_DIAS > 0;
            const [code, body] = await cobrarConRegistro(req.usuario, monto, `apoyo:${req.usuario}:${req.body.clave}`, {
                tipo: 'regalo', destinatario: j.usuario, regaloId: 'apoyo', juegoId: String(j._id), creadorUsd: rep.creador, plataformaUsd: rep.plataforma,
                estado: retener ? 'retenida' : 'liberada', liberarEn: retener ? new Date(Date.now() + L.RETENCION_DIAS * 864e5) : null });
            if (code !== 200) return err(res, code, body.error, { monedas: body.monedas, faltan: body.faltan });
            if (!body.repetido) {
                await Usuario.updateOne({ usuario: j.usuario }, { $inc: retener ? { saldoRetenido: rep.creador } : { saldo: rep.creador } });
                avisar(j.usuario, j.title, `🪙 @${req.usuario} apoyó "${String(j.title).slice(0, 60)}" con ${monto} UpCoins. ¡Gracias por crear!`, String(j._id));
                X.evento(req.usuario, 'apoyar', String(j._id));
            }
            ok(res, { apoyado: monto, upcoins: await totalUC(req.usuario) });
        } catch (e) { logger.error(`[extras] apoyar: ${e.message}`); err(res, 500, 'No se pudo enviar tu apoyo'); }
    });
    // Apoyos recibidos por una publicación (contador público)
    app.get('/items/:id/apoyos', async (req, res) => {
        if (!esId(req.params.id)) return err(res, 400, 'ID no válido');
        try {
            const a = await LiveTx.aggregate([{ $match: { juegoId: req.params.id, regaloId: 'apoyo', estado: { $ne: 'revertida' } } }, { $group: { _id: null, n: { $sum: 1 }, uc: { $sum: '$monedas' }, fans: { $addToSet: '$usuario' } } }]);
            ok(res, { apoyos: a[0]?.n || 0, uc: a[0]?.uc || 0, fans: (a[0]?.fans || []).length });
        } catch (e) { err(res, 500, 'Error'); }
    });

    // ── Revisión prioritaria ────────────────────────────────────────────────
    const ENREV = { status: { $in: ['pendiente', 'pending'] } };
    app.post('/items/:id/prioridad', verificarToken, async (req, res) => {
        try {
            const c = await X.config();
            if (!c.activo.prioridad) return err(res, 409, 'La revisión prioritaria está pausada');
            if (!esId(req.params.id) || !claveOk(req.body?.clave)) return err(res, 400, 'Datos no válidos');
            const j = await Juego.findById(req.params.id).select('usuario status prioridadDesde').lean();
            if (!j || j.usuario !== req.usuario) return err(res, 404, 'Publicación no encontrada');
            if (!['pendiente', 'pending'].includes(j.status)) return err(res, 409, 'Solo las publicaciones en revisión pueden ser prioritarias');
            if (j.prioridadDesde) return err(res, 409, 'Esta publicación ya es prioritaria');
            const [code, body] = await cobrarConRegistro(req.usuario, c.precios.prioridad, `prioridad:${req.params.id}`, { tipo: 'compra', planId: `prioridad:${req.params.id}`, juegoId: req.params.id });
            if (code !== 200) return err(res, code, body.error, { monedas: body.monedas, faltan: body.faltan });
            await Juego.updateOne({ _id: j._id, prioridadDesde: null }, { $set: { prioridadDesde: new Date() } });
            ok(res, { prioritaria: true, horas: HORAS_PRIORIDAD, upcoins: await totalUC(req.usuario) });
        } catch (e) { logger.error(`[extras] prioridad: ${e.message}`); err(res, 500, 'No se pudo activar la revisión prioritaria'); }
    });
    // Si el equipo no la revisó a tiempo, se devuelven los UpCoins (como comprados: no retirables)
    async function reembolsarPrioridades() {
        try {
            const vencidas = await Juego.find({ ...ENREV, prioridadDesde: { $lte: new Date(Date.now() - HORAS_PRIORIDAD * 3600e3) }, prioridadReembolso: { $ne: true } }).select('_id usuario title').limit(200).lean();
            for (const j of vencidas) {
                const m = await Juego.updateOne({ _id: j._id, prioridadReembolso: { $ne: true } }, { $set: { prioridadReembolso: true } });
                if (!m.modifiedCount) continue;
                const tx = await LiveTx.findOneAndUpdate({ ref: `prioridad:${j._id}`, estado: { $ne: 'revertida' } }, { $set: { estado: 'revertida' } }).lean();
                if (!tx) continue;
                await Usuario.updateOne({ usuario: tx.usuario }, { $inc: { monedas: tx.monedas } });
                avisar(tx.usuario, j.title, `↩️ No alcanzamos a revisar "${String(j.title).slice(0, 60)}" en ${HORAS_PRIORIDAD} h: te devolvimos ${tx.monedas} UpCoins. Sigue primera en la fila.`, String(j._id));
            }
            if (vencidas.length) logger.info(`[extras] ${vencidas.length} revisión(es) prioritaria(s) vencida(s): UpCoins devueltos`);
        } catch (e) { logger.warn(`[extras] reembolsos de prioridad: ${e.message}`); }
    }
    setInterval(reembolsarPrioridades, 30 * 60000).unref();
    setTimeout(reembolsarPrioridades, 45000).unref();

    // ── Misiones ────────────────────────────────────────────────────────────
    app.get('/misiones', verificarToken, async (req, res) => {
        try { ok(res, await X.estado(req.usuario)); } catch (e) { err(res, 500, 'No se pudieron cargar las misiones'); }
    });
    app.post('/misiones/evento', verificarToken, async (req, res) => {
        try {
            if (req.body?.tipo !== 'ver_live' || !esId(req.body?.liveId)) return err(res, 400, 'Evento no válido');
            const Live = require('mongoose').models.Live;
            const l = Live ? await Live.findById(req.body.liveId).select('estado creador inicio').lean() : null;
            // Solo cuenta un live en curso, ajeno y que lleve al menos 2 minutos
            if (!l || l.estado !== 'en_vivo' || l.creador === req.usuario || Date.now() - new Date(l.inicio) < 110000) return ok(res, { contado: false });
            ok(res, { contado: await X.evento(req.usuario, 'ver_live', req.body.liveId) });
        } catch (e) { err(res, 500, 'Error'); }
    });
    app.post('/misiones/:mision/reclamar', verificarToken, async (req, res) => {   // :mision (no :id: app.param('id') exige ObjectId)
        try {
            const r = await X.reclamar(Usuario, req.usuario, String(req.params.mision));
            if (r.status !== 200) return err(res, r.status, r.error, r.code ? { code: r.code } : undefined);
            if (r.insignia) deps.olvidarPerfil?.(req.usuario);
            ok(res, { uc: r.uc, insignia: r.insignia, upcoins: await totalUC(req.usuario), misiones: await X.estado(req.usuario) });
        } catch (e) { logger.error(`[extras] reclamar: ${e.message}`); err(res, 500, 'No se pudo reclamar'); }
    });

    // ── Guía de inicio: métricas ANÓNIMAS (contadores por día y paso, sin usuario ni IP) ──
    const PASOS_GUIA = new Set(['_inicio', '_fin', 'explorar', 'abrir', 'cuenta', 'email', 'favorito', 'seguir', 'nexus', 'live', 'upcoins', 'publicar']);
    const statsGuia = () => require('mongoose').connection.collection('guia_stats');
    let idxGuia = false;
    const limGuia = new Map();   // ip → [ts] (máx. 40 eventos por hora; evita inflar los números)
    app.post('/guia/evento', async (req, res) => {
        try {
            const { paso, accion, modo } = req.body || {};
            if (!PASOS_GUIA.has(paso) || !['completo', 'llevame'].includes(accion) || !['inv', 'usr'].includes(modo)) return err(res, 400, 'Evento no válido');
            const ip = req.ip || '', ahora = Date.now(), l = (limGuia.get(ip) || []).filter(t => t > ahora - 3600e3);
            if (l.length >= 40) return ok(res, { contado: false });
            l.push(ahora); limGuia.set(ip, l); if (limGuia.size > 20000) limGuia.clear();
            if (!idxGuia) { idxGuia = true; statsGuia().createIndex({ fecha: 1 }, { expireAfterSeconds: 400 * 86400 }).catch(() => {}); }
            const dia = new Date(ahora - 5 * 3600e3).toISOString().slice(0, 10);
            await statsGuia().updateOne({ _id: `${dia}:${modo}:${paso}:${accion}` }, { $inc: { n: 1 }, $setOnInsert: { dia, modo, paso, accion, fecha: new Date() } }, { upsert: true });
            ok(res, { contado: true });
        } catch (e) { err(res, 500, 'Error'); }
    });
    app.get('/admin/stats/guia', verificarAdmin, async (req, res) => {
        try {
            const dias = Math.min(365, Math.max(1, parseInt(req.query.dias, 10) || 30));
            const desde = new Date(Date.now() - 5 * 3600e3 - (dias - 1) * 864e5).toISOString().slice(0, 10);
            const filas = await statsGuia().aggregate([{ $match: { dia: { $gte: desde } } }, { $group: { _id: { modo: '$modo', paso: '$paso', accion: '$accion' }, n: { $sum: '$n' } } }]).toArray();
            const r = { inv: {}, usr: {} };
            for (const f of filas) { const m = r[f._id.modo]; (m[f._id.paso] ||= { completo: 0, llevame: 0 })[f._id.accion] += f.n; }
            ok(res, { dias, guia: r });
        } catch (e) { err(res, 500, 'No se pudo cargar'); }
    });

    // ── Panel admin ─────────────────────────────────────────────────────────
    app.get('/admin/finanzas/extras', verificarAdmin, async (req, res) => {
        try {
            const c = await X.config();
            const desde = new Date(Date.now() - 30 * 864e5);
            const [ventas, prioridadPend, misionesSem] = await Promise.all([
                LiveTx.aggregate([{ $match: { fecha: { $gte: desde }, estado: { $ne: 'revertida' }, $or: [{ regaloId: { $in: ['superchat', 'apoyo'] } }, { planId: /^(cosmetico:|prioridad:|nombre$)/ }, { tipo: 'mision' }, { tipo: 'plan', destinatario: { $nin: ['', null] } }] } },
                    { $group: { _id: { $switch: { branches: [
                        { case: { $in: ['$regaloId', ['superchat', 'apoyo']] }, then: '$regaloId' },
                        { case: { $eq: ['$tipo', 'mision'] }, then: 'mision' },
                        { case: { $eq: ['$tipo', 'plan'] }, then: 'regalo_premium' },
                    ], default: { $arrayElemAt: [{ $split: ['$planId', ':'] }, 0] } } }, n: { $sum: 1 }, uc: { $sum: '$monedas' } } }]),
                Juego.countDocuments({ ...ENREV, prioridadDesde: { $ne: null }, prioridadReembolso: { $ne: true } }),
                require('mongoose').connection.collection('misiones_progreso').aggregate([{ $match: { semana: X.semana() } }, { $project: { r: { $size: { $ifNull: ['$reclamadas', []] } } } }, { $group: { _id: null, usuarios: { $sum: 1 }, reclamadas: { $sum: '$r' } } }]).toArray(),
            ]);
            const porCosmetico = await LiveTx.aggregate([{ $match: { planId: /^cosmetico:/, estado: { $ne: 'revertida' } } }, { $group: { _id: '$planId', n: { $sum: 1 } } }]);
            ok(res, { config: c, tiposMision: X.TIPOS_MISION, stats: {
                ventas30d: Object.fromEntries(ventas.map(v => [v._id, { n: v.n, uc: v.uc }])),
                prioridadPendientes: prioridadPend, misionesSemana: misionesSem[0] || { usuarios: 0, reclamadas: 0 },
                vendidosPorCosmetico: Object.fromEntries(porCosmetico.map(x => [x._id.split(':')[1], x.n])),
            } });
        } catch (e) { logger.error(`[extras] admin: ${e.message}`); err(res, 500, 'No se pudo cargar'); }
    });
    app.put('/admin/finanzas/extras', verificarAdmin, async (req, res) => {
        try {
            const c = await X.guardar(req.body || {});
            logger.info(`ADMIN @${req.admin?.usuario || '?'}: configuración de extras UC actualizada`);
            ok(res, { config: c });
        } catch (e) { e.status === 400 ? err(res, 400, e.message) : (logger.error(`[extras] guardar: ${e.message}`), err(res, 500, 'No se pudo guardar')); }
    });

    return { reembolsarPrioridades };
}

module.exports = { registrar, HORAS_PRIORIDAD };
