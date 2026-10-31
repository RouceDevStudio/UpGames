// Hoja «Desde foto»: elegir 1 o 2 fotos, ver el recorte y crear el modelo.
import * as THREE from 'three';
import { mascaraDesdeImagen, relieveDesdeMascara, cascoVisual, sangrar } from './fotoA3D.js';

const LADO_MAX = 480; // las fotos se analizan reducidas a este lado máximo
const ALTO_MODELO = 2; // unidades de la escena

export function instalarDialogoFoto({ alCrear, aviso }) {
  const hoja = document.getElementById('hojaFoto');
  const ranuras = [...hoja.querySelectorAll('.ranura')];
  const fotos = [null, null]; // { img: ImageData, mk, color }
  let n = 1;
  const $ = (id) => document.getElementById(id);
  const tol = $('fTol'), grosor = $('fGrosor'), detalle = $('fDetalle'), invertir = $('fInvertir'), bCrear = $('bCrearFoto');

  const actualizarBoton = () => { bCrear.disabled = !fotos.slice(0, n).every((f) => f && f.mk && f.mk.area > 50); };

  hoja.querySelectorAll('#fotoModo button').forEach((b) => b.addEventListener('click', () => {
    n = +b.dataset.n;
    hoja.querySelectorAll('#fotoModo button').forEach((q) => q.classList.toggle('activo', q === b));
    ranuras[1].hidden = n === 1;
    $('filaGrosor').hidden = n === 2;
    $('filaInvertir').hidden = n === 1;
    ranuras[0].querySelector('.etq').textContent = n === 1 ? 'Foto' : 'Frente';
    $('fotoAyuda').textContent = n === 1
      ? 'Foto del objeto sobre un fondo liso (pared, mesa, papel). La silueta se recorta sola y se infla en 3D con la foto como textura.'
      : 'Dos fotos del mismo objeto sobre fondo liso: una de frente y otra de lado (girando el objeto 90°), a la misma distancia. Se talla el volumen que encaja con las dos siluetas y se colorea con las fotos.';
    actualizarBoton();
  }));

  ranuras.forEach((r, i) => r.querySelectorAll('input[type=file]').forEach((inp) => inp.addEventListener('change', async () => {
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
  })));

  for (const [inp, out] of [[tol, 'oTol'], [grosor, 'oGrosor'], [detalle, 'oDetalle']]) {
    inp.addEventListener('input', () => {
      $(out).textContent = inp.value;
      if (inp === tol) { clearTimeout(tol._t); tol._t = setTimeout(() => { analizar(0); analizar(1); }, 60); }
    });
  }

  function analizar(i) {
    const f = fotos[i];
    if (!f) return;
    f.mk = mascaraDesdeImagen(f.img, { tolerancia: tol.value / 100 });
    f.color = null; // se recalcula al crear
    vistaPrevia(ranuras[i].querySelector('canvas'), f);
    actualizarBoton();
  }

  bCrear.addEventListener('click', () => {
    bCrear.disabled = true;
    bCrear.textContent = 'Creando…';
    // deja pintar el «Creando…» antes del cálculo
    setTimeout(() => {
      try {
        const malla = n === 1 ? desdeUnaFoto(fotos[0], +grosor.value / 100, +detalle.value)
                              : desdeDosFotos(fotos[0], fotos[1], +detalle.value, invertir.checked);
        if (!malla) aviso('No se encontró el objeto en la foto. Prueba con otro recorte del fondo.');
        else { hoja.hidden = true; alCrear(malla); }
      } catch (e) {
        console.error(e);
        aviso('No se pudo crear el modelo');
      }
      bCrear.textContent = 'Crear modelo';
      actualizarBoton();
    }, 30);
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
  return { img: ctx.getImageData(0, 0, lienzo.width, lienzo.height), mk: null, color: null };
}

// Foto con el fondo oscurecido y el contorno del recorte resaltado.
function vistaPrevia(cv, f) {
  const { width: w, height: h } = f.img;
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const out = ctx.createImageData(w, h);
  const m = f.mk.mascara, src = f.img.data, dst = out.data;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const x = p % w, borde = m[p] && (x === 0 || x === w - 1 || !m[p - 1] || !m[p + 1] || !m[p - w] || !m[p + w]);
    if (borde) { dst[i] = 255; dst[i + 1] = 122; dst[i + 2] = 47; dst[i + 3] = 255; }
    else if (m[p]) { dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; dst[i + 3] = 255; }
    else { dst[i] = src[i] * 0.25; dst[i + 1] = src[i + 1] * 0.25; dst[i + 2] = src[i + 2] * 0.3; dst[i + 3] = 120; }
  }
  ctx.putImageData(out, 0, 0);
}

function desdeUnaFoto(f, grosor, detalle) {
  const r = relieveDesdeMascara(f.mk, { res: detalle * 1.5, grosor });
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
