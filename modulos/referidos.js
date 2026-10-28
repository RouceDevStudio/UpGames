/**
 * Referidos: invita a un amigo y ganan los dos.
 *
 *   1. El enlace es upgames.games/?ref=<tu usuario> (también sirven los códigos viejos de `referrals`).
 *   2. Al registrarse, la cuenta nueva queda con `referidoPor` y estado 'pendiente'.
 *   3. Cuando verifica su email, se paga UNA vez: UpCoins de regalo (no retirables) para
 *      quien invitó y para el invitado. Montos y tope mensual se editan en Admin → Extras UC.
 *
 * Anti-abuso: no se paga si el invitado se registra desde la misma IP que quien lo invitó
 * ('misma_red'), si quien invita está en lista negra o suspendido, ni por encima del tope
 * mensual ('tope': el invitado igual recibe su regalo de bienvenida).
 */
const mongoose = require('mongoose');

const inicioMes = () => { const d = new Date(Date.now() - 5 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) + 5 * 3600e3); };
const limpiar = r => String(r || '').trim().slice(0, 40);

/** Quién invita según el código (usuario o código viejo). null si no vale. */
async function resolver(Usuario, ref, nuevo) {
    const r = limpiar(ref); if (!r) return null;
    let u = await Usuario.findOne({ usuario: r.toLowerCase() }).select('usuario registrationIP listaNegraAdmin suspendido').lean();
    if (!u) {
        const viejo = await mongoose.connection.collection('referrals').findOne({ codigoReferral: r.toUpperCase() }).catch(() => null);
        if (viejo?.usuario) u = await Usuario.findOne({ usuario: viejo.usuario }).select('usuario registrationIP listaNegraAdmin suspendido').lean();
    }
    if (!u || u.usuario === nuevo) return null;
    return u;
}

/** Al crear la cuenta: deja la relación guardada (no paga nada todavía). */
async function alRegistrar(Usuario, nuevo, ref, ip) {
    try {
        const X = require('./extras'); const c = await X.config();
        if (!c.activo.referidos) return null;
        const inv = await resolver(Usuario, ref, nuevo);
        if (!inv) return null;
        const estado = inv.listaNegraAdmin || inv.suspendido ? 'bloqueado' : (ip && inv.registrationIP && ip === inv.registrationIP ? 'misma_red' : 'pendiente');
        await Usuario.updateOne({ usuario: nuevo, referidoPor: { $in: [null, ''] } }, { $set: { referidoPor: inv.usuario, referidoEstado: estado, referidoEn: new Date() } });
        return { invitador: inv.usuario, estado };
    } catch (_) { return null; }
}

/** Al verificar el email: paga una sola vez (atómico). */
async function alVerificar(Usuario, nuevo, { crearNotif, logger } = {}) {
    try {
        const r = await Usuario.findOneAndUpdate({ usuario: nuevo, referidoEstado: 'pendiente' }, { $set: { referidoEstado: 'procesando' } }, { new: true }).select('usuario referidoPor').lean();
        if (!r?.referidoPor) return null;
        const X = require('./extras'); const c = await X.config();
        const pInv = c.precios.refInvitador, pNuevo = c.precios.refInvitado;
        const pagadosMes = await Usuario.countDocuments({ referidoPor: r.referidoPor, referidoEstado: 'pagado', referidoPagadoEn: { $gte: inicioMes() } });
        const inv = await Usuario.findOne({ usuario: r.referidoPor }).select('usuario listaNegraAdmin suspendido').lean();
        const pagaInv = !!inv && !inv.listaNegraAdmin && !inv.suspendido && pagadosMes < c.precios.refMaxMes && pInv > 0;
        await Usuario.updateOne({ usuario: nuevo }, { $set: { referidoEstado: pagaInv ? 'pagado' : (inv ? 'tope' : 'bloqueado'), referidoPagadoEn: new Date() }, ...(pNuevo > 0 ? { $inc: { monedas: pNuevo } } : {}) });
        const LiveTx = mongoose.models.LiveTx;
        const tx = (usuario, monedas, ref) => LiveTx && monedas > 0 && LiveTx.create({ tipo: 'mision', usuario, monedas, usd: 0, planId: 'referido', metodo: 'mision', ref, estado: 'completada' }).catch(() => {});
        await tx(nuevo, pNuevo, `referido-bienvenida:${nuevo}`);
        if (pagaInv) {
            await Usuario.updateOne({ usuario: inv.usuario }, { $inc: { monedas: pInv } });
            // 5 invitados verificados → insignia Embajador (no se vende)
            if (await Usuario.countDocuments({ referidoPor: inv.usuario, referidoEstado: 'pagado' }) >= 5)
                await Usuario.updateOne({ usuario: inv.usuario, cosmeticos: { $ne: 'ins_embajador' } }, { $addToSet: { cosmeticos: 'ins_embajador' } });
            await tx(inv.usuario, pInv, `referido:${inv.usuario}:${nuevo}`);
            crearNotif?.({ destinatario: inv.usuario, tipo: 'sistema', emisor: nuevo, itemTitle: 'Referidos', mensaje: `🎉 @${nuevo} se unió con tu invitación: ganaste ${pInv} UpCoins` });
        }
        if (pNuevo > 0) crearNotif?.({ destinatario: nuevo, tipo: 'sistema', emisor: 'UpGames', itemTitle: 'Referidos', mensaje: `🎁 Bienvenido: por llegar invitado por @${r.referidoPor} recibiste ${pNuevo} UpCoins` });
        logger?.info(`[referidos] @${nuevo} verificó (invitó @${r.referidoPor}) · invitador ${pagaInv ? '+' + pInv : 'sin pago'} · invitado +${pNuevo}`);
        return { invitador: r.referidoPor, pagaInv };
    } catch (e) { logger?.warn(`[referidos] ${e.message}`); return null; }
}

/** Panel "Invita y gana" del usuario. */
async function resumen(Usuario, usuario) {
    const X = require('./extras'); const c = await X.config();
    const [lista, mes] = await Promise.all([
        Usuario.find({ referidoPor: usuario }).select('usuario referidoEstado referidoEn').sort({ referidoEn: -1 }).limit(50).lean(),
        Usuario.countDocuments({ referidoPor: usuario, referidoEstado: 'pagado', referidoPagadoEn: { $gte: inicioMes() } }),
    ]);
    const total = await Usuario.countDocuments({ referidoPor: usuario });
    const pagados = await Usuario.countDocuments({ referidoPor: usuario, referidoEstado: 'pagado' });
    const LiveTx = mongoose.models.LiveTx;
    const ganado = LiveTx ? (await LiveTx.aggregate([{ $match: { usuario, planId: 'referido', ref: { $regex: '^referido:' } } }, { $group: { _id: null, uc: { $sum: '$monedas' } } }]).catch(() => []))[0]?.uc || 0 : 0;
    return {
        activo: !!c.activo.referidos, codigo: usuario,
        recompensa: { invitador: c.precios.refInvitador, invitado: c.precios.refInvitado }, topeMes: c.precios.refMaxMes, pagadosMes: mes,
        total, pagados, ganadoUC: ganado,
        recientes: lista.map(x => ({ usuario: x.usuario, estado: x.referidoEstado || 'pendiente', fecha: x.referidoEn })),
    };
}

module.exports = { alRegistrar, alVerificar, resumen, resolver };
