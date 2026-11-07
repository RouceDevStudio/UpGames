// UPSTAR — exploración espacial online con un universo infinito generado por fórmulas.
// Une todos los sistemas: nave, a pie, planetas, criaturas, combate, clima, estación, galaxia,
// escáner y descubrimientos, misiones, historia, bases, multijugador, sonido e interfaz.

import * as THREE from 'three';
import { sistema, expedicionSemana, SENAL } from './universo.js';
import { Planeta, estadisticasHilos, materialToon } from './planeta.js';
import { Nave, MODELOS, modeloNave } from './nave.js';
import { Astronauta } from './pie.js';
import { Controles } from './controles.js';
import { Particulas } from './particulas.js';
import { Combate } from './combate.js';
import { Clima } from './clima.js';
import { Criaturas } from './criaturas.js';
import { Estacion } from './estacion.js';
import { Galaxia, COSTE_SECTOR } from './mapa.js';
import { Audio } from './audio.js';
import { E, guardar, sincronizar, anadir, capacidad, cargaTotal } from './estado.js';
import { nube, token, usuario, Online } from './red.js';
import { iniciarUI, abrirMenu, abrirEstacion, cerrarPanel, hackeo, ficha, HISTORIA } from './ui.js';

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const movil = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
if (window.Capacitor) document.body.classList.add('app');

// ─── Render ──────────────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: $('#lienzo'), antialias: !movil, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
let escalaRes = 1;
const dpr = () => Math.min(devicePixelRatio || 1, movil ? 1.5 : 2) * escalaRes;
renderer.setPixelRatio(dpr()); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const ESPACIO = new THREE.Color('#07040f');
scene.background = ESPACIO.clone();
const camara = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.3, 4e6);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camara.aspect = innerWidth / innerHeight; camara.updateProjectionMatrix(); });
const luzSol = new THREE.DirectionalLight(0xffffff, 2.6);
const hemi = new THREE.HemisphereLight(0x8a7dff, 0x1a0f2e, 0.6);
scene.add(luzSol, luzSol.target, hemi);

// estrellas de fondo (decorado) y polvo espacial que marca la velocidad
const fondo = (() => {
  const n = movil ? 2000 : 4000, p = new Float32Array(n * 3), c = new Float32Array(n * 3), col = new THREE.Color();
  for (let i = 0; i < n; i++) { const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1.5e6); p.set([v.x, v.y, v.z], i * 3); col.setHSL([0.55, 0.85, 0.75][i % 3], 0.5, 0.45 + Math.random() * 0.3).toArray(c, i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true }));
  m.frustumCulled = false; scene.add(m); return m;
})();
const polvo = (() => {
  const n = 260, p = new Float32Array(n * 6), base = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) base.set([(Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160], i * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#bfefff', transparent: true, opacity: 0.55, fog: false }));
  m.frustumCulled = false; m.userData.base = base; scene.add(m); return m;
})();
// la estrella del sistema
const sol = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(cv); })(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
scene.add(sol, halo);

// ─── Sistemas del juego ─────────────────────────────────────────────────────────────────────
const audio = new Audio();
const part = new Particulas(scene);
const combate = new Combate(scene, part, audio);
const clima = new Clima(scene);
const criaturas = new Criaturas(scene); criaturas.alSonido = () => audio.criatura();
const galaxia = new Galaxia(scene);
const online = new Online();
const ctrl = new Controles();
const astro = new Astronauta(scene, E);
let nave = new Nave(scene, E);
const J = { sector: null, destino: null, enMenu: false, online, desatracar: () => desatracar() };
let sis = null, planetas = [], estacion = null, modo = 'nave', modoCam = 0;
const sinDano = { t: 99 };
iniciarUI({ audio, juego: J, alCambiarNave: () => nave.cambiarModelo(), alPlantarBase: () => plantarBase() });

// ─── Sistemas estelares ─────────────────────────────────────────────────────────────────────
let bases = [];
function cargarSistema(sec, llegada = null) {
  for (const p of planetas) p.destruir();
  estacion?.destruir(); combate.limpiar();
  for (const b of bases) scene.remove(b); bases = [];
  J.sector = sec; sis = sistema(...sec);
  const cs = new THREE.Color(sis.estrella.color);
  sol.scale.setScalar(sis.estrella.radio); sol.material.color.copy(cs).multiplyScalar(1.5);
  halo.material.color.copy(cs); halo.scale.setScalar(sis.estrella.radio * 9);
  luzSol.color.copy(cs).lerp(new THREE.Color(1, 1, 1), 0.55);
  planetas = sis.planetas.map(p => { const pl = new Planeta(scene, p, new THREE.Vector3(...p.pos).negate().normalize()); return pl; });
  estacion = new Estacion(scene, sis);
  galaxia.poner(sec);
  if (llegada) {
    // llegamos por el lado que da al sistema de origen, mirando hacia esta estrella
    nave.pos.copy(llegada).multiplyScalar(-230000);
    nave.raiz.lookAt(new THREE.Vector3()); nave.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    nave.vel.copy(llegada).multiplyScalar(2500); nave.vf = 2500;
  } else {
    // aparición: junto a la estación, mirando al primer planeta
    nave.pos.copy(estacion.puerta).add(new THREE.Vector3(0, 0, 250));
    nave.raiz.lookAt(new THREE.Vector3(...sis.planetas[0].pos)); nave.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    nave.vel.set(0, 0, 0); nave.vf = 0;
  }
  nave.estado = 'espacio'; ctrl.acel = 0;
  const clave = sec.join(',');
  if (!E.visitados.includes(clave)) E.visitados.push(clave);
  E.sector = sec;
  // la Señal y la expedición semanal
  const dS = Math.hypot(SENAL[0] - sec[0], SENAL[1] - sec[1], SENAL[2] - sec[2]);
  E.senal0 ??= dS; E.cercaSenal = Math.max(E.cercaSenal || 0, Math.round(E.senal0 - dS));
  const exp = expedicionSemana();
  if (exp.sector.join() === clave && E.expedicion !== exp.semana) { E.expedicion = exp.semana; E.creditos += 500; setTimeout(() => aviso('EXPEDICIÓN COMPLETADA', '+500 créditos'), 2500); }
  history.replaceState(null, '', `?sector=${clave}`);
  $('#sistema').textContent = `Sistema ${sis.nombre}`;
  $('#sector').textContent = `Sector ${sec.join(' · ')}`;
  $('#faccion').innerHTML = `<span style="color:${sis.faccion.color}">◆ ${sis.faccion.nombre}</span>`;
  aviso(`SISTEMA ${sis.nombre.toUpperCase()}`, `${planetas.length} planetas · ${sis.faccion.nombre} · sector ${sec.join(' · ')}`);
  crearEtiquetas();
  online.entrar(sec);
  // nombres registrados por los jugadores y bases plantadas
  nube.descubrimientos(planetas.map((p, k) => `p:${clave}:${k}`)).then(d => {
    planetas.forEach((p, k) => { const r = d.lista[`p:${clave}:${k}`]; if (r) { p.p.nombre = r.nombre; p.p.por = r.usuario; } }); crearEtiquetas();
  }).catch(() => {});
  nube.bases(sec).then(d => { for (const b of d.bases) ponerBase(b); }).catch(() => {});
  for (const b of E.bases.filter(b => b.sector === clave)) ponerBase(b);
  guardar();
}

function ponerBase(b) {
  const pl = planetas[b.planeta]; if (!pl) return;
  const g = new THREE.Group(), up = new THREE.Vector3(...b.pos).normalize();
  g.position.copy(pl.grupo.position).add(new THREE.Vector3(...b.pos)); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  g.add(new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), materialToon({ color: '#d9e2f2' })));
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 14, 6), materialToon({ color: '#444' })); ant.position.y = 7; g.add(ant);
  const luz = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2e88' })); luz.position.y = 14.5; g.add(luz);
  const ar = new THREE.Mesh(new THREE.TorusGeometry(7, 0.25, 6, 32), new THREE.MeshBasicMaterial({ color: '#00f0ff' })); ar.rotation.x = Math.PI / 2; ar.position.y = 0.3; g.add(ar);
  g.userData = { nombre: b.nombre || 'Base', usuario: b.usuario };
  scene.add(g); bases.push(g);
}
function plantarBase() {
  if (modo !== 'pie') { aviso('BAJA DE LA NAVE', 'Las bases se plantan a pie'); return false; }
  const pl = cercano(astro.pos); if (!pl) return false;
  const k = planetas.indexOf(pl), local = astro.pos.clone().sub(pl.grupo.position);
  const b = { sector: J.sector.join(','), planeta: k, pos: local.toArray().map(v => Math.round(v * 10) / 10), nombre: `Base de ${usuario() || 'viajero'}`, usuario: usuario() };
  E.bases.push(b); ponerBase(b); guardar();
  if (token()) nube.plantarBase({ sector: b.sector, planeta: k, pos: b.pos, nombre: b.nombre }).catch(() => {});
  aviso('BASE PLANTADA', `En ${pl.p.nombre}${token() ? ' · la verán los demás jugadores' : ''}`);
  return true;
}

