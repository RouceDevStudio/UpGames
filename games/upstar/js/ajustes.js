// Ajustes del jugador (se guardan en este navegador / teléfono): controles, calidad, sonido,
// cámara e interfaz. Los módulos leen AJ directamente; aplicarAjustes() avisa a los que
// necesitan reconfigurarse (resolución, volumen, ayudas…).
const CLAVE = 'upstar.ajustes.v1';
export const DEF = {
  sens: 1,          // sensibilidad del ratón / dedo
  invertirY: false, // invertir el eje vertical (nave y a pie)
  res: 1,           // escala máxima de resolución (0.5–1)
  detalle: 2.3,     // distancia de detalle del terreno (divide los trozos antes)
  fov: 65,          // campo de visión
  vol: 0.7,         // volumen general
  musica: 1,        // volumen de la música (relativo)
  distCam: 1,       // distancia de la cámara en tercera persona
  ayudas: true,     // mostrar la línea de ayuda de teclas
  vibrar: true,     // vibración en el móvil al recibir daño
  fps: true,        // contador de FPS
};
export const AJ = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') }; } catch { return { ...DEF }; } })();
const oyentes = [];
export function alCambiarAjustes(f) { oyentes.push(f); }
export function guardarAjustes() {
  try { localStorage.setItem(CLAVE, JSON.stringify(AJ)); } catch { /* sin espacio */ }
  aplicarAjustes();
}
export function aplicarAjustes() {
  document.body.classList.toggle('sin-ayuda', !AJ.ayudas);
  document.body.classList.toggle('sin-fps', !AJ.fps);
  for (const f of oyentes) try { f(AJ); } catch (e) { console.warn(e); }
}
export function restablecerAjustes() { Object.assign(AJ, DEF); guardarAjustes(); }

/** Controles del formulario: [clave, etiqueta, tipo, min, max, paso, formato] */
export const CAMPOS = [
  ['Controles'],
  ['sens', 'Sensibilidad', 'r', 0.3, 2.5, 0.05, (v) => `${Math.round(v * 100)} %`],
  ['invertirY', 'Invertir eje vertical', 'b'],
  ['vibrar', 'Vibración (móvil)', 'b'],
  ['Gráficos'],
  ['res', 'Resolución', 'r', 0.5, 1, 0.05, (v) => `${Math.round(v * 100)} %`],
  ['detalle', 'Distancia de detalle', 'r', 1.4, 3.4, 0.1, (v) => v < 1.9 ? 'Baja' : v < 2.6 ? 'Media' : v < 3.1 ? 'Alta' : 'Ultra'],
  ['fov', 'Campo de visión', 'r', 55, 90, 1, (v) => `${v}°`],
  ['fps', 'Mostrar FPS', 'b'],
  ['Sonido'],
  ['vol', 'Volumen general', 'r', 0, 1, 0.05, (v) => `${Math.round(v * 100)} %`],
  ['musica', 'Música', 'r', 0, 1, 0.05, (v) => `${Math.round(v * 100)} %`],
  ['Cámara e interfaz'],
  ['distCam', 'Distancia de cámara', 'r', 0.7, 1.8, 0.05, (v) => `${Math.round(v * 100)} %`],
  ['ayudas', 'Ayuda de teclas en pantalla', 'b'],
];
