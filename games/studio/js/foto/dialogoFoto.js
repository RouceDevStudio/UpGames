// Hoja «Desde foto»: elegir 1 o 2 fotos, ver el recorte y crear el modelo.
import * as THREE from 'three';
import { mascaraDesdeImagen, limpiarMascara, relieveDesdeMascara, cascoVisual, sangrar } from './fotoA3D.js';
import * as ia from './ia.js';

const LADO_MAX = 480; // las fotos se analizan reducidas a este lado máximo
const ALTO_MODELO = 2; // unidades de la escena

export function instalarDialogoFoto({ alCrear, aviso }) {
  const hoja = document.getElementById('hojaFoto');
  const ranuras = [...hoja.querySelectorAll('.ranura')];
  // { img: ImageData, mk, color, puntos: [{x, y, dentro}], recortar: fn | null, prof }
  const fotos = [null, null];
  let n = 1, quitar = false;
  const $ = (id) => document.getElementById(id);
  const tol = $('fTol'), grosor = $('fGrosor'), detalle = $('fDetalle'), invertir = $('fInvertir'), bCrear = $('bCrearFoto');
  const usaIA = () => $('fIA').checked;
  const estado = (t) => { $('fotoEstado').textContent = t || ''; };

  const actualizarBoton = () => { bCrear.disabled = !fotos.slice(0, n).every((f) => f && f.mk && f.mk.area > 50); };
  const ayuda = () => {
    const ia = usaIA();
    $('fotoAyuda').textContent = n === 1
      ? (ia ? 'Toca el objeto en la foto: la IA lo separa del fondo (aunque no sea liso) y calcula su profundidad para darle relieve real. La foto queda como textura.'
            : 'Foto del objeto sobre un fondo liso (pared, mesa, papel). La silueta se recorta por color y se infla en 3D con la foto como textura.')
      : 'Dos fotos del mismo objeto: una de frente y otra de lado (girando el objeto 90°), a la misma distancia. Toca el objeto en cada una. Se talla el volumen que encaja con las dos siluetas y se colorea con las fotos.';
    $('filaTol').hidden = ia;
    $('filaZona').hidden = !ia;
  };

  hoja.querySelectorAll('#fotoModo button').forEach((b) => b.addEventListener('click', () => {
    n = +b.dataset.n;
    hoja.querySelectorAll('#fotoModo button').forEach((q) => q.classList.toggle('activo', q === b));
    ranuras[1].hidden = n === 1;
    $('filaGrosor').hidden = n === 2;
    $('filaInvertir').hidden = n === 1;
    ranuras[0].querySelector('.etq').textContent = n === 1 ? 'Foto' : 'Frente';
    ayuda();
    actualizarBoton();
  }));
  $('fIA').addEventListener('change', () => { ayuda(); fotos.forEach((f, i) => f && analizar(i)); });
  hoja.querySelectorAll('#filaZona [data-zona]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.zona === 'reiniciar') { fotos.forEach((f, i) => { if (f) { f.puntos = [{ x: 0.5, y: 0.5, dentro: true }]; analizar(i); } }); return; }
    quitar = b.dataset.zona === 'quitar';
    hoja.querySelectorAll('#filaZona [data-zona]').forEach((q) => q.classList.toggle('activo', q === b));
  }));
  ayuda();

  ranuras.forEach((r, i) => {
    r.querySelectorAll('input[type=file]').forEach((inp) => inp.addEventListener('change', async () => {
      const archivo = inp.files[0];
      inp.value = '';
      if (!archivo) return;
      try {
        fotos[i] = await cargar(archivo);
        analizar(i);
      } catch (e) {
        aviso('No se pudo abrir la foto');
        console.error(e);
      }
    }));
    // tocar la vista previa marca el objeto (o una zona que no es del objeto)
    r.querySelector('canvas').addEventListener('click', (e) => {
      const f = fotos[i];
      if (!f || !usaIA()) return;
      const c = e.currentTarget.getBoundingClientRect();
      // la imagen se dibuja con object-fit: contain
      const k = Math.min(c.width / f.img.width, c.height / f.img.height);
      const x = (e.clientX - c.left - (c.width - f.img.width * k) / 2) / (f.img.width * k);
      const y = (e.clientY - c.top - (c.height - f.img.height * k) / 2) / (f.img.height * k);
      if (x < 0 || y < 0 || x > 1 || y > 1) return;
      const p = { x, y, dentro: !quitar };
      f.puntos = f.tocado ? [...f.puntos, p] : [p];
      f.tocado = true;
      analizar(i);
    });
  });

  for (const [inp, out] of [[tol, 'oTol'], [grosor, 'oGrosor'], [detalle, 'oDetalle']]) {
    inp.addEventListener('input', () => {
      $(out).textContent = inp.value;
      if (inp === tol) { clearTimeout(tol._t); tol._t = setTimeout(() => { analizar(0); analizar(1); }, 60); }
    });
  }

  async function analizar(i) {
    const f = fotos[i];
    if (!f) return;
    const turno = (f.turno = (f.turno || 0) + 1);
    f.color = null; // se recalcula al crear
    const lienzo = ranuras[i].querySelector('canvas');
    if (usaIA()) {
      try {
        bCrear.disabled = true;
        if (!f.recortar) {
          vistaPrevia(lienzo, f, null);
          f.recortar = await ia.prepararRecorte(f.img, estado);
        }
        estado('Recortando…');
        const m = await f.recortar(f.puntos);
        if (turno !== f.turno) return; // llegó otro toque mientras tanto
        f.mk = limpiarMascara(m);
        estado(f.tocado ? 'Toca más zonas para añadir, o «Quitar zona» para restar.' : 'Si el recorte no es el objeto, tócalo en la foto.');
      } catch (e) {
        console.error(e);
        $('fIA').checked = false; ayuda();
        estado('');
        aviso('No se pudo usar la IA (¿sin conexión?). Se usa el recorte por color.');
        return analizar(i);
      }
    } else {
      f.mk = mascaraDesdeImagen(f.img, { tolerancia: tol.value / 100 });
    }
    vistaPrevia(lienzo, f, usaIA() ? f.puntos : null);
    actualizarBoton();
  }

  bCrear.addEventListener('click', async () => {
    bCrear.disabled = true;
    bCrear.textContent = 'Creando…';
    try {
      let prof = null;
      if (n === 1 && usaIA()) {
        const f = fotos[0];
        try { f.prof = f.prof || await ia.estimarProfundidad(f.img, estado); prof = f.prof; }
        catch (e) { console.error(e); aviso('Sin profundidad de la IA: se usa el inflado.'); }
        estado('');
      }
      await new Promise((r) => setTimeout(r, 30)); // deja pintar el «Creando…»
      const malla = n === 1 ? desdeUnaFoto(fotos[0], +grosor.value / 100, +detalle.value, prof)
                            : desdeDosFotos(fotos[0], fotos[1], +detalle.value, invertir.checked);
      if (!malla) aviso('No se encontró el objeto en la foto. Tócalo en la foto o cambia el recorte.');
      else { hoja.hidden = true; alCrear(malla); }
    } catch (e) {
      console.error(e);
      aviso('No se pudo crear el modelo');
    }
    bCrear.textContent = 'Crear modelo';
    actualizarBoton();
  });

  return { abrir() { hoja.hidden = false; } };
}

