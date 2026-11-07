'use strict';
/**
 * UPSTAR (games/upstar): exploración espacial online.
 *
 * El universo no se guarda: sale de fórmulas a partir de las coordenadas de cada sector, así que
 * aquí solo se guarda lo que hacen los jugadores.
 *
 *   GET  /upstar/descubrimientos?claves=a,b,c   quién descubrió y cómo se llama cada cosa (≤ 60 claves)
 *   POST /upstar/descubrimiento                 { clave, tipo, nombre } el primero que lo registra lo nombra
 *   GET  /upstar/bases?sector=x,y,z             bases plantadas por los jugadores en ese sector
 *   POST /upstar/base                           { sector, planeta, pos, nombre } (máx. 5 por jugador)
 *   GET  /upstar/guardado · PUT /upstar/guardado { datos }   partida en la nube (≤ 96 KB)
 *
 *   Socket.IO /upstar: 'entrar' { sector, nombre } → sala del sector; 'estado' { p, q, v, m } a ~10/s
 *   → 'jugador' { id, nombre, p, q, v, m } a los demás del sector; 'sale' { id }.
 */

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const L = require('../modulos/live');

const DescSchema = new mongoose.Schema({
    clave:   { type: String, required: true, unique: true },   // p. ej. «p:0,0,0:1» o «c:0,0,0:1:83721»
    tipo:    { type: String, default: '' },
    nombre:  { type: String, default: '' },
    usuario: { type: String, required: true, index: true },
    fecha:   { type: Date, default: Date.now },
}, { collection: 'upstar_descubrimientos' });

const BaseSchema = new mongoose.Schema({
    sector:  { type: String, required: true, index: true },
    planeta: { type: Number, default: 0 },
    pos:     { type: [Number], default: [] },
    nombre:  { type: String, default: '' },
    usuario: { type: String, required: true, index: true },
    fecha:   { type: Date, default: Date.now },
}, { collection: 'upstar_bases' });

const GuardSchema = new mongoose.Schema({
    usuario:     { type: String, required: true, unique: true },
    datos:       { type: String, default: '' },
    actualizado: { type: Date, default: Date.now },
}, { collection: 'upstar_guardados' });

const RE_SECTOR = /^-?\d{1,9},-?\d{1,9},-?\d{1,9}$/;
const RE_CLAVE = /^[a-z]:[-\d,:]{5,80}$/;
const limpiar = (s, n = 32) => String(s || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);
const num = (v, lim = 1e9) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;

