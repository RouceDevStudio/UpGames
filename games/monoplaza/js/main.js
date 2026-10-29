// APEX GP: arranque, menús, bucle de juego, render y HUD.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Circuito } from './track.js';
import { Sesion } from './race.js';
import { REGLAJE_DEF, COMPUESTOS, COCHE, EQUIPOS, MEJORAS_INFO } from './config.js';
import { construirEscenario } from './render/escenario.js';
import { crearModelo, dibujarPlantilla } from './render/cocheModelo.js';
import { GestorBoxes, Escombros } from './render/equipo.js';
import { NOMBRES_PATRON, NOMBRES_CASCO } from './render/librea.js';
import { cuenta, Multijugador, empaquetar, aplicarEstado } from './red.js';
import { Efectos } from './render/efectos.js';
import { Camara, NOMBRES_CAMARA } from './render/camara.js';
import { Sonido } from './audio.js';
import { Entrada } from './input.js';

const $ = (s) => document.querySelector(s);
const esTactil = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const esMovil = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (esTactil && Math.min(screen.width, screen.height) < 820);

// --- Persistencia ---------------------------------------------------------
const CLAVE = 'apexgp.v1';
const AJ_DEF = {
  control: esTactil ? 'inclinacion' : 'tactil', sensibilidad: 1, anguloInclinacion: 24, invertir: false, vibracion: true,
  tc: 2, abs: true, cambioAuto: true, direccion: true, estabilidad: false, trazada: true,
  calidad: 'auto', fps: false, volumen: 0.8, unidades: 'kmh', camara: 'persecucion',
};
const OPC_CARRERA_DEF = { vueltas: 5, rivales: 7, dificultad: 'normal', posSalida: 4, compuesto: 'medio' };
function cargar() {
  try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { return {}; }
}
const datos = cargar();
const ajustes = { ...AJ_DEF, ...(datos.ajustes || {}) };
const reglaje = { ...REGLAJE_DEF, ...(datos.reglaje || {}) };
const opcCarrera = { ...OPC_CARRERA_DEF, ...(datos.carrera || {}) };
const records = datos.records || {};
let fantasmaGuardado = datos.fantasma || null;
// garaje: lo equipado y lo comprado (el servidor manda; aquí queda una copia para jugar sin conexión)
const EQUIPADO_DEF = { patron: 'flecha', acabado: 'brillo', casco: 'clasico', propia: false, colores: { base: '#0d47ff', acento: '#00e5ff', tercero: '#ffffff' }, cascoColores: { base: '#ffffff', acento: '#0d47ff' }, numero: 7 };
const equipado = { ...EQUIPADO_DEF, ...(datos.equipado || {}), colores: { ...EQUIPADO_DEF.colores, ...(datos.equipado?.colores || {}) }, cascoColores: { ...EQUIPADO_DEF.cascoColores, ...(datos.equipado?.cascoColores || {}) } };
let perfilApex = datos.perfil || { mejoras: {}, cosmeticos: [], upcoins: null };
const opcMulti = { tipo: '1v1', max: 22, vueltas: 3, ...(datos.multi || {}) };
function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify({ ajustes, reglaje, carrera: opcCarrera, records, fantasma: fantasmaGuardado, equipado, perfil: perfilApex, multi: opcMulti })); } catch { /* sin almacenamiento */ }
}
// librea propia: imagen guardada aparte (puede pesar varios cientos de KB)
let imagenLibrea = null;
function cargarImagenLibrea() {
  let url = null;
  try { url = localStorage.getItem('apexgp.librea'); } catch { /* nada */ }
  if (!url) { imagenLibrea = null; return Promise.resolve(); }
  return new Promise(r => { const im = new Image(); im.onload = () => { imagenLibrea = im; r(); }; im.onerror = () => r(); im.src = url; });
}

// --- Utilidades -------------------------------------------------------------
function fmt(t) {
  if (!isFinite(t) || t == null) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
const esperar = (ms) => new Promise(r => setTimeout(r, ms));
function progreso(p, txt) { $('#cargaBarra').style.width = (p * 100) + '%'; if (txt) $('#cargaTexto').textContent = txt; }

// --- Calidad gráfica --------------------------------------------------------
function calidadInicial() {
  if (ajustes.calidad !== 'auto') return +ajustes.calidad;
  if (!esMovil) return 2;
  const mem = navigator.deviceMemory || 4;
  return mem >= 6 ? 1 : 0;
}
let calidad = calidadInicial();

// --- Estado global ----------------------------------------------------------
let renderer, scene, composer, camara, efectos, escenario, circuito;
const sonido = new Sonido();
const entrada = new Entrada(ajustes);
let sesion = null, modelos = [], modeloFantasma = null, lineaIdeal = null;
let gestorBoxes = null, escombros = null;
const multi = new Multijugador();
let enGaraje = false, enRed = false;
let jugando = false, pausado = false, modoActual = 'practica';
let pantallaPrevia = 'menu';

async function iniciar() {
  progreso(0.05, 'Trazando el circuito…');
  await esperar(20);
  circuito = new Circuito();
  $('#largoPista').textContent = (circuito.largo / 1000).toFixed(3) + ' km';
  progreso(0.25, 'Preparando el motor gráfico…');
  await esperar(20);
  crearRenderer();
  progreso(0.4, 'Modelando el terreno y las gradas…');
  await esperar(20);
  escenario = construirEscenario(scene, renderer, circuito, calidad);
  progreso(0.75, 'Montando los coches…');
  await esperar(20);
  efectos = new Efectos(scene, calidad);
  gestorBoxes = new GestorBoxes(scene);
  escombros = new Escombros(scene, (x, z) => { const p = circuito.proyectar(x, z, -1, {}); return p.y + circuito.caida(p.i, p.d); });
  await cargarImagenLibrea();
  construirLineaIdeal();
  dibujarMinimapaBase();
  progreso(0.9, 'Compilando sombreadores…');
  // vista de cortesía detrás del menú
  sesion = new Sesion(circuito, { modo: 'practica', reglaje, ayudas: ayudasDe() });
  crearModelos();
  renderer.compile(scene, camara.cam);
  progreso(1, '¡Listo!');
  await esperar(150);
  $('#carga').classList.remove('visible');
  mostrar('menu');
  actualizarRecordMenu();
  requestAnimationFrame(bucle);
}

function crearRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas: $('#lienzo'), antialias: calidad === 1, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = calidad >= 1;
  renderer.shadowMap.type = calidad >= 2 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  scene = new THREE.Scene();
  camara = new Camara(innerWidth / innerHeight);
  camara.modo = ajustes.camara;
  configurarPost();
  addEventListener('resize', redimensionar);
}

function pixelRatio() {
  const dpr = devicePixelRatio || 1;
  return [0.75, Math.min(dpr, 1.25), Math.min(dpr, 1.6), Math.min(dpr, 2)][calidad];
}

function configurarPost() {
  composer = null;
  if (calidad < 2) return;
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: calidad >= 3 ? 4 : 2 });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pixelRatio());
  composer.addPass(new RenderPass(scene, camara.cam));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.22, 0.45, 0.93));
  composer.addPass(new OutputPass());
}

function redimensionar() {
  renderer.setSize(innerWidth, innerHeight);
  camara.cam.aspect = innerWidth / innerHeight;
  camara.cam.updateProjectionMatrix();
  composer?.setSize(innerWidth, innerHeight);
  efectos?.ajustarEscala(innerHeight * renderer.getPixelRatio(), camara.cam.fov);
}

function cambiarCalidad(nueva) {
  if (nueva === calidad) return;
  calidad = nueva;
  renderer.setPixelRatio(pixelRatio());
  renderer.shadowMap.enabled = calidad >= 1;
  escenario.luzSol.castShadow = calidad >= 1;
  scene.traverse(o => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.needsUpdate = true; }); } });
  configurarPost();
  redimensionar();
}

