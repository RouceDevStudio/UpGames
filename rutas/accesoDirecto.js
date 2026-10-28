/**
 * Acceso directo: pagar US$1 (tarjeta o PayPal) o 100 monedas para saltarse la
 * página puente (espera + anuncios) y abrir el enlace al instante.
 *
 * - Se paga UNA vez por publicación: después el enlace queda desbloqueado para
 *   siempre en esa cuenta (registro en `accesos_directos`).
 * - El creador recibe ACCESO_CREADOR (30% por defecto) del precio, retenido
 *   LIVE_RETENCION_DIAS como los regalos, y la descarga le cuenta.
 * - Las transacciones viven en la misma colección que las del live (LiveTx),
 *   así que la liberación, el reverso por contracargo y el retiro las cubren.
 */
'use strict';

const mongoose = require('mongoose');
const L = require('../modulos/live');

const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const PRECIO_USD     = 1.00;
const PRECIO_MONEDAS = Math.round(PRECIO_USD / L.MONEDA_USD);   // 100
const REPARTO        = require('../modulos/reparto');
const PARTE_CREADOR  = REPARTO.ACCESO_CREADOR;   // 25 %
// Con un pase activo, la primera vez que un usuario abre una publicación paga esto a su
// creador, descontado del fondo para creadores que generó su pase (nunca más del 25 % del precio)
const PASE_CREADOR_USD = REPARTO.PASE_POR_APERTURA;
const PASE_TOPE_DIA    = Math.max(0, num(process.env.PASE_TOPE_DIA, 30));   // descargas con pase que pagan al creador, por usuario y día

const AccesoSchema = new mongoose.Schema({
    usuario: { type: String, required: true },
    juegoId: { type: String, required: true },
    via:     { type: String, enum: ['monedas', 'tarjeta_paypal', 'tarjeta_mp', 'saldo'], required: true },
    fecha:   { type: Date, default: Date.now },
}, { collection: 'accesos_directos', timestamps: false });
AccesoSchema.index({ usuario: 1, juegoId: 1 }, { unique: true });
const Acceso = mongoose.models.Acceso || mongoose.model('Acceso', AccesoSchema);

