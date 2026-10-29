// Texturas generadas en tiempo de ejecución (sin descargar imágenes).

import * as THREE from 'three';

export function aleatorio(semilla = 1) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ruido de valor periódico (para texturas que se repiten sin costuras)
function ruidoPeriodico(tam, celdas, rnd) {
  const g = new Float32Array(celdas * celdas);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(tam * tam);
  for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
    const fx = x / tam * celdas, fy = y / tam * celdas;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[(y0 % celdas) * celdas + x0 % celdas], b = g[(y0 % celdas) * celdas + (x0 + 1) % celdas];
    const c = g[((y0 + 1) % celdas) * celdas + x0 % celdas], d = g[((y0 + 1) % celdas) * celdas + (x0 + 1) % celdas];
    out[y * tam + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
  return out;
}

function fbm(tam, rnd, octavas = 5, base = 4) {
  const out = new Float32Array(tam * tam);
  let amp = 1, tot = 0;
  for (let o = 0; o < octavas; o++) {
    const r = ruidoPeriodico(tam, base << o, rnd);
    for (let i = 0; i < out.length; i++) out[i] += r[i] * amp;
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function lienzo(tam, alto = tam) {
  const c = document.createElement('canvas');
  c.width = tam; c.height = alto;
  return c;
}

function aTextura(canvas, repetir = true, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (repetir) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Mapa de normales a partir de una altura (operador de Sobel)
function normalDesdeAltura(alt, tam, fuerza) {
  const c = lienzo(tam), ctx = c.getContext('2d');
  const img = ctx.createImageData(tam, tam);
  const h = (x, y) => alt[((y + tam) % tam) * tam + (x + tam) % tam];
  for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * fuerza;
    const dy = (h(x, y + 1) - h(x, y - 1)) * fuerza;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * tam + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return aTextura(c, true, false);
}

export function texturasAsfalto(tam = 512) {
  const rnd = aleatorio(7);
  const base = fbm(tam, rnd, 5, 4);
  const alt = new Float32Array(tam * tam);
  const c = lienzo(tam), ctx = c.getContext('2d');
  const img = ctx.createImageData(tam, tam);
  const cr = lienzo(tam), ctr = cr.getContext('2d');
  const imr = ctr.createImageData(tam, tam);
  for (let i = 0; i < tam * tam; i++) {
    // árido: granos claros y oscuros
    const r = rnd();
    let v = 0.30 + base[i] * 0.16;
    let a = base[i] * 0.4;
    if (r < 0.06) { v += 0.18 * rnd(); a += 0.7; }
    else if (r < 0.14) { v -= 0.08; a -= 0.3; }
    alt[i] = a + rnd() * 0.35;
    const g = Math.max(0, Math.min(1, v));
    img.data[i * 4] = g * 255 * 0.98; img.data[i * 4 + 1] = g * 255; img.data[i * 4 + 2] = g * 255 * 1.03; img.data[i * 4 + 3] = 255;
    const rough = 0.78 + (r < 0.06 ? -0.25 : 0) + base[i] * 0.15;
    imr.data[i * 4] = imr.data[i * 4 + 1] = imr.data[i * 4 + 2] = Math.min(255, rough * 255); imr.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctr.putImageData(imr, 0, 0);
  return { mapa: aTextura(c), normal: normalDesdeAltura(alt, tam, 2.2), rugosidad: aTextura(cr, true, false) };
}

// Goma depositada sobre la trazada: franja oscura con bordes difuminados
export function texturaGoma() {
  const c = lienzo(64, 256), ctx = c.getContext('2d');
  const rnd = aleatorio(31);
  const img = ctx.createImageData(64, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
    const u = x / 63 * 2 - 1;
    const i = (y * 64 + x) * 4;
    const perfil = Math.max(0, 1 - u * u) ** 1.5;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 8;
    img.data[i + 3] = 255 * perfil * (0.55 + 0.45 * rnd());
  }
  ctx.putImageData(img, 0, 0);
  return aTextura(c);
}

export function texturaValla() {
  // malla metálica de las vallas de protección
  const c = lienzo(64), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(200,205,210,0.9)'; ctx.lineWidth = 1.2;
  for (let k = -64; k < 128; k += 8) {
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + 64, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k + 64, 0); ctx.lineTo(k, 64); ctx.stroke();
  }
  return aTextura(c);
}

export function texturaEdificio() {
  const c = lienzo(512, 128), ctx = c.getContext('2d');
  ctx.fillStyle = '#d8dde3'; ctx.fillRect(0, 0, 512, 128);
  // ventanales superiores
  const g = ctx.createLinearGradient(0, 10, 0, 50);
  g.addColorStop(0, '#2c4a66'); g.addColorStop(1, '#8fb4d4');
  ctx.fillStyle = g;
  for (let x = 6; x < 512; x += 42) ctx.fillRect(x, 10, 36, 40);
  // puertas de garaje
  for (let x = 4; x < 512; x += 64) {
    ctx.fillStyle = '#1a1d22'; ctx.fillRect(x, 64, 56, 64);
    ctx.fillStyle = '#0d47ff'; ctx.fillRect(x, 60, 56, 4);
  }
  return aTextura(c);
}

// Fachada de edificio urbano: ventanas en rejilla y bajos con tiendas (algunas con UPGAMES)
export function texturaFachada(semilla = 5) {
  const rnd = aleatorio(semilla);
  const c = lienzo(256, 512), ctx = c.getContext('2d');
  const tonos = ['#e9dcc4', '#d9c3a5', '#f1ece2', '#c9b79c', '#e6d2b5', '#b8a48a'];
  ctx.fillStyle = tonos[Math.floor(rnd() * tonos.length)]; ctx.fillRect(0, 0, 256, 512);
  for (let y = 16; y < 440; y += 40) for (let x = 12; x < 256; x += 40) {
    const luz = rnd();
    ctx.fillStyle = luz > 0.85 ? '#f6e7b0' : luz > 0.4 ? '#3a4e63' : '#5e7c96';
    ctx.fillRect(x, y, 22, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x - 2, y + 28, 26, 3);
  }
  ctx.fillStyle = '#2a2d33'; ctx.fillRect(0, 452, 256, 60);
  ctx.fillStyle = rnd() < 0.5 ? '#0d47ff' : '#b3122e'; ctx.fillRect(0, 446, 256, 14);
  ctx.fillStyle = '#fff'; ctx.font = '900 italic 13px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(rnd() < 0.5 ? 'UPGAMES' : 'CAFÉ · HOTEL', 128, 453);
  return aTextura(c);
}

export function texturaHierba(tam = 512) {
  const rnd = aleatorio(11);
  const base = fbm(tam, rnd, 6, 4);
  const c = lienzo(tam), ctx = c.getContext('2d');
  const img = ctx.createImageData(tam, tam);
  for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
    const i = y * tam + x;
    const brizna = rnd();
    const v = base[i];
    // franjas de corte de césped
    const franja = ((Math.floor(x / (tam / 4))) % 2) ? 0.06 : -0.02;
    let r = 0.20 + v * 0.10 + franja * 0.5, g = 0.36 + v * 0.18 + franja, b = 0.12 + v * 0.06;
    if (brizna < 0.25) { g += 0.07 * rnd(); r += 0.02; }
    if (brizna > 0.97) { r += 0.1; g += 0.08; b += 0.02; }
    img.data[i * 4] = r * 255; img.data[i * 4 + 1] = g * 255; img.data[i * 4 + 2] = b * 255; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return aTextura(c);
}

export function texturaTerreno(tam = 512) {
  const rnd = aleatorio(5);
  const base = fbm(tam, rnd, 6, 3);
  const c = lienzo(tam), ctx = c.getContext('2d');
  const img = ctx.createImageData(tam, tam);
  for (let i = 0; i < tam * tam; i++) {
    const v = base[i];
    const seco = Math.max(0, (v - 0.55) * 2.2);
    const r = 0.22 + v * 0.12 + seco * 0.18, g = 0.33 + v * 0.14 + seco * 0.05, b = 0.13 + v * 0.05 + seco * 0.04;
    const n = (rnd() - 0.5) * 0.05;
    img.data[i * 4] = (r + n) * 255; img.data[i * 4 + 1] = (g + n) * 255; img.data[i * 4 + 2] = (b + n) * 255; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return aTextura(c);
}

export function texturaGrava(tam = 256) {
  const rnd = aleatorio(19);
  const c = lienzo(tam), ctx = c.getContext('2d');
  ctx.fillStyle = '#b9a586'; ctx.fillRect(0, 0, tam, tam);
  for (let k = 0; k < tam * tam / 6; k++) {
    const x = rnd() * tam, y = rnd() * tam, r = 0.6 + rnd() * 1.8;
    const l = 120 + rnd() * 110;
    ctx.fillStyle = `rgb(${l},${l * 0.9},${l * 0.75})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return aTextura(c);
}

export function texturaBordillo() {
  const c = lienzo(64, 128), ctx = c.getContext('2d');
  ctx.fillStyle = '#d9161c'; ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, 64, 64, 64);
  // estrías
  ctx.globalAlpha = 0.18; ctx.fillStyle = '#000';
  for (let y = 0; y < 128; y += 8) ctx.fillRect(0, y, 64, 2);
  return aTextura(c);
}

export function texturaMuro(texto = 'UPGAMES') {
  const c = lienzo(1024, 128), ctx = c.getContext('2d');
  const colores = [['#0d47ff', '#ffffff'], ['#111', '#00e5ff'], ['#f2f2f2', '#d9161c'], ['#e8202a', '#fff']];
  const paneles = 4;
  for (let k = 0; k < paneles; k++) {
    const [fondo, letra] = colores[k % colores.length];
    ctx.fillStyle = fondo; ctx.fillRect(k * 256, 0, 256, 128);
    ctx.fillStyle = letra; ctx.font = 'bold 54px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const t = [texto, 'APEX GP', texto, 'MONOPLAZA'][k];
    ctx.fillText(t, k * 256 + 128, 66);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(k * 256, 0, 3, 128);
  }
  return aTextura(c);
}

export function texturaNeumaticos() {
  // barrera de neumáticos con cinta transportadora
  const c = lienzo(256, 128), ctx = c.getContext('2d');
  ctx.fillStyle = '#151515'; ctx.fillRect(0, 0, 256, 128);
  for (let k = 0; k < 8; k++) {
    const g = ctx.createRadialGradient(k * 32 + 16, 64, 4, k * 32 + 16, 64, 18);
    g.addColorStop(0, '#050505'); g.addColorStop(0.6, '#2a2a2a'); g.addColorStop(1, '#0c0c0c');
    ctx.fillStyle = g; ctx.fillRect(k * 32, 0, 32, 128);
  }
  ctx.fillStyle = '#e8202a'; ctx.fillRect(0, 20, 256, 22);
  ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, 86, 256, 22);
  // funda publicitaria sobre los neumáticos
  ctx.fillStyle = '#0d47ff'; ctx.fillRect(0, 46, 256, 36);
  ctx.fillStyle = '#ffffff'; ctx.font = '900 italic 28px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('UPGAMES', 128, 65);
  return aTextura(c);
}

export function texturaPublico() {
  const c = lienzo(512, 256), ctx = c.getContext('2d');
  const rnd = aleatorio(23);
  ctx.fillStyle = '#2b2f36'; ctx.fillRect(0, 0, 512, 256);
  const colores = ['#e8202a', '#0d47ff', '#f5c518', '#ffffff', '#ff7a00', '#1b1b1f', '#00a86b', '#c4061a', '#7fb3ff'];
  for (let fila = 0; fila < 16; fila++) {
    ctx.fillStyle = '#3a3f47'; ctx.fillRect(0, fila * 16 + 13, 512, 3);
    for (let x = 2; x < 512; x += 6 + rnd() * 2) {
      if (rnd() < 0.1) continue;
      ctx.fillStyle = colores[Math.floor(rnd() * colores.length)];
      ctx.fillRect(x, fila * 16 + 5, 4, 8);
      ctx.fillStyle = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69'][Math.floor(rnd() * 4)];
      ctx.fillRect(x + 0.5, fila * 16 + 1, 3, 4);
    }
  }
  return aTextura(c);
}

export function texturaCarbono() {
  const c = lienzo(64), ctx = c.getContext('2d');
  for (let y = 0; y < 64; y += 8) for (let x = 0; x < 64; x += 8) {
    const par = ((x + y) / 8) % 2;
    const g = ctx.createLinearGradient(x, y, par ? x + 8 : x, par ? y : y + 8);
    g.addColorStop(0, '#0c0c0e'); g.addColorStop(0.5, '#2a2b30'); g.addColorStop(1, '#0c0c0e');
    ctx.fillStyle = g; ctx.fillRect(x, y, 8, 8);
  }
  const t = aTextura(c);
  t.repeat.set(6, 6);
  return t;
}

export function texturaHumo() {
  const c = lienzo(128), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return aTextura(c, false);
}

export function texturaNumero(numero, color, fondo) {
  const c = lienzo(128), ctx = c.getContext('2d');
  ctx.fillStyle = fondo; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = color; ctx.font = 'bold italic 92px Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(numero), 64, 70);
  return aTextura(c, false);
}

export function texturaCartel(texto, fondo = '#ffffff', color = '#111111') {
  const ancho = texto.length > 4 ? 512 : 256;
  const c = lienzo(ancho, 128), ctx = c.getContext('2d');
  ctx.fillStyle = fondo; ctx.fillRect(0, 0, ancho, 128);
  ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.strokeRect(6, 6, ancho - 12, 116);
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let tam = 84;
  do { ctx.font = `bold italic ${tam}px Arial, sans-serif`; tam -= 4; } while (ctx.measureText(texto).width > ancho - 40 && tam > 20);
  ctx.fillText(texto, ancho / 2, 68);
  return aTextura(c, false);
}

export function texturaFlanco(colorCompuesto) {
  // flanco del neumático con banda de color del compuesto y rotulación
  const c = lienzo(512, 64), ctx = c.getContext('2d');
  ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = colorCompuesto; ctx.fillRect(0, 26, 512, 6);
  ctx.fillStyle = '#e8e8e8'; ctx.font = 'bold 18px Arial, sans-serif';
  for (let k = 0; k < 2; k++) ctx.fillText('APEX  ·  SLICK', 40 + k * 256, 54);
  return aTextura(c, true);
}
