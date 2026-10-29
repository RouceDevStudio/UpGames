// Sonido sintetizado con Web Audio: motor V6 turbo, neumáticos, viento,
// bordillos, grava, petardeos al levantar, cambios, golpes y semáforo.

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

function bufferRuido(ctx, seg = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seg, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function curvaSaturacion(k = 2.5) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

class VozMotor {
  constructor(ctx, destino, ruido, completo = true) {
    this.ctx = ctx;
    this.salida = ctx.createGain(); this.salida.gain.value = 0;
    this.filtro = ctx.createBiquadFilter(); this.filtro.type = 'lowpass'; this.filtro.Q.value = 0.9;
    const sat = ctx.createWaveShaper(); sat.curve = curvaSaturacion(2.2); sat.oversample = '2x';
    this.mezcla = ctx.createGain(); this.mezcla.gain.value = 0.5;
    this.mezcla.connect(sat); sat.connect(this.filtro); this.filtro.connect(this.salida); this.salida.connect(destino);
    const osc = (tipo, g) => {
      const o = ctx.createOscillator(); o.type = tipo;
      const gg = ctx.createGain(); gg.gain.value = g;
      o.connect(gg); gg.connect(this.mezcla); o.start();
      return { o, g: gg };
    };
    this.o1 = osc('sawtooth', 0.55);   // frecuencia de encendido
    // timbre de V6 turbo: armónicos de encendido con los de orden 1,5 marcados
    try {
      const n = 16, re = new Float32Array(n), im = new Float32Array(n);
      const amp = [0, 1, 0.62, 0.48, 0.3, 0.26, 0.18, 0.12, 0.1, 0.07, 0.05, 0.04, 0.03, 0.02, 0.015, 0.01];
      for (let k = 1; k < n; k++) im[k] = amp[k] * (k % 3 === 0 ? 1.25 : 1);
      this.o1.o.setPeriodicWave(ctx.createPeriodicWave(re, im));
    } catch { /* navegador sin PeriodicWave: diente de sierra */ }
    this.o2 = osc('square', 0.18);     // segundo armónico
    this.o3 = osc('sine', 0.5);        // fundamental del cigüeñal
    // irregularidad de combustión: un vibrato rápido y pequeño
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 23;
    this.gLfo = ctx.createGain(); this.gLfo.gain.value = 0;
    this.lfo.connect(this.gLfo); this.gLfo.connect(this.o1.o.frequency); this.lfo.start();
    // resonancia del escape: un filtro de pico que sigue a las vueltas
    this.escape = ctx.createBiquadFilter(); this.escape.type = 'peaking'; this.escape.Q.value = 2.2; this.escape.gain.value = 7;
    this.filtro.disconnect(); this.filtro.connect(this.escape); this.escape.connect(this.salida);
    if (completo) {
      this.o4 = osc('triangle', 0.22); // armónico 1.5 (carácter V6)
      // aspereza de combustión: ruido filtrado alrededor de la frecuencia de encendido
      const src = ctx.createBufferSource(); src.buffer = ruido; src.loop = true;
      this.bp = ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.Q.value = 1.6;
      this.gRuido = ctx.createGain(); this.gRuido.gain.value = 0;
      src.connect(this.bp); this.bp.connect(this.gRuido); this.gRuido.connect(this.mezcla); src.start();
    }
  }

  ajustar(rpm, carga, volumen, t, tono = 1) {
    const f = rpm / 60 * 3 * tono; // V6 cuatro tiempos: 3 encendidos por vuelta
    const T = 0.03;
    this.o1.o.frequency.setTargetAtTime(f, t, T);
    this.o2.o.frequency.setTargetAtTime(f * 2, t, T);
    this.o3.o.frequency.setTargetAtTime(f / 3, t, T);
    if (this.o4) {
      this.o4.o.frequency.setTargetAtTime(f * 1.5, t, T);
      this.bp.frequency.setTargetAtTime(f * 2.2, t, T);
      this.gRuido.gain.setTargetAtTime(0.12 + carga * 0.35, t, 0.05);
    }
    this.filtro.frequency.setTargetAtTime(500 + carga * 4200 + rpm * 0.28, t, 0.04);
    this.escape.frequency.setTargetAtTime(180 + rpm * 0.055, t, 0.05);
    this.gLfo.gain.setTargetAtTime(f * (0.004 + (1 - carga) * 0.01), t, 0.1);
    this.salida.gain.setTargetAtTime(volumen * (0.32 + 0.68 * carga), t, 0.04);
  }
}

export class Sonido {
  constructor() {
    this.ctx = null;
    this.volumen = 0.8;
    this.acelPrevio = 0;
    this.listo = false;
  }

  iniciar() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.ruido = bufferRuido(ctx);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.maestro = ctx.createGain(); this.maestro.gain.value = this.volumen;
    this.maestro.connect(comp); comp.connect(ctx.destination);

    this.motor = new VozMotor(ctx, this.maestro, this.ruido, true);
    this.rival = new VozMotor(ctx, this.maestro, this.ruido, false);
    // turbo
    this.turbo = ctx.createOscillator(); this.turbo.type = 'sine';
    this.gTurbo = ctx.createGain(); this.gTurbo.gain.value = 0;
    this.turbo.connect(this.gTurbo); this.gTurbo.connect(this.maestro); this.turbo.start();
    const lazo = (tipo, f, q) => {
      const s = ctx.createBufferSource(); s.buffer = this.ruido; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = tipo; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.maestro); s.start(ctx.currentTime + Math.random());
      return { f: fl, g };
    };
    this.chirrido = lazo('bandpass', 1100, 7);
    this.bloqueo = lazo('bandpass', 1650, 9);
    this.viento = lazo('lowpass', 400, 0.5);
    this.grava = lazo('lowpass', 900, 0.7);
    this.rodadura = lazo('lowpass', 160, 0.8);
    // bordillo: zumbido grave
    this.bord = ctx.createOscillator(); this.bord.type = 'square'; this.bord.frequency.value = 38;
    this.gBord = ctx.createGain(); this.gBord.gain.value = 0;
    const fb = ctx.createBiquadFilter(); fb.type = 'lowpass'; fb.frequency.value = 220;
    this.bord.connect(fb); fb.connect(this.gBord); this.gBord.connect(this.maestro); this.bord.start();
    // ambiente: público, lluvia y megafonía (mezclados aparte para poder apagarlos)
    this.ambiente = ctx.createGain(); this.ambiente.gain.value = 1; this.ambiente.connect(this.maestro);
    const lazoA = (tipo, f, q) => {
      const s = ctx.createBufferSource(); s.buffer = this.ruido; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = tipo; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.ambiente); s.start(ctx.currentTime + Math.random());
      return { f: fl, g };
    };
    this.publico = lazoA('bandpass', 900, 0.8);
    this.publico2 = lazoA('bandpass', 2100, 1.4);
    this.lluvia = lazoA('highpass', 2600, 0.4);
    this.spray = lazoA('bandpass', 1400, 0.6);
    this.cercaGrada = 0;
    this.listo = true;
  }

  // ovación del público (salida, adelantamientos, meta)
  ovacion(fuerza = 1) {
    if (!this.listo) return;
    const t = this.ctx.currentTime;
    for (const l of [this.publico, this.publico2]) {
      l.g.gain.cancelScheduledValues(t);
      l.g.gain.setTargetAtTime(0.16 * fuerza, t, 0.25);
      l.g.gain.setTargetAtTime(0.03, t + 1.6 + fuerza, 1.2);
    }
  }

  // ding-dong de megafonía antes de un anuncio
  campana() {
    if (!this.listo) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [[784, 0], [622, 0.38]].forEach(([f, r]) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t + r); g.gain.linearRampToValueAtTime(0.16, t + r + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + r + 1.1);
      o.connect(g); g.connect(this.ambiente); o.start(t + r); o.stop(t + r + 1.2);
    });
  }

  // chasquido y estática de la radio del equipo
  radio(fin = false) {
    if (!this.listo) return;
    this._rafaga(fin ? 0.09 : 0.14, 2400, 'bandpass', 0.18);
    this.pitido(fin ? 1250 : 1650, 0.06, 0.06);
  }

  ponerAmbiente(on) { if (this.ambiente) this.ambiente.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.2); }

  ponerVolumen(v) {
    this.volumen = v;
    if (this.maestro) this.maestro.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  silenciar(si) {
    if (!this.ctx) return;
    if (si) this.ctx.suspend(); else this.ctx.resume();
  }

  // estallido corto (petardeo, golpe, cambio)
  _rafaga(dur, freq, tipo, vol, retraso = 0) {
    const ctx = this.ctx, t = ctx.currentTime + retraso;
    const s = ctx.createBufferSource(); s.buffer = this.ruido;
    const f = ctx.createBiquadFilter(); f.type = tipo; f.frequency.value = freq; f.Q.value = 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.maestro);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  pitido(f = 880, dur = 0.16, vol = 0.25) {
    if (!this.listo) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.value = f; o.type = 'sine';
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.maestro); o.start(t); o.stop(t + dur + 0.02);
  }

  evento(nombre, valor = 0) {
    if (!this.listo) return;
    if (nombre === 'cambio') { this._rafaga(0.05, 2500, 'highpass', 0.12); }
    else if (nombre === 'golpe') { this._rafaga(0.35, 300, 'lowpass', clamp(valor / 12, 0.2, 1.2)); this._rafaga(0.15, 3000, 'bandpass', clamp(valor / 25, 0.1, 0.5)); }
    else if (nombre === 'contacto') { this._rafaga(0.18, 900, 'bandpass', clamp(valor / 15, 0.1, 0.6)); }
    else if (nombre === 'luz') this.pitido(660, 0.14, 0.18);
    else if (nombre === 'salida') this.pitido(1320, 0.3, 0.2);
    else if (nombre === 'vuelta') this.pitido(990, 0.12, 0.12);
  }

  actualizar(dt, car, rivalCercano, camara, entorno = {}) {
    if (!this.listo) return;
    const t = this.ctx.currentTime;
    // ambiente: murmullo del público cerca de las gradas, lluvia y agua levantada por las ruedas
    const lluvia = entorno.lluvia || 0, agua = entorno.agua || 0;
    const base = 0.012 + 0.03 * (entorno.grada || 0);
    if (this.publico.g.gain.value < base + 0.01) { this.publico.g.gain.setTargetAtTime(base, t, 0.6); this.publico2.g.gain.setTargetAtTime(base * 0.5, t, 0.6); }
    this.lluvia.g.gain.setTargetAtTime(lluvia * 0.09, t, 0.5);
    this.spray.g.gain.setTargetAtTime(agua * Math.min(1, car.velocidad / 60) * 0.12, t, 0.2);
    const v = car.velocidad;
    const acel = car.mandos.acelerador * (car.tc ?? 1);
    const carga = car.limitador ? 0.35 : clamp(acel, 0, 1);
    this.motor.ajustar(car.rpm, carga, 0.55, t);
    this.turbo.frequency.setTargetAtTime(1800 + car.rpm * 0.42, t, 0.08);
    this.gTurbo.gain.setTargetAtTime(0.012 * carga * car.rpm / 15000, t, 0.1);
    // petardeos al levantar el pie a altas vueltas
    if (this.acelPrevio > 0.6 && acel < 0.15 && car.rpm > 9000) {
      const n = 2 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) this._rafaga(0.04 + Math.random() * 0.05, 600 + Math.random() * 900, 'bandpass', 0.25 + Math.random() * 0.3, k * (0.05 + Math.random() * 0.08));
    }
    this.acelPrevio = acel;
    // neumáticos
    let chir = 0, bloq = 0, tierra = 0, bord = 0;
    for (const w of car.ruedas) {
      const exceso = clamp((w.sigma - 1.05) * 1.6, 0, 1) * clamp(w.deslizamiento / 6, 0, 1);
      if (w.sup <= 2) {
        if (w.kappa < -0.5) bloq = Math.max(bloq, clamp(-w.kappa, 0, 1) * clamp(v / 20, 0, 1));
        else chir = Math.max(chir, exceso);
      } else tierra = Math.max(tierra, clamp(v / 40, 0, 1));
      if (w.sup === 1) bord = Math.max(bord, clamp(v / 30, 0, 1));
    }
    this.chirrido.g.gain.setTargetAtTime(chir * 0.16, t, 0.05);
    this.chirrido.f.frequency.setTargetAtTime(900 + chir * 500 + v * 2, t, 0.1);
    this.bloqueo.g.gain.setTargetAtTime(bloq * 0.22, t, 0.03);
    this.grava.g.gain.setTargetAtTime(tierra * 0.35, t, 0.05);
    this.gBord.gain.setTargetAtTime(bord * 0.22, t, 0.02);
    this.bord.frequency.setTargetAtTime(20 + v * 0.9, t, 0.05);
    this.viento.g.gain.setTargetAtTime(Math.min(0.32, (v / 95) ** 2 * 0.32), t, 0.1);
    this.viento.f.frequency.setTargetAtTime(250 + v * 14, t, 0.1);
    this.rodadura.g.gain.setTargetAtTime(Math.min(0.2, v / 90 * 0.2), t, 0.1);
    // rival cercano con efecto Doppler
    if (rivalCercano) {
      const { coche: r, dist, vRel } = rivalCercano;
      const vol = clamp(1 - dist / 120, 0, 1) ** 2 * 0.5;
      const doppler = clamp(343 / (343 - clamp(vRel, -150, 150)), 0.6, 1.6);
      this.rival.ajustar(r.rpm, clamp(r.mandos.acelerador, 0, 1), vol, t, doppler);
    } else this.rival.salida.gain.setTargetAtTime(0, t, 0.1);
  }
}
