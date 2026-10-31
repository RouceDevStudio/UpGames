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

// Barrera TecPro: bloques de espuma alternos azul y rojo con publicidad
export function texturaTecpro() {
  const c = lienzo(256, 64), ctx = c.getContext('2d');
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = k % 2 ? '#c4101e' : '#0d47ff'; ctx.fillRect(k * 64, 0, 64, 64);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(k * 64, 0, 3, 64);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(k * 64 + 4, 6, 56, 6);
  }
  ctx.fillStyle = '#ffffff'; ctx.font = '900 italic 16px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('UPGAMES', 64, 36); ctx.fillText('UPGAMES', 192, 36);
  return aTextura(c);
}

// Bordillo alto (salchicha) amarillo y negro
export function texturaSalchicha() {
  const c = lienzo(64, 64), ctx = c.getContext('2d');
  ctx.fillStyle = '#f5c518'; ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#16161a'; ctx.fillRect(0, 32, 64, 32);
  return aTextura(c);
}

export function texturaHierba(tam = 512) {
  // césped de circuito: base con manchas (fbm), franjas de corte suaves a lo largo de la pista,
  // miles de briznas pintadas una a una en varios verdes, trébol y alguna calva de tierra
  const rnd = aleatorio(11);
  const base = fbm(tam, rnd, 6, 4);
  const c = lienzo(tam), ctx = c.getContext('2d');
  const img = ctx.createImageData(tam, tam);
  for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
    const i = y * tam + x;
    const v = base[i];
    const fr = Math.sin((x / tam) * Math.PI * 8);                      // 4 pasadas de cortacésped
    const franja = Math.sign(fr) * Math.min(1, Math.abs(fr) * 4) * 0.035;
    let r = 0.19 + v * 0.10 + franja * 0.4, g = 0.35 + v * 0.17 + franja, b = 0.11 + v * 0.05;
    const n = (rnd() - 0.5) * 0.05;
    if (v < 0.22) { r += (0.22 - v) * 0.5; g += (0.22 - v) * 0.12; }      // calvas secas
    img.data[i * 4] = (r + n) * 255; img.data[i * 4 + 1] = (g + n) * 255; img.data[i * 4 + 2] = (b + n * 0.5) * 255; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // briznas: trazos cortos inclinados, claros arriba y oscuros abajo (dan volumen)
  const nB = tam * tam / 9;
  ctx.lineCap = 'round';
  for (let k = 0; k < nB; k++) {
    const x = rnd() * tam, y = rnd() * tam, L = 2 + rnd() * 5, a = -Math.PI / 2 + (rnd() - 0.5) * 1.2;
    const l = rnd();
    ctx.strokeStyle = l < 0.45 ? `rgba(${30 + l * 40},${70 + l * 90},${22 + l * 20},0.55)` : `rgba(${60 + l * 50},${110 + l * 70},${35 + l * 25},0.5)`;
    ctx.lineWidth = 0.6 + rnd() * 0.8;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); ctx.stroke();
  }
  // tréboles y florecillas sueltas
  for (let k = 0; k < tam / 6; k++) {
    const x = rnd() * tam, y = rnd() * tam;
    ctx.fillStyle = rnd() < 0.8 ? 'rgba(70,130,50,0.6)' : 'rgba(235,230,170,0.7)';
    for (let h = 0; h < 3; h++) { ctx.beginPath(); ctx.arc(x + Math.cos(h * 2.1) * 1.4, y + Math.sin(h * 2.1) * 1.4, 1.2, 0, Math.PI * 2); ctx.fill(); }
  }
  return aTextura(c);
}

/** Mechones de hierba (recorte alfa) para los matojos 3D junto a la pista. */
export function texturaMechon(tam = 128) {
  const rnd = aleatorio(29);
  const c = lienzo(tam), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, tam, tam);
  ctx.lineCap = 'round';
  for (let k = 0; k < 70; k++) {
    const x0 = tam * (0.1 + rnd() * 0.8), alto = tam * (0.35 + rnd() * 0.6), curva = (rnd() - 0.5) * tam * 0.35;
    const l = rnd();
    const gr = ctx.createLinearGradient(0, tam, 0, tam - alto);
    gr.addColorStop(0, `rgb(${25 + l * 20},${55 + l * 30},${18})`); gr.addColorStop(1, `rgb(${90 + l * 60},${140 + l * 60},${50 + l * 30})`);
    ctx.strokeStyle = gr; ctx.lineWidth = 1.2 + rnd() * 1.8;
    ctx.beginPath(); ctx.moveTo(x0, tam); ctx.quadraticCurveTo(x0 + curva * 0.3, tam - alto * 0.6, x0 + curva, tam - alto); ctx.stroke();
  }
  const t = aTextura(c, false); return t;
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

