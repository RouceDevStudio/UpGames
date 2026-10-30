// Editor de circuitos de la comunidad: se dibuja el trazado con puntos de control sobre un
// plano (como los circuitos reales, se une con una curva suave), se valida, se guarda en el
// dispositivo y se comparte con un código. Los circuitos creados se corren sin conexión.

import { Circuito } from './track.js';

const CLAVE = 'apexgp.circuitos';
export const LADO = 2000;                 // el plano mide 2 × 2 km
export const RELIEVES = {
  llano: [[1.5, 1, 0.3], [0.6, 3, 1.2]],
  ondulado: [[8, 1, 0.9], [3, 2, 2.2], [1.2, 5, 0.4]],
  montana: [[24, 1, 0.5], [9, 2, 1.9], [3, 4, 0.8]],
};
export const NOMBRES_RELIEVE = { llano: 'Llano', ondulado: 'Ondulado', montana: 'Montaña' };

// ─── Datos ↔ definición de circuito ─────────────────────────────────────────
/** datos: { id, nombre, ancho, relieve, urbano, noche, p: [x0, z0, x1, z1, …] (m, en el plano) } */
export function definicion(d) {
  const p = d.p, x0 = p[0], z0 = p[1];
  // la línea de meta (primer punto) en el origen, como en los trazados reales
  const puntos = p.map((v, i) => Math.round((v - (i % 2 ? z0 : x0)) * 10) / 10);
  const def = {
    id: d.id, nombre: d.nombre, corto: d.nombre.slice(0, 18), pais: 'Comunidad', tipo: d.urbano ? 'urbano' : 'parque',
    ancho: d.ancho, relieve: RELIEVES[d.relieve] || RELIEVES.llano, puntos, comunidad: true, real: true, drs: 'auto',
  };
  if (d.urbano) def.urbano = true;
  if (d.noche) def.hora = 'noche';
  return def;
}

// curva cerrada que pasa por los puntos (centrípeta, como en track.js) para la vista previa
export function curva(p, porTramo = 12) {
  const P = []; for (let i = 0; i < p.length; i += 2) P.push([p[i], p[i + 1]]);
  const n = P.length, out = [];
  if (n < 3) return P;
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const t1 = Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1e-3), t2 = t1 + Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1e-3), t3 = t2 + Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) || 1e-3);
    for (let k = 0; k < porTramo; k++) {
      const t = t1 + (t2 - t1) * k / porTramo;
      out.push([0, 1].map(c => {
        const A1 = (t1 - t) / t1 * p0[c] + t / t1 * p1[c];
        const A2 = (t2 - t) / (t2 - t1) * p1[c] + (t - t1) / (t2 - t1) * p2[c];
        const A3 = (t3 - t) / (t3 - t2) * p2[c] + (t - t2) / (t3 - t2) * p3[c];
        const B1 = (t2 - t) / t2 * A1 + t / t2 * A2;
        const B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
        return (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2;
      }));
    }
  }
  return out;
}

