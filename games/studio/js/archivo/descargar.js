// Guardar un archivo creado en la página: en el navegador, una descarga normal; en la app de
// Android, por trozos en base64 al puente nativo (window.StudioArchivo → Descargas › UpGames Studio).
export async function descargar(datos, nombre, tipo = 'application/octet-stream') {
  const blob = datos instanceof Blob ? datos : new Blob([datos], { type: tipo });
  const nativo = window.StudioArchivo;
  if (nativo) {
    const id = nativo.abrir(nombre, tipo);
    if (id) {
      const bytes = new Uint8Array(await blob.arrayBuffer()), TROZO = 512 * 1024;
      for (let i = 0; i < bytes.length; i += TROZO) {
        let s = '';
        const parte = bytes.subarray(i, i + TROZO);
        for (let k = 0; k < parte.length; k += 0x8000) s += String.fromCharCode(...parte.subarray(k, k + 0x8000));
        if (!nativo.escribir(id, btoa(s))) throw new Error('No se pudo guardar el archivo');
      }
      if (!nativo.cerrar(id)) throw new Error('No se pudo guardar el archivo');
      return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ¿Estamos dentro de la app de Android?
export const enApp = () => !!window.StudioArchivo;
