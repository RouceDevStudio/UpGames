# UPSTAR (nombre provisional)

Exploración espacial online para navegador y Android: viajar en nave entre sistemas y planetas infinitos, aterrizar sin pantallas de carga, descubrir criaturas extrañas. Estética **cyberpunk** con gráficos de dibujo animado (*cel shading*), más ligeros que los realistas y con más presupuesto para distancia de visión, vida y jugadores.

- Prototipo: `games/upstar/index.html` (`?sector=x,y,z` para ir a un sector concreto).

## Cómo funciona el universo infinito

Nada se guarda ni se diseña a mano. **Cada sector es una terna de enteros (x, y, z)** y de ella sale todo con fórmulas deterministas (`js/universo.js`, `js/ruido.js`):

1. `hash(x, y, z)` → semilla del sistema → estrella (color, dirección de la luz) y 2-4 planetas.
2. Cada planeta: tipo (neón, tóxico, desierto, helado, volcánico, cristal), radio, gravedad, mar o lava, anillos, paleta y nombre generado por sílabas.
3. El relieve es una función `altura(dirección)` con ruido simplex por semilla: continentes (fBm), cordilleras (crestas), detalle cercano y terrazas en los desiertos.

Como los enteros no se acaban, los sistemas tampoco, y como es determinista **todos los jugadores ven el mismo universo sin enviar el terreno por la red**: el servidor solo tendrá que sincronizar jugadores, naves y descubrimientos.

## Cómo se dibuja un planeta

- **Cubo esferizado** de 6 caras, cada una un *quadtree* (`js/planeta.js`): los trozos se dividen al acercarse (hasta ~15 m) y se juntan al alejarse. Un planeta entero se dibuja con 50-300 trozos.
- Cada trozo (17×17 vértices + faldón contra las grietas) se calcula en **Web Workers** (`js/trozo.worker.js`), con prioridad para los más cercanos: el juego no se congela al acercarse.
- Posiciones relativas al centro de cada trozo y búfer de profundidad logarítmico: precisión desde 30 cm hasta millones de metros.
- Materiales de dibujo de 4 tonos con contorno (borde oscurecido), colores por altura y pendiente en bandas nítidas, agua o lava, atmósfera con brillo en el borde y del lado del sol, anillos, y flora de neón instanciada en los trozos cercanos (también determinista).
- Cielo que pasa del negro del espacio al color de la atmósfera al bajar (de día y de noche), con niebla de altura. Resolución dinámica según los FPS.

## Nave (`js/nave.js`)

Empuje con inercia, turbo y **pulso** (viaje rápido, solo lejos de los planetas), gravedad del planeta cercano, rozamiento del aire ∝ v² según la densidad, sustentación al volar nivelado, asistente que endereza las alas en la atmósfera, aterrizaje suave (alineada con el suelo) o rebote si se llega demasiado rápido, y despegue al acelerar.

Mandos (`js/controles.js`): teclado (W/S empuje, ↑↓ morro, A/D giro, Q/E alabeo, Mayús turbo, Espacio pulso, C cámara, J saltar de sistema) y táctiles (palanca, acelerador, turbo, pulso). Con teclado los táctiles se ocultan.

## Hoja de ruta

1. **Prototipo** ✅: sistema por coordenadas, planetas con LOD, aterrizar sin cortes, nave, estilo visual, móvil y PC.
2. **Explorar a pie**: bajar de la nave, caminar con la gravedad del planeta, *jetpack*, escáner.
3. **Vida**: criaturas por piezas (cuerpo, patas, cabeza, colores, comportamiento) generadas por semilla de cada zona; plantas y rocas variadas por bioma; clima (tormentas de neón, lluvia ácida).
4. **Online**: Socket.IO como en APEX GP; ver a otros jugadores, nombrar descubrimientos (el primero que los registra), chat. Cuentas de UpGames.
5. **Juego**: recursos y mejoras de nave, bases, misiones, mapa galáctico y saltos entre sistemas por la red de sectores, estaciones espaciales y comercio.
6. **App Android** con Capacitor (como `apps/apex-gp-android`).

## Nombres posibles

UPSTAR, **NEONOVA**, **Hyperia**, **Synthverse**, **Voidline**, **Nullstar**, **ASTRA//NET**, **Neon Drift Galaxy**. Hay que comprobar que el elegido no esté registrado como marca ni usado por otro juego.
