/**
 * APEX GP (games/monoplaza): mejoras y cosméticos con UpCoins y salas multijugador.
 *
 *   GET  /apexgp/catalogo        mejoras, niveles, precios y cosméticos (público)
 *   GET  /apexgp/perfil          lo mío: mejoras, cosméticos, lo equipado y mis UpCoins
 *   POST /apexgp/comprar         { id: 'mejora:motor' | 'cosmetico:patron:rayo', clave }
 *   PUT  /apexgp/equipar         { equipado } (solo se guarda lo que el piloto tiene)
 *
 * Socket.IO, espacio /apexgp (mismo servidor que los lives):
 *   cliente → servidor: lista, crear, unirse, salir, listo, iniciar, estado, vuelta, meta, abandono, revancha
 *   servidor → cliente: sala (estado de la sala), estados (coches, ~15 por segundo), resultados, error
 */
'use strict';

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const A = require('../modulos/apexgp');
const UC = require('../modulos/upcoins');
const L = require('../modulos/live');

const PerfilSchema = new mongoose.Schema({
    usuario:    { type: String, required: true, unique: true },
    mejoras:    { type: Object, default: {} },
    cosmeticos: { type: [String], default: [] },
    equipado:   { type: Object, default: null },
    carreras:   { type: Number, default: 0 },
    victorias:  { type: Number, default: 0 },
}, { collection: 'apexgp_perfiles', timestamps: true });

const claveOk = c => /^[A-Za-z0-9_-]{8,64}$/.test(String(c || ''));
const r2 = n => Math.round(n * 100) / 100;
const LIVERY_MAX = 50000;      // librea propia compartida en la sala (JPEG en base64)