// ─── Utilidades ─────────────────────────────────────────────────────────────────────────────
function cercano(p) {
  let mejor = null, dm = Infinity;
  for (const pl of planetas) { const d = p.distanceTo(pl.grupo.position) - pl.R; if (d < dm) { dm = d; mejor = pl; } }
  return mejor && dm < mejor.R * 3 ? mejor : null;
}
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _up = new THREE.Vector3();
function ambiente(p, pl) {
  if (!pl) return { pl: null, up: null, alt: Infinity, atm: 0, g: 0 };
  const up = new THREE.Vector3().copy(p).sub(pl.grupo.position); const r = up.length(); up.divideScalar(r);
  const h = pl.suelo(p, _w), alt = r - pl.R - h;
  const atm = Math.max(0, Math.min(1, 1 - (r - pl.R) / (pl.R * 0.35)));
  return { pl, up, alt, atm, g: pl.p.gravedad * Math.min(1, (pl.R / r) ** 2), hS: h };
}
let tAviso = 0;
function aviso(t, s = '', dur = 3.5) { $('#aviso').innerHTML = `${t}<small>${s}</small>`; $('#aviso').classList.add('visible'); tAviso = dur; }
combate.alAviso = (t, s) => { aviso(t, s); audio.alarma(); };

// ─── Daños ──────────────────────────────────────────────────────────────────────────────
let destruida = 0;
function danar(n) {
  if (modo === 'atracado' || destruida) return;
  sinDano.t = 0;
  $('#danoFlash').style.opacity = Math.min(1, 0.3 + n / 25); setTimeout(() => { $('#danoFlash').style.opacity = 0; }, 180);
  if (modo === 'pie') { E.traje = Math.max(0, E.traje - n * (E.implantes.pielBlindada ? 0.5 : 1)); if (E.traje <= 0) morirPie(); return; }
  let r = n;
  if (E.escudo > 0) { const a = Math.min(E.escudo, r * 1.3); E.escudo -= a; r -= a / 1.3; }
  E.casco = Math.max(0, E.casco - r / MODELOS[E.nave.modelo].casco);
  audio.golpe(Math.min(1, n / 20));
  if (E.casco <= 0) destruir();
}
function destruir() {
  destruida = 3;
  part.explosion(nave.pos, '#ff7a00', 160, 70, 6); part.explosion(nave.pos, '#ffffff', 60, 40, 3); audio.explosion(1.4);
  nave.raiz.visible = false;
  for (const k of Object.keys(E.inventario)) E.inventario[k] = Math.floor(E.inventario[k] * 0.6);
  aviso('NAVE DESTRUIDA', 'Has perdido parte de la carga · rescate en la estación', 4);
}
function reaparecer() {
  E.casco = 55; E.escudo = 40; destruida = 0; nave.raiz.visible = true; modo = 'nave'; ctrl.ponerModo('nave'); astro.ocultar();
  nave.pos.copy(estacion.puerta).add(new THREE.Vector3(0, 0, 250)); nave.vel.set(0, 0, 0); nave.vf = 0; nave.estado = 'espacio'; ctrl.acel = 0;
  guardar();
}
function morirPie() {
  aviso('SOPORTE VITAL AGOTADO', 'Despiertas en tu nave · pierdes parte de la carga', 4);
  for (const k of Object.keys(E.inventario)) E.inventario[k] = Math.floor(E.inventario[k] * 0.7);
  E.traje = 45; subirNave(true);
}

