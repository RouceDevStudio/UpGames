/**
 * ══════════════════════════════════════════════════════════════════
 *  nexus/herramientas.js — Lo que Nexus puede consultar y hacer
 *
 *  Cada herramienta lee la base de datos de UpGames directamente (mismo
 *  servidor). Nunca devuelve enlaces de descarga ni datos privados de
 *  otros usuarios: solo lo que la propia app ya muestra en público, más
 *  la cuenta del usuario que pregunta (si ha iniciado sesión).
 *
 *  Además de leer, Nexus puede PROPONER acciones de interfaz (abrir un
 *  contenido, filtrar una categoría, ir a una pestaña…): se devuelven al
 *  cliente como botones que el usuario toca; nada se ejecuta solo.
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const CATEGORIAS = ['Juego', 'ROM', 'Mod', 'Apps', 'Software', 'Ajustes', 'Optimizacion', 'Video'];
const PESTANAS = { inicio: 'main', favoritos: 'favs', economia: 'economia', perfil: 'profile' };
const VISIBLE = { status: 'aprobado', linkStatus: { $in: ['online', 'revision'] } };
const esId = s => /^[a-f\d]{24}$/i.test(String(s || ''));
const corta = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const escRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ficha pública y ligera de un contenido (sin enlace). */
function lite(j) {
    if (!j) return null;
    return {
        id: String(j._id), titulo: corta(j.serie?.base && j.serieInfo ? j.serie.base : j.title, 120),
        categoria: j.category || 'General', autor: j.usuario,
        descargas: j.serieInfo?.descargas ?? j.descargasEfectivas ?? 0, likes: j.likesCount || 0,
        imagen: /^https:\/\//i.test(j.image || '') ? j.image : '',
        resumen: corta(j.description, 160), tags: (j.tags || []).slice(0, 6),
        partes: j.serieInfo?.partes || (j.serie?.total || null),
        fecha: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : null,
    };
}

// ── Base de conocimiento de UpGames (reglas reales de la plataforma) ──
function conocimiento({ config, LINKS_PERMITIDOS }) {
    return {
        economia: `Cada descarga válida de tu contenido suma dinero a tu saldo: ${config.CPM_VALUE} USD por cada 1.000 descargas (CPM) y el ${Math.round(config.AUTHOR_PERCENTAGE * 100)}% es para el creador. Una misma IP cuenta como máximo ${config.MAX_DOWNLOADS_PER_IP_PER_DAY} descargas al día por publicación; con bloqueador de anuncios la descarga no cuenta. Hay un detector de fraude: descargas infladas se revierten y la cuenta puede quedar en revisión.`,
        retiros: `Para retirar necesitas: saldo mínimo de ${config.MIN_WITHDRAWAL} USD, estar verificado (nivel 1 o más, lo concede el equipo de UpGames), un correo de PayPal guardado en la pestaña Economía, al menos una publicación con descargas y no tener otra solicitud pendiente. El pago se envía por PayPal tras revisarlo el equipo.`,
        publicar: `Para publicar ve a Perfil → Publicar. Necesitas título, categoría (${CATEGORIAS.join(', ')}), portada y un enlace de descarga de una plataforma permitida: ${LINKS_PERMITIDOS.join(', ')}. Sin acortadores ni enlaces directos a .exe/.msi (usa .zip o .rar). Todo pasa por revisión del equipo antes de salir en el inicio. Antes de enviarla, Nexus revisa la publicación (enlace vivo, portada, descripción, duplicados). Si subes un mod por partes (Parte 1, Parte 2…), UpGames las agrupa en una sola tarjeta y se desbloquean en orden.`,
        normas: 'No se permite piratería de juegos comerciales (cracks, keygens, repacks de juegos de pago), malware, enlaces rotos, spam, ni contenido engañoso. Las publicaciones rechazadas muestran el motivo en tu perfil para que las corrijas.',
        verificacion: 'La verificación (insignia) la otorga el equipo de UpGames a creadores activos y confiables. Niveles 1 a 3. Nivel 1 es necesario para retirar ganancias.',
        cuenta: 'Puedes cambiar avatar, portada, bio y redes desde tu perfil. El nombre de usuario se puede cambiar con un tiempo de espera entre cambios. Las notificaciones push al móvil se activan desde la campana de notificaciones → Ajustes.',
        descargar: 'Toca una tarjeta para ver el detalle y pulsa Descargar: pasarás por la página puente, que valida la descarga y abre el enlace. Si un enlace no funciona, usa Reportar en el detalle.',
    };
}

