/**
 * Acceso directo: saltarse la página puente (espera + anuncios) y abrir el enlace
 * al instante. Desde la v7.0 de los Términos es SOLO un beneficio de Premium:
 * ya no se vende por publicación, para que ningún pago quede atado a un enlace.
 *
 * - Los accesos comprados antes siguen desbloqueados en esa cuenta
 *   (registro en `accesos_directos`).
 * - `entregarPagado` solo completa pagos con tarjeta ya cobrados antes del cambio.
 * - Las transacciones viven en la misma colección que las del live (LiveTx),
 *   así que la liberación, el reverso por contracargo y el retiro las cubren.
 */
'use strict';

const StatsItems = require('../modulos/statsItems');
const mongoose = require('mongoose');
const L = require('../modulos/live');

const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const PRECIO_USD     = 1.00;
const PRECIO_MONEDAS = Math.round(PRECIO_USD / L.MONEDA_USD);   // 50 UpCoins
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

function registrar(app, { verificarToken, Juego, Usuario, LiveTx, logger }) {
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
        StatsItems.sumar(String(juego._id), juego.usuario, { d: 1, g: tx.creadorUsd });
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

    // Estado: si ya está desbloqueado (acceso comprado antes o publicación propia), el
    // enlace; y si el usuario tiene Premium, que es lo único que salta la espera.
    app.get('/acceso-directo/:id', verificarToken, async (req, res) => {
        try {
            const juego = await cargarJuego(req.params.id);
            if (!juego) return err(res, 404, 'Publicación no disponible');
            const [acc, u] = await Promise.all([
                Acceso.exists({ usuario: req.usuario, juegoId: String(juego._id) }),
                Usuario.findOne({ usuario: req.usuario }).select('planId planHasta').lean(),
            ]);
            const propio = juego.usuario === req.usuario;
            const pase = u?.planHasta && new Date(u.planHasta) > new Date() ? { plan: u.planId, hasta: u.planHasta } : null;
            ok(res, { desbloqueado: !!acc || propio, link: acc || propio ? juego.link : undefined, pase, soloPremium: true });
        } catch (e) { logger.error(`[acceso] estado: ${e.message}`); err(res, 500, 'Error al consultar el acceso'); }
    });

    // La compra de acceso directo POR PUBLICACIÓN se retiró: ningún pago queda atado a
    // un enlace concreto. Saltar la espera es solo un beneficio de Premium (global, igual
    // para todas las publicaciones). Los accesos comprados antes se siguen respetando
    // (GET de arriba) y `entregarPagado` queda para pagos con tarjeta ya cobrados.
    const VENTA_RETIRADA = 'El acceso directo por publicación ya no se vende. Con Premium te saltas la espera y los anuncios en todas las publicaciones.';
    app.post(['/acceso-directo/:id/monedas', '/acceso-directo/:id/orden', '/acceso-directo/:id/capturar'], verificarToken,
        (req, res) => err(res, 410, VENTA_RETIRADA, { soloPremium: true }));

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
                    StatsItems.sumar(String(juego._id), juego.usuario, { d: 1, g: PASE_CREADOR_USD });
                }
            }
            ok(res, { link: juego.link, hasta: u.planHasta });
        } catch (e) { logger.error(`[acceso] pase: ${e.message}`); err(res, 500, 'No se pudo abrir el enlace'); }
    });

    logger.info(`[acceso] Acceso directo solo con Premium · pase: US$${PASE_CREADOR_USD}/descarga al creador (máx. ${PASE_TOPE_DIA}/usuario/día)`);
    return { Acceso, PRECIO_USD, PRECIO_MONEDAS, PARTE_CREADOR, entregarPagado, cargarJuego };
}

module.exports = { registrar, PRECIO_USD, PRECIO_MONEDAS };
