// Copia Studio (games/studio) a www/ para empaquetarlo en el APK.
import { cpSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const origen = join(aqui, '..', '..', 'games', 'studio');
const destino = join(aqui, 'www');
const excluir = new Set(['tools', 'package.json', 'sw.js', '_pruebas']);
if (existsSync(destino)) rmSync(destino, { recursive: true });
cpSync(origen, destino, { recursive: true, filter: (p) => !excluir.has(basename(p)) || p === origen });
console.log('Studio copiado a', destino);
