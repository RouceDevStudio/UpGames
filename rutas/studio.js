/**
 * UpGames Studio · IA en la nube (ver modulos/studio.js).
 *
 *   GET  /studio/ia3d/estado       { disponible }  (público)
 *   POST /studio/ia3d              { fotos: [dataURL, …] (1 a 4) } → { id }
 *   GET  /studio/ia3d/:id          { estado: cola|trabajando|listo|error, fase, posicion, error }
 *   GET  /studio/ia3d/:id/glb      el modelo (.glb)
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
  return gestor;
}

module.exports = { registrar };
