// Carrera profesional: empiezas en un equipo modesto, firmas contratos, desarrollas el
// coche con lo que ganas en pista, tienes un rival (tu compañero de equipo), atiendes a la
// prensa y al final de cada temporada te llegan ofertas según tu reputación. Lógica pura.

import { EQUIPOS } from './config.js';

// Fuerza de cada equipo (multiplica la habilidad de sus pilotos) y su nivel de partida en
// cada área del coche (0..5, como las mejoras). Orden de EQUIPOS en config.js.
export const FUERZA = [0.975, 0.99, 1.0, 0.995, 0.985, 0.965, 0.97, 0.955, 0.95, 0.945, 0.96];
export const AREAS = { aero: 'Aerodinámica', motor: 'Motor', chasis: 'Chasis', frenos: 'Frenos', ers: 'ERS', neumaticos: 'Gestión de neumáticos' };
const REPUTACION_MIN = (ie) => Math.round((FUERZA[ie] - 0.94) / 0.06 * 85);   // 0..85 según lo grande que sea el equipo

function azar(sem) { let s = (sem >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export function nueva(nombre) {
  const t = { v: 1, nombre, temporadaNum: 1, equipo: null, contrato: null, reputacion: 15, creditos: 0,
    desarrollo: {}, puntosDes: 0, rival: null, historial: [], noticias: [], ofertas: [], temp: null, pregunta: null };
  t.ofertas = generarOfertas(t, 1);
  t.noticias.unshift({ t: `Nace una promesa: ${nombre} busca su primer volante en la F1`, tipo: 'info' });
  return t;
}

/** Ofertas de equipos a los que llega tu reputación (los mejores, primero), con sueldo y objetivo. */
export function generarOfertas(t, semilla = Date.now()) {
  const r = azar(semilla);
  const posibles = EQUIPOS.map((e, ie) => ie).filter(ie => REPUTACION_MIN(ie) <= t.reputacion + 8 && ie !== t.equipo);
  posibles.sort((a, b) => FUERZA[b] - FUERZA[a]);
  return posibles.slice(0, 3).map(ie => {
    const f = (FUERZA[ie] - 0.94) / 0.06;
    return { equipo: ie, anios: r() < 0.5 ? 1 : 2, sueldo: Math.round(200 + f * 1800 + r() * 150),
      objetivo: Math.max(1, Math.round(10 - f * 8 + r() * 2)) };          // puesto mínimo en el mundial de pilotos
  });
}

export function firmar(t, oferta) {
  t.equipo = oferta.equipo;
  t.contrato = { anios: oferta.anios, sueldo: oferta.sueldo, objetivo: oferta.objetivo };
  // el coche llega con el nivel de desarrollo de su equipo
  const base = Math.round((FUERZA[oferta.equipo] - 0.94) / 0.06 * 3);
  t.desarrollo = Object.fromEntries(Object.keys(AREAS).map(k => [k, Math.min(5, base)]));
  t.rival = { nombre: EQUIPOS[oferta.equipo].pilotos[1], id: `${oferta.equipo}:1` };
  t.ofertas = [];
  t.noticias.unshift({ t: `🖊️ ${t.nombre} firma por ${EQUIPOS[oferta.equipo].nombre} (${oferta.anios} temporada${oferta.anios > 1 ? 's' : ''})`, tipo: 'fichaje' });
}

/** Ajusta la parrilla de una temporada: cada piloto rinde según la fuerza de su equipo. */
export function ajustarParrilla(temp, t) {
  const r = azar(temp.semilla);
  for (const p of temp.pilotos) {
    if (p.jugador) continue;
    p.hab = +(FUERZA[p.ie] * (0.985 + r() * 0.02)).toFixed(4);
    if (t.rival && p.ie === t.equipo) t.rival.id = p.id;
  }
  temp.trayectoria = true;
}

export function costeMejora(nivel) { return 2 + nivel * 2; }
export function invertir(t, area) {
  const n = t.desarrollo[area] ?? 0, c = costeMejora(n);
  if (n >= 5 || t.puntosDes < c) return false;
  t.desarrollo[area] = n + 1; t.puntosDes -= c;
  t.noticias.unshift({ t: `🔧 ${EQUIPOS[t.equipo].nombre} estrena mejoras de ${AREAS[area].toLowerCase()}`, tipo: 'desarrollo' });
  return true;
}

const PREGUNTAS = [
  { q: '¿Qué le ha faltado hoy para estar más arriba?', r: [['Ritmo: el coche necesita mejoras', -1, 'El equipo no se lo toma muy bien'], ['He cometido errores, mejoraré', 2, 'La afición valora la autocrítica'], ['Nada, ha sido una gran carrera', 0, '']] },
  { q: '¿Cómo va la relación con tu compañero?', r: [['Es mi primer rival a batir', 1, 'La prensa adora la rivalidad'], ['Trabajamos juntos por el equipo', 2, 'El equipo te ve como un líder'], ['Prefiero no hablar de eso', -1, 'Silencio incómodo en la sala']] },
  { q: 'Se rumorea interés de otros equipos, ¿estás contento aquí?', r: [['Mi futuro está aquí', 2, 'El equipo agradece tu compromiso'], ['Escucharé todas las ofertas', 1, 'Los jefes de equipo toman nota'], ['Solo pienso en la próxima carrera', 0, '']] },
];

/** Tras cada GP: reputación, puntos de desarrollo, créditos, titulares y una pregunta de la prensa. */
export function trasCarrera(t, { pos, abandono, rivalPos, puntos, gp, nPilotos }) {
  const t0 = t.reputacion;
  const rel = abandono ? 0 : Math.max(0, 1 - (pos - 1) / Math.max(1, nPilotos - 1));
  t.reputacion = Math.max(0, Math.min(100, t.reputacion + (abandono ? -2 : Math.round(rel * 6 - 2 + (pos <= 3 ? 3 : 0)))));
  t.puntosDes += abandono ? 1 : Math.round(1 + rel * 4);
  t.creditos += Math.round((t.contrato?.sueldo || 0) / 7 + puntos * 20);
  const eq = EQUIPOS[t.equipo].nombre, tit = [];
  if (abandono) tit.push(`💥 Fin de semana para olvidar: ${t.nombre} abandona en ${gp}`);
  else if (pos === 1) tit.push(`🏆 ¡${t.nombre} gana en ${gp}! Exhibición con el ${eq}`);
  else if (pos <= 3) tit.push(`🥂 Podio para ${t.nombre} en ${gp}`);
  else if (pos <= 10) tit.push(`${t.nombre} suma puntos en ${gp} (P${pos})`);
  else tit.push(`${t.nombre} se queda sin puntos en ${gp} (P${pos})`);
  if (rivalPos != null && !abandono) tit.push(pos < rivalPos ? `⚔️ ${t.nombre} vuelve a batir a ${t.rival.nombre} en el duelo interno` : `⚔️ ${t.rival.nombre} se impone a ${t.nombre} en el duelo del ${eq}`);
  for (const x of tit) t.noticias.unshift({ t: x, tipo: 'carrera' });
  t.noticias = t.noticias.slice(0, 30);
  t.historial.push({ temporada: t.temporadaNum, gp, pos: abandono ? null : pos, rivalPos });
  t.pregunta = PREGUNTAS[(t.historial.length + t.temporadaNum) % PREGUNTAS.length];
  return { titulares: tit, reputacion: t.reputacion - t0 };
}

export function responder(t, k) {
  const r = t.pregunta?.r?.[k];
  if (!r) return '';
  t.reputacion = Math.max(0, Math.min(100, t.reputacion + r[1]));
  t.pregunta = null;
  if (r[2]) t.noticias.unshift({ t: `🎤 «${r[0]}» — ${r[2]}`, tipo: 'prensa' });
  return r[2];
}

/** Fin de temporada: se mira el objetivo del contrato, se cobra y llegan ofertas. */
export function finTemporada(t, posMundial) {
  const ok = posMundial <= (t.contrato?.objetivo || 10);
  t.reputacion = Math.max(0, Math.min(100, t.reputacion + (ok ? 10 : -6) + (posMundial === 1 ? 15 : 0)));
  t.noticias.unshift({ t: ok ? `✅ Objetivo cumplido: P${posMundial} en el Mundial` : `❌ Objetivo no cumplido (P${posMundial}): el equipo esperaba más`, tipo: 'temporada' });
  if (t.contrato) t.contrato.anios--;
  t.temporadaNum++;
  t.temp = null;
  // ofertas: si el contrato sigue y se cumplió el objetivo, el equipo también renueva
  t.ofertas = generarOfertas(t, t.temporadaNum * 977);
  if (t.contrato?.anios > 0 && ok) t.ofertas.unshift({ equipo: t.equipo, anios: t.contrato.anios, sueldo: Math.round(t.contrato.sueldo * 1.1), objetivo: Math.max(1, t.contrato.objetivo - 1), renovar: true });
  else if (t.contrato?.anios > 0) t.ofertas.unshift({ equipo: t.equipo, anios: t.contrato.anios, sueldo: t.contrato.sueldo, objetivo: t.contrato.objetivo, renovar: true });
  return ok;
}