// Línea de trazada ideal coloreada por frenada / curva / aceleración
function construirLineaIdeal() {
  const c = circuito, t = c.trazada, n = c.n;
  const pos = new Float32Array((n + 1) * 2 * 3), col = new Float32Array((n + 1) * 2 * 3), idx = [];
  for (let r = 0; r <= n; r++) {
    const i = r % n;
    const nx = -c.tz[i], nz = c.tx[i];
    const v0 = c.perfil[i], v1 = c.perfil[(i + 4) % n];
    let cr = 0.15, cg = 0.95, cb = 0.35;
    if (v1 < v0 - 0.25) { cr = 1; cg = 0.12; cb = 0.1; }
    else if (Math.abs(v1 - v0) <= 0.25 && v0 < 85) { cr = 1; cg = 0.8; cb = 0.1; }
    for (const [k, d] of [[0, -0.35], [1, 0.35]]) {
      const o = t.off[i] + d;
      const j = (r * 2 + k) * 3;
      pos[j] = c.x[i] + nx * o; pos[j + 1] = c.y[i] + 0.02; pos[j + 2] = c.z[i] + nz * o;
      col[j] = cr; col[j + 1] = cg; col[j + 2] = cb;
    }
    if (r < n) { const a = r * 2, b = a + 1, cc = a + 2, d = a + 3; idx.push(a, b, cc, b, d, cc); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  lineaIdeal = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  lineaIdeal.renderOrder = 2;
  scene.add(lineaIdeal);
}

const NUMEROS_IA = [16, 55, 44, 63, 1, 22, 4, 81, 14, 18, 10, 31, 23, 2, 27, 77, 24, 20, 11, 3, 12];
const imagenesRed = new Map();     // librea propia de cada rival en línea

// Librea de un equipo de la parrilla con el número y el casco del piloto
function libreaEquipo(ie, base) {
  const eq = EQUIPOS[ie];
  return { ...base, patron: eq.patron, acabado: base.acabado || 'brillo', propia: false, colores: { base: eq.base, acento: eq.acento, tercero: eq.tercero || '#ffffff' } };
}

function equipadoDe(p, k) {
  if (p.jugador) return (equipado.equipo || 0) > 0 ? libreaEquipo(equipado.equipo, equipado) : { ...equipado, propia: equipado.propia && !!imagenLibrea };
  if (p.equipado) return (p.equipado.equipo || 0) > 0 && p.equipado.equipo < EQUIPOS.length ? libreaEquipo(p.equipado.equipo, p.equipado) : p.equipado;
  const eq = p.equipo;
  return { patron: eq.patron, acabado: 'brillo', casco: ['clasico', 'rayas', 'estrellas', 'damero', 'llamas'][k % 5], colores: { base: eq.base, acento: eq.acento, tercero: eq.tercero || '#ffffff' },
    cascoColores: { base: eq.tercero || '#ffffff', acento: eq.base }, numero: NUMEROS_IA[k % NUMEROS_IA.length] };
}

function crearModelos() {
  for (const m of modelos) scene.remove(m.raiz);
  modelos = [];
  gestorBoxes?.limpiar();
  sesion.participantes.forEach((p, k) => {
    p.coche.id = k;
    const eq = equipadoDe(p, k);
    const imagen = p.jugador ? (eq.propia ? imagenLibrea : null) : (p.idRed && imagenesRed.get(p.idRed)) || null;
    const m = crearModelo({ equipo: p.equipo, equipado: eq, imagen, compuesto: p.coche.reglaje.compuesto, calidad, cabina: p.jugador });
    // piezas que se desprenden en los choques
    m.alDesprender = (tipo, obj) => {
      const c = p.coche;
      const vel = new THREE.Vector3(Math.cos(c.psi) * c.vx - Math.sin(c.psi) * c.vy, 0, Math.sin(c.psi) * c.vx + Math.cos(c.psi) * c.vy);
      escombros.lanzar(obj, vel, { radio: tipo === 'rueda' ? 0.36 : 0.08, alto: tipo === 'rueda' ? 4 : 1 });
      obj.updateMatrixWorld(true);
      escombros.esquirlas(new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld), vel, tipo === 'rueda' ? 4 : 10);
    };
    scene.add(m.raiz);
    modelos.push(m);
  });
  if (modeloFantasma) { scene.remove(modeloFantasma.raiz); modeloFantasma = null; }
  if (sesion.modo !== 'carrera') {
    modeloFantasma = crearModelo({ equipo: { base: '#9fd3ff', acento: '#ffffff' }, calidad: 0 });
    modeloFantasma.raiz.traverse(o => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.22, depthWrite: false });
        o.castShadow = false;
      }
    });
    modeloFantasma.raiz.visible = false;
    scene.add(modeloFantasma.raiz);
  }
}

function ayudasDe() {
  return { tc: +ajustes.tc, abs: ajustes.abs, cambioAuto: ajustes.cambioAuto, direccion: ajustes.direccion, estabilidad: ajustes.estabilidad };
}

// --- Sesiones -----------------------------------------------------------------
function empezar(modo) {
  modoActual = modo;
  sonido.iniciar();
  sonido.ponerVolumen(ajustes.volumen);
  const opc = { modo, reglaje: { ...reglaje }, ayudas: ayudasDe(), mejoras: perfilApex.mejoras, equipado: { ...equipado }, equipoJugador: equipado.equipo || 0, nombre: cuenta.usuario() ? '@' + cuenta.usuario() : 'Tú' };
  if (modo === 'carrera') {
    Object.assign(opc, { vueltas: opcCarrera.vueltas, rivales: opcCarrera.rivales, dificultad: opcCarrera.dificultad, posSalida: opcCarrera.posSalida });
    opc.reglaje.compuesto = opcCarrera.compuesto;
  }
  if (modo === 'contrarreloj' && fantasmaGuardado?.puntos?.length) opc.fantasma = fantasmaGuardado;
  sesion = new Sesion(circuito, opc);
  arrancarSesion(modo);
}

// Parte común de empezar una sesión local o en línea
function arrancarSesion(modo) {
  enGaraje = false;
  crearModelos();
  camara.iniciada = false;
  if (camara.modo === 'orbita') camara.modo = ajustes.camara || 'persecucion';
  ocultarTodo();
  $('#hud').classList.add('visible');
  if (esTactil) { $('#tactil').classList.add('visible'); document.body.classList.add('tactil-on'); }
  aplicarModoControl();
  document.body.classList.add('jugando');
  document.body.classList.toggle('cambio-auto', !!ajustes.cambioAuto);
  jugando = true; pausado = false;
  mensajesMostrados.clear();
  $('#semaforo').classList.toggle('visible', modo === 'carrera');
  if (modo === 'contrarreloj') mensaje('VUELTA DE SALIDA', 'La vuelta cronometrada empieza en la línea de meta', 3);
  if (modo === 'practica') mensaje('PRÁCTICA LIBRE', 'Sin límite de tiempo · prueba el reglaje', 3);
  pantallaCompleta();
  if (ajustes.control === 'inclinacion' && esTactil) entrada.activarInclinacion().then(() => setTimeout(() => entrada.calibrar(), 400));
  pedirWakeLock();
}

let wakeLock = null;
async function pedirWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* no disponible */ }
}

function pantallaCompleta() {
  if (window.Capacitor) return;
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen && esTactil) {
    el.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  }
}

function aplicarModoControl() {
  const t = $('#tactil');
  t.classList.toggle('inclinacion', ajustes.control === 'inclinacion');
  t.classList.toggle('tactil', ajustes.control !== 'inclinacion');
}

function pausar(si) {
  if (!jugando) return;
  pausado = si;
  if (si) {
    mostrar('pausa');
    $('#bPausaReglaje').style.display = modoActual === 'carrera' ? 'none' : '';
    $('#bCalibrar').style.display = ajustes.control === 'inclinacion' && esTactil ? '' : 'none';
    telemetriaPausa();
    sonido.silenciar(true);
  } else {
    ocultarTodo();
    sonido.silenciar(false);
  }
}

function salirAlMenu() {
  if (enRed) { multi.salir(); enRed = false; }
  jugando = false; pausado = false;
  $('#panelBox').classList.remove('visible');
  $('#hud').classList.remove('visible');
  $('#tactil').classList.remove('visible');
  document.body.classList.remove('jugando');
  sonido.silenciar(true);
  sesion = new Sesion(circuito, { modo: 'practica', reglaje, ayudas: ayudasDe() });
  crearModelos();
  mostrar('menu');
  actualizarRecordMenu();
  wakeLock?.release?.().catch(() => {}); wakeLock = null;
}

function actualizarRecordMenu() {
  const r = records.contrarreloj;
  $('#recordMenu').textContent = r ? `Récord personal: ${fmt(r)}` : 'Marca tu primer récord en Contrarreloj';
}

// --- Menús ----------------------------------------------------------------------
function ocultarTodo() { document.querySelectorAll('.pantalla').forEach(p => p.classList.remove('visible')); }
function mostrar(id) {
  const actual = document.querySelector('.pantalla.visible');
  if (actual && actual.id !== id && !['reglaje', 'ajustes', 'ayuda', 'cuenta'].includes(actual.id)) pantallaPrevia = actual.id;
  ocultarTodo();
  $('#' + id).classList.add('visible');
  if (id === 'reglaje') pintarReglaje();
  if (id === 'ajustes') pintarAjustes();
  if (id === 'cuenta') pintarCuenta();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ir]');
  if (!b) return;
  sonido.iniciar();
  const destino = b.dataset.ir;
  if (destino === 'volver') { aplicarAjustesEnVivo(); mostrar(jugando ? 'pausa' : pantallaPrevia || 'menu'); return; }
  if (destino === 'contrarreloj' || destino === 'practica') { empezar(destino); return; }
  if (destino === 'garaje') { abrirGaraje(); return; }
  if (destino === 'multi') { abrirMulti(); return; }
  if (destino === 'menu' && enGaraje) cerrarGaraje();
  mostrar(destino);
  if (destino === 'carrera') pintarSegmentos('#carrera', opcCarrera);
});

function pintarSegmentos(raiz, obj) {
  document.querySelectorAll(`${raiz} .segm[data-campo]`).forEach(sg => {
    const campo = sg.dataset.campo;
    sg.querySelectorAll('b').forEach(b => {
      b.classList.toggle('sel', String(obj[campo]) === b.dataset.v);
      b.onclick = () => {
        const v = b.dataset.v;
        obj[campo] = isNaN(+v) ? v : +v;
        pintarSegmentos(raiz, obj); guardar();
      };
    });
  });
}
$('#empezarCarrera').addEventListener('click', () => empezar('carrera'));

