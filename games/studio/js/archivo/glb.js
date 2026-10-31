// Exportar la escena a GLB (Blender, Unity, Godot y APEX GP lo abren).
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export async function exportarGLB(raiz, nombre = 'modelo') {
  const visibles = raiz.children.filter((o) => o.visible);
  if (!visibles.length) throw new Error('vacío');
  const datos = await new GLTFExporter().parseAsync(visibles, { binary: true, onlyVisible: true });
  const url = URL.createObjectURL(new Blob([datos], { type: 'model/gltf-binary' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${nombre}.glb` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
