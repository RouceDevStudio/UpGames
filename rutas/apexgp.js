/**
 * APEX GP (games/monoplaza): mejoras y cosméticos con UpCoins y salas multijugador.
 *
 *   GET  /apexgp/catalogo        mejoras, niveles, precios y cosméticos (público)
 *   GET  /apexgp/perfil          lo mío: mejoras, cosméticos, lo equipado y mis UpCoins
 *   POST /apexgp/comprar         { id: 'mejora:motor' | 'cosmetico:patron:rayo', clave }
 *   PUT  /apexgp/equipar         { equipado } (solo se guarda lo que el piloto tiene)
 *
 *   UpCoins (NO retirables, solo monedas) únicamente para el TOP 5 del ranking mundial
 *   de cada semana: 1º 15 · 2º 10 · 3º-5º 5. Las carreras sueltas solo dan puntos.
 *
 *   Campeonato mundial (puntos por carrera, máx. 6 carreras al día):
 *   POST /apexgp/campeonato/carrera    { circuito, vueltas, rivales, dificultad } → ficha firmada
 *   POST /apexgp/campeonato/resultado  { ficha, pos, tiempo } → puntos y posición mundial
 *   GET  /apexgp/campeonato/ranking    ?periodo=semana|global
 *
 *   Contrarreloj (ranking global y semanal con fantasma; top 5 semanal de cada circuito):
 *   POST /apexgp/contrarreloj/sesion   { circuito } → ficha
 *   POST /apexgp/contrarreloj/tiempo   { ficha, tiempo, fantasma }
 *   GET  /apexgp/contrarreloj/ranking  ?circuito=&periodo=semana|global
 *   GET  /apexgp/contrarreloj/fantasma ?circuito=&periodo=semana|global
 *
 *   GET  /apexgp/ranking/elo           mejores pilotos online por ELO
 *
 * Socket.IO, espacio /apexgp (mismo servidor que los lives):
 *   cliente → servidor: lista, crear, unirse, salir, listo, iniciar, estado, vuelta, meta, abandono, revancha, buscar, cancelarBusqueda
 *   servidor → cliente: sala (estado de la sala), estados (coches, ~15 por segundo), resultados, emparejado, elo, error
 */
'use strict';

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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
    elo:        { type: Number, default: A.ELO_INICIAL, index: true },
    online:     { type: Number, default: 0 },          // carreras online puntuadas
}, { collection: 'apexgp_perfiles', timestamps: true });

// Mejor vuelta de contrarreloj por piloto, circuito y semana ('global' = de siempre)
const TiempoSchema = new mongoose.Schema({
    usuario:  { type: String, required: true },
    circuito: { type: String, required: true },
    semana:   { type: String, required: true },
    tiempo:   { type: Number, required: true },
    fantasma: { type: String, default: '' },
    fecha:    { type: Date, default: Date.now },
}, { collection: 'apexgp_tiempos', timestamps: false });
TiempoSchema.index({ usuario: 1, circuito: 1, semana: 1 }, { unique: true });
TiempoSchema.index({ circuito: 1, semana: 1, tiempo: 1 });

// Puntos del campeonato mundial por piloto y semana ('global' = de siempre)
const MundialSchema = new mongoose.Schema({
    usuario:   { type: String, required: true },
    semana:    { type: String, required: true },
    puntos:    { type: Number, default: 0 },
    carreras:  { type: Number, default: 0 },
    victorias: { type: Number, default: 0 },
    fecha:     { type: Date, default: Date.now },
}, { collection: 'apexgp_mundial', timestamps: false });
MundialSchema.index({ usuario: 1, semana: 1 }, { unique: true });
MundialSchema.index({ semana: 1, puntos: -1 });

// Cada carrera de campeonato puntúa una sola vez (ficha) y como mucho 6 al día
const ResultadoSchema = new mongoose.Schema({
    ref:     { type: String, required: true, unique: true },
    usuario: { type: String, required: true, index: true },
    pos:     Number, puntos: Number, circuito: String,
    fecha:   { type: Date, default: Date.now, index: true },
}, { collection: 'apexgp_resultados', timestamps: false });

