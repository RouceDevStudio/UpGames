# Tráiler APEX GP: guion y narración

Vídeo de **76 s** rodado con el propio juego (`games/monoplaza/tools/trailer.js`), sobre «There Is No Way Out» (Infraction, sin copyright).

**Voz:** femenina, suave, cercana y un poco susurrada (tipo anuncio de coches de lujo). Sin prisa: deja respirar las pausas. Graba cada frase por separado, en seco (sin música ni efectos), en WAV o MP3 de buena calidad.

## Momentos clave de la música

| Tiempo | Qué pasa en la música | Qué pasa en el vídeo |
|---|---|---|
| 0:00 | Ambiente, casi silencio | Negro; una línea roja se abre en el centro |
| 0:04.8 | Primer golpe | **UPGAMES** aparece con un destello; debajo, «presenta» |
| 0:09 – 0:28.8 | Subida lenta | Parrilla al atardecer: plano aéreo, rueda, casco del piloto, travelling lateral |
| 0:23.8 – 0:27.8 | Un golpe por segundo | Se encienden las **5 luces** de salida, una por golpe |
| 0:28.8 | **Drop** | Se apagan las luces: **¡salida!** Logotipo **APEX GP** |
| 0:28.8 – 1:04.8 | Música a tope | Tomas rápidas cada 2 s: a ras de suelo, de frente, en la rueda, a bordo, teleobjetivo, dron; atardecer, noche y lluvia; tarjetas con las características |
| 1:04.8 – 1:07.2 | Corte: la música cae | **Cámara lenta** alrededor del coche · «¿Estás listo?» |
| 1:07.2 | Golpe | Pasada a ras de suelo |
| 1:12.0 | Golpe final | Logotipo y **«Juega gratis en upgames.games»** |
| 1:14.5 – 1:16 | Final | Fundido a negro |

## Narración (voz femenina)

Las frases van en los huecos de la música. Los tiempos son el **inicio** de cada frase y su duración aproximada.

| # | Entra en | Dura | Texto |
|---|---|---|---|
| 1 | 0:01.0 | 3 s | Hay un lugar donde el tiempo… se mide en milésimas. |
| 2 | 0:09.5 | 4 s | Donde el silencio antes de la salida pesa más que cualquier motor. |
| 3 | 0:15.0 | 3 s | Veintidós pilotos. Un solo objetivo. |
| 4 | 0:19.8 | 3.5 s | Cuando las luces se encienden… |
| 5 | 0:24.5 | 3.5 s | …solo existe la próxima curva. |
| — | 0:28.8 | — | *(silencio de voz: la salida es de la música)* |
| 6 | 0:40.5 | 3.5 s | Física real. Aire real. Cada decisión cuenta. |
| 7 | 0:52.5 | 3 s | De día. De noche. Bajo la lluvia. |
| 8 | 1:05.2 | 1.5 s | Respira. |
| 9 | 1:08.0 | 3 s | Ahora… acelera. |
| 10 | 1:12.6 | 3 s | APEX GP. Juega gratis en upgames punto games. |

### Versión en inglés (por si se publica fuera)

1. There's a place where time… is measured in thousandths.
2. Where the silence before the start weighs more than any engine.
3. Twenty-two drivers. One goal.
4. When the lights come on…
5. …only the next corner exists.
6. Real physics. Real air. Every decision counts.
7. By day. By night. In the rain.
8. Breathe.
9. Now… go.
10. APEX GP. Play free at upgames dot games.

## Textos en pantalla

- 0:04.8 · **UPGAMES** / *presenta*
- 0:10 · *Cada milésima cuenta.*
- 0:19.6 · *22 pilotos. Una sola línea.*
- 0:28.8 · **APEX GP** · SIMULADOR DE MONOPLAZAS
- Tarjetas (cada 4 s desde 0:32): Física real a 300 Hz · El aire también corre · 22 pilotos con IA humana · Daños de verdad · Día, atardecer y noche · Multijugador en línea · La lluvia lo cambia todo · Campeonato y carrera profesional
- 1:05 · *¿Estás listo?*
- 1:12 · **APEX GP** · Juega gratis en upgames.games · ANDROID · NAVEGADOR · MULTIJUGADOR

## Cómo se monta la voz cuando esté grabada

Pásame las frases (un archivo por frase, con su número). Las coloco en sus tiempos con ffmpeg, bajo la música unos 8 dB mientras habla la voz (*ducking*) y exporto el vídeo final en 1080p.

## Volver a rodar el vídeo

```bash
cd UpGames && python3 -m http.server 8123 &
node games/monoplaza/tools/rodar-trailer.cjs trailer.mp4 1920 1080 30
```

Para verlo en directo en el navegador: `games/monoplaza/index.html?trailer` y tocar «Reproducir tráiler».
