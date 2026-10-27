/**
 * ══════════════════════════════════════════════════════════════════
 *  nexus/memoria.js — Lo que Nexus recuerda de cada usuario
 *
 *  Una colección (nexus_memoria), un documento por usuario:
 *    • historial  → últimos mensajes del chat (continúa en cualquier dispositivo)
 *    • gustos     → peso por categoría y por tag, aprendido de lo que el
 *                   usuario mira, busca, guarda en favoritos y descarga
 *    • recientes  → últimos contenidos vistos (para no repetirlos)
 *  Los invitados no se guardan: su historial vive en su navegador.
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const mongoose = require('mongoose');
const { CATEGORIAS } = require('./herramientas');

const MAX_HISTORIAL = 24, MAX_RECIENTES = 40, MAX_TAGS = 60;

const NexusMemoria = mongoose.models.NexusMemoria || mongoose.model('NexusMemoria', new mongoose.Schema({
    _id:        { type: String },                     // nombre de usuario
    historial:  [{ _id: false, rol: { type: String, enum: ['user', 'assistant'] }, texto: String, items: [mongoose.Schema.Types.Mixed], acciones: [mongoose.Schema.Types.Mixed], fecha: { type: Date, default: Date.now } }],
    categorias: { type: Map, of: Number, default: {} },
    tags:       { type: Map, of: Number, default: {} },
    recientes:  { type: [String], default: [] },
    actualizado:{ type: Date, default: Date.now },
}, { collection: 'nexus_memoria', versionKey: false }));

// Peso de cada señal: descargar o guardar dice más que mirar
const PESO = { view: 1, search: 0.5, category: 0.7, favorite: 3, unfavorite: -2, download: 4 };
// Las claves de Map no admiten "." ni "$"
const clave = s => String(s || '').trim().toLowerCase().replace(/[.$]/g, '').slice(0, 40);

async function historial(usuario) {
    const m = await NexusMemoria.findById(usuario).select('historial').lean();
    return m?.historial || [];
}

async function guardarTurno(usuario, pregunta, respuesta) {
    const ahora = new Date();
    await NexusMemoria.updateOne({ _id: usuario }, {
        $push: { historial: { $each: [{ rol: 'user', texto: pregunta, fecha: ahora }, { rol: 'assistant', texto: respuesta.texto, items: respuesta.items || [], acciones: respuesta.acciones || [], fecha: ahora }], $slice: -MAX_HISTORIAL } },
        $set: { actualizado: ahora },
    }, { upsert: true });
}

const borrarHistorial = usuario => NexusMemoria.updateOne({ _id: usuario }, { $set: { historial: [] } });

/** Registra una señal de gusto. item: { _id, category, tags } (opcional) */
async function aprender(usuario, tipo, { item, categoria } = {}) {
    const p = PESO[tipo];
    if (!p || !usuario) return;
    const inc = {};
    const cat = clave(item?.category || categoria);
    if (cat) inc[`categorias.${cat}`] = p;
    for (const t of (item?.tags || []).slice(0, 6)) { const k = clave(t); if (k) inc[`tags.${k}`] = p / 2; }
    const upd = { $set: { actualizado: new Date() } };
    if (Object.keys(inc).length) upd.$inc = inc;
    if (item?._id && (tipo === 'view' || tipo === 'download')) upd.$push = { recientes: { $each: [String(item._id)], $slice: -MAX_RECIENTES } };
    await NexusMemoria.updateOne({ _id: usuario }, upd, { upsert: true });
}

/** Perfil de gustos ordenado: { categorias:[{nombre,peso}], tags:[{tag,peso}], recientes:[id] } */
async function gustos(usuario) {
    const m = await NexusMemoria.findById(usuario).select('categorias tags recientes').lean();
    if (!m) return { categorias: [], tags: [], recientes: [] };
    const orden = o => Object.entries(o || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const tags = orden(m.tags);
    // Poda: que el documento no crezca sin límite
    if (tags.length > MAX_TAGS) NexusMemoria.updateOne({ _id: usuario }, { $unset: Object.fromEntries(tags.slice(MAX_TAGS).map(([k]) => [`tags.${k}`, ''])) }).catch(() => {});
    return {
        categorias: orden(m.categorias).slice(0, 8).map(([nombre, peso]) => ({ nombre: CATEGORIAS.find(c => c.toLowerCase() === nombre) || nombre, peso: +peso.toFixed(2) })),
        tags: tags.slice(0, 15).map(([tag, peso]) => ({ tag, peso: +peso.toFixed(2) })),
        recientes: [...new Set((m.recientes || []).slice().reverse())].slice(0, 20),
    };
}

module.exports = { NexusMemoria, historial, guardarTurno, borrarHistorial, aprender, gustos, PESO };
