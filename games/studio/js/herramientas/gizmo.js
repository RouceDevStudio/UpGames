// Gizmo mover / girar / escalar (TransformControls), grande para los dedos, con ajuste
// magnético y deshacer al soltar.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { estado } from '../escena.js';

export function crearGizmo(camara, lienzo, scene, escena) {
  const tc = new TransformControls(camara, lienzo);
  const tactil = matchMedia('(pointer: coarse)').matches;
  tc.setSize(tactil ? 1.5 : 1.05);
  scene.add(tc.getHelper());

  let antes = null;
  tc.addEventListener('mouseDown', () => { if (tc.object) antes = estado(tc.object); });
  tc.addEventListener('mouseUp', () => {
    if (tc.object && antes) escena.transformado(tc.object, antes);
    antes = null;
  });
  escena.alCambiar(() => {
    const o = escena.seleccion;
    if (o && o.visible && !o.userData.bloqueado) { if (tc.object !== o) tc.attach(o); }
    else if (tc.object) tc.detach();
  });

  const api = {
    tc,
    get arrastrando() { return tc.dragging; },
    modo(m) { tc.setMode(m); },
    espacio(local) { tc.setSpace(local ? 'local' : 'world'); },
    iman(si) {
      tc.setTranslationSnap(si ? 0.25 : null);
      tc.setRotationSnap(si ? THREE.MathUtils.degToRad(15) : null);
      tc.setScaleSnap(si ? 0.1 : null);
    },
  };
  return api;
}
