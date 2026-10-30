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
const MAX_ESPECTADORES = 50;
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ESTADO_LARGO = 20;               // números por paquete de estado
const VUELTA_MIN_S = 45;               // ninguna vuelta de ningún circuito baja de esto
const ESPERA_FIN_MS = 90000;           // tras el primero en meta
const VEL_MAX = 115;                   // m/s (414 km/h): nadie va más rápido
const GRACIA_MS = 30000;               // tiempo para volver tras perder la conexión en carrera
const SOSPECHAS_MAX = 25;              // paquetes imposibles antes de descalificar

function limpiarNombre(n) {
    return String(n || '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 18) || 'Piloto';
}

class Salas {
    constructor({ ahora = () => Date.now(), azar = Math.random } = {}) {
        this.salas = new Map();       // código → sala
        this.de = new Map();          // socketId → código
        this.espect = new Map();      // socketId → código de la sala que mira (espectadores)
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
            licencia: LICENCIAS.includes(j?.licencia) ? j.licencia : 'D', sr: +j?.sr || SR_INICIAL, inc: null,
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
            vueltas: Math.max(1, Math.min(70, Math.floor(+opc.vueltas) || 3)),
            publica: opc.publica !== false,
            mejoras: !!opc.mejoras,            // ¿cuentan las mejoras compradas?
            licMin: LICENCIAS.includes(opc.licMin) ? opc.licMin : 'D',   // licencia mínima para entrar
            circuito: circuitoOk(opc.circuito),
            clima: CLIMAS.includes(opc.clima) ? opc.clima : 'seco',
            semilla: Math.floor(this.azar() * 1e9),   // mismo tiempo variable para todos
            rapida: !!opc.rapida,
            // partida rápida: clasificación previa (s) y pilotos de la IA que completan la parrilla
            clasifSeg: Math.max(0, Math.min(600, Math.floor(+opc.clasifSeg) || 0)),
            bots: [], tFinQ: 0,
            nombre: limpiarNombre(opc.nombre || `Sala de ${limpiarNombre(jugador?.nombre)}`).slice(0, 24),
            host: id, estado: 'espera', jugadores: new Map(), parrilla: [], tSalida: 0, tPrimero: 0, creada: this.ahora(),
        };
        // juez: crea la sala y la dirige (empezar) pero no corre; la ve como espectador
        if (opc.juez) { sala.juez = id; sala.nombre = limpiarNombre(opc.nombre || `Torneo de ${limpiarNombre(jugador?.nombre)}`).slice(0, 24); }
        else sala.jugadores.set(id, this._jugador(id, jugador));
        this.salas.set(sala.codigo, sala);
        this.de.set(id, sala.codigo);
        return { ok: true, sala };
    }

    unirse(id, codigo, jugador) {
        const sala = this.salas.get(String(codigo || '').toUpperCase().trim());
        if (!sala) return { ok: false, error: 'No existe ninguna sala con ese código' };
        if (sala.jugadores.has(id)) return { ok: true, sala };
        if (sala.estado !== 'espera') return { ok: false, error: 'La carrera ya empezó' };
        if (sala.jugadores.size + sala.bots.length >= sala.max) return { ok: false, error: 'La sala está llena' };
        if (nivelLicencia(jugador?.licencia) < nivelLicencia(sala.licMin)) return { ok: false, error: `Esta sala exige licencia ${sala.licMin} o superior` };
        if (this.de.has(id)) this.salir(id);
        sala.jugadores.set(id, this._jugador(id, jugador));
        this.de.set(id, sala.codigo);
        return { ok: true, sala };
    }

    salaDe(id) { return this.salas.get(this.de.get(id)); }

    /** Informe de incidentes del piloto (se manda junto a la meta o el abandono). */
    incidentes(id, d) {
        const j = this.salaDe(id)?.jugadores.get(id);
        if (!j || !d || typeof d !== 'object') return false;
        j.inc = limpiarIncidentes(d);
        return true;
    }

    /** Mirar una sala sin correr: no ocupa plaza ni casilla. */
    espectar(id, codigo) {
        const sala = this.salas.get(String(codigo || '').toUpperCase().trim());
        if (!sala) return { ok: false, error: 'No existe ninguna sala con ese código' };
        if (this.de.get(id) === sala.codigo && sala.juez === id) return { ok: true, sala };
        if (this.numEspectadores(sala) >= MAX_ESPECTADORES) return { ok: false, error: 'No caben más espectadores' };
        if (this.de.has(id)) this.salir(id);
        this.espect.set(id, sala.codigo);
        return { ok: true, sala };
    }

    dejarEspectar(id) {
        const c = this.espect.get(id);
        this.espect.delete(id);
        return c ? this.salas.get(c) || null : null;
    }

    numEspectadores(sala) {
        let n = sala.juez && this.de.get(sala.juez) === sala.codigo ? 1 : 0;
        for (const c of this.espect.values()) if (c === sala.codigo) n++;
        return n;
    }

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
        // la sala sigue viva mientras quede algún piloto o el juez que la dirige
        const juezDentro = sala.juez && sala.juez !== id && this.de.get(sala.juez) === sala.codigo;
        if (![...sala.jugadores.values()].some(x => !x.desconectado) && !juezDentro) {
            this.salas.delete(sala.codigo);
            for (const [e, c] of this.espect) if (c === sala.codigo) this.espect.delete(e);
            return { sala, borrada: true };
        }
        if (sala.host === id) {
            const sig = [...sala.jugadores.values()].find(x => !x.desconectado);
            sala.host = sig ? sig.id : sala.juez;
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
        if (n < 2 && !sala.oficial) return { ok: false, error: 'Hace falta al menos otro piloto' };   // el GP oficial sale aunque solo haya uno (con la IA)
        if (sala.tipo === '1v1' && n !== 2) return { ok: false, error: 'El duelo es de 2 pilotos' };
        const noListos = [...sala.jugadores.values()].filter(j => j.id !== id && !j.listo).length;
        if (noListos) return { ok: false, error: `Faltan ${noListos} piloto(s) por marcar "Listo"` };
        for (const j of sala.jugadores.values()) { j.terminado = false; j.tiempo = null; j.abandono = false; j.mejor = null; j.tQ = null; j.inc = null; }
        // partida rápida: la IA completa la parrilla hasta el máximo de la sala
        if (sala.rapida) this._crearBots(sala);
        if (sala.clasifSeg > 0) {
            sala.estado = 'clasif';
            sala.tFinQ = this.ahora() + sala.clasifSeg * 1000 + 6000;   // 6 s para cargar y salir a pista
            return { ok: true, sala, clasif: true };
        }
        // parrilla aleatoria
        const ids = [...sala.jugadores.keys(), ...sala.bots.map(b => b.id)];
        for (let i = ids.length - 1; i > 0; i--) { const k = Math.floor(this.azar() * (i + 1)); [ids[i], ids[k]] = [ids[k], ids[i]]; }
        this._salida(sala, ids);
        return { ok: true, sala };
    }

    _salida(sala, parrilla) {
        sala.parrilla = parrilla;
        sala.estado = 'carrera';
        // semáforo: 1,5 s + 5 luces + apagado aleatorio, todo decidido por el servidor
        sala.tSalida = this.ahora() + 9000 + Math.floor(this.azar() * 2000);
        sala.tInicio = this.ahora();
        sala.tPrimero = 0;
        for (const b of sala.bots) Object.assign(b, { terminado: false, tiempo: null, abandono: false });
    }

    _crearBots(sala) {
        const n = Math.max(0, sala.max - sala.jugadores.size);
        const minV = CIRCUITOS[sala.circuito]?.minVuelta || 60;
        sala.bots = Array.from({ length: n }, (_, k) => {
            const hab = Math.round((0.945 + this.azar() * 0.05) * 1000) / 1000;
            // vuelta de clasificación: el ritmo de la IA con algo de dispersión
            return { id: `bot:${k}`, k, hab, tQ: Math.round(minV * 1.285 / hab * (1 + (this.azar() - 0.5) * 0.01) * 1000) / 1000, estado: null, terminado: false, tiempo: null, abandono: false };
        });
    }

    /** Vuelta de clasificación de un piloto (se guarda la mejor). */
    vueltaQ(id, t) {
        const sala = this.salaDe(id);
        const j = sala?.jugadores.get(id);
        const s = +t;
        const min = Math.max(VUELTA_MIN_S, CIRCUITOS[sala?.circuito]?.minVuelta || 0);
        if (!j || sala.estado !== 'clasif' || !(s >= min && s < 600)) return null;
        if (j.tQ == null || s < j.tQ) j.tQ = Math.round(s * 1000) / 1000;
        return sala;
    }

    /** Tabla de la clasificación (personas y bots). */
    tablaQ(sala) {
        return [...[...sala.jugadores.values()].filter(j => !j.desconectado).map(j => ({ id: j.id, nombre: j.nombre, t: j.tQ })),
            ...sala.bots.map(b => ({ id: b.id, bot: b.k, t: b.tQ }))]
            .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity));
    }

    /** Salas cuya clasificación terminó: se forma la parrilla y se da la salida. */
    revisarClasif() {
        const out = [];
        for (const s of this.salas.values()) {
            if (s.estado !== 'clasif' || this.ahora() < s.tFinQ) continue;
            this._salida(s, this.tablaQ(s).map(x => x.id));
            out.push(s);
        }
        return out;
    }

    /** El anfitrión simula a los bots y manda su estado. */
    estadoBots(id, lista) {
        const sala = this.salaDe(id);
        if (!sala || sala.host !== id || sala.estado !== 'carrera' || !Array.isArray(lista) || lista.length > 22) return null;
        for (const it of lista) {
            if (!Array.isArray(it) || it.length !== 2) continue;
            const b = sala.bots.find(x => x.id === it[0]);
            const d = it[1];
            if (!b || !Array.isArray(d) || d.length > ESTADO_LARGO || !d.every(v => Number.isFinite(+v) && Math.abs(+v) <= 1e6)) continue;
            b.estado = d.map(v => Math.round(+v * 1000) / 1000);
        }
        return sala;
    }

    botMeta(id, botId) {
        const sala = this.salaDe(id);
        const b = sala?.bots.find(x => x.id === botId);
        if (!b || sala.host !== id || sala.estado !== 'carrera' || b.terminado) return null;
        const t = (this.ahora() - sala.tSalida) / 1000;
        if (t < sala.vueltas * Math.max(VUELTA_MIN_S, CIRCUITOS[sala.circuito]?.minVuelta || 0)) return null;
        b.terminado = true; b.tiempo = Math.round(t * 1000) / 1000;
        return sala;
    }

    botAbandono(id, botId) {
        const sala = this.salaDe(id);
        const b = sala?.bots.find(x => x.id === botId);
        if (!b || sala.host !== id || sala.estado !== 'carrera' || b.terminado) return null;
        b.abandono = true;
        return sala;
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
        // anti-trampas: posición y distancia recorrida tienen que ser físicamente posibles
        const ahora = this.ahora();
        if (j.tEstado) {
            const dt = Math.max(0.02, (ahora - j.tEstado) / 1000);
            const salto = Math.hypot(limpio[0] - (j.estado?.[0] ?? limpio[0]), limpio[1] - (j.estado?.[1] ?? limpio[1]));
            if (salto > VEL_MAX * dt * 1.3 + 25) {
                j.sospechas = (j.sospechas || 0) + 1;
                if (j.sospechas > SOSPECHAS_MAX && !j.terminado) { j.abandono = true; j.descalificado = true; this._quizasTerminar(sala); }
                return null;
            }
            // la distancia de carrera solo puede crecer a ritmo de coche
            if (Number.isFinite(limpio[11])) j.dist = Math.max(j.dist || 0, Math.min(limpio[11], (j.dist || 0) + VEL_MAX * dt * 1.3 + 30));
        } else if (Number.isFinite(limpio[11]) && j.dist == null) j.dist = Math.min(limpio[11], 400);
        j.tEstado = ahora;
        j.estado = limpio;
        return sala;
    }

    vuelta(id, t) {
        const sala = this.salaDe(id);
        const j = sala?.jugadores.get(id);
        const s = +t;
        const min = Math.max(VUELTA_MIN_S, CIRCUITOS[sala?.circuito]?.minVuelta || 0);
        if (!j || sala.estado !== 'carrera' || !(s >= min && s < 3600)) return null;
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
        // tiene que haber recorrido (de forma creíble) casi toda la distancia de la carrera
        const largo = CIRCUITOS[sala.circuito]?.largo;
        if (largo && j.tEstado && (j.dist || 0) < largo * sala.vueltas * 0.95) return null;
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

    /**
     * Conexión perdida: en carrera, un piloto con cuenta tiene GRACIA_MS para volver (su coche
     * sigue en la parrilla); los invitados o fuera de carrera salen como siempre.
     */
    desconectar(id) {
        const sala = this.salaDe(id);
        const j = sala?.jugadores.get(id);
        if (!sala || !j || sala.estado !== 'carrera' || j.terminado || j.abandono || !j.usuario) return this.salir(id);
        j.desconectado = true; j.tDesc = this.ahora();
        this.de.delete(id);
        return { sala, borrada: false, gracia: true };
    }

    /** Vuelve a la carrera con otra conexión: el piloto conserva coche, posición y tiempos. */
    reanudar(nuevoId, codigo, usuario) {
        const sala = this.salas.get(String(codigo || '').toUpperCase().trim());
        if (!usuario) return { ok: false, error: 'Solo los pilotos con cuenta pueden volver a la carrera' };
        if (!sala || sala.estado !== 'carrera') return { ok: false, error: 'La carrera ya no está en marcha' };
        const j = [...sala.jugadores.values()].find(x => x.usuario === usuario && x.desconectado && !x.abandono);
        if (!j || this.ahora() - j.tDesc > GRACIA_MS) return { ok: false, error: 'Ha pasado demasiado tiempo' };
        const viejo = j.id;
        if (this.de.has(nuevoId)) this.salir(nuevoId);
        sala.jugadores.delete(viejo);
        j.id = nuevoId; j.desconectado = false; j.tDesc = 0; j.tEstado = 0;
        // el orden de la parrilla (y el resto de la sala) se conserva con el id nuevo
        const m = new Map(); for (const [k, v] of sala.jugadores) m.set(k, v);
        sala.jugadores = new Map([...m, [nuevoId, j]]);
        sala.parrilla = sala.parrilla.map(x => x === viejo ? nuevoId : x);
        if (sala.host === viejo) sala.host = nuevoId;
        this.de.set(nuevoId, sala.codigo);
        return { ok: true, sala, viejo };
    }

    _quizasTerminar(sala) {
        // quien no volvió a tiempo tras perder la conexión queda como abandono
        for (const j of sala.jugadores.values()) if (j.desconectado && j.tDesc && !j.abandono && this.ahora() - j.tDesc > GRACIA_MS) j.abandono = true;
        const todos = [...sala.jugadores.values()].every(j => j.terminado || j.abandono);
        const tarde = sala.tPrimero && this.ahora() - sala.tPrimero > ESPERA_FIN_MS;
        if (todos || tarde) sala.estado = 'fin';
        return sala.estado === 'fin';
    }

    /** Revisa salas cuyo plazo tras el ganador venció. Devuelve las que acaban de terminar. */
    revisarPlazos() {
        const out = [];
        for (const s of this.salas.values()) if (s.estado === 'carrera' && (s.tPrimero || [...s.jugadores.values()].some(j => j.tDesc)) && this._quizasTerminar(s)) out.push(s);
        return out;
    }

    /** Vuelve a la sala de espera tras la carrera (para la revancha). */
    reiniciar(id) {
        const sala = this.salaDe(id);
        if (!sala || sala.host !== id || sala.estado !== 'fin') return null;
        for (const [k, j] of sala.jugadores) if (j.desconectado) sala.jugadores.delete(k); else Object.assign(j, { listo: false, estado: null, terminado: false, tiempo: null, abandono: false, mejor: null, tQ: null });
        Object.assign(sala, { estado: 'espera', parrilla: [], tSalida: 0, tPrimero: 0, bots: [], tFinQ: 0 });
        return sala;
    }

    resultados(sala) {
        const js = [...sala.jugadores.values(), ...sala.bots.map(b => ({ ...b, bot: b.k, nombre: null, usuario: null, mejor: null }))];
        const fin = js.filter(j => j.terminado).sort((a, b) => a.tiempo - b.tiempo);
        const resto = js.filter(j => !j.terminado);
        return [...fin, ...resto].map((j, i) => ({ pos: i + 1, id: j.id, nombre: j.nombre, usuario: j.usuario, bot: j.bot ?? null, tiempo: j.tiempo, mejor: j.mejor, abandono: !j.terminado, desconectado: !!j.desconectado, descalificado: !!j.descalificado, inc: j.inc || null, licencia: j.licencia || null }));
    }

    publico(sala) {
        return {
            codigo: sala.codigo, tipo: sala.tipo, max: sala.max, vueltas: sala.vueltas, publica: sala.publica, mejoras: sala.mejoras,
            circuito: sala.circuito, clima: sala.clima, semilla: sala.semilla, rapida: sala.rapida, licMin: sala.licMin,
            clasifSeg: sala.clasifSeg, tFinQ: sala.tFinQ, bots: sala.bots.map(b => ({ id: b.id, k: b.k, hab: b.hab, terminado: b.terminado, abandono: b.abandono })),
            nombre: sala.nombre, host: sala.host, estado: sala.estado, parrilla: sala.parrilla, tSalida: sala.tSalida,
            juez: sala.juez || null, espectadores: this.numEspectadores(sala),
            jugadores: [...sala.jugadores.values()].map(j => ({ id: j.id, nombre: j.nombre, usuario: j.usuario, equipado: j.equipado, licencia: j.licencia,
                mejoras: sala.mejoras ? j.mejoras : {}, listo: j.listo, terminado: j.terminado, abandono: j.abandono })),
        };
    }

    listaPublica() {
        // abiertas con sitio (para unirse) y en marcha (para verlas como espectador)
        return [...this.salas.values()].filter(s => s.publica && ((s.estado === 'espera' && s.jugadores.size < s.max) || s.estado === 'carrera' || s.estado === 'clasif'))
            .sort((a, b) => (a.estado === 'espera' ? 0 : 1) - (b.estado === 'espera' ? 0 : 1) || b.jugadores.size - a.jugadores.size).slice(0, 30)
            .map(s => ({ codigo: s.codigo, nombre: s.nombre, tipo: s.tipo, jugadores: s.jugadores.size + s.bots.length, max: s.max, vueltas: s.vueltas, mejoras: s.mejoras, circuito: s.circuito, clima: s.clima, licMin: s.licMin,
                estado: s.estado, espectadores: this.numEspectadores(s), juez: !!s.juez }));
    }

    /** Paquete con los estados de todos los coches de la sala. */
    paquete(sala) {
        const out = [];
        for (const j of sala.jugadores.values()) if (j.estado && !j.desconectado) out.push([j.id, j.estado]);
        for (const b of sala.bots) if (b.estado) out.push([b.id, b.estado]);
        return out;
    }
}


