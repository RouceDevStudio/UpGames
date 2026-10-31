/**
 * UpGames Studio · IA en la nube (mejora 9): de 1 a 4 fotos a un modelo 3D completo (360°) con
 * TRELLIS (Microsoft, licencia MIT) en un Space de Hugging Face, por su API de Gradio, sin
 * dependencias nuevas. Necesita HF_TOKEN (cuenta de Hugging Face; la cuota de GPU es la de esa
 * cuenta). Opcional: STUDIO_IA_SPACE (por defecto trellis-community/TRELLIS).
 *
 * Trabajos en memoria (el servidor corre con una réplica): uno a la vez por usuario y un máximo
 * diario por usuario (STUDIO_IA_DIARIO, por defecto 5).
 */
'use strict';

const crypto = require('crypto');

const SPACE = () => process.env.STUDIO_IA_SPACE || 'trellis-community/TRELLIS';
const baseDe = (space) => `https://${space.toLowerCase().replace(/[/_.]/g, '-')}.hf.space`;

// ---------- cliente mínimo de Gradio (cola: join + eventos SSE) ----------
function clienteGradio({ base, token, fetch: f = fetch }) {
  const cab = token ? { Authorization: `Bearer ${token}` } : {};
  const sesion = crypto.randomBytes(6).toString('hex');
  let config = null;
  async function fnIndex(nombre) {
    if (!config) { const r = await f(`${base}/config`, { headers: cab }); if (!r.ok) throw new Error(`Space no disponible (${r.status})`); config = await r.json(); }
    const i = config.dependencies.findIndex((d) => d.api_name === nombre.replace(/^\//, ''));
    if (i < 0) throw new Error(`El Space no tiene /${nombre}`);
    return config.dependencies[i].id ?? i;
  }
  async function subir(buffer, nombre = 'foto.png', tipo = 'image/png') {
    const fd = new FormData();
    fd.append('files', new Blob([buffer], { type: tipo }), nombre);
    const r = await f(`${base}/gradio_api/upload`, { method: 'POST', headers: cab, body: fd });
    if (!r.ok) throw new Error(`No se pudo subir la foto (${r.status})`);
    const [ruta] = await r.json();
    return { path: ruta, orig_name: nombre, mime_type: tipo, meta: { _type: 'gradio.FileData' } };
  }
  // llama a un endpoint y espera su resultado; alAvanzar({ fase, posicion })
  async function llamar(nombre, datos, alAvanzar = () => {}) {
    const fn_index = await fnIndex(nombre);
    const j = await f(`${base}/gradio_api/queue/join`, { method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: datos, fn_index, session_hash: sesion, event_data: null, trigger_id: null }) });
    if (!j.ok) throw new Error(`La IA rechazó la petición (${j.status})`);
    const { event_id: evento } = await j.json();
    const r = await f(`${base}/gradio_api/queue/data?session_hash=${sesion}`, { headers: { ...cab, Accept: 'text/event-stream' } });
    if (!r.ok || !r.body) throw new Error(`Sin respuesta de la IA (${r.status})`);
    const lector = r.body.getReader(), dec = new TextDecoder();
    let resto = '';
    for (;;) {
      const { value, done } = await lector.read();
      if (done) throw new Error('La IA cortó la conexión');
      resto += dec.decode(value, { stream: true });
      const lineas = resto.split('\n'); resto = lineas.pop();
      for (const l of lineas) {
        if (!l.startsWith('data:')) continue;
        let m; try { m = JSON.parse(l.slice(5)); } catch { continue; }
        if (m.event_id && evento && m.event_id !== evento) continue;
        if (m.msg === 'estimation') alAvanzar({ fase: 'cola', posicion: m.rank ?? m.queue_size });
        else if (m.msg === 'process_starts') alAvanzar({ fase: 'generando' });
        else if (m.msg === 'process_completed') {
          lector.cancel().catch(() => {});
          if (!m.success) throw new Error(mensajeError(m.output?.error || m.output?.title || 'La IA no pudo generar el modelo'));
          return m.output.data;
        }
      }
    }
  }
  async function descargar(archivo) {
    const url = archivo.url || `${base}/gradio_api/file=${archivo.path}`;
    const r = await f(url, { headers: cab });
    if (!r.ok) throw new Error(`No se pudo descargar el modelo (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  return { llamar, subir, descargar, sesion };
}

function mensajeError(e) {
  const t = String(e);
  if (/quota/i.test(t)) return 'Se acabó la cuota de GPU de la cuenta de Hugging Face por hoy. Prueba más tarde o amplía la cuenta.';
  return t.slice(0, 300);
}

// Genera el GLB a partir de fotos (Buffers PNG/JPG). Devuelve un Buffer con el .glb.
async function generarModelo(fotos, { token, space = SPACE(), fetch: f = fetch, alAvanzar = () => {} } = {}) {
  const g = clienteGradio({ base: baseDe(space), token, fetch: f });
  alAvanzar({ fase: 'subiendo' });
  try { await g.llamar('start_session', []); } catch { /* algunos Spaces no la tienen */ }
  const subidas = [];
  for (const [i, b] of fotos.entries()) subidas.push(await g.subir(b, `foto${i + 1}.png`));
  alAvanzar({ fase: 'preparando' });
  const [prep] = await g.llamar('preprocess_image', [subidas[0]], alAvanzar);
  let multi = [];
  if (subidas.length > 1) {
    const [lista] = await g.llamar('preprocess_images', [subidas.map((s) => ({ image: s, caption: null }))], alAvanzar);
    multi = lista || [];
  }
  const salida = await g.llamar('generate_and_extract_glb', [prep, multi, 0, 7.5, 12, 3, 12, 'stochastic', 0.95, 1024], alAvanzar);
  const glb = salida.find((x, i) => i > 0 && x && (x.path || x.url) && /\.glb/i.test(x.path || x.url || x.orig_name || '')) || salida[1];
  if (!glb) throw new Error('La IA no devolvió el modelo');
  alAvanzar({ fase: 'descargando' });
  return g.descargar(glb);
}

// ---------- trabajos ----------
function crearGestor({ generar = generarModelo, ahora = () => Date.now(), diario = () => +(process.env.STUDIO_IA_DIARIO || 5) } = {}) {
  const trabajos = new Map(), usos = new Map();
  const dia = () => new Date(ahora()).toISOString().slice(0, 10);
  function limpiar() { for (const [id, t] of trabajos) if (ahora() - t.creado > 30 * 60e3) trabajos.delete(id); }
  return {
    disponible: () => !!process.env.HF_TOKEN,
    crear(usuario, fotos) {
      limpiar();
      if (!process.env.HF_TOKEN) return { error: 'La IA en la nube no está configurada (falta HF_TOKEN en el servidor)', status: 503 };
      if (!Array.isArray(fotos) || !fotos.length || fotos.length > 4) return { error: 'Envía de 1 a 4 fotos', status: 400 };
      if ([...trabajos.values()].some((t) => t.usuario === usuario && !['listo', 'error'].includes(t.estado))) return { error: 'Ya tienes un modelo generándose', status: 429 };
      const clave = `${usuario}|${dia()}`, n = usos.get(clave) || 0;
      if (n >= diario()) return { error: `Has usado tus ${diario()} modelos de hoy`, status: 429 };
      usos.set(clave, n + 1);
      const id = crypto.randomBytes(8).toString('hex');
      const t = { id, usuario, estado: 'cola', fase: 'cola', posicion: null, creado: ahora(), glb: null, error: null };
      trabajos.set(id, t);
      Promise.resolve().then(() => generar(fotos, { token: process.env.HF_TOKEN, alAvanzar: ({ fase, posicion }) => { t.fase = fase; t.estado = 'trabajando'; if (posicion != null) t.posicion = posicion; } }))
        .then((glb) => { t.glb = glb; t.estado = 'listo'; t.fase = 'listo'; })
        .catch((e) => { t.estado = 'error'; t.error = e.message || String(e); usos.set(clave, Math.max(0, (usos.get(clave) || 1) - 1)); });
      return { id };
    },
    ver(usuario, id) {
      const t = trabajos.get(id);
      if (!t || t.usuario !== usuario) return null;
      return { id, estado: t.estado, fase: t.fase, posicion: t.posicion, error: t.error, bytes: t.glb ? t.glb.length : 0 };
    },
    glb(usuario, id) { const t = trabajos.get(id); return t && t.usuario === usuario && t.glb ? t.glb : null; },
    _trabajos: trabajos,
  };
}

// dataURL o base64 → Buffer (máx. 8 MB por foto)
function fotoDe(x) {
  if (typeof x !== 'string') return null;
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(x);
  const b = Buffer.from(m ? m[2] : x, 'base64');
  return b.length > 100 && b.length < 8 * 1024 * 1024 ? b : null;
}

module.exports = { clienteGradio, generarModelo, crearGestor, fotoDe, baseDe };
