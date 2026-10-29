// Parámetros del monoplaza, compuestos y equipos.
// Unidades SI: metros, kilogramos, segundos, newtons, radianes.

export const G = 9.81;
export const RHO_AIRE = 1.2;

export const COCHE = {
  masaSeca: 768,            // coche + piloto, sin combustible
  wheelbase: 3.60,
  viaDel: 1.60,
  viaTras: 1.55,
  repartoDel: 0.455,        // fracción del peso estático sobre el eje delantero
  alturaCG: 0.29,
  centroBalanceoDel: 0.04,
  centroBalanceoTras: 0.09,
  inerciaYaw: 1150,         // kg·m²
  // Ruedas
  radioDel: 0.36,
  radioTras: 0.365,
  inerciaRueda: 1.2,
  // Dirección
  angMaxRueda: 0.33,        // ángulo máximo de la rueda delantera (rad)
  ackermann: 0.08,
  // Suspensión (para transferencias dinámicas y alturas)
  rigidezBalanceoTotal: 220000, // N·m/rad
  rigidezCabeceo: 300000,
  muelleDel: 240000,        // N/m equivalente en rueda (por eje)
  muelleTras: 190000,
  alturaLibreDel: 0.032,    // m, estática
  alturaLibreTras: 0.075,
  // Aerodinámica (valores base, el reglaje los modifica)
  areaFrontal: 1.5,
  // Motor
  rpmRalenti: 4000,
  rpmLimite: 15000,
  rpmEmbrague: 6500,
  inerciaMotor: 0.09,
  // curva de par del motor térmico (rpm, N·m)
  curvaPar: [
    [3000, 220], [4000, 270], [6000, 340], [8000, 400], [10000, 440],
    [11000, 455], [12000, 448], [13000, 425], [14000, 392], [15000, 352], [15500, 0],
  ],
  frenoMotor: [30, 0.0042],  // N·m = a + b·rpm
  eficiencia: 0.92,
  relaciones: [19.6, 15.2, 12.2, 10.2, 8.75, 7.55, 6.5, 5.55],
  relacionReversa: -16,
  tiempoCambioSubir: 0.035,
  tiempoCambioBajar: 0.06,
  // ERS (MGU-K)
  ersPotencia: 120000,       // W
  ersParMax: 200,            // N·m en el cigüeñal
  ersCapacidad: 4.0e6,       // J
  ersDespliegueVuelta: 4.0e6,
  ersRecuperacionVuelta: 2.0e6,
  // Combustible
  consumoMax: 100 / 3600,    // kg/s a plena carga
  // Frenos
  parFrenoMax: 13200,        // N·m sumando las cuatro ruedas
  frenoTempOpt: [350, 1000], // °C ventana del carbono
  // Rozamiento de rodadura
  rodadura: 0.012,
};

// Reglaje por defecto (valores enteros como en un simulador)
export const REGLAJE_DEF = {
  aleronDel: 6,      // 1..11
  aleronTras: 6,     // 1..11
  repartoFreno: 57,  // % delante, 50..65
  difTraccion: 60,   // % bloqueo en aceleración, 20..100
  difRetencion: 45,  // % bloqueo en retención, 20..100
  barraDel: 6,       // 1..11
  barraTras: 5,      // 1..11
  alturaDel: 3,      // 1..10 (mm extra sobre la mínima / 3)
  alturaTras: 5,
  presion: 5,        // 1..10 (afecta calentamiento, agarre y desgaste)
  compuesto: 'blando',
};

// Neumáticos: agarre base, ventana térmica, desgaste
export const COMPUESTOS = {
  blando: { nombre: 'Blando', color: '#e8202a', mu: 1.80, tOpt: 100, ancho: 26, calor: 1.15, desgaste: 1.6 },
  medio:  { nombre: 'Medio',  color: '#f5c518', mu: 1.75, tOpt: 105, ancho: 28, calor: 1.0,  desgaste: 1.0 },
  duro:   { nombre: 'Duro',   color: '#f2f2f2', mu: 1.70, tOpt: 112, ancho: 30, calor: 0.85, desgaste: 0.6 },
};

