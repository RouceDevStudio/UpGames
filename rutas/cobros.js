/**
 * Métodos de cobro de los creadores: dónde reciben sus retiros.
 *
 * - PayPal (automático si los Payouts están activos) · Nequi · Daviplata ·
 *   cuenta bancaria en Colombia · Mercado Pago (transferencia manual del admin).
 * - Pagar "a una tarjeta" no es posible: ni Mercado Pago ni PayPal permiten enviar
 *   dinero a un número de tarjeta, y guardar números de tarjeta exige PCI DSS. Las
 *   tarjetas débito están atadas a una cuenta o a Nequi/Daviplata: se pide eso.
 * - Los datos (cuenta, documento, celular) se guardan CIFRADOS (AES-256-GCM); al
 *   usuario solo se le muestran enmascarados y el admin los ve al pagar (auditado).
 * - Cambiar el método exige la contraseña, avisa por email y deja los retiros en
 *   espera 48 h: si alguien roba la cuenta no puede desviar el dinero al instante.
 */
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ESPERA_H = Math.max(0, parseFloat(process.env.COBRO_ESPERA_HORAS) || 48);
const BANCOS = ['Bancolombia', 'Banco de Bogotá', 'Davivienda', 'BBVA', 'Banco de Occidente', 'Banco Popular', 'Banco AV Villas',
    'Banco Caja Social', 'Scotiabank Colpatria', 'Banco Agrario', 'Itaú', 'Banco GNB Sudameris', 'Banco Falabella', 'Banco Pichincha',
    'Bancoomeva', 'Banco Finandina', 'Banco Serfinanza', 'Lulo Bank', 'Nu Colombia', 'Banco Mundo Mujer', 'Bancamía', 'Otro'];
const TIPOS = {
    paypal:      { nombre: 'PayPal',            auto: true },
    nequi:       { nombre: 'Nequi',             auto: false },
    daviplata:   { nombre: 'Daviplata',         auto: false },
    banco:       { nombre: 'Cuenta bancaria',   auto: false },
    mercadopago: { nombre: 'Mercado Pago',      auto: false },
};
const TIPOS_DOC = ['CC', 'CE', 'NIT', 'PPT', 'PAS', 'TI'];

// ── Cifrado ─────────────────────────────────────────────────────────────
function clave() {
    const base = process.env.COBROS_CLAVE || `${process.env.JWT_SECRET || ''}:cobros`;
    return crypto.createHash('sha256').update(base).digest();
}
function cifrar(obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', clave(), iv);
    const datos = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), datos].map(b => b.toString('base64')).join('.');
}
function descifrar(txt) {
    try {
        const [iv, tag, datos] = String(txt || '').split('.').map(x => Buffer.from(x, 'base64'));
        const d = crypto.createDecipheriv('aes-256-gcm', clave(), iv);
        d.setAuthTag(tag);
        return JSON.parse(Buffer.concat([d.update(datos), d.final()]).toString('utf8'));
    } catch (_) { return null; }
}

// ── Validación ──────────────────────────────────────────────────────────
const txt = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const soloDig = v => String(v ?? '').replace(/[\s.-]/g, '');
const fin = (v, n = 4) => '•••• ' + String(v).slice(-n);
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const enmEmail = e => e.replace(/^(.{1,2})[^@]*(@.*)$/, (_, a, b) => a + '•••' + b);

