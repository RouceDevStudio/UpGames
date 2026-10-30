// Progresión del piloto: experiencia y nivel, temporada mensual con escalones, tres misiones
// diarias (iguales para todos ese día) y logros. El juego le avisa de lo que pasa con
// evento(tipo, datos) y devuelve lo que se ha completado para mostrarlo. Lógica pura.

export const LOGROS = [
  { id: 'primera', icono: '🏁', nombre: 'Bandera a cuadros', desc: 'Termina tu primera carrera' },
  { id: 'victoria', icono: '🏆', nombre: 'Primera victoria', desc: 'Gana una carrera' },
  { id: 'victorias10', icono: '👑', nombre: 'Dominador', desc: 'Gana 10 carreras' },
  { id: 'podio', icono: '🥂', nombre: 'Al podio', desc: 'Termina entre los tres primeros' },
  { id: 'pole', icono: '⏱️', nombre: 'Pole position', desc: 'Sal desde la pole tras la clasificación' },
  { id: 'hattrick', icono: '🎩', nombre: 'Hat-trick', desc: 'Pole, victoria y vuelta rápida en el mismo GP' },
  { id: 'remontada', icono: '🚀', nombre: 'Remontada', desc: 'Gana 8 posiciones en una carrera' },
  { id: 'lluvia', icono: '🌧️', nombre: 'Maestro de la lluvia', desc: 'Gana una carrera con lluvia' },
  { id: 'limpia', icono: '✨', nombre: 'Carrera limpia', desc: 'Termina una carrera de 5+ vueltas sin daños ni sanciones' },
  { id: 'parada', icono: '🔧', nombre: 'Parada relámpago', desc: 'Haz una parada en boxes de menos de 2,5 s' },
  { id: 'adelantos50', icono: '⚔️', nombre: 'Cazador', desc: 'Adelanta a 50 coches en total' },
  { id: 'vueltas100', icono: '🔁', nombre: 'Kilometraje', desc: 'Completa 100 vueltas' },
  { id: 'km1000', icono: '🛣️', nombre: 'Mil kilómetros', desc: 'Recorre 1000 km en total' },
  { id: 'escuela', icono: '🎓', nombre: 'Licenciado', desc: 'Oro en todas las lecciones de la escuela' },
  { id: 'campeon', icono: '🌍', nombre: 'Campeón del mundo', desc: 'Gana un campeonato' },
  { id: 'resistencia', icono: '🌙', nombre: 'Resistencia', desc: 'Termina una carrera de resistencia de 30 min o más' },
  { id: 'circuitos', icono: '🗺️', nombre: 'Trotamundos', desc: 'Corre en los 13 circuitos' },
  { id: 'online', icono: '🌐', nombre: 'En línea', desc: 'Termina una carrera multijugador' },
  { id: 'creador', icono: '✏️', nombre: 'Diseñador', desc: 'Crea y corre en tu propio circuito' },
  { id: 'nivel10', icono: '⭐', nombre: 'Veterano', desc: 'Llega al nivel 10' },
];

// misiones posibles: [id, texto con {n}, valores de n, xp]
const MISIONES = [
  ['vueltas', 'Completa {n} vueltas', [5, 8, 12], 120],
  ['carrera', 'Termina {n} carreras', [1, 2, 3], 150],
  ['top5', 'Termina en el top 5 {n} veces', [1, 2], 180],
  ['podio', 'Sube al podio {n} vez', [1], 220],
  ['adelantos', 'Adelanta a {n} coches', [5, 10, 15], 160],
  ['limpias', 'Haz {n} vueltas válidas seguidas', [3, 5], 170],
  ['parada', 'Haz una parada de menos de {n} s', [3.2, 2.9], 140],
  ['km', 'Recorre {n} km', [25, 50], 130],
  ['escuela', 'Consigue {n} medallas en la escuela', [1, 2], 120],
  ['online', 'Termina {n} carrera en línea', [1], 200],
];

const XP_NIVEL = (n) => 400 + n * 150;                 // xp para pasar del nivel n al n+1
export const ESCALONES_TEMPORADA = 30;
const XP_ESCALON = 500;