const REGLAJE_UI = [
  ['aleronDel', 'Alerón delantero', 1, 11, 'Más ángulo: más carga delante y más giro en la entrada.'],
  ['aleronTras', 'Alerón trasero', 1, 11, 'Más ángulo: estabilidad en curva rápida a costa de velocidad punta.'],
  ['repartoFreno', 'Reparto de frenada (% delante)', 50, 65, 'Más delante: estable pero bloquea antes las delanteras.'],
  ['difTraccion', 'Diferencial en aceleración (%)', 20, 100, 'Más bloqueo: mejor tracción, más subviraje a la salida.'],
  ['difRetencion', 'Diferencial en retención (%)', 20, 100, 'Más bloqueo: estabilidad al frenar, menos giro en la entrada.'],
  ['barraDel', 'Barra estabilizadora delantera', 1, 11, 'Más dura: respuesta rápida, más subviraje.'],
  ['barraTras', 'Barra estabilizadora trasera', 1, 11, 'Más dura: el coche rota mejor, la trasera es más nerviosa.'],
  ['alturaDel', 'Altura delantera', 1, 10, 'Más baja: más carga por efecto suelo; demasiado baja toca el suelo.'],
  ['alturaTras', 'Altura trasera', 1, 10, 'Controla el rake (inclinación) y el balance aerodinámico.'],
  ['presion', 'Presión de neumáticos', 1, 10, 'Más baja: más agarre y temperatura; más desgaste del flanco.'],
];
function pintarReglaje() {
  const lista = $('#listaReglaje');
  lista.innerHTML = '';
  const fila = document.createElement('div'); fila.className = 'opcion';
  fila.innerHTML = '<label>Compuesto<span class="desc">Blando: más agarre, menos duración. Duro: al revés.</span></label>';
  const seg = document.createElement('div'); seg.className = 'segm compuestos';
  for (const k of Object.keys(COMPUESTOS)) {
    const b = document.createElement('b'); b.dataset.v = k; b.textContent = COMPUESTOS[k].nombre;
    b.classList.toggle('sel', reglaje.compuesto === k);
    b.onclick = () => { reglaje.compuesto = k; guardar(); pintarReglaje(); };
    seg.appendChild(b);
  }
  fila.appendChild(seg); lista.appendChild(fila);
  for (const [campo, nombre, min, max, desc] of REGLAJE_UI) {
    const f = document.createElement('div'); f.className = 'opcion';
    f.innerHTML = `<label>${nombre}<span class="desc">${desc}</span></label><input type="range" min="${min}" max="${max}" step="1" value="${reglaje[campo]}"><span class="valor">${reglaje[campo]}</span>`;
    const inp = f.querySelector('input'), val = f.querySelector('.valor');
    inp.addEventListener('input', () => { reglaje[campo] = +inp.value; val.textContent = inp.value; guardar(); });
    lista.appendChild(f);
  }
}
$('#reglajeDef').addEventListener('click', () => { Object.assign(reglaje, REGLAJE_DEF); guardar(); pintarReglaje(); });

function pintarAjustes() {
  document.querySelectorAll('#ajustes [data-aj]').forEach(el => {
    const k = el.dataset.aj;
    if (el.classList.contains('segm')) {
      el.querySelectorAll('b').forEach(b => {
        b.classList.toggle('sel', String(ajustes[k]) === b.dataset.v);
        b.onclick = () => { ajustes[k] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; guardar(); pintarAjustes(); };
      });
    } else if (el.type === 'checkbox') {
      el.checked = !!ajustes[k];
      el.onchange = () => { ajustes[k] = el.checked; guardar(); };
    } else if (el.type === 'range') {
      el.value = ajustes[k];
      const val = el.parentElement.querySelector('.valor');
      const pinta = () => { val.textContent = k === 'volumen' ? Math.round(ajustes[k] * 100) + '%' : k === 'anguloInclinacion' ? ajustes[k] + '°' : (+ajustes[k]).toFixed(2); };
      pinta();
      el.oninput = () => { ajustes[k] = +el.value; pinta(); guardar(); if (k === 'volumen') sonido.ponerVolumen(ajustes.volumen); };
    }
  });
}

// Cambios de ajustes que se aplican al coche en marcha
function aplicarAjustesEnVivo() {
  if (!sesion) return;
  const c = sesion.jugador.coche;
  Object.assign(c.ayudas, ayudasDe());
  // el reglaje solo cambia en práctica/contrarreloj (como en parque cerrado)
  if (sesion.modo !== 'carrera') {
    const comp = c.reglaje.compuesto;
    Object.assign(c.reglaje, reglaje);
    if (reglaje.compuesto !== comp) { c.ponerCompuesto(reglaje.compuesto); crearModelos(); }
    else for (const w of c.ruedas) w.neum.ponerCompuesto(w.neum.c, reglaje.presion);
  }
  document.body.classList.toggle('cambio-auto', !!ajustes.cambioAuto);
  aplicarModoControl();
  if (ajustes.control === 'inclinacion' && esTactil) entrada.activarInclinacion();
  const objetivo = ajustes.calidad === 'auto' ? calidad : +ajustes.calidad;
  if (objetivo !== calidad) {
    mensaje('CALIDAD GRÁFICA', 'Se aplicará por completo al reiniciar el juego', 2.5);
    cambiarCalidad(objetivo);
  }
  sonido.ponerVolumen(ajustes.volumen);
}

$('#bContinuar').addEventListener('click', () => pausar(false));
$('#bReiniciar').addEventListener('click', () => empezar(modoActual));
$('#bSalir').addEventListener('click', salirAlMenu);
$('#bCalibrar').addEventListener('click', () => { entrada.calibrar(); mensaje('CENTRADO', '', 1); });
$('#bResMenu').addEventListener('click', salirAlMenu);
$('#bResOtra').addEventListener('click', () => empezar(modoActual));

entrada.conectarTactil({
  acel: $('#pedalAcel'), freno: $('#pedalFreno'), volante: $('#zonaVolante'), pomo: $('#pomo'),
  subir: $('#bSubir'), bajar: $('#bBajar'), drs: $('#bDrs'), ers: $('#bErs'), camara: $('#bCam'), pausa: $('#bPausa'),
  atras: $('#bAtras'), recolocar: $('#bRecolocar'),
});
document.addEventListener('visibilitychange', () => { if (document.hidden && jugando && !pausado) pausar(true); });

// --- Mensajes ---------------------------------------------------------------
let tMensaje = 0;
const mensajesMostrados = new Set();
function mensaje(titulo, sub = '', dur = 2) {
  const el = $('#hMensaje');
  el.innerHTML = `${titulo}${sub ? `<small>${sub}</small>` : ''}`;
  el.classList.add('visible');
  tMensaje = dur;
}

// --- Minimapa -------------------------------------------------------------------
let mapaBase = null, mapaTransf = null;
function dibujarMinimapaBase() {
  const cv = document.createElement('canvas'); cv.width = 220; cv.height = 160;
  const x = cv.getContext('2d');
  const c = circuito;
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < c.n; i++) { minx = Math.min(minx, c.x[i]); maxx = Math.max(maxx, c.x[i]); minz = Math.min(minz, c.z[i]); maxz = Math.max(maxz, c.z[i]); }
  const esc = Math.min(200 / (maxx - minx), 140 / (maxz - minz));
  const ox = (220 - (maxx - minx) * esc) / 2, oz = (160 - (maxz - minz) * esc) / 2;
  mapaTransf = (px, pz) => [ox + (px - minx) * esc, oz + (pz - minz) * esc];
  x.lineJoin = 'round';
  for (const [w, col] of [[7, 'rgba(0,0,0,.55)'], [3.5, 'rgba(235,240,248,.9)']]) {
    x.beginPath();
    for (let i = 0; i <= c.n; i += 2) { const [a, b] = mapaTransf(c.x[i % c.n], c.z[i % c.n]); i ? x.lineTo(a, b) : x.moveTo(a, b); }
    x.closePath(); x.lineWidth = w; x.strokeStyle = col; x.stroke();
  }
  // zonas DRS
  x.lineWidth = 3.5; x.strokeStyle = '#2fe07a';
  for (const z of c.drs) {
    x.beginPath();
    let s = z.ini, primero = true;
    const fin = z.fin < z.ini ? z.fin + c.largo : z.fin;
    for (; s <= fin; s += 10) { const m = c.muestra(s); const [a, b] = mapaTransf(m.x, m.z); primero ? x.moveTo(a, b) : x.lineTo(a, b); primero = false; }
    x.stroke();
  }
  const [a, b] = mapaTransf(c.x[0], c.z[0]);
  x.fillStyle = '#fff'; x.fillRect(a - 1.5, b - 5, 3, 10);
  mapaBase = cv;
}
function dibujarMinimapa() {
  const cv = $('#minimapa'), x = cv.getContext('2d');
  x.clearRect(0, 0, 220, 160);
  x.drawImage(mapaBase, 0, 0);
  for (const p of sesion.participantes) {
    if (p.jugador) continue;
    const [a, b] = mapaTransf(p.coche.x, p.coche.z);
    x.fillStyle = p.equipo.base; x.strokeStyle = p.equipo.acento; x.lineWidth = 1.5;
    x.beginPath(); x.arc(a, b, 4, 0, Math.PI * 2); x.fill(); x.stroke();
  }
  const j = sesion.jugador.coche;
  const [a, b] = mapaTransf(j.x, j.z);
  x.fillStyle = '#ffd23f'; x.strokeStyle = '#000'; x.lineWidth = 2;
  x.beginPath(); x.arc(a, b, 5.5, 0, Math.PI * 2); x.fill(); x.stroke();
}

// --- HUD ---------------------------------------------------------------------
const leds = $('#leds');
for (let k = 0; k < 15; k++) { const i = document.createElement('i'); i.className = k < 5 ? 'g' : k < 10 ? 'r' : 'b'; leds.appendChild(i); }
const ledEls = [...leds.children];
const neumEls = [...$('#hNeum').children];
const ERS_NOMBRES = ['ERS RECARGA', 'ERS NORMAL', 'ERS ADELANTAR'];
let tHud = 0;

function colorTemp(t, opt) {
  const d = t - opt;
  if (d < -35) return '#2f7bff';
  if (d < -15) return '#36c4ff';
  if (d < 15) return '#2fe07a';
  if (d < 30) return '#ffd23f';
  return '#ff3b3b';
}

