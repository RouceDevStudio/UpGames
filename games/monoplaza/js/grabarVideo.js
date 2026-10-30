// Graba la imagen del juego (y su sonido) a un vídeo y lo guarda. En el navegador se
// descarga; en la app de Android lo guarda en la carpeta Películas a través del puente
// nativo `ApexArchivo` (el WebView no sabe descargar archivos creados en la página).

const TIPOS = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function puedeGrabar(lienzo) {
  return !!(window.MediaRecorder && lienzo.captureStream);
}

export class GrabadorVideo {
  constructor(lienzo, audio = null) {
    this.lienzo = lienzo;
    this.audio = audio;          // MediaStream con el sonido del juego (opcional)
    this.rec = null;
    this.trozos = [];
    this.inicio = 0;
  }

  get grabando() { return !!this.rec && this.rec.state === 'recording'; }
  get segundos() { return this.grabando ? (performance.now() - this.inicio) / 1000 : 0; }

  empezar(fps = 30) {
    const flujo = this.lienzo.captureStream(fps);
    for (const p of this.audio?.getAudioTracks?.() || []) flujo.addTrack(p);
    const tipo = TIPOS.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
    // calidad alta: ~12 Mbit/s a 1080p, proporcional al tamaño del lienzo
    const bits = Math.round(Math.min(16e6, Math.max(4e6, this.lienzo.width * this.lienzo.height * fps * 0.2)));
    this.rec = new MediaRecorder(flujo, { mimeType: tipo || undefined, videoBitsPerSecond: bits, audioBitsPerSecond: 192000 });
    this.tipo = this.rec.mimeType || tipo || 'video/webm';
    this.trozos = [];
    this.rec.ondataavailable = (e) => { if (e.data?.size) this.trozos.push(e.data); };
    this.rec.start(1000);
    this.inicio = performance.now();
  }

  /** Para y guarda; devuelve una promesa con el nombre del archivo. */
  parar() {
    return new Promise((ok, mal) => {
      if (!this.rec) { mal(new Error('No se está grabando')); return; }
      this.rec.onstop = async () => {
        const blob = new Blob(this.trozos, { type: this.tipo });
        this.rec = null; this.trozos = [];
        const ext = this.tipo.includes('mp4') ? 'mp4' : 'webm';
        const nombre = `APEX-GP-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
        try { await guardarArchivo(blob, nombre); ok(nombre); } catch (e) { mal(e); }
      };
      this.rec.stop();
    });
  }
}

/** Guarda un Blob como archivo (descarga en el navegador; Películas/Imágenes en Android). */
export async function guardarArchivo(blob, nombre) {
  const nativo = window.ApexArchivo;
  if (nativo) {
    // por trozos en base64 para no superar los límites del puente JS → Java
    const buf = new Uint8Array(await blob.arrayBuffer());
    const id = nativo.abrir(nombre, blob.type || 'application/octet-stream');
    if (!id) throw new Error('No se pudo crear el archivo');
    const T = 512 * 1024;
    for (let i = 0; i < buf.length; i += T) {
      let s = '';
      const trozo = buf.subarray(i, i + T);
      for (let k = 0; k < trozo.length; k += 0x8000) s += String.fromCharCode.apply(null, trozo.subarray(k, k + 0x8000));
      if (!nativo.escribir(id, btoa(s))) throw new Error('Error al escribir el archivo');
      await new Promise(r => setTimeout(r, 0));
    }
    if (!nativo.cerrar(id)) throw new Error('Error al guardar el archivo');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
