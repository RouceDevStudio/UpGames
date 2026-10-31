// IA en el propio móvil (transformers.js, sin servidor). La primera vez descarga los modelos
// (≈ 35 MB) y el navegador los guarda en caché.
// - Recorte: SlimSAM (Segment Anything). Tocas el objeto y lo separa de cualquier fondo.
// - Profundidad: Depth Anything v2 (small). Distancia relativa de cada píxel a la cámara.
// Los dos modelos tienen licencia Apache-2.0.

const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/transformers.min.js';
const M_SAM = 'Xenova/slimsam-77-uniform';
const M_PROF = 'onnx-community/depth-anything-v2-small';

let tjs = null, sam = null, prof = null;

async function libreria() {
  if (!tjs) {
    tjs = await import(TJS);
    tjs.env.allowLocalModels = false;
  }
  return tjs;
}

// progreso(texto, 0..1) mientras se descargan los archivos del modelo
function seguir(progreso, nombre) {
  const archivos = new Map();
  return (e) => {
    if (e.status === 'progress' && e.total) {
      archivos.set(e.file, [e.loaded, e.total]);
      let a = 0, b = 0;
      for (const [x, y] of archivos.values()) { a += x; b += y; }
      progreso?.(`Descargando ${nombre}… ${(a / 1048576).toFixed(1)} de ${(b / 1048576).toFixed(1)} MB`, a / b);
    }
  };
}

const opciones = async () => ({ device: (await tieneWebGPU()) ? 'webgpu' : 'wasm', dtype: (await tieneWebGPU()) ? 'fp32' : 'q8' });
let webgpu;
async function tieneWebGPU() {
  if (webgpu === undefined) {
    try { webgpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { webgpu = false; }
  }
  return webgpu;
}

const imagenRaw = (T, img) => new T.RawImage(img.data, img.width, img.height, 4).rgb();

// Prepara el recorte de una foto (lo lento: codificar la imagen una vez). Devuelve una función
// que, con los puntos tocados, da la máscara al tamaño de la foto.
export async function prepararRecorte(img, progreso) {
  const T = await libreria();
  if (!sam) {
    const op = await opciones();
    sam = {
      modelo: await T.SamModel.from_pretrained(M_SAM, { ...op, dtype: 'q8', device: 'wasm', progress_callback: seguir(progreso, 'el recorte con IA') }),
      proc: await T.AutoProcessor.from_pretrained(M_SAM),
    };
  }
  progreso?.('Analizando la foto…', 1);
  const entradas = await sam.proc(imagenRaw(T, img));
  const incrustado = await sam.modelo.get_image_embeddings(entradas);
  const [rh, rw] = entradas.reshaped_input_sizes[0];
  // puntos: [{ x, y, dentro }] en coordenadas 0..1 de la foto
  return async (puntos) => {
    const p = puntos.flatMap((q) => [q.x * rw, q.y * rh]);
    const input_points = new T.Tensor('float32', p, [1, 1, puntos.length, 2]);
    const input_labels = new T.Tensor('int64', puntos.map((q) => BigInt(q.dentro ? 1 : 0)), [1, 1, puntos.length]);
    const { pred_masks, iou_scores } = await sam.modelo({ ...incrustado, input_points, input_labels });
    const mascaras = await sam.proc.post_process_masks(pred_masks, entradas.original_sizes, entradas.reshaped_input_sizes);
    const m = mascaras[0]; // [1, 3, H, W]
    const [, n, H, W] = m.dims, puntos3 = iou_scores.data;
    let mejor = 0;
    for (let k = 1; k < n; k++) if (puntos3[k] > puntos3[mejor]) mejor = k;
    const r = new Uint8Array(W * H), datos = m.data, base = mejor * W * H;
    for (let i = 0; i < W * H; i++) r[i] = datos[base + i] ? 1 : 0;
    return { mascara: r, width: W, height: H, calidad: puntos3[mejor] };
  };
}

// Profundidad relativa (0 = lejos, 1 = cerca) al tamaño de la foto.
export async function estimarProfundidad(img, progreso) {
  const T = await libreria();
  if (!prof) {
    const op = await opciones();
    prof = await T.pipeline('depth-estimation', M_PROF, { ...op, progress_callback: seguir(progreso, 'la profundidad con IA') });
  }
  progreso?.('Calculando la profundidad…', 1);
  const { predicted_depth: d } = await prof(imagenRaw(T, img));
  const [h, w] = d.dims.slice(-2), src = d.data;
  let mn = Infinity, mx = -Infinity;
  for (const v of src) { if (v < mn) mn = v; if (v > mx) mx = v; }
  // remuestreo bilineal al tamaño de la foto
  const W = img.width, H = img.height, out = new Float32Array(W * H), k = 1 / (mx - mn || 1);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / H - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / W - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const v = (src[y0 * w + x0] * (1 - tx) + src[y0 * w + x1] * tx) * (1 - ty) + (src[y1 * w + x0] * (1 - tx) + src[y1 * w + x1] * tx) * ty;
      out[y * W + x] = (v - mn) * k;
    }
  }
  return { data: out, width: W, height: H };
}
