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
import { instalarGuardado, importar, exportar, listarProyectos, guardarProyecto, abrirProyecto, borrarProyecto } from './archivo/proyecto.js';
import { ModoEdicion, mallaDe, contextoModificadores } from './edicion.js';
import { evaluar } from './malla/modificadores.js';
import { poligonosDeMalla } from './malla/csg.js';
import { instalarModificadores } from './ui/modificadores.js';
import { instalarMateriales } from './ui/materiales.js';
import { Pincel } from './herramientas/pincel.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
// entorno de estudio para que los metales, el cromo y el barniz tengan qué reflejar
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
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
escena.alCambiar(() => { caja.visible = !!escena.seleccion && !edicion.activo && !(typeof pincel !== 'undefined' && pincel.activo); if (caja.visible) caja.setFromObject(escena.seleccion); });

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
// booleanas: polígonos de otro objeto (con sus modificadores, salvo booleanas) en las coordenadas del destino
const ctxMods = {
  poligonosDe(id, destino) {
    const o = escena.objetos.find((q) => q.uuid === id);
    if (!o || o === destino) return null;
    const m = evaluar(mallaDe(o), (o.userData.modificadores || []).filter((x) => x.tipo !== 'booleana'));
    o.updateMatrixWorld(); destino.updateMatrixWorld();
    const M = destino.matrixWorld.clone().invert().multiply(o.matrixWorld), v = new THREE.Vector3();
    return poligonosDeMalla(m, (p) => v.set(p[0], p[1], p[2]).applyMatrix4(M).toArray());
  },
};
contextoModificadores(ctxMods);
let modoActual = 'objeto';
function ponerModo(modo) {
  const o = escena.seleccion;
  if (modo !== 'objeto' && modo !== modoActual) {
    if (!o) { aviso('Toca primero el objeto'); return; }
    if (o.userData.bloqueado) { aviso('El objeto está bloqueado'); return; }
  }
  // salir del modo anterior
  if (edicion.activo && modo !== 'editar') { edicion.salir(); escena.avisar(); }
  if (pincel.activo && (modo !== modoActual || modo === 'objeto')) { pincel.salir(); gizmo.tc.enabled = true; escena.avisar(); }
  if (modo === 'editar') {
    abrirHoja(null);
    edicion.entrar(o);
  } else if (modo === 'esculpir' || modo === 'pintar') {
    abrirHoja(null);
    pincel.entrar(o, modo);
    gizmo.tc.detach(); gizmo.tc.enabled = false;
    pintarPincel();
  }
  modoActual = edicion.activo ? 'editar' : pincel.activo ? pincel.modo : 'objeto';
  caja.visible = modoActual === 'objeto' && !!escena.seleccion;
  if (modoActual === 'objeto') gizmo.sincronizar();
  document.body.classList.toggle('editando', edicion.activo);
  document.body.classList.toggle('pincelando', pincel.activo);
  $('barraEdicion').hidden = !edicion.activo;
  $('barraPincel').hidden = !pincel.activo;
  document.querySelectorAll('[data-modo]').forEach((q) => q.classList.toggle('activo', q.dataset.modo === modoActual));
  actualizarEstado();
}

