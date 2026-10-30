// Clima: intensidad de la lluvia y agua sobre la pista (que tarda en acumularse
// y en secarse). Determinista con una semilla para que en línea llueva igual para todos.

function azar(semilla) {
  let s = (semilla >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export const CLIMAS = { seco: 'Seco', lluvia: 'Lluvia', variable: 'Variable' };

export class Clima {
  constructor(modo = 'seco', semilla = 1) {
    this.modo = CLIMAS[modo] ? modo : 'seco';
    this.t = 0;
    const r = azar(semilla);
    if (this.modo === 'lluvia') { this.lluvia = 0.55 + r() * 0.3; this.agua = this.lluvia * 0.9; this.plan = []; }
    else if (this.modo === 'variable') {
      // empieza seco (o casi), llega un chubasco y luego escampa
      this.lluvia = 0; this.agua = 0;
      const ini = 50 + r() * 150, dur = 160 + r() * 260;
      this.plan = [{ t: ini, lluvia: 0.45 + r() * 0.45 }, { t: ini + dur, lluvia: 0 }];
    } else { this.lluvia = 0; this.agua = 0; this.plan = []; }
    this.objetivo = this.lluvia;
    // la lluvia no cae en todo el circuito a la vez: el frente entra por un punto (centro, 0..1
    // del recorrido) y se extiende; cobertura = parte del circuito bajo la lluvia
    this.centro = r();
    this.cobertura = this.modo === 'lluvia' ? 1 : 0;
    // nubes que pasan tapando el sol (seco: pocas; variable: muchas; lluvia: cielo cubierto)
    this.nubes = this.modo === 'variable' ? 0.7 : this.modo === 'seco' ? 0.3 : 0;
  }

  /** Parte del agua que hay en el punto u (0..1 del recorrido): 1 bajo la lluvia, 0 en seco. */
  factor(u) {
    if (this.cobertura >= 1) return 1;
    let d = Math.abs(u - this.centro); d = Math.min(d, 1 - d);
    const mitad = this.cobertura / 2;
    return d <= mitad ? 1 : Math.max(0, 1 - (d - mitad) / 0.06);
  }

  /** Sombra de las nubes que pasan (0..1) en el instante t. */
  sombraNubes() {
    if (!this.nubes) return 0;
    const t = this.t;
    const v = Math.sin(t * 0.021) * 0.5 + Math.sin(t * 0.047 + 1.3) * 0.3 + Math.sin(t * 0.11 + 2.1) * 0.2;
    return this.nubes * Math.min(1, Math.max(0, (v + 0.15) * 2.2));
  }

  get mojado() { return this.agua > 0.05; }

  actualizar(dt) {
    this.t += dt;
    while (this.plan.length && this.t >= this.plan[0].t) this.objetivo = this.plan.shift().lluvia;
    // la lluvia cambia de intensidad en ~20 s
    this.lluvia += (this.objetivo - this.lluvia) * Math.min(1, dt / 20);
    if (this.objetivo === 0 && this.lluvia < 0.005) this.lluvia = 0;
    // el frente avanza por el circuito en ~2 min; se retira cuando la pista se seca
    if (this.objetivo > 0 || this.lluvia > 0.02) this.cobertura = Math.min(1, this.cobertura + dt / 120);
    else if (this.agua < 0.03) this.cobertura = Math.max(0, this.cobertura - dt / 60);
    // el agua se acumula en ~1,5 min y se seca en ~5 min (los coches abren una trazada seca)
    if (this.lluvia > this.agua) this.agua += (this.lluvia - this.agua) * dt / 90;
    else this.agua = Math.max(0, this.agua - dt / 300 * (1 - this.lluvia));
  }

  // próximo cambio, para la radio del ingeniero (segundos hasta que empiece o pare)
  pronostico() {
    const p = this.plan[0];
    return p ? { en: p.t - this.t, lluvia: p.lluvia } : null;
  }
}
