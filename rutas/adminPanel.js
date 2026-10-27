/**
 * ══════════════════════════════════════════════════════════════════
 *  adminPanel.js — Autenticación y gobierno del panel de administración
 *
 *  • Dueño (owner): la(s) cuenta(s) cuyo email está en OWNER_EMAIL
 *    (por defecto jhonatandavidcastrogalviz@gmail.com). Tiene todo,
 *    gestiona el equipo y ve la auditoría. Nadie puede tocar su cuenta.
 *  • Sub-administradores: el dueño les asigna un ROL EXCLUSIVO (plantilla)
 *    o permisos a medida. Cada uno solo ve y solo puede usar su área.
 *
 *  Permisos (granulares):
 *    revision · contenido · comentarios · usuarios · sanciones ·
 *    anuncios · finanzas · estadisticas · sistema
 *
 *  Controles del dueño sobre cada miembro: pausar, acceso hasta una fecha,
 *  cerrar todas sus sesiones, quitarlo, y "pausar a todo el equipo"
 *  (emergencia). Las acciones sensibles de un sub-admin le llegan al dueño
 *  como notificación.
 *
 *  Login: email/usuario + contraseña de la cuenta (+ 2FA si está activo).
 *  ADMIN_PIN (variable de entorno) es la llave maestra de emergencia.
 *
 *  La sesión es un JWT de 8 h; el rol se relee de la BD en cada petición
 *  (caché 15 s). Todo cambio queda en adminlogs (180 días).
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const crypto   = require('crypto');
const os       = require('os');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');

const PERMISOS = {
    revision:     { nombre: 'Revisión',      desc: 'Aprobar o rechazar entradas, marcar enlaces online/caídos y limpiar reportes' },
    contenido:    { nombre: 'Contenido',     desc: 'Editar y eliminar entradas y videos' },
    comentarios:  { nombre: 'Comentarios',   desc: 'Moderar y eliminar comentarios' },
    usuarios:     { nombre: 'Usuarios',      desc: 'Ver cuentas, verificación, lista negra y notas' },
    sanciones:    { nombre: 'Sanciones',     desc: 'Suspender y eliminar cuentas' },
    anuncios:     { nombre: 'Anuncios',      desc: 'Enviar notificaciones a la comunidad' },
    finanzas:     { nombre: 'Finanzas',      desc: 'Pagos, saldos y tarjetas' },
    estadisticas: { nombre: 'Estadísticas',  desc: 'Inicio con métricas, gráficos y rankings' },
    sistema:      { nombre: 'Sistema',       desc: 'API Test, diagnóstico y caché' },
};
const CLAVES = Object.keys(PERMISOS);

// Roles exclusivos listos para asignar. "personalizado" = permisos a mano.
const ROLES = {
    revisor:     { nombre: 'Revisor',              icono: '🔍', permisos: ['revision'] },
    editor:      { nombre: 'Editor de contenido',  icono: '✏️', permisos: ['revision', 'contenido'] },
    moderador:   { nombre: 'Moderador',            icono: '🧹', permisos: ['comentarios'] },
    soporte:     { nombre: 'Soporte de usuarios',  icono: '🎧', permisos: ['usuarios'] },
    seguridad:   { nombre: 'Seguridad',            icono: '🛡️', permisos: ['usuarios', 'sanciones'] },
    tesorero:    { nombre: 'Tesorero',             icono: '💰', permisos: ['finanzas'] },
    comunicador: { nombre: 'Comunicación',         icono: '📢', permisos: ['anuncios'] },
    analista:    { nombre: 'Analista',             icono: '📊', permisos: ['estadisticas'] },
    tecnico:     { nombre: 'Técnico',              icono: '🛠️', permisos: ['sistema'] },
    admin:       { nombre: 'Administrador general', icono: '⭐', permisos: CLAVES.slice() },
    personalizado: { nombre: 'Personalizado',      icono: '🧩', permisos: null },
};

// Permisos de la primera versión (antes de los roles exclusivos)
const LEGADO = { contenido: ['revision', 'contenido', 'comentarios'], usuarios: ['usuarios', 'sanciones', 'anuncios'], finanzas: ['finanzas'], sistema: ['sistema'] };

const SESION_MS = 8 * 60 * 60 * 1000;
const ownerEmails = () => (process.env.OWNER_EMAIL || 'jhonatandavidcastrogalviz@gmail.com')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const esOwnerEmail = email => ownerEmails().includes(String(email || '').toLowerCase());

/**
 * Permisos que habilitan una ruta: array = basta con tener UNO;
 * 'owner' = solo el dueño; null = cualquier admin con sesión.
 */
