// Radio del ingeniero y megafonía del circuito con voz sintetizada. En el navegador usa
// la síntesis de voz del sistema (speechSynthesis); en la app de Android, cuyo WebView no
// la tiene, usa el motor de voz nativo a través del puente `ApexVoz`. Cada mensaje sale
// también como subtítulo, así que nunca se pierde aunque no haya voz.

import { tr, idiomaActual, lenguaVoz } from './idioma.js';

const voces = () => (window.speechSynthesis?.getVoices?.() || []).filter(v => v.lang?.toLowerCase().startsWith(idiomaActual()));
const MAX_COLA = 6;

export class Radio {
  constructor({ alSubtitulo, sonido } = {}) {
    this.alSubtitulo = alSubtitulo;
    this.sonido = sonido;
    this.voz = true;
    this.cola = [];
    this.hablando = false;
    this.ultimo = new Map();          // clave → instante (para no repetir)
    this.n = 0;
    window.speechSynthesis?.getVoices?.();
    window.speechSynthesis?.addEventListener?.('voiceschanged', () => { this._voces = null; });
    // Chrome y Safari solo hablan después de un toque del usuario: se "despierta" la voz con el primero
    const despertar = () => {
      removeEventListener('pointerdown', despertar, true); removeEventListener('keydown', despertar, true);
      try { const s = window.speechSynthesis; if (s && !this.nativa) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; s.speak(u); } } catch { /* nada */ }
    };
    addEventListener('pointerdown', despertar, true); addEventListener('keydown', despertar, true);
    // fin de frase avisado por la voz nativa
    window.__vozFin = (id) => { if (this._idActual === id) this._fin?.(); };
  }

  get nativa() {
    try {
      const si = !!window.ApexVoz?.disponible?.();
      if (si && !this._lenguaNativa) { this._lenguaNativa = true; window.ApexVoz.idioma?.(idiomaActual()); }
      return si;
    } catch { return false; }
  }
  get disponible() { return this.nativa || !!window.speechSynthesis; }

  _vozDe(tipo) {
    const vs = voces();
    if (!vs.length) return null;
    // el ingeniero con una voz y el locutor con otra si hay más de una
    if (idiomaActual() !== 'es') return vs.find(v => v.lang === lenguaVoz()) || vs[0];
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
    const m = { texto: tr(texto), tipo, t: ahora, prioridad };
    if (prioridad) this.cola.unshift(m); else this.cola.push(m);
    // si se acumulan, se descartan los mensajes normales más viejos (nunca los prioritarios)
    while (this.cola.length > MAX_COLA) {
      const i = this.cola.findIndex(x => !x.prioridad);
      this.cola.splice(i >= 0 ? i : this.cola.length - 1, 1);
    }
    this._siguiente();
    return true;
  }

  _siguiente() {
    if (this.hablando || !this.cola.length) return;
    // los avisos que llevan demasiado esperando ya no tienen sentido (salvo los prioritarios)
    const ahora = performance.now() / 1000;
    this.cola = this.cola.filter(x => x.prioridad || ahora - x.t < 20);
    if (!this.cola.length) return;
    const m = this.cola.shift();
    this.hablando = true;
    if (m.tipo === 'megafonia') this.sonido?.campana(); else this.sonido?.radio(false);
    this.alSubtitulo?.(m, true);
    let cerrado = false;
    const fin = this._fin = () => {
      if (cerrado) return;
      cerrado = true;
      this.hablando = false; this._fin = null;
      if (m.tipo !== 'megafonia') this.sonido?.radio(true);
      this.alSubtitulo?.(m, false);
      setTimeout(() => this._siguiente(), 300);
    };
    const espera = m.tipo === 'megafonia' ? 900 : 180;
    // tiempo máximo por si la voz no avisa del final
    setTimeout(fin, espera + 2500 + m.texto.length * 95);
    if (!this.voz) { setTimeout(fin, 1200 + m.texto.length * 55); return; }
    const mega = m.tipo === 'megafonia';
    if (this.nativa) {
      const id = 'v' + (++this.n);
      this._idActual = id;
      setTimeout(() => { try { window.ApexVoz.hablar(m.texto, id, mega ? 1.0 : 1.12, mega ? 0.85 : 1.0); } catch { fin(); } }, espera);
      return;
    }
    const synth = window.speechSynthesis;
    if (!synth) { setTimeout(fin, 1200 + m.texto.length * 55); return; }
    try {
      const u = new SpeechSynthesisUtterance(m.texto);
      u.lang = lenguaVoz();
      const v = this._vozDe(m.tipo); if (v) { u.voice = v; u.lang = v.lang; }
      if (mega) { u.rate = 1.0; u.pitch = 0.85; u.volume = 0.8; }
      else { u.rate = 1.12; u.pitch = 1.0; u.volume = 1; }
      u.onend = fin; u.onerror = fin;
      setTimeout(() => { try { synth.resume?.(); synth.speak(u); } catch { fin(); } }, espera);
    } catch { setTimeout(fin, 1500); }
  }

  callar() {
    this.cola.length = 0;
    try { window.speechSynthesis?.cancel(); } catch { /* nada */ }
    try { window.ApexVoz?.callar?.(); } catch { /* nada */ }
    this._fin?.();
    this.hablando = false;
  }
}
