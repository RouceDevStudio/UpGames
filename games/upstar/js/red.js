// Conexión con UpGames: sesión (la misma de upgames.games), descubrimientos compartidos, bases,
// partida en la nube y jugadores en el mismo sector (Socket.IO /upstar).
import { io } from '../../monoplaza/lib/socket.io.esm.min.js';

const apiLocal = new URLSearchParams(location.search).get('api');
export const API = apiLocal && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(apiLocal) ? apiLocal : 'https://upgames-production.up.railway.app';
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } } };
export function token() { const t = LS.get('token') || LS.get('apexgp.token'); return t && t !== 'null' && t.length > 20 ? t : null; }
export const usuario = () => LS.get('apexgp.usuario') || LS.get('user_admin') || null;

async function api(ruta, opc = {}) {
  const t = token();
  // (con tiempo máximo: una red lenta nunca deja el juego colgado)
  const r = await fetch(API + ruta, { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined, method: opc.method || 'GET', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: opc.body ? JSON.stringify(opc.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.success === false) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

export const nube = {
  descubrimientos: (claves) => api('/upstar/descubrimientos?claves=' + claves.map(encodeURIComponent).join(',')),
  registrar: (clave, tipo, nombre) => api('/upstar/descubrimiento', { method: 'POST', body: { clave, tipo, nombre } }),
  bases: (sector) => api('/upstar/bases?sector=' + sector.join(',')),
  plantarBase: (d) => api('/upstar/base', { method: 'POST', body: d }),
  cargar: () => api('/upstar/guardado'),
  guardar: (datos) => api('/upstar/guardado', { method: 'PUT', body: { datos } }),
};

/** Multijugador: los demás jugadores del sector. */
export class Online {
  constructor() { this.otros = new Map(); this.s = null; this.sector = null; }
  conectar(nombre) {
    if (this.s) return;
    try {
      this.s = io(API + '/upstar', { transports: ['websocket'], auth: { token: token() }, reconnectionDelay: 3000 });
      this.s.on('connect', () => { if (this.sector) this.s.emit('entrar', { sector: this.sector, nombre }); this.nombre = nombre; });
      this.s.on('jugador', (d) => { const o = this.otros.get(d.id) || {}; Object.assign(o, d, { t: performance.now() }); this.otros.set(d.id, o); });
      this.s.on('sale', (d) => { const o = this.otros.get(d.id); if (o) o.fuera = true; });
    } catch { this.s = null; }
  }
  entrar(sector) { this.sector = sector.join(','); for (const o of this.otros.values()) o.fuera = true; this.s?.connected && this.s.emit('entrar', { sector: this.sector, nombre: this.nombre }); }
  enviar(p, q, v, m) { if (this.s?.connected) this.s.volatile.emit('estado', { p: [p.x, p.y, p.z].map(n => Math.round(n * 10) / 10), q: [q.x, q.y, q.z, q.w].map(n => Math.round(n * 1e4) / 1e4), v: Math.round(v), m }); }
  get conectado() { return !!this.s?.connected; }
}
