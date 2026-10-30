# APEX GP: simulador de monoplazas

Juego de carreras de monoplazas en 3D que corre en el navegador (WebGL con Three.js) y como app Android (Capacitor). Está pensado primero para el celular: dirección inclinando el teléfono o táctil, pedales analógicos y también teclado y mando.

- Web: `https://upgames.games/games/monoplaza/`
- Android: el workflow `APK APEX GP` compila el APK (ver más abajo).

## Modos

- **Carrera** contra hasta 21 rivales con IA (11 equipos de 2 coches): semáforo de salida, posiciones, rebufo, DRS con detección a 1 s, contactos, estrategia de boxes y abandonos.
- **Partida rápida en línea**: 22 coches (la IA completa la parrilla y la simula el anfitrión; si se va, la simula el siguiente), 20 vueltas y 6 minutos de clasificación que deciden la parrilla. En línea no hay ayudas ni reinicios: quien destroza el coche queda fuera.
- **Multijugador**: duelos 1 vs 1 o salas abiertas de hasta 22 pilotos (Socket.IO, espacio `/apexgp` del backend). Salida sincronizada con el reloj del servidor, rivales interpolados y resultados validados en el servidor.
- **Contrarreloj** con fantasma de tu mejor vuelta, delta en vivo y sectores de colores (morado, verde, amarillo).
- **Práctica libre** para probar el reglaje.
- **Campeonato**: calendario Clásico (Valle Andino, Puerto Real y Autódromo Veloz), Europa o Mundial; cada GP con clasificación Q1-Q2-Q3 y carrera; puntos de pilotos y constructores (25-18-15-12-10-8-6-4-2-1, +1 por vuelta rápida). Con cuenta de UpGames, cada carrera suma puntos al **ranking mundial semanal** (validados en el servidor con una ficha firmada, duración mínima y máximo 6 carreras al día).
- **Modo carrera profesional**: firmas con un equipo modesto, desarrollas el coche (aerodinámica, motor, chasis, frenos, ERS y neumáticos) con los puntos que ganas en pista, tienes un duelo interno con tu compañero, respondes a la prensa (cambia tu reputación) y al final de cada temporada llegan ofertas según el objetivo cumplido (`js/trayectoria.js`).
- **Resistencia**: carreras de 15, 30 o 60 minutos o «24 h» (60 minutos reales con ciclo de día y noche completo); el depósito no da para toda la carrera, la IA para a repostar y puedes ceder el coche a tu compañero (relevo, con avance ×3) desde el panel de boxes.
- **Licencias en línea**: el safety rating (SR, 0-5) sube con vueltas limpias y baja con contactos, sanciones y límites de pista; con el SR, las carreras y el ELO se gana licencia D, C, B, A o Pro. Las salas pueden exigir una licencia mínima y la partida rápida empareja aparte a quien conduce sucio (SR < 2) durante el primer minuto.
- **Editor de circuitos** (`js/editorCircuito.js`): se dibuja el trazado tocando puntos sobre un plano de 2 × 2 km (la pista pasa suave por ellos), con ancho, relieve, urbano y noche; se comprueba largo (1,8-8 km), cruces y radio mínimo, se guarda en el dispositivo, se prueba al momento y se comparte con un código `APX1.…`. Los circuitos creados se corren sin conexión (no puntúan en los rankings).
- **IA humana**: la trazada de cada rival varía, cada frenada es distinta, el ritmo sube y baja con la concentración y cometen errores (pasarse de frenada bloqueando ruedas, abrirse a la salida y pisar la hierba, trompos al acelerar antes de tiempo), más con lluvia, en tráfico y bajo presión. Los pilotos agresivos cubren el interior en la frenada, no dejan hueco y a veces tocan; todos frenan y esquivan a quien hace un trompo delante.
- **Piloto como modelo aparte** (`js/render/piloto.js`): hombros, brazos con codo por cinemática inversa y guantes con dedos. En un golpe fuerte el volante pega latigazos y gira solo hasta los topes; el piloto lo suelta, cruza los brazos sobre el pecho para protegerse las muñecas y encoge la cabeza contra el HANS, y luego vuelve a cogerlo (también en la repetición).
- **Muros que se abollan**: hormigón, neumáticos, TecPro y vallas se deforman donde golpea un coche y vuelven a su sitio al reiniciar (también se recogen los restos).
- **Público en 3D** en las gradas (calidad media y alta): miles de espectadores instanciados que se mueven, saltan al pasar los coches y hacen la ola; árboles cercanos con más detalle; desenfoque por velocidad desde ~180 km/h (calidad alta); helicóptero de UPGAMES TV que sigue al líder; más vallas publicitarias que ahora se leen bien de frente.
- **Reglaje guiado**: en el reglaje le cuentas al ingeniero qué le pasa al coche (subviraje a la entrada, sobreviraje a la salida, poca velocidad punta, neumáticos que se calientan…) y te propone cambios explicados que puedes aplicar y deshacer (`js/ingeniero.js`).
- **Rankings**: campeonato mundial (puntos semanales y de siempre), contrarreloj global y semanal por circuito con fantasma descargable del récord, y ELO del multijugador con partida rápida por nivel y región.
- **UpCoins como premio**: solo para el **top 5 del ranking mundial** de cada semana (campeonato y contrarreloj de cada circuito): 1º 15 UC, 2º 10 UC, 3º a 5º 5 UC. Son UpCoins de juego **no retirables** (campo `monedas`, nunca `saldo`), pagadas una sola vez por semana y puesto.

