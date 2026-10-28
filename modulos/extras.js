/**
 * Usos extra de los UpCoins: configuración editable desde el panel admin.
 *
 *   Estilo del perfil ... marcos de avatar, color del nombre, fondo, insignias y diseño de tarjeta (cosméticos)
 *   Super Chat .......... mensaje destacado y fijado en un live (el creador recibe 25 %)
 *   Apoyar .............. propina a una publicación (el creador recibe 25 %)
 *   Revisión prioritaria  la publicación pasa al frente de la cola; si no se revisa en 24 h se devuelve
 *   Regalar Premium ..... pagar con UpCoins el Premium de otra persona
 *   Cambio de nombre .... sin esperar los 30 días
 *   Misiones semanales .. dan UpCoins de regalo (no retirables) o insignias
 *
 * La configuración vive en un solo documento (config_extras/_id: 'extras'). Lo que no
 * esté guardado toma el valor por defecto de aquí, así que agregar algo nuevo no rompe nada.
 */
'use strict';

const mongoose = require('mongoose');

const COSMETICOS = [
    // Marcos del avatar (animados con CSS). Precios de octubre 2026: lo ya comprado se conserva.
    { id: 'marco_neon', tipo: 'marco', nombre: 'Neón', emoji: '💚', precio: 100 },
    { id: 'marco_hielo', tipo: 'marco', nombre: 'Hielo', emoji: '❄️', precio: 150 },
    { id: 'marco_fuego', tipo: 'marco', nombre: 'Fuego', emoji: '🔥', precio: 150 },
    { id: 'marco_rayo', tipo: 'marco', nombre: 'Eléctrico', emoji: '⚡', precio: 180 },
    { id: 'marco_toxico', tipo: 'marco', nombre: 'Tóxico', emoji: '☢️', precio: 180 },
    { id: 'marco_oro', tipo: 'marco', nombre: 'Oro', emoji: '👑', precio: 200 },
    { id: 'marco_arcoiris', tipo: 'marco', nombre: 'Arcoíris', emoji: '🌈', precio: 250 },
    { id: 'marco_glitch', tipo: 'marco', nombre: 'Glitch', emoji: '👾', precio: 280 },
    { id: 'marco_dragon', tipo: 'marco', nombre: 'Dragón', emoji: '🐉', precio: 350 },
    { id: 'marco_galaxia', tipo: 'marco', nombre: 'Galaxia', emoji: '🌌', precio: 400 },
    { id: 'marco_diamante', tipo: 'marco', nombre: 'Diamante', emoji: '💎', precio: 600 },
    // Color del nombre (perfil, publicaciones, comentarios y chat de los lives)
    { id: 'color_cian', tipo: 'color', nombre: 'Cian', emoji: '🩵', precio: 70 },
    { id: 'color_rosa', tipo: 'color', nombre: 'Rosa', emoji: '🩷', precio: 70 },
    { id: 'color_verde', tipo: 'color', nombre: 'Verde neón', emoji: '💚', precio: 70 },
    { id: 'color_oro', tipo: 'color', nombre: 'Dorado', emoji: '💛', precio: 100 },
    { id: 'color_plata', tipo: 'color', nombre: 'Plata', emoji: '🤍', precio: 120 },
    { id: 'color_hielo', tipo: 'color', nombre: 'Hielo', emoji: '🧊', precio: 140 },
    { id: 'color_fuego', tipo: 'color', nombre: 'Fuego', emoji: '🔥', precio: 180 },
    { id: 'color_degradado', tipo: 'color', nombre: 'Degradado vivo', emoji: '✨', precio: 200 },
    { id: 'color_arcoiris', tipo: 'color', nombre: 'Arcoíris', emoji: '🌈', precio: 260 },
    // Fondo del perfil público y de tu tarjeta de creador en las publicaciones
    { id: 'fondo_selva', tipo: 'fondo', nombre: 'Selva', emoji: '🌿', precio: 150 },
    { id: 'fondo_oceano', tipo: 'fondo', nombre: 'Océano', emoji: '🌊', precio: 150 },
    { id: 'fondo_aurora', tipo: 'fondo', nombre: 'Aurora', emoji: '🌠', precio: 160 },
    { id: 'fondo_atardecer', tipo: 'fondo', nombre: 'Atardecer', emoji: '🌇', precio: 160 },
    { id: 'fondo_ciber', tipo: 'fondo', nombre: 'Ciberpunk', emoji: '🌆', precio: 200 },
    { id: 'fondo_lava', tipo: 'fondo', nombre: 'Lava', emoji: '🌋', precio: 220 },
    { id: 'fondo_espacio', tipo: 'fondo', nombre: 'Espacio', emoji: '🪐', precio: 250 },
    { id: 'fondo_neon', tipo: 'fondo', nombre: 'Ciudad neón', emoji: '🏙️', precio: 280 },
    { id: 'fondo_matrix', tipo: 'fondo', nombre: 'Matrix', emoji: '💾', precio: 320 },
    // Insignias de colección (se muestran hasta 3 en el perfil y en tus publicaciones)
    { id: 'ins_gamer', tipo: 'insignia', nombre: 'Gamer', emoji: '🎮', precio: 80 },
    { id: 'ins_retro', tipo: 'insignia', nombre: 'Retro', emoji: '👾', precio: 80 },
    { id: 'ins_modder', tipo: 'insignia', nombre: 'Modder', emoji: '🛠️', precio: 100 },
    { id: 'ins_streamer', tipo: 'insignia', nombre: 'Streamer', emoji: '🎙️', precio: 100 },
    { id: 'ins_speedrun', tipo: 'insignia', nombre: 'Speedrunner', emoji: '⏱️', precio: 100 },
    { id: 'ins_creador', tipo: 'insignia', nombre: 'Creador', emoji: '🎨', precio: 120 },
    { id: 'ins_coleccionista', tipo: 'insignia', nombre: 'Coleccionista', emoji: '🗃️', precio: 150 },
    { id: 'ins_mvp', tipo: 'insignia', nombre: 'MVP', emoji: '🏅', precio: 220 },
    { id: 'ins_leyenda', tipo: 'insignia', nombre: 'Leyenda', emoji: '🏆', precio: 300 },
    { id: 'ins_realeza', tipo: 'insignia', nombre: 'Realeza', emoji: '👑', precio: 450 },
    // Solo se ganan (no se venden)
    { id: 'ins_mecenas', tipo: 'insignia', nombre: 'Mecenas', emoji: '🎁', precio: 0, soloMision: true },
    { id: 'ins_activo', tipo: 'insignia', nombre: 'Siempre activo', emoji: '⚡', precio: 0, soloMision: true },
    { id: 'ins_embajador', tipo: 'insignia', nombre: 'Embajador', emoji: '🤝', precio: 0, soloMision: true },   // 5 invitados verificados
    // Diseño de tarjeta: así ven los demás las publicaciones de quien lo usa (explorar, favoritos, perfil).
    // Los más caros piden verificación (verificadoNivel) y/o seguidores para comprarse; lo comprado se conserva.
    { id: 'tj_carbono', tipo: 'tarjeta', nombre: 'Fibra de carbono', emoji: '🖤', precio: 150 },
    { id: 'tj_neon', tipo: 'tarjeta', nombre: 'Neón', emoji: '💚', precio: 180 },
    { id: 'tj_sakura', tipo: 'tarjeta', nombre: 'Sakura', emoji: '🌸', precio: 200 },
    { id: 'tj_glaciar', tipo: 'tarjeta', nombre: 'Glaciar', emoji: '❄️', precio: 220 },
    { id: 'tj_toxica', tipo: 'tarjeta', nombre: 'Tóxica', emoji: '☢️', precio: 250 },
    { id: 'tj_abisal', tipo: 'tarjeta', nombre: 'Abisal', emoji: '🌊', precio: 300, req: { seguidores: 10 } },
    { id: 'tj_infierno', tipo: 'tarjeta', nombre: 'Infierno', emoji: '🔥', precio: 350, req: { seguidores: 10 } },
    { id: 'tj_matrix', tipo: 'tarjeta', nombre: 'Matrix', emoji: '💾', precio: 380, req: { seguidores: 25 } },
    { id: 'tj_ciber', tipo: 'tarjeta', nombre: 'Ciberpunk', emoji: '👾', precio: 400, req: { seguidores: 25 } },
    { id: 'tj_synth', tipo: 'tarjeta', nombre: 'Synthwave', emoji: '🌅', precio: 450, req: { verificado: 1 } },
    { id: 'tj_arcade', tipo: 'tarjeta', nombre: 'Arcade retro', emoji: '🕹️', precio: 500, req: { verificado: 1 } },
    { id: 'tj_tormenta', tipo: 'tarjeta', nombre: 'Tormenta', emoji: '⚡', precio: 550, req: { seguidores: 50 } },
    { id: 'tj_holo', tipo: 'tarjeta', nombre: 'Holográfica', emoji: '🪩', precio: 650, req: { verificado: 1, seguidores: 50 } },
    { id: 'tj_aurora', tipo: 'tarjeta', nombre: 'Aurora boreal', emoji: '🌠', precio: 750, req: { seguidores: 100 } },
    { id: 'tj_oro', tipo: 'tarjeta', nombre: 'Oro puro', emoji: '👑', precio: 900, req: { verificado: 2 } },
    { id: 'tj_galaxia', tipo: 'tarjeta', nombre: 'Galaxia', emoji: '🌌', precio: 1100, req: { verificado: 1, seguidores: 250 } },
    { id: 'tj_dragon', tipo: 'tarjeta', nombre: 'Dragón', emoji: '🐉', precio: 1400, req: { verificado: 2, seguidores: 500 } },
    { id: 'tj_diamante', tipo: 'tarjeta', nombre: 'Diamante', emoji: '💎', precio: 1700, req: { verificado: 3 } },
    { id: 'tj_fenix', tipo: 'tarjeta', nombre: 'Fénix', emoji: '🐦‍🔥', precio: 2000, req: { verificado: 3, seguidores: 250 } },
    { id: 'tj_leyenda', tipo: 'tarjeta', nombre: 'Leyenda', emoji: '🏆', precio: 2500, req: { verificado: 3, seguidores: 1000 } },
    // Exclusiva: cuentas creadas antes de FUNDADOR_HASTA. No se vende ni se gana después.
    { id: 'ins_fundador', tipo: 'insignia', nombre: 'Fundador', emoji: '🏛️', precio: 0, soloMision: true },
];