/** Comprobaciones rápidas sobre la curva (sin construir el circuito). */
export function revisar(d) {
  const errores = [];
  const n = d.p.length / 2;
  if (n < 5) return { ok: false, errores: ['Pon al menos 5 puntos'], largo: 0 };
  const c = curva(d.p, 16);
  let largo = 0;
  for (let i = 0; i < c.length; i++) { const a = c[i], b = c[(i + 1) % c.length]; largo += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  if (largo < 1800) errores.push(`Muy corto (${(largo / 1000).toFixed(2)} km): mínimo 1,8 km`);
  if (largo > 8000) errores.push(`Muy largo (${(largo / 1000).toFixed(2)} km): máximo 8 km`);
  // remuestreo cada ~8 m para buscar cruces y curvas imposibles
  const r = [];
  let acc = 0;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (acc <= l) { const t = acc / (l || 1); r.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); acc += 8; }
    acc -= l;
  }
  const m = r.length, sep = d.ancho * 2.2, vecinos = Math.ceil(60 / 8);
  let cruce = -1;
  for (let i = 0; i < m && cruce < 0; i += 2) for (let j = i + vecinos; j < m - (i < vecinos ? vecinos - i : 0); j += 2) {
    if (Math.hypot(r[i][0] - r[j][0], r[i][1] - r[j][1]) < sep) { cruce = i; break; }
  }
  if (cruce >= 0) errores.push('El trazado se cruza o dos tramos van demasiado juntos');
  // radio de giro mínimo (sobre puntos a ±16 m)
  let rMin = Infinity, iMin = 0;
  for (let i = 0; i < m; i++) {
    const a = r[(i - 2 + m) % m], b = r[i], e = r[(i + 2) % m];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), be = Math.hypot(e[0] - b[0], e[1] - b[1]), ae = Math.hypot(e[0] - a[0], e[1] - a[1]);
    const area2 = Math.abs((b[0] - a[0]) * (e[1] - a[1]) - (b[1] - a[1]) * (e[0] - a[0]));
    const rad = area2 > 1e-6 ? ab * be * ae / (2 * area2) : Infinity;
    if (rad < rMin) { rMin = rad; iMin = i; }
  }
  if (rMin < 11) errores.push(`Hay una curva demasiado cerrada (radio ${rMin.toFixed(0)} m, mínimo 11 m)`);
  // la meta necesita una recta: los dos primeros tramos casi alineados
  const ang = (k) => Math.atan2(d.p[2 * k + 3] - d.p[2 * k + 1], d.p[2 * k + 2] - d.p[2 * k]);
  let dAng = Math.abs(ang(0) - ang(n - 1)); if (dAng > Math.PI) dAng = 2 * Math.PI - dAng;
  const avisos = [];
  if (dAng > 0.35) avisos.push('Consejo: pon la meta (punto verde) en medio de una recta para que quepan los boxes');
  return { ok: !errores.length, errores, avisos, largo, rMin, puntoCerrado: r[iMin], cruce: cruce >= 0 ? r[cruce] : null };
}

/** Construye el circuito de verdad y comprueba que se puede correr. */
export function construir(d) {
  const def = definicion(d);
  const c = new Circuito(def);
  const t = c.vueltaTeorica(1);
  if (!Number.isFinite(t) || t <= 0) throw new Error('El circuito no se puede recorrer');
  return { def, circuito: c, vuelta: t };
}

// ─── Guardado y códigos para compartir ──────────────────────────────────────
export function cargarGuardados() {
  try { const l = JSON.parse(localStorage.getItem(CLAVE) || '[]'); return Array.isArray(l) ? l.filter(valido) : []; } catch { return []; }
}
export function guardarLista(l) { try { localStorage.setItem(CLAVE, JSON.stringify(l.slice(0, 30))); } catch { /* sin espacio */ } }

