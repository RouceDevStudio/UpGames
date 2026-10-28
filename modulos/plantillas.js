/**
 * Plantillas de descripción por categoría (Crear publicación → "Usar plantilla").
 * El frontend las inserta tal cual; NEXUS puede llenarlas (POST /items/describir) con lo que
 * se sabe del título, dejando "(complétalo)" donde no hay datos ciertos.
 */
'use strict';

const PLANTILLAS = {
    Juego: `🎮 Qué incluye:\n• \n\n💻 Requisitos mínimos:\n• Sistema: \n• Procesador: \n• RAM: \n• Gráfica: \n• Espacio: \n\n📥 Cómo instalar:\n1. Descarga y descomprime con WinRAR o 7-Zip\n2. \n3. \n\n📝 Notas:\n• Versión: \n• Idioma: `,
    Mod: `🛠️ Qué cambia este mod:\n• \n\n🎮 Juego y versión compatible:\n• \n\n📥 Cómo instalarlo:\n1. Haz una copia de seguridad de tus archivos\n2. \n3. \n\n⚠️ Requisitos (otros mods o cargadores):\n• \n\n↩️ Cómo quitarlo:\n• `,
    ROM: `🕹️ Consola: \n🌎 Región e idioma: \n📦 Formato: \n\n▶️ Emulador recomendado:\n• Android: \n• PC: \n\n📥 Cómo jugar:\n1. Descarga y descomprime\n2. Abre el emulador y carga el archivo\n\n📝 Notas:\n• `,
    Apps: `📱 Qué hace:\n• \n\n✅ Compatible con:\n• Android: \n• Versión de la app: \n\n📥 Cómo instalar el APK:\n1. Permite "Instalar apps de origen desconocido"\n2. Abre el archivo descargado\n\n🔐 Permisos que pide:\n• `,
    Software: `💻 Para qué sirve:\n• \n\n✅ Compatible con:\n• Sistema: \n• Versión: \n\n📥 Cómo instalar:\n1. \n2. \n\n📝 Notas:\n• Licencia: `,
    Ajustes: `🧰 Para qué sirve esta herramienta:\n• \n\n✅ Funciona con:\n• \n\n▶️ Cómo usarla:\n1. \n2. \n\n⚠️ Precauciones:\n• `,
    Optimizacion: `⚡ Qué mejora:\n• FPS / tiempos de carga / temperatura: \n\n🧪 Probado en:\n• Equipo: \n• Antes → después: \n\n▶️ Cómo aplicarlo:\n1. Crea un punto de restauración\n2. \n\n↩️ Cómo revertirlo:\n• `,
};
const plantilla = cat => PLANTILLAS[cat] || PLANTILLAS.Juego;

module.exports = { PLANTILLAS, plantilla };
