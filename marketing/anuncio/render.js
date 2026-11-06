#!/usr/bin/env node
/**
 * Graba anuncio.html cuadro a cuadro y lo codifica con ffmpeg (H.264, sin audio).
 *   node render.js [salida.mp4] [fps=30] [desde=0] [hasta=fin]
 *   PREVIEW="1,5.5,12" node render.js  → solo esos instantes como PNG (revisión)
 */
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
  const salida = process.argv[2] || 'upgames-anuncio.mp4';
  const fps = +(process.argv[3] || 30);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.error('ERROR página:', e.message));
  await p.goto('file://' + path.join(__dirname, 'anuncio.html'));
  await p.evaluate(() => window.listo);
  const dur = await p.evaluate(() => window.DURACION);
  if (process.env.PREVIEW) {
    for (const t of process.env.PREVIEW.split(',').map(Number)) {
      await p.evaluate(t => window.render(t), t);
      await p.screenshot({ path: `preview-${String(t).padStart(5, '0')}.png` });
    }
    await b.close(); return;
  }
  const desde = +(process.argv[4] || 0), hasta = +(process.argv[5] || dur);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(fps), salida], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round((hasta - desde) * fps), t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const t = desde + i / fps;
    await p.evaluate(t => window.render(t), t);
    const img = await p.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(img)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`${i}/${n} cuadros · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await b.close();
  console.log('Listo:', salida);
})();
