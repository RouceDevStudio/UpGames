// Idiomas (español, inglés y portugués). El juego está escrito en español; para los otros
// idiomas se traduce lo que aparece en pantalla con un diccionario (idiomas/en.json, pt.json):
// frase exacta, frase con números (los números se cambian por # y se vuelven a poner) o, si
// es una frase compuesta, trozo a trozo. Un observador traduce cualquier texto que el juego
// escriba en la página, así que no hace falta tocar cada mensaje.

export const IDIOMAS = { es: 'Español', en: 'English', pt: 'Português' };
let lengua = 'es', dic = null;
const cache = new Map();
const TROZOS = /(\s·\s|:\s|\.\s|!\s|\?\s|,\s|\s\(|\)\s|<br>|\n)/;

export function idiomaActual() { return lengua; }

/** Idioma guardado o el del dispositivo; carga su diccionario. */
export async function iniciarIdioma(guardado) {
  const nav = (navigator.language || 'es').slice(0, 2);
  lengua = IDIOMAS[guardado] ? guardado : IDIOMAS[nav] ? nav : 'es';
  document.documentElement.lang = lengua;
  if (lengua === 'es') return lengua;
  try { dic = await (await fetch(new URL(`../idiomas/${lengua}.json`, import.meta.url))).json(); }
  catch (e) { console.warn('idioma', e); lengua = 'es'; return lengua; }
  traducirArbol(document.body);
  new MutationObserver(observar).observe(document.body, { childList: true, subtree: true, characterData: true });
  return lengua;
}

function buscar(s) {
  if (!s) return null;
  if (dic[s] != null) return dic[s];
  // EN MAYÚSCULAS o en minúscula: se busca con la primera letra mayúscula y se respeta el estilo
  if (/[a-záéíóúñ]/i.test(s)) {
    const cap = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    if (cap !== s) {
      const t = buscarExacto(cap);
      if (t != null) return s === s.toUpperCase() ? t.toUpperCase() : s.charAt(0) === s.charAt(0).toLowerCase() ? t.charAt(0).toLowerCase() + t.slice(1) : t;
    }
  }
  // con números: «Completa 5 vueltas» → «Completa # vueltas»
  const nums = s.match(/\d+([.,]\d+)?/g);
  if (nums) {
    const t = dic[s.replace(/\d+([.,]\d+)?/g, '#')];
    if (t != null) { let k = 0; return t.replace(/#/g, () => nums[k++] ?? '#'); }
  }
  return null;
}

function buscarExacto(s) {
  if (dic[s] != null) return dic[s];
  const nums = s.match(/\d+([.,]\d+)?/g);
  if (nums) { const t = dic[s.replace(/\d+([.,]\d+)?/g, '#')]; if (t != null) { let k = 0; return t.replace(/#/g, () => nums[k++] ?? '#'); } }
  return null;
}

/** Traduce un texto (frase entera, con números o por trozos). */
export function tr(texto) {
  if (lengua === 'es' || !dic || typeof texto !== 'string') return texto;
  const limpio = texto.trim();
  if (!limpio || !/[a-záéíóúñ]/i.test(limpio)) return texto;
  if (cache.has(texto)) return cache.get(texto);
  let out = buscar(limpio);
  if (out == null) {
    // frase compuesta: se traduce cada trozo y se respetan los separadores
    const partes = limpio.split(TROZOS);
    let cambio = false;
    out = partes.map(p => { if (TROZOS.test(p)) return p; const t = buscar(p.trim()); if (t != null) { cambio = true; return p.replace(p.trim(), t); } return p; }).join('');
    if (!cambio) out = limpio;
  }
  // se conservan los espacios de los extremos (separan texto de etiquetas vecinas)
  const res = texto.replace(limpio, out);
  if (cache.size > 4000) cache.clear();
  cache.set(texto, res);
  return res;
}

const hechos = new WeakMap();          // nodo → último texto que pusimos (para no volver a traducirlo)
function traducirNodo(n) {
  const p = n.parentNode;
  if (!p || /^(SCRIPT|STYLE|CANVAS|TEXTAREA)$/.test(p.nodeName) || p.closest?.('[data-notr]')) return;
  const v = n.data;
  if (hechos.get(n) === v) return;
  const t = tr(v);
  hechos.set(n, t);
  if (t !== v) n.data = t;
}
function traducirAtributos(el) {
  for (const a of ['title', 'placeholder', 'aria-label']) {
    const v = el.getAttribute?.(a);
    if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); }
  }
}
export function traducirArbol(raiz) {
  if (lengua === 'es' || !raiz) return;
  if (raiz.nodeType === 3) { traducirNodo(raiz); return; }
  if (raiz.nodeType !== 1) return;
  traducirAtributos(raiz);
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = w.nextNode())) { if (n.nodeType === 3) traducirNodo(n); else traducirAtributos(n); }
}
function observar(lista) {
  for (const m of lista) {
    if (m.type === 'characterData') traducirNodo(m.target);
    else for (const n of m.addedNodes) traducirArbol(n);
  }
}

/** Código de voz para la síntesis (es-ES, en-US, pt-BR). */
export function lenguaVoz() { return lengua === 'en' ? 'en-US' : lengua === 'pt' ? 'pt-BR' : 'es-ES'; }
