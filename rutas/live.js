/**
 * UpGames Live — transmisiones en vivo, chat en tiempo real, monedas y regalos.
 *
 * El video NUNCA pasa por este servidor: en modo 'p2p' viaja navegador→navegador
 * (aquí solo se reenvía la señalización WebRTC) y en modo 'mediamtx' lo sirve un
 * servidor de medios aparte. Aquí vive todo lo demás: quién emite, chat,
 * espectadores, monedas, regalos, comisión y retención del dinero.
 *
 * Estado en memoria (salas, espectadores, chat reciente): requiere UNA réplica.
 * Para varias réplicas hace falta el adaptador de Redis de Socket.IO.
 */
'use strict';

const https = require('https');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const L = require('../modulos/live');

// ── Modelos ──────────────────────────────────────────────────────────────────
const LiveSchema = new mongoose.Schema({
    creador:   { type: String, required: true, index: true },
    titulo:    { type: String, default: '', maxlength: 100 },
    categoria: { type: String, default: '', maxlength: 40 },
    modo:      { type: String, enum: ['p2p', 'mediamtx'], default: 'p2p' },
    estado:    { type: String, enum: ['en_vivo', 'finalizado'], default: 'en_vivo', index: true },
    inicio:    { type: Date, default: Date.now, index: true },
    fin:       { type: Date, default: null },
    latido:    { type: Date, default: Date.now },
    pico:      { type: Number, default: 0 },
    likes:     { type: Number, default: 0 },
    regalos:   { type: Number, default: 0 },
    monedas:   { type: Number, default: 0 },
    motivoFin: { type: String, default: '' },
}, { collection: 'lives', timestamps: false });
// Un solo live activo por creador (dos pestañas no crean dos directos)
LiveSchema.index({ creador: 1 }, { unique: true, partialFilterExpression: { estado: 'en_vivo' }, name: 'un_live_activo' });

const TxSchema = new mongoose.Schema({
    tipo:         { type: String, enum: ['compra', 'regalo'], required: true },
    usuario:      { type: String, required: true, index: true },   // quien paga
    destinatario: { type: String, default: '', index: true },      // creador (regalos)
    monedas:      { type: Number, required: true },
    usd:          { type: Number, default: 0 },                    // valor bruto
    creadorUsd:   { type: Number, default: 0 },
    plataformaUsd:{ type: Number, default: 0 },
    regaloId:     { type: String, default: '' },
    cantidad:     { type: Number, default: 1 },
    liveId:       { type: String, default: '', index: true },
    ref:          { type: String, required: true, unique: true },  // idempotencia (orden PayPal / clave del regalo)
    captureId:    { type: String, default: '', index: true },
    estado:       { type: String, enum: ['completada', 'retenida', 'liberada', 'revertida'], default: 'completada' },
    liberarEn:    { type: Date, default: null },
    fecha:        { type: Date, default: Date.now, index: true },
}, { collection: 'live_transacciones', timestamps: false });
TxSchema.index({ estado: 1, liberarEn: 1 });

const Live = mongoose.models.Live || mongoose.model('Live', LiveSchema);
const LiveTx = mongoose.models.LiveTx || mongoose.model('LiveTx', TxSchema);

// ── PayPal (Orders v2) ───────────────────────────────────────────────────────
function paypal(config, getToken) {
    const host = config.PAYPAL_MODE === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
    return async (method, path, body, extraHeaders = {}) => {
        const token = await getToken();
        const payload = body ? JSON.stringify(body) : '';
        return new Promise((resolve, reject) => {
            const req = https.request({
                hostname: host, path, method,
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...extraHeaders },
                timeout: 20000,
            }, res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    let json = {};
                    try { json = data ? JSON.parse(data) : {}; } catch (_) {}
                    resolve({ status: res.statusCode, data: json });
                });
            });
            req.on('timeout', () => req.destroy(new Error('PayPal no respondió a tiempo')));
            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
        });
    };
}

