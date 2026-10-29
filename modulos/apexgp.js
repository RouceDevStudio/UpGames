/**
 * APEX GP (games/monoplaza): catálogo de mejoras y cosméticos que se pagan con
 * UpCoins, validación de lo que equipa cada piloto y lógica de las salas
 * multijugador (sin red: rutas/apexgp.js la conecta a Socket.IO).
 */
'use strict';

const NIVELES = 5;
// Precio en UC de cada nivel (1..5) de cada mejora de rendimiento
const PRECIO_NIVEL = [60, 120, 200, 320, 500];
const MEJORAS = {
    motor:      { nombre: 'Motor',          desc: '+1,2 % de potencia por nivel' },
    aero:       { nombre: 'Aerodinámica',   desc: '+1 % de carga y −0,6 % de resistencia por nivel' },
    frenos:     { nombre: 'Frenos',         desc: '+3 % de par de frenada y mejor refrigeración por nivel' },
    chasis:     { nombre: 'Chasis ligero',  desc: '−3 kg por nivel' },
    neumaticos: { nombre: 'Neumáticos',     desc: '−6 % de desgaste y +0,4 % de agarre por nivel' },
    ers:        { nombre: 'ERS',            desc: '+5 % de despliegue y +4 % de recuperación por nivel' },
};

// Cosméticos: id → { tipo, nombre, precio } (precio 0 = gratis para todos)
const COSMETICOS = {
    'patron:lisa':       { tipo: 'patron', nombre: 'Lisa',             precio: 0 },
    'patron:franjas':    { tipo: 'patron', nombre: 'Franjas clásicas', precio: 0 },
    'patron:flecha':     { tipo: 'patron', nombre: 'Flecha',           precio: 60 },
    'patron:degradado':  { tipo: 'patron', nombre: 'Degradado',        precio: 80 },
    'patron:rayo':       { tipo: 'patron', nombre: 'Rayo',             precio: 100 },
    'patron:geometrico': { tipo: 'patron', nombre: 'Geométrico',       precio: 120 },
    'patron:digital':    { tipo: 'patron', nombre: 'Camuflaje digital', precio: 150 },
    'patron:llamas':     { tipo: 'patron', nombre: 'Llamas',           precio: 180 },
    'acabado:brillo':    { tipo: 'acabado', nombre: 'Brillo',          precio: 0 },
    'acabado:mate':      { tipo: 'acabado', nombre: 'Mate',            precio: 60 },
    'acabado:perlado':   { tipo: 'acabado', nombre: 'Perlado',         precio: 120 },
    'acabado:cromado':   { tipo: 'acabado', nombre: 'Cromado',         precio: 250 },
    'acabado:dorado':    { tipo: 'acabado', nombre: 'Oro',             precio: 400 },
    'casco:clasico':     { tipo: 'casco', nombre: 'Clásico',           precio: 0 },
    'casco:rayas':       { tipo: 'casco', nombre: 'Rayas',             precio: 40 },
    'casco:estrellas':   { tipo: 'casco', nombre: 'Estrellas',         precio: 70 },
    'casco:damero':      { tipo: 'casco', nombre: 'Damero',            precio: 70 },
    'casco:llamas':      { tipo: 'casco', nombre: 'Llamas',            precio: 100 },
    'casco:neon':        { tipo: 'casco', nombre: 'Neón',              precio: 120 },
    'livery:propia':     { tipo: 'livery', nombre: 'Librea propia (sube tu diseño)', precio: 150 },
};

const COLOR = /^#[0-9a-f]{6}$/i;
const EQUIPADO_DEF = {
    patron: 'franjas', acabado: 'brillo', casco: 'clasico', propia: false,
    colores: { base: '#0d47ff', acento: '#00e5ff', tercero: '#ffffff' },
    cascoColores: { base: '#ffffff', acento: '#0d47ff' },
    numero: 7,
    equipo: 0,
};

function catalogo() {
    return {
        niveles: NIVELES,
        mejoras: Object.entries(MEJORAS).map(([id, m]) => ({ id, ...m, precios: PRECIO_NIVEL })),
        cosmeticos: Object.entries(COSMETICOS).map(([id, c]) => ({ id, ...c })),
    };
}

