// Monoplaza escaneado (modelo 3D): carrocería, alerones, suspensión y halo de una sola pieza,
// ya preparada fuera de línea (tools: x adelante, y arriba, z a la derecha, escala real y sin
// ruedas). Aquí se carga, se le proyecta la librea del equipo con el mismo atlas que el coche
// procedural (arriba / lado derecho / lado izquierdo) y se le da el material: la pintura del
// equipo multiplicada por el sombreado del escaneo (juntas, rejillas, tornillos) y su mapa de
// normales; las piezas oscuras del escaneo y el fondo plano quedan de carbono.
//
// Tres versiones: alta (tu coche), media (rivales) y baja (lejos, sin texturas).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { proyectarUV } from './librea.js';

/** Dónde quedan las ruedas en el escaneo (x del eje delantero y trasero, semivía). */
export const RUEDAS_GLB = { del: 1.852, tras: -1.528, zDel: 0.924, zTras: 0.709, radio: 0.36 };   // (el modelo trae los suyos)

const datos = new Map(), listos = {};
export function cargarCocheGLB(nivel = 'medio') {
  if (!datos.has(nivel)) {
    datos.set(nivel, new GLTFLoader().loadAsync(new URL(`../../modelos/coche_${nivel}.glb`, import.meta.url).href)
      .then(preparar).then(d => { listos[nivel] = d; return d; })
      .catch(e => { console.warn('coche 3D no disponible', e); return null; }));
  }
  return datos.get(nivel);
}
export function cocheGLBListo(nivel = 'medio') { return listos[nivel] || null; }

function preparar(gltf) {
  const ex = gltf.scene.userData?.ruedas;
  if (ex) Object.assign(RUEDAS_GLB, ex);
  const partes = {};
  let mat = null;
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    mat = mat || o.material;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    // la UV del escaneo pasa al canal 1 (normales y sombreado); la 0 es la de la librea
    if (g.attributes.uv) { g.setAttribute('uv1', g.attributes.uv); g.deleteAttribute('uv'); }
    if (!o.name.startsWith('rueda')) proyectarUV(g);      // las ruedas no llevan librea
    g.computeBoundingSphere();
    g.userData.compartida = true;
    partes[o.name] = g;
  });
  if (!partes.cuerpo) return null;
  const detalle = mat?.map || null, normal = mat?.normalMap || null;
  for (const t of [detalle, normal]) if (t) { t.channel = 1; t.anisotropy = 4; }
  if (detalle) detalle.colorSpace = THREE.NoColorSpace;     // se usa como dato (gris), no como color
  // ruedas: goma y llanta del escaneo, oscuras (el gris del escaneo da el relieve)
  return { partes, detalle, normal };
}

const cacheMat = new WeakMap();
/**
 * Material del coche escaneado a partir de la pintura del equipo (mantiene su acabado y las
 * gotas de lluvia). Uno por pintura.
 */
export function materialCocheGLB(pintura, dat) {
  let porDat = cacheMat.get(pintura);
  if (!porDat) { porDat = new Map(); cacheMat.set(pintura, porDat); }
  if (porDat.has(dat)) return porDat.get(dat);
  const m = pintura.clone();
  const previo = pintura.onBeforeCompile;
  if (dat.normal) { m.normalMap = dat.normal; m.normalScale = new THREE.Vector2(0.8, 0.8); }
  const conDetalle = !!(dat.detalle && dat.normal);
  m.onBeforeCompile = (sh, r) => {
    previo?.call(m, sh, r);
    sh.uniforms.mapaDetalle = { value: dat.detalle };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPosC; varying float vAbajo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPosC = position; vAbajo = normal.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vPosC; varying float vAbajo;
      ${conDetalle ? 'uniform sampler2D mapaDetalle;' : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        // fondo plano, tabla y caras de abajo: carbono
        float carb = max(step(vPosC.y, 0.14), smoothstep(-0.55, -0.8, vAbajo));
        // suspensión, portamanguetas y conductos de freno: lo que sale del monocasco junto a
        // cada eje (los pontones no llegan tan lejos ni tan cerca de las ruedas)
        float zA = abs(vPosC.z);
        float eje = min(abs(vPosC.x - ${RUEDAS_GLB.del.toFixed(3)}) * 1.25, abs(vPosC.x - (${RUEDAS_GLB.tras.toFixed(3)})));
        carb = max(carb, step(vPosC.x > 0.5 ? 0.2 : 0.34, zA) * step(eje, 0.55) * step(vPosC.y, 0.72));
        ${conDetalle ? `
        float gD = texture2D(mapaDetalle, vNormalMapUv).r;
        carb = max(carb, smoothstep(0.30, 0.20, gD));          // piezas oscuras del escaneo
        diffuseColor.rgb *= clamp(0.35 + gD * 1.05, 0.55, 1.15);` : ''}
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.028, 0.03, 0.034), carb);
      }`);
  };
  m.customProgramCacheKey = () => 'cocheGLB' + (conDetalle ? 1 : 0) + (dat.normal ? 1 : 0);
  porDat.set(dat, m);
  return m;
}

// ─── Chasis desarmado (lo que queda tras un choque que destroza el coche) ──────────────────
// El monocasco con la suspensión al aire y piezas del fondo: cuando la carrocería sale volando
// en trozos, queda este chasis en su sitio (ya en las coordenadas y escala del coche).
let datDes = null, cargaDes = null;
export function cargarDesarmado() {
  if (!cargaDes) cargaDes = new GLTFLoader().loadAsync(new URL('../../modelos/coche_desarmado.glb', import.meta.url).href).then(g => {
    let m = null; g.scene.traverse(o => { if (o.isMesh && !m) m = o; });
    m.material.roughness = 0.45; m.material.metalness = 0.3; m.material.color.setHex(0x3a3d44);   // carbono
    datDes = { geo: m.geometry, mat: m.material };
    return datDes;
  }).catch(() => null);
  return cargaDes;
}
export const desarmadoListo = () => datDes;

// ─── Neumáticos montados (uno por compuesto, con la marca Up Games y su franja) ──────────────
// Centrados, eje en z, radio 0,36 m. Versión alta para tu coche y baja para los demás.
const RUEDA = {}, cargaRueda = {};
export function cargarRuedas(nivel = 'alto') {
  if (!cargaRueda[nivel]) cargaRueda[nivel] = Promise.all(['blando', 'medio', 'duro', 'inter', 'lluvia'].map(c =>
    new GLTFLoader().loadAsync(new URL(`../../modelos/rueda_${c}_${nivel}.glb`, import.meta.url).href).then(g => {
      let m = null; g.scene.traverse(o => { if (o.isMesh && !m) m = o; });
      m.material.roughness = 0.8; m.material.metalness = 0.1;
      (RUEDA[nivel] ||= {})[c] = { geo: m.geometry, mat: m.material };
    }).catch(() => {}))).then(() => RUEDA[nivel] || null);
  return cargaRueda[nivel];
}
export const ruedasListas = (nivel = 'alto') => RUEDA[nivel] || null;
/** Geometría y material del neumático de ese compuesto (o null). */
export function ruedaDe(nivel, compuesto) { const r = RUEDA[nivel]; return r ? (r[compuesto] || r.medio) : null; }
