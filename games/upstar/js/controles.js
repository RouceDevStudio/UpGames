// Mandos de nave y a pie, con teclado + ratón (PC) o táctiles (Android). Con teclado los táctiles
// se ocultan; al tocar la pantalla vuelven.
//
// NAVE — el ACELERADOR se queda donde lo dejas: W sube, S baja (hasta la reversa), X lo pone a cero.
// Ratón (clic en la pantalla para capturarlo) o flechas: morro. A/D guiñada, Q/E alabeo. Mayús turbo,
// Espacio pulso, clic izquierdo o K disparar, L aterrizar, F bajar de la nave.
// A PIE — WASD andar, ratón mirar, Espacio saltar (mantener: jetpack), Mayús correr, clic minar,
// F subir a la nave / interactuar. Siempre: R escanear, J salto, M mapa, I inventario, C cámara,
// T visión térmica.

export class Controles {
  constructor() {
    this.modo = 'nave';
    this.acel = 0; this.teclas = new Set(); this.eventos = [];
    this.palanca = { x: 0, y: 0 }; this.raton = { x: 0, y: 0 }; this.mirar = { x: 0, y: 0 };
    this.fuego = false; this.salta = false;
    const lienzo = document.getElementById('lienzo');
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea')) return;
      this.teclas.add(e.code); document.body.classList.add('teclado');
      if (!e.repeat) {
        const m = { KeyJ: 'saltar', KeyC: 'camara', KeyR: 'escanear', KeyM: 'mapa', KeyI: 'inventario', KeyL: 'aterrizar', KeyF: 'accion', KeyT: 'termica', Escape: 'cerrar' }[e.code];
        if (m) this.eventos.push(m);
        if (e.code === 'KeyX') this.acel = 0;
        if (e.code === 'Space' && this.modo === 'pie') this.salta = true;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.teclas.delete(e.code));
    addEventListener('blur', () => { this.teclas.clear(); this.fuego = false; });
    // ratón con el puntero capturado (como en los juegos de PC)
    lienzo.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== lienzo && !document.body.classList.contains('tocando')) { lienzo.requestPointerLock?.(); return; }
      if (e.button === 0) this.fuego = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.fuego = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== lienzo) return;
      if (this.modo === 'nave') { this.raton.x = Math.max(-1, Math.min(1, this.raton.x + e.movementX * 0.004)); this.raton.y = Math.max(-1, Math.min(1, this.raton.y + e.movementY * 0.004)); }
      else { this.mirar.x += e.movementX * 0.0035; this.mirar.y -= e.movementY * 0.003; }
    });
    addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { document.body.classList.remove('teclado'); document.body.classList.add('tocando'); } }, true);
    this._tactil();
  }

  ponerModo(m) { this.modo = m; document.body.classList.toggle('modo-pie', m === 'pie'); document.body.classList.toggle('modo-nave', m === 'nave'); this.raton.x = this.raton.y = 0; }

  _tactil() {
    const $ = (id) => document.getElementById(id);
    // palanca analógica (dirección de la nave o andar a pie)
    const zona = $('palanca'), pomo = zona.querySelector('i');
    let id = null, x0 = 0, y0 = 0;
    zona.addEventListener('pointerdown', (e) => { id = e.pointerId; const r = zona.getBoundingClientRect(); x0 = r.left + r.width / 2; y0 = r.top + r.height / 2; zona.setPointerCapture(id); mover(e); });
    const mover = (e) => { if (e.pointerId !== id) return; const R = 55, dx = Math.max(-R, Math.min(R, e.clientX - x0)), dy = Math.max(-R, Math.min(R, e.clientY - y0)); this.palanca.x = dx / R; this.palanca.y = dy / R; pomo.style.transform = `translate(${dx}px, ${dy}px)`; };
    zona.addEventListener('pointermove', mover);
    const fin = (e) => { if (e.pointerId !== id) return; id = null; this.palanca.x = this.palanca.y = 0; pomo.style.transform = ''; };
    zona.addEventListener('pointerup', fin); zona.addEventListener('pointercancel', fin);
    // acelerador: se queda donde lo dejas (arriba avance, la franja roja de abajo es reversa)
    const ac = $('acelerador'), barra = ac.querySelector('i');
    let ia = null;
    const pon = (e) => { const r = ac.getBoundingClientRect(); const v = 1 - (e.clientY - r.top) / r.height; this.acel = Math.max(-0.3, Math.min(1, v * 1.3 - 0.3)); if (Math.abs(this.acel) < 0.04) this.acel = 0; };
    ac.addEventListener('pointerdown', (e) => { ia = e.pointerId; ac.setPointerCapture(ia); pon(e); });
    ac.addEventListener('pointermove', (e) => { if (e.pointerId === ia) pon(e); });
    const finA = (e) => { if (e.pointerId === ia) ia = null; }; ac.addEventListener('pointerup', finA); ac.addEventListener('pointercancel', finA);
    this._barra = barra;
    // a pie: arrastrar en la mitad derecha mueve la cámara
    const mz = $('mirarZona'); let im = null, lx = 0, ly = 0;
    mz.addEventListener('pointerdown', (e) => { im = e.pointerId; lx = e.clientX; ly = e.clientY; mz.setPointerCapture(im); });
    mz.addEventListener('pointermove', (e) => { if (e.pointerId !== im) return; this.mirar.x += (e.clientX - lx) * 0.006; this.mirar.y -= (e.clientY - ly) * 0.005; lx = e.clientX; ly = e.clientY; });
    const finM = (e) => { if (e.pointerId === im) im = null; }; mz.addEventListener('pointerup', finM); mz.addEventListener('pointercancel', finM);
    // botones mantenidos
    for (const [b, k] of [['bFuego', '_fuegoT'], ['bTurbo', '_turbo'], ['bPulso', '_pulso'], ['bSaltar', '_jet'], ['bHerr', '_fuegoT']]) {
      const el = $(b); if (!el) continue;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this[k] = true; el.classList.add('on'); if (b === 'bSaltar') this.salta = true; });
      const f = () => { this[k] = false; el.classList.remove('on'); };
      el.addEventListener('pointerup', f); el.addEventListener('pointercancel', f); el.addEventListener('pointerleave', f);
    }
    // botones de un toque
    for (const [b, ev] of [['bAccion', 'accion'], ['bEscanear', 'escanear'], ['bMenu', 'mapa'], ['bSalto', 'saltar'], ['bCam', 'camara']]) $(b)?.addEventListener('click', () => this.eventos.push(ev));
  }

  leer(dt) {
    const t = this.teclas, k = (c) => t.has(c) ? 1 : 0;
    // acelerador por teclado: se mueve mientras se mantiene W o S
    if (t.has('KeyW') && this.modo === 'nave') this.acel = Math.min(1, this.acel + dt * 0.8);
    if (t.has('KeyS') && this.modo === 'nave') this.acel = Math.max(-0.3, this.acel - dt * 0.8);
    if (this._barra) { this._barra.style.bottom = this.acel >= 0 ? '23%' : `${23 + this.acel / 0.3 * 23}%`; this._barra.style.height = `${Math.abs(this.acel) * (this.acel >= 0 ? 77 : 23 / 0.3)}%`; this._barra.classList.toggle('rev', this.acel < 0); }
    // el ratón vuelve poco a poco al centro (para no girar sin querer)
    this.raton.x *= Math.exp(-dt * 1.6); this.raton.y *= Math.exp(-dt * 1.6);
    const m = {
      acelerador: this.acel,
      cabeceo: (k('ArrowDown') - k('ArrowUp')) || this.palanca.y || this.raton.y,
      guinada: (k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft')) || this.palanca.x * 0.9 || this.raton.x,
      alabeo: k('KeyE') - k('KeyQ'),
      turbo: !!(t.has('ShiftLeft') || t.has('ShiftRight') || this._turbo),
      pulso: !!(t.has('Space') && this.modo === 'nave' || this._pulso),
      fuego: !!(this.fuego || t.has('KeyK') || this._fuegoT),
      // a pie
      x: (k('KeyD') - k('KeyA')) || this.palanca.x, z: (k('KeyS') - k('KeyW')) || this.palanca.y,
      girar: this.mirar.x + (k('ArrowRight') - k('ArrowLeft')) * dt * 2, mirar: this.mirar.y + (k('ArrowUp') - k('ArrowDown')) * dt * 1.5,
      saltar: this.salta, jetpack: !!(t.has('Space') || this._jet), correr: !!(t.has('ShiftLeft') || t.has('ShiftRight')),
    };
    this.mirar.x = 0; this.mirar.y = 0; this.salta = false;
    const ev = this.eventos; this.eventos = [];
    return { m, ev };
  }
}
