// UpGames Studio: arranque, bucle de render e interfaz del modo objeto (etapa 1, sprint 1).
import * as THREE from 'three';
import { CamaraOrbital } from './camara.js';
import { instalarGestos } from './ui/gestos.js';
import { abrirRadial } from './ui/radial.js';
import { Historial } from './deshacer.js';
import { Escena } from './escena.js';
import { PRIMITIVAS, crearPrimitiva } from './primitivas.js';
import { crearGizmo } from './herramientas/gizmo.js';
import { instalarDialogoFoto } from './foto/dialogoFoto.js';
import { exportarGLB } from './archivo/glb.js';
import { ModoEdicion } from './edicion.js';
import { construirMonoplaza } from './plantillas/monoplaza.js';
import { construirPiloto } from './plantillas/piloto.js';

const $ = (id) => document.getElementById(id);
const lienzo = $('lienzo');

// ---------- Render ----------
const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1f2b);
const camara = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
const camOrb = new CamaraOrbital(camara);

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 1.4));
const sol = new THREE.DirectionalLight(0xffffff, 2.2);
sol.position.set(5, 9, 6);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
Object.assign(sol.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 0.5, far: 40 });
sol.shadow.bias = -0.0005;
scene.add(sol);

const suelo = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.28 }));
suelo.receiveShadow = true;
scene.add(suelo);
const rejilla = new THREE.GridHelper(20, 40, 0x56607a, 0x323a4c);
rejilla.material.transparent = true; rejilla.material.opacity = 0.75;
scene.add(rejilla);
const ejes = new THREE.LineSegments(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-10, 0.001, 0), new THREE.Vector3(10, 0.001, 0), new THREE.Vector3(0, 0.001, -10), new THREE.Vector3(0, 0.001, 10)]),
  new THREE.LineBasicMaterial({ vertexColors: true }),
);
ejes.geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, .25, .3, 1, .25, .3, .2, .5, 1, .2, .5, 1], 3));
scene.add(ejes);

// ---------- Escena, deshacer y gizmo ----------
const historial = new Historial({ alCambiar: (h) => { $('bDeshacer').disabled = !h.puedeDeshacer; $('bRehacer').disabled = !h.puedeRehacer; } });
const escena = new Escena(scene, historial);
const gizmo = crearGizmo(camara, lienzo, scene, escena);
const caja = new THREE.BoxHelper(undefined, 0x00d2ff);
caja.material.depthTest = false; caja.material.transparent = true; caja.material.opacity = 0.6;
caja.renderOrder = 2; caja.visible = false;
scene.add(caja);
escena.alCambiar(() => { caja.visible = !!escena.seleccion && !edicion.activo; if (caja.visible) caja.setFromObject(escena.seleccion); });

function anadirPrimitiva(id) {
  const m = crearPrimitiva(id);
  // delante de la cámara, sobre el suelo
  m.position.set(Math.round(camOrb.centro.x * 4) / 4, 0, Math.round(camOrb.centro.z * 4) / 4);
  escena.anadir(m, `Añadir ${m.name}`);
  aviso(`${m.name} añadido`);
}
const enfocar = () => {
  const s = (edicion.activo && edicion.enfoque()) || escena.esferaDe(escena.seleccion);
  camOrb.enfocar(s.center, s.radius);
};

// ---------- Modo edición ----------
const edicion = new ModoEdicion({ scene, camara, lienzo, historial, gizmo, alCambiar: () => pintarEdicion() });
function ponerModo(modo) {
  if (modo === 'editar') {
    const o = escena.seleccion;
    if (!o) { aviso('Toca primero el objeto que quieres editar'); return; }
    if (o.userData.bloqueado) { aviso('El objeto está bloqueado'); return; }
    abrirHoja(null);
    edicion.entrar(o);
    caja.visible = false;
  } else if (edicion.activo) {
    edicion.salir();
    escena.avisar();
  }
  document.body.classList.toggle('editando', edicion.activo);
  $('barraEdicion').hidden = !edicion.activo;
  document.querySelectorAll('[data-modo]').forEach((q) => q.classList.toggle('activo', q.dataset.modo === (edicion.activo ? 'editar' : 'objeto')));
}
function pintarEdicion() {
  if (!edicion.activo) return;
  document.querySelectorAll('[data-tipo]').forEach((q) => q.classList.toggle('activo', q.dataset.tipo === edicion.tipo));
  $('bSumar').classList.toggle('activo', edicion.anadir);
  $('bRayos').classList.toggle('activo', edicion.rayosX);
  $('bBucle').hidden = edicion.tipo !== 'e';
  const m = edicion.malla, nombres = { v: 'vértices', e: 'aristas', f: 'caras' };
  $('infoMalla').textContent = `${edicion.obj.name} · ${m.nV} vértices · ${m.nE} aristas · ${m.nF} caras · ${edicion.sel.size} ${nombres[edicion.tipo]} seleccionad${edicion.tipo === 'v' ? 'os' : 'as'}`;
}
document.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => edicion.ponerTipo(b.dataset.tipo)));
$('bSumar').onclick = () => { edicion.anadir = !edicion.anadir; pintarEdicion(); };
$('bTodo').onclick = () => edicion.seleccionarTodo();
$('bBucle').onclick = () => { if (!edicion.seleccionarBucle()) aviso('Toca primero una arista'); };
$('bRayos').onclick = () => { edicion.rayosX = !edicion.rayosX; edicion.aplicarRayosX(); pintarEdicion(); };
// si el objeto que se edita desaparece (borrado o deshecho), volver al modo objeto
escena.alCambiar(() => { if (edicion.activo && edicion.obj.parent !== escena.raiz) ponerModo('objeto'); });

