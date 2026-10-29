/**
 * Reparto del dinero entre UpGames y los creadores: ÚNICA fuente de verdad.
 *
 * Regla: en cada venta el creador recibe como máximo el 30 % de lo que paga el
 * comprador y UpGames al menos el 70 % (con eso se pagan las pasarelas, el servidor
 * y la operación). Los porcentajes se pueden ajustar con variables de entorno,
 * pero nunca por encima del tope.
 *
 *   Regalos en lives ........ 25 % del valor de los UpCoins regalados
 *                             (peor caso: paquete de 3.000 UC + bono Premium = 30 % de lo pagado)
 *   Acceso directo (US$1) ... 25 % (solo accesos vendidos antes de la v7.0 de los Términos:
 *                             ya no se vende por publicación)
 *   Pases sin anuncios ...... fondo para creadores = 25 % del precio menos lo que
 *                             cuestan las monedas de regalo del pase; se reparte a
 *                             US$0,01 por la primera descarga efectiva del usuario en cada publicación
 *   Descargas (anuncios) .... CPM fijo por 1.000 descargas efectivas (CPM_VALUE); las vistas no se pagan;
 *                             debe ser ≤ 30 % de lo que pagan los anuncios por 1.000 visitas
 */
'use strict';

const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const TOPE_CREADOR = 0.30;
const parte = (v, d) => Math.min(TOPE_CREADOR, Math.max(0, num(v, d)));

const MONEDA_USD = 0.02;   // 1 UpCoin

// Compatibilidad: LIVE_COMISION era la parte de UpGames en los regalos
const REGALO_CREADOR = process.env.LIVE_PARTE_CREADOR != null ? parte(process.env.LIVE_PARTE_CREADOR, 0.25)
    : process.env.LIVE_COMISION != null ? parte(1 - num(process.env.LIVE_COMISION, 0.75), 0.25) : 0.25;
const ACCESO_CREADOR = parte(process.env.ACCESO_CREADOR, 0.25);
const PASE_CREADOR = parte(process.env.PASE_PARTE_CREADOR, 0.25);
const PASE_POR_APERTURA = Math.max(0, Math.min(0.05, num(process.env.PASE_CREADOR_USD, 0.01)));

/** Lo mínimo que UpGames cobra por una moneda (paquete más grande + 10 % del pase). */
const VALOR_MONEDA_MIN = 54.99 / 3300;


/**
 * Fondo para creadores que genera un pase: 25 % de lo pagado menos lo que costarían
 * sus monedas de regalo si se regalan en lives. Pagado con monedas, lo pagado se
 * valora al precio más bajo de la moneda.
 */
function fondoPase({ usd = 0, monedas = 0, metodo, monedasRegalo = 0 }) {
    const pagado = (metodo === 'monedas' || metodo === 'upcoins') ? monedas * VALOR_MONEDA_MIN : usd;
    return Math.floor(Math.max(0, pagado * PASE_CREADOR - monedasRegalo * MONEDA_USD * REGALO_CREADOR) * 10000) / 10000;   // hacia abajo: nunca pasar del tope
}

/**
 * Monedas extra del pase (+10 %) en un paquete, recortadas para que, si se regalan
 * todas, el creador no reciba más del 30 % de lo pagado por el paquete.
 */
function bonoPaquete(monedas, usd, bono = 0.10) {
    const maxMonedas = Math.floor(usd * TOPE_CREADOR / (MONEDA_USD * REGALO_CREADOR) + 1e-9);
    return Math.max(0, Math.min(Math.floor(monedas * bono), maxMonedas - monedas));
}

module.exports = {
    TOPE_CREADOR, MONEDA_USD, REGALO_CREADOR, ACCESO_CREADOR, PASE_CREADOR, PASE_POR_APERTURA, VALOR_MONEDA_MIN,
    fondoPase, bonoPaquete,
    /** Resumen público (lo muestran la app, los términos y NEXUS). */
    publico: () => ({ regalos: REGALO_CREADOR, accesoDirecto: ACCESO_CREADOR, pases: PASE_CREADOR, paseApertura: PASE_POR_APERTURA, tope: TOPE_CREADOR }),
};
