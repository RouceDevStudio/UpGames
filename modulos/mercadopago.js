/**
 * Mercado Pago (API de pagos + Card Payment Brick) para cobrar con tarjeta.
 *
 * - El formulario de la tarjeta lo dibuja Mercado Pago (Brick): UpGames recibe solo
 *   un token de un uso, nunca el número de la tarjeta.
 * - El servidor fija el monto (nunca el navegador) y crea el pago con clave de
 *   idempotencia: reintentar no cobra dos veces.
 * - La moneda sale de la cuenta (Colombia → COP). Los precios de UpGames están en
 *   USD y se convierten con MERCADOPAGO_TASA_USD (moneda local por 1 USD).
 *
 * Variables: MERCADOPAGO_ACCESS_TOKEN y MERCADOPAGO_PUBLIC_KEY (se aceptan también
 * MP_ACCESS_TOKEN / MP_PUBLIC_KEY). Opcional: MERCADOPAGO_TASA_USD.
 */
'use strict';

const https = require('https');

const limpio = v => String(v ?? '').trim().replace(/^(['"])(.*)\1$/s, '$2').trim();
// Moneda de cada país de Mercado Pago (site_id de la cuenta)
const MONEDA_SITIO = { MCO: 'COP', MLM: 'MXN', MLA: 'ARS', MLB: 'BRL', MLC: 'CLP', MPE: 'PEN', MLU: 'UYU' };
// Tasas de respaldo SOLO si no se configura MERCADOPAGO_TASA_USD (conviene fijarla)
const TASA_RESPALDO = { COP: 4000, MXN: 18, PEN: 3.8, CLP: 950, BRL: 5.5, UYU: 40, ARS: 1200 };
// Monedas sin decimales en Mercado Pago
const SIN_DECIMALES = new Set(['COP', 'CLP']);

function crear({ transporte, env = process.env } = {}) {
    const token = () => limpio(env.MERCADOPAGO_ACCESS_TOKEN || env.MP_ACCESS_TOKEN);
    const publicKey = () => limpio(env.MERCADOPAGO_PUBLIC_KEY || env.MP_PUBLIC_KEY);
    const configurado = () => !!(token() && publicKey());

    function req(method, path, body, extra = {}) {
        if (transporte) return transporte(method, path, body, extra);
        const payload = body ? JSON.stringify(body) : '';
        return new Promise((resolve, reject) => {
            const r = https.request({
                hostname: 'api.mercadopago.com', path, method, timeout: 25000,
                headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...extra },
            }, res => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => { let j = {}; try { j = d ? JSON.parse(d) : {}; } catch (_) {} resolve({ status: res.statusCode, data: j }); });
            });
            r.on('timeout', () => r.destroy(new Error('Mercado Pago no respondió a tiempo')));
            r.on('error', reject);
            if (payload) r.write(payload);
            r.end();
        });
    }

    let estado = { ok: null, motivo: '', detalle: '', moneda: '', sitio: '' };
    async function verificar() {
        if (!configurado()) return (estado = { ok: false, motivo: 'sin_configurar', detalle: 'Faltan MERCADOPAGO_ACCESS_TOKEN / MERCADOPAGO_PUBLIC_KEY', moneda: '', sitio: '' });
        try {
            const r = await req('GET', '/users/me');
            if (r.status === 200 && r.data.site_id) {
                const moneda = MONEDA_SITIO[r.data.site_id] || 'USD';
                estado = { ok: true, motivo: '', detalle: '', moneda, sitio: r.data.site_id, prueba: /^TEST-/.test(token()) };
            } else {
                estado = { ok: false, motivo: 'credenciales_invalidas', moneda: '', sitio: '',
                    detalle: `Mercado Pago rechazó MERCADOPAGO_ACCESS_TOKEN (HTTP ${r.status}). Cópialo completo desde mercadopago.com → Tu negocio → Configuración → Credenciales (de producción: empieza por APP_USR-).` };
            }
        } catch (e) {
            estado = { ok: false, motivo: 'no_disponible', moneda: '', sitio: '', detalle: `No se pudo contactar a Mercado Pago: ${e.message.slice(0, 160)}` };
        }
        return estado;
    }
    const activo = () => configurado() && estado.ok === true;
    const tasa = () => {
        const t = parseFloat(limpio(env.MERCADOPAGO_TASA_USD));
        return Number.isFinite(t) && t > 0 ? t : (TASA_RESPALDO[estado.moneda] || 1);
    };
    const tasaConfigurada = () => Number.isFinite(parseFloat(limpio(env.MERCADOPAGO_TASA_USD)));

    /** Precio en moneda local: COP redondeado hacia arriba a la centena (US$1 → $4.000). */
    function montoLocal(usd) {
        const m = usd * tasa();
        if (SIN_DECIMALES.has(estado.moneda)) return Math.ceil(m / 100) * 100;
        return Math.ceil(m * 100) / 100;
    }

    /**
     * Cobra con el token del Brick. `producto` y `monto` los decide el servidor.
     * Devuelve { id, status, detalle } (status: approved | in_process | pending | rejected).
     */
    async function pagar({ formData, monto, descripcion, referencia, idempotencia, notificacion, email }) {
        const f = formData || {};
        if (!f.token || !f.payment_method_id) { const e = new Error('Faltan los datos de la tarjeta'); e.status = 400; throw e; }
        const cuerpo = {
            transaction_amount: monto,
            token: String(f.token),
            description: String(descripcion).slice(0, 200),
            installments: 1,
            payment_method_id: String(f.payment_method_id),
            issuer_id: f.issuer_id ? String(f.issuer_id) : undefined,
            payer: {
                email: String(f.payer?.email || email || '').slice(0, 120),
                identification: f.payer?.identification?.number ? { type: String(f.payer.identification.type || '').slice(0, 10), number: String(f.payer.identification.number).slice(0, 20) } : undefined,
            },
            external_reference: referencia,
            statement_descriptor: 'UPGAMES',
            notification_url: notificacion || undefined,
            binary_mode: false,
        };
        const r = await req('POST', '/v1/payments', cuerpo, { 'X-Idempotency-Key': idempotencia });
        if (r.status !== 201 && r.status !== 200) {
            const e = new Error(traducirError(r.data)); e.status = 402; e.detalle = JSON.stringify(r.data).slice(0, 300); throw e;
        }
        return { id: String(r.data.id), status: r.data.status, detalle: r.data.status_detail, monto: r.data.transaction_amount, referencia: r.data.external_reference };
    }

    async function obtener(id) {
        const r = await req('GET', `/v1/payments/${encodeURIComponent(id)}`);
        if (r.status !== 200) return null;
        return { id: String(r.data.id), status: r.data.status, detalle: r.data.status_detail, monto: r.data.transaction_amount, moneda: r.data.currency_id, referencia: r.data.external_reference };
    }

    return { activo, configurado, verificar, estado: () => ({ ...estado }), publicKey, tasa, tasaConfigurada, montoLocal, pagar, obtener, req };
}

