# UpGames Studio (pendiente)

App para crear modelos 3D, animaciones y juegos desde el celular o desde upgames.games.
Se retoma cuando APEX GP esté terminado. Misma base que APEX GP: web (Three.js) + PWA + APK con Capacitor,
cuenta de UpGames y servidor existente.

## Etapas
1. **Modelador táctil**: gestos (1 dedo seleccionar, 2 girar/zoom, 3 desplazar), gizmos grandes,
   primitivas, modo edición de vértices/aristas/caras, extruir, biselar, cortes en bucle, subdividir,
   espejo, booleanas simples; materiales PBR, texturas desde la cámara, pintura sobre el modelo,
   UV automático; importar/exportar GLB y OBJ; guardado automático (IndexedDB) y deshacer ilimitado.
2. **Animación**: línea de tiempo con fotogramas clave, esqueleto automático para humanoides,
   biblioteca de poses, modo «grabar movimiento» con el dedo.
3. **Juegos sin programar**: editor de escenas con física; comportamientos por ajustes (controlable,
   vehículo, enemigo que patrulla, moneda, puerta con llave, meta, cámara que sigue); bloques visuales
   tipo Scratch; modo código JavaScript con API y autocompletado; plantillas (carreras basada en
   APEX GP, plataformas, disparos, puzles).
4. **Publicar en UpGames**: un botón con enlace propio, ranking y multijugador del servidor actual;
   exportar APK; tienda de modelos/plantillas con UpCoins; Nexus IA como asistente («hazme un coche rojo»).
