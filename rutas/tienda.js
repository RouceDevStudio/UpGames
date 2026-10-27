/**
 * Tienda de UpGames: un catálogo y una entrega para todos los métodos de pago.
 *
 * Productos:  monedas:<paquete>  ·  acceso:<juegoId>  ·  plan:<pase7|pase30|pase365>
 * Métodos:    tarjeta (Mercado Pago) · PayPal · monedas · saldo de UpGames
 *
 * Reglas:
 * - El precio lo calcula SIEMPRE el servidor a partir del producto.
 * - Cada cobro tiene una referencia única (LiveTx.ref): repetir la petición, el
 *   webhook o un doble clic nunca entrega dos veces.
 * - Los pases son PREPAGO: no hay cobros automáticos. Renovar o cambiar de plan
 *   suma días al vencimiento actual.
 * - El saldo no se puede gastar mientras hay un retiro pendiente (ese dinero ya
 *   está comprometido con el pago solicitado).
 */
'use strict';

const mongoose = require('mongoose');
const L = require('../modulos/live');
const MP = require('../modulos/mercadopago');

const PLANES = [
    { id: 'pase7',   nombre: 'Pase 7 días',  dias: 7,   usd: 1.99,  monedas: 199,  monedasRegalo: 50,   resumen: 'Ideal para probar' },
    { id: 'pase30',  nombre: 'Pase 30 días', dias: 30,  usd: 4.99,  monedas: 499,  monedasRegalo: 200,  resumen: 'El más elegido', destacado: true },
    { id: 'pase365', nombre: 'Pase 1 año',   dias: 365, usd: 39.99, monedas: 3999, monedasRegalo: 2500, resumen: 'Ahorra 33%' },
];
// Beneficios que todos los pases tienen mientras están vigentes (se muestran en la tienda y en "Mi plan")
const BENEFICIOS_PASE = [
    'Enlaces directos: sin los 30 s de espera',
    'Sin publicidad en la página puente',
    'Monedas de regalo al comprar o renovar',
    '+10% de monedas extra en cada paquete que compres',
    'Insignia ⭐ junto a tu nombre en el chat de los lives',
];
const BONO_PAQUETE = 0.10;
const plan = id => PLANES.find(p => p.id === id) || null;
const r2 = n => Math.round(n * 100) / 100;

/** Producto → descripción interna (null si no existe). */
function parsear(producto) {
    const s = String(producto || '');
    let m;
    if ((m = /^monedas:(p\d+)$/.exec(s)) && L.paquete(m[1])) return { tipo: 'monedas', paquete: L.paquete(m[1]), id: s };
    if ((m = /^acceso:([a-f\d]{24})$/i.exec(s))) return { tipo: 'acceso', juegoId: m[1].toLowerCase(), id: s };
    if ((m = /^plan:(\w+)$/.exec(s)) && plan(m[1])) return { tipo: 'plan', plan: plan(m[1]), id: s };
    return null;
}
/** Precio en USD según el método: con saldo/monedas las monedas valen su valor nominal (sin comisión de pasarela). */
function precioUsd(p, metodo) {
    if (p.tipo === 'monedas') return metodo === 'saldo' ? r2(p.paquete.monedas * L.MONEDA_USD) : p.paquete.usd;
    if (p.tipo === 'acceso') return 1;
    return p.plan.usd;
}
const descripcion = p => p.tipo === 'monedas' ? `${p.paquete.monedas} monedas UpGames` : p.tipo === 'acceso' ? 'Acceso directo UpGames (sin anuncios)' : `${p.plan.nombre} UpGames (sin anuncios)`;