// Packs a juego: marco + color + fondo (+ insignia). Se cobran solo los artículos que te faltan, con descuento.
const PACKS = [
    { id: 'pack_hielo', nombre: 'Glaciar', emoji: '❄️', items: ['marco_hielo', 'color_hielo', 'fondo_oceano'] },
    { id: 'pack_fuego', nombre: 'Infierno', emoji: '🔥', items: ['marco_fuego', 'color_fuego', 'fondo_lava'] },
    { id: 'pack_ciber', nombre: 'Ciberpunk', emoji: '👾', items: ['marco_glitch', 'color_rosa', 'fondo_neon'] },
    { id: 'pack_matrix', nombre: 'Hacker', emoji: '💾', items: ['marco_toxico', 'color_verde', 'fondo_matrix'] },
    { id: 'pack_galaxia', nombre: 'Cósmico', emoji: '🌌', items: ['marco_galaxia', 'color_arcoiris', 'fondo_espacio'] },
    { id: 'pack_dragon', nombre: 'Dragón legendario', emoji: '🐉', items: ['marco_dragon', 'color_fuego', 'fondo_lava', 'ins_leyenda'] },
    { id: 'pack_realeza', nombre: 'Realeza', emoji: '👑', items: ['marco_diamante', 'color_oro', 'fondo_atardecer', 'ins_realeza'] },
];

