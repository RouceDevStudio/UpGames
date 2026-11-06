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
import { ATLAS } from './librea.js';

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
    if (o.name === 'cuerpo') {
      separar(g, esTuerca);
      // cada retrovisor, centrado en sí mismo (gira sobre su centro al romperse y volar)
      for (const [nombre, sg] of [['espejoIzq', 1], ['espejoDer', -1]]) {
        const e = separar(g, esEspejo(sg));
        if (!e) continue;
        e.computeBoundingBox(); const c = e.boundingBox.getCenter(new THREE.Vector3());
        e.translate(-c.x, -c.y, -c.z); e.computeBoundingSphere();
        e.userData = { compartida: true, centro: c };
        partes[nombre] = e;
      }
    }
    g.computeBoundingSphere();
    g.userData.compartida = true;
    partes[o.name] = g;
  });
  if (!partes.cuerpo) return null;
  const mapa = mat?.map || null, normal = mat?.normalMap || null;
  for (const t of [mapa, normal]) if (t) t.anisotropy = 8;
  return { partes, mapa, normal, colores: !!partes.cuerpo.attributes.color };
}

// Separa de la geometría (sin índice) los triángulos cuyo centro cumple `dentro(x, y, z)`:
// devuelve una geometría nueva con ellos (o null) y los quita de la original.
function separar(g, dentro) {
  const p = g.attributes.position, n = p.count / 3, quedan = [], salen = [];
  for (let t = 0; t < n; t++) {
    const v = t * 3;
    const x = (p.getX(v) + p.getX(v + 1) + p.getX(v + 2)) / 3, y = (p.getY(v) + p.getY(v + 1) + p.getY(v + 2)) / 3, z = (p.getZ(v) + p.getZ(v + 1) + p.getZ(v + 2)) / 3;
    (dentro(x, y, z) ? salen : quedan).push(t);
  }
  if (!salen.length) return null;
  const fuera = new THREE.BufferGeometry();
  for (const nombre of Object.keys(g.attributes)) {
    const a = g.attributes[nombre], tam = a.itemSize;
    const copia = (lista) => { const nuevo = new a.array.constructor(lista.length * 3 * tam); lista.forEach((t, k) => nuevo.set(a.array.subarray(t * 3 * tam, (t + 1) * 3 * tam), k * 3 * tam)); return new THREE.BufferAttribute(nuevo, tam, a.normalized); };
    fuera.setAttribute(nombre, copia(salen));
    g.setAttribute(nombre, copia(quedan));
  }
  return fuera;
}

// El escaneo trae las tuercas de sus ruedas delanteras, que asoman por fuera de la llanta de
// las ruedas del juego: se quitan.
const esTuerca = (x, y, z) => Math.abs(z) > RUEDAS_GLB.zDel + 0.09 && Math.abs(x - RUEDAS_GLB.del) < 0.3 && y > 0.1 && y < 0.7;

/** Retrovisores del escaneo (carcasa y brazo), a cada lado del habitáculo: se rompen aparte. */
export const ESPEJOS_GLB = { x0: 0.66, x1: 0.98, y0: 0.665, y1: 0.86, z0: 0.36, z1: 0.68 };
const esEspejo = (sg) => (x, y, z) => x > ESPEJOS_GLB.x0 && x < ESPEJOS_GLB.x1 && y > ESPEJOS_GLB.y0 && y < ESPEJOS_GLB.y1 && z * sg > ESPEJOS_GLB.z0 && z * sg < ESPEJOS_GLB.z1;

const cacheMat = new Map();
/**
 * Material del coche: el color grabado en los vértices del escaneo decide qué es pintura (claro)
 * y qué es carbono (oscuro: fondo, suspensión, interior de los alerones). La pintura toma la
 * librea del equipo (franjas, colores, dorsal, logotipos o la imagen propia del jugador),
 * proyectada en el shader desde el atlas de librea.js: vista de arriba para las caras que miran
 * arriba y laterales para las de los lados, mezcladas suave según la normal (así no se estira
 * en las curvas). El relieve y las sombras del escaneo se conservan.
 */