function registrar(app, deps) {
    const { verificarToken, Usuario, LiveTx, Notificacion, paypal, acceso, logger, apiUrlSelf } = deps;
    const olvidarPerfil = deps.olvidarPerfil || (() => {});
    const mp = deps.mp || MP.crear();
    const ok = (res, d) => res.json({ success: true, ...d });
    const err = (res, code, error, extra) => res.status(code).json({ success: false, error, ...extra });

    // Credenciales de Mercado Pago verificadas al arrancar (como PayPal)
    const revisarMP = () => mp.verificar().then(e => {
        if (e.ok) logger.info(`[pagos] Mercado Pago verificado (${e.sitio}, ${e.moneda}${e.prueba ? ', MODO PRUEBA' : ''}) ✓ · US$1 = ${mp.tasa()} ${e.moneda}${mp.tasaConfigurada() ? '' : ' (tasa de respaldo: define MERCADOPAGO_TASA_USD)'}`);
        else if (e.motivo === 'sin_configurar') logger.info('[pagos] Mercado Pago sin configurar');
        else logger.error(`[pagos] MERCADO PAGO DESACTIVADO — ${e.detalle}`);
    }).catch(() => {});
    revisarMP();
    setInterval(() => { if (mp.configurado() && !mp.activo()) revisarMP(); }, 10 * 60000).unref();

    const metodos = () => ({
        tarjeta: mp.activo() ? 'mercadopago' : (paypal.activo() ? 'paypal' : null),
        paypal: paypal.activo(),
        mercadopago: mp.activo() ? { publicKey: mp.publicKey(), moneda: mp.estado().moneda, tasa: mp.tasa() } : null,
    });

    // ── Entrega (idempotente por ref) ───────────────────────────────────────
    async function entregar(usuario, p, { ref, captureId = '', metodo, usd }) {
        if (p.tipo === 'monedas') {
            // Con un pase vigente cada paquete trae un 10% extra
            const yo = await Usuario.findOne({ usuario }).select('planHasta').lean();
            const bono = yo?.planHasta && new Date(yo.planHasta) > new Date() ? Math.floor(p.paquete.monedas * BONO_PAQUETE) : 0;
            const total = p.paquete.monedas + bono;
            try { await LiveTx.create({ tipo: 'compra', usuario, monedas: total, bonoMonedas: bono, usd, ref, captureId, metodo, estado: 'completada' }); }
            catch (e) { if (e.code !== 11000) throw e; const u = await Usuario.findOne({ usuario }).select('monedas').lean(); return { monedas: u?.monedas || 0, repetida: true }; }
            const u = await Usuario.findOneAndUpdate({ usuario }, { $inc: { monedas: total } }, { new: true }).select('monedas').lean();
            logger.info(`[tienda] @${usuario}: +${total} monedas${bono ? ` (incluye ${bono} de bono del pase)` : ''} (${metodo}, US$${usd})`);
            return { monedas: u?.monedas || 0, acreditadas: total, bono };
        }
        if (p.tipo === 'acceso') {
            const via = { paypal: 'tarjeta_paypal', tarjeta_mp: 'tarjeta_mp', saldo: 'saldo' }[metodo] || 'tarjeta_mp';
            return acceso.entregarPagado({ usuario, juegoId: p.juegoId, ref, captureId, via, metodo });
        }
        // Pase: suma días desde el vencimiento actual (o desde ahora si ya venció)
        const regalo = p.plan.monedasRegalo || 0;
        try { await LiveTx.create({ tipo: 'plan', usuario, monedas: metodo === 'monedas' ? p.plan.monedas : 0, bonoMonedas: regalo, usd, planId: p.plan.id, ref, captureId, metodo, estado: 'completada' }); }
        catch (e) { if (e.code !== 11000) throw e; const u = await Usuario.findOne({ usuario }).select('planId planHasta monedas').lean(); return { plan: u?.planId, hasta: u?.planHasta, monedas: u?.monedas || 0, repetida: true }; }
        const u = await Usuario.findOneAndUpdate({ usuario }, [{ $set: {
            planId: p.plan.id,
            planHasta: { $add: [{ $max: ['$$NOW', { $ifNull: ['$planHasta', '$$NOW'] }] }, p.plan.dias * 864e5] },
            planAvisadoHasta: null,
            monedas: { $add: [{ $ifNull: ['$monedas', 0] }, regalo] },
        } }], { new: true }).select('planId planHasta monedas').lean();
        olvidarPerfil(usuario);   // la insignia ⭐ del chat aparece al instante
        logger.info(`[tienda] @${usuario}: ${p.plan.nombre} (${metodo}) +${regalo} monedas de regalo → vence ${u?.planHasta?.toISOString?.().slice(0, 10)}`);
        return { plan: u?.planId, hasta: u?.planHasta, monedas: u?.monedas || 0, monedasRegalo: regalo };
    }

    /** Anula una compra reembolsada o con contracargo (Mercado Pago o PayPal). */
    async function revertir(captureId, motivo) {
        const tx = await LiveTx.findOneAndUpdate({ captureId, tipo: { $in: ['compra', 'acceso', 'plan'] }, estado: { $ne: 'revertida' } }, { $set: { estado: 'revertida' } }).lean();
        if (!tx) return false;
        if (tx.tipo === 'compra') await Usuario.updateOne({ usuario: tx.usuario }, [{ $set: { monedas: { $max: [0, { $subtract: [{ $ifNull: ['$monedas', 0] }, tx.monedas] }] } } }]);
        if (tx.tipo === 'acceso') {
            if (tx.estado === 'retenida') await Usuario.updateOne({ usuario: tx.destinatario }, [{ $set: { saldoRetenido: { $max: [0, { $subtract: [{ $ifNull: ['$saldoRetenido', 0] }, tx.creadorUsd] }] } } }]);
            await mongoose.connection.collection('accesos_directos').deleteOne({ usuario: tx.usuario, juegoId: tx.juegoId }).catch(() => {});
        }
        if (tx.tipo === 'plan') {
            await Usuario.updateOne({ usuario: tx.usuario }, [{ $set: { planHasta: '$$NOW', monedas: { $max: [0, { $subtract: [{ $ifNull: ['$monedas', 0] }, tx.bonoMonedas || 0] }] } } }]);
            olvidarPerfil(tx.usuario);
        }
        await Usuario.updateOne({ usuario: tx.usuario }, { $set: { listaNegraAdmin: true, notasAdmin: `Reembolso/contracargo (${motivo}) de ${tx.tipo}`, fechaListaNegra: new Date() } });
        logger.warn(`[tienda] ${motivo}: ${tx.tipo} de @${tx.usuario} revertido (${captureId})`);
        return true;
    }

    async function validarCompra(usuario, p) {
        if (!p) return 'Producto no válido';
        if (p.tipo === 'acceso') {
            const j = await acceso.cargarJuego(p.juegoId);
            if (!j) return 'Publicación no disponible';
            if (j.usuario === usuario) return 'Es tu propia publicación';
            if (await acceso.Acceso.exists({ usuario, juegoId: p.juegoId })) return 'Ya tienes acceso directo a esta publicación';
        }
        return null;
    }

    // ── Catálogo ────────────────────────────────────────────────────────────
    app.get('/tienda/catalogo', (req, res) => {
        const m = metodos();
        ok(res, {
            planes: PLANES, beneficios: BENEFICIOS_PASE, bonoPaquete: BONO_PAQUETE, paquetes: L.PAQUETES, acceso: { usd: 1, monedas: 100 }, monedaUsd: L.MONEDA_USD,
            metodos: m,
            pagos: m.tarjeta ? 'ok' : (paypal.estado().motivo === 'credenciales_invalidas' || mp.estado().motivo === 'credenciales_invalidas' ? 'credenciales_invalidas' : 'sin_configurar'),
            // Precios en moneda local para la tarjeta (Mercado Pago)
            local: m.mercadopago ? Object.fromEntries([
                ...L.PAQUETES.map(p => [`monedas:${p.id}`, mp.montoLocal(p.usd)]),
                ...PLANES.map(p => [`plan:${p.id}`, mp.montoLocal(p.usd)]),
                ['acceso', mp.montoLocal(1)],
            ]) : null,
        });
    });

    // ── Mi plan ─────────────────────────────────────────────────────────────
    app.get('/tienda/mi-plan', verificarToken, async (req, res) => {
        try {
            const u = await Usuario.findOne({ usuario: req.usuario }).select('planId planHasta planRecordatorio saldo monedas solicitudPagoPendiente').lean();
            if (!u) return err(res, 404, 'Usuario no encontrado');
            const activo = !!(u.planHasta && new Date(u.planHasta) > new Date());
            const [historial, accesos, conPase] = await Promise.all([
                LiveTx.find({ usuario: req.usuario, tipo: { $in: ['plan', 'acceso', 'compra'] }, metodo: { $ne: 'pase' } }).sort({ fecha: -1 }).limit(25)
                    .select('-_id tipo planId juegoId monedas usd metodo estado fecha').lean(),
                acceso.Acceso.countDocuments({ usuario: req.usuario }),
                activo ? LiveTx.countDocuments({ usuario: req.usuario, metodo: 'pase', fecha: { $gte: new Date(Date.now() - 30 * 864e5) } }) : 0,
            ]);
            ok(res, {
                plan: activo ? { ...plan(u.planId), hasta: u.planHasta, diasRestantes: Math.ceil((new Date(u.planHasta) - Date.now()) / 864e5) } : null,
                vencido: !activo && u.planHasta ? { id: u.planId, nombre: plan(u.planId)?.nombre, hasta: u.planHasta } : null,
                recordatorio: u.planRecordatorio !== false,
                saldo: u.saldo || 0, saldoBloqueado: !!u.solicitudPagoPendiente, monedas: u.monedas || 0,
                accesosComprados: accesos, descargasConPase30d: conPase,
                historial, planes: PLANES, beneficios: BENEFICIOS_PASE, metodos: metodos(),
            });
        } catch (e) { logger.error(`[tienda] mi-plan: ${e.message}`); err(res, 500, 'Error al cargar tu plan'); }
    });
    app.put('/tienda/mi-plan/recordatorio', verificarToken, async (req, res) => {
        const activo = req.body?.activo === true;
        await Usuario.updateOne({ usuario: req.usuario }, { $set: { planRecordatorio: activo } }).catch(() => {});
        ok(res, { recordatorio: activo });
    });

    // ── Pagar con saldo o monedas (instantáneo) ─────────────────────────────
    const enCurso = new Map();
    async function pagarInterno(usuario, p, metodo, clave) {
        const ref = `${metodo}:${usuario}:${clave}`;
        const previa = await LiveTx.findOne({ ref }).select('_id').lean();
        if (previa) return [200, { repetida: true }];
        const problema = await validarCompra(usuario, p);
        if (problema) return [409, { error: problema }];
        let costo, filtro, cambio, devolver;
        if (metodo === 'saldo') {
            costo = precioUsd(p, 'saldo');
            filtro = { usuario, saldo: { $gte: costo }, solicitudPagoPendiente: { $ne: true }, listaNegraAdmin: { $ne: true } };
            cambio = { $inc: { saldo: -costo } }; devolver = { $inc: { saldo: costo } };
        } else {
            if (p.tipo !== 'plan') return [400, { error: 'Con monedas puedes pagar pases (el acceso directo se paga con monedas desde la página del enlace)' }];
            costo = p.plan.monedas;
            filtro = { usuario, monedas: { $gte: costo }, listaNegraAdmin: { $ne: true } };
            cambio = { $inc: { monedas: -costo } }; devolver = { $inc: { monedas: costo } };
        }
        const pagador = await Usuario.findOneAndUpdate(filtro, cambio, { new: true }).select('saldo monedas').lean();
        if (!pagador) {
            const u = await Usuario.findOne({ usuario }).select('saldo monedas solicitudPagoPendiente listaNegraAdmin').lean();
            if (u?.listaNegraAdmin) return [403, { error: 'Tu cuenta no puede hacer pagos' }];
            if (metodo === 'saldo' && u?.solicitudPagoPendiente) return [409, { error: 'Tienes un retiro pendiente: tu saldo está reservado para ese pago hasta que se procese.' }];
            return [402, { error: metodo === 'saldo' ? `Saldo insuficiente: necesitas US$${costo.toFixed(2)} y tienes US$${(u?.saldo || 0).toFixed(2)}` : `Necesitas ${costo} monedas y tienes ${u?.monedas || 0}` }];
        }
        try {
            const entrega = await entregar(usuario, p, { ref, metodo, usd: metodo === 'saldo' ? costo : r2(costo * L.MONEDA_USD) });
            if (entrega.repetida) { await Usuario.updateOne({ usuario }, devolver); return [200, entrega]; }
            return [200, { ...entrega, saldo: pagador.saldo, monedas: entrega.monedas ?? pagador.monedas }];
        } catch (e) {
            await Usuario.updateOne({ usuario }, devolver);   // no se entregó: devolver lo cobrado
            throw e;
        }
    }
    app.post('/tienda/pagar', verificarToken, async (req, res) => {
        try {
            const p = parsear(req.body?.producto);
            const metodo = req.body?.metodo;
            const clave = String(req.body?.clave || '');
            if (!p) return err(res, 400, 'Producto no válido');
            if (!['saldo', 'monedas'].includes(metodo)) return err(res, 400, 'Método no válido');
            if (!/^[A-Za-z0-9_-]{8,64}$/.test(clave)) return err(res, 400, 'Falta la clave del pago');
            const k = `${req.usuario}:${clave}`;
            if (!enCurso.has(k)) enCurso.set(k, pagarInterno(req.usuario, p, metodo, clave).finally(() => enCurso.delete(k)));
            const [code, body] = await enCurso.get(k);
            code === 200 ? ok(res, body) : err(res, code, body.error);
        } catch (e) { logger.error(`[tienda] pagar: ${e.message}`); err(res, e.status || 500, e.status ? e.message : 'No se pudo completar el pago'); }
    });

    // ── PayPal (cualquier producto) ─────────────────────────────────────────
    app.post('/tienda/paypal/orden', verificarToken, async (req, res) => {
        try {
            if (!paypal.activo()) return err(res, 503, 'PayPal no está disponible en este momento');
            const p = parsear(req.body?.producto);
            const problema = await validarCompra(req.usuario, p);
            if (problema) return err(res, 409, problema);
            ok(res, { orderID: await paypal.crearOrden({ usuario: req.usuario, referencia: p.id, usd: precioUsd(p, 'paypal'), descripcion: descripcion(p) }) });
        } catch (e) { logger.error(`[tienda] paypal orden: ${e.message} ${e.detalle || ''}`); err(res, e.status || 500, e.status ? e.message : 'No se pudo crear la orden'); }
    });
    app.post('/tienda/paypal/capturar', verificarToken, async (req, res) => {
        try {
            if (!paypal.activo()) return err(res, 503, 'PayPal no está disponible en este momento');
            const orderID = String(req.body?.orderID || '');
            const ref = `paypal:${orderID}`;
            const previa = await LiveTx.findOne({ ref }).lean();
            if (previa) { if (previa.usuario !== req.usuario) return err(res, 403, 'Esta orden no es tuya'); return ok(res, { repetida: true }); }
            const { captura, referencia } = await paypal.capturar(orderID, { usuario: req.usuario, validarRef: r => !!parsear(r), usd: r => precioUsd(parsear(r), 'paypal') });
            const p = parsear(referencia);
            ok(res, await entregar(req.usuario, p, { ref, captureId: captura.id || '', metodo: 'paypal', usd: precioUsd(p, 'paypal') }));
        } catch (e) {
            if (e.status) { if (e.detalle) logger.warn(`[tienda] paypal captura: ${e.detalle}`); return err(res, e.status, e.message, e.reintentar ? { reintentar: true } : undefined); }
            logger.error(`[tienda] paypal capturar: ${e.message}`); err(res, 500, 'Error al confirmar el pago');
        }
    });

    // ── Mercado Pago: tarjeta con Card Payment Brick ────────────────────────
    const notificacionMP = () => (apiUrlSelf && /^https:/.test(apiUrlSelf)) ? `${apiUrlSelf}/pagos/mercadopago/webhook` : undefined;
    app.post('/pagos/mp/pagar', verificarToken, async (req, res) => {
        try {
            if (!mp.activo()) return err(res, 503, 'El pago con tarjeta no está disponible en este momento');
            const p = parsear(req.body?.producto);
            const clave = String(req.body?.clave || '');
            if (!/^[A-Za-z0-9_-]{8,64}$/.test(clave)) return err(res, 400, 'Falta la clave del pago');
            const problema = await validarCompra(req.usuario, p);
            if (problema) return err(res, 409, problema);
            const u = await Usuario.findOne({ usuario: req.usuario }).select('email listaNegraAdmin').lean();
            if (!u || u.listaNegraAdmin) return err(res, 403, 'Tu cuenta no puede hacer pagos');
            const usd = precioUsd(p, 'tarjeta_mp');
            const pago = await mp.pagar({
                formData: req.body?.formData, monto: mp.montoLocal(usd), descripcion: descripcion(p),
                referencia: `${req.usuario}|${p.id}`, idempotencia: `ug-${req.usuario}-${clave}`.slice(0, 64),
                notificacion: notificacionMP(), email: u.email,
            });
            if (pago.status === 'approved') {
                const entrega = await entregar(req.usuario, p, { ref: `mp:${pago.id}`, captureId: `mp:${pago.id}`, metodo: 'tarjeta_mp', usd });
                return ok(res, { estado: 'aprobado', ...entrega });
            }
            if (pago.status === 'in_process' || pago.status === 'pending' || pago.status === 'authorized') {
                logger.info(`[tienda] Pago MP ${pago.id} de @${req.usuario} pendiente (${pago.detalle})`);
                return ok(res, { estado: 'pendiente', mensaje: 'Tu banco está revisando el pago. Te lo entregaremos apenas se apruebe (suele tardar minutos).' });
            }
            return err(res, 402, MP.traducirRechazo(pago.detalle), { detalle: pago.detalle });
        } catch (e) {
            if (e.status) { if (e.detalle) logger.warn(`[tienda] MP: ${e.detalle}`); return err(res, e.status, e.message); }
            logger.error(`[tienda] MP pagar: ${e.message}`); err(res, 500, 'No se pudo completar el pago');
        }
    });

    // Webhook: se consulta el pago a Mercado Pago con NUESTRO token, así que un
    // aviso falso no puede aprobar nada. Entrega pendientes y revierte reembolsos.
    app.post('/pagos/mercadopago/webhook', async (req, res) => {
        res.sendStatus(200);   // responder rápido: Mercado Pago reintenta si tarda
        try {
            if (!mp.activo()) return;
            const tipo = req.body?.type || req.body?.topic || req.query.type || req.query.topic;
            const id = req.body?.data?.id || req.query['data.id'] || req.query.id;
            if (tipo !== 'payment' || !/^\d{5,20}$/.test(String(id || ''))) return;
            const pago = await mp.obtener(id);
            if (!pago) return;
            const [usuario, producto] = String(pago.referencia || '').split('|');
            const p = parsear(producto);
            if (!usuario || !p) return;
            if (pago.status === 'approved') {
                // El monto cobrado debe coincidir con el precio actual del producto
                if (Math.abs(pago.monto - mp.montoLocal(precioUsd(p, 'tarjeta_mp'))) > 1) return logger.warn(`[tienda] MP ${id}: monto ${pago.monto} no coincide con ${p.id}`);
                await entregar(usuario, p, { ref: `mp:${pago.id}`, captureId: `mp:${pago.id}`, metodo: 'tarjeta_mp', usd: precioUsd(p, 'tarjeta_mp') });
            } else if (['refunded', 'charged_back', 'cancelled'].includes(pago.status)) {
                await revertir(`mp:${pago.id}`, `Mercado Pago ${pago.status}`);
            }
        } catch (e) { logger.error(`[tienda] webhook MP: ${e.message}`); }
    });

    // ── Recordatorio de vencimiento del pase (2 días antes, uno por periodo) ──
    async function recordar() {
        try {
            const ahora = new Date();
            const pronto = await Usuario.find({ planHasta: { $gt: ahora, $lte: new Date(Date.now() + 2 * 864e5) }, planRecordatorio: { $ne: false } })
                .select('usuario planId planHasta planAvisadoHasta').limit(500).lean();
            const avisar = pronto.filter(u => !u.planAvisadoHasta || +new Date(u.planAvisadoHasta) !== +new Date(u.planHasta));
            if (!avisar.length) return;
            await Notificacion.insertMany(avisar.map(u => ({ destinatario: u.usuario, tipo: 'sistema', emisor: 'UpGames', itemTitle: 'Tu pase vence', leida: false, fecha: new Date(),
                mensaje: `⏳ Tu ${plan(u.planId)?.nombre || 'pase'} vence el ${new Date(u.planHasta).toLocaleDateString('es-CO')}. Renuévalo para seguir sin anuncios (no hay cobros automáticos).` })), { ordered: false });
            for (const u of avisar) await Usuario.updateOne({ usuario: u.usuario }, { $set: { planAvisadoHasta: u.planHasta } });
            logger.info(`[tienda] Recordatorio de vencimiento enviado a ${avisar.length} usuario(s)`);
        } catch (e) { logger.warn(`[tienda] recordar: ${e.message}`); }
    }
    setTimeout(recordar, 120000).unref();
    setInterval(recordar, 60 * 60000).unref();

    return { PLANES, parsear, precioUsd, entregar, revertir, mp, metodos };
}

module.exports = { registrar, PLANES, BENEFICIOS_PASE, BONO_PAQUETE, parsear, precioUsd };
