// Sonido con Web Audio. El motor V6 turbo se sintetiza explosión a explosión en un
// AudioWorklet (motorWorklet.js); si el navegador no lo permite se usa una versión con
// osciladores. Además: turbo y válvula de descarga, silbido de la caja de cambios,
// neumáticos, viento, bordillos, grava, roce del fondo, golpes por capas (impacto seco,
// fibra de carbono que cruje y piezas que caen), rivales situados en 3D con efecto
// Doppler, eco junto a los muros, público, lluvia y megafonía.

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const N_RIVALES = 3;

function bufferRuido(ctx, seg = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seg, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// respuesta al impulso sintética: reflexiones tempranas y cola que decae (eco de muros y gradas)
function bufferEco(ctx, seg = 1.6) {
  const n = Math.floor(ctx.sampleRate * seg), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2) * (i < ctx.sampleRate * 0.012 ? 0 : 1);
    for (let k = 0; k < 6; k++) { const i = Math.floor(ctx.sampleRate * (0.015 + Math.random() * 0.07)); d[i] += (Math.random() < 0.5 ? -1 : 1) * 0.7; }
  }
  return b;
}

function curvaSaturacion(k = 2.5) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

// Motor por osciladores (respaldo si no hay AudioWorklet)
class VozMotor {
  constructor(ctx, destino, ruido, completo = true) {
    this.ctx = ctx;
    this.salida = ctx.createGain(); this.salida.gain.value = 0;
    this.filtro = ctx.createBiquadFilter(); this.filtro.type = 'lowpass'; this.filtro.Q.value = 0.9;
    const sat = ctx.createWaveShaper(); sat.curve = curvaSaturacion(2.2); sat.oversample = '2x';
    this.mezcla = ctx.createGain(); this.mezcla.gain.value = 0.5;
    this.mezcla.connect(sat); sat.connect(this.filtro);
    const osc = (tipo, g) => {
      const o = ctx.createOscillator(); o.type = tipo;
      const gg = ctx.createGain(); gg.gain.value = g;
      o.connect(gg); gg.connect(this.mezcla); o.start();
      return { o, g: gg };
    };
    this.o1 = osc('sawtooth', 0.55);
    try {
      const n = 16, re = new Float32Array(n), im = new Float32Array(n);
      const amp = [0, 1, 0.62, 0.48, 0.3, 0.26, 0.18, 0.12, 0.1, 0.07, 0.05, 0.04, 0.03, 0.02, 0.015, 0.01];
      for (let k = 1; k < n; k++) im[k] = amp[k] * (k % 3 === 0 ? 1.25 : 1);
      this.o1.o.setPeriodicWave(ctx.createPeriodicWave(re, im));
    } catch { /* diente de sierra */ }
    this.o2 = osc('square', 0.18);
    this.o3 = osc('sine', 0.5);
    this.escape = ctx.createBiquadFilter(); this.escape.type = 'peaking'; this.escape.Q.value = 2.2; this.escape.gain.value = 7;
    this.filtro.connect(this.escape); this.escape.connect(this.salida); if (destino) this.salida.connect(destino);
    if (completo) {
      this.o4 = osc('triangle', 0.22);
      const src = ctx.createBufferSource(); src.buffer = ruido; src.loop = true;
      this.bp = ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.Q.value = 1.6;
      this.gRuido = ctx.createGain(); this.gRuido.gain.value = 0;
      src.connect(this.bp); this.bp.connect(this.gRuido); this.gRuido.connect(this.mezcla); src.start();
    }
  }

