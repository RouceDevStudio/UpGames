// Coche propio en GLB (hecho en UpGames Studio u otro programa): sustituye la carrocería del
// monoplaza del jugador; las físicas no cambian. Las piezas se reconocen por su nombre:
//   rueda_del_izq, rueda_del_der, rueda_tra_izq, rueda_tra_der (y sus sufijos, p. ej. _llanta):
//   van a las ruedas del juego (giran y se orientan con la dirección);
//   casco_piloto / visera: se quitan (el piloto es el del juego).
// Ejes del GLB como en Studio: +z delante, +y arriba, x > 0 a la izquierda del piloto, en metros.
// Se escala para que la batalla (distancia entre ejes) sea la del juego.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { COCHE } from '../config.js';

const RUEDAS = ['rueda_del_izq', 'rueda_del_der', 'rueda_tra_izq', 'rueda_tra_der']; // mismo orden que el juego
const QUITAR = /^(casco_piloto|visera|piloto)/;
let plantilla = null, nombre = '';

function bd() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('apexgp-coche', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('glb');
    r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
  });
}
async function bdOp(modo, fn) { const db = await bd(); return new Promise((ok, mal) => { const t = db.transaction('glb', modo), r = fn(t.objectStore('glb')); t.oncomplete = () => ok(r?.result); t.onerror = () => mal(t.error); }); }

async function analizar(buf) {
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const escena = gltf.scene;
  escena.updateMatrixWorld(true);
  // ruedas: centro de cada una (cajas de sus piezas)
  const cajas = RUEDAS.map(() => new THREE.Box3());
  const todo = new THREE.Box3();
  escena.traverse((o) => {
    if (!o.isMesh) return;
    if (QUITAR.test(o.name)) return;
    todo.expandByObject(o);
    const k = RUEDAS.findIndex((r) => o.name.startsWith(r));
    if (k >= 0) cajas[k].expandByObject(o);
  });
  if (todo.isEmpty()) throw new Error('El GLB no tiene mallas');
  const del = cajas.slice(0, 2).filter((c) => !c.isEmpty()), tra = cajas.slice(2).filter((c) => !c.isEmpty());
  const zDe = (l) => l.reduce((s, c) => s + c.getCenter(new THREE.Vector3()).z, 0) / l.length;
  let escala, zDel;
  if (del.length && tra.length) { zDel = zDe(del); escala = COCHE.wheelbase / Math.abs(zDel - zDe(tra)); }
  else { const largo = todo.max.z - todo.min.z; escala = 5.5 / largo; zDel = todo.max.z - largo * 0.18; } // sin ruedas: un F1 mide ~5,5 m
  return { escena, cajas, todo, escala, zDel };
}

// al arrancar: el coche guardado (si lo hay)
export async function cargarCocheGuardado() {
  try {
    const r = await bdOp('readonly', (s) => s.get('actual'));
    if (r?.buf) { plantilla = await analizar(r.buf); nombre = r.nombre || 'Coche propio'; }
  } catch (e) { console.warn('coche GLB', e); plantilla = null; }
  return !!plantilla;
}
export async function guardarCoche(archivo) {
  const buf = await archivo.arrayBuffer();
  const p = await analizar(buf); // valida antes de guardar
  await bdOp('readwrite', (s) => s.put({ buf, nombre: archivo.name.replace(/\.glb$/i, '') }, 'actual'));
  plantilla = p; nombre = archivo.name.replace(/\.glb$/i, '');
  return { nombre, ruedas: p.cajas.filter((c) => !c.isEmpty()).length };
}
export async function quitarCoche() { await bdOp('readwrite', (s) => s.delete('actual')); plantilla = null; nombre = ''; }
export const cocheGLB = () => (plantilla ? { nombre, ruedas: plantilla.cajas.filter((c) => !c.isEmpty()).length } : null);

// Aplica el coche propio al modelo de crearModelo(): esconde la carrocería del juego (menos el
// piloto y el volante) y monta las piezas del GLB; las ruedas del GLB sustituyen a las del juego.
export function aplicarCoche(m) {
  if (!plantilla) return false;
  const { escena, cajas, todo, escala, zDel } = plantilla;
  const A = COCHE.wheelbase * (1 - COCHE.repartoDel);
  // GLB (x izq, z delante) → coche del juego (x delante, z derecha): giro de +90° en y, escala y desplazamiento
  const T = new THREE.Matrix4().makeTranslation(A - zDel * escala, -todo.min.y * escala, 0)
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeScale(escala, escala, escala));
  const conservar = new Set([m.piloto?.grupo, m.columna].filter(Boolean));
  for (const h of m.carroceria.children) if (!conservar.has(h)) h.visible = false;
  m.alaDel && (m.alaDel.visible = false); m.alaTras && (m.alaTras.visible = false);
  const cuerpo = new THREE.Group(); cuerpo.name = 'coche_glb';
  const usadas = [false, false, false, false];
  escena.traverse((o) => {
    if (!o.isMesh || QUITAR.test(o.name)) return;
    const k = RUEDAS.findIndex((r) => o.name.startsWith(r));
    const malla = new THREE.Mesh(o.geometry, o.material);
    malla.castShadow = true; malla.receiveShadow = true; malla.name = o.name;
    const M = T.clone().multiply(o.matrixWorld);
    if (k >= 0 && m.ruedas[k]) {
      // al grupo que gira la rueda, con su centro en el eje de la rueda del juego
      const c = cajas[k].getCenter(new THREE.Vector3()).applyMatrix4(T);
      new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z).multiply(M).decompose(malla.position, malla.quaternion, malla.scale);
      m.ruedas[k].rot.add(malla);
      usadas[k] = true;
    } else {
      M.decompose(malla.position, malla.quaternion, malla.scale);
      cuerpo.add(malla);
    }
  });
  m.carroceria.add(cuerpo);
  // ruedas del juego que el GLB sustituye: se esconden sus piezas
  usadas.forEach((u, k) => { if (!u) return; const w = m.ruedas[k]; for (const p of [w.neum, w.tapa, w.borroso]) if (p) p.visible = false; for (const h of w.rot.children) if (!h.name?.startsWith('rueda_')) h.visible = false; });
  m.cocheGLB = true;
  return true;
}
