// Primitivas del modo objeto. Todas apoyadas sobre el suelo (y = 0) al crearse.
import * as THREE from 'three';

const ic = (d) => `<svg viewBox="0 0 32 32">${d}</svg>`;

export const PRIMITIVAS = [
  { id: 'cubo', nombre: 'Cubo', icono: ic('<path d="M16 4l11 6v12l-11 6-11-6V10z"/><path d="M5 10l11 6 11-6M16 16v12"/>'),
    geo: (o) => new THREE.BoxGeometry(1, 1, 1, o.segmentos || 1, o.segmentos || 1, o.segmentos || 1), alto: 1 },
  { id: 'esfera', nombre: 'Esfera UV', icono: ic('<circle cx="16" cy="16" r="11"/><ellipse cx="16" cy="16" rx="11" ry="4"/><ellipse cx="16" cy="16" rx="4" ry="11"/>'),
    geo: (o) => new THREE.SphereGeometry(0.5, o.radiales || 32, o.anillos || 16), alto: 1 },
  { id: 'ico', nombre: 'Icoesfera', icono: ic('<path d="M16 5l10 6v10l-10 6-10-6V11z"/><path d="M16 5l-4 9h8zM12 14l-6 7M20 14l6 7M12 14l4 13 4-13"/>'),
    geo: () => new THREE.IcosahedronGeometry(0.5, 2), alto: 1 },
  { id: 'cilindro', nombre: 'Cilindro', icono: ic('<ellipse cx="16" cy="8" rx="9" ry="3.5"/><path d="M7 8v16c0 2 4 3.5 9 3.5s9-1.5 9-3.5V8"/>'),
    geo: (o) => new THREE.CylinderGeometry(0.5, 0.5, 1, o.radiales || 32, o.segmentos || 1), alto: 1 },
  { id: 'cono', nombre: 'Cono', icono: ic('<path d="M16 4L7 24M16 4l9 20"/><ellipse cx="16" cy="24" rx="9" ry="3.5"/>'),
    geo: () => new THREE.ConeGeometry(0.5, 1, 32), alto: 1 },
  { id: 'toro', nombre: 'Toro', icono: ic('<ellipse cx="16" cy="16" rx="12" ry="7"/><ellipse cx="16" cy="15" rx="5" ry="2.2"/>'),
    geo: (o) => new THREE.TorusGeometry(0.4, 0.15, o.anillos || 16, o.radiales || 48).rotateX(-Math.PI / 2), alto: 0.3 },
  { id: 'plano', nombre: 'Plano', icono: ic('<path d="M4 20l12-7 12 7-12 7z"/>'),
    geo: () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), alto: 0 },
  { id: 'capsula', nombre: 'Cápsula', icono: ic('<rect x="10" y="4" width="12" height="24" rx="6"/>'),
    geo: () => new THREE.CapsuleGeometry(0.3, 0.6, 8, 24), alto: 1.2 },
];

const PALETA = [0xc9d1dc, 0xe8202a, 0x2f7bff, 0xffd23f, 0x2fe07a, 0xb84dff, 0xff7a2f, 0x00d2ff];
let n = 0;

// opciones (como en Blender al añadir): { segmentos, radiales, anillos }
export function crearPrimitiva(id, opciones = {}) {
  const p = PRIMITIVAS.find((q) => q.id === id);
  if (!p) throw new Error(`primitiva desconocida: ${id}`);
  const geo = p.geo(opciones);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0); // origen en la base
  const mat = new THREE.MeshStandardMaterial({ color: PALETA[n++ % PALETA.length], roughness: 0.55, metalness: 0.05, side: id === 'plano' ? THREE.DoubleSide : THREE.FrontSide });
  const m = new THREE.Mesh(geo, mat);
  m.name = p.nombre;
  m.castShadow = true; m.receiveShadow = true;
  m.userData.tipo = id;
  return m;
}