// ---------- Esculpir y pintar ----------
const pincel = new Pincel({ camara, lienzo, historial, escena });
function pintarPincel() {
  const esc = pincel.modo === 'esculpir';
  document.querySelectorAll('[data-pincel]').forEach((b) => { b.hidden = !esc; b.classList.toggle('activo', b.dataset.pincel === pincel.tipo); });
  $('filaColorPincel').hidden = esc; $('bLimpiarMascara').hidden = !esc; $('bRestar').hidden = !esc;
  $('bRestar').classList.toggle('activo', pincel.restar);
  $('bSimetriaPincel').classList.toggle('activo', pincel.simetria);
  $('pRadio').value = pincel.radio; $('pFuerza').value = pincel.fuerza;
  $('infoPincel').textContent = pincel.malla ? `${pincel.malla.nV} vértices${pincel.malla.nV < 2000 && esc ? ' · pulsa «Más detalle» para esculpir con precisión' : ''}` : '';
}
document.querySelectorAll('[data-pincel]').forEach((b) => b.addEventListener('click', () => { pincel.tipo = b.dataset.pincel; pintarPincel(); }));
$('bRestar').onclick = () => { pincel.restar = !pincel.restar; pintarPincel(); };
$('bSimetriaPincel').onclick = () => { pincel.simetria = !pincel.simetria; pintarPincel(); };
$('pRadio').oninput = () => { pincel.radio = +$('pRadio').value; };
$('pFuerza').oninput = () => { pincel.fuerza = +$('pFuerza').value; };
$('pColorPincel').oninput = () => { pincel.color.set($('pColorPincel').value); };
$('bMasDetalle').onclick = () => { if (!pincel.masDetalle()) aviso('La malla ya tiene mucho detalle'); pintarPincel(); };
$('bLimpiarMascara').onclick = () => pincel.limpiarMascara();
function pintarEdicion() {
  if (!edicion.activo) return;
  document.querySelectorAll('[data-tipo]').forEach((q) => q.classList.toggle('activo', q.dataset.tipo === edicion.tipo));
  $('bSumar').classList.toggle('activo', edicion.anadir);
  $('bRayos').classList.toggle('activo', edicion.rayosX);
  $('bBucle').hidden = edicion.tipo !== 'e';
  document.querySelectorAll('[data-op][data-tipos]').forEach((b) => { b.disabled = !b.dataset.tipos.includes(edicion.tipo); });
  const m = edicion.malla, nombres = { v: 'vértices', e: 'aristas', f: 'caras' };
  $('infoMalla').textContent = `${edicion.obj.name} · ${m.nV} vértices · ${m.nE} aristas · ${m.nF} caras · ${edicion.sel.size} ${nombres[edicion.tipo]} seleccionad${edicion.tipo === 'v' ? 'os' : 'as'}`;
}
document.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => edicion.ponerTipo(b.dataset.tipo)));
const PISTAS = { extruir: 'Toca primero una o más caras', inset: 'Toca primero una o más caras', cortarBucle: 'Toca primero una arista', fusionar: 'Toca dos o más vértices', borrar: 'No hay nada seleccionado', subdividir: 'La malla ya es demasiado densa' };
function operacion(op) {
  if (!edicion.activo) return;
  if (!edicion[op]()) aviso(PISTAS[op] || 'No se pudo aplicar');
}
document.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => operacion(b.dataset.op)));
$('bSumar').onclick = () => { edicion.anadir = !edicion.anadir; pintarEdicion(); };
$('bTodo').onclick = () => edicion.seleccionarTodo();
$('bBucle').onclick = () => { if (!edicion.seleccionarBucle()) aviso('Toca primero una arista'); };
$('bRayos').onclick = () => { edicion.rayosX = !edicion.rayosX; edicion.aplicarRayosX(); pintarEdicion(); };
// si el objeto que se edita desaparece (borrado o deshecho), volver al modo objeto
escena.alCambiar(() => { if ((edicion.activo && edicion.obj.parent !== escena.raiz) || (pincel.activo && pincel.obj.parent !== escena.raiz)) ponerModo('objeto'); });

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
  pincel: { empezar: (x, y) => pincel.activo && pincel.empezar(x, y), mover: (x, y) => pincel.mover(x, y), terminar: () => pincel.terminar() },
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
      { nombre: 'Borrar', desactivado: !hay, icono: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>', hacer: () => borrarSeleccion() },
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
  if (['objeto', 'editar', 'esculpir', 'pintar'].includes(b.dataset.modo)) ponerModo(b.dataset.modo);
  else if (b.dataset.modo === 'material') { abrirHoja(null); materiales.abrir(); }
  else if (b.dataset.sprint) aviso(`«${b.textContent}» llega en el sprint ${b.dataset.sprint} de la etapa 1`);
  else if (b.dataset.etapa) aviso(`«${b.textContent}» llega en la etapa ${b.dataset.etapa}`);
}));

