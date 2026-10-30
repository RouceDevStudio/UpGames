// Reglaje guiado: el piloto describe lo que siente y el ingeniero propone cambios
// concretos sobre el reglaje, con la explicación de cada uno. Las reglas siguen la
// práctica habitual de ingeniería de pista (equilibrio aerodinámico, barras, diferencial,
// reparto de frenada, alturas y presiones).

const LIM = {
  aleronDel: [1, 11], aleronTras: [1, 11], repartoFreno: [50, 65], difTraccion: [20, 100], difRetencion: [20, 100],
  barraDel: [1, 11], barraTras: [1, 11], alturaDel: [1, 10], alturaTras: [1, 10], presion: [1, 10],
};

export const SINTOMAS = [
  { id: 'subLento', texto: 'Subvira en curvas lentas', icono: '↪️',
    cambios: [['barraDel', -2, 'Barra delantera más blanda: el eje delantero agarra mejor en apoyo'], ['difRetencion', -10, 'Menos bloqueo en retención: el coche gira mejor al soltar el freno'], ['alturaDel', -1, 'Morro algo más bajo: más carga delante']] },
  { id: 'subRapido', texto: 'Subvira en curvas rápidas', icono: '🌀',
    cambios: [['aleronDel', 1, 'Más ala delantera: más carga en el eje delantero a alta velocidad'], ['aleronTras', -1, 'Algo menos de ala trasera para equilibrar']] },
  { id: 'sobreEntrada', texto: 'Sobrevira al entrar (al frenar)', icono: '⚠️',
    cambios: [['repartoFreno', 2, 'Más freno delante: la trasera no se suelta al frenar'], ['difRetencion', 12, 'Más bloqueo en retención: estabiliza la trasera'], ['barraTras', -1, 'Barra trasera más blanda']] },
  { id: 'sobreSalida', texto: 'Sobrevira al acelerar (salida)', icono: '💨',
    cambios: [['difTraccion', -12, 'Menos bloqueo en tracción: la rueda interior no empuja de más'], ['aleronTras', 1, 'Más ala trasera: más carga para traccionar'], ['barraTras', -1, 'Barra trasera más blanda: más agarre mecánico detrás']] },
  { id: 'inestableRapido', texto: 'Nervioso en curvas rápidas', icono: '😬',
    cambios: [['aleronTras', 2, 'Más ala trasera: estabilidad en apoyo largo'], ['alturaTras', -1, 'Trasera un poco más baja: plataforma aerodinámica más estable']] },
  { id: 'puntaBaja', texto: 'Falta velocidad punta', icono: '🏁',
    cambios: [['aleronTras', -2, 'Menos ala trasera: menos resistencia en recta'], ['aleronDel', -1, 'Menos ala delantera para mantener el equilibrio']] },
  { id: 'bloqueaDel', texto: 'Bloquea las ruedas delanteras', icono: '🛑',
    cambios: [['repartoFreno', -2, 'Reparto hacia atrás: el eje delantero no se satura'], ['presion', -1, 'Presión algo menor: más huella delante']] },
  { id: 'bloqueaTras', texto: 'Bloquea las traseras al frenar', icono: '🔁',
    cambios: [['repartoFreno', 2, 'Reparto hacia delante'], ['difRetencion', 8, 'Más retención: la trasera acompaña']] },
  { id: 'calienta', texto: 'Los neumáticos se recalientan', icono: '🔥',
    cambios: [['presion', -1, 'Menos presión: menos temperatura en la banda'], ['difTraccion', -8, 'Menos patinaje en tracción'], ['barraTras', -1, 'Menos deslizamiento de la trasera']] },
  { id: 'frios', texto: 'No calientan los neumáticos', icono: '🧊',
    cambios: [['presion', 1, 'Más presión: el neumático trabaja más y sube de temperatura'], ['barraDel', 1, 'Barras más duras: más carga en cada rueda']] },
  { id: 'baches', texto: 'Toca fondo / rebota en baches', icono: '〰️',
    cambios: [['alturaDel', 1, 'Más altura delante: no toca el fondo'], ['alturaTras', 1, 'Más altura detrás'], ['barraDel', -1, 'Más blando para absorber los bordillos']] },
];

/** Devuelve la propuesta: cambios con valor antes/después (ya limitados a su rango). */
export function proponer(reglaje, idSintoma) {
  const s = SINTOMAS.find(x => x.id === idSintoma);
  if (!s) return null;
  const cambios = [];
  for (const [campo, delta, porque] of s.cambios) {
    const [a, b] = LIM[campo];
    const antes = reglaje[campo], despues = Math.max(a, Math.min(b, antes + delta));
    if (despues !== antes) cambios.push({ campo, antes, despues, porque });
  }
  return { sintoma: s, cambios };
}

/** Frase para la radio (corta). */
export function frase(p) {
  if (!p.cambios.length) return 'Ese ajuste ya está al límite. Prueba otro síntoma o cambia el compuesto.';
  const prim = p.cambios[0].porque.split(':')[0].toLowerCase();
  return `Entendido: ${p.sintoma.texto.toLowerCase()}. Te propongo ${p.cambios.length} cambio${p.cambios.length > 1 ? 's' : ''}; el principal, ${prim}.`;
}