// ---------- Selección con el dedo ----------
const ray = new THREE.Raycaster();
function objetoEn(x, y) {
  const r = lienzo.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camara);
  const candidatos = escena.objetos.filter((o) => o.visible && !o.userData.bloqueado);
  const hit = ray.intersectObjects(candidatos, false)[0];
  return hit ? hit.object : null;
}

instalarGestos(lienzo, camOrb, {
  ocupado: () => gizmo.arrastrando,
  alTocar: (x, y, sumar) => { if (edicion.activo) edicion.tocar(x, y, sumar); else escena.seleccionar(objetoEn(x, y)); },
  alDobleToque: (x, y) => { if (!edicion.activo) { const o = objetoEn(x, y); if (o) escena.seleccionar(o); } enfocar(); },
  alPulsacionLarga: (x, y, id) => {
    if (edicion.activo) return radialEdicion(x, y, id);
    const o = objetoEn(x, y);
    if (o) escena.seleccionar(o);
    const hay = !!escena.seleccion;
    abrirRadial(x, y, [
      { nombre: 'Cubo', icono: PRIMITIVAS[0].icono, hacer: () => anadirPrimitiva('cubo') },
      { nombre: 'Añadir', icono: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>', hacer: () => abrirHoja('hojaAnadir') },
      { nombre: 'Foto', icono: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/></svg>', hacer: () => dialogoFoto.abrir() },
      { nombre: 'Enfocar', icono: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/></svg>', hacer: enfocar },
      { nombre: 'Duplicar', desactivado: !hay, icono: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V4h12"/></svg>', hacer: () => escena.duplicar() },
      { nombre: 'Borrar', desactivado: !hay, icono: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>', hacer: () => escena.borrar() },
      { nombre: 'Editar', desactivado: !hay, icono: ICONO_EDITAR, hacer: () => ponerModo('editar') },
      { nombre: 'Deshacer', desactivado: !historial.puedeDeshacer, icono: ICONO_DESHACER, hacer: () => historial.deshacer() },
    ], id);
  },
});
const ICONO_DESHACER = '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>';
const ICONO_EDITAR = '<svg viewBox="0 0 24 24"><path d="M5 19L12 5l7 14z"/><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="5" cy="19" r="2" fill="currentColor"/><circle cx="19" cy="19" r="2" fill="currentColor"/></svg>';
function radialEdicion(x, y, id) {
  const t = (tipo, nombre) => ({ nombre, hacer: () => edicion.ponerTipo(tipo) });
  abrirRadial(x, y, [
    t('v', 'Vértice'), t('e', 'Arista'), t('f', 'Cara'),
    { nombre: 'Todo', hacer: () => edicion.seleccionarTodo() },
    { nombre: 'Bucle', desactivado: edicion.tipo !== 'e' || !edicion.sel.size, hacer: () => edicion.seleccionarBucle() },
    { nombre: 'Enfocar', hacer: enfocar },
    { nombre: 'Deshacer', desactivado: !historial.puedeDeshacer, icono: ICONO_DESHACER, hacer: () => historial.deshacer() },
    { nombre: 'Objeto', hacer: () => ponerModo('objeto') },
  ], id);
}

// ---------- Interfaz ----------
const dialogoFoto = instalarDialogoFoto({
  aviso,
  alCrear: (m) => {
    // una malla o varias piezas (carrocería y ruedas), todas con el mismo origen
    for (const pieza of Array.isArray(m) ? m : [m]) {
      pieza.position.set(camOrb.centro.x, 0, camOrb.centro.z);
      escena.anadir(pieza, 'Modelo desde foto');
    }
    escena.seleccionar(Array.isArray(m) ? m[0] : m);
    enfocar();
    aviso('Modelo creado. Puedes moverlo, girarlo, escalarlo y exportarlo a GLB.');
  },
});

$('bDeshacer').onclick = () => historial.deshacer();
$('bRehacer').onclick = () => historial.rehacer();
document.querySelectorAll('[data-vista]').forEach((b) => b.addEventListener('click', () => camOrb.vista(b.dataset.vista)));

let iman = false;
$('bIman').onclick = () => {
  iman = !iman; gizmo.iman(iman); $('bIman').classList.toggle('activo', iman);
  aviso(iman ? 'Ajuste magnético: 0,25 · 15° · 0,1' : 'Ajuste magnético desactivado');
};

let local = false;
$('bEspacio').onclick = () => { local = !local; gizmo.espacio(local); $('tEspacio').textContent = local ? 'Local' : 'Mundo'; };
const ponerModoGizmo = (m) => {
  gizmo.modo(m);
  document.querySelectorAll('[data-gizmo]').forEach((q) => q.classList.toggle('activo', q.dataset.gizmo === m));
};
document.querySelectorAll('[data-gizmo]').forEach((b) => b.addEventListener('click', () => ponerModoGizmo(b.dataset.gizmo)));

document.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.modo === 'objeto' || b.dataset.modo === 'editar') ponerModo(b.dataset.modo);
  else if (b.dataset.sprint) aviso(`«${b.textContent}» llega en el sprint ${b.dataset.sprint} de la etapa 1`);
  else if (b.dataset.etapa) aviso(`«${b.textContent}» llega en la etapa ${b.dataset.etapa}`);
}));

$('bExportar').onclick = async () => {
  const capas = [];
  escena.raiz.traverse((o) => { if (o.userData.capa && o.visible) { capas.push(o); o.visible = false; } });
  try { await exportarGLB(escena.raiz, 'upgames-studio'); aviso('GLB exportado'); }
  catch (e) { aviso(e.message === 'vacío' ? 'No hay nada visible para exportar' : 'No se pudo exportar'); console.error(e); }
  finally { for (const o of capas) o.visible = true; }
};

// Hojas emergentes
function abrirHoja(id) { document.querySelectorAll('.hoja').forEach((h) => { h.hidden = h.id !== id; }); }
document.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', () => { b.closest('.hoja').hidden = true; }));
$('bAnadir').onclick = () => abrirHoja($('hojaAnadir').hidden ? 'hojaAnadir' : null);
$('bFoto').onclick = () => { abrirHoja(null); dialogoFoto.abrir(); };
$('rejillaPrimitivas').innerHTML = PRIMITIVAS.map((p) => `<button data-prim="${p.id}">${p.icono}${p.nombre}</button>`).join('');
function crearPlantilla(construir, nombre, texto) {
  if (edicion.activo) ponerModo('objeto');
  const piezas = escena.anadirVarios(construir(), `Plantilla ${nombre}`);
  $('hojaAnadir').hidden = true;
  escena.seleccionar(null);
  const s = escena.esferaDe(null);
  camOrb.enfocar(s.center, s.radius);
  aviso(`${texto}: ${piezas.length} piezas con nombre. Exporta a GLB para APEX GP.`);
}
$('bPlantillaF1').onclick = () => crearPlantilla(construirMonoplaza, 'monoplaza', 'Monoplaza F1 creado');
$('bPlantillaPiloto').onclick = () => crearPlantilla(construirPiloto, 'piloto', 'Piloto creado');
$('rejillaPrimitivas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-prim]');
  if (!b) return;
  anadirPrimitiva(b.dataset.prim);
  $('hojaAnadir').hidden = true;
});

