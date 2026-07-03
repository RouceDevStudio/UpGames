/**
 * ══════════════════════════════════════════════════════════════════
 *  nexusPublish.js — Receptor y hosting de publicaciones NEXUS → UpGames
 *  Archivo: modulos/nexusPublish.js
 *
 *  Cuando el usuario pulsa "🚀 Publicar" en la zona de Proyectos de Nexus,
 *  Nexus empaqueta los archivos del workspace y los envía aquí. Este módulo:
 *    1. Los guarda de forma PERSISTENTE en MongoDB (colección nexus_proyectos)
 *       → sobreviven a los redeploys del contenedor (a diferencia del disco).
 *    2. Los sirve en  /u/<usuario>/<proyecto>/<archivo>  con cabeceras de
 *       seguridad (sandbox) y metadatos Open Graph para compartir.
 *    3. Crea/actualiza una entrada (Juego) en la categoría "software".
 *
 *  Público vs privado:  visibility=private → status 'privado' → fuera de todo
 *  el descubrimiento público; solo accesible por su link directo.
 *
 *  Premium:  publicar es un beneficio del plan. Si el usuario cancela o pierde
 *  el plan, Nexus llama a /api/nexus/project-status con active=false: las
 *  entradas se marcan como "caido" (ocultas del catálogo) y el hosting /u
 *  responde 403. Un job de reconciliación en Nexus reenvía el estado por si se
 *  pierde un webhook.
 *
 *  Versionado:  cada re-publicación crea una versión; se guardan las últimas
 *  KEEP_VERSIONS y se puede revertir.
 *
 *  Endpoints (todos autenticados con x-nexus-key salvo el hosting /u):
 *    POST /api/nexus/publish-project      publica / re-publica
 *    POST /api/nexus/project-status       activa/desactiva por premium
 *    POST /api/nexus/project-visibility   público/privado
 *    POST /api/nexus/project-stats        métricas de una publicación
 *    POST /api/nexus/unpublish-project    despublica y borra
 *    GET  /u/<usuario>/<proyecto>/<file>  hosting del contenido
 *
 *  Integración en index.js (ANTES del handler 404):
 *    const nexusPublish = require('./modulos/nexusPublish');
 *    nexusPublish.registrar(app, { Juego, logger });
 *
 *  Variables de entorno:
 *    UPGAMES_NEXUS_KEY   secreto compartido con Nexus (obligatorio).
 *    PUBLIC_BASE_URL     origen público para construir los links (o se infiere).
 * ══════════════════════════════════════════════════════════════════
 */

'use strict';

const mongoose = require('mongoose');
const path     = require('path');

// Límites defensivos
const MAX_FILES       = 300;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;  // 10 MB por proyecto
const MAX_FILE_BYTES  = 3 * 1024 * 1024;   // 3 MB por archivo
const KEEP_VERSIONS   = 3;                 // versiones antiguas conservadas

// Tipos MIME por extensión (para servir el contenido correctamente)
const MIME = {
    '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
    '.map': 'application/json', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};
function mimeFor(p) { return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'; }

/** Convierte un texto en un segmento de ruta seguro para URLs/almacenamiento. */
function slugify(s) {
    return String(s || '')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 60);
}

