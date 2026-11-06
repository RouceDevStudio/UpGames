/**
 * Reglas de contenido legal en el SERVIDOR (antes solo existían en el navegador y se
 * podían saltar llamando a la API directamente). Es un filtro por palabras clave: no revisa
 * el contenido de los archivos enlazados.
 *
 *  revisar(pub) →
 *    { bloquear: 'motivo' }   no se publica (el título o la descripción declaran piratería)
 *    {}                       normal
 *  Es automático: no crea revisiones manuales ni colas de trabajo.
 */
'use strict';

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Términos inequívocos de piratería / elusión de licencias (con límites de palabra)
const PIRATERIA = [
    'crack', 'cracked', 'crackeado', 'crackeada', 'crackeo', 'keygen', 'warez', 'pirata', 'pirateado', 'pirateada',
    'serial key', 'license key', 'licencia gratis', 'activador', 'activator', 'kms pico', 'patch crack',
    'apk full', 'full apk', 'apk premium', 'premium desbloqueado', 'premium unlocked', 'pro desbloqueado', 'paid apk',
    'apk de pago gratis', 'juego de pago gratis', 'mod apk premium', 'unlocked all', 'todo desbloqueado gratis',
    'prod.keys', 'title.keys', 'prod keys', 'bios ps2', 'bios ps1', 'bios psx', 'scph1001', 'scph-1001', 'scph70012',
];
const RE = new RegExp(`(^|[^a-z0-9])(${PIRATERIA.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s._-]+')).join('|')})(?=$|[^a-z0-9])`);


function revisar(pub) {
    const texto = norm(`${pub.title || ''} ${pub.description || ''}`);
    const m = texto.match(RE);
    if (m) return { bloquear: `contiene «${m[2].replace(/[\s._-]+/g, ' ')}», asociado a piratería o a saltarse licencias` };
    return {};
}

module.exports = { revisar, PIRATERIA };
