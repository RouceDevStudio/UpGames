// Gizmo mover / girar / escalar (TransformControls), grande para los dedos, con ajuste
// magnético y deshacer al soltar. En modo edición mueve un pivote y el modo edición aplica
// ese movimiento a los vértices seleccionados.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { estado } from '../escena.js';

export function crearGizmo(camara, lienzo, scene, escena) {
  const tc = new TransformControls(camara, lienzo);
  const tactil = matchMedia('(pointer: coarse)').matches;
  tc.setSize(tactil ? 1.5 : 1.05);
  scene.add(tc.getHelper());

  let antes = null;
  tc.addEventListener('mouseDown', () => {
    if (api.pivote) api.edicion?.empezar();
    else if (tc.object) antes = estado(tc.object);
  });
  tc.addEventListener('objectChange', () => { if (api.pivote) api.edicion?.mover(); });
  tc.addEventListener('mouseUp', () => {
    if (api.pivote) api.edicion?.soltar();
    else if (tc.object && antes) escena.transformado(tc.object, antes);
    antes = null;
  });

  const api = {
    tc,
    pivote: null,   // en modo edición: el objeto que mueve el gizmo
    edicion: null,
    get arrastrando() { return tc.dragging; },
    modo(m) { tc.setMode(m); },
    espacio(local) { tc.setSpace(local ? 'local' : 'world'); },
    iman(si) {
      tc.setTranslationSnap(si ? 0.25 : null);
      tc.setRotationSnap(si ? THREE.MathUtils.degToRad(15) : null);
      tc.setScaleSnap(si ? 0.1 : null);
    },
    sincronizar() {
      const o = api.edicion?.activo ? api.pivote : escena.seleccion;
      const ok = o && (api.pivote === o || (o.visible && !o.userData.bloqueado));
      if (ok) { if (tc.object !== o) tc.attach(o); }
      else if (tc.object) tc.detach();
    },
  };
  escena.alCambiar(api.sincronizar);
  return api;
}