function actualizarHud(dt) {
  const p = sesion.jugador, c = p.coche;
  // LEDs de cambio (cada frame)
  const rpm = c.rpm;
  const nOn = Math.max(0, Math.min(15, Math.floor((rpm - 10500) / 4200 * 15)));
  const flash = rpm > 14550 && c.marcha > 0 && c.marcha < 8;
  leds.classList.toggle('flash', flash && Math.floor(performance.now() / 70) % 2 === 0);
  ledEls.forEach((el, k) => el.classList.toggle('on', k < nOn));
  tHud += dt;
  if (tHud < 0.066) return;
  tHud = 0;
  const v = c.velocidad * (ajustes.unidades === 'mph' ? 2.23694 : 3.6);
  $('#hVel').textContent = Math.round(Math.abs(v));
  $('#hUnid').textContent = ajustes.unidades === 'mph' ? 'MPH' : 'KM/H';
  $('#hMarcha').textContent = c.marcha === -1 ? 'R' : c.marcha === 0 ? 'N' : c.marcha;
  $('#hErs').style.width = (c.ers / COCHE.ersCapacidad * 100).toFixed(0) + '%';
  $('#hErsModo').textContent = ERS_NOMBRES[c.mandos.ersModo ?? 1];
  const drs = $('#hDrs');
  drs.classList.toggle('abierto', c.drsAbierto);
  drs.classList.toggle('disponible', !c.drsAbierto && c.drsPermitido);
  $('#bDrs').classList.toggle('activo', c.drsAbierto || c.drsPermitido);
  c.ruedas.forEach((w, k) => {
    const el = neumEls[k];
    el.style.background = colorTemp(w.neum.tSup, w.neum.c.tOpt);
    el.firstChild.textContent = Math.round(w.neum.tSup);
    el.lastChild.style.width = Math.max(0, 80 * (1 - w.neum.desgaste)).toFixed(0) + '%';
    el.classList.toggle('pinchado', c.dano.pinchazo[k] && !c.dano.suelta[k]);
    el.classList.toggle('suelta', c.dano.suelta[k]);
  });
  // indicadores de daños
  const dn = $('#hDanos').children;
  const marcar = (i, on, leve) => { dn[i].classList.toggle('on', !!on); dn[i].classList.toggle('leve', !!leve); };
  marcar(0, c.danoAleron > 0.05, c.danoAleron < 0.5);
  marcar(1, c.dano.aleronTras > 0.05, c.dano.aleronTras < 0.5);
  const sm = Math.max(...c.dano.susp);
  marcar(2, sm > 0.15, sm < 0.5);
  marcar(3, c.dano.pinchazo.some((x, k) => x && !c.dano.suelta[k]), false);
  marcar(4, c.limitadorPit, false); dn[4].classList.toggle('pit', true);
  $('#bBox').classList.toggle('activo', !!p.solicitudBox);
  const desg = Math.max(...c.ruedas.map(w => w.neum.desgaste));
  $('#hNeumTxt').textContent = `${c.reglaje.compuesto.toUpperCase()} · ${Math.round((1 - desg) * 100)}%`;
  $('#hComb').textContent = `${c.combustible.toFixed(1)} KG`;
  // tiempos
  const tEl = $('#hTiempo');
  tEl.textContent = p.vuelta > 0 ? fmt(p.tVuelta) : (sesion.modo === 'carrera' ? fmt(0) : 'SALIDA');
  tEl.classList.toggle('invalida', !p.valida && p.vuelta > 0);
  $('#hMejor').textContent = fmt(p.mejor);
  $('#hTiemposMini').textContent = `Mejor ${fmt(p.mejor)} · Última ${p.ultimaVuelta ? fmt(p.ultimaVuelta.t) : '--:--.---'}`;
  $('#hUltima').textContent = p.ultimaVuelta ? fmt(p.ultimaVuelta.t) + (p.ultimaVuelta.valida ? '' : ' ✕') : '--:--.---';
  const dEl = $('#hDelta');
  const d = sesion.modo !== 'carrera' ? sesion.delta() : null;
  if (d != null) { dEl.textContent = (d > 0 ? '+' : '') + d.toFixed(2); dEl.className = 'delta ' + (d <= 0 ? 'mejor' : 'peor'); }
  else if (sesion.modo === 'carrera') {
    const g = sesion.diferencias(p);
    if (g.del != null && p.vuelta > 0) { dEl.textContent = `▲ ${g.del.toFixed(1)} s`; dEl.className = 'delta'; } else { dEl.textContent = ''; dEl.className = 'delta'; }
  } else { dEl.textContent = ''; dEl.className = 'delta'; }
  for (let k = 0; k < 3; k++) {
    const el = $('#hS' + (k + 1));
    if (p.sectores[k] == null) el.className = '';
  }
  // posición y vuelta
  const total = sesion.participantes.length;
  $('#hPos').parentElement.style.display = sesion.modo === 'carrera' ? '' : 'none';
  $('#hPos').textContent = 'P' + p.posicion; $('#hPosTot').textContent = '/' + total;
  $('#hVuelta').textContent = sesion.modo === 'carrera' ? `${Math.max(1, Math.min(p.vuelta, sesion.vueltasTotales))}/${sesion.vueltasTotales}` : String(Math.max(0, p.vuelta));
  if (sesion.modo === 'carrera' && sesion.orden) {
    const lider = sesion.orden[0];
    // en el móvil solo líder, el de delante, tú y el de detrás (el resto tapa los pedales)
    let filas = sesion.orden;
    if (esTactil) { const i = filas.indexOf(p); filas = filas.filter((q, k) => k === 0 || Math.abs(k - i) <= 1); }
    $('#hTabla').innerHTML = filas.map(q => {
      const gap = q === lider ? 'Líder' : q.terminado ? '🏁' : '+' + ((lider.distancia - q.distancia) / Math.max(20, lider.coche.velocidad)).toFixed(1);
      return `<div class="${q.jugador ? 'yo' : ''}"><span class="n">${q.posicion}</span><span class="c" style="background:${q.equipo.base}"></span><span>${q.equipo.corto}</span><span class="t">${gap}</span></div>`;
    }).join('');
  } else $('#hTabla').innerHTML = '';
  dibujarMinimapa();
}

function telemetriaPausa() {
  const c = sesion.jugador.coche;
  const nom = ['DI', 'DD', 'TI', 'TD'];
  $('#telemetria').innerHTML =
    c.ruedas.map((w, k) => `${nom[k]}: ${w.neum.tSup.toFixed(0)}°C sup · ${w.neum.tNucleo.toFixed(0)}°C carcasa · desgaste ${(w.neum.desgaste * 100).toFixed(1)}% · freno ${w.tFreno.toFixed(0)}°C`).join('<br>') +
    `<br>Carga aerodinámica a 250 km/h ≈ ${Math.round((0.5 * 1.2 * 69.4 ** 2 * ((1.5 + 0.07 * c.reglaje.aleronDel) + (2.15 + 0.10 * c.reglaje.aleronTras))) / 9.81)} kg · balance ${(c.carga.balance * 100 || 0).toFixed(1)}% delante` +
    (c.danoAleron > 0.05 ? `<br><b style="color:#ff3b3b">Alerón delantero dañado: −${Math.round(c.danoAleron * 35)}% de carga delantera</b>` : '');
}

// --- Eventos de la sesión -------------------------------------------------------
function procesarEventos() {
  for (const e of sesion.eventos) {
    if (e === 'luz') { sonido.evento('luz'); }
    else if (e === 'salida') { sonido.evento('salida'); mensaje('¡LUCES FUERA!', '', 1.2); entrada.vibrar(80); }
    else if (e.tipo === 'contacto' && e.jugador) { sonido.evento('contacto', e.fuerza); entrada.vibrar(60, 0.8); }
    else if (e.tipo === 'limites' && e.jugador) mensaje('LÍMITES DE PISTA', 'Vuelta anulada', 1.8);
    else if (e.tipo === 'sector') {
      const el = $('#hS' + (e.k + 1)); el.className = e.color;
    }
    else if (e.tipo === 'vuelta' && e.p.jugador) {
      sonido.evento('vuelta');
      const txt = e.valida ? fmt(e.t) : fmt(e.t) + ' (anulada)';
      if (e.mejora) mensaje(sesion.modo === 'carrera' ? 'MEJOR VUELTA PERSONAL' : 'NUEVO MEJOR TIEMPO', txt, 2.4);
      else mensaje('VUELTA', txt, 1.8);
      if (sesion.modo === 'contrarreloj' && e.valida && (!records.contrarreloj || e.t < records.contrarreloj)) {
        records.contrarreloj = e.t; guardar();
      }
      if (sesion.modo === 'carrera' && e.p.vuelta === sesion.vueltasTotales) mensaje('ÚLTIMA VUELTA', '', 1.8);
    }
    else if (e.tipo === 'nuevoFantasma') {
      if (sesion.modo === 'contrarreloj' && (!fantasmaGuardado || e.fantasma.tiempo < fantasmaGuardado.tiempo)) { fantasmaGuardado = e.fantasma; guardar(); }
    }
    else if (e.tipo === 'meta' && e.p.jugador) {
      mensaje('🏁 BANDERA A CUADROS', `Terminas P${e.p.posicion}`, 3);
      if (enRed) multi.meta();
      else setTimeout(() => { if (jugando && sesion.modo === 'carrera') mostrarResultados(); }, 3500);
    }
    else if (e.tipo === 'vuelta' && e.p.jugador && enRed && e.valida) multi.vuelta(e.t);
    else if (e.tipo === 'entraBoxes' && e.p.jugador) mensaje('ENTRANDO A BOXES', 'Limitador a 80 km/h', 2);
    else if (e.tipo === 'paradaIni') {
      const k = sesion.participantes.indexOf(e.p);
      gestorBoxes.empezar(e.p.coche, modelos[k], e.p.equipo.base, e.duracion, e.morro);
      if (e.p.jugador) mensaje('PARADA EN BOXES', e.morro ? 'Neumáticos y morro nuevo' : 'Cambio de neumáticos', 2);
    }
    else if (e.tipo === 'paradaFin') {
      const k = sesion.participantes.indexOf(e.p);
      modelos[k].cambiarCompuesto(e.p.coche.reglaje.compuesto);
      if (e.p.jugador) { mensaje(`PARADA: ${e.duracion.toFixed(1)} s`, `Neumáticos ${COMPUESTOS[e.p.coche.reglaje.compuesto].nombre.toLowerCase()}`, 2.4); $('#bBox').classList.remove('activo'); }
    }
    else if (e.tipo === 'abandono') {
      if (e.p.jugador) {
        mensaje('ABANDONO', e.motivo || 'Coche demasiado dañado', 3.5);
        if (enRed) multi.abandono();
        else if (sesion.modo === 'carrera') setTimeout(() => { if (jugando) mostrarResultados(); }, 4500);
        else setTimeout(() => { if (jugando && sesion.jugador.coche.abandono) { const c = sesion.jugador.coche; c.repararTodo(); c.repararEnBoxes(); c.recolocar(); sesion.jugador.abandono = false; sesion.jugador.valida = false; crearModelos(); mensaje('COCHE NUEVO', 'Vuelta anulada', 2); } }, 3500);
      }
    }
    else if (e.tipo === 'finCarrera' && !enRed) { if (jugando && !$('#resultados').classList.contains('visible')) setTimeout(() => { if (jugando) mostrarResultados(); }, 1500); }
  }
  sesion.eventos.length = 0;
  const c = sesion.jugador.coche;
  for (const e of c.eventos) {
    if (e === 'cambio') sonido.evento('cambio');
    else if (e.startsWith('golpe:')) { const f = +e.slice(6); sonido.evento('golpe', f); entrada.vibrar(Math.min(250, 40 + f * 12), 1); }
    else if (e === 'reduccionDenegada') mensaje('REDUCCIÓN DENEGADA', 'Se pasaría de vueltas', 0.9);
    else if (e.startsWith('dano:') || e.startsWith('rueda:')) avisoDano(e);
  }
  c.eventos.length = 0;
  for (const p of sesion.participantes) if (!p.jugador) p.coche.eventos.length = 0;
}

