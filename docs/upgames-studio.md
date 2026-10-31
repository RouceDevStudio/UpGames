# UpGames Studio: plan completo

App para **crear modelos 3D, animarlos y hacer juegos desde el celular** (y desde
upgames.games en el PC), sin instalar nada más. Es «el intento de Blender en Android»,
hecho a nuestra medida: Blender no corre en Android y su interfaz no sirve para dedos, así
que se construye un modelador propio, web y táctil, que exporta a los formatos de Blender
(GLB/OBJ) para que los modelos vayan y vuelvan entre los dos.

> Esta sesión es solo del juego (APEX GP). Studio se empieza en **otra sesión**, con el
> mensaje de arranque del final de este documento.

---

## 1. Decisiones de base

| Tema | Decisión | Por qué |
|---|---|---|
| Plataforma | Web (PWA) + APK con Capacitor | Igual que APEX GP: una base de código para web, Android y PC |
| Motor 3D | Three.js (la misma versión vendorizada que APEX GP) | Ya lo conocemos; trae GLTFExporter/Loader, OBJ, TransformControls |
| Datos de malla | Estructura propia de **media arista** (half-edge) | Permite extruir, biselar, cortes en bucle y subdividir sin romper la malla |
| Render | La malla se convierte a BufferGeometry solo para dibujarla | La edición no depende de Three.js y es rápida |
| Deshacer | Patrón comando (cada operación sabe hacerse y deshacerse) | Deshacer/rehacer ilimitado y guardado incremental |
| Guardado | IndexedDB local, automático cada 10 s y al salir; nube opcional con la cuenta UpGames | Funciona sin conexión |
| Formatos | Propio `.ups` (JSON comprimido) + exportar/importar **GLB**, **OBJ**, **STL** | GLB entra en APEX GP, Blender, Unity y Godot |
| Cuenta y servidor | Los de UpGames (Railway, Express) | Login, UpCoins y publicar ya existen |
| Carpeta | `apps/upgames-studio/` (web en `games/studio/` para servirla en upgames.games/studio) | Mismo patrón que `games/monoplaza` + `apps/apex-gp-android` |

---

## 2. Etapas (cada una se puede publicar sola)

### Etapa 1: Modelador táctil (el núcleo)
**Gestos**
- 1 dedo: seleccionar o mover el gizmo.
- 2 dedos: orbitar y zoom.
- 3 dedos: desplazar.
- Doble toque: enfocar lo seleccionado.
- Pulsación larga: menú radial con las herramientas a mano.

**Interfaz**
- Barra inferior grande para el pulgar: Objeto, Editar, Esculpir, Pintar, Material, Animar.
- Gizmos grandes (mover, girar, escalar) con ejes que se pueden tocar.
- Cuadrícula y ajuste magnético.
- Vista única con botones de cámara (frente, lado, arriba, perspectiva) en vez de cuatro vistas.

**Modo objeto**
- Primitivas: cubo, esfera UV e ico, cilindro, cono, toro, plano, cápsula y texto 3D.
- Duplicar, agrupar, jerarquía, ocultar, bloquear.

**Modo edición**
- Seleccionar vértices, aristas y caras, y bucles de aristas.
- Extruir, insertar cara (inset), biselar y cortes en bucle (loop cut).
- Fusionar y separar, rellenar, borrar y disolver.
- Subdividir (Catmull-Clark) y suavizar.

**Modificadores (no destructivos)**
- Espejo (con ajuste al centro), subdivisión, matriz (array).
- Booleana (unión, resta, intersección) y solidificar.
- Se pueden aplicar o quitar.

**Materiales PBR**
- Color, metal, rugosidad, emisión y transparencia.
- Biblioteca: carbono, pintura de coche, goma, cromo, cristal, tela y metal.

**Texturas**
- Desde la galería o la cámara del móvil.
- UV automático (proyección inteligente) y vista UV simple.
- Pintar directamente sobre el modelo.

**Esculpido básico**
- Pinceles: inflar, alisar, pellizcar, arrastrar y aplanar, con máscara.
- Usa subdivisión dinámica limitada para no saturar el móvil.

**Referencias**
- Imagen de fondo (calco), por ejemplo las capturas que me pasaste del F1.

**Modelos desde fotos** (adelantado en el sprint 1)
- 1 foto: recorte automático de la silueta sobre fondo liso, inflado en 3D con la foto como textura.
- 2 fotos (frente + lado): casco visual con vóxeles y «surface nets», coloreado con las fotos.
- Más adelante: más vistas (3–8 fotos alrededor) y profundidad estimada con IA en el servidor.

**Exportar e importar**
- GLB, OBJ y STL, y el formato propio `.ups`.

**Rendimiento en móvil**
- 60 FPS con 100 000 triángulos.
- Edición fluida hasta unos 20 000 vértices en modo edición.

**Criterio de terminado de la etapa 1:** modelar en el móvil un monoplaza sencillo (morro,
pontones, alerones y ruedas), exportarlo a GLB y que **APEX GP lo cargue como coche**.

### Etapa 2: Animación
- Línea de tiempo con fotogramas clave para posición, rotación, escala y materiales, con curvas de suavizado.
- Esqueleto: huesos a mano, y automático para humanoides (plantilla y ajuste a la malla). Pesos automáticos y pintura de pesos.
- Biblioteca de poses y animaciones: andar, correr, saludar, celebrar, sentarse (como las de los mecánicos del juego).
- «Grabar movimiento»: mover un hueso con el dedo mientras corre el tiempo.
- Exporta las animaciones dentro del GLB.

