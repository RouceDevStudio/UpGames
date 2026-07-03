/**
 * ══════════════════════════════════════════════════════════════════
 *  nexusPublish.js — Receptor de publicaciones NEXUS → UpGames
 *  Archivo: modulos/nexusPublish.js
 *
 *  Cuando el usuario pulsa "🚀 Publicar" en la zona de Proyectos de Nexus,
 *  Nexus empaqueta los archivos del workspace y los envía aquí. Este módulo:
 *    1. Los guarda en  user_public/<usuario>/<proyecto>/   (una subcarpeta por
 *       usuario, y dentro una carpeta por proyecto).
 *    2. Los sirve estáticamente en  /u/<usuario>/<proyecto>/<entry>
 *    3. Crea/actualiza una entrada (Juego) en la categoría "software",
 *       aprobada y online, cuyo link apunta a la subpágina hospedada.
 *
 *  Publicar es un beneficio del plan premium (Nexus lo verifica antes de
 *  enviar). Si el usuario cancela o pierde el plan, Nexus llama a
 *  /api/nexus/project-status con active=false y todas sus entradas se marcan
 *  como "caido" — con lo que dejan de visualizarse en el catálogo público
 *  (GET /items filtra linkStatus ∈ {online, revision}).
 *
 *  Integración en index.js (ANTES del handler 404):
 *    const nexusPublish = require('./modulos/nexusPublish');
 *    nexusPublish.registrar(app, { Juego, logger });
 *
 *  Variables de entorno:
 *    UPGAMES_NEXUS_KEY   — secreto compartido con Nexus (obligatorio; debe
 *                          coincidir con el mismo valor en Nexus). Alterna:
 *                          NEXUS_INTERNAL_SECRET.
 *    USER_PUBLIC_DIR     — carpeta base (por defecto  ../user_public).
 *    PUBLIC_BASE_URL     — origen público para construir los links
 *                          (por defecto se infiere del request). Alterna: APP_URL.
 * ══════════════════════════════════════════════════════════════════
 */

'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const fsp     = fs.promises;

// Límites defensivos
const MAX_FILES       = 200;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;   // 8 MB por proyecto
const MAX_FILE_BYTES  = 2 * 1024 * 1024;   // 2 MB por archivo

/** Convierte un texto en un segmento de ruta seguro para el sistema de archivos. */
function slugify(s) {
    return String(s || '')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 60);
}

/**
 * Normaliza una ruta relativa dentro del proyecto y bloquea path traversal.
 * Devuelve la ruta relativa (con separadores POSIX) o null si es insegura.
 */
