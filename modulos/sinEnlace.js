/**
 * El enlace de descarga de una publicación solo se entrega en la página puente
 * (POST /economia/validar-descarga, que cuenta la descarga y paga al creador) o con
 * acceso directo/Premium. Antes viajaba en los listados públicos (catálogo, perfil,
 * búsqueda, recomendaciones), y cualquiera podía saltarse la espera, los anuncios y
 * el conteo leyendo el JSON.
 *
 * Este middleware quita `link` de toda publicación (que no sea Video: en los videos el
 * enlace ES el video) en las respuestas GET públicas. El autor sigue viendo sus enlaces
 * en GET /items/user/<él mismo> y los admins en /admin/*.
 */
'use strict';

const esPublicacion = o => o && typeof o === 'object' && !Array.isArray(o) && 'link' in o && o.category !== 'Video'
    && ('title' in o || 'titulo' in o) && ('_id' in o || 'id' in o);

function limpiar(x, prof = 0) {
    if (prof > 5 || !x || typeof x !== 'object') return x;
    if (Array.isArray(x)) return x.map(v => limpiar(v, prof + 1));
    if (x instanceof Date || (x.constructor && x.constructor.name === 'ObjectId')) return x;
    if (typeof x.toJSON === 'function' && !(x.constructor === Object)) x = x.toJSON();
    const out = {};
    const quitar = esPublicacion(x);
    for (const [k, v] of Object.entries(x)) {
        if (quitar && k === 'link') continue;
        out[k] = (v && typeof v === 'object') ? limpiar(v, prof + 1) : v;
    }
    return out;
}

/**
 * @param {object} o { usuarioOpcional(req) → nombre | null }
 */
function middleware({ usuarioOpcional }) {
    return (req, res, next) => {
        if (req.method !== 'GET' || /^\/admin\b/.test(req.path) || /^\/acceso-directo\b/.test(req.path)) return next();
        // El autor viendo su propio perfil necesita sus enlaces (editar publicación)
        const m = req.path.match(/^\/items\/user\/([^/]+)$/);
        if (m) { const yo = usuarioOpcional(req); if (yo && yo === decodeURIComponent(m[1]).toLowerCase()) return next(); }
        const json = res.json.bind(res);
        res.json = cuerpo => json(limpiar(cuerpo));
        next();
    };
}

module.exports = { middleware, limpiar };
