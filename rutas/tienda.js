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
const REPARTO = require('../modulos/reparto');
const UC = require('../modulos/upcoins');
const Extras = require('../modulos/extras');

// Premium. `monedas` = precio en UpCoins; `monedasRegalo` = UpCoins de regalo, SOLO si se paga con dinero
const PLANES = [
    { id: 'pase7',   nombre: 'Premium 7 días',  dias: 7,   usd: 1.99,  monedas: 100,  monedasRegalo: 25,   resumen: 'Ideal para probar' },
    { id: 'pase30',  nombre: 'Premium 30 días', dias: 30,  usd: 4.99,  monedas: 250,  monedasRegalo: 100,  resumen: 'El más elegido', destacado: true },
    { id: 'pase365', nombre: 'Premium 1 año',   dias: 365, usd: 39.99, monedas: 2000, monedasRegalo: 1250, resumen: 'Ahorra 33%' },
];
// Beneficios de Premium mientras está vigente (se muestran en la tienda y en "Mi plan")
const BENEFICIOS_PASE = [
    'Enlaces directos: sin los 30 s de espera',
    'Sin publicidad en la página puente',
    'NEXUS IA ilimitado y con el modelo más potente',
    'Más visibilidad para tus publicaciones en el inicio',
    'UpCoins de regalo al pagar con dinero',
    '+10% de UpCoins extra en cada paquete que compres',
    'Insignia ⭐ junto a tu nombre en el chat de los lives',
];
const BONO_PAQUETE = 0.10;
// Créditos de NEXUS (mensajes extra cuando se acaban los gratis del día)
const PAQUETES_IA = [
    { id: 'ia5',  mensajes: 5,  monedas: 5 },
    { id: 'ia25', mensajes: 25, monedas: 20, extra: 'Ahorra 20%' },
];
// Destacar una publicación (aparece arriba en el inicio, marcada como "Promocionado")
const IMPULSO = { horas: 24, monedas: 50 };
const plan = id => PLANES.find(p => p.id === id) || null;
// Premium dado desde el panel admin (cortesía, soporte): mismos beneficios, sin precio
const nombrePlan = id => plan(id)?.nombre || (id === 'cortesia' ? 'Premium (cortesía)' : 'Premium');
const paqueteIA = id => PAQUETES_IA.find(p => p.id === id) || null;
const r2 = n => Math.round(n * 100) / 100;
const SOLO_UC = ['ia', 'impulso'];   // productos que solo se pagan con UpCoins

/** Producto → descripción interna (null si no existe). */
function parsear(producto) {
    const s = String(producto || '');
    let m;
    if ((m = /^monedas:(p\d+)$/.exec(s)) && L.paquete(m[1])) return { tipo: 'monedas', paquete: L.paquete(m[1]), id: s };
    if ((m = /^acceso:([a-f\d]{24})$/i.exec(s))) return { tipo: 'acceso', juegoId: m[1].toLowerCase(), id: s };
    if ((m = /^plan:(\w+)$/.exec(s)) && plan(m[1])) return { tipo: 'plan', plan: plan(m[1]), id: s };
    if ((m = /^ia:(\w+)$/.exec(s)) && paqueteIA(m[1])) return { tipo: 'ia', paquete: paqueteIA(m[1]), id: s };
    if ((m = /^impulso:([a-f\d]{24})$/i.exec(s))) return { tipo: 'impulso', juegoId: m[1].toLowerCase(), id: s };
    return null;
}
/** Precio en UpCoins (null si ese producto no se puede pagar con UpCoins). */
function precioUC(p) {
    if (p.tipo === 'acceso') return Math.round(1 / L.MONEDA_USD);
    if (p.tipo === 'plan') return p.plan.monedas;
    if (p.tipo === 'ia') return p.paquete.monedas;
    if (p.tipo === 'impulso') return IMPULSO.monedas;
    return null;   // los paquetes de UpCoins se compran con dinero
}
/** Precio en USD al pagar con dinero (tarjeta o PayPal). */
function precioUsd(p) {
    if (p.tipo === 'monedas') return p.paquete.usd;
    if (p.tipo === 'acceso') return 1;
    if (p.tipo === 'plan') return p.plan.usd;
    return r2((precioUC(p) || 0) * L.MONEDA_USD);
}
const descripcion = p => p.tipo === 'monedas' ? `${p.paquete.monedas} UpCoins` : p.tipo === 'acceso' ? 'Acceso directo UpGames (sin anuncios)'
    : p.tipo === 'plan' ? `${p.plan.nombre} UpGames` : p.tipo === 'ia' ? `${p.paquete.mensajes} mensajes de NEXUS IA` : `Destacar publicación ${IMPULSO.horas} h`;

