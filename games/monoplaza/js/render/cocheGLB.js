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
export const RUEDAS_GLB = { del: 1.913, tras: -1.589, z: 0.818 };

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
  const partes = {};
  let mat = null;
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    mat = mat || o.material;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    // la UV del escaneo pasa al canal 1 (normales y sombreado); la 0 es la de la librea
    if (g.attributes.uv) { g.setAttribute('uv1', g.attributes.uv); g.deleteAttribute('uv'); }
    proyectarUV(g);
    g.computeBoundingSphere();
    g.userData.compartida = true;
    partes[o.name] = g;
  });
  if (!partes.cuerpo) return null;
  const detalle = mat?.map || null, normal = mat?.normalMap || null;
  for (const t of [detalle, normal]) if (t) { t.channel = 1; t.anisotropy = 4; }
  if (detalle) detalle.colorSpace = THREE.NoColorSpace;     // se usa como dato (gris), no como color
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
