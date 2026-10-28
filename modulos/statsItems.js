/**
 * Estadísticas diarias por publicación (colección `stats_items`):
 *   _id "<itemId>:<día>" → { itemId, autor, dia, v (vistas), d (descargas), a (apoyos), auc (UC de apoyos), g (ganancia USD) }
 * Un documento por publicación y día; se borran solos a los 400 días.
 * Alimenta el panel "Rendimiento por publicación" y la gráfica real de descargas por día.
 */
const mongoose = require('mongoose');
const Limites = require('./limites');

const col = () => mongoose.connection.collection('stats_items');
const dia = (t = Date.now()) => new Date(t - 5 * 3600e3).toISOString().slice(0, 10);   // hora de Colombia
let indices = false;
function asegurarIndices() {
    if (indices) return; indices = true;
    col().createIndex({ autor: 1, dia: 1 }).catch(() => {});
    col().createIndex({ fecha: 1 }, { expireAfterSeconds: 400 * 86400 }).catch(() => {});
}

/** Suma a las estadísticas de hoy. campos: { v, d, a, auc, g } */
async function sumar(itemId, autor, campos) {
    try {
        if (!itemId || !autor) return;
        asegurarIndices();
        const inc = {};
        for (const [k, n] of Object.entries(campos)) if (['v', 'd', 'a', 'auc', 'g'].includes(k) && Number(n)) inc[k] = Number(n);
        if (!Object.keys(inc).length) return;
        const d = dia();
        await col().updateOne({ _id: `${itemId}:${d}` }, { $inc: inc, $setOnInsert: { itemId: String(itemId), autor, dia: d, fecha: new Date() } }, { upsert: true });
    } catch (_) {}
}

/** Vista de una publicación: 1 por IP/usuario y día (contador en Mongo, no infla). */
async function vista(itemId, autor, quien) {
    if (!(await Limites.permitir(`vista:${itemId}:${quien}`, [[Limites.DIA, 1]]))) return false;
    await sumar(itemId, autor, { v: 1 });
    return true;
}

/** Resumen de un autor en los últimos `dias`: por publicación y serie diaria. */
async function delAutor(autor, dias = 30) {
    const desde = dia(Date.now() - (dias - 1) * 864e5);
    const docs = await col().find({ autor, dia: { $gte: desde } }).project({ _id: 0, fecha: 0 }).toArray();
    const items = {}, serie = {};
    for (const x of docs) {
        const it = items[x.itemId] || (items[x.itemId] = { v: 0, d: 0, a: 0, auc: 0, g: 0, serie: {} });
        for (const k of ['v', 'd', 'a', 'auc', 'g']) it[k] += x[k] || 0;
        it.serie[x.dia] = (it.serie[x.dia] || 0) + (x.d || 0);
        const s = serie[x.dia] || (serie[x.dia] = { v: 0, d: 0, g: 0 });
        s.v += x.v || 0; s.d += x.d || 0; s.g += x.g || 0;
    }
    const dias_ = [];
    for (let i = dias - 1; i >= 0; i--) dias_.push(dia(Date.now() - i * 864e5));
    return { desde, dias: dias_, items, serie: dias_.map(d => ({ dia: d, ...(serie[d] || { v: 0, d: 0, g: 0 }) })) };
}

module.exports = { sumar, vista, delAutor, dia };
