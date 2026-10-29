// Campeonato (temporada de varios Grandes Premios con puntos de pilotos y
// constructores) y clasificación Q1-Q2-Q3. Lógica pura, sin DOM.

import { EQUIPOS } from './config.js';

export const PUNTOS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const PUNTO_VUELTA_RAPIDA = 1;          // si termina entre los 10 primeros
export const HABILIDAD = { facil: [0.9, 0.93], normal: [0.94, 0.97], dificil: [0.97, 1.0], extremo: [1.0, 1.03] };

function azar(semilla) {
  let s = (semilla >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Pilotos de la parrilla: el jugador en su equipo y los rivales con una habilidad fija
 * (en un campeonato cada piloto conserva su nivel toda la temporada).
 * Devuelve [{ id, nombre, ie, ip, hab, jugador }]
 */
export function crearPilotos({ rivales = 7, dificultad = 'normal', equipoJugador = 0, nombre = 'Tú', semilla = 1 } = {}) {
  const r = azar(semilla);
  const ej = Math.max(0, Math.min(EQUIPOS.length - 1, equipoJugador | 0));
  const asientos = [];
  for (let k = 0; k < EQUIPOS.length; k++) if (k !== ej) asientos.push([k, 0]);
  asientos.push([ej, 1]);
  for (let k = 0; k < EQUIPOS.length; k++) if (k !== ej) asientos.push([k, 1]);
  const [hMin, hMax] = HABILIDAD[dificultad] || HABILIDAD.normal;
  const n = Math.min(rivales, EQUIPOS.length * 2 - 1);
  const out = [{ id: 'jugador', nombre, ie: ej, ip: 0, hab: 1, jugador: true }];
  for (let k = 0; k < n; k++) {
    const [ie, ip] = asientos[k];
    out.push({ id: `${ie}:${ip}`, nombre: EQUIPOS[ie].pilotos[ip], ie, ip, hab: +(hMax - (hMax - hMin) * (k / Math.max(1, n - 1)) + (r() - 0.5) * 0.01).toFixed(4), jugador: false });
  }
  return out;
}

// ─── Clasificación ──────────────────────────────────────────────────────────
/** Cuántos quedan fuera en Q1 y Q2 según el tamaño de la parrilla (22 → 6 y 6, quedan 10 para Q3). */
export function eliminados(n) {
  if (n <= 4) return [0, 0];
  if (n <= 8) return [Math.floor(n / 4), Math.floor(n / 4)];
  return [Math.round(n * 0.27), Math.round(n * 0.27)];
}

/** Tiempo simulado de un rival en una tanda: ritmo base / habilidad con algo de dispersión. */
export function tiempoSimulado(ritmo, hab, r, tanda = 0) {
  const error = r() < 0.08 ? 0.4 + r() * 1.2 : 0;               // a veces una vuelta con un error
  const mejora = 1 - tanda * 0.0015;                              // la pista mejora en cada tanda
  return +((ritmo / hab) * mejora * (1 + (r() - 0.5) * 0.006) + error).toFixed(3);
}

export class Clasificacion {
  constructor(pilotos, { ritmo, semilla = 1 } = {}) {
    this.pilotos = pilotos.map(p => ({ ...p, tiempos: [null, null, null], fuera: null }));
    this.ritmo = ritmo;
    this.r = azar(semilla);
    this.tanda = 0;            // 0 = Q1, 1 = Q2, 2 = Q3
    this.fin = false;
    this.cortes = eliminados(pilotos.length);
  }
  get vivos() { return this.pilotos.filter(p => p.fuera == null); }
  get jugador() { return this.pilotos.find(p => p.jugador); }
  /** Cierra la tanda actual con el tiempo del jugador (null = sin tiempo). */
  cerrarTanda(tiempoJugador) {
    const k = this.tanda;
    for (const p of this.vivos) p.tiempos[k] = p.jugador ? (tiempoJugador ?? null) : tiempoSimulado(this.ritmo, p.hab, this.r, k);
    const orden = this.ordenTanda(k);
    if (k < 2) {
      const n = this.cortes[k];
      orden.slice(orden.length - n).forEach(p => { p.fuera = k; });
    }
    this.tanda++;
    if (this.tanda > 2 || this.vivos.length <= 1) this.fin = true;
    return orden;
  }
  ordenTanda(k) {
    return this.pilotos.filter(p => p.fuera == null || p.fuera >= k)
      .sort((a, b) => (a.tiempos[k] ?? Infinity) - (b.tiempos[k] ?? Infinity));
  }
  /** Parrilla final: Q3, luego los eliminados en Q2 y en Q1 (cada grupo por su tiempo). */
  parrilla() {
    const grupo = k => this.pilotos.filter(p => (k === 2 ? p.fuera == null : p.fuera === k))
      .sort((a, b) => (a.tiempos[k] ?? Infinity) - (b.tiempos[k] ?? Infinity));
    return [...grupo(2), ...grupo(1), ...grupo(0)];
  }
}

// ─── Temporada ──────────────────────────────────────────────────────────────
export function crearTemporada({ rondas = ['valle', 'puerto', 'veloz'], vueltas = 5, rivales = 11, dificultad = 'normal', clima = 'auto', equipoJugador = 0, nombre = 'Tú' } = {}) {
  const semilla = Math.floor(Math.random() * 1e9);
  return {
    v: 1, semilla, rondas, ronda: 0, opc: { vueltas, rivales, dificultad, clima },
    pilotos: crearPilotos({ rivales, dificultad, equipoJugador, nombre, semilla }).map(p => ({ ...p, puntos: 0, victorias: 0, podios: 0, mejor: null })),
    carreras: [], terminada: false, premios: 0,
  };
}

/** Clima de cada ronda en modo 'auto': determinista por temporada. */
export function climaRonda(t, k = t.ronda) {
  if (t.opc.clima !== 'auto') return t.opc.clima;
  const r = azar(t.semilla + k * 7919);
  const x = r();
  return x < 0.62 ? 'seco' : x < 0.85 ? 'variable' : 'lluvia';
}

/**
 * Suma los puntos de una carrera. resultado: [{ id, pos, abandono, vueltaRapida }]
 * Devuelve los puntos ganados por cada id.
 */
export function registrarCarrera(t, resultado) {
  const ganados = {};
  for (const r of resultado) {
    const p = t.pilotos.find(x => x.id === r.id);
    if (!p) continue;
    let pts = r.abandono ? 0 : PUNTOS[r.pos - 1] || 0;
    if (r.vueltaRapida && !r.abandono && r.pos <= 10) pts += PUNTO_VUELTA_RAPIDA;
    p.puntos += pts;
    if (!r.abandono && r.pos === 1) p.victorias++;
    if (!r.abandono && r.pos <= 3) p.podios++;
    if (!r.abandono && (p.mejor == null || r.pos < p.mejor)) p.mejor = r.pos;
    ganados[r.id] = pts;
  }
  t.carreras.push({ circuito: t.rondas[t.ronda], resultado: resultado.map(r => ({ id: r.id, pos: r.pos, abandono: !!r.abandono })) });
  t.ronda++;
  if (t.ronda >= t.rondas.length) t.terminada = true;
  return ganados;
}

export function tablaPilotos(t) {
  return [...t.pilotos].sort((a, b) => b.puntos - a.puntos || b.victorias - a.victorias || b.podios - a.podios || (a.mejor ?? 99) - (b.mejor ?? 99));
}

export function tablaConstructores(t) {
  const eq = new Map();
  for (const p of t.pilotos) {
    const e = eq.get(p.ie) || { ie: p.ie, nombre: EQUIPOS[p.ie].nombre, base: EQUIPOS[p.ie].base, puntos: 0, victorias: 0 };
    e.puntos += p.puntos; e.victorias += p.victorias;
    eq.set(p.ie, e);
  }
  return [...eq.values()].sort((a, b) => b.puntos - a.puntos || b.victorias - a.victorias);
}
