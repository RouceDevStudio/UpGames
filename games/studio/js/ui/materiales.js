// Hoja «Material» (sprint 5): PBR (color, metal, rugosidad, emisión, opacidad), biblioteca de
// materiales, textura desde la galería o la cámara, UV automático y vista UV. Cada cambio se
// deshace: se cambia el material entero por una copia modificada.
import * as THREE from 'three';
import { mallaDe, ponerMalla } from '../edicion.js';
import { uvAutomatico } from '../malla/uv.js';

const BIBLIOTECA = {
  pintura: { nombre: 'Pintura de coche', color: 0xd8141f, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 },
  carbono: { nombre: 'Fibra de carbono', color: 0xffffff, metalness: 0.25, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.1, textura: 'carbono', repetir: 6 },
  goma: { nombre: 'Goma', color: 0x141516, metalness: 0, roughness: 0.95 },
  cromo: { nombre: 'Cromo', color: 0xffffff, metalness: 1, roughness: 0.06 },
  cristal: { nombre: 'Cristal', color: 0xcfeaff, metalness: 0, roughness: 0.03, opacity: 0.3, clearcoat: 1 },
  tela: { nombre: 'Tela', color: 0x2b4c8c, metalness: 0, roughness: 1, sheen: 1, sheenColor: 0x9fb8ff },
  metal: { nombre: 'Metal cepillado', color: 0xb8bcc4, metalness: 1, roughness: 0.38 },
  plastico: { nombre: 'Plástico', color: 0xc9d1dc, metalness: 0, roughness: 0.55 },
};

