# Propuestas · noviembre 2026

Documento de trabajo. Lo implementado en esta tanda está al final, en «Hecho».

---

## 1. Instalador de UpGames (APK + OBB + DATA)

### Qué se puede y qué no
- **Una página web o PWA no puede hacerlo.** El navegador no instala APK por su cuenta ni escribe en `Android/obb` o `Android/data`. Hace falta una **app nativa**. Ya tenemos el patrón: UpGames Studio (Capacitor, un puente Java y el APK compilado en GitHub Actions).
- **Instalar el APK:** se usa `PackageInstaller`. Admite APK sueltos y divididos (XAPK/APKS/APKM). Android siempre le pide al usuario que confirme; no hay instalación silenciosa.
- **OBB (`Android/obb/<paquete>`):** desde Android 11, una app con el permiso `REQUEST_INSTALL_PACKAGES` puede escribir en las carpetas OBB de otras apps. Es el caso fácil.
- **DATA (`Android/data/<paquete>`):** es el caso difícil.
  - Android 11–12: con el permiso de carpeta del sistema (SAF), en la mayoría de equipos.
  - Android 13 y superior: está bloqueado para apps normales. Hace falta **Shizuku** (permiso de nivel ADB por depuración inalámbrica, sin root) o root. Si no hay ninguno, el instalador guía al usuario paso a paso.
- **Google Play:** `REQUEST_INSTALL_PACKAGES` está restringido. La app se distribuiría como el APK de Studio (GitHub Releases o upgames.games).

### Diseño propuesto
1. **Fase 1 · App «UpGames Instalador»**
   - Elegir un ZIP/XAPK/APK desde Descargas, o una APK más una carpeta.
   - Detectar la estructura sola: `manifest.json` del XAPK, archivos `main.N.paquete.obb`, carpetas con nombre de paquete (`com.x.y`).
   - Extraer mostrando el progreso.
   - Instalar la APK y mover OBB/DATA a su sitio.
   - Si no se puede mover algo, mostrar el plan B con instrucciones.
2. **Fase 2 · Conexión con la página puente**
   - Al terminar la descarga, un botón «Instalar con UpGames» abre la app (`upgames://instalar?...`) con el archivo ya elegido.
3. **Fase 3 · «Tipo de instalación» en cada publicación**
   - Nuevo campo en Publicar y Editar: APK sola / APK+OBB / APK+DATA / ZIP de emulador / mod que reemplaza archivos.
   - Con eso el instalador sabe qué hacer sin preguntar, y Nexus puede generar la guía.
4. **Fase 4:** emuladores (contenedores de Winlator, BIOS, configuraciones recomendadas por juego).

**Decisión pendiente:** ¿la hacemos como app aparte (recomendado: menos permisos sensibles en la app principal) o dentro de una futura app UpGames?

---

## 2. Nexus: más protagonismo y mejor posicionamiento

1. **Nexus en la barra de búsqueda:** escribir «juegos de carreras que corran en 3 GB de RAM» y que Nexus lo convierta en filtros. Es la entrada más usada de la app; hoy Nexus no está ahí.
2. **«¿Funciona en mi celular?»** en cada publicación. Se usan datos del dispositivo (RAM aproximada con `navigator.deviceMemory`, GPU con WebGL) más los requisitos de la publicación. Resultado: semáforo y ajustes sugeridos (por ejemplo, la configuración de Winlator).
3. **Guía de instalación generada** por publicación (desde la descripción y el «tipo de instalación»), conectada al instalador.
4. **Radar semanal de tendencias:** el buscador nuevo se ejecuta solo una vez por semana. Detecta lo que está en auge y aún no está en UpGames, y avisa a los admins y a los creadores con un «esto se busca y nadie lo ha publicado». Opcional: recompensas en UpCoins.
5. **Búsquedas sin resultados → ideas para creadores.** `modulos/search.js` ya registra las búsquedas; Nexus puede convertirlas en «publica esto y tendrás demanda».
6. **Identidad:** un avatar animado propio, la misma voz en toda la app y un estado visible («Nexus revisó tu publicación», «Nexus encontró 3 mods nuevos»).
7. **Soporte de primera línea:** Nexus responde los reportes y tickets primero y solo escala a un humano lo que no puede resolver.

---

## 3. Diseño cyberpunk: ¿es viable?

**Sí es viable**, con dos condiciones.

1. **Primero hay que unificar los tokens de diseño.** Hoy cada archivo define su propia paleta: `biblioteca.css`, `upgames-estilo.css`, el panel admin y el perfil público, que tenía una paleta distinta hasta esta tanda. Además hay muchos colores escritos a mano en atributos `style=""`. Sin esta limpieza, el tema cyberpunk quedaría a medias.
2. **Rendimiento en gama baja.** El público de ports y emuladores usa celulares modestos. El neón con `blur`, los resplandores y las animaciones deben ser ligeros y desactivarse con `prefers-reduced-motion` o en «modo ahorro».