// Tipos de misión que el servidor sabe contar (el admin elige objetivo y recompensa)
const TIPOS_MISION = {
    comentar: 'Comenta publicaciones distintas',
    favorito: 'Guarda publicaciones en favoritos',
    seguir: 'Sigue a creadores',
    ver_live: 'Mira lives (2 minutos o más)',
    apoyar: 'Apoya publicaciones con UpCoins',
    regalo_live: 'Envía regalos o Super Chats en lives',
};

const DEFECTO = {
    activo: { cosmeticos: true, packs: true, superchat: true, apoyar: true, prioridad: true, regalarPremium: true, nombre: true, misiones: true, referidos: true, promoLive: true },
    // refInvitador/refInvitado: UC de regalo al verificar el email · refMaxMes: invitaciones pagadas por mes
    // promoLive: paquetes para promover un live (suman al puntaje del directorio mientras dure el live)
    precios: { superchat: [20, 50, 100, 200], apoyo: [10, 50, 100], prioridad: 30, nombre: 100, refInvitador: 20, refInvitado: 10, refMaxMes: 20, promoLive: [30, 60, 150, 300], packDescuento: 25 },
    cosmeticos: {},   // { id: { precio, activo } } — cambios del admin sobre el catálogo base
    misiones: [
        { id: 'm_comentar', tipo: 'comentar', titulo: 'Comenta 5 publicaciones', objetivo: 5, uc: 5, insignia: '', activa: true },
        { id: 'm_favoritos', tipo: 'favorito', titulo: 'Guarda 3 favoritos', objetivo: 3, uc: 3, insignia: '', activa: true },
        { id: 'm_seguir', tipo: 'seguir', titulo: 'Sigue a 2 creadores', objetivo: 2, uc: 3, insignia: '', activa: true },
        { id: 'm_live', tipo: 'ver_live', titulo: 'Mira un live', objetivo: 1, uc: 5, insignia: '', activa: true },
        { id: 'm_apoyar', tipo: 'apoyar', titulo: 'Apoya una publicación', objetivo: 1, uc: 10, insignia: '', activa: true },
        { id: 'm_regalo', tipo: 'regalo_live', titulo: 'Envía un regalo en un live', objetivo: 1, uc: 0, insignia: 'ins_mecenas', activa: true },
    ],
};
// Insignia Fundador: para las cuentas creadas antes de esta fecha (hora Colombia, fin del día)
const FUNDADOR_HASTA = (() => { const d = new Date(`${process.env.FUNDADOR_HASTA || '2027-01-31'}T23:59:59-05:00`); return isNaN(d) ? new Date('2027-01-31T23:59:59-05:00') : d; })();
// Duración del Super Chat fijado según el monto (segundos)
const SUPERCHAT_SEG = m => m >= 200 ? 300 : m >= 100 ? 120 : m >= 50 ? 60 : 30;