// Panel de escena
const panel = $('panel');
$('bPanel').onclick = () => panel.classList.toggle('abierto');
$('bCerrarPanel').onclick = () => panel.classList.remove('abierto');
const OJO = '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const CANDADO = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pintarPanel() {
  const lista = $('lista');
  const objs = escena.objetos;
  lista.innerHTML = objs.length ? objs.map((o, i) => `
    <li data-i="${i}" class="${o === escena.seleccion ? 'sel' : ''} ${o.visible ? '' : 'oculto'}">
      <span class="n">${esc(o.name)}</span>
      <button data-acc="ver" class="${o.visible ? 'on' : ''}" title="Mostrar u ocultar">${OJO}</button>
      <button data-acc="bloq" class="${o.userData.bloqueado ? 'on' : ''}" title="Bloquear">${CANDADO}</button>
    </li>`).join('') : '<li class="vacio">Vacía. Toca «Añadir» o «Desde foto».</li>';
  const s = escena.seleccion;
  $('props').hidden = !s;
  if (s) {
    if (document.activeElement !== $('pNombre')) $('pNombre').value = s.name;
    $('pColor').value = `#${s.material.color.getHexString()}`;
  }
}
$('lista').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]');
  if (!li) return;
  const o = escena.objetos[+li.dataset.i];
  const acc = e.target.closest('[data-acc]')?.dataset.acc;
  if (acc === 'ver') escena.alternarVisible(o);
  else if (acc === 'bloq') escena.alternarBloqueo(o);
  else if (o.visible) { if (edicion.activo && edicion.obj !== o) ponerModo('objeto'); escena.seleccionar(o); }
});
$('pNombre').addEventListener('change', () => escena.seleccion && escena.renombrar(escena.seleccion, $('pNombre').value));
$('pNombre').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
$('pColor').addEventListener('change', () => escena.seleccion && escena.colorear(escena.seleccion, parseInt($('pColor').value.slice(1), 16)));
$('pDuplicar').onclick = () => escena.duplicar();
$('pBorrar').onclick = () => escena.borrar();
escena.alCambiar(pintarPanel);