module.exports.registrar = function registrar(app, { verificarToken, io, logger, JWT_SECRET, estaSuspendido }) {
    const Desc = mongoose.models.UpstarDesc || mongoose.model('UpstarDesc', DescSchema);
    const Base = mongoose.models.UpstarBase || mongoose.model('UpstarBase', BaseSchema);
    const Guard = mongoose.models.UpstarGuard || mongoose.model('UpstarGuard', GuardSchema);
    const lim = L.limitador(20, 0.5);           // escrituras: ráfagas de 20, 1 cada 2 s
    const ok = (res, d) => res.json({ success: true, ...d });
    const err = (res, c, e) => res.status(c).json({ success: false, error: e });

    app.get('/upstar/descubrimientos', async (req, res) => {
        try {
            const claves = String(req.query.claves || '').split(',').filter(c => RE_CLAVE.test(c)).slice(0, 60);
            if (!claves.length) return ok(res, { lista: {} });
            const ds = await Desc.find({ clave: { $in: claves } }).select('clave nombre usuario tipo fecha').lean();
            const lista = {}; for (const d of ds) lista[d.clave] = { nombre: d.nombre, usuario: d.usuario, tipo: d.tipo, fecha: d.fecha };
            res.set('Cache-Control', 'public, max-age=30');
            ok(res, { lista });
        } catch (e) { logger.error(`[upstar] desc: ${e.message}`); err(res, 500, 'No disponible'); }
    });

    app.post('/upstar/descubrimiento', verificarToken, async (req, res) => {
        try {
            if (!lim(`d:${req.usuario}`)) return err(res, 429, 'Espera un momento');
            const { clave, tipo, nombre } = req.body || {};
            if (!RE_CLAVE.test(String(clave || ''))) return err(res, 400, 'Clave no válida');
            const n = limpiar(nombre, 28);
            if (n.length < 2) return err(res, 400, 'Escribe un nombre');
            try {
                const d = await Desc.create({ clave, tipo: limpiar(tipo, 12), nombre: n, usuario: req.usuario });
                ok(res, { primero: true, nombre: d.nombre, usuario: d.usuario });
            } catch (e) {
                if (e.code !== 11000) throw e;
                const d = await Desc.findOne({ clave }).lean();
                ok(res, { primero: false, nombre: d?.nombre, usuario: d?.usuario });
            }
        } catch (e) { logger.error(`[upstar] desc+: ${e.message}`); err(res, 500, 'No se pudo registrar'); }
    });

    app.get('/upstar/bases', async (req, res) => {
        try {
            const sector = String(req.query.sector || '');
            if (!RE_SECTOR.test(sector)) return err(res, 400, 'Sector no válido');
            const bases = await Base.find({ sector }).sort({ fecha: -1 }).limit(60).select('planeta pos nombre usuario').lean();
            ok(res, { bases });
        } catch (e) { logger.error(`[upstar] bases: ${e.message}`); err(res, 500, 'No disponible'); }
    });

    app.post('/upstar/base', verificarToken, async (req, res) => {
        try {
            if (!lim(`b:${req.usuario}`)) return err(res, 429, 'Espera un momento');
            const { sector, planeta, pos, nombre } = req.body || {};
            if (!RE_SECTOR.test(String(sector || ''))) return err(res, 400, 'Sector no válido');
            if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(v => num(v, 1e7)) || !num(planeta, 16)) return err(res, 400, 'Posición no válida');
            if (await Base.countDocuments({ usuario: req.usuario }) >= 5) await Base.deleteOne({ usuario: req.usuario }, { sort: { fecha: 1 } });
            const b = await Base.create({ sector, planeta: Math.floor(planeta), pos, nombre: limpiar(nombre, 24) || `Base de ${req.usuario}`, usuario: req.usuario });
            ok(res, { base: { planeta: b.planeta, pos: b.pos, nombre: b.nombre, usuario: b.usuario } });
        } catch (e) { logger.error(`[upstar] base+: ${e.message}`); err(res, 500, 'No se pudo plantar la base'); }
    });

    app.get('/upstar/guardado', verificarToken, async (req, res) => {
        try { const g = await Guard.findOne({ usuario: req.usuario }).lean(); ok(res, { datos: g?.datos || '', actualizado: g?.actualizado || null }); }
        catch (e) { logger.error(`[upstar] guard: ${e.message}`); err(res, 500, 'No disponible'); }
    });
    app.put('/upstar/guardado', verificarToken, async (req, res) => {
        try {
            if (!lim(`g:${req.usuario}`)) return err(res, 429, 'Espera un momento');
            const datos = String(req.body?.datos || '');
            if (datos.length > 96 * 1024) return err(res, 413, 'Partida demasiado grande');
            await Guard.updateOne({ usuario: req.usuario }, { $set: { datos, actualizado: new Date() } }, { upsert: true });
            ok(res, {});
        } catch (e) { logger.error(`[upstar] guard+: ${e.message}`); err(res, 500, 'No se pudo guardar'); }
    });

    // ── Multijugador: ver a los demás en tu sector ──
    if (!io) return;
    const ns = io.of('/upstar');
    const limEst = L.limitador(30, 14);
    ns.use((socket, next) => {
        const t = socket.handshake.auth?.token;
        socket.data.usuario = null;
        if (t && typeof t === 'string' && t.length > 20) {
            try { const u = jwt.verify(t, JWT_SECRET).usuario; if (u && !estaSuspendido(u)) socket.data.usuario = u; } catch (_) { /* invitado */ }
        }
        next();
    });
    ns.on('connection', (socket) => {
        socket.on('entrar', (d) => {
            const sector = String(d?.sector || '');
            if (!RE_SECTOR.test(sector)) return;
            if (socket.data.sala) { socket.to(socket.data.sala).emit('sale', { id: socket.id }); socket.leave(socket.data.sala); }
            socket.data.sala = `up:${sector}`;
            socket.data.nombre = socket.data.usuario ? `@${socket.data.usuario}` : (limpiar(d?.nombre, 18) || 'Viajero');
            socket.join(socket.data.sala);
        });
        socket.on('estado', (d) => {
            if (!socket.data.sala || !limEst(socket.id)) return;
            const p = d?.p, q = d?.q;
            if (!Array.isArray(p) || p.length !== 3 || !p.every(v => num(v, 1e8))) return;
            if (!Array.isArray(q) || q.length !== 4 || !q.every(v => num(v, 2))) return;
            socket.to(socket.data.sala).volatile.emit('jugador', { id: socket.id, nombre: socket.data.nombre, p, q, v: num(d.v, 1e5) ? d.v : 0, m: d.m === 'pie' ? 'pie' : 'nave' });
        });
        socket.on('disconnect', () => { if (socket.data.sala) socket.to(socket.data.sala).emit('sale', { id: socket.id }); });
    });
};
