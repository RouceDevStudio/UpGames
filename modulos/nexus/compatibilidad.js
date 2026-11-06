/**
 * ══════════════════════════════════════════════════════════════════
 *  nexus/compatibilidad.js — "¿Funciona en mi celular?"
 *
 *  El navegador manda lo que sabe del equipo (RAM aproximada, núcleos, GPU vía WebGL,
 *  modelo y sistema). Nexus lo cruza con la publicación (plataforma, requisitos,
 *  tamaño, si es un port por Winlator/Mobox, un emulador de PS2/Switch…) y da un
 *  semáforo con razones y ajustes recomendados.
 *
 *  El veredicto lo calculan reglas (siempre igual para el mismo equipo y publicación);
 *  la IA, si está, solo redacta la explicación y los ajustes en lenguaje claro.
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const llm = require('./llm');
const { tamanoGB, ramGB } = require('./filtros');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const txt = (v, n) => String(v ?? '').replace(/[^\w .()+,:/-]/g, '').trim().slice(0, n);

/** Limpia lo que manda el navegador. */
function dispositivo(d = {}) {
    const so = ['android', 'ios', 'windows', 'mac', 'linux', 'chromeos'].includes(d.so) ? d.so : 'otro';
    const ram = +d.ramGB;
    return {
        so, gpu: txt(d.gpu, 80), modelo: txt(d.modelo, 40), version: txt(d.version, 12),
        ramGB: Number.isFinite(ram) && ram > 0 && ram <= 64 ? ram : null,   // navigator.deviceMemory: 0.25…8 (redondeado, tope 8)
        nucleos: Math.max(0, Math.min(32, parseInt(d.nucleos, 10) || 0)) || null,
    };
}

/** Gama de la GPU: 4 tope · 3 alta · 2 media · 1 baja · null desconocida. */
function gamaGPU(gpu) {
    const g = norm(gpu);
    if (!g) return null;
    let m;
    if ((m = g.match(/adreno\D*(\d{3})/))) { const n = +m[1]; return n >= 730 ? 4 : n >= 650 ? 3 : n >= 618 ? 2 : 1; }
    if (/immortalis|xclipse|apple gpu|apple m\d|geforce|radeon|nvidia|intel\(r\) (iris|arc)|arc a\d/.test(g)) return /intel|uhd/.test(g) ? 2 : 4;
    if ((m = g.match(/mali-?g(\d{2,3})/))) { const n = +m[1]; return n >= 710 || n === 78 || n === 77 ? 3 : n >= 610 || n === 68 || n === 76 ? 3 : n >= 57 ? 2 : 1; }
    if (/mali-?t|powervr|ge8\d{3}|vivante|videocore/.test(g)) return 1;
    if (/intel|uhd|hd graphics/.test(g)) return 2;
    if (/swiftshader|llvmpipe|software/.test(g)) return null;   // renderizado por software: no dice nada del equipo
    return null;
}
const esAdreno = gpu => /adreno/i.test(gpu || '');

/** Cuánto exige la publicación: { nivel 1-4, ramMin, motor, plataforma, notas[] } */
function exigencia(it) {
    const s = norm(`${it.title} ${it.description || ''} ${Object.values(it.extraData || {}).filter(v => typeof v === 'string').join(' ')}`);
    const r = { nivel: 1, ramMin: null, motor: null, plataforma: null, notas: [] };
    const pl = norm(`${it.extraData?.plataforma || ''} ${it.extraData?.so || ''}`);
    r.plataforma = /android|apk/.test(pl) ? 'android' : /pc|windows/.test(pl) ? 'pc' : /ios/.test(pl) ? 'ios' : /multi/.test(pl) ? 'multi'
        : /\bapk\b|android/.test(s) ? 'android' : /\bpc\b|windows|steam/.test(s) ? 'pc' : null;
    if (/winlator|mobox|gamehub|game hub|box64|exagear|wine\b|pc port|port de pc|\bdxvk\b/.test(s)) { r.motor = 'pc-en-android'; r.nivel = 3; r.ramMin = 6; r.plataforma = 'android'; }
    else if (/yuzu|sudachi|eden|citron|skyline|egg ns|switch/.test(s) && /emula|rom|nsp|xci/.test(s)) { r.motor = 'switch'; r.nivel = 4; r.ramMin = 8; }
    else if (/ps3|rpcs3|aps3e/.test(s)) { r.motor = 'ps3'; r.nivel = 4; r.ramMin = 8; }
    else if (/ps2|aethersx2|nethersx2|armsx2|playstation 2/.test(s)) { r.motor = 'ps2'; r.nivel = 3; r.ramMin = 4; }
    else if (/gamecube|wii\b|dolphin|3ds|citra|lime3ds|azahar/.test(s)) { r.motor = 'gc-wii-3ds'; r.nivel = 3; r.ramMin = 4; }
    else if (/psp|ppsspp|nintendo ds|\bnds\b|drastic|n64|psx|ps1|duckstation|dreamcast/.test(s)) { r.motor = 'retro-3d'; r.nivel = 2; r.ramMin = 2; }
    else if (/\bnes\b|snes|\bgba\b|game boy|genesis|mega drive|arcade|mame|retroarch/.test(s)) { r.motor = 'retro'; r.nivel = 1; r.ramMin = 1; }
    const tam = tamanoGB(it);
    if (!r.motor && it.category !== 'Apps' && it.category !== 'Software') {
        if (tam != null) r.nivel = tam > 4 ? 3 : tam > 1.5 ? 2 : 1;
        else if (/ultra|4k|60 ?fps|realista|remaster|graficos altos/.test(s)) r.nivel = 3;
        else if (it.category === 'Juego' || it.category === 'Mod') r.nivel = 2;
    }
    if (/lite|bajos recursos|low end|gama baja|optimizad|potato/.test(s)) { r.nivel = Math.max(1, r.nivel - 1); r.notas.push('versión optimizada para equipos modestos'); }
    const ram = ramGB(it);
    if (ram) r.ramMin = ram;
    if (r.ramMin == null) r.ramMin = [null, 2, 3, 6, 8][r.nivel];
    return r;
}

