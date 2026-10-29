// Copia el juego (games/monoplaza) a www/ para empaquetarlo en el APK.
import { cpSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const origen = join(aqui, '..', '..', 'games', 'monoplaza');
const destino = join(aqui, 'www');
const excluir = new Set(['tools', 'package.json', 'sw.js']);
if (existsSync(destino)) rmSync(destino, { recursive: true });
cpSync(origen, destino, { recursive: true, filter: (p) => !excluir.has(basename(p)) || p === origen });
console.log('Juego copiado a', destino);