export function instalarMateriales({ escena, historial, edicion, ponerModo, aviso }) {
  const $ = (id) => document.getElementById(id);
  const hoja = $('hojaMaterial');
  $('bibliotecaMat').innerHTML = Object.entries(BIBLIOTECA).map(([k, b]) =>
    `<button data-mat="${k}"><i style="background:${muestra(b)}"></i>${b.nombre}</button>`).join('');

  let pendiente = null; // { obj, antes, nuevo } mientras se arrastra un deslizador

  const obj = () => escena.seleccion;
  // copia física del material para editarla (MeshPhysicalMaterial admite barniz, brillo de tela…)
  function copiaFisica(m) {
    const n = new THREE.MeshPhysicalMaterial();
    for (const k of ['color', 'emissive']) if (m[k]) n[k].copy(m[k]);
    for (const k of ['metalness', 'roughness', 'emissiveIntensity', 'opacity', 'transparent', 'map', 'clearcoat', 'clearcoatRoughness', 'sheen', 'side', 'vertexColors', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits']) if (m[k] !== undefined) n[k] = m[k];
    if (m.sheenColor) n.sheenColor.copy(m.sheenColor);
    n.name = m.name;
    return n;
  }
  function empezar() {
    const o = obj();
    if (!o) return null;
    if (edicion.activo) ponerModo('objeto'); // el modo Editar retoca el material mientras está abierto
    if (!pendiente || pendiente.obj !== o) {
      cerrar();
      pendiente = { obj: o, antes: o.material, nuevo: copiaFisica(o.material) };
      o.material = pendiente.nuevo;
    }
    return pendiente.nuevo;
  }
  function cerrar(nombre = 'Material') {
    if (!pendiente) return;
    const { obj: o, antes, nuevo } = pendiente;
    pendiente = null;
    historial.hacer({ nombre, hacer: () => { o.material = nuevo; pintar(); }, deshacer: () => { o.material = antes; pintar(); } }, { yaHecho: true });
  }

  // deslizadores y colores: vista en vivo al arrastrar, un paso de deshacer al soltar
  const CAMPOS = { mColor: 'color', mMetal: 'metalness', mRugosidad: 'roughness', mEmision: 'emissive', mEmisionInt: 'emissiveIntensity', mOpacidad: 'opacity', mRepetir: 'repetir' };
  for (const [id, campo] of Object.entries(CAMPOS)) {
    $(id).addEventListener('input', () => {
      const m = empezar(); if (!m) return;
      const v = $(id).value;
      if (campo === 'color' || campo === 'emissive') m[campo].set(v);
      else if (campo === 'repetir') { if (m.map) { m.map.repeat.set(+v, +v); m.map.needsUpdate = true; } }
      else { m[campo] = +v; if (campo === 'opacity') m.transparent = +v < 1; }
      if (campo === 'emissive' && m.emissiveIntensity === 0) m.emissiveIntensity = 1;
      m.needsUpdate = true;
      salida();
    });
    $(id).addEventListener('change', () => cerrar(`Material: ${campo}`));
  }

  $('bibliotecaMat').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mat]'); if (!b || !obj()) return;
    const p = BIBLIOTECA[b.dataset.mat];
    const m = empezar();
    m.color.set(p.color); m.metalness = p.metalness; m.roughness = p.roughness;
    m.clearcoat = p.clearcoat || 0; m.clearcoatRoughness = p.clearcoatRoughness ?? 0;
    m.sheen = p.sheen || 0; if (p.sheenColor) m.sheenColor.set(p.sheenColor);
    m.opacity = p.opacity ?? 1; m.transparent = m.opacity < 1; m.depthWrite = m.opacity >= 0.99;
    m.emissive.set(0); m.emissiveIntensity = 0;
    m.map = p.textura === 'carbono' ? texturaCarbono(p.repetir) : null;
    m.needsUpdate = true;
    cerrar(`Material: ${p.nombre}`);
    pintar();
    if (p.textura && !tieneUV(obj())) aviso('Consejo: pulsa «UV automático» para que el tejido quede uniforme');
  });

  // textura desde la galería o la cámara
  hoja.querySelectorAll('input[type=file]').forEach((inp) => inp.addEventListener('change', async () => {
    const f = inp.files[0]; inp.value = '';
    if (!f || !obj()) return;
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(f));
      const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4;
      const m = empezar(); m.map = tex; m.color.set(0xffffff); m.needsUpdate = true;
      cerrar('Textura');
      pintar();
    } catch (e) { console.error(e); aviso('No se pudo abrir la imagen'); }
  }));
  $('bQuitarTextura').onclick = () => { const m = obj()?.material; if (!m?.map) return; const n = empezar(); n.map = null; n.needsUpdate = true; cerrar('Quitar textura'); pintar(); };

  $('bUVAuto').onclick = () => {
    const o = obj(); if (!o) return;
    if (edicion.activo) ponerModo('objeto');
    const antes = mallaDe(o), despues = uvAutomatico(antes).malla;
    historial.hacer({ nombre: 'UV automático', hacer: () => { ponerMalla(o, despues); o.userData.uvAuto = true; pintar(); }, deshacer: () => { ponerMalla(o, antes); delete o.userData.uvAuto; pintar(); } });
    aviso('UV automático: caras agrupadas por dirección, sin solaparse');
  };

  function tieneUV(o) { return o && o.userData.uvAuto; }

  function salida() {
    for (const [id, out] of [['mMetal', 'oMetal'], ['mRugosidad', 'oRugosidad'], ['mEmisionInt', 'oEmisionInt'], ['mOpacidad', 'oOpacidad'], ['mRepetir', 'oRepetir']]) $(out).textContent = (+$(id).value).toFixed(id === 'mRepetir' ? 0 : 2);
  }

  function pintar() {
    const o = obj();
    $('matVacio').hidden = !!o; $('matCuerpo').hidden = !o;
    if (!o) return;
    const m = o.material;
    $('matNombre').textContent = o.name;
    $('mColor').value = `#${m.color.getHexString()}`;
    $('mMetal').value = m.metalness ?? 0; $('mRugosidad').value = m.roughness ?? 0.5;
    $('mEmision').value = `#${(m.emissive || new THREE.Color(0)).getHexString()}`; $('mEmisionInt').value = m.emissiveIntensity ?? 0;
    $('mOpacidad').value = m.opacity ?? 1; $('mRepetir').value = m.map ? m.map.repeat.x : 1;
    salida();
    vistaUV(o);
  }

  // vista UV: la textura (o un damero) y encima las caras de la malla en el espacio UV
  function vistaUV(o) {
    const cv = $('vistaUV'), ctx = cv.getContext('2d'), N = cv.width;
    const img = o.material.map?.image;
    if (img) ctx.drawImage(img, 0, 0, N, N);
    else for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { ctx.fillStyle = (x + y) % 2 ? '#2a3140' : '#1d2330'; ctx.fillRect(x * N / 8, y * N / 8, N / 8, N / 8); }
    const m = mallaDe(o);
    if (m.nF > 20000) return;
    ctx.strokeStyle = 'rgba(255,138,31,.85)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let f = 0; f < m.nF; f++) {
      const hs = m.mediasDeCara(f);
      hs.forEach((h, i) => { const x = m.heUV[h * 2] * N, y = (1 - m.heUV[h * 2 + 1]) * N; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
    }
    ctx.stroke();
  }

  escena.alCambiar(() => { if (!hoja.hidden) pintar(); });
  return { abrir() { hoja.hidden = false; pintar(); }, pintar };
}

function muestra(b) {
  if (b.textura === 'carbono') return 'repeating-linear-gradient(45deg,#111 0 4px,#2b2e33 4px 8px)';
  const c = `#${new THREE.Color(b.color).getHexString()}`;
  return b.metalness > 0.8 ? `linear-gradient(135deg,#fff,${c} 45%,#555)` : c;
}

// Tejido de carbono 2×2 dibujado en un lienzo (se repite sobre la pieza).
function texturaCarbono(repetir = 6) {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), m = N / 4;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const h = (x + y) % 2 === 0;
    const gr = h ? g.createLinearGradient(x * m, 0, x * m + m, 0) : g.createLinearGradient(0, y * m, 0, y * m + m);
    gr.addColorStop(0, '#0d0e10'); gr.addColorStop(0.5, '#3a3d44'); gr.addColorStop(1, '#0d0e10');
    g.fillStyle = gr; g.fillRect(x * m, y * m, m, m);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repetir, repetir); t.anisotropy = 4;
  return t;
}
