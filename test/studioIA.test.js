/**
 * Tests de UpGames Studio · IA en la nube (modulos/studio.js) con un Space de Gradio simulado.
 * Autónomo: `node test/studioIA.test.js`.
 */
'use strict';
const assert = require('assert');
const S = require('../modulos/studio');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; }
}

// Space falso: /config, /upload, /queue/join y /queue/data (SSE) como Gradio 5
function spaceFalso({ fallar = false } = {}) {
  const llamadas = [], pendientes = [];
  const deps = ['start_session', 'preprocess_image', 'preprocess_images', 'generate_and_extract_glb'].map((api_name, id) => ({ id, api_name }));
  const sse = (eventos) => ({ ok: true, body: new ReadableStream({ start(c) { for (const e of eventos) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`)); c.close(); } }) });
  const f = async (url, op = {}) => {
    llamadas.push([url, op.headers?.Authorization]);
    if (url.endsWith('/config')) return { ok: true, json: async () => ({ dependencies: deps }) };
    if (url.endsWith('/gradio_api/upload')) return { ok: true, json: async () => ['/tmp/gradio/abc/foto.png'] };
    if (url.endsWith('/gradio_api/queue/join')) { const b = JSON.parse(op.body); pendientes.push(b); return { ok: true, json: async () => ({ event_id: `e${pendientes.length}` }) }; }
    if (url.includes('/gradio_api/queue/data')) {
      const b = pendientes[pendientes.length - 1], ev = `e${pendientes.length}`, nombre = deps[b.fn_index].api_name;
      if (fallar && nombre === 'generate_and_extract_glb') return sse([{ msg: 'process_completed', event_id: ev, success: false, output: { error: 'You have exceeded your ZeroGPU quota' } }]);
      const datos = nombre === 'generate_and_extract_glb' ? [{ video: {} }, { path: '/tmp/m.glb', url: 'https://x.hf.space/file=/tmp/m.glb' }, { path: '/tmp/m.glb' }]
        : nombre === 'preprocess_image' ? [{ path: '/tmp/pre.png' }] : [];
      return sse([{ msg: 'estimation', event_id: ev, rank: 2 }, { msg: 'process_starts', event_id: ev }, { msg: 'process_completed', event_id: ev, success: true, output: { data: datos } }]);
    }
    if (url.endsWith('/tmp/m.glb')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('glTF-falso').buffer };
    return { ok: false, status: 404 };
  };
  return { f, llamadas, pendientes };
}

(async () => {
  console.log('UpGames Studio · IA en la nube');
  await test('genera el GLB: sube la foto, prepara, genera y descarga con el token', async () => {
    const sp = spaceFalso(), fases = [];
    const glb = await S.generarModelo([Buffer.alloc(200, 1)], { token: 'hf_x', space: 'trellis-community/TRELLIS', fetch: sp.f, alAvanzar: (a) => fases.push(a.fase) });
    assert.strictEqual(glb.toString(), 'glTF-falso');
    assert.ok(sp.llamadas[0][0].startsWith('https://trellis-community-trellis.hf.space/'));
    assert.ok(sp.llamadas.every(([, a]) => a === 'Bearer hf_x'));
    const gen = sp.pendientes.find((b) => b.fn_index === 3);
    assert.deepStrictEqual(gen.data[0], { path: '/tmp/pre.png' });
    assert.ok(fases.includes('cola') && fases.includes('generando') && fases.includes('descargando'));
  });
  await test('error de cuota con mensaje claro', async () => {
    const sp = spaceFalso({ fallar: true });
    await assert.rejects(S.generarModelo([Buffer.alloc(200, 1)], { token: 'hf_x', fetch: sp.f }), /cuota de GPU/);
  });
  await test('trabajos: sin HF_TOKEN no se puede; con él, uno a la vez y límite diario', async () => {
    delete process.env.HF_TOKEN;
    const g0 = S.crearGestor({ generar: async () => Buffer.from('x') });
    assert.strictEqual(g0.crear('ana', [Buffer.alloc(200)]).status, 503);
    process.env.HF_TOKEN = 'hf_x';
    let soltar; const espera = new Promise((r) => { soltar = r; });
    const g = S.crearGestor({ generar: async () => { await espera; return Buffer.from('glb'); }, diario: () => 2 });
    const { id } = g.crear('ana', [Buffer.alloc(200)]);
    assert.ok(id);
    assert.strictEqual(g.crear('ana', [Buffer.alloc(200)]).status, 429, 'uno a la vez');
    assert.strictEqual(g.ver('beto', id), null, 'otro usuario no lo ve');
    soltar(); await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(g.ver('ana', id).estado, 'listo');
    assert.strictEqual(g.glb('ana', id).toString(), 'glb');
    g.crear('ana', [Buffer.alloc(200)]); await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(g.crear('ana', [Buffer.alloc(200)]).status, 429, 'límite diario');
    delete process.env.HF_TOKEN;
  });
  await test('fotos: dataURL válido sí, basura no', () => {
    assert.ok(S.fotoDe('data:image/png;base64,' + Buffer.alloc(300, 7).toString('base64')));
    assert.strictEqual(S.fotoDe('data:image/png;base64,AAAA'), null);
    assert.strictEqual(S.fotoDe(42), null);
  });
  console.log(`\n${passed} pruebas correctas`);
})();