// ─── Modos ───────────────────────────────────────────────────────────────────────────────
function bajarNave() {
  if (nave.estado !== 'aterrizada') { aviso('ATERRIZA PRIMERO', 'Pulsa L (o ATERRIZAR) cerca del suelo'); return; }
  const pl = cercano(nave.pos), amb = ambiente(nave.pos, pl);
  const lado = _v.set(1, 0, 0).applyQuaternion(nave.quat);
  astro.bajar(nave.pos.clone().addScaledVector(lado, 5).addScaledVector(amb.up, 1), amb.up, nave.delante(new THREE.Vector3()));
  modo = 'pie'; ctrl.ponerModo('pie'); modoCam = 0;
  aviso(pl.p.nombre.toUpperCase(), `${pl.p.tipoNombre} · gravedad ${pl.p.gravedad.toFixed(1)} m/s² · ${clima.actual(pl)}`);
}
function subirNave(forzar = false) {
  if (!forzar && astro.pos.distanceTo(nave.pos) > 9) return;
  modo = 'nave'; ctrl.ponerModo('nave'); astro.ocultar(); E.traje = Math.max(E.traje, 30); E.jetpack = 100;
}
function atracar() {
  modo = 'atracado'; nave.raiz.visible = false; nave.vel.set(0, 0, 0); nave.vf = 0; ctrl.acel = 0; combate.limpiar();
  E.escudo = 100; guardar(true);
  abrirEstacion(sis);
}
function desatracar() {
  if (modo !== 'atracado') return;
  modo = 'nave'; nave.raiz.visible = true;
  nave.pos.copy(estacion.puerta).add(new THREE.Vector3(0, 0, 60));
  nave.raiz.lookAt(nave.pos.clone().add(new THREE.Vector3(0, 0, -1))); nave.vel.set(0, 0, 40); nave.vf = 0;
  nave.raiz.lookAt(nave.pos.clone().add(new THREE.Vector3(0, 0, 1))); nave.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
  ctrl.acel = 0.2;
}
function intentarSalto() {
  if (modo !== 'nave' || galaxia.salto) return;
  const amb = ambiente(nave.pos, cercano(nave.pos));
  if (amb.atm > 0) { aviso('NO SE PUEDE SALTAR', 'Sal de la atmósfera'); return; }
  if (amb.pl && amb.alt < amb.pl.R * 0.8) { aviso('DEMASIADO CERCA', 'Aléjate del planeta para saltar'); return; }
  const fw = nave.delante(new THREE.Vector3()), e = galaxia.apuntada(fw);
  if (!e) { aviso('APUNTA A UNA ESTRELLA', J.destino ? 'Gira hacia la marca verde de tu destino' : 'Las estrellas del cielo son otros sistemas'); return; }
  const coste = Math.ceil(e.dist * COSTE_SECTOR);
  if (E.combustible < coste) { aviso('SIN COMBUSTIBLE', `Hace falta ${coste} % · fabrica células de plasma con cristales`); return; }
  E.combustible -= coste;
  galaxia.iniciarSalto(e.sector, e.dir); audio.salto();
  aviso(`SALTO A ${e.nombre.toUpperCase()}`, `${e.dist.toFixed(1)} sectores`, 2.5);
  if (J.destino && e.sector.join() === J.destino.join()) J.destino = null;
}

// ─── Escáner y descubrimientos ────────────────────────────────────────────────────────────────
let marcas = [], onda = null;
function escanear() {
  audio.iniciar(); audio.escaner();
  const centro = modo === 'pie' ? astro.pos : nave.pos, radio = (modo === 'pie' ? 180 : 900) * (E.implantes.escanerPlus ? 2 : 1);
  onda = { t: 0, centro: centro.clone(), radio };
  const pl = cercano(centro), clave = J.sector.join(',');
  marcas = [];
  const descubrir = (key, d) => {
    if (E.descubiertos[key]) return;
    nube.descubrimientos([key]).then(r => { const x = r.lista[key]; mostrarFicha(key, d, x); }).catch(() => mostrarFicha(key, d, null));
  };
  if (pl) {
    const k = planetas.indexOf(pl), amb = ambiente(centro, pl);
    if (amb.atm > 0.05) descubrir(`p:${clave}:${k}`, { tipo: 'planeta', nombre: pl.p.nombre, datos: [['Tipo', pl.p.tipoNombre], ['Gravedad', pl.p.gravedad.toFixed(1) + ' m/s²'], ['Clima', pl.p.climas[1]], ['Lunas', pl.p.lunas], ['Radio', (pl.R / 1000).toFixed(1) + ' km'], ['Especies', pl.p.especies.length]] });
    for (const c of criaturas.cerca(centro, radio)) {
      marcas.push({ pos: c.obj.position, txt: c.es.nombre, c: c.es.temperamento === 'agresiva' ? '#ff3b3b' : '#39ff88' });
      const ki = pl.p.especies.indexOf(c.es), key = `c:${clave}:${k}:${ki}`;
      if (!E.descubiertos[key] && !marcas.some(m => m.key === key)) { marcas[marcas.length - 1].key = key; descubrir(key, { tipo: 'criatura', nombre: c.es.nombre, datos: [['Temperamento', c.es.temperamento], ['Dieta', c.es.dieta], ['Tamaño', c.es.tam.toFixed(1) + ' m'], ['Rareza', c.es.rareza], ['Patas', c.es.vuela ? 'vuela' : c.es.patas], ['Planeta', pl.p.nombre]] }); }
    }
    (pl.ruinas || []).forEach(r => {
      const pw = r.pos.clone().add(pl.grupo.position);
      if (pw.distanceTo(centro) < radio * 4) { marcas.push({ pos: pw, txt: 'Ruina antigua', c: '#ffd23f' }); if (pw.distanceTo(centro) < radio) descubrir(`r:${clave}:${k}:${r.k}`, { tipo: 'ruina', nombre: `Ruina de ${pl.p.nombre}`, datos: [['Terminal', 'activo'], ['Edad', `${3 + (r.k * 7919) % 40}.000 años`], ['Planeta', pl.p.nombre], ['Señal', 'coincide']] }); }
    });
    if (pl.ciudad) { const pw = pl.ciudad.pos.clone().add(pl.grupo.position); if (pw.distanceTo(centro) < radio * 6) marcas.push({ pos: pw, txt: 'Ciudad de neón', c: '#ff2e88' }); }
    let minerales = 0; for (const m of pl.minables) if (m.visible) minerales += m.count;
    aviso('ESCÁNER', `${criaturas.cerca(centro, radio).length} criaturas · ${minerales} recursos cerca`, 2);
  } else aviso('ESCÁNER', 'Nada cerca: acércate a un planeta', 2);
  marcas.t = 12;
}
function mostrarFicha(key, d, reg) {
  if (reg) { d.nombre = reg.nombre; d.por = reg.usuario; }
  if (d.tipo === 'criatura') E.escaneados++;
  E.descubiertos[key] = { nombre: d.nombre, tipo: d.tipo, por: d.por || null };
  E.creditos += d.tipo === 'planeta' ? 60 : d.tipo === 'criatura' ? 40 : 80;
  audio.descubrir(); guardar();
  ficha(d, (nombre) => {
    E.descubiertos[key].nombre = nombre;
    if (token()) nube.registrar(key, d.tipo, nombre).then(r => { E.descubiertos[key] = { nombre: r.nombre, tipo: d.tipo, por: r.usuario }; if (r.primero) aviso('¡REGISTRADO!', `«${r.nombre}» lleva tu nombre para todos`); guardar(); }).catch(() => {});
    if (d.tipo === 'planeta') { const k = +key.split(':')[2]; if (planetas[k]) planetas[k].p.nombre = nombre; crearEtiquetas(); }
    guardar();
  });
}

