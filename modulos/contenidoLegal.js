/**
 * Reglas de contenido legal en el SERVIDOR (antes solo existían en el navegador y se
 * podían saltar llamando a la API directamente). Ver Términos, sección 02B.
 *
 *  revisar(pub, { detectGame }) →
 *    { bloquear: 'motivo' }            no se publica (piratería evidente)
 *    { revisionHumana: 'motivo' }      se publica como "pendiente" hasta que un admin la apruebe
 *    {}                                normal
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

// Archivos de app/juego instalables directos
const ES_APK = /\.(apk|apks|xapk|apkm|obb|ipa)(\?|$)/i;

function revisar(pub, { detectGame } = {}) {
    const texto = norm(`${pub.title || ''} ${pub.description || ''}`);
    const m = texto.match(RE);
    if (m) return { bloquear: `contiene «${m[2].replace(/[\s._-]+/g, ' ')}», asociado a piratería o a saltarse licencias` };
    const cat = String(pub.category || '');
    if (cat === 'Video') return {};
    // Juego o app COMERCIAL reconocido publicado como juego/app/ROM → revisión humana obligatoria
    const det = typeof detectGame === 'function' ? detectGame(pub.title, pub.description) : null;
    if (det && ['Juego', 'ROM', 'Apps'].includes(cat)) return { revisionHumana: `parece ser «${det.gameName}», un título comercial: un administrador debe confirmar que tienes autorización para publicarlo` };
    if (ES_APK.test(String(pub.link || '')) && ['Juego', 'Apps'].includes(cat) && det) return { revisionHumana: 'enlace directo a un instalador de un título comercial' };
    return {};
}

module.exports = { revisar, PIRATERIA };
