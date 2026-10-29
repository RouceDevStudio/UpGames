// Conexión con UpGames: cuenta, garaje (mejoras y cosméticos con UpCoins) y multijugador.

import { io } from '../lib/socket.io.esm.min.js';

// ?api=http://localhost:PUERTO permite probar contra un servidor local (solo localhost)
const apiLocal = new URLSearchParams(location.search).get('api');
export const API = apiLocal && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(apiLocal) ? apiLocal : 'https://upgames-production.up.railway.app';
const LS = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

// La web comparte la sesión de upgames.games (mismo origen); la app usa la suya
export function token() {
  const t = LS.get('apexgp.token') || LS.get('token');
  return t && t !== 'null' && t !== 'undefined' && t.length > 20 ? t : null;
}

async function api(ruta, opc = {}) {
  const t = token();
  const r = await fetch(API + ruta, {
    method: opc.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: opc.body ? JSON.stringify(opc.body) : undefined,
  });
  let d = {};
  try { d = await r.json(); } catch { /* respuesta vacía */ }
  if (!r.ok || d.success === false) {
    const e = new Error(d.error || `Error ${r.status}`); e.status = r.status; e.datos = d;
    if (r.status === 401 && t) { LS.set('apexgp.token', null); }
    throw e;
  }
  return d;
}

export const cuenta = {
  conectado: () => !!token(),
  async entrar(usuario, password, token2fa) {
    const d = await api('/auth/login', { method: 'POST', body: { usuario, password, ...(token2fa ? { token2fa } : {}) } });
    LS.set('apexgp.token', d.token);
    LS.set('apexgp.usuario', d.usuario);
    return d;
  },
  salir() { LS.set('apexgp.token', null); LS.set('apexgp.usuario', null); },
  usuario: () => LS.get('apexgp.usuario') || LS.get('user_admin') || null,
  catalogo: () => api('/apexgp/catalogo'),
  perfil: () => api('/apexgp/perfil'),
  comprar: (id) => api('/apexgp/comprar', { method: 'POST', body: { id, clave: clave() } }),
  equipar: (equipado) => api('/apexgp/equipar', { method: 'PUT', body: { equipado } }),
};