export function materialCocheGLB(colores, dat, librea = null) {
  const clave = (colores.base || '') + '|' + (colores.acento || '') + '|' + (dat.mapa ? dat.mapa.uuid : 'v') + '|' + (librea ? librea.uuid : '-');
  if (cacheMat.has(clave)) return cacheMat.get(clave);
  const m = new THREE.MeshPhysicalMaterial({
    map: dat.mapa, normalMap: dat.normal, vertexColors: !dat.mapa && dat.colores,
    roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08,
  });
  if (dat.normal) m.normalScale = new THREE.Vector2(1, 1);
  const cBase = new THREE.Color(colores.base || '#c8102e'), cAcento = new THREE.Color(colores.acento || '#ffffff');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.cBase = { value: cBase }; sh.uniforms.cAcento = { value: cAcento };
    sh.uniforms.mapaLibrea = { value: librea };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPosO; varying vec3 vNorO;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPosO = position; vNorO = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      #define PINT_0 0.014
      #define PINT_1 0.03
      uniform vec3 cBase; uniform vec3 cAcento; uniform sampler2D mapaLibrea;
      varying vec3 vPosO; varying vec3 vNorO;
      // atlas de librea.js (ATLAS): ${ATLAS.x0} .. ${ATLAS.x1} en x, ±${ATLAS.zMax} en z, ${ATLAS.yMax} de alto
      vec3 librea(vec3 p, vec3 n) {
        float u = clamp((p.x - (${ATLAS.x0.toFixed(4)})) / ${(ATLAS.x1 - ATLAS.x0).toFixed(4)}, 0.002, 0.998);
        vec2 uvA = vec2(u, 1.0 - clamp((p.z + ${ATLAS.zMax.toFixed(4)}) / ${(2 * ATLAS.zMax).toFixed(4)}, 0.004, 0.996) * 0.5);
        float v = (1.0 - clamp(p.y / ${ATLAS.yMax.toFixed(4)}, 0.004, 0.996)) * 0.25;
        vec2 uvL = n.z >= 0.0 ? vec2(u, 1.0 - (0.5 + v)) : vec2(1.0 - u, 1.0 - (0.75 + v));
        float wa = smoothstep(0.48, 0.66, abs(n.y));
        vec3 c = mix(texture2D(mapaLibrea, uvL).rgb, texture2D(mapaLibrea, uvA).rgb, wa);
        // caras que miran adelante o atrás (bocas de los pontones, cantos de los alerones): ahí
        // la proyección se estiraría; van del color base del equipo
        return mix(c, cBase, smoothstep(0.62, 0.85, abs(n.x)) * (1.0 - wa));
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        ${librea ? 'vec3 eq = librea(vPosO, normalize(vNorO));' : 'vec3 eq = mix(cBase, cAcento, smoothstep(0.78, 0.95, l) * 0.6);'}
        // claro -> pintura (con el sombreado del escaneo), oscuro -> carbono
        // el fondo plano y la tabla son de carbono sin pintar, como en los coches de verdad
        // (el color del escaneo viene ya promediado: solo separa pintura de carbono; la pintura va
        // uniforme, sin las sombras horneadas que la hacían ver a manchas)
        float pintado = smoothstep(PINT_0, PINT_1, l) * smoothstep(0.1, 0.17, vPosO.y);
        // brazos de suspensión, manguetas y conductos de freno: carbono, como en los F1 reales
        float az = abs(vPosO.z);
        float suspD = step(1.5, vPosO.x) * step(vPosO.x, 2.45) * smoothstep(0.3, 0.36, az);
        float suspT = step(-2.05, vPosO.x) * step(vPosO.x, -1.38) * smoothstep(0.34, 0.4, az);
        pintado *= 1.0 - max(suspD, suspT);
        diffuseColor.rgb = mix(vec3(0.028, 0.03, 0.034), eq, pintado);
      }`);
  };
  m.customProgramCacheKey = () => 'cocheGLB5' + (dat.mapa ? 'm' : 'v') + (librea ? 'L' : '');
  cacheMat.set(clave, m);
  return m;
}