function registrar(app, server, deps) {
    const { verificarToken, verificarAdmin, Usuario, Notificacion, logger, config, JWT_SECRET, estaSuspendido, getPayPalAccessToken } = deps;
    const pp = paypal(config, getPayPalAccessToken);
    const ppActivo = () => !!(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET);
    const mtxSecreto = process.env.MEDIAMTX_AUTH_SECRET || '';
    const mtxApi = (process.env.MEDIAMTX_API_URL || '').replace(/\/+$/, '');

    // ── Estado en memoria por sala ──────────────────────────────────────────
    // liveId → { live, host: socketId|null, viewers: Map<socketId, usuario|null>,
    //            chat: [], silenciados: Set, likes, pico, finTimer, lastCount }
    const salas = new Map();
    const sala = id => salas.get(String(id));
    const rid = id => `live:${id}`;

    const io = new Server(server, {
        cors: { origin: config.ALLOWED_ORIGINS, credentials: true },
        // cors solo cubre HTTP: el WebSocket se valida aquí (sin Origin = app nativa / servidor)
        allowRequest: (req, cb) => { const o = req.headers.origin; cb(null, !o || config.ALLOWED_ORIGINS.includes(o)); },
        pingInterval: 20000, pingTimeout: 25000,
        maxHttpBufferSize: 64 * 1024,     // SDP/ICE caben de sobra; nada de archivos
    });

    io.use((socket, next) => {
        const t = socket.handshake.auth?.token;
        socket.data.usuario = null;
        if (t && typeof t === 'string' && t.length > 20) {
            try {
                const u = jwt.verify(t, JWT_SECRET).usuario;
                if (u && !estaSuspendido(u)) socket.data.usuario = u;
            } catch (_) { /* invitado */ }
        }
        next();
    });

    const limChat = L.limitador(4, 1);       // 4 mensajes de golpe, luego 1/s
    const limLike = L.limitador(10, 5);
    const limSenal = L.limitador(400, 100);  // ICE llega en ráfagas
    const limRegalo = L.limitador(6, 2);

    const perfilCache = new Map();           // usuario → { avatar, verificado, ts }
    async function perfil(u) {
        const c = perfilCache.get(u);
        if (c && Date.now() - c.ts < 5 * 60000) return c;
        const d = await Usuario.findOne({ usuario: u }).select('avatar verificadoNivel').lean().catch(() => null);
        const p = { avatar: d?.avatar || '', verificado: d?.verificadoNivel || 0, ts: Date.now() };
        if (perfilCache.size > 5000) perfilCache.clear();
        perfilCache.set(u, p);
        return p;
    }

    function conteo(s) { return s.viewers.size; }
    function emitirConteo(id) {
        const s = sala(id); if (!s) return;
        const n = conteo(s);
        if (n > s.pico) s.pico = n;
        if (n === s.lastCount) return;
        s.lastCount = n;
        io.to(rid(id)).emit('espectadores', { n });
    }
    // Agrupa los cambios de espectadores y likes (cientos de entradas no = cientos de eventos)
    setInterval(() => {
        for (const [id, s] of salas) {
            emitirConteo(id);
            if (s.likesSucios) { s.likesSucios = false; io.to(rid(id)).emit('likes', { total: s.likes }); }
        }
    }, 2000).unref();

    async function cargarSala(id) {
        let s = sala(id);
        if (s) return s;
        if (!mongoose.isValidObjectId(id)) return null;
        const live = await Live.findById(id).lean();
        if (!live || live.estado !== 'en_vivo') return null;
        s = sala(id);   // otra petición pudo crearla mientras se leía
        if (s) return s;
        s = { live, host: null, viewers: new Map(), chat: [], silenciados: new Set(), likes: live.likes || 0, pico: live.pico || 0, finTimer: null, lastCount: -1, likesSucios: false };
        salas.set(String(id), s);
        return s;
    }

    async function finalizar(id, motivo = 'El creador terminó la transmisión') {
        id = String(id);
        const s = sala(id);
        const set = { estado: 'finalizado', fin: new Date(), motivoFin: motivo.slice(0, 120) };
        if (s) { set.likes = s.likes; set.pico = s.pico; }
        const r = await Live.updateOne({ _id: id, estado: 'en_vivo' }, { $set: set }).catch(e => { logger.warn(`[live] finalizar: ${e.message}`); return null; });
        if (s) { clearTimeout(s.finTimer); salas.delete(id); }
        io.to(rid(id)).emit('fin', { motivo });
        io.in(rid(id)).socketsLeave(rid(id));
        if (r?.modifiedCount) logger.info(`[live] Finalizado ${id}: ${motivo}`);
        return !!r?.modifiedCount;
    }

    const publico = (l, s) => ({
        _id: l._id, creador: l.creador, titulo: l.titulo, categoria: l.categoria, modo: l.modo,
        estado: l.estado, inicio: l.inicio, likes: s ? s.likes : l.likes, regalos: l.regalos,
        espectadores: s ? conteo(s) : 0, enLinea: s ? !!s.host || l.modo === 'mediamtx' : l.modo === 'mediamtx',
    });

    async function topDonantes(liveId, limite = 5) {
        return LiveTx.aggregate([
            { $match: { tipo: 'regalo', liveId: String(liveId), estado: { $ne: 'revertida' } } },
            { $group: { _id: '$usuario', monedas: { $sum: '$monedas' } } },
            { $sort: { monedas: -1 } }, { $limit: limite },
            { $project: { _id: 0, usuario: '$_id', monedas: 1 } },
        ]);
    }

    async function avisarSeguidores(creador, live) {
        try {
            // Un aviso por sesión: reconectar o reiniciar en 30 min no vuelve a notificar
            const previo = await Live.countDocuments({ creador, _id: { $ne: live._id }, inicio: { $gte: new Date(Date.now() - 30 * 60000) } });
            if (previo) return;
            const u = await Usuario.findOne({ usuario: creador }).select('listaSeguidores').lean();
            const seg = [...new Set((u?.listaSeguidores || []).map(x => String(x).toLowerCase()))].filter(x => x && x !== creador).slice(0, 5000);
            if (!seg.length) return;
            const mensaje = (live.titulo || 'Está transmitiendo ahora').slice(0, 140);
            await Notificacion.insertMany(seg.map(d => ({ destinatario: d, tipo: 'sistema', emisor: creador, itemId: String(live._id), itemTitle: 'En vivo', mensaje, leida: false, fecha: new Date() })), { ordered: false });
        } catch (e) { logger.warn(`[live] avisarSeguidores: ${e.message}`); }
    }

    async function crearLive(creador, { titulo, categoria, modo }) {
        const existente = await Live.findOne({ creador, estado: 'en_vivo' }).lean();
        if (existente) {
            const set = { latido: new Date() };
            if (titulo) set.titulo = titulo;
            if (categoria) set.categoria = categoria;
            if (modo && modo !== existente.modo) set.modo = modo;
            await Live.updateOne({ _id: existente._id }, { $set: set });
            const s = sala(existente._id); if (s) Object.assign(s.live, set);
            return { live: { ...existente, ...set }, nuevo: false };
        }
        try {
            const live = await Live.create({ creador, titulo: titulo || `En vivo con @${creador}`, categoria: categoria || '', modo: modo || 'p2p' });
            avisarSeguidores(creador, live);
            return { live: live.toObject(), nuevo: true };
        } catch (e) {
            if (e.code === 11000) return crearLive(creador, { titulo, categoria, modo });   // carrera: ya lo creó otra petición
            throw e;
        }
    }

    // ── Socket.IO ───────────────────────────────────────────────────────────
    io.on('connection', socket => {
        const yo = () => socket.data.usuario;
        socket.data.lives = new Set();

        socket.on('unirse', async (p = {}, ack) => {
            const responder = typeof ack === 'function' ? ack : () => {};
            try {
                const id = String(p.liveId || '');
                const s = await cargarSala(id);
                if (!s) return responder({ ok: false, error: 'Este live ya terminó' });
                const comoHost = p.rol === 'host';
                if (comoHost && yo() !== s.live.creador) return responder({ ok: false, error: 'No eres el creador de este live' });
                socket.join(rid(id));
                socket.data.lives.add(id);
                if (comoHost) {
                    if (s.host && s.host !== socket.id) io.to(s.host).emit('reemplazado');   // abrió el estudio en otra pestaña
                    s.host = socket.id;
                    clearTimeout(s.finTimer); s.finTimer = null;
                    Live.updateOne({ _id: id }, { $set: { latido: new Date() } }).catch(() => {});
                    socket.to(rid(id)).emit('host:conectado');
                    // Reanudar: pedir oferta para cada espectador ya presente
                    if (s.live.modo === 'p2p') [...s.viewers.keys()].slice(0, L.P2P_MAX).forEach(v => socket.emit('p2p:nuevo', { peer: v }));
                } else {
                    s.viewers.set(socket.id, yo());
                    if (s.live.modo === 'p2p' && s.host) {
                        if (s.viewers.size <= L.P2P_MAX) io.to(s.host).emit('p2p:nuevo', { peer: socket.id });
                        else socket.emit('p2p:lleno', { max: L.P2P_MAX });
                    }
                }
                responder({ ok: true, yo: yo(), host: !!s.host, espectadores: conteo(s), likes: s.likes, chat: s.chat.slice(-40), top: await topDonantes(id), live: publico(s.live, s) });
            } catch (e) {
                logger.warn(`[live] unirse: ${e.message}`);
                responder({ ok: false, error: 'No se pudo entrar al live' });
            }
        });

        socket.on('salir', p => salirDe(String(p?.liveId || '')));

        socket.on('chat', async (p = {}, ack) => {
            const responder = typeof ack === 'function' ? ack : () => {};
            const id = String(p.liveId || ''), s = sala(id), u = yo();
            if (!s || !socket.data.lives.has(id)) return responder({ ok: false, error: 'No estás en este live' });
            if (!u) return responder({ ok: false, error: 'Inicia sesión para chatear' });
            if (s.silenciados.has(u)) return responder({ ok: false, error: 'El creador te silenció en este live' });
            if (!limChat(`${u}`)) return responder({ ok: false, error: 'Vas muy rápido, espera un momento' });
            const t = L.limpiarChat(p.texto);
            if (!t) return responder({ ok: false });
            const pf = await perfil(u);
            const m = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, u, t, ts: Date.now(), av: pf.avatar, v: pf.verificado, host: u === s.live.creador };
            s.chat.push(m); if (s.chat.length > 80) s.chat.splice(0, s.chat.length - 80);
            io.to(rid(id)).emit('chat', m);
            responder({ ok: true });
        });

        socket.on('like', p => {
            const id = String(p?.liveId || ''), s = sala(id);
            if (!s || !socket.data.lives.has(id) || !limLike(socket.id)) return;
            s.likes++; s.likesSucios = true;
        });

        // Señalización WebRTC: solo entre el host y un espectador de SU sala
        socket.on('p2p:senal', (p = {}) => {
            if (!limSenal(socket.id)) return;
            const id = String(p.liveId || ''), s = sala(id), para = String(p.para || '');
            if (!s || !socket.data.lives.has(id)) return;
            const desdeHost = socket.id === s.host;
            const valido = desdeHost ? s.viewers.has(para) : (para === s.host && s.viewers.has(socket.id));
            if (!valido || !p.data || typeof p.data !== 'object') return;
            io.to(para).emit('p2p:senal', { de: socket.id, data: p.data });
        });
        socket.on('p2p:solicitar', p => {   // el espectador pide una conexión nueva (falló o se cortó)
            const id = String(p?.liveId || ''), s = sala(id);
            if (!s || !s.host || !s.viewers.has(socket.id) || s.live.modo !== 'p2p') return;
            const pos = [...s.viewers.keys()].indexOf(socket.id);
            if (pos >= L.P2P_MAX) return socket.emit('p2p:lleno', { max: L.P2P_MAX });
            io.to(s.host).emit('p2p:nuevo', { peer: socket.id });
        });

        // Moderación del creador
        socket.on('mod', (p = {}) => {
            const id = String(p.liveId || ''), s = sala(id);
            if (!s || socket.id !== s.host) return;
            if (p.accion === 'silenciar' && p.usuario) {
                const u = String(p.usuario).toLowerCase().slice(0, 20);
                if (u === s.live.creador) return;
                s.silenciados.add(u);
                s.chat = s.chat.filter(m => m.u !== u);
                io.to(rid(id)).emit('chat:silenciado', { u });
            } else if (p.accion === 'borrar' && p.id) {
                s.chat = s.chat.filter(m => m.id !== p.id);
                io.to(rid(id)).emit('chat:borrado', { id: String(p.id) });
            }
        });

        socket.on('latido', p => {
            const id = String(p?.liveId || ''), s = sala(id);
            if (!s || socket.id !== s.host) return;
            const ahora = Date.now();
            if (ahora - (s.ultimoLatido || 0) < 20000) return;
            s.ultimoLatido = ahora;
            Live.updateOne({ _id: id, estado: 'en_vivo' }, { $set: { latido: new Date(), likes: s.likes, pico: s.pico } }).catch(() => {});
        });

        function salirDe(id) {
            const s = sala(id);
            socket.leave(rid(id));
            socket.data.lives.delete(id);
            if (!s) return;
            if (s.viewers.delete(socket.id) && s.host) {
                io.to(s.host).emit('p2p:salio', { peer: socket.id });
                // Se liberó un cupo directo: quien esperaba en "lleno" lo vuelve a pedir
                if (s.live.modo === 'p2p' && s.viewers.size >= L.P2P_MAX) io.to(rid(id)).emit('p2p:hueco');
            }
            if (s.host === socket.id) {
                s.host = null;
                io.to(rid(id)).emit('host:desconectado');
                // Corte de red o recarga: margen para volver antes de cerrar el live
                if (s.live.modo === 'p2p') {
                    clearTimeout(s.finTimer);
                    s.finTimer = setTimeout(() => { if (!s.host) finalizar(id, 'Se perdió la conexión con el creador'); }, 90000);
                }
            }
        }
        socket.on('disconnect', () => { for (const id of [...socket.data.lives]) salirDe(id); });
    });

    // ── HTTP: lives ─────────────────────────────────────────────────────────
    const ok = (res, d) => res.json({ success: true, ...d });
    const err = (res, code, error, extra) => res.status(code).json({ success: false, error, ...extra });

    app.get('/live/config', (req, res) => ok(res, {
        proveedor: L.proveedor(), ice: L.iceServers(),
        regalos: L.REGALOS, paquetes: L.PAQUETES,
        comision: L.COMISION, retencionDias: L.RETENCION_DIAS, monedaUsd: L.MONEDA_USD,
        paypal: ppActivo() ? { clientId: config.PAYPAL_CLIENT_ID, modo: config.PAYPAL_MODE } : null,
    }));

    app.get('/live/activos', async (req, res) => {
        try {
            const lives = await Live.find({ estado: 'en_vivo' }).sort({ inicio: -1 }).limit(100).lean();
            const perfiles = new Map((await Usuario.find({ usuario: { $in: lives.map(l => l.creador) } }).select('usuario avatar verificadoNivel').lean()).map(u => [u.usuario, u]));
            const lista = lives.map(l => ({ ...publico(l, sala(l._id)), avatar: perfiles.get(l.creador)?.avatar || '', verificado: perfiles.get(l.creador)?.verificadoNivel || 0 }))
                .sort((a, b) => b.espectadores - a.espectadores);
            ok(res, { lives: lista });
        } catch (e) { logger.error(`[live] activos: ${e.message}`); err(res, 500, 'Error al cargar los lives'); }
    });

    app.get('/live/canal/:usuario', async (req, res) => {
        try {
            const u = String(req.params.usuario || '').toLowerCase().slice(0, 20);
            const [creador, live] = await Promise.all([
                Usuario.findOne({ usuario: u }).select('usuario avatar banner bio verificadoNivel listaSeguidores').lean(),
                Live.findOne({ creador: u, estado: 'en_vivo' }).lean(),
            ]);
            if (!creador) return err(res, 404, 'Ese creador no existe');
            const ultimo = live ? null : await Live.findOne({ creador: u }).sort({ inicio: -1 }).select('titulo inicio fin pico').lean();
            ok(res, {
                creador: { usuario: creador.usuario, avatar: creador.avatar || '', banner: creador.banner || '', bio: creador.bio || '', verificado: creador.verificadoNivel || 0, seguidores: (creador.listaSeguidores || []).length },
                live: live ? publico(live, sala(live._id)) : null,
                top: live ? await topDonantes(live._id) : [],
                ultimo,
            });
        } catch (e) { logger.error(`[live] canal: ${e.message}`); err(res, 500, 'Error al cargar el canal'); }
    });

    app.post('/live/iniciar', verificarToken, async (req, res) => {
        try {
            const u = await Usuario.findOne({ usuario: req.usuario }).select('usuario listaNegraAdmin suspendido').lean();
            if (!u) return err(res, 404, 'Usuario no encontrado');
            if (u.listaNegraAdmin || u.suspendido) return err(res, 403, 'Tu cuenta no puede transmitir en este momento');
            const titulo = L.limpiarChat(req.body?.titulo, 100) || '';
            const categoria = L.limpiarChat(req.body?.categoria, 40) || '';
            const prov = L.proveedor();
            const modo = req.body?.modo === 'mediamtx' && prov.tipo === 'mediamtx' ? 'mediamtx' : 'p2p';
            const { live, nuevo } = await crearLive(req.usuario, { titulo, categoria, modo });
            logger.info(`[live] @${req.usuario} ${nuevo ? 'inició' : 'reanudó'} live ${live._id} (${modo})`);
            ok(res, { live: publico(live, sala(live._id)), nuevo });
        } catch (e) { logger.error(`[live] iniciar: ${e.message}`); err(res, 500, 'No se pudo iniciar el live'); }
    });

    app.post('/live/finalizar', verificarToken, async (req, res) => {
        try {
            const live = await Live.findOne({ creador: req.usuario, estado: 'en_vivo' }).select('_id').lean();
            if (!live) return ok(res, { finalizado: false });
            await finalizar(live._id);
            const resumen = await Live.findById(live._id).select('titulo inicio fin pico likes regalos monedas').lean();
            ok(res, { finalizado: true, resumen });
        } catch (e) { logger.error(`[live] finalizar: ${e.message}`); err(res, 500, 'No se pudo finalizar'); }
    });

    app.put('/live/titulo', verificarToken, async (req, res) => {
        const titulo = L.limpiarChat(req.body?.titulo, 100);
        if (!titulo) return err(res, 400, 'Escribe un título');
        const live = await Live.findOneAndUpdate({ creador: req.usuario, estado: 'en_vivo' }, { $set: { titulo } }, { new: true }).lean().catch(() => null);
        if (!live) return err(res, 404, 'No tienes un live activo');
        const s = sala(live._id); if (s) s.live.titulo = titulo;
        io.to(rid(live._id)).emit('titulo', { titulo });
        ok(res, { titulo });
    });

    // Clave de transmisión para OBS (solo con servidor de medios)
    async function clave(usuario, regenerar) {
        let u = await Usuario.findOne({ usuario }).select('+liveKey').lean();
        if (!u) return null;
        if (!u.liveKey || regenerar) {
            const k = L.nuevaClave();
            await Usuario.updateOne({ usuario }, { $set: { liveKey: k } });
            u = { ...u, liveKey: k };
        }
        const prov = L.proveedor();
        return { clave: u.liveKey, servidor: prov.rtmp || null, streamKey: `${usuario}?key=${u.liveKey}`, whip: prov.whip ? prov.whip.replace('{u}', usuario) : null, disponible: prov.tipo === 'mediamtx' };
    }
    app.get('/live/mi-clave', verificarToken, async (req, res) => {
        const c = await clave(req.usuario, false).catch(() => null);
        c ? ok(res, c) : err(res, 500, 'No se pudo obtener la clave');
    });
    app.post('/live/mi-clave/regenerar', verificarToken, async (req, res) => {
        const c = await clave(req.usuario, true).catch(() => null);
        c ? ok(res, c) : err(res, 500, 'No se pudo regenerar la clave');
    });

    // Autorización de MediaMTX (authMethod: http). 200 = permitido, 401 = denegado.
    app.post('/live/mediamtx/auth', async (req, res) => {
        try {
            if (!mtxSecreto || req.query.s !== mtxSecreto) return res.sendStatus(401);
            const b = req.body || {};
            const u = L.usuarioDeRuta(b.path);
            if (!u) return res.sendStatus(401);
            if (b.action === 'read') return res.sendStatus(200);
            if (b.action !== 'publish') return res.sendStatus(401);
            const d = await Usuario.findOne({ usuario: u }).select('+liveKey listaNegraAdmin suspendido').lean();
            if (!d || d.listaNegraAdmin || d.suspendido || estaSuspendido(u) || !L.claveValida(d.liveKey, L.claveDeAuth(b))) {
                logger.warn(`[live] MediaMTX: publicación rechazada en ${b.path} desde ${b.ip || '?'}`);
                return res.sendStatus(401);
            }
            await crearLive(u, { modo: 'mediamtx' });
            res.sendStatus(200);
        } catch (e) { logger.error(`[live] mediamtx auth: ${e.message}`); res.sendStatus(500); }
    });

    // ── HTTP: monedas y regalos ─────────────────────────────────────────────
    app.get('/monedas/saldo', verificarToken, async (req, res) => {
        const u = await Usuario.findOne({ usuario: req.usuario }).select('monedas saldo saldoRetenido').lean().catch(() => null);
        if (!u) return err(res, 404, 'Usuario no encontrado');
        ok(res, { monedas: u.monedas || 0, saldo: u.saldo || 0, saldoRetenido: u.saldoRetenido || 0, retencionDias: L.RETENCION_DIAS });
    });

    app.get('/monedas/movimientos', verificarToken, async (req, res) => {
        const movs = await LiveTx.find({ $or: [{ usuario: req.usuario }, { destinatario: req.usuario }] })
            .sort({ fecha: -1 }).limit(50).select('-_id tipo usuario destinatario monedas usd creadorUsd regaloId cantidad estado liberarEn fecha').lean().catch(() => []);
        ok(res, { movimientos: movs.map(m => m.destinatario === req.usuario && m.usuario !== req.usuario ? { ...m, recibido: true, usd: undefined } : { ...m, creadorUsd: undefined }) });
    });

    app.post('/monedas/orden', verificarToken, async (req, res) => {
        try {
            if (!ppActivo()) return err(res, 503, 'Las compras aún no están disponibles');
            const p = L.paquete(req.body?.paquete);
            if (!p) return err(res, 400, 'Paquete no válido');
            const r = await pp('POST', '/v2/checkout/orders', {
                intent: 'CAPTURE',
                purchase_units: [{
                    reference_id: p.id, custom_id: req.usuario,
                    description: `${p.monedas} monedas UpGames`,
                    amount: { currency_code: 'USD', value: p.usd.toFixed(2) },
                }],
                application_context: { brand_name: 'UpGames', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
            }, { 'PayPal-Request-Id': `ug-${req.usuario}-${p.id}-${Date.now()}` });
            if (r.status !== 201 || !r.data.id) {
                logger.error(`[live] PayPal crear orden [${r.status}]: ${JSON.stringify(r.data).slice(0, 300)}`);
                return err(res, 502, 'PayPal no pudo crear la orden');
            }
            ok(res, { orderID: r.data.id });
        } catch (e) { logger.error(`[live] orden: ${e.message}`); err(res, 500, 'No se pudo crear la orden'); }
    });

    app.post('/monedas/capturar', verificarToken, async (req, res) => {
        try {
            if (!ppActivo()) return err(res, 503, 'Las compras aún no están disponibles');
            const orderID = String(req.body?.orderID || '');
            if (!/^[A-Z0-9]{10,30}$/.test(orderID)) return err(res, 400, 'Orden no válida');
            const ref = `paypal:${orderID}`;
            const previa = await LiveTx.findOne({ ref }).lean();
            if (previa) {
                if (previa.usuario !== req.usuario) return err(res, 403, 'Esta orden no es tuya');
                const u = await Usuario.findOne({ usuario: req.usuario }).select('monedas').lean();
                return ok(res, { monedas: u?.monedas || 0, acreditadas: previa.monedas, repetida: true });
            }
            // Verificar ANTES de cobrar: dueño y monto de la orden
            const o = await pp('GET', `/v2/checkout/orders/${orderID}`);
            if (o.status !== 200) return err(res, 404, 'PayPal no encontró la orden');
            const pu = o.data.purchase_units?.[0] || {};
            const p = L.paquete(pu.reference_id);
            if (!p || pu.custom_id !== req.usuario) return err(res, 403, 'Esta orden no es tuya');
            if (pu.amount?.currency_code !== 'USD' || Math.abs(parseFloat(pu.amount?.value) - p.usd) > 0.001) return err(res, 400, 'El monto de la orden no coincide');

            let captura = pu.payments?.captures?.[0];
            if (o.data.status !== 'COMPLETED') {
                const c = await pp('POST', `/v2/checkout/orders/${orderID}/capture`, {}, { 'PayPal-Request-Id': `ug-cap-${orderID}` });
                if (c.status !== 201 && c.status !== 200) {
                    logger.warn(`[live] PayPal captura [${c.status}] ${orderID}: ${JSON.stringify(c.data).slice(0, 300)}`);
                    const rechazo = c.data?.details?.[0]?.issue === 'INSTRUMENT_DECLINED';
                    return err(res, 402, rechazo ? 'PayPal rechazó el método de pago. Prueba con otro.' : 'No se pudo completar el pago', { reintentar: rechazo });
                }
                captura = c.data.purchase_units?.[0]?.payments?.captures?.[0];
            }
            if (!captura || captura.status !== 'COMPLETED' || Math.abs(parseFloat(captura.amount?.value) - p.usd) > 0.001) {
                logger.warn(`[live] Captura no completada ${orderID}: ${captura?.status}`);
                return err(res, 402, 'El pago quedó pendiente en PayPal. Las monedas llegarán cuando se confirme.');
            }
            try {
                await LiveTx.create({ tipo: 'compra', usuario: req.usuario, monedas: p.monedas, usd: p.usd, ref, captureId: captura.id || '', estado: 'completada' });
            } catch (e) {
                if (e.code !== 11000) throw e;
                const u = await Usuario.findOne({ usuario: req.usuario }).select('monedas').lean();
                return ok(res, { monedas: u?.monedas || 0, acreditadas: p.monedas, repetida: true });
            }
            const u = await Usuario.findOneAndUpdate({ usuario: req.usuario }, { $inc: { monedas: p.monedas } }, { new: true }).select('monedas').lean();
            logger.info(`[live] Compra @${req.usuario}: ${p.monedas} monedas por $${p.usd} (orden ${orderID})`);
            ok(res, { monedas: u?.monedas || 0, acreditadas: p.monedas });
        } catch (e) { logger.error(`[live] capturar: ${e.message}`); err(res, 500, 'Error al confirmar el pago'); }
    });

    // Contracargos / reembolsos: se descuentan las monedas y se revierten los
    // regalos de ese comprador que aún estén retenidos (para eso existe la retención).
    app.post('/monedas/paypal-webhook', async (req, res) => {
        try {
            const webhookId = process.env.PAYPAL_WEBHOOK_ID;
            if (!webhookId || !ppActivo()) return res.sendStatus(404);
            const h = req.headers;
            const v = await pp('POST', '/v1/notifications/verify-webhook-signature', {
                auth_algo: h['paypal-auth-algo'], cert_url: h['paypal-cert-url'], transmission_id: h['paypal-transmission-id'],
                transmission_sig: h['paypal-transmission-sig'], transmission_time: h['paypal-transmission-time'],
                webhook_id: webhookId, webhook_event: req.body,
            });
            if (v.data?.verification_status !== 'SUCCESS') { logger.warn('[live] Webhook PayPal con firma inválida'); return res.sendStatus(400); }
            const ev = req.body || {};
            const tipos = ['PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED', 'CUSTOMER.DISPUTE.CREATED'];
            if (!tipos.includes(ev.event_type)) return res.sendStatus(200);
            const r = ev.resource || {};
            const captureId = ev.event_type === 'CUSTOMER.DISPUTE.CREATED'
                ? r.disputed_transactions?.[0]?.seller_transaction_id
                : (r.links || []).find(l => l.rel === 'up')?.href?.split('/').pop() || r.id;
            const compra = captureId && await LiveTx.findOneAndUpdate({ tipo: 'compra', captureId, estado: 'completada' }, { $set: { estado: 'revertida' } }, { new: true }).lean();
            if (!compra) return res.sendStatus(200);
            await Usuario.updateOne({ usuario: compra.usuario }, [{ $set: { monedas: { $max: [0, { $subtract: [{ $ifNull: ['$monedas', 0] }, compra.monedas] }] } } }]);
            const regalos = await LiveTx.find({ tipo: 'regalo', usuario: compra.usuario, estado: 'retenida' }).lean();
            let revertidos = 0;
            for (const g of regalos) {
                const m = await LiveTx.updateOne({ _id: g._id, estado: 'retenida' }, { $set: { estado: 'revertida' } });
                if (!m.modifiedCount) continue;
                await Usuario.updateOne({ usuario: g.destinatario }, [{ $set: { saldoRetenido: { $max: [0, { $subtract: [{ $ifNull: ['$saldoRetenido', 0] }, g.creadorUsd] }] } } }]);
                revertidos++;
            }
            await Usuario.updateOne({ usuario: compra.usuario }, { $set: { listaNegraAdmin: true, notasAdmin: `Contracargo/reembolso PayPal (${ev.event_type}) de ${compra.monedas} monedas`, fechaListaNegra: new Date() } });
            logger.warn(`[live] ${ev.event_type}: compra de @${compra.usuario} revertida, ${revertidos} regalo(s) retenido(s) anulados`);
            res.sendStatus(200);
        } catch (e) { logger.error(`[live] webhook: ${e.message}`); res.sendStatus(500); }
    });

    app.post('/live/:id/regalo', verificarToken, async (req, res) => {
        try {
            const id = String(req.params.id);
            const g = L.regalo(req.body?.regaloId);
            const cantidad = Math.max(1, Math.min(99, parseInt(req.body?.cantidad, 10) || 1));
            const claveIdem = String(req.body?.clave || '').slice(0, 64);
            if (!g) return err(res, 400, 'Regalo no válido');
            if (!/^[A-Za-z0-9_-]{8,64}$/.test(claveIdem)) return err(res, 400, 'Falta la clave del regalo');
            if (!limRegalo(req.usuario)) return err(res, 429, 'Espera un momento entre regalos');
            const s = await cargarSala(id);
            if (!s) return err(res, 404, 'Este live ya terminó');
            const creador = s.live.creador;
            if (creador === req.usuario) return err(res, 400, 'No puedes enviarte regalos a ti mismo');

            const ref = `regalo:${req.usuario}:${claveIdem}`;
            const repetido = await LiveTx.findOne({ ref }).select('_id').lean();
            if (repetido) return ok(res, { repetido: true });

            const costo = g.monedas * cantidad;
            const pagador = await Usuario.findOneAndUpdate(
                { usuario: req.usuario, monedas: { $gte: costo }, listaNegraAdmin: { $ne: true } },
                { $inc: { monedas: -costo } }, { new: true }).select('monedas').lean();
            if (!pagador) {
                const u = await Usuario.findOne({ usuario: req.usuario }).select('monedas listaNegraAdmin').lean();
                if (u?.listaNegraAdmin) return err(res, 403, 'Tu cuenta no puede enviar regalos');
                return err(res, 402, 'No tienes monedas suficientes', { monedas: u?.monedas || 0, faltan: costo - (u?.monedas || 0) });
            }
            const rep = L.reparto(costo);
            const retener = L.RETENCION_DIAS > 0;
            try {
                await LiveTx.create({
                    tipo: 'regalo', usuario: req.usuario, destinatario: creador, monedas: costo, usd: rep.bruto,
                    creadorUsd: rep.creador, plataformaUsd: rep.plataforma, regaloId: g.id, cantidad, liveId: id, ref,
                    estado: retener ? 'retenida' : 'liberada', liberarEn: retener ? new Date(Date.now() + L.RETENCION_DIAS * 864e5) : null,
                });
            } catch (e) {
                await Usuario.updateOne({ usuario: req.usuario }, { $inc: { monedas: costo } });   // devolver: no se registró
                if (e.code === 11000) return ok(res, { repetido: true, monedas: pagador.monedas + costo });
                throw e;
            }
            await Usuario.updateOne({ usuario: creador }, { $inc: retener ? { saldoRetenido: rep.creador } : { saldo: rep.creador } });
            Live.updateOne({ _id: id }, { $inc: { regalos: cantidad, monedas: costo } }).catch(() => {});
            s.live.regalos = (s.live.regalos || 0) + cantidad;

            const pf = await perfil(req.usuario);
            io.to(rid(id)).emit('regalo', { de: req.usuario, av: pf.avatar, regalo: { id: g.id, nombre: g.nombre, emoji: g.emoji, monedas: g.monedas }, cantidad, total: costo, ts: Date.now() });
            topDonantes(id).then(top => io.to(rid(id)).emit('top', { top })).catch(() => {});
            ok(res, { monedas: pagador.monedas });
        } catch (e) { logger.error(`[live] regalo: ${e.message}`); err(res, 500, 'No se pudo enviar el regalo'); }
    });

    // ── Admin ───────────────────────────────────────────────────────────────
    app.get('/admin/live/resumen', verificarAdmin, async (req, res) => {
        try {
            const [activos, porTipo, retenido] = await Promise.all([
                Live.find({ estado: 'en_vivo' }).sort({ inicio: -1 }).lean(),
                LiveTx.aggregate([{ $match: { estado: { $ne: 'revertida' } } }, { $group: { _id: '$tipo', usd: { $sum: '$usd' }, monedas: { $sum: '$monedas' }, plataforma: { $sum: '$plataformaUsd' }, creadores: { $sum: '$creadorUsd' }, n: { $sum: 1 } } }]),
                LiveTx.aggregate([{ $match: { estado: 'retenida' } }, { $group: { _id: null, usd: { $sum: '$creadorUsd' } } }]),
            ]);
            const t = Object.fromEntries(porTipo.map(x => [x._id, x]));
            const r2 = n => Math.round((n || 0) * 100) / 100;
            ok(res, {
                activos: activos.map(l => publico(l, sala(l._id))),
                ventas: { usd: r2(t.compra?.usd), monedas: t.compra?.monedas || 0, compras: t.compra?.n || 0 },
                regalos: { n: t.regalo?.n || 0, monedas: t.regalo?.monedas || 0, comisionPlataforma: r2(t.regalo?.plataforma), paraCreadores: r2(t.regalo?.creadores), retenido: r2(retenido[0]?.usd) },
                config: { comision: L.COMISION, retencionDias: L.RETENCION_DIAS, proveedor: L.proveedor().tipo, paypal: ppActivo() },
            });
        } catch (e) { logger.error(`[live] admin resumen: ${e.message}`); err(res, 500, 'Error al cargar el resumen'); }
    });

    app.post('/admin/live/:id/finalizar', verificarAdmin, async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.id)) return err(res, 400, 'ID no válido');
        const motivo = L.limpiarChat(req.body?.motivo, 120) || 'Finalizado por moderación';
        ok(res, { finalizado: await finalizar(req.params.id, motivo) });
    });

    // ── Trabajos periódicos ─────────────────────────────────────────────────
    // 1) Cerrar lives sin señal (el navegador del creador se cerró, OBS se detuvo, reinicio del servidor)
    setInterval(async () => {
        try {
            const viejos = await Live.find({ estado: 'en_vivo', latido: { $lt: new Date(Date.now() - 150000) } }).select('_id').lean();
            for (const l of viejos) { const s = sala(l._id); if (!s?.host) await finalizar(l._id, 'La transmisión se detuvo'); }
        } catch (e) { logger.warn(`[live] limpieza: ${e.message}`); }
    }, 60000).unref();

    // 2) Liberar el dinero retenido de los regalos cuando vence la retención
    async function liberar() {
        try {
            const pendientes = await LiveTx.find({ tipo: 'regalo', estado: 'retenida', liberarEn: { $lte: new Date() } }).limit(500).lean();
            for (const g of pendientes) {
                const m = await LiveTx.updateOne({ _id: g._id, estado: 'retenida' }, { $set: { estado: 'liberada' } });
                if (!m.modifiedCount) continue;
                await Usuario.updateOne({ usuario: g.destinatario }, [{ $set: {
                    saldoRetenido: { $max: [0, { $subtract: [{ $ifNull: ['$saldoRetenido', 0] }, g.creadorUsd] }] },
                    saldo: { $add: [{ $ifNull: ['$saldo', 0] }, g.creadorUsd] },
                } }]);
            }
            if (pendientes.length) logger.info(`[live] ${pendientes.length} regalo(s) liberado(s) al saldo retirable`);
        } catch (e) { logger.warn(`[live] liberar: ${e.message}`); }
    }
    setInterval(liberar, 10 * 60000).unref();
    setTimeout(liberar, 30000).unref();

    // 3) Con servidor de medios: lo que está publicando OBS mantiene vivo su live
    if (mtxApi) {
        setInterval(async () => {
            try {
                const r = await fetch(`${mtxApi}/v3/paths/list?itemsPerPage=500`, { signal: AbortSignal.timeout(8000) });
                if (!r.ok) return;
                const activos = ((await r.json()).items || []).filter(p => p.ready).map(p => L.usuarioDeRuta(p.name)).filter(Boolean);
                if (activos.length) await Live.updateMany({ creador: { $in: activos }, estado: 'en_vivo' }, { $set: { latido: new Date() } });
            } catch (e) { logger.debug?.(`[live] MediaMTX API: ${e.message}`); }
        }, 20000).unref();
    }

    logger.info(`[live] Módulo activo · video: ${L.proveedor().tipo} · comisión ${Math.round(L.COMISION * 100)}% · retención ${L.RETENCION_DIAS} días`);

    // ¿Tiene ingresos de lives ya liberados? (habilita el retiro sin descargas)
    const tieneIngresosLive = usuario => LiveTx.exists({ tipo: 'regalo', destinatario: usuario, estado: 'liberada' }).then(Boolean).catch(() => false);
    return { io, Live, LiveTx, finalizar, tieneIngresosLive };
}

module.exports = { registrar, LiveSchema, TxSchema };