function safeRel(rel) {
    const cleaned = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!cleaned) return null;
    const parts = [];
    for (const seg of cleaned.split('/')) {
        if (!seg || seg === '.') continue;
        if (seg === '..') return null;               // traversal
        if (seg.startsWith('.')) return null;         // dotfiles
        if (/[<>:"|?*\x00-\x1f]/.test(seg)) return null;
        parts.push(seg);
    }
    if (!parts.length) return null;
    return parts.join('/');
}

/** Busca un archivo de entrada razonable dentro del directorio del proyecto. */
function findEntry(baseDir) {
    const prefer = ['index.html', 'index.htm'];
    for (const p of prefer) {
        if (fs.existsSync(path.join(baseDir, p))) return p;
    }
    // Primer .html en la raíz
    try {
        const html = fs.readdirSync(baseDir).find(f => /\.html?$/i.test(f));
        if (html) return html;
    } catch (_) {}
    return null;
}

function registrar(app, deps) {
    const { Juego, logger } = deps;
    const log = logger || console;

    const NEXUS_KEY = process.env.UPGAMES_NEXUS_KEY || process.env.NEXUS_INTERNAL_SECRET || '';
    const USER_PUBLIC_DIR = process.env.USER_PUBLIC_DIR
        || path.join(__dirname, '..', 'user_public');
    const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || '').replace(/\/+$/, '');

    // Asegurar la carpeta base
    try { fs.mkdirSync(USER_PUBLIC_DIR, { recursive: true }); }
    catch (e) { log.warn(`[nexusPublish] no se pudo crear ${USER_PUBLIC_DIR}: ${e.message}`); }

    // ── Hosting estático de los proyectos publicados ──────────────────
    //   /u/<usuario>/<proyecto>/...   sirve el contenido subido.
    app.use('/u', express.static(USER_PUBLIC_DIR, {
        index: 'index.html',
        dotfiles: 'ignore',
        maxAge: '1h',
        fallthrough: true,
        setHeaders(res) {
            // El contenido es de terceros: evitar que se enmarque en la app.
            res.setHeader('X-Content-Type-Options', 'nosniff');
        }
    }));

    // ── Middleware de autenticación entre servicios ───────────────────
    function requireNexusKey(req, res, next) {
        if (!NEXUS_KEY) {
            log.warn('[nexusPublish] UPGAMES_NEXUS_KEY no configurado — publicación deshabilitada');
            return res.status(503).json({ error: 'Publicación de proyectos no configurada en el servidor' });
        }
        const key = req.headers['x-nexus-key'] || req.headers['x-nexus-secret'] || '';
        if (key !== NEXUS_KEY) return res.status(401).json({ error: 'Credencial de servicio inválida' });
        next();
    }

    // ────────────────────────────────────────────────────────────────
    // POST /api/nexus/publish-project
    // Recibe un proyecto de Nexus, lo hospeda y crea/actualiza la entrada.
    // Body: { source, userId, username, projectId, title, description,
    //         category, entry, files:[{path, contentB64}], graphStats }
    // ────────────────────────────────────────────────────────────────
    app.post('/api/nexus/publish-project', requireNexusKey, async (req, res) => {
        try {
            const b = req.body || {};
            const userId   = String(b.userId || '').trim();
            const username = String(b.username || '').trim();
            if (!Array.isArray(b.files) || !b.files.length) {
                return res.status(400).json({ error: 'No se recibieron archivos' });
            }

            const folderUser = slugify(username) || ('user-' + slugify(userId) || 'anon');
            // Id estable del proyecto → permite re-publicar (actualizar) el mismo.
            const projKey    = slugify(b.projectId || b.title || String(Date.now()));
            const nexusProjectId = String(b.projectId || projKey);

            const baseDir = path.join(USER_PUBLIC_DIR, folderUser, projKey);

            // Reescribir limpio: elimina archivos borrados en el proyecto.
            await fsp.rm(baseDir, { recursive: true, force: true });
            await fsp.mkdir(baseDir, { recursive: true });

            let written = 0, total = 0;
            for (const f of b.files) {
                const rel = safeRel(f && f.path);
                if (!rel) continue;
                let buf;
                try { buf = Buffer.from(String(f.contentB64 || ''), 'base64'); }
                catch { continue; }
                if (buf.length > MAX_FILE_BYTES) continue;
                if (total + buf.length > MAX_TOTAL_BYTES) break;
                if (written >= MAX_FILES) break;

                const abs = path.join(baseDir, rel);
                if (!abs.startsWith(baseDir + path.sep)) continue;   // guard extra
                await fsp.mkdir(path.dirname(abs), { recursive: true });
                await fsp.writeFile(abs, buf);
                written++; total += buf.length;
            }
            if (!written) {
                await fsp.rm(baseDir, { recursive: true, force: true }).catch(() => {});
                return res.status(400).json({ error: 'Ningún archivo válido para publicar' });
            }

            // Resolver el archivo de entrada
            let entry = safeRel(b.entry) || 'index.html';
            if (!fs.existsSync(path.join(baseDir, entry))) {
                entry = findEntry(baseDir) || entry;
            }

            const origin  = PUBLIC_BASE || `${req.protocol}://${req.get('host')}`;
            const relUrl  = `/u/${encodeURIComponent(folderUser)}/${encodeURIComponent(projKey)}/`
                          + entry.split('/').map(encodeURIComponent).join('/');
            const url     = origin + relUrl;

            // Visibilidad elegida por el usuario en Nexus antes de publicar.
            // 'private' → status 'privado' (queda fuera de todo el descubrimiento
            // público, que filtra status:'aprobado'; solo accesible por link directo).
            const visibility = String(b.visibility || 'public') === 'private' ? 'private' : 'public';

            const extraData = {
                nexusProject:   true,
                nexusProjectId,
                nexusUserId:    userId,
                nexusPublisher: username,
                entry,
                folder:         `${folderUser}/${projKey}`,
                graphStats:     b.graphStats || null,
                files:          written,
                bytes:          total,
                nexusPublishedAt: new Date()
            };

            const fields = {
                usuario:     username || folderUser,
                title:       String(b.title || 'Proyecto').slice(0, 200),
                description: String(b.description || '').slice(0, 1000),
                link:        url,
                category:    String(b.category || 'software').slice(0, 40),
                visibility,
                status:      visibility === 'private' ? 'privado' : 'aprobado',
                linkStatus:  'online',
            };

            // Upsert idempotente por (nexusProjectId, nexusUserId)
            const existing = await Juego.findOne({
                'extraData.nexusProjectId': nexusProjectId,
                'extraData.nexusUserId':    userId
            });

            let saved;
            if (existing) {
                Object.assign(existing, fields);
                existing.extraData = { ...(existing.extraData || {}), ...extraData };
                existing.markModified('extraData');
                saved = await existing.save();
            } else {
                saved = await new Juego({ ...fields, extraData }).save();
            }

            log.info(`[nexusPublish] "${fields.title}" de @${fields.usuario} → ${written} archivo(s), ${(total / 1024).toFixed(0)}KB → ${relUrl}`);
            return res.json({
                ok: true,
                id: String(saved._id),
                url,
                message: 'Proyecto publicado en UpGames (categoría software).'
            });
        } catch (e) {
            log.error(`[nexusPublish] publish-project: ${e.message}`);
            return res.status(500).json({ error: 'Error hospedando el proyecto' });
        }
    });

    // ────────────────────────────────────────────────────────────────
    // POST /api/nexus/project-status
    // Nexus avisa cuando el usuario pierde/recupera el plan premium.
    // active=false → todas sus entradas nexus se marcan "caido" (ocultas).
    // active=true  → se reactivan (online).
    // Body: { userId, username, active }
    // ────────────────────────────────────────────────────────────────
    app.post('/api/nexus/project-status', requireNexusKey, async (req, res) => {
        try {
            const { userId, username, active } = req.body || {};
            const or = [];
            if (userId)   or.push({ 'extraData.nexusUserId':    String(userId) });
            if (username) or.push({ 'extraData.nexusPublisher': String(username) });
            if (!or.length) return res.status(400).json({ error: 'Se requiere userId o username' });

            const filter     = { 'extraData.nexusProject': true, $or: or };
            const linkStatus = active ? 'online' : 'caido';
            const r = await Juego.updateMany(filter, { $set: { linkStatus } });
            const updated = r.modifiedCount ?? r.nModified ?? 0;

            log.info(`[nexusPublish] project-status active=${!!active} → ${updated} entrada(s) ${linkStatus}`);
            return res.json({ ok: true, updated, linkStatus });
        } catch (e) {
            log.error(`[nexusPublish] project-status: ${e.message}`);
            return res.status(500).json({ error: 'Error actualizando estado de proyectos' });
        }
    });

    // ────────────────────────────────────────────────────────────────
    // POST /api/nexus/project-visibility
    // El usuario cambia (desde el historial de proyectos de Nexus) si una
    // publicación ya hecha es pública o privada. No toca linkStatus, así que
    // respeta el gate de premium (una entrada caída sigue caída).
    // Body: { userId, projectId, visibility: 'public' | 'private' }
    // ────────────────────────────────────────────────────────────────
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
            // Solo alterna entre público/privado; si estaba caído por premium, no lo revive.
            if (item.status !== 'rechazado' && item.linkStatus !== 'caido') {
                item.status = visibility === 'private' ? 'privado' : 'aprobado';
            } else {
                // Guarda la intención para cuando se reactive (aunque el gate lo mantenga oculto).
                item.status = visibility === 'private' ? 'privado' : (item.status === 'privado' ? 'aprobado' : item.status);
            }
            await item.save();

            log.info(`[nexusPublish] project-visibility ${projectId} → ${visibility}`);
            return res.json({ ok: true, visibility, id: String(item._id) });
        } catch (e) {
            log.error(`[nexusPublish] project-visibility: ${e.message}`);
            return res.status(500).json({ error: 'Error actualizando visibilidad' });
        }
    });

    log.info(`🔗 [nexusPublish] listo — hosting en /u, base=${USER_PUBLIC_DIR}${NEXUS_KEY ? '' : ' (⚠ UPGAMES_NEXUS_KEY sin configurar)'}`);
}

module.exports = { registrar, slugify, safeRel };