function azar(sem) { let s = (sem >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export const diaDe = (f = new Date()) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
export const temporadaDe = (f = new Date()) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;

/** Las tres misiones del día (las mismas para todos los jugadores ese día). */
export function misionesDelDia(dia) {
  const r = azar([...dia].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  const idx = MISIONES.map((m, k) => k).sort(() => r() - 0.5).slice(0, 3);
  return idx.map(k => { const [id, txt, ns, xp] = MISIONES[k]; const n = ns[Math.floor(r() * ns.length)]; return { id, texto: txt.replace('{n}', String(n).replace('.', ',')), n, xp, prog: 0, hecha: false }; });
}

export function nueva() {
  return { v: 1, xp: 0, nivel: 1, xpNivel: 0, temporada: temporadaDe(), xpTemporada: 0, dia: null, misiones: [], logros: {}, stats: { carreras: 0, victorias: 0, vueltas: 0, km: 0, adelantos: 0, circuitos: [] }, rachaLimpia: 0 };
}

export class Progresion {
  constructor(datos) {
    this.d = Object.assign(nueva(), datos || {});
    this.d.stats = Object.assign(nueva().stats, this.d.stats || {});
    this.revisarDia();
  }
  get nivel() { return this.d.nivel; }
  get escalon() { return Math.min(ESCALONES_TEMPORADA, Math.floor(this.d.xpTemporada / XP_ESCALON)); }

  /** Cambio de día o de mes: misiones nuevas y temporada nueva. */
  revisarDia(ahora = new Date()) {
    const dia = diaDe(ahora), temp = temporadaDe(ahora);
    if (this.d.dia !== dia) { this.d.dia = dia; this.d.misiones = misionesDelDia(dia); }
    if (this.d.temporada !== temp) { this.d.temporada = temp; this.d.xpTemporada = 0; }
  }

  _xp(n, out) {
    const d = this.d;
    d.xp += n; d.xpTemporada += n; d.xpNivel += n;
    while (d.xpNivel >= XP_NIVEL(d.nivel)) { d.xpNivel -= XP_NIVEL(d.nivel); d.nivel++; out.push({ tipo: 'nivel', nivel: d.nivel }); if (d.nivel >= 10) this._logro('nivel10', out); }
  }
  _logro(id, out) {
    if (this.d.logros[id]) return;
    this.d.logros[id] = Date.now();
    const l = LOGROS.find(x => x.id === id);
    if (l) { out.push({ tipo: 'logro', logro: l }); this._xp(250, out); }
  }
  _mision(id, valor, out, modo = 'suma') {
    for (const m of this.d.misiones) {
      if (m.id !== id || m.hecha) continue;
      if (modo === 'max') m.prog = Math.max(m.prog, valor);
      else if (modo === 'menor') m.prog = valor <= m.n ? m.n : m.prog;
      else m.prog = Math.min(m.n, m.prog + valor);
      if (m.prog >= m.n) { m.hecha = true; out.push({ tipo: 'mision', mision: m }); this._xp(m.xp, out); }
    }
  }

  /**
   * tipo: 'vuelta' {valida} · 'km' {km} · 'adelanto' · 'parada' {seg} · 'carrera' {pos, n, parrilla, lluvia,
   * limpia, vueltas, vr, pole, enLinea, circuito, comunidad, resistencia} · 'campeon' · 'leccion' {medalla, todasOro}
   */
  evento(tipo, x = {}) {
    this.revisarDia();
    const out = [], s = this.d.stats;
    if (tipo === 'vuelta') {
      s.vueltas++; this._xp(10, out); this._mision('vueltas', 1, out);
      this.d.rachaLimpia = x.valida ? this.d.rachaLimpia + 1 : 0;
      this._mision('limpias', this.d.rachaLimpia, out, 'max');
      if (s.vueltas >= 100) this._logro('vueltas100', out);
    } else if (tipo === 'km') {
      s.km += x.km; this._mision('km', x.km, out);
      if (s.km >= 1000) this._logro('km1000', out);
    } else if (tipo === 'adelanto') {
      s.adelantos++; this._mision('adelantos', 1, out);
      if (s.adelantos >= 50) this._logro('adelantos50', out);
    } else if (tipo === 'parada') {
      this._mision('parada', x.seg, out, 'menor');
      if (x.seg < 2.5) this._logro('parada', out);
    } else if (tipo === 'carrera') {
      s.carreras++;
      this._xp(80 + Math.max(0, (x.n - x.pos + 1)) * 12 + (x.pos === 1 ? 150 : 0), out);
      this._mision('carrera', 1, out);
      this._logro('primera', out);
      if (x.pos <= 5) this._mision('top5', 1, out);
      if (x.pos <= 3) { this._mision('podio', 1, out); this._logro('podio', out); }
      if (x.pos === 1) { s.victorias++; this._logro('victoria', out); if (s.victorias >= 10) this._logro('victorias10', out); if (x.lluvia) this._logro('lluvia', out); if (x.pole && x.vr) this._logro('hattrick', out); }
      if (x.pole) this._logro('pole', out);
      if (x.parrilla - x.pos >= 8) this._logro('remontada', out);
      if (x.limpia && x.vueltas >= 5) this._logro('limpia', out);
      if (x.enLinea) { this._mision('online', 1, out); this._logro('online', out); }
      if (x.comunidad) this._logro('creador', out);
      if (x.resistencia) this._logro('resistencia', out);
      if (x.circuito && !s.circuitos.includes(x.circuito)) { s.circuitos.push(x.circuito); if (s.circuitos.length >= 13) this._logro('circuitos', out); }
    } else if (tipo === 'campeon') this._logro('campeon', out);
    else if (tipo === 'leccion') { this._mision('escuela', 1, out); this._xp(40 * (x.medalla || 1), out); if (x.todasOro) this._logro('escuela', out); }
    return out;
  }

  xpParaSiguiente() { return XP_NIVEL(this.d.nivel); }
}
