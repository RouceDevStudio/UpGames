# UpGames Studio

Modelador 3D táctil para el celular (y el PC), en `upgames.games/studio`. Plan completo en
[`docs/upgames-studio.md`](../../docs/upgames-studio.md).

## Hecho: etapa 1, sprint 1 (esqueleto)
- PWA con Three.js r170 (la misma versión que APEX GP), sin conexión con `sw.js`.
- Cámara orbital táctil propia (`js/camara.js`, `js/ui/gestos.js`):
  1 dedo toca = seleccionar, arrastra en vacío = orbitar; 2 dedos = orbitar y pellizco para zoom;
  3 dedos = desplazar; doble toque = enfocar; pulsación larga = menú radial.
  Ratón: izquierdo orbita, derecho/central o Mayús desplaza, rueda zoom.
- Vistas Frente / Lado / Arriba / 3D, cuadrícula, ejes y ajuste magnético (0,25 · 15° · 0,1).
- Primitivas: cubo, esfera UV, icoesfera, cilindro, cono, toro, plano y cápsula.
- Gizmo grande mover / girar / escalar, ejes del mundo o locales.
- Panel de escena: renombrar, color, ocultar, bloquear, duplicar y borrar.
- Deshacer / rehacer ilimitado con patrón comando (`js/deshacer.js`) para todo lo anterior.
- **Desde foto** (`js/foto/`):
  - 1 foto: recorta la silueta del fondo liso y la infla en 3D con la foto como textura.
  - 2 fotos (frente + lado): casco visual con vóxeles y «surface nets», coloreado con las fotos.
- Exportar la escena a GLB.

## Atajos en el PC
G/W mover · R/E girar · S escalar · F enfocar · 1/3/7/5 vistas · Ctrl+Z / Ctrl+Y ·
Mayús+D duplicar · Supr borrar · Esc soltar selección.

## Pruebas
`node test/studio.test.mjs` (deshacer, recorte de silueta, relieve y casco visual cerrados).