async function cargar(archivo) {
  const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(archivo));
  const k = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(1, Math.round(bmp.width * k));
  lienzo.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
  bmp.close?.();
  return { img: ctx.getImageData(0, 0, lienzo.width, lienzo.height), mk: null, color: null, puntos: [{ x: 0.5, y: 0.5, dentro: true }], recortar: null, prof: null };
}

// Foto con el fondo oscurecido, el contorno del recorte resaltado y los puntos tocados.
// Sin máscara (mientras la IA analiza) se ve la foto tal cual.
function vistaPrevia(cv, f, puntos) {
  const { width: w, height: h } = f.img;
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (!f.mk) { ctx.putImageData(f.img, 0, 0); return; }
  const out = ctx.createImageData(w, h);
  const m = f.mk.mascara, src = f.img.data, dst = out.data;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const x = p % w, borde = m[p] && (x === 0 || x === w - 1 || !m[p - 1] || !m[p + 1] || !m[p - w] || !m[p + w]);
    if (borde) { dst[i] = 255; dst[i + 1] = 122; dst[i + 2] = 47; dst[i + 3] = 255; }
    else if (m[p]) { dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; dst[i + 3] = 255; }
    else { dst[i] = src[i] * 0.25; dst[i + 1] = src[i + 1] * 0.25; dst[i + 2] = src[i + 2] * 0.3; dst[i + 3] = 120; }
  }
  ctx.putImageData(out, 0, 0);
  for (const q of puntos || []) {
    ctx.beginPath();
    ctx.arc(q.x * w, q.y * h, Math.max(5, w / 70), 0, Math.PI * 2);
    ctx.fillStyle = q.dentro ? '#2fe07a' : '#ff4d4d';
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
}

