# UpGames Live: servidor de medios (opcional)

Sin este servicio el live ya funciona en **modo directo (P2P)**: el navegador del creador envía el video a cada espectador. Ese modo tiene un límite de `LIVE_P2P_MAX_VIEWERS` espectadores con video (12 por defecto); los demás siguen el chat.

Con MediaMTX se suman:

- **OBS / Streamlabs / Prism** por RTMP, usando la clave de transmisión de cada creador.
- **Espectadores sin límite** por LL-HLS, con 2 a 4 segundos de retraso.

## Desplegar en Railway

1. Crea un servicio nuevo desde este mismo repositorio con **Root Directory = `mediamtx`**. Railway detecta el `Dockerfile`.
2. Ponle estas variables al servicio de MediaMTX:
   - `MTX_AUTHHTTPADDRESS=http://<servicio-backend>.railway.internal:<PORT>/live/mediamtx/auth?s=<SECRETO>`
3. En **Networking**:
   - Genera un dominio público con *target port* **8888**. Ese es el HLS.
   - Agrega un **TCP Proxy** al puerto **1935**. Ese es el RTMP para OBS.
4. Ponle estas variables al **backend**:

| Variable | Ejemplo |
|---|---|
| `MEDIAMTX_AUTH_SECRET` | el mismo `<SECRETO>` del paso 2 |
| `MEDIAMTX_PUBLIC_URL` | `https://mediamtx-production.up.railway.app` |
| `MEDIAMTX_RTMP_URL` | `rtmp://roundhouse.proxy.rlwy.net:12345` |
| `MEDIAMTX_API_URL` | `http://mediamtx.railway.internal:9997` (**obligatoria**: con ella el backend sabe si OBS sigue emitiendo) |
| `MEDIAMTX_WHIP_URL` | *(opcional)* dominio del puerto 8889. WebRTC necesita UDP y Railway no lo expone. Úsala solo en un VPS con UDP abierto; sin ella, el estudio del navegador sigue en P2P. |

En OBS, cada creador usa **Servidor** `MEDIAMTX_RTMP_URL/live` y la **Clave** que aparece en *Estudio → OBS*.

## Ancho de banda

Un stream a 3 Mbps consume unos 1,35 GB por espectador cada hora, y ese tráfico sale de este servicio. Cuando haya mucho público, cambia solo el video a un CDN (Cloudflare Stream, LiveKit, Mux). El chat, los regalos y la economía no cambian.
