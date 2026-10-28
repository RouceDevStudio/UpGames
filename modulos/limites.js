/**
 * Límites anti-abuso guardados en MongoDB (colección `limites`).
 *
 * Antes cada límite vivía en un Map en memoria: se reiniciaba con cada despliegue y,
 * si Railway corre varias copias del servidor, cada una llevaba su propia cuenta.
 * Aquí la cuenta es compartida y sobrevive reinicios. Ventanas fijas (balde por
 * ventana) con TTL: Mongo borra solo los baldes viejos.
 *
 * Si la base falla, se usa un respaldo en memoria para no bloquear a nadie por error.
 */
const mongoose = require('mongoose');

const col = () => mongoose.connection.collection('limites');
let indice = false;
function asegurarIndice() {
    if (indice) return; indice = true;
    col().createIndex({ expira: 1 }, { expireAfterSeconds: 0 }).catch(() => { indice = false; });
}

// Respaldo en memoria (solo si Mongo no responde)
const mem = new Map();
function memoria(id, n) {
    const v = (mem.get(id) || 0) + n; mem.set(id, v);
    if (mem.size > 50000) mem.clear();
    return v;
}

const balde = (clave, ventanaMs, ahora = Date.now()) => {
    const b = Math.floor(ahora / ventanaMs);
    return { id: `${clave}|${ventanaMs}|${b}`, expira: new Date((b + 2) * ventanaMs), reinicio: new Date((b + 1) * ventanaMs) };
};

/** Suma 1 al contador y devuelve el total de la ventana actual. */
async function sumar(clave, ventanaMs, n = 1) {
    const { id, expira } = balde(clave, ventanaMs);
    try {
        asegurarIndice();
        const r = await col().findOneAndUpdate({ _id: id }, { $inc: { n }, $setOnInsert: { expira } }, { upsert: true, returnDocument: 'after' });
        return (r && (r.value !== undefined ? r.value : r))?.n || n;
    } catch (_) { return memoria(id, n); }
}

/** Total de la ventana actual sin sumar. */
async function leer(clave, ventanaMs) {
    const { id } = balde(clave, ventanaMs);
    try { return (await col().findOne({ _id: id }))?.n || 0; } catch (_) { return mem.get(id) || 0; }
}

/**
 * ¿Se permite una acción más? reglas = [[ventanaMs, máximo], …]. Si todas tienen
 * cupo, la cuenta en todas y devuelve true; si alguna está llena, no cuenta nada.
 */
async function permitir(clave, reglas) {
    const llenos = await Promise.all(reglas.map(([v, max]) => leer(clave, v).then(n => n >= max)));
    if (llenos.some(Boolean)) return false;
    await Promise.all(reglas.map(([v]) => sumar(clave, v)));
    return true;
}

/** ¿Ya se alcanzó el máximo? (para contar solo los fallos, p. ej. contraseñas) */
async function lleno(clave, ventanaMs, max) { return (await leer(clave, ventanaMs)) >= max; }

/** Borra el contador de la ventana actual (p. ej. tras acertar la contraseña). */
async function reiniciar(clave, ventanaMs) {
    const { id } = balde(clave, ventanaMs); mem.delete(id);
    try { await col().deleteOne({ _id: id }); } catch (_) {}
}

/** Almacén compartido para express-rate-limit (v7). */
class MongoStore {
    constructor(prefijo) { this.prefijo = prefijo; this.localKeys = false; }
    init(opciones) { this.windowMs = opciones.windowMs; }
    async increment(key) {
        const k = `${this.prefijo}:${key}`;
        return { totalHits: await sumar(k, this.windowMs), resetTime: balde(k, this.windowMs).reinicio };
    }
    async decrement(key) { await sumar(`${this.prefijo}:${key}`, this.windowMs, -1); }
    async resetKey(key) { try { await col().deleteOne({ _id: balde(`${this.prefijo}:${key}`, this.windowMs).id }); } catch (_) {} }
}

const MIN = 60000, HORA = 3600000, DIA = 864e5;
module.exports = { sumar, leer, permitir, lleno, reiniciar, MongoStore, MIN, HORA, DIA };
