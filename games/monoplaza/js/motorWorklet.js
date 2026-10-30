// Motor V6 turbo sintetizado por modelado físico simplificado (AudioWorklet).
// Cada explosión de cada cilindro excita unos resonadores (colector, escape y carrocería);
// después un tubo con realimentación da el color del escape. La admisión es ruido
// modulado por el ciclo. Al levantar a altas vueltas hay detonaciones en el escape y
// al cambiar de marcha, corte de encendido.

const DOS_PI = Math.PI * 2;
// pequeñas diferencias entre cilindros: dan la textura "áspera" de un motor real
const CILINDROS = [1.0, 0.92, 1.06, 0.95, 1.03, 0.9];

class Resonador {
  constructor() { this.y1 = 0; this.y2 = 0; this.a1 = 0; this.a2 = 0; this.g = 0; }
  ajustar(f, q, sr) {
    const w = DOS_PI * Math.min(f, sr * 0.45) / sr, r = Math.exp(-w / (2 * q));
    this.a1 = 2 * r * Math.cos(w); this.a2 = -r * r; this.g = (1 - r * r) * 0.5;
  }
  paso(x) { const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}

class MotorApex extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 4000, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'carga', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'corte', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'brillo', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'tono', defaultValue: 1, minValue: 0.2, maxValue: 3, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.fase = 0;                       // 0..1 a lo largo del ciclo de 720° (6 explosiones)
    this.ruidoEnv = 0;                   // envolvente del ruido de combustión
    this.petardo = 0;                    // envolvente de una detonación en el escape
    this.rpmS = 4000; this.cargaS = 0;
    this.colector = new Resonador(); this.escape = new Resonador(); this.rasp = new Resonador(); this.cuerpo = new Resonador(); this.petR = new Resonador();
    const sr = sampleRate;
    this.tubo = new Float32Array(Math.ceil(sr * 0.02)); this.iTubo = 0;
    this.lp = 0; this.adm = 0; this.dc = 0; this.dcx = 0;
    this.k = 0;
  }

  process(_in, outputs, p) {
    const out = outputs[0][0];
    if (!out) return true;
    const sr = sampleRate;
    const rpmObj = p.rpm[0] * p.tono[0], cargaObj = p.carga[0], corte = p.corte[0], brillo = p.brillo[0];
    // resonancias que suben con las vueltas (presión y temperatura de los gases)
    if ((this.k++ & 3) === 0) {
      const r = this.rpmS;
      this.colector.ajustar(95 + r * 0.012, 0.8, sr);
      this.escape.ajustar(340 + r * 0.035, 1.3, sr);
      this.rasp.ajustar(1500 + r * 0.09, 1.6, sr);
      this.cuerpo.ajustar(62, 0.7, sr);
      this.petR.ajustar(140, 1.2, sr);
    }
    const dTubo = Math.floor(sr * (0.0042 - Math.min(0.0015, this.rpmS * 0.0000001)));
    for (let n = 0; n < out.length; n++) {
      this.rpmS += (rpmObj - this.rpmS) * 0.0015;
      this.cargaS += (cargaObj - this.cargaS) * 0.002;
      // ciclo de cuatro tiempos: dos vueltas de cigüeñal, seis explosiones
      const antes = Math.floor(this.fase * 6);
      this.fase += this.rpmS / 60 / 2 / sr;
      if (this.fase >= 1) this.fase -= 1;
      const cil = Math.floor(this.fase * 6);
      let exc = 0;
      if (cil !== antes) {
        const enciende = corte < 0.5 && !(this.cargaS < 0.04 && Math.random() < 0.35);
        if (enciende) {
          const a = (0.28 + 0.72 * this.cargaS) * CILINDROS[cil] * (0.93 + Math.random() * 0.14);
          exc = a;
          this.ruidoEnv = Math.max(this.ruidoEnv, a);
        } else if (this.rpmS > 7500 && Math.random() < 0.05 + 0.1 * corte) {
          // combustible sin quemar que explota en el escape
          this.petardo = 0.9 + Math.random() * 0.8;
        }
      }
      this.ruidoEnv *= 0.975;
      this.petardo *= 0.9975;
      const ruido = (Math.random() * 2 - 1);
      const comb = exc * 4 + ruido * this.ruidoEnv * 0.35;
      let x = this.colector.paso(comb) * 1.4 + this.escape.paso(comb) * 1.0 + this.rasp.paso(comb) * (0.25 + 0.5 * brillo) + this.cuerpo.paso(comb) * 0.6;
      x += this.petR.paso(ruido * this.petardo) * 3.5 + ruido * this.petardo * 0.25;
      // tubo de escape: eco corto con realimentación (coloración de tubo)
      const eco = this.tubo[(this.iTubo - dTubo + this.tubo.length) % this.tubo.length];
      const y = x + eco * 0.42;
      this.tubo[this.iTubo] = y; this.iTubo = (this.iTubo + 1) % this.tubo.length;
      // admisión: silbido de aire modulado por el ciclo (se oye sobre todo a bordo)
      this.adm += ((ruido * (0.15 + 0.85 * this.cargaS)) - this.adm) * 0.25;
      let s = y * (0.55 + 0.45 * brillo) + this.adm * 0.08 * (1 - brillo) * (0.6 + 0.4 * Math.sin(this.fase * DOS_PI * 6));
      // filtro de paso bajo suave: más apagado a bordo y lejos
      this.lp += (s - this.lp) * (0.25 + 0.6 * brillo);
      s = this.lp;
      // quitar continua y saturar
      this.dc = s - this.dcx + 0.995 * this.dc; this.dcx = s;
      out[n] = Math.tanh(this.dc * 1.6) * 0.8;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor('motor-apex', MotorApex);
