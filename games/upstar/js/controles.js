// Mandos: teclado (PC) y táctiles (Android). En cuanto se pulsa una tecla, los táctiles se ocultan;
// al tocar la pantalla vuelven.
//
// Teclado: W/S acelerar/frenar · ↑↓ o ratón cabeceo · A/D o ←→ guiñada · Q/E alabeo ·
// Mayús turbo · Espacio pulso (viaje rápido en el espacio) · J saltar a otro sistema.
// Táctil: palanca a la izquierda (morro), acelerador a la derecha, botones de turbo y pulso.

export class Controles {
  constructor() {
    this.m = { acel: 0, cabeceo: 0, guinada: 0, alabeo: 0, turbo: false, pulso: false, frenar: false };
    this.teclas = new Set(); this.eventos = [];
    this.palanca = { x: 0, y: 0 }; this.acelTactil = 0;
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea')) return;
      this.teclas.add(e.code); document.body.classList.add('teclado');
      if (e.code === 'KeyJ' && !e.repeat) this.eventos.push('saltar');
      if (e.code === 'KeyC' && !e.repeat) this.eventos.push('camara');
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.teclas.delete(e.code));
    addEventListener('blur', () => this.teclas.clear());
    addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') document.body.classList.remove('teclado'); }, true);
    this._tactil();
  }

  _tactil() {
    const zona = document.getElementById('palanca'), pomo = zona.querySelector('i');
    let id = null, x0 = 0, y0 = 0;
    zona.addEventListener('pointerdown', (e) => { id = e.pointerId; x0 = e.clientX; y0 = e.clientY; zona.setPointerCapture(id); });
    zona.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const R = 55, dx = Math.max(-R, Math.min(R, e.clientX - x0)), dy = Math.max(-R, Math.min(R, e.clientY - y0));
      this.palanca.x = dx / R; this.palanca.y = dy / R; pomo.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const fin = (e) => { if (e.pointerId !== id) return; id = null; this.palanca.x = this.palanca.y = 0; pomo.style.transform = ''; };
    zona.addEventListener('pointerup', fin); zona.addEventListener('pointercancel', fin);
    // acelerador vertical: arriba acelera, abajo frena
    const acel = document.getElementById('acelerador'), barra = acel.querySelector('i');
    let ida = null;
    const pon = (e) => { const r = acel.getBoundingClientRect(); const v = 1 - (e.clientY - r.top) / r.height; this.acelTactil = Math.max(-0.3, Math.min(1, v * 1.3 - 0.3)); barra.style.height = Math.max(0, this.acelTactil) * 100 + '%'; };
    acel.addEventListener('pointerdown', (e) => { ida = e.pointerId; acel.setPointerCapture(ida); pon(e); });
    acel.addEventListener('pointermove', (e) => { if (e.pointerId === ida) pon(e); });
    const finA = (e) => { if (e.pointerId === ida) ida = null; };
    acel.addEventListener('pointerup', finA); acel.addEventListener('pointercancel', finA);
    for (const [idb, k] of [['bTurbo', '_turbo'], ['bPulso', '_pulso']]) {
      const b = document.getElementById(idb);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this[k] = true; b.classList.add('on'); });
      const f = () => { this[k] = false; b.classList.remove('on'); };
      b.addEventListener('pointerup', f); b.addEventListener('pointercancel', f); b.addEventListener('pointerleave', f);
    }
    document.getElementById('bSaltar').addEventListener('click', () => this.eventos.push('saltar'));
    document.getElementById('bCam').addEventListener('click', () => this.eventos.push('camara'));
  }

  leer() {
    const t = this.teclas, k = (c) => t.has(c) ? 1 : 0, m = this.m;
    const tecAcel = k('KeyW') - k('KeyS');
    m.acel = tecAcel || this.acelTactil;
    m.cabeceo = (k('ArrowDown') - k('ArrowUp')) || this.palanca.y;
    m.guinada = (k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft')) || this.palanca.x * 0.8;
    m.alabeo = (k('KeyE') - k('KeyQ')) || this.palanca.x * 0.6;
    m.turbo = !!(t.has('ShiftLeft') || t.has('ShiftRight') || this._turbo);
    m.pulso = !!(t.has('Space') || this._pulso);
    m.frenar = t.has('KeyS');
    const ev = this.eventos; this.eventos = [];
    return { m, ev };
  }
}