const col = () => mongoose.connection.collection('config_extras');
let cache = null, cacheAt = 0;

/** Configuración efectiva (defectos + lo guardado), con 30 s de caché. */
async function config(forzar) {
    if (!forzar && cache && Date.now() - cacheAt < 30000) return cache;
    const g = (await col().findOne({ _id: 'extras' }).catch(() => null)) || {};
    const c = {
        activo: { ...DEFECTO.activo, ...(g.activo || {}) },
        precios: { ...DEFECTO.precios, ...(g.precios || {}) },
        cosmeticos: COSMETICOS.map(b => ({ ...b, ...(g.cosmeticos?.[b.id] || {}), activo: g.cosmeticos?.[b.id]?.activo !== false })),
        misiones: Array.isArray(g.misiones) && g.misiones.length ? g.misiones : DEFECTO.misiones,
    };
    cache = c; cacheAt = Date.now();
    return c;
}

const entero = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : null; };

/** Valida y guarda los cambios del panel admin. Lanza { status: 400 } si algo no es válido. */
async function guardar(cambios = {}) {
    const actual = (await col().findOne({ _id: 'extras' })) || {};
    const set = {};
    const malo = m => { const e = new Error(m); e.status = 400; throw e; };
    if (cambios.activo) {
        set.activo = { ...(actual.activo || {}) };
        for (const k of Object.keys(DEFECTO.activo)) if (typeof cambios.activo[k] === 'boolean') set.activo[k] = cambios.activo[k];
    }
    if (cambios.precios) {
        const p = { ...(actual.precios || {}) }, c = cambios.precios;
        for (const k of ['superchat', 'apoyo', 'promoLive']) if (c[k] != null) {
            const l = [...new Set((Array.isArray(c[k]) ? c[k] : String(c[k]).split(',')).map(x => entero(x, 1, 100000)))];
            if (!l.length || l.some(x => x == null) || l.length > 6) malo(`Montos de ${k} no válidos (1 a 6 números enteros)`);
            p[k] = l.sort((a, b) => a - b);
        }
        for (const k of ['prioridad', 'nombre']) if (c[k] != null) { const n = entero(c[k], 1, 100000); if (n == null) malo(`Precio de ${k} no válido`); p[k] = n; }
        for (const [k, max] of [['refInvitador', 500], ['refInvitado', 500], ['refMaxMes', 1000], ['packDescuento', 60]]) if (c[k] != null) { const n = entero(c[k], 0, max); if (n == null) malo(`Valor de ${k} no válido (0 a ${max})`); p[k] = n; }
        set.precios = p;
    }
    if (cambios.cosmeticos) {
        const m = { ...(actual.cosmeticos || {}) };
        for (const [id, v] of Object.entries(cambios.cosmeticos)) {
            const b = COSMETICOS.find(x => x.id === id); if (!b) malo(`Cosmético desconocido: ${id}`);
            const n = { ...(m[id] || {}) };
            if (v.precio != null && !b.soloMision) { const pr = entero(v.precio, 1, 100000); if (pr == null) malo(`Precio no válido para ${b.nombre}`); n.precio = pr; }
            if (typeof v.activo === 'boolean') n.activo = v.activo;
            m[id] = n;
        }
        set.cosmeticos = m;
    }
    if (cambios.misiones) {
        if (!Array.isArray(cambios.misiones) || cambios.misiones.length > 12) malo('Máximo 12 misiones');
        const ids = new Set();
        set.misiones = cambios.misiones.map((x, i) => {
            const id = String(x.id || `m_${Date.now().toString(36)}_${i}`).replace(/[^\w-]/g, '').slice(0, 40);
            if (!id || ids.has(id)) malo('Cada misión necesita un id único'); ids.add(id);
            if (!TIPOS_MISION[x.tipo]) malo(`Tipo de misión no válido: ${x.tipo}`);
            const objetivo = entero(x.objetivo, 1, 100), uc = entero(x.uc ?? 0, 0, 500);
            if (objetivo == null) malo('Objetivo no válido (1 a 100)'); if (uc == null) malo('Recompensa en UC no válida (0 a 500)');
            const insignia = x.insignia ? String(x.insignia) : '';
            if (insignia && !COSMETICOS.some(c => c.id === insignia && c.tipo === 'insignia')) malo(`Insignia no válida: ${insignia}`);
            if (!uc && !insignia) malo('Cada misión debe dar UpCoins o una insignia');
            const titulo = String(x.titulo || TIPOS_MISION[x.tipo]).replace(/[<>]/g, '').trim().slice(0, 60);
            return { id, tipo: x.tipo, titulo, objetivo, uc, insignia, activa: x.activa !== false };
        });
    }
    await col().updateOne({ _id: 'extras' }, { $set: { ...set, actualizado: new Date() } }, { upsert: true });
    return config(true);
}

