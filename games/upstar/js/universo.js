// El universo entero sale de fórmulas: un sector es una terna de enteros (x, y, z) y de ella
// salen su estrella, sus planetas, sus nombres, sus colores y el relieve de cada punto de cada
// planeta. Como los enteros no se acaban, los sistemas tampoco; y como es determinista, todos los
// jugadores ven exactamente el mismo universo sin que se guarde ni se envíe nada.

import { hash, azar, crearRuido } from './ruido.js';

const SILABAS = ['ka', 'ze', 'ri', 'no', 'vax', 'lu', 'tor', 'ny', 'xe', 'qua', 'mi', 'dra', 'sol', 'vek', 'ion', 'ra', 'thu', 'zan', 'ex', 'ul', 'kai', 'ne', 'or', 'syn', 'ar', 'vo', 'lys', 'ce', 'pho', 'nyx'];
const SUFIJOS = ['', '', '', ' Prime', ' IX', ' VII', '-7', ' Neo', ' X', ' Zero'];

export function nombre(semilla, conSufijo = true) {
  const r = azar(semilla), n = 2 + Math.floor(r() * 2);
  let s = ''; for (let i = 0; i < n; i++) s += SILABAS[Math.floor(r() * SILABAS.length)];
  s = s[0].toUpperCase() + s.slice(1);
  return conSufijo ? s + SUFIJOS[Math.floor(r() * SUFIJOS.length)] : s;
}

// Paletas cyberpunk por tipo de planeta: [fondo marino, playa/bajo, medio, alto, cima]
export const TIPOS = {
  neon:     { nombre: 'Neón',      pal: ['#1a0b3d', '#2de2e6', '#7b2ff7', '#f72585', '#fef9ff'], cielo: '#ff4fd8', mar: '#0a1a5c', agua: true },
  toxico:   { nombre: 'Tóxico',    pal: ['#0b2b1a', '#c6ff00', '#39d353', '#1b7f5a', '#e8ffd6'], cielo: '#9dff4f', mar: '#0d3b2a', agua: true },
  desierto: { nombre: 'Desierto',  pal: ['#3b1c0a', '#ffb347', '#ff7b3d', '#c4452d', '#ffe3c2'], cielo: '#ff8f5a', mar: '#3b1c0a', agua: false },
  helado:   { nombre: 'Helado',    pal: ['#0a1f3d', '#9bf6ff', '#a0c4ff', '#6c7bff', '#ffffff'], cielo: '#7fd1ff', mar: '#123a6b', agua: true },
  volcan:   { nombre: 'Volcánico', pal: ['#1a0505', '#ff3d00', '#3a1f2b', '#22121a', '#ff9e00'], cielo: '#ff5a36', mar: '#ff3d00', agua: true, lava: true },
  cristal:  { nombre: 'Cristal',   pal: ['#140a2e', '#00f5d4', '#00bbf9', '#9b5de5', '#f15bb5'], cielo: '#00f5d4', mar: '#14094a', agua: true },
};
const LISTA_TIPOS = Object.keys(TIPOS);

export const FACCIONES = [
  { id: 'corp', nombre: 'Corporación Nova', color: '#00f0ff', piratas: 0.15, precio: 0.85, desc: 'Orden, comercio y estaciones bien surtidas. Pagan por cazar piratas.' },
  { id: 'sind', nombre: 'Sindicato de Datos', color: '#ff2e88', piratas: 0.55, precio: 1.15, desc: 'Piratas y hackers. Peligroso, pero los terminales pagan el doble.' },
  { id: 'ia',   nombre: 'Colectivo IA', color: '#b4ff39', piratas: 0.3, precio: 1.0, desc: 'Mentes sintéticas. Venden los mejores implantes.' },
];
const estrellaColor = (s) => ['#ffd27a', '#ff9e6b', '#9ad7ff', '#ff6bd6', '#fff3c4', '#b18cff'][hash(s, 3) % 6];
export const colorEstrella = (x, y, z) => estrellaColor(hash(x, y, z, 7));
const CLIMAS = ['despejado', 'tormenta', 'acido', 'ventisca', 'calor'];