// ---------- Archivo: guardar, abrir, importar, exportar ----------
const guardado = instalarGuardado({ escena, historial, aviso });
let proyecto = { id: null, nombre: 'Sin nombre' };
try { proyecto = JSON.parse(localStorage.getItem('studio-proyecto')) || proyecto; } catch { /* sin almacenamiento */ }
const recordarProyecto = () => { try { localStorage.setItem('studio-proyecto', JSON.stringify(proyecto)); } catch { /* */ } $('nombreProyecto').textContent = proyecto.nombre; };
recordarProyecto();
// miniatura de la vista actual (para la lista de proyectos)
function miniatura() {
  renderer.render(scene, camara);
  const c = document.createElement('canvas'); c.width = 320; c.height = 200;
  const g = c.getContext('2d'), w = lienzo.width, h = lienzo.height, k = Math.max(320 / w, 200 / h);
  g.drawImage(lienzo, (320 - w * k) / 2, (200 - h * k) / 2, w * k, h * k);
  return c.toDataURL('image/jpeg', 0.7);
}
async function pintarProyectos() {
  const lista = await listarProyectos().catch(() => []);
  $('listaProyectos').innerHTML = lista.length ? lista.map((p) => `
    <div class="tarjeta-proyecto" data-id="${p.id}">
      ${p.miniatura ? `<img src="${p.miniatura}" alt="">` : '<div class="sin-imagen"></div>'}
      <div class="pie"><b>${esc(p.nombre)}</b><small>${new Date(p.fecha).toLocaleString('es')} · ${p.objetos} objeto${p.objetos === 1 ? '' : 's'}</small></div>
      <div class="botones"><button data-proy="abrir">Abrir</button><button data-proy="borrar" class="peligro" title="Borrar">✕</button></div>
    </div>`).join('') : '<p class="vacio">Aún no has guardado ningún proyecto. Pulsa «Guardar como…».</p>';
}
$('listaProyectos').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-proy]'); if (!b) return;
  const id = b.closest('[data-id]').dataset.id;
  if (b.dataset.proy === 'borrar') {
    if (!confirm('¿Borrar este proyecto del dispositivo? No se puede deshacer.')) return;
    await borrarProyecto(id); if (proyecto.id === id) { proyecto = { id: null, nombre: 'Sin nombre' }; recordarProyecto(); }
    pintarProyectos(); return;
  }
  if (edicion.activo || pincel.activo) ponerModo('objeto');
  try {
    const r = await abrirProyecto(id);
    escena.reemplazarTodo(r.objetos, `Abrir ${r.nombre}`);
    proyecto = { id: r.id, nombre: r.nombre }; recordarProyecto();
    abrirHoja(null); enfocar(); aviso(`«${r.nombre}» abierto`, conDeshacer);
  } catch (err) { console.error(err); aviso(err.message); }
});
async function guardarComo(pedirNombre) {
  if (edicion.activo || pincel.activo) ponerModo('objeto');
  let nombre = proyecto.nombre;
  if (pedirNombre || !proyecto.id) {
    nombre = prompt('Nombre del proyecto', proyecto.id ? `${proyecto.nombre} (copia)` : 'Mi modelo');
    if (!nombre) return;
  }
  try {
    const id = await guardarProyecto(escena, { id: pedirNombre ? null : proyecto.id, nombre: nombre.trim().slice(0, 60), miniatura: miniatura() });
    proyecto = { id, nombre: nombre.trim().slice(0, 60) }; recordarProyecto();
    pintarProyectos(); aviso(`Guardado: «${proyecto.nombre}»`);
  } catch (err) { console.error(err); aviso('No se pudo guardar'); }
}
$('bArchivo').onclick = () => { abrirHoja($('hojaArchivo').hidden ? 'hojaArchivo' : null); if (!$('hojaArchivo').hidden) pintarProyectos(); };
document.querySelectorAll('[data-arch]').forEach((b) => b.addEventListener('click', async () => {
  const acc = b.dataset.arch;
  if (acc === 'guardar' || acc === 'guardarComo') return guardarComo(acc === 'guardarComo');
  if (acc === 'nuevo') {
    proyecto = { id: null, nombre: 'Sin nombre' }; recordarProyecto();
    if (edicion.activo) ponerModo('objeto');
    const c = crearPrimitiva('cubo'); c.material.color.setHex(0xc9d1dc); c.name = 'Cubo';
    escena.reemplazarTodo([c], 'Nuevo proyecto');
    abrirHoja(null); aviso('Proyecto nuevo', conDeshacer);
    return;
  }
  if (edicion.activo) ponerModo('objeto');
  try { await exportar(acc, escena); aviso(`${acc.toUpperCase()} listo`); }
  catch (e) { console.error(e); aviso(e.message === 'vacío' ? 'No hay nada visible para exportar' : 'No se pudo exportar'); }
}));
for (const [id, reemplazar] of [['fAbrir', true], ['fImportar', false]]) {
  $(id).addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (edicion.activo) ponerModo('objeto');
    try {
      const objs = await importar(f);
      if (reemplazar) escena.reemplazarTodo(objs, `Abrir ${f.name}`);
      else escena.anadirVarios(objs, `Importar ${f.name}`);
      abrirHoja(null); enfocar();
      aviso(`${f.name}: ${objs.length} objeto${objs.length === 1 ? '' : 's'}`);
    } catch (err) { console.error(err); aviso(err.message || 'No se pudo abrir'); }
  });
}

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
// imagen de referencia (calco): un plano con la imagen, semitransparente, mirando a la vista actual
$('fReferencia').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(f));
    const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const alto = 3, ancho = alto * c.width / c.height;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ancho, alto), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    m.name = 'Referencia'; m.userData.tipo = 'referencia'; m.userData.referencia = true; m.renderOrder = -1;
    // de cara a la vista más cercana (frente, lado o arriba), detrás del centro de la escena
    const v = new THREE.Vector3().subVectors(camara.position, camOrb.centro).normalize();
    const eje = ['x', 'y', 'z'].reduce((a, b) => (Math.abs(v[b]) > Math.abs(v[a]) ? b : a));
    if (eje === 'x') { m.rotation.y = Math.sign(v.x) * Math.PI / 2; m.position.set(-Math.sign(v.x) * 1.5, alto / 2, 0); }
    else if (eje === 'y') { m.rotation.x = -Math.PI / 2; m.position.set(0, 0.002, 0); }
    else { m.rotation.y = v.z < 0 ? Math.PI : 0; m.position.set(0, alto / 2, -Math.sign(v.z) * 1.5); }
    escena.anadir(m, 'Imagen de referencia');
    $('hojaAnadir').hidden = true;
    aviso('Referencia añadida: muévela, escálala o bloquéala desde Propiedades');
  } catch (err) { console.error(err); aviso('No se pudo abrir la imagen'); }
});
$('rejillaPrimitivas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-prim]');
  if (!b) return;
  anadirPrimitiva(b.dataset.prim);
  $('hojaAnadir').hidden = true;
});

