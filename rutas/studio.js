/**
 * UpGames Studio · IA en la nube (ver modulos/studio.js).
 *
 *   GET  /studio/ia3d/estado       { disponible }  (público)
 *   POST /studio/ia3d              { fotos: [dataURL, …] (1 a 4) } → { id }
 *   GET  /studio/ia3d/:id          { estado: cola|trabajando|listo|error, fase, posicion, error }
 *   GET  /studio/ia3d/:id/glb      el modelo (.glb)
 *   GET  /studio/apk               la app de Android (APK de la versión studio-latest de GitHub)
 */
'use strict';

const { crearGestor, fotoDe } = require('../modulos/studio');

function registrar(app, { verificarToken, logger, gestor = crearGestor() }) {
  app.get('/studio/ia3d/estado', (req, res) => res.json({ success: true, disponible: gestor.disponible() }));

  app.post('/studio/ia3d', verificarToken, (req, res) => {
    const fotos = (req.body?.fotos || []).map(fotoDe);
    if (!fotos.length || fotos.some((f) => !f)) return res.status(400).json({ success: false, error: 'Fotos no válidas (PNG, JPG o WEBP de menos de 8 MB)' });
    const r = gestor.crear(req.usuario, fotos);
    if (r.error) return res.status(r.status || 400).json({ success: false, error: r.error });
    logger?.info?.(`studio ia3d: ${req.usuario} pidió un modelo (${fotos.length} foto/s)`);
    res.json({ success: true, id: r.id });
  });

  app.get('/studio/ia3d/:id', verificarToken, (req, res) => {
    const t = gestor.ver(req.usuario, req.params.id);
    if (!t) return res.status(404).json({ success: false, error: 'No existe' });
    res.json({ success: true, ...t });
  });

  app.get('/studio/ia3d/:id/glb', verificarToken, (req, res) => {
    const glb = gestor.glb(req.usuario, req.params.id);
    if (!glb) return res.status(404).json({ success: false, error: 'Aún no está listo' });
    res.set('Content-Type', 'model/gltf-binary').set('Content-Disposition', 'attachment; filename="modelo-ia.glb"').send(glb);
  });
  // APK: se descarga de GitHub Releases y se sirve desde aquí (el enlace de GitHub cambia de dominio
  // y algunos navegadores móviles no siguen bien la redirección)
  const APK_ORIGEN = 'https://github.com/UpgamesStudio/UpGames/releases/download/studio-latest/UpGames-Studio.apk';
  let apk = { buf: null, t: 0, cargando: null };
  async function cargarApk() {
    if (apk.buf && Date.now() - apk.t < 10 * 60e3) return apk.buf;
    if (!apk.cargando) apk.cargando = (async () => {
      const r = await fetch(APK_ORIGEN, { redirect: 'follow' });
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 100000 || buf.readUInt32BE(0) !== 0x504b0304) throw new Error('el APK descargado no es válido');
      apk = { buf, t: Date.now(), cargando: null };
      return buf;
    })().finally(() => { apk.cargando = null; });
    return apk.cargando;
  }
  app.get('/studio/apk', async (req, res) => {
    try {
      const buf = await cargarApk();
      res.set({ 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': buf.length, 'Content-Disposition': 'attachment; filename="UpGames-Studio.apk"', 'Cache-Control': 'public, max-age=300' });
      res.end(buf);
    } catch (e) {
      logger?.error?.(`[studio] apk: ${e.message}`);
      res.redirect(302, APK_ORIGEN);
    }
  });
  return gestor;
}

module.exports = { registrar };
