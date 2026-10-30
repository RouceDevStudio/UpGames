// APEX GP: arranque, menús, bucle de juego, render y HUD.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Circuito, CIRCUITOS } from './track.js';
import { Sesion } from './race.js';
import { REGLAJE_DEF, COMPUESTOS, COCHE, EQUIPOS, MEJORAS_INFO, compuestoParaAgua } from './config.js';
import { CLIMAS } from './clima.js';
import * as CAMP from './campeonato.js';
import { Radio } from './radio.js';
import { Grabadora, crearProxy, CamarasTV } from './repeticion.js';
import { CamaraRepe, CAMARAS_REPE, NOMBRES_REPE } from './render/camaraRepe.js';
import { Cine, FILTROS, NOMBRES_FILTRO } from './render/cine.js';
import { GrabadorVideo, puedeGrabar, guardarArchivo } from './grabarVideo.js';
import { Telemetria } from './telemetria.js';
import { Lluvia } from './render/lluvia.js';
import { Barreras } from './render/barreras.js';
import { Comisarios, CapaCamara, CocheSeguridad, Fuegos } from './render/vida.js';
import { Persona } from './render/personas.js';
import { construirEscenario, ponerHora, ponerAgua } from './render/escenario.js';
import { crearModelo, dibujarPlantilla } from './render/cocheModelo.js';
import { GestorBoxes, Escombros } from './render/equipo.js';
import { NOMBRES_PATRON, NOMBRES_CASCO } from './render/librea.js';
import { cuenta, Multijugador, empaquetar, aplicarEstado, fantasmaAServidor, fantasmaDeServidor, API } from './red.js';
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
  calidad: 'auto', fps: false, volumen: 0.8, unidades: 'kmh', camara: 'persecucion', radio: true, ambiente: true, averias: true,
};
const OPC_CARRERA_DEF = { vueltas: 5, rivales: 7, dificultad: 'normal', posSalida: 0, compuesto: 'medio', clima: 'seco', hora: 'dia', formacion: 0 };
function cargar() {
  try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { return {}; }
}
const datos = cargar();
const ajustes = { ...AJ_DEF, ...(datos.ajustes || {}) };
// circuito elegido; el reglaje, los récords y el fantasma se guardan por circuito
let circuitoId = CIRCUITOS[datos.circuito] ? datos.circuito : 'valle';
const reglajes = datos.reglajes || { valle: datos.reglaje || {} };
const reglaje = { ...REGLAJE_DEF, ...(reglajes[circuitoId] || {}) };
const opcCarrera = { ...OPC_CARRERA_DEF, ...(datos.carrera || {}) };
const records = datos.records || {};
if (records.contrarreloj && !records['crono:valle']) records['crono:valle'] = records.contrarreloj;
const fantasmas = datos.fantasmas || (datos.fantasma ? { valle: datos.fantasma } : {});
let fantasmaGuardado = fantasmas[circuitoId] || null;
let fantasmaRival = null;          // récord descargado del ranking
// garaje: lo equipado y lo comprado (el servidor manda; aquí queda una copia para jugar sin conexión)
const EQUIPADO_DEF = { patron: 'flecha', acabado: 'brillo', casco: 'clasico', propia: false, colores: { base: '#0d47ff', acento: '#00e5ff', tercero: '#ffffff' }, cascoColores: { base: '#ffffff', acento: '#0d47ff' }, numero: 7 };
const equipado = { ...EQUIPADO_DEF, ...(datos.equipado || {}), colores: { ...EQUIPADO_DEF.colores, ...(datos.equipado?.colores || {}) }, cascoColores: { ...EQUIPADO_DEF.cascoColores, ...(datos.equipado?.cascoColores || {}) } };
let perfilApex = datos.perfil || { mejoras: {}, cosmeticos: [], upcoins: null };
const regionDef = (() => { const z = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; return /^Europe|^Africa/.test(z) ? 'europa' : /^Asia|^Australia|^Pacific/.test(z) ? 'asia' : 'america'; })();
const opcMulti = { tipo: '1v1', max: 22, vueltas: 3, circuito: 'valle', clima: 'seco', region: regionDef, ...(datos.multi || {}) };
const opcCamp = { vueltas: 5, rivales: 11, dificultad: 'normal', clima: 'auto', ...(datos.opcCamp || {}) };
let temporada = (() => { try { return JSON.parse(localStorage.getItem('apexgp.campeonato')) || null; } catch { return null; } })();
function guardar() {
  reglajes[circuitoId] = { ...reglaje };
  if (fantasmaGuardado) fantasmas[circuitoId] = fantasmaGuardado;
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ ajustes, reglajes, circuito: circuitoId, carrera: opcCarrera, records, fantasmas, equipado, perfil: perfilApex, multi: opcMulti, opcCamp }));
    localStorage.setItem('apexgp.campeonato', JSON.stringify(temporada));
  } catch { /* sin almacenamiento */ }
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
let gestorBoxes = null, escombros = null, lluviaFx = null, camarasTV = null, barreras = null, comisarios = null, cocheSeg = null;
let capaCamara = null;
const _vSol = new THREE.Vector3();
let grabadora = null, telemetria = null, repe = null;
let qActual = null, carreraCamp = null, fichaCrono = null;
const multi = new Multijugador();
let estadoRadio = {};
let tRadio = 0;
const radio = new Radio({
  sonido,
  alSubtitulo: (m, on) => {
    const el = $('#hRadio');
    if (on) { el.innerHTML = `<b>${m.tipo === 'megafonia' ? '📢 MEGAFONÍA' : '📻 JEFE DE MECÁNICOS'}</b>${m.texto}`; el.classList.add('visible'); clearTimeout(tRadio); }
    else tRadio = setTimeout(() => el.classList.remove('visible'), 1200);
  },
});
let enGaraje = false, enRed = false;
let jugando = false, pausado = false, modoActual = 'practica';
let pantallaPrevia = 'menu';

async function iniciar() {
  crearRenderer();
  await cargarImagenLibrea();
  await cargarCircuito(circuitoId);
  mostrar('menu');
  requestAnimationFrame(bucle);
}

// Construye (o reconstruye) el circuito y todo su escenario
let cargando = null;
async function cargarCircuito(id) {
  if (cargando) await cargando;
  if (circuito && circuito.id === id) return;
  let fin;
  cargando = new Promise(r => { fin = r; });
  const visible = document.querySelector('.pantalla.visible')?.id;
  ocultarTodo();
  $('#carga').classList.add('visible');
  progreso(0.05, 'Trazando el circuito…');
  await esperar(20);
  // guardar el reglaje del circuito anterior y cargar el de este
  if (circuito) reglajes[circuito.id] = { ...reglaje };
  circuitoId = id;
  Object.assign(reglaje, REGLAJE_DEF, reglajes[id] || {});
  fantasmaGuardado = fantasmas[id] || null; fantasmaRival = null;
  circuito = new Circuito(id);
  $('#largoPista').textContent = (circuito.largo / 1000).toFixed(3) + ' km';
  $('#nombrePista').textContent = circuito.nombre;
  progreso(0.3, 'Modelando el terreno, las gradas y los edificios…');
  await esperar(20);
  if (scene) liberarEscena();
  scene = new THREE.Scene();
  configurarPost();
  escenario = construirEscenario(scene, renderer, circuito, calidad);
  progreso(0.75, 'Montando los coches…');
  await esperar(20);
  efectos = new Efectos(scene, calidad);
  gestorBoxes = new GestorBoxes(scene, calidad, (tipo, pos) => {
    if (!jugando) return;
    const d = camara.cam.position.distanceTo(pos), vol = Math.min(1, 25 / Math.max(5, d));
    if (vol > 0.08) sonido.boxes?.(tipo, vol);
  });
  escombros = new Escombros(scene, (x, z) => { const p = circuito.proyectar(x, z, -1, {}); return p.y + circuito.caida(p.i, p.d); });
  lluviaFx = new Lluvia(scene, escenario, calidad);
  barreras = new Barreras(scene, circuito, { escombros, efectos, calidad });
  comisarios = new Comisarios(scene, circuito, calidad);
  cocheSeg = new CocheSeguridad(scene);
  fuegos = new Fuegos(scene, calidad);
  camarasTV = new CamarasTV(circuito);
  camara.tv = camarasTV;
  modelos = []; modeloFantasma = null;
  construirLineaIdeal();
  dibujarMinimapaBase();
  progreso(0.9, 'Compilando sombreadores…');
  // vista de cortesía detrás del menú
  sesion = new Sesion(circuito, { modo: 'practica', reglaje, ayudas: ayudasDe() });
  crearModelos();
  renderer.compile(scene, camara.cam);
  progreso(1, '¡Listo!');
  guardar();
  pintarCircuitos();
  actualizarRecordMenu();
  await esperar(120);
  $('#carga').classList.remove('visible');
  if (visible && visible !== 'carga') mostrar(visible);
  cargando = null; fin();
}

// gotas en la lente, destello del sol y viñeta de velocidad (capa 2D sobre el render)
function actualizarCapaCamara(dt, j) {
  capaCamara ??= new CapaCamara($('#capaCamara'));
  if (!jugando || ajustes.efectosCamara === false) { if (capaCamara.activa) capaCamara.actualizar(dt, {}); return; }
  _vSol.copy(escenario.sol).multiplyScalar(5000).add(camara.cam.position).project(camara.cam);
  const sol = _vSol.z < 1 && escenario.sol.y > 0 ? [(_vSol.x + 1) / 2 * innerWidth, (1 - _vSol.y) / 2 * innerHeight] : null;
  capaCamara.actualizar(dt, {
    lluvia: sesion.clima.lluvia, aBordo: ['cabina', 'cara', 'tcam'].includes(camara.modo),
    velocidad: j.velocidad, solPantalla: calidad >= 1 ? sol : null, hora: escenario.hora,
  });
}

function aplicarHora(hora) {
  if (!escenario || escenario.hora === hora) return;
  ponerHora(escenario, scene, renderer, hora);
  lluviaFx?.forzar();
}

function liberarEscena() {
  scene.traverse(o => {
    o.geometry?.dispose?.();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) { for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose?.(); }
  });
  scene.environment?.dispose?.();
}

function pintarCircuitos() {
  const el = $('#selCircuito');
  el.innerHTML = Object.values(CIRCUITOS).map(d => `<b data-v="${d.id}" class="${d.id === circuitoId ? 'sel' : ''}">${d.corto}<small>${d.tipo === 'urbano' ? 'urbano' : d.tipo === 'parque' ? 'rápido' : 'técnico'}</small></b>`).join('');
  el.querySelectorAll('b').forEach(b => b.onclick = () => { if (b.dataset.v !== circuitoId) cargarCircuito(b.dataset.v); });
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
  camara = new Camara(innerWidth / innerHeight);
  camara.modo = ajustes.camara;
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
    m.luzTrasera = () => escenario?.hora === 'noche' || (sesion?.clima?.lluvia || 0) > 0.05;
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

// En línea todos corren igual: sin control de tracción, ABS, dirección asistida, estabilidad
// ni trazada ideal (el cambio automático queda para todos, igual que en el resto de pilotos)
const AYUDAS_RED = { tc: 0, abs: false, cambioAuto: true, direccion: false, estabilidad: false };
function ayudasDe(red = enRed) {
  if (red) return { ...AYUDAS_RED };
  return { tc: +ajustes.tc, abs: ajustes.abs, cambioAuto: ajustes.cambioAuto, direccion: ajustes.direccion, estabilidad: ajustes.estabilidad };
}

// --- Sesiones -----------------------------------------------------------------
const nombreJugador = () => cuenta.usuario() ? '@' + cuenta.usuario() : 'Tú';
function opcBase(modo) {
  return { modo, reglaje: { ...reglaje }, ayudas: ayudasDe(), mejoras: perfilApex.mejoras, equipado: { ...equipado }, equipoJugador: equipado.equipo || 0, nombre: nombreJugador() };
}

function empezar(modo, extra = {}) {
  modoActual = modo;
  sonido.iniciar();
  sonido.ponerVolumen(ajustes.volumen);
  const opc = { ...opcBase(modo), ...extra, averias: ajustes.averias ? 1 : 0, formacion: opcCarrera.formacion === 1 };
  carreraCamp = extra.campeonato || null;
  if (modo === 'carrera' && !extra.pilotos) {
    // carrera rápida: con clasificación la parrilla la decide Q1-Q2-Q3
    if (+opcCarrera.posSalida === 0 && !extra.sinClasif) { empezarClasificacion({ rivales: opcCarrera.rivales, dificultad: opcCarrera.dificultad, clima: opcCarrera.clima, hora: opcCarrera.hora }); return; }
    Object.assign(opc, { vueltas: opcCarrera.vueltas, rivales: opcCarrera.rivales, dificultad: opcCarrera.dificultad, posSalida: opcCarrera.posSalida || 1, clima: opcCarrera.clima });
  }
  if (modo === 'carrera') {
    opc.vueltas ??= opcCarrera.vueltas;
    opc.reglaje.compuesto = extra.compuesto || opcCarrera.compuesto;
    // si llueve y el jugador eligió lisos, el ingeniero le pone intermedios o de lluvia
    if (opc.clima === 'lluvia' && !COMPUESTOS[opc.reglaje.compuesto].lluvia) opc.reglaje.compuesto = 'lluvia';
  }
  if (modo === 'contrarreloj') {
    const f = fantasmaRival || fantasmaGuardado;
    if (f?.puntos?.length) opc.fantasma = f;
    fichaCrono = null;
    if (cuenta.conectado()) cuenta.fichaCrono(circuito.id).then(d => { fichaCrono = d.ficha; }).catch(() => {});
  }
  if (modo === 'practica') opc.clima = extra.clima || opcCarrera.clima;
  sesion = new Sesion(circuito, opc);
  sesion.hora = extra.hora || opcCarrera.hora || 'dia';
  arrancarSesion(modo);
}

// Parte común de empezar una sesión local o en línea
function arrancarSesion(modo) {
  enGaraje = false;
  aplicarHora(sesion.hora || 'dia');
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
  if (modo === 'contrarreloj') { mensaje('VUELTA DE SALIDA', 'La vuelta cronometrada empieza en la línea de meta', 3); radio.decir('Vuelta de salida. Calienta los neumáticos; el crono empieza en la línea de meta.', { clave: 'salidaCr', cada: 5 }); }
  if (modo === 'practica') { mensaje('PRÁCTICA LIBRE', 'Sin límite de tiempo · prueba el reglaje', 3); radio.decir('Práctica libre. Sin prisa: prueba el reglaje y dime qué tal va el coche.', { clave: 'practica', cada: 5 }); }
  pantallaCompleta();
  if (ajustes.control === 'inclinacion' && esTactil) entrada.activarInclinacion().then(() => setTimeout(() => entrada.calibrar(), 400));
  pedirWakeLock();
  barreras?.reponer();
  // repetición, telemetría, radio y estado de la carrera
  grabadora = new Grabadora(sesion.participantes.length);
  posPrev = new Map();
  telemetria = new Telemetria(circuito.largo);
  if (sesion.estado === 'formacion') { mensaje('VUELTA DE FORMACIÓN', 'Sigue al de delante y vuelve a tu casilla', 3); radio.decir('Vuelta de formación. Calienta neumáticos y frenos, y vuelve a tu casilla.', { clave: 'form', cada: 5 }); }
  estadoRadio = { clima: sesion.clima.agua > 0.13 ? 'mojado' : 'seco', lluvia: sesion.clima.lluvia > 0.05, lider: null, avisoDesg: false, vsc: false, ultimaPos: null };
  radio.voz = !!ajustes.radio;
  sonido.ponerAmbiente(!!ajustes.ambiente);
  radio.callar();
  $('#hPen').classList.remove('visible');
  if (modo === 'carrera') {
    const p = sesion.jugador;
    if (ajustes.ambiente) radio.decir(`Bienvenidos al ${circuito.nombre}. ${sesion.participantes.length} pilotos en la parrilla${sesion.clima.lluvia > 0.05 ? ', con lluvia' : ''}.`, { tipo: 'megafonia' });
    radio.decir(`Sales ${p.posicion}º. ${sesion.clima.agua > 0.13 ? 'Pista mojada, cuidado en las frenadas.' : sesion.clima.modo === 'variable' ? 'El radar marca lluvia en la carrera, atento.' : 'Neumáticos a temperatura, vamos.'}`, { clave: 'salida', cada: 1 });
  } else if (modo === 'contrarreloj') radio.decir(fantasmaRival ? `Vas contra el récord de ${fantasmaRival.autor}: ${fmt(fantasmaRival.tiempo)}.` : 'Vuelta de salida. Calienta los neumáticos y empuja desde la meta.', { clave: 'crono', cada: 1 });
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
    $('#bPausaReglaje').style.display = modoActual === 'carrera' || enRed ? 'none' : '';
    $('#bReiniciar').style.display = enRed ? 'none' : '';
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
  aplicarHora('dia');
  qRed = null;
  qActual = null; carreraCamp = null; radio.callar();
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
  if (actual && actual.id !== id && !['reglaje', 'ajustes', 'ayuda', 'cuenta', 'telePantalla', 'carga'].includes(actual.id)) pantallaPrevia = actual.id;
  ocultarTodo();
  $('#' + id).classList.add('visible');
  if (id === 'reglaje') { pintarReglaje(); $('#reglajeCircuito').textContent = '· ' + circuito.def.corto; }
  if (id === 'ajustes') pintarAjustes();
  if (id === 'cuenta') pintarCuenta();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ir]');
  if (!b) return;
  sonido.iniciar();
  const destino = b.dataset.ir;
  if (destino === 'volver') { aplicarAjustesEnVivo(); mostrar(jugando ? 'pausa' : pantallaPrevia || 'menu'); return; }
  if (destino === 'contrarreloj' || destino === 'practica') { if (destino === 'contrarreloj') fantasmaRival = null; empezar(destino); return; }
  if (destino === 'garaje') { abrirGaraje(); return; }
  if (destino === 'multi') { abrirMulti(); return; }
  if (destino === 'campeonato') { abrirCampeonato(); return; }
  if (destino === 'rankings') { abrirRankings(); return; }
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
$('#bReiniciar').addEventListener('click', () => { if (qActual) salirAPistaQ(); else empezar(modoActual, carreraCamp ? { pilotos: sesion.participantes.map(p => ({ id: p.idPiloto, nombre: p.nombre, ie: p.indiceEquipo, ip: p.numeroPiloto, hab: p.ia?.habilidad ?? 1, jugador: p.jugador })), vueltas: sesion.vueltasTotales, clima: sesion.clima.modo, campeonato: carreraCamp } : {}); });
$('#bSalir').addEventListener('click', salirAlMenu);
$('#bProbarVoz').addEventListener('click', () => {
  sonido.iniciar(); radio.voz = true;
  $('#estadoVoz').textContent = radio.disponible ? (radio.nativa ? 'Voz del sistema Android' : 'Voz del navegador') : 'Este dispositivo no tiene voz: solo subtítulos';
  radio.decir('Radio comprobada. Te escucho alto y claro, ¿qué tal el coche?', { prioridad: true });
});
$('#bCalibrar').addEventListener('click', () => { entrada.calibrar(); mensaje('CENTRADO', '', 1); });
$('#bResMenu').addEventListener('click', salirAlMenu);
$('#bResOtra').addEventListener('click', () => { if (carreraCamp) { carreraCamp = null; volverMenuSinSesion(); abrirCampeonato(); } else empezar(modoActual === 'red' ? 'carrera' : modoActual); });
$('#bPausaRepe').addEventListener('click', () => abrirRepe('pausa'));
$('#bResRepe').addEventListener('click', () => abrirRepe('resultados'));
$('#bPausaTele').addEventListener('click', () => abrirTelemetria());
$('#bResTele').addEventListener('click', () => abrirTelemetria());

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
  const bD = $('#bDrs');
  bD.classList.toggle('activo', !c.drsAbierto && c.drsPermitido);
  bD.classList.toggle('abierto', c.drsAbierto);
  const bE = $('#bErs'), modoE = c.mandos.ersModo ?? 1;
  bE.classList.toggle('m0', modoE === 0); bE.classList.toggle('m2', modoE === 2);
  $('#bErsTxt').textContent = ['RECARGA', 'ERS', 'ATAQUE'][modoE];
  bE.querySelector('.carga').style.transform = `scaleX(${(c.ers / COCHE.ersCapacidad).toFixed(2)})`;
  // banderas
  const bandera = $('#hBandera');
  let bnd = '', btxt = '';
  if (sesion.vsc) { bnd = 'vsc'; btxt = 'VSC · COCHE DE SEGURIDAD VIRTUAL'; }
  else if (sesion.enAmarilla?.(c.proj.s)) { bnd = 'amarilla'; btxt = 'BANDERA AMARILLA'; }
  else if (estadoRadio.tVerde > 0) { bnd = 'verde'; btxt = 'PISTA LIBRE'; }
  else if (estadoRadio.tBN > 0) { bnd = 'blanconegra'; btxt = 'AVISO: LÍMITES DE PISTA'; }
  else if (sesion.modo === 'carrera' && azulPara(p)) { bnd = 'azul'; btxt = 'BANDERA AZUL · DEJA PASAR'; }
  bandera.className = 'bandera ' + bnd; bandera.textContent = btxt;
  const clima = sesion.clima, ch = $('#hClima');
  ch.classList.toggle('visible', clima.lluvia > 0.02 || clima.agua > 0.02);
  ch.textContent = `${clima.lluvia > 0.4 ? '🌧️' : clima.lluvia > 0.02 ? '🌦️' : '⛅'} pista ${clima.agua > 0.48 ? 'muy mojada' : clima.agua > 0.13 ? 'mojada' : clima.agua > 0.02 ? 'húmeda' : 'seca'} · ${Math.round(clima.agua * 100)}%`;
  const pen = $('#hPen'); pen.classList.toggle('visible', p.penalizacion > 0); pen.textContent = `+${p.penalizacion} s`;
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
  marcar(5, (c.dano.fondo || 0) > 0.1, (c.dano.fondo || 0) < 0.4);
  marcar(6, (c.dano.motor || 0) > 0.1, (c.dano.motor || 0) < 0.4);
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
      return `<div class="${q.jugador ? 'yo' : ''}"><span class="n">${q.posicion}</span><span class="c" style="background:${q.equipo.base}"></span><span>${q.equipo.corto}${q.penalizacion ? ' <b style="color:#ff3b3b">+' + q.penalizacion + '</b>' : ''}</span><span class="t">${gap}</span></div>`;
    }).join('');
  } else $('#hTabla').innerHTML = '';
  dibujarMinimapa();
}

