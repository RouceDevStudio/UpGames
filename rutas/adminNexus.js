/**
 * ══════════════════════════════════════════════════════════════════
 *  adminNexus.js — Nexus como asistente profesional del panel admin
 *
 *  GET  /admin/nexus/briefing  → qué necesita atención ahora mismo:
 *       acciones priorizadas (reglas sobre datos reales) + un resumen
 *       redactado por Nexus. Cada admin solo ve las áreas de su rol.
 *  POST /admin/nexus/chat      → pregunta libre ("¿qué reviso primero?",
 *       "¿cómo va @usuario?", "¿hay fraude?"). Nexus responde con los
 *       datos del panel que ese admin puede ver; si no hay IA, responde
 *       con el resumen por reglas.
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const mongoose = require('mongoose');
const { chatIA } = require('../modulos/nexusIA');

const H = 3600e3, D = 24 * H;
const SECCIONES = 'Inicio, Revisión, Entradas, Videos, Reportes, Comentarios, Usuarios, Anuncios, Pagos, Tarjetas, API Test, Equipo y Auditoría';
const escRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function registrar(app, { verificarAdmin, Juego, Usuario, Comentario, Pago, logger, NEXUS_API }) {
    const puede = (adm, p) => adm.rol === 'owner' || (adm.permisos || []).includes(p);
    const algun = (adm, ps) => ps.some(p => puede(adm, p));

    // ── Datos del panel que este admin puede ver ─────────────────
    async function recopilar(adm) {
        const ahora = Date.now(), datos = {}, tareas = [];
        if (algun(adm, ['revision', 'contenido'])) tareas.push((async () => {
            const enRev = { status: { $ne: 'rechazado' }, $or: [{ linkStatus: 'revision' }, { status: { $in: ['pendiente', 'pending'] } }] };
            const [total, iaRechazar, iaAprobar, sinAnalizar, vencen, reportadas, malware, topRep] = await Promise.all([
                Juego.countDocuments(enRev),
                Juego.countDocuments({ ...enRev, 'analisisIA.decision': 'rechazar' }),
                Juego.countDocuments({ ...enRev, 'analisisIA.decision': 'aprobar' }),
                Juego.countDocuments({ ...enRev, analisisIA: { $exists: false } }),
                Juego.countDocuments({ status: 'aprobado', linkStatus: 'revision', updatedAt: { $lte: new Date(ahora - 36 * H) } }),
                Juego.countDocuments({ reportes: { $gt: 0 }, status: { $ne: 'rechazado' } }),
                Juego.countDocuments({ 'reportesDesglose.malware': { $gt: 0 }, status: { $ne: 'rechazado' } }),
                Juego.find({ reportes: { $gt: 0 }, status: { $ne: 'rechazado' } }).sort({ reportes: -1 }).limit(3).select('title usuario reportes').lean(),
            ]);
            datos.revision = { enRevision: total, nexusRecomiendaRechazar: iaRechazar, nexusRecomiendaAprobar: iaAprobar, sinAnalizar, vencenEnMenosDe12h: vencen };
            datos.reportes = { publicacionesReportadas: reportadas, conReportesDeMalware: malware, masReportadas: topRep.map(j => ({ titulo: j.title, autor: j.usuario, reportes: j.reportes })) };
        })());
        if (puede(adm, 'comentarios')) tareas.push((async () => {
            const desde = new Date(ahora - D);
            const [hoy, conEnlace] = await Promise.all([
                Comentario.countDocuments({ fecha: { $gte: desde } }),
                Comentario.countDocuments({ fecha: { $gte: desde }, texto: /https?:\/\//i }),
            ]);
            datos.comentarios = { ultimas24h: hoy, conEnlaces24h: conEnlace };
        })());
        if (algun(adm, ['usuarios', 'sanciones'])) tareas.push((async () => {
            const [nuevos24, nuevos7, suspendidos, listaNegra, ipsRepetidas, fraude] = await Promise.all([
                Usuario.countDocuments({ fecha: { $gte: new Date(ahora - D) } }),
                Usuario.countDocuments({ fecha: { $gte: new Date(ahora - 7 * D) } }),
                Usuario.countDocuments({ suspendido: true }),
                Usuario.countDocuments({ listaNegraAdmin: true }),
                Usuario.aggregate([
                    { $match: { fecha: { $gte: new Date(ahora - 7 * D) }, registrationIP: { $nin: ['', null] } } },
                    { $group: { _id: '$registrationIP', n: { $sum: 1 }, cuentas: { $push: '$usuario' } } },
                    { $match: { n: { $gte: 3 } } }, { $sort: { n: -1 } }, { $limit: 5 },
                ]),
                mongoose.models.SuspiciousActivity
                    ? mongoose.models.SuspiciousActivity.countDocuments({ revisado: false, severidad: { $in: ['high', 'critical'] } })
                    : Promise.resolve(0),
            ]);
            datos.usuarios = { nuevos24h: nuevos24, nuevos7d: nuevos7, suspendidos, enListaNegra: listaNegra,
                ipsConVariasCuentasNuevas: ipsRepetidas.map(g => ({ cuentas: g.n, usuarios: g.cuentas.slice(0, 5) })), alertasFraudeGraves: fraude };
        })());
        if (puede(adm, 'finanzas')) tareas.push((async () => {
            const pend = await Pago.find({ estado: 'pendiente' }).select('usuario monto fecha').sort({ fecha: 1 }).lean();
            const negros = pend.length ? await Usuario.find({ usuario: { $in: pend.map(p => p.usuario) }, listaNegraAdmin: true }).select('usuario').lean() : [];
            datos.pagos = { pendientes: pend.length, totalPendienteUSD: +pend.reduce((a, p) => a + (p.monto || 0), 0).toFixed(2),
                masAntiguoHaceDias: pend[0] ? Math.floor((ahora - new Date(pend[0].fecha)) / D) : 0, deUsuariosEnListaNegra: negros.map(u => u.usuario) };
        })());
        if (puede(adm, 'estadisticas')) tareas.push((async () => {
            const [items24, items7, topSemana, descargas] = await Promise.all([
                Juego.countDocuments({ createdAt: { $gte: new Date(ahora - D) } }),
                Juego.countDocuments({ createdAt: { $gte: new Date(ahora - 7 * D) } }),
                Juego.aggregate([{ $match: { status: 'aprobado' } }, { $group: { _id: '$usuario', d: { $sum: '$descargasEfectivas' } } }, { $sort: { d: -1 } }, { $limit: 3 }]),
                Juego.aggregate([{ $group: { _id: null, d: { $sum: '$descargasEfectivas' } } }]),
            ]);
            datos.actividad = { publicaciones24h: items24, publicaciones7d: items7, descargasTotales: descargas[0]?.d || 0, topCreadores: topSemana.map(t => ({ usuario: t._id, descargas: t.d })) };
        })());
        if (adm.rol === 'owner') tareas.push((async () => {
            const AdminLog = mongoose.models.AdminLog;
            if (!AdminLog) return;
            const desde = new Date(ahora - D);
            const [bloqueos, acciones, pausados] = await Promise.all([
                AdminLog.aggregate([{ $match: { fecha: { $gte: desde }, accion: /^BLOQUEADO/ } }, { $group: { _id: '$admin', n: { $sum: 1 } } }]),
                AdminLog.countDocuments({ fecha: { $gte: desde }, accion: { $not: /^(LOGIN|LOGOUT|BLOQUEADO)/ } }),
                Usuario.countDocuments({ adminRol: { $nin: ['', null] }, adminPausado: true }),
            ]);
            datos.equipo = { accionesUltimas24h: acciones, intentosBloqueados24h: bloqueos.map(b => ({ admin: b._id, intentos: b.n })), miembrosPausados: pausados };
        })());
        if (puede(adm, 'sistema')) tareas.push((async () => {
            datos.sistema = { iaNexusConfigurada: !!process.env.NEXUS_INTERNAL_SECRET, groqEnUpGames: !!process.env.GROQ_API_KEY, emailConfigurado: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) };
            try {
                const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
                const r = await fetch(`${NEXUS_API}/health`, { signal: ctl.signal }).finally(() => clearTimeout(t));
                const j = await r.json(); datos.sistema.nexusEnLinea = r.ok; datos.sistema.baseDatosNexus = !!j.db;
            } catch (_) { datos.sistema.nexusEnLinea = false; }
        })());
        await Promise.all(tareas.map(t => t.catch(e => logger.warn(`[adminNexus] ${e.message}`))));
        return datos;
    }

    // ── Acciones priorizadas (reglas, sin IA) ────────────────────
    function acciones(d) {
        const a = [], add = (prioridad, icono, texto, vista) => a.push({ prioridad, icono, texto, vista });
        const r = d.revision, rp = d.reportes, p = d.pagos, u = d.usuarios, c = d.comentarios, e = d.equipo, s = d.sistema;
        if (r?.vencenEnMenosDe12h) add('alta', '⏳', `${r.vencenEnMenosDe12h} publicación(es) en revisión vencen en menos de 12 h y se marcarán como caídas`, 'revn');
        if (r?.nexusRecomiendaRechazar) add('alta', '⛔', `Nexus recomienda rechazar ${r.nexusRecomiendaRechazar} publicación(es) en revisión`, 'revn');
        if (rp?.conReportesDeMalware) add('alta', '🛡️', `${rp.conReportesDeMalware} publicación(es) tienen reportes de malware`, 'reportes');
        if (p?.deUsuariosEnListaNegra?.length) add('alta', '🚫', `Hay pagos pendientes de usuarios en lista negra: ${p.deUsuariosEnListaNegra.map(x => '@' + x).join(', ')}`, 'pays');
        if (p?.pendientes) add(p.masAntiguoHaceDias >= 3 ? 'alta' : 'media', '💰', `${p.pendientes} pago(s) pendiente(s) por $${p.totalPendienteUSD}${p.masAntiguoHaceDias ? ` (el más antiguo hace ${p.masAntiguoHaceDias} días)` : ''}`, 'pays');
        if (e?.intentosBloqueados24h?.length) add('alta', '🔐', `Intentos bloqueados del equipo en 24 h: ${e.intentosBloqueados24h.map(x => `@${x.admin} (${x.intentos})`).join(', ')}`, 'audit');
        if (u?.alertasFraudeGraves) add('alta', '🚨', `${u.alertasFraudeGraves} alerta(s) de fraude grave sin revisar`, 'usrs');
        if (r?.sinAnalizar) add('media', '✦', `${r.sinAnalizar} publicación(es) en revisión sin analizar con Nexus`, 'revn');
        if (r?.nexusRecomiendaAprobar) add('media', '✅', `${r.nexusRecomiendaAprobar} publicación(es) que Nexus recomienda aprobar: puedes aprobarlas rápido`, 'revn');
        if (rp?.publicacionesReportadas) add('media', '🚩', `${rp.publicacionesReportadas} publicación(es) con reportes de usuarios`, 'reportes');
        if (u?.ipsConVariasCuentasNuevas?.length) add('media', '🕵️', `${u.ipsConVariasCuentasNuevas.length} IP(s) crearon 3 o más cuentas esta semana (posibles multicuentas)`, 'usrs');
        if (c?.conEnlaces24h) add('baja', '💬', `${c.conEnlaces24h} comentario(s) con enlaces en las últimas 24 h (posible spam)`, 'comt');
        if (s && !s.iaNexusConfigurada && !s.groqEnUpGames) add('baja', '⚙️', 'La IA de Nexus no está conectada en UpGames (falta NEXUS_INTERNAL_SECRET o GROQ_API_KEY)', 'api');
        if (s && s.nexusEnLinea && s.baseDatosNexus === false) add('baja', '⚙️', 'Nexus funciona, pero su base de datos no está conectada', 'api');
        const orden = { alta: 0, media: 1, baja: 2 };
        return a.sort((x, y) => orden[x.prioridad] - orden[y.prioridad]);
    }

    const ROL_TXT = { owner: 'dueño de UpGames' };
    const sistemaBase = adm => `Eres NEXUS, el asistente de administración de UpGames (plataforma de mods, juegos indie, ROMs homebrew, apps, software y videos con economía CPM para creadores).
Hablas con @${adm.usuario}, ${ROL_TXT[adm.rol] || `sub-administrador (${adm.rolNombre || adm.rol})`} con permisos: ${adm.rol === 'owner' ? 'todos' : (adm.permisos || []).join(', ')}.
Responde SIEMPRE en español, como un analista profesional: directo, con cifras concretas y prioridades claras. Usa viñetas cortas cuando ayuden.
Usa SOLO los datos que te doy (son reales y actuales). Si algo no está en los datos o no es de su área, dilo y sugiere dónde mirarlo. No inventes cifras ni nombres.
Cuando recomiendes una acción, nombra la sección del panel donde se hace (${SECCIONES}).
Las decisiones finales son del administrador: recomienda, no ordenes.`;

    // ── Briefing ─────────────────────────────────────────────────
    const cacheBriefing = new Map();   // clave de permisos → { t, data }
    app.get('/admin/nexus/briefing', verificarAdmin, async (req, res) => {
        try {
            const adm = req.admin;
            const clave = adm.rol === 'owner' ? 'owner' : [...(adm.permisos || [])].sort().join(',');
            const c = cacheBriefing.get(clave);
            if (c && req.query.forzar !== '1' && Date.now() - c.t < 10 * 60e3) return res.json({ success: true, ...c.data, cache: true });
            const datos = await recopilar(adm);
            const lista = acciones(datos);
            let resumen = null, fuente = null;
            const ia = await chatIA(sistemaBase(adm) + '\n\nRedacta un BRIEFING de 3 o 4 frases para empezar el turno: estado general, lo más urgente y por dónde empezar. Sin saludos largos ni listas.',
                [{ role: 'user', content: `DATOS DEL PANEL (JSON):\n${JSON.stringify(datos)}\n\nACCIONES DETECTADAS:\n${lista.map(x => `- [${x.prioridad}] ${x.texto}`).join('\n') || '- Nada urgente'}` }],
                { maxTokens: 350, temperatura: 0.3 }).catch(() => null);
            if (ia) { resumen = ia.texto; fuente = ia.fuente; }
            else resumen = lista.length
                ? `Hay ${lista.filter(x => x.prioridad === 'alta').length} asunto(s) urgente(s) y ${lista.length} en total. Empieza por: ${lista[0].texto.charAt(0).toLowerCase() + lista[0].texto.slice(1)}.`
                : 'Todo en orden: no hay nada pendiente en tus áreas ahora mismo.';
            const data = { acciones: lista, resumen, fuente, datos, generado: new Date() };
            cacheBriefing.set(clave, { t: Date.now(), data });
            res.json({ success: true, ...data, cache: false });
        } catch (e) {
            logger.error(`[nexus briefing] ${e.message}`);
            res.status(500).json({ success: false, error: 'Nexus no pudo preparar el briefing' });
        }
    });

    // ── Chat ─────────────────────────────────────────────────────
    app.post('/admin/nexus/chat', verificarAdmin, async (req, res) => {
        try {
            const adm = req.admin;
            const mensaje = String(req.body?.mensaje || '').trim().slice(0, 1500);
            if (!mensaje) return res.status(400).json({ success: false, error: 'Escribe tu pregunta' });
            const historial = (Array.isArray(req.body?.historial) ? req.body.historial : []).slice(-8)
                .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
                .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));

            const datos = await recopilar(adm);
            const extra = {};
            // @usuarios mencionados → ficha resumida (si su rol puede ver usuarios)
            const handles = [...new Set((mensaje.match(/@([a-z0-9_.-]{3,20})/gi) || []).map(h => h.slice(1).toLowerCase()))].slice(0, 3);
            if (handles.length && algun(adm, ['usuarios', 'sanciones', 'finanzas'])) {
                extra.usuariosMencionados = await Promise.all(handles.map(async h => {
                    const u = await Usuario.findOne({ usuario: h }).select('usuario fecha verificadoNivel saldo descargasTotales listaNegraAdmin suspendido emailVerificado listaSeguidores ultimoLogin adminRol').lean();
                    if (!u) return { usuario: h, existe: false };
                    const [pubs, caidas, rechazadas] = await Promise.all([
                        Juego.countDocuments({ usuario: h }), Juego.countDocuments({ usuario: h, linkStatus: 'caido' }), Juego.countDocuments({ usuario: h, status: 'rechazado' })]);
                    return { usuario: u.usuario, registro: u.fecha, verificacion: u.verificadoNivel, saldoUSD: puede(adm, 'finanzas') ? u.saldo : 'sin permiso', descargas: u.descargasTotales,
                        seguidores: (u.listaSeguidores || []).length, publicaciones: pubs, caidas, rechazadas, listaNegra: !!u.listaNegraAdmin, suspendido: !!u.suspendido,
                        emailVerificado: !!u.emailVerificado, ultimaActividad: u.ultimoLogin, esEquipo: !!u.adminRol };
                }));
            }
            // "títulos entre comillas" → publicaciones que coinciden
            const titulos = [...mensaje.matchAll(/["“«]([^"”»]{3,80})["”»]/g)].map(m => m[1]).slice(0, 2);
            if (titulos.length && algun(adm, ['revision', 'contenido'])) {
                extra.publicacionesMencionadas = (await Promise.all(titulos.map(t => Juego.find({ title: { $regex: escRegex(t), $options: 'i' } })
                    .select('title usuario status linkStatus reportes descargasEfectivas createdAt analisisIA.decision analisisIA.resumen').limit(3).lean()))).flat();
            }

            const contexto = `DATOS ACTUALES DEL PANEL (JSON, ${new Date().toLocaleString('es')}):\n${JSON.stringify(datos)}\n\nACCIONES DETECTADAS:\n${acciones(datos).map(x => `- [${x.prioridad}] ${x.texto}`).join('\n') || '- Nada urgente'}${Object.keys(extra).length ? `\n\nDATOS DE LO QUE PREGUNTA:\n${JSON.stringify(extra)}` : ''}`;
            const ia = await chatIA(sistemaBase(adm) + '\n\n' + contexto, [...historial, { role: 'user', content: mensaje }], { maxTokens: 800, temperatura: 0.35 });
            if (ia) return res.json({ success: true, respuesta: ia.texto, fuente: ia.fuente });
            const l = acciones(datos);
            res.json({ success: true, fuente: null, respuesta: `La IA de Nexus no está disponible ahora mismo, pero esto es lo que veo en tus áreas:\n\n${l.length ? l.map(x => `${x.icono} ${x.texto}`).join('\n') : '✅ No hay nada pendiente.'}` });
        } catch (e) {
            logger.error(`[nexus chat] ${e.message}`);
            res.status(500).json({ success: false, error: 'Nexus no pudo responder' });
        }
    });

    return { recopilar, acciones };
}

module.exports = { registrar };
