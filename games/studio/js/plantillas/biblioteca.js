// Biblioteca de piezas (mejora 8): piezas listas para montar más rápido. Cada una sale como un
// grupo centrado en el origen y apoyado en el suelo; se pueden editar como cualquier objeto.
import * as THREE from 'three';
import { construirMonoplaza } from './monoplaza.js';
import { casco, volante } from './piloto.js';
import { caja, material, centrar, objetoDeMalla } from './forma.js';
import { MallaHE } from '../malla/mediaArista.js';
import { subdividir } from '../malla/subdividir.js';
import { moverVertices } from '../malla/operaciones.js';
import { mallas } from '../escena.js';

const delCoche = (filtro) => construirMonoplaza().filter((o) => filtro(o.name));

export const PIEZAS = [
  { id: 'rueda', nombre: 'Rueda F1', crear: () => delCoche((n) => n.startsWith('rueda_del_izq') || n === 'freno_del_izq') },
  { id: 'aleronDel', nombre: 'Alerón delantero', crear: () => delCoche((n) => n.startsWith('aleron_delantero')) },
  { id: 'aleronTra', nombre: 'Alerón trasero', crear: () => delCoche((n) => n.startsWith('aleron_trasero') || n === 'luz_lluvia') },
  { id: 'halo', nombre: 'Halo', crear: () => delCoche((n) => n.startsWith('halo')) },
  { id: 'casco', nombre: 'Casco', crear: () => casco() },
  { id: 'volante', nombre: 'Volante', crear: () => volante() },
  { id: 'cono', nombre: 'Cono de pista', crear: cono },
  { id: 'barrera', nombre: 'Barrera Tecpro', crear: barrera },
  { id: 'neumaticos', nombre: 'Pila de neumáticos', crear: pilaNeumaticos },
];

// Construye la pieza y la deja centrada en x/z y con la base en y = 0.
export function crearPieza(id) {
  const p = PIEZAS.find((q) => q.id === id);
  const objs = p.crear();
  const c = new THREE.Box3();
  for (const o of objs) { o.updateMatrixWorld(); c.expandByObject(o); }
  const centro = c.getCenter(new THREE.Vector3());
  for (const o of objs) { o.position.x -= centro.x; o.position.z -= centro.z; o.position.y -= c.min.y; }
  return { objs, nombre: p.nombre };
}

function cono() {
  const g = new THREE.ConeGeometry(0.16, 0.7, 32, 6, true);
  const m = new THREE.Mesh(g, material(0xff6a13, 0.6, 0)); m.name = 'cono'; m.position.y = 0.37;
  const franja = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.105, 0.12, 32, 1, true), material(0xf2f2f2, 0.4, 0));
  franja.name = 'cono_franja'; franja.position.y = 0.42; franja.scale.setScalar(1.02);
  const base = caja('cono_base', [0.42, 0.04, 0.42], [0, 0.02, 0], [0, 0, 0], 0x17191d);
  for (const o of [m, franja]) { o.castShadow = o.receiveShadow = true; o.material.side = THREE.DoubleSide; }
  return [m, franja, base];
}

// Bloque de barrera con los cantos redondeados (caja con cortes, subdividida)
function barrera() {
  const g = new THREE.BoxGeometry(1.5, 1, 0.8, 6, 4, 4); // muchos cortes: al subdividir solo se redondean los cantos
  let m = MallaHE.desdeTriangulos(g.attributes.position.array, g.index.array, { uvs: g.attributes.uv.array });
  m = moverVertices(m, [...Array(m.nV).keys()], ([x, y, z]) => [x, y + 0.5, z]).malla;
  m = subdividir(m, 1).malla;
  const bloque = objetoDeMalla(m, 'barrera', 0xd8141f, mallas);
  bloque.material.roughness = 0.5;
  const franja = caja('barrera_franja', [1.42, 0.16, 0.82], [0, 0.62, 0], [0, 0, 0], 0xf2f2f2);
  return [bloque, franja];
}

function pilaNeumaticos() {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const n = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.12, 14, 32), material(0x141516, 0.9, 0));
    n.name = `neumatico_${i + 1}`; n.castShadow = n.receiveShadow = true;
    centrar(n);
    n.rotation.x = Math.PI / 2; n.position.set(0, 0.12 + i * 0.23, 0); // tumbados y apilados
    out.push(n);
  }
  return out;
}