// bandera azul: un coche con una vuelta más se acerca por detrás
function azulPara(p) {
  for (const o of sesion.participantes) {
    if (o === p || o.abandono || o.distancia - p.distancia < sesion.c.largo * 0.5) continue;
    let ds = p.coche.proj.s - o.coche.proj.s; if (ds < 0) ds += sesion.c.largo;
    if (ds < 80) return true;
  }
  return false;
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
// Momentos para el resumen de la repetición
function marcarMomento(e) {
  if (!grabadora || sesion.modo !== 'carrera') return;
  const t = sesion.tiempo, k = (p) => sesion.participantes.indexOf(p), nom = (p) => p.nombre.replace('@', '');
  if (e === 'salida') grabadora.marcar(t, 'salida', k(sesion.participantes.find(p => p.posicion === 1) || sesion.jugador), '¡Luces fuera!');
  else if (e.tipo === 'abandono') grabadora.marcar(t - 2, 'abandono', k(e.p), `Abandono de ${nom(e.p)}`);
  else if (e.tipo === 'vueltaRapida') grabadora.marcar(t - 3, 'vuelta', k(e.p), `Vuelta rápida de ${nom(e.p)}`);
  else if (e.tipo === 'meta' && e.p.posicion <= 3) grabadora.marcar(t, 'meta', k(e.p), `${nom(e.p)} termina P${e.p.posicion}`);
  else if (e.tipo === 'sc' && e.activo) grabadora.marcar(t, 'sc', k(sesion.orden?.[0] || sesion.jugador), 'Safety Car');
  else if (e.tipo === 'roja') grabadora.marcar(t - 3, 'roja', k(sesion.jugador), 'Bandera roja');
  else if (e.tipo === 'averia') grabadora.marcar(t, 'averia', k(e.p), `Avería de ${nom(e.p)}`);
}
// adelantamientos y golpes fuertes (se revisan dos veces por segundo)
let tMomentos = 0, posPrev = new Map();
function vigilarMomentos(dt) {
  if (!grabadora || sesion.modo !== 'carrera' || sesion.estado !== 'carrera') return;
  tMomentos += dt;
  if (tMomentos < 0.5) return;
  tMomentos = 0;
  sesion.participantes.forEach((p, k) => {
    if (p.coche.impacto > 10) grabadora.marcar(sesion.tiempo - 1.5, 'choque', k, `Golpe de ${p.nombre.replace('@', '')}`);
    const antes = posPrev.get(p);
    // gana una posición en pista (no por boxes ni abandonos) entre los diez primeros
    if (antes && p.posicion < antes && p.posicion <= 10 && !p.box && !p.coche.limitadorPit) {
      const pasado = sesion.participantes.find(o => o.posicion === p.posicion + 1);
      if (pasado && !pasado.box && !pasado.abandono && !pasado.coche.limitadorPit) grabadora.marcar(sesion.tiempo - 2.5, 'adelanta', k, `${p.nombre.replace('@', '')} adelanta a ${pasado.nombre.replace('@', '')}`);
    }
    posPrev.set(p, p.posicion);
  });
}

function procesarEventos() {
  for (const e of sesion.eventos) {
    marcarMomento(e);
    if (e === 'luz') { sonido.evento('luz'); }
    else if (e === 'salida') { sonido.evento('salida'); sonido.ovacion(1.6); mensaje('¡LUCES FUERA!', '', 1.2); entrada.vibrar(80); }
    else if (e.tipo === 'averia') {
      if (e.p.jugador) {
        if (e.averia === 'motor') { mensaje('¡MOTOR ROTO!', 'Humo y pérdida de potencia', 3); radio.decir('¡Perdemos el motor! Lleva el coche a un lugar seguro.', { prioridad: true }); entrada.vibrar(300, 1); }
        else if (e.averia === 'caja') { mensaje('CAJA DE CAMBIOS BLOQUEADA', 'Atascado en ' + e.p.coche.marcha + 'ª', 2.6); radio.decir(`Problema en la caja de cambios, estás atascado en ${e.p.coche.marcha}ª. Sigue como puedas.`, { prioridad: true }); }
        else if (e.averia === 'ers') { mensaje('ERS SOBRECALENTADO', 'Sin despliegue unos segundos', 2.2); radio.decir('El ERS se ha sobrecalentado. Sin batería unos veinte segundos.', { prioridad: true }); }
      } else if (e.averia === 'motor') radio.decir(`¡Humo en el coche de ${e.p.nombre.replace('@', '')}! Parece el motor.`, { tipo: 'megafonia', clave: 'av:' + e.p.nombre, cada: 999 });
    }
    else if (e.tipo === 'sc') {
      if (e.activo) { mensaje('SAFETY CAR', 'Agrúpate detrás del coche de seguridad · prohibido adelantar', 3); radio.decir('Safety car, safety car. Agrúpate detrás y no adelantes. Mantén calor en los neumáticos.', { clave: 'sc', cada: 5, prioridad: true }); radio.decir('Sale el coche de seguridad.', { tipo: 'megafonia', clave: 'scM', cada: 30 }); }
      else if (e.entra) { mensaje('SAFETY CAR EN BOXES ESTA VUELTA', 'Prepárate para la relanzada', 2.5); radio.decir('El safety car entra esta vuelta. Prepárate, el líder marca el ritmo.', { clave: 'scIn', cada: 5, prioridad: true }); }
      else { mensaje('PISTA LIBRE', 'Fin del Safety Car', 1.8); estadoRadio.tVerde = 4; radio.decir('Verde, verde, verde. ¡Vamos!', { clave: 'scFin', cada: 5, prioridad: true }); }
    }
    else if (e.tipo === 'roja') { mensaje('BANDERA ROJA', 'Carrera detenida · todos a la parrilla', 4); sonido.evento('golpe', 2); radio.decir('Bandera roja, bandera roja. Carrera detenida. Reduce y vuelve despacio, reparamos el coche en la parrilla.', { clave: 'roja', cada: 5, prioridad: true }); radio.decir('Bandera roja. La carrera queda detenida.', { tipo: 'megafonia', clave: 'rojaM', cada: 30 }); }
    else if (e.tipo === 'relanzada') { mensaje('SALIDA PARADA', 'Relanzada desde la parrilla', 2.5); radio.decir('Hemos reparado alerones y pinchazos. Salida parada, concéntrate en las luces.', { clave: 'relanzada', cada: 5, prioridad: true }); }
    else if (e.tipo === 'finFormacion') { mensaje('EN PARRILLA', 'Atento al semáforo', 1.5); radio.decir('Todos en la parrilla. Embrague listo, atento a las luces.', { clave: 'finForm', cada: 5 }); }
    else if (e.tipo === 'vsc') {
      if (e.activo) { mensaje('VSC', 'Coche de seguridad virtual · ritmo limitado y sin DRS', 2.5); radio.decir('VSC, VSC. Coche de seguridad virtual, levanta y respeta el delta.', { clave: 'vsc', cada: 5, prioridad: true }); radio.decir('Coche de seguridad virtual desplegado.', { tipo: 'megafonia', clave: 'vscM', cada: 30 }); }
      else { mensaje('PISTA LIBRE', 'Fin del VSC', 1.8); estadoRadio.tVerde = 4; radio.decir('Fin del VSC, fin del VSC. ¡A fondo!', { clave: 'vscFin', cada: 5, prioridad: true }); }
    }
    else if (e.tipo === 'amarilla') {
      let ds = e.s - sesion.jugador.coche.proj.s; if (ds < 0) ds += circuito.largo;
      if (ds < 700) radio.decir('Bandera amarilla más adelante, cuidado.', { clave: 'amarilla', cada: 15 });
    }
    else if (e.tipo === 'sancion') {
      if (e.p.jugador) { mensaje(`+${e.seg} s DE SANCIÓN`, e.motivo, 2.6); radio.decir(`Nos han puesto cinco segundos de sanción por ${e.motivo.toLowerCase()}. Llevamos ${e.total} en total.`, { prioridad: true }); }
    }
    else if (e.tipo === 'avisoLimites' && e.p.jugador) {
      if (e.bandera) { estadoRadio.tBN = 4; radio.decir('Bandera blanca y negra. Un aviso más por límites de pista y son cinco segundos.', { prioridad: true }); }
      else if (e.n >= 2) radio.decir(`Cuidado con los límites de pista, llevas ${e.n} avisos.`, { clave: 'limites', cada: 20 });
    }
    else if (e.tipo === 'vueltaRapida' && sesion.modo === 'carrera' && sesion.estado === 'carrera') {
      radio.decir(`Vuelta rápida para ${e.p.nombre.replace('@', '')}: ${fmt(e.p.mejor)}.`, { tipo: 'megafonia', clave: 'vr', cada: 40 });
      if (e.p.jugador) radio.decir('¡Vuelta rápida! Muy bien.', { clave: 'vrJ', cada: 30 });
    }
    else if (e.tipo === 'contacto' && e.jugador) { sonido.evento('contacto', e.fuerza); entrada.vibrar(60, 0.8); }
    else if (e.tipo === 'limites' && e.jugador) { mensaje('LÍMITES DE PISTA', 'Vuelta anulada', 1.8); radio.decir(['Te has pasado de los límites, vuelta anulada.', 'Cuatro ruedas fuera. Esa vuelta no cuenta.', 'Ojo con los límites de pista.'][Math.floor(Math.random() * 3)], { clave: 'limites', cada: 12 }); }
    else if (e.tipo === 'sector') {
      const el = $('#hS' + (e.k + 1)); el.className = e.color;
      if (e.color === 'morado') radio.decir(`Sector ${e.k + 1} morado. ¡Vas volando!`, { clave: 'morado', cada: 40 });
    }
    else if (e.tipo === 'vuelta' && e.p.jugador) {
      sonido.evento('vuelta');
      const txt = e.valida ? fmt(e.t) : fmt(e.t) + ' (anulada)';
      if (e.mejora) { mensaje(sesion.modo === 'carrera' ? 'MEJOR VUELTA PERSONAL' : 'NUEVO MEJOR TIEMPO', txt, 2.4); if (sesion.modo !== 'carrera') radio.decir(`${fmt(e.t)}. ¡Mejor vuelta! Sigue así.`, { clave: 'mejorV', cada: 8 }); }
      else mensaje('VUELTA', txt, 1.8);
      const clave = 'crono:' + circuito.id;
      if (sesion.modo === 'contrarreloj' && !qActual && e.valida && (!records[clave] || e.t < records[clave])) {
        records[clave] = e.t; guardar();
      }
      telemetria?.cerrarVuelta(e.t, e.valida);
      if (qRed && e.valida) multi.vueltaQ(e.t);
      if (qActual) finVueltaClasif(e);
      if (sesion.modo === 'carrera' && e.p.vuelta === sesion.vueltasTotales) { mensaje('ÚLTIMA VUELTA', '', 1.8); radio.decir('Última vuelta. ¡Tráelo a casa!', { clave: 'ultima', cada: 60 }); }
      else if (sesion.modo === 'carrera') {
        const g = sesion.diferencias(e.p);
        radio.decir(`P${e.p.posicion}, ${sesion.vueltasTotales - e.p.vuelta + 1} vueltas para el final.${g.del != null ? ` A ${g.del.toFixed(1)} del de delante.` : ' Lideras la carrera.'}${g.tras != null && g.tras < 1.5 ? ` El de detrás a ${g.tras.toFixed(1)}.` : ''}`, { clave: 'gap', cada: 20 });
        if (e.p.vuelta === Math.ceil(sesion.vueltasTotales / 2) + 1) radio.decir('Mitad de carrera. Buen ritmo, sigue así.', { clave: 'mitad', cada: 999 });
      } else if (!qActual && e.p.mejor && e.valida && !e.mejora) radio.decir(`${fmt(e.t)}, a ${(e.t - e.p.mejor).toFixed(2)} de tu mejor vuelta.`, { clave: 'vueltaPr', cada: 15 });
    }
    else if (e.tipo === 'nuevoFantasma') {
      if (sesion.modo === 'contrarreloj' && !qActual && (!fantasmaGuardado || e.fantasma.tiempo < fantasmaGuardado.tiempo)) { fantasmaGuardado = e.fantasma; guardar(); }
      if (sesion.modo === 'contrarreloj' && !qActual) subirTiempo(e.fantasma);
    }
    if (enRed && e.p?.bot && !e.p.remoto) { if (e.tipo === 'meta') multi.botMeta(e.p.idRed); if (e.tipo === 'abandono') multi.botAbandono(e.p.idRed); }
    if (e === 'luz' || e === 'salida') { /* ya tratado */ }
    else if (e.tipo === 'meta' && e.p.posicion === 1 && !estadoRadio.ganador) {
      estadoRadio.ganador = true; sonido.ovacion(2.5);
      radio.decir(`¡${e.p.nombre.replace('@', '')} gana en el ${circuito.def.corto}!`, { tipo: 'megafonia' });
      if (e.p.jugador) { mensaje('🏆 ¡VICTORIA!', '', 3); radio.decir('¡¡Ganamos!! ¡Increíble carrera, campeón!', { prioridad: true }); entrada.vibrar(300); if (enRed) multi.meta(); celebrar(e.p); }
      if (!enRed && e.p.jugador) setTimeout(() => { if (jugando && sesion.modo === 'carrera' && sesion.jugador.terminado) mostrarResultados(); }, 12000);
    }
    else if (e.tipo === 'meta' && e.p.jugador) {
      mensaje('🏁 BANDERA A CUADROS', `Terminas P${e.p.posicion}`, 3);
      radio.decir(e.p.posicion <= 3 ? `¡Bandera a cuadros! P${e.p.posicion}, ¡al podio! Gran trabajo.` : `Bandera a cuadros. Terminas P${e.p.posicion}. Buen esfuerzo, vuelve a boxes.`, { prioridad: true, clave: 'metaJ', cada: 30 });
      if (enRed) multi.meta();
      else setTimeout(() => { if (jugando && sesion.modo === 'carrera') mostrarResultados(); }, e.p.posicion <= 3 ? 10000 : 3500);
      if (e.p.posicion <= 3) celebrar(e.p);
    }
    else if (e.tipo === 'vuelta' && e.p.jugador && enRed && e.valida) multi.vuelta(e.t);
    else if (e.tipo === 'entraBoxes') prepararEquipo(e.p);
    if (e.tipo === 'entraBoxes' && e.p.jugador) { mensaje('ENTRANDO A BOXES', 'El equipo conduce: limitador a 80 km/h', 2); radio.decir('Box, box. Te llevamos al garaje, limitador puesto.', { prioridad: true, clave: 'boxEnt', cada: 10 }); }
    else if (e.tipo === 'paradaIni') {
      const k = sesion.participantes.indexOf(e.p);
      gestorBoxes.empezar(k, e.p.coche, modelos[k], { color: e.p.equipo.base, texto: e.p.equipo.corto === 'UPG' ? 'UPGAMES' : e.p.equipo.nombre.split(' ')[0].toUpperCase(), compuesto: e.p.paradaInfo?.compuesto, duracion: e.duracion, morro: e.morro });
      if (e.p.jugador) paradaJugador = { t0: performance.now(), duracion: e.duracion, k };
      if (e.p.jugador) radio.decir('Gatos arriba. Ruedas fuera…', { clave: 'gatos', cada: 10 });
      if (e.p.jugador) { mensaje('PARADA EN BOXES', e.morro ? 'Neumáticos y morro nuevo' : 'Cambio de neumáticos', 2); estadoRadio.avisoDesg = false; }
    }
    else if (e.tipo === 'paradaFin') {
      const k = sesion.participantes.indexOf(e.p);
      modelos[k].cambiarCompuesto(e.p.coche.reglaje.compuesto);
      if (e.p.jugador) radio.decir(e.duracion < 3 ? `¡Parada de ${e.duracion.toFixed(1)} segundos! Vamos, vamos, vamos.` : `Parada de ${e.duracion.toFixed(1)} segundos. Sal con cuidado, neumáticos fríos.`, { prioridad: true });
      if (e.p.jugador) { mensaje(`PARADA: ${e.duracion.toFixed(1)} s`, `Neumáticos ${COMPUESTOS[e.p.coche.reglaje.compuesto].nombre.toLowerCase()}`, 2.4); $('#bBox').classList.remove('activo'); }
    }
    else if (e.tipo === 'abandono') {
      if (!e.p.jugador && sesion.modo === 'carrera') radio.decir(`Abandono de ${e.p.nombre.replace('@', '')}.`, { tipo: 'megafonia', clave: 'ab:' + e.p.nombre, cada: 999 });
      if (e.p.jugador) {
        mensaje('ABANDONO', e.motivo || 'Coche demasiado dañado', 3.5);
        radio.decir('Se acabó, lo siento. Deja el coche en un lugar seguro.', { prioridad: true });
        if (enRed) { multi.abandono(); setTimeout(() => { if (jugando && enRed) mostrarFueraRed(e.motivo); }, 3500); }
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
    else if (e === 'aquaplaning') { mensaje('¡AQUAPLANING!', 'Charco: levanta el pie', 1.2); entrada.vibrar(160, 0.6); radio.decir('Cuidado con los charcos, hay mucha agua acumulada.', { clave: 'charco', cada: 90 }); }
    else if (e.startsWith('plano')) { const k = +e.slice(5); mensaje('PLANO EN EL NEUMÁTICO', k < 2 ? 'Rueda delantera' : 'Rueda trasera', 1.6); radio.decir('Has hecho un plano bloqueando. Notarás vibraciones; cuida las frenadas.', { clave: 'plano', cada: 60 }); }
  }
  c.eventos.length = 0;
  for (const p of sesion.participantes) if (!p.jugador) p.coche.eventos.length = 0;
}

// Radio del ingeniero: clima, neumáticos, daños y posiciones (se revisa una vez por segundo)
let tRadioRev = 0;
// El ingeniero analiza a los rivales: ritmo, diferencias, paradas, estrategia y lluvia
function radioRivales(p, pr) {
  const orden = sesion.orden, i = orden.indexOf(p), del = orden[i - 1], tras = orden[i + 1];
  const nom = (q) => q.nombre.replace('@', '');
  const ult = (q) => (q?.ultimaVuelta && q.ultimaVuelta.valida !== false ? q.ultimaVuelta.t : null);
  const g = sesion.diferencias(p) || {};
  const mia = ult(p);
  if (del && !del.box && g.del != null && ult(del) && mia) {
    const dif = ult(del) - mia;
    if (dif > 0.25 && g.del < 6) { const n = Math.max(1, Math.ceil(g.del / dif)); radio.decir(`${nom(del)} rueda ${dif.toFixed(1)} más lento. Lo alcanzas en ${n} vuelta${n > 1 ? 's' : ''}.`, { clave: 'alcanza', cada: 55 }); }
    else if (dif < -0.4 && g.del < 3) radio.decir(`${nom(del)} va más rápido ahora. Cuida los neumáticos y espera su error.`, { clave: 'masRapido', cada: 75 });
  }
  if (tras && !tras.box && g.tras != null && ult(tras) && mia) {
    const dif = mia - ult(tras);
    if (dif > 0.25 && g.tras < 3) radio.decir(`${nom(tras)} viene ${dif.toFixed(1)} por vuelta más rápido, a ${g.tras.toFixed(1)}. Defiende las frenadas.`, { clave: 'defiende', cada: 55 });
  }
  // paradas de los rivales que van justo delante o detrás
  estadoRadio.paradas ??= new Map();
  for (const q of [del, tras]) {
    if (!q) continue;
    const antes = estadoRadio.paradas.get(q) ?? q.paradas;
    if (q.paradas > antes) radio.decir(q === del ? `${nom(q)} ha parado. Aprieta ahora: si hacemos buenas vueltas saldremos por delante.` : `${nom(q)} ha entrado a boxes. Intentará el undercut: cuidado con su vuelta de salida.`, { clave: 'paradaRival', cada: 40 });
    estadoRadio.paradas.set(q, q.paradas);
  }
  // gestión: atacar o cuidar
  const desg = Math.max(...p.coche.ruedas.map(w => w.neum.desgaste)), faltan = sesion.vueltasTotales - p.vuelta;
  if (desg < 0.25 && g.del != null && g.del < 1.0 && !del?.box) radio.decir('Estás a menos de un segundo. Neumáticos frescos: ¡ataca!', { clave: 'ataca', cada: 70 });
  else if (desg > 0.4 && faltan > 5 && !p.paradas) radio.decir('Gestiona los neumáticos: suave en la salida de las curvas lentas.', { clave: 'gestiona', cada: 95 });
  if (faltan === 2 && g.del != null && g.del < 2.5) radio.decir(`Quedan dos vueltas y tienes a ${nom(del)} a ${g.del.toFixed(1)}. Todo o nada.`, { clave: 'final', cada: 200 });
  // lluvia en vueltas, no en segundos
  if (pr && pr.lluvia > 0 && pr.en > 0) {
    const n = Math.max(1, Math.round(pr.en / (isFinite(p.mejor) ? p.mejor : 90)));
    if (n <= 4) radio.decir(`Lluvia prevista en unas ${n} vuelta${n > 1 ? 's' : ''}. Tenemos los intermedios listos.`, { clave: 'lluviaVueltas', cada: 150 });
  }
}

function radioPeriodica(dt) {
  tRadioRev += dt;
  if (tRadioRev < 1) return;
  tRadioRev = 0;
  estadoRadio.tVerde = Math.max(0, (estadoRadio.tVerde || 0) - 1);
  estadoRadio.tBN = Math.max(0, (estadoRadio.tBN || 0) - 1);
  const p = sesion.jugador, c = p.coche, clima = sesion.clima;
  if (!p || p.terminado || c.abandono) return;
  const comp = c.reglaje.compuesto, deLluvia = COMPUESTOS[comp].lluvia;
  const pr = clima.pronostico();
  if (pr && pr.lluvia > 0 && pr.en < 70 && pr.en > 0) radio.decir(`El radar marca lluvia en un minuto más o menos.`, { clave: 'radarLluvia', cada: 999 });
  if (pr && pr.lluvia === 0 && pr.en < 60 && pr.en > 0 && clima.lluvia > 0.2) radio.decir('Va a parar de llover pronto. La pista se secará poco a poco.', { clave: 'radarSeco', cada: 999 });
  if (clima.lluvia > 0.1 && !estadoRadio.lluvia) { estadoRadio.lluvia = true; radio.decir('Empieza a llover. Cuidado en las frenadas.', { clave: 'llueve', cada: 60 }); }
  if (clima.lluvia < 0.02 && estadoRadio.lluvia) { estadoRadio.lluvia = false; radio.decir('Ha parado de llover.', { clave: 'parado', cada: 60 }); }
  if (sesion.modo === 'carrera' && !p.solicitudBox && !p.box) {
    const ideal = compuestoParaAgua(clima.agua);
    if (!deLluvia && clima.agua > 0.15) radio.decir(`La pista está mojada. Box, box: entra a por ${ideal === 'lluvia' ? 'neumáticos de lluvia' : 'intermedios'}. Pulsa BOX.`, { clave: 'aMojado', cada: 35, prioridad: true });
    else if (comp === 'inter' && clima.agua > 0.6) radio.decir('Hay mucha agua. Los de lluvia serían más rápidos ahora.', { clave: 'aLluvia', cada: 45 });
    else if (comp === 'lluvia' && clima.agua < 0.32 && clima.agua > 0.1) radio.decir('La pista mejora. Los intermedios ya son más rápidos.', { clave: 'aInter', cada: 45 });
    else if (deLluvia && clima.agua < 0.09) radio.decir('La trazada está seca. Box: es hora de los lisos.', { clave: 'aSeco', cada: 35, prioridad: true });
    const desg = Math.max(...c.ruedas.map(w => w.neum.desgaste));
    if (desg > 0.55 && !estadoRadio.avisoDesg) { estadoRadio.avisoDesg = true; radio.decir('Los neumáticos están muy gastados. Entra a boxes cuando quieras.'); }
    if (c.danoAleron > 0.3) radio.decir('Tienes el alerón delantero dañado. Entra a boxes a cambiar el morro.', { clave: 'morro', cada: 60 });
  }
  // neumáticos, frenos, batería y combustible
  const tN = c.ruedas.reduce((a, w) => a + w.neum.tSup, 0) / 4, tOpt = COMPUESTOS[comp].tOpt;
  if (c.velocidad > 30 && p.vuelta > 0) {
    if (tN < tOpt - 22) radio.decir('Los neumáticos están fríos. Caliéntalos: frena fuerte y acelera progresivo.', { clave: 'neumFrio', cada: 60 });
    else if (tN > tOpt + 22) radio.decir('Neumáticos sobrecalentados. Cuida las ruedas, menos derrapes.', { clave: 'neumCal', cada: 60 });
    const tF = Math.max(...c.ruedas.map(w => w.tFreno));
    if (tF > 1050) radio.decir('Frenos muy calientes. Levanta antes y frena más suave.', { clave: 'frenos', cada: 60 });
    const bat = c.ers / COCHE.ersCapacidad;
    if (bat < 0.12) radio.decir('Batería baja. Modo recarga un par de curvas.', { clave: 'batBaja', cada: 70 });
    else if (bat > 0.95 && (c.mandos.ersModo ?? 1) !== 2) radio.decir('Batería llena. Usa el modo ataque en la recta.', { clave: 'batLlena', cada: 90 });
    if (sesion.modo === 'carrera') {
      const faltan = sesion.vueltasTotales - p.vuelta + 1, necesita = faltan * 1.45;
      if (c.combustible < necesita * 0.97) radio.decir('Vamos justos de combustible. Levanta y deja correr antes de frenar.', { clave: 'gasolina', cada: 90 });
    }
  }
  if (c.drsPermitido && !c.drsAbierto && sesion.modo === 'carrera') radio.decir('DRS disponible. ¡Ábrelo!', { clave: 'drs', cada: 45 });
  if (sesion.modo === 'carrera' && sesion.vueltasTotales >= 8 && p.vuelta === Math.round(sesion.vueltasTotales * 0.4) && !p.paradas) radio.decir('La ventana de paradas está abierta. Avísanos cuando quieras entrar.', { clave: 'ventana', cada: 999 });
  if (sesion.modo === 'carrera' && sesion.orden && p.vuelta >= 2) radioRivales(p, pr);
  if (sesion.modo === 'carrera' && sesion.estado === 'carrera' && sesion.orden) {
    const g = sesion.diferencias(p);
    if (g.del != null && g.del < 1 && g.del > 0.2) radio.decir(`Estás a ${g.del.toFixed(1)} del de delante. ¡Ataca!`, { clave: 'ataca', cada: 40 });
    if (g.tras != null && g.tras < 0.7) radio.decir(`Te atacan, está a ${g.tras.toFixed(1)}. Defiende la posición.`, { clave: 'defiende', cada: 40 });
    if (azulPara(p)) radio.decir('Bandera azul. Deja pasar al coche que te dobla.', { clave: 'azul', cada: 30 });
    if (estadoRadio.ultimaPos != null && p.posicion < estadoRadio.ultimaPos) { sonido.ovacion(0.7); if (Math.random() < 0.5) radio.decir(`¡Buen adelantamiento! P${p.posicion}.`, { clave: 'adel', cada: 20 }); }
    estadoRadio.ultimaPos = p.posicion;
    const lider = sesion.orden[0];
    if (estadoRadio.lider && lider !== estadoRadio.lider && sesion.tiempo > 20) radio.decir(`¡Nuevo líder de la carrera: ${lider.nombre.replace('@', '')}!`, { tipo: 'megafonia', clave: 'lider', cada: 25 });
    estadoRadio.lider = lider;
  }
}

function mostrarResultados() {
  jugando = false;
  $('#hud').classList.remove('visible'); $('#tactil').classList.remove('visible');
  document.body.classList.remove('jugando');
  sonido.silenciar(true);
  radio.callar();
  sesion._posiciones?.();
  const orden = sesion.orden || sesion.participantes;
  const ganador = orden[0];
  const total = (p) => p.tTotal + (p.penalizacion || 0);
  $('#resTitulo').textContent = sesion.jugador.posicion === 1 && !sesion.jugador.abandono ? '🏆 ¡Victoria!' : `Resultado: P${sesion.jugador.posicion}`;
  $('#resLista').innerHTML = orden.map(p => {
    const dif = p.abandono ? 'Abandono' : p === ganador ? fmt(total(p)) : p.terminado ? '+' + (total(p) - total(ganador)).toFixed(3) : 'En pista';
    return `<div class="fila-res ${p.jugador ? 'yo' : ''}"><b>${p.posicion}</b><span><i class="eq" style="background:${p.equipo.base}"></i>${p.nombre} <small style="color:var(--tenue)">${p.equipo.nombre}${p.penalizacion ? ` · <b style="color:#ff3b3b">+${p.penalizacion} s</b>` : ''}</small></span><span>${dif}</span><span>${fmt(p.mejor)}</span></div>`;
  }).join('');
  $('#resPremio').textContent = '';
  $('#bResOtra').textContent = carreraCamp ? (temporada?.terminada ? 'Ver campeonato' : 'Siguiente GP') : 'Otra vez';
  if (carreraCamp) cerrarCarreraCampeonato(orden);
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
  // en la repetición el teclado y los toques los gestiona su propia interfaz
  if (repe) { if (!repe.exportando) actualizarRepe(dt); return; }
  const j = sesion.jugador.coche;
  if (jugando && espectando) { /* sin mandos: lo maneja su propia barra */ }
  else if (jugando) {
    for (const e of evs) {
      if (e === 'pausa') pausar(!pausado);
      else if (pausado) continue;
      else if (e === 'subir') j.cambiar(1);
      else if (e === 'bajar') j.cambiar(-1);
      else if (e === 'camara') { const m = camara.siguiente(); ajustes.camara = m; guardar(); mensaje(NOMBRES_CAMARA[m].toUpperCase(), '', 0.8); }
      else if (e === 'ers') { j.mandos.ersModo = ((j.mandos.ersModo ?? 1) + 1) % 3; mensaje(ERS_NOMBRES[j.mandos.ersModo], '', 0.8); }
      else if (e === 'recolocar' && enRed) mensaje('SIN REINICIOS EN LÍNEA', '', 1);
      else if (e === 'recolocar') {
        if (j.abandono && sesion.modo !== 'carrera') continue;
        if (j.velocidad < 8 || j.fueraPista) { j.recolocar(); sesion.jugador.valida = false; mensaje('DE VUELTA A LA PISTA', 'Vuelta anulada', 1.2); radio.decir('De vuelta en pista. Esa vuelta no cuenta, céntrate.', { clave: 'recol', cada: 20 }); }
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
    // donuts de celebración: gas a fondo, volante girado (antes de la física)
    if (celebracion?.donuts > 0) { j.mandos.acelerador = 1; j.mandos.freno = 0; j.mandos.direccion = 1; if (j.marcha > 2) j.marcha = 2; }
    j.mandos.drs = entrada.drs || (j.drsPermitido && esTactil && ajustes.cambioAuto && !entrada.usandoMando);
    camara.mirarAtras = entrada.mirarAtras;
  } else {
    // menú: el coche del jugador da vueltas solo como fondo (en el garaje se queda quieto)
    if (enGaraje) { /* parado frente a su garaje */ }
    else if (!sesion._piloto) import('./ai.js').then(({ PilotoIA }) => { if (sesion && !sesion._piloto) { sesion._piloto = new PilotoIA(sesion.jugador.coche, circuito, 0.9, 0.3); sesion.jugador.coche.esIA = true; } });
    if (!enGaraje) sesion._piloto?.conducir(dt, sesion.coches);
  }
  if (enRed && jugando && !qRed) actualizarRed(dt);
  if (qRed) actualizarQRed();
  else $('#hQRed').classList.remove('visible');
  if (!pausado && !enGaraje) {
    sesion.actualizar(dt);
    if (jugando) procesarEventos(); else { sesion.eventos.length = 0; for (const p of sesion.participantes) p.coche.eventos.length = 0; }
    if (jugando) {
      grabadora?.grabar(dt, sesion.coches, sesion.tiempo);
      vigilarMomentos(dt);
      const pj = sesion.jugador;
      if (pj.vuelta > 0) telemetria?.registrar(pj.coche.proj.s, pj.coche, pj.tVuelta);
      if (!espectando) radioPeriodica(dt);
    }
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
  lineaIdeal.visible = jugando && ajustes.trazada && !enRed;
  document.body.classList.toggle('en-red', enRed && jugando);
  // en la cámara de cabina el tablero está en el volante (se oculta el del HUD)
  document.body.classList.toggle('vista-cabina', jugando && (camara.modo === 'cabina' || camara.modo === 'cara'));
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
  if (jugando && espectando && camEsp) actualizarEspectador(dt, j, mJ);
  // durante la parada del jugador, plano de televisión del equipo trabajando (como en la tele)
  if (jugando && !espectando && paradaJugador && sesion.jugador.paradaInfo && ajustes.camParada !== false && !repe) {
    const tp = sesion.tiempo - sesion.jugador.paradaInfo.inicio, cs = Math.cos(j.psi), sn = Math.sin(j.psi);
    const lx = 6.2 - tp * 0.3, lz = -5.4 + tp * 0.3;        // un travelling lento por encima del equipo
    camara.cam.position.set(j.x + cs * lx - sn * lz, j.y + 3.4, j.z + sn * lx + cs * lz);
    camara.cam.up.set(0, 1, 0);
    camara.cam.lookAt(j.x + cs * 0.4, j.y + 0.5, j.z + sn * 0.4);
    camara.cam.fov = 48; camara.cam.updateProjectionMatrix();
    camara.iniciada = false;
  }
  const luz = escenario.luzSol;
  luz.target.position.set(j.x, j.y, j.z);
  luz.position.copy(escenario.sol).multiplyScalar(250).add(luz.target.position);
  if (!pausado) {
    efectos.actualizar(dt, sesion.coches, camara.cam.position);
    escombros.actualizar(dt);
    for (const e of barreras.actualizar(dt, sesion.participantes)) {
      if (e.tipo === 'bidon' && jugando) { sonido.evento('golpe', 4); if (e.jugador) { mensaje('¡BIDONES DE AGUA!', '', 1.2); entrada.vibrar(120, 0.8); radio.decir('¡Te has llevado los bidones! Revisa que el alerón esté bien.', { clave: 'bidon', cada: 30 }); } }
    }
    gestorBoxes.actualizar(dt, camara.cam.position);
    actualizarMarcadorParada();
    comisarios.actualizar(dt, sesion);
    cocheSeg.actualizar(dt, sesion.sc);
    fuegos?.actualizar(dt);
    actualizarCelebracion(dt);
  }
  actualizarCapaCamara(dt, j);
  escenario.camPos = camara.cam.position;
  for (const f of escenario.actualizables) f(dt);
  // lluvia, spray y asfalto mojado
  efectos.agua = sesion.clima.agua;
  ponerAgua(escenario, sesion.clima.agua);
  lluviaFx.actualizar(dt, camara.cam.position, sesion.clima.lluvia, sesion.clima.agua, renderer);
  nivelDetalle();
  if (efectos._escala !== camara.cam.fov) { efectos.ajustarEscala(innerHeight * renderer.getPixelRatio(), camara.cam.fov); efectos._escala = camara.cam.fov; }

  // sonido
  if (jugando && !pausado) {
    // los tres rivales más cercanos suenan situados en 3D
    const rivales = [];
    for (const p of sesion.participantes) {
      if (p.jugador || p.retirado) continue;
      const d = Math.hypot(p.coche.x - j.x, p.coche.z - j.z);
      if (d < 220) rivales.push({ c: p.coche, d });
    }
    rivales.sort((a, b) => a.d - b.d);
    const sj = j.proj.s, ij = j.proj.i;
    // eco: entre muros cercanos (urbano) y, sobre todo, dentro del túnel
    circuito._tunel ??= circuito._sDeSegmento?.('Túnel') || false;
    const enTunel = circuito._tunel && sj > circuito._tunel.s0 && sj < circuito._tunel.s1;
    sonido.actualizar(dt, j, rivales.slice(0, 3).map(r => r.c), camara.cam, {
      lluvia: sesion.clima.lluvia, agua: sesion.clima.agua, grada: sj < 600 || sj > circuito.largo - 300 ? 1 : 0,
      reflejo: enTunel ? 1 : Math.max(0, Math.min(0.6, 1 - (circuito.muro[0][ij] + circuito.muro[1][ij]) / 30)),
      aBordo: ['cabina', 'cara', 'tcam'].includes(camara.modo),
    });
    // vibración en bordillos
    if (j.enBordillo && j.velocidad > 15 && Math.random() < dt * 12) entrada.vibrar(12, 0.3);
    actualizarHud(dt);
  }
  if (tMensaje > 0) { tMensaje -= dt; if (tMensaje <= 0) $('#hMensaje').classList.remove('visible'); }

  // render
  if (composer) composer.render(); else renderer.render(scene, camara.cam);
  if (fotoPendiente) guardarFoto();

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

// --- Celebraciones: fuegos, el equipo saltando en el muro y donuts --------------------
function celebrar(p) {
  if (celebracion) return;
  const c = circuito, m = c.muestra(0);
  // fuegos sobre la recta de meta
  fuegos?.lanzar(new THREE.Vector3(m.x, m.y + 30, m.z), p.posicion === 1 ? 12 : 7, (pos) => {
    const d = camara.cam.position.distanceTo(pos), vol = Math.min(1, 60 / Math.max(20, d));
    setTimeout(() => sonido.boxes?.('gato', vol * 1.4), d / 343 * 1000);    // el estampido llega con retraso
  });
  // su equipo, saltando en el muro de boxes frente a su garaje
  const gente = [];
  if (calidad >= 1) {
    const sg = sesion._garajeDe(p), mg = c.muestra(sg), i = mg.i, d = c.semiAncho[i] + c.pit.muroA + 0.7;
    for (let k = 0; k < (calidad >= 2 ? 8 : 5); k++) {
      const per = new Persona({ color: p.equipo.base, texto: p.equipo.corto === 'UPG' ? 'UPGAMES' : p.equipo.nombre.split(' ')[0].toUpperCase(), numero: 70 + k, rol: k % 3 === 2 ? 'ingeniero' : 'mecanico', calidad });
      const s = sg - 6 + k * 1.6, mk = c.muestra(s);
      per.raiz.position.set(mk.x - mk.tz * d, mk.y, mk.z + mk.tx * d);
      per.raiz.rotation.y = -Math.atan2(mk.tz, mk.tx) + Math.PI / 2;          // de cara a la pista
      per.poner('celebra', 0.3); per.salto = 0.6 + Math.random() * 0.4; per.t = Math.random() * 3;
      scene.add(per.raiz); gente.push(per);
    }
  }
  celebracion = { t: 0, gente, donuts: 0 };
  if (p.jugador && !enRed) $('#bDonuts').classList.add('visible');
}
function actualizarCelebracion(dt) {
  if (!celebracion) return;
  const ce = celebracion;
  ce.t += dt;
  for (const g of ce.gente) g.actualizar(dt);
  // donuts automáticos: gas a fondo, volante girado y sin control de tracción
  const j = sesion.jugador.coche;
  if (ce.donuts > 0) {
    ce.donuts -= dt;
    if (ce.donuts <= 0) { j.ayudas = ce.ayudas || j.ayudas; $('#bDonuts').classList.remove('activo'); }
  }
  if (ce.t > 16 || !jugando) {
    for (const g of ce.gente) scene.remove(g.raiz);
    $('#bDonuts').classList.remove('visible');
    celebracion = null;
  }
}
$('#bDonuts').addEventListener('click', () => {
  if (!celebracion || celebracion.donuts > 0) return;
  const j = sesion.jugador.coche;
  celebracion.ayudas = j.ayudas;
  j.ayudas = { ...j.ayudas, tc: 0, estabilidad: false };
  celebracion.donuts = 5;
  $('#bDonuts').classList.add('activo');
  sonido.ovacion(1.5);
});

// --- Espectador / juez -------------------------------------------------------------
const CAMS_ESPECT = ['tv', 'persecucion', 'cercana', 'helicoptero', 'dron', 'lateral', 'suelo', 'cabina', 'tcam', 'morro', 'orbita'];
function iniciarEspectador() {
  document.body.classList.add('espectando');
  camEsp = new CamaraRepe(circuito, camarasTV, camara);
  esp.cam = 'tv'; esp.auto = true; esp.tCambio = 0;
  $('#espAuto').classList.add('on');
  pintarEspectador();
  mensaje('MODO ESPECTADOR', 'Toca un piloto de la lista para seguirlo', 2.5);
}
function focoEsp(p) {
  if (!p || p === sesion.jugador) return;
  sesion.jugador = p; camara.iniciada = false; camEsp?.poner(esp.cam, camara.cam);
  pintarEspectador();
}
function pintarEspectador() {
  const p = sesion.jugador;
  $('#espCoche').textContent = `P${p.posicion} ${p.nombre.replace('@', '')}`;
  $('#espCam').textContent = '🎥 ' + (NOMBRES_REPE[esp.cam] || esp.cam);
}
function actualizarEspectador(dt, j, mJ) {
  // realización automática: cada ~12 s busca la batalla más apretada y cambia de plano
  esp.tCambio += dt;
  if (esp.auto && esp.tCambio > 12) {
    esp.tCambio = 0;
    const orden = (sesion.orden || sesion.participantes).filter(p => !p.abandono && !p.terminado);
    let mejor = orden[0], gap = Infinity;
    for (let k = 1; k < orden.length; k++) { const g = orden[k - 1].distancia - orden[k].distancia; if (g < gap && g > 0) { gap = g; mejor = orden[k]; } }
    if (Math.random() < 0.25) mejor = orden[0];                // a veces, el líder
    esp.cam = ['tv', 'persecucion', 'helicoptero', 'lateral', 'dron', 'cabina', 'suelo', 'tv', 'tcam'][Math.floor(Math.random() * 9)];
    if (mejor && mejor !== sesion.jugador) focoEsp(mejor); else { camEsp.poner(esp.cam, camara.cam); pintarEspectador(); }
  }
  camEsp.actualizar(camara.cam, j, mJ, esp.cam, dt);
  // torre de posiciones (4 veces por segundo)
  esp.tTorre -= dt;
  if (esp.tTorre > 0) return;
  esp.tTorre = 0.25;
  const orden = sesion.orden || sesion.participantes, lider = orden[0];
  $('#espTorre').innerHTML = orden.map((p, k) => {
    const g = k === 0 ? `V${Math.max(1, Math.min(p.vuelta, sesion.vueltasTotales))}/${sesion.vueltasTotales}` : p.abandono ? 'FUERA' : p.terminado ? 'META' : '+' + ((lider.distancia - p.distancia) / Math.max(25, p.coche.velocidad || 25)).toFixed(1);
    return `<div data-i="${sesion.participantes.indexOf(p)}" class="${p === sesion.jugador ? 'foco' : ''} ${p.abandono ? 'fuera' : ''}"><b>${k + 1}</b><i style="background:${p.equipo?.base || '#888'}"></i><span>${p.nombre.replace('@', '').replace(/</g, '')}</span><span class="g">${g}</span></div>`;
  }).join('');
  $('#espInfo').textContent = `${salaActual?.nombre || ''} · 👁 ${salaActual?.espectadores || 1}`;
  if (esp.tTorre === 0.25 && $('#espCoche').textContent.split(' ')[0] !== 'P' + sesion.jugador.posicion) pintarEspectador();
}
function salirEspectador() {
  document.body.classList.remove('espectando');
  camEsp = null;
  multi.dejarEspectar();
  espectando = false;
  salirAlMenu();
  abrirMulti();
}
$('#espTorre').addEventListener('click', (e) => { const d = e.target.closest('[data-i]'); if (d) { esp.auto = false; $('#espAuto').classList.remove('on'); focoEsp(sesion.participantes[+d.dataset.i]); } });
const pasoCocheEsp = (paso) => {
  const orden = sesion.orden || sesion.participantes, i = orden.indexOf(sesion.jugador);
  esp.auto = false; $('#espAuto').classList.remove('on');
  focoEsp(orden[(i + paso + orden.length) % orden.length]);
};
$('#espPrev').addEventListener('click', () => pasoCocheEsp(-1));
$('#espSig').addEventListener('click', () => pasoCocheEsp(1));
$('#espCoche').addEventListener('click', () => pasoCocheEsp(1));
$('#espCam').addEventListener('click', () => { esp.cam = CAMS_ESPECT[(CAMS_ESPECT.indexOf(esp.cam) + 1) % CAMS_ESPECT.length]; esp.auto = false; $('#espAuto').classList.remove('on'); camEsp?.poner(esp.cam, camara.cam); pintarEspectador(); });
$('#espAuto').addEventListener('click', () => { esp.auto = !esp.auto; esp.tCambio = 99; $('#espAuto').classList.toggle('on', esp.auto); });
$('#espSalir').addEventListener('click', salirEspectador);
addEventListener('keydown', (e) => {
  if (!espectando || !jugando || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'c') $('#espCam').click();
  else if (k === 'v' || k === 'arrowright') pasoCocheEsp(1);
  else if (k === 'arrowleft') pasoCocheEsp(-1);
  else if (k === 'a') $('#espAuto').click();
});

// --- Equipo de boxes -------------------------------------------------------------
let paradaJugador = null;
// en cuanto el coche entra al carril, su equipo sale del garaje a esperarlo
function prepararEquipo(p) {
  const k = sesion.participantes.indexOf(p);
  if (!p.box || k < 0) return;
  const c = circuito, sB = p.box.sBox, d = c.dCarrilPit(sB) + 2.2, m = c.muestra(sB);
  gestorBoxes.preparar(k, {
    color: p.equipo.base, texto: p.equipo.corto === 'UPG' ? 'UPGAMES' : p.equipo.nombre.split(' ')[0].toUpperCase(), compuesto: p.solicitudBox,
    posicion: { x: m.x - m.tz * d, y: m.y, z: m.z + m.tx * d, psi: Math.atan2(m.tz, m.tx) },
  });
}
// marcador de la parada del jugador: cronómetro y estado de las cuatro ruedas
function actualizarMarcadorParada() {
  const el = $('#hParada');
  if (!paradaJugador || !sesion.jugador.paradaInfo) {
    if (paradaJugador && performance.now() - paradaJugador.t0 > (paradaJugador.duracion + 2.5) * 1000) paradaJugador = null;
    el.classList.toggle('visible', !!paradaJugador);
    return;
  }
  el.classList.add('visible');
  const t = Math.max(0, Math.min(paradaJugador.duracion, sesion.tiempo - sesion.jugador.paradaInfo.inicio));
  $('#hParadaT').textContent = t.toFixed(1) + ' s';
  const pr = gestorBoxes.progreso(paradaJugador.k) || [0, 0, 0, 0];
  el.querySelectorAll('.rp').forEach((r, i) => { r.className = 'rp ' + (pr[i] >= 1 ? 'ok' : pr[i] > 0 ? 'en' : ''); });
}

// --- Daños y boxes ----------------------------------------------------------------
const NOMBRE_RUEDA = ['delantera izquierda', 'delantera derecha', 'trasera izquierda', 'trasera derecha'];
function avisoDano(e) {
  const [tipo, det] = e.split(':');
  entrada.vibrar(140, 1);
  if (tipo === 'rueda') { mensaje('¡RUEDA ARRANCADA!', NOMBRE_RUEDA[+det], 3); radio.decir(`¡Hemos perdido la rueda ${NOMBRE_RUEDA[+det]}! Para el coche en un sitio seguro.`, { prioridad: true, clave: 'ruedaA', cada: 10 }); return; }
  if (det === 'aleronDel') { mensaje('ALERÓN DELANTERO ROTO', 'Entra a boxes a cambiar el morro', 2.5); radio.decir('Alerón delantero roto. Box esta vuelta, tenemos el morro preparado.', { prioridad: true, clave: 'alaD', cada: 30 }); }
  else if (det === 'aleronDelTocado') { mensaje('ALERÓN DELANTERO TOCADO', 'Menos carga delante', 1.8); radio.decir('Vemos daño en el alerón delantero. Tendrás algo de subviraje.', { clave: 'alaDT', cada: 40 }); }
  else if (det === 'aleronTras') { mensaje('ALERÓN TRASERO DAÑADO', 'El coche pierde estabilidad', 2.2); radio.decir('Alerón trasero dañado. Cuidado en las frenadas, la trasera estará nerviosa.', { clave: 'alaT', cada: 40 }); }
  else if (det === 'fondo') { mensaje('FONDO DAÑADO', 'Menos carga aerodinámica', 2.2); radio.decir('Has roto el fondo. El coche tiene menos carga, frena antes.', { clave: 'fondo', cada: 60 }); }
  else if (det === 'motor') { mensaje('MOTOR TOCADO', 'Pierdes potencia', 2.2); radio.decir('El golpe ha tocado la caja de cambios y el motor. Perdemos potencia.', { clave: 'motorD', cada: 60 }); }
  else if (det.startsWith('pinchazo')) { mensaje('¡PINCHAZO!', `Rueda ${NOMBRE_RUEDA[+det.slice(8)]} · entra a boxes`, 2.8); radio.decir(`¡Pinchazo en la ${NOMBRE_RUEDA[+det.slice(8)]}! Box, box. Tráelo despacio.`, { prioridad: true, clave: 'pinch', cada: 15 }); }
  else if (det.startsWith('susp')) { mensaje('SUSPENSIÓN DAÑADA', `Rueda ${NOMBRE_RUEDA[+det.slice(4)]} · el coche tira hacia un lado`, 2.4); radio.decir('La suspensión está tocada, el coche tirará hacia un lado. Compensa con el volante.', { clave: 'susp', cada: 40 }); }
}

function alternarPanelBox() {
  const p = sesion.jugador;
  if (p.box) { mensaje('YA ESTÁS EN BOXES', '', 1); return; }
  if (p.solicitudBox) { sesion.cancelarBox(p); mensaje('BOXES CANCELADO', '', 1); radio.decir('Entendido, nos quedamos fuera. Cancelamos la parada.', { clave: 'boxNo', cada: 5 }); $('#panelBox').classList.remove('visible'); return; }
  $('#panelBox').classList.toggle('visible');
}
document.querySelectorAll('#panelBox [data-box]').forEach(b => b.addEventListener('click', () => {
  const v = b.dataset.box;
  $('#panelBox').classList.remove('visible');
  if (v === 'cancelar') { sesion.cancelarBox(sesion.jugador); return; }
  sesion.pedirBox(sesion.jugador, v);
  mensaje('BOX, BOX', `Entra al final de esta vuelta · neumáticos ${COMPUESTOS[v].nombre.toLowerCase()}`, 2.4);
  radio.decir(`Recibido. Box esta vuelta, preparamos ${COMPUESTOS[v].nombre.toLowerCase()}s.`, { clave: 'boxSi', cada: 5 });
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
    perfilApex = { mejoras: d.mejoras || {}, cosmeticos: d.cosmeticos || [], upcoins: d.upcoins, elo: d.elo, nivel: d.nivel };
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
  $('#mElo').textContent = perfilApex.elo ? `Tu ELO: ${perfilApex.elo} (${perfilApex.nivel})` : cuenta.conectado() ? '' : 'Inicia sesión para tener ELO y ranking';
}
let buscando = false;
$('#bBuscar').addEventListener('click', async () => {
  if (buscando) { multi.cancelarBusqueda(); buscando = false; $('#bBuscar').textContent = '⚡ Buscar partida'; $('#mEstado').textContent = 'Búsqueda cancelada'; return; }
  try { await multi.conectar(); } catch (e) { $('#mEstado').textContent = e.message; return; }
  const r = await multi.buscar({ ...datosJugador(), region: opcMulti.region });
  if (!r?.ok) { $('#mEstado').textContent = r?.error || 'No se pudo buscar'; return; }
  buscando = true;
  $('#bBuscar').textContent = '✕ Cancelar búsqueda';
  $('#mEstado').innerHTML = `Buscando rivales de tu nivel (ELO ${r.elo} · ${r.nivel})… en cola: ${r.enCola}. Se empareja en unos segundos.`;
});
multi.on('emparejado', (d) => {
  buscando = false; $('#bBuscar').textContent = '⚡ Buscar partida';
  salaActual = d.sala;
  mostrar('sala'); pintarSala();
  $('#salaInfo').innerHTML = `¡Rivales encontrados! ${d.sala.jugadores.length} pilotos · ${CIRCUITOS[d.sala.circuito]?.corto || ''} · la salida es en unos segundos…`;
});
let ultimoElo = null;
const textoElo = (d) => { const dif = d.despues - d.antes; return `ELO ${d.antes} → ${d.despues} (${dif >= 0 ? '+' : ''}${dif}) · ${d.nivel}`; };
multi.on('elo', (d) => {
  perfilApex.elo = d.despues; perfilApex.nivel = d.nivel; guardar();
  ultimoElo = d;
  if ($('#resultados').classList.contains('visible')) $('#resPremio').textContent = textoElo(d);
});
multi.on('lista', (l) => {
  $('#listaSalas').innerHTML = l.length ? '<h3>Salas abiertas y carreras en directo</h3>' + l.map(x => {
    const enVivo = x.estado && x.estado !== 'espera';
    return `<div class="sala-pub" data-codigo="${x.codigo}" data-vivo="${enVivo ? 1 : ''}"><span>${enVivo ? '<b style="color:var(--rojo)">● EN DIRECTO</b> · ' : ''}<b>${x.nombre.replace(/</g, '')}</b>${x.juez ? ' · 🏆 torneo con juez' : ''} · ${x.tipo === '1v1' ? 'Duelo' : 'Abierta'} · ${CIRCUITOS[x.circuito]?.corto || 'Valle Andino'} · ${x.vueltas} vueltas${x.clima && x.clima !== 'seco' ? ' · ' + CLIMAS[x.clima] : ''}${x.mejoras ? ' · con mejoras' : ''}${x.espectadores ? ` · 👁 ${x.espectadores}` : ''}</span><span>${x.jugadores}/${x.max} <button class="btn mini ver" data-ver="${x.codigo}">👁 Ver</button></span></div>`;
  }).join('') : '<p class="nota">No hay salas abiertas ahora mismo. ¡Crea una y comparte el código!</p>';
  document.querySelectorAll('.sala-pub').forEach(el => el.onclick = (e) => {
    if (e.target.closest('[data-ver]') || el.dataset.vivo) espectarSala(el.dataset.codigo); else unirse(el.dataset.codigo);
  });
});
multi.on('aviso', (t) => { if ($('#sala').classList.contains('visible')) $('#salaInfo').textContent = t; else $('#mEstado').textContent = t; });
const datosJugador = () => ({ nombre: cuenta.usuario() || 'Invitado', equipado: { ...equipado }, livery: libreaParaRed() });
$('#bCrearSala').addEventListener('click', async () => {
  const juez = $('#mpJuez').checked;
  const r = await multi.crear({ ...datosJugador(), opciones: { tipo: opcMulti.tipo, max: opcMulti.max, vueltas: opcMulti.vueltas, publica: $('#mpPublica').checked, mejoras: $('#mpMejoras').checked, circuito: opcMulti.circuito, clima: opcMulti.clima, juez } });
  if (!r.ok) { $('#mEstado').textContent = r.error; return; }
  espectando = juez;
  entrarSala(r.sala);
});
$('#bUnirse').addEventListener('click', () => unirse($('#mpCodigo').value));
$('#bVerSala').addEventListener('click', () => espectarSala($('#mpCodigo').value));
// entrar a una sala sin correr: se ve la carrera en directo con todas las cámaras
async function espectarSala(codigo) {
  try { await multi.conectar(); } catch (e) { $('#mEstado').textContent = e.message; return; }
  const r = await multi.espectar(String(codigo || '').toUpperCase().trim());
  if (!r.ok) { $('#mEstado').textContent = r.error; return; }
  espectando = true;
  entrarSala(r.sala);
}
async function unirse(codigo) {
  espectando = false;
  const r = await multi.unirse({ ...datosJugador(), codigo: String(codigo || '').toUpperCase().trim() });
  if (!r.ok) { $('#mEstado').textContent = r.error; return; }
  entrarSala(r.sala);
}
$('#bSalirMulti').addEventListener('click', () => { multi.desconectar(); mostrar('menu'); });
function entrarSala(sala) { salaActual = sala; mostrar('sala'); pintarSala(); }
multi.on('sala', (sala) => { salaActual = sala; if ($('#sala').classList.contains('visible')) pintarSala(); tomarBots(); });
multi.on('livery', (d) => {
  const im = new Image(); im.onload = () => { imagenesRed.set(d.id, im); if (enRed && jugando) crearModelos(); }; im.src = d.livery;
});
function pintarSala() {
  const s = salaActual; if (!s) return;
  const yo = multi.yo, soyHost = s.host === yo;
  $('#salaTitulo').textContent = `${s.nombre} · ${s.codigo}`;
  $('#salaInfo').innerHTML = `${s.rapida ? 'Partida rápida' : s.tipo === '1v1' ? 'Duelo 1 vs 1' : `Sala abierta · hasta ${s.max} pilotos`} · <b>${CIRCUITOS[s.circuito]?.nombre || ''}</b> · ${CLIMAS[s.clima] || 'Seco'} · ${s.vueltas} vueltas · ${s.mejoras ? 'con mejoras de UpCoins' : 'coches iguales'}${s.publica ? ' · pública' : ' · privada'}<br>Comparte el código <b style="color:#ffd23f;font-size:16px">${s.codigo}</b> para que se unan.`;
  // el circuito de la sala se prepara mientras se espera
  if (s.circuito && s.circuito !== circuito.id && !cargando && s.estado === 'espera') cargarCircuito(s.circuito);
  $('#salaPilotos').innerHTML = s.jugadores.map((j, k) => `<div class="sala-fila"><b>${k + 1}</b><span><i class="eq" style="display:inline-block;width:4px;height:16px;border-radius:2px;margin-right:8px;vertical-align:middle;background:${j.equipado?.colores?.base || '#888'}"></i>${j.nombre.replace(/</g, '')}${j.id === yo ? ' (tú)' : ''}</span><span class="host">${j.id === s.host ? 'ANFITRIÓN' : ''}</span><span class="listo">${j.listo || j.id === s.host ? 'LISTO' : ''}</span></div>`).join('');
  $('#bSalaEmpezar').classList.toggle('oculto', !soyHost);
  $('#bSalaListo').classList.toggle('oculto', soyHost || espectando);
  if (espectando) $('#salaInfo').innerHTML += `<br>👁 <b>${s.juez === yo ? 'Eres el juez: das la salida y lo ves todo en directo' : 'Modo espectador'}</b> · ${s.espectadores || 1} mirando${s.estado === 'clasif' ? ' · <b>clasificación en curso</b>' : ''}`;
  const yoJ = s.jugadores.find(j => j.id === yo);
  $('#bSalaListo').textContent = yoJ?.listo ? 'No estoy listo' : 'Estoy listo';
}
$('#bSalaListo').addEventListener('click', () => { const j = salaActual?.jugadores.find(x => x.id === multi.yo); multi.listo(!j?.listo); });
$('#bSalaEmpezar').addEventListener('click', async () => { const r = await multi.iniciar(); if (!r?.ok) $('#salaInfo').textContent = r?.error || 'No se pudo empezar'; });
$('#bSalaSalir').addEventListener('click', () => { if (espectando) multi.dejarEspectar(); multi.salir(); espectando = false; salaActual = null; abrirMulti(); });
$('#bSalaCompartir').addEventListener('click', async () => {
  const t = `¡Corre contra mí en APEX GP! Código de sala: ${salaActual?.codigo} · https://upgames.games/games/monoplaza/`;
  try { if (navigator.share) await navigator.share({ title: 'APEX GP', text: t }); else { await navigator.clipboard.writeText(t); $('#salaInfo').textContent = 'Código copiado'; } } catch { /* cancelado */ }
});

// el servidor da la salida: todos arrancan la carrera a la vez con el mismo semáforo
multi.on('salida', async (d) => {
  const s = salaActual;
  if (s.circuito && s.circuito !== circuito?.id) await cargarCircuito(s.circuito);
  modoActual = 'red'; enRed = true;
  carreraCamp = null; qActual = null; ultimoElo = null;
  sonido.iniciar(); sonido.ponerVolumen(ajustes.volumen);
  const rc = { ...reglaje };
  if (s.clima === 'lluvia' && !COMPUESTOS[rc.compuesto]?.lluvia) rc.compuesto = 'lluvia';
  sesion = new Sesion(circuito, {
    modo: 'carrera', vueltas: s.vueltas, reglaje: rc, ayudas: ayudasDe(), clima: s.clima, semilla: s.semilla,
    multijugador: { parrilla: d.parrilla, yo: espectando ? null : multi.yo, jugadores: s.jugadores.map(j => j.id === multi.yo ? { ...j, mejoras: perfilApex.mejoras } : j), mejoras: s.mejoras,
      bots: s.bots || [], soyHost: !espectando && s.host === multi.yo, espectador: espectando },
  });
  qRed = null;
  sesion.tSalidaLocal = d.tSalidaLocal;
  carreraRed = { resultados: null };
  arrancarSesion('carrera');
  if (espectando) iniciarEspectador();
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
    const j = salaActual?.jugadores.find(x => x.id === p.idRed) || salaActual?.bots?.find(x => x.id === p.idRed);
    if (j) { p.terminado = j.terminado; p.abandono = j.abandono; if (j.terminado) sesion.banderaFinal = true; }
  }
  if (espectando) return;
  // mi coche, ~15 veces por segundo (y los bots si soy el anfitrión)
  // (los bots van en otro fotograma: dos paquetes volátiles seguidos hacen que se pierda el segundo)
  tEnvio += dt; tEnvioBots += dt;
  const bots = sesion.participantes.filter(p => p.bot && !p.remoto);
  const tocaBots = bots.length && tEnvioBots >= 1 / 10 && (ultimoEnvio === 'estado' || tEnvio < 1 / 15);
  if (tocaBots) { tEnvioBots = 0; ultimoEnvio = 'bots'; multi.enviarBots(bots.map(p => [p.idRed, empaquetar(p.coche, p)])); }
  else if (tEnvio >= 1 / 15) { tEnvio = 0; ultimoEnvio = 'estado'; multi.enviarEstado(empaquetar(sesion.jugador.coche, sesion.jugador)); }
}
let ultimoEnvio = 'estado';
let tEnvioBots = 0;

// Si el anfitrión se va, el nuevo anfitrión pasa a simular a los bots desde donde estaban
function tomarBots() {
  if (!enRed || !sesion?.mp || salaActual?.host !== multi.yo) return;
  import('./ai.js').then(({ PilotoIA }) => {
    for (const p of sesion.participantes) {
      if (!p.bot || !p.remoto) continue;
      p.remoto = false;
      p.coche.esIA = true;
      p.ia = new PilotoIA(p.coche, circuito, p.hab || 0.97, 0.4);
      p.coche.colocar(p.coche.proj.s, p.coche.proj.d);
      p.coche.vx = Math.max(10, p.coche.vx || 0); for (const w of p.coche.ruedas) w.omega = p.coche.vx / w.radio;
    }
  });
}

// ─── Clasificación en línea (partida rápida): cada piloto marca vueltas solo en pista ───
let qRed = null;
multi.on('clasif', async (d) => {
  if (espectando) { pintarSala(); return; }
  const s = salaActual;
  if (s?.circuito && s.circuito !== circuito?.id) await cargarCircuito(s.circuito);
  enRed = true; modoActual = 'red'; carreraCamp = null; qActual = null;
  qRed = { tFin: d.tFinLocal, tabla: [], terminada: false };
  sonido.iniciar(); sonido.ponerVolumen(ajustes.volumen);
  const opc = opcBase('contrarreloj');
  opc.ayudas = ayudasDe(true);
  opc.clima = s?.clima === 'lluvia' ? 'lluvia' : 'seco';
  if (opc.clima === 'lluvia') opc.reglaje.compuesto = 'lluvia';
  sesion = new Sesion(circuito, opc);
  arrancarSesion('contrarreloj');
  mensaje('CLASIFICACIÓN', `${Math.round(d.seg / 60)} minutos · marca tu mejor vuelta`, 3);
  radio.decir(`Clasificación: ${Math.round(d.seg / 60)} minutos. Busca una vuelta limpia.`, { clave: 'qRed', cada: 10 });
  radio.decir(`Clasificación de ${Math.round(d.seg / 60)} minutos. Tu mejor vuelta decide la parrilla de la carrera.`, { prioridad: true });
});
multi.on('tablaQ', (t) => {
  if (qRed) qRed.tabla = t;
  // el espectador ve la tabla de la clasificación en la pantalla de la sala
  if (espectando && $('#sala').classList.contains('visible')) $('#salaPilotos').innerHTML = '<h3>Clasificación</h3>' + t.map((x, k) => `<div class="sala-fila"><b>${k + 1}</b><span>${nombreQ(x)}</span><span>${x.t ? fmt(x.t) : 'sin tiempo'}</span></div>`).join('');
});
function nombreQ(x) {
  if (x.bot != null) { const ie = x.bot % EQUIPOS.length, ip = Math.floor(x.bot / EQUIPOS.length) % 2; return EQUIPOS[ie].pilotos[ip]; }
  return String(x.nombre || '').replace(/</g, '');
}
function actualizarQRed() {
  if (!qRed) return;
  const falta = Math.max(0, (qRed.tFin - Date.now()) / 1000);
  const pos = qRed.tabla.findIndex(x => x.id === multi.yo) + 1;
  const el = $('#hQRed');
  el.classList.add('visible');
  el.textContent = `CLASIFICACIÓN ${Math.floor(falta / 60)}:${String(Math.floor(falta % 60)).padStart(2, '0')}${pos ? ` · P${pos}/${qRed.tabla.length}` : ''}`;
  if (falta <= 0 && !qRed.terminada && jugando) {
    qRed.terminada = true;
    jugando = false;
    $('#hud').classList.remove('visible'); $('#tactil').classList.remove('visible');
    document.body.classList.remove('jugando');
    sonido.silenciar(true);
    $('#qTitulo').textContent = 'Clasificación terminada';
    $('#qInfo').textContent = 'Formando la parrilla… la salida es en unos segundos.';
    $('#qLista').innerHTML = qRed.tabla.map((x, i) => `<div class="fila-q ${x.id === multi.yo ? 'yo' : ''}"><b>${i + 1}</b><span>${nombreQ(x)}${x.bot != null ? ' <small style="color:var(--tenue)">IA</small>' : ''}</span><span>${fmt(x.t)}</span><span></span></div>`).join('');
    $('#bQSeguir').classList.add('oculto'); $('#bQSaltar').classList.add('oculto');
    mostrar('clasif');
  }
}

// En línea no hay coche nuevo: quien destroza el coche queda fuera y pierde la carrera
function mostrarFueraRed(motivo) {
  jugando = false;
  $('#hud').classList.remove('visible'); $('#tactil').classList.remove('visible');
  document.body.classList.remove('jugando');
  sonido.silenciar(true); radio.callar();
  $('#resTitulo').textContent = '💥 Fuera de carrera';
  $('#resLista').innerHTML = `<p class="nota" style="text-align:left">${motivo || 'Coche demasiado dañado'}. En línea no se puede reiniciar: la carrera ha terminado para ti y cuentas como último (abandono).</p>`;
  $('#resPremio').textContent = cuenta.conectado() ? 'El ELO se actualiza al terminar la carrera de los demás.' : '';
  $('#bResOtra').textContent = 'Volver a la sala';
  mostrar('resultados');
}

function mostrarResultadosRed(r) {
  jugando = false;
  $('#hud').classList.remove('visible'); $('#tactil').classList.remove('visible');
  document.body.classList.remove('jugando');
  sonido.silenciar(true);
  const yo = r.find(x => x.id === multi.yo);
  $('#resTitulo').textContent = espectando ? '🏁 Resultados de la carrera' : yo?.pos === 1 && !yo.abandono ? '🏆 ¡Victoria en línea!' : `Resultado: P${yo?.pos ?? '-'}`;
  document.body.classList.remove('espectando');
  const ganador = r[0];
  $('#resPremio').textContent = ultimoElo ? textoElo(ultimoElo) : cuenta.conectado() ? 'Calculando ELO…' : '';
  $('#resLista').innerHTML = r.map(x => `<div class="fila-res ${x.id === multi.yo ? 'yo' : ''}"><b>${x.pos}</b><span>${nombreQ(x)}${x.bot != null ? ' <small style="color:var(--tenue)">IA</small>' : ''}</span><span>${x.abandono ? 'Abandono' : x === ganador ? fmt(x.tiempo) : '+' + (x.tiempo - ganador.tiempo).toFixed(3)}</span><span>${fmt(x.mejor)}</span></div>`).join('');
  mostrar('resultados');
  $('#bResOtra').textContent = 'Volver a la sala';
}
$('#bResOtra').addEventListener('click', (e) => {
  if (!enRed) return;
  e.stopImmediatePropagation();
  enRed = false; carreraRed = null; camEsp = null;
  if (!espectando || salaActual?.host === multi.yo) multi.revancha();
  $('#bResOtra').textContent = 'Otra vez';
  sesion = new Sesion(circuito, { modo: 'practica', reglaje, ayudas: ayudasDe() }); crearModelos();
  mostrar('sala'); pintarSala();
}, true);


// --- Nivel de detalle y sombras --------------------------------------------------------
// Los coches lejanos pierden piezas pequeñas (piloto, retrovisores, tornillería) y solo
// los cercanos proyectan sombra.
const vLod = new THREE.Vector3();
function prepararLod(m) {
  m._detalle = []; m._mallas = [];
  m.raiz.traverse(o => {
    if (!o.isMesh) return;
    m._mallas.push(o);
    o.geometry.computeBoundingSphere?.();
    if ((o.geometry.boundingSphere?.radius ?? 1) < 0.16) m._detalle.push(o);
  });
  m._lejos = false; m._sombra = true;
}
function nivelDetalle() {
  const cp = camara.cam.position;
  for (const m of modelos) {
    if (!m._mallas) prepararLod(m);
    const d = vLod.copy(m.raiz.position).sub(cp).length();
    const lejos = d > 85, sombra = d < 55 && calidad >= 1;
    if (lejos !== m._lejos) { m._lejos = lejos; for (const o of m._detalle) o.visible = !lejos; }
    if (sombra !== m._sombra) { m._sombra = sombra; for (const o of m._mallas) o.castShadow = sombra; }
  }
}

// --- Repetición y modo foto ------------------------------------------------------------
let fotoPendiente = false;
let camRepe = null, cine = null, grabVideo = null;
let espectando = false, camEsp = null;
let fuegos = null, celebracion = null;
const esp = { cam: 'tv', auto: true, tCambio: 0, tTorre: 0 };
const VELS_REPE = [0.1, 0.25, 0.5, 1, 2, 4];
function abrirRepe(desde) {
  if (!grabadora || grabadora.cuantos < 10) { mensaje('SIN REPETICIÓN', 'Aún no hay nada grabado', 1.5); return; }
  const yo = sesion.participantes.indexOf(sesion.jugador);
  capaCamara?.actualizar(0, {});
  repe = { desde, u: Math.max(0, 1 - 40 / grabadora.duracion), play: true, vel: 1, cam: 'director', coche: yo, proxies: sesion.participantes.map(p => crearProxy(p.coche)), camPrev: camara.modo, tQuieto: 0, sonido: true };
  instalarControlesRepe();
  camRepe = new CamaraRepe(circuito, camarasTV, camara);
  camRepe.poner('director', camara.cam);
  for (const m of modelos) { m.alDesprender = null; m.reponerPiezas?.(); }
  ocultarTodo();
  $('#hud').classList.remove('visible'); $('#tactil').classList.remove('visible');
  $('#repe').classList.add('visible');
  $('#repe').classList.remove('oculta', 'limpia');
  document.body.classList.add('en-repe');
  radio.callar();
  sonido.modoRepe?.(true);
  repe.claves = repe.claves || []; repe.resumen = null; repe.ruta = false;
  pintarPanelCam(); pintarCine(); pintarRepe(); pintarMarcas();
  $('#repeAyuda').innerHTML = esTactil ? '' : 'Espacio: pausa · ←/→: ±5 s · ,/. : fotograma · C: cámara · V: coche<br>Cámara libre: arrastra para mirar, WASD/QE para moverte (Mayús rápido), rueda para avanzar<br>H: ocultar controles · P: foto · R: grabar vídeo';
  despertarRepe();
}
function pintarRepe() {
  if (!repe) return;
  $('#repePlay').textContent = repe.play ? '⏸' : '▶';
  $('#repeVel').textContent = repe.vel + '×';
  const plano = repe.cam === 'director' && camRepe?.planoActual ? ` (${NOMBRES_REPE[camRepe.planoActual] || ''})` : '';
  $('#repeCam').textContent = NOMBRES_REPE[repe.cam] + plano;
  $('#repeCoche').textContent = sesion.participantes[repe.coche].nombre.replace('@', '');
  document.querySelectorAll('#repePanelCam button').forEach(b => b.classList.toggle('on', b.dataset.cam === repe.cam));
}
function pintarPanelCam() {
  const el = $('#repePanelCam');
  el.innerHTML = CAMARAS_REPE.map(c => `<button class="chip" data-cam="${c}">${NOMBRES_REPE[c]}</button>`).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => ponerCamRepe(b.dataset.cam));
}
function pintarCine() {
  cine ??= new Cine(renderer);
  const o = cine.opc;
  $('#cineFiltros').innerHTML = FILTROS.map(f => `<button class="chip ${o.filtro === f ? 'on' : ''}" data-f="${f}">${NOMBRES_FILTRO[f]}</button>`).join('');
  $('#cineFiltros').querySelectorAll('button').forEach(b => b.onclick = () => { o.filtro = b.dataset.f; pintarCine(); });
  $('#cineBarras').classList.toggle('on', o.barras);
  $('#cineSacudida').classList.toggle('on', !!camRepe?.sacudida);
  $('#cineSonido').classList.toggle('on', !!repe?.sonido);
  $('#cineApertura').value = o.apertura * 100; $('#cineGrano').value = o.grano * 500; $('#cineVineta').value = o.vineta * 100;
  $('#cineZoom').value = camRepe?.fovExtra || 0; $('#cineAlabeo').value = Math.round((camRepe?.alabeo || 0) * 180 / Math.PI);
}
function ponerCamRepe(c) {
  repe.cam = c;
  camRepe.poner(c, camara.cam);
  pintarRepe();
}
// los controles se apagan solos a los 3 s sin tocar nada
function despertarRepe() {
  if (!repe) return;
  repe.tQuieto = 0;
  $('#repe').classList.remove('oculta');
}
function cineActivo() {
  const o = cine?.opc;
  return o && (o.apertura > 0 || o.filtro !== 'natural' || o.barras || o.grano > 0 || o.vineta > 0 || o.movimiento > 0);
}
function actualizarRepe(dt) {
  const r = repe, g = grabadora;
  r.tQuieto += dt;
  const panelAbierto = document.querySelector('.repe-panel.visible');
  if (r.tQuieto > 3 && !panelAbierto && !$('#repe').classList.contains('oculta')) $('#repe').classList.add('oculta');
  if (r.play && !fotoPendiente) {
    r.u += dt * r.vel / Math.max(1, g.duracion);
    if (r.u >= 1) { r.u = 1; r.play = false; pintarRepe(); }
  }
  if (r.resumen && r.u >= r.resumen.fin) siguienteMomento();
  if (r.ruta && r.u >= r.claves[r.claves.length - 1].u) finRuta();
  g.leer(r.u, r.proxies);
  $('#repeBarra').value = Math.round(r.u * 1000);
  $('#repeT').textContent = fmt(g.tiempoEn(r.u));
  const dtR = r.play ? dt * r.vel : 0;
  sesion.participantes.forEach((p, k) => {
    const c = r.proxies[k], m = modelos[k];
    if (!m) return;
    m.raiz.position.set(c.x, c.y, c.z);
    m.raiz.rotation.set(0, -c.psi, 0);
    m.actualizar(c, dtR);
  });
  const c = r.proxies[r.coche], m = modelos[r.coche];
  const planoAntes = camRepe.planoActual;
  camRepe.actualizar(camara.cam, c, m, r.cam, dt);
  if (r.ruta) camaraRuta(r.u);
  if (camRepe.planoActual !== planoAntes) pintarRepe();
  for (const f of escenario.actualizables) f(dt);
  efectos.actualizar(dtR, [], camara.cam.position);
  lluviaFx.actualizar(dt, camara.cam.position, sesion.clima.lluvia, sesion.clima.agua, renderer);
  escenario.luzSol.target.position.set(c.x, c.y, c.z);
  escenario.luzSol.position.copy(escenario.sol).multiplyScalar(250).add(escenario.luzSol.target.position);
  nivelDetalle();
  if (r.sonido) sonido.actualizarRepe?.(dt, r.proxies, r.coche, camara.cam, r.play ? r.vel : 0, ['cabina', 'cara', 'tcam', 'morro', 'rueda', 'trasera'].includes(camRepe.planoActual));
  else sonido.actualizarRepe?.(dt, [], 0, camara.cam, 0, false);
  if (cineActivo()) cine.render(scene, camara.cam, camara.cam.position.distanceTo(m.raiz.position), dt);
  else if (composer) composer.render(); else renderer.render(scene, camara.cam);
  if (fotoPendiente) guardarFoto();
  if (grabVideo?.grabando) $('#repeGrab').textContent = '● ' + fmt(grabVideo.segundos).replace(/\.\d+$/, '');
}
function cerrarRepe() {
  if (grabVideo?.grabando) alternarGrabacion();
  const desde = repe.desde;
  camara.modo = repe.camPrev; camara.iniciada = false;
  camara.cam.up.set(0, 1, 0);
  repe = null; camRepe = null;
  $('#repe').classList.remove('visible');
  document.querySelectorAll('.repe-panel').forEach(p => p.classList.remove('visible'));
  document.body.classList.remove('foto', 'en-repe');
  sonido.modoRepe?.(false);
  crearModelos();
  if (desde === 'resultados') mostrar('resultados');
  else { mostrar('pausa'); $('#hud').classList.add('visible'); if (esTactil) $('#tactil').classList.add('visible'); }
}
// ─── Resumen automático: los momentos apuntados durante la carrera ───
function pintarMarcas() {
  const g = grabadora, el = $('#repeMarcas');
  const ms = g.marcas.map(m => ({ ...m, u: g.uDeTiempo(m.t) })).filter(m => m.u > 0.001 && m.u < 0.999);
  el.innerHTML = ms.map((m, i) => `<i class="${m.tipo}" style="left:${(m.u * 100).toFixed(2)}%" data-i="${i}" title="${m.texto.replace(/"/g, '')}"></i>`).join('')
    + (repe.claves || []).map(k => `<i class="clave" style="left:${(k.u * 100).toFixed(2)}%"></i>`).join('');
  el.querySelectorAll('i[data-i]').forEach(x => x.onclick = (e) => {
    e.stopPropagation();
    const m = ms[+x.dataset.i];
    repe.u = Math.max(0, g.uDeTiempo(m.t - 2)); repe.coche = m.coche; repe.play = true;
    camRepe.poner(repe.cam, camara.cam); for (const md of modelos) md.reponerPiezas?.();
    rotulo(m.texto); pintarRepe();
  });
}
function rotulo(texto) {
  const el = $('#repeRotulo'); el.textContent = texto; el.classList.add('visible');
  clearTimeout(rotulo.t); rotulo.t = setTimeout(() => el.classList.remove('visible'), 4000);
}
function iniciarResumen() {
  const g = grabadora;
  const lista = g.marcas.filter(m => g.uDeTiempo(m.t) > 0.001).sort((a, b) => a.t - b.t);
  if (!lista.length) { mensajeRepe('Aún no hay momentos destacados'); return; }
  repe.resumen = { lista, i: -1, fin: 0 }; repe.vel = 1; repe.play = true; repe.ruta = false;
  siguienteMomento();
}
function siguienteMomento() {
  const R = repe.resumen; R.i++;
  if (R.i >= R.lista.length) { repe.resumen = null; repe.play = false; $('#repeRotulo').classList.remove('visible'); mensajeRepe('Fin del resumen'); pintarRepe(); return; }
  const m = R.lista[R.i], g = grabadora;
  repe.u = Math.max(0, g.uDeTiempo(m.t - 2.5)); R.fin = g.uDeTiempo(m.t + 4.5);
  repe.coche = m.coche;
  const cams = ['tv', 'lateral', 'persecucion', 'helicoptero', 'suelo', 'dron', 'tv', 'cercana'];
  ponerCamRepe(m.tipo === 'salida' ? 'helicoptero' : m.tipo === 'choque' ? 'tv' : cams[R.i % cams.length]);
  for (const md of modelos) md.reponerPiezas?.();
  rotulo(`${R.i + 1}/${R.lista.length} · ${m.texto}`);
}

// ─── Editor de tráiler: puntos de cámara y recorrido suave entre ellos ───
function pintarClaves() {
  $('#claveLista').innerHTML = repe.claves.map((k, i) => `<span data-i="${i}" title="Ir a este punto (doble toque: borrar)">📍 ${i + 1} · ${fmt(grabadora.tiempoEn(k.u))}</span>`).join('') || '<span style="opacity:.6">Sin puntos todavía</span>';
  $('#claveLista').querySelectorAll('[data-i]').forEach(x => {
    x.onclick = () => { const k = repe.claves[+x.dataset.i]; repe.u = k.u; repe.play = false; repe.ruta = false; ponerCamRepe('libre'); camRepe.libre.pos.copy(k.pos); camara.cam.quaternion.copy(k.q); const d = new THREE.Vector3(0, 0, -1).applyQuaternion(k.q); camRepe.libre.yaw = Math.atan2(d.z, d.x); camRepe.libre.pitch = Math.asin(d.y); pintarRepe(); };
    x.ondblclick = () => { repe.claves.splice(+x.dataset.i, 1); pintarClaves(); pintarMarcas(); };
  });
}
function anadirClave() {
  const c = camara.cam;
  repe.claves = repe.claves.filter(k => Math.abs(k.u - repe.u) > 1e-4);
  repe.claves.push({ u: repe.u, pos: c.position.clone(), q: c.quaternion.clone(), fov: c.fov });
  repe.claves.sort((a, b) => a.u - b.u);
  pintarClaves(); pintarMarcas();
  mensajeRepe(`Punto ${repe.claves.length} añadido`);
}
const _cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
function camaraRuta(u) {
  const K = repe.claves;
  if (K.length < 2) return;
  let i = 0; while (i < K.length - 2 && u >= K[i + 1].u) i++;
  const a = K[i], b = K[i + 1], p0 = K[i - 1] || a, p3 = K[i + 2] || b;
  let t = THREE.MathUtils.clamp((u - a.u) / Math.max(1e-6, b.u - a.u), 0, 1);
  const cam = camara.cam;
  cam.position.set(_cr(p0.pos.x, a.pos.x, b.pos.x, p3.pos.x, t), _cr(p0.pos.y, a.pos.y, b.pos.y, p3.pos.y, t), _cr(p0.pos.z, a.pos.z, b.pos.z, p3.pos.z, t));
  const ts = t * t * (3 - 2 * t);
  cam.quaternion.slerpQuaternions(a.q, b.q, ts);
  cam.fov = a.fov + (b.fov - a.fov) * ts; cam.updateProjectionMatrix();
}
function verRuta(grabar = false) {
  if (repe.claves.length < 2) { mensajeRepe('Añade al menos 2 puntos de cámara'); return; }
  repe.u = repe.claves[0].u; repe.play = true; repe.vel = repe.vel > 1 ? 1 : repe.vel; repe.ruta = true; repe.resumen = null;
  repe.grabarRuta = grabar;
  for (const md of modelos) md.reponerPiezas?.();
  document.querySelectorAll('.repe-panel').forEach(p => p.classList.remove('visible'));
  if (grabar && !grabVideo?.grabando) alternarGrabacion();
}
function finRuta() {
  repe.ruta = false; repe.play = false;
  if (repe.grabarRuta && grabVideo?.grabando) alternarGrabacion();
  repe.grabarRuta = false; pintarRepe();
}

// ─── Exportar a 1080p y 60 fps fotograma a fotograma (no depende de los FPS del móvil) ───
async function exportarVideo() {
  if (!window.VideoEncoder || !window.VideoFrame) { mensajeRepe('Este navegador no permite exportar: usa ⏺ Grabar'); return; }
  const K = repe.claves, g = grabadora;
  const conRuta = K.length >= 2;
  const u0 = conRuta ? K[0].u : repe.u, u1 = conRuta ? K[K.length - 1].u : Math.min(1, repe.u + 15 / Math.max(1, g.duracion));
  const W = 1920, H = 1080, FPS = 60;
  let codec = null;
  for (const c of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'vp09.00.40.08']) {
    try { if ((await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate: 14e6, framerate: FPS })).supported) { codec = c; break; } } catch { /* sigue */ }
  }
  if (!codec) { mensajeRepe('Sin códec de vídeo disponible: usa ⏺ Grabar'); return; }
  const { Muxer, ArrayBufferTarget } = await import('../lib/mp4-muxer/mp4-muxer.mjs');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: codec.startsWith('avc') ? 'avc' : 'vp9', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
  let fallo = null;
  const enc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: (e) => { fallo = e; } });
  enc.configure({ codec, width: W, height: H, bitrate: 14e6, framerate: FPS });
  // render a 1080p sin tocar el tamaño que se ve en pantalla
  const prevPR = renderer.getPixelRatio(), prevTam = renderer.getSize(new THREE.Vector2());
  renderer.setPixelRatio(1); renderer.setSize(W, H, false); composer?.setSize(W, H);
  camara.cam.aspect = W / H; camara.cam.updateProjectionMatrix();
  const N = Math.max(1, Math.ceil((u1 - u0) * g.duracion * FPS));
  Object.assign(repe, { exportando: true, u: u0, play: true, vel: 1, ruta: conRuta, resumen: null });
  $('#repe').classList.add('limpia');
  try {
    for (let i = 0; i < N && !fallo; i++) {
      actualizarRepe(1 / FPS);
      const f = new VideoFrame(renderer.domElement, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      enc.encode(f, { keyFrame: i % 120 === 0 }); f.close();
      if (i % 6 === 0 || enc.encodeQueueSize > 6) { $('#repeGrab').textContent = `⬇ ${Math.round(i / N * 100)}%`; $('#repeGrab').classList.add('on'); await new Promise(r => setTimeout(r, 0)); }
    }
    await enc.flush();
    if (fallo) throw fallo;
    muxer.finalize();
    const nombre = `APEX-GP-1080p60-${Date.now()}.mp4`;
    await guardarArchivo(new Blob([muxer.target.buffer], { type: 'video/mp4' }), nombre);
    mensajeRepe('Vídeo exportado: ' + nombre);
  } catch (e) { console.warn('exportar', e); mensajeRepe('No se pudo exportar el vídeo'); }
  finally {
    try { enc.close(); } catch { /* ya cerrado */ }
    renderer.setPixelRatio(prevPR); renderer.setSize(prevTam.x, prevTam.y); composer?.setSize(prevTam.x, prevTam.y);
    camara.cam.aspect = prevTam.x / prevTam.y; camara.cam.updateProjectionMatrix();
    repe.exportando = false; repe.play = false; repe.ruta = false;
    $('#repeGrab').classList.remove('on'); $('#repe').classList.remove('limpia');
    pintarRepe();
  }
}

function saltarRepe(seg) { repe.u = THREE.MathUtils.clamp(repe.u + seg / Math.max(1, grabadora.duracion), 0, 1); for (const m of modelos) m.reponerPiezas?.(); }
function alternarPanel(id) {
  const p = $(id), abrir = !p.classList.contains('visible');
  document.querySelectorAll('.repe-panel').forEach(x => x.classList.remove('visible'));
  p.classList.toggle('visible', abrir);
}
function cocheRepe(paso) {
  const orden = sesion.orden || sesion.participantes;
  const i = orden.indexOf(sesion.participantes[repe.coche]);
  repe.coche = sesion.participantes.indexOf(orden[(i + paso + orden.length) % orden.length]);
  camRepe.poner(repe.cam === 'libre' ? 'orbita' : repe.cam, camara.cam);
  if (repe.cam === 'libre') repe.cam = 'orbita';
  pintarRepe();
}
async function alternarGrabacion() {
  const bt = $('#repeGrabar');
  if (grabVideo?.grabando) {
    bt.classList.remove('on'); $('#repeGrab').classList.remove('on');
    mensajeRepe('Guardando vídeo…');
    try { const n = await grabVideo.parar(); mensajeRepe('Vídeo guardado: ' + n); }
    catch (e) { mensajeRepe('No se pudo guardar el vídeo'); console.warn(e); }
    return;
  }
  if (!puedeGrabar(renderer.domElement)) { mensajeRepe('Este dispositivo no permite grabar vídeo'); return; }
  grabVideo ??= new GrabadorVideo(renderer.domElement, sonido.flujoGrabacion?.());
  try {
    grabVideo.empezar(30);
    bt.classList.add('on'); $('#repeGrab').classList.add('on');
    if (!repe.play) { repe.play = true; pintarRepe(); }
    $('#repe').classList.add('oculta');
  } catch (e) { mensajeRepe('No se pudo empezar a grabar'); console.warn(e); }
}
function mensajeRepe(txt) {
  const el = $('#repeCam'); el.textContent = txt;
  clearTimeout(mensajeRepe.t); mensajeRepe.t = setTimeout(pintarRepe, 2500);
}
$('#repePlay').addEventListener('click', () => { if (repe.u >= 1) repe.u = 0; repe.play = !repe.play; pintarRepe(); });
$('#repeVel').addEventListener('click', () => { repe.vel = VELS_REPE[(VELS_REPE.indexOf(repe.vel) + 1) % VELS_REPE.length]; pintarRepe(); });
$('#repeAtras').addEventListener('click', () => saltarRepe(-5));
$('#repeAdelante').addEventListener('click', () => saltarRepe(5));
$('#repeCuadro').addEventListener('click', () => { repe.play = false; saltarRepe(1 / 30); pintarRepe(); });
$('#repeCamBt').addEventListener('click', () => alternarPanel('#repePanelCam'));
$('#repeCineBt').addEventListener('click', () => { pintarCine(); alternarPanel('#repePanelCine'); });
$('#repeCoche').addEventListener('click', () => cocheRepe(1));
$('#repeCocheSig').addEventListener('click', () => cocheRepe(1));
$('#repeCochePrev').addEventListener('click', () => cocheRepe(-1));
$('#repeBarra').addEventListener('input', (e) => { repe.u = +e.target.value / 1000; for (const m of modelos) m.reponerPiezas?.(); });
$('#repeSalir').addEventListener('click', cerrarRepe);
$('#repeFoto').addEventListener('click', () => { document.body.classList.add('foto'); fotoPendiente = true; });
$('#repeGrabar').addEventListener('click', alternarGrabacion);
$('#repeResumen').addEventListener('click', iniciarResumen);
$('#repeClaveBt').addEventListener('click', () => { pintarClaves(); alternarPanel('#repePanelClaves'); });
$('#claveAnadir').addEventListener('click', anadirClave);
$('#claveVer').addEventListener('click', () => verRuta(false));
$('#claveGrabar').addEventListener('click', () => verRuta(true));
$('#claveExportar').addEventListener('click', exportarVideo);
$('#claveBorrar').addEventListener('click', () => { repe.claves = []; repe.ruta = false; pintarClaves(); pintarMarcas(); });
$('#cineMovimiento').addEventListener('input', (e) => { cine.opc.movimiento = +e.target.value / 100; });
$('#repeOcultar').addEventListener('click', () => { $('#repe').classList.add('limpia'); document.querySelectorAll('.repe-panel').forEach(p => p.classList.remove('visible')); });
$('#repe').addEventListener('pointerdown', despertarRepe);
// ajustes de cine
$('#cineApertura').addEventListener('input', (e) => { cine.opc.apertura = +e.target.value / 100; });
$('#cineGrano').addEventListener('input', (e) => { cine.opc.grano = +e.target.value / 500; });
$('#cineVineta').addEventListener('input', (e) => { cine.opc.vineta = +e.target.value / 100; });
$('#cineZoom').addEventListener('input', (e) => { camRepe.fovExtra = +e.target.value; });
$('#cineAlabeo').addEventListener('input', (e) => { camRepe.alabeo = +e.target.value * Math.PI / 180; });
$('#cineBarras').addEventListener('click', () => { cine.opc.barras = !cine.opc.barras; pintarCine(); });
$('#cineSacudida').addEventListener('click', () => { camRepe.sacudida = !camRepe.sacudida; pintarCine(); });
$('#cineSonido').addEventListener('click', () => { repe.sonido = !repe.sonido; pintarCine(); });
$('#cineReset').addEventListener('click', () => { Object.assign(cine.opc, { apertura: 0, filtro: 'natural', barras: false, grano: 0, vineta: 0, movimiento: 0 }); $('#cineMovimiento').value = 0; camRepe.fovExtra = 0; camRepe.alabeo = 0; camRepe.sacudida = 1; pintarCine(); });
// arrastrar sobre la imagen: mirar con la cámara libre u orbitar; tocar sin arrastrar enseña/oculta los controles
// (se instala al abrir la primera repetición, cuando ya existe el renderizador)
function instalarControlesRepe() {
  if (instalarControlesRepe.hecho) return;
  instalarControlesRepe.hecho = true;
  const lienzo = renderer.domElement, toques = new Map();
  let movido = 0, distPrev = 0;
  lienzo.addEventListener('pointerdown', (e) => { if (!repe) return; toques.set(e.pointerId, { x: e.clientX, y: e.clientY }); movido = 0; lienzo.setPointerCapture?.(e.pointerId); });
  lienzo.addEventListener('pointermove', (e) => {
    if (!repe || !toques.has(e.pointerId)) return;
    const t = toques.get(e.pointerId), dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY; movido += Math.abs(dx) + Math.abs(dy);
    if (toques.size === 2) {
      const [a, b] = [...toques.values()], dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (distPrev) camRepe.acercar(repe.cam, (dist - distPrev) * 2);
      distPrev = dist;
      return;
    }
    let modo = repe.cam;
    if (!['libre', 'orbita'].includes(modo) && movido > 12) { repe.cam = modo = 'orbita'; camRepe.poner('orbita', camara.cam); pintarRepe(); }
    camRepe.arrastrar(modo, dx, dy);
  });
  const soltar = (e) => {
    if (!repe || !toques.has(e.pointerId)) return;
    toques.delete(e.pointerId); distPrev = 0;
    if (movido < 6 && toques.size === 0) {
      const el = $('#repe');
      if (el.classList.contains('limpia')) el.classList.remove('limpia');
      else if (el.classList.contains('oculta')) despertarRepe();
      else { el.classList.add('oculta'); document.querySelectorAll('.repe-panel').forEach(p => p.classList.remove('visible')); }
    }
  };
  lienzo.addEventListener('pointerup', soltar); lienzo.addEventListener('pointercancel', soltar);
  lienzo.addEventListener('wheel', (e) => { if (!repe) return; e.preventDefault(); camRepe.acercar(repe.cam, -e.deltaY); }, { passive: false });
  addEventListener('keydown', (e) => {
    if (!repe || e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    camRepe.teclas.add(k === 'shift' ? 'shift' : k);
    if (repe.cam === 'libre' && 'wasdqe'.includes(k) || k.startsWith('arrow') && repe.cam === 'libre') return;
    if (k === ' ') { e.preventDefault(); $('#repePlay').click(); }
    else if (k === 'arrowleft') saltarRepe(-5);
    else if (k === 'arrowright') saltarRepe(5);
    else if (k === '.') { repe.play = false; saltarRepe(1 / 30); pintarRepe(); }
    else if (k === ',') { repe.play = false; saltarRepe(-1 / 30); pintarRepe(); }
    else if (k === 'c') ponerCamRepe(CAMARAS_REPE[(CAMARAS_REPE.indexOf(repe.cam) + 1) % CAMARAS_REPE.length]);
    else if (k === 'v') cocheRepe(1);
    else if (k === 'h') { const el = $('#repe'); el.classList.toggle('limpia'); }
    else if (k === 'p') $('#repeFoto').click();
    else if (k === 'r') alternarGrabacion();
    else if (k === 'escape') cerrarRepe();
    if (!['shift'].includes(k)) despertarRepe();
  });
  addEventListener('keyup', (e) => { camRepe?.teclas.delete(e.key.toLowerCase()); });
  addEventListener('blur', () => camRepe?.teclas.clear());
}

function guardarFoto() {
  fotoPendiente = false;
  try {
    const src = renderer.domElement;
    const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    const x = cv.getContext('2d');
    x.drawImage(src, 0, 0);
    // marca de agua
    const h = Math.max(18, cv.height * 0.035);
    x.font = `900 italic ${h}px system-ui, Arial`; x.textBaseline = 'bottom'; x.textAlign = 'right';
    x.fillStyle = 'rgba(0,0,0,.45)'; x.fillText('APEX GP · UPGAMES', cv.width - h * 0.6 + 2, cv.height - h * 0.5 + 2);
    x.fillStyle = '#fff'; x.fillText('APEX GP · UPGAMES', cv.width - h * 0.6, cv.height - h * 0.5);
    cv.toBlob(b => { guardarArchivo(b, `apexgp-${circuito.id}-${Date.now()}.png`).catch(e => console.warn('foto', e)); }, 'image/png');
  } catch (e) { console.warn('foto', e); }
  const f = $('#flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60);
  setTimeout(() => document.body.classList.remove('foto'), 400);
}

function abrirTelemetria() {
  mostrar('telePantalla');
  const t = telemetria;
  $('#teleInfo').innerHTML = t?.ultima ? 'Velocidad de tu última vuelta (cian) contra tu mejor vuelta (morado). Abajo: frenada (rojo), acelerador (verde) y diferencia de tiempo acumulada (amarillo: por encima pierdes).' : '';
  (t || new Telemetria(circuito.largo)).dibujar($('#teleGrafico'), fmt, circuito.curvas);
}

function volverMenuSinSesion() {
  jugando = false; pausado = false; enRed = false;
  $('#hud').classList.remove('visible'); $('#tactil').classList.remove('visible');
  document.body.classList.remove('jugando');
  sesion = new Sesion(circuito, { modo: 'practica', reglaje, ayudas: ayudasDe() });
  crearModelos();
}

// --- Contrarreloj en línea ---------------------------------------------------------------
async function subirTiempo(f) {
  if (!cuenta.conectado() || !fichaCrono || !f?.puntos?.length) return;
  try {
    const d = await cuenta.enviarTiempo({ ficha: fichaCrono, tiempo: f.tiempo, fantasma: fantasmaAServidor(f) });
    if (d.mejorado?.semana) { mensaje('TIEMPO EN EL RANKING', `P${d.posicionSemana} de la semana · ${fmt(d.tiempo)}`, 2.6); radio.decir(`Tiempo registrado: P${d.posicionSemana} del ranking de la semana.`, { clave: 'rankS', cada: 20 }); }
  } catch (e) { console.warn('ranking', e.message); }
}

// --- Clasificación Q1-Q2-Q3 ----------------------------------------------------------------
const NOMBRE_Q = ['Q1', 'Q2', 'Q3'];
function ritmoRivales(clima) {
  // en mojado la IA va tan lenta como dice el perfil de agarre (con neumáticos de lluvia)
  const f = clima === 'lluvia' ? 0.72 : 1;
  return circuito.def.ritmoIA * (f < 1 ? circuito.vueltaTeorica(f) / circuito.vueltaTeorica(1) : 1);
}
function empezarClasificacion(cfg) {
  const pilotos = cfg.pilotos || CAMP.crearPilotos({ rivales: cfg.rivales, dificultad: cfg.dificultad, equipoJugador: equipado.equipo || 0, nombre: nombreJugador(), semilla: Math.floor(Math.random() * 1e9) });
  const climaQ = cfg.clima === 'lluvia' ? 'lluvia' : 'seco';
  qActual = { cfg: { ...cfg, climaQ }, clasif: new CAMP.Clasificacion(pilotos, { ritmo: ritmoRivales(climaQ), semilla: Math.floor(Math.random() * 1e9) }), mejor: null, vueltas: 0 };
  pintarClasif(null);
}
function pintarClasif(orden) {
  const q = qActual, cl = q.clasif, k = Math.min(2, cl.tanda);
  $('#qTitulo').textContent = `Clasificación · ${circuito.def.corto}${q.cfg.campeonato ? ` · GP ${temporada.ronda + 1}/${temporada.rondas.length}` : ''}`;
  const yo = cl.jugador;
  if (!orden) {
    $('#qInfo').innerHTML = `<b>${NOMBRE_Q[cl.tanda]}</b> · ${cl.vivos.length} pilotos · ${cl.tanda < 2 ? `los ${cl.cortes[cl.tanda]} más lentos quedan fuera` : 'la pole se decide aquí'}. Tienes 2 vueltas lanzadas: cuenta la mejor.${q.cfg.climaQ === 'lluvia' ? ' 🌧️ Pista mojada.' : ''}`;
    $('#qLista').innerHTML = '';
    $('#bQSeguir').textContent = `Salir a pista (${NOMBRE_Q[cl.tanda]})`;
    $('#bQSaltar').classList.remove('oculto');
  } else {
    const kk = cl.tanda - 1;
    const fuera = cl.pilotos.filter(p => p.fuera === kk);
    const corte = orden.length - fuera.length;
    const lider = orden[0].tiempos[kk];
    $('#qLista').innerHTML = orden.map((p, i) => `${i === corte && fuera.length ? '<div class="corte">ZONA DE ELIMINACIÓN</div>' : ''}<div class="fila-q ${p.jugador ? 'yo' : ''} ${p.fuera === kk ? 'fuera' : ''}"><b>${i + 1}</b><span><i class="eq" style="display:inline-block;width:4px;height:14px;border-radius:2px;margin-right:6px;vertical-align:middle;background:${EQUIPOS[p.ie].base}"></i>${p.jugador ? nombreJugador() : p.nombre}</span><span>${fmt(p.tiempos[kk])}</span><span>${p.tiempos[kk] != null && i ? '+' + (p.tiempos[kk] - lider).toFixed(3) : ''}</span></div>`).join('');
    const pos = orden.indexOf(yo) + 1;
    if (yo.fuera != null || cl.fin) {
      const grid = cl.parrilla().indexOf(yo) + 1;
      $('#qInfo').innerHTML = cl.fin && yo.fuera == null ? (grid === 1 ? '🏆 <b>¡POLE POSITION!</b>' : `Terminas la Q3 en <b>P${grid}</b>.`) : `Eliminado en ${NOMBRE_Q[yo.fuera]}: sales <b>P${grid}</b>.`;
      $('#bQSeguir').textContent = 'A la parrilla';
      $('#bQSaltar').classList.add('oculto');
      if (cl.fin && grid === 1) radio.decir('¡Pole position! ¡Qué vuelta!', { prioridad: true });
    } else {
      $('#qInfo').innerHTML = `${NOMBRE_Q[kk]}: P${pos}. Pasas a la <b>${NOMBRE_Q[cl.tanda]}</b>.`;
      $('#bQSeguir').textContent = `Salir a pista (${NOMBRE_Q[cl.tanda]})`;
      $('#bQSaltar').classList.remove('oculto');
    }
  }
  void k;
  mostrar('clasif');
}
function salirAPistaQ() {
  const q = qActual;
  q.mejor = null; q.vueltas = 0;
  modoActual = 'contrarreloj';
  sonido.iniciar(); sonido.ponerVolumen(ajustes.volumen);
  const opc = opcBase('contrarreloj');
  opc.clima = q.cfg.climaQ;
  opc.reglaje.compuesto = q.cfg.climaQ === 'lluvia' ? 'lluvia' : 'blando';
  sesion = new Sesion(circuito, opc);
  sesion.hora = q.cfg.hora || opcCarrera.hora || 'dia';
  arrancarSesion('contrarreloj');
  mensaje(NOMBRE_Q[q.clasif.tanda], 'Vuelta de salida · 2 vueltas lanzadas', 3);
  radio.decir(`${NOMBRE_Q[q.clasif.tanda]}. Vuelta de salida y dos vueltas lanzadas. A por ello.`, { clave: 'q' + q.clasif.tanda, cada: 10 });
}
function finVueltaClasif(e) {
  const q = qActual;
  q.vueltas++;
  if (e.valida && (q.mejor == null || e.t < q.mejor)) q.mejor = e.t;
  if (q.vueltas >= 2) setTimeout(() => { if (qActual === q && jugando) terminarTandaQ(); }, 1500);
  else mensaje(e.valida ? fmt(e.t) : 'VUELTA ANULADA', 'Una vuelta más', 2);
}
function terminarTandaQ() {
  const q = qActual;
  jugando = false; pausado = false;
  $('#hud').classList.remove('visible'); $('#tactil').classList.remove('visible');
  document.body.classList.remove('jugando');
  sonido.silenciar(true);
  const orden = q.clasif.cerrarTanda(q.mejor);
  pintarClasif(orden);
}
$('#bQSeguir').addEventListener('click', () => {
  const q = qActual; if (!q) return;
  const yo = q.clasif.jugador;
  if (q.clasif.fin || yo.fuera != null) empezarCarreraTrasQ();
  else salirAPistaQ();
});
$('#bQSaltar').addEventListener('click', () => { if (qActual) { qActual.mejor = null; terminarTandaQ(); } });
function empezarCarreraTrasQ() {
  const q = qActual; qActual = null;
  const parrilla = q.clasif.parrilla();
  const cfg = q.cfg;
  empezar('carrera', {
    pilotos: parrilla, vueltas: cfg.vueltas ?? opcCarrera.vueltas, clima: cfg.clima, semilla: cfg.semilla, hora: cfg.hora,
    campeonato: cfg.campeonato ? { ronda: temporada.ronda } : null,
    compuesto: cfg.clima === 'lluvia' ? 'lluvia' : opcCarrera.compuesto,
  });
  if (cfg.campeonato && cuenta.conectado()) {
    const cc = carreraCamp;
    cuenta.fichaCarrera({ circuito: circuito.id, vueltas: sesion.vueltasTotales, rivales: sesion.participantes.length - 1, dificultad: temporada.opc.dificultad })
      .then(d => { if (cc) { cc.ficha = d.ficha; cc.puntuable = d.puntuable; } }).catch(() => {});
  }
}

// --- Campeonato -------------------------------------------------------------------------------
function pintarCampeonato() {
  const t = temporada;
  const activa = t && !t.terminada;
  $('#campNueva').classList.toggle('oculto', !!activa);
  document.querySelectorAll('#campeonato [data-camp]').forEach(sg => {
    const k = sg.dataset.camp;
    sg.querySelectorAll('b').forEach(b => { b.classList.toggle('sel', String(opcCamp[k]) === b.dataset.v); b.onclick = () => { opcCamp[k] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; guardar(); pintarCampeonato(); }; });
  });
  if (t) {
    const pil = CAMP.tablaPilotos(t), cons = CAMP.tablaConstructores(t);
    $('#campTablas').innerHTML = `<div><h3>Pilotos</h3>${pil.map((p, i) => `<div class="fila-camp ${p.jugador ? 'yo' : ''}"><b>${i + 1}</b><span><i style="background:${EQUIPOS[p.ie].base}"></i>${p.jugador ? nombreJugador() : p.nombre}${p.victorias ? ` <small style="color:#ffd23f">🏆${p.victorias}</small>` : ''}</span><span class="pts">${p.puntos}</span></div>`).join('')}</div>
      <div><h3>Constructores</h3>${cons.map((e, i) => `<div class="fila-camp ${e.ie === (equipado.equipo || 0) ? 'yo' : ''}"><b>${i + 1}</b><span><i style="background:${e.base}"></i>${e.nombre}</span><span class="pts">${e.puntos}</span></div>`).join('')}</div>`;
  } else $('#campTablas').innerHTML = '';
  if (activa) {
    const id = t.rondas[t.ronda], cl = CAMP.climaRonda(t);
    $('#campTitulo').textContent = `Campeonato · GP ${t.ronda + 1} de ${t.rondas.length}`;
    $('#campInfo').innerHTML = `Próximo: <b>${CIRCUITOS[id].nombre}</b> · ${t.opc.vueltas} vueltas · ${CLIMAS[cl]}${cl === 'variable' ? ' (puede llover)' : ''} · ${t.pilotos.length} pilotos.`;
    $('#bCampSeguir').textContent = 'Ir a la clasificación';
    $('#bCampAbandonar').classList.remove('oculto');
  } else if (t?.terminada) {
    const campeon = CAMP.tablaPilotos(t)[0];
    $('#campTitulo').textContent = campeon.jugador ? '🏆 ¡CAMPEÓN DEL MUNDO!' : 'Temporada terminada';
    $('#campInfo').innerHTML = `Campeón: <b>${campeon.jugador ? nombreJugador() : campeon.nombre}</b> (${EQUIPOS[campeon.ie].nombre}) con ${campeon.puntos} puntos.`;
    $('#bCampSeguir').textContent = 'Nueva temporada';
    $('#bCampAbandonar').classList.add('oculto');
  } else {
    $('#campTitulo').textContent = 'Campeonato';
    $('#campInfo').textContent = '';
    $('#bCampSeguir').textContent = 'Empezar temporada';
    $('#bCampAbandonar').classList.add('oculto');
  }
}
function abrirCampeonato() { mostrar('campeonato'); pintarCampeonato(); }
$('#bCampSeguir').addEventListener('click', async () => {
  if (!temporada || temporada.terminada) {
    temporada = CAMP.crearTemporada({ ...opcCamp, equipoJugador: equipado.equipo || 0, nombre: nombreJugador() });
    guardar();
  }
  const t = temporada;
  await cargarCircuito(t.rondas[t.ronda]);
  const cl = CAMP.climaRonda(t);
  empezarClasificacion({ pilotos: t.pilotos.map(p => ({ id: p.id, nombre: p.nombre, ie: p.ie, ip: p.ip, hab: p.hab, jugador: p.jugador })), clima: cl, vueltas: t.opc.vueltas, semilla: t.semilla + t.ronda, campeonato: true,
    hora: t.rondas[t.ronda] === 'puerto' ? 'noche' : t.rondas[t.ronda] === 'veloz' ? 'atardecer' : 'dia' });
});
$('#bCampAbandonar').addEventListener('click', () => {
  if (!confirm('¿Empezar una temporada nueva? Se pierde la clasificación actual.')) return;
  temporada = null; guardar(); pintarCampeonato();
});

function cerrarCarreraCampeonato(orden) {
  const cc = carreraCamp;
  if (!cc || cc.cerrada || !temporada) return;
  cc.cerrada = true;
  const rapido = orden.filter(p => isFinite(p.mejor)).sort((a, b) => a.mejor - b.mejor)[0];
  const res = orden.map(p => ({ id: p.idPiloto, pos: p.posicion, abandono: p.abandono || !p.terminado, vueltaRapida: p === rapido }));
  const ganados = CAMP.registrarCarrera(temporada, res);
  const yo = sesion.jugador;
  const pts = ganados.jugador || 0;
  let txt = `+${pts} puntos en el campeonato`;
  $('#resPremio').textContent = txt;
  guardar();
  // puntos al ranking mundial (validados por el servidor); las UpCoins solo llegan al top 5 semanal
  if (cc.ficha && yo.terminado && !yo.abandono) {
    $('#resPremio').textContent = txt + ' · enviando al ranking mundial…';
    cuenta.resultadoCarrera({ ficha: cc.ficha, pos: yo.posicion, tiempo: yo.tTotal })
      .then(d => {
        if (d.puntos > 0) txt += ` · 🌍 +${d.puntos} pts mundiales`;
        else if (d.tope) txt += ' · hoy ya puntuaron tus 6 carreras';
        if (d.posicion) txt += ` · vas P${d.posicion} del mundo esta semana${d.posicion <= 5 ? ' (zona de UpCoins 🪙)' : ' (el top 5 gana UpCoins)'}`;
        $('#resPremio').textContent = txt;
      })
      .catch(e => { $('#resPremio').textContent = txt + ` · no puntuó en el ranking: ${e.message}`; });
  } else if (!cuenta.conectado()) $('#resPremio').textContent = txt + ' · inicia sesión para sumar puntos al ranking mundial (el top 5 semanal gana UpCoins)';
  else if (cc.puntuable === false) $('#resPremio').textContent = txt + ' · no puntúa en el ranking mundial (mínimo 7 rivales, 3 vueltas y dificultad normal)';
}

// --- Rankings en línea ------------------------------------------------------------------------
const rk = { tab: 'mundial', circuito: 'valle', periodo: 'semana' };
const MEDALLA = (pos, semana) => (semana && pos <= 5 ? ['🥇', '🥈', '🥉', '🏅', '🏅'][pos - 1] : '');
const TXT_PREMIOS = 'Solo el <b style="color:#ffd23f">top 5 mundial</b> de cada semana gana UpCoins (no retirables): <b style="color:#ffd23f">1º 15 · 2º 10 · 3º-5º 5 UC</b>.';
function abrirRankings() { rk.circuito = circuito.id; mostrar('rankings'); pintarRankings(); }
async function pintarRankings() {
  document.querySelectorAll('#rankings .pestanas b').forEach(b => { b.classList.toggle('sel', b.dataset.rk === rk.tab); b.onclick = () => { rk.tab = b.dataset.rk; pintarRankings(); }; });
  const cs = $('#rkCircuito');
  cs.innerHTML = Object.values(CIRCUITOS).map(d => `<b data-v="${d.id}" class="${d.id === rk.circuito ? 'sel' : ''}">${d.corto}</b>`).join('');
  cs.querySelectorAll('b').forEach(b => b.onclick = () => { rk.circuito = b.dataset.v; pintarRankings(); });
  $('#rkPeriodo').querySelectorAll('b').forEach(b => { b.classList.toggle('sel', b.dataset.v === rk.periodo); b.onclick = () => { rk.periodo = b.dataset.v; pintarRankings(); }; });
  $('#rkFiltros').classList.toggle('oculto', rk.tab === 'elo');
  $('#rkCircuito').classList.toggle('oculto', rk.tab !== 'crono');
  $('#bRkFantasma').classList.toggle('oculto', rk.tab !== 'crono');
  $('#rkLista').innerHTML = '<p class="nota">Cargando…</p>';
  try {
    if (rk.tab === 'mundial') {
      $('#rkInfo').innerHTML = `Puntos del Campeonato de APEX GP en todo el mundo: cada carrera de campeonato suma (25-18-15-12-10-8-6-4-2-1, más en difícil y extremo). ${TXT_PREMIOS}`;
      const d = await cuenta.rankingMundial(rk.periodo);
      const yo = cuenta.usuario();
      $('#rkLista').innerHTML = d.filas.length ? d.filas.map(f => `${f.pos === 6 && rk.periodo === 'semana' ? '<div class="corte">FIN DE LOS PREMIOS</div>' : ''}<div class="fila-q ${f.usuario === yo ? 'yo' : ''}"><b>${f.pos}</b><span>@${String(f.usuario).replace(/</g, '')} <small style="color:var(--tenue)">${f.carreras} carr.${f.victorias ? ` · 🏆${f.victorias}` : ''}</small></span><span>${f.puntos} pts</span><span>${MEDALLA(f.pos, rk.periodo === 'semana')}</span></div>`).join('') : '<p class="nota">Nadie ha puntuado esta semana. ¡Corre el campeonato y ponte primero!</p>';
    } else if (rk.tab === 'crono') {
      $('#rkInfo').innerHTML = `Mejores vueltas en <b>${CIRCUITOS[rk.circuito].nombre}</b>. ${TXT_PREMIOS} Inicia sesión y corre en Contrarreloj para entrar.${records['crono:' + rk.circuito] ? ` Tu récord local: <b>${fmt(records['crono:' + rk.circuito])}</b>.` : ''}`;
      const d = await cuenta.ranking(rk.circuito, rk.periodo);
      const yo = cuenta.usuario();
      $('#rkLista').innerHTML = d.filas.length ? d.filas.map(f => `<div class="fila-q ${f.usuario === yo ? 'yo' : ''}"><b>${f.pos}</b><span>@${String(f.usuario).replace(/</g, '')}</span><span>${fmt(f.tiempo)}</span><span>${MEDALLA(f.pos, rk.periodo === 'semana')}</span></div>`).join('') : '<p class="nota">Nadie ha marcado tiempo todavía. ¡Sé el primero!</p>';
    } else {
      $('#rkInfo').innerHTML = `Puntuación ELO de las carreras en línea entre pilotos con cuenta. La partida rápida te empareja con rivales de tu nivel y tu región.${perfilApex.elo ? ` Tu ELO: <b>${perfilApex.elo}</b> (${perfilApex.nivel}).` : ''}`;
      const d = await cuenta.rankingElo();
      const yo = cuenta.usuario();
      $('#rkLista').innerHTML = d.filas.length ? d.filas.map(f => `<div class="fila-q ${f.usuario === yo ? 'yo' : ''}"><b>${f.pos}</b><span>@${String(f.usuario).replace(/</g, '')} <small style="color:var(--tenue)">${f.nivel}</small></span><span>${f.elo}</span><span>${f.carreras} carr.</span></div>`).join('') : '<p class="nota">Aún no hay carreras puntuadas.</p>';
    }
  } catch (e) { $('#rkLista').innerHTML = `<p class="nota">No se pudo cargar el ranking: ${e.message}</p>`; }
}
$('#bRkFantasma').addEventListener('click', async () => {
  try {
    const d = await cuenta.fantasmaRecord(rk.circuito, rk.periodo);
    await cargarCircuito(rk.circuito);
    fantasmaRival = { ...fantasmaDeServidor(d.fantasma, d.tiempo), autor: '@' + d.usuario };
    empezar('contrarreloj');
  } catch (e) { $('#rkInfo').textContent = e.status === 404 ? 'Aún no hay récord en este circuito.' : 'No se pudo descargar el fantasma: ' + e.message; }
});

// acceso para pruebas automáticas desde la consola
window.apexDebug = { celebrar: (p) => celebrar(p || sesion.jugador), get grabadora() { return grabadora; }, get sesion() { return sesion; }, get sonido() { return sonido; }, get renderer() { return renderer; }, get escenario() { return escenario; }, get camara() { return camara; }, circuito: () => circuito, multi, get modelos() { return modelos; }, cargarCircuito, get qActual() { return qActual; }, get temporada() { return temporada; }, get repe() { return repe; }, terminarTandaQ, radio };
actualizarCuentaMenu();
refrescarPerfil().then(actualizarCuentaMenu);
// enlace estable al APK (servido por el servidor de UpGames); dentro de la app no hace falta
if (window.Capacitor) $('#lnkApk').remove(); else $('#lnkApk').href = API + '/apexgp/apk';

// --- Arranque -----------------------------------------------------------------------
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
iniciar().catch((err) => {
  console.error(err);
  $('#cargaTexto').textContent = 'No se pudo iniciar el juego: ' + (err?.message || err) + '. Tu navegador necesita WebGL.';
});