function mostrarResultados() {
  jugando = false;
  $('#hud').classList.remove('visible'); $('#tactil').classList.remove('visible');
  document.body.classList.remove('jugando');
  sonido.silenciar(true);
  const orden = sesion.orden || sesion.participantes;
  const ganador = orden[0];
  $('#resTitulo').textContent = sesion.jugador.posicion === 1 ? '🏆 ¡Victoria!' : `Resultado: P${sesion.jugador.posicion}`;
  $('#resLista').innerHTML = orden.map(p => {
    const dif = p === ganador ? fmt(p.tTotal - 0) : p.terminado ? '+' + (p.tTotal - ganador.tTotal).toFixed(3) : 'En pista';
    return `<div class="fila-res ${p.jugador ? 'yo' : ''}"><b>${p.posicion}</b><span><i class="eq" style="background:${p.equipo.base}"></i>${p.nombre} <small style="color:var(--tenue)">${p.equipo.nombre}</small></span><span>${dif}</span><span>${fmt(p.mejor)}</span></div>`;
  }).join('');
  mostrar('resultados');
}

// --- Bucle principal --------------------------------------------------------------
let tPrevio = performance.now();
let fpsAcum = 0, fpsN = 0, fpsMostrar = 0, tLento = 0;

function bucle(ahora) {
  requestAnimationFrame(bucle);
  const dt = Math.min(0.1, (ahora - tPrevio) / 1000);
  tPrevio = ahora;
  // entrada
  entrada.actualizar(dt);
  const evs = entrada.tomarEventos();
  const j = sesion.jugador.coche;
  if (jugando) {
    for (const e of evs) {
      if (e === 'pausa') pausar(!pausado);
      else if (pausado) continue;
      else if (e === 'subir') j.cambiar(1);
      else if (e === 'bajar') j.cambiar(-1);
      else if (e === 'camara') { const m = camara.siguiente(); ajustes.camara = m; guardar(); mensaje(NOMBRES_CAMARA[m].toUpperCase(), '', 0.8); }
      else if (e === 'ers') { j.mandos.ersModo = ((j.mandos.ersModo ?? 1) + 1) % 3; mensaje(ERS_NOMBRES[j.mandos.ersModo], '', 0.8); }
      else if (e === 'recolocar') {
        if (j.abandono && sesion.modo !== 'carrera') continue;
        if (j.velocidad < 8 || j.fueraPista) { j.recolocar(); sesion.jugador.valida = false; mensaje('DE VUELTA A LA PISTA', 'Vuelta anulada', 1.2); }
      }
      else if (e === 'box') alternarPanelBox();
    }
    if (sesion._pilotoPrueba) sesion._pilotoPrueba.conducir(dt, sesion.coches);
    else if (sesion.jugador.box) { /* la calle de boxes la conduce el ingeniero */ }
    else {
      j.mandos.direccion = entrada.direccion;
      j.mandos.acelerador = entrada.acelerador;
      j.mandos.freno = entrada.freno;
    }
    j.mandos.drs = entrada.drs || (j.drsPermitido && esTactil && ajustes.cambioAuto && !entrada.usandoMando);
    camara.mirarAtras = entrada.mirarAtras;
  } else {
    // menú: el coche del jugador da vueltas solo como fondo (en el garaje se queda quieto)
    if (enGaraje) { /* parado frente a su garaje */ }
    else if (!sesion._piloto) import('./ai.js').then(({ PilotoIA }) => { if (sesion && !sesion._piloto) { sesion._piloto = new PilotoIA(sesion.jugador.coche, circuito, 0.9, 0.3); sesion.jugador.coche.esIA = true; } });
    if (!enGaraje) sesion._piloto?.conducir(dt, sesion.coches);
  }
  if (enRed && jugando) actualizarRed(dt);
  if (!pausado && !enGaraje) {
    sesion.actualizar(dt);
    if (jugando) procesarEventos(); else { sesion.eventos.length = 0; for (const p of sesion.participantes) p.coche.eventos.length = 0; }
  }
  // semáforo
  if (sesion.modo === 'carrera' && jugando) {
    const sem = $('#semaforo');
    sem.classList.toggle('visible', sesion.estado === 'parrilla');
    [...sem.children].forEach((el, k) => el.classList.toggle('on', k < sesion.luces));
    escenario.semaforo.poner(sesion.estado === 'parrilla' ? sesion.luces : 0);
  } else escenario.semaforo.poner(0);

  // modelos
  sesion.participantes.forEach((p, k) => {
    const c = p.coche, m = modelos[k];
    m.raiz.position.set(c.x, c.y, c.z);
    // inclinación por la pendiente de la pista
    const pend = Math.atan(circuito.pendiente[c.proj.i] * (Math.cos(c.psi) * c.proj.tx + Math.sin(c.psi) * c.proj.tz));
    m.raiz.rotation.set(0, -c.psi, 0);
    m.raiz.rotateZ(pend);
    m.actualizar(c, dt);
  });
  // fantasma
  if (modeloFantasma) {
    const f = sesion.fantasma, p = sesion.jugador;
    const ver = f?.puntos?.length && p.vuelta > 0 && jugando;
    modeloFantasma.raiz.visible = !!ver;
    if (ver) {
      const u = p.tVuelta / 0.05, i = Math.min(f.puntos.length - 2, Math.floor(u)), t = Math.min(1, u - i);
      const a = f.puntos[i], b = f.puntos[i + 1] || a;
      modeloFantasma.raiz.position.set(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t, a[1] + (b[1] - a[1]) * t);
      let dpsi = b[3] - a[3]; dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi));
      modeloFantasma.raiz.rotation.set(0, -(a[3] + dpsi * t), 0);
      const dist = Math.hypot(modeloFantasma.raiz.position.x - j.x, modeloFantasma.raiz.position.z - j.z);
      modeloFantasma.raiz.visible = dist > 3;
    }
  }
  lineaIdeal.visible = jugando && ajustes.trazada;
  // en la cámara de cabina el tablero está en el volante (se oculta el del HUD)
  document.body.classList.toggle('vista-cabina', jugando && camara.modo === 'cabina');
  const pj = sesion.jugador, mj = modelos[sesion.participantes.indexOf(pj)];
  if (mj) mj.info = {
    pos: sesion.modo === 'carrera' ? pj.posicion : null,
    vuelta: sesion.modo === 'carrera' ? `VUELTA ${Math.max(1, Math.min(pj.vuelta, sesion.vueltasTotales))}/${sesion.vueltasTotales}` : `VUELTA ${Math.max(0, pj.vuelta)}`,
    tiempo: pj.vuelta > 0 ? fmt(pj.tVuelta) : '',
    delta: sesion.modo !== 'carrera' ? sesion.delta() : null,
    box: !!pj.solicitudBox,
  };

  // cámara, luz y efectos
  const mJ = modelos[sesion.participantes.indexOf(sesion.jugador)];
  camara.actualizar(dt, j, mJ);
  const luz = escenario.luzSol;
  luz.target.position.set(j.x, j.y, j.z);
  luz.position.copy(escenario.sol).multiplyScalar(250).add(luz.target.position);
  if (!pausado) {
    efectos.actualizar(dt, sesion.coches, camara.cam.position);
    escombros.actualizar(dt);
    gestorBoxes.actualizar(dt);
  }
  for (const f of escenario.actualizables) f(dt);
  if (efectos._escala !== camara.cam.fov) { efectos.ajustarEscala(innerHeight * renderer.getPixelRatio(), camara.cam.fov); efectos._escala = camara.cam.fov; }

  // sonido
  if (jugando && !pausado) {
    let cerca = null, dmin = Infinity;
    for (const p of sesion.participantes) {
      if (p.jugador) continue;
      const dx = p.coche.x - j.x, dz = p.coche.z - j.z;
      const d = Math.hypot(dx, dz);
      if (d < dmin) {
        dmin = d;
        // velocidad relativa de acercamiento (Doppler)
        const vx = Math.cos(p.coche.psi) * p.coche.vx - Math.cos(j.psi) * j.vx, vz = Math.sin(p.coche.psi) * p.coche.vx - Math.sin(j.psi) * j.vx;
        cerca = { coche: p.coche, dist: d, vRel: -(vx * dx + vz * dz) / Math.max(1, d) };
      }
    }
    sonido.actualizar(dt, j, dmin < 150 ? cerca : null, camara.cam);
    // vibración en bordillos
    if (j.enBordillo && j.velocidad > 15 && Math.random() < dt * 12) entrada.vibrar(12, 0.3);
    actualizarHud(dt);
  }
  if (tMensaje > 0) { tMensaje -= dt; if (tMensaje <= 0) $('#hMensaje').classList.remove('visible'); }

  // render
  if (composer) composer.render(); else renderer.render(scene, camara.cam);

  // rendimiento: baja la calidad si el móvil no llega
  fpsAcum += dt; fpsN++;
  if (fpsAcum >= 1) {
    fpsMostrar = fpsN / fpsAcum;
    if (ajustes.fps) $('#hFps').textContent = `${fpsMostrar.toFixed(0)} FPS · calidad ${['baja', 'media', 'alta', 'ultra'][calidad]}`;
    else $('#hFps').textContent = '';
    if (ajustes.calidad === 'auto' && jugando && !pausado) {
      tLento = fpsMostrar < 40 ? tLento + 1 : 0;
      if (tLento >= 4 && calidad > 0) { cambiarCalidad(calidad - 1); tLento = 0; }
    }
    fpsAcum = 0; fpsN = 0;
  }
}

