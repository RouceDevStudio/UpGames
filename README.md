# UpGames
La primera plataforma de su especie en el mundo 

## En vivo (UpGames Live)

Transmisiones de gameplay con chat en tiempo real, regalos y monedas. Página: `public/live.html`. Backend: `rutas/live.js`. Reglas de la economía: `modulos/live.js`.

**Video:**
- Funciona sin infraestructura extra en modo P2P (WebRTC navegador a navegador).
- Para OBS y público grande, despliega el servidor de medios opcional: ver [`mediamtx/README.md`](mediamtx/README.md).

**Economía:**
- 1 moneda = US$0,01. El espectador compra paquetes con PayPal y los regala.
- El creador recibe `1 − LIVE_COMISION` del valor de cada regalo.
- Lo ganado queda retenido `LIVE_RETENCION_DIAS` días y luego pasa a su saldo retirable. Eso cubre los contracargos.

| Variable | Por defecto | Para qué |
|---|---|---|
| `LIVE_COMISION` | `0.30` | Comisión de la plataforma por regalo |
| `LIVE_RETENCION_DIAS` | `7` | Días de retención antes de que sea retirable |
| `LIVE_P2P_MAX_VIEWERS` | `12` | Espectadores con video en modo P2P |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_MODE` | — | Las mismas de los retiros; activan la compra de monedas |
| `PAYPAL_WEBHOOK_ID` | — | Webhook de PayPal (`/monedas/paypal-webhook`) para revertir reembolsos y contracargos |
| `TURN_URL` / `TURN_USER` / `TURN_PASS` | — | Servidor TURN: mejora la conexión P2P detrás de redes estrictas |

El estado de las salas vive en memoria, así que el backend debe correr con **una réplica**. Para usar varias hace falta el adaptador de Redis de Socket.IO.