function clave() {
  const a = new Uint8Array(12);
  (globalThis.crypto || window.crypto).getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Multijugador ─────────────────────────────────────────────────────────
// Estado que cada coche envía ~15 veces por segundo (18 números)
export function empaquetar(car, p) {
  const d = car.dano;
  let bits = 0;
  d.pinchazo.forEach((x, k) => { if (x) bits |= 1 << k; });
  d.suelta.forEach((x, k) => { if (x) bits |= 1 << (k + 4); });
  bits |= Math.round(Math.min(1, car.danoAleron) * 3) << 8;
  bits |= Math.round(Math.min(1, d.aleronTras) * 3) << 10;
  const flags = (car.drsAbierto ? 1 : 0) | (car.mandos.freno > 0.1 ? 2 : 0) | (p.box ? 4 : 0) | (car.retenido ? 8 : 0) | (car.abandono ? 16 : 0) | (car.limitadorPit ? 32 : 0);
  return [car.x, car.z, car.y, car.psi, car.vx, car.vy, car.r, car.anguloVolante || 0, car.rpm, car.marcha,
    car.proj.s, p.distancia, p.vuelta, flags, car.cabeceo, car.balanceo, bits, car.mandos.acelerador];
}

export function aplicarEstado(car, e, circuito) {
  [car.x, car.z, car.y, car.psi, car.vx, car.vy, car.r] = e;
  car.anguloVolante = e[7]; car.rpm = e[8]; car.marcha = e[9];
  car.cabeceo = e[14]; car.balanceo = e[15];
  const f = e[13], bits = e[16];
  car.drsAbierto = !!(f & 1); car.retenido = !!(f & 8); car.abandono = !!(f & 16); car.limitadorPit = !!(f & 32);
  car.mandos.freno = f & 2 ? 1 : 0; car.mandos.acelerador = e[17] || 0;
  for (let k = 0; k < 4; k++) { car.dano.pinchazo[k] = !!(bits & (1 << k)); car.dano.suelta[k] = !!(bits & (1 << (k + 4))); }
  car.danoAleron = ((bits >> 8) & 3) / 3; car.dano.aleronTras = ((bits >> 10) & 3) / 3;
  car.proj = circuito.proyectar(car.x, car.z, car.proj?.i ?? -1, car.proj?.i >= 0 ? car.proj : {});
  // giro de las ruedas y dirección para el modelo
  const delta = car.anguloVolante;
  car.ruedas[0].angulo = delta; car.ruedas[1].angulo = delta;
}

export class Multijugador {
  constructor() {
    this.socket = null; this.sala = null; this.yo = null; this.offset = 0;
    this.manejadores = {}; this.buffers = new Map(); this.libreas = new Map();
  }

  on(ev, fn) { this.manejadores[ev] = fn; }
  _emitirLocal(ev, d) { this.manejadores[ev]?.(d); }

  conectar() {
    if (this.socket?.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = this.socket = io(API + '/apexgp', { auth: { token: token() }, transports: ['websocket', 'polling'], reconnectionAttempts: 5 });
      const t = setTimeout(() => reject(new Error('No se pudo conectar con el servidor')), 12000);
      s.on('connect', async () => { clearTimeout(t); await this.sincronizarReloj(); resolve(); });
      s.on('connect_error', (e) => { this._emitirLocal('aviso', 'Conexión inestable: ' + (e?.message || 'reintentando')); });
      s.on('lista', (l) => this._emitirLocal('lista', l));
      s.on('sala', (sala) => { this.sala = sala; this._emitirLocal('sala', sala); });
      s.on('salida', (d) => { this.sala && (this.sala.parrilla = d.parrilla); this._emitirLocal('salida', { ...d, tSalidaLocal: d.tSalida - this.offset }); });
      s.on('estados', (p) => this._recibirEstados(p));
      s.on('vuelta', (d) => this._emitirLocal('vuelta', d));
      s.on('resultados', (r) => this._emitirLocal('resultados', r));
      s.on('livery', (d) => { this.libreas.set(d.id, d.livery); this._emitirLocal('livery', d); });
      s.on('evento', (d) => this._emitirLocal('evento', d));
      s.on('error_sala', (e) => this._emitirLocal('aviso', e));
      s.on('disconnect', () => this._emitirLocal('desconectado'));
    });
  }

  // desfase del reloj del servidor con varias mediciones (la de menor latencia gana)
  async sincronizarReloj() {
    let mejor = Infinity;
    for (let k = 0; k < 5; k++) {
      const t0 = Date.now();
      const ts = await new Promise(r => this.socket.emit('reloj', t0, r));
      const t1 = Date.now(), rtt = t1 - t0;
      if (rtt < mejor) { mejor = rtt; this.offset = ts - (t0 + rtt / 2); }
    }
    this.latencia = mejor;
  }

  ahoraServidor() { return Date.now() + this.offset; }

  pedirLista() { this.socket?.emit('lista'); }
  crear(datos) { return new Promise(r => this.socket.emit('crear', datos, (x) => { if (x.ok) { this.sala = x.sala; this.yo = x.yo; } r(x); })); }
  unirse(datos) { return new Promise(r => this.socket.emit('unirse', datos, (x) => { if (x.ok) { this.sala = x.sala; this.yo = x.yo; } r(x); })); }
  listo(v) { this.socket?.emit('listo', v); }
  iniciar() { return new Promise(r => this.socket.emit('iniciar', r)); }
  revancha() { this.socket?.emit('revancha'); }
  salir() { this.socket?.emit('salir'); this.sala = null; this.buffers.clear(); }
  desconectar() { this.salir(); this.socket?.disconnect(); this.socket = null; }
  enviarEstado(arr) { this.socket?.volatile.emit('estado', arr.map(v => Math.round(v * 1000) / 1000)); }
  vuelta(t) { this.socket?.emit('vuelta', t); }
  meta() { this.socket?.emit('meta'); }
  abandono() { this.socket?.emit('abandono'); }

  _recibirEstados(p) {
    for (const [id, e] of p.c) {
      if (id === this.yo) continue;
      let b = this.buffers.get(id);
      if (!b) { b = []; this.buffers.set(id, b); }
      b.push({ t: p.t, e });
      if (b.length > 30) b.shift();
    }
  }

  // estado interpolado de un rival, 120 ms en el pasado para tener siempre dos muestras
  interpolado(id) {
    const b = this.buffers.get(id);
    if (!b || !b.length) return null;
    const t = this.ahoraServidor() - 120;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > t) i--;
    const a = b[Math.max(0, i - 1)], c = b[i];
    if (!a || a === c || c.t <= a.t) return c.e;
    const u = Math.max(0, Math.min(1.2, (t - a.t) / (c.t - a.t)));
    const out = a.e.slice();
    for (const k of [0, 1, 2, 4, 5, 6, 7, 8, 10, 11, 14, 15, 17]) out[k] = a.e[k] + (c.e[k] - a.e[k]) * u;
    let dpsi = c.e[3] - a.e[3]; dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi));
    out[3] = a.e[3] + dpsi * u;
    // s y distancia pueden saltar al cruzar la meta
    if (Math.abs(c.e[10] - a.e[10]) > 100) out[10] = c.e[10];
    return out;
  }
}
