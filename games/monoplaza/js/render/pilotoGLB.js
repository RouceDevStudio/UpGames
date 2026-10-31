// Piloto con el modelo 3D escaneado, ya sentado al volante (casco, HANS, mono, guantes y botas).
// Viene preparado fuera de línea en las coordenadas del coche (x adelante, y arriba, z a la
// derecha) con dos pesos por vértice: cuánto sigue a la cabeza y cuánto a las manos. Aquí se le
// ponen tres huesos (cuerpo, cabeza y manos): la cabeza se inclina con las fuerzas G y mira a la
// curva como el piloto procedural, y las manos giran con el volante; el antebrazo acompaña poco
// a poco, así nada se estira ni se deforma (el cuerpo no se mueve).
//
// Dos versiones: detallada (tu coche) y ligera (los demás).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Volante del piloto escaneado: centro y caída de la columna (en la carrocería). */
export const VOLANTE_GLB = { x: 0.617, y: 0.637, caida: -0.06 };
const CUELLO = new THREE.Vector3(0.201, 0.668, 0);

const datos = new Map(), listos = {};
export function cargarPilotoGLB(ligero = false) {
  const clave = ligero ? 'bajo' : 'alto';
  if (!datos.has(clave)) {
    datos.set(clave, new GLTFLoader().loadAsync(new URL(`../../modelos/piloto_${clave}.glb`, import.meta.url).href)
      .then(preparar).then(d => { listos[clave] = d; return d; })
      .catch(e => { console.warn('piloto 3D no disponible', e); return null; }));
  }
  return datos.get(clave);
}
/** El que ya esté cargado (o null), sin esperar. */
export function pilotoGLBListo(ligero = false) { return listos[ligero ? 'bajo' : 'alto'] || null; }

function preparar(gltf) {
  let malla = null;
  gltf.scene.traverse(o => { if (o.isMesh && !malla) malla = o; });
  if (!malla) return null;
  const geo = malla.geometry;
  const pw = geo.attributes._pesos, pos = geo.attributes.position, n = pos.count;
  const idx = new Uint16Array(n * 4), pes = new Float32Array(n * 4), zona = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const wc = pw ? pw.getX(i) : 0, wm = pw ? pw.getY(i) : 0;
    idx.set([0, 1, 2, 0], i * 4); pes.set([Math.max(0, 1 - wc - wm), wc, wm, 0], i * 4);
    // zonas para teñir: casco, guantes, botas y mono
    const x = pos.getX(i), y = pos.getY(i);
    zona[i] = wc > 0.5 && y > 0.71 ? 0 : wm > 0.97 ? 2 : x > 0.98 ? 3 : 1;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(pes, 4));
  geo.setAttribute('zona', new THREE.Float32BufferAttribute(zona, 1));
  if (pw) geo.deleteAttribute('_pesos');
  geo.computeBoundingSphere();
  return { geo, mat: malla.material };
}

export class PilotoGLB {
  /** colores: { traje, casco } (CSS). */
  constructor(dat, { traje = '#0d47ff', casco = '#ffffff' } = {}) {
    this.raiz = new THREE.Group();
    // material: el gris del escaneo multiplicado por el color de cada zona
    const mat = dat.mat.clone();
    mat.metalness = 0; mat.roughness = 0.75;
    const cTraje = new THREE.Color(traje).lerp(new THREE.Color(0xffffff), 0.12), cCasco = new THREE.Color(0xffffff).lerp(new THREE.Color(casco), 0.45);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.cTraje = { value: cTraje }; sh.uniforms.cCasco = { value: cCasco };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float zona; varying float vZona;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvZona = zona;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 cTraje; uniform vec3 cCasco; varying float vZona;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 tinte = vZona < 0.5 ? cCasco : vZona < 1.5 ? cTraje : vec3(0.13);
          diffuseColor.rgb *= tinte * 1.45;`);
    };
    mat.customProgramCacheKey = () => 'pilotoGLB2';
    // huesos: cuerpo (fijo), cabeza (en el cuello) y manos (en el centro del volante)
    const cuerpo = new THREE.Bone(), cabeza = new THREE.Bone(), manos = new THREE.Bone();
    cabeza.position.copy(CUELLO);
    manos.position.set(VOLANTE_GLB.x, VOLANTE_GLB.y, 0);
    cuerpo.add(cabeza, manos);
    this.raiz.add(cuerpo);
    this.malla = new THREE.SkinnedMesh(dat.geo, mat);
    this.malla.frustumCulled = false; this.malla.castShadow = true; this.malla.receiveShadow = true;
    this.raiz.add(this.malla);
    this.raiz.updateMatrixWorld(true);
    this.malla.bind(new THREE.Skeleton([cuerpo, cabeza, manos]));
    this.huesos = { cuerpo, cabeza, manos };
    this.eje = new THREE.Vector3(Math.cos(VOLANTE_GLB.caida), Math.sin(VOLANTE_GLB.caida), 0);
  }

  /** La cámara de cabina va dentro del casco: ahí la cabeza se encoge hasta desaparecer. */
  verCabeza(si) { this.huesos.cabeza.scale.setScalar(si ? 1 : 0.0001); }

  /** cabeza: Euler del cuello del piloto procedural; giro: ángulo del volante (rad). */
  posar(cabeza, giro) {
    this.huesos.cabeza.rotation.set(cabeza.x * 0.9, cabeza.y * 0.9, cabeza.z * 0.9);
    this.huesos.manos.quaternion.setFromAxisAngle(this.eje, giro);
  }
}