/** Normaliza una ruta relativa y bloquea path traversal. Devuelve POSIX o null. */
function safeRel(rel) {
    const cleaned = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '').split('?')[0].split('#')[0];
    if (!cleaned) return null;
    const parts = [];
    for (const seg of cleaned.split('/')) {
        if (!seg || seg === '.') continue;
        if (seg === '..') return null;
        if (seg.startsWith('.')) return null;
        if (/[<>:"|?*\x00-\x1f]/.test(seg)) return null;
        parts.push(seg);
    }
    return parts.length ? parts.join('/') : null;
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Inyecta metadatos Open Graph en el <head> del HTML de entrada, si faltan. */
function injectOpenGraph(html, { title, description, url, image }) {
    if (typeof html !== 'string') return html;
    if (/property=["']og:title["']/i.test(html)) return html;   // ya los tiene
    const tags = [
        `<meta property="og:type" content="website">`,
        `<meta property="og:title" content="${escapeHtml(title)}">`,
        description ? `<meta property="og:description" content="${escapeHtml(description)}">` : '',
        url ? `<meta property="og:url" content="${escapeHtml(url)}">` : '',
        image ? `<meta property="og:image" content="${escapeHtml(image)}">` : '',
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${escapeHtml(title)}">`,
        `<meta name="generator" content="UpGames · publicado desde Nexus">`,
    ].filter(Boolean).join('\n');
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => `${m}\n${tags}`);
    return `${tags}\n${html}`;
}

// ── Modelos Mongoose (persistencia de los archivos publicados) ────────
function getModels() {
    const FileSchema = new mongoose.Schema({
        path:  { type: String, required: true },
        ctype: { type: String, default: 'application/octet-stream' },
        data:  { type: Buffer, required: true },
    }, { _id: false });

    const ProyectoSchema = new mongoose.Schema({
        userId:         { type: String, index: true },
        username:       { type: String, default: '' },
        folderUser:     { type: String, index: true },
        projKey:        { type: String, index: true },
        nexusProjectId: { type: String, index: true },
        itemId:         { type: String, default: '' },
        entry:          { type: String, default: 'index.html' },
        visibility:     { type: String, enum: ['public', 'private'], default: 'public' },
        active:         { type: Boolean, default: true },   // false = suspendido por premium
        version:        { type: Number, default: 1 },
        bytes:          { type: Number, default: 0 },
        title:          { type: String, default: '' },
        description:    { type: String, default: '' },
        files:          { type: [FileSchema], default: [] },
    }, { collection: 'nexus_proyectos', timestamps: true });
    ProyectoSchema.index({ folderUser: 1, projKey: 1 }, { unique: true });

    const VersionSchema = new mongoose.Schema({
        proyectoId: { type: mongoose.Schema.Types.ObjectId, index: true },
        version:    { type: Number },
        entry:      { type: String, default: 'index.html' },
        bytes:      { type: Number, default: 0 },
        files:      { type: [FileSchema], default: [] },
        ts:         { type: Date, default: Date.now },
    }, { collection: 'nexus_proyecto_versiones' });

    const NexusProyecto = mongoose.models.NexusProyecto || mongoose.model('NexusProyecto', ProyectoSchema);
    const NexusProyectoVersion = mongoose.models.NexusProyectoVersion || mongoose.model('NexusProyectoVersion', VersionSchema);
    return { NexusProyecto, NexusProyectoVersion };
}

function registrar(app, deps) {
    const { Juego, logger } = deps;
    const log = logger || console;
    const { NexusProyecto, NexusProyectoVersion } = getModels();

    const NEXUS_KEY   = process.env.UPGAMES_NEXUS_KEY || process.env.NEXUS_INTERNAL_SECRET || '';
    const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || '').replace(/\/+$/, '');

    function requireNexusKey(req, res, next) {
        if (!NEXUS_KEY) {
            log.warn('[nexusPublish] UPGAMES_NEXUS_KEY no configurado — publicación deshabilitada');
            return res.status(503).json({ error: 'Publicación de proyectos no configurada en el servidor' });
        }
        const key = req.headers['x-nexus-key'] || req.headers['x-nexus-secret'] || '';
        if (key !== NEXUS_KEY) return res.status(401).json({ error: 'Credencial de servicio inválida' });
        next();
    }

    // ══════════════════════════════════════════════════════════════
    //  HOSTING:  GET /u/:usuario/:proj/*  — sirve el contenido desde la BD
    // ══════════════════════════════════════════════════════════════
    async function serve(req, res) {
        try {
            const folderUser = slugify(req.params.usuario);
            const projKey    = slugify(req.params.proj);
            const proj = await NexusProyecto.findOne({ folderUser, projKey }).lean();
            if (!proj) return res.status(404).type('text/plain').send('Proyecto no encontrado');
            if (proj.active === false) {
                return res.status(403).type('text/html').send(
                    '<h1>Publicación suspendida</h1><p>Este proyecto no está disponible temporalmente (el plan del autor está inactivo).</p>');
            }
            let rel = safeRel(req.params[0] || '') || proj.entry || 'index.html';
            let file = proj.files.find(f => f.path === rel);
            if (!file) {
                // Solo se hace fallback en rutas SIN extensión (directorios / rutas tipo SPA):
                // un asset con extensión que no existe debe dar 404, no la página de entrada.
                const hasExt = /\.[a-z0-9]+$/i.test(rel);
                if (!hasExt) {
                    const asIndex = safeRel(rel.replace(/\/+$/, '') + '/index.html');
                    file = (asIndex && proj.files.find(f => f.path === asIndex)) || proj.files.find(f => f.path === proj.entry);
                }
            }
            if (!file) return res.status(404).type('text/plain').send('Archivo no encontrado');

            // Cabeceras de seguridad — el contenido es de terceros (sandbox).
            res.set('X-Content-Type-Options', 'nosniff');
            res.set('X-Frame-Options', 'SAMEORIGIN');
            res.set('Referrer-Policy', 'no-referrer');
            res.set('Cross-Origin-Resource-Policy', 'same-site');
            res.set('Cache-Control', 'public, max-age=300');
            res.type(file.ctype || mimeFor(file.path));

            let body = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data?.buffer || file.data || '');
            // En el HTML de entrada, inyecta Open Graph para compartir (punto 9).
            if (/\.html?$/i.test(file.path) && file.path === (proj.entry || 'index.html')) {
                const origin = PUBLIC_BASE || `${req.protocol}://${req.get('host')}`;
                const url = `${origin}/u/${encodeURIComponent(folderUser)}/${encodeURIComponent(projKey)}/`;
                body = Buffer.from(injectOpenGraph(body.toString('utf8'),
                    { title: proj.title || projKey, description: proj.description, url }), 'utf8');
            }
            return res.send(body);
        } catch (e) {
            log.error(`[nexusPublish] serve: ${e.message}`);
            return res.status(500).type('text/plain').send('Error sirviendo el contenido');
        }
    }
    app.get('/u/:usuario/:proj', serve);
    app.get('/u/:usuario/:proj/*', serve);

    // ══════════════════════════════════════════════════════════════
    //  POST /api/nexus/publish-project
    // ══════════════════════════════════════════════════════════════
    app.post('/api/nexus/publish-project', requireNexusKey, async (req, res) => {
        try {
            const b = req.body || {};
            const userId   = String(b.userId || '').trim();
            const username = String(b.username || '').trim();
            if (!Array.isArray(b.files) || !b.files.length) {
                return res.status(400).json({ error: 'No se recibieron archivos' });
            }

            const folderUser = slugify(username) || ('user-' + (slugify(userId) || 'anon'));
            const projKey    = slugify(b.projectId || b.title || String(Date.now()));
            const nexusProjectId = String(b.projectId || projKey);
            const visibility = String(b.visibility || 'public') === 'private' ? 'private' : 'public';

            // Decodificar y validar archivos
            const files = [];
            let total = 0;
            for (const f of b.files) {
                const rel = safeRel(f && f.path);
                if (!rel) continue;
                let buf;
                try { buf = Buffer.from(String(f.contentB64 || ''), 'base64'); } catch { continue; }
                if (buf.length > MAX_FILE_BYTES) continue;
                if (total + buf.length > MAX_TOTAL_BYTES) break;
                if (files.length >= MAX_FILES) break;
                files.push({ path: rel, ctype: mimeFor(rel), data: buf });
                total += buf.length;
            }
            if (!files.length) return res.status(400).json({ error: 'Ningún archivo válido para publicar' });

            // Entry
            let entry = safeRel(b.entry) || 'index.html';
            if (!files.find(f => f.path === entry)) {
                entry = (files.find(f => /(^|\/)index\.html?$/i.test(f.path)) || files.find(f => /\.html?$/i.test(f.path)) || files[0]).path;
            }

            const title = String(b.title || 'Proyecto').slice(0, 200);
            const description = String(b.description || '').slice(0, 1000);

            // Upsert del proyecto persistido + versionado
            let proj = await NexusProyecto.findOne({ folderUser, projKey });
            let version = 1;
            if (proj) {
                // Snapshot de la versión actual antes de sobrescribir
                try {
                    await NexusProyectoVersion.create({
                        proyectoId: proj._id, version: proj.version, entry: proj.entry, bytes: proj.bytes, files: proj.files
                    });
                    const olds = await NexusProyectoVersion.find({ proyectoId: proj._id }).sort({ version: -1 }).skip(KEEP_VERSIONS).select('_id').lean();
                    if (olds.length) await NexusProyectoVersion.deleteMany({ _id: { $in: olds.map(o => o._id) } });
                } catch (e) { log.warn(`[nexusPublish] snapshot: ${e.message}`); }
                version = (proj.version || 1) + 1;
                Object.assign(proj, { userId, username, nexusProjectId, entry, visibility, active: true, version, bytes: total, title, description, files });
            } else {
                proj = new NexusProyecto({ userId, username, folderUser, projKey, nexusProjectId, entry, visibility, active: true, version, bytes: total, title, description, files });
            }
            await proj.save();

            const origin = PUBLIC_BASE || `${req.protocol}://${req.get('host')}`;
            const url = `${origin}/u/${encodeURIComponent(folderUser)}/${encodeURIComponent(projKey)}/`;

            // Upsert de la entrada del catálogo (Juego)
            const extraData = {
                nexusProject: true, nexusProjectId, nexusUserId: userId, nexusPublisher: username,
                entry, folder: `${folderUser}/${projKey}`, graphStats: b.graphStats || null,
                files: files.length, bytes: total, version, nexusPublishedAt: new Date()
            };
            const fields = {
                usuario: username || folderUser, title, description, link: url,
                category: String(b.category || 'software').slice(0, 40),
                visibility, status: visibility === 'private' ? 'privado' : 'aprobado', linkStatus: 'online',
            };
            const existing = await Juego.findOne({ 'extraData.nexusProjectId': nexusProjectId, 'extraData.nexusUserId': userId });
            let item;
            if (existing) {
                Object.assign(existing, fields);
                existing.extraData = { ...(existing.extraData || {}), ...extraData };
                existing.markModified('extraData');
                item = await existing.save();
            } else {
                item = await new Juego({ ...fields, extraData }).save();
            }
            if (String(proj.itemId) !== String(item._id)) { proj.itemId = String(item._id); await proj.save(); }

            log.info(`[nexusPublish] "${title}" de @${fields.usuario} v${version} → ${files.length} archivo(s), ${(total / 1024).toFixed(0)}KB (${visibility})`);
            return res.json({ ok: true, id: String(item._id), url, version, visibility, files: files.length, bytes: total,
                message: `Proyecto publicado en UpGames (categoría software, ${visibility === 'private' ? 'privado' : 'público'}).` });
        } catch (e) {
            log.error(`[nexusPublish] publish-project: ${e.message}`);
            return res.status(500).json({ error: 'Error hospedando el proyecto' });
        }
    });

    // ══════════════════════════════════════════════════════════════
    //  POST /api/nexus/project-status  — activar/desactivar por premium
    // ══════════════════════════════════════════════════════════════
    app.post('/api/nexus/project-status', requireNexusKey, async (req, res) => {
        try {
            const { userId, username, active } = req.body || {};
            const or = [];
            if (userId)   or.push({ 'extraData.nexusUserId': String(userId) });
            if (username) or.push({ 'extraData.nexusPublisher': String(username) });
            if (!or.length) return res.status(400).json({ error: 'Se requiere userId o username' });

            const linkStatus = active ? 'online' : 'caido';
            const r = await Juego.updateMany({ 'extraData.nexusProject': true, $or: or }, { $set: { linkStatus } });
            // Espeja en el hosting: los proyectos suspendidos devuelven 403.
            const projOr = [];
            if (userId) projOr.push({ userId: String(userId) });
            if (username) projOr.push({ username: String(username) });
            await NexusProyecto.updateMany(projOr.length ? { $or: projOr } : {}, { $set: { active: !!active } });

            const updated = r.modifiedCount ?? r.nModified ?? 0;
            log.info(`[nexusPublish] project-status active=${!!active} → ${updated} entrada(s)`);
            return res.json({ ok: true, updated, linkStatus });
        } catch (e) {
            log.error(`[nexusPublish] project-status: ${e.message}`);
            return res.status(500).json({ error: 'Error actualizando estado de proyectos' });
        }
    });

    // ══════════════════════════════════════════════════════════════
    //  POST /api/nexus/project-visibility  — público/privado
    // ══════════════════════════════════════════════════════════════
    app.post('/api/nexus/project-visibility', requireNexusKey, async (req, res) => {
        try {
            const { userId, projectId } = req.body || {};
            const visibility = String((req.body || {}).visibility || 'public') === 'private' ? 'private' : 'public';
            if (!projectId) return res.status(400).json({ error: 'Se requiere projectId' });

            const filter = { 'extraData.nexusProject': true, 'extraData.nexusProjectId': String(projectId) };
            if (userId) filter['extraData.nexusUserId'] = String(userId);
            const item = await Juego.findOne(filter);
            if (!item) return res.status(404).json({ error: 'Proyecto publicado no encontrado' });

            item.visibility = visibility;
            if (item.linkStatus !== 'caido' && item.status !== 'rechazado') {
                item.status = visibility === 'private' ? 'privado' : 'aprobado';
            }
            await item.save();
            await NexusProyecto.updateOne({ nexusProjectId: String(projectId), userId: String(userId || item.extraData?.nexusUserId || '') }, { $set: { visibility } });

            log.info(`[nexusPublish] project-visibility ${projectId} → ${visibility}`);
            return res.json({ ok: true, visibility, id: String(item._id) });
        } catch (e) {
            log.error(`[nexusPublish] project-visibility: ${e.message}`);
            return res.status(500).json({ error: 'Error actualizando visibilidad' });
        }
    });

    // ══════════════════════════════════════════════════════════════
    //  POST /api/nexus/project-stats  — métricas de una publicación
    // ══════════════════════════════════════════════════════════════
    app.post('/api/nexus/project-stats', requireNexusKey, async (req, res) => {
        try {
            const { userId, projectId } = req.body || {};
            if (!projectId) return res.status(400).json({ error: 'Se requiere projectId' });
            const filter = { 'extraData.nexusProject': true, 'extraData.nexusProjectId': String(projectId) };
            if (userId) filter['extraData.nexusUserId'] = String(userId);
            const item = await Juego.findOne(filter).lean();
            if (!item) return res.status(404).json({ error: 'Proyecto publicado no encontrado' });
            const proj = await NexusProyecto.findOne({ nexusProjectId: String(projectId) }).select('version bytes files updatedAt visibility active').lean();
            return res.json({
                ok: true,
                stats: {
                    descargas: item.descargasEfectivas || 0,
                    likes: item.likesCount || 0,
                    reportes: item.reportes || 0,
                    visibility: item.visibility || 'public',
                    linkStatus: item.linkStatus,
                    status: item.status,
                    version: proj?.version || 1,
                    bytes: proj?.bytes || 0,
                    archivos: proj?.files?.length || 0,
                    actualizado: proj?.updatedAt || item.updatedAt,
                    link: item.link,
                }
            });
        } catch (e) {
            log.error(`[nexusPublish] project-stats: ${e.message}`);
            return res.status(500).json({ error: 'Error obteniendo métricas' });
        }
    });

    // ══════════════════════════════════════════════════════════════
    //  POST /api/nexus/unpublish-project  — despublicar y borrar
    // ══════════════════════════════════════════════════════════════
    app.post('/api/nexus/unpublish-project', requireNexusKey, async (req, res) => {
        try {
            const { userId, projectId } = req.body || {};
            if (!projectId) return res.status(400).json({ error: 'Se requiere projectId' });
            const filter = { 'extraData.nexusProject': true, 'extraData.nexusProjectId': String(projectId) };
            if (userId) filter['extraData.nexusUserId'] = String(userId);

            const item = await Juego.findOne(filter);
            const proj = await NexusProyecto.findOne({ nexusProjectId: String(projectId), ...(userId ? { userId: String(userId) } : {}) });
            if (proj) {
                await NexusProyectoVersion.deleteMany({ proyectoId: proj._id }).catch(() => {});
                await NexusProyecto.deleteOne({ _id: proj._id });
            }
            if (item) await Juego.deleteOne({ _id: item._id });
            if (!item && !proj) return res.status(404).json({ error: 'Proyecto publicado no encontrado' });

            log.info(`[nexusPublish] unpublish ${projectId}`);
            return res.json({ ok: true, message: 'Publicación eliminada de UpGames.' });
        } catch (e) {
            log.error(`[nexusPublish] unpublish-project: ${e.message}`);
            return res.status(500).json({ error: 'Error despublicando el proyecto' });
        }
    });

    // ══════════════════════════════════════════════════════════════
    //  POST /api/nexus/project-revert  — revertir a la versión anterior
    // ══════════════════════════════════════════════════════════════
    app.post('/api/nexus/project-revert', requireNexusKey, async (req, res) => {
        try {
            const { userId, projectId } = req.body || {};
            if (!projectId) return res.status(400).json({ error: 'Se requiere projectId' });
            const proj = await NexusProyecto.findOne({ nexusProjectId: String(projectId), ...(userId ? { userId: String(userId) } : {}) });
            if (!proj) return res.status(404).json({ error: 'Proyecto publicado no encontrado' });
            const target = String((req.body || {}).version || '');
            const snap = target
                ? await NexusProyectoVersion.findOne({ proyectoId: proj._id, version: Number(target) })
                : await NexusProyectoVersion.findOne({ proyectoId: proj._id }).sort({ version: -1 });
            if (!snap) return res.status(404).json({ error: 'No hay una versión anterior para revertir' });

            // Guarda la actual como versión antes de revertir
            await NexusProyectoVersion.create({ proyectoId: proj._id, version: proj.version, entry: proj.entry, bytes: proj.bytes, files: proj.files });
            proj.version = (proj.version || 1) + 1;
            proj.entry = snap.entry; proj.bytes = snap.bytes; proj.files = snap.files;
            await proj.save();
            await NexusProyectoVersion.deleteOne({ _id: snap._id }).catch(() => {});
            const olds = await NexusProyectoVersion.find({ proyectoId: proj._id }).sort({ version: -1 }).skip(KEEP_VERSIONS).select('_id').lean();
            if (olds.length) await NexusProyectoVersion.deleteMany({ _id: { $in: olds.map(o => o._id) } });

            log.info(`[nexusPublish] revert ${projectId} → v${snap.version} (ahora v${proj.version})`);
            return res.json({ ok: true, version: proj.version, restoredFrom: snap.version });
        } catch (e) {
            log.error(`[nexusPublish] project-revert: ${e.message}`);
            return res.status(500).json({ error: 'Error revirtiendo la versión' });
        }
    });

    log.info(`🔗 [nexusPublish] listo — hosting persistente en /u (MongoDB)${NEXUS_KEY ? '' : ' (⚠ UPGAMES_NEXUS_KEY sin configurar)'}`);
}

module.exports = { registrar, slugify, safeRel, injectOpenGraph, mimeFor };