const AJUSTES = {
    'pc-en-android': ['Usa los drivers Turnip si tu GPU es Adreno', 'Empieza con resolución 800×600 o 1024×768', 'DXVK para juegos DirectX 9-11; WineD3D si se cierra', 'Cierra todas las apps en segundo plano'],
    switch: ['Activa la resolución 0.5× o 0.75×', 'Usa el driver Turnip en Adreno', 'Desactiva la sincronización vertical si va lento'],
    ps3: ['Empieza con la resolución nativa y sin escalado', 'Usa el driver Turnip en Adreno'],
    ps2: ['Renderizador Vulkan', 'Escala de resolución 1× (nativa) si va lento', 'Activa "Velocidad de EE" en modo rendimiento si se traba'],
    'gc-wii-3ds': ['Backend Vulkan y resolución 1×', 'Activa "Skip EFB Access" si va lento'],
    'retro-3d': ['Resolución 2× suele ir fluida; baja a 1× si se traba'],
    retro: ['Cualquier emulador de RetroArch funciona; activa el "run-ahead" si notas retraso'],
};

/** Veredicto por reglas. */
function evaluar(itRaw, devRaw) {
    const it = itRaw || {}, d = dispositivo(devRaw), ex = exigencia(it);
    const gama = gamaGPU(d.gpu);
    const razones = [], ajustes = [...(AJUSTES[ex.motor] || [])];
    const esVideo = it.category === 'Video';
    if (esVideo) return { veredicto: 'no_aplica', puntuacion: null, titulo: 'Es un video', razones: ['Los videos se ven en cualquier equipo.'], ajustes: [], exigencia: ex, dispositivo: { ...d, gama } };

    // Plataforma
    const movil = d.so === 'android' || d.so === 'ios';
    if (d.so === 'ios' && (ex.plataforma === 'android' || ex.motor === 'pc-en-android'))
        return { veredicto: 'no', puntuacion: 5, titulo: 'No es para iPhone', razones: ['Es para Android (APK) y iPhone no instala APK.'], ajustes: [], exigencia: ex, dispositivo: { ...d, gama } };
    if (!movil && ex.plataforma === 'android')
        return { veredicto: 'no_aplica', puntuacion: null, titulo: 'Es para Android', razones: ['Estás en un computador: ábrelo desde tu celular Android para saber si te funciona.', 'En PC solo correría con un emulador de Android.'], ajustes: [], exigencia: ex, dispositivo: { ...d, gama } };
    if (d.so === 'android' && ex.plataforma === 'pc' && !ex.motor) {
        razones.push('Es para PC: en Android necesitas Winlator, Mobox o GameHub.');
        ex.motor = 'pc-en-android'; ex.nivel = Math.max(ex.nivel, 3); ex.ramMin = Math.max(ex.ramMin || 0, 6);
        ajustes.unshift(...AJUSTES['pc-en-android']);
    }

    // Puntos: GPU frente a lo que exige + RAM
    let p = 70;
    if (gama != null) {
        const dif = gama - ex.nivel;
        p += dif >= 1 ? 22 : dif === 0 ? 8 : dif === -1 ? -25 : -50;
        razones.push(gama >= ex.nivel ? `Tu GPU (${d.gpu}) es de gama ${['', 'baja', 'media', 'alta', 'tope'][gama]}: suficiente para lo que pide.`
            : `Tu GPU (${d.gpu}) es de gama ${['', 'baja', 'media', 'alta', 'tope'][gama]} y esto pide más.`);
    } else razones.push('No pude identificar tu GPU (tu navegador la oculta): el resultado es aproximado.');
    if (d.ramGB != null && ex.ramMin) {
        // deviceMemory se queda en 8 aunque el equipo tenga 12 o 16 GB
        if (d.ramGB >= ex.ramMin || (d.ramGB >= 8 && ex.ramMin <= 16)) { p += 6; razones.push(`RAM: ${d.ramGB >= 8 ? '8 GB o más' : `≈ ${d.ramGB} GB`}; pide ${ex.ramMin} GB. ✓`); }
        else { p -= d.ramGB * 1.5 < ex.ramMin ? 35 : 18; razones.push(`RAM: ≈ ${d.ramGB} GB y pide unos ${ex.ramMin} GB.`); }
    }
    if (ex.motor === 'pc-en-android' && d.gpu && !esAdreno(d.gpu)) { p -= 15; razones.push('Los ports de PC (Winlator/Mobox) van mejor con GPU Adreno: en Mali o PowerVR suelen ir más lentos.'); }
    if (ex.motor === 'switch' && d.gpu && !esAdreno(d.gpu)) { p -= 15; razones.push('La emulación de Switch está muy optimizada para Adreno.'); }
    ex.notas.forEach(n => razones.push('Es una ' + n + '.'));
    p = Math.max(3, Math.min(98, Math.round(p)));
    const veredicto = p >= 75 ? 'si' : p >= 55 ? 'probable' : p >= 35 ? 'dudoso' : 'no';
    const titulo = { si: 'Debería ir bien', probable: 'Probablemente funcione', dudoso: 'Puede ir justo', no: 'Difícilmente funcione' }[veredicto];
    if (veredicto !== 'si' && !ajustes.length) ajustes.push('Cierra las apps en segundo plano y activa el modo rendimiento', 'Baja la calidad gráfica en el menú del juego');
    return { veredicto, puntuacion: p, titulo, razones, ajustes: [...new Set(ajustes)].slice(0, 4), exigencia: ex, dispositivo: { ...d, gama } };
}