## Circuitos, clima y reglas

- Tres trazados originales (`js/track.js`, `CIRCUITOS`): técnico de montaña, urbano estrecho con guardarraíles, edificios y túnel, y rápido de rectas largas. El reglaje, los récords y el fantasma se guardan por circuito.
- Diez **trazados reales de la F1 con otros nombres** (`js/circuitosReales.js`, a partir de los datos abiertos MIT de github.com/bacinger/f1-circuits, escalados a la longitud oficial): Principado (Mónaco), Parque Real (Monza), Ardenas (Spa), Aeródromo (Silverstone), Levante (Barcelona), Anillo Alpino (Red Bull Ring), Danubio (Hungaroring), Dunas (Zandvoort), Desierto (Baréin, de noche) e Isla (Montreal). Rectas, zonas de DRS, nombres de curva, calle de boxes y ritmo de la IA se calculan solos; los garajes se estrechan donde no caben. El campeonato tiene calendarios Clásico, Europa (7 GP) y Mundial (13 GP).
- Coches sólidos también en calidad baja: sombra de contacto bajo cada coche, antialiasing y resolución completa, llantas con desenfoque de giro y placas de alerón con grosor.
- Clima seco, lluvia o variable (`js/clima.js`): el agua se acumula y se seca; neumáticos intermedios y de lluvia, agarre según el agua (`factorAgua`), spray, gotas, asfalto que brilla. La IA cambia de neumáticos con su propio criterio.
- Banderas amarillas, coche de seguridad virtual (VSC) tras un abandono en pista, bandera azul, 3 avisos por límites de pista y +5 s desde el cuarto, +5 s por provocar un choque.
- Contra la IA: **Safety Car** real (un deportivo con barra de luces que agrupa al pelotón; adelantarle a otro coche cuesta +5 s; entra a boxes al final de la vuelta), **bandera roja** tras un choque múltiple (todos a la parrilla, se reparan alerones y pinchazos y salida parada) y **vuelta de formación** opcional en las opciones de carrera.
- Carreras de **día, atardecer o noche** (focos, luces traseras encendidas, asfalto mojado que refleja). En el campeonato, Puerto Real es de noche y el Autódromo Veloz al atardecer.
- Pista viva: goma en la trazada, **canicas** fuera de ella en las curvas (menos agarre en seco), parches de asfalto, bordillos gastados, bordillos altos, **charcos** en los puntos bajos con lluvia fuerte (aquaplaning según velocidad, profundidad y neumático), muros de hormigón, de neumáticos y TecPro, bidones de agua, restos que pinchan y comisarios que agitan banderas.
- Efectos de cámara: gotas en la lente a bordo cuando llueve, destello del sol y viñeta de velocidad.
- Radio del ingeniero y megafonía con la síntesis de voz del navegador, público y lluvia sintetizados. Sonidos grabados reales requerirían archivos de audio con licencia.
- **Repetición y modo cine** (últimos 5 minutos): controles discretos que se ocultan solos (tocar la imagen los muestra; H los quita del todo) y 16 cámaras: director automático que corta entre planos, TV, helicóptero, dron, travelling lateral con teleobjetivo, a ras de suelo, persecución, cercana, cabina, cara del piloto, T-Cam, morro, rueda, alerón trasero, **órbita** (arrastrar y pellizcar) y **cámara libre** (arrastrar para mirar, WASD/QE para moverse, Mayús rápido, rueda para avanzar; en móvil, arrastrar y pellizcar). Cámara lenta hasta 0,1×, fotograma a fotograma, zoom, inclinación, profundidad de campo con enfoque automático al coche, filtros (cine, cálido, frío, blanco y negro, película antigua), grano, viñeta y formato panorámico 2.39. **Grabación de vídeo** con sonido (MP4/WebM) y fotos PNG; en la app de Android se guardan en Películas/Imágenes › APEX GP. Telemetría de velocidad por vuelta contra la mejor.
- **Toda la carrera en la repetición** (hasta ~40 MB de memoria: una hora con pocos coches, ~25 min con 22) con **resumen automático** (⭐): salida, adelantamientos, golpes, abandonos, Safety Car, vuelta rápida y meta, con rótulos y cámaras alternas; las marcas se ven en la línea de tiempo. **Editor de tráiler** (📍): puntos de cámara por los que el recorrido pasa suavemente (Catmull-Rom), para verlo, grabarlo o **exportarlo a MP4 1080p 60 fps** fotograma a fotograma con WebCodecs (`lib/mp4-muxer`, MIT), sin depender de los FPS del móvil. Desenfoque de movimiento de cámara por reproyección.
- **Cámaras a bordo vivas**: la cabeza del piloto se mueve con las fuerzas G y los golpes sacuden la imagen.
- **Ingeniero que analiza la carrera**: ritmo del de delante y del de detrás, en cuántas vueltas lo alcanzas, paradas de los rivales (undercut), cuándo atacar o cuidar ruedas y la lluvia en vueltas.
- **Celebraciones**: fuegos artificiales sobre la recta, el equipo saltando en el muro de boxes y donuts automáticos (🍩) al terminar en el podio.
- **Espectador y juez**: cualquiera puede ver una sala en directo (también a mitad de carrera) sin ocupar plaza, con torre de posiciones, 11 cámaras y realización automática que busca las batallas. El juez de un torneo crea la sala sin correr y da la salida.
- **Boxes como en la tele**: 19 mecánicos articulados que salen del garaje y esperan al coche (pistolas, gatos, mantas, pórtico con semáforo), cámara de TV y marcador de la parada; garajes abiertos con interior e ingenieros en el muro.
- **Sonido**: el motor V6 turbo se sintetiza explosión a explosión en un AudioWorklet (`js/motorWorklet.js`: resonancias de colector y escape, tubo, admisión, petardeos al levantar y corte de encendido al cambiar), turbo con válvula de descarga, silbido de la caja, golpes por capas (impacto, carbono que cruje, piezas que caen), roce del fondo, rivales situados en 3D con efecto Doppler, eco entre muros y en el túnel. En la repetición suenan los coches grabados desde la posición de la cámara.
- **Radio con voz siempre**: todos los avisos del ingeniero tienen voz y subtítulo. En la app de Android usa el motor de voz del sistema (el WebView no trae síntesis de voz); en Ajustes hay un botón para probarla.
- Rendimiento: coches lejanos sin piezas pequeñas y sombras solo de los cercanos.