// Equipos ficticios: 11 escuderías con dos pilotos (22 coches como en la parrilla real)
export const EQUIPOS = [
  { nombre: 'UpGames Racing', corto: 'UPG', base: '#0d47ff', acento: '#00e5ff', tercero: '#ffffff', pilotos: ['Tú', 'R. Castro'], patron: 'flecha' },
  { nombre: 'Rosso Vulcano', corto: 'RSV', base: '#c4061a', acento: '#ffd200', tercero: '#111111', pilotos: ['L. Moretti', 'A. Ferrandi'], patron: 'franjas' },
  { nombre: 'Silver Arrowhead', corto: 'SAH', base: '#b9c2c9', acento: '#00b3a4', tercero: '#111111', pilotos: ['K. Brandt', 'J. Weller'], patron: 'degradado' },
  { nombre: 'Nightbull', corto: 'NBL', base: '#14204a', acento: '#e3001b', tercero: '#ffd200', pilotos: ['M. Varga', 'T. Okafor'], patron: 'rayo' },
  { nombre: 'Papaya Speed', corto: 'PAP', base: '#ff7a00', acento: '#1c8dff', tercero: '#111111', pilotos: ['O. Reyes', 'N. Harlow'], patron: 'geometrico' },
  { nombre: 'Verde Andino', corto: 'VAN', base: '#0b6b4f', acento: '#c8ff00', tercero: '#ffffff', pilotos: ['S. Quintero', 'D. Arango'], patron: 'franjas' },
  { nombre: 'Alpine Blue', corto: 'ALB', base: '#1060d0', acento: '#ff4fa3', tercero: '#ffffff', pilotos: ['P. Dubois', 'E. Marchand'], patron: 'degradado' },
  { nombre: 'Kraken GP', corto: 'KRK', base: '#1b1b1f', acento: '#ff3df5', tercero: '#00e5ff', pilotos: ['H. Sato', 'Y. Mori'], patron: 'digital' },
  { nombre: 'Halcón Dorado', corto: 'HDO', base: '#f2f2f2', acento: '#c9a227', tercero: '#111111', pilotos: ['F. Salgado', 'C. Ibarra'], patron: 'flecha' },
  { nombre: 'Polar Racing', corto: 'POL', base: '#e8f4ff', acento: '#0057b8', tercero: '#ff3b3b', pilotos: ['A. Lindqvist', 'M. Koskinen'], patron: 'geometrico' },
  { nombre: 'Tormenta Roja', corto: 'TRJ', base: '#5a0b1e', acento: '#ff5a1f', tercero: '#ffffff', pilotos: ['V. Petrov', 'G. Rinaldi'], patron: 'llamas' },
];

// Efecto de cada nivel de mejora comprada con UpCoins (niveles 0..5). Los mismos
// nombres que modulos/apexgp.js en el servidor.
export const MEJORAS_INFO = {
  motor: 'Motor', aero: 'Aerodinámica', frenos: 'Frenos', chasis: 'Chasis ligero', neumaticos: 'Neumáticos', ers: 'ERS',
};
export function efectosMejoras(m = {}) {
  const n = (k) => Math.max(0, Math.min(5, Math.floor(m?.[k] || 0)));
  return {
    potencia: 1 + 0.012 * n('motor'),
    cl: 1 + 0.01 * n('aero'), cd: 1 - 0.006 * n('aero'),
    freno: 1 + 0.03 * n('frenos'), refrigeracion: 1 + 0.1 * n('frenos'),
    kg: 3 * n('chasis'),
    desgaste: 1 - 0.06 * n('neumaticos'), mu: 1 + 0.004 * n('neumaticos'),
    ers: 1 + 0.05 * n('ers'), recuperacion: 1 + 0.04 * n('ers'),
  };
}