### Propuesta
- **Tema opcional «Neón»**, no un cambio total de golpe. Se activa con `data-tema="neon"` en `<html>`.
  - Paleta: magenta `#ff2a6d`, cian `#05d9e8` y amarillo `#f9f002` sobre `#0d0221`.
  - Esquinas biseladas con `clip-path`, líneas de escaneo sutiles y un «glitch» solo en títulos.
  - Tipografía display tipo Rajdhani u Orbitron, con Manrope para el texto largo (por legibilidad).
- **Se puede vender como estilo con UpCoins.** Ya existe la tienda de estilos. También se puede medir con la infraestructura A/B que ya existe para la bienvenida, antes de hacerlo el tema por defecto.
- **Identidad propia:** inspirarse en el género (neo-noir, neón), sin copiar la estética ni las marcas de un juego concreto.

### Esfuerzo aproximado
1. Unificar tokens.
2. Crear el tema.
3. Pulir componentes y movimiento.

Cada fase cabe en una o dos sesiones de trabajo.

---

## 4. Puntos ciegos

### Corregidos en esta tanda
- **Cambiar el enlace después de aprobado:** se podía cambiar el enlace de una publicación ya verificada sin volver a revisión (riesgo de cambiarlo por malware). Ahora vuelve a «En revisión».
- **Enlaces en el JSON público:** los listados públicos (catálogo, perfiles, búsqueda, recomendaciones) devolvían el **enlace de descarga directo**. Cualquiera podía saltarse la página puente, los anuncios y el conteo. Ahora solo lo entrega la página puente; el autor sigue viendo los suyos.
- **Datos extra borrados al editar:** editar borraba `extraData` (plataforma, tamaño, juego detectado…) y no dejaba cambiarlos. Ahora se fusionan y se recalcula el juego detectado.
- **Editar estaba incompleto:** faltaban los campos de la categoría, la plantilla, NEXUS, la vista previa y la revisión. La descripción admitía 500 caracteres y no 1000 como al publicar.
- **«Que NEXUS la escriba»:** enviaba mal los datos extra (las claves quedaban con el prefijo `pf-ex-`).
- **Revisión con Nexus al editar:** marcaba la publicación como duplicada de sí misma.
- **Perfil público:**
  - Exponía la fecha del último inicio de sesión.
  - No codificaba el usuario en las URL.
  - Duplicaba el aviso «EN VIVO» al seguir.
  - Recargaba todo el perfil al seguir.
  - Usaba `alert()`.
  - No mostraba las redes sociales.
- **Contador «intención de compra»:** era público y sin límite, así que se podía inflar.

### Pendientes (requieren decisión)
1. **La espera de la página puente solo existe en el navegador.** `POST /economia/validar-descarga` devuelve el enlace de inmediato, así que un script se salta la espera. Propuesta: un ticket firmado al abrir la página puente; el servidor exige X segundos antes de entregar el enlace (Premium exento).
2. **El «tengo bloqueador de anuncios» lo declara el cliente** (`tieneAdBlocker`). Basta con mentir para que la descarga cuente. Se puede reforzar con el mismo ticket.
3. **El perfil público no tiene SEO del lado del servidor.** WhatsApp, Facebook y Google ven el título genérico. Las publicaciones ya tienen páginas estáticas (`public/p/`); los perfiles podrían tener las suyas.
4. **Tokens de diseño duplicados** entre archivos (ver §3).
5. **`alert()`/`confirm()` nativos** en varios flujos de publicar. Ya existe `customConfirm` para unificarlos.
6. **`script.js` (6.000 líneas) y `biblioteca.css` (5.400)** se cargan enteros en cada visita. Partirlos y cargar por partes mejora el arranque en gama baja.
7. **Lives:** su estado vive en memoria, así que hay una sola réplica (ver README). Hace falta Redis antes de escalar.

---

## Hecho en esta tanda
- Editar publicación completo (igual que Publicar).
- Perfil público renovado: degradado en la portada, redes sociales, fecha de ingreso, barra con el nombre y sin `alert()`.
- Degradado de la portada también en el perfil personal.
- Buscador avanzado de Nexus en el panel admin: web, YouTube, TikTok, Facebook, Instagram y Reddit.
  - Variables opcionales: `SERPER_API_KEY` (recomendada para las redes), `BRAVE_SEARCH_API_KEY`, `YOUTUBE_API_KEY`.
- Correcciones de puntos ciegos listadas arriba.
