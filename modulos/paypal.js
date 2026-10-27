/**
 * PayPal Checkout (Orders v2) para cobros dentro de UpGames: monedas del live y
 * acceso directo a enlaces. El comprador paga con TARJETA (crédito/débito, sin
 * cuenta de PayPal) o con su cuenta PayPal; los datos de la tarjeta los captura
 * PayPal en su formulario seguro, nunca pasan por UpGames.
 *
 * Flujo seguro: el servidor crea la orden con el dueño (custom_id) y el producto
 * (reference_id); al capturar, verifica ambos y el monto ANTES de cobrar.
 */
'use strict';

const https = require('https');

function crear(config, getToken, { transporte } = {}) {
    const host = () => config.PAYPAL_MODE === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
    const activo = () => !!(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET);

    async function req(method, path, body, extraHeaders = {}) {
        if (transporte) return transporte(method, path, body, extraHeaders);   // tests
        const token = await getToken();
        const payload = body ? JSON.stringify(body) : '';
        return new Promise((resolve, reject) => {
            const r = https.request({
                hostname: host(), path, method,
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...extraHeaders },
                timeout: 20000,
            }, res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    let json = {};
                    try { json = data ? JSON.parse(data) : {}; } catch (_) {}
                    resolve({ status: res.statusCode, data: json });
                });
            });
            r.on('timeout', () => r.destroy(new Error('PayPal no respondió a tiempo')));
            r.on('error', reject);
            if (payload) r.write(payload);
            r.end();
        });
    }

    /** Crea una orden. Devuelve el orderID o lanza un error con .status. */
    async function crearOrden({ usuario, referencia, usd, descripcion }) {
        const r = await req('POST', '/v2/checkout/orders', {
            intent: 'CAPTURE',
            purchase_units: [{ reference_id: referencia, custom_id: usuario, description: descripcion.slice(0, 127), amount: { currency_code: 'USD', value: usd.toFixed(2) } }],
            application_context: { brand_name: 'UpGames', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
        }, { 'PayPal-Request-Id': `ug-${usuario}-${referencia}-${Date.now()}`.slice(0, 108) });
        if (r.status !== 201 || !r.data.id) {
            const e = new Error('PayPal no pudo crear la orden'); e.status = 502; e.detalle = JSON.stringify(r.data).slice(0, 300); throw e;
        }
        return r.data.id;
    }

    /**
     * Verifica dueño, producto y monto de la orden y la captura (idempotente si
     * ya estaba capturada). Devuelve { captura, referencia }.
     * `validarRef(ref)` decide si la referencia corresponde a lo que se compra.
     */
    async function capturar(orderID, { usuario, validarRef, usd }) {
        const fallo = (status, msg, extra = {}) => { const e = new Error(msg); e.status = status; Object.assign(e, extra); return e; };
        if (!/^[A-Z0-9]{10,30}$/.test(String(orderID || ''))) throw fallo(400, 'Orden no válida');
        const o = await req('GET', `/v2/checkout/orders/${orderID}`);
        if (o.status !== 200) throw fallo(404, 'PayPal no encontró la orden');
        const pu = o.data.purchase_units?.[0] || {};
        if (pu.custom_id !== usuario || !validarRef(pu.reference_id)) throw fallo(403, 'Esta orden no es tuya');
        const monto = typeof usd === 'function' ? usd(pu.reference_id) : usd;
        if (pu.amount?.currency_code !== 'USD' || Math.abs(parseFloat(pu.amount?.value) - monto) > 0.001) throw fallo(400, 'El monto de la orden no coincide');

        let captura = pu.payments?.captures?.[0];
        if (o.data.status !== 'COMPLETED') {
            const c = await req('POST', `/v2/checkout/orders/${orderID}/capture`, {}, { 'PayPal-Request-Id': `ug-cap-${orderID}` });
            if (c.status !== 201 && c.status !== 200) {
                const rechazo = c.data?.details?.[0]?.issue === 'INSTRUMENT_DECLINED';
                throw fallo(402, rechazo ? 'Tu banco o PayPal rechazó el pago. Prueba con otra tarjeta.' : 'No se pudo completar el pago', { reintentar: rechazo, detalle: JSON.stringify(c.data).slice(0, 300) });
            }
            captura = c.data.purchase_units?.[0]?.payments?.captures?.[0];
        }
        if (!captura || captura.status !== 'COMPLETED' || Math.abs(parseFloat(captura.amount?.value) - monto) > 0.001)
            throw fallo(402, 'El pago quedó pendiente en PayPal. Se acreditará cuando se confirme.', { detalle: captura?.status });
        return { captura, referencia: pu.reference_id };
    }

    return { activo, req, crearOrden, capturar };
}

module.exports = { crear };
