/**
 * Tests de APEX GP: catálogo, compras con UpCoins (rutas/apexgp.js con modelos simulados)
 * y la lógica de las salas multijugador (modulos/apexgp.js).
 * Autónomo: `node test/apexgp.test.js` (o `npm test`).
 */
'use strict';

const assert = require('assert');
const mongoose = require('mongoose');
const A = require('../modulos/apexgp');

let passed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; }
}

// ─── Modelos en memoria ────────────────────────────────────────────────────
const consulta = v => ({ select() { return this; }, lean: async () => (v ? JSON.parse(JSON.stringify(v)) : v), then: (a, b) => Promise.resolve(v).then(a, b) });
function crearMundo(monedas) {
    const usuarios = { ana: { usuario: 'ana', monedas, saldo: 0 }, beto: { usuario: 'beto', monedas: 0, saldo: 0 }, caro: { usuario: 'caro', monedas: 0, saldo: 0 } };
    const perfiles = new Map();
    const txs = new Map();
    const Usuario = {
        findOne: f => consulta(usuarios[f.usuario] || null),
        findOneAndUpdate: (f, pipeline) => {
            const u = usuarios[f.usuario];
            const uc = f.$expr.$gte[1] + 1e-9;
            if (!u || u.monedas < uc - 1e-6) return consulta(null);
            const antes = { ...u };
            u.monedas -= Math.round(uc);
            void pipeline;
            return consulta(antes);
        },
        updateOne: async (f, upd) => { const u = usuarios[f.usuario]; u.monedas += upd.$inc.monedas || 0; return { matchedCount: 1 }; },
    };
    const LiveTx = {
        exists: async f => txs.has(f.ref),
        create: async d => { if (txs.has(d.ref)) { const e = new Error('dup'); e.code = 11000; throw e; } txs.set(d.ref, d); return d; },
        deleteOne: async f => { txs.delete(f.ref); },
        countDocuments: async f => [...txs.values()].filter(t => t.usuario === f.usuario && t.planId === f.planId).length,
    };
    // tiempos de contrarreloj: find/findOne con sort por tiempo
    const tiempos = [];
    const filtra = f => tiempos.filter(t => Object.entries(f).every(([k, v]) => (v && typeof v === 'object' && '$lt' in v ? t[k] < v.$lt : t[k] === v)));
    const cursor = arr => { const c = { sort() { arr.sort((a, b) => a.tiempo - b.tiempo); return c; }, limit(n) { arr = arr.slice(0, n); return c; }, select() { return c; }, lean: async () => JSON.parse(JSON.stringify(arr)) }; return c; };
    const Tiempo = {
        find: f => cursor(filtra(f)),
        findOne: f => { const c = cursor(filtra(f)); const lean = c.lean; c.lean = async () => (await lean())[0] || null; return c; },
        countDocuments: async f => filtra(f).length,
        updateOne: async (f, upd, opc = {}) => {
            const t = filtra(f)[0];
            if (t) { Object.assign(t, upd.$set); return { matchedCount: 1 }; }
            if (opc.upsert) { const { tiempo, ...clave } = f; void tiempo; tiempos.push({ ...clave, ...upd.$set }); return { upsertedCount: 1 }; }
            return { matchedCount: 0 };
        },
    };
    mongoose.models.ApexTiempo = Tiempo;
    // colección genérica en memoria: find/findOne/countDocuments/updateOne/create con $gt y $gte
    const coleccion = (unicos = []) => {
        const docs = [];
        const cumple = (d, f) => Object.entries(f).every(([k, v]) => {
            if (v && typeof v === 'object' && !(v instanceof Date)) return ('$gt' in v ? d[k] > v.$gt : true) && ('$gte' in v ? d[k] >= v.$gte : true);
            return d[k] === v;
        });
        const cur = arr => { const c = { sort(o) { const [k, dir] = Object.entries(o)[0]; arr.sort((a, b) => (a[k] - b[k]) * dir); return c; }, limit(n) { arr = arr.slice(0, n); return c; }, select() { return c; }, lean: async () => JSON.parse(JSON.stringify(arr)) }; return c; };
        return {
            docs,
            find: f => cur(docs.filter(d => cumple(d, f))),
            findOne: f => { const c = cur(docs.filter(d => cumple(d, f))); const l = c.lean; c.lean = async () => (await l())[0] || null; return c; },
            countDocuments: async f => docs.filter(d => cumple(d, f)).length,
            create: async d => { if (unicos.some(k => docs.some(x => x[k] === d[k]))) { const e = new Error('dup'); e.code = 11000; throw e; } docs.push({ fecha: new Date(), ...d }); return d; },
            updateOne: async (f, upd, opc = {}) => {
                let d = docs.find(x => cumple(x, f));
                if (!d) { if (!opc.upsert) return { matchedCount: 0 }; d = { ...f }; docs.push(d); }
                for (const [k, v] of Object.entries(upd.$inc || {})) d[k] = (d[k] || 0) + v;
                Object.assign(d, upd.$set || {});
                return { matchedCount: 1 };
            },
        };
    };
    const Mundial = coleccion(), Resultado = coleccion(['ref']);
    mongoose.models.ApexMundial = Mundial;
    mongoose.models.ApexResultado = Resultado;
    const Perfil = {
        findOne: f => consulta(perfiles.get(f.usuario) || null),
        updateOne: async (f, upd, opc = {}) => {
            let p = perfiles.get(f.usuario);
            const coincide = d => {
                if (!d) return false;
                for (const [k, v] of Object.entries(f)) {
                    if (k === 'usuario') continue;
                    if (k === '$or') { if (!v.some(o => { const [c, val] = Object.entries(o)[0]; const x = c.split('.').reduce((a, b) => a?.[b], d); return val.$exists === false ? x === undefined : x === val; })) return false; continue; }
                    if (k.split('.').reduce((a, b) => a?.[b], d) !== v) return false;
                }
                return true;
            };
            if (p && !coincide(p)) {
                if (opc.upsert) { const e = new Error('dup'); e.code = 11000; throw e; }
                return { matchedCount: 0 };
            }
            let up = 0;
            if (!p) { if (!opc.upsert) return { matchedCount: 0 }; p = { usuario: f.usuario, mejoras: {}, cosmeticos: [] }; perfiles.set(f.usuario, p); up = 1; }
            for (const [k, v] of Object.entries(upd.$set || {})) { const [a, b] = k.split('.'); if (b) { p[a] = p[a] || {}; p[a][b] = v; } else p[a] = v; }
            for (const [k, v] of Object.entries(upd.$addToSet || {})) { p[k] = p[k] || []; if (!p[k].includes(v)) p[k].push(v); }
            return { matchedCount: up ? 0 : 1, upsertedCount: up };
        },
    };
    mongoose.models.ApexPerfil = Perfil;
    const rutas = {};
    const app = { get: (r, ...h) => { rutas['GET ' + r] = h.at(-1); }, post: (r, ...h) => { rutas['POST ' + r] = h.at(-1); }, put: (r, ...h) => { rutas['PUT ' + r] = h.at(-1); } };
    delete require.cache[require.resolve('../rutas/apexgp')];
    const r = require('../rutas/apexgp').registrar(app, { verificarToken: () => {}, Usuario, LiveTx, io: null, logger: { info() {}, error() {} }, JWT_SECRET: 'secreto-de-prueba' });
    const llamar = (ruta, body, usuario = 'ana', query = {}) => new Promise(resolve => {
        const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, json(d) { resolve({ code: this.code, ...d }); } };
        rutas[ruta]({ usuario, body, query }, res);
    });
    return { usuarios, perfiles, txs, tiempos, Mundial, Resultado, llamar, premiarSemana: r.premiarSemana };
}