// Atajos de teclado en el PC
addEventListener('keydown', (e) => {
  if (e.target.matches?.('input')) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (k === 'tab') { e.preventDefault(); ponerModo(edicion.activo ? 'objeto' : 'editar'); return; }
  if (edicion.activo && !ctrl) {
    const tipos = { 1: 'v', 2: 'e', 3: 'f' };
    if (tipos[k]) { edicion.ponerTipo(tipos[k]); return; }
    if (k === 'a') { edicion.seleccionarTodo(); return; }
    if (k === 'l') { edicion.seleccionarBucle(); return; }
    if (k === 'z' && e.altKey) { $('bRayos').click(); return; }
    if (k === 'delete' || k === 'backspace' || k === 'x' || (e.shiftKey && k === 'd')) return; // llegan en el sprint 3
  }
  if (ctrl && k === 'z') { e.preventDefault(); if (e.shiftKey) historial.rehacer(); else historial.deshacer(); }
  else if (ctrl && k === 'y') { e.preventDefault(); historial.rehacer(); }
  else if (ctrl && k === 'd' || (e.shiftKey && k === 'd')) { e.preventDefault(); escena.duplicar(); }
  else if (k === 'delete' || k === 'backspace' || k === 'x') escena.borrar();
  else if (k === 'g' || k === 'w') ponerModoGizmo('translate');
  else if (k === 'r' || k === 'e') ponerModoGizmo('rotate');
  else if (k === 's') ponerModoGizmo('scale');
  else if (k === 'f' || k === '.') enfocar();
  else if (k === '1') camOrb.vista('frente');
  else if (k === '3') camOrb.vista('lado');
  else if (k === '7') camOrb.vista('arriba');
  else if (k === '5') camOrb.vista('persp');
  else if (k === 'escape') { if (edicion.activo) ponerModo('objeto'); else escena.seleccionar(null); abrirHoja(null); }
});

// ---------- Avisos ----------
let tAviso = 0;
function aviso(texto) {
  const el = $('aviso');
  el.textContent = texto;
  el.classList.add('ver');
  clearTimeout(tAviso);
  tAviso = setTimeout(() => el.classList.remove('ver'), 2200);
}

// ---------- Bucle ----------
function ajustar() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camara.aspect = w / h;
  camara.updateProjectionMatrix();
}
addEventListener('resize', ajustar);
ajustar();

let antes = performance.now();
renderer.setAnimationLoop(() => {
  const ahora = performance.now();
  camOrb.actualizar(Math.min(0.1, (ahora - antes) / 1000));
  antes = ahora;
  if (caja.visible) caja.update();
  renderer.render(scene, camara);
});

// Escena inicial: un cubo, como siempre
const cubo = crearPrimitiva('cubo');
cubo.material.color.setHex(0xc9d1dc);
escena.raiz.add(cubo);
escena.avisar();
pintarPanel();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// Para las pruebas en el navegador
window.studio = { escena, historial, camOrb, gizmo, anadirPrimitiva, edicion, ponerModo };