function registrar(app, { verificarToken, Juego, Usuario, LiveTx, paypal, mp, logger }) {
    const tarjetaActiva = () => paypal.activo() || !!mp?.activo();
    const ok = (res, d) => res.json({ success: true, ...d });
    const err = (res, code, error, extra) => res.status(code).json({ success: false, error, ...extra });
    const r4 = n => Math.round(n * 10000) / 10000;

    async function cargarJuego(id) {
        if (!mongoose.isValidObjectId(id)) return null;
        const j = await Juego.findById(id).select('link usuario status title category').lean();
        return j && j.status === 'aprobado' && j.link ? j : null;
    }

    // Abona al creador su parte (retenida) y le suma la descarga
    async function abonarCreador(juego, tx) {
        const retener = L.RETENCION_DIAS > 0;
        await Usuario.updateOne({ usuario: juego.usuario }, { $inc: retener ? { saldoRetenido: tx.creadorUsd } : { saldo: tx.creadorUsd } });
        Juego.updateOne({ _id: juego._id }, { $inc: { descargasEfectivas: 1 } }).catch(() => {});
    }
    const datosTx = (juego, usuario, extra) => {
        const creadorUsd = r4(PRECIO_USD * PARTE_CREADOR);
        const retener = L.RETENCION_DIAS > 0;
        return {
            tipo: 'acceso', usuario, destinatario: juego.usuario, monedas: PRECIO_MONEDAS, usd: PRECIO_USD,
            creadorUsd, plataformaUsd: r4(PRECIO_USD - creadorUsd), juegoId: String(juego._id),
            estado: retener ? 'retenida' : 'liberada', liberarEn: retener ? new Date(Date.now() + L.RETENCION_DIAS * 864e5) : null,
            ...extra,
        };
    };
    const desbloquear = (usuario, juegoId, via) =>
        Acceso.updateOne({ usuario, juegoId }, { $setOnInsert: { via, fecha: new Date() } }, { upsert: true }).catch(e => { if (e.code !== 11000) throw e; });

    // Estado: precio, saldo de monedas y, si ya está desbloqueado, el enlace
    app.get('/acceso-directo/:id', verificarToken, async (req, res) => {
        try {
            const juego = await cargarJuego(req.params.id);
            if (!juego) return err(res, 404, 'Publicación no disponible');
            const [acc, u] = await Promise.all([
                Acceso.exists({ usuario: req.usuario, juegoId: String(juego._id) }),
                Usuario.findOne({ usuario: req.usuario }).select('monedas saldo planId planHasta solicitudPagoPendiente').lean(),
            ]);
            const propio = juego.usuario === req.usuario;
            const pase = u?.planHasta && new Date(u.planHasta) > new Date() ? { plan: u.planId, hasta: u.planHasta } : null;
            ok(res, {
                desbloqueado: !!acc || propio, link: acc || propio ? juego.link : undefined,
                precioUsd: PRECIO_USD, precioMonedas: PRECIO_MONEDAS, monedas: u?.monedas || 0,
                saldo: u?.solicitudPagoPendiente ? 0 : (u?.saldo || 0),
                pase, pagosActivos: tarjetaActiva(),
            });
        } catch (e) { logger.error(`[acceso] estado: ${e.message}`); err(res, 500, 'Error al consultar el acceso'); }
    });

    // Pagar con monedas (instantáneo). Clics simultáneos del mismo usuario sobre la
    // misma publicación comparten UN resultado (si no, el segundo vería "sin monedas"
    // justo después de que el primero pagara). La ref única en BD sigue impidiendo
    // el doble cobro aunque hubiera varias instancias.
    const enCurso = new Map();
    async function pagarConMonedas(usuario, juego) {
        const juegoId = String(juego._id);
        if (juego.usuario === usuario || await Acceso.exists({ usuario, juegoId })) return [200, { link: juego.link, yaDesbloqueado: true }];
        const pagador = await Usuario.findOneAndUpdate(
            { usuario, monedas: { $gte: PRECIO_MONEDAS }, listaNegraAdmin: { $ne: true } },
            { $inc: { monedas: -PRECIO_MONEDAS } }, { new: true }).select('monedas').lean();
        if (!pagador) {
            const u = await Usuario.findOne({ usuario }).select('monedas listaNegraAdmin').lean();
            if (u?.listaNegraAdmin) return [403, { error: 'Tu cuenta no puede hacer pagos' }];
            return [402, { error: 'No tienes monedas suficientes', monedas: u?.monedas || 0 }];
        }
        let tx;
        try {
            tx = await LiveTx.create(datosTx(juego, usuario, { ref: `acceso:${usuario}:${juegoId}` }));
        } catch (e) {
            await Usuario.updateOne({ usuario }, { $inc: { monedas: PRECIO_MONEDAS } });   // ya estaba pagado: devolver
            if (e.code === 11000) { await desbloquear(usuario, juegoId, 'monedas'); return [200, { link: juego.link, yaDesbloqueado: true, monedas: pagador.monedas + PRECIO_MONEDAS }]; }
            throw e;
        }
        await desbloquear(usuario, juegoId, 'monedas');
        await abonarCreador(juego, tx);
        logger.info(`[acceso] @${usuario} desbloqueó ${juegoId} con monedas`);
        return [200, { link: juego.link, monedas: pagador.monedas }];
    }
    app.post('/acceso-directo/:id/monedas', verificarToken, async (req, res) => {
        try {
            const juego = await cargarJuego(req.params.id);
            if (!juego) return err(res, 404, 'Publicación no disponible');
            const clave = `${req.usuario}:${juego._id}`;
            if (!enCurso.has(clave)) enCurso.set(clave, pagarConMonedas(req.usuario, juego).finally(() => enCurso.delete(clave)));
            const [code, body] = await enCurso.get(clave);
            code === 200 ? ok(res, body) : err(res, code, body.error, { monedas: body.monedas });
        } catch (e) { logger.error(`[acceso] monedas: ${e.message}`); err(res, 500, 'No se pudo completar el pago'); }
    });

    // Pagar US$1 con tarjeta o PayPal
    app.post('/acceso-directo/:id/orden', verificarToken, async (req, res) => {
        try {
            if (!paypal.activo()) return err(res, 503, 'Los pagos con tarjeta aún no están disponibles');
            const juego = await cargarJuego(req.params.id);
            if (!juego) return err(res, 404, 'Publicación no disponible');
            if (juego.usuario === req.usuario || await Acceso.exists({ usuario: req.usuario, juegoId: String(juego._id) })) return err(res, 409, 'Ya tienes acceso directo a este enlace');
            const orderID = await paypal.crearOrden({ usuario: req.usuario, referencia: `acceso:${juego._id}`, usd: PRECIO_USD, descripcion: `Acceso directo: ${juego.title || 'enlace'}` });
            ok(res, { orderID });
        } catch (e) { logger.error(`[acceso] orden: ${e.message} ${e.detalle || ''}`); err(res, e.status || 500, e.status ? e.message : 'No se pudo crear la orden'); }
    });

    app.post('/acceso-directo/:id/capturar', verificarToken, async (req, res) => {
        try {
            if (!paypal.activo()) return err(res, 503, 'Los pagos con tarjeta aún no están disponibles');
            const juego = await cargarJuego(req.params.id);
            if (!juego) return err(res, 404, 'Publicación no disponible');
            const juegoId = String(juego._id);
            const orderID = String(req.body?.orderID || '');
            const ref = `paypal:${orderID}`;
            const previa = await LiveTx.findOne({ ref }).lean();
            if (previa) {
                if (previa.usuario !== req.usuario || previa.juegoId !== juegoId) return err(res, 403, 'Esta orden no es tuya');
                return ok(res, { link: juego.link, repetida: true });
            }
            const { captura } = await paypal.capturar(orderID, { usuario: req.usuario, validarRef: r => r === `acceso:${juegoId}`, usd: PRECIO_USD });
            let tx;
            try {
                tx = await LiveTx.create(datosTx(juego, req.usuario, { ref, captureId: captura.id || '', monedas: 0 }));
            } catch (e) {
                if (e.code !== 11000) throw e;
                return ok(res, { link: juego.link, repetida: true });
            }
            await desbloquear(req.usuario, juegoId, 'tarjeta_paypal');
            await abonarCreador(juego, tx);
            logger.info(`[acceso] @${req.usuario} desbloqueó ${juegoId} con tarjeta/PayPal (orden ${orderID})`);
            ok(res, { link: juego.link });
        } catch (e) {
            if (e.status) { if (e.detalle) logger.warn(`[acceso] captura ${req.body?.orderID}: ${e.detalle}`); return err(res, e.status, e.message, e.reintentar ? { reintentar: true } : undefined); }
            logger.error(`[acceso] capturar: ${e.message}`); err(res, 500, 'Error al confirmar el pago');
        }
    });

    /** Entrega un acceso ya cobrado (tarjeta, PayPal o saldo). Idempotente por ref. */
    async function entregarPagado({ usuario, juegoId, ref, captureId = '', via, metodo }) {
        const juego = await cargarJuego(juegoId);
        if (!juego) { const e = new Error('Publicación no disponible'); e.status = 404; throw e; }
        try {
            const tx = await LiveTx.create(datosTx(juego, usuario, { ref, captureId, monedas: 0, metodo }));
            await desbloquear(usuario, String(juego._id), via);
            await abonarCreador(juego, tx);
            logger.info(`[acceso] @${usuario} desbloqueó ${juego._id} (${metodo})`);
        } catch (e) {
            if (e.code !== 11000) throw e;   // ya entregado antes: devolver el enlace igual
            await desbloquear(usuario, String(juego._id), via);
        }
        return { link: juego.link };
    }

    // Con un pase activo: enlace directo. El creador cobra PASE_CREADOR_USD una vez al
    // día por usuario y publicación (retenido como los regalos) y la descarga le cuenta.
    app.post('/acceso-directo/:id/pase', verificarToken, async (req, res) => {
        try {
            const juego = await cargarJuego(req.params.id);
            if (!juego) return err(res, 404, 'Publicación no disponible');
            const u = await Usuario.findOne({ usuario: req.usuario }).select('planHasta planId').lean();
            if (!u?.planHasta || new Date(u.planHasta) <= new Date()) return err(res, 402, 'No tienes un pase activo', { sinPase: true });
            // El creador cobra una vez por usuario y publicación, con tope diario por usuario:
            // así un pase no sirve para "ordeñar" las publicaciones de un cómplice.
            const hoy = new Date(); hoy.setUTCHours(0, 0, 0, 0);
            const pagadasHoy = juego.usuario !== req.usuario && PASE_CREADOR_USD > 0
                ? await LiveTx.countDocuments({ usuario: req.usuario, metodo: 'pase', fecha: { $gte: hoy } }) : Infinity;
            // Solo si al pase le queda fondo para creadores (se descuenta de forma atómica)
            const conFondo = pagadasHoy < PASE_TOPE_DIA && !(await LiveTx.exists({ ref: `pase:${req.usuario}:${juego._id}` }))
                && await Usuario.findOneAndUpdate({ usuario: req.usuario, paseFondoUsd: { $gte: PASE_CREADOR_USD } }, { $inc: { paseFondoUsd: -PASE_CREADOR_USD } }).select('_id').lean();
            if (conFondo) {
                const retener = L.RETENCION_DIAS > 0;
                let creada = false;
                try {
                    await LiveTx.create({
                        tipo: 'acceso', usuario: req.usuario, destinatario: juego.usuario, monedas: 0, usd: 0, metodo: 'pase', planId: u.planId,
                        creadorUsd: PASE_CREADOR_USD, plataformaUsd: 0, juegoId: String(juego._id), ref: `pase:${req.usuario}:${juego._id}`,
                        estado: retener ? 'retenida' : 'liberada', liberarEn: retener ? new Date(Date.now() + L.RETENCION_DIAS * 864e5) : null,
                    });
                    creada = true;
                } catch (e) {
                    await Usuario.updateOne({ usuario: req.usuario }, { $inc: { paseFondoUsd: PASE_CREADOR_USD } });   // no se pagó: devolver al fondo
                    if (e.code !== 11000) throw e;   // ya contó antes (doble clic)
                }
                if (creada) {
                    await Usuario.updateOne({ usuario: juego.usuario }, { $inc: retener ? { saldoRetenido: PASE_CREADOR_USD } : { saldo: PASE_CREADOR_USD } });
                    Juego.updateOne({ _id: juego._id }, { $inc: { descargasEfectivas: 1 } }).catch(() => {});
                }
            }
            ok(res, { link: juego.link, hasta: u.planHasta });
        } catch (e) { logger.error(`[acceso] pase: ${e.message}`); err(res, 500, 'No se pudo abrir el enlace'); }
    });

    logger.info(`[acceso] Acceso directo activo · US$${PRECIO_USD} o ${PRECIO_MONEDAS} monedas · creador ${Math.round(PARTE_CREADOR * 100)}% · pase: US$${PASE_CREADOR_USD}/descarga al creador (máx. ${PASE_TOPE_DIA}/usuario/día)`);
    return { Acceso, PRECIO_USD, PRECIO_MONEDAS, PARTE_CREADOR, entregarPagado, cargarJuego };
}

module.exports = { registrar, PRECIO_USD, PRECIO_MONEDAS };