// --- Daños y boxes ----------------------------------------------------------------
const NOMBRE_RUEDA = ['delantera izquierda', 'delantera derecha', 'trasera izquierda', 'trasera derecha'];
function avisoDano(e) {
  const [tipo, det] = e.split(':');
  entrada.vibrar(140, 1);
  if (tipo === 'rueda') { mensaje('¡RUEDA ARRANCADA!', NOMBRE_RUEDA[+det], 3); return; }
  if (det === 'aleronDel') mensaje('ALERÓN DELANTERO ROTO', 'Entra a boxes a cambiar el morro', 2.5);
  else if (det === 'aleronDelTocado') mensaje('ALERÓN DELANTERO TOCADO', 'Menos carga delante', 1.8);
  else if (det === 'aleronTras') mensaje('ALERÓN TRASERO DAÑADO', 'El coche pierde estabilidad', 2.2);
  else if (det.startsWith('pinchazo')) mensaje('¡PINCHAZO!', `Rueda ${NOMBRE_RUEDA[+det.slice(8)]} · entra a boxes`, 2.8);
  else if (det.startsWith('susp')) mensaje('SUSPENSIÓN DAÑADA', `Rueda ${NOMBRE_RUEDA[+det.slice(4)]} · el coche tira hacia un lado`, 2.4);
}

function alternarPanelBox() {
  const p = sesion.jugador;
  if (p.box) { mensaje('YA ESTÁS EN BOXES', '', 1); return; }
  if (p.solicitudBox) { sesion.cancelarBox(p); mensaje('BOXES CANCELADO', '', 1); $('#panelBox').classList.remove('visible'); return; }
  $('#panelBox').classList.toggle('visible');
}
document.querySelectorAll('#panelBox [data-box]').forEach(b => b.addEventListener('click', () => {
  const v = b.dataset.box;
  $('#panelBox').classList.remove('visible');
  if (v === 'cancelar') { sesion.cancelarBox(sesion.jugador); return; }
  sesion.pedirBox(sesion.jugador, v);
  mensaje('BOX, BOX', `Entra al final de esta vuelta · neumáticos ${COMPUESTOS[v].nombre.toLowerCase()}`, 2.4);
}));
$('#bBox').addEventListener('click', () => entrada.eventos.push('box'));
$('#bBox').addEventListener('touchstart', (e) => { e.preventDefault(); entrada.eventos.push('box'); }, { passive: false });
addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'x' && !e.repeat) entrada.eventos.push('box'); });

// --- Cuenta de UpGames ---------------------------------------------------------------
function pintarCuenta() {
  const u = cuenta.usuario();
  const dentro = cuenta.conectado();
  $('#formLogin').classList.toggle('oculto', dentro);
  $('#cuentaSalir').classList.toggle('oculto', !dentro);
  $('#cuentaEstado').innerHTML = dentro ? `Conectado como <b>@${u || 'tú'}</b>${perfilApex.upcoins != null ? ` · <b style="color:#ffd23f">${perfilApex.upcoins} UpCoins</b>` : ''}` : 'Inicia sesión para usar tus UpCoins, guardar tu garaje y aparecer con tu nombre en las salas en línea.';
  $('#lgError').textContent = '';
}
$('#formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#lgError').textContent = 'Entrando…';
  try {
    await cuenta.entrar($('#lgUsuario').value.trim(), $('#lgClave').value, $('#lg2fa').value.trim());
    $('#lgClave').value = '';
    await refrescarPerfil();
    pintarCuenta(); actualizarCuentaMenu();
    mostrar(pantallaPrevia === 'garaje' ? 'garaje' : 'menu');
    if (enGaraje) pintarGaraje();
  } catch (err) {
    if (err.datos?.require2FA) { $('#fila2fa').classList.remove('oculto'); $('#lgError').textContent = 'Escribe el código de tu app de autenticación'; return; }
    $('#lgError').textContent = err.message || 'No se pudo entrar';
  }
});
$('#bSalirCuenta').addEventListener('click', () => { cuenta.salir(); perfilApex = { mejoras: {}, cosmeticos: [], upcoins: null }; guardar(); pintarCuenta(); actualizarCuentaMenu(); });
$('#bCuentaG').addEventListener('click', () => { pantallaPrevia = 'garaje'; mostrar('cuenta'); });

async function refrescarPerfil() {
  if (!cuenta.conectado()) return;
  try {
    const d = await cuenta.perfil();
    perfilApex = { mejoras: d.mejoras || {}, cosmeticos: d.cosmeticos || [], upcoins: d.upcoins };
    if (d.equipado) Object.assign(equipado, d.equipado, { propia: equipado.propia && d.equipado.propia });
    guardar();
  } catch (e) { if (e.status === 401) perfilApex.upcoins = null; }
}
function actualizarCuentaMenu() {
  const u = cuenta.usuario();
  $('#cuentaMenu').innerHTML = cuenta.conectado() ? `@${u || 'piloto'} · ${perfilApex.upcoins ?? '…'} UpCoins` : '<a href="#" id="lnkEntrar" style="color:#9fd3ff">Inicia sesión con UpGames</a> para usar tus UpCoins';
  const l = $('#lnkEntrar'); if (l) l.onclick = (e) => { e.preventDefault(); pantallaPrevia = 'menu'; mostrar('cuenta'); };
}

// --- Garaje ------------------------------------------------------------------------
let catalogo = null, tabGaraje = 'mejoras';
const PRECIOS_NIVEL = [60, 120, 200, 320, 500];
const PRECIO_COSM = {
  'patron:lisa': 0, 'patron:franjas': 0, 'patron:flecha': 60, 'patron:degradado': 80, 'patron:rayo': 100, 'patron:geometrico': 120, 'patron:digital': 150, 'patron:llamas': 180,
  'acabado:brillo': 0, 'acabado:mate': 60, 'acabado:perlado': 120, 'acabado:cromado': 250, 'acabado:dorado': 400,
  'casco:clasico': 0, 'casco:rayas': 40, 'casco:estrellas': 70, 'casco:damero': 70, 'casco:llamas': 100, 'casco:neon': 120, 'livery:propia': 150,
};
const NOMBRES_ACABADO = { brillo: 'Brillo', mate: 'Mate', perlado: 'Perlado', cromado: 'Cromado', dorado: 'Oro' };
const tiene = (id) => (PRECIO_COSM[id] ?? 1) === 0 || perfilApex.cosmeticos.includes(id);

async function abrirGaraje() {
  sonido.iniciar();
  enGaraje = true;
  // el coche del jugador espera frente a su garaje en la calle de boxes
  sesion = new Sesion(circuito, { modo: 'practica', reglaje, ayudas: ayudasDe(), mejoras: perfilApex.mejoras, equipado: { ...equipado } });
  const c = sesion.jugador.coche;
  const sG = circuito.pit.garajes[0];
  c.colocar(sG, circuito.semiAncho[0] + circuito.pit.carril + 2.2);
  c.retenido = true;
  crearModelos();
  camara.modo = 'orbita'; camara.iniciada = false;
  mostrar('garaje');
  pintarGaraje();
  if (cuenta.conectado()) { await refrescarPerfil(); pintarGaraje(); }
  if (!catalogo) cuenta.catalogo().then(d => { catalogo = d; }).catch(() => {});
}
function cerrarGaraje() {
  enGaraje = false;
  camara.modo = ajustes.camara || 'persecucion';
  sesion = new Sesion(circuito, { modo: 'practica', reglaje, ayudas: ayudasDe() });
  crearModelos();
  actualizarCuentaMenu();
}
document.querySelectorAll('#garaje .pestanas b').forEach(b => b.addEventListener('click', () => { tabGaraje = b.dataset.tab; pintarGaraje(); }));

function avisoG(t) { $('#gMensaje').textContent = t || ''; }