  ajustar(rpm, carga, volumen, t, tono = 1, brillo = 1, corte = 0) {
    const f = rpm / 60 * 3 * tono, T = 0.03;
    this.o1.o.frequency.setTargetAtTime(f, t, T);
    this.o2.o.frequency.setTargetAtTime(f * 2, t, T);
    this.o3.o.frequency.setTargetAtTime(f / 3, t, T);
    if (this.o4) {
      this.o4.o.frequency.setTargetAtTime(f * 1.5, t, T);
      this.bp.frequency.setTargetAtTime(f * 2.2, t, T);
      this.gRuido.gain.setTargetAtTime(0.12 + carga * 0.35, t, 0.05);
    }
    this.filtro.frequency.setTargetAtTime((500 + carga * 4200 + rpm * 0.28) * (0.4 + 0.6 * brillo), t, 0.04);
    this.escape.frequency.setTargetAtTime(180 + rpm * 0.055, t, 0.05);
    this.salida.gain.setTargetAtTime(volumen * (0.32 + 0.68 * carga) * (corte ? 0.4 : 1), t, 0.02);
  }
}

// Motor por modelado físico (AudioWorklet)
class VozWorklet {
  constructor(ctx, destino) {
    this.nodo = new AudioWorkletNode(ctx, 'motor-apex', { numberOfInputs: 0, outputChannelCount: [1] });
    this.salida = ctx.createGain(); this.salida.gain.value = 0;
    // ecualización: cuerpo grave y "chillido" agudo del V6 a altas vueltas
    this.grave = ctx.createBiquadFilter(); this.grave.type = 'lowshelf'; this.grave.frequency.value = 180; this.grave.gain.value = 4;
    this.agudo = ctx.createBiquadFilter(); this.agudo.type = 'peaking'; this.agudo.Q.value = 1.1; this.agudo.gain.value = 5;
    this.nodo.connect(this.grave); this.grave.connect(this.agudo); this.agudo.connect(this.salida); this.salida.connect(destino);
    this.p = this.nodo.parameters;
  }
  ajustar(rpm, carga, volumen, t, tono = 1, brillo = 1, corte = 0) {
    this.p.get('rpm').setTargetAtTime(rpm, t, 0.02);
    this.p.get('carga').setTargetAtTime(carga, t, 0.02);
    this.p.get('corte').setValueAtTime(corte ? 1 : 0, t);
    this.p.get('brillo').setTargetAtTime(brillo, t, 0.1);
    this.p.get('tono').setTargetAtTime(tono, t, 0.05);
    this.agudo.frequency.setTargetAtTime(900 + rpm * 0.18, t, 0.05);
    this.salida.gain.setTargetAtTime(volumen * (0.45 + 0.55 * carga), t, 0.025);
  }
}