function desdeUnaFoto(f, grosor, detalle, profundidad) {
  const r = relieveDesdeMascara(f.mk, { res: detalle * 1.5, grosor, profundidad });
  if (!r) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(r.posiciones, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(r.uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(r.indices, 1));
  geo.scale(ALTO_MODELO, ALTO_MODELO, ALTO_MODELO);
  geo.computeVertexNormals();
  const tex = new THREE.CanvasTexture(lienzoDe(colorDe(f)));
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0 });
  return mallaFinal(geo, mat, 'Foto');
}

function desdeDosFotos(fF, fL, detalle, invertirLado) {
  const r = cascoVisual(fF.mk, fL.mk, { res: Math.round(detalle * 0.75), invertirLado });
  if (!r) return null;
  const nv = r.posiciones.length / 3, col = new Float32Array(nv * 3);
  const muestra = (f, u, v, salida) => {
    const { width: w, height: h, data } = colorDe(f);
    const x = Math.min(w - 1, Math.max(0, Math.floor(u * w))), y = Math.min(h - 1, Math.max(0, Math.floor((1 - v) * h)));
    const p = y * w + x, i = p * 4;
    salida[0] = data[i] / 255; salida[1] = data[i + 1] / 255; salida[2] = data[i + 2] / 255;
    return f.mk.mascara[p] ? 1 : 0.05; // fuera del recorte casi no cuenta
  };
  const cF = [0, 0, 0], cL = [0, 0, 0], lin = new THREE.Color();
  for (let v = 0; v < nv; v++) {
    const wF = (Math.abs(r.normales[v * 3 + 2]) + 0.05) * muestra(fF, r.uvFrente[v * 2], r.uvFrente[v * 2 + 1], cF);
    const wL = (Math.abs(r.normales[v * 3]) + 0.05) * muestra(fL, r.uvLado[v * 2], r.uvLado[v * 2 + 1], cL);
    const s = wF + wL || 1;
    lin.setRGB((cF[0] * wF + cL[0] * wL) / s, (cF[1] * wF + cL[1] * wL) / s, (cF[2] * wF + cL[2] * wL) / s, THREE.SRGBColorSpace);
    col[v * 3] = lin.r; col[v * 3 + 1] = lin.g; col[v * 3 + 2] = lin.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(r.posiciones, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(r.normales, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(r.indices, 1));
  geo.scale(ALTO_MODELO, ALTO_MODELO, ALTO_MODELO);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0 });
  return mallaFinal(geo, mat, 'Fotos');
}

// Foto con el fondo rellenado con el color del borde del objeto.
function colorDe(f) {
  if (!f.color) f.color = sangrar(f.img, f.mk, 8);
  return f.color;
}

function lienzoDe({ data, width, height }) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  c.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
  return c;
}

function mallaFinal(geo, mat, nombre) {
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, mat);
  m.name = nombre;
  m.castShadow = true; m.receiveShadow = true;
  m.userData.tipo = 'foto';
  return m;
}