function pintarGaraje() {
  document.querySelectorAll('#garaje .pestanas b').forEach(b => b.classList.toggle('sel', b.dataset.tab === tabGaraje));
  $('#tabMejoras').classList.toggle('oculto', tabGaraje !== 'mejoras');
  $('#tabLibrea').classList.toggle('oculto', tabGaraje !== 'librea');
  $('#tabCasco').classList.toggle('oculto', tabGaraje !== 'casco');
  $('#tabMonoplaza').classList.toggle('oculto', tabGaraje !== 'monoplaza');
  const eqSel = equipado.equipo || 0;
  $('#tabMonoplaza').innerHTML = '<p class="nota" style="text-align:left">Elige con qué monoplaza corres. Todos rinden igual; cambia la librea, el garaje y tu compañero de equipo. Con <b>UpGames Racing</b> llevas tu propio diseño.</p><div class="rejilla">' +
    EQUIPOS.map((eq, k) => `<div class="ficha coche ${eqSel === k ? 'sel' : ''}" data-equipo="${k}"><i class="muestra" style="background:linear-gradient(135deg, ${eq.base} 0 55%, ${eq.acento} 55% 75%, ${eq.tercero || '#fff'} 75%)"></i>${eq.nombre}<span class="precio libre">${eqSel === k ? 'TU COCHE' : k === 0 ? 'TU DISEÑO' : 'GRATIS'}</span></div>`).join('') + '</div>';
  document.querySelectorAll('#garaje [data-equipo]').forEach(b => b.onclick = () => { equipado.equipo = +b.dataset.equipo; aplicarEquipado(); });
  $('#saldoUC').textContent = cuenta.conectado() ? `${perfilApex.upcoins ?? '…'} UpCoins` : 'Sin sesión';
  // mejoras de rendimiento
  const desc = { motor: '+1,2 % de potencia por nivel', aero: '+1 % de carga y −0,6 % de resistencia', frenos: '+3 % de frenada y mejor refrigeración', chasis: '−3 kg por nivel', neumaticos: '−6 % de desgaste y +0,4 % de agarre', ers: '+5 % de despliegue y +4 % de recuperación' };
  $('#tabMejoras').innerHTML = Object.entries(MEJORAS_INFO).map(([id, nom]) => {
    const n = perfilApex.mejoras[id] || 0;
    const pips = Array.from({ length: 5 }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('');
    const boton = n >= 5 ? '<b class="mini" style="color:var(--verde)">MÁXIMO</b>' : `<button class="btn mini comprar" data-comprar="mejora:${id}">Nivel ${n + 1} · ${PRECIOS_NIVEL[n]} UC</button>`;
    return `<div class="mejora"><div><span class="nom">${nom}</span><div class="pips">${pips}</div></div>${boton}<span class="desc">${desc[id]}</span></div>`;
  }).join('') + '<p class="nota">Las mejoras cuentan en carreras contra la IA y en las salas en línea que las permitan.</p>';
  // librea
  const fichas = (tipo, nombres, actual) => Object.entries(nombres).map(([k, n]) => {
    const id = `${tipo}:${k}`, ok = tiene(id), precio = PRECIO_COSM[id] ?? 0;
    return `<div class="ficha ${actual === k ? 'sel' : ''}" data-equipar="${tipo}" data-v="${k}">${n}<span class="precio ${ok ? 'libre' : ''}">${ok ? (actual === k ? 'EQUIPADO' : 'TUYO') : precio + ' UC'}</span></div>`;
  }).join('');
  const col = equipado.colores;
  $('#tabLibrea').innerHTML = `
    <h3>Diseño</h3><div class="rejilla">${fichas('patron', NOMBRES_PATRON, equipado.patron)}</div>
    <h3>Colores y número</h3>
    <div class="colores">
      <label>Base<input type="color" data-color="base" value="${col.base}"></label>
      <label>Acento<input type="color" data-color="acento" value="${col.acento}"></label>
      <label>Detalles<input type="color" data-color="tercero" value="${col.tercero}"></label>
      <label>Número<input class="campo" style="width:70px" type="number" min="1" max="99" id="gNumero" value="${equipado.numero}"></label>
    </div>
    <h3>Acabado de la pintura</h3><div class="rejilla">${fichas('acabado', NOMBRES_ACABADO, equipado.acabado)}</div>
    <h3>Librea propia</h3>
    <p class="nota" style="text-align:left">Descarga la plantilla, pinta encima con cualquier editor (respetando las tres vistas) y súbela. ${tiene('livery:propia') ? '' : 'Desbloquéala por 150 UC.'}</p>
    <div class="fila">
      <button class="btn mini" id="gPlantilla">Descargar plantilla</button>
      ${tiene('livery:propia') ? `<label class="btn mini" style="text-align:center">Subir imagen<input type="file" accept="image/*" id="gSubir" hidden></label>${imagenLibrea ? `<button class="btn mini" id="gUsarPropia">${equipado.propia ? 'Usar diseño del juego' : 'Usar mi librea'}</button>` : ''}` : '<button class="btn mini comprar" data-comprar="cosmetico:livery:propia">Desbloquear · 150 UC</button>'}
    </div>`;
  $('#tabCasco').innerHTML = `
    <h3>Diseño del casco</h3><div class="rejilla">${fichas('casco', NOMBRES_CASCO, equipado.casco)}</div>
    <h3>Colores</h3>
    <div class="colores">
      <label>Base<input type="color" data-casco="base" value="${equipado.cascoColores.base}"></label>
      <label>Diseño<input type="color" data-casco="acento" value="${equipado.cascoColores.acento}"></label>
    </div>`;
  // eventos
  document.querySelectorAll('#garaje [data-comprar]').forEach(b => b.onclick = () => comprar(b.dataset.comprar));
  document.querySelectorAll('#garaje [data-equipar]').forEach(b => b.onclick = () => {
    const tipo = b.dataset.equipar, v = b.dataset.v, id = `${tipo}:${v}`;
    if (!tiene(id)) { comprar('cosmetico:' + id, () => { equipado[tipo] = v; aplicarEquipado(); }); return; }
    equipado[tipo] = v; aplicarEquipado();
  });
  document.querySelectorAll('#garaje [data-color]').forEach(i => i.onchange = () => { equipado.colores[i.dataset.color] = i.value; aplicarEquipado(); });
  document.querySelectorAll('#garaje [data-casco]').forEach(i => i.onchange = () => { equipado.cascoColores[i.dataset.casco] = i.value; aplicarEquipado(); });
  const num = $('#gNumero'); if (num) num.onchange = () => { const n = Math.max(1, Math.min(99, Math.floor(+num.value) || 7)); equipado.numero = n; aplicarEquipado(); };
  const pl = $('#gPlantilla'); if (pl) pl.onclick = descargarPlantilla;
  const sub = $('#gSubir'); if (sub) sub.onchange = () => subirLibrea(sub.files[0]);
  const up = $('#gUsarPropia'); if (up) up.onclick = () => { equipado.propia = !equipado.propia; aplicarEquipado(); };
}

let tGuardarEquipado = 0;
function aplicarEquipado() {
  guardar();
  crearModelos();
  pintarGaraje();
  // se guarda en el servidor (con un respiro para no enviar cada clic)
  clearTimeout(tGuardarEquipado);
  if (cuenta.conectado()) tGuardarEquipado = setTimeout(() => cuenta.equipar(equipado).catch(() => {}), 800);
}

async function comprar(id, despues) {
  if (!cuenta.conectado()) { avisoG('Inicia sesión con tu cuenta de UpGames para comprar con UpCoins.'); pantallaPrevia = 'garaje'; mostrar('cuenta'); return; }
  avisoG('Comprando…');
  try {
    const d = await cuenta.comprar(id);
    perfilApex = { mejoras: d.mejoras || perfilApex.mejoras, cosmeticos: d.cosmeticos || perfilApex.cosmeticos, upcoins: d.upcoins };
    guardar();
    avisoG(d.repetido ? 'Ya lo tenías.' : `¡Listo! −${d.precio} UpCoins`);
    despues?.();
    if (id.startsWith('mejora:')) { sesion.jugador.coche.ef = (await import('./config.js')).efectosMejoras(perfilApex.mejoras); }
    pintarGaraje();
  } catch (e) {
    avisoG(e.status === 402 ? `${e.message}. Consigue UpCoins en upgames.games` : e.message || 'No se pudo comprar');
  }
}

function descargarPlantilla() {
  const cv = dibujarPlantilla(2048);
  cv.toBlob((b) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = 'apexgp-plantilla-librea.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

function subirLibrea(archivo) {
  if (!archivo) return;
  const im = new Image();
  im.onload = () => {
    // se guarda como JPEG cuadrado de 1024 px (cabe en el almacenamiento del navegador)
    const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
    cv.getContext('2d').drawImage(im, 0, 0, 1024, 1024);
    const url = cv.toDataURL('image/jpeg', 0.86);
    try { localStorage.setItem('apexgp.librea', url); } catch { avisoG('La imagen es demasiado grande para guardarla.'); return; }
    URL.revokeObjectURL(im.src);
    cargarImagenLibrea().then(() => { equipado.propia = true; aplicarEquipado(); avisoG('Librea cargada.'); });
  };
  im.onerror = () => avisoG('No se pudo leer la imagen');
  im.src = URL.createObjectURL(archivo);
}

// Versión reducida de la librea propia para enviarla a la sala (≈30 KB)
function libreaParaRed() {
  if (!equipado.propia || !imagenLibrea) return '';
  const cv = document.createElement('canvas'); cv.width = cv.height = 384;
  cv.getContext('2d').drawImage(imagenLibrea, 0, 0, 384, 384);
  const url = cv.toDataURL('image/jpeg', 0.6);
  return url.length < 48000 ? url : '';
}

// --- Multijugador -------------------------------------------------------------------
let salaActual = null, carreraRed = null, tEnvio = 0;

async function abrirMulti() {
  mostrar('multi');
  pintarOpcMulti();
  $('#mEstado').textContent = 'Conectando con el servidor de UpGames…';
  try {
    await multi.conectar();
    $('#mEstado').innerHTML = `Conectado${cuenta.conectado() ? ` como <b>@${cuenta.usuario()}</b>` : ' como invitado (inicia sesión para usar tu nombre y tus mejoras)'} · ping ${Math.round(multi.latencia || 0)} ms`;
    multi.pedirLista();
  } catch (e) { $('#mEstado').textContent = e.message + '. Revisa tu conexión.'; }
}
function pintarOpcMulti() {
  document.querySelectorAll('#multi [data-mp]').forEach(sg => {
    const k = sg.dataset.mp;
    sg.querySelectorAll('b').forEach(b => {
      b.classList.toggle('sel', String(opcMulti[k]) === b.dataset.v);
      b.onclick = () => { opcMulti[k] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; guardar(); pintarOpcMulti(); };
    });
  });
  $('#filaMax').classList.toggle('oculto', opcMulti.tipo === '1v1');
}
multi.on('lista', (l) => {
  $('#listaSalas').innerHTML = l.length ? '<h3>Salas abiertas</h3>' + l.map(x => `<div class="sala-pub" data-codigo="${x.codigo}"><span><b>${x.nombre.replace(/</g, '')}</b> · ${x.tipo === '1v1' ? 'Duelo' : 'Abierta'} · ${x.vueltas} vueltas${x.mejoras ? ' · con mejoras' : ''}</span><span>${x.jugadores}/${x.max}</span></div>`).join('') : '<p class="nota">No hay salas abiertas ahora mismo. ¡Crea una y comparte el código!</p>';
  document.querySelectorAll('.sala-pub').forEach(el => el.onclick = () => unirse(el.dataset.codigo));
});
multi.on('aviso', (t) => { if ($('#sala').classList.contains('visible')) $('#salaInfo').textContent = t; else $('#mEstado').textContent = t; });
const datosJugador = () => ({ nombre: cuenta.usuario() || 'Invitado', equipado: { ...equipado }, livery: libreaParaRed() });
$('#bCrearSala').addEventListener('click', async () => {
  const r = await multi.crear({ ...datosJugador(), opciones: { tipo: opcMulti.tipo, max: opcMulti.max, vueltas: opcMulti.vueltas, publica: $('#mpPublica').checked, mejoras: $('#mpMejoras').checked } });
  if (!r.ok) { $('#mEstado').textContent = r.error; return; }
  entrarSala(r.sala);
});
$('#bUnirse').addEventListener('click', () => unirse($('#mpCodigo').value));
async function unirse(codigo) {
  const r = await multi.unirse({ ...datosJugador(), codigo: String(codigo || '').toUpperCase().trim() });
  if (!r.ok) { $('#mEstado').textContent = r.error; return; }
  entrarSala(r.sala);
}
$('#bSalirMulti').addEventListener('click', () => { multi.desconectar(); mostrar('menu'); });
function entrarSala(sala) { salaActual = sala; mostrar('sala'); pintarSala(); }
multi.on('sala', (sala) => { salaActual = sala; if ($('#sala').classList.contains('visible')) pintarSala(); });
multi.on('livery', (d) => {
  const im = new Image(); im.onload = () => { imagenesRed.set(d.id, im); if (enRed && jugando) crearModelos(); }; im.src = d.livery;
});
function pintarSala() {
  const s = salaActual; if (!s) return;
  const yo = multi.yo, soyHost = s.host === yo;
  $('#salaTitulo').textContent = `${s.nombre} · ${s.codigo}`;
  $('#salaInfo').innerHTML = `${s.tipo === '1v1' ? 'Duelo 1 vs 1' : `Sala abierta · hasta ${s.max} pilotos`} · ${s.vueltas} vueltas · ${s.mejoras ? 'con mejoras de UpCoins' : 'coches iguales'}${s.publica ? ' · pública' : ' · privada'}<br>Comparte el código <b style="color:#ffd23f;font-size:16px">${s.codigo}</b> para que se unan.`;
  $('#salaPilotos').innerHTML = s.jugadores.map((j, k) => `<div class="sala-fila"><b>${k + 1}</b><span><i class="eq" style="display:inline-block;width:4px;height:16px;border-radius:2px;margin-right:8px;vertical-align:middle;background:${j.equipado?.colores?.base || '#888'}"></i>${j.nombre.replace(/</g, '')}${j.id === yo ? ' (tú)' : ''}</span><span class="host">${j.id === s.host ? 'ANFITRIÓN' : ''}</span><span class="listo">${j.listo || j.id === s.host ? 'LISTO' : ''}</span></div>`).join('');
  $('#bSalaEmpezar').classList.toggle('oculto', !soyHost);
  $('#bSalaListo').classList.toggle('oculto', soyHost);
  const yoJ = s.jugadores.find(j => j.id === yo);
  $('#bSalaListo').textContent = yoJ?.listo ? 'No estoy listo' : 'Estoy listo';
}
$('#bSalaListo').addEventListener('click', () => { const j = salaActual?.jugadores.find(x => x.id === multi.yo); multi.listo(!j?.listo); });
$('#bSalaEmpezar').addEventListener('click', async () => { const r = await multi.iniciar(); if (!r?.ok) $('#salaInfo').textContent = r?.error || 'No se pudo empezar'; });
$('#bSalaSalir').addEventListener('click', () => { multi.salir(); salaActual = null; abrirMulti(); });
$('#bSalaCompartir').addEventListener('click', async () => {
  const t = `¡Corre contra mí en APEX GP! Código de sala: ${salaActual?.codigo} · https://upgames.games/games/monoplaza/`;
  try { if (navigator.share) await navigator.share({ title: 'APEX GP', text: t }); else { await navigator.clipboard.writeText(t); $('#salaInfo').textContent = 'Código copiado'; } } catch { /* cancelado */ }
});

// el servidor da la salida: todos arrancan la carrera a la vez con el mismo semáforo
multi.on('salida', (d) => {
  const s = salaActual;
  modoActual = 'red'; enRed = true;
  sonido.iniciar(); sonido.ponerVolumen(ajustes.volumen);
  sesion = new Sesion(circuito, {
    modo: 'carrera', vueltas: s.vueltas, reglaje: { ...reglaje }, ayudas: ayudasDe(),
    multijugador: { parrilla: d.parrilla, yo: multi.yo, jugadores: s.jugadores.map(j => j.id === multi.yo ? { ...j, mejoras: perfilApex.mejoras } : j), mejoras: s.mejoras },
  });
  sesion.tSalidaLocal = d.tSalidaLocal;
  carreraRed = { resultados: null };
  arrancarSesion('carrera');
});
multi.on('resultados', (r) => { if (carreraRed) carreraRed.resultados = r; setTimeout(() => { if (enRed) mostrarResultadosRed(r); }, 2500); });
multi.on('desconectado', () => { if (enRed && jugando) mensaje('CONEXIÓN PERDIDA', 'Reintentando…', 3); });

function actualizarRed(dt) {
  // semáforo sincronizado con el reloj del servidor
  if (sesion.estado === 'parrilla' && sesion.tSalidaLocal) {
    const faltan = (sesion.tSalidaLocal - Date.now()) / 1000;
    const luces = faltan > 6.5 ? 0 : faltan > 0 ? Math.min(5, Math.floor(7.5 - faltan)) : 0;
    if (luces > sesion.luces) { sesion.luces = luces; sonido.evento('luz'); }
    sesion.tLuces = 0; sesion.tApagar = null;
    if (faltan <= 0) { sesion.estado = 'carrera'; sesion.luces = 0; sesion.eventos.push('salida'); }
  }
  // rivales: posición interpolada de la red
  for (const p of sesion.participantes) {
    if (!p.remoto) continue;
    const e = multi.interpolado(p.idRed);
    if (!e) continue;
    aplicarEstado(p.coche, e, circuito);
    p.distancia = e[11]; p.vuelta = e[12];
    for (const w of p.coche.ruedas) w.giro += p.coche.vx / w.radio * dt;
    const j = salaActual?.jugadores.find(x => x.id === p.idRed);
    if (j) { p.terminado = j.terminado; p.abandono = j.abandono; if (j.terminado) sesion.banderaFinal = true; }
  }
  // mi coche, ~15 veces por segundo
  tEnvio += dt;
  if (tEnvio >= 1 / 15) { tEnvio = 0; multi.enviarEstado(empaquetar(sesion.jugador.coche, sesion.jugador)); }
}

function mostrarResultadosRed(r) {
  jugando = false;
  $('#hud').classList.remove('visible'); $('#tactil').classList.remove('visible');
  document.body.classList.remove('jugando');
  sonido.silenciar(true);
  const yo = r.find(x => x.id === multi.yo);
  $('#resTitulo').textContent = yo?.pos === 1 && !yo.abandono ? '🏆 ¡Victoria en línea!' : `Resultado: P${yo?.pos ?? '-'}`;
  const ganador = r[0];
  $('#resLista').innerHTML = r.map(x => `<div class="fila-res ${x.id === multi.yo ? 'yo' : ''}"><b>${x.pos}</b><span>${String(x.nombre).replace(/</g, '')}</span><span>${x.abandono ? 'Abandono' : x === ganador ? fmt(x.tiempo) : '+' + (x.tiempo - ganador.tiempo).toFixed(3)}</span><span>${fmt(x.mejor)}</span></div>`).join('');
  mostrar('resultados');
  $('#bResOtra').textContent = 'Volver a la sala';
}
$('#bResOtra').addEventListener('click', (e) => {
  if (!enRed) return;
  e.stopImmediatePropagation();
  enRed = false; carreraRed = null;
  multi.revancha();
  $('#bResOtra').textContent = 'Otra vez';
  sesion = new Sesion(circuito, { modo: 'practica', reglaje, ayudas: ayudasDe() }); crearModelos();
  mostrar('sala'); pintarSala();
}, true);

// acceso para pruebas automáticas desde la consola
window.apexDebug = { get sesion() { return sesion; }, get camara() { return camara; }, circuito: () => circuito, multi, get modelos() { return modelos; } };
actualizarCuentaMenu();
refrescarPerfil().then(actualizarCuentaMenu);

// --- Arranque -----------------------------------------------------------------------
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
iniciar().catch((err) => {
  console.error(err);
  $('#cargaTexto').textContent = 'No se pudo iniciar el juego: ' + (err?.message || err) + '. Tu navegador necesita WebGL.';
});