// ─── Circuitos, premios, contrarreloj y ELO ───────────────────────────────
// Vuelta mínima plausible por circuito (s): el mejor tiempo posible con todas
// las mejoras, con margen. Por debajo, el tiempo se rechaza.
const CIRCUITOS = {
    valle:  { nombre: 'Valle Andino',      minVuelta: 62, largo: 4356 },
    puerto: { nombre: 'Puerto Real',       minVuelta: 48, largo: 2949 },
    veloz:  { nombre: 'Autódromo Veloz',   minVuelta: 50, largo: 4097 },
    // trazados reales con otros nombres (vuelta mínima ≈ 78 % del ritmo de la IA)
    principado:  { nombre: 'Circuito Urbano del Principado', minVuelta: 63, largo: 3343 },
    parque_real: { nombre: 'Autódromo del Parque Real',      minVuelta: 72, largo: 5795 },
    ardenas:     { nombre: 'Circuito de las Ardenas',        minVuelta: 96, largo: 7010 },
    aerodromo:   { nombre: 'Circuito del Viejo Aeródromo',   minVuelta: 88, largo: 5897 },
    levante:     { nombre: 'Circuito de Levante',            minVuelta: 71, largo: 4658 },
    alpino:      { nombre: 'Anillo Alpino',                  minVuelta: 62, largo: 4322 },
    danubio:     { nombre: 'Circuito del Danubio',           minVuelta: 75, largo: 4384 },
    dunas:       { nombre: 'Circuito de las Dunas',          minVuelta: 70, largo: 4266 },
    desierto:    { nombre: 'Circuito del Desierto',          minVuelta: 85, largo: 5418 },
    isla:        { nombre: 'Circuito de la Isla',            minVuelta: 66, largo: 4365 },
    bahia:       { nombre: 'Circuito Urbano de la Bahía',    minVuelta: 85, largo: 4935 },
    bulevar:     { nombre: 'Gran Bulevar Nocturno',          minVuelta: 82, largo: 6209 },
};
const CLIMAS = ['seco', 'lluvia', 'variable'];
const circuitoOk = c => Object.prototype.hasOwnProperty.call(CIRCUITOS, c) ? c : 'valle';