## Física (`js/physics/`)

Todo corre a 300 Hz con paso fijo, independiente de los FPS.

| Sistema | Modelo |
|---|---|
| Neumáticos | Pacejka "Magic Formula" con deslizamiento combinado normalizado, sensibilidad a la carga, longitud de relajación, temperatura de superficie y carcasa, ventana térmica por compuesto, desgaste y presión |
| Ruedas | Integración semi-implícita del giro de cada rueda (bloqueos y patinaje estables), inercia del motor reflejada según la marcha |
| Chasis | Dinámica plana de 3 grados de libertad, transferencia de carga longitudinal y lateral (centros de balanceo, reparto de rigidez de las barras), cabeceo y balanceo amortiguados |
| Aerodinámica | Carga y resistencia ∝ v², efecto suelo sensible a la altura y al cabeceo, contacto del fondo (chispas), DRS, rebufo, aire sucio y daño del alerón |
| Motor | V6 turbo con curva de par, limitador, freno motor, embrague automático de salida |
| ERS | MGU-K de 120 kW, 4 MJ de batería, límites de despliegue y recuperación por vuelta, modos Normal, Adelantar y Recarga |
| Transmisión | 8 marchas, tiempos de cambio, protección contra reducciones peligrosas, diferencial autoblocante con rampas de tracción y retención |
| Frenos | Reparto ajustable, temperatura de los discos de carbono con pérdida de eficacia fuera de ventana, ABS opcional |
| Pista | Relieve con pendientes y cambios de rasante (que cargan o descargan el coche), bordillos que hacen vibrar la carga, hierba y grava con menos agarre y más resistencia, muros con choques por impulsos |
| Daños | Por zona del golpe: alerones que se doblan y se desprenden, suspensión doblada (el coche tira hacia un lado), pinchazos y ruedas arrancadas que dejan fuera de carrera |
| Averías | Motor (humo, pérdida de potencia, rotura), caja bloqueada en una marcha y ERS que se apaga; se pueden desactivar en ajustes |
| Planos | Una rueda bloqueada sobre el asfalto deja un plano: vibración en cada vuelta de la rueda y algo menos de agarre |
| Boxes | Calle de boxes con limitador de 80 km/h, muro, 11 garajes; la parada la conduce el ingeniero y el equipo cambia ruedas (y el morro si está roto) |