export class Sonido {
  constructor() {
    this.ctx = null;
    this.volumen = 0.8;
    this.acelPrevio = 0;
    this.listo = false;
    this.marchaPrevia = 0;
    this.impactoPrevio = [];
    this.posPrev = [];
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
    this.comp = comp;
    // eco: un envío común a una reverberación sintética
    this.eco = ctx.createConvolver(); this.eco.buffer = bufferEco(ctx);
    this.envioEco = ctx.createGain(); this.envioEco.gain.value = 0.08;
    this.envioEco.connect(this.eco); this.eco.connect(this.maestro);
    // bus de los motores: va seco al maestro y una parte al eco
    this.busMotor = ctx.createGain();
    this.busMotor.connect(this.maestro); this.busMotor.connect(this.envioEco);

    this.motor = new VozMotor(ctx, this.busMotor, this.ruido, true);
    this.rivales = [];
    for (let k = 0; k < N_RIVALES; k++) this.rivales.push(this._rival(new VozMotor(ctx, null, this.ruido, false)));
    // el motor bueno se carga aparte (es un módulo) y sustituye al de osciladores al estar listo
    if (ctx.audioWorklet) {
      ctx.audioWorklet.addModule(new URL('./motorWorklet.js', import.meta.url)).then(() => {
        const viejo = this.motor;
        this.motor = new VozWorklet(ctx, this.busMotor);
        viejo.salida.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        setTimeout(() => viejo.salida.disconnect(), 400);
        this.rivales.forEach((r, k) => {
          const v = new VozWorklet(ctx, r.panner);
          r.voz.salida.disconnect(); r.voz = v;
        });
        this.worklet = true;
      }).catch((e) => console.warn('motor por osciladores', e));
    }
    // turbo: silbido que sube con la presión y válvula de descarga al levantar
    this.turbo = ctx.createOscillator(); this.turbo.type = 'sine';
    this.gTurbo = ctx.createGain(); this.gTurbo.gain.value = 0;
    this.turbo.connect(this.gTurbo); this.gTurbo.connect(this.maestro); this.turbo.start();
    this.presion = 0;
    // caja de cambios de dientes rectos: silbido proporcional a la velocidad
    this.caja = ctx.createOscillator(); this.caja.type = 'triangle';
    this.gCaja = ctx.createGain(); this.gCaja.gain.value = 0;
    this.caja.connect(this.gCaja); this.gCaja.connect(this.maestro); this.caja.start();
    const lazo = (tipo, f, q, destino = this.maestro) => {
      const s = ctx.createBufferSource(); s.buffer = this.ruido; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = tipo; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(destino); s.start(ctx.currentTime + Math.random());
      return { f: fl, g };
    };
    this.chirrido = lazo('bandpass', 1100, 7);
    this.bloqueo = lazo('bandpass', 1650, 9);
    this.viento = lazo('lowpass', 400, 0.5);
    this.grava = lazo('lowpass', 900, 0.7);
    this.rodadura = lazo('lowpass', 160, 0.8);
    this.raspado = lazo('bandpass', 3800, 1.5);        // fondo contra el asfalto (chispas)
    this.soplido = lazo('bandpass', 2600, 2.5);        // válvula de descarga del turbo
    // bordillo: zumbido grave
    this.bord = ctx.createOscillator(); this.bord.type = 'square'; this.bord.frequency.value = 38;
    this.gBord = ctx.createGain(); this.gBord.gain.value = 0;
    const fb = ctx.createBiquadFilter(); fb.type = 'lowpass'; fb.frequency.value = 220;
    this.bord.connect(fb); fb.connect(this.gBord); this.gBord.connect(this.maestro); this.bord.start();
    // ambiente: público, lluvia y megafonía (mezclados aparte para poder apagarlos)
    this.ambiente = ctx.createGain(); this.ambiente.gain.value = 1; this.ambiente.connect(this.maestro);
    this.publico = lazo('bandpass', 900, 0.8, this.ambiente);
    this.publico2 = lazo('bandpass', 2100, 1.4, this.ambiente);
    this.lluvia = lazo('highpass', 2600, 0.4, this.ambiente);
    this.spray = lazo('bandpass', 1400, 0.6, this.ambiente);
    this.listo = true;
  }

  _rival(voz) {
    const ctx = this.ctx;
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower'; panner.distanceModel = 'inverse';
    panner.refDistance = 8; panner.rolloffFactor = 1.3; panner.maxDistance = 400;
    panner.connect(this.busMotor);
    voz.salida.connect(panner);
    return { voz, panner };
  }

  /** Pista de audio para grabar vídeo junto con la imagen. */
  flujoGrabacion() {
    if (!this.ctx) return null;
    if (!this.destinoGrab) { this.destinoGrab = this.ctx.createMediaStreamDestination(); this.comp.connect(this.destinoGrab); }
    return this.destinoGrab.stream;
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
      o.connect(g); g.connect(this.ambiente); o.connect(this.envioEco); o.start(t + r); o.stop(t + r + 1.2);
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

  /** En la repetición suenan los coches grabados; al salir se calla todo. */
  modoRepe(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of [this.chirrido.g, this.bloqueo.g, this.grava.g, this.gBord, this.raspado.g, this.gTurbo, this.gCaja, this.viento.g, this.rodadura.g])
      g.gain.setTargetAtTime(0, t, 0.05);
    this.motor.salida.gain.setTargetAtTime(0, t, 0.05);
    for (const r of this.rivales) r.voz.salida.gain.setTargetAtTime(0, t, 0.05);
    if (on) this.ctx.resume(); else setTimeout(() => this.ctx.suspend(), 150);
  }

