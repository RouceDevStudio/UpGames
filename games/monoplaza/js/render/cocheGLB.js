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
    // sin índice: las abolladuras y la desintegración trabajan triángulo a triángulo
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    if (o.name === 'cuerpo') quitarTuercas(g);
    g.computeBoundingSphere();
    g.userData.compartida = true;
    partes[o.name] = g;
  });
  if (!partes.cuerpo) return null;
  const mapa = mat?.map || null, normal = mat?.normalMap || null;
  for (const t of [mapa, normal]) if (t) t.anisotropy = 8;
  return { partes, mapa, normal, colores: !!partes.cuerpo.attributes.color };
}

// El escaneo trae las tuercas de sus ruedas delanteras, que asoman por fuera de la llanta de
// las ruedas del juego: se quitan los triángulos que sobresalen de los bujes delanteros.
function quitarTuercas(g) {
  const p = g.attributes.position, n = p.count / 3, quedan = [];
  for (let t = 0; t < n; t++) {
    let fuera = false;
    for (let v = t * 3; v < t * 3 + 3 && !fuera; v++) {
      const x = p.getX(v), y = p.getY(v), z = Math.abs(p.getZ(v));
      fuera = z > RUEDAS_GLB.zDel + 0.09 && x > RUEDAS_GLB.del - 0.3 && x < RUEDAS_GLB.del + 0.3 && y > 0.1 && y < 0.7;
    }
    if (!fuera) quedan.push(t);
  }
  if (quedan.length === n) return;
  for (const nombre of Object.keys(g.attributes)) {
    const a = g.attributes[nombre], tam = a.itemSize, nuevo = new a.array.constructor(quedan.length * 3 * tam);
    quedan.forEach((t, k) => nuevo.set(a.array.subarray(t * 3 * tam, (t + 1) * 3 * tam), k * 3 * tam));
    g.setAttribute(nombre, new THREE.BufferAttribute(nuevo, tam, a.normalized));
  }
}

const cacheMat = new Map();
/**
 * Material del coche: la textura en alta definición del propio modelo (o, en los rivales, su
 * color grabado en los vértices) teñida con el color del equipo: las zonas claras del modelo
 * toman el color, las oscuras quedan de carbono. Sin proyecciones, así nada se estira.
 */
export function materialCocheGLB(colores, dat) {
  const clave = (colores.base || '') + '|' + (colores.acento || '') + '|' + (dat.mapa ? dat.mapa.uuid : 'v');
  if (cacheMat.has(clave)) return cacheMat.get(clave);
  const m = new THREE.MeshPhysicalMaterial({
    map: dat.mapa, normalMap: dat.normal, vertexColors: !dat.mapa && dat.colores,
    roughness: 0.32, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.12,
  });
  if (dat.normal) m.normalScale = new THREE.Vector2(1, 1);
  const cBase = new THREE.Color(colores.base || '#c8102e'), cAcento = new THREE.Color(colores.acento || '#ffffff');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.cBase = { value: cBase }; sh.uniforms.cAcento = { value: cAcento };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 cBase; uniform vec3 cAcento;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        // luminancia del modelo: claro -> color del equipo (con toques del acento en lo más
        // claro), oscuro -> carbono; el relieve y el detalle del modelo se conservan
        float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 eq = mix(cBase, cAcento, smoothstep(0.78, 0.95, l) * 0.6);
        diffuseColor.rgb = mix(vec3(0.03, 0.032, 0.036), eq, smoothstep(0.03, 0.3, l)) * (0.85 + 0.6 * l);
      }`);
  };
  m.customProgramCacheKey = () => 'cocheGLB3' + (dat.mapa ? 'm' : 'v');
  cacheMat.set(clave, m);
  return m;
}
