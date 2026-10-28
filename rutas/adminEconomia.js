/**
 * Panel admin → Economía: UpCoins, ventas, Premium, NEXUS y publicaciones destacadas.
 *
 *   GET  /admin/finanzas/economia                 resumen completo (finanzas o estadísticas)
 *   PUT  /admin/finanzas/usuarios/:id/upcoins     fija los UpCoins comprados/regalo de una cuenta
 *   PUT  /admin/finanzas/usuarios/:id/premium     suma días de Premium (o lo quita con dias = 0)
 *
 * Un sub-admin no puede usarlos sobre el dueño, otros admins ni su propia cuenta (adminPanel.objetivoProtegido).
 *
 * Las ventas se leen de live_transacciones (LiveTx). "Con dinero" = tarjeta o PayPal;
 * lo pagado con UpCoins es consumo de la moneda, no un ingreso nuevo.
 */
'use strict';

const L = require('../modulos/live');
const REPARTO = require('../modulos/reparto');
const { PLANES, PAQUETES_IA, IMPULSO, BONO_PAQUETE } = require('./tienda');

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const PAGO_UC = ['upcoins', 'monedas', 'saldo', 'pase'];

/** Clasifica una transacción: producto vendido y si se pagó con dinero real. */
function clasificar(tx) {
    const conUC = PAGO_UC.includes(tx.metodo) || (tx.tipo === 'acceso' && tx.monedas > 0);
    let producto;
    if (tx.tipo === 'regalo') producto = 'regalo';
    else if (tx.tipo === 'plan') producto = 'premium';
    else if (tx.tipo === 'acceso') producto = tx.metodo === 'pase' ? 'apertura_premium' : 'acceso';
    else if (/^ia/.test(tx.planId || '')) producto = 'nexus';
    else if (/^impulso/.test(tx.planId || '')) producto = 'destacar';
    else producto = 'paquete';
    return { producto, conDinero: tx.tipo !== 'regalo' && !conUC };
}

// Expresión de agregación equivalente a clasificar() (para sumar en MongoDB)
const EXPR_PRODUCTO = { $switch: { branches: [
    { case: { $eq: ['$tipo', 'regalo'] }, then: 'regalo' },
    { case: { $eq: ['$tipo', 'plan'] }, then: 'premium' },
    { case: { $and: [{ $eq: ['$tipo', 'acceso'] }, { $eq: ['$metodo', 'pase'] }] }, then: 'apertura_premium' },
    { case: { $eq: ['$tipo', 'acceso'] }, then: 'acceso' },
    { case: { $regexMatch: { input: { $ifNull: ['$planId', ''] }, regex: /^ia/ } }, then: 'nexus' },
    { case: { $regexMatch: { input: { $ifNull: ['$planId', ''] }, regex: /^impulso/ } }, then: 'destacar' },
], default: 'paquete' } };
const EXPR_DINERO = { $and: [
    { $ne: ['$tipo', 'regalo'] },
    { $not: [{ $in: [{ $ifNull: ['$metodo', ''] }, PAGO_UC] }] },
    { $not: [{ $and: [{ $eq: ['$tipo', 'acceso'] }, { $gt: ['$monedas', 0] }] }] },
] };

