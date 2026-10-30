// Entrada unificada: inclinación del móvil, controles táctiles, teclado y mando.

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const esIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class Entrada {
  constructor(ajustes) {
    this.ajustes = ajustes;
    this.direccion = 0; this.acelerador = 0; this.freno = 0;
    this.drs = false; this.ersModo = 1;
    this.mirarAtras = false;
    this.eventos = [];
    this.teclas = new Set();
    this.inclinacion = 0; this.ceroInclinacion = 0; this.hayInclinacion = false;
    this.toque = { dir: 0, acel: 0, freno: 0, dirActiva: false };
    this.ultimoMando = 0;
    this.usandoMando = false;
    this._teclado();
  }

  _teclado() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.teclas.add(k);
      if (k === 'e' || k === 'shift') this.eventos.push('subir');
      if (k === 'q' || k === 'control') this.eventos.push('bajar');
      if (k === 'c') this.eventos.push('camara');
      if (k === 'escape' || k === 'p') this.eventos.push('pausa');
      if (k === 'f') this.eventos.push('ers');
      if (k === 'm') this.eventos.push('mezcla');
      if (k === 'b') this.eventos.push('bbMas');
      if (k === 'n') this.eventos.push('bbMenos');
      if (k === 'r') this.eventos.push('recolocar');
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.teclas.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.teclas.clear());
  }

  // El permiso de sensores en iOS solo se puede pedir desde un toque
  async activarInclinacion() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch { return false; }
    if (this._escuchaMov) return true;
    this._escuchaMov = (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null) return;
      const ang = (screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI / 180;
      // gravedad en ejes de la pantalla
      let sx = g.x * Math.cos(ang) + g.y * Math.sin(ang);
      if (esIOS) sx = -sx;
      const n = Math.hypot(g.x, g.y, g.z) || 9.81;
      this.inclinacion = Math.asin(clamp(sx / n, -1, 1));
      this.hayInclinacion = true;
    };
    window.addEventListener('devicemotion', this._escuchaMov);
    return true;
  }

  calibrar() { this.ceroInclinacion = this.inclinacion; }

  // Controles táctiles: pedales analógicos (más arriba = más presión) y zona de volante
  conectarTactil(elementos) {
    const pedal = (el, campo) => {
      if (!el) return;
      const leer = (t) => {
        const r = el.getBoundingClientRect();
        const v = clamp((r.bottom - t.clientY) / (r.height * 0.8), 0.3, 1);
        this.toque[campo] = v;
        el.style.setProperty('--presion', v.toFixed(2));
      };
      const ids = new Set();
      el.addEventListener('touchstart', (e) => { e.preventDefault(); for (const t of e.changedTouches) { ids.add(t.identifier); leer(t); } el.classList.add('activo'); }, { passive: false });
      el.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (ids.has(t.identifier)) leer(t); }, { passive: false });
      const fin = (e) => { for (const t of e.changedTouches) ids.delete(t.identifier); if (!ids.size) { this.toque[campo] = 0; el.classList.remove('activo'); el.style.setProperty('--presion', '0'); } };
      el.addEventListener('touchend', fin); el.addEventListener('touchcancel', fin);
      // ratón (pruebas en escritorio)
      el.addEventListener('mousedown', (e) => { leer(e); el.classList.add('activo'); const up = () => { this.toque[campo] = 0; el.classList.remove('activo'); window.removeEventListener('mouseup', up); }; window.addEventListener('mouseup', up); });
    };
    pedal(elementos.acel, 'acel');
    pedal(elementos.freno, 'freno');

    const zona = elementos.volante;
    if (zona) {
      let id = null, x0 = 0;
      const pomo = elementos.pomo;
      const mover = (x) => {
        const rango = Math.min(140, window.innerWidth * 0.14);
        const d = clamp((x - x0) / rango, -1, 1);
        this.toque.dir = d;
        if (pomo) pomo.style.transform = `translateX(${(d * rango).toFixed(0)}px)`;
      };
      zona.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (id !== null) return;
        const t = e.changedTouches[0]; id = t.identifier; x0 = t.clientX;
        this.toque.dirActiva = true;
        if (pomo) { const r = zona.getBoundingClientRect(); pomo.style.left = (t.clientX - r.left) + 'px'; pomo.style.top = (t.clientY - r.top) + 'px'; pomo.classList.add('visible'); }
        mover(t.clientX);
      }, { passive: false });
      zona.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === id) mover(t.clientX); }, { passive: false });
      const fin = (e) => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; this.toque.dir = 0; this.toque.dirActiva = false; if (pomo) { pomo.classList.remove('visible'); pomo.style.transform = ''; } } };
      zona.addEventListener('touchend', fin); zona.addEventListener('touchcancel', fin);
    }
    const boton = (el, ev, mantener) => {
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); if (mantener) this[mantener] = true; else this.eventos.push(ev); el.classList.add('activo'); }, { passive: false });
      const fin = () => { if (mantener) this[mantener] = false; el.classList.remove('activo'); };
      el.addEventListener('touchend', fin); el.addEventListener('touchcancel', fin);
      el.addEventListener('click', () => { if (!mantener) this.eventos.push(ev); });
    };
    boton(elementos.subir, 'subir'); boton(elementos.bajar, 'bajar');
    boton(elementos.drs, null, '_drsTactil'); boton(elementos.ers, 'ers'); if (elementos.mezcla) boton(elementos.mezcla, 'mezcla'); if (elementos.bb) boton(elementos.bb, 'bbCiclo');
    boton(elementos.camara, 'camara'); boton(elementos.pausa, 'pausa');
    boton(elementos.atras, null, '_atrasTactil');
    boton(elementos.recolocar, 'recolocar');
  }

  _mando() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0;
      const dz = 0.07;
      const dir = Math.abs(ax) < dz ? 0 : Math.sign(ax) * ((Math.abs(ax) - dz) / (1 - dz)) ** 1.3;
      const bt = (i) => p.buttons[i] ? (p.buttons[i].value ?? (p.buttons[i].pressed ? 1 : 0)) : 0;
      const pres = (i) => !!p.buttons[i]?.pressed;
      let acel = bt(7), freno = bt(6);
      // mandos sin gatillos analógicos: stick derecho vertical
      if (p.axes.length >= 4 && acel === 0 && freno === 0) {
        const y = p.axes[3];
        if (y < -0.1) acel = -y; else if (y > 0.1) freno = y;
      }
      const prev = this._botonesPrev || [];
      const flanco = (i) => pres(i) && !prev[i];
      if (flanco(5)) this.eventos.push('subir');
      if (flanco(4)) this.eventos.push('bajar');
      if (flanco(3)) this.eventos.push('camara');
      if (flanco(9)) this.eventos.push('pausa');
      if (flanco(1)) this.eventos.push('ers');
      if (flanco(8)) this.eventos.push('recolocar');
      this._botonesPrev = p.buttons.map(b => b.pressed);
      const activo = Math.abs(dir) > 0 || acel > 0.02 || freno > 0.02 || p.buttons.some(b => b.pressed);
      if (activo) this.ultimoMando = performance.now();
      return { dir, acel, freno, drs: pres(0), atras: pres(2), vibrador: p.vibrationActuator };
    }
    return null;
  }

  actualizar(dt) {
    const t = this.teclas;
    const izq = t.has('arrowleft') || t.has('a'), der = t.has('arrowright') || t.has('d');
    const arr = t.has('arrowup') || t.has('w'), abj = t.has('arrowdown') || t.has('s');
    const tecladoActivo = izq || der || arr || abj;
    const mando = this._mando();
    this.usandoMando = !!mando && performance.now() - this.ultimoMando < 8000;
    this.vibrador = mando?.vibrador;

    let dirObj = 0, acelObj = 0, frenoObj = 0;
    const aj = this.ajustes;
    if (this.usandoMando) {
      dirObj = mando.dir; acelObj = mando.acel; frenoObj = mando.freno;
      this.drs = mando.drs || t.has(' ');
      this.mirarAtras = mando.atras;
      this.direccion = dirObj * aj.sensibilidad;
    } else if (tecladoActivo || !('ontouchstart' in window)) {
      // teclado: rampas suaves como un volante real
      const objetivo = (der ? 1 : 0) - (izq ? 1 : 0);
      const vel = objetivo === 0 ? 5 : (Math.sign(objetivo) !== Math.sign(this.direccion) ? 6 : 2.6);
      this.direccion += clamp(objetivo - this.direccion, -vel * dt, vel * dt);
      acelObj = arr ? 1 : 0; frenoObj = abj ? 1 : 0;
      const kA = arr ? 7 : 10, kF = abj ? 9 : 12;
      this.acelerador += clamp(acelObj - this.acelerador, -kA * dt, kA * dt);
      this.freno += clamp(frenoObj - this.freno, -kF * dt, kF * dt);
      this.drs = t.has(' ');
      this.mirarAtras = t.has('b');
      return;
    } else {
      // táctil
      if (aj.control === 'inclinacion' && this.hayInclinacion) {
        let a = this.inclinacion - this.ceroInclinacion;
        if (aj.invertir) a = -a;
        const max = (aj.anguloInclinacion || 24) * Math.PI / 180;
        let d = clamp(a / max, -1, 1);
        const zm = 0.03;
        d = Math.abs(d) < zm ? 0 : Math.sign(d) * (Math.abs(d) - zm) / (1 - zm);
        dirObj = d * aj.sensibilidad;
      } else dirObj = this.toque.dir * aj.sensibilidad;
      acelObj = this.toque.acel; frenoObj = this.toque.freno;
      this.drs = !!this._drsTactil;
      this.mirarAtras = !!this._atrasTactil;
      // filtro paso bajo para el sensor
      this.direccion += (clamp(dirObj, -1, 1) - this.direccion) * Math.min(1, dt / 0.05);
      this.acelerador += (acelObj - this.acelerador) * Math.min(1, dt / 0.04);
      this.freno += (frenoObj - this.freno) * Math.min(1, dt / 0.03);
      return;
    }
    this.acelerador = acelObj; this.freno = frenoObj;
  }

  tomarEventos() { const e = this.eventos; this.eventos = []; return e; }

  vibrar(ms, fuerza = 0.6) {
    if (!this.ajustes.vibracion) return;
    if (this.usandoMando && this.vibrador?.playEffect) {
      this.vibrador.playEffect('dual-rumble', { duration: ms, strongMagnitude: fuerza, weakMagnitude: fuerza * 0.6 }).catch(() => {});
    } else if (navigator.vibrate) navigator.vibrate(ms);
  }
}