/** La Señal: un punto fijo del universo hacia el que tira la historia. */
export const SENAL = [0, 0, -48];
/** Sector de la expedición de la semana (cambia cada lunes). */
export function expedicionSemana(ahora = Date.now()) {
  const semana = Math.floor((ahora / 86400000 + 3) / 7);
  const r = azar(hash(semana, 77));
  return { semana, sector: [Math.floor(r() * 13) - 6, Math.floor(r() * 5) - 2, Math.floor(r() * 13) - 6] };
}

/** Sistema estelar del sector (x, y, z). Distancias en metros. */
export function sistema(x, y, z) {
  const sem = hash(x, y, z, 7);
  const r = azar(sem);
  const n = 2 + Math.floor(r() * 3);
  const sis = { sector: [x, y, z], semilla: sem, nombre: nombre(hash(sem, 1), false), planetas: [] };
  // la estrella está en el centro del sistema (0, 0, 0); los planetas orbitan a su alrededor
  sis.estrella = { color: estrellaColor(sem), radio: 9000 + r() * 7000 };
  sis.faccion = FACCIONES[Math.floor(r() * FACCIONES.length)];
  let orbita = 30000;
  for (let i = 0; i < n; i++) {
    orbita += 28000 + r() * 26000;
    const ang = r() * Math.PI * 2;
    sis.planetas.push(planeta(hash(sem, 100 + i), [Math.cos(ang) * orbita, (r() - 0.5) * 8000, Math.sin(ang) * orbita], i));
  }
  // estación espacial en órbita del primer planeta y su circuito de anillos
  const p0 = sis.planetas[0], a0 = r() * Math.PI * 2, d0 = p0.radio * 2.6;
  sis.estacion = { pos: [p0.pos[0] + Math.cos(a0) * d0, p0.pos[1] + p0.radio * 0.6, p0.pos[2] + Math.sin(a0) * d0], nombre: `Estación ${nombre(hash(sem, 9), false)}` };
  sis.anillos = [];
  { let pp = sis.estacion.pos.slice(), dir = [Math.cos(a0 + 1.6), 0, Math.sin(a0 + 1.6)];
    for (let k = 0; k < 10; k++) {
      dir = [dir[0] + (r() - 0.5) * 0.9, (r() - 0.5) * 0.5, dir[2] + (r() - 0.5) * 0.9];
      const l = Math.hypot(...dir); dir = dir.map(v => v / l);
      pp = [pp[0] + dir[0] * (900 + r() * 500), pp[1] + dir[1] * 600, pp[2] + dir[2] * (900 + r() * 500)];
      sis.anillos.push({ pos: pp.slice(), dir: dir.slice() });
    } }
  // el primero, cerca del punto de llegada para que el viaje empiece con un planeta a la vista
  return sis;
}

export function planeta(semilla, pos, i = 0) {
  const r = azar(semilla);
  const tipo = LISTA_TIPOS[Math.floor(r() * LISTA_TIPOS.length)], T = TIPOS[tipo];
  const radio = 2600 + r() * 3200;
  return {
    ...T, tipoNombre: T.nombre,
    semilla, pos, indice: i, tipo, radio,
    nombre: nombre(hash(semilla, 2)),
    amplitud: radio * (0.028 + r() * 0.04),
    nivelMar: T.agua ? 0.0 + r() * 0.12 : -10,     // en unidades de la amplitud
    escala: 1.4 + r() * 1.6,                        // continentes grandes o pequeños
    montes: 0.6 + r() * 0.9,
    anillos: r() < 0.3,
    gravedad: 6 + r() * 7,
    lunas: Math.floor(r() * 3),
    climas: [CLIMAS[0], CLIMAS[1 + Math.floor(r() * 4)]],   // alterna entre despejado y su clima propio
    ciudad: r() < 0.45 ? [r() - 0.5, r() - 0.5, r() - 0.5] : null,
    ruinas: [0, 1, 2, 3].map(() => [r() - 0.5, r() - 0.5, r() - 0.5]),
    especies: [0, 1, 2, 3, 4, 5].map(k => especie(hash(semilla, 500 + k), tipo)),
  };
}

