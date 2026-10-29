// Radio del ingeniero y megafonía del circuito con la síntesis de voz del
// navegador (las grabaciones reales de un motor o de un locutor necesitarían
// archivos de audio con licencia). Cada mensaje sale también como subtítulo.

const voces = () => (window.speechSynthesis?.getVoices?.() || []).filter(v => /^es/i.test(v.lang));

export class Radio {
  constructor({ alSubtitulo, sonido } = {}) {
    this.alSubtitulo = alSubtitulo;
    this.sonido = sonido;
    this.voz = true;
    this.cola = [];
    this.hablando = false;
    this.ultimo = new Map();          // clave → instante (para no repetir)
    window.speechSynthesis?.getVoices?.();
  }

  _vozDe(tipo) {
    const vs = voces();
    if (!vs.length) return null;
    // el ingeniero con una voz y el locutor con otra si hay más de una
    const pref = tipo === 'megafonia' ? vs.find(v => /es-(ES|MX|US)/i.test(v.lang) && !/female|mujer|helena|laura|paulina|monica/i.test(v.name)) : vs.find(v => /es-(MX|US|CO|419)/i.test(v.lang));
    return pref || vs[tipo === 'megafonia' ? vs.length - 1 : 0];
  }

  /** tipo: 'ingeniero' | 'megafonia'. clave evita repetir el mismo aviso en `cada` segundos. */
  decir(texto, { tipo = 'ingeniero', clave = null, cada = 25, prioridad = false } = {}) {
    const ahora = performance.now() / 1000;
    if (clave) {
      if (ahora - (this.ultimo.get(clave) ?? -1e9) < cada) return false;
      this.ultimo.set(clave, ahora);
    }
    const m = { texto, tipo };
    if (prioridad) this.cola.unshift(m); else this.cola.push(m);
    if (this.cola.length > 4) this.cola.splice(1, this.cola.length - 4);
    this._siguiente();
    return true;
  }

  _siguiente() {
    if (this.hablando || !this.cola.length) return;
    const m = this.cola.shift();
    this.hablando = true;
    if (m.tipo === 'megafonia') this.sonido?.campana(); else this.sonido?.radio(false);
    this.alSubtitulo?.(m, true);
    const fin = () => {
      if (!this.hablando) return;
      this.hablando = false;
      if (m.tipo !== 'megafonia') this.sonido?.radio(true);
      this.alSubtitulo?.(m, false);
      setTimeout(() => this._siguiente(), 350);
    };
    const synth = window.speechSynthesis;
    if (!this.voz || !synth) { setTimeout(fin, 1200 + m.texto.length * 55); return; }
    try {
      const u = new SpeechSynthesisUtterance(m.texto);
      u.lang = 'es-ES';
      const v = this._vozDe(m.tipo); if (v) { u.voice = v; u.lang = v.lang; }
      if (m.tipo === 'megafonia') { u.rate = 1.0; u.pitch = 0.85; u.volume = 0.8; }
      else { u.rate = 1.12; u.pitch = 1.0; u.volume = 1; }
      u.onend = fin; u.onerror = fin;
      setTimeout(() => { if (this.hablando) { synth.cancel(); fin(); } }, 2500 + m.texto.length * 90);
      setTimeout(() => synth.speak(u), m.tipo === 'megafonia' ? 900 : 180);
    } catch { setTimeout(fin, 1500); }
  }

  callar() {
    this.cola.length = 0;
    try { window.speechSynthesis?.cancel(); } catch { /* nada */ }
    this.hablando = false;
  }
}