/** Devuelve { datos, resumen } o lanza un Error con mensaje para el usuario. */
function validar(tipo, d = {}) {
    const mal = m => { const e = new Error(m); e.status = 400; throw e; };
    if (!TIPOS[tipo]) mal('Método de cobro no válido');
    const titular = txt(d.titular, 80);
    if (tipo === 'paypal') {
        const email = txt(d.email, 120).toLowerCase();
        if (!emailOk(email)) mal('Escribe el email de tu cuenta PayPal');
        return { datos: { email }, resumen: `PayPal · ${enmEmail(email)}`, paypalEmail: email };
    }
    if (titular.length < 3) mal('Escribe el nombre completo del titular');
    if (tipo === 'nequi' || tipo === 'daviplata') {
        const celular = soloDig(d.celular);
        if (!/^3\d{9}$/.test(celular)) mal('El celular debe tener 10 dígitos y empezar por 3');
        return { datos: { celular, titular }, resumen: `${TIPOS[tipo].nombre} · ${fin(celular)} · ${titular}` };
    }
    if (tipo === 'mercadopago') {
        const cuenta = txt(d.cuenta, 120).toLowerCase();
        const esCel = /^3\d{9}$/.test(soloDig(cuenta));
        if (!esCel && !emailOk(cuenta)) mal('Escribe el email o el celular de tu cuenta de Mercado Pago');
        const valor = esCel ? soloDig(cuenta) : cuenta;
        return { datos: { cuenta: valor, titular }, resumen: `Mercado Pago · ${esCel ? fin(valor) : enmEmail(valor)} · ${titular}` };
    }
    // banco
    const banco = BANCOS.includes(d.banco) ? d.banco : mal('Elige tu banco');
    const tipoCuenta = ['ahorros', 'corriente'].includes(d.tipoCuenta) ? d.tipoCuenta : mal('Elige el tipo de cuenta');
    const numero = soloDig(d.numero);
    if (!/^\d{6,20}$/.test(numero)) mal('El número de cuenta debe tener entre 6 y 20 dígitos');
    const tipoDoc = TIPOS_DOC.includes(d.tipoDoc) ? d.tipoDoc : mal('Elige el tipo de documento');
    const documento = soloDig(d.documento).toUpperCase();
    if (!/^[0-9A-Z]{5,15}$/.test(documento)) mal('Revisa el número de documento');
    return { datos: { banco, tipoCuenta, numero, titular, tipoDoc, documento }, resumen: `${banco} · ${tipoCuenta} ${fin(numero)} · ${titular}` };
}