/** Qué es lo que se quiere comprar y cuánto cuesta. null si no existe o ya está al máximo/comprado. */
function precioCompra(id, perfil) {
    const s = String(id || '');
    if (s.startsWith('mejora:')) {
        const m = s.slice(7);
        if (!MEJORAS[m]) return null;
        const nivel = Math.max(0, Math.floor(perfil?.mejoras?.[m] || 0));
        if (nivel >= NIVELES) return null;
        return { tipo: 'mejora', mejora: m, nivel, precio: PRECIO_NIVEL[nivel] };
    }
    if (s.startsWith('cosmetico:')) {
        const c = s.slice(10);
        const def = COSMETICOS[c];
        if (!def || def.precio <= 0) return null;
        if ((perfil?.cosmeticos || []).includes(c)) return null;
        return { tipo: 'cosmetico', cosmetico: c, precio: def.precio };
    }
    return null;
}

function tieneCosmetico(perfil, id) {
    const def = COSMETICOS[id];
    if (!def) return false;
    return def.precio === 0 || (perfil?.cosmeticos || []).includes(id);
}

/** Limpia lo que el piloto quiere equipar y descarta lo que no ha comprado. */
function validarEquipado(entrada, perfil) {
    const e = entrada && typeof entrada === 'object' ? entrada : {};
    const out = JSON.parse(JSON.stringify(EQUIPADO_DEF));
    for (const k of ['patron', 'acabado', 'casco']) {
        const v = String(e[k] || '');
        if (tieneCosmetico(perfil, `${k}:${v}`)) out[k] = v;
    }
    out.propia = !!e.propia && tieneCosmetico(perfil, 'livery:propia');
    for (const k of ['base', 'acento', 'tercero']) if (COLOR.test(e.colores?.[k] || '')) out.colores[k] = e.colores[k].toLowerCase();
    for (const k of ['base', 'acento']) if (COLOR.test(e.cascoColores?.[k] || '')) out.cascoColores[k] = e.cascoColores[k].toLowerCase();
    const n = Math.floor(+e.numero);
    if (n >= 1 && n <= 99) out.numero = n;
    // monoplaza elegido: 0 = UpGames Racing (diseño propio), 1..10 = equipos de la parrilla
    const eq = Math.floor(+e.equipo);
    out.equipo = eq >= 0 && eq <= 10 ? eq : 0;
    return out;
}

function nivelesMejoras(perfil) {
    const out = {};
    for (const k of Object.keys(MEJORAS)) out[k] = Math.max(0, Math.min(NIVELES, Math.floor(perfil?.mejoras?.[k] || 0)));
    return out;
}

// ─── Salas multijugador ─────────────────────────────────────────────────────
const MAX_JUGADORES = 22;
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ESTADO_LARGO = 18;               // números por paquete de estado
const VUELTA_MIN_S = 45;               // ninguna vuelta de ningún circuito baja de esto
const ESPERA_FIN_MS = 90000;           // tras el primero en meta