Las ayudas (control de tracción, ABS, cambio automático, dirección asistida, estabilidad, trazada) se pueden apagar todas.

## Pruebas sin gráficos

```bash
node tools/prueba-fisica.mjs 5 0.98   # 5 vueltas de un piloto automático: tiempos, G, temperaturas
node tools/prueba-carrera.mjs 3       # carrera completa de 8 coches
node tools/plano.mjs > plano.svg      # plano del circuito con muros y trazada ideal
```

## APK para Android

El proyecto nativo está en `apps/apex-gp-android/` y empaqueta esta carpeta tal cual (funciona sin conexión). La app abre a pantalla completa inmersiva, en horizontal fija y con la pantalla siempre encendida.

Compilarlo en tu computador (necesita JDK 21 y el SDK de Android):

```bash
cd apps/apex-gp-android
npm install
npm run apk        # deja el APK en android/app/build/outputs/apk/debug/
```

En GitHub, el workflow `.github/workflows/apk-monoplaza.yml` lo compila en cada cambio y lo sube como artefacto; en `main` además lo publica en la versión `apex-gp-latest`. Para firmar la versión de publicación (Play Store), crea estos secretos del repositorio: `APEX_KEYSTORE_BASE64`, `APEX_KEYSTORE_PASSWORD`, `APEX_KEY_ALIAS` y `APEX_KEY_PASSWORD`.

## Garaje, UpCoins y libreas

- Mejoras de rendimiento (motor, aerodinámica, frenos, chasis, neumáticos, ERS) de 5 niveles y cosméticos (diseños, acabados, cascos, librea propia) se compran con UpCoins en `rutas/apexgp.js`; el cobro es atómico e idempotente (`modulos/upcoins.js`).
- La librea es una textura con tres vistas (arriba, lado derecho, lado izquierdo). En el Garaje se descarga la plantilla con el contorno real de cada pieza, se pinta en cualquier editor y se sube como imagen cuadrada.
- En la web se usa la sesión de upgames.games; en la app se inicia sesión desde el juego.
- Para probar el multijugador contra un servidor local: `index.html?api=http://localhost:PUERTO`.
