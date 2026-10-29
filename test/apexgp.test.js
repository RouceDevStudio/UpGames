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
    const usuarios = { ana: { usuario: 'ana', monedas, saldo: 0 } };
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
    };
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
    require('../rutas/apexgp').registrar(app, { verificarToken: () => {}, Usuario, LiveTx, io: null, logger: { info() {}, error() {} } });
    const llamar = (ruta, body) => new Promise(resolve => {
        const res = { code: 200, status(c) { this.code = c; return this; }, set() { return this; }, json(d) { resolve({ code: this.code, ...d }); } };
        rutas[ruta]({ usuario: 'ana', body }, res);
    });
    return { usuarios, perfiles, txs, llamar };
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
    await test('limpiarNombre: sin HTML ni nombres larguísimos', () => {
        assert.strictEqual(A.limpiarNombre('<b>Ana</b>'), 'bAnab');
        assert.strictEqual(A.limpiarNombre('x'.repeat(60)).length, 18);
        assert.strictEqual(A.limpiarNombre(''), 'Piloto');
    });

    console.log(`\napexgp: ${passed} pruebas OK`);
})();