function registrar(app, deps) {
    const { verificarToken, Usuario, LiveTx, io, logger, JWT_SECRET, estaSuspendido } = deps;
    const Perfil = mongoose.models.ApexPerfil || mongoose.model('ApexPerfil', PerfilSchema);
    const ok = (res, d) => res.json({ success: true, ...d });
    const err = (res, code, error, extra) => res.status(code).json({ success: false, error, ...extra });
    const totalUC = async u => Math.floor(UC.saldoUC(await Usuario.findOne({ usuario: u }).select('monedas saldo solicitudPagoPendiente').lean() || {}).total);
    const perfilDe = async u => (await Perfil.findOne({ usuario: u }).lean()) || { usuario: u, mejoras: {}, cosmeticos: [], equipado: null };
    const publico = p => ({ mejoras: A.nivelesMejoras(p), cosmeticos: p.cosmeticos || [], equipado: A.validarEquipado(p.equipado || {}, p), carreras: p.carreras || 0, victorias: p.victorias || 0 });

    app.get('/apexgp/catalogo', (req, res) => { res.set('Cache-Control', 'public, max-age=300'); ok(res, A.catalogo()); });

    app.get('/apexgp/perfil', verificarToken, async (req, res) => {
        try { ok(res, { usuario: req.usuario, ...publico(await perfilDe(req.usuario)), upcoins: await totalUC(req.usuario) }); }
        catch (e) { logger.error(`[apexgp] perfil: ${e.message}`); err(res, 500, 'No se pudo cargar tu garaje'); }
    });

    app.post('/apexgp/comprar', verificarToken, async (req, res) => {
        const u = req.usuario;
        try {
            const { id, clave } = req.body || {};
            if (!claveOk(clave)) return err(res, 400, 'Falta la clave de la compra');
            const p = await perfilDe(u);
            const c = A.precioCompra(id, p);
            if (!c) return err(res, 400, 'Eso no se puede comprar (no existe, ya lo tienes o está al máximo)');
            // la referencia hace la compra idempotente: el mismo nivel o cosmético nunca se cobra dos veces
            const ref = c.tipo === 'mejora' ? `apexgp:${u}:mejora:${c.mejora}:${c.nivel + 1}` : `apexgp:${u}:${c.cosmetico}`;
            if (await LiveTx.exists({ ref })) return ok(res, { repetido: true, ...publico(await perfilDe(u)), upcoins: await totalUC(u) });
            const cobro = await UC.cobrar(Usuario, u, c.precio);
            if (!cobro) {
                const motivo = await UC.motivoSinSaldo(Usuario, u, c.precio), tengo = await totalUC(u);
                return err(res, /cuenta no puede/.test(motivo) ? 403 : /retiro pendiente/.test(motivo) ? 409 : 402, motivo, { upcoins: tengo, faltan: Math.max(0, c.precio - tengo) });
            }
            try {
                await LiveTx.create({ tipo: 'compra', usuario: u, monedas: c.precio, usd: r2(c.precio * L.MONEDA_USD), planId: `apexgp:${String(id).slice(0, 40)}`, metodo: 'upcoins', ref, estado: 'completada' });
            } catch (e) {
                await UC.devolver(Usuario, u, cobro);
                if (e.code === 11000) return ok(res, { repetido: true, ...publico(await perfilDe(u)), upcoins: await totalUC(u) });
                throw e;
            }
            // aplicar con condición: si otra compra simultánea ya subió el nivel, se devuelve
            let r;
            if (c.tipo === 'mejora') {
                const campo = `mejoras.${c.mejora}`;
                const filtro = c.nivel === 0 ? { usuario: u, $or: [{ [campo]: { $exists: false } }, { [campo]: 0 }] } : { usuario: u, [campo]: c.nivel };
                r = await Perfil.updateOne(filtro, { $set: { [campo]: c.nivel + 1 } }, { upsert: c.nivel === 0 }).catch(e => (e.code === 11000 ? { matchedCount: 0, upsertedCount: 0 } : Promise.reject(e)));
            } else r = await Perfil.updateOne({ usuario: u }, { $addToSet: { cosmeticos: c.cosmetico } }, { upsert: true });
            if (!(r.matchedCount || r.upsertedCount)) {
                await UC.devolver(Usuario, u, cobro);
                await LiveTx.deleteOne({ ref }).catch(() => {});
                return err(res, 409, 'Otra compra cambió tu garaje al mismo tiempo. No se te cobró; inténtalo de nuevo.');
            }
            logger.info(`[apexgp] @${u} compró ${id} por ${c.precio} UC`);
            ok(res, { comprado: id, precio: c.precio, ...publico(await perfilDe(u)), upcoins: await totalUC(u) });
        } catch (e) { logger.error(`[apexgp] comprar: ${e.message}`); err(res, 500, 'No se pudo completar la compra'); }
    });

    app.put('/apexgp/equipar', verificarToken, async (req, res) => {
        try {
            const p = await perfilDe(req.usuario);
            const equipado = A.validarEquipado(req.body?.equipado, p);
            await Perfil.updateOne({ usuario: req.usuario }, { $set: { equipado } }, { upsert: true });
            ok(res, { equipado });
        } catch (e) { logger.error(`[apexgp] equipar: ${e.message}`); err(res, 500, 'No se pudo guardar'); }
    });

    // ─── Multijugador ───────────────────────────────────────────────────────
    if (!io) return { Perfil };
    const salas = new A.Salas();
    const ns = io.of('/apexgp');
    const lim = L.limitador(40, 25);          // estados: ~15/s por coche con margen
    const limAcc = L.limitador(8, 2);         // crear, unirse, listo…
    const rid = c => `apex:${c}`;

    ns.use((socket, next) => {
        const t = socket.handshake.auth?.token;
        socket.data.usuario = null;
        if (t && typeof t === 'string' && t.length > 20) {
            try { const u = jwt.verify(t, JWT_SECRET).usuario; if (u && !estaSuspendido(u)) socket.data.usuario = u; } catch (_) { /* invitado */ }
        }
        next();
    });

    const emitirSala = s => ns.to(rid(s.codigo)).emit('sala', salas.publico(s));
    const emitirLista = () => ns.to('apex:lobby').emit('lista', salas.listaPublica());

    async function jugadorDe(socket, d) {
        const u = socket.data.usuario;
        const base = { nombre: u ? `@${u}` : A.limpiarNombre(d?.nombre) || 'Invitado', usuario: u };
        let livery = '';
        if (typeof d?.livery === 'string' && d.livery.length <= LIVERY_MAX && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d.livery)) livery = d.livery;
        if (!u) return { ...base, equipado: A.validarEquipado(d?.equipado, {}), mejoras: {}, livery: '' };
        const p = await perfilDe(u).catch(() => ({}));
        const equipado = A.validarEquipado(d?.equipado || p.equipado, p);
        return { ...base, equipado, mejoras: A.nivelesMejoras(p), livery: equipado.propia ? livery : '' };
    }

    async function cerrarCarrera(s) {
        const res = salas.resultados(s);
        ns.to(rid(s.codigo)).emit('resultados', res);
        emitirSala(s);
        // estadísticas de los pilotos con cuenta
        for (const r of res) if (r.usuario) Perfil.updateOne({ usuario: r.usuario }, { $inc: { carreras: 1, victorias: r.pos === 1 && !r.abandono ? 1 : 0 } }, { upsert: true }).catch(() => {});
    }

    ns.on('connection', socket => {
        const id = socket.id;
        const acc = () => limAcc(id);
        const dejar = () => {
            const r = salas.salir(id);
            if (!r) return;
            socket.leave(rid(r.sala.codigo));
            if (!r.borrada) { emitirSala(r.sala); if (r.sala.estado === 'fin') cerrarCarrera(r.sala); }
            emitirLista();
        };

        socket.on('lista', () => { if (!acc()) return; socket.join('apex:lobby'); socket.emit('lista', salas.listaPublica()); });

        socket.on('crear', async (d, cb) => {
            if (!acc()) return cb?.({ ok: false, error: 'Vas muy rápido' });
            try {
                const r = salas.crear(id, await jugadorDe(socket, d), d?.opciones || {});
                socket.join(rid(r.sala.codigo)); socket.leave('apex:lobby');
                cb?.({ ok: true, sala: salas.publico(r.sala), yo: id });
                enviarLibreas(socket, r.sala);
                emitirLista();
            } catch (e) { logger.error(`[apexgp] crear: ${e.message}`); cb?.({ ok: false, error: 'No se pudo crear la sala' }); }
        });

        socket.on('unirse', async (d, cb) => {
            if (!acc()) return cb?.({ ok: false, error: 'Vas muy rápido' });
            const r = salas.unirse(id, d?.codigo, await jugadorDe(socket, d));
            if (!r.ok) return cb?.(r);
            socket.join(rid(r.sala.codigo)); socket.leave('apex:lobby');
            cb?.({ ok: true, sala: salas.publico(r.sala), yo: id });
            emitirSala(r.sala);
            enviarLibreas(socket, r.sala);
            const j = r.sala.jugadores.get(id);
            if (j.livery) socket.to(rid(r.sala.codigo)).emit('livery', { id, livery: j.livery });
            emitirLista();
        });

        // las libreas propias de los demás, una por mensaje
        function enviarLibreas(sk, s) { for (const j of s.jugadores.values()) if (j.id !== sk.id && j.livery) sk.emit('livery', { id: j.id, livery: j.livery }); }

        socket.on('salir', dejar);
        socket.on('disconnect', dejar);
        socket.on('listo', v => { if (!acc()) return; const s = salas.listo(id, v); if (s) emitirSala(s); });
        socket.on('iniciar', cb => {
            if (!acc()) return;
            const r = salas.iniciar(id);
            if (!r.ok) return typeof cb === 'function' ? cb(r) : socket.emit('error_sala', r.error);
            ns.to(rid(r.sala.codigo)).emit('salida', { tSalida: r.sala.tSalida, ahora: Date.now(), parrilla: r.sala.parrilla });
            emitirSala(r.sala);
            emitirLista();
            typeof cb === 'function' && cb({ ok: true });
        });
        socket.on('revancha', () => { if (!acc()) return; const s = salas.reiniciar(id); if (s) emitirSala(s); });
        socket.on('reloj', (t, cb) => typeof cb === 'function' && cb(Date.now()));
        socket.on('estado', d => { if (lim(id)) salas.estado(id, d); });
        socket.on('vuelta', t => { const s = salas.vuelta(id, t); if (s) ns.to(rid(s.codigo)).emit('vuelta', { id, t: +t }); });
        socket.on('meta', () => { const s = salas.meta(id); if (!s) return; emitirSala(s); if (s.estado === 'fin') cerrarCarrera(s); });
        socket.on('abandono', () => { const s = salas.abandono(id); if (!s) return; emitirSala(s); if (s.estado === 'fin') cerrarCarrera(s); });
        socket.on('evento', d => {
            // contactos entre coches y daños visibles para los demás (pequeños y limitados)
            const s = salas.salaDe(id);
            if (!s || s.estado !== 'carrera' || !acc() || !d || typeof d !== 'object') return;
            const ev = { id, tipo: String(d.tipo || '').slice(0, 16), datos: Array.isArray(d.datos) ? d.datos.slice(0, 8).map(Number).filter(Number.isFinite) : [] };
            socket.to(rid(s.codigo)).emit('evento', ev);
        });
    });

    // ~15 paquetes por segundo con la posición de todos los coches de cada sala en carrera
    setInterval(() => {
        for (const s of salas.salas.values()) {
            if (s.estado !== 'carrera') continue;
            const p = salas.paquete(s);
            if (p.length) ns.to(rid(s.codigo)).volatile.emit('estados', { t: Date.now(), c: p });
        }
        for (const s of salas.revisarPlazos()) cerrarCarrera(s);
    }, 66).unref();

    return { Perfil, salas };
}

module.exports = { registrar, PerfilSchema };