function permisoRequerido(method, path) {
    if (/^\/admin\/(equipo|auditoria)/.test(path)) return 'owner';
    if (/^\/admin\/auth/.test(path)) return null;
    if (/^\/admin\/sistema\/anuncio/.test(path)) return ['anuncios'];
    if (/^\/admin\/(sistema|cache)/.test(path)) return ['sistema'];
    if (/^\/(admin\/stats|analytics\/admin)/.test(path)) return ['estadisticas'];
    if (/^\/admin\/(finanzas|payments-pending)/.test(path)) return ['finanzas'];
    if (/^\/admin\/users\/(ajustar-saldo|[^/]+\/reset-saldo)/.test(path)) return ['finanzas'];
    if (/^\/admin\/users\/suspender/.test(path)) return ['sanciones'];
    if (/^\/admin\/users\/[^/]+\/items$/.test(path)) return ['sanciones'];
    if (method === 'DELETE' && /^\/auth\/users\//.test(path)) return ['sanciones'];
    if (method === 'GET' && /^\/(auth\/users|admin\/users\/detalle)/.test(path)) return ['usuarios', 'sanciones', 'finanzas'];
    if (/^\/(admin\/users|auth\/users|auth\/admin|admin\/fraud|admin\/nexus)/.test(path)) return ['usuarios'];
    if (/^\/comentarios/.test(path)) return ['comentarios'];
    if (method === 'DELETE' && /^\/items\//.test(path)) return ['contenido'];
    if (/^\/(admin\/items|items\/|admin\/links)/.test(path)) return ['revision', 'contenido'];
    return ['sistema'];
}

// Quien solo tiene "revision" no puede editar textos/enlaces ni borrar
function limiteRevision(req) {
    if (req.method === 'PUT' && /^\/admin\/items\/bulk-action$/.test(req.path))
        return req.body?.action === 'eliminar' ? 'Eliminar entradas requiere el permiso "Contenido"' : null;
    if (req.method === 'PUT' && /^\/admin\/items\/[^/]+$/.test(req.path)) {
        const extra = Object.keys(req.body || {}).filter(k => !['status', 'linkStatus', 'reportes'].includes(k));
        return extra.length ? 'Tu rol solo permite cambiar el estado de las entradas' : null;
    }
    return null;
}

// Acciones de un sub-admin que se notifican al dueño
const SENSIBLES = [
    [/DELETE \/auth\/users/, 'eliminó una cuenta'], [/DELETE \/admin\/users\/[^/]+\/items/, 'borró todas las publicaciones de un usuario'],
    [/suspender/, 'cambió la suspensión de una cuenta'], [/ajustar-saldo|reset-saldo/, 'ajustó un saldo'],
    [/procesar-pago/, 'marcó un pago como enviado'], [/rechazar-pago/, 'rechazó un pago'], [/DELETE \/admin\/finanzas\/tarjetas/, 'eliminó una tarjeta'],
    [/anuncio/, 'envió un anuncio'], [/bulk-action/, 'hizo una acción masiva'],
];

function limpiarBody(body) {
    if (!body || typeof body !== 'object') return '';
    const copia = {};
    for (const [k, v] of Object.entries(body)) {
        if (/pass|pin|token|secret/i.test(k)) continue;
        copia[k] = typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : v;
    }
    const s = JSON.stringify(copia);
    return s === '{}' ? '' : s.slice(0, 600);
}

const escHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function normalizarPermisos(u) {
    const base = (u.adminPermisos || []);
    const lista = u.adminPermisosV >= 2 ? base : base.flatMap(p => LEGADO[p] || [p]).concat(base.length ? ['estadisticas'] : []);
    return [...new Set(lista)].filter(p => CLAVES.includes(p));
}

function registrar(app, { Usuario, Juego, Comentario, Notificacion, Pago, JWT_SECRET, logger, twoFactor, authLimiter, NEXUS_API }) {
    const ADMIN_SECRET = JWT_SECRET + '_ADMIN';

    const AdminLog = mongoose.models.AdminLog || mongoose.model('AdminLog', new mongoose.Schema({
        admin:   { type: String, index: true },
        rol:     String,
        accion:  String,          // "PUT /admin/items/…"
        objetivo:{ type: String, default: '' },
        detalle: { type: String, default: '' },
        estado:  Number,
        ip:      String,
        fecha:   { type: Date, default: Date.now, index: true, expires: 180 * 24 * 60 * 60 },
    }, { collection: 'adminlogs' }));

    const registrarLog = (datos) => AdminLog.create(datos).catch(e => logger.warn(`[admin-log] ${e.message}`));

    // jti de sesiones cerradas con "Salir" (las demás caducan a las 8 h o
    // al subir adminSesionVer desde "Cerrar sesiones")
    const revocadas = new Map();
    setInterval(() => {
        const lim = Date.now() - SESION_MS;
        for (const [k, t] of revocadas) if (t < lim) revocadas.delete(k);
    }, 60 * 60 * 1000).unref();

    // Rol actual de una cuenta, cacheado 15 s para no ir a la BD en cada clic
    const cacheRol = new Map();
    async function rolDe(usuario) {
        const c = cacheRol.get(usuario);
        if (c && Date.now() - c.t < 15000) return c.v;
        const u = await Usuario.findOne({ usuario })
            .select('usuario email adminRol adminPermisos adminPermisosV adminPausado adminHasta adminSesionVer suspendido').lean();
        let v = null;
        if (u && esOwnerEmail(u.email)) v = { usuario: u.usuario, email: u.email, rol: 'owner', permisos: CLAVES.slice(), ver: u.adminSesionVer || 0 };
        else if (u && u.adminRol) {
            let bloqueo = null;
            if (u.suspendido) bloqueo = 'Tu cuenta está suspendida';
            else if (u.adminPausado) bloqueo = 'El dueño pausó tu acceso al panel';
            else if (u.adminHasta && new Date(u.adminHasta) < new Date()) bloqueo = 'Tu acceso temporal al panel terminó';
            v = bloqueo ? { bloqueo } : { usuario: u.usuario, email: u.email, rol: u.adminRol, permisos: normalizarPermisos(u), ver: u.adminSesionVer || 0, hasta: u.adminHasta || null };
        }
        cacheRol.set(usuario, { v, t: Date.now() });
        return v;
    }
    const olvidarRol = usuario => cacheRol.delete(usuario);

    function firmarSesion(adm) {
        const jti = crypto.randomBytes(12).toString('hex');
        const adminToken = jwt.sign({ adm: adm.usuario, rol: adm.rol, jti, v: adm.ver || 0 }, ADMIN_SECRET, { expiresIn: '8h' });
        return { adminToken, expiresIn: '8h', expiraEn: Date.now() + SESION_MS };
    }

    // Devuelve { admin } o { status, error }
    async function sesionDesdeToken(token) {
        if (!token) return { status: 401, error: 'Panel admin: inicia sesión' };
        let p;
        try { p = jwt.verify(token, ADMIN_SECRET); }
        catch (e) { return { status: 401, error: e.name === 'TokenExpiredError' ? 'Sesión admin expirada' : 'Sesión admin inválida' }; }
        if (!p.adm || (p.jti && revocadas.has(p.jti))) return { status: 401, error: 'Sesión admin cerrada' };
        if (p.adm === '__pin__') return { admin: { usuario: 'llave-maestra', rol: 'owner', permisos: CLAVES.slice(), jti: p.jti, exp: p.exp } };
        const r = await rolDe(p.adm);
        if (!r) return { status: 401, error: 'Tu cuenta ya no tiene acceso al panel' };
        if (r.bloqueo) return { status: 401, error: r.bloqueo };
        if ((p.v || 0) !== r.ver) return { status: 401, error: 'Tu sesión fue cerrada. Vuelve a entrar.' };
        return { admin: { ...r, jti: p.jti, exp: p.exp } };
    }

    // Un sub-admin no puede tocar al dueño ni a otros administradores
    async function objetivoProtegido(req) {
        const m = req.path.match(/^\/(?:admin\/users\/(?:ajustar-saldo\/|lista-negra\/|notas\/|suspender\/)?|auth\/users\/|auth\/admin\/verificacion\/)([^/]+)/);
        if (!m) return false;
        const id = m[1];
        const q = mongoose.isValidObjectId(id) ? { _id: id } : { usuario: String(id).toLowerCase() };
        const t = await Usuario.findOne(q).select('email adminRol').lean();
        return !!t && (esOwnerEmail(t.email) || !!t.adminRol);
    }

    // Dueños a los que avisar (caché 10 min)
    let duenos = { lista: [], t: 0 };
    async function nombresDueno() {
        if (Date.now() - duenos.t < 600000) return duenos.lista;
        const l = await Usuario.find({ email: { $in: ownerEmails() } }).select('usuario').lean();
        duenos = { lista: l.map(u => u.usuario), t: Date.now() };
        return duenos.lista;
    }
    async function avisarDueno(adm, accion, objetivo) {
        const m = SENSIBLES.find(([r]) => r.test(accion)); if (!m) return;
        const destino = await nombresDueno();
        const obj = objetivo && !/^[a-f\d]{24}(,|$)/i.test(objetivo) ? ' · ' + objetivo : '';
        const txt = escHtml(`🛡️ @${adm.usuario} (${ROLES[adm.rol]?.nombre || adm.rol}) ${m[1]}${obj}. Revísalo en Auditoría.`);
        await Notificacion.insertMany(destino.map(d => ({ destinatario: d, tipo: 'sistema', emisor: adm.usuario, itemTitle: 'Equipo', mensaje: txt, leida: false, fecha: new Date() })));
    }

    const verificarAdmin = async (req, res, next) => {
        try {
            const s = await sesionDesdeToken(req.headers['x-admin-token']);
            if (!s.admin) return res.status(s.status).json({ success: false, error: s.error });
            const adm = s.admin;
            const negar = (error, extra = {}) => {
                if (req.method !== 'GET') registrarLog({ admin: adm.usuario, rol: adm.rol, accion: `BLOQUEADO ${req.method} ${req.path}`, detalle: error, estado: 403, ip: req.ip });
                return res.status(403).json({ success: false, error, ...extra });
            };
            const req_ = permisoRequerido(req.method, req.path);
            if (adm.rol !== 'owner') {
                if (req_ === 'owner') return negar('Solo el dueño puede hacer esto');
                if (Array.isArray(req_) && !req_.some(p => adm.permisos.includes(p)))
                    return negar(`Tu rol no incluye: ${req_.map(p => PERMISOS[p]?.nombre || p).join(' o ')}`, { permiso: req_ });
                if (!adm.permisos.includes('contenido')) { const lim = limiteRevision(req); if (lim) return negar(lim); }
                if (req.method !== 'GET' && await objetivoProtegido(req))
                    return negar('No puedes modificar al dueño ni a otros administradores');
            }

            req.admin = adm;
            if (req.method !== 'GET') {
                res.on('finish', () => {
                    const accion = `${req.method} ${req.path}`;
                    const objetivo = Object.values(req.params || {}).join(',').slice(0, 80);
                    registrarLog({ admin: adm.usuario, rol: adm.rol, accion, objetivo, detalle: limpiarBody(req.body), estado: res.statusCode, ip: req.ip });
                    if (adm.rol !== 'owner' && res.statusCode < 400) avisarDueno(adm, accion, objetivo).catch(() => {});
                });
            }
            next();
        } catch (e) {
            logger.error(`[verificarAdmin] ${e.message}`);
            res.status(500).json({ success: false, error: 'Error verificando sesión admin' });
        }
    };

    // ── Suspensión de cuentas (bloquea login y peticiones con token) ──
    const suspendidos = new Set();
    async function recargarSuspendidos() {
        try {
            const l = await Usuario.find({ suspendido: true }).select('usuario').lean();
            suspendidos.clear(); l.forEach(u => suspendidos.add(u.usuario));
        } catch (_) { /* BD aún no conectada */ }
    }
    mongoose.connection.on('connected', recargarSuspendidos);
    if (mongoose.connection.readyState === 1) recargarSuspendidos();
    setInterval(recargarSuspendidos, 5 * 60 * 1000).unref();

    const infoAdmin = a => ({ usuario: a.usuario, email: a.email || '', rol: a.rol, rolNombre: a.rol === 'owner' ? 'Dueño' : (ROLES[a.rol]?.nombre || a.rol), permisos: a.permisos, hasta: a.hasta || null });

    // ══════════════ AUTH ══════════════
    app.use('/admin/auth/login', authLimiter);

    app.post('/admin/auth/login', async (req, res) => {
        const ip = req.ip;
        try {
            const { email, password, pin, token2fa } = req.body || {};

            if (pin) {
                const PIN = (process.env.ADMIN_PIN || '').trim();
                const ok = PIN.length >= 8 && crypto.timingSafeEqual(
                    crypto.createHash('sha256').update(String(pin)).digest(),
                    crypto.createHash('sha256').update(PIN).digest());
                if (!ok) {
                    logger.warn(`Intento de PIN admin fallido - IP: ${ip}`);
                    return res.status(401).json({ success: false, error: PIN ? 'PIN incorrecto' : 'La llave maestra no está configurada (ADMIN_PIN)' });
                }
                registrarLog({ admin: 'llave-maestra', rol: 'owner', accion: 'LOGIN pin', estado: 200, ip });
                return res.json({ success: true, ...firmarSesion({ usuario: '__pin__', rol: 'owner' }), admin: infoAdmin({ usuario: 'llave-maestra', rol: 'owner', permisos: CLAVES }) });
            }

            const id = String(email || '').toLowerCase().trim();
            if (!id || !password) return res.status(400).json({ success: false, error: 'Escribe tu email y contraseña' });
            const u = await Usuario.findOne({ $or: [{ email: id }, { usuario: id }] }).select('usuario email password');
            const valida = u && await bcrypt.compare(String(password), u.password);
            if (!valida) {
                logger.warn(`Login admin fallido (${id}) - IP: ${ip}`);
                return res.status(401).json({ success: false, error: 'Email o contraseña incorrectos' });
            }
            olvidarRol(u.usuario);
            const adm = await rolDe(u.usuario);
            if (!adm || adm.bloqueo) {
                registrarLog({ admin: u.usuario, rol: '', accion: 'LOGIN denegado', detalle: adm?.bloqueo || 'sin rol', estado: 403, ip });
                return res.status(403).json({ success: false, error: adm?.bloqueo || 'Tu cuenta no tiene acceso al panel de administración' });
            }
            if (await twoFactor.tieneActivo(u.usuario)) {
                if (!token2fa) return res.status(401).json({ success: false, error: 'Escribe tu código 2FA', require2FA: true });
                const chk = await twoFactor.verificar(u.usuario, token2fa);
                if (!chk.ok) return res.status(401).json({ success: false, error: chk.error || 'Código 2FA incorrecto', require2FA: true });
            }
            registrarLog({ admin: adm.usuario, rol: adm.rol, accion: 'LOGIN', estado: 200, ip });
            logger.info(`Sesión admin: @${adm.usuario} (${adm.rol}) - IP: ${ip}`);
            res.json({ success: true, ...firmarSesion(adm), admin: infoAdmin(adm) });
        } catch (e) {
            logger.error(`[admin login] ${e.message}`);
            res.status(500).json({ success: false, error: 'Error al iniciar sesión' });
        }
    });

    app.get('/admin/auth/verify', async (req, res) => {
        const s = await sesionDesdeToken(req.headers['x-admin-token']);
        if (!s.admin) return res.status(s.status).json({ success: false, error: s.error });
        res.json({ success: true, message: 'Sesión activa' });
    });

    app.get('/admin/auth/me', verificarAdmin, (req, res) => {
        res.json({ success: true, admin: { ...infoAdmin(req.admin), expiraEn: req.admin.exp ? req.admin.exp * 1000 : null }, permisos: PERMISOS });
    });

    app.post('/admin/auth/logout', async (req, res) => {
        try {
            const p = jwt.verify(req.headers['x-admin-token'] || '', ADMIN_SECRET);
            if (p.jti) revocadas.set(p.jti, Date.now());
            registrarLog({ admin: p.adm === '__pin__' ? 'llave-maestra' : p.adm, rol: p.rol, accion: 'LOGOUT', estado: 200, ip: req.ip });
        } catch (_) {}
        res.json({ success: true, message: 'Sesión cerrada' });
    });

    // ══════════════ EQUIPO (solo dueño) ══════════════
    app.get('/admin/equipo', verificarAdmin, async (req, res) => {
        try {
            const lista = await Usuario.find({ $or: [{ adminRol: { $nin: ['', null] } }, { email: { $in: ownerEmails() } }] })
                .select('usuario email avatar adminRol adminPermisos adminPermisosV adminDesde adminPor adminPausado adminHasta ultimoLogin suspendido').lean();
            const ultimos = await AdminLog.aggregate([
                { $match: { admin: { $in: lista.map(u => u.usuario) } } },
                { $group: { _id: '$admin', ultima: { $max: '$fecha' }, acciones: { $sum: 1 } } },
            ]);
            const act = Object.fromEntries(ultimos.map(x => [x._id, x]));
            res.json({
                success: true, permisos: PERMISOS, roles: ROLES,
                equipo: lista.map(u => {
                    const owner = esOwnerEmail(u.email);
                    return {
                        usuario: u.usuario, email: u.email, avatar: u.avatar || '',
                        rol: owner ? 'owner' : u.adminRol,
                        rolNombre: owner ? 'Dueño' : (ROLES[u.adminRol]?.nombre || u.adminRol),
                        permisos: owner ? CLAVES : normalizarPermisos(u),
                        desde: u.adminDesde || null, por: u.adminPor || '', ultimoLogin: u.ultimoLogin || null,
                        ultimaAccion: act[u.usuario]?.ultima || null, acciones: act[u.usuario]?.acciones || 0,
                        pausado: !!u.adminPausado, hasta: u.adminHasta || null,
                        vencido: !!(u.adminHasta && new Date(u.adminHasta) < new Date()), suspendido: !!u.suspendido,
                    };
                }).sort((a, b) => (a.rol === 'owner' ? -1 : b.rol === 'owner' ? 1 : a.usuario.localeCompare(b.usuario))),
            });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // Asignar rol: { rol: <clave de ROLES>, permisos?: [...] (solo "personalizado"), hasta?: fecha ISO | null }
    app.put('/admin/equipo/:usuario', verificarAdmin, async (req, res) => {
        try {
            const nombre = String(req.params.usuario || '').toLowerCase().replace(/^@/, '').trim();
            const rol = req.body?.rol;
            if (!ROLES[rol]) return res.status(400).json({ success: false, error: 'Elige un rol válido' });
            const permisos = ROLES[rol].permisos
                ? ROLES[rol].permisos.slice()
                : [...new Set((Array.isArray(req.body?.permisos) ? req.body.permisos : []).filter(p => CLAVES.includes(p)))];
            if (!permisos.length) return res.status(400).json({ success: false, error: 'Elige al menos un permiso' });
            let hasta = null;
            if (req.body?.hasta) {
                hasta = new Date(req.body.hasta);
                if (isNaN(hasta) || hasta < new Date()) return res.status(400).json({ success: false, error: 'La fecha de fin de acceso debe ser futura' });
            }
            const u = await Usuario.findOne({ $or: [{ usuario: nombre }, { email: nombre }] });
            if (!u) return res.status(404).json({ success: false, error: 'No existe ninguna cuenta con ese usuario o email' });
            if (esOwnerEmail(u.email)) return res.status(400).json({ success: false, error: 'El dueño ya tiene todos los permisos' });
            if (u.suspendido) return res.status(400).json({ success: false, error: 'La cuenta está suspendida' });
            const nuevo = !u.adminRol;
            Object.assign(u, { adminRol: rol, adminPermisos: permisos, adminPermisosV: 2, adminHasta: hasta, adminPausado: false });
            if (nuevo) { u.adminDesde = new Date(); u.adminPor = req.admin.usuario; }
            await u.save();
            olvidarRol(u.usuario);
            const rn = ROLES[rol].nombre;
            Notificacion.create({ destinatario: u.usuario, tipo: 'sistema', emisor: 'UpGames', itemTitle: 'Equipo',
                mensaje: escHtml(nuevo ? `🛡️ Ahora formas parte del equipo de UpGames como ${rn}. Entra al panel con tu email y contraseña.` : `🛡️ Tu rol en el panel cambió a: ${rn}`) }).catch(() => {});
            res.json({ success: true, usuario: u.usuario, rol, rolNombre: rn, permisos, hasta });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // Pausar / reanudar sin perder la configuración
    app.put('/admin/equipo/:usuario/pausa', verificarAdmin, async (req, res) => {
        try {
            const u = await Usuario.findOne({ usuario: String(req.params.usuario).toLowerCase() });
            if (!u || !u.adminRol || esOwnerEmail(u.email)) return res.status(404).json({ success: false, error: 'No es un sub-administrador' });
            u.adminPausado = !!req.body?.pausado;
            await u.save(); olvidarRol(u.usuario);
            res.json({ success: true, pausado: u.adminPausado });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // Cerrar todas las sesiones abiertas de un miembro (también las tuyas)
    app.post('/admin/equipo/:usuario/cerrar-sesiones', verificarAdmin, async (req, res) => {
        try {
            const u = await Usuario.findOneAndUpdate({ usuario: String(req.params.usuario).toLowerCase() }, { $inc: { adminSesionVer: 1 } }, { new: true });
            if (!u) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
            olvidarRol(u.usuario);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // Emergencia: pausa (o reanuda) a TODO el equipo y cierra sus sesiones
    app.post('/admin/equipo-emergencia', verificarAdmin, async (req, res) => {
        try {
            const pausar = req.body?.pausar !== false;
            const upd = pausar ? { $set: { adminPausado: true }, $inc: { adminSesionVer: 1 } } : { $set: { adminPausado: false } };
            const r = await Usuario.updateMany({ adminRol: { $nin: ['', null] }, email: { $nin: ownerEmails() } }, upd);
            cacheRol.clear();
            res.json({ success: true, afectados: r.modifiedCount || 0, pausado: pausar });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    app.delete('/admin/equipo/:usuario', verificarAdmin, async (req, res) => {
        try {
            const u = await Usuario.findOne({ usuario: String(req.params.usuario).toLowerCase() });
            if (!u || !u.adminRol) return res.status(404).json({ success: false, error: 'No es parte del equipo' });
            if (esOwnerEmail(u.email)) return res.status(400).json({ success: false, error: 'No se puede quitar al dueño' });
            Object.assign(u, { adminRol: '', adminPermisos: [], adminPausado: false, adminHasta: null, adminSesionVer: (u.adminSesionVer || 0) + 1 });
            await u.save();
            olvidarRol(u.usuario);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // ══════════════ AUDITORÍA (solo dueño) ══════════════
    app.get('/admin/auditoria', verificarAdmin, async (req, res) => {
        try {
            const q = {};
            if (req.query.admin) q.admin = String(req.query.admin).toLowerCase();
            if (req.query.soloCambios === '1') q.accion = { $not: /^(LOGIN|LOGOUT)/ };
            if (req.query.antes) q.fecha = { $lt: new Date(req.query.antes) };
            const limite = Math.min(parseInt(req.query.limite) || 100, 1000);
            const logs = await AdminLog.find(q).sort({ fecha: -1 }).limit(limite).lean();
            res.json({ success: true, logs });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // ══════════════ USUARIOS: suspender ══════════════
    app.put('/admin/users/suspender/:id', verificarAdmin, async (req, res) => {
        try {
            if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, error: 'ID inválido' });
            const u = await Usuario.findById(req.params.id);
            if (!u) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
            if (esOwnerEmail(u.email)) return res.status(400).json({ success: false, error: 'No se puede suspender al dueño' });
            const s = !!req.body?.suspendido;
            u.suspendido = s;
            u.motivoSuspension = s ? String(req.body?.motivo || '').slice(0, 300) : '';
            u.fechaSuspension = s ? new Date() : null;
            await u.save();
            if (s) suspendidos.add(u.usuario); else suspendidos.delete(u.usuario);
            olvidarRol(u.usuario);
            res.json({ success: true, suspendido: s });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // ══════════════ ANUNCIOS ══════════════
    // { mensaje, destino: 'todos'|'verificados'|'creadores'|'usuario', usuario? }
    app.post('/admin/sistema/anuncio', verificarAdmin, async (req, res) => {
        try {
            const mensaje = String(req.body?.mensaje || '').trim().slice(0, 280);
            if (mensaje.length < 3) return res.status(400).json({ success: false, error: 'Escribe el mensaje del anuncio' });
            const destino = req.body?.destino || 'todos';
            let nombres;
            if (destino === 'usuario') {
                const u = await Usuario.findOne({ usuario: String(req.body?.usuario || '').toLowerCase().replace(/^@/, '').trim() }).select('usuario').lean();
                if (!u) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
                nombres = [u.usuario];
            } else if (destino === 'creadores') {
                nombres = await Juego.distinct('usuario');
            } else {
                const q = destino === 'verificados' ? { verificadoNivel: { $gte: 1 } } : {};
                nombres = (await Usuario.find({ ...q, suspendido: { $ne: true } }).select('usuario').lean()).map(u => u.usuario);
            }
            const texto = '📢 ' + escHtml(mensaje);
            const docs = nombres.map(d => ({ destinatario: d, tipo: 'sistema', emisor: 'UpGames', itemTitle: 'Anuncio', mensaje: texto, leida: false, fecha: new Date() }));
            for (let i = 0; i < docs.length; i += 1000) await Notificacion.insertMany(docs.slice(i, i + 1000), { ordered: false });
            res.json({ success: true, enviados: docs.length });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // ══════════════ DIAGNÓSTICO / API TEST ══════════════
    app.get('/admin/sistema/diagnostico', verificarAdmin, async (req, res) => {
        const medir = async (fn) => { const t = Date.now(); try { const v = await fn(); return { ok: true, ms: Date.now() - t, ...v }; } catch (e) { return { ok: false, ms: Date.now() - t, error: e.message }; } };
        const estados = ['desconectada', 'conectada', 'conectando', 'desconectando'];
        const [db, conteos, nexus] = await Promise.all([
            medir(async () => { await mongoose.connection.db.admin().ping(); return { estado: estados[mongoose.connection.readyState] || '?' }; }),
            medir(async () => {
                const [usuarios, items, comentarios, pagosPend, suspendidosN, equipo] = await Promise.all([
                    Usuario.estimatedDocumentCount(), Juego.estimatedDocumentCount(), Comentario.estimatedDocumentCount(),
                    Pago.countDocuments({ estado: 'pendiente' }), Usuario.countDocuments({ suspendido: true }),
                    Usuario.countDocuments({ adminRol: { $nin: ['', null] } }),
                ]);
                return { usuarios, items, comentarios, pagosPend, suspendidos: suspendidosN, subAdmins: equipo };
            }),
            medir(async () => {
                const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
                try {
                    const r = await fetch(`${NEXUS_API}/health`, { signal: ctl.signal });
                    const j = await r.json().catch(() => ({}));
                    return { status: r.status, url: NEXUS_API, detalle: j };
                } finally { clearTimeout(to); }
            }),
        ]);
        const mem = process.memoryUsage();
        res.json({
            success: true,
            servidor: {
                node: process.version, uptimeSeg: Math.round(process.uptime()),
                memoriaMB: Math.round(mem.rss / 1048576), heapMB: Math.round(mem.heapUsed / 1048576),
                cpus: os.cpus().length, carga: os.loadavg().map(n => +n.toFixed(2)), entorno: process.env.NODE_ENV || 'production',
            },
            db, conteos, nexus,
            config: {   // solo si existen, nunca los valores
                groq: !!process.env.GROQ_API_KEY, nexusSecret: !!process.env.NEXUS_INTERNAL_SECRET,
                email: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
                cloudinary: !!(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_API_KEY),
                adminPin: !!process.env.ADMIN_PIN, ownerEmails: ownerEmails().length,
            },
            hora: new Date().toISOString(),
        });
    });

    return {
        verificarAdmin,
        estaSuspendido: usuario => suspendidos.has(usuario),
        esOwnerEmail,
        sesionDesdeToken,
    };
}

module.exports = { registrar, permisoRequerido, limiteRevision, normalizarPermisos, PERMISOS, ROLES };
