/**
 * Reseñas con estrellas y colecciones de publicaciones.
 *
 * Reseñas (una por persona y publicación, se puede editar):
 *   GET    /items/:id/resenas              resumen (promedio, total, reparto, ¿funcionó?) + últimas 30 + la mía
 *   POST   /items/:id/resenas              { estrellas 1-5, funciono true|false|null, texto ≤ 500 }
 *   DELETE /items/:id/resenas              borrar la mía
 *   DELETE /admin/resenas/:id              (admin)
 *   El resumen se guarda en la publicación (`resenas`) para mostrar ★ en las tarjetas sin otra consulta.
 *   Requisitos: cuenta con email verificado, no ser el autor, publicación aprobada. El texto pasa por
 *   las mismas reglas de moderación que los comentarios.
 *
 * Colecciones (listas públicas de publicaciones propias, con portada):
 *   GET    /colecciones/usuario/:usuario   las de un creador
 *   GET    /colecciones/:id                una colección con sus publicaciones (en su orden)
 *   GET    /items/:id/colecciones          en qué colecciones está una publicación
 *   POST   /colecciones                    { titulo, descripcion, items[], portadaId }
 *   PUT    /colecciones/:id                igual (reemplaza; el orden de items es el orden de la lista)
 *   POST   /colecciones/:id/items          { itemId, quitar }
 *   DELETE /colecciones/:id
 */
'use strict';

const mongoose = require('mongoose');

const MAX_COLECCIONES = 30, MAX_ITEMS = 100;
const esId = s => /^[a-f\d]{24}$/i.test(String(s || ''));
const limpio = (s, max) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const ResenaSchema = new mongoose.Schema({
    itemId:    { type: String, required: true, index: true },
    autorItem: { type: String, default: '' },
    usuario:   { type: String, required: true },
    estrellas: { type: Number, required: true, min: 1, max: 5 },
    funciono:  { type: Boolean, default: null },
    texto:     { type: String, default: '', maxlength: 500 },
    fecha:     { type: Date, default: Date.now },
    editada:   { type: Date, default: null },
}, { collection: 'resenas' });
ResenaSchema.index({ itemId: 1, usuario: 1 }, { unique: true });
ResenaSchema.index({ itemId: 1, fecha: -1 });
const Resena = mongoose.models.Resena || mongoose.model('Resena', ResenaSchema);

const ColeccionSchema = new mongoose.Schema({
    usuario:     { type: String, required: true, index: true },
    titulo:      { type: String, required: true, maxlength: 60 },
    descripcion: { type: String, default: '', maxlength: 300 },
    items:       { type: [String], default: [] },
    portadaId:   { type: String, default: '' },
    creada:      { type: Date, default: Date.now },
    actualizada: { type: Date, default: Date.now },
}, { collection: 'colecciones' });
ColeccionSchema.index({ items: 1 });
const Coleccion = mongoose.models.Coleccion || mongoose.model('Coleccion', ColeccionSchema);