// UpCoins NO retirables (van al campo de monedas, como las compradas), de 5 en 5,
// y SOLO para los 5 primeros del ranking mundial de cada semana (campeonato y
// contrarreloj de cada circuito). Las carreras sueltas no dan UpCoins: dan puntos.
const PREMIOS = { 1: 15, 2: 10, 3: 5, 4: 5, 5: 5 };
const TOP_PREMIADO = 5;
const premioPosicion = pos => PREMIOS[pos] || 0;
// Puntos del ranking mundial por carrera de campeonato (como en la F1)
const PUNTOS_CARRERA = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const CARRERAS_DIA = 6;                // carreras que puntúan por día y piloto
const DIFICULTAD_EXTRA = { normal: 1, dificil: 1.2, extremo: 1.4 };

/** ¿Una carrera de campeonato puntúa en el ranking mundial? (mínimos contra el abuso) */
function carreraPuntuable(c) {
    return !!c && !!CIRCUITOS[c.circuito] && c.vueltas >= 3 && c.rivales >= 7 && Object.prototype.hasOwnProperty.call(DIFICULTAD_EXTRA, c.dificultad);
}

/** Puntos mundiales de una posición: los de la F1 con un extra por dificultad (enteros). */
function puntosCarrera(pos, dificultad) {
    return Math.round((PUNTOS_CARRERA[pos - 1] || 0) * (DIFICULTAD_EXTRA[dificultad] || 1));
}

