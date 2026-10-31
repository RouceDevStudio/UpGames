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

/**
 * Material de las ruedas escaneadas de un coche: goma mate, llanta metálica y la franja del
 * compuesto en el flanco (como las de verdad). `color` es el del compuesto; se cambia con
 * `mat.userData.compuesto.value.set(...)` al montar otro juego.
 */
export function materialRuedaGLB(dat, color) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: dat.detalle, normalMap: dat.normal, roughness: 0.85, metalness: 0 });
  const comp = { value: new THREE.Color(color) };
  m.userData.compuesto = comp;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.cComp = comp;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPR;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPR = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 cComp; varying vec3 vPR;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float r = length(vPR.xy), g = diffuseColor.r;
          float llanta = 1.0 - smoothstep(0.225, 0.24, r);
          float flanco = smoothstep(0.1, 0.13, abs(vPR.z));
          float franja = flanco * smoothstep(0.272, 0.278, r) * (1.0 - smoothstep(0.296, 0.302, r));
          vec3 goma = vec3(0.045, 0.046, 0.05) * (0.6 + g * 0.8);
          vec3 metal = vec3(0.16, 0.165, 0.175) * (0.5 + g);
          diffuseColor.rgb = mix(mix(goma, metal, llanta), cComp * 0.85, franja);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, 1.0 - smoothstep(0.225, 0.24, length(vPR.xy)));')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.75, 1.0 - smoothstep(0.225, 0.24, length(vPR.xy)));');
  };
  m.customProgramCacheKey = () => 'ruedaGLB';
  return m;
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
