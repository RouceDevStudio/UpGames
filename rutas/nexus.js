/**
 * ══════════════════════════════════════════════════════════════════
 *  rutas/nexus.js — API de Nexus (nativa de UpGames)
 *
 *  GET    /nexus/status        ¿la IA está lista?
 *  POST   /nexus/chat          { mensaje, historial?, contexto? } → respuesta
 *                              Con sesión: recuerda la conversación. Invitado:
 *                              el historial lo manda su navegador.
 *  GET    /nexus/historial     conversación guardada        (sesión)
 *  DELETE /nexus/historial     empezar de cero              (sesión)
 *  POST   /nexus/evento        señal de gusto (view, category…) (sesión)
 *  GET    /nexus/perfil        gustos aprendidos            (sesión)
 *  GET    /nexus/mentor/:id    consejos de una publicación propia (sesión)
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const llm = require('../modulos/nexus/llm');
const cerebro = require('../modulos/nexus/cerebro');
const memoria = require('../modulos/nexus/memoria');
const { CATEGORIAS, VISIBLE } = require('../modulos/nexus/herramientas');

const esId = s => /^[a-f\d]{24}$/i.test(String(s || ''));

// Límite de uso en memoria: { clave → [timestamps] }
function limitador(porMinuto, porDia) {
    const uso = new Map();
    return clave => {
        const ahora = Date.now();
        const l = (uso.get(clave) || []).filter(t => t > ahora - 864e5);
        if (l.filter(t => t > ahora - 6e4).length >= porMinuto) return 'Vas muy rápido: espera unos segundos y vuelve a preguntar.';
        if (l.length >= porDia) return 'Has llegado al límite de preguntas de hoy. Vuelve mañana.';
        l.push(ahora); uso.set(clave, l);
        if (uso.size > 20000) uso.clear();
        return null;
    };
}

function registrar(app, deps) {
    const { verificarToken, usuarioOpcional, Juego, logger } = deps;
    const limUsuario = limitador(12, 300), limInvitado = limitador(6, 40), limEvento = limitador(60, 3000);

    app.get('/nexus/status', (req, res) => {
        const e = llm.estado();
        res.json({ online: true, ia: e.configurado, nativo: true, checkedAt: new Date().toISOString() });
    });

    app.post('/nexus/chat', async (req, res) => {
        const usuario = usuarioOpcional(req);
        const mensaje = String(req.body?.mensaje || '').trim();
        if (!mensaje) return res.status(400).json({ ok: false, error: 'Escribe un mensaje' });
        if (mensaje.length > 1500) return res.status(400).json({ ok: false, error: 'Mensaje demasiado largo (máx. 1500 caracteres)' });
        const lim = usuario ? limUsuario(usuario) : limInvitado(String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip);
        if (lim) return res.status(429).json({ ok: false, error: lim });

        // Contexto de la pantalla (validado; el título del item se lee de la BD)
        const c = req.body?.contexto || {};
        const contexto = {
            pestana: typeof c.pestana === 'string' ? c.pestana.replace(/[^a-z]/gi, '').slice(0, 20) : null,
            categoria: CATEGORIAS.includes(c.categoria) ? c.categoria : null,
            busqueda: typeof c.busqueda === 'string' ? c.busqueda.slice(0, 60) : null,
            item: null,
        };
        if (esId(c.itemId)) {
            const it = await Juego.findOne({ _id: c.itemId, ...VISIBLE }).select('title').lean().catch(() => null);
            if (it) contexto.item = { id: String(it._id), titulo: it.title };
        }

        try {
            let historial;
            if (usuario) historial = await memoria.historial(usuario).catch(() => []);
            else historial = (Array.isArray(req.body?.historial) ? req.body.historial : []).slice(-10)
                .filter(h => h && ['user', 'assistant'].includes(h.rol) && typeof h.texto === 'string')
                .map(h => ({ rol: h.rol, texto: h.texto.slice(0, 1200) }));
            const gustos = usuario ? await memoria.gustos(usuario).catch(() => null) : null;

            const r = await cerebro.responder({ mensaje, historial, usuario, contexto, gustos }, deps);
            if (usuario) memoria.guardarTurno(usuario, mensaje, r).catch(e => logger.warn(`[nexus] memoria: ${e.message}`));
            res.json({ ok: true, texto: r.texto, items: r.items, acciones: r.acciones, fuente: r.fuente });
        } catch (e) {
            logger.error(`[nexus/chat] ${e.message}`);
            res.status(500).json({ ok: false, error: 'Nexus tuvo un problema. Inténtalo de nuevo.' });
        }
    });

    app.get('/nexus/historial', verificarToken, async (req, res) => {
        const h = await memoria.historial(req.usuario).catch(() => []);
        res.json({ ok: true, historial: h.map(m => ({ rol: m.rol, texto: m.texto, items: m.items || [], acciones: m.acciones || [], fecha: m.fecha })) });
    });

    app.delete('/nexus/historial', verificarToken, async (req, res) => {
        await memoria.borrarHistorial(req.usuario).catch(() => {});
        res.json({ ok: true });
    });

    app.post('/nexus/evento', verificarToken, async (req, res) => {
        const tipo = String(req.body?.tipo || '');
        if (!['view', 'category', 'search'].includes(tipo)) return res.status(400).json({ ok: false });
        if (limEvento(req.usuario)) return res.json({ ok: true, ignorado: true });
        try {
            if (tipo === 'view' && esId(req.body.itemId)) {
                const item = await Juego.findOne({ _id: req.body.itemId, ...VISIBLE }).select('category tags').lean();
                if (item) await memoria.aprender(req.usuario, 'view', { item });
            } else if (CATEGORIAS.includes(req.body?.categoria)) await memoria.aprender(req.usuario, tipo, { categoria: req.body.categoria });
            res.json({ ok: true });
        } catch (_) { res.json({ ok: false }); }
    });

    app.get('/nexus/perfil', verificarToken, async (req, res) => {
        res.json({ ok: true, ...(await memoria.gustos(req.usuario).catch(() => ({ categorias: [], tags: [], recientes: [] }))) });
    });

    app.get('/nexus/mentor/:id', verificarToken, async (req, res) => {
        if (!esId(req.params.id)) return res.status(400).json({ ok: false, error: 'id inválido' });
        const item = await Juego.findById(req.params.id).select('nexusMentor usuario title').lean().catch(() => null);
        if (!item) return res.status(404).json({ ok: false, error: 'Item no encontrado' });
        if (item.usuario !== req.usuario) return res.status(403).json({ ok: false, error: 'Sin permiso' });
        res.json({ ok: true, mentor: item.nexusMentor || null, title: item.title });
    });
}

module.exports = { registrar, limitador };
