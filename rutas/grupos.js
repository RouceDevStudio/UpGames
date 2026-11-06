/**
 * ══════════════════════════════════════════════════════════════════
 *  Grupos y comunidades del chat de UpGames
 *
 *  • Grupo     → privado: se entra con el enlace de invitación (?g=CODIGO).
 *  • Comunidad → pública: aparece en Explorar y cualquiera puede unirse.
 *  • +18       → solo adultos (se confirma la edad al entrar; no sale en Explorar
 *                salvo que la persona active "Mostrar +18"). Ahí se permite contenido
 *                para adultos entre adultos. Fuera de los +18 se frena el contenido sexual.
 *  • En TODOS: cero tolerancia (menores, zoofilia, abuso, gore real) → se bloquea,
 *    se abre incidente con expediente y se avisa al admin (modulos/ceroTolerancia.js).
 *
 *  Roles: dueño (1), admins y miembros. Los admins expulsan, banean, fijan,
 *  borran mensajes, cambian la info y el enlace; solo el dueño nombra admins.
 *  Mensajes: responder, reaccionar, editar (15 min), borrar, @menciones (push),
 *  "escribiendo…", fijado, modo anuncios (solo admins escriben) y reportes.
 *
 *  GET    /grupos/mios                         mis grupos con no leídos
 *  GET    /grupos/no-leidos                    total para el globo del menú
 *  GET    /grupos/explorar?q=&adultos=1        comunidades públicas
 *  GET    /grupos/invitacion/:codigo           vista previa de una invitación
 *  POST   /grupos                              crear { nombre, descripcion, tipo, adultos, avatar, etiquetas }
 *  GET    /grupos/:id                          información (+ mi rol)
 *  PUT    /grupos/:id                          editar (admins)
 *  DELETE /grupos/:id                          eliminar (dueño)
 *  POST   /grupos/:id/unirse                   { codigo?, confirmoEdad? }
 *  POST   /grupos/:id/salir
 *  POST   /grupos/:id/codigo                   nuevo enlace de invitación (admins)
 *  GET    /grupos/:id/miembros
 *  POST   /grupos/:id/miembros/:usuario        { accion: admin|miembro|expulsar|banear|desbanear|dueno }
 *  GET    /grupos/:id/mensajes?antes=|desde=   como el chat privado (cursor del servidor)
 *  POST   /grupos/:id/mensajes                 { texto, imagen, replyTo }
 *  PATCH  /grupos/:id/mensajes/:mid            editar el mío
 *  DELETE /grupos/:id/mensajes/:mid            el mío o cualquiera si soy admin
 *  POST   /grupos/:id/mensajes/:mid/reaccion   { emoji }
 *  POST   /grupos/:id/mensajes/:mid/fijar      { quitar? } (admins)
 *  POST   /grupos/:id/mensajes/:mid/reportar   { motivo }
 *  POST   /grupos/:id/escribiendo
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');

const REACCIONES = ['❤️', '😂', '😮', '😢', '👍', '🔥'];
const PAGINA = 40, MAX_MIEMBROS = 5000, MAX_GRUPOS_POR_USUARIO = 80;
const ETIQUETAS = ['juegos', 'mods', 'emuladores', 'android', 'pc', 'consolas', 'creadores', 'arte', 'musica', 'memes', 'noticias', 'ayuda', 'competitivo', 'anime', 'tecnologia', 'social'];
const MOTIVOS_REPORTE = { menores: 1, zoofilia: 1, abuso: 1, gore: 1, sexual: 1, odio: 1, acoso: 1, spam: 1, estafa: 1, otro: 1 };
const esId = s => /^[a-f\d]{24}$/i.test(String(s || ''));
const limpio = (s, max) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
const linea = (s, max) => limpio(s, max).replace(/\s+/g, ' ');
const nuevoCodigo = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8).padEnd(8, 'x');
const online = f => !!f && Date.now() - new Date(f).getTime() < 2 * 60e3;

const MiembroSchema = new mongoose.Schema({
    u:      { type: String, required: true },
    rol:    { type: String, enum: ['dueno', 'admin', 'miembro'], default: 'miembro' },
    desde:  { type: Date, default: Date.now },
    leido:  { type: Date, default: Date.now },
}, { _id: false });
const GrupoSchema = new mongoose.Schema({
    nombre:      { type: String, required: true, maxlength: 50 },
    descripcion: { type: String, default: '', maxlength: 500 },
    reglas:      { type: String, default: '', maxlength: 1500 },
    avatar:      { type: String, default: '' },
    tipo:        { type: String, enum: ['grupo', 'comunidad'], default: 'grupo', index: true },
    adultos:     { type: Boolean, default: false, index: true },
    soloAdmins:  { type: Boolean, default: false },
    etiquetas:   { type: [String], default: [] },
    dueno:       { type: String, required: true, index: true },
    miembros:    { type: [MiembroSchema], default: [] },
    nMiembros:   { type: Number, default: 1, index: true },
    baneados:    { type: [String], default: [] },
    codigo:      { type: String, required: true, unique: true },
    fijado:      { id: String, de: String, texto: String, imagen: Boolean, por: String, fecha: Date },
    ultimo:      { de: String, texto: String, imagen: Boolean, fecha: Date, tipo: String },
    creado:      { type: Date, default: Date.now },
    actividad:   { type: Date, default: Date.now, index: true },
    suspendido:  { type: Boolean, default: false },   // un admin de UpGames puede cerrarlo
}, { collection: 'grupos' });
GrupoSchema.index({ 'miembros.u': 1 });
GrupoSchema.index({ nombre: 'text', descripcion: 'text', etiquetas: 'text' });
const Grupo = mongoose.models.Grupo || mongoose.model('Grupo', GrupoSchema);

const GMensajeSchema = new mongoose.Schema({
    grupo:       { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    de:          { type: String, required: true },
    tipo:        { type: String, enum: ['msg', 'sistema'], default: 'msg' },
    texto:       { type: String, default: '', maxlength: 2000 },
    imagen:      { type: String, default: '' },
    fecha:       { type: Date, default: Date.now, expires: 180 * 864e5 },
    actualizado: { type: Date, default: Date.now },
    editado:     { type: Boolean, default: false },
    borrado:     { type: Boolean, default: false },
    borradoPor:  { type: String, default: '' },
    replyTo:     { id: String, de: String, texto: String, imagen: Boolean },
    reacciones:  { type: [{ u: String, e: String, _id: false }], default: [] },
    menciones:   { type: [String], default: [] },
}, { collection: 'grupo_mensajes' });
GMensajeSchema.index({ grupo: 1, fecha: -1 });
GMensajeSchema.index({ grupo: 1, actualizado: 1 });
const GMensaje = mongoose.models.GMensaje || mongoose.model('GMensaje', GMensajeSchema);

function registrar(app, deps) {
    const { verificarToken, Usuario, Notificacion, push, urlImagenSegura, Moderacion, CeroTolerancia, Limites, logger } = deps;
    const ok = (res, d = {}) => res.json({ success: true, ...d });
    const err = (res, code, error, extra = {}) => res.status(code).json({ success: false, error, ...extra });
    const escribiendo = new Map();   // grupoId → Map(usuario → ts)

    const miembro = (g, u) => (g.miembros || []).find(m => m.u === u);
    const esAdmin = (g, u) => ['dueno', 'admin'].includes(miembro(g, u)?.rol);
    const serial = m => ({
        id: m._id, de: m.de, tipo: m.tipo || 'msg',
        texto: m.borrado ? '' : m.texto, imagen: m.borrado ? '' : (m.imagen || ''),
        fecha: m.fecha, editado: !!m.editado, borrado: !!m.borrado, borradoPor: m.borrado ? (m.borradoPor || '') : '',
        replyTo: m.replyTo && m.replyTo.id ? m.replyTo : null,
        reacciones: m.borrado ? [] : (m.reacciones || []),
    });
    const vistaGrupo = (g, yo, extra = {}) => {
        const mio = yo ? miembro(g, yo) : null;
        return {
            id: g._id, nombre: g.nombre, descripcion: g.descripcion, reglas: g.reglas, avatar: g.avatar, tipo: g.tipo, adultos: !!g.adultos,
            soloAdmins: !!g.soloAdmins, etiquetas: g.etiquetas || [], dueno: g.dueno, nMiembros: g.nMiembros || (g.miembros || []).length,
            creado: g.creado, actividad: g.actividad, fijado: g.fijado?.id ? g.fijado : null,
            soyMiembro: !!mio, miRol: mio?.rol || null,
            codigo: mio && (mio.rol !== 'miembro' || g.tipo === 'comunidad') ? g.codigo : undefined,
            ...extra,
        };
    };
    async function cargar(req, res, { requiereMiembro = true, admin = false, campos } = {}) {
        if (!esId(req.params.id)) { err(res, 400, 'Grupo inválido'); return null; }
        const g = await Grupo.findById(req.params.id).select(campos || '').lean();
        if (!g || g.suspendido) { err(res, 404, 'Este grupo ya no existe'); return null; }
        if (requiereMiembro && !miembro(g, req.usuario)) { err(res, 403, 'No eres miembro de este grupo', { code: 'NO_MIEMBRO' }); return null; }
        if (admin && !esAdmin(g, req.usuario)) { err(res, 403, 'Solo los administradores del grupo pueden hacer esto'); return null; }
        return g;
    }
    async function sistema(g, texto) {
        const ahora = new Date();
        const m = await new GMensaje({ grupo: g._id, de: 'upgames', tipo: 'sistema', texto, fecha: ahora, actualizado: ahora }).save();
        await Grupo.updateOne({ _id: g._id }, { $set: { ultimo: { de: 'upgames', texto, imagen: false, fecha: ahora, tipo: 'sistema' }, actividad: ahora } });
        return m;
    }
    // Revisión de textos (nombre, descripción, mensajes): cero tolerancia + sexual fuera de los +18
    async function revisar({ texto, g, req, donde }) {
        const cero = await CeroTolerancia.frenarTexto({ texto, usuario: req.usuario, donde, ref: g ? String(g._id) : '', req });
        if (cero) return cero;
        if (!g?.adultos) {
            const m = Moderacion.reglas(texto, 'chat');
            if (m.bloquear && m.categoria === 'sexual') return { status: 400, error: 'El contenido para adultos solo se permite en grupos y comunidades marcados +18.', code: 'NO_ADULTOS' };
            if (m.bloquear && (m.categoria === 'odio' || m.categoria === 'spam')) return { status: 400, error: `No se envió porque ${Moderacion.MENSAJE[m.categoria]}.` };
        }
        return null;
    }
    async function subirAvatar(raw) {
        if (!raw) return '';
        if (/^data:image\//.test(raw)) {
            if (raw.length > 4 * 1024 * 1024 || !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(raw)) throw Object.assign(new Error('Imagen no válida (máx 3 MB)'), { status: 400 });
            return deps.imagenes.subir(raw, { carpeta: 'grupos', ancho: 400, alto: 400 });
        }
        const u = urlImagenSegura(raw);
        if (!u) throw Object.assign(new Error('Imagen no válida'), { status: 400 });
        return u;
    }

    // ── Listas ───────────────────────────────────────────────────────────
    app.get('/grupos/mios', verificarToken, async (req, res) => {
        try {
            const yo = req.usuario;
            const gs = await Grupo.find({ 'miembros.u': yo, suspendido: { $ne: true } }).select('nombre avatar tipo adultos soloAdmins nMiembros ultimo actividad miembros.u miembros.leido miembros.rol').sort({ actividad: -1 }).limit(MAX_GRUPOS_POR_USUARIO).lean();
            const conteos = await Promise.all(gs.map(g => {
                const m = miembro(g, yo);
                return GMensaje.countDocuments({ grupo: g._id, fecha: { $gt: m?.leido || new Date(0) }, de: { $ne: yo }, tipo: 'msg', borrado: { $ne: true } }).limit(100);
            }));
            ok(res, { grupos: gs.map((g, i) => ({ id: g._id, nombre: g.nombre, avatar: g.avatar, tipo: g.tipo, adultos: !!g.adultos, soloAdmins: !!g.soloAdmins, nMiembros: g.nMiembros, ultimo: g.ultimo || null, actividad: g.actividad, noLeidos: conteos[i], miRol: miembro(g, yo)?.rol })) });
        } catch (e) { logger.error(`grupos/mios: ${e.message}`); err(res, 500, 'No se pudieron cargar tus grupos'); }
    });
    app.get('/grupos/no-leidos', verificarToken, async (req, res) => {
        try {
            const gs = await Grupo.find({ 'miembros.u': req.usuario, suspendido: { $ne: true } }).select('miembros.u miembros.leido').limit(MAX_GRUPOS_POR_USUARIO).lean();
            const n = await Promise.all(gs.map(g => GMensaje.countDocuments({ grupo: g._id, fecha: { $gt: miembro(g, req.usuario)?.leido || new Date(0) }, de: { $ne: req.usuario }, tipo: 'msg' }).limit(100)));
            ok(res, { noLeidos: n.reduce((a, b) => a + b, 0) });
        } catch (e) { err(res, 500, 'Error interno'); }
    });
    app.get('/grupos/explorar', verificarToken, async (req, res) => {
        try {
            const q = linea(req.query.q, 60), adultos = req.query.adultos === '1', etiqueta = ETIQUETAS.includes(req.query.etiqueta) ? req.query.etiqueta : '';
            const f = { tipo: 'comunidad', suspendido: { $ne: true }, ...(adultos ? {} : { adultos: { $ne: true } }), ...(etiqueta ? { etiquetas: etiqueta } : {}) };
            if (q) f.$or = [{ nombre: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { etiquetas: q.toLowerCase() }, { descripcion: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
            const gs = await Grupo.find(f).select('nombre descripcion avatar tipo adultos etiquetas nMiembros actividad miembros.u').sort({ nMiembros: -1, actividad: -1 }).limit(40).lean();
            ok(res, { etiquetas: ETIQUETAS, comunidades: gs.map(g => ({ id: g._id, nombre: g.nombre, descripcion: g.descripcion, avatar: g.avatar, adultos: !!g.adultos, etiquetas: g.etiquetas, nMiembros: g.nMiembros, activa: Date.now() - new Date(g.actividad) < 864e5, soyMiembro: !!miembro(g, req.usuario) })) });
        } catch (e) { logger.error(`grupos/explorar: ${e.message}`); err(res, 500, 'No se pudo cargar Explorar'); }
    });
    app.get('/grupos/invitacion/:codigo', verificarToken, async (req, res) => {
        try {
            const g = await Grupo.findOne({ codigo: String(req.params.codigo || '').slice(0, 20), suspendido: { $ne: true } }).select('nombre descripcion reglas avatar tipo adultos etiquetas nMiembros dueno miembros.u baneados codigo').lean();
            if (!g) return err(res, 404, 'Esta invitación ya no es válida');
            ok(res, { grupo: { ...vistaGrupo(g, req.usuario), baneado: (g.baneados || []).includes(req.usuario), codigo: undefined } });
        } catch (e) { err(res, 500, 'Error interno'); }
    });

    // ── Crear / ver / editar / eliminar ──────────────────────────────────
    app.post('/grupos', verificarToken, async (req, res) => {
        try {
            const nombre = linea(req.body.nombre, 50), descripcion = limpio(req.body.descripcion, 500);
            if (nombre.length < 3) return err(res, 400, 'El nombre necesita al menos 3 caracteres');
            const tipo = req.body.tipo === 'comunidad' ? 'comunidad' : 'grupo';
            const adultos = req.body.adultos === true;
            if (!(await Limites.permitir(`grupo-crear:${req.usuario}`, [[Limites.DIA, 5]]))) return err(res, 429, 'Ya creaste varios grupos hoy. Prueba mañana.');
            if ((await Grupo.countDocuments({ 'miembros.u': req.usuario })) >= MAX_GRUPOS_POR_USUARIO) return err(res, 400, `Puedes estar en ${MAX_GRUPOS_POR_USUARIO} grupos como máximo`);
            const bad = await revisar({ texto: `${nombre}\n${descripcion}`, g: { adultos }, req, donde: 'creación de grupo' });
            if (bad) return err(res, bad.status, bad.error, { code: bad.code });
            const avatar = await subirAvatar(req.body.avatar);
            const etiquetas = (Array.isArray(req.body.etiquetas) ? req.body.etiquetas : []).filter(e => ETIQUETAS.includes(e)).slice(0, 4);
            const ahora = new Date();
            const g = await new Grupo({ nombre, descripcion, reglas: limpio(req.body.reglas, 1500), avatar, tipo, adultos, etiquetas, dueno: req.usuario,
                miembros: [{ u: req.usuario, rol: 'dueno', desde: ahora, leido: ahora }], nMiembros: 1, codigo: nuevoCodigo(), creado: ahora, actividad: ahora }).save();
            await sistema(g, `@${req.usuario} creó ${tipo === 'comunidad' ? 'la comunidad' : 'el grupo'} «${nombre}»`);
            CeroTolerancia.vigilarImagen({ imagen: avatar, usuario: req.usuario, donde: `foto del grupo «${nombre}»`, ref: String(g._id), req, ocultar: () => Grupo.updateOne({ _id: g._id }, { $set: { avatar: '' } }) });
            ok(res, { grupo: vistaGrupo(g.toObject(), req.usuario) });
        } catch (e) { if (e.status) return err(res, e.status, e.message); logger.error(`grupos crear: ${e.message}`); err(res, 500, 'No se pudo crear el grupo'); }
    });
    app.get('/grupos/:id', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res, { requiereMiembro: false }); if (!g) return;
            const soy = miembro(g, req.usuario);
            if (!soy && g.tipo !== 'comunidad') return err(res, 403, 'Este grupo es privado: necesitas una invitación', { code: 'PRIVADO' });
            ok(res, { grupo: vistaGrupo(g, req.usuario, { baneado: (g.baneados || []).includes(req.usuario) }) });
        } catch (e) { err(res, 500, 'Error interno'); }
    });
    app.put('/grupos/:id', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res, { admin: true }); if (!g) return;
            const set = {};
            if (req.body.nombre !== undefined) { const n = linea(req.body.nombre, 50); if (n.length < 3) return err(res, 400, 'El nombre necesita al menos 3 caracteres'); set.nombre = n; }
            if (req.body.descripcion !== undefined) set.descripcion = limpio(req.body.descripcion, 500);
            if (req.body.reglas !== undefined) set.reglas = limpio(req.body.reglas, 1500);
            if (typeof req.body.soloAdmins === 'boolean') set.soloAdmins = req.body.soloAdmins;
            if (typeof req.body.adultos === 'boolean') set.adultos = req.body.adultos;
            if (['grupo', 'comunidad'].includes(req.body.tipo)) set.tipo = req.body.tipo;
            if (Array.isArray(req.body.etiquetas)) set.etiquetas = req.body.etiquetas.filter(e => ETIQUETAS.includes(e)).slice(0, 4);
            const bad = await revisar({ texto: `${set.nombre || ''}\n${set.descripcion || ''}\n${set.reglas || ''}`, g: { ...g, ...set }, req, donde: `edición del grupo «${g.nombre}»` });
            if (bad) return err(res, bad.status, bad.error, { code: bad.code });
            if (req.body.avatar !== undefined) set.avatar = await subirAvatar(req.body.avatar);
            await Grupo.updateOne({ _id: g._id }, { $set: set });
            if (set.avatar) CeroTolerancia.vigilarImagen({ imagen: set.avatar, usuario: req.usuario, donde: `foto del grupo «${set.nombre || g.nombre}»`, ref: String(g._id), req, ocultar: () => Grupo.updateOne({ _id: g._id }, { $set: { avatar: '' } }) });
            const cambios = [set.nombre && 'el nombre', set.descripcion !== undefined && 'la descripción', set.reglas !== undefined && 'las reglas', set.avatar !== undefined && 'la foto', set.soloAdmins !== undefined && (set.soloAdmins ? 'el modo anuncios (solo admins escriben)' : 'que todos escriban'), set.adultos !== undefined && (set.adultos ? 'el modo +18' : 'quitar el +18'), set.tipo && `el tipo (${set.tipo})`].filter(Boolean);
            if (cambios.length) await sistema(g, `@${req.usuario} cambió ${cambios.join(', ')}`);
            const g2 = await Grupo.findById(g._id).lean();
            ok(res, { grupo: vistaGrupo(g2, req.usuario) });
        } catch (e) { if (e.status) return err(res, e.status, e.message); logger.error(`grupos editar: ${e.message}`); err(res, 500, 'No se pudo guardar'); }
    });
    app.delete('/grupos/:id', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res); if (!g) return;
            if (g.dueno !== req.usuario) return err(res, 403, 'Solo el dueño puede eliminar el grupo');
            await Promise.all([Grupo.deleteOne({ _id: g._id }), GMensaje.deleteMany({ grupo: g._id })]);
            ok(res);
        } catch (e) { err(res, 500, 'No se pudo eliminar'); }
    });

    // ── Entrar / salir / invitación ──────────────────────────────────────
    app.post('/grupos/:id/unirse', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res, { requiereMiembro: false }); if (!g) return;
            if (miembro(g, req.usuario)) return ok(res, { grupo: vistaGrupo(g, req.usuario) });
            if ((g.baneados || []).includes(req.usuario)) return err(res, 403, 'Los administradores te sacaron de este grupo');
            if (g.tipo !== 'comunidad' && String(req.body.codigo || '') !== g.codigo) return err(res, 403, 'Este grupo es privado: necesitas el enlace de invitación', { code: 'PRIVADO' });
            if (g.adultos && req.body.confirmoEdad !== true) return err(res, 400, 'Confirma que eres mayor de 18 años para entrar', { code: 'EDAD' });
            if ((g.nMiembros || 0) >= MAX_MIEMBROS) return err(res, 400, 'El grupo está lleno');
            if (await CeroTolerancia.restringido(req.usuario)) return err(res, 403, 'Tu cuenta está restringida mientras el equipo de seguridad revisa un reporte.');
            if ((await Grupo.countDocuments({ 'miembros.u': req.usuario })) >= MAX_GRUPOS_POR_USUARIO) return err(res, 400, `Puedes estar en ${MAX_GRUPOS_POR_USUARIO} grupos como máximo`);
            const ahora = new Date();
            const r = await Grupo.updateOne({ _id: g._id, 'miembros.u': { $ne: req.usuario } }, { $push: { miembros: { u: req.usuario, rol: 'miembro', desde: ahora, leido: new Date(ahora - 1) } }, $inc: { nMiembros: 1 } });
            if (r.modifiedCount) await sistema(g, `@${req.usuario} se unió`);
            const g2 = await Grupo.findById(g._id).lean();
            ok(res, { grupo: vistaGrupo(g2, req.usuario) });
        } catch (e) { logger.error(`grupos unirse: ${e.message}`); err(res, 500, 'No se pudo entrar'); }
    });
    app.post('/grupos/:id/salir', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res); if (!g) return;
            const quedan = g.miembros.filter(m => m.u !== req.usuario);
            if (!quedan.length) { await Promise.all([Grupo.deleteOne({ _id: g._id }), GMensaje.deleteMany({ grupo: g._id })]); return ok(res, { eliminado: true }); }
            const set = {};
            if (g.dueno === req.usuario) {
                // El grupo pasa al admin más antiguo; si no hay, al miembro más antiguo
                const nuevo = quedan.filter(m => m.rol === 'admin').sort((a, b) => a.desde - b.desde)[0] || quedan.sort((a, b) => a.desde - b.desde)[0];
                set.dueno = nuevo.u;
                await Grupo.updateOne({ _id: g._id }, { $pull: { miembros: { u: req.usuario } }, $inc: { nMiembros: -1 }, $set: set });
                await Grupo.updateOne({ _id: g._id, 'miembros.u': nuevo.u }, { $set: { 'miembros.$.rol': 'dueno' } });
                await sistema(g, `@${req.usuario} salió. Ahora @${nuevo.u} es el dueño`);
            } else {
                await Grupo.updateOne({ _id: g._id }, { $pull: { miembros: { u: req.usuario } }, $inc: { nMiembros: -1 } });
                await sistema(g, `@${req.usuario} salió`);
            }
            ok(res);
        } catch (e) { err(res, 500, 'No se pudo salir'); }
    });
    app.post('/grupos/:id/codigo', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res, { admin: true }); if (!g) return;
            const codigo = nuevoCodigo();
            await Grupo.updateOne({ _id: g._id }, { $set: { codigo } });
            ok(res, { codigo });
        } catch (e) { err(res, 500, 'Error interno'); }
    });

    // ── Miembros ─────────────────────────────────────────────────────────
    app.get('/grupos/:id/miembros', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res); if (!g) return;
            const nombres = g.miembros.map(m => m.u).slice(0, 1000);
            const us = await Usuario.find({ usuario: { $in: nombres } }).select('usuario avatar verificadoNivel ultimoLogin').lean();
            const por = new Map(us.map(u => [u.usuario, u]));
            const orden = { dueno: 0, admin: 1, miembro: 2 };
            const lista = g.miembros.slice(0, 1000).map(m => { const u = por.get(m.u) || {}; return { usuario: m.u, rol: m.rol, desde: m.desde, avatar: u.avatar || '', verificadoNivel: u.verificadoNivel || 0, online: online(u.ultimoLogin) }; })
                .sort((a, b) => (orden[a.rol] - orden[b.rol]) || (b.online - a.online) || a.usuario.localeCompare(b.usuario));
            ok(res, { miembros: lista, baneados: esAdmin(g, req.usuario) ? (g.baneados || []) : [] });
        } catch (e) { err(res, 500, 'Error interno'); }
    });
    app.post('/grupos/:id/miembros/:usuario', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res, { admin: true }); if (!g) return;
            const obj = String(req.params.usuario || '').toLowerCase(), acc = String(req.body.accion || '');
            const yoRol = miembro(g, req.usuario).rol, suRol = miembro(g, obj)?.rol;
            if (obj === req.usuario) return err(res, 400, 'No puedes hacerte esto a ti mismo');
            if (suRol === 'dueno') return err(res, 403, 'Nadie puede cambiar al dueño del grupo');
            if (suRol === 'admin' && yoRol !== 'dueno') return err(res, 403, 'Solo el dueño puede tocar a otros administradores');
            if (['admin', 'miembro', 'dueno'].includes(acc)) {
                if (yoRol !== 'dueno') return err(res, 403, 'Solo el dueño nombra administradores');
                if (!suRol) return err(res, 404, 'Esa persona no está en el grupo');
                if (acc === 'dueno') {
                    await Grupo.updateOne({ _id: g._id, 'miembros.u': obj }, { $set: { 'miembros.$.rol': 'dueno', dueno: obj } });
                    await Grupo.updateOne({ _id: g._id, 'miembros.u': req.usuario }, { $set: { 'miembros.$.rol': 'admin' } });
                    await sistema(g, `@${req.usuario} le pasó el grupo a @${obj}`);
                } else {
                    await Grupo.updateOne({ _id: g._id, 'miembros.u': obj }, { $set: { 'miembros.$.rol': acc } });
                    await sistema(g, acc === 'admin' ? `@${obj} ahora es administrador` : `@${obj} ya no es administrador`);
                }
            } else if (acc === 'expulsar' || acc === 'banear') {
                if (suRol) await Grupo.updateOne({ _id: g._id }, { $pull: { miembros: { u: obj } }, $inc: { nMiembros: -1 }, ...(acc === 'banear' ? { $addToSet: { baneados: obj } } : {}) });
                else if (acc === 'banear') await Grupo.updateOne({ _id: g._id }, { $addToSet: { baneados: obj } });
                else return err(res, 404, 'Esa persona no está en el grupo');
                await sistema(g, `@${req.usuario} ${acc === 'banear' ? 'baneó' : 'sacó'} a @${obj}`);
            } else if (acc === 'desbanear') {
                await Grupo.updateOne({ _id: g._id }, { $pull: { baneados: obj } });
            } else return err(res, 400, 'Acción no válida');
            ok(res);
        } catch (e) { logger.error(`grupos miembros: ${e.message}`); err(res, 500, 'No se pudo aplicar'); }
    });

    // ── Mensajes ─────────────────────────────────────────────────────────
    app.get('/grupos/:id/mensajes', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res, { campos: 'miembros fijado tipo adultos soloAdmins suspendido nombre' }); if (!g) return;
            const cursor = Date.now(), desde = Number(req.query.desde) || 0, antes = Number(req.query.antes) || 0;
            let mensajes, hayMas = false;
            if (desde) {
                const d = new Date(desde - 1500);
                mensajes = await GMensaje.find({ grupo: g._id, $or: [{ fecha: { $gt: d } }, { actualizado: { $gt: d } }] }).sort({ fecha: 1 }).limit(300).lean();
            } else {
                const f = antes ? { grupo: g._id, fecha: { $lt: new Date(antes) } } : { grupo: g._id };
                const filas = await GMensaje.find(f).sort({ fecha: -1 }).limit(PAGINA + 1).lean();
                hayMas = filas.length > PAGINA;
                mensajes = filas.slice(0, PAGINA).reverse();
            }
            if (!antes) Grupo.updateOne({ _id: g._id, 'miembros.u': req.usuario }, { $set: { 'miembros.$.leido': new Date() } }).catch(() => {});
            // Avatares de quienes aparecen en esta página
            const autores = [...new Set(mensajes.map(m => m.de).filter(u => u !== 'upgames'))];
            const us = autores.length ? await Usuario.find({ usuario: { $in: autores } }).select('usuario avatar verificadoNivel').lean() : [];
            const esc = escribiendo.get(String(g._id));
            const tecleando = esc ? [...esc].filter(([u, t]) => u !== req.usuario && cursor - t < 6000).map(([u]) => u).slice(0, 3) : [];
            ok(res, { mensajes: mensajes.map(serial), hayMas, cursor, escribiendo: tecleando, fijado: g.fijado?.id ? g.fijado : null,
                autores: Object.fromEntries(us.map(u => [u.usuario, { avatar: u.avatar || '', v: u.verificadoNivel || 0 }])) });
        } catch (e) { logger.error(`grupos mensajes: ${e.message}`); err(res, 500, 'Error interno'); }
    });
    app.post('/grupos/:id/mensajes', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res); if (!g) return;
            if (g.soloAdmins && !esAdmin(g, req.usuario)) return err(res, 403, 'En este grupo solo los administradores pueden escribir', { code: 'SOLO_ADMINS' });
            const texto = typeof req.body.texto === 'string' ? limpio(req.body.texto, 2000) : '';
            const raw = typeof req.body.imagen === 'string' ? req.body.imagen.trim() : '';
            const imagen = raw ? urlImagenSegura(raw) : '';
            if (raw && !imagen) return err(res, 400, 'Imagen inválida');
            if (!texto && !imagen) return err(res, 400, 'Mensaje vacío');
            if (!(await Limites.permitir(`gmsg:${req.usuario}`, [[Limites.MIN, 30]]))) return err(res, 429, 'Vas muy rápido. Espera un momento.');
            const bad = await revisar({ texto, g, req, donde: `grupo «${g.nombre}»` });
            if (bad) return err(res, bad.status, bad.error, { code: bad.code });
            let replyTo;
            if (esId(req.body.replyTo)) {
                const o = await GMensaje.findOne({ _id: req.body.replyTo, grupo: g._id }).select('de texto imagen borrado').lean();
                if (o && !o.borrado) replyTo = { id: String(o._id), de: o.de, texto: (o.texto || '').slice(0, 140), imagen: !!o.imagen };
            }
            const nombres = new Set(g.miembros.map(m => m.u));
            const menciones = [...new Set((texto.match(/@([a-z0-9_.]{3,20})/gi) || []).map(x => x.slice(1).toLowerCase()))].filter(u => nombres.has(u) && u !== req.usuario).slice(0, 10);
            if (replyTo && replyTo.de !== req.usuario && nombres.has(replyTo.de) && !menciones.includes(replyTo.de)) menciones.push(replyTo.de);
            const ahora = new Date();
            const m = await new GMensaje({ grupo: g._id, de: req.usuario, texto, imagen, replyTo, menciones, fecha: ahora, actualizado: ahora }).save();
            escribiendo.get(String(g._id))?.delete(req.usuario);
            await Grupo.updateOne({ _id: g._id }, { $set: { ultimo: { de: req.usuario, texto: texto.slice(0, 140), imagen: !!imagen, fecha: ahora, tipo: 'msg' }, actividad: ahora } });
            Grupo.updateOne({ _id: g._id, 'miembros.u': req.usuario }, { $set: { 'miembros.$.leido': ahora } }).catch(() => {});
            CeroTolerancia.vigilarImagen({ imagen, usuario: req.usuario, donde: `grupo «${g.nombre}»`, ref: String(m._id), texto, req,
                ocultar: () => GMensaje.updateOne({ _id: m._id }, { $set: { borrado: true, borradoPor: 'NEXUS', texto: '', imagen: '', actualizado: new Date() } }) });
            // Solo las menciones y respuestas avisan al móvil (un grupo activo no debe llenar de notificaciones)
            if (menciones.length) push.alCrear(menciones.map(u => ({ destinatario: u, emisor: req.usuario, tipo: 'sistema', itemTitle: `@${req.usuario} en ${g.nombre}`, mensaje: texto || '📷 Foto' })));
            ok(res, { mensaje: serial(m.toObject()), cursor: Date.now() });
        } catch (e) { logger.error(`grupos enviar: ${e.message}`); err(res, 500, 'No se pudo enviar'); }
    });
    app.patch('/grupos/:id/mensajes/:mid', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res); if (!g) return;
            if (!esId(req.params.mid)) return err(res, 400, 'ID inválido');
            const texto = typeof req.body.texto === 'string' ? limpio(req.body.texto, 2000) : '';
            if (!texto) return err(res, 400, 'Texto inválido');
            const m = await GMensaje.findOne({ _id: req.params.mid, grupo: g._id });
            if (!m || m.de !== req.usuario || m.tipo !== 'msg') return err(res, 404, 'Mensaje no encontrado');
            if (m.borrado) return err(res, 400, 'El mensaje fue eliminado');
            if (Date.now() - m.fecha.getTime() > 15 * 60e3) return err(res, 400, 'Solo puedes editar durante 15 minutos');
            const bad = await revisar({ texto, g, req, donde: `grupo «${g.nombre}» (edición)` });
            if (bad) return err(res, bad.status, bad.error, { code: bad.code });
            m.texto = texto; m.editado = true; m.actualizado = new Date(); await m.save();
            ok(res, { mensaje: serial(m.toObject()) });
        } catch (e) { err(res, 500, 'Error interno'); }
    });
    app.delete('/grupos/:id/mensajes/:mid', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res); if (!g) return;
            if (!esId(req.params.mid)) return err(res, 400, 'ID inválido');
            const m = await GMensaje.findOne({ _id: req.params.mid, grupo: g._id });
            if (!m) return err(res, 404, 'Mensaje no encontrado');
            const admin = esAdmin(g, req.usuario);
            if (m.de !== req.usuario && !admin) return err(res, 403, 'Solo puedes eliminar tus mensajes');
            m.borrado = true; m.borradoPor = m.de === req.usuario ? '' : req.usuario; m.texto = ''; m.imagen = ''; m.reacciones = []; m.replyTo = undefined; m.actualizado = new Date();
            await m.save();
            if (g.fijado?.id === String(m._id)) await Grupo.updateOne({ _id: g._id }, { $unset: { fijado: 1 } });
            ok(res, { mensaje: serial(m.toObject()) });
        } catch (e) { err(res, 500, 'Error interno'); }
    });
    app.post('/grupos/:id/mensajes/:mid/reaccion', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res, { campos: 'miembros suspendido' }); if (!g) return;
            const e = String(req.body.emoji || '');
            if (!REACCIONES.includes(e) || !esId(req.params.mid)) return err(res, 400, 'Reacción no permitida');
            const m = await GMensaje.findOne({ _id: req.params.mid, grupo: g._id });
            if (!m || m.borrado || m.tipo !== 'msg') return err(res, 404, 'Mensaje no encontrado');
            const previa = (m.reacciones || []).find(r => r.u === req.usuario);
            m.reacciones = (m.reacciones || []).filter(r => r.u !== req.usuario);
            if (!previa || previa.e !== e) m.reacciones.push({ u: req.usuario, e });
            m.actualizado = new Date(); await m.save();
            ok(res, { mensaje: serial(m.toObject()) });
        } catch (e) { err(res, 500, 'Error interno'); }
    });
    app.post('/grupos/:id/mensajes/:mid/fijar', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res, { admin: true }); if (!g) return;
            if (req.body.quitar) { await Grupo.updateOne({ _id: g._id }, { $unset: { fijado: 1 } }); return ok(res, { fijado: null }); }
            if (!esId(req.params.mid)) return err(res, 400, 'ID inválido');
            const m = await GMensaje.findOne({ _id: req.params.mid, grupo: g._id }).lean();
            if (!m || m.borrado || m.tipo !== 'msg') return err(res, 404, 'Mensaje no encontrado');
            const fijado = { id: String(m._id), de: m.de, texto: (m.texto || '').slice(0, 200), imagen: !!m.imagen, por: req.usuario, fecha: new Date() };
            await Grupo.updateOne({ _id: g._id }, { $set: { fijado } });
            await sistema(g, `@${req.usuario} fijó un mensaje`);
            ok(res, { fijado });
        } catch (e) { err(res, 500, 'Error interno'); }
    });
    app.post('/grupos/:id/mensajes/:mid/reportar', verificarToken, async (req, res) => {
        try {
            const g = await cargar(req, res, { campos: 'miembros nombre suspendido' }); if (!g) return;
            if (!esId(req.params.mid)) return err(res, 400, 'ID inválido');
            const motivo = MOTIVOS_REPORTE[req.body.motivo] ? req.body.motivo : 'otro';
            if (!(await Limites.permitir(`greport:${req.usuario}`, [[Limites.HORA, 20]]))) return err(res, 429, 'Ya enviaste muchos reportes. Gracias, los estamos revisando.');
            const m = await GMensaje.findOne({ _id: req.params.mid, grupo: g._id }).lean();
            if (!m || m.tipo !== 'msg') return err(res, 404, 'Mensaje no encontrado');
            if (CeroTolerancia.MOTIVO[motivo]) {
                // Reporte grave: incidente con la evidencia del mensaje (aunque luego lo borren) y aviso al admin de UpGames
                CeroTolerancia.incidente({ usuario: m.de, categoria: motivo, motivo: `Reportado por @${req.usuario}: ${CeroTolerancia.MOTIVO[motivo]}`, fuente: 'reporte de usuario', donde: `grupo «${g.nombre}»`, ref: String(m._id), texto: m.texto, imagen: m.imagen });
                if (m.imagen) CeroTolerancia.vigilarImagen({ imagen: m.imagen, usuario: m.de, donde: `grupo «${g.nombre}» (reportado)`, ref: String(m._id), texto: m.texto,
                    ocultar: () => GMensaje.updateOne({ _id: m._id }, { $set: { borrado: true, borradoPor: 'NEXUS', texto: '', imagen: '', actualizado: new Date() } }) });
            } else {
                Moderacion.registrar({ tipo: 'chat', usuario: m.de, categoria: motivo, motivo: `Reporte en grupo «${g.nombre}» por @${req.usuario}`, fuente: 'reporte', texto: m.texto, ref: String(m._id), accion: 'reportado' });
            }
            // Los admins del grupo también se enteran
            const admins = g.miembros.filter(x => x.rol !== 'miembro' && x.u !== req.usuario).map(x => x.u);
            if (admins.length) Notificacion.insertMany(admins.map(a => ({ destinatario: a, tipo: 'sistema', emisor: 'UpGames', itemTitle: `Reporte en ${g.nombre}`, mensaje: `🚩 Reportaron un mensaje de @${m.de} en «${g.nombre}». Revísalo.`.replace(/[<>&]/g, ''), leida: false, fecha: new Date() }))).catch(() => {});
            ok(res, { mensaje: 'Gracias. El reporte llegó al equipo de UpGames y a los administradores del grupo.' });
        } catch (e) { logger.error(`grupos reportar: ${e.message}`); err(res, 500, 'No se pudo reportar'); }
    });
    app.post('/grupos/:id/escribiendo', verificarToken, (req, res) => {
        if (!esId(req.params.id)) return err(res, 400, 'Grupo inválido');
        let m = escribiendo.get(req.params.id);
        if (!m) { if (escribiendo.size > 20000) escribiendo.clear(); m = new Map(); escribiendo.set(req.params.id, m); }
        m.set(req.usuario, Date.now());
        if (m.size > 50) m.delete(m.keys().next().value);
        ok(res);
    });

    return { Grupo, GMensaje };
}

module.exports = { registrar, ETIQUETAS, REACCIONES };
