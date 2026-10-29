// Modelo de neumático: "Magic Formula" de Pacejka con deslizamiento combinado
// normalizado, sensibilidad a la carga, ventana térmica de dos capas y desgaste.

const C_FORMA = 1.45;                                  // caída tras el pico ≈ 76 %
const B_FORMA = Math.tan(Math.PI / (2 * C_FORMA));     // pico exacto en σ = 1
const FZ_NOMINAL = 3500;                               // N
const SENS_CARGA = 0.085;                              // pérdida de μ por unidad de carga relativa

export function formaPacejka(sigma) {
  return Math.sin(C_FORMA * Math.atan(B_FORMA * sigma));
}

// Coeficiente de fricción efectivo según la carga vertical
export function muCarga(mu0, fz) {
  const f = 1 - SENS_CARGA * (fz / FZ_NOMINAL - 1);
  return mu0 * Math.max(0.62, Math.min(1.12, f));
}

// Fuerzas del neumático en su propio sistema (x hacia delante, y hacia la derecha).
// kappa: deslizamiento longitudinal; tanAlfa: tangente del ángulo de deriva.
// Devuelve fuerzas en `out` y la magnitud normalizada del deslizamiento.
export function fuerzasNeumatico(kappa, tanAlfa, fz, mu, kappaPico, tanAlfaPico, out) {
  if (fz <= 0) { out.fx = 0; out.fy = 0; out.sigma = 0; return out; }
  const sx = kappa / kappaPico;
  const sy = tanAlfa / tanAlfaPico;
  const sigma = Math.hypot(sx, sy);
  out.sigma = sigma;
  if (sigma < 1e-9) { out.fx = 0; out.fy = 0; return out; }
  const d = mu * fz;
  const f = d * formaPacejka(sigma) / sigma;
  // la fuerza lateral es algo menor que la longitudinal a igual deslizamiento normalizado
  out.fx = f * sx;
  out.fy = -f * sy * 0.97;
  return out;
}

export class Neumatico {
  constructor(compuesto, presion = 5) {
    this.ponerCompuesto(compuesto, presion);
    this.tSup = 72;       // °C superficie (mantas)
    this.tNucleo = 70;    // °C carcasa
    this.desgaste = 0;    // 0 nuevo .. 1 destruido
    this.bloqueo = 0;     // plano por bloqueo (vibración)
  }

  ponerCompuesto(c, presion = 5) {
    this.c = c;
    this.presion = presion;
    const dp = 5 - presion;
    this.factorMuPresion = 1 + dp * 0.004;
    this.factorCalorPresion = 1 + dp * 0.05;
    this.factorDesgastePresion = 1 - dp * 0.03;
    this.picoAlfa = Math.tan(0.095 * (1 + dp * 0.012));
    this.picoKappa = 0.095;
    this.mejoraMu = this.mejoraMu ?? 1;
    this.mejoraDesgaste = this.mejoraDesgaste ?? 1;
  }

  // Agarre por temperatura y desgaste
  factorAgarre() {
    const t = 0.65 * this.tSup + 0.35 * this.tNucleo;
    const x = (t - this.c.tOpt) / this.c.ancho;
    const termico = 0.80 + 0.20 * Math.exp(-x * x);
    const w = this.desgaste;
    const desg = w < 0.75 ? 1 - 0.12 * w : 1 - 0.09 - 0.6 * (w - 0.75);
    return termico * Math.max(0.55, desg) * this.factorMuPresion * this.mejoraMu;
  }

  // potenciaDeslizamiento en W, fz en N, v en m/s
  termico(dt, potenciaDeslizamiento, fz, v, tAmb, agua = 0) {
    const calor = potenciaDeslizamiento * 0.55 * this.c.calor * this.factorCalorPresion * (1 - 0.4 * agua)
      + Math.max(0, fz) * v * 0.0027 * this.factorCalorPresion;
    // el agua que levanta la rueda la enfría muchísimo (evaporación)
    const hAire = (20 + 1.05 * v) * (1 + 2.2 * agua);
    const kCond = 90;
    const cSup = 3800, cNuc = 26000;
    this.tSup += (calor - kCond * (this.tSup - this.tNucleo) - hAire * (this.tSup - tAmb)) / cSup * dt;
    this.tNucleo += (kCond * (this.tSup - this.tNucleo) - 6 * (this.tNucleo - tAmb)) / cNuc * dt;
    // el desgaste se acelera fuera de la ventana térmica
    const sobre = Math.max(0, this.tSup - this.c.tOpt - 20) / 40;
    // los de lluvia sobre pista seca se destrozan; el agua lubrica y apenas gasta los lisos
    const seco = this.c.lluvia ? 1 + 3 * Math.max(0, 0.25 - agua) * 4 : 1 - 0.5 * Math.min(1, agua);
    this.desgaste += potenciaDeslizamiento * 2.4e-8 * this.c.desgaste * this.factorDesgastePresion * this.mejoraDesgaste * (1 + sobre) * seco * dt;
    if (this.desgaste > 1) this.desgaste = 1;
  }
}
