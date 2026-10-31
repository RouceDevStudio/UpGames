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

  // grupo: el gizmo mueve un pivote en el centro del grupo y cada pieza le sigue
  const pivoteGrupo = new THREE.Object3D();
  pivoteGrupo.name = 'pivote del grupo';
  scene.add(pivoteGrupo);
  let antes = null, grupo = null;
  tc.addEventListener('mouseDown', () => {
    if (api.pivote) api.edicion?.empezar();
    else if (tc.object === pivoteGrupo) {
      const objs = escena.miembros(escena.seleccion);
      pivoteGrupo.updateMatrixWorld();
      grupo = { objs, antes: objs.map(estado), M0: objs.map((o) => { o.updateMatrixWorld(); return o.matrixWorld.clone(); }), P0inv: pivoteGrupo.matrixWorld.clone().invert() };
    } else if (tc.object) antes = estado(tc.object);
  });
  tc.addEventListener('objectChange', () => {
    if (api.pivote) api.edicion?.mover();
    else if (grupo) {
      pivoteGrupo.updateMatrixWorld();
      const T = pivoteGrupo.matrixWorld.clone().multiply(grupo.P0inv);
      grupo.objs.forEach((o, i) => { new THREE.Matrix4().multiplyMatrices(T, grupo.M0[i]).decompose(o.position, o.quaternion, o.scale); o.updateMatrixWorld(); });
    }
  });
  tc.addEventListener('mouseUp', () => {
    if (api.pivote) api.edicion?.soltar();
    else if (grupo) { escena.transformadoVarios(grupo.objs, grupo.antes); grupo = null; }
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
      let o = api.edicion?.activo ? api.pivote : escena.seleccion;
      if (!api.edicion?.activo && o && escena.enGrupo(o) && !grupo) {
        // pivote en el centro del grupo, sin giro ni escala
        const caja = new THREE.Box3();
        for (const m of escena.miembros(o)) caja.expandByObject(m);
        caja.getCenter(pivoteGrupo.position); pivoteGrupo.quaternion.identity(); pivoteGrupo.scale.set(1, 1, 1);
        pivoteGrupo.updateMatrixWorld();
        if (!o.userData.bloqueado) { if (tc.object !== pivoteGrupo) tc.attach(pivoteGrupo); return; }
      }
      if (grupo) return;
      const ok = o && (api.pivote === o || (o.visible && !o.userData.bloqueado));
      if (ok) { if (tc.object !== o) tc.attach(o); }
      else if (tc.object) tc.detach();
    },
  };
  escena.alCambiar(api.sincronizar);
  return api;
}
