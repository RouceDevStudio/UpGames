// Exportar la escena a GLB (Blender, Unity, Godot y APEX GP lo abren).
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { descargar } from './descargar.js';

// animaciones (opcional): AnimationClip de la línea de tiempo, se guardan dentro del GLB
export async function exportarGLB(raiz, nombre = 'modelo', animaciones = []) {
  const visibles = raiz.children.filter((o) => o.visible);
  if (!visibles.length) throw new Error('vacío');
  const datos = await new GLTFExporter().parseAsync(visibles, { binary: true, onlyVisible: true, animations: animaciones });
  await descargar(datos, `${nombre}.glb`, 'model/gltf-binary');
}