// ─── Interfaz: etiquetas en el cielo ──────────────────────────────────────────────────────────
let etiquetas = [];
function crearEtiquetas() {
  $('#etiquetas').innerHTML = '';
  const mk = (cls = '') => { const e = document.createElement('div'); e.className = 'etq ' + cls; $('#etiquetas').appendChild(e); return e; };
  etiquetas = planetas.map(p => ({ el: mk(), obj: p }));
  etiquetas.forEach(({ el, obj }) => { el.innerHTML = `<b>${obj.p.nombre}</b><small>${obj.p.tipoNombre}${obj.p.por ? ' · @' + obj.p.por : ''}</small><span></span>`; });
  etiquetas.push({ el: mk(), est: true }); etiquetas.at(-1).el.innerHTML = `<b>${sis.estacion.nombre}</b><small>Estación · comercio</small><span></span>`;
  etiquetas.push({ el: mk(), dest: true }); etiquetas.at(-1).el.style.setProperty('--c', '#39ff88');
  etiquetas.push({ el: mk(), senal: true }); etiquetas.at(-1).el.style.setProperty('--c', '#ff2e88'); etiquetas.at(-1).el.innerHTML = '<b>LA SEÑAL</b><small>sector 0 · 0 · −48</small><span></span>';
  etiquetas.push({ el: mk(), apunt: true }); etiquetas.at(-1).el.style.setProperty('--c', '#ffffff');
  etiquetas.push({ el: mk(), anillo: true }); etiquetas.at(-1).el.style.setProperty('--c', '#39ff88');
  marcasEl = [];
}
let marcasEl = [];
function proyectar(p, el, txt) {
  _v.copy(p).project(camara);
  const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
  el.style.display = vis ? '' : 'none';
  if (vis) el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * innerWidth}px, ${(-_v.y * 0.5 + 0.5) * innerHeight}px)`;
  if (vis && txt != null) el.querySelector('span').textContent = txt;
  return vis;
}
const km = (d) => d > 1e5 ? (d / 1000).toFixed(0) + ' km' : d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';

function hud(dt, amb, pos) {
  const pie = modo === 'pie';
  const v = pie ? astro.velPlano : nave.velocidad;
  $('#vel').textContent = v > 9999 ? (v / 1000).toFixed(1) + ' km/s' : Math.round(v * 3.6) + ' km/h';
  $('#alt').textContent = !amb.pl || amb.alt > 1e5 ? '—' : km(Math.max(0, pie ? astro.altitud : amb.alt));
  const vv = nave.vVert; $('#vvert').textContent = amb.atm > 0 ? (vv > 0 ? '▲ ' : '▼ ') + Math.abs(vv).toFixed(0) + ' m/s' : '—';
  const est = galaxia.salto ? ['salto', 'HIPERESPACIO'] : pie ? ['pie', 'A PIE'] : modo === 'atracado' ? ['aterrizada', 'ATRACADA'] : nave.pulso ? ['pulso', 'PULSO'] : nave.estado === 'aterrizada' ? ['aterrizada', 'ATERRIZADA'] : nave.autoAterrizar ? ['atmosfera', 'ATERRIZANDO…'] : nave.vf < -1 ? ['reversa', 'REVERSA'] : nave.estado === 'atmosfera' ? ['atmosfera', 'ATMÓSFERA'] : ['espacio', 'ESPACIO'];
  $('#estado').className = 'estado ' + est[0]; $('#estado').textContent = est[1];
  const a = ctrl.acel; $('#acelTxt').textContent = (a < 0 ? 'R ' : '') + Math.round(Math.abs(a) * 100) + ' %';
  const ab = $('#acelBar'); ab.style.bottom = a >= 0 ? '23%' : `${23 + a / 0.3 * 23}%`; ab.style.height = `${Math.abs(a) * (a >= 0 ? 77 : 23 / 0.3)}%`; ab.classList.toggle('rev', a < 0);
  const barra = (id, v) => { const b = $(id); b.style.width = Math.max(0, Math.min(100, v)) + '%'; b.parentElement.parentElement.classList.toggle('bajo', v < 25); };
  barra('#bCasco', E.casco); barra('#bEscudo', E.escudo); barra('#bComb', E.combustible); barra('#bTraje', E.traje); barra('#bJet', E.jetpack);
  if (amb.pl) $('#planeta').innerHTML = `<b>${amb.pl.p.nombre}</b> · ${amb.pl.p.tipoNombre} · g ${amb.pl.p.gravedad.toFixed(1)}${amb.pl.p.lunas ? ` · ${amb.pl.p.lunas} luna${amb.pl.p.lunas > 1 ? 's' : ''}` : ''}`;
  else $('#planeta').innerHTML = '';
  // alertas
  let al = '';
  if (!pie && amb.atm > 0 && amb.alt < 120 && nave.vVert < -25 && nave.estado !== 'aterrizada') al = '¡TERRENO! SUBE';
  else if (E.casco < 25 && !pie) al = 'CASCO CRÍTICO';
  else if (pie && E.traje < 25) al = 'SOPORTE VITAL BAJO';
  else if (!pie && combate.piratas.length) al = `PIRATAS: ${combate.piratas.length}`;
  $('#alerta').textContent = al;
  // vector de velocidad (hacia dónde te mueves de verdad)
  const vec = $('#vector');
  if (!pie && nave.velocidad > 3) {
    const atras = nave.vel.dot(nave.delante()) < 0;
    _v.copy(nave.vel).normalize().multiplyScalar(atras ? -100 : 100).add(camara.position).project(camara);
    vec.style.display = _v.z < 1 ? '' : 'none'; vec.classList.toggle('atras', atras);
    vec.style.left = (_v.x * 0.5 + 0.5) * innerWidth + 'px'; vec.style.top = (-_v.y * 0.5 + 0.5) * innerHeight + 'px';
  } else vec.style.display = 'none';
  // etiquetas
  for (const e of etiquetas) {
    if (e.obj) { const d = pos.distanceTo(e.obj.grupo.position) - e.obj.R; if (e.obj === amb.pl && amb.atm > 0.05) { e.el.style.display = 'none'; continue; } proyectar(e.obj.grupo.position, e.el, km(d)); }
    else if (e.est) { const d = pos.distanceTo(estacion.obj.position); proyectar(estacion.obj.position, e.el, km(d) + (d < 700 && !pie ? ' · ATRACAR' : '')); }
    else if (e.dest) { if (!J.destino) { e.el.style.display = 'none'; continue; } const dir = galaxia.direccionA(J.destino); e.el.innerHTML = `<b>DESTINO</b><small>${J.destino.join(' · ')}</small><span></span>`; proyectar(_w.copy(dir).multiplyScalar(1e5).add(camara.position), e.el, ''); }
    else if (e.senal) proyectar(_w.copy(galaxia.senal()).multiplyScalar(1e5).add(camara.position), e.el, '');
    else if (e.apunt) {
      const st = !pie && amb.atm === 0 ? galaxia.apuntada(nave.delante(new THREE.Vector3())) : null;
      if (!st) { e.el.style.display = 'none'; continue; }
      e.el.innerHTML = `<b>${st.nombre}</b><small>${st.dist.toFixed(1)} sectores · ${Math.ceil(st.dist * COSTE_SECTOR)} % · J/SALTO</small><span></span>`;
      proyectar(_w.copy(st.dir).multiplyScalar(1e5).add(camara.position), e.el, '');
    } else if (e.anillo) { const a = estacion.siguiente(); if (!a || pie) { e.el.style.display = 'none'; continue; } e.el.innerHTML = '<b>ANILLO</b><small></small><span></span>'; proyectar(a.position, e.el, km(pos.distanceTo(a.position))); }
  }
  // marcas del escáner y visión térmica
  if (marcas.t > 0) marcas.t -= dt;
  const lista = marcas.t > 0 ? marcas.slice(0, 30) : [];
  if (E.implantes.termica && J.termica) for (const c of criaturas.cerca(pos, 300)) lista.push({ pos: c.obj.position, txt: '', c: '#ff7a00' });
  while (marcasEl.length < lista.length) { const el = document.createElement('div'); el.className = 'etq mini'; el.innerHTML = '<b></b><span></span>'; $('#etiquetas').appendChild(el); marcasEl.push(el); }
  marcasEl.forEach((el, k) => { const m = lista[k]; if (!m) { el.style.display = 'none'; return; } el.style.setProperty('--c', m.c); el.querySelector('b').textContent = m.txt; proyectar(m.pos, el, km(pos.distanceTo(m.pos))); });
  // botón de acción según el momento
  const acc = accionActual(amb);
  const b = $('#bAccion'); b.textContent = acc ? acc[1] : ''; b.classList.toggle('visible', !!acc);
  // misión en curso
  const m = E.misiones.find(x => !x.cobrada); $('#mision').textContent = m ? '◆ Misión en curso (estación)' : '';
  $('#clima').textContent = amb.pl && amb.atm > 0.05 ? `Clima: ${clima.actual(amb.pl)}` : '';
}
function accionActual(amb) {
  if (galaxia.salto || destruida) return null;
  if (modo === 'pie') {
    if (astro.pos.distanceTo(nave.pos) < 9) return ['subir', 'F · SUBIR A LA NAVE'];
    const t = terminalCerca(); if (t) return ['hackear', 'F · HACKEAR TERMINAL'];
    return null;
  }
  if (modo !== 'nave') return null;
  if (nave.estado === 'aterrizada') return ['bajar', 'F · BAJAR DE LA NAVE'];
  if (estacion && nave.pos.distanceTo(estacion.obj.position) < 700 && nave.velocidad < 160) return ['atracar', 'F · ATRACAR'];
  if (amb.atm > 0 && amb.alt < 350) return ['aterrizar', nave.autoAterrizar ? 'L · CANCELAR ATERRIZAJE' : 'L · ATERRIZAR'];
  return null;
}
function terminalCerca() {
  const pl = cercano(astro.pos); if (!pl?.ruinas) return null;
  for (const r of pl.ruinas) if (r.terminal.clone().add(pl.grupo.position).distanceTo(astro.pos) < 5) return { pl, r };
  return null;
}

// ─── Cámara ─────────────────────────────────────────────────────────────────────────────────
const camPos = new THREE.Vector3(); let sacudida = 0;
function moverCamara(dt) {
  if (modo === 'pie') { astro.camara(camara, dt); camara.fov += (70 - camara.fov) * Math.min(1, dt * 3); camara.updateProjectionMatrix(); nave.raiz.visible = !destruida; return; }
  const off = modoCam === 0 ? _v.set(0, 3.4, 14) : _v.set(0, 0.55, -1.1);
  const obj = off.applyQuaternion(nave.quat).add(nave.pos);
  if (modoCam === 0) camPos.lerp(obj, 1 - Math.exp(-dt * 10)); else camPos.copy(obj);
  if (camPos.distanceTo(nave.pos) > 120) camPos.copy(obj);
  camara.position.copy(camPos);
  if (sacudida > 0) { camara.position.x += (Math.random() - 0.5) * sacudida; camara.position.y += (Math.random() - 0.5) * sacudida; sacudida *= Math.exp(-dt * 6); }
  camara.up.set(0, 1, 0).applyQuaternion(nave.quat);
  camara.lookAt(_w.copy(nave.delante()).multiplyScalar(modoCam === 0 ? 40 : 100).add(nave.pos).addScaledVector(camara.up, modoCam === 0 ? 1.5 : 0));
  const fov = 64 + Math.min(14, Math.max(0, nave.vf) / 40) + (nave.pulso || galaxia.salto ? 18 : 0) + (nave.turbo ? 6 : 0);
  camara.fov += (fov - camara.fov) * Math.min(1, dt * 3); camara.updateProjectionMatrix();
  nave.raiz.visible = modoCam === 0 && !destruida && modo !== 'atracado';
}

// ─── Cielo ───────────────────────────────────────────────────────────────────────────────
const _c = new THREE.Color();
function cielo(amb, efecto) {
  let t = 0, colCielo = ESPACIO;
  if (amb.pl) {
    t = amb.atm;
    _v.copy(camara.position).sub(amb.pl.grupo.position).normalize();
    const aSol = _w.copy(camara.position).negate().normalize();
    const dia = THREE.MathUtils.smoothstep(_v.dot(aSol), -0.25, 0.35);
    amb.noche = dia < 0.3;
    colCielo = _c.set(amb.pl.p.cielo).multiplyScalar((0.16 + 0.46 * dia) * efecto.cielo).lerp(ESPACIO, 1 - dia * 0.85);
    if (efecto.color) colCielo.lerp(new THREE.Color(efecto.color), 0.25 * dia);
    // los colores muy vivos (verde tóxico, cian) no deben deslumbrar: tope de brillo del cielo
    const mx = Math.max(colCielo.r, colCielo.g, colCielo.b); if (mx > 0.17) colCielo.multiplyScalar(0.17 / mx);
  }
  scene.background.copy(ESPACIO).lerp(colCielo, t * t);
  if (efecto.flash > 0) scene.background.lerp(new THREE.Color('#e8f4ff'), efecto.flash * 0.7);
  fondo.material.opacity = 1 - t * 0.95; galaxia.pts.visible = t < 0.6;
  if (t > 0.02) {
    if (!scene.fog) scene.fog = new THREE.Fog(0, 1, 1);
    scene.fog.color.copy(scene.background);
    scene.fog.near = 600 * efecto.visibilidad; scene.fog.far = THREE.MathUtils.lerp(600000, 26000 * efecto.visibilidad, t);
  } else scene.fog = null;
}

// ─── Bucle ─────────────────────────────────────────────────────────────────────────────────
let tPrev = performance.now(), fpsN = 0, fpsT = 0, tGuardar = 0, tRed = 0, tHist = 0;
const otros = new Map();
function bucle(ahora) {
  requestAnimationFrame(bucle);
  const dt = Math.min(0.05, (ahora - tPrev) / 1000); tPrev = ahora;
  const { m, ev } = ctrl.leer(dt);
  for (const e of ev) evento(e);
  if (J.enMenu) { m.cabeceo = m.guinada = m.alabeo = 0; m.fuego = false; m.x = m.z = 0; }
  const foco = modo === 'pie' ? astro.pos : nave.pos;
  const pl = cercano(foco), amb = ambiente(foco, pl);

  // ── nave / a pie ──
  if (destruida) { destruida -= dt; if (destruida <= 0) reaparecer(); }
  else if (galaxia.salto) {
    nave.vel.copy(galaxia.salto.dir).multiplyScalar(30000); nave.pos.addScaledVector(nave.vel, dt * 0.02);
    const qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), galaxia.salto.dir, new THREE.Vector3(0, 1, 0)));
    nave.quat.slerp(qd, Math.min(1, dt * 2));
  } else if (modo === 'nave') {
    const ambN = ambiente(nave.pos, cercano(nave.pos));
    nave.actualizar(dt, m, ambN);
    if (ambN.pl) {
      const a2 = ambiente(nave.pos, ambN.pl), r = nave.suelo(a2.alt - 1.4, a2.up);
      if (r === -1) { audio.golpe(0.2); aviso('ATERRIZAJE', `Bienvenido a ${ambN.pl.p.nombre} · F para bajar`, 2.5); }
      else if (r > 0) { danar(r); sacudida = Math.min(2, r / 10); part.explosion(nave.pos, '#ffb347', 20, 15, 1.5); }
    }
    if (m.fuego && !J.enMenu) { const res = combate.dispararNave(nave, cercano(nave.pos), E); recoger(res); }
    // humo y chispas con la nave dañada
    if (E.casco < 55 && Math.random() < dt * 25) part.emitir(nave.modelo.userData.escape.clone().applyQuaternion(nave.quat).add(nave.pos), _v.copy(nave.vel).multiplyScalar(0.6).add(_w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4)), new THREE.Color(E.casco < 30 ? '#ff7a00' : '#666a78'), E.casco < 30 ? 1.2 : 2, 1.2, 0.6);
  } else if (modo === 'pie' && pl) {
    const jet = astro.actualizar(dt, m, pl);
    if (astro.golpe) { danar(astro.golpe); astro.golpe = 0; }
    if (m.fuego && !J.enMenu) { const res = combate.herramienta(astro.pos.clone().addScaledVector(astro.up, 1.3), astro.mira(camara, new THREE.Vector3()), pl, E); recoger(res); }
    if (jet && Math.random() < dt * 30) part.emitir(astro.pos.clone().addScaledVector(astro.up, 0.6), astro.up.clone().multiplyScalar(-6), new THREE.Color('#00f0ff'), 0.4, 0.4, 2);
    E.traje = Math.max(0, E.traje - dt * 0.15);
  }

  // ── mundo ──
  const enEspacio = modo === 'nave' && amb.atm === 0 && !galaxia.salto;
  combate.actualizar(dt, nave, enEspacio, sis.faccion, E, (p) => {
    const cr = 90 + Math.floor(Math.random() * 70); E.creditos += cr; E.piratas++; E.reputacion.corp += 2; E.reputacion.sind -= 1;
    if (Math.random() < 0.6) anadir('plasma', 1);
    aviso('PIRATA DERRIBADO', `+${cr} créditos`, 1.6);
  }, (n) => { danar(n); sacudida = 0.6; });
  const cercaSuelo = amb.pl && (modo === 'pie' || amb.alt < 1500);
  const danoCr = criaturas.actualizar(dt, cercaSuelo ? amb.pl : null, foco, modo === 'pie' ? astro.pos : null, cercaSuelo);
  if (danoCr > 0) danar(danoCr);
  const efecto = clima.actualizar(dt, amb.pl, camara, amb.atm, amb.noche, audio);
  if (efecto.traje && modo === 'pie') { E.traje = Math.max(0, E.traje - dt * efecto.traje * (E.implantes.pielBlindada ? 0.5 : 1)); if (E.traje <= 0) morirPie(); }
  if (efecto.nave && modo === 'nave' && amb.atm > 0) { if (E.escudo > 0) E.escudo = Math.max(0, E.escudo - dt * efecto.nave * 2); else E.casco = Math.max(1, E.casco - dt * efecto.nave * 0.3); }
  sinDano.t += dt; if (sinDano.t > 4 && modo !== 'pie') E.escudo = Math.min(100, E.escudo + dt * 6);
  const ev2 = modo === 'nave' ? estacion.actualizar(dt, nave) : (estacion.actualizar(0, { pos: new THREE.Vector3(1e9, 0, 0) }), null);
  if (ev2) eventoCarrera(ev2);
  $('#carreraHud').textContent = estacion.carrera ? `ANILLOS ${estacion.carrera.sig}/10 · ${estacion.carrera.t.toFixed(2)} s` : '';
  const sj = galaxia.actualizar(dt, camara);
  if (sj === 'cargar') cargarSistema(galaxia.salto.destino, galaxia.salto.dir);
  if (sj === 'fin') { aviso(`SISTEMA ${sis.nombre.toUpperCase()}`, `${sis.faccion.nombre} · ${planetas.length} planetas`); ctrl.acel = 0.5; }
  if (onda) { onda.t += dt; if (onda.t > 1.5) onda = null; }

  moverCamara(dt);
  for (const p of planetas) p.actualizar(camara.position);
  // luz del sol: desde la estrella (en el centro del sistema) hacia donde estás
  luzSol.position.set(0, 0, 0); luzSol.target.position.copy(camara.position);
  halo.position.set(0, 0, 0);
  fondo.position.copy(camara.position);
  cielo(amb, efecto);
  actualizarPolvo(amb);
  part.actualizar(dt);
  hud(dt, amb, foco);
  if (tAviso > 0) { tAviso -= dt; if (tAviso <= 0) $('#aviso').classList.remove('visible'); }
  // online
  tRed -= dt;
  if (tRed <= 0) { tRed = 0.1; if (modo !== 'atracado' && !destruida) online.enviar(modo === 'pie' ? astro.pos : nave.pos, modo === 'pie' ? astro.modelo.quaternion : nave.quat, modo === 'pie' ? astro.velPlano : nave.velocidad, modo === 'pie' ? 'pie' : 'nave'); }
  actualizarOtros(dt);
  audio.actualizar(dt, { empuje: modo === 'nave' ? Math.max(0, ctrl.acel) + (nave.turbo ? 0.4 : 0) + (nave.pulso ? 0.8 : 0) : 0, vel: modo === 'pie' ? astro.velPlano : nave.velocidad, densidad: amb.atm, aPie: modo !== 'nave', semillaPlaneta: amb.pl?.p.semilla, dentro: amb.atm > 0.05 });
  // historia y guardado
  tHist -= dt;
  if (tHist <= 0) { tHist = 1; const h = HISTORIA[E.historia.paso]; if (h && h.ok()) { E.historia.paso++; aviso('BITÁCORA ACTUALIZADA', HISTORIA[E.historia.paso]?.t || h.t, 4); audio.descubrir(); guardar(); } }
  tGuardar -= dt; if (tGuardar <= 0) { tGuardar = 20; guardar(); }
  fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    const fps = fpsN / fpsT; fpsN = 0; fpsT = 0;
    $('#fps').textContent = `${fps.toFixed(0)} FPS · ${planetas.reduce((s, p) => s + p.trozos, 0)} trozos${online.conectado ? ` · ${[...otros.values()].filter(o => o.obj.visible).length} jugadores` : ''}`;
    if (fps < 45 && escalaRes > 0.65) { escalaRes -= 0.1; renderer.setPixelRatio(dpr()); }
    else if (fps > 57 && escalaRes < 1) { escalaRes = Math.min(1, escalaRes + 0.05); renderer.setPixelRatio(dpr()); }
  }
  renderer.render(scene, camara);
}

function recoger(res) {
  if (!res?.recurso) return;
  if (cargaTotal() + res.n > capacidad()) { aviso('BODEGA LLENA', 'Vende en la estación o fabrica algo'); return; }
  anadir(res.recurso, res.n);
  if (res.recurso === 'cristal') E.minadoCristal = (E.minadoCristal || 0) + res.n;
  aviso(`+${res.n} ${res.recurso.toUpperCase()}`, '', 1);
}
function eventoCarrera(e) {
  if (e.tipo === 'inicio') { aviso('¡CARRERA!', 'Pasa por los 10 anillos'); audio.descubrir(); }
  else if (e.tipo === 'anillo') audio.boton();
  else if (e.tipo === 'fin') { const k = J.sector.join(','), mejor = !E.records[k] || e.t < E.records[k]; if (mejor) E.records[k] = e.t; E.creditos += 150; aviso(mejor ? '¡NUEVO RÉCORD!' : 'META', `${e.t.toFixed(2)} s · +150 créditos`); audio.descubrir(); guardar(); }
}
function evento(e) {
  audio.iniciar();
  if (e === 'cerrar') { if (J.enMenu) { cerrarPanel(); if (modo === 'atracado') desatracar(); } return; }
  if (J.enMenu && e !== 'mapa' && e !== 'inventario') return;
  if (e === 'camara') modoCam = (modoCam + 1) % 2;
  else if (e === 'mapa') { if (J.enMenu && modo !== 'atracado') cerrarPanel(); else if (modo !== 'atracado') abrirMenu('mapa'); }
  else if (e === 'inventario') { if (modo !== 'atracado') abrirMenu('inv'); }
  else if (e === 'escanear') escanear();
  else if (e === 'saltar') intentarSalto();
  else if (e === 'termica') { if (E.implantes.termica) { J.termica = !J.termica; aviso(J.termica ? 'VISIÓN TÉRMICA' : 'VISIÓN NORMAL', '', 1); } }
  else if (e === 'aterrizar') { const a = ambiente(nave.pos, cercano(nave.pos)); if (modo === 'nave' && a.atm > 0 && a.alt < 350 && nave.estado !== 'aterrizada') { nave.autoAterrizar = !nave.autoAterrizar; ctrl.acel = 0; } }
  else if (e === 'accion') {
    const acc = accionActual(ambiente(modo === 'pie' ? astro.pos : nave.pos, cercano(modo === 'pie' ? astro.pos : nave.pos)));
    if (!acc) return;
    if (acc[0] === 'bajar') bajarNave();
    else if (acc[0] === 'subir') subirNave();
    else if (acc[0] === 'atracar') atracar();
    else if (acc[0] === 'aterrizar') evento('aterrizar');
    else if (acc[0] === 'hackear') {
      const t = terminalCerca(); const id = t.r.id; E.hackeadas ??= [];
      if (E.hackeadas.includes(id)) { aviso('TERMINAL VACÍO', 'Ya lo hackeaste'); return; }
      J.enMenu = true;
      hackeo(sis.faccion.id === 'sind' ? 2 : 1, (ok) => { J.enMenu = false; if (ok) { E.hackeadas.push(id); E.hackeos = (E.hackeos || 0) + 1; const cr = sis.faccion.id === 'sind' ? 500 : 250; E.creditos += cr; E.reputacion.sind += 1; aviso('DATOS EXTRAÍDOS', `+${cr} créditos · fragmento de la Señal`); guardar(); } });
    }
  }
}

function actualizarPolvo(amb) {
  const g = polvo.geometry.attributes.position, p = g.array, b = polvo.userData.base, c = camara.position;
  const v = modo === 'nave' ? nave.vel : _v.set(0, 0, 0), sp = v.length();
  polvo.visible = modo === 'nave' && sp > 4 && !galaxia.salto;
  if (!polvo.visible) return;
  const largo = Math.min(14, sp * 0.03), dir = _w.copy(v).normalize();
  polvo.material.opacity = Math.min(0.6, sp / 200) * (amb.atm > 0 ? 0.6 : 1);
  for (let i = 0; i < b.length; i += 3) {
    // las motas están quietas en el mundo: al moverte pasan a tu lado (se nota avance y retroceso)
    let x = b[i] - c.x, y = b[i + 1] - c.y, z = b[i + 2] - c.z;
    if (Math.abs(x) > 80 || Math.abs(y) > 80 || Math.abs(z) > 80) { x = (Math.random() - 0.5) * 160; y = (Math.random() - 0.5) * 160; z = (Math.random() - 0.5) * 160; b[i] = c.x + x + dir.x * 60; b[i + 1] = c.y + y + dir.y * 60; b[i + 2] = c.z + z + dir.z * 60; }
    const j = i * 2;
    p[j] = b[i]; p[j + 1] = b[i + 1]; p[j + 2] = b[i + 2];
    p[j + 3] = b[i] - dir.x * largo; p[j + 4] = b[i + 1] - dir.y * largo; p[j + 5] = b[i + 2] - dir.z * largo;
  }
  g.needsUpdate = true;
}

function actualizarOtros(dt) {
  for (const [id, o] of online.otros) {
    let r = otros.get(id);
    if (!r) {
      const obj = o.m === 'pie' ? new Astronauta(scene, E).modelo : modeloNave('caza', { casco: '#3a3f5a', acento: '#b4ff39', luz: '#b4ff39' });
      obj.visible = true; if (o.m !== 'pie') scene.add(obj);
      const el = document.createElement('div'); el.className = 'etq'; el.style.setProperty('--c', '#b4ff39'); el.innerHTML = '<b></b><small>jugador</small><span></span>'; $('#etiquetas').appendChild(el);
      r = { obj, el, m: o.m }; otros.set(id, r);
    }
    if (o.fuera || performance.now() - o.t > 6000) { scene.remove(r.obj); r.el.remove(); otros.delete(id); online.otros.delete(id); continue; }
    r.obj.position.lerp(_v.set(...o.p), Math.min(1, dt * 8));
    r.obj.quaternion.slerp(new THREE.Quaternion(...o.q), Math.min(1, dt * 8));
    r.el.querySelector('b').textContent = o.nombre;
    proyectar(r.obj.position, r.el, km(r.obj.position.distanceTo(camara.position)));
  }
}

// ─── Arranque ──────────────────────────────────────────────────────────────────────────────
async function arrancar() {
  if (await sincronizar()) { nave.cambiarModelo(); }
  const sec = q.get('sector') ? q.get('sector').split(',').map(Number) : (E.sector || [0, 0, 0]);
  cargarSistema(sec.length === 3 && sec.every(Number.isFinite) ? sec : [0, 0, 0]);
  ctrl.ponerModo('nave');
  online.conectar(usuario() ? '@' + usuario() : 'Viajero');
  requestAnimationFrame(bucle);
  $('#carga').classList.add('oculta');
  setTimeout(() => aviso('BIENVENIDO A UPSTAR', 'Acelerador: W/S o la barra derecha · F para atracar en la estación', 5), 600);
  // horizontal: en el móvil se pide pantalla completa y orientación horizontal al primer toque
  addEventListener('pointerdown', () => { if (!movil || document.fullscreenElement) return; document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {}); }, { once: true });
}
arrancar();
window.upstar = { nave, astro, get planetas() { return planetas; }, camara, renderer, scene, cargarSistema, E, J, combate, criaturas, galaxia, estacion: () => estacion, evento };
