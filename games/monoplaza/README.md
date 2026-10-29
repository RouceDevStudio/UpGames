# APEX GP: simulador de monoplazas

Juego de carreras de monoplazas en 3D que corre en el navegador (WebGL con Three.js) y como app Android (Capacitor). Está pensado primero para el celular: dirección inclinando el teléfono o táctil, pedales analógicos y también teclado y mando.

- Web: `https://upgames.games/games/monoplaza/`
- Android: el workflow `APK APEX GP` compila el APK (ver más abajo).

## Modos

- **Carrera** contra hasta 21 rivales con IA (11 equipos de 2 coches): semáforo de salida, posiciones, rebufo, DRS con detección a 1 s, contactos, estrategia de boxes y abandonos.
- **Multijugador**: duelos 1 vs 1 o salas abiertas de hasta 22 pilotos (Socket.IO, espacio `/apexgp` del backend). Salida sincronizada con el reloj del servidor, rivales interpolados y resultados validados en el servidor.
- **Contrarreloj** con fantasma de tu mejor vuelta, delta en vivo y sectores de colores (morado, verde, amarillo).
- **Práctica libre** para probar el reglaje.

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
