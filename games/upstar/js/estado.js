// Partida del jugador: nave, inventario, créditos, mejoras, reputación, descubrimientos e historia.
// Se guarda en el dispositivo y, con cuenta de UpGames, también en la nube.
import { nube, token } from './red.js';

const CLAVE = 'upstar.partida.v1';
const NUEVA = () => ({
  v: 1, t: 0, creditos: 600,
  casco: 100, escudo: 100, combustible: 100, traje: 100, jetpack: 100,
  inventario: { cristal: 0, ferrita: 0, carbono: 0, plasma: 2 },
  nave: { modelo: 'caza', colores: { casco: '#2a2f45', acento: '#ff2e88', luz: '#00f0ff' } },
  implantes: {},              // termica, dobleSalto, escanerPlus, pielBlindada
  reputacion: { corp: 0, sind: 0, ia: 0 },
  visitados: ['0,0,0'], descubiertos: {}, escaneados: 0, piratas: 0,
  historia: { paso: 0, notas: [] }, expedicion: -1,
  records: {}, bases: [], misiones: [],
});
export const E = (() => { try { return { ...NUEVA(), ...JSON.parse(localStorage.getItem(CLAVE) || '{}') }; } catch { return NUEVA(); } })();

let tNube = 0;
export function guardar(forzarNube = false) {
  E.t = Date.now();
  try { localStorage.setItem(CLAVE, JSON.stringify(E)); } catch { /* sin espacio */ }
  if (token() && (forzarNube || Date.now() - tNube > 60000)) { tNube = Date.now(); nube.guardar(JSON.stringify(E)).catch(() => {}); }
}
/** Al empezar: si la partida de la nube es más reciente, se usa esa. */
export async function sincronizar() {
  if (!token()) return false;
  try {
    const d = await nube.cargar();
    if (!d.datos) { guardar(true); return false; }
    const r = JSON.parse(d.datos);
    if ((r.t || 0) > (E.t || 0)) { Object.assign(E, NUEVA(), r); guardar(); return true; }
  } catch { /* sin conexión */ }
  return false;
}
export function reiniciar() { Object.assign(E, NUEVA()); guardar(true); }
export const anadir = (rec, n) => { E.inventario[rec] = Math.max(0, (E.inventario[rec] || 0) + n); };
export const capacidad = () => E.nave.modelo === 'carguero' ? 120 : 60;
export const cargaTotal = () => Object.values(E.inventario).reduce((a, b) => a + b, 0);
