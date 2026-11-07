// Copia el juego (games/upstar) a www/ para empaquetarlo en el APK, con la librería 3D
// (que en la web se comparte con APEX GP) dentro de la app.
import { cpSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const juegos = join(aqui, '..', '..', 'games');
const destino = join(aqui, 'www');
if (existsSync(destino)) rmSync(destino, { recursive: true });
cpSync(join(juegos, 'upstar'), destino, { recursive: true, filter: (p) => basename(p) !== 'README.md' });
cpSync(join(juegos, 'monoplaza', 'lib'), join(destino, 'lib'), { recursive: true });
const ix = join(destino, 'index.html');
writeFileSync(ix, readFileSync(ix, 'utf8').replaceAll('../monoplaza/lib/', 'lib/'));
// los módulos que importan la librería de red de APEX GP
for (const f of readdirSync(join(destino, 'js'))) { const r = join(destino, 'js', f); const t = readFileSync(r, 'utf8'); if (t.includes('../../monoplaza/lib/')) writeFileSync(r, t.replaceAll('../../monoplaza/lib/', '../lib/')); }
console.log('Juego copiado a', destino);