(async () => {
    await test('catálogo: 6 mejoras de 5 niveles y cosméticos gratis y de pago', () => {
        const c = A.catalogo();
        assert.strictEqual(c.mejoras.length, 6);
        assert.ok(c.mejoras.every(m => m.precios.length === 5));
        assert.ok(c.cosmeticos.some(x => x.precio === 0) && c.cosmeticos.some(x => x.precio > 0));
    });
    await test('precioCompra: sube de nivel, se detiene en el máximo, no vende gratis ni repetidos', () => {
        assert.deepStrictEqual(A.precioCompra('mejora:motor', {}), { tipo: 'mejora', mejora: 'motor', nivel: 0, precio: 60 });
        assert.strictEqual(A.precioCompra('mejora:motor', { mejoras: { motor: 2 } }).precio, 200);
        assert.strictEqual(A.precioCompra('mejora:motor', { mejoras: { motor: 5 } }), null);
        assert.strictEqual(A.precioCompra('mejora:turbo', {}), null);
        assert.strictEqual(A.precioCompra('cosmetico:patron:lisa', {}), null);
        assert.strictEqual(A.precioCompra('cosmetico:patron:rayo', { cosmeticos: ['patron:rayo'] }), null);
        assert.strictEqual(A.precioCompra('cosmetico:acabado:cromado', {}).precio, 250);
    });
    await test('validarEquipado: descarta lo no comprado y colores inválidos', () => {
        const e = A.validarEquipado({ patron: 'rayo', acabado: 'mate', casco: 'clasico', colores: { base: '#FF0000', acento: 'rojo' }, numero: 150, propia: true }, { cosmeticos: ['acabado:mate'] });
        assert.strictEqual(e.patron, 'franjas');
        assert.strictEqual(e.acabado, 'mate');
        assert.strictEqual(e.colores.base, '#ff0000');
        assert.strictEqual(e.colores.acento, A.EQUIPADO_DEF.colores.acento);
        assert.strictEqual(e.numero, 7);
        assert.strictEqual(e.propia, false);
        assert.strictEqual(e.equipo, 0);
        assert.strictEqual(A.validarEquipado({ equipo: 4 }, {}).equipo, 4);
        assert.strictEqual(A.validarEquipado({ equipo: 99 }, {}).equipo, 0);
    });

    await test('comprar: cobra, sube el nivel y no cobra dos veces el mismo nivel', async () => {
        const m = crearMundo(1000);
        const r = await m.llamar('POST /apexgp/comprar', { id: 'mejora:motor', clave: 'clave-0001' });
        assert.strictEqual(r.success, true, JSON.stringify(r));
        assert.strictEqual(r.mejoras.motor, 1);
        assert.strictEqual(m.usuarios.ana.monedas, 940);
        const r2 = await m.llamar('POST /apexgp/comprar', { id: 'mejora:motor', clave: 'clave-0002' });
        assert.strictEqual(r2.mejoras.motor, 2);
        assert.strictEqual(m.usuarios.ana.monedas, 820);
        assert.strictEqual(m.txs.size, 2);
    });
    await test('comprar: sin saldo → 402 y nada cambia', async () => {
        const m = crearMundo(10);
        const r = await m.llamar('POST /apexgp/comprar', { id: 'cosmetico:acabado:cromado', clave: 'clave-0003' });
        assert.strictEqual(r.code, 402);
        assert.strictEqual(m.usuarios.ana.monedas, 10);
        assert.strictEqual(m.txs.size, 0);
    });
    await test('comprar: cosmético una sola vez', async () => {
        const m = crearMundo(1000);
        assert.strictEqual((await m.llamar('POST /apexgp/comprar', { id: 'cosmetico:patron:rayo', clave: 'clave-0004' })).success, true);
        const r = await m.llamar('POST /apexgp/comprar', { id: 'cosmetico:patron:rayo', clave: 'clave-0005' });
        assert.strictEqual(r.code, 400);
        assert.strictEqual(m.usuarios.ana.monedas, 900);
    });
    await test('comprar: dos compras simultáneas del mismo nivel cobran una sola vez', async () => {
        const m = crearMundo(1000);
        const [a, b] = await Promise.all([
            m.llamar('POST /apexgp/comprar', { id: 'mejora:aero', clave: 'clave-0006' }),
            m.llamar('POST /apexgp/comprar', { id: 'mejora:aero', clave: 'clave-0007' }),
        ]);
        assert.ok(a.success || b.success);
        assert.strictEqual(m.perfiles.get('ana').mejoras.aero, 1);
        assert.strictEqual(m.usuarios.ana.monedas, 940);
    });
    await test('comprar: clave inválida o producto inventado → 400', async () => {
        const m = crearMundo(1000);
        assert.strictEqual((await m.llamar('POST /apexgp/comprar', { id: 'mejora:motor', clave: 'x' })).code, 400);
        assert.strictEqual((await m.llamar('POST /apexgp/comprar', { id: 'mejora:nitro', clave: 'clave-0008' })).code, 400);
        assert.strictEqual(m.usuarios.ana.monedas, 1000);
    });

    // ─── Salas ─────────────────────────────────────────────────────────────
    let reloj = 1_000_000;
    const nueva = () => new A.Salas({ ahora: () => reloj, azar: (() => { let s = 7; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); })() });
    await test('salas: duelo 1v1 admite 2 y empieza cuando el rival está listo', () => {
        const S = nueva();
        const { sala } = S.crear('a', { nombre: 'Ana' }, { tipo: '1v1', vueltas: 3 });
        assert.strictEqual(sala.max, 2);
        assert.ok(S.unirse('b', sala.codigo, { nombre: 'Beto' }).ok);
        assert.strictEqual(S.unirse('c', sala.codigo, { nombre: 'Caro' }).error, 'La sala está llena');
        assert.match(S.iniciar('a').error, /Listo/);
        S.listo('b', true);
        assert.strictEqual(S.iniciar('b').error, 'Solo quien creó la sala puede empezar');
        const r = S.iniciar('a');
        assert.ok(r.ok);
        assert.strictEqual(sala.estado, 'carrera');
        assert.strictEqual(sala.parrilla.length, 2);
        assert.ok(sala.tSalida > reloj);
    });
    await test('salas: hasta 22 pilotos en una sala abierta', () => {
        const S = nueva();
        const { sala } = S.crear('h', { nombre: 'Host' }, { tipo: 'abierta', max: 99 });
        assert.strictEqual(sala.max, 22);
        for (let i = 1; i < 22; i++) assert.ok(S.unirse('j' + i, sala.codigo, { nombre: 'P' + i }).ok);
        assert.strictEqual(S.unirse('extra', sala.codigo, {}).ok, false);
        assert.strictEqual(S.listaPublica().length, 0);   // llena: no se anuncia
    });
    await test('salas: estados se limpian y se rechazan los inválidos', () => {
        const S = nueva();
        const { sala } = S.crear('a', {}, { tipo: '1v1' });
        S.unirse('b', sala.codigo, {}); S.listo('b', true); S.iniciar('a');
        assert.ok(S.estado('a', [1.23456, 2, 3]));
        assert.deepStrictEqual(sala.jugadores.get('a').estado, [1.235, 2, 3]);
        assert.strictEqual(S.estado('a', [NaN]), null);
        assert.strictEqual(S.estado('a', new Array(50).fill(0)), null);
        assert.strictEqual(S.estado('a', 'hola'), null);
        assert.strictEqual(S.paquete(sala).length, 1);
    });
    await test('salas: la meta solo vale con un tiempo posible y ordena los resultados', () => {
        const S = nueva();
        const { sala } = S.crear('a', { nombre: 'Ana' }, { tipo: '1v1', vueltas: 2 });
        S.unirse('b', sala.codigo, { nombre: 'Beto' }); S.listo('b', true); S.iniciar('a');
        reloj = sala.tSalida + 30000;
        assert.strictEqual(S.meta('a'), null);              // 30 s para 2 vueltas: imposible
        reloj = sala.tSalida + 170000; S.meta('b');
        reloj = sala.tSalida + 172500; S.meta('a');
        assert.strictEqual(sala.estado, 'fin');
        const r = S.resultados(sala);
        assert.deepStrictEqual(r.map(x => x.nombre), ['Beto', 'Ana']);
        assert.strictEqual(r[1].tiempo, 172.5);
    });
    await test('salas: quien se va en carrera cuenta como abandono y el host pasa a otro', () => {
        const S = nueva();
        const { sala } = S.crear('a', {}, { tipo: 'abierta' });
        S.unirse('b', sala.codigo, {}); S.unirse('c', sala.codigo, {});
        S.listo('b', true); S.listo('c', true); S.iniciar('a');
        S.salir('a');
        assert.notStrictEqual(sala.host, 'a');
        assert.strictEqual(sala.jugadores.get('a').abandono, true);
        S.abandono('b'); S.abandono('c');
        assert.strictEqual(sala.estado, 'fin');
        assert.ok(S.resultados(sala).every(x => x.abandono));
    });
    await test('salas: la última persona en irse borra la sala', () => {
        const S = nueva();
        const { sala } = S.crear('a', {}, {});
        assert.strictEqual(S.salir('a').borrada, true);
        assert.strictEqual(S.salas.has(sala.codigo), false);
    });
    await test('salas: revancha devuelve a la espera sin los desconectados', () => {
        const S = nueva();
        const { sala } = S.crear('a', {}, { tipo: 'abierta' });
        S.unirse('b', sala.codigo, {}); S.unirse('c', sala.codigo, {});
        S.listo('b', true); S.listo('c', true); S.iniciar('a');
        S.salir('c'); S.abandono('a'); S.abandono('b');
        assert.ok(S.reiniciar('a'));
        assert.strictEqual(sala.estado, 'espera');
        assert.strictEqual(sala.jugadores.size, 2);
    });

    // ─── Campeonato, contrarreloj y ELO ───────────────────────────────────
    const ahoraReal = Date.now;
    const adelantar = s => { const base = ahoraReal(); Date.now = () => base + s * 1000; };
    const correr = async (m, pos, { usuario = 'ana', circuito = 'valle', vueltas = 5, dificultad = 'normal', seg = 5 * 70 } = {}) => {
        Date.now = ahoraReal;
        const f = await m.llamar('POST /apexgp/campeonato/carrera', { circuito, vueltas, rivales: 11, dificultad }, usuario);
        adelantar(seg);
        try { return { f, r: await m.llamar('POST /apexgp/campeonato/resultado', { ficha: f.ficha, pos, tiempo: seg - 2 }, usuario) }; } finally { Date.now = ahoraReal; }
    };
    await test('campeonato: una carrera da puntos al ranking mundial, nunca UpCoins, y la ficha no se reusa', async () => {
        const m = crearMundo(0);
        const { f, r } = await correr(m, 1);
        assert.strictEqual(f.puntuable, true);
        assert.strictEqual(r.puntos, 25, JSON.stringify(r));
        assert.strictEqual(r.posicion, 1);
        assert.strictEqual(m.usuarios.ana.monedas, 0);
        assert.strictEqual(m.txs.size, 0);
        adelantar(400);
        try { assert.strictEqual((await m.llamar('POST /apexgp/campeonato/resultado', { ficha: f.ficha, pos: 1, tiempo: 348 })).puntos, 0); } finally { Date.now = ahoraReal; }
        const rk = await m.llamar('GET /apexgp/campeonato/ranking', null, null, {});
        assert.deepStrictEqual(rk.filas.map(x => [x.usuario, x.puntos]), [['ana', 25]]);
    });
    await test('campeonato: puntos de F1 con extra por dificultad y máximo 6 carreras al día', async () => {
        const m = crearMundo(0);
        assert.strictEqual((await correr(m, 2, { dificultad: 'extremo' })).r.puntos, 25);    // 18 × 1,4
        assert.strictEqual((await correr(m, 11)).r.puntos, 0);
        for (let k = 0; k < 4; k++) await correr(m, 10);
        const tope = (await correr(m, 1)).r;
        assert.strictEqual(tope.puntos, 0); assert.strictEqual(tope.tope, true);
        assert.strictEqual(A.puntosCarrera(3, 'dificil'), 18);
    });
    await test('campeonato: no puntúa si dura menos de lo posible, es fácil o corta, o la ficha es falsa', async () => {
        const m = crearMundo(0);
        const f = await m.llamar('POST /apexgp/campeonato/carrera', { circuito: 'valle', vueltas: 5, rivales: 11, dificultad: 'normal' });
        assert.strictEqual((await m.llamar('POST /apexgp/campeonato/resultado', { ficha: f.ficha, pos: 1, tiempo: 5 * 69 })).code, 400);   // nada de tiempo real
        assert.strictEqual((await m.llamar('POST /apexgp/campeonato/resultado', { ficha: f.ficha, pos: 1, tiempo: 100 })).code, 400);
        assert.strictEqual((await m.llamar('POST /apexgp/campeonato/resultado', { ficha: f.ficha + 'x', pos: 1, tiempo: 400 })).code, 400);
        assert.strictEqual((await m.llamar('POST /apexgp/campeonato/resultado', { ficha: f.ficha, pos: 1, tiempo: 400 }, 'beto')).code, 400);
        const facil = await m.llamar('POST /apexgp/campeonato/carrera', { circuito: 'valle', vueltas: 5, rivales: 11, dificultad: 'facil' });
        assert.strictEqual(facil.puntuable, false);
        assert.strictEqual(A.carreraPuntuable({ circuito: 'valle', vueltas: 2, rivales: 11, dificultad: 'normal' }), false);
        assert.strictEqual(m.Mundial.docs.length, 0);
    });

    const fantasma = (seg, v = 60) => JSON.stringify(Array.from({ length: Math.round(seg * A.FANTASMA_HZ) }, (_, i) => [Math.round(i * v / A.FANTASMA_HZ * 10), 0, 0, v]));
    await test('validarVuelta: duración, teletransportes y tiempos imposibles', () => {
        assert.ok(A.validarVuelta('valle', 80, fantasma(80)).ok);
        assert.strictEqual(A.validarVuelta('valle', 40, fantasma(40)).ok, false);
        assert.strictEqual(A.validarVuelta('valle', 80, fantasma(60)).ok, false);
        assert.strictEqual(A.validarVuelta('valle', 80, fantasma(80, 200)).ok, false);
        assert.strictEqual(A.validarVuelta('valle', 80, 'basura').ok, false);
        assert.strictEqual(A.validarVuelta('marte', 80, fantasma(80)).ok, false);
    });
    await test('contrarreloj: guarda la mejor vuelta semanal y global, ranking y fantasma del récord', async () => {
        const m = crearMundo(0);
        const s = await m.llamar('POST /apexgp/contrarreloj/sesion', { circuito: 'valle' });
        const sb = await m.llamar('POST /apexgp/contrarreloj/sesion', { circuito: 'valle' }, 'beto');
        adelantar(300);
        try {
            const a = await m.llamar('POST /apexgp/contrarreloj/tiempo', { ficha: s.ficha, tiempo: 85, fantasma: fantasma(85) });
            assert.deepStrictEqual(a.mejorado, { semana: true, global: true }, JSON.stringify(a));
            const b = await m.llamar('POST /apexgp/contrarreloj/tiempo', { ficha: s.ficha, tiempo: 90, fantasma: fantasma(90) });
            assert.deepStrictEqual(b.mejorado, { semana: false, global: false });
            await m.llamar('POST /apexgp/contrarreloj/tiempo', { ficha: s.ficha, tiempo: 82, fantasma: fantasma(82) });
            await m.llamar('POST /apexgp/contrarreloj/tiempo', { ficha: sb.ficha, tiempo: 84, fantasma: fantasma(84) }, 'beto');
        } finally { Date.now = ahoraReal; }
        const rk = await m.llamar('GET /apexgp/contrarreloj/ranking', null, null, { circuito: 'valle' });
        assert.deepStrictEqual(rk.filas.map(f => [f.usuario, f.tiempo]), [['ana', 82], ['beto', 84]]);
        const g = await m.llamar('GET /apexgp/contrarreloj/fantasma', null, null, { circuito: 'valle', periodo: 'global' });
        assert.strictEqual(g.usuario, 'ana'); assert.strictEqual(JSON.parse(g.fantasma).length, 820);
        // una vuelta más larga que la sesión no vale
        const s2 = await m.llamar('POST /apexgp/contrarreloj/sesion', { circuito: 'valle' });
        assert.strictEqual((await m.llamar('POST /apexgp/contrarreloj/tiempo', { ficha: s2.ficha, tiempo: 80, fantasma: fantasma(80) })).code, 400);
    });
    await test('premios semanales: solo el top 5 mundial cobra 15/10/5/5/5 UC no retirables, una sola vez', async () => {
        const m = crearMundo(0);
        const sem = '2026-W40';
        const nombres = ['ana', 'beto', 'caro', 'dani', 'eva', 'fito'];
        for (const u of nombres) if (!m.usuarios[u]) m.usuarios[u] = { usuario: u, monedas: 0, saldo: 0 };
        nombres.forEach((u, i) => m.Mundial.docs.push({ usuario: u, semana: sem, puntos: 100 - i * 10 }));
        m.tiempos.push({ usuario: 'beto', circuito: 'veloz', semana: sem, tiempo: 70 });
        assert.strictEqual(await m.premiarSemana(sem), 6);
        assert.strictEqual(await m.premiarSemana(sem), 0);
        assert.deepStrictEqual(nombres.map(u => m.usuarios[u].monedas), [15, 25, 5, 5, 5, 0]);
        assert.ok(nombres.every(u => m.usuarios[u].saldo === 0));
        assert.ok([...m.txs.values()].every(t => t.tipo === 'mision' && t.usd === 0 && [5, 10, 15].includes(t.monedas)));
    });
    await test('semanaDe: semanas ISO', () => {
        assert.strictEqual(A.semanaDe(new Date('2026-01-01T12:00:00Z')), '2026-W01');
        assert.strictEqual(A.semanaDe(new Date('2026-10-29T12:00:00Z')), '2026-W44');
        assert.strictEqual(A.semanaAnterior(new Date('2026-10-29T12:00:00Z')), '2026-W43');
    });
    await test('ELO: gana quien queda delante, suma cero y pesa más ganar a alguien mejor', () => {
        const r = A.eloTras([{ usuario: 'a', elo: 1200, pos: 1 }, { usuario: 'b', elo: 1200, pos: 2 }]);
        assert.deepStrictEqual(r, { a: 1216, b: 1184 });
        const sorpresa = A.eloTras([{ usuario: 'a', elo: 1000, pos: 1 }, { usuario: 'b', elo: 1600, pos: 2 }]);
        assert.ok(sorpresa.a - 1000 > 25);
        const tres = A.eloTras([{ usuario: 'a', elo: 1300, pos: 2 }, { usuario: 'b', elo: 1250, pos: 1 }, { usuario: 'c', elo: 1100, pos: 3 }]);
        assert.ok(Math.abs(tres.a + tres.b + tres.c - 3650) <= 2);
        assert.strictEqual(A.nivelElo(1600), 'Diamante');
    });
    await test('emparejador: agrupa por región y ELO, abre el margen con la espera', () => {
        let t = 0;
        const E = new A.Emparejador({ ahora: () => t, maximo: 4, espera: 10000 });
        E.entrar('a', {}, 1200, 'america'); E.entrar('b', {}, 1250, 'america'); E.entrar('c', {}, 1900, 'america'); E.entrar('d', {}, 1210, 'europa');
        assert.strictEqual(E.emparejar().length, 0);           // aún esperando a más
        t = 11000;
        const g = E.emparejar();
        assert.strictEqual(g.length, 1);
        assert.deepStrictEqual(g[0].map(x => x.id).sort(), ['a', 'b']);
        t = 40000;                                             // con la espera: otras regiones y ELO más lejano
        E.entrar('e', {}, 1500, 'asia');
        t = 52000;
        const g2 = E.emparejar();
        assert.ok(g2.length === 1 && g2[0].length >= 2, JSON.stringify(g2.map(x => x.map(y => y.id))));
    });
    await test('salas: guardan circuito y clima válidos', () => {
        const S = new A.Salas();
        assert.strictEqual(S.crear('a', {}, { circuito: 'puerto', clima: 'lluvia' }).sala.circuito, 'puerto');
        const b = S.crear('b', {}, { circuito: 'luna', clima: 'nieve' }).sala;
        assert.deepStrictEqual([b.circuito, b.clima], ['valle', 'seco']);
    });
    await test('partida rápida: clasificación, bots que completan 22 y parrilla por tiempos', () => {
        let ahora = 1_000_000;
        const S = new A.Salas({ ahora: () => ahora });
        const { sala } = S.crear('a', { nombre: 'Ana' }, { tipo: 'abierta', max: 22, vueltas: 20, rapida: true, clasifSeg: 360, circuito: 'valle' });
        S.unirse('b', sala.codigo, { nombre: 'Beto' }); S.listo('b', true);
        const r = S.iniciar('a');
        assert.ok(r.ok && r.clasif);
        assert.strictEqual(sala.estado, 'clasif');
        assert.strictEqual(sala.bots.length, 20);
        assert.strictEqual(S.vueltaQ('a', 30), null);                    // imposible
        assert.ok(S.vueltaQ('a', 70)); assert.ok(S.vueltaQ('a', 74));
        assert.strictEqual(sala.jugadores.get('a').tQ, 70);
        assert.strictEqual(S.revisarClasif().length, 0);
        ahora = sala.tFinQ + 1;
        assert.strictEqual(S.revisarClasif().length, 1);
        assert.strictEqual(sala.estado, 'carrera');
        assert.strictEqual(sala.parrilla.length, 22);
        assert.strictEqual(sala.parrilla[0], 'a');                        // 70 s: pole
        assert.strictEqual(sala.parrilla[21], 'b');                       // sin tiempo: al fondo
        // solo el anfitrión mueve a los bots
        assert.strictEqual(S.estadoBots('b', [['bot:0', [1, 2, 3]]]), null);
        assert.ok(S.estadoBots('a', [['bot:0', [1, 2, 3]]]));
        assert.ok(S.paquete(sala).some(([id]) => id === 'bot:0'));
        ahora = sala.tSalida + 20 * 80 * 1000;
        assert.ok(S.botMeta('a', 'bot:3'));
        ahora += 5000; S.meta('b'); S.abandono('a');
        const res = S.resultados(sala);
        assert.strictEqual(res.length, 22);
        assert.strictEqual(res[0].bot, 3);
        assert.strictEqual(res.find(x => x.id === 'a').abandono, true);
    });
    await test('espectadores y juez: miran sin ocupar plaza y el juez dirige la sala', () => {
        const S = new A.Salas();
        const { sala } = S.crear('juez', { nombre: 'Juez' }, { juez: true, max: 20, vueltas: 5 });
        assert.strictEqual(sala.juez, 'juez');
        assert.strictEqual(sala.jugadores.size, 0);
        assert.ok(S.unirse('a', sala.codigo, { nombre: 'Ana' }).ok);
        assert.ok(S.unirse('b', sala.codigo, { nombre: 'Beto' }).ok);
        assert.ok(S.espectar('v1', sala.codigo).ok);
        assert.ok(S.espectar('v2', sala.codigo).ok);
        assert.strictEqual(S.publico(sala).espectadores, 3);      // dos espectadores y el juez
        assert.strictEqual(sala.jugadores.size, 2);
        S.listo('a', true); S.listo('b', true);
        const r = S.iniciar('juez');
        assert.ok(r.ok, r.error);
        assert.strictEqual(sala.parrilla.length, 2);               // el juez no tiene casilla
        assert.ok(!sala.parrilla.includes('juez'));
        assert.strictEqual(S.estado('v1', [1, 2, 3]), null);       // un espectador no puede mandar estados
        // la sala en carrera aparece en la lista para verla
        const l = S.listaPublica().find(x => x.codigo === sala.codigo);
        assert.strictEqual(l.estado, 'carrera');
        assert.strictEqual(l.espectadores, 3);
        S.dejarEspectar('v1');
        assert.strictEqual(S.publico(sala).espectadores, 2);
        // si se van los pilotos, la sala sigue mientras esté el juez
        S.salir('a'); S.salir('b');
        assert.ok(S.salas.has(sala.codigo));
        S.salir('juez');
        assert.ok(!S.salas.has(sala.codigo));
        assert.ok(!S.espect.has('v2'));
    });
    await test('licencias y safety rating: carreras limpias suben, sucias bajan, salas con licencia mínima', () => {
        assert.strictEqual(A.licenciaDe(2.5, 0, 1200), 'D');
        assert.strictEqual(A.licenciaDe(2.5, 5, 1200), 'C');
        assert.strictEqual(A.licenciaDe(3.6, 20, 1200), 'A');
        assert.strictEqual(A.licenciaDe(4.2, 40, 1600), 'Pro');
        assert.strictEqual(A.licenciaDe(4.2, 40, 1300), 'A');
        assert.ok(A.srTras(2.5, { vueltas: 10 }) > 2.5);
        assert.ok(A.srTras(2.5, { vueltas: 10, contactos: 2, sanciones: 1 }) < 2.5);
        assert.strictEqual(A.srTras(4.99, { vueltas: 50 }), 5);
        assert.strictEqual(A.srTras(0.1, { vueltas: 1, sanciones: 9 }), 0);
        assert.deepStrictEqual(A.limpiarIncidentes({ vueltas: 1e9, contactos: -3, limites: 'x' }), { vueltas: 200, contactos: 0, sanciones: 0, limites: 0 });
        const S = new A.Salas();
        const { sala } = S.crear('h', { nombre: 'Host', licencia: 'B' }, { licMin: 'B', vueltas: 3 });
        assert.strictEqual(S.publico(sala).licMin, 'B');
        assert.ok(!S.unirse('n', sala.codigo, { nombre: 'Novato', licencia: 'D' }).ok);
        assert.ok(S.unirse('v', sala.codigo, { nombre: 'Veterano', licencia: 'A' }).ok);
        assert.ok(S.incidentes('v', { vueltas: 3, contactos: 1 }));
        assert.strictEqual(sala.jugadores.get('v').inc.contactos, 1);
        // partida rápida: un piloto sucio no se empareja con uno limpio en el primer minuto
        let t = 0;
        const E = new A.Emparejador({ ahora: () => t, espera: 1000 });
        E.entrar('a', {}, 1200, 'europa', 3); E.entrar('b', {}, 1200, 'europa', 1.2);
        t = 5000; assert.strictEqual(E.emparejar().length, 0);
        t = 61000; assert.strictEqual(E.emparejar().length, 1);
    });
    await test('anti-trampas y reconexión: saltos imposibles, distancia mínima en meta y 30 s para volver', () => {
        let ahora = 1000;
        const S = new A.Salas({ ahora: () => ahora });
        const { sala } = S.crear('a', { nombre: 'Ana', usuario: 'ana' }, { vueltas: 1, circuito: 'puerto' });
        S.unirse('b', sala.codigo, { nombre: 'Beto', usuario: 'beto' });
        S.listo('b', true);
        assert.ok(S.iniciar('a').ok);
        ahora = sala.tSalida + 100;
        const est = (x, z, dist) => [x, z, 0, 0, 0, 0, 0, 0, 9000, 3, 0, dist, 0, 0, 0, 0, 0, 0];
        assert.ok(S.estado('a', est(0, 0, 0)));
        ahora += 100;
        assert.strictEqual(S.estado('a', est(500, 0, 500)), null);          // 500 m en 0,1 s: imposible
        assert.ok(S.estado('a', est(8, 0, 8)));
        // meta sin haber recorrido la distancia: rechazada aunque el tiempo cuadre
        ahora = sala.tSalida + 60000;
        assert.strictEqual(S.meta('a'), null);
        // reconexión: Beto pierde la conexión y vuelve con otro id dentro de la gracia
        S.estado('b', est(0, 0, 0));
        const d = S.desconectar('b');
        assert.ok(d.gracia);
        assert.strictEqual(sala.jugadores.get('b').abandono, false);
        ahora += 10000;
        const r = S.reanudar('b2', sala.codigo, 'beto');
        assert.ok(r.ok, r.error);
        assert.strictEqual(r.viejo, 'b');
        assert.ok(sala.jugadores.has('b2') && !sala.jugadores.has('b'));
        assert.ok(sala.parrilla.includes('b2'));
        // si tarda más de 30 s, queda fuera
        S.desconectar('b2');
        ahora += 31000;
        S._quizasTerminar(sala);
        assert.strictEqual(sala.jugadores.get('b2').abandono, true);
        assert.strictEqual(S.reanudar('b3', sala.codigo, 'beto').ok, false);
    });
    await test('limpiarNombre: sin HTML ni nombres larguísimos', () => {
        assert.strictEqual(A.limpiarNombre('<b>Ana</b>'), 'bAnab');
        assert.strictEqual(A.limpiarNombre('x'.repeat(60)).length, 18);
        assert.strictEqual(A.limpiarNombre(''), 'Piloto');
    });

    console.log(`\napexgp: ${passed} pruebas OK`);
})();
