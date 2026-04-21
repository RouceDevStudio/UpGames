// ========================================
// 🗂️ CREAR ÍNDICES FALTANTES
// ========================================
// Ejecutar UNA sola vez en producción:
//   node modulos/crearIndices.js
//
// O llamarlo desde el servidor al arrancar
// (es idempotente — no duplica índices existentes).
// ========================================

const mongoose = require('mongoose');
const config   = require('./config');
const logger   = require('./logger');

async function crearIndices() {
    try {
        const db = mongoose.connection.db;
        if (!db) {
            logger.warn('crearIndices: MongoDB no conectado todavía, se omite');
            return;
        }

        // ── Favoritos: índice en usuario (COLLSCAN fix) ──────────────────────
        // Sin este índice, GET /favoritos/:usuario escanea TODA la colección.
        await db.collection('favoritos').createIndex(
            { usuario: 1 },
            { background: true, name: 'idx_favoritos_usuario' }
        );

        // ── Favoritos: índice compuesto para upsert rápido ───────────────────
        await db.collection('favoritos').createIndex(
            { usuario: 1, itemId: 1 },
            { unique: true, background: true, name: 'idx_favoritos_usuario_itemId' }
        );

        // ── Juegos: índice en descargasEfectivas para topUploaders (JOB admin) ──
        // El dashboard usa $group { $sum: '$descargasEfectivas' } por usuario.
        // Un índice en (usuario, descargasEfectivas) cubre el $match de status=aprobado también.
        await db.collection('juegos').createIndex(
            { usuario: 1, descargasEfectivas: -1 },
            { background: true, name: 'idx_juegos_usuario_descargas' }
        );

        // ── Mensajes: índice compuesto para GET /chat/conversaciones ─────────
        // El aggregate agrupa por (de, para) filtrando por yo.
        await db.collection('mensajes').createIndex(
            { de: 1, para: 1, fecha: -1 },
            { background: true, name: 'idx_mensajes_de_para_fecha' }
        );
        await db.collection('mensajes').createIndex(
            { para: 1, leido: 1, fecha: -1 },
            { background: true, name: 'idx_mensajes_para_leido_fecha' }
        );

        // ── DownloadTracking: índice compuesto para análisis de fraude ───────
        await db.collection('download_tracking').createIndex(
            { usuario: 1, timestamp: -1 },
            { background: true, name: 'idx_dltrack_usuario_ts' }
        );
        await db.collection('download_tracking').createIndex(
            { ip: 1, timestamp: -1 },
            { background: true, name: 'idx_dltrack_ip_ts' }
        );

        logger.info('✅ Índices verificados / creados correctamente');
    } catch (err) {
        // createIndex con la misma key definition + name es idempotente en Mongo,
        // pero si hay conflicto de nombre lanza error. Logueamos y seguimos.
        logger.warn(`crearIndices advertencia: ${err.message}`);
    }
}

module.exports = { crearIndices };

// ── Ejecutar directamente si se llama con `node crearIndices.js` ──────────
if (require.main === module) {
    mongoose.connect(process.env.MONGODB_URI || require('./config').MONGODB_URI)
        .then(async () => {
            logger.info('Conectado — creando índices...');
            await crearIndices();
            await mongoose.disconnect();
            logger.info('Listo.');
        })
        .catch(err => {
            console.error('Error:', err.message);
            process.exit(1);
        });
}