  // estallido corto de ruido filtrado
  _rafaga(dur, freq, tipo, vol, retraso = 0, q = 1, destino = this.maestro) {
    const ctx = this.ctx, t = ctx.currentTime + retraso;
    const s = ctx.createBufferSource(); s.buffer = this.ruido;
    const f = ctx.createBiquadFilter(); f.type = tipo; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.003); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(destino); g.connect(this.envioEco);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  // golpe sordo: seno que cae de tono (la masa del coche contra el muro)
  _impacto(vol, f0 = 95, retraso = 0) {
    const ctx = this.ctx, t = ctx.currentTime + retraso;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g); g.connect(this.maestro); g.connect(this.envioEco); o.start(t); o.stop(t + 0.5);
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
    if (nombre === 'cambio') {
      // golpe seco del cambio sin embrague y chasquido metálico
      this._impacto(0.12, 140); this._rafaga(0.04, 2600, 'highpass', 0.08);
    } else if (nombre === 'golpe') {
      const f = clamp(valor / 12, 0.15, 1.3);
      this._impacto(0.9 * f, 85);
      this._rafaga(0.4 + f * 0.3, 700, 'lowpass', 0.6 * f);                 // carrocería
      // fibra de carbono que cruje: varias ráfagas agudas muy seguidas
      const n = 3 + Math.floor(f * 6);
      for (let k = 0; k < n; k++) this._rafaga(0.03 + Math.random() * 0.05, 2200 + Math.random() * 3500, 'bandpass', 0.25 * f, Math.random() * 0.12, 2);
      // piezas que caen y rebotan
      const p = Math.floor(f * 10);
      for (let k = 0; k < p; k++) this._rafaga(0.02 + Math.random() * 0.03, 1500 + Math.random() * 4000, 'bandpass', 0.12 * f * Math.random(), 0.15 + Math.random() * 0.9, 4);
    } else if (nombre === 'contacto') {
      const f = clamp(valor / 15, 0.1, 0.7);
      this._impacto(0.35 * f, 120); this._rafaga(0.12, 900, 'bandpass', f * 0.8); this._rafaga(0.05, 3500, 'bandpass', f * 0.4, 0.02, 2);
    } else if (nombre === 'luz') this.pitido(660, 0.14, 0.18);
    else if (nombre === 'salida') this.pitido(1320, 0.3, 0.2);
    else if (nombre === 'vuelta') this.pitido(990, 0.12, 0.12);
  }

  /** Coloca al oyente en la cámara (para el sonido 3D de los rivales). */
  _oyente(cam, t) {
    const L = this.ctx.listener;
    const p = cam.position, d = cam.getWorldDirection(this._dir || (this._dir = cam.position.clone()));
    if (L.positionX) {
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(d.x, t); L.forwardY.setValueAtTime(d.y, t); L.forwardZ.setValueAtTime(d.z, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else { L.setPosition?.(p.x, p.y, p.z); L.setOrientation?.(d.x, d.y, d.z, 0, 1, 0); }
  }

  // un coche sonando en 3D: volumen por distancia (panner) y Doppler por la velocidad radial
  _sonarRival(r, c, cam, vCam, t, k, escalaTiempo = 1) {
    const dx = c.x - cam.position.x, dy = c.y - cam.position.y, dz = c.z - cam.position.z;
    const dist = Math.max(1, Math.hypot(dx, dy, dz));
    const vx = Math.cos(c.psi) * c.velocidad - vCam.x, vz = Math.sin(c.psi) * c.velocidad - vCam.z;
    const vRad = (vx * dx + vz * dz) / dist;                 // positiva: se aleja
    const doppler = clamp(343 / (343 + clamp(vRad, -150, 150)), 0.6, 1.7);
    const P = r.panner;
    if (P.positionX) { P.positionX.setValueAtTime(c.x, t); P.positionY.setValueAtTime(c.y + 0.5, t); P.positionZ.setValueAtTime(c.z, t); }
    else P.setPosition(c.x, c.y + 0.5, c.z);
    const carga = clamp(c.mandos?.acelerador ?? 0.5, 0, 1);
    r.voz.ajustar(c.rpm, carga, escalaTiempo > 0 ? 0.9 : 0, t, doppler * clamp(escalaTiempo, 0.35, 1), clamp(1 - dist / 250, 0.25, 1), 0);
    void k;
  }

  actualizar(dt, car, rivales, cam, entorno = {}) {
    if (!this.listo) return;
    const t = this.ctx.currentTime;
    this._oyente(cam, t);
    // ambiente: murmullo del público cerca de las gradas, lluvia y agua levantada por las ruedas
    const lluvia = entorno.lluvia || 0, agua = entorno.agua || 0;
    const base = 0.012 + 0.03 * (entorno.grada || 0);
    if (this.publico.g.gain.value < base + 0.01) { this.publico.g.gain.setTargetAtTime(base, t, 0.6); this.publico2.g.gain.setTargetAtTime(base * 0.5, t, 0.6); }
    this.lluvia.g.gain.setTargetAtTime(lluvia * 0.09, t, 0.5);
    this.spray.g.gain.setTargetAtTime(agua * Math.min(1, car.velocidad / 60) * 0.12, t, 0.2);
    // eco más fuerte entre muros (urbano, túnel) y algo con las gradas
    this.envioEco.gain.setTargetAtTime(0.05 + 0.3 * (entorno.reflejo || 0) + 0.04 * (entorno.grada || 0), t, 0.3);
    const v = car.velocidad;
    const acel = car.mandos.acelerador * (car.tc ?? 1);
    const carga = car.limitador ? 0.35 : clamp(acel, 0, 1);
    const aBordo = !!entorno.aBordo;
    // a bordo se oye más la admisión y la mecánica; desde fuera, el escape
    const corte = car.cambioT > 0;
    this.motor.ajustar(car.rpm, carga, aBordo ? 0.62 : 0.55, t, 1, aBordo ? 0.25 : 1, corte);
    // turbo: la presión sube con carga y vueltas; al levantar, soplido de la válvula
    const pObj = carga * clamp((car.rpm - 6000) / 6000, 0, 1);
    if (this.presion > 0.5 && pObj < 0.2) {
      this.soplido.g.gain.cancelScheduledValues(t);
      this.soplido.g.gain.setValueAtTime(0.09 * this.presion, t);
      this.soplido.g.gain.setTargetAtTime(0, t + 0.05, 0.12);
    }
    this.presion += (pObj - this.presion) * Math.min(1, dt * (pObj > this.presion ? 2.5 : 8));
    this.turbo.frequency.setTargetAtTime(2200 + this.presion * 5200, t, 0.06);
    this.gTurbo.gain.setTargetAtTime(0.018 * this.presion * (aBordo ? 1.4 : 1), t, 0.05);
    // caja de cambios
    this.caja.frequency.setTargetAtTime(60 + v * 34, t, 0.05);
    this.gCaja.gain.setTargetAtTime(clamp(v / 80, 0, 1) * (aBordo ? 0.022 : 0.008) * (0.4 + 0.6 * (1 - carga)), t, 0.1);
    // petardeos al levantar el pie a altas vueltas (el worklet ya los hace solo)
    if (!this.worklet && this.acelPrevio > 0.6 && acel < 0.15 && car.rpm > 9000) {
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
    this.chirrido.g.gain.setTargetAtTime(chir * 0.16 * (1 - agua * 0.7), t, 0.05);
    this.chirrido.f.frequency.setTargetAtTime(900 + chir * 500 + v * 2, t, 0.1);
    this.bloqueo.g.gain.setTargetAtTime(bloq * 0.22 * (1 - agua * 0.6), t, 0.03);
    this.grava.g.gain.setTargetAtTime(tierra * 0.35, t, 0.05);
    this.gBord.gain.setTargetAtTime(bord * 0.22, t, 0.02);
    this.bord.frequency.setTargetAtTime(20 + v * 0.9, t, 0.05);
    this.raspado.g.gain.setTargetAtTime(clamp(car.fondoToca || 0, 0, 1) * clamp(v / 50, 0, 1) * 0.2, t, 0.02);
    this.viento.g.gain.setTargetAtTime(Math.min(0.32, (v / 95) ** 2 * 0.32) * (aBordo ? 1.2 : 0.7), t, 0.1);
    this.viento.f.frequency.setTargetAtTime(250 + v * 14, t, 0.1);
    this.rodadura.g.gain.setTargetAtTime(Math.min(0.2, v / 90 * 0.2), t, 0.1);
    // rivales cercanos situados en 3D
    const vCam = { x: Math.cos(car.psi) * v, z: Math.sin(car.psi) * v };
    this.rivales.forEach((r, k) => {
      const c = rivales?.[k];
      if (c) this._sonarRival(r, c, cam, vCam, t, k);
      else r.voz.salida.gain.setTargetAtTime(0, t, 0.1);
    });
  }

  /**
   * Repetición: el coche seguido y los tres más cercanos a la cámara suenan donde están.
   * velocidad = velocidad de reproducción (cámara lenta: el sonido se vuelve más grave).
   */
  actualizarRepe(dt, coches, foco, cam, velocidad, aBordo) {
    if (!this.listo) return;
    const t = this.ctx.currentTime;
    this._oyente(cam, t);
    const vCam = this._velCam(cam, dt);
    const c = coches[foco];
    if (!c || !velocidad) {
      this.motor.salida.gain.setTargetAtTime(0, t, 0.08);
      for (const r of this.rivales) r.voz.salida.gain.setTargetAtTime(0, t, 0.08);
      return;
    }
    const tono = clamp(velocidad, 0.35, 1);
    // el coche seguido: con el volumen según lo lejos que esté la cámara
    const dist = Math.max(1, cam.position.distanceTo({ x: c.x, y: c.y, z: c.z }));
    const vol = aBordo ? 0.62 : clamp(9 / dist, 0.03, 0.6);
    const dx = c.x - cam.position.x, dz = c.z - cam.position.z;
    const vRad = ((Math.cos(c.psi) * c.velocidad - vCam.x) * dx + (Math.sin(c.psi) * c.velocidad - vCam.z) * dz) / dist;
    const doppler = aBordo ? 1 : clamp(343 / (343 + clamp(vRad, -150, 150)), 0.6, 1.7);
    this.motor.ajustar(c.rpm, clamp(c.mandos.acelerador, 0, 1), vol, t, tono * doppler, aBordo ? 0.25 : clamp(1 - dist / 250, 0.3, 1), 0);
    this.viento.g.gain.setTargetAtTime(aBordo ? Math.min(0.3, (c.velocidad / 95) ** 2 * 0.3) : 0, t, 0.1);
    this.raspado.g.gain.setTargetAtTime(clamp(c.fondoToca || 0, 0, 1) * clamp(9 / dist, 0, 1) * 0.2, t, 0.02);
    // los demás: los tres más cercanos a la cámara
    const otros = coches.map((o, k) => ({ o, k, d: k === foco ? Infinity : Math.hypot(o.x - cam.position.x, o.z - cam.position.z) }))
      .sort((a, b) => a.d - b.d).slice(0, N_RIVALES);
    this.rivales.forEach((r, k) => {
      const e = otros[k];
      if (e && e.d < 300) this._sonarRival(r, e.o, cam, vCam, t, k, velocidad);
      else r.voz.salida.gain.setTargetAtTime(0, t, 0.1);
    });
    // golpes grabados
    coches.forEach((o, k) => {
      const prev = this.impactoPrevio[k] || 0;
      if (o.impacto > 6 && o.impacto > prev + 3) {
        const d = Math.hypot(o.x - cam.position.x, o.z - cam.position.z);
        if (d < 150) this.evento('golpe', o.impacto * clamp(20 / d, 0.15, 1));
      }
      this.impactoPrevio[k] = o.impacto;
    });
  }

  _velCam(cam, dt) {
    const p = cam.position, a = this._camPrev;
    const v = { x: 0, z: 0 };
    if (a && dt > 0) { v.x = clamp((p.x - a.x) / dt, -120, 120); v.z = clamp((p.z - a.z) / dt, -120, 120); }
    this._camPrev = { x: p.x, z: p.z };
    return v;
  }
}