function limpiarNombre(n) {
    return String(n || '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 18) || 'Piloto';
}

class Salas {
    constructor({ ahora = () => Date.now(), azar = Math.random } = {}) {
        this.salas = new Map();       // código → sala
        this.de = new Map();          // socketId → código
        this.ahora = ahora;
        this.azar = azar;
    }

    _codigo() {
        for (let k = 0; k < 50; k++) {
            let c = '';
            for (let i = 0; i < 5; i++) c += LETRAS[Math.floor(this.azar() * LETRAS.length)];
            if (!this.salas.has(c)) return c;
        }
        throw new Error('sin códigos libres');
    }

    _jugador(id, j) {
        return {
            id, nombre: limpiarNombre(j?.nombre), usuario: j?.usuario || null,
            equipado: j?.equipado || EQUIPADO_DEF, mejoras: j?.mejoras || {}, livery: typeof j?.livery === 'string' ? j.livery : '',
            listo: false, estado: null, terminado: false, tiempo: null, mejor: null, abandono: false, unido: this.ahora(),
        };
    }

    crear(id, jugador, opc = {}) {
        if (this.de.has(id)) this.salir(id);
        const unoContraUno = opc.tipo === '1v1';
        const sala = {
            codigo: this._codigo(),
            tipo: unoContraUno ? '1v1' : 'abierta',
            max: unoContraUno ? 2 : Math.max(2, Math.min(MAX_JUGADORES, Math.floor(+opc.max) || MAX_JUGADORES)),
            vueltas: Math.max(1, Math.min(30, Math.floor(+opc.vueltas) || 3)),
            publica: opc.publica !== false,
            mejoras: !!opc.mejoras,            // ¿cuentan las mejoras compradas?
            circuito: circuitoOk(opc.circuito),
            clima: CLIMAS.includes(opc.clima) ? opc.clima : 'seco',
            semilla: Math.floor(this.azar() * 1e9),   // mismo tiempo variable para todos
            rapida: !!opc.rapida,
            nombre: limpiarNombre(opc.nombre || `Sala de ${limpiarNombre(jugador?.nombre)}`).slice(0, 24),
            host: id, estado: 'espera', jugadores: new Map(), parrilla: [], tSalida: 0, tPrimero: 0, creada: this.ahora(),
        };
        sala.jugadores.set(id, this._jugador(id, jugador));
        this.salas.set(sala.codigo, sala);
        this.de.set(id, sala.codigo);
        return { ok: true, sala };
    }

    unirse(id, codigo, jugador) {
        const sala = this.salas.get(String(codigo || '').toUpperCase().trim());
        if (!sala) return { ok: false, error: 'No existe ninguna sala con ese código' };
        if (sala.jugadores.has(id)) return { ok: true, sala };
        if (sala.estado !== 'espera') return { ok: false, error: 'La carrera ya empezó' };
        if (sala.jugadores.size >= sala.max) return { ok: false, error: 'La sala está llena' };
        if (this.de.has(id)) this.salir(id);
        sala.jugadores.set(id, this._jugador(id, jugador));
        this.de.set(id, sala.codigo);
        return { ok: true, sala };
    }

    salaDe(id) { return this.salas.get(this.de.get(id)); }

    salir(id) {
        const sala = this.salaDe(id);
        this.de.delete(id);
        if (!sala) return null;
        const j = sala.jugadores.get(id);
        if (sala.estado === 'carrera' && j && !j.terminado) {
            // quien se va en carrera queda como abandono en la clasificación
            j.abandono = true; j.desconectado = true;
            this._quizasTerminar(sala);
        } else sala.jugadores.delete(id);
        if (![...sala.jugadores.values()].some(x => !x.desconectado)) { this.salas.delete(sala.codigo); return { sala, borrada: true }; }
        if (sala.host === id) {
            const sig = [...sala.jugadores.values()].find(x => !x.desconectado);
            sala.host = sig.id;
        }
        return { sala, borrada: false };
    }

    listo(id, valor) {
        const sala = this.salaDe(id);
        const j = sala?.jugadores.get(id);
        if (!j || sala.estado !== 'espera') return null;
        j.listo = !!valor;
        return sala;
    }

    iniciar(id) {
        const sala = this.salaDe(id);
        if (!sala) return { ok: false, error: 'No estás en una sala' };
        if (sala.host !== id) return { ok: false, error: 'Solo quien creó la sala puede empezar' };
        if (sala.estado !== 'espera') return { ok: false, error: 'La carrera ya empezó' };
        const n = sala.jugadores.size;
        if (n < 2) return { ok: false, error: 'Hace falta al menos otro piloto' };
        if (sala.tipo === '1v1' && n !== 2) return { ok: false, error: 'El duelo es de 2 pilotos' };
        const noListos = [...sala.jugadores.values()].filter(j => j.id !== id && !j.listo).length;
        if (noListos) return { ok: false, error: `Faltan ${noListos} piloto(s) por marcar "Listo"` };
        // parrilla aleatoria
        const ids = [...sala.jugadores.keys()];
        for (let i = ids.length - 1; i > 0; i--) { const k = Math.floor(this.azar() * (i + 1)); [ids[i], ids[k]] = [ids[k], ids[i]]; }
        sala.parrilla = ids;
        sala.estado = 'carrera';
        // semáforo: 1,5 s + 5 luces + apagado aleatorio, todo decidido por el servidor
        sala.tSalida = this.ahora() + 8000 + Math.floor(this.azar() * 2000);
        sala.tInicio = this.ahora();
        for (const j of sala.jugadores.values()) { j.terminado = false; j.tiempo = null; j.abandono = false; j.mejor = null; }
        return { ok: true, sala };
    }

    /** Último estado de un coche (array de números). Devuelve la sala o null si se descarta. */
    estado(id, datos) {
        const sala = this.salaDe(id);
        const j = sala?.jugadores.get(id);
        if (!j || sala.estado !== 'carrera' || !Array.isArray(datos) || datos.length > ESTADO_LARGO) return null;
        const limpio = new Array(datos.length);
        for (let i = 0; i < datos.length; i++) {
            const v = +datos[i];
            if (!Number.isFinite(v) || Math.abs(v) > 1e6) return null;
            limpio[i] = Math.round(v * 1000) / 1000;
        }
        j.estado = limpio;
        return sala;
    }

    vuelta(id, t) {
        const sala = this.salaDe(id);
        const j = sala?.jugadores.get(id);
        const s = +t;
        if (!j || sala.estado !== 'carrera' || !(s >= VUELTA_MIN_S && s < 3600)) return null;
        if (j.mejor == null || s < j.mejor) j.mejor = Math.round(s * 1000) / 1000;
        return sala;
    }

    /** El cliente dice que cruzó la meta: se acepta si el tiempo es posible. */
    meta(id) {
        const sala = this.salaDe(id);
        const j = sala?.jugadores.get(id);
        if (!j || sala.estado !== 'carrera' || j.terminado) return null;
        const t = (this.ahora() - sala.tSalida) / 1000;
        if (t < sala.vueltas * Math.max(VUELTA_MIN_S, CIRCUITOS[sala.circuito]?.minVuelta || 0)) return null;
        j.terminado = true; j.tiempo = Math.round(t * 1000) / 1000;
        if (!sala.tPrimero) sala.tPrimero = this.ahora();
        this._quizasTerminar(sala);
        return sala;
    }

    abandono(id) {
        const sala = this.salaDe(id);
        const j = sala?.jugadores.get(id);
        if (!j || sala.estado !== 'carrera' || j.terminado) return null;
        j.abandono = true;
        this._quizasTerminar(sala);
        return sala;
    }

    _quizasTerminar(sala) {
        const todos = [...sala.jugadores.values()].every(j => j.terminado || j.abandono);
        const tarde = sala.tPrimero && this.ahora() - sala.tPrimero > ESPERA_FIN_MS;
        if (todos || tarde) sala.estado = 'fin';
        return sala.estado === 'fin';
    }

    /** Revisa salas cuyo plazo tras el ganador venció. Devuelve las que acaban de terminar. */
    revisarPlazos() {
        const out = [];
        for (const s of this.salas.values()) if (s.estado === 'carrera' && s.tPrimero && this._quizasTerminar(s)) out.push(s);
        return out;
    }

    /** Vuelve a la sala de espera tras la carrera (para la revancha). */
    reiniciar(id) {
        const sala = this.salaDe(id);
        if (!sala || sala.host !== id || sala.estado !== 'fin') return null;
        for (const [k, j] of sala.jugadores) if (j.desconectado) sala.jugadores.delete(k); else Object.assign(j, { listo: false, estado: null, terminado: false, tiempo: null, abandono: false, mejor: null });
        Object.assign(sala, { estado: 'espera', parrilla: [], tSalida: 0, tPrimero: 0 });
        return sala;
    }

    resultados(sala) {
        const js = [...sala.jugadores.values()];
        const fin = js.filter(j => j.terminado).sort((a, b) => a.tiempo - b.tiempo);
        const resto = js.filter(j => !j.terminado);
        return [...fin, ...resto].map((j, i) => ({ pos: i + 1, id: j.id, nombre: j.nombre, usuario: j.usuario, tiempo: j.tiempo, mejor: j.mejor, abandono: !j.terminado, desconectado: !!j.desconectado }));
    }

    publico(sala) {
        return {
            codigo: sala.codigo, tipo: sala.tipo, max: sala.max, vueltas: sala.vueltas, publica: sala.publica, mejoras: sala.mejoras,
            circuito: sala.circuito, clima: sala.clima, semilla: sala.semilla, rapida: sala.rapida,
            nombre: sala.nombre, host: sala.host, estado: sala.estado, parrilla: sala.parrilla, tSalida: sala.tSalida,
            jugadores: [...sala.jugadores.values()].map(j => ({ id: j.id, nombre: j.nombre, usuario: j.usuario, equipado: j.equipado,
                mejoras: sala.mejoras ? j.mejoras : {}, listo: j.listo, terminado: j.terminado, abandono: j.abandono })),
        };
    }

    listaPublica() {
        return [...this.salas.values()].filter(s => s.publica && s.estado === 'espera' && s.jugadores.size < s.max)
            .sort((a, b) => b.jugadores.size - a.jugadores.size).slice(0, 30)
            .map(s => ({ codigo: s.codigo, nombre: s.nombre, tipo: s.tipo, jugadores: s.jugadores.size, max: s.max, vueltas: s.vueltas, mejoras: s.mejoras, circuito: s.circuito, clima: s.clima }));
    }

    /** Paquete con los estados de todos los coches de la sala. */
    paquete(sala) {
        const out = [];
        for (const j of sala.jugadores.values()) if (j.estado && !j.desconectado) out.push([j.id, j.estado]);
        return out;
    }
}


// ─── Circuitos, premios, contrarreloj y ELO ───────────────────────────────
// Vuelta mínima plausible por circuito (s): el mejor tiempo posible con todas
// las mejoras, con margen. Por debajo, el tiempo se rechaza.
const CIRCUITOS = {
    valle:  { nombre: 'Valle Andino',      minVuelta: 62 },
    puerto: { nombre: 'Puerto Real',       minVuelta: 48 },
    veloz:  { nombre: 'Autódromo Veloz',   minVuelta: 50 },
};
const CLIMAS = ['seco', 'lluvia', 'variable'];
const circuitoOk = c => Object.prototype.hasOwnProperty.call(CIRCUITOS, c) ? c : 'valle';

// Premios del campeonato y de la contrarreloj semanal: UpCoins NO retirables
// (van al campo de monedas, como las compradas), de 5 en 5.
const PREMIOS = { 1: 15, 2: 10, 3: 5 };
const PREMIOS_DIA = 3;                 // carreras premiadas por día y piloto
const premioPosicion = pos => PREMIOS[pos] || 0;

/** ¿Una carrera de campeonato puede dar premio? (mínimos contra el abuso) */
function carreraPremiable(c) {
    return !!c && CIRCUITOS[c.circuito] && c.vueltas >= 3 && c.rivales >= 7 && ['normal', 'dificil', 'extremo'].includes(c.dificultad);
}

/** Valida el resultado de una carrera de campeonato contra su ficha (emitida por el servidor). */
function validarResultado(ficha, res, ahoraMs) {
    if (!carreraPremiable(ficha)) return { ok: false, error: 'Esta carrera no da premio (mínimo 3 vueltas, 7 rivales y dificultad normal)' };
    const pos = Math.floor(+res?.pos), tiempo = +res?.tiempo;
    if (!(pos >= 1 && pos <= ficha.rivales + 1)) return { ok: false, error: 'Posición no válida' };
    const minimo = ficha.vueltas * CIRCUITOS[ficha.circuito].minVuelta;
    if (!(tiempo >= minimo && tiempo < 4 * 3600)) return { ok: false, error: 'Tiempo imposible' };
    // la carrera tiene que haber durado de verdad (con 20 s de margen por la salida y la red)
    const real = (ahoraMs - ficha.t0) / 1000;
    if (real + 20 < tiempo || real < minimo) return { ok: false, error: 'La carrera terminó demasiado pronto' };
    if (real > 6 * 3600) return { ok: false, error: 'La ficha de la carrera caducó' };
    return { ok: true, pos, tiempo, premio: premioPosicion(pos) };
}

/** Semana ISO 'AAAA-Www' (lunes 00:00 UTC) de una fecha. */
function semanaDe(fecha = new Date()) {
    const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
    const dia = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dia);
    const ini = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const n = Math.ceil(((d - ini) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(n).padStart(2, '0')}`;
}
function semanaAnterior(fecha = new Date()) { return semanaDe(new Date(fecha.getTime() - 7 * 86400000)); }

const FANTASMA_HZ = 10;
const FANTASMA_MAX = 60000;            // caracteres del fantasma comprimido
/**
 * Fantasma: muestras a 10 Hz [x, z, rumbo, velocidad] codificadas como enteros.
 * Comprueba que su duración cuadre con el tiempo y que nada se teletransporte.
 */
function validarVuelta(circuito, tiempo, fantasma) {
    const c = CIRCUITOS[circuito];
    if (!c) return { ok: false, error: 'Circuito desconocido' };
    const t = +tiempo;
    if (!(t >= c.minVuelta && t < 600)) return { ok: false, error: 'Tiempo imposible' };
    if (typeof fantasma !== 'string' || fantasma.length > FANTASMA_MAX) return { ok: false, error: 'Fantasma no válido' };
    let m;
    try { m = JSON.parse(fantasma); } catch (_) { return { ok: false, error: 'Fantasma no válido' }; }
    if (!Array.isArray(m) || !m.every(v => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite))) return { ok: false, error: 'Fantasma no válido' };
    const esperadas = t * FANTASMA_HZ;
    if (Math.abs(m.length - esperadas) > 3) return { ok: false, error: 'El fantasma no cuadra con el tiempo' };
    for (let i = 1; i < m.length; i++) {
        const d = Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]) / 10;   // decímetros → m
        if (d > 110 / FANTASMA_HZ) return { ok: false, error: 'El fantasma se teletransporta' };
    }
    return { ok: true, tiempo: Math.round(t * 1000) / 1000 };
}

// ELO multijugador: todos contra todos dentro de la carrera
const ELO_INICIAL = 1200;
function eloTras(jugadores) {
    // jugadores: [{ usuario, elo, pos }] (pos 1 = mejor). Devuelve { usuario: nuevoElo }
    const n = jugadores.length, out = {};
    if (n < 2) return out;
    const K = 32 / (n - 1);
    for (const a of jugadores) {
        let d = 0;
        for (const b of jugadores) {
            if (a === b) continue;
            const esperado = 1 / (1 + 10 ** ((b.elo - a.elo) / 400));
            const real = a.pos < b.pos ? 1 : a.pos > b.pos ? 0 : 0.5;
            d += K * (real - esperado);
        }
        out[a.usuario] = Math.max(100, Math.round(a.elo + d));
    }
    return out;
}
const nivelElo = e => e >= 1800 ? 'Leyenda' : e >= 1550 ? 'Diamante' : e >= 1400 ? 'Oro' : e >= 1250 ? 'Plata' : 'Bronce';
const REGIONES = ['america', 'europa', 'asia', 'otra'];
const regionOk = r => (REGIONES.includes(r) ? r : 'otra');

/**
 * Cola de partida rápida: agrupa por región y ELO parecido. El margen de ELO
 * crece con la espera; tras 20 s se acepta cualquier región.
 */
class Emparejador {
    constructor({ ahora = () => Date.now(), maximo = 8, espera = 12000 } = {}) {
        this.cola = new Map();   // id → { id, elo, region, t, jugador }
        this.ahora = ahora; this.maximo = maximo; this.espera = espera;
    }
    entrar(id, jugador, elo, region) { this.cola.set(id, { id, jugador, elo: +elo || ELO_INICIAL, region: regionOk(region), t: this.ahora() }); return this.cola.size; }
    salir(id) { return this.cola.delete(id); }
    _compatibles(a, b, ahora) {
        const espera = Math.min(ahora - a.t, ahora - b.t) / 1000;
        const margen = 150 + 25 * espera;
        return Math.abs(a.elo - b.elo) <= margen && (a.region === b.region || espera >= 20);
    }
    /** Grupos listos para correr (se sacan de la cola). */
    emparejar() {
        const ahora = this.ahora(), grupos = [];
        const lista = [...this.cola.values()].sort((a, b) => a.t - b.t);
        const usados = new Set();
        for (const a of lista) {
            if (usados.has(a.id)) continue;
            const g = [a];
            for (const b of lista) if (b !== a && !usados.has(b.id) && g.length < this.maximo && g.every(x => this._compatibles(x, b, ahora))) g.push(b);
            if (g.length >= 2 && (g.length >= this.maximo || ahora - a.t >= this.espera)) {
                for (const x of g) { usados.add(x.id); this.cola.delete(x.id); }
                grupos.push(g);
            }
        }
        return grupos;
    }
}

module.exports = {
    CIRCUITOS, CLIMAS, circuitoOk, PREMIOS, PREMIOS_DIA, premioPosicion, carreraPremiable, validarResultado,
    semanaDe, semanaAnterior, FANTASMA_HZ, FANTASMA_MAX, validarVuelta, ELO_INICIAL, eloTras, nivelElo, REGIONES, regionOk, Emparejador,
    NIVELES, PRECIO_NIVEL, MEJORAS, COSMETICOS, EQUIPADO_DEF, MAX_JUGADORES, ESTADO_LARGO,
    catalogo, precioCompra, tieneCosmetico, validarEquipado, nivelesMejoras, limpiarNombre, Salas,
};