// Panel de escena
const panel = $('panel');
$('bPanel').onclick = () => panel.classList.toggle('abierto');
$('bAyuda').onclick = () => abrirHoja($('hojaAyuda').hidden ? 'hojaAyuda' : null);
try { if (!localStorage.getItem('studio-ayuda-vista')) { localStorage.setItem('studio-ayuda-vista', '1'); setTimeout(() => abrirHoja('hojaAyuda'), 600); } } catch { /* sin almacenamiento */ }
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
  $('props').hidden = !s; $('propsVacio').hidden = !!s; $('modsVacio').hidden = !!s;
  $('selMod').hidden = !s;
  if (s) {
    if (document.activeElement !== $('pNombre')) $('pNombre').value = s.name;
    $('pColor').value = `#${s.material.color.getHexString()}`;
    // transformación numérica (giro en grados)
    const val = { p: s.position.toArray(), r: [s.rotation.x, s.rotation.y, s.rotation.z].map((a) => a * 180 / Math.PI), s: s.scale.toArray() };
    document.querySelectorAll('[data-tr]').forEach((inp) => {
      if (document.activeElement === inp) return;
      const v = val[inp.dataset.tr[0]][+inp.dataset.tr[1]];
      inp.value = Math.abs(v) < 1e-9 ? 0 : +v.toFixed(inp.dataset.tr[0] === 'r' ? 1 : 3);
    });
    const g = s.geometry, tri = g.index ? g.index.count / 3 : g.attributes.position.count / 3, mods = (s.userData.modificadores || []).length;
    $('pInfo').textContent = `${Math.round(tri).toLocaleString('es')} triángulos${mods ? ` · ${mods} modificador${mods > 1 ? 'es' : ''}` : ''}${s.userData.bloqueado ? ' · bloqueado' : ''}`;
  }
  actualizarEstado();
}