### Etapa 3: Juegos sin programar
- **Editor de escenas:** suelo, cielo, luz y física (Rapier en WASM, ligera y rápida en móvil).
- **Comportamientos por ajustes:**
  - controlable (tipo plataforma o coche), vehículo con suspensión;
  - enemigo que patrulla o persigue, moneda, vida, puerta con llave;
  - meta, cámara que sigue, punto de control, zona de daño.
- **Bloques visuales** tipo Scratch (eventos → condiciones → acciones).
- **Modo código** JavaScript con API documentada y autocompletado (para usuarios avanzados).
- **Plantillas:** carreras (basada en APEX GP), plataformas 3D, disparos en tercera persona, puzles y mundo abierto pequeño.
- **Botón «Jugar»** que prueba al instante en el móvil.

### Etapa 4: Publicar y comunidad
- Publicar en UpGames con un botón: enlace propio, miniatura automática y página del juego.
- Ranking, logros y multijugador simple reutilizando el servidor actual (salas Socket.IO).
- Exportar a APK (plantilla Capacitor generada en el servidor con GitHub Actions, como el APK de APEX GP).
- Tienda de modelos y plantillas con UpCoins (el autor cobra una parte).
- **Nexus IA** como asistente:
  - «hazme un coche rojo»: genera una base con primitivas y modificadores;
  - «ponle ruedas»;
  - «anima que salte»;
  - explica herramientas paso a paso.

---

## 3. Arquitectura de archivos (etapa 1)

```
games/studio/
  index.html              interfaz (barra inferior, paneles, menú radial)
  estilo.css
  sw.js, manifest.webmanifest
  js/
    main.js               arranque, bucle de render, modo actual
    escena.js             objetos, jerarquía, selección
    malla/
      mediaArista.js      estructura half-edge (vértices, aristas, caras, bucles)
      operaciones.js      extruir, inset, biselar, loop cut, fusionar, borrar
      subdividir.js       Catmull-Clark
      booleanas.js        CSG (three-bvh-csg o propio con BSP)
      aGeometria.js       half-edge → BufferGeometry (con normales y UV)
    modificadores.js      espejo, subdivisión, matriz, solidificar (pila no destructiva)
    herramientas/
      seleccion.js  gizmo.js  esculpir.js  pintar.js  uv.js
    deshacer.js           pila de comandos
    archivo/
      ups.js  glb.js  obj.js  stl.js  guardado.js (IndexedDB + nube)
    ui/
      gestos.js           1/2/3 dedos, pulsación larga, pellizco
      barra.js  paneles.js  radial.js
apps/upgames-studio-android/   proyecto Capacitor (igual que apps/apex-gp-android)
.github/workflows/apk-studio.yml   APK en cada push que toque games/studio
modulos/studio.js + rutas/studio.js   en el servidor: proyectos en la nube y publicar
```

---

## 4. Plan de trabajo de la etapa 1 (sprints cortos)

1. ✅ **Esqueleto** (publicado en upgames.games/studio, con «Desde foto»):
   - página, PWA, Three.js, cámara orbital táctil y cuadrícula;
   - primitivas y selección;
   - gizmo mover, girar y escalar;
   - deshacer.
2. ✅ **Half-edge:** construir desde primitivas y dibujar; seleccionar vértices, aristas y caras; mover componentes.
3. ✅ **Operaciones:** extruir, inset, loop cut, borrar, fusionar, suavizar, simetría X; subdividir (Catmull-Clark). Pendiente: biselar.
4. ✅ **Modificadores:** espejo, subdivisión, matriz, solidificar y booleanas (unión, resta, intersección con BSP) en una pila no destructiva; se ocultan, se quitan o se aplican.
5. ✅ **Materiales y texturas:** PBR (color, metal, rugosidad, emisión, opacidad, barniz), biblioteca de 8 materiales, entorno de luz para reflejos, UV automático por direcciones con vista UV, textura desde la galería o la cámara.
6. **Archivos:** guardado automático; exportar GLB/OBJ/STL; importar GLB/OBJ.
7. **Esculpir y pintar:** versión básica.
8. **APK:** proyecto Capacitor, flujo de GitHub Actions, enlace de descarga en el servidor.
9. **Prueba real:** modelar el monoplaza y cargarlo en APEX GP.

En cada sprint: pruebas automáticas de las operaciones de malla (sin navegador, con Node), prueba
en el móvil (gestos y FPS) y publicación en upgames.games/studio.

---

## 5. Conexión con APEX GP

- APEX GP ya acepta modelos externos: añadir en el garaje «Cargar coche GLB» (escala y posición de
  ruedas automáticas por nombres de pieza: `rueda_del_izq`, `alerón_trasero`, `halo`…).
- Studio trae una **plantilla de monoplaza** con esas piezas ya nombradas para que el coche
  modelado se pueda conducir y romper con los daños por zonas del juego.

---

## 6. Mensaje para empezar en la otra sesión

> «Empezamos UpGames Studio siguiendo `docs/upgames-studio.md` del repo RouceDevStudio/UpGames.
> Haz la etapa 1, sprint 1 (esqueleto con cámara táctil, primitivas, gizmo y deshacer) en
> `games/studio/`, publícalo en upgames.games/studio y dame el enlace. Respóndeme en español.»
