// Escuela de pilotaje: lecciones cortas en Valle Andino con la línea de trazada, objetivos
// claros y medallas (bronce, plata, oro). Al acabar recomienda las ayudas según cómo se ha
// conducido. Lógica pura: el juego le pasa el estado del coche cada fotograma.

export const LECCIONES = [
  { id: 'frenada', titulo: 'Acelerar y frenar', icono: '🛑',
    texto: 'A fondo por la recta hasta pasar de 250 km/h y frena en la zona roja para tomar la T1 sin salirte.',
    radio: 'Primera lección: a fondo por la recta. Cuando la línea se ponga roja, frena fuerte y en línea recta, y gira cuando la línea vuelva a amarilla.',
    inicio: { s: 60, d: 0 }, fin: 760, curvas: ['T1 La Cumbre'], medallas: [22.6, 17.9, 17.25] },
  { id: 'trazada', titulo: 'La trazada', icono: '〰️',
    texto: 'Sigue la línea por las curvas T2, T3 y T4: abierto a la entrada, al vértice y abierto a la salida.',
    radio: 'Segunda lección: la trazada. Fuera, dentro, fuera. Sigue la línea pintada y no pises la hierba.',
    inicio: { s: 860, d: 0 }, fin: 1330, curvas: ['T2', 'T3', 'T4'], medallas: [15.1, 12.3, 11.8] },
  { id: 'horquilla', titulo: 'Frenada a la horquilla', icono: '↩️',
    texto: 'La curva más lenta: frena tarde pero recto, gira despacio y acelera progresivamente a la salida.',
    radio: 'Tercera lección: la horquilla. Frena recto, suelta el freno poco a poco al girar y no aceleres a fondo hasta enderezar.',
    inicio: { s: 2930, d: 0 }, fin: 3600, curvas: ['T7 Los Andes', 'T8 Horquilla', 'T8b'], medallas: [28.4, 22.9, 21.95] },
  { id: 'chicane', titulo: 'Chicane y Parabólica', icono: '⚡',
    texto: 'Pasa la chicane sin saltarte los pianos altos y sal rápido de la Parabólica hasta la meta.',
    radio: 'Cuarta lección: la chicane. Usa los pianos bajos, no los altos, y prepara la salida de la Parabólica: ahí se gana la recta.',
    inicio: { s: 3700, d: 0 }, fin: 4356 + 40, curvas: ['T10 Chicane', 'T11 Chicane', 'T12 Parabólica'], medallas: [21.5, 17.8, 17.1] },
  { id: 'vuelta', titulo: 'Vuelta completa', icono: '🏁',
    texto: 'Junta todo en una vuelta lanzada válida (sin salirte de los límites).',
    radio: 'Última lección: una vuelta completa. Todo lo aprendido junto. ¡Vamos!',
    inicio: { s: 4356 - 350, d: 0 }, vuelta: true, medallas: [108.6, 86.7, 83.1] },
];

export const NOMBRE_MEDALLA = ['', '🥉 Bronce', '🥈 Plata', '🥇 Oro'];

export class Leccion {
  constructor(def, circuito) {
    this.def = def; this.c = circuito;
    this.t = 0; this.estado = 'corre';          // corre | ok | fallo
    this.salidas = 0; this.trompos = 0; this.maxV = 0; this.motivo = '';
    this.recorrido = 0; this.sPrev = null; this._fuera = false;
  }

  /** car: el coche del jugador; vueltaValida: evento de vuelta completada (solo la lección «vuelta»). */
  actualizar(dt, car, ev = {}) {
    if (this.estado !== 'corre') return this.estado;
    this.t += dt;
    const c = this.c, s = car.proj.s;
    if (this.sPrev != null) { let d = s - this.sPrev; if (d < -c.largo / 2) d += c.largo; else if (d > c.largo / 2) d -= c.largo; this.recorrido += d; }
    this.sPrev = s;
    const v = car.velocidad * 3.6;
    this.maxV = Math.max(this.maxV, v);
    // salidas de pista (cuatro ruedas fuera) y trompos
    const fuera = car.ruedas.every(w => w.sup >= 2);
    if (fuera && !this._fuera) this.salidas++;
    this._fuera = fuera;
    if (Math.abs(Math.atan2(car.vy, Math.max(0.5, Math.abs(car.vx)))) > 1.1 && car.velocidad > 6) { if (!this._trompo) this.trompos++; this._trompo = true; } else this._trompo = false;
    if (car.abandono) return this._fallo('Coche demasiado dañado');
    if (this.def.vuelta) {
      if (ev.vuelta) return ev.vuelta.valida ? this._ok(ev.vuelta.t) : this._fallo('Vuelta anulada por los límites de pista');
      if (this.t > 200) return this._fallo('Se acabó el tiempo');
      return 'corre';
    }
    if (this.salidas > 0) return this._fallo('Te has salido de la pista');
    if (this.trompos > 0) return this._fallo('Trompo');
    if (this.def.id === 'frenada' && this.recorrido > 200 && this.maxV < 250 && this.recorrido > 560) return this._fallo('No llegaste a 250 km/h: ¡a fondo en la recta!');
    const objetivo = this.def.fin - this.def.inicio.s;
    if (this.recorrido >= objetivo) return this._ok(this.t);
    if (this.t > this.def.medallas[0] * 1.8) return this._fallo('Demasiado lento');
    return 'corre';
  }

  _ok(t) {
    this.estado = 'ok'; this.tiempo = t;
    const [b, p, o] = this.def.medallas;
    this.medalla = t <= o ? 3 : t <= p ? 2 : t <= b ? 1 : 1;
    return 'ok';
  }
  _fallo(m) { this.estado = 'fallo'; this.motivo = m; return 'fallo'; }
}

/** Ayudas recomendadas según las lecciones (salidas, trompos y medallas). */
export function recomendar(progreso) {
  const res = Object.values(progreso);
  const fallos = res.reduce((a, r) => a + (r.fallos || 0), 0);
  const oros = res.filter(r => r.medalla === 3).length;
  if (fallos >= 6 || res.length < 2) return { tc: 3, abs: true, linea: true, direccion: true, texto: 'Te recomendamos control de tracción alto, ABS, línea de trazada y dirección asistida mientras te acostumbras.' };
  if (oros >= 4 && fallos <= 2) return { tc: 0, abs: false, linea: false, direccion: false, texto: '¡Pilotas como un profesional! Prueba sin ayudas: más rápido y más divertido.' };
  if (oros >= 2) return { tc: 1, abs: true, linea: false, direccion: false, texto: 'Buen nivel: control de tracción bajo y ABS. Quita la línea de trazada.' };
  return { tc: 2, abs: true, linea: true, direccion: true, texto: 'Control de tracción medio, ABS y línea de trazada en las frenadas te ayudarán a ser constante.' };
}