// pestañas del panel de propiedades
document.querySelectorAll('[data-pest]').forEach((b) => b.tagName === 'BUTTON' && b.addEventListener('click', () => abrirPestana(b.dataset.pest)));
function abrirPestana(id) {
  document.querySelectorAll('.pestanas [data-pest]').forEach((q) => q.classList.toggle('activo', q.dataset.pest === id));
  document.querySelectorAll('.pest').forEach((q) => { q.hidden = q.dataset.pest !== id; });
}
// transformación numérica: un paso de deshacer por campo cambiado
document.querySelectorAll('[data-tr]').forEach((inp) => inp.addEventListener('change', () => {
  const o = escena.seleccion; if (!o || !Number.isFinite(+inp.value)) return;
  const antes = { p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray() };
  const k = +inp.dataset.tr[1], v = +inp.value;
  if (inp.dataset.tr[0] === 'p') o.position.setComponent(k, v);
  else if (inp.dataset.tr[0] === 's') o.scale.setComponent(k, v || 0.001);
  else { const e = o.rotation.clone(); e[['x', 'y', 'z'][k]] = v * Math.PI / 180; o.rotation.copy(e); }
  o.updateMatrixWorld();
  escena.transformado(o, antes);
  escena.avisar();
}));
document.querySelectorAll('[data-tr]').forEach((inp) => inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); }));