export function texturaGrava(tam = 512) {
  // grava de escapatoria: piedras redondeadas de varios tamaños, cada una con luz arriba y
  // sombra abajo, huecos oscuros entre ellas; y un mapa de relieve con las mismas piedras
  const rnd = aleatorio(19);
  const c = lienzo(tam), ctx = c.getContext('2d');
  const h = lienzo(tam), hx = h.getContext('2d');
  ctx.fillStyle = '#8c7b62'; ctx.fillRect(0, 0, tam, tam);
  hx.fillStyle = '#000'; hx.fillRect(0, 0, tam, tam);
  const n = tam * tam / 9;
  for (let k = 0; k < n; k++) {
    const x = rnd() * tam, y = rnd() * tam, r = 0.9 + rnd() ** 2 * 3.4;
    const l = 135 + rnd() * 100, tinte = rnd();
    const [cr, cg, cb] = tinte < 0.15 ? [l * 0.85, l * 0.82, l * 0.8] : tinte < 0.3 ? [l, l * 0.86, l * 0.68] : [l, l * 0.92, l * 0.78];
    for (const [cx, dx, dy] of [[ctx, 0, 0]]) {
      const g = cx.createRadialGradient(x - r * 0.35 + dx, y - r * 0.4 + dy, r * 0.1, x, y, r * 1.1);
      g.addColorStop(0, `rgb(${Math.min(255, cr * 1.18)},${Math.min(255, cg * 1.18)},${Math.min(255, cb * 1.18)})`);
      g.addColorStop(0.7, `rgb(${cr | 0},${cg | 0},${cb | 0})`);
      g.addColorStop(1, `rgb(${cr * 0.55 | 0},${cg * 0.55 | 0},${cb * 0.55 | 0})`);
      cx.fillStyle = g; cx.beginPath(); cx.ellipse(x, y, r, r * (0.7 + rnd() * 0.3), rnd() * 3, 0, Math.PI * 2); cx.fill();
    }
    const gh = hx.createRadialGradient(x, y, 0, x, y, r);
    gh.addColorStop(0, '#fff'); gh.addColorStop(1, '#222');
    hx.fillStyle = gh; hx.beginPath(); hx.arc(x, y, r, 0, Math.PI * 2); hx.fill();
  }
  // relieve → normales (las piedras sobresalen y hacen sombra con el sol bajo)
  const dat = hx.getImageData(0, 0, tam, tam).data, alt = new Float32Array(tam * tam);
  for (let i = 0; i < alt.length; i++) alt[i] = dat[i * 4] / 255;
  const mapa = aTextura(c);
  mapa.userData = { normal: normalDesdeAltura(alt, tam, 3) };
  return mapa;
}

export function texturaBordillo() {
  const c = lienzo(128, 256), ctx = c.getContext('2d');
  const rnd = aleatorio(53);
  ctx.fillStyle = '#d9161c'; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, 128, 128, 128);
  // estrías
  ctx.globalAlpha = 0.18; ctx.fillStyle = '#000';
  for (let y = 0; y < 256; y += 16) ctx.fillRect(0, y, 128, 4);
  // desgaste: pintura saltada y goma de las ruedas en el lado de la pista (u = 0)
  ctx.globalAlpha = 1;
  for (let k = 0; k < 160; k++) {
    const x = rnd() ** 2 * 128, y = rnd() * 256, r = 1 + rnd() * 3;
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(60,60,62,0.7)' : 'rgba(200,190,180,0.5)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const g = ctx.createLinearGradient(0, 0, 70, 0);
  g.addColorStop(0, 'rgba(15,15,15,0.55)'); g.addColorStop(1, 'rgba(15,15,15,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 70, 256);
  return aTextura(c);
}

// Canicas: bolitas de goma sueltas fuera de la trazada
export function texturaCanicas() {
  const c = lienzo(128, 256), ctx = c.getContext('2d');
  const rnd = aleatorio(61);
  for (let k = 0; k < 900; k++) {
    const u = rnd(), x = u * 128, y = rnd() * 256;
    if (rnd() > Math.sin(u * Math.PI) ** 0.5) continue;    // más densas en el centro de la franja
    ctx.fillStyle = `rgba(10,10,10,${0.5 + rnd() * 0.4})`;
    ctx.beginPath(); ctx.arc(x, y, 0.8 + rnd() * 1.8, 0, Math.PI * 2); ctx.fill();
  }
  return aTextura(c);
}

// Parche de asfalto reparado: más oscuro y liso, con juntas de sellado
export function texturaParche() {
  const c = lienzo(128), ctx = c.getContext('2d');
  const rnd = aleatorio(71);
  ctx.fillStyle = 'rgba(28,28,30,0.85)'; ctx.fillRect(4, 4, 120, 120);
  for (let k = 0; k < 600; k++) { ctx.fillStyle = `rgba(${rnd() < 0.5 ? '70,70,72' : '15,15,16'},0.4)`; ctx.fillRect(4 + rnd() * 120, 4 + rnd() * 120, 1.5, 1.5); }
  ctx.strokeStyle = 'rgba(8,8,8,0.9)'; ctx.lineWidth = 3; ctx.strokeRect(4, 4, 120, 120);
  return aTextura(c, false);
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