// ── Misiones semanales ───────────────────────────────────────────────────
/** Semana actual en hora de Colombia, p. ej. "2026-W44" (lunes a domingo). */
function semana(fecha = new Date()) {
    const d = new Date(fecha.getTime() - 5 * 3600e3);
    const dia = (d.getUTCDay() + 6) % 7;                       // 0 = lunes
    const jueves = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia + 3));
    const enero4 = new Date(Date.UTC(jueves.getUTCFullYear(), 0, 4));
    const n = 1 + Math.round(((jueves - enero4) / 864e5 - 3 + ((enero4.getUTCDay() + 6) % 7)) / 7);
    return `${jueves.getUTCFullYear()}-W${String(n).padStart(2, '0')}`;
}
/** Fin de la semana actual (lunes 00:00 hora de Colombia). */
function finSemana(fecha = new Date()) {
    const d = new Date(fecha.getTime() - 5 * 3600e3);
    const dia = (d.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia + 7) + 5 * 3600e3);
}
const progreso = () => mongoose.connection.collection('misiones_progreso');
let indices = false;
async function asegurarIndices() {
    if (indices) return; indices = true;
    await progreso().createIndex({ usuario: 1, semana: 1 }, { unique: true }).catch(() => {});
    await progreso().createIndex({ creado: 1 }, { expireAfterSeconds: 60 * 864e2 }).catch(() => {});   // se borra a los 60 días
}

/**
 * Registra una acción para las misiones. `clave` evita contar dos veces lo mismo
 * (comentar 5 veces la misma publicación cuenta 1). Nunca lanza: las misiones no
 * deben romper la acción principal.
 */
async function evento(usuario, tipo, clave) {
    try {
        if (!usuario || !TIPOS_MISION[tipo]) return false;
        const c = await config();
        if (!c.activo.misiones || !c.misiones.some(m => m.activa && m.tipo === tipo)) return false;
        await asegurarIndices();
        const k = `${tipo}:${String(clave || Date.now()).slice(0, 60)}`, s = semana();
        const r = await progreso().updateOne({ usuario, semana: s, claves: { $ne: k } },
            { $inc: { [`conteo.${tipo}`]: 1 }, $push: { claves: { $each: [k], $slice: -400 } }, $setOnInsert: { creado: new Date(), reclamadas: [] } },
            { upsert: true }).catch(e => { if (e.code === 11000) return { modifiedCount: 0 }; throw e; });   // ya contada
        return !!(r.modifiedCount || r.upsertedCount);
    } catch (_) { return false; }
}