function valido(d) {
  return d && typeof d.id === 'string' && /^com_[a-z0-9]{4,16}$/.test(d.id) && typeof d.nombre === 'string' && Array.isArray(d.p)
    && d.p.length >= 10 && d.p.length <= 240 && d.p.length % 2 === 0 && d.p.every(v => Number.isFinite(v) && Math.abs(v) <= LADO * 2)
    && [11, 13, 15].includes(d.ancho);
}
export const nuevoId = () => 'com_' + Math.random().toString(36).slice(2, 10);
export const limpiarNombre = n => String(n || '').replace(/[<>&"]/g, '').trim().slice(0, 28) || 'Mi circuito';

/** Código compartible: APX1.<base64 url> con los puntos redondeados a metros. */
export function codificar(d) {
  const o = { n: d.nombre, a: d.ancho, r: d.relieve, u: d.urbano ? 1 : 0, h: d.noche ? 1 : 0, p: d.p.map(Math.round) };
  const b = btoa(unescape(encodeURIComponent(JSON.stringify(o))));
  return 'APX1.' + b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodificar(txt) {
  const m = String(txt || '').trim().match(/APX1\.([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('No es un código de circuito válido');
  let b = m[1].replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
  const o = JSON.parse(decodeURIComponent(escape(atob(b))));
  const d = { id: nuevoId(), nombre: limpiarNombre(o.n), ancho: [11, 13, 15].includes(o.a) ? o.a : 13, relieve: RELIEVES[o.r] ? o.r : 'llano', urbano: !!o.u, noche: !!o.h, p: Array.isArray(o.p) ? o.p.map(Number) : [] };
  if (!valido(d)) throw new Error('El código está incompleto o dañado');
  return d;
}

/** Registra (o actualiza) un circuito de la comunidad en la tabla de circuitos del juego. */
export function registrar(CIRCUITOS, d) {
  const def = definicion(d);
  CIRCUITOS[d.id] = def;
  return def;
}

// plantilla de partida: un trazado sencillo de unos 3,6 km
export const PLANTILLA = [-300, 600, 300, 600, 650, 560, 760, 380, 620, 200, 300, 160, 120, -40, 260, -300, 600, -420, 620, -640, 300, -720, -200, -640, -500, -420, -640, -60, -660, 360, -560, 560];

// ─── Vista en 2D (canvas) ───────────────────────────────────────────────────
/** Dibuja el plano, el trazado con su ancho, la meta, el sentido y los puntos. */
export function dibujar(cv, d, { sel = -1, rev = null } = {}) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  const esc = Math.min(W, H) / LADO, ox = W / 2, oz = H / 2;
  const P = ([x, z]) => [ox + x * esc, oz + z * esc];
  g.fillStyle = '#16301e'; g.fillRect(0, 0, W, H);
  // cuadrícula cada 100 m (más marcada cada 500 m)
  for (let k = -LADO / 2; k <= LADO / 2; k += 100) {
    g.strokeStyle = k % 500 === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(ox + k * esc, 0); g.lineTo(ox + k * esc, H); g.moveTo(0, oz + k * esc); g.lineTo(W, oz + k * esc); g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,.4)'; g.font = `${Math.max(10, W / 60)}px system-ui`; g.fillText('100 m', 6, H - 8);
  const n = d.p.length / 2;
  if (n >= 3) {
    const c = curva(d.p).map(P);
    const linea = (w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineJoin = 'round'; g.beginPath(); c.forEach(([x, z], i) => i ? g.lineTo(x, z) : g.moveTo(x, z)); g.closePath(); g.stroke(); };
    linea(Math.max(3, (d.ancho + 6) * esc), '#d8d8d0');          // bordillos y escapatoria
    linea(Math.max(2, d.ancho * esc), '#3b3d42');                 // asfalto
    linea(1, 'rgba(255,255,255,.25)');
    // flechas de sentido
    g.fillStyle = '#ffd23f';
    for (let i = 6; i < c.length; i += 24) {
      const [x, z] = c[i], [x2, z2] = c[(i + 1) % c.length], a = Math.atan2(z2 - z, x2 - x);
      g.save(); g.translate(x, z); g.rotate(a); g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -4); g.lineTo(-4, 4); g.fill(); g.restore();
    }
    // línea de meta
    const [x0, z0] = c[0], [x1, z1] = c[1], a = Math.atan2(z1 - z0, x1 - x0), w = Math.max(6, d.ancho * esc);
    g.save(); g.translate(x0, z0); g.rotate(a);
    for (let k = 0; k < 6; k++) { g.fillStyle = k % 2 ? '#000' : '#fff'; g.fillRect(-2, -w / 2 + k * w / 6, 4, w / 6); }
    g.restore();
  }
  // problemas encontrados
  for (const q of [rev?.cruce, rev?.rMin < 11 ? rev.puntoCerrado : null]) if (q) {
    const [x, z] = P(q); g.strokeStyle = '#ff3b3b'; g.lineWidth = 3; g.beginPath(); g.arc(x, z, 14, 0, 7); g.stroke();
  }
  // puntos de control
  for (let i = 0; i < n; i++) {
    const [x, z] = P([d.p[2 * i], d.p[2 * i + 1]]);
    g.fillStyle = i === 0 ? '#22c55e' : i === sel ? '#ffd23f' : '#e8202a';
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, z, i === sel ? 9 : 7, 0, 7); g.fill(); g.stroke();
    if (W > 380) { g.fillStyle = '#fff'; g.font = `bold ${Math.max(9, W / 80)}px system-ui`; g.fillText(i === 0 ? 'META' : String(i), x + 9, z - 8); }
  }
}

/** Editor sobre un canvas: tocar añade, arrastrar mueve, tocar un tramo inserta un punto. */
export class EditorPlano {
  constructor(cv, alCambiar) {
    this.cv = cv; this.alCambiar = alCambiar;
    this.d = null; this.sel = -1; this.arrastre = -1; this.rev = null;
    const pos = (e) => {
      const r = cv.getBoundingClientRect(), esc = Math.min(cv.width, cv.height) / LADO;
      const px = (e.clientX - r.left) * cv.width / r.width, pz = (e.clientY - r.top) * cv.height / r.height;
      return [(px - cv.width / 2) / esc, (pz - cv.height / 2) / esc, esc];
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!this.d) return;
      e.preventDefault(); cv.setPointerCapture(e.pointerId);
      const [x, z, esc] = pos(e), radio = 16 / esc;
      const n = this.d.p.length / 2;
      let k = -1, mejor = radio;
      for (let i = 0; i < n; i++) { const dd = Math.hypot(this.d.p[2 * i] - x, this.d.p[2 * i + 1] - z); if (dd < mejor) { mejor = dd; k = i; } }
      if (k < 0) {
        // ¿cerca de un tramo? se inserta ahí; si no, al final
        k = this._tramoCercano(x, z, 30 / esc);
        const at = k >= 0 ? k + 1 : n;
        if (n >= 120) return;
        this.d.p.splice(2 * at, 0, Math.round(x), Math.round(z));
        k = at;
      }
      this.sel = k; this.arrastre = k;
      this.cambio();
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.arrastre < 0) return;
      const [x, z] = pos(e), L = LADO / 2 - 20;
      this.d.p[2 * this.arrastre] = Math.round(Math.max(-L, Math.min(L, x)));
      this.d.p[2 * this.arrastre + 1] = Math.round(Math.max(-L, Math.min(L, z)));
      this.pintar();
    });
    const soltar = () => { if (this.arrastre >= 0) { this.arrastre = -1; this.cambio(); } };
    cv.addEventListener('pointerup', soltar); cv.addEventListener('pointercancel', soltar);
  }

  _tramoCercano(x, z, max) {
    const p = this.d.p, n = p.length / 2;
    if (n < 2) return -1;
    let k = -1, mejor = max;
    for (let i = 0; i < n; i++) {
      const ax = p[2 * i], az = p[2 * i + 1], bx = p[2 * ((i + 1) % n)], bz = p[2 * ((i + 1) % n) + 1];
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      const dd = Math.hypot(ax + vx * t - x, az + vz * t - z);
      if (dd < mejor) { mejor = dd; k = i; }
    }
    return k;
  }

  cargar(d) { this.d = d; this.sel = -1; this.cambio(); }
  borrarSel() {
    if (this.sel < 0 || !this.d) return;
    this.d.p.splice(2 * this.sel, 2);
    this.sel = Math.min(this.sel, this.d.p.length / 2 - 1);
    this.cambio();
  }
  /** El punto seleccionado pasa a ser la línea de meta. */
  metaAqui() {
    if (this.sel <= 0) return;
    const p = this.d.p;
    this.d.p = [...p.slice(2 * this.sel), ...p.slice(0, 2 * this.sel)];
    this.sel = 0; this.cambio();
  }
  invertir() {
    const p = this.d.p, n = p.length / 2, q = [p[0], p[1]];
    for (let i = n - 1; i >= 1; i--) q.push(p[2 * i], p[2 * i + 1]);
    this.d.p = q; this.cambio();
  }
  ajustarTam() {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (w && h && (this.cv.width !== w || this.cv.height !== h)) { this.cv.width = w; this.cv.height = h; }
  }
  cambio() { this.rev = this.d && this.d.p.length >= 10 ? revisar(this.d) : null; this.pintar(); this.alCambiar?.(this.rev); }
  pintar() { if (this.d) { this.ajustarTam(); dibujar(this.cv, this.d, { sel: this.sel, rev: this.arrastre >= 0 ? null : this.rev }); } }
}