// barra de estado: modo, selección y qué se puede hacer
function actualizarEstado() {
  const el = $('estado'); if (!el) return;
  const s = escena.seleccion, modo = typeof modoActual === 'undefined' ? 'objeto' : modoActual;
  const PISTAS = {
    objeto: s ? 'Arrastra las flechas para mover · doble toque enfoca · mantén pulsado para el menú' : 'Toca un objeto para seleccionarlo · 1 dedo gira la vista · 2 dedos acercan',
    editar: 'Toca vértices, aristas o caras · «+ Selec.» para varios · herramientas abajo',
    esculpir: 'Arrastra sobre el modelo para esculpir · fuera de él giras la vista',
    pintar: 'Arrastra sobre el modelo para pintar · fuera de él giras la vista',
  };
  const nombres = { objeto: 'Objeto', editar: 'Editar', esculpir: 'Esculpir', pintar: 'Pintar' };
  el.innerHTML = `<b>${nombres[modo] || 'Objeto'}</b>${s ? ` · ${esc(s.name)}` : ''}<br>${PISTAS[modo] || ''}`;
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
$('pBorrar').onclick = () => borrarSeleccion();
$('pMaterial').onclick = () => { panel.classList.remove('abierto'); materiales.abrir(); };
escena.alCambiar(pintarPanel);

const modificadores = instalarModificadores({ escena, historial, edicion, ponerModo, aviso, ctx: ctxMods });
const materiales = instalarMateriales({ escena, historial, edicion, ponerModo, aviso });

// Atajos de teclado en el PC
addEventListener('keydown', (e) => {
  if (e.target.matches?.('input')) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 's') { e.preventDefault(); guardarComo(false); return; }
  if (edicion.activo && ctrl && k === 'r') { e.preventDefault(); operacion('cortarBucle'); return; }
  if (k === 'tab') { e.preventDefault(); ponerModo(edicion.activo ? 'objeto' : 'editar'); return; }
  if (edicion.activo && !ctrl) {
    const tipos = { 1: 'v', 2: 'e', 3: 'f' };
    if (tipos[k]) { edicion.ponerTipo(tipos[k]); return; }
    if (k === 'a') { edicion.seleccionarTodo(); return; }
    if (k === 'l') { edicion.seleccionarBucle(); return; }
    if (k === 'z' && e.altKey) { $('bRayos').click(); return; }
    if (k === 'delete' || k === 'backspace' || k === 'x') { operacion('borrar'); return; }
    if (k === 'e') { operacion('extruir'); return; }
    if (k === 'i') { operacion('inset'); return; }
    if (k === 'm') { operacion('fusionar'); return; }
    if (e.shiftKey && k === 'd') return;
  }
  if (ctrl && k === 'z') { e.preventDefault(); if (e.shiftKey) historial.rehacer(); else historial.deshacer(); }
  else if (ctrl && k === 'y') { e.preventDefault(); historial.rehacer(); }
  else if (ctrl && k === 'd' || (e.shiftKey && k === 'd')) { e.preventDefault(); escena.duplicar(); }
  else if (k === 'delete' || k === 'backspace' || k === 'x') borrarSeleccion();
  else if (k === 'g' || k === 'w') ponerModoGizmo('translate');
  else if (k === 'r' || k === 'e') ponerModoGizmo('rotate');
  else if (k === 's') ponerModoGizmo('scale');
  else if (k === 'f' || k === '.') enfocar();
  else if (k === '1') camOrb.vista('frente');
  else if (k === '3') camOrb.vista('lado');
  else if (k === '7') camOrb.vista('arriba');
  else if (k === '5') camOrb.vista('persp');
  else if (k === 'escape') { if (edicion.activo || pincel.activo) ponerModo('objeto'); else escena.seleccionar(null); abrirHoja(null); }
});

// ---------- Avisos ----------
let tAviso = 0;
// aviso(texto, { texto, fn }): mensaje breve, con un botón opcional (p. ej. «Deshacer»)
function aviso(texto, accion = null) {
  const el = $('aviso');
  $('avisoTexto').textContent = texto;
  const b = $('avisoAccion');
  b.hidden = !accion;
  el.classList.toggle('con-accion', !!accion);
  if (accion) { b.textContent = accion.texto; b.onclick = () => { el.classList.remove('ver'); accion.fn(); }; }
  el.classList.add('ver');
  clearTimeout(tAviso);
  tAviso = setTimeout(() => el.classList.remove('ver'), accion ? 4500 : 2200);
}
const conDeshacer = { texto: 'Deshacer', fn: () => historial.deshacer() };
function borrarSeleccion() {
  const o = escena.seleccion; if (!o) return;
  escena.borrar(o);
  aviso(`«${o.name}» borrado`, conDeshacer);
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

// recuperar el último trabajo guardado en este dispositivo
guardado.recuperar().then((r) => {
  if (!r || !r.objetos.length) return;
  escena.raiz.remove(cubo);
  for (const o of r.objetos) escena.raiz.add(o);
  escena.avisar();
  guardado.marcarLimpio();
  const s = escena.esferaDe(null); camOrb.enfocar(s.center, s.radius);
  aviso(`Proyecto recuperado (${new Date(r.fecha).toLocaleString('es')})`);
});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// Para las pruebas en el navegador
window.studio = { escena, historial, camOrb, gizmo, anadirPrimitiva, edicion, ponerModo, materiales, modificadores, guardado };