const claveOk = c => /^[A-Za-z0-9_-]{8,64}$/.test(String(c || ''));
const r2 = n => Math.round(n * 100) / 100;
const LIVERY_MAX = 50000;      // librea propia compartida en la sala (JPEG en base64)

function registrar(app, deps) {
    const { verificarToken, Usuario, LiveTx, io, logger, JWT_SECRET, estaSuspendido } = deps;
    const Perfil = mongoose.models.ApexPerfil || mongoose.model('ApexPerfil', PerfilSchema);
    const Tiempo = mongoose.models.ApexTiempo || mongoose.model('ApexTiempo', TiempoSchema);
    const Mundial = mongoose.models.ApexMundial || mongoose.model('ApexMundial', MundialSchema);
    const Resultado = mongoose.models.ApexResultado || mongoose.model('ApexResultado', ResultadoSchema);
    const SECRETO = `${JWT_SECRET || 'apexgp-dev'}:apexgp-fichas`;
    const firmar = d => jwt.sign({ ...d, jti: crypto.randomBytes(12).toString('hex') }, SECRETO, { expiresIn: '6h' });
    const leerFicha = (f, u, tipo) => { try { const d = jwt.verify(String(f || ''), SECRETO); return d.u === u && d.tipo === tipo ? d : null; } catch (_) { return null; } };
    // premio en UpCoins NO retirables: solo suben las monedas, nunca el saldo en dólares
    async function premiar(u, monedas, ref, planId) {
        if (!(monedas > 0)) return false;
        try { await LiveTx.create({ tipo: 'mision', usuario: u, monedas, usd: 0, planId, metodo: 'mision', ref, estado: 'completada' }); }
        catch (e) { if (e.code === 11000) return false; throw e; }
        try { await Usuario.updateOne({ usuario: u }, { $inc: { monedas } }); }
        catch (e) { await LiveTx.deleteOne({ ref }).catch(() => {}); throw e; }
        return true;
    }
    const ok = (res, d) => res.json({ success: true, ...d });
    const err = (res, code, error, extra) => res.status(code).json({ success: false, error, ...extra });
    const totalUC = async u => Math.floor(UC.saldoUC(await Usuario.findOne({ usuario: u }).select('monedas saldo solicitudPagoPendiente').lean() || {}).total);
    const perfilDe = async u => (await Perfil.findOne({ usuario: u }).lean()) || { usuario: u, mejoras: {}, cosmeticos: [], equipado: null };
    const publico = p => ({ mejoras: A.nivelesMejoras(p), cosmeticos: p.cosmeticos || [], equipado: A.validarEquipado(p.equipado || {}, p), carreras: p.carreras || 0, victorias: p.victorias || 0,
        elo: p.elo || A.ELO_INICIAL, nivel: A.nivelElo(p.elo || A.ELO_INICIAL), online: p.online || 0 });

    app.get('/apexgp/catalogo', (req, res) => { res.set('Cache-Control', 'public, max-age=300'); ok(res, A.catalogo()); });

    // APK de Android con un enlace estable: el de GitHub redirige a una URL firmada que
    // caduca y que algunos gestores de descarga de Android no consiguen reanudar
    const APK_ORIGEN = 'https://github.com/RouceDevStudio/UpGames/releases/download/apex-gp-latest/APEX-GP.apk';
    let apk = { buf: null, t: 0, cargando: null };
    async function cargarApk() {
        if (apk.buf && Date.now() - apk.t < 10 * 60 * 1000) return apk.buf;
        if (!apk.cargando) apk.cargando = (async () => {
            const r = await fetch(APK_ORIGEN, { redirect: 'follow' });
            if (!r.ok) throw new Error(`GitHub ${r.status}`);
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length < 100000 || buf.readUInt32BE(0) !== 0x504b0304) throw new Error('el APK descargado no es válido');
            apk = { buf, t: Date.now(), cargando: null };
            return buf;
        })().finally(() => { apk.cargando = null; });
        return apk.cargando;
    }
    app.get('/apexgp/apk', async (req, res) => {
        try {
            const buf = await cargarApk();
            res.set({ 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': buf.length, 'Content-Disposition': 'attachment; filename="APEX-GP.apk"', 'Cache-Control': 'public, max-age=300', 'Accept-Ranges': 'none' });
            res.end(buf);
        } catch (e) {
            logger.error(`[apexgp] apk: ${e.message}`);
            if (apk.buf) { res.set({ 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="APEX-GP.apk"' }); return res.end(apk.buf); }
            res.redirect(302, APK_ORIGEN);
        }
    });

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

    // ─── Campeonato mundial: puntos por carrera; UpCoins solo al top 5 semanal ──
    const inicioDia = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };
    app.post('/apexgp/campeonato/carrera', verificarToken, (req, res) => {
        const b = req.body || {};
        const c = { circuito: A.circuitoOk(b.circuito), vueltas: Math.max(1, Math.min(70, Math.floor(+b.vueltas) || 0)), rivales: Math.max(0, Math.min(21, Math.floor(+b.rivales) || 0)), dificultad: String(b.dificultad || '') };
        ok(res, { ficha: firmar({ tipo: 'camp', u: req.usuario, ...c, t0: Date.now() }), puntuable: A.carreraPuntuable(c), premios: A.PREMIOS, top: A.TOP_PREMIADO, porDia: A.CARRERAS_DIA });
    });

    const posicionMundial = async (u, semana) => {
        const yo = await Mundial.findOne({ usuario: u, semana }).select('puntos').lean();
        if (!yo) return null;
        return 1 + await Mundial.countDocuments({ semana, puntos: { $gt: yo.puntos } });
    };

    app.post('/apexgp/campeonato/resultado', verificarToken, async (req, res) => {
        const u = req.usuario;
        try {
            const f = leerFicha(req.body?.ficha, u, 'camp');
            if (!f) return err(res, 400, 'La ficha de la carrera no es válida');
            const v = A.validarResultado(f, req.body, Date.now());
            if (!v.ok) return err(res, 400, v.error);
            const semana = A.semanaDe();
            const hoy = await Resultado.countDocuments({ usuario: u, fecha: { $gte: inicioDia() } });
            if (hoy >= A.CARRERAS_DIA) return ok(res, { puntos: 0, tope: true, mensaje: `Hoy ya puntuaron tus ${A.CARRERAS_DIA} carreras`, posicion: await posicionMundial(u, semana) });
            try { await Resultado.create({ ref: `apexgp:camp:${f.jti}`, usuario: u, pos: v.pos, puntos: v.puntos, circuito: f.circuito }); }
            catch (e) { if (e.code === 11000) return ok(res, { puntos: 0, repetido: true, posicion: await posicionMundial(u, semana) }); throw e; }
            if (v.puntos > 0) {
                const inc = { $inc: { puntos: v.puntos, carreras: 1, victorias: v.pos === 1 ? 1 : 0 }, $set: { fecha: new Date() } };
                await Mundial.updateOne({ usuario: u, semana }, inc, { upsert: true });
                await Mundial.updateOne({ usuario: u, semana: 'global' }, inc, { upsert: true });
            }
            ok(res, { puntos: v.puntos, posicion: await posicionMundial(u, semana), semana, premios: A.PREMIOS, top: A.TOP_PREMIADO });
        } catch (e) { logger.error(`[apexgp] resultado: ${e.message}`); err(res, 500, 'No se pudo registrar el resultado'); }
    });

    app.get('/apexgp/campeonato/ranking', async (req, res) => {
        try {
            const semana = req.query.periodo === 'global' ? 'global' : A.semanaDe();
            const filas = await Mundial.find({ semana, puntos: { $gt: 0 } }).sort({ puntos: -1 }).limit(20).select('usuario puntos carreras victorias').lean();
            res.set('Cache-Control', 'public, max-age=30');
            ok(res, { semana, premios: A.PREMIOS, top: A.TOP_PREMIADO, filas: filas.map((r, i) => ({ pos: i + 1, usuario: r.usuario, puntos: r.puntos, carreras: r.carreras, victorias: r.victorias })) });
        } catch (e) { logger.error(`[apexgp] ranking mundial: ${e.message}`); err(res, 500, 'No se pudo cargar el ranking'); }
    });

    // ─── Contrarreloj: ranking con fantasma y premios semanales ─────────────
    app.post('/apexgp/contrarreloj/sesion', verificarToken, (req, res) => {
        ok(res, { ficha: firmar({ tipo: 'crono', u: req.usuario, circuito: A.circuitoOk(req.body?.circuito), t0: Date.now() }) });
    });

    app.post('/apexgp/contrarreloj/tiempo', verificarToken, async (req, res) => {
        const u = req.usuario;
        try {
            const f = leerFicha(req.body?.ficha, u, 'crono');
            if (!f) return err(res, 400, 'La ficha de la sesión no es válida');
            const v = A.validarVuelta(f.circuito, req.body?.tiempo, req.body?.fantasma);
            if (!v.ok) return err(res, 400, v.error);
            if ((Date.now() - f.t0) / 1000 + 5 < v.tiempo) return err(res, 400, 'Esa vuelta duró más que tu sesión');
            const out = {};
            for (const semana of [A.semanaDe(), 'global']) {
                const clave = { usuario: u, circuito: f.circuito, semana };
                const antes = await Tiempo.findOne(clave).select('tiempo').lean();
                if (antes && antes.tiempo <= v.tiempo) { out[semana === 'global' ? 'global' : 'semana'] = false; continue; }
                await Tiempo.updateOne(antes ? { ...clave, tiempo: antes.tiempo } : clave, { $set: { tiempo: v.tiempo, fantasma: req.body.fantasma, fecha: new Date() } }, { upsert: !antes })
                    .catch(e => (e.code === 11000 ? null : Promise.reject(e)));
                out[semana === 'global' ? 'global' : 'semana'] = true;
            }
            const pos = 1 + await Tiempo.countDocuments({ circuito: f.circuito, semana: A.semanaDe(), tiempo: { $lt: v.tiempo } });
            ok(res, { mejorado: out, posicionSemana: pos, tiempo: v.tiempo });
        } catch (e) { logger.error(`[apexgp] tiempo: ${e.message}`); err(res, 500, 'No se pudo guardar el tiempo'); }
    });

    const periodo = q => (q === 'global' ? 'global' : A.semanaDe());
    app.get('/apexgp/contrarreloj/ranking', async (req, res) => {
        try {
            const circuito = A.circuitoOk(req.query.circuito), semana = periodo(req.query.periodo);
            const filas = await Tiempo.find({ circuito, semana }).sort({ tiempo: 1 }).limit(20).select('usuario tiempo fecha').lean();
            res.set('Cache-Control', 'public, max-age=30');
            ok(res, { circuito, semana, premios: A.PREMIOS, filas: filas.map((r, i) => ({ pos: i + 1, usuario: r.usuario, tiempo: r.tiempo, fecha: r.fecha })) });
        } catch (e) { logger.error(`[apexgp] ranking: ${e.message}`); err(res, 500, 'No se pudo cargar el ranking'); }
    });

    app.get('/apexgp/contrarreloj/fantasma', async (req, res) => {
        try {
            const circuito = A.circuitoOk(req.query.circuito), semana = periodo(req.query.periodo);
            const r = await Tiempo.findOne({ circuito, semana }).sort({ tiempo: 1 }).select('usuario tiempo fantasma').lean();
            if (!r || !r.fantasma) return err(res, 404, 'Aún no hay récord en este circuito');
            ok(res, { usuario: r.usuario, tiempo: r.tiempo, fantasma: r.fantasma, hz: A.FANTASMA_HZ });
        } catch (e) { logger.error(`[apexgp] fantasma: ${e.message}`); err(res, 500, 'No se pudo cargar el fantasma'); }
    });

    /** Premia al top 5 de una semana ya cerrada: campeonato mundial y contrarreloj de cada circuito (idempotente). */
    async function premiarSemana(semana) {
        let n = 0;
        const top = await Mundial.find({ semana, puntos: { $gt: 0 } }).sort({ puntos: -1 }).limit(A.TOP_PREMIADO).select('usuario').lean();
        for (let i = 0; i < top.length; i++) {
            if (await premiar(top[i].usuario, A.premioPosicion(i + 1), `apexgp:mundial:${semana}:${i + 1}`, 'apexgp:mundial')) n++;
        }
        for (const circuito of Object.keys(A.CIRCUITOS)) {
            const tt = await Tiempo.find({ circuito, semana }).sort({ tiempo: 1 }).limit(A.TOP_PREMIADO).select('usuario').lean();
            for (let i = 0; i < tt.length; i++) {
                if (await premiar(tt[i].usuario, A.premioPosicion(i + 1), `apexgp:semana:${semana}:${circuito}:${i + 1}`, 'apexgp:semanal')) n++;
            }
        }
        if (n) logger.info(`[apexgp] premios del ranking mundial de ${semana}: ${n}`);
        return n;
    }
    if (io) {
        const revisar = () => premiarSemana(A.semanaAnterior()).catch(e => logger.error(`[apexgp] premios semanales: ${e.message}`));
        setTimeout(revisar, 60000).unref();
        setInterval(revisar, 3600000).unref();
    }

    app.get('/apexgp/ranking/elo', async (req, res) => {
        try {
            const filas = await Perfil.find({ online: { $gt: 0 } }).sort({ elo: -1 }).limit(50).select('usuario elo online victorias').lean();
            res.set('Cache-Control', 'public, max-age=30');
            ok(res, { filas: filas.map((p, i) => ({ pos: i + 1, usuario: p.usuario, elo: p.elo, nivel: A.nivelElo(p.elo), carreras: p.online, victorias: p.victorias || 0 })) });
        } catch (e) { logger.error(`[apexgp] elo: ${e.message}`); err(res, 500, 'No se pudo cargar el ranking'); }
    });

    // ─── Multijugador ───────────────────────────────────────────────────────
    if (!io) return { Perfil, Tiempo, Mundial, premiarSemana };
    const salas = new A.Salas();
    const ns = io.of('/apexgp');
    const lim = L.limitador(40, 25);          // estados: ~15/s por coche con margen
    const limAcc = L.limitador(8, 2);         // crear, unirse, listo…
    const rid = c => `apex:${c}`;
    const emparejador = new A.Emparejador();

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
        actualizarElo(s, res).catch(e => logger.error(`[apexgp] elo: ${e.message}`));
    }

    // ELO entre los pilotos con cuenta (cada usuario cuenta una vez por carrera)
    async function actualizarElo(s, res) {
        const vistos = new Set();
        const conCuenta = res.filter(r => r.usuario && !vistos.has(r.usuario) && vistos.add(r.usuario));
        if (conCuenta.length < 2) return;
        const perfiles = await Perfil.find({ usuario: { $in: conCuenta.map(r => r.usuario) } }).select('usuario elo').lean();
        const elo = Object.fromEntries(perfiles.map(p => [p.usuario, p.elo || A.ELO_INICIAL]));
        const nuevo = A.eloTras(conCuenta.map(r => ({ usuario: r.usuario, elo: elo[r.usuario] || A.ELO_INICIAL, pos: r.pos })));
        await Promise.all(Object.entries(nuevo).map(([u, e]) => Perfil.updateOne({ usuario: u }, { $set: { elo: e }, $inc: { online: 1 } }, { upsert: true })));
        for (const r of conCuenta) {
            const antes = elo[r.usuario] || A.ELO_INICIAL;
            const sk = ns.sockets.get(r.id);
            sk?.emit('elo', { antes, despues: nuevo[r.usuario], nivel: A.nivelElo(nuevo[r.usuario]) });
        }
        void s;
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
        socket.on('disconnect', () => { emparejador.salir(id); dejar(); });
        socket.on('buscar', async (d, cb) => {
            if (!acc()) return cb?.({ ok: false, error: 'Vas muy rápido' });
            dejar();
            const u = socket.data.usuario;
            const elo = u ? ((await Perfil.findOne({ usuario: u }).select('elo').lean().catch(() => null))?.elo || A.ELO_INICIAL) : A.ELO_INICIAL;
            const n = emparejador.entrar(id, await jugadorDe(socket, d), elo, d?.region);
            cb?.({ ok: true, elo, nivel: A.nivelElo(elo), enCola: n });
        });
        socket.on('cancelarBusqueda', () => emparejador.salir(id));
        socket.on('listo', v => { if (!acc()) return; const s = salas.listo(id, v); if (s) emitirSala(s); });
        socket.on('iniciar', cb => {
            if (!acc()) return;
            const r = salas.iniciar(id);
            if (!r.ok) return typeof cb === 'function' ? cb(r) : socket.emit('error_sala', r.error);
            if (r.clasif) ns.to(rid(r.sala.codigo)).emit('clasif', { tFin: r.sala.tFinQ, ahora: Date.now(), seg: r.sala.clasifSeg });
            else ns.to(rid(r.sala.codigo)).emit('salida', { tSalida: r.sala.tSalida, ahora: Date.now(), parrilla: r.sala.parrilla });
            emitirSala(r.sala);
            emitirLista();
            typeof cb === 'function' && cb({ ok: true });
        });
        socket.on('revancha', () => { if (!acc()) return; const s = salas.reiniciar(id); if (s) emitirSala(s); });
        socket.on('reloj', (t, cb) => typeof cb === 'function' && cb(Date.now()));
        socket.on('estado', d => { if (lim(id)) salas.estado(id, d); });
        socket.on('estadosBots', d => { if (lim(id)) salas.estadoBots(id, d); });
        socket.on('botMeta', b => { const s = salas.botMeta(id, String(b)); if (s) emitirSala(s); });
        socket.on('botAbandono', b => { const s = salas.botAbandono(id, String(b)); if (s) emitirSala(s); });
        socket.on('vueltaQ', t => {
            const s = salas.vueltaQ(id, t);
            if (s) ns.to(rid(s.codigo)).emit('tablaQ', salas.tablaQ(s));
        });
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
        for (const s of salas.revisarClasif()) {
            ns.to(rid(s.codigo)).emit('salida', { tSalida: s.tSalida, ahora: Date.now(), parrilla: s.parrilla });
            emitirSala(s);
        }
    }, 66).unref();

    // partida rápida: cada segundo se forman grupos por ELO y región y salen solos
    const CIRC = Object.keys(A.CIRCUITOS);
    setInterval(() => {
        for (const g of emparejador.emparejar()) {
            const vivos = g.filter(x => ns.sockets.get(x.id));
            if (vivos.length < 2) { for (const x of vivos) emparejador.entrar(x.id, x.jugador, x.elo, x.region); continue; }
            const [h, ...resto] = vivos;
            // 22 coches (la IA completa la parrilla), 20 vueltas y 6 minutos de clasificación
            const opciones = { tipo: 'abierta', max: A.MAX_JUGADORES, vueltas: 20, publica: false, rapida: true, nombre: 'Partida rápida', clasifSeg: +process.env.APEXGP_CLASIF_SEG || 360,
                circuito: CIRC[Math.floor(Math.random() * CIRC.length)], clima: Math.random() < 0.2 ? 'variable' : 'seco' };
            const { sala } = salas.crear(h.id, h.jugador, opciones);
            for (const x of resto) salas.unirse(x.id, sala.codigo, x.jugador);
            for (const x of vivos) { salas.listo(x.id, true); const sk = ns.sockets.get(x.id); sk.join(rid(sala.codigo)); sk.leave('apex:lobby'); }
            const r = salas.iniciar(h.id);
            for (const x of vivos) {
                const sk = ns.sockets.get(x.id);
                sk.emit('emparejado', { sala: salas.publico(sala), yo: x.id });
                enviarLibreasA(sk, sala);
            }
            if (r.ok && r.clasif) ns.to(rid(sala.codigo)).emit('clasif', { tFin: sala.tFinQ, ahora: Date.now(), seg: sala.clasifSeg });
            else if (r.ok) ns.to(rid(sala.codigo)).emit('salida', { tSalida: sala.tSalida, ahora: Date.now(), parrilla: sala.parrilla });
            emitirSala(sala);
        }
    }, 1000).unref();
    function enviarLibreasA(sk, s) { for (const j of s.jugadores.values()) if (j.id !== sk.id && j.livery) sk.emit('livery', { id: j.id, livery: j.livery }); }

    return { Perfil, Tiempo, Mundial, salas, premiarSemana, emparejador };
}

module.exports = { registrar, PerfilSchema, TiempoSchema, MundialSchema };
