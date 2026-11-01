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
// (dónde quedan el volante y el cuello lo guarda el propio modelo, según cómo se colocó)
export const VOLANTE_GLB = { x: 0.848, y: 0.603, caida: -0.28 };
const CUELLO = new THREE.Vector3(0.247, 0.689, 0);

// el volante escaneado (pantalla, LEDs, rotativos y levas), en la mano del piloto
let datVol = null, cargaVol = null;
export function cargarVolanteGLB() {
  if (!cargaVol) cargaVol = new GLTFLoader().loadAsync(new URL('../../modelos/volante.glb', import.meta.url).href)
    .then(g => { let m = null; g.scene.traverse(o => { if (o.isMesh && !m) m = o; }); datVol = m ? { geo: m.geometry, mat: m.material } : null; return datVol; })
    .catch(() => null);
  return cargaVol;
}
export const volanteGLBListo = () => datVol;
cargarVolanteGLB();
// placa con el logo del juego (tapa el logo de marca que trae el escaneo en el centro)
let texPlaca = null;
function placaApex() {
  if (!texPlaca) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const x = cv.getContext('2d');
    x.fillStyle = '#0b0c0f'; x.fillRect(0, 0, 128, 64); x.fillStyle = '#e8202a'; x.font = '900 italic 30px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('APEX', 64, 33);
    texPlaca = new THREE.CanvasTexture(cv); texPlaca.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.015), new THREE.MeshStandardMaterial({ map: texPlaca, roughness: 0.4 }));
  m.rotation.y = -Math.PI / 2; m.position.set(-0.047, -0.007, 0.008); m.scale.setScalar(1.5);
  return m;
}

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
  const ex = gltf.scene.userData || {};
  if (ex.volante) { VOLANTE_GLB.x = ex.volante[0]; VOLANTE_GLB.y = ex.volante[1]; }
  if (ex.cuello) CUELLO.set(ex.cuello[0], ex.cuello[1], 0);
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


// material: el gris del escaneo multiplicado por el color de cada zona (casco, mono, guantes y botas)
function materialPiloto(dat, traje = '#0d47ff', casco = '#ffffff') {
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
  return mat;
}

export class PilotoGLB {
  /** colores: { traje, casco } (CSS). */
  constructor(dat, { traje = '#0d47ff', casco = '#ffffff' } = {}) {
    this.raiz = new THREE.Group();
    const mat = materialPiloto(dat, traje, casco);
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
    // el volante escaneado va en el hueso de las manos: gira con ellas, sin deformar nada
    this.volante = new THREE.Group(); this.volante.rotation.z = VOLANTE_GLB.caida;
    manos.add(this.volante);
    if (datVol) {
      const v = new THREE.Mesh(datVol.geo, datVol.mat); v.castShadow = true;
      this.volante.add(v, placaApex());
    }
    this.eje = new THREE.Vector3(Math.cos(VOLANTE_GLB.caida), Math.sin(VOLANTE_GLB.caida), 0);
  }

  /** Pone la pantalla viva del juego (marcha, deltas…) sobre la pantalla del volante escaneado. */
  ponerPantalla(mp) {
    if (!mp || !datVol) return;
    mp.removeFromParent(); mp.visible = true; delete mp.userData.oculto;
    mp.position.set(-0.047, 0.056, 0.009); mp.rotation.set(0, -Math.PI / 2, 0); mp.scale.setScalar(1.15);
    this.volante.add(mp);
  }

  /** La cámara de cabina va dentro del casco: ahí la cabeza se encoge hasta desaparecer. */
  verCabeza(si) { this.huesos.cabeza.scale.setScalar(si ? 1 : 0.0001); }

  /** cabeza: Euler del cuello del piloto procedural; giro: ángulo del volante (rad). */
  posar(cabeza, giro) {
    this.huesos.cabeza.rotation.set(cabeza.x * 0.9, cabeza.y * 0.9, cabeza.z * 0.9);
    this.huesos.manos.quaternion.setFromAxisAngle(this.eje, giro);
  }
}