/** Valida el resultado de una carrera de campeonato contra su ficha (emitida por el servidor). */
function validarResultado(ficha, res, ahoraMs) {
    if (!carreraPuntuable(ficha)) return { ok: false, error: 'Esta carrera no puntúa (mínimo 3 vueltas, 7 rivales y dificultad normal)' };
    const pos = Math.floor(+res?.pos), tiempo = +res?.tiempo;
    if (!(pos >= 1 && pos <= ficha.rivales + 1)) return { ok: false, error: 'Posición no válida' };
    const minimo = ficha.vueltas * CIRCUITOS[ficha.circuito].minVuelta;
    if (!(tiempo >= minimo && tiempo < 4 * 3600)) return { ok: false, error: 'Tiempo imposible' };
    // la carrera tiene que haber durado de verdad (con 20 s de margen por la salida y la red)
    const real = (ahoraMs - ficha.t0) / 1000;
    if (real + 20 < tiempo || real < minimo) return { ok: false, error: 'La carrera terminó demasiado pronto' };
    if (real > 6 * 3600) return { ok: false, error: 'La ficha de la carrera caducó' };
    return { ok: true, pos, tiempo, puntos: puntosCarrera(pos, ficha.dificultad) };
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
// Licencias y safety rating (SR, 0..5): las carreras limpias suben el SR; contactos,
// sanciones y límites de pista lo bajan. La licencia exige SR, experiencia y nivel.
const SR_INICIAL = 2.5;
const LICENCIAS = ['D', 'C', 'B', 'A', 'Pro'];
function licenciaDe(sr = SR_INICIAL, carreras = 0, elo = ELO_INICIAL) {
    if (sr >= 4 && carreras >= 30 && elo >= 1550) return 'Pro';
    if (sr >= 3.5 && carreras >= 15) return 'A';
    if (sr >= 3 && carreras >= 8) return 'B';
    if (sr >= 2 && carreras >= 3) return 'C';
    return 'D';
}
const nivelLicencia = l => Math.max(0, LICENCIAS.indexOf(l));
/** Informe de incidentes que manda el cliente al acabar (acotado: no se fía de números absurdos). */
function limpiarIncidentes(d) {
    const n = (v, max) => Math.max(0, Math.min(max, Math.floor(+v) || 0));
    return { vueltas: n(d?.vueltas, 200), contactos: n(d?.contactos, 99), sanciones: n(d?.sanciones, 99), limites: n(d?.limites, 99) };
}
/** SR tras una carrera: +0,05 por vuelta limpia (máx. +0,4), −0,15 por contacto, −0,3 por sanción, −0,05 por límites. */
function srTras(sr = SR_INICIAL, inc = {}, abandono = false) {
    const i = limpiarIncidentes(inc);
    const sucias = i.contactos + i.sanciones + i.limites;
    const limpias = Math.max(0, i.vueltas - sucias);
    let d = Math.min(0.4, limpias * 0.05) - i.contactos * 0.15 - i.sanciones * 0.3 - i.limites * 0.05;
    if (abandono && !i.vueltas) d -= 0.1;             // irse en la primera vuelta también cuenta
    return Math.round(Math.max(0, Math.min(5, sr + d)) * 100) / 100;
}
const nivelElo = e => e >= 1800 ? 'Leyenda' : e >= 1550 ? 'Diamante' : e >= 1400 ? 'Oro' : e >= 1250 ? 'Plata' : 'Bronce';
const REGIONES = ['america', 'europa', 'asia', 'otra'];
const regionOk = r => (REGIONES.includes(r) ? r : 'otra');

/**
 * Cola de partida rápida: agrupa por región y ELO parecido. El margen de ELO
 * crece con la espera; tras 20 s se acepta cualquier región.
 */
class Emparejador {
    constructor({ ahora = () => Date.now(), maximo = MAX_JUGADORES, espera = 45000 } = {}) {
        this.cola = new Map();   // id → { id, elo, region, t, jugador }
        this.ahora = ahora; this.maximo = maximo; this.espera = espera;
    }
    entrar(id, jugador, elo, region, sr = SR_INICIAL) { this.cola.set(id, { id, jugador, elo: +elo || ELO_INICIAL, region: regionOk(region), sr: +sr || 0, t: this.ahora() }); return this.cola.size; }
    salir(id) { return this.cola.delete(id); }
    _compatibles(a, b, ahora) {
        const espera = Math.min(ahora - a.t, ahora - b.t) / 1000;
        const margen = 150 + 25 * espera;
        // quien conduce sucio (SR < 2) corre con los suyos durante el primer minuto
        const limpio = (a.sr >= 2) === (b.sr >= 2) || espera >= 60;
        return Math.abs(a.elo - b.elo) <= margen && (a.region === b.region || espera >= 20) && limpio;
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

// ─── GP Oficial: carrera en línea a hora fija, cada 2 horas en punto (UTC) ───
// Todos los que se apunten corren en la misma sala; la IA completa la parrilla. El circuito
// rota y de vez en cuando hay clima variable; las inscripciones abren 10 minutos antes.
const OFICIAL_CADA = 2 * 3600 * 1000, OFICIAL_ABRE = 10 * 60 * 1000;
const OFICIAL_ROTA = ['valle', 'principado', 'levante', 'bahia', 'veloz', 'ardenas', 'alpino', 'aerodromo', 'puerto', 'danubio', 'parque_real', 'bulevar', 'isla', 'dunas', 'desierto'].filter(c => CIRCUITOS[c]);
function oficialDe(ahora = Date.now()) {
    const slot = Math.floor(ahora / OFICIAL_CADA) + 1;           // la próxima hora en punto
    const inicio = slot * OFICIAL_CADA;
    const h = (slot * 2654435761) >>> 0;
    return { slot, inicio, abre: inicio - OFICIAL_ABRE, circuito: OFICIAL_ROTA[slot % OFICIAL_ROTA.length], clima: h % 5 === 0 ? 'variable' : 'seco', vueltas: 12 };
}

module.exports = {
    oficialDe, OFICIAL_CADA, OFICIAL_ABRE,
    CIRCUITOS, CLIMAS, circuitoOk, PREMIOS, TOP_PREMIADO, premioPosicion, PUNTOS_CARRERA, CARRERAS_DIA, carreraPuntuable, puntosCarrera, validarResultado,
    semanaDe, semanaAnterior, FANTASMA_HZ, FANTASMA_MAX, validarVuelta, ELO_INICIAL, eloTras, nivelElo, SR_INICIAL, LICENCIAS, licenciaDe, nivelLicencia, limpiarIncidentes, srTras, REGIONES, regionOk, Emparejador,
    NIVELES, PRECIO_NIVEL, MEJORAS, COSMETICOS, EQUIPADO_DEF, MAX_JUGADORES, ESTADO_LARGO,
    catalogo, precioCompra, tieneCosmetico, validarEquipado, nivelesMejoras, limpiarNombre, Salas,
};