/** Estado de las misiones de la semana para un usuario. */
async function estado(usuario) {
    const c = await config();
    const doc = (await progreso().findOne({ usuario, semana: semana() }).catch(() => null)) || {};
    return {
        activo: c.activo.misiones, semana: semana(), terminaEn: finSemana(),
        misiones: c.misiones.filter(m => m.activa).map(m => {
            const n = Math.min(m.objetivo, doc.conteo?.[m.tipo] || 0);
            const ins = m.insignia ? COSMETICOS.find(x => x.id === m.insignia) : null;
            return { id: m.id, tipo: m.tipo, titulo: m.titulo, objetivo: m.objetivo, progreso: n, uc: m.uc,
                insignia: ins ? { id: ins.id, nombre: ins.nombre, emoji: ins.emoji } : null,
                completa: n >= m.objetivo, reclamada: (doc.reclamadas || []).includes(m.id) };
        }),
    };
}

/**
 * Entrega la recompensa de una misión completa (una vez por semana). Exige email
 * verificado y que la cuenta no esté en la lista negra (evita granjas de cuentas).
 */
async function reclamar(Usuario, usuario, misionId) {
    const c = await config();
    if (!c.activo.misiones) return { status: 409, error: 'Las misiones están pausadas' };
    const m = c.misiones.find(x => x.id === misionId && x.activa);
    if (!m) return { status: 404, error: 'Misión no disponible' };
    const u = await Usuario.findOne({ usuario }).select('emailVerificado listaNegraAdmin').lean();
    if (!u) return { status: 404, error: 'Cuenta no encontrada' };
    if (!u.emailVerificado) return { status: 403, error: 'Verifica tu email para reclamar recompensas', code: 'EMAIL_NO_VERIFICADO' };
    if (u.listaNegraAdmin) return { status: 403, error: 'Tu cuenta no puede reclamar recompensas ahora' };
    const s = semana();
    // Atómico: solo si llegó al objetivo y no la reclamó antes
    const r = await progreso().updateOne({ usuario, semana: s, [`conteo.${m.tipo}`]: { $gte: m.objetivo }, reclamadas: { $ne: m.id } }, { $push: { reclamadas: m.id } });
    if (!r.modifiedCount) {
        const doc = await progreso().findOne({ usuario, semana: s });
        return (doc?.reclamadas || []).includes(m.id) ? { status: 409, error: 'Ya reclamaste esta misión esta semana' } : { status: 409, error: 'Aún no completas esta misión' };
    }
    const inc = m.uc ? { monedas: m.uc } : {};
    await Usuario.updateOne({ usuario }, { ...(m.uc ? { $inc: inc } : {}), ...(m.insignia ? { $addToSet: { cosmeticos: m.insignia } } : {}) });
    const LiveTx = mongoose.models.LiveTx;
    if (LiveTx && m.uc) await LiveTx.create({ tipo: 'mision', usuario, monedas: m.uc, usd: 0, planId: m.id, metodo: 'mision', ref: `mision:${usuario}:${s}:${m.id}`, estado: 'completada' }).catch(() => {});
    return { status: 200, uc: m.uc, insignia: m.insignia || null };
}

/** Precio de un pack para quien ya tiene `mios`: suma de lo que falta, con descuento. null si no está disponible. */
function precioPack(c, pack, mios = []) {
    const tiene = new Set(mios), arts = pack.items.map(id => c.cosmeticos.find(x => x.id === id));
    if (arts.some(a => !a || !a.activo || a.soloMision)) return null;
    const faltan = arts.filter(a => !tiene.has(a.id));
    const lleno = faltan.reduce((t, a) => t + a.precio, 0);
    return { faltan: faltan.map(a => a.id), lleno, precio: Math.max(1, Math.round(lleno * (1 - (c.precios.packDescuento || 0) / 100))), completo: !faltan.length };
}

/** Qué le falta a alguien para comprar un artículo con requisitos ('' si nada). */
function faltaRequisito(item, { verificado = 0, seguidores = 0 } = {}) {
    const r = item?.req || {}, f = [];
    if (r.verificado && verificado < r.verificado) f.push(`verificación nivel ${r.verificado}`);
    if (r.seguidores && seguidores < r.seguidores) f.push(`${r.seguidores} seguidores`);
    return f.length ? `Necesitas ${f.join(' y ')} para este diseño` : '';
}

module.exports = { faltaRequisito, PACKS, precioPack, COSMETICOS, TIPOS_MISION, DEFECTO, SUPERCHAT_SEG, FUNDADOR_HASTA, config, guardar, semana, finSemana, evento, estado, reclamar };
