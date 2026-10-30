// Exporta el monoplaza y el piloto (sentado y de pie) a .glb con tools/exportar-glb.html.
// Uso: node tools/exportar-glb.mjs [carpeta de salida] [--capturas]
// Sirve la carpeta del juego, abre la página en Chromium (Playwright) y guarda cada modelo en
// gris (arcilla, como las referencias) y con colores.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright viene instalado de forma global (require lo encuentra con NODE_PATH)
const { chromium } = createRequire(import.meta.url)('playwright');
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const salida = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : join(raiz, 'modelos');
const capturas = process.argv.includes('--capturas');
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = createServer(async (req, res) => {
  try {
    const ruta = join(raiz, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!ruta.startsWith(raiz)) throw new Error('fuera');
    res.writeHead(200, { 'content-type': tipos[extname(ruta)] || 'application/octet-stream' }); res.end(await readFile(ruta));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const puerto = srv.address().port;
await mkdir(salida, { recursive: true });
const nav = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pag = await nav.newPage({ viewport: { width: 1200, height: 900 } });
pag.on('pageerror', e => console.error('error en la página:', e.message));
for (const modelo of ['coche', 'sentado', 'de_pie']) {
  for (const gris of [true, false]) {
    await pag.goto(`http://localhost:${puerto}/tools/exportar-glb.html?modelo=${modelo}${gris ? '&gris=1' : ''}`);
    await pag.waitForFunction(() => window.listo, null, { timeout: 120000 });
    const nombre = `${modelo === 'coche' ? 'monoplaza' : 'piloto_' + modelo}${gris ? '_gris' : ''}`;
    if (capturas) await pag.screenshot({ path: join(salida, nombre + '.png') });
    const b64 = await pag.evaluate(() => window.exportar());
    const buf = Buffer.from(b64, 'base64');
    await writeFile(join(salida, nombre + '.glb'), buf);
    console.log(`${nombre}.glb  ${(buf.length / 1024).toFixed(0)} KB`);
  }
}
await nav.close(); srv.close();