/** Motivo de rechazo en lenguaje claro (status_detail de Mercado Pago). */
function traducirRechazo(detalle) {
    const m = {
        cc_rejected_insufficient_amount: 'La tarjeta no tiene fondos suficientes.',
        cc_rejected_bad_filled_security_code: 'El código de seguridad (CVV) es incorrecto.',
        cc_rejected_bad_filled_date: 'La fecha de vencimiento es incorrecta.',
        cc_rejected_bad_filled_card_number: 'El número de la tarjeta es incorrecto.',
        cc_rejected_bad_filled_other: 'Revisa los datos de la tarjeta.',
        cc_rejected_call_for_authorize: 'Tu banco pide que autorices este pago. Llama al banco e inténtalo de nuevo.',
        cc_rejected_card_disabled: 'La tarjeta está desactivada. Actívala con tu banco o usa otra.',
        cc_rejected_duplicated_payment: 'Ya hiciste un pago igual hace un momento.',
        cc_rejected_high_risk: 'El pago fue rechazado por seguridad. Prueba con otra tarjeta.',
        cc_rejected_max_attempts: 'Llegaste al límite de intentos. Usa otra tarjeta.',
        cc_rejected_blacklist: 'No se pudo procesar el pago con esta tarjeta.',
        cc_rejected_other_reason: 'El banco rechazó el pago. Prueba con otra tarjeta.',
    };
    return m[detalle] || 'El pago fue rechazado. Prueba con otra tarjeta.';
}
function traducirError(data) {
    const c = data?.cause?.[0]?.code;
    if (c === 2006 || c === 2062 || /token/i.test(data?.message || '')) return 'Los datos de la tarjeta vencieron. Vuelve a escribirlos.';
    return 'No se pudo procesar el pago con Mercado Pago. Inténtalo de nuevo.';
}

module.exports = { crear, traducirRechazo, MONEDA_SITIO };