function registrar(app, { verificarToken, verificarAdmin, Usuario, logger, sendEmail, plantillaAviso }) {
    const ok = (res, d) => res.json({ success: true, ...d });
    const err = (res, code, error) => res.status(code).json({ success: false, error });

    /** Método vigente del usuario (incluye el PayPal antiguo, guardado solo como email). */
    function metodoDe(u) {
        if (u?.cobro?.tipo) return { tipo: u.cobro.tipo, resumen: u.cobro.resumen, cifrado: u.cobro.cifrado, actualizado: u.cobro.actualizado };
        if (u?.paypalEmail) return { tipo: 'paypal', resumen: `PayPal · ${enmEmail(u.paypalEmail)}`, cifrado: cifrar({ email: u.paypalEmail }), actualizado: null };
        return null;
    }
    /** Hasta cuándo están en espera los retiros tras cambiar el método (null si no hay espera). */
    const esperaHasta = u => {
        const t = u?.cobro?.esperaHasta ? new Date(u.cobro.esperaHasta) : null;
        return t && t > new Date() ? t : null;
    };

    app.get('/economia/metodo-cobro', verificarToken, async (req, res) => {
        const u = await Usuario.findOne({ usuario: req.usuario }).select('cobro paypalEmail').lean().catch(() => null);
        if (!u) return err(res, 404, 'Usuario no encontrado');
        const m = metodoDe(u);
        ok(res, {
            metodo: m ? { tipo: m.tipo, nombre: TIPOS[m.tipo]?.nombre, resumen: m.resumen, actualizado: m.actualizado } : null,
            esperaHasta: esperaHasta(u), tipos: Object.entries(TIPOS).map(([id, t]) => ({ id, nombre: t.nombre })), bancos: BANCOS, tiposDoc: TIPOS_DOC, esperaHoras: ESPERA_H,
        });
    });

    const intentos = new Map();   // usuario → intentos fallidos de contraseña
    app.put('/economia/metodo-cobro', verificarToken, async (req, res) => {
        try {
            const u = await Usuario.findOne({ usuario: req.usuario }).select('usuario email password cobro paypalEmail solicitudPagoPendiente').lean();
            if (!u) return err(res, 404, 'Usuario no encontrado');
            // Máximo 5 intentos de contraseña cada 15 min (un token robado no sirve para adivinarla)
            const ahora = Date.now(), previos = (intentos.get(req.usuario) || []).filter(t => ahora - t < 15 * 60000);
            if (previos.length >= 5) return err(res, 429, 'Demasiados intentos. Espera 15 minutos.');
            if (!req.body?.password || !(await bcrypt.compare(String(req.body.password), u.password || ''))) {
                previos.push(ahora); intentos.set(req.usuario, previos); if (intentos.size > 10000) intentos.clear();
                return err(res, 401, 'La contraseña no es correcta');
            }
            intentos.delete(req.usuario);
            if (u.solicitudPagoPendiente) return err(res, 409, 'Tienes un retiro pendiente: espera a que se procese para cambiar el método de cobro');
            const { datos, resumen, paypalEmail } = validar(String(req.body.tipo || ''), req.body.datos || {});
            const tenia = !!metodoDe(u);
            const cobro = { tipo: req.body.tipo, cifrado: cifrar(datos), resumen, actualizado: new Date(),
                esperaHasta: tenia && ESPERA_H > 0 ? new Date(Date.now() + ESPERA_H * 3600e3) : null };
            await Usuario.updateOne({ usuario: req.usuario }, { $set: { cobro, ...(paypalEmail ? { paypalEmail } : {}) } });
            logger.info(`[cobros] @${req.usuario} configuró su método de cobro: ${TIPOS[cobro.tipo].nombre}`);
            if (tenia && u.email) sendEmail?.({ to: u.email, subject: '🔐 Cambiaste tu método de cobro en UpGames',
                html: plantillaAviso ? plantillaAviso(u.usuario, `Tu método de cobro ahora es: <b>${resumen}</b>. Por seguridad, los retiros quedan en espera ${ESPERA_H} horas. Si no fuiste tú, cambia tu contraseña y escríbenos de inmediato.`)
                    : `Tu método de cobro ahora es: ${resumen}. Si no fuiste tú, cambia tu contraseña y escríbenos.` }).catch?.(() => {});
            ok(res, { metodo: { tipo: cobro.tipo, nombre: TIPOS[cobro.tipo].nombre, resumen }, esperaHasta: cobro.esperaHasta,
                mensaje: cobro.esperaHasta ? `Guardado. Por seguridad podrás retirar desde el ${cobro.esperaHasta.toLocaleString('es-CO')}.` : 'Método de cobro guardado' });
        } catch (e) {
            if (e.status) return err(res, e.status, e.message);
            logger.error(`[cobros] guardar: ${e.message}`); err(res, 500, 'No se pudo guardar el método de cobro');
        }
    });

    // Admin: datos completos para hacer la transferencia. Es POST para que quede en la
    // auditoría del panel (las consultas GET no se registran) y avise al dueño.
    if (verificarAdmin) app.post('/admin/finanzas/datos-cobro/:pagoId', verificarAdmin, async (req, res) => {
        try {
            const mongoose = require('mongoose');
            if (!mongoose.isValidObjectId(req.params.pagoId)) return err(res, 404, 'Pago no encontrado');
            const p = await mongoose.model('Pago').findById(req.params.pagoId).select('usuario metodo datosCobro paypalEmail monto').lean();
            if (!p) return err(res, 404, 'Pago no encontrado');
            const datos = p.datosCobro ? descifrar(p.datosCobro) : (p.paypalEmail ? { email: p.paypalEmail } : null);
            if (!datos) return err(res, 409, 'No se pudieron leer los datos de cobro (¿cambió COBROS_CLAVE o JWT_SECRET?)');
            logger.warn(`[cobros] Admin @${req.admin?.usuario || '?'} consultó los datos de cobro del pago ${p._id} (@${p.usuario})`);
            ok(res, { usuario: p.usuario, metodo: p.metodo || 'paypal', nombre: TIPOS[p.metodo || 'paypal']?.nombre, datos, monto: p.monto });
        } catch (e) { logger.error(`[cobros] datos admin: ${e.message}`); err(res, 500, 'Error al leer los datos'); }
    });

    return { metodoDe, esperaHasta, TIPOS, validar, cifrar, descifrar };
}

module.exports = { registrar, validar, cifrar, descifrar, TIPOS, BANCOS };