/** Veredicto + explicación de Nexus (si hay IA). */
const cache = new Map();
async function analizar(item, devRaw) {
    const base = evaluar(item, devRaw);
    const k = `${item._id}|${JSON.stringify(base.dispositivo)}`;
    if (cache.has(k)) return cache.get(k);
    let r = { ...base, resumen: null, fuente: null };
    if (base.veredicto !== 'no_aplica' && llm.disponible()) {
        const d = base.dispositivo;
        const ia = await llm.json(`Eres NEXUS, de UpGames. Le dices al usuario si una publicación le funcionará en su equipo.
El VEREDICTO ya está calculado: no lo cambies. Escribe en español claro, cercano y concreto. Devuelve SOLO JSON:
{"resumen":"1-2 frases para el usuario, nombrando su equipo si lo sabes","ajustes":["ajuste concreto 1","ajuste 2","ajuste 3"]}
Ajustes: máximo 4, prácticos para ESTE juego/app y ESTE equipo (resolución, renderizador, drivers, FPS, ajustes del emulador). No inventes datos del juego que no estén abajo.`,
        `Publicación: ${item.title} (${item.category})\nDescripción: ${String(item.description || '').slice(0, 600)}\nDatos: ${JSON.stringify(item.extraData || {}).slice(0, 300)}
Exigencia estimada: ${JSON.stringify(base.exigencia)}
Equipo: ${d.so}${d.version ? ' ' + d.version : ''}${d.modelo ? ', ' + d.modelo : ''}, GPU ${d.gpu || 'desconocida'} (gama ${d.gama ?? '?'}), RAM ${d.ramGB ?? '?'} GB, ${d.nucleos ?? '?'} núcleos
Veredicto: ${base.titulo} (${base.puntuacion}/100). Razones: ${base.razones.join(' | ')}`,
        { rapido: true, maxTokens: 320, temperatura: 0.3, timeout: 9000 }).catch(() => null);
        if (ia?.resumen) r = { ...r, resumen: String(ia.resumen).slice(0, 300), ajustes: (Array.isArray(ia.ajustes) && ia.ajustes.length ? ia.ajustes : base.ajustes).filter(x => typeof x === 'string').slice(0, 4).map(x => x.slice(0, 140)), fuente: ia._fuente };
    }
    delete r.exigencia;
    cache.set(k, r);
    if (cache.size > 3000) cache.delete(cache.keys().next().value);
    return r;
}

module.exports = { dispositivo, gamaGPU, exigencia, evaluar, analizar };
