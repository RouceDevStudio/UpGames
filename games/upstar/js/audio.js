// Sonido generado por código (sin archivos): motor de la nave, viento de la atmósfera, música
// ambiental distinta en cada planeta (acordes a partir de su semilla) y efectos.
import { azar } from './ruido.js';
import { AJ } from './ajustes.js';

export class Audio {
  constructor() { this.ctx = null; }
  iniciar() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const c = this.ctx = new C();
    this.maestro = c.createGain(); this.maestro.gain.value = AJ.vol; this.maestro.connect(c.destination);
    // ruido blanco compartido
    const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.ruido = b;
    const lazo = (tipo, f, q) => { const s = c.createBufferSource(); s.buffer = b; s.loop = true; const fl = c.createBiquadFilter(); fl.type = tipo; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(this.maestro); s.start(); return { fl, g }; };
    this.viento = lazo('lowpass', 500, 0.7);
    this.chorro = lazo('bandpass', 900, 0.8);
    // motor: dos osciladores desafinados y un zumbido grave
    this.motorG = c.createGain(); this.motorG.gain.value = 0; this.motorG.connect(this.maestro);
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 700; fl.connect(this.motorG); this.motorF = fl;
    this.osc = [55, 55.7, 110.4].map((f, k) => { const o = c.createOscillator(); o.type = k === 2 ? 'square' : 'sawtooth'; o.frequency.value = f; const g = c.createGain(); g.gain.value = k === 2 ? 0.08 : 0.3; o.connect(g); g.connect(fl); o.start(); return o; });
    // música ambiental
    this.musicaG = c.createGain(); this.musicaG.gain.value = 0; this.musicaG.connect(this.maestro);
    const rev = c.createConvolver(); const ir = c.createBuffer(2, c.sampleRate * 3, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / x.length, 3); }
    rev.buffer = ir; this.rev = rev; rev.connect(this.musicaG);
    this.semMusica = null; this.tNota = 0;
  }
  /** Cada frame: estado de la nave y del entorno. */
  actualizar(dt, { empuje = 0, vel = 0, densidad = 0, aPie = false, semillaPlaneta = null, dentro = false }) {
    const c = this.ctx; if (!c) return; const t = c.currentTime;
    const motor = aPie ? 0 : 0.05 + empuje * 0.14;
    this.motorG.gain.setTargetAtTime(motor, t, 0.2);
    this.osc.forEach((o, k) => o.frequency.setTargetAtTime((k === 2 ? 110 : 55) * (1 + empuje * 0.9 + Math.min(1, vel / 600) * 0.4) * (k === 1 ? 1.013 : 1), t, 0.25));
    this.motorF.frequency.setTargetAtTime(400 + empuje * 1600, t, 0.2);
    this.chorro.g.gain.setTargetAtTime(aPie ? 0 : empuje * 0.05, t, 0.2);
    this.viento.g.gain.setTargetAtTime(Math.min(0.32, densidad * (aPie ? 0.08 : Math.min(1, vel / 250) * 0.35)), t, 0.3);
    this.viento.fl.frequency.setTargetAtTime(300 + vel * 3, t, 0.3);
    // música: acordes lentos con la semilla del planeta (o del espacio)
    const sem = dentro ? semillaPlaneta : 1;
    if (sem !== this.semMusica) { this.semMusica = sem; this.escala = this._escala(sem); }
    this.musicaG.gain.setTargetAtTime(0.18 * AJ.musica, t, 2);
    this.maestro.gain.setTargetAtTime(AJ.vol, t, 0.1);
    this.tNota -= dt;
    if (this.tNota <= 0) { this.tNota = 3.5 + Math.random() * 3; this._acorde(); }
  }
  _escala(sem) {
    const r = azar(sem * 7 + 3), raiz = 110 * Math.pow(2, Math.floor(r() * 7) / 12);
    const modos = [[0, 3, 7, 10, 14], [0, 2, 7, 9, 14], [0, 4, 7, 11, 16], [0, 3, 5, 10, 15]];
    return modos[Math.floor(r() * modos.length)].map(s => raiz * Math.pow(2, s / 12));
  }
  _acorde() {
    const c = this.ctx, t = c.currentTime, esc = this.escala;
    for (let k = 0; k < 3; k++) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = esc[Math.floor(Math.random() * esc.length)] * (k === 0 ? 0.5 : 1);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 1.5); g.gain.linearRampToValueAtTime(0, t + 6);
      o.connect(g); g.connect(this.rev); o.start(t); o.stop(t + 6.2);
    }
  }
  _tono(f0, f1, dur, tipo = 'square', vol = 0.15) {
    const c = this.ctx; if (!c) return; const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = tipo; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.maestro); o.start(t); o.stop(t + dur + 0.02);
  }
  _ruido(dur, f, vol = 0.4) {
    const c = this.ctx; if (!c) return; const t = c.currentTime, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.ruido; fl.type = 'lowpass'; fl.frequency.setValueAtTime(f, t); fl.frequency.exponentialRampToValueAtTime(60, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(this.maestro); s.start(t); s.stop(t + dur);
  }
  laser() { this._tono(1600, 220, 0.18, 'sawtooth', 0.08); }
  laserEnemigo() { this._tono(900, 140, 0.22, 'square', 0.05); }
  explosion(f = 1) { this._ruido(1.2 * f, 1800, 0.6 * f); this._tono(90, 30, 0.9, 'sine', 0.4 * f); }
  golpe(f = 1) { this._ruido(0.35, 900, 0.5 * f); }
  escaner() { this._tono(400, 2200, 0.6, 'sine', 0.12); setTimeout(() => this._tono(2200, 2200, 0.08, 'sine', 0.08), 650); }
  descubrir() { [523, 659, 784, 1046].forEach((f, k) => setTimeout(() => this._tono(f, f, 0.25, 'triangle', 0.1), k * 110)); }
  alarma() { this._tono(880, 660, 0.25, 'square', 0.07); }
  salto() { this._tono(60, 1400, 2.4, 'sawtooth', 0.12); this._ruido(3, 4000, 0.3); }
  minar() { this._tono(300 + Math.random() * 80, 260, 0.08, 'square', 0.03); }
  recoger() { this._tono(880, 1320, 0.12, 'triangle', 0.08); }
  criatura() { const f = 300 + Math.random() * 900; this._tono(f, f * (0.6 + Math.random()), 0.3, 'triangle', 0.06); }
  trueno() { this._ruido(2.5, 400, 0.7); }
  boton() { this._tono(1200, 1200, 0.04, 'square', 0.04); }
}
