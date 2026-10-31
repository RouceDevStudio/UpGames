// Proyectos (sprint 6): guardar y abrir .ups, guardado automático en el móvil (IndexedDB) cada
// 10 s y al salir, exportar GLB / OBJ / STL e importar GLB / OBJ / .ups.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { mallaDe, ponerMalla } from '../edicion.js';
import { mallas } from '../escena.js';
import { VERSION_UPS, mallaADatos, datosAMalla, comprimir, descomprimir } from './ups.js';
import { exportarGLB } from './glb.js';

// ---------- escena ↔ datos ----------

function materialADatos(m) {
  const d = { tipo: m.type, color: m.color?.getHex(), metal: m.metalness, rugosidad: m.roughness, emision: m.emissive?.getHex(), emisionInt: m.emissiveIntensity,
    opacidad: m.opacity, barniz: m.clearcoat, barnizRug: m.clearcoatRoughness, brillo: m.sheen, brilloColor: m.sheenColor?.getHex(), colores: !!m.vertexColors, doble: m.side === THREE.DoubleSide };
  if (m.map?.image) {
    try {
      const img = m.map.image, c = document.createElement('canvas');
      c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
      d.mapa = c.toDataURL('image/jpeg', 0.85); d.repetir = m.map.repeat.x;
    } catch { /* imagen no copiable */ }
  }
  return d;
}

function datosAMaterial(d) {
  const m = new THREE.MeshPhysicalMaterial({ color: d.color ?? 0xcccccc, metalness: d.metal ?? 0, roughness: d.rugosidad ?? 0.5, emissive: d.emision ?? 0, emissiveIntensity: d.emisionInt ?? 1,
    opacity: d.opacidad ?? 1, transparent: (d.opacidad ?? 1) < 1, clearcoat: d.barniz ?? 0, clearcoatRoughness: d.barnizRug ?? 0, sheen: d.brillo ?? 0, vertexColors: !!d.colores,
    side: d.doble ? THREE.DoubleSide : THREE.FrontSide });
  if (d.brilloColor !== undefined) m.sheenColor.setHex(d.brilloColor);
  if (d.mapa) {
    const img = new Image();
    const tex = new THREE.Texture(img);
    img.onload = () => { tex.needsUpdate = true; };
    img.src = d.mapa;
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(d.repetir || 1, d.repetir || 1);
    m.map = tex;
  }
  return m;
}

export function escenaADatos(escena) {
  return {
    formato: 'upgames-studio', version: VERSION_UPS, fecha: new Date().toISOString(),
    objetos: escena.objetos.map((o) => ({
      nombre: o.name, tipo: o.userData.tipo, visible: o.visible, bloqueado: !!o.userData.bloqueado,
      p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(), uuid: o.uuid,
      malla: mallaADatos(mallaDe(o)), material: materialADatos(o.material), modificadores: o.userData.modificadores || [],
    })),
  };
}

export function datosAObjetos(d) {
  if (d.formato !== 'upgames-studio') throw new Error('No es un proyecto de UpGames Studio');
  return d.objetos.map((x) => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), datosAMaterial(x.material));
    m.name = x.nombre; m.visible = x.visible; m.uuid = x.uuid || m.uuid;
    m.userData.tipo = x.tipo; m.userData.bloqueado = x.bloqueado; m.userData.modificadores = x.modificadores || [];
    m.position.fromArray(x.p); m.quaternion.fromArray(x.q); m.scale.fromArray(x.s);
    if (x.tipo === 'referencia') { // calco: sin luz, semitransparente
      m.material = new THREE.MeshBasicMaterial({ map: m.material.map, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
      m.userData.referencia = true; m.renderOrder = -1;
    }
    m.castShadow = m.receiveShadow = true;
    ponerMalla(m, datosAMalla(x.malla));
    return m;
  });
}

export async function guardarBytes(escena) { return comprimir(JSON.stringify(escenaADatos(escena))); }
export async function abrirBytes(bytes) { return datosAObjetos(JSON.parse(await descomprimir(bytes))); }

// ---------- guardado automático (IndexedDB) ----------

function bd() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('upgames-studio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('proyectos');
    r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
  });
}
async function bdPoner(clave, valor) { const db = await bd(); return new Promise((ok, mal) => { const t = db.transaction('proyectos', 'readwrite'); t.objectStore('proyectos').put(valor, clave); t.oncomplete = ok; t.onerror = () => mal(t.error); }); }
async function bdLeer(clave) { const db = await bd(); return new Promise((ok, mal) => { const r = db.transaction('proyectos').objectStore('proyectos').get(clave); r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); }); }

export function instalarGuardado({ escena, historial, aviso }) {
  let sucio = false, guardando = false;
  const alCambiarAntes = historial.alCambiar;
  historial.alCambiar = (h) => { sucio = true; alCambiarAntes(h); };
  async function guardar() {
    if (!sucio || guardando) return;
    guardando = true; sucio = false;
    try { await bdPoner('actual', { bytes: await guardarBytes(escena), fecha: Date.now() }); }
    catch (e) { sucio = true; console.error('guardado automático', e); }
    guardando = false;
  }
  setInterval(guardar, 10000);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') guardar(); });
  addEventListener('pagehide', guardar);
  return {
    guardar: () => { sucio = true; return guardar(); },
    async recuperar() {
      try {
        const r = await bdLeer('actual');
        if (!r?.bytes) return null;
        return { objetos: await abrirBytes(r.bytes), fecha: r.fecha };
      } catch (e) { console.error(e); return null; }
    },
    marcarLimpio() { sucio = false; },
  };
}

