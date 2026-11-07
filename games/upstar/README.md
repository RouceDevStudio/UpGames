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

## Cómo se juega

**Nave** (`js/nave.js`): el acelerador se queda donde lo dejas (de −30 % reversa a 100 %), la velocidad hacia delante tiende a la que marca y el morro manda; el vector verde de la pantalla muestra hacia dónde te mueves de verdad (rojo si vas marcha atrás) y el polvo espacial pasa a tu lado según la velocidad. En la atmósfera: gravedad, sustentación, rozamiento ∝ v², alabeo automático al girar, vuelo estacionario a baja velocidad y **aterrizaje automático** (L). Turbo, **pulso** (viaje rápido lejos de los planetas, gasta combustible) y tres modelos: caza, explorador y carguero.

**Daños**: escudo que se regenera y casco. Golpes contra el suelo según la velocidad, láseres de los piratas, lluvia ácida. Humo y chispas con la nave dañada; a 0 % la nave explota, pierdes parte de la carga y apareces en la estación.

**A pie** (`js/pie.js`): caminar sobre la esfera con la gravedad del planeta, saltar, jetpack con combustible, doble salto (implante), herramienta que mina. Soporte vital que gasta el clima.

**Mundo**: criaturas por piezas con temperamento (pacíficas, huidizas, agresivas que muerden) en celdas deterministas (`js/criaturas.js`); flora y minerales que se minan (cristal, ferrita, carbono); ruinas con terminales para hackear; ciudades de neón con su faro; lunas; clima por planeta (tormentas con rayos, lluvia ácida, ventisca, calor) y auroras de noche (`js/clima.js`).

**Espacio**: estación por sistema con su facción (Corporación Nova, Sindicato de Datos, Colectivo IA) para reparar, comerciar, comprar implantes, cambiar de nave y de colores, aceptar misiones y hackear el terminal (`js/estacion.js`, `js/ui.js`); circuito de 10 anillos de neón con récord; piratas que aparecen según la facción (`js/combate.js`).

**Galaxia** (`js/mapa.js`): las estrellas del cielo son los sistemas vecinos en su dirección real; apuntas a una y pulsas SALTO (gasta combustible por sector) y llegas por el lado que da al sistema de origen. Mapa 2D con los visitados, la expedición de la semana (+500 créditos) y la dirección de la Señal.

**Historia**: la Señal (bitácora con capítulos que se desbloquean al viajar, escanear, hackear y acercarse a ella).

**Online** (`js/red.js`, servidor `rutas/upstar.js`): con cuenta de UpGames se ven los demás jugadores del sector, los descubrimientos (planetas, especies, ruinas) se registran para todos con el nombre del primero que los encuentra, las bases plantadas se ven en el planeta y la partida se guarda en la nube.

**Sonido** (`js/audio.js`): todo generado por código: motor, viento según la atmósfera, música ambiental distinta en cada planeta (acordes a partir de su semilla) y efectos.

**Pantalla**: siempre en horizontal (la app Android va bloqueada en horizontal; en el navegador del móvil se pide pantalla completa horizontal y, en vertical, se pide girar el teléfono). Con teclado o mando se ocultan los táctiles.

## Hoja de ruta

1. **Prototipo** ✅: sistema por coordenadas, planetas con LOD, aterrizar sin cortes, nave, estilo visual, móvil y PC.
2. **Fase 2** ✅: a pie, escáner, criaturas, clima, estación, facciones, combate, anillos, mapa galáctico, salto dirigido, daños, sonido, online, descubrimientos, bases, guardado en la nube y la Señal.
3. **Siguiente**: interiores de las ciudades, más tipos de criaturas y comportamientos (manadas, depredadores), cuevas, más capítulos de la Señal, misiones entre jugadores.
3. **Vida**: criaturas por piezas (cuerpo, patas, cabeza, colores, comportamiento) generadas por semilla de cada zona; plantas y rocas variadas por bioma; clima (tormentas de neón, lluvia ácida).
4. **Online**: Socket.IO como en APEX GP; ver a otros jugadores, nombrar descubrimientos (el primero que los registra), chat. Cuentas de UpGames.
5. **Juego**: recursos y mejoras de nave, bases, misiones, mapa galáctico y saltos entre sistemas por la red de sectores, estaciones espaciales y comercio.
6. **App Android** con Capacitor (como `apps/apex-gp-android`).

## Nombres posibles

UPSTAR, **NEONOVA**, **Hyperia**, **Synthverse**, **Voidline**, **Nullstar**, **ASTRA//NET**, **Neon Drift Galaxy**. Hay que comprobar que el elegido no esté registrado como marca ni usado por otro juego.