/** Definiciones para el modelo (formato OpenAI/Groq). */
const DEFINICIONES = [
    { type: 'function', function: { name: 'buscar_contenido', description: 'Busca en el catálogo REAL de UpGames (juegos, mods, ROMs, apps, software, videos). Úsala siempre que el usuario pida algo concreto o recomendaciones de un tema.', parameters: { type: 'object', properties: {
        consulta: { type: 'string', description: 'Palabras clave (p. ej. "minecraft texturas", "terror")' },
        categoria: { type: 'string', enum: CATEGORIAS },
        orden: { type: 'string', enum: ['relevancia', 'descargas', 'reciente', 'likes'] },
        limite: { type: 'integer', minimum: 1, maximum: 10 } } } } },
    { type: 'function', function: { name: 'ver_contenido', description: 'Detalles de un contenido por su id (descripción, autor, partes de la serie, estadísticas).', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
    { type: 'function', function: { name: 'tendencias', description: 'Lo más popular o lo más nuevo ahora mismo, opcionalmente de una categoría.', parameters: { type: 'object', properties: {
        tipo: { type: 'string', enum: ['popular', 'nuevo'] }, categoria: { type: 'string', enum: CATEGORIAS }, limite: { type: 'integer', minimum: 1, maximum: 10 } } } } },
    { type: 'function', function: { name: 'recomendar_para_mi', description: 'Recomendaciones personalizadas según los gustos del usuario (favoritos, creadores que sigue, lo que mira).', parameters: { type: 'object', properties: { categoria: { type: 'string', enum: CATEGORIAS }, limite: { type: 'integer', minimum: 1, maximum: 10 } } } } },
    { type: 'function', function: { name: 'mi_cuenta', description: 'Saldo, descargas, verificación, si puede retirar y qué le falta, seguidores y estado de sus publicaciones. Solo para el usuario que pregunta.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'mis_publicaciones', description: 'Lista las publicaciones del usuario con su estado (aprobada, pendiente, rechazada y motivo), descargas y likes.', parameters: { type: 'object', properties: { estado: { type: 'string', enum: ['todas', 'aprobado', 'pendiente', 'rechazado'] } } } } },
    { type: 'function', function: { name: 'perfil_creador', description: 'Perfil público de un creador de UpGames: bio, seguidores, verificación y sus publicaciones más descargadas.', parameters: { type: 'object', properties: { usuario: { type: 'string' } }, required: ['usuario'] } } },
    { type: 'function', function: { name: 'reglas_upgames', description: 'Reglas oficiales de UpGames. Úsala antes de responder sobre dinero, retiros, cómo publicar, normas, verificación, cuenta o cómo descargar.', parameters: { type: 'object', properties: { tema: { type: 'string', enum: ['economia', 'retiros', 'publicar', 'normas', 'verificacion', 'cuenta', 'descargar'] } }, required: ['tema'] } } },
    { type: 'function', function: { name: 'mostrar_contenido', description: 'Muestra al usuario tarjetas tocables de los contenidos que recomiendas (ids obtenidos de otras herramientas). Llámala cuando recomiendes o menciones contenidos concretos.', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, maxItems: 6 } }, required: ['ids'] } } },
    { type: 'function', function: { name: 'proponer_accion', description: 'Propone un botón de acción en la app: filtrar el inicio por categoría, ir a una pestaña, o buscar un texto en el inicio.', parameters: { type: 'object', properties: {
        tipo: { type: 'string', enum: ['filtrar_categoria', 'ir_a', 'buscar'] },
        valor: { type: 'string', description: 'Categoría (Juego, Mod…), pestaña (inicio, favoritos, economia, perfil) o texto a buscar' },
        etiqueta: { type: 'string', description: 'Texto corto del botón' } }, required: ['tipo', 'valor'] } } },
];

/**
 * Crea los ejecutores ligados a un usuario concreto.
 * deps: { Juego, Usuario, Favorito, search, recommendations, series, config, LINKS_PERMITIDOS }
 * ctx:  { usuario|null, salida: { items: Map, acciones: [] } }
 */
function crear(deps, ctx) {
    const { Juego, Usuario, search, recommendations, series } = deps;
    const vistos = ctx.vistos || new Map();      // id → lite (todo lo que el modelo ha visto)
    const ver = arr => arr.filter(Boolean).map(x => { const l = lite(x); vistos.set(l.id, l); return l; });
    const sinSesion = { error: 'El usuario no ha iniciado sesión. Pídele que inicie sesión para ver su cuenta.' };
    const colapsar = async items => (series ? series.colapsar(items, Juego, VISIBLE).catch(() => items) : items);

    const ejecutores = {
        async buscar_contenido({ consulta = '', categoria, orden = 'relevancia', limite = 6 }) {
            limite = Math.min(Math.max(+limite || 6, 1), 10);
            if (categoria && !CATEGORIAS.includes(categoria)) categoria = undefined;
            const r = await search.buscar({ q: String(consulta).slice(0, 80), categoria: categoria || null, orden: ['relevancia', 'descargas', 'reciente', 'likes'].includes(orden) ? orden : 'relevancia', limit: limite * 2 });
            const items = (await colapsar(r.items || [])).slice(0, limite);
            return { total: r.total || 0, resultados: ver(items) };
        },
        async ver_contenido({ id }) {
            if (!esId(id)) return { error: 'id inválido' };
            const j = await Juego.findOne({ _id: id, ...VISIBLE }).select('-link -analisisIA -nexusMentor -motivoRechazo').lean();
            if (!j) return { error: 'No existe o no está publicado' };
            const l = ver([j])[0];
            let partes = null;
            if (j.serie?.clave) partes = (await Juego.find({ 'serie.clave': j.serie.clave, ...VISIBLE }).sort({ 'serie.parte': 1 }).select('title serie.parte descargasEfectivas').lean())
                .map(p => ({ id: String(p._id), parte: p.serie?.parte, titulo: p.title }));
            return { ...l, descripcion: corta(j.description, 700), partes_serie: partes };
        },
        async tendencias({ tipo = 'popular', categoria, limite = 6 }) {
            limite = Math.min(Math.max(+limite || 6, 1), 10);
            const filtro = { ...VISIBLE, category: categoria && CATEGORIAS.includes(categoria) ? categoria : { $ne: 'Video' } };
            let items;
            if (tipo === 'nuevo') items = await Juego.find(filtro).sort({ createdAt: -1 }).limit(limite * 2).select('-link').lean();
            else if (!categoria && recommendations) items = await recommendations.getTrending(limite * 2).catch(() => null);
            if (!items?.length) items = await Juego.find(filtro).sort({ descargasEfectivas: -1, likesCount: -1 }).limit(limite * 2).select('-link').lean();
            return { tipo, resultados: ver((await colapsar(items)).slice(0, limite)) };
        },
        async recomendar_para_mi({ categoria, limite = 6 }) {
            limite = Math.min(Math.max(+limite || 6, 1), 10);
            let items = [];
            if (ctx.usuario && recommendations) items = await recommendations.getPersonalizedFor(ctx.usuario, 30).catch(() => []);
            // Gustos aprendidos por Nexus (lo que el usuario mira, busca y descarga)
            const gustos = ctx.gustos?.categorias?.slice(0, 3).map(c => c.nombre) || [];
            if (categoria && CATEGORIAS.includes(categoria)) items = items.filter(i => i.category === categoria);
            if (items.length < limite) {
                const cats = categoria ? [categoria] : gustos;
                const extra = await Juego.find({ ...VISIBLE, ...(cats.length ? { category: { $in: cats } } : { category: { $ne: 'Video' } }), usuario: { $ne: ctx.usuario || '' } })
                    .sort({ scoreRecomendacion: -1, descargasEfectivas: -1 }).limit(limite * 2).select('-link').lean();
                const ya = new Set(items.map(i => String(i._id)));
                items = items.concat(extra.filter(e => !ya.has(String(e._id))));
            }
            const recientes = new Set(ctx.gustos?.recientes || []);
            items = items.filter(i => !recientes.has(String(i._id))).concat(items.filter(i => recientes.has(String(i._id))));
            return { personalizado: !!ctx.usuario, basado_en: gustos, resultados: ver((await colapsar(items)).slice(0, limite)) };
        },
        async mi_cuenta() {
            if (!ctx.usuario) return sinSesion;
            const u = await Usuario.findOne({ usuario: ctx.usuario }).select('usuario saldo descargasTotales isVerificado verificadoNivel paypalEmail solicitudPagoPendiente listaSeguidores siguiendo fecha listaNegraAdmin').lean();
            if (!u) return { error: 'Cuenta no encontrada' };
            const [porEstado, conDescargas] = await Promise.all([
                Juego.aggregate([{ $match: { usuario: ctx.usuario } }, { $group: { _id: '$status', n: { $sum: 1 }, d: { $sum: '$descargasEfectivas' } } }]),
                Juego.countDocuments({ usuario: ctx.usuario, descargasEfectivas: { $gt: 0 } }),
            ]);
            const min = deps.config.MIN_WITHDRAWAL;
            const falta = [];
            if ((u.saldo || 0) < min) falta.push(`llegar a ${min} USD (faltan ${(min - (u.saldo || 0)).toFixed(2)} USD, unas ${Math.ceil((min - (u.saldo || 0)) / (deps.config.CPM_VALUE * deps.config.AUTHOR_PERCENTAGE / 1000)).toLocaleString('es')} descargas)`);
            if (!u.isVerificado || (u.verificadoNivel || 0) < 1) falta.push('estar verificado (nivel 1)');
            if (!u.paypalEmail) falta.push('guardar tu correo de PayPal en Economía');
            if (!conDescargas) falta.push('tener al menos una publicación con descargas');
            if (u.solicitudPagoPendiente) falta.push('esperar a que se procese la solicitud pendiente');
            const est = Object.fromEntries(porEstado.map(e => [e._id, { publicaciones: e.n, descargas: e.d }]));
            return {
                usuario: u.usuario, saldo_usd: +(u.saldo || 0).toFixed(4), descargas_totales: u.descargasTotales || 0,
                verificado: !!u.isVerificado, nivel_verificacion: u.verificadoNivel || 0, paypal_configurado: !!u.paypalEmail,
                puede_retirar: !falta.length, le_falta: falta, seguidores: (u.listaSeguidores || []).length, siguiendo: (u.siguiendo || []).length,
                miembro_desde: u.fecha ? new Date(u.fecha).toISOString().slice(0, 10) : null,
                en_revision: !!u.listaNegraAdmin, publicaciones: est,
            };
        },
        async mis_publicaciones({ estado = 'todas' }) {
            if (!ctx.usuario) return sinSesion;
            const f = { usuario: ctx.usuario };
            if (estado === 'pendiente') f.status = { $in: ['pendiente', 'pending'] };
            else if (['aprobado', 'rechazado'].includes(estado)) f.status = estado;
            const items = await Juego.find(f).sort({ createdAt: -1 }).limit(15).select('title category status linkStatus descargasEfectivas likesCount motivoRechazo reportes createdAt nexusMentor.puntuacion').lean();
            return { publicaciones: items.map(i => ({ id: String(i._id), titulo: i.title, categoria: i.category, estado: i.status, enlace: i.linkStatus, descargas: i.descargasEfectivas || 0, likes: i.likesCount || 0, reportes: i.reportes || 0, motivo_rechazo: i.status === 'rechazado' ? (i.motivoRechazo || 'Sin motivo indicado') : undefined, puntuacion_nexus: i.nexusMentor?.puntuacion })) };
        },
        async perfil_creador({ usuario }) {
            const nombre = String(usuario || '').replace(/^@/, '').trim().toLowerCase().slice(0, 20);
            if (!nombre) return { error: 'usuario requerido' };
            const u = await Usuario.findOne({ usuario: nombre }).select('usuario bio verificadoNivel listaSeguidores fecha suspendido').lean()
                || await Usuario.findOne({ usuario: new RegExp('^' + escRegex(nombre)) }).select('usuario bio verificadoNivel listaSeguidores fecha suspendido').lean();
            if (!u || u.suspendido) return { error: 'No encontré ese creador' };
            const top = await Juego.find({ usuario: u.usuario, ...VISIBLE }).sort({ descargasEfectivas: -1 }).limit(8).select('-link').lean();
            const total = await Juego.countDocuments({ usuario: u.usuario, ...VISIBLE });
            return { usuario: u.usuario, bio: corta(u.bio, 200), verificado_nivel: u.verificadoNivel || 0, seguidores: (u.listaSeguidores || []).length, publicaciones: total, top: ver((await colapsar(top)).slice(0, 5)) };
        },
        async reglas_upgames({ tema }) {
            const k = conocimiento(deps);
            return { tema, texto: k[tema] || Object.values(k).join('\n') };
        },
        async mostrar_contenido({ ids = [] }) {
            const lista = (Array.isArray(ids) ? ids : []).map(String).filter(esId).slice(0, 6);
            const faltan = lista.filter(id => !vistos.has(id));
            if (faltan.length) ver(await Juego.find({ _id: { $in: faltan }, ...VISIBLE }).select('-link').lean());
            lista.forEach(id => { if (vistos.has(id)) ctx.salida.items.set(id, vistos.get(id)); });
            return { mostrados: [...ctx.salida.items.keys()].length };
        },
        async proponer_accion({ tipo, valor, etiqueta }) {
            valor = String(valor || '').trim();
            let a = null;
            if (tipo === 'filtrar_categoria') { const c = CATEGORIAS.find(x => x.toLowerCase() === valor.toLowerCase()); if (c) a = { tipo, valor: c }; }
            else if (tipo === 'ir_a') { const t = PESTANAS[valor.toLowerCase()] || Object.values(PESTANAS).find(x => x === valor); if (t) a = { tipo, valor: t }; }
            else if (tipo === 'buscar' && valor) a = { tipo, valor: valor.slice(0, 60) };
            if (!a) return { error: 'acción no válida' };
            a.etiqueta = corta(etiqueta || (tipo === 'buscar' ? `Buscar "${a.valor}"` : a.valor), 40);
            if (ctx.salida.acciones.length < 3 && !ctx.salida.acciones.some(x => x.tipo === a.tipo && x.valor === a.valor)) ctx.salida.acciones.push(a);
            return { ok: true };
        },
    };
    return { ejecutores, vistos };
}

module.exports = { DEFINICIONES, CATEGORIAS, crear, lite, conocimiento, VISIBLE };