function registrar(app, deps) {
    const { verificarAdmin, Usuario, Juego, LiveTx, Pago, Notificacion, logger, limpiarCache, olvidarPerfil } = deps;
    const ok = (res, d) => res.json({ success: true, ...d });
    const err = (res, code, error) => res.status(code).json({ success: false, error });
    const hoyCol = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);   // día en hora de Colombia
    const avisar = (destinatario, itemTitle, mensaje) => Notificacion?.create?.({ destinatario, tipo: 'sistema', emisor: 'UpGames', itemTitle, mensaje, leida: false, fecha: new Date() }).catch(() => {});

    app.get('/admin/finanzas/economia', verificarAdmin, async (req, res) => {
        try {
            const ahora = new Date();
            const dia = new Date(ahora - 864e5), mes = new Date(ahora - 30 * 864e5), semanaSig = new Date(+ahora + 7 * 864e5);
            const valido = { estado: { $ne: 'revertida' } };
            const ventasDesde = desde => LiveTx.aggregate([
                { $match: { ...valido, fecha: { $gte: desde } } },
                { $group: { _id: { producto: EXPR_PRODUCTO, dinero: EXPR_DINERO, metodo: '$metodo' }, n: { $sum: 1 }, usd: { $sum: '$usd' }, uc: { $sum: '$monedas' }, creador: { $sum: '$creadorUsd' } } },
            ]);
            const [circ, ventasTodo, ventas30, ventas24, revertidas, premium, porPlan, vencen, iaHoy, iaCred, destacadas, ultimas, pagos] = await Promise.all([
                Usuario.aggregate([{ $group: { _id: null, compradas: { $sum: '$monedas' }, ganadasUsd: { $sum: '$saldo' }, retenidoUsd: { $sum: '$saldoRetenido' }, fondoPase: { $sum: '$paseFondoUsd' } } }]),
                ventasDesde(new Date(0)), ventasDesde(mes), ventasDesde(dia),
                LiveTx.aggregate([{ $match: { estado: 'revertida' } }, { $group: { _id: null, n: { $sum: 1 }, usd: { $sum: '$usd' } } }]),
                Usuario.find({ planHasta: { $gt: ahora } }).select('usuario planId planHasta').sort({ planHasta: 1 }).limit(300).lean(),
                Usuario.aggregate([{ $match: { planHasta: { $gt: ahora } } }, { $group: { _id: '$planId', n: { $sum: 1 } } }]),
                Usuario.countDocuments({ planHasta: { $gt: ahora, $lte: semanaSig } }),
                Usuario.aggregate([{ $match: { 'iaUso.dia': hoyCol() } }, { $group: { _id: null, usuarios: { $sum: 1 }, mensajes: { $sum: { $add: [{ $ifNull: ['$iaUso.usados', 0] }, { $ifNull: ['$iaUso.premium', 0] }] } } } }]),
                Usuario.aggregate([{ $match: { iaCreditos: { $gt: 0 } } }, { $group: { _id: null, usuarios: { $sum: 1 }, creditos: { $sum: '$iaCreditos' } } }]),
                Juego.find({ destacadoHasta: { $gt: ahora } }).select('title usuario destacadoHasta').sort({ destacadoHasta: 1 }).limit(100).lean(),
                LiveTx.find({ tipo: { $ne: 'regalo' } }).sort({ fecha: -1 }).limit(60).select('tipo usuario destinatario monedas usd metodo planId juegoId estado fecha bonoMonedas').lean(),
                Pago ? Pago.aggregate([{ $group: { _id: '$estado', n: { $sum: 1 }, usd: { $sum: '$monto' } } }]) : [],
            ]);

            // Resumen de un periodo: ingresos con dinero por producto y consumo de UpCoins
            const resumir = filas => {
                const r = { ingresosUsd: 0, ventas: 0, porProducto: {}, porMetodo: {}, ucGastados: 0, ucRegalados: 0, paraCreadoresUsd: 0 };
                for (const f of filas) {
                    const { producto, dinero, metodo } = f._id;
                    if (dinero) {
                        r.ingresosUsd += f.usd; r.ventas += f.n;
                        const p = (r.porProducto[producto] ||= { n: 0, usd: 0 }); p.n += f.n; p.usd += f.usd;
                        const m = { tarjeta_mp: 'Tarjeta (Mercado Pago)', paypal: 'PayPal', tarjeta_paypal: 'Tarjeta (PayPal)' }[metodo] || 'PayPal';
                        const pm = (r.porMetodo[m] ||= { n: 0, usd: 0 }); pm.n += f.n; pm.usd += f.usd;
                    } else if (producto === 'regalo') r.ucRegalados += f.uc;
                    else if (producto !== 'apertura_premium') {
                        r.ucGastados += f.uc;
                        const p = (r.porProducto['uc_' + producto] ||= { n: 0, uc: 0 }); p.n += f.n; p.uc += f.uc;
                    }
                    r.paraCreadoresUsd += f.creador || 0;
                }
                r.ingresosUsd = r2(r.ingresosUsd); r.paraCreadoresUsd = r2(r.paraCreadoresUsd);
                for (const v of Object.values(r.porProducto)) if (v.usd != null) v.usd = r2(v.usd);
                for (const v of Object.values(r.porMetodo)) v.usd = r2(v.usd);
                return r;
            };
            const c = circ[0] || {};
            const ucUsd = L.MONEDA_USD;
            const pagosPor = Object.fromEntries((pagos || []).map(p => [p._id, { n: p.n, usd: r2(p.usd) }]));

            ok(res, {
                ucUsd,
                circulacion: {
                    compradas: Math.floor(c.compradas || 0),
                    ganadas: Math.floor((c.ganadasUsd || 0) / ucUsd),
                    ganadasUsd: r2(c.ganadasUsd), retenidasUsd: r2(c.retenidoUsd), fondoPremiumUsd: r2(c.fondoPase),
                    // Lo comprado no se retira: solo lo ganado es deuda real en dinero con los creadores
                    deudaRetirableUsd: r2((c.ganadasUsd || 0) + (c.retenidoUsd || 0)),
                },
                periodos: { hoy: resumir(ventas24), mes: resumir(ventas30), total: resumir(ventasTodo) },
                revertidas: { n: revertidas[0]?.n || 0, usd: r2(revertidas[0]?.usd) },
                premium: {
                    activos: premium.length, vencen7dias: vencen,
                    porPlan: Object.fromEntries(porPlan.map(p => [p._id || 'otro', p.n])),
                    lista: premium.map(u => ({ usuario: u.usuario, planId: u.planId, hasta: u.planHasta })),
                },
                nexus: {
                    gratisDia: Math.max(0, parseInt(process.env.IA_GRATIS_DIA, 10) || 10),
                    usuariosHoy: iaHoy[0]?.usuarios || 0, mensajesHoy: iaHoy[0]?.mensajes || 0,
                    creditosCirculando: iaCred[0]?.creditos || 0, usuariosConCreditos: iaCred[0]?.usuarios || 0,
                },
                destacadas: destacadas.map(j => ({ id: j._id, titulo: j.title, usuario: j.usuario, hasta: j.destacadoHasta })),
                ultimas: ultimas.map(t => ({ ...clasificar(t), usuario: t.usuario, destinatario: t.destinatario, uc: t.monedas, usd: r2(t.usd), metodo: t.metodo, planId: t.planId, estado: t.estado, fecha: t.fecha, bono: t.bonoMonedas || 0 })),
                retiros: pagosPor,
                catalogo: {
                    paquetes: L.PAQUETES, premium: PLANES, nexus: PAQUETES_IA, destacar: IMPULSO, bonoPremium: BONO_PAQUETE,
                    regalos: L.REGALOS, accesoDirecto: { usd: 1, uc: Math.round(1 / ucUsd) },
                    cpmUsd: require('../modulos/config').CPM_VALUE,
                },
                reparto: REPARTO.publico(),
            });
        } catch (e) {
            logger.error(`[admin] economía: ${e.message}`);
            err(res, 500, 'No se pudo cargar la economía');
        }
    });

    // UpCoins comprados/regalo (no retirables). Lo ganado se ajusta con "Ajustar saldo".
    app.put('/admin/finanzas/usuarios/:id/upcoins', verificarAdmin, async (req, res) => {
        const uc = Number(req.body?.upcoins), motivo = String(req.body?.motivo || '').trim().slice(0, 200);
        if (!/^[a-f\d]{24}$/i.test(req.params.id)) return err(res, 400, 'ID no válido');
        if (!Number.isInteger(uc) || uc < 0 || uc > 10_000_000) return err(res, 400, 'Cantidad de UpCoins no válida');
        if (!motivo) return err(res, 400, 'Escribe el motivo del ajuste');
        try {
            const antes = await Usuario.findByIdAndUpdate(req.params.id, { $set: { monedas: uc } }, { new: false }).select('usuario monedas').lean();
            if (!antes) return err(res, 404, 'Usuario no encontrado');
            const dif = uc - (antes.monedas || 0);
            logger.info(`ADMIN @${req.admin?.usuario || '?'}: UpCoins de @${antes.usuario} ${antes.monedas || 0} → ${uc} (${motivo})`);
            if (dif > 0) avisar(antes.usuario, 'UpCoins', `🪙 UpGames te acreditó ${dif.toLocaleString('es-CO')} UpCoins. Motivo: ${motivo}`);
            ok(res, { usuario: antes.usuario, monedas: uc });
        } catch (e) { logger.error(`[admin] upcoins: ${e.message}`); err(res, 500, 'No se pudo ajustar'); }
    });

    // Premium de cortesía o corrección: suma días desde el vencimiento actual; dias = 0 lo quita.
    app.put('/admin/finanzas/usuarios/:id/premium', verificarAdmin, async (req, res) => {
        const dias = Number(req.body?.dias), motivo = String(req.body?.motivo || '').trim().slice(0, 200);
        if (!/^[a-f\d]{24}$/i.test(req.params.id)) return err(res, 400, 'ID no válido');
        if (!Number.isInteger(dias) || dias < 0 || dias > 3650) return err(res, 400, 'Días no válidos (0 a 3650)');
        if (!motivo) return err(res, 400, 'Escribe el motivo');
        try {
            const set = dias === 0
                ? { planHasta: null, planId: '' }
                : { planId: { $cond: [{ $gt: [{ $ifNull: ['$planHasta', new Date(0)] }, '$$NOW'] }, '$planId', 'cortesia'] },
                    planHasta: { $add: [{ $max: ['$$NOW', { $ifNull: ['$planHasta', '$$NOW'] }] }, dias * 864e5] }, planAvisadoHasta: null };
            const u = await Usuario.findByIdAndUpdate(req.params.id, [{ $set: set }], { new: true }).select('usuario planId planHasta').lean();
            if (!u) return err(res, 404, 'Usuario no encontrado');
            olvidarPerfil?.(u.usuario);
            await Juego.updateMany({ usuario: u.usuario }, { $set: { impulsoHasta: u.planHasta || null } }).catch(() => {});
            limpiarCache?.();
            logger.info(`ADMIN @${req.admin?.usuario || '?'}: Premium de @${u.usuario} ${dias ? `+${dias} días → ${u.planHasta?.toISOString?.().slice(0, 10)}` : 'retirado'} (${motivo})`);
            if (dias) avisar(u.usuario, 'Premium', `⭐ UpGames te regaló ${dias} día(s) de Premium. Activo hasta el ${new Date(u.planHasta).toLocaleDateString('es-CO')}.`);
            ok(res, { usuario: u.usuario, planId: u.planId, planHasta: u.planHasta });
        } catch (e) { logger.error(`[admin] premium: ${e.message}`); err(res, 500, 'No se pudo cambiar Premium'); }
    });
}

module.exports = { registrar, clasificar };