/** Especie de criatura por piezas, a partir de su semilla. */
export function especie(sem, tipo) {
  const r = azar(sem), pal = TIPOS[tipo].pal;
  const vuela = r() < 0.22;
  const tam = vuela ? 0.6 + r() * 1.6 : r() < 0.15 ? 4 + r() * 5 : 0.5 + r() * 2.2;
  const comp = r();
  return {
    sem, nombre: nombre(hash(sem, 1), false) + ' ' + ['minor', 'magnus', 'vulgaris', 'lux', 'umbra', 'neon', 'ferox'][Math.floor(r() * 7)],
    vuela, tam, patas: vuela ? 0 : [2, 4, 4, 6][Math.floor(r() * 4)],
    cuerpo: [0.8 + r() * 0.8, 0.5 + r() * 0.6, 0.6 + r() * 0.9], cuello: r() * 0.6, cabeza: 0.35 + r() * 0.35,
    color: pal[1 + Math.floor(r() * 4)], acento: ['#00f0ff', '#ff2e88', '#b4ff39', '#ffd23f', '#ffffff'][Math.floor(r() * 5)],
    cuernos: r() < 0.4, cola: r() < 0.6, ojos: 1 + Math.floor(r() * 3),
    temperamento: comp < 0.5 ? 'pacífica' : comp < 0.8 ? 'huidiza' : 'agresiva',
    dieta: ['herbívora', 'carnívora', 'omnívora', 'litófaga', 'fotosintética'][Math.floor(r() * 5)],
    rareza: r() < 0.6 ? 'común' : r() < 0.85 ? 'rara' : 'legendaria',
    velocidad: 2 + r() * 5,
  };
}

/** Relieve de un planeta: altura (m sobre el radio) en la dirección unitaria (dx, dy, dz). */
export function crearRelieve(p) {
  const R = crearRuido(p.semilla), e = p.escala;
  return function altura(dx, dy, dz) {
    const cont = R.fbm(dx * e, dy * e, dz * e, 5);                       // continentes
    const m = R.crestas(dx * e * 3.1 + 7, dy * e * 3.1, dz * e * 3.1, 5);  // cordilleras
    const masc = Math.min(1, Math.max(0, cont * 2.2 + 0.25));
    const det = R.fbm(dx * 60, dy * 60, dz * 60, 3) * 0.035;               // detalle cercano
    let h = cont * 0.55 + m * masc * p.montes * 0.9 + det;
    // mesetas en los desiertos (terrazas)
    if (p.tipo === 'desierto') { const t = h * 6; h = (Math.floor(t) + Math.pow(t - Math.floor(t), 4)) / 6; }
    return h * p.amplitud;
  };
}

/** Color del suelo según altura relativa (0 = nivel del mar), pendiente y latitud. */
export function colorSuelo(p, hRel, pendiente, lat, out) {
  const pal = p.pal;
  const mar = p.nivelMar * p.amplitud;
  const u = (hRel - mar) / p.amplitud;                    // ~0 costa, ~1 cumbres
  let a, b, t;
  if (u < 0) { a = 0; b = 1; t = Math.max(0, 1 + u * 4); }
  else if (u < 0.08) { a = 1; b = 2; t = u / 0.08; }
  else if (u < 0.45) { a = 2; b = 3; t = (u - 0.08) / 0.37; }
  else { a = 3; b = 4; t = Math.min(1, (u - 0.45) / 0.4 + Math.abs(lat) * 0.4); }
  // escalones nítidos (estilo de dibujo): pocas bandas de color, sin degradados largos
  t = Math.round(t * 3) / 3;
  const ca = pal[a], cb = pal[b];
  for (let k = 0; k < 3; k++) {
    const va = parseInt(ca.substr(1 + k * 2, 2), 16) / 255, vb = parseInt(cb.substr(1 + k * 2, 2), 16) / 255;
    out[k] = va + (vb - va) * t;
  }
  // las laderas empinadas, de roca más oscura
  const roca = Math.min(1, Math.max(0, (pendiente - 0.35) * 2.5));
  for (let k = 0; k < 3; k++) out[k] = out[k] * (1 - roca * 0.55);
  return out;
}
