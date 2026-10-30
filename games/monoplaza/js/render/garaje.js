// Garajes de boxes abiertos por delante, con su interior: suelo de resina con los colores
// del equipo, pared del fondo con el logotipo, armarios de herramientas, pantallas de
// telemetría, estanterías de ruedas con mantas, alerón de recambio, luces de techo y
// mecánicos trabajando. Y los puestos del muro de boxes con los ingenieros sentados.
//
// Ejes del garaje: x a lo largo de la pista, +y arriba, -z hacia la pista (la puerta).

import * as THREE from 'three';
import { Persona } from './personas.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Funde en una sola malla por material todas las piezas fijas del grupo (menos llamadas de dibujo)
function fusionar(g) {
  const porMat = new Map();
  for (const m of [...g.children]) {
    if (!m.isMesh || m.userData.suelta) continue;
    m.updateMatrix();
    const geo = m.geometry.clone().applyMatrix4(m.matrix);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    const geoI = geo.index ? geo.toNonIndexed() : geo;
    if (!porMat.has(m.material)) porMat.set(m.material, { lista: [], sombra: m.castShadow });
    porMat.get(m.material).lista.push(geoI);
    g.remove(m);
  }
  for (const [mat, { lista, sombra }] of porMat) {
    const f = new THREE.Mesh(mergeGeometries(lista, false), mat);
    f.castShadow = sombra; f.receiveShadow = true;
    g.add(f);
  }
}

const ANCHO = 28, FONDO = 16, ALTO = 9, HUECO = 6.2;

function lienzo(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(cv, rep = [1, 1]) { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); t.anisotropy = 4; return t; }