// ---------- mis proyectos (varios, con nombre y miniatura) ----------

async function bdTodos() {
  const db = await bd();
  return new Promise((ok, mal) => {
    const out = [], r = db.transaction('proyectos').objectStore('proyectos').openCursor();
    r.onsuccess = () => { const c = r.result; if (!c) return ok(out); if (String(c.key).startsWith('p:')) out.push(c.value); c.continue(); };
    r.onerror = () => mal(r.error);
  });
}
async function bdBorrar(clave) { const db = await bd(); return new Promise((ok, mal) => { const t = db.transaction('proyectos', 'readwrite'); t.objectStore('proyectos').delete(clave); t.oncomplete = ok; t.onerror = () => mal(t.error); }); }

export async function listarProyectos() {
  return (await bdTodos()).map(({ id, nombre, fecha, miniatura, objetos }) => ({ id, nombre, fecha, miniatura, objetos })).sort((a, b) => b.fecha - a.fecha);
}
export async function guardarProyecto(escena, { id = null, nombre, miniatura = null }) {
  id = id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await bdPoner(`p:${id}`, { id, nombre, fecha: Date.now(), miniatura, objetos: escena.objetos.length, bytes: await guardarBytes(escena) });
  return id;
}
export async function abrirProyecto(id) {
  const r = await bdLeer(`p:${id}`);
  if (!r) throw new Error('No se encontró el proyecto');
  return { objetos: await abrirBytes(r.bytes), nombre: r.nombre, id };
}
export const borrarProyecto = (id) => bdBorrar(`p:${id}`);

// ---------- importar ----------

// GLB/GLTF u OBJ → objetos de Studio (cada malla con su transformación de mundo).
export async function importar(archivo) {
  const nombre = archivo.name.toLowerCase(), buf = await archivo.arrayBuffer();
  if (nombre.endsWith('.ups')) return abrirBytes(buf);
  let raiz;
  if (nombre.endsWith('.glb') || nombre.endsWith('.gltf')) raiz = (await new GLTFLoader().parseAsync(buf, '')).scene;
  else if (nombre.endsWith('.obj')) raiz = new OBJLoader().parse(new TextDecoder().decode(buf));
  else throw new Error('Formato no admitido (usa .glb, .gltf, .obj o .ups)');
  raiz.updateMatrixWorld(true);
  const objetos = [];
  raiz.traverse((n) => {
    if (!n.isMesh || !n.geometry?.attributes?.position) return;
    const g = n.geometry;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', g.attributes.position.clone());
    if (g.attributes.uv) geo.setAttribute('uv', g.attributes.uv.clone());
    if (g.attributes.color && g.attributes.color.itemSize === 3) geo.setAttribute('color', g.attributes.color.clone());
    if (g.index) geo.setIndex(g.index.clone());
    if (g.attributes.normal) geo.setAttribute('normal', g.attributes.normal.clone()); else geo.computeVertexNormals(); // sin normales se ve negro
    const mat = Array.isArray(n.material) ? n.material[0] : n.material;
    const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
      color: mat?.color ? mat.color.getHex() : 0xcccccc, metalness: mat?.metalness ?? 0, roughness: mat?.roughness ?? 0.6,
      map: mat?.map || null, emissive: mat?.emissive ? mat.emissive.getHex() : 0, opacity: mat?.opacity ?? 1, transparent: !!mat?.transparent, vertexColors: !!geo.attributes.color,
    }));
    n.matrixWorld.decompose(m.position, m.quaternion, m.scale);
    m.name = n.name || 'Importado';
    m.userData.tipo = 'importado';
    m.castShadow = m.receiveShadow = true;
    objetos.push(m);
  });
  if (!objetos.length) throw new Error('El archivo no tiene mallas');
  return objetos;
}

// ---------- exportar ----------

function descargar(datos, nombre, tipo) {
  const url = URL.createObjectURL(new Blob([datos], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Oculta un momento lo que no es parte del modelo (capas del modo Editar, imágenes de referencia).
function visiblesSinCapas(raiz) {
  const capas = [];
  raiz.traverse((o) => { if ((o.userData.capa || o.userData.referencia) && o.visible) { capas.push(o); o.visible = false; } });
  return () => { for (const o of capas) o.visible = true; };
}

export async function exportar(formato, escena, nombre = 'upgames-studio') {
  const volver = visiblesSinCapas(escena.raiz);
  try {
    if (formato === 'glb') return await exportarGLB(escena.raiz, nombre);
    const grupo = new THREE.Group();
    for (const o of escena.objetos) if (o.visible) { const c = o.clone(false); c.userData = {}; grupo.add(c); }
    if (!grupo.children.length) throw new Error('vacío');
    grupo.updateMatrixWorld(true);
    if (formato === 'obj') descargar(new OBJExporter().parse(grupo), `${nombre}.obj`, 'text/plain');
    else if (formato === 'stl') descargar(new STLExporter().parse(grupo, { binary: true }), `${nombre}.stl`, 'model/stl');
    else if (formato === 'ups') descargar(await guardarBytes(escena), `${nombre}.ups`, 'application/octet-stream');
  } finally { volver(); }
}
