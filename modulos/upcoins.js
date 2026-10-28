/**
 * UpCoins (UC): la única moneda de UpGames. 1 UC = US$0,02 (50 UC = US$1).
 *
 * Un usuario tiene UpCoins de dos orígenes, que en la app se ven como un solo total:
 *   - comprados o de regalo → campo `monedas` (en UC). Se gastan dentro de UpGames,
 *     pero NO se retiran como dinero (evita lavado con tarjetas robadas y contracargos).
 *   - ganados como creador → campo `saldo` (en USD, con decimales exactos). Se gastan
 *     igual y además se pueden retirar como dinero real.
 * Al pagar se usan primero los comprados y luego los ganados. Si hay un retiro
 * pendiente, lo ganado está reservado para ese pago y no se puede gastar.
 */
'use strict';

const L = require('./live');
const UC_USD = L.MONEDA_USD;
const r4 = n => Math.round(n * 10000) / 10000;

/** Total de UpCoins y su desglose a partir del documento del usuario. */
function saldoUC(u = {}) {
    const compradas = Math.max(0, Math.floor(u.monedas || 0));
    const ganadas = r4(Math.max(0, (u.saldo || 0) / UC_USD));
    const retenidas = r4(Math.max(0, (u.saldoRetenido || 0) / UC_USD));
    const bloqueadas = !!u.solicitudPagoPendiente;
    return { total: r4(compradas + (bloqueadas ? 0 : ganadas)), compradas, ganadas, retenidas, retirables: ganadas, bloqueadas, ucUsd: UC_USD };
}

/**
 * Cobra `uc` UpCoins de forma atómica. Devuelve { deCompradas, deGanadas } o null si
 * no alcanza (o la cuenta está restringida). `devolver` deshace el cobro exacto.
 */
async function cobrar(Usuario, usuario, uc) {
    uc = Math.ceil(uc);
    if (!(uc > 0)) return { deCompradas: 0, deGanadas: 0 };
    const disponibles = { $add: [{ $ifNull: ['$monedas', 0] }, { $cond: [{ $eq: ['$solicitudPagoPendiente', true] }, 0, { $divide: [{ $ifNull: ['$saldo', 0] }, UC_USD] }] }] };
    const antes = await Usuario.findOneAndUpdate(
        { usuario, listaNegraAdmin: { $ne: true }, $expr: { $gte: [disponibles, uc - 1e-9] } },
        [{ $set: {
            // Las dos expresiones leen el documento ORIGINAL (misma etapa $set)
            saldo: { $max: [0, { $subtract: [{ $ifNull: ['$saldo', 0] }, { $multiply: [{ $max: [0, { $subtract: [uc, { $ifNull: ['$monedas', 0] }] }] }, UC_USD] }] }] },
            monedas: { $max: [0, { $subtract: [{ $ifNull: ['$monedas', 0] }, uc] }] },
        } }],
        { new: false }).select('monedas saldo').lean();
    if (!antes) return null;
    const deCompradas = Math.min(uc, Math.max(0, antes.monedas || 0));
    return { deCompradas, deGanadas: uc - deCompradas };
}
async function devolver(Usuario, usuario, cobro) {
    if (!cobro) return;
    await Usuario.updateOne({ usuario }, { $inc: { monedas: cobro.deCompradas || 0, saldo: r4((cobro.deGanadas || 0) * UC_USD) } });
}
/** Mensaje claro cuando no alcanza. */
async function motivoSinSaldo(Usuario, usuario, uc) {
    const u = await Usuario.findOne({ usuario }).select('monedas saldo solicitudPagoPendiente listaNegraAdmin').lean();
    if (u?.listaNegraAdmin) return 'Tu cuenta no puede hacer pagos';
    const s = saldoUC(u || {});
    if (s.bloqueadas && s.compradas < uc && s.compradas + s.ganadas >= uc) return 'Tienes un retiro pendiente: tus UpCoins ganados están reservados para ese pago hasta que se procese.';
    return `Necesitas ${uc} UpCoins y tienes ${Math.floor(s.total)}`;
}

/**
 * Migración única: antes 1 moneda valía US$0,01; ahora 1 UC vale US$0,02. Se divide
 * a la mitad redondeando a favor del usuario. Idempotente (marca ucv = 2 por usuario).
 */
async function migrar(Usuario, logger) {
    const r = await Usuario.updateMany({ ucv: { $ne: 2 } },
        [{ $set: { monedas: { $ceil: { $divide: [{ $ifNull: ['$monedas', 0] }, 2] } }, ucv: 2 } }]);
    if (r.modifiedCount) logger?.info?.(`[upcoins] ${r.modifiedCount} cuenta(s) convertidas a UpCoins (1 UC = US$${UC_USD})`);
    return r.modifiedCount;
}

module.exports = { UC_USD, saldoUC, cobrar, devolver, motivoSinSaldo, migrar };
