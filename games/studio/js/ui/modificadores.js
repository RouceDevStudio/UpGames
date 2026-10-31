// Panel de modificadores del objeto seleccionado (sprint 4): añadir, ajustar, ocultar, aplicar y
// quitar. Cada cambio es un paso de deshacer.
import { TIPOS, nuevoModificador, evaluar } from '../malla/modificadores.js';
import { mallaDe, ponerMalla, refrescarObjeto } from '../edicion.js';
import { mallas } from '../escena.js';

const clonar = (x) => JSON.parse(JSON.stringify(x || []));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function instalarModificadores({ escena, historial, edicion, ponerModo, aviso, ctx }) {
  const lista = document.getElementById('listaMods'), sel = document.getElementById('selMod');
  sel.innerHTML = '<option value="">+ Añadir modificador…</option>' + Object.entries(TIPOS).map(([k, t]) => `<option value="${k}">${t.nombre}</option>`).join('');

  // cambia la pila de un objeto (con deshacer)
  function cambiar(obj, nuevos, nombre) {
    const antes = clonar(obj.userData.modificadores), despues = clonar(nuevos);
    const poner = (mods) => { obj.userData.modificadores = clonar(mods); refrescarObjeto(obj); escena.avisar(); };
    historial.hacer({ nombre, hacer: () => poner(despues), deshacer: () => poner(antes) });
  }

  sel.addEventListener('change', () => {
    const obj = escena.seleccion, tipo = sel.value;
    sel.value = '';
    if (!obj || !tipo) return;
    if (edicion.activo) ponerModo('objeto');
    mallaDe(obj);
    const mod = nuevoModificador(tipo);
    if (tipo === 'booleana') {
      const otro = escena.objetos.find((o) => o !== obj && o.visible);
      if (!otro) { aviso('Añade otro objeto para cortar con él'); return; }
      mod.objeto = otro.uuid;
    }
    cambiar(obj, [...(obj.userData.modificadores || []), mod], `Añadir ${TIPOS[tipo].nombre}`);
  });

  lista.addEventListener('change', (e) => {
    const obj = escena.seleccion, campo = e.target.dataset.campo, i = +e.target.closest('[data-i]')?.dataset.i;
    if (!obj || !campo || Number.isNaN(i)) return;
    const mods = clonar(obj.userData.modificadores);
    const t = e.target;
    mods[i][campo] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? +t.value : t.value;
    cambiar(obj, mods, `${TIPOS[mods[i].tipo].nombre}: ${campo}`);
  });

  lista.addEventListener('click', (e) => {
    const b = e.target.closest('[data-acc]'), obj = escena.seleccion;
    if (!b || !obj) return;
    const i = +b.closest('[data-i]').dataset.i, mods = clonar(obj.userData.modificadores);
    if (b.dataset.acc === 'ver') { mods[i].visible = !mods[i].visible; cambiar(obj, mods, mods[i].visible ? 'Mostrar modificador' : 'Ocultar modificador'); }
    else if (b.dataset.acc === 'quitar') { const [q] = mods.splice(i, 1); cambiar(obj, mods, `Quitar ${TIPOS[q.tipo].nombre}`); }
    else if (b.dataset.acc === 'aplicar') aplicar(obj, i);
    else if (b.dataset.acc === 'subir' || b.dataset.acc === 'bajar') {
      const j = b.dataset.acc === 'subir' ? i - 1 : i + 1;
      if (j < 0 || j >= mods.length) return;
      [mods[i], mods[j]] = [mods[j], mods[i]];
      cambiar(obj, mods, 'Reordenar modificadores');
    }
  });

  // Aplicar: la malla base pasa a ser el resultado hasta ese modificador (incluido) y esos salen de la pila.
  function aplicar(obj, i) {
    if (edicion.activo) ponerModo('objeto');
    const base = mallaDe(obj), mods = clonar(obj.userData.modificadores);
    const nueva = evaluar(base, mods, { poligonosDe: (id) => ctx.poligonosDe(id, obj) }, i + 1);
    const restantes = mods.slice(i + 1);
    const poner = (m, ms) => { obj.userData.modificadores = clonar(ms); ponerMalla(obj, m); escena.avisar(); };
    historial.hacer({ nombre: `Aplicar ${TIPOS[mods[i].tipo].nombre}`, hacer: () => poner(nueva, restantes), deshacer: () => poner(base, mods) });
    aviso(`${TIPOS[mods[i].tipo].nombre} aplicado: ${nueva.nV} vértices, ${nueva.nF} caras`);
  }

  function pintar() {
    const obj = escena.seleccion;
    const mods = obj?.userData.modificadores || [];
    lista.innerHTML = mods.map((m, i) => `
      <div class="mod ${m.visible ? '' : 'apagado'}" data-i="${i}">
        <div class="mod-cab"><b>${TIPOS[m.tipo].nombre}</b>
          <button data-acc="subir" class="mover" title="Subir (se aplica antes)" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button data-acc="bajar" class="mover" title="Bajar (se aplica después)" ${i === mods.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-acc="ver" title="Mostrar u ocultar">${m.visible ? 'Ver' : 'Oculto'}</button>
          <button data-acc="aplicar" title="Aplicar (hasta aquí)">Aplicar</button>
          <button data-acc="quitar" class="peligro" title="Quitar">✕</button>
        </div>
        <div class="mod-campos">${campos(m, obj)}</div>
      </div>`).join('');
  }

  function campos(m, obj) {
    const num = (k, et, paso = 1, min = '', max = '') => `<label>${et}<input type="number" data-campo="${k}" value="${m[k]}" step="${paso}" min="${min}" max="${max}"></label>`;
    const casilla = (k, et) => `<label class="fila"><input type="checkbox" data-campo="${k}" ${m[k] ? 'checked' : ''}>${et}</label>`;
    const opciones = (k, et, ops) => `<label>${et}<select data-campo="${k}">${ops.map(([v, t]) => `<option value="${v}" ${m[k] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    switch (m.tipo) {
      case 'espejo': return opciones('eje', 'Eje', [['x', 'X'], ['y', 'Y'], ['z', 'Z']]) + casilla('coser', 'Coser el centro');
      case 'subdivision': return num('niveles', 'Niveles', 1, 0, 4);
      case 'matriz': return num('cantidad', 'Copias', 1, 1, 50) + num('x', 'X', 0.1) + num('y', 'Y', 0.1) + num('z', 'Z', 0.1) + casilla('relativo', 'Relativo al tamaño');
      case 'solidificar': return num('grosor', 'Grosor', 0.01);
      case 'booleana': return opciones('operacion', 'Operación', [['resta', 'Resta'], ['union', 'Unión'], ['interseccion', 'Intersección']])
        + opciones('objeto', 'Con', escena.objetos.filter((o) => o !== obj).map((o) => [o.uuid, esc(o.name)]));
      default: return '';
    }
  }

  escena.alCambiar(pintar);

  // las booleanas siguen al objeto que corta: si cambia la posición relativa, se recalculan
  const firmas = new WeakMap();
  escena.alCambiar(() => {
    for (const obj of escena.objetos) {
      const bools = (obj.userData.modificadores || []).filter((m) => m.tipo === 'booleana' && m.visible);
      if (!bools.length || obj.userData.editando) continue;
      obj.updateMatrixWorld();
      const firma = bools.map((m) => { const o = escena.objetos.find((q) => q.uuid === m.objeto); return o ? o.matrixWorld.elements.join() + (mallas.get(o)?.nV ?? '') : ''; }).join('|') + obj.matrixWorld.elements.join();
      if (firmas.get(obj) !== firma) { firmas.set(obj, firma); refrescarObjeto(obj); }
    }
  });
  return { pintar };
}