function registrar(app, deps) {
    const { verificarToken, Usuario, LiveTx, Notificacion, paypal, acceso, logger, apiUrlSelf, Juego } = deps;
    const limpiarCache = deps.limpiarCache;
    const avisar = (destinatario, itemTitle, mensaje) => Notificacion?.create?.({ destinatario, tipo: 'sistema', emisor: 'UpGames', itemTitle, mensaje, leida: false, fecha: new Date() }).catch(() => {});
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
    async function entregar(usuario, p, { ref, captureId = '', metodo, usd, para = '' }) {
        if (p.tipo === 'monedas') {
            // Con un pase vigente cada paquete trae un 10% extra
            const yo = await Usuario.findOne({ usuario }).select('planHasta').lean();
            const bono = yo?.planHasta && new Date(yo.planHasta) > new Date() ? REPARTO.bonoPaquete(p.paquete.monedas, p.paquete.usd, BONO_PAQUETE) : 0;
            const total = p.paquete.monedas + bono;
            try { await LiveTx.create({ tipo: 'compra', usuario, monedas: total, bonoMonedas: bono, usd, ref, captureId, metodo, estado: 'completada' }); }
            catch (e) { if (e.code !== 11000) throw e; const u = await Usuario.findOne({ usuario }).select('monedas').lean(); return { monedas: u?.monedas || 0, repetida: true }; }
            const u = await Usuario.findOneAndUpdate({ usuario }, { $inc: { monedas: total } }, { new: true }).select('monedas').lean();
            logger.info(`[tienda] @${usuario}: +${total} UpCoins${bono ? ` (incluye ${bono} de bono Premium)` : ''} (${metodo}, US$${usd})`);
            avisar(usuario, 'Compra', `🪙 ¡Has adquirido ${total.toLocaleString('es-CO')} UpCoins!${bono ? ` (incluye ${bono} extra por ser Premium)` : ''} Úsalos en lives, NEXUS IA, Premium o para destacar tus publicaciones.`);
            return { monedas: u?.monedas || 0, acreditadas: total, bono };
        }
        if (p.tipo === 'acceso') {
            const via = { paypal: 'tarjeta_paypal', tarjeta_mp: 'tarjeta_mp', upcoins: 'monedas' }[metodo] || 'tarjeta_mp';
            return acceso.entregarPagado({ usuario, juegoId: p.juegoId, ref, captureId, via, metodo });
        }
        if (p.tipo === 'ia') {
            try { await LiveTx.create({ tipo: 'compra', usuario, monedas: p.paquete.monedas, usd, ref, captureId, metodo, planId: p.id, estado: 'completada' }); }
            catch (e) { if (e.code !== 11000) throw e; return { repetida: true }; }
            const u = await Usuario.findOneAndUpdate({ usuario }, { $inc: { iaCreditos: p.paquete.mensajes } }, { new: true }).select('iaCreditos').lean();
            avisar(usuario, 'Compra', `🧠 Desbloqueaste ${p.paquete.mensajes} mensajes extra de NEXUS IA.`);
            return { iaCreditos: u?.iaCreditos || 0, mensajes: p.paquete.mensajes };
        }
        if (p.tipo === 'impulso') {
            try { await LiveTx.create({ tipo: 'compra', usuario, monedas: IMPULSO.monedas, usd, ref, captureId, metodo, juegoId: p.juegoId, planId: p.id, estado: 'completada' }); }
            catch (e) { if (e.code !== 11000) throw e; return { repetida: true }; }
            const j = await Juego.findOneAndUpdate({ _id: p.juegoId }, [{ $set: { destacadoHasta: { $add: [{ $max: ['$$NOW', { $ifNull: ['$destacadoHasta', '$$NOW'] }] }, IMPULSO.horas * 3600e3] } } }], { new: true }).select('title destacadoHasta').lean();
            limpiarCache?.();
            avisar(usuario, 'Compra', `🚀 "${String(j?.title || 'Tu publicación').slice(0, 60)}" está destacada hasta el ${new Date(j?.destacadoHasta).toLocaleString('es-CO')}.`);
            return { destacadoHasta: j?.destacadoHasta };
        }
        // Premium: suma días desde el vencimiento actual (o desde ahora si ya venció).
        // UpCoins de regalo solo si se pagó con dinero (pagado con UpCoins no regala UpCoins).
        const conUC = metodo === 'upcoins';
        const regalo = conUC ? 0 : (p.plan.monedasRegalo || 0);
        const monedasPagadas = conUC ? p.plan.monedas : 0;
        const fondo = REPARTO.fondoPase({ usd, monedas: monedasPagadas, metodo, monedasRegalo: regalo });   // para los creadores que abra con el pase
        const quien = para || usuario;   // Premium regalado: lo recibe `para`, lo paga `usuario`
        try { await LiveTx.create({ tipo: 'plan', usuario, destinatario: para, monedas: monedasPagadas, bonoMonedas: regalo, creadorUsd: fondo, plataformaUsd: Math.max(0, usd - fondo), usd, planId: p.plan.id, ref, captureId, metodo, estado: 'completada' }); }
        catch (e) { if (e.code !== 11000) throw e; const u = await Usuario.findOne({ usuario: quien }).select('planId planHasta monedas').lean(); return { plan: u?.planId, hasta: u?.planHasta, monedas: u?.monedas || 0, repetida: true }; }
        const u = await Usuario.findOneAndUpdate({ usuario: quien }, [{ $set: {
            planId: p.plan.id,
            planHasta: { $add: [{ $max: ['$$NOW', { $ifNull: ['$planHasta', '$$NOW'] }] }, p.plan.dias * 864e5] },
            planAvisadoHasta: null,
            monedas: { $add: [{ $ifNull: ['$monedas', 0] }, regalo] },
            paseFondoUsd: { $add: [{ $ifNull: ['$paseFondoUsd', 0] }, fondo] },
        } }], { new: true }).select('planId planHasta monedas').lean();
        olvidarPerfil(quien);   // la insignia ⭐ del chat aparece al instante
        // Más visibilidad: sus publicaciones suben en el inicio mientras dure Premium
        if (Juego && u?.planHasta) { Juego.updateMany({ usuario: quien }, { $set: { impulsoHasta: u.planHasta } }).then(() => limpiarCache?.()).catch(() => {}); }
        logger.info(`[tienda] @${quien}: ${p.plan.nombre} (${metodo}${para ? `, regalo de @${usuario}` : ''}) +${regalo} UpCoins de regalo → vence ${u?.planHasta?.toISOString?.().slice(0, 10)}`);
        if (para) {
            avisar(para, 'Premium', `🎁 ¡@${usuario} te regaló ${p.plan.nombre}! Activo hasta el ${new Date(u?.planHasta).toLocaleDateString('es-CO')}: sin anuncios, NEXUS ilimitado y más visibilidad.`);
            avisar(usuario, 'Compra', `🎁 Regalaste ${p.plan.nombre} a @${para}. Ya le avisamos.`);
            return { plan: u?.planId, hasta: u?.planHasta, para, monedasRegalo: 0 };
        }
        avisar(usuario, 'Premium', `⭐ ¡Has desbloqueado ${p.plan.nombre}! Activo hasta el ${new Date(u?.planHasta).toLocaleDateString('es-CO')}: sin anuncios, NEXUS ilimitado y más visibilidad.${regalo ? ` Además recibiste ${regalo.toLocaleString('es-CO')} UpCoins de regalo.` : ''}`);
        return { plan: u?.planId, hasta: u?.planHasta, monedas: u?.monedas || 0, monedasRegalo: regalo };
    }

    /** Anula una compra reembolsada o con contracargo (Mercado Pago o PayPal). */
    async function revertir(captureId, motivo, sancionar = true) {
        const tx = await LiveTx.findOneAndUpdate({ captureId, tipo: { $in: ['compra', 'acceso', 'plan'] }, estado: { $ne: 'revertida' } }, { $set: { estado: 'revertida' } }).lean();
        if (!tx) return false;
        if (tx.tipo === 'compra') await Usuario.updateOne({ usuario: tx.usuario }, [{ $set: { monedas: { $max: [0, { $subtract: [{ $ifNull: ['$monedas', 0] }, tx.monedas] }] } } }]);
        if (tx.tipo === 'acceso') {
            if (tx.estado === 'retenida') await Usuario.updateOne({ usuario: tx.destinatario }, [{ $set: { saldoRetenido: { $max: [0, { $subtract: [{ $ifNull: ['$saldoRetenido', 0] }, tx.creadorUsd] }] } } }]);
            await mongoose.connection.collection('accesos_directos').deleteOne({ usuario: tx.usuario, juegoId: tx.juegoId }).catch(() => {});
        }
        if (tx.tipo === 'plan') {
            await Usuario.updateOne({ usuario: tx.destinatario || tx.usuario }, [{ $set: { planHasta: '$$NOW',
                monedas: { $max: [0, { $subtract: [{ $ifNull: ['$monedas', 0] }, tx.bonoMonedas || 0] }] },
                paseFondoUsd: { $max: [0, { $subtract: [{ $ifNull: ['$paseFondoUsd', 0] }, tx.creadorUsd || 0] }] } } }]);
            olvidarPerfil(tx.destinatario || tx.usuario);
            if (Juego) await Juego.updateMany({ usuario: tx.destinatario || tx.usuario }, { $set: { impulsoHasta: null } }).catch(() => {});
        }
        if (sancionar) await Usuario.updateOne({ usuario: tx.usuario }, { $set: { listaNegraAdmin: true, notasAdmin: `Contracargo (${motivo}) de ${tx.tipo}`, fechaListaNegra: new Date() } });
        logger.warn(`[tienda] ${motivo}: ${tx.tipo} de @${tx.usuario} revertido (${captureId})`);
        return true;
    }

    async function validarCompra(usuario, p, metodo) {
        if (!p) return 'Producto no válido';
        if (SOLO_UC.includes(p.tipo) && metodo !== 'upcoins') return 'Esto se paga con UpCoins';
        if (p.tipo === 'monedas' && metodo === 'upcoins') return 'Los paquetes de UpCoins se compran con tarjeta o PayPal';
        if (p.tipo === 'impulso') {
            const j = await Juego.findById(p.juegoId).select('usuario status').lean();
            if (!j || j.usuario !== usuario) return 'Solo puedes destacar tus propias publicaciones';
            if (j.status !== 'aprobado') return 'La publicación debe estar aprobada para destacarla';
        }
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
            planes: PLANES, beneficios: BENEFICIOS_PASE, bonoPaquete: BONO_PAQUETE, reparto: REPARTO.publico(), paquetes: L.PAQUETES.map(p => ({ ...p, bonoPase: REPARTO.bonoPaquete(p.monedas, p.usd, BONO_PAQUETE) })), acceso: { usd: 1, monedas: Math.round(1 / L.MONEDA_USD) }, ia: PAQUETES_IA, impulso: IMPULSO, monedaUsd: L.MONEDA_USD,
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
            const u = await Usuario.findOne({ usuario: req.usuario }).select('planId planHasta planRecordatorio saldo saldoRetenido monedas solicitudPagoPendiente iaCreditos').lean();
            if (!u) return err(res, 404, 'Usuario no encontrado');
            const activo = !!(u.planHasta && new Date(u.planHasta) > new Date());
            const [historial, accesos, conPase] = await Promise.all([
                LiveTx.find({ usuario: req.usuario, tipo: { $in: ['plan', 'acceso', 'compra'] }, metodo: { $ne: 'pase' } }).sort({ fecha: -1 }).limit(25)
                    .select('-_id tipo planId juegoId monedas usd metodo estado fecha').lean(),
                acceso.Acceso.countDocuments({ usuario: req.usuario }),
                activo ? LiveTx.countDocuments({ usuario: req.usuario, metodo: 'pase', fecha: { $gte: new Date(Date.now() - 30 * 864e5) } }) : 0,
            ]);
            ok(res, {
                plan: activo ? { id: u.planId, ...plan(u.planId), nombre: nombrePlan(u.planId), hasta: u.planHasta, diasRestantes: Math.ceil((new Date(u.planHasta) - Date.now()) / 864e5) } : null,
                vencido: !activo && u.planHasta ? { id: u.planId, nombre: nombrePlan(u.planId), hasta: u.planHasta } : null,
                recordatorio: u.planRecordatorio !== false,
                saldo: u.saldo || 0, saldoBloqueado: !!u.solicitudPagoPendiente, monedas: u.monedas || 0, upcoins: UC.saldoUC(u), iaCreditos: u.iaCreditos || 0,
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
    async function pagarInterno(usuario, p, metodo, clave, para = '') {
        const ref = `${metodo}:${usuario}:${clave}`;
        const previa = await LiveTx.findOne({ ref }).select('_id').lean();
        if (previa) return [200, { repetida: true }];
        const problema = await validarCompra(usuario, p, metodo);
        if (problema) return [p.tipo === 'monedas' || problema === 'Esto se paga con UpCoins' ? 400 : 409, { error: problema }];
        const costo = precioUC(p);
        const cobro = await UC.cobrar(Usuario, usuario, costo);   // comprados primero, luego ganados
        if (!cobro) {
            const motivo = await UC.motivoSinSaldo(Usuario, usuario, costo);
            return [/cuenta no puede/.test(motivo) ? 403 : /retiro pendiente/.test(motivo) ? 409 : 402, { error: motivo }];
        }
        try {
            const entrega = await entregar(usuario, p, { ref, metodo, usd: r2(costo * L.MONEDA_USD), para });
            if (entrega.repetida) await UC.devolver(Usuario, usuario, cobro);
            const u = await Usuario.findOne({ usuario }).select('monedas saldo solicitudPagoPendiente').lean();
            return [200, { ...entrega, cobradoUC: costo, upcoins: UC.saldoUC(u || {}), monedas: Math.floor(UC.saldoUC(u || {}).total) }];
        } catch (e) {
            await UC.devolver(Usuario, usuario, cobro);   // no se entregó: devolver lo cobrado
            throw e;
        }
    }
    app.post('/tienda/pagar', verificarToken, async (req, res) => {
        try {
            const p = parsear(req.body?.producto);
            // 'saldo' y 'monedas' son nombres antiguos: ahora todo es UpCoins (comprados + ganados)
            const metodo = ['saldo', 'monedas', 'upcoins'].includes(req.body?.metodo) ? 'upcoins' : null;
            const clave = String(req.body?.clave || '');
            if (!p) return err(res, 400, 'Producto no válido');
            if (!metodo) return err(res, 400, 'Método no válido');
            if (!/^[A-Za-z0-9_-]{8,64}$/.test(clave)) return err(res, 400, 'Falta la clave del pago');
            // Regalar Premium a otra persona (solo con UpCoins)
            let para = '';
            if (req.body?.para) {
                if (p.tipo !== 'plan') return err(res, 400, 'Solo Premium se puede regalar');
                if (!(await Extras.config()).activo.regalarPremium) return err(res, 409, 'Regalar Premium está pausado');
                para = String(req.body.para).trim().toLowerCase().replace(/^@/, '');
                if (para === req.usuario) return err(res, 400, 'Para ti mismo, compra Premium normalmente');
                const dest = /^[a-z0-9_.-]{3,20}$/.test(para) ? await Usuario.findOne({ usuario: para }).select('suspendido').lean() : null;
                if (!dest || dest.suspendido) return err(res, 404, `No encontramos a @${para}`);
            }
            const k = `${req.usuario}:${clave}`;
            if (!enCurso.has(k)) enCurso.set(k, pagarInterno(req.usuario, p, metodo, clave, para).finally(() => enCurso.delete(k)));
            const [code, body] = await enCurso.get(k);
            code === 200 ? ok(res, body) : err(res, code, body.error);
        } catch (e) { logger.error(`[tienda] pagar: ${e.message}`); err(res, e.status || 500, e.status ? e.message : 'No se pudo completar el pago'); }
    });

    // ── PayPal (cualquier producto) ─────────────────────────────────────────
    app.post('/tienda/paypal/orden', verificarToken, async (req, res) => {
        try {
            if (!paypal.activo()) return err(res, 503, 'PayPal no está disponible en este momento');
            const p = parsear(req.body?.producto);
            const problema = await validarCompra(req.usuario, p, 'paypal');
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
            const problema = await validarCompra(req.usuario, p, 'tarjeta_mp');
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
                await revertir(`mp:${pago.id}`, `Mercado Pago ${pago.status}`, pago.status === 'charged_back');   // reembolso propio (retracto) no restringe la cuenta
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
            await Notificacion.insertMany(avisar.map(u => ({ destinatario: u.usuario, tipo: 'sistema', emisor: 'UpGames', itemTitle: 'Tu Premium vence', leida: false, fecha: new Date(),
                mensaje: `⏳ Tu ${nombrePlan(u.planId)} vence el ${new Date(u.planHasta).toLocaleDateString('es-CO')}. Renuévalo para seguir sin anuncios, con NEXUS ilimitado y más visibilidad (no hay cobros automáticos).` })), { ordered: false });
            for (const u of avisar) await Usuario.updateOne({ usuario: u.usuario }, { $set: { planAvisadoHasta: u.planHasta } });
            logger.info(`[tienda] Recordatorio de vencimiento enviado a ${avisar.length} usuario(s)`);
        } catch (e) { logger.warn(`[tienda] recordar: ${e.message}`); }
    }
    setTimeout(recordar, 120000).unref();
    setInterval(recordar, 60 * 60000).unref();

    return { PLANES, parsear, precioUsd, entregar, revertir, mp, metodos };
}

module.exports = { registrar, PLANES, BENEFICIOS_PASE, BONO_PAQUETE, PAQUETES_IA, IMPULSO, parsear, precioUsd, precioUC };