function registrar(app, deps) {
    const { verificarToken, verificarAdmin, usuarioOpcional, Usuario, Juego, Moderacion, Limites, crearNotif, logger } = deps;
    const ok = (res, d) => res.json({ success: true, ...d });
    const err = (res, code, error) => res.status(code).json({ success: false, error });
    const publica = { status: 'aprobado', visibility: { $ne: 'private' } };

    // ── Reseñas ────────────────────────────────────────────────────────────
    async function resumen(itemId) {
        const [a] = await Resena.aggregate([{ $match: { itemId } }, { $group: { _id: null, n: { $sum: 1 }, suma: { $sum: '$estrellas' },
            e1: { $sum: { $cond: [{ $eq: ['$estrellas', 1] }, 1, 0] } }, e2: { $sum: { $cond: [{ $eq: ['$estrellas', 2] }, 1, 0] } },
            e3: { $sum: { $cond: [{ $eq: ['$estrellas', 3] }, 1, 0] } }, e4: { $sum: { $cond: [{ $eq: ['$estrellas', 4] }, 1, 0] } },
            e5: { $sum: { $cond: [{ $eq: ['$estrellas', 5] }, 1, 0] } },
            si: { $sum: { $cond: [{ $eq: ['$funciono', true] }, 1, 0] } }, no: { $sum: { $cond: [{ $eq: ['$funciono', false] }, 1, 0] } } } }]);
        return a ? { n: a.n, promedio: Math.round(a.suma / a.n * 10) / 10, dist: [a.e1, a.e2, a.e3, a.e4, a.e5], si: a.si, no: a.no } : { n: 0, promedio: 0, dist: [0, 0, 0, 0, 0], si: 0, no: 0 };
    }
    // Lo que se guarda en la publicación para las tarjetas (no invalida el catálogo: ver CONTADORES_JUEGO)
    const guardarResumen = async (itemId, r) => Juego.updateOne({ _id: itemId }, { $set: { resenas: { n: r.n, promedio: r.promedio, si: r.si, no: r.no } } }).catch(() => {});
    const vista = x => ({ id: String(x._id), usuario: x.usuario, estrellas: x.estrellas, funciono: x.funciono, texto: x.texto, fecha: x.fecha, editada: x.editada });

    app.get('/items/:id/resenas', async (req, res) => {
        try {
            const id = req.params.id, yo = usuarioOpcional(req);
            const [r, lista, mia] = await Promise.all([resumen(id), Resena.find({ itemId: id, texto: { $ne: '' } }).sort({ fecha: -1 }).limit(30).lean(),
                yo ? Resena.findOne({ itemId: id, usuario: yo }).lean() : null]);
            ok(res, { resumen: r, resenas: lista.map(vista), mia: mia ? vista(mia) : null });
        } catch (e) { err(res, 500, 'No se pudieron cargar las reseñas'); }
    });

    app.post('/items/:id/resenas', verificarToken, async (req, res) => {
        try {
            const id = req.params.id;
            const estrellas = parseInt(req.body?.estrellas, 10);
            if (!(estrellas >= 1 && estrellas <= 5)) return err(res, 400, 'Elige de 1 a 5 estrellas');
            const f = req.body?.funciono, funciono = f === true || f === false ? f : null;
            const texto = limpio(req.body?.texto, 500);
            const [item, yo] = await Promise.all([Juego.findOne({ _id: id, ...publica }).select('usuario title image').lean(), Usuario.findOne({ usuario: req.usuario }).select('emailVerificado listaNegraAdmin').lean()]);
            if (!item) return err(res, 404, 'Publicación no disponible');
            if (item.usuario === req.usuario) return err(res, 400, 'No puedes reseñar tu propia publicación');
            if (!yo?.emailVerificado) return err(res, 403, 'Verifica tu email para dejar reseñas');
            if (yo.listaNegraAdmin) return err(res, 403, 'Tu cuenta no puede dejar reseñas');
            if (texto) {
                const m = Moderacion.reglas(texto, 'comentario');
                if (m.bloquear) {
                    Moderacion.registrar({ tipo: 'comentario', usuario: req.usuario, categoria: m.categoria, motivo: m.motivo, fuente: 'reglas', texto, ref: id, accion: 'bloqueado-antes' });
                    return err(res, 400, `Tu reseña no se publicó porque ${Moderacion.MENSAJE[m.categoria] || 'incumple las normas'}. Escríbela de otra forma.`);
                }
            }
            if (!(await Limites.permitir(`resena:${req.usuario}`, [[Limites.HORA || 3600e3, 20]]))) return err(res, 429, 'Vas muy rápido. Espera un rato para dejar más reseñas.');
            const antes = await Resena.findOne({ itemId: id, usuario: req.usuario }).select('_id funciono').lean();
            const r = await Resena.findOneAndUpdate({ itemId: id, usuario: req.usuario },
                { $set: { estrellas, funciono, texto, autorItem: item.usuario, ...(antes ? { editada: new Date() } : {}) }, $setOnInsert: { fecha: new Date() } },
                { upsert: true, new: true }).lean();
            const sum = await resumen(id); await guardarResumen(id, sum);
            res.status(antes ? 200 : 201).json({ success: true, resena: vista(r), resumen: sum, editada: !!antes });
            if (!antes) crearNotif({ destinatario: item.usuario, tipo: 'sistema', emisor: req.usuario, itemId: id, itemTitle: item.title, itemImage: item.image || '',
                mensaje: `${'★'.repeat(estrellas)}${'☆'.repeat(5 - estrellas)} @${req.usuario} reseñó "${String(item.title).slice(0, 60)}"${funciono === false ? ' · dice que NO le funcionó' : ''}` });
            // Muchos "no funcionó": aviso al creador una vez al cruzar el umbral (5 votos y más de la mitad)
            if (funciono === false && antes?.funciono !== false && sum.no >= 5 && sum.no > sum.si && sum.no === Math.max(5, sum.si + 1))
                crearNotif({ destinatario: item.usuario, tipo: 'sistema', emisor: 'UpGames', itemId: id, itemTitle: item.title, mensaje: `⚠️ Varias personas dicen que "${String(item.title).slice(0, 60)}" no les funcionó. Revisa el enlace o la descripción.` });
        } catch (e) {
            if (e.code === 11000) return err(res, 409, 'Ya dejaste una reseña: inténtalo otra vez para editarla');
            logger.error(`[resenas] ${e.message}`); err(res, 500, 'No se pudo guardar tu reseña');
        }
    });

    app.delete('/items/:id/resenas', verificarToken, async (req, res) => {
        try {
            const d = await Resena.deleteOne({ itemId: req.params.id, usuario: req.usuario });
            if (!d.deletedCount) return err(res, 404, 'No tienes reseña aquí');
            const sum = await resumen(req.params.id); await guardarResumen(req.params.id, sum);
            ok(res, { resumen: sum });
        } catch (e) { err(res, 500, 'No se pudo borrar'); }
    });

    app.delete('/admin/resenas/:id', verificarAdmin, async (req, res) => {
        try {
            const r = await Resena.findByIdAndDelete(req.params.id).lean();
            if (!r) return err(res, 404, 'No existe');
            await guardarResumen(r.itemId, await resumen(r.itemId));
            ok(res, {});
        } catch (e) { err(res, 500, 'No se pudo borrar'); }
    });

    // ── Colecciones ────────────────────────────────────────────────────────
    // Portada: la imagen de la publicación elegida (o la primera); nunca una URL suelta
    async function armar(cols, conItems = false) {
        const ids = [...new Set(cols.flatMap(c => conItems ? c.items : [c.portadaId || c.items[0]]).filter(esId))];
        const items = ids.length ? await Juego.find({ _id: { $in: ids }, ...publica }).select('title image category usuario descargasEfectivas likesCount resenas serie createdAt').lean() : [];
        const porId = new Map(items.map(i => [String(i._id), i]));
        return cols.map(c => {
            const vivos = c.items.filter(id => !conItems || porId.has(id));
            const port = porId.get(c.portadaId) || porId.get(c.items.find(id => porId.has(id)));
            return { id: String(c._id), usuario: c.usuario, titulo: c.titulo, descripcion: c.descripcion, total: conItems ? vivos.length : c.items.length,
                portada: port?.image || '', portadaId: port ? String(port._id) : '', actualizada: c.actualizada,
                ...(conItems ? { items: vivos.map(id => { const i = porId.get(id); return { _id: id, title: i.title, image: i.image, category: i.category, usuario: i.usuario, descargasEfectivas: i.descargasEfectivas || 0, likesCount: i.likesCount || 0, resenas: i.resenas || null }; }) } : {}) };
        });
    }
    // Valida título/descripción/items de una colección propia
    async function datos(req) {
        const titulo = limpio(req.body?.titulo, 60), descripcion = limpio(req.body?.descripcion, 300);
        if (titulo.length < 2) return { error: 'Ponle un nombre a la colección (2 a 60 letras)' };
        for (const t of [titulo, descripcion]) if (t && Moderacion.reglas(t, 'comentario').bloquear) return { error: 'El nombre o la descripción incumplen las normas' };
        const pedidos = [...new Set((Array.isArray(req.body?.items) ? req.body.items : []).map(String).filter(esId))];
        if (pedidos.length > MAX_ITEMS) return { error: `Máximo ${MAX_ITEMS} publicaciones por colección` };
        const mias = pedidos.length ? new Set((await Juego.find({ _id: { $in: pedidos }, usuario: req.usuario }).select('_id').lean()).map(i => String(i._id))) : new Set();
        if (pedidos.some(id => !mias.has(id))) return { error: 'Solo puedes agregar tus propias publicaciones' };
        const portadaId = esId(req.body?.portadaId) && mias.has(String(req.body.portadaId)) ? String(req.body.portadaId) : '';
        return { titulo, descripcion, items: pedidos, portadaId };
    }
    const mia = (id, u) => Coleccion.findOne({ _id: id, usuario: u });

    app.get('/colecciones/usuario/:usuario', async (req, res) => {
        try {
            const u = String(req.params.usuario || '').toLowerCase().slice(0, 30);
            const cols = await Coleccion.find({ usuario: u }).sort({ actualizada: -1 }).limit(MAX_COLECCIONES).lean();
            ok(res, { colecciones: await armar(cols) });
        } catch (e) { err(res, 500, 'No se pudieron cargar las colecciones'); }
    });
    app.get('/colecciones/:id', async (req, res) => {
        try {
            const c = await Coleccion.findById(req.params.id).lean();
            if (!c) return err(res, 404, 'Esa colección ya no existe');
            ok(res, { coleccion: (await armar([c], true))[0] });
        } catch (e) { err(res, 500, 'No se pudo cargar la colección'); }
    });
    app.get('/items/:id/colecciones', async (req, res) => {
        try {
            const cols = await Coleccion.find({ items: req.params.id }).select('titulo usuario items').limit(5).lean();
            ok(res, { colecciones: cols.map(c => ({ id: String(c._id), titulo: c.titulo, usuario: c.usuario, total: c.items.length })) });
        } catch (e) { err(res, 500, 'Error'); }
    });

    app.post('/colecciones', verificarToken, async (req, res) => {
        try {
            if (await Coleccion.countDocuments({ usuario: req.usuario }) >= MAX_COLECCIONES) return err(res, 409, `Puedes tener hasta ${MAX_COLECCIONES} colecciones`);
            if (!(await Limites.permitir(`colec:${req.usuario}`, [[Limites.HORA || 3600e3, 20]]))) return err(res, 429, 'Espera un rato antes de crear más colecciones');
            const d = await datos(req); if (d.error) return err(res, 400, d.error);
            const c = await Coleccion.create({ usuario: req.usuario, ...d });
            res.status(201).json({ success: true, coleccion: (await armar([c.toObject()], true))[0] });
        } catch (e) { logger.error(`[colecciones] ${e.message}`); err(res, 500, 'No se pudo crear la colección'); }
    });
    app.put('/colecciones/:id', verificarToken, async (req, res) => {
        try {
            const c = await mia(req.params.id, req.usuario); if (!c) return err(res, 404, 'No es tu colección');
            const d = await datos(req); if (d.error) return err(res, 400, d.error);
            Object.assign(c, d, { actualizada: new Date() }); await c.save();
            ok(res, { coleccion: (await armar([c.toObject()], true))[0] });
        } catch (e) { err(res, 500, 'No se pudo guardar'); }
    });
    app.post('/colecciones/:id/items', verificarToken, async (req, res) => {
        try {
            const itemId = String(req.body?.itemId || ''); if (!esId(itemId)) return err(res, 400, 'Publicación no válida');
            if (!(await Juego.exists({ _id: itemId, usuario: req.usuario }))) return err(res, 403, 'Solo puedes agregar tus propias publicaciones');
            const quitar = !!req.body?.quitar;
            const c = await Coleccion.findOneAndUpdate(
                { _id: req.params.id, usuario: req.usuario, ...(quitar ? {} : { [`items.${MAX_ITEMS - 1}`]: { $exists: false } }) },
                quitar ? { $pull: { items: itemId }, $set: { actualizada: new Date() } } : { $addToSet: { items: itemId }, $set: { actualizada: new Date() } }, { new: true }).lean();
            if (!c) return err(res, (await Coleccion.exists({ _id: req.params.id, usuario: req.usuario })) ? 409 : 404, quitar ? 'No es tu colección' : `La colección ya tiene ${MAX_ITEMS} publicaciones (o no es tuya)`);
            ok(res, { total: c.items.length, dentro: c.items.includes(itemId) });
        } catch (e) { err(res, 500, 'No se pudo actualizar'); }
    });
    app.delete('/colecciones/:id', verificarToken, async (req, res) => {
        try {
            const d = await Coleccion.deleteOne({ _id: req.params.id, usuario: req.usuario });
            if (!d.deletedCount) return err(res, 404, 'No es tu colección');
            ok(res, {});
        } catch (e) { err(res, 500, 'No se pudo borrar'); }
    });

    return { Resena, Coleccion };
}

module.exports = { registrar, Resena, Coleccion };