// Suelo de resina gris con brillo, franja del equipo y la plaza del coche marcada
function texturaSuelo(color) {
  const cv = lienzo(1024, 512), x = cv.getContext('2d');
  x.fillStyle = '#5d6168'; x.fillRect(0, 0, 1024, 512);
  for (let k = 0; k < 4000; k++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.03)`; x.fillRect(Math.random() * 1024, Math.random() * 512, 3, 3); }
  x.fillStyle = color; x.fillRect(0, 0, 1024, 46); x.fillRect(0, 466, 1024, 46);
  x.strokeStyle = '#f2f2f2'; x.lineWidth = 8; x.setLineDash([40, 24]);
  x.strokeRect(330, 150, 364, 212);
  x.setLineDash([]);
  x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '900 italic 60px Arial'; x.textAlign = 'center'; x.fillText('APEX GP', 512, 270);
  return tex(cv);
}

// Pared del fondo: color del equipo, nombre grande y franjas
function texturaFondo(nombre, color) {
  const cv = lienzo(1024, 340), x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 340); g.addColorStop(0, '#0d0f14'); g.addColorStop(1, '#1b1e26');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 340);
  x.fillStyle = color; x.fillRect(0, 230, 1024, 26); x.fillRect(0, 266, 1024, 8);
  const claro = new THREE.Color(color).getHSL({}).l > 0.6;
  x.fillStyle = claro ? '#ffffff' : color; x.font = '900 italic 92px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(nombre.toUpperCase(), 512, 120);
  x.fillStyle = '#fff'; x.font = '700 30px Arial'; x.fillText('POWERED BY UPGAMES', 512, 190);
  return tex(cv);
}

// Pantalla de telemetría: trazas de colores sobre fondo oscuro
function texturaPantalla(semilla) {
  const cv = lienzo(256, 160), x = cv.getContext('2d');
  x.fillStyle = '#05080e'; x.fillRect(0, 0, 256, 160);
  const cols = ['#00e5ff', '#ffd23f', '#18c45a', '#ff3b3b'];
  for (let c = 0; c < 3; c++) {
    x.strokeStyle = cols[(c + semilla) % 4]; x.lineWidth = 2; x.beginPath();
    for (let i = 0; i <= 256; i += 4) { const y = 30 + c * 45 + Math.sin(i * 0.05 + semilla + c) * 12 + Math.sin(i * 0.13 + c * 2) * 6; i ? x.lineTo(i, y) : x.moveTo(i, y); }
    x.stroke();
  }
  x.fillStyle = '#ffffff'; x.font = '700 14px monospace'; x.fillText('S1 28.412  S2 31.077', 8, 152);
  return tex(cv);
}

let compartido = null;
function materiales() {
  if (compartido) return compartido;
  compartido = {
    pared: new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.85 }),
    techo: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.8 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.8, roughness: 0.35 }),
    negro: new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 }),
    goma: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }),
    luz: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 2.2 }),
    carbono: new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.4, roughness: 0.35 }),
  };
  return compartido;
}

/**
 * Garaje completo. Devuelve { grupo, actualizar(dt, camPos) }.
 * k: índice de equipo (para variar), calidad 0..3.
 */
export function crearGaraje({ nombre, color, calidad = 2, k = 0 }) {
  const M = materiales();
  const g = new THREE.Group();
  const caja = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const matEquipo = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 });
  // estructura: fondo, laterales, techo, dintel y pilares de la puerta
  caja(ANCHO, ALTO, 0.3, M.pared, 0, ALTO / 2, FONDO / 2);
  for (const x of [-ANCHO / 2, ANCHO / 2]) caja(0.4, ALTO, FONDO, M.pared, x, ALTO / 2, 0);
  caja(ANCHO + 0.4, 0.4, FONDO, M.techo, 0, ALTO, 0);
  caja(ANCHO + 0.4, ALTO - HUECO, 0.5, M.techo, 0, (ALTO + HUECO) / 2, -FONDO / 2);
  for (const x of [-ANCHO / 2 + 0.6, ANCHO / 2 - 0.6]) caja(1.2, HUECO, 0.6, M.techo, x, HUECO / 2, -FONDO / 2);
  // suelo de resina (brilla un poco)
  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(ANCHO, FONDO), new THREE.MeshStandardMaterial({ map: texturaSuelo(color), roughness: 0.25, metalness: 0.1 }));
  suelo.rotation.x = -Math.PI / 2; suelo.position.y = 0.02; suelo.receiveShadow = true; g.add(suelo);
  // pared del fondo con el logotipo
  const fondo = new THREE.Mesh(new THREE.PlaneGeometry(ANCHO - 1, 5.4), new THREE.MeshStandardMaterial({ map: texturaFondo(nombre, color), roughness: 0.6 }));
  fondo.position.set(0, 3.6, FONDO / 2 - 0.2); fondo.rotation.y = Math.PI; g.add(fondo);
  // luces del techo (tiras)
  for (const x of [-8, 0, 8]) for (const z of [-3, 3]) caja(5, 0.08, 0.35, M.luz, x, ALTO - 0.3, z).castShadow = false;
  if (calidad >= 1) {
    // armarios de herramientas a los lados, en el color del equipo
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      const a = caja(1.6, 1.05, 0.7, matEquipo, sx * (ANCHO / 2 - 1.2), 0.55, 2 + i * 1.8 - 2);
      a.rotation.y = Math.PI / 2;
      caja(1.62, 0.04, 0.72, M.metal, sx * (ANCHO / 2 - 1.2), 1.1, 2 + i * 1.8 - 2).rotation.y = Math.PI / 2;
    }
    // pantallas de telemetría en el fondo
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.95), new THREE.MeshStandardMaterial({ map: texturaPantalla(i + k), emissive: 0xffffff, emissiveMap: texturaPantalla(i + k), emissiveIntensity: 0.9 }));
      p.position.set(-4.5 + i * 3, 2.2, FONDO / 2 - 1.2); p.rotation.y = Math.PI; g.add(p);
      caja(1.6, 1.05, 0.06, M.negro, -4.5 + i * 3, 2.2, FONDO / 2 - 1.15);
      caja(0.08, 1.7, 0.08, M.metal, -4.5 + i * 3, 0.85, FONDO / 2 - 1.15);
    }
    // estanterías con ruedas (con mantas del equipo) a la izquierda y derecha del fondo
    const neum = new THREE.CylinderGeometry(0.36, 0.36, 0.34, 18);
    const matManta = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const r = new THREE.Mesh(neum, j === 2 ? M.goma : matManta);
      r.position.set(sx * (ANCHO / 2 - 3.2 - i * 0.85), 0.2 + j * 0.36, FONDO / 2 - 2.6);
      r.castShadow = true; g.add(r);
    }
    // alerón delantero de recambio sobre su caballete
    caja(1.9, 0.05, 0.5, M.carbono, -9, 1.0, -1.5);
    caja(0.04, 0.32, 0.5, matEquipo, -9.95, 1.12, -1.5); caja(0.04, 0.32, 0.5, matEquipo, -8.05, 1.12, -1.5);
    for (const x of [-9.6, -8.4]) caja(0.06, 1.0, 0.06, M.metal, x, 0.5, -1.5);
    // carro de pistolas neumáticas y mangueras colgando del techo
    caja(1.2, 0.9, 0.6, M.negro, 9, 0.45, -2);
    for (const x of [-3, 3]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, ALTO - 2.2, 6), M.negro);
      m.position.set(x, (ALTO + 2.2) / 2, -4); g.add(m);
    }
  }
  fusionar(g);
  // mecánicos trabajando (solo con calidad alta)
  const gente = [];
  if (calidad >= 2) {
    const quien = [['espera', -6, 1.5, -0.6], ['de_pie', 7.5, 2.5, Math.PI], ['preparado', -9, -0.6, Math.PI / 2]];
    quien.forEach(([pose, x, z, ry], i) => {
      const p = new Persona({ color, texto: nombre.split(' ')[0].toUpperCase(), numero: 60 + i, rol: i === 1 ? 'ingeniero' : 'mecanico', calidad });
      p.raiz.position.set(x, 0, z); p.raiz.rotation.y = ry; p.poner(pose, 0.01);
      p.raiz.traverse(o => { if (o.isMesh) o.castShadow = false; });
      g.add(p.raiz); gente.push(p);
    });
  }
  let t = Math.random() * 10;
  return {
    grupo: g,
    actualizar(dt, cerca) {
      if (!gente.length) return;
      for (const p of gente) p.raiz.visible = cerca;
      if (!cerca) return;
      t += dt;
      // de vez en cuando cambian de postura (revisando, hablando, agachados)
      if (Math.floor(t / 6) !== Math.floor((t - dt) / 6)) {
        const p = gente[Math.floor(Math.random() * gente.length)];
        p.poner(['espera', 'de_pie', 'preparado', 'estabiliza'][Math.floor(Math.random() * 4)], 0.6);
      }
      for (const p of gente) p.actualizar(dt);
    },
  };
}

/** Puesto del muro de boxes: banco, techo, pantallas y dos ingenieros sentados mirando la carrera. */
export function crearPuestoMuro({ nombre, color, calidad = 2 }) {
  const M = materiales();
  const g = new THREE.Group();
  const caja = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const matEquipo = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  caja(4.2, 0.08, 1.1, M.negro, 0, 1.15, 0);                 // mesa
  for (const x of [-2, 2]) caja(0.08, 2.6, 0.08, M.metal, x, 1.3, 0.5);
  caja(4.4, 0.1, 1.6, matEquipo, 0, 2.6, 0.2);               // techo con el color del equipo
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), new THREE.MeshStandardMaterial({ map: texturaPantalla(i), emissive: 0xffffff, emissiveMap: texturaPantalla(i + 2), emissiveIntensity: 0.8 }));
    p.position.set(-1.3 + i * 1.3, 1.6, -0.2); p.rotation.x = -0.15; g.add(p);
  }
  const gente = [];
  if (calidad >= 2) {
    for (const x of [-0.9, 0.9]) {
      caja(0.5, 0.06, 0.5, M.negro, x, 0.55, 0.6);           // taburete
      caja(0.06, 0.55, 0.06, M.metal, x, 0.27, 0.6);
    }
  }
  fusionar(g);
  if (calidad >= 2) {
    for (const x of [-0.9, 0.9]) {
      const p = new Persona({ color, texto: nombre.split(' ')[0].toUpperCase(), rol: 'ingeniero', calidad });
      p.raiz.position.set(x, 0, 0.55); p.raiz.rotation.y = Math.PI / 2; p.poner('sentado', 0.01);
      p.raiz.traverse(o => { if (o.isMesh) o.castShadow = false; });
      g.add(p.raiz); gente.push(p);
    }
  }
  return {
    grupo: g,
    actualizar(dt, cerca) {
      for (const p of gente) { p.raiz.visible = cerca; if (cerca) p.actualizar(dt); }
    },
  };
}
