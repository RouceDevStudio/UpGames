// Rueda el tráiler fotograma a fotograma con el reloj del juego bajo control (no depende de los
// FPS del equipo) y lo monta con la música:
//   node tools/rodar-trailer.cjs [salida.mp4] [ancho] [alto] [fps] [desde_s] [hasta_s]
// Necesita un servidor en la raíz del repositorio (python3 -m http.server 8123) y ffmpeg.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const [salida = 'trailer.mp4', W = '1280', H = '720', FPS = '30', DESDE = '0', HASTA = '76'] = process.argv.slice(2);
const fps = +FPS, dir = path.resolve(salida + '.fotos');
fs.mkdirSync(dir, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const p = await b.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.addInitScript(() => {
    // reloj virtual: el juego solo avanza cuando se pide un fotograma
    // (hasta que empieza el rodaje el reloj es el real: la carga tiene bucles que esperan al reloj)
    const real = performance.now.bind(performance);
    const v = window.__virtual = { tVideo: 0, tJuego: 0, cbs: [], fijo: false };
    performance.now = () => v.fijo ? v.tJuego * 1000 : real();
    v.fijar = () => { v.tJuego = real() / 1000; v.fijo = true; };
    window.requestAnimationFrame = (cb) => { v.cbs.push(cb); return v.cbs.length; };
    window.cancelAnimationFrame = () => {};
    window.__paso = (dV, dJ) => { if (!v.fijo) v.fijar(); v.tVideo += dV; v.tJuego += dJ; const l = v.cbs; v.cbs = []; for (const cb of l) { try { cb(v.tJuego * 1000); } catch (e) { console.error(e); } } };
    try { localStorage.setItem('apexgp.v1', JSON.stringify({ ajustes: { calidad: '2', fps: false, ambiente: false, radio: false } })); } catch (e) {}
  });
  await p.goto('http://localhost:8123/games/monoplaza/index.html?trailer');
  // carga: se mueven fotogramas sin avanzar el vídeo hasta que el tráiler esté listo
  for (let k = 0; k < 2000 && !(await p.evaluate(() => !!window.__trailerListo)); k++) { await p.evaluate(() => window.__paso(0, 1 / 30)); await p.waitForTimeout(50); }
  for (let k = 0; k < 20; k++) await p.evaluate(() => window.__paso(0, 1 / 30));
  // avance rápido hasta el inicio pedido (sin guardar)
  // (sin dibujar: solo avanza la carrera; mucho más rápido)
  await p.evaluate(() => { const r = window.apexTrailer.renderer; r._render = r.render; r.render = () => {}; });
  for (let quedan = Math.round(+DESDE * fps); quedan > 0; quedan -= 10)
    await p.evaluate(([d, n]) => { for (let k = 0; k < n; k++) window.__paso(d, d * window.__escalaJuego(window.__virtual.tVideo)); }, [1 / fps, Math.min(10, quedan)]);
  await p.evaluate(() => { const r = window.apexTrailer.renderer; r.render = r._render; });
  const n0 = Math.round(+DESDE * fps), n1 = Math.round(+HASTA * fps), t0 = Date.now();
  for (let n = n0; n < n1; n++) {
    await p.evaluate((d) => window.__paso(d, d * window.__escalaJuego(window.__virtual.tVideo)), 1 / fps);
    await p.screenshot({ path: path.join(dir, String(n).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 93 });
    if (n % 30 === 0) console.log(`fotograma ${n}/${n1} · ${((Date.now() - t0) / (n - n0 + 1)).toFixed(0)} ms/fotograma`);
  }
  await b.close();
  if (process.env.SOLO_FOTOS) { console.log('fotos listas'); return; }
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(fps), '-start_number', String(n0), '-i', path.join(dir, '%05d.jpg'),
    '-ss', String(+DESDE), '-i', path.join(__dirname, 'trailer_musica.mp3'), '-t', String(+HASTA - +DESDE),
    '-af', `afade=t=out:st=${Math.max(0, +HASTA - +DESDE - 2.5)}:d=2.5`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', salida], { stdio: 'inherit' });
  console.log('listo:', salida);
})();
