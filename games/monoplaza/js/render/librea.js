// Libreas: un atlas de textura con tres vistas del coche (arriba, lado derecho,
// lado izquierdo). Las caras de la carrocería se proyectan sobre la vista que les
// corresponde según su normal, así una imagen plana viste el coche entero.
//
//   ┌──────────────────────────── ARRIBA (morro a la derecha) ───┐  mitad superior
//   ├──────────── LADO DERECHO (morro a la derecha) ─────────────┤  tercer cuarto
//   └──────────── LADO IZQUIERDO (morro a la izquierda) ─────────┘  último cuarto

import * as THREE from 'three';

export const ATLAS = { x0: -2.65, x1: 3.1, zMax: 1.02, yMax: 1.25 };
const SPAN = ATLAS.x1 - ATLAS.x0;

// coordenadas normalizadas (0..1, origen arriba a la izquierda como en un lienzo)
export function uvArriba(x, z) { return [(x - ATLAS.x0) / SPAN, (z + ATLAS.zMax) / (2 * ATLAS.zMax) * 0.5]; }
export function uvLado(x, y, derecho) {
  const u = (x - ATLAS.x0) / SPAN;
  const v = (1 - Math.min(1, Math.max(0, y / ATLAS.yMax))) * 0.25;
  return derecho ? [u, 0.5 + v] : [1 - u, 0.75 + v];
}

// Asigna UV a una geometría no indexada proyectando cada triángulo según su normal
export function proyectarUV(geo) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(t.subVectors(a, b)).normalize();
    const zc = (a.z + b.z + c.z) / 3;
    const arriba = Math.abs(n.y) > 0.55 || (Math.abs(n.y) > Math.abs(n.z) && Math.abs(n.x) < 0.7);
    const derecho = Math.abs(n.z) > 0.2 ? n.z > 0 : zc >= 0;
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      const [u, w] = arriba ? uvArriba(v.x, v.z) : uvLado(v.x, v.y, derecho);
      uv[(i + k) * 2] = u; uv[(i + k) * 2 + 1] = 1 - w;   // las texturas de lienzo van con flipY
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ─── Dibujo de libreas ─────────────────────────────────────────────────────
function aleatorio(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

class Pincel {
  constructor(ctx, W, H) { this.ctx = ctx; this.W = W; this.H = H; }
  arriba(x, z) { const [u, v] = uvArriba(x, z); return [u * this.W, v * this.H]; }
  lado(x, y, der) { const [u, v] = uvLado(x, y, der); return [u * this.W, v * this.H]; }
  // polígono en coordenadas del coche en la vista de arriba
  poliArriba(pts, color) {
    const c = this.ctx; c.beginPath();
    pts.forEach(([x, z], i) => { const [px, py] = this.arriba(x, z); i ? c.lineTo(px, py) : c.moveTo(px, py); });
    c.closePath(); c.fillStyle = color; c.fill();
  }
  poliLados(pts, color) {
    for (const der of [true, false]) {
      const c = this.ctx; c.beginPath();
      pts.forEach(([x, y], i) => { const [px, py] = this.lado(x, y, der); i ? c.lineTo(px, py) : c.moveTo(px, py); });
      c.closePath(); c.fillStyle = color; c.fill();
    }
  }
  // texto centrado en (x, z) de la vista de arriba; rot en radianes; alto en metros
  textoArriba(t, x, z, alto, color, rot = 0, fuente = '900 italic') {
    const c = this.ctx, [px, py] = this.arriba(x, z);
    const escala = this.H / (4 * ATLAS.zMax);
    c.save(); c.translate(px, py); c.rotate(rot);
    c.font = `${fuente} ${Math.round(alto * escala)}px Arial, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color;
    c.fillText(t, 0, 0); c.restore();
  }
  textoLados(t, x, y, alto, color, ancho = 0, fuente = '900 italic') {
    for (const der of [true, false]) {
      const c = this.ctx, [px, py] = this.lado(x, y, der);
      const escala = this.H / 4 / ATLAS.yMax;
      c.save(); c.translate(px, py);
      c.font = `${fuente} ${Math.round(alto * escala)}px Arial, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color;
      if (ancho) {
        const m = c.measureText(t).width, max = ancho / SPAN * this.W;
        if (m > max) c.scale(max / m, 1);
      }
      c.fillText(t, 0, 0); c.restore();
    }
  }
}

const PATRONES = {
  lisa() {},
  franjas(p, col) {
    p.poliArriba([[3.1, -0.11], [-2.7, -0.11], [-2.7, 0.11], [3.1, 0.11]], col.acento);
    p.poliArriba([[3.1, -0.16], [-2.7, -0.16], [-2.7, -0.13], [3.1, -0.13]], col.tercero);
    p.poliArriba([[3.1, 0.13], [-2.7, 0.13], [-2.7, 0.16], [3.1, 0.16]], col.tercero);
    p.poliLados([[3.1, 0.30], [-2.7, 0.30], [-2.7, 0.36], [3.1, 0.36]], col.acento);
  },
  flecha(p, col) {
    p.poliArriba([[3.1, 0], [0.3, -1.1], [-0.4, -1.1], [2.2, 0], [-0.4, 1.1], [0.3, 1.1]], col.acento);
    p.poliLados([[1.6, 0.6], [0.1, 0.18], [-0.8, 0.18], [0.7, 0.6]], col.acento);
    p.poliLados([[-0.9, 0.9], [-1.8, 0.2], [-2.1, 0.2], [-1.2, 0.9]], col.tercero);
  },
  degradado(p, col, ctx, W, H) {
    const g = ctx.createLinearGradient(W, 0, 0, 0);
    g.addColorStop(0, col.base); g.addColorStop(0.45, col.base); g.addColorStop(1, col.acento);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H / 2);
    const g2 = ctx.createLinearGradient(0, 0, W, 0);
    g2.addColorStop(0, col.acento); g2.addColorStop(0.55, col.base); g2.addColorStop(1, col.base);
    for (const [y0, inv] of [[H / 2, false], [3 * H / 4, true]]) {
      ctx.save(); if (inv) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.fillStyle = g2; ctx.fillRect(0, y0, W, H / 4); ctx.restore();
    }
  },
  rayo(p, col) {
    const z = [[3.1, 0.05], [1.6, 0.22], [1.0, -0.05], [-0.2, 0.3], [-0.6, 0.05], [-2.7, 0.35], [-2.7, 0.45], [-0.5, 0.2], [-0.1, 0.45], [1.1, 0.1], [1.7, 0.35], [3.1, 0.15]];
    p.poliArriba(z, col.acento);
    p.poliArriba(z.map(([x, w]) => [x, -w]), col.acento);
    p.poliLados([[3.0, 0.3], [1.2, 0.5], [0.6, 0.28], [-0.6, 0.62], [-1.0, 0.38], [-2.6, 0.75], [-2.6, 0.85], [-0.9, 0.5], [-0.5, 0.75], [0.7, 0.4], [1.3, 0.62], [3.0, 0.4]], col.acento);
  },
  geometrico(p, col, ctx, W, H) {
    const r = aleatorio(17);
    for (let k = 0; k < 140; k++) {
      ctx.globalAlpha = 0.35 + r() * 0.5;
      ctx.fillStyle = r() < 0.6 ? col.acento : col.tercero;
      const x = r() * W, y = r() * H, s = 20 + r() * 70;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s, y + s * (r() - 0.5)); ctx.lineTo(x + s * (r() - 0.5), y + s); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
  digital(p, col, ctx, W, H) {
    const r = aleatorio(29), t = Math.round(W / 64);
    for (let y = 0; y < H; y += t) for (let x = 0; x < W; x += t) {
      const q = r();
      if (q < 0.22) { ctx.fillStyle = col.acento; ctx.fillRect(x, y, t, t); }
      else if (q < 0.32) { ctx.fillStyle = col.tercero; ctx.fillRect(x, y, t, t); }
    }
  },
  llamas(p, col, ctx) {
    const llama = (fn, color) => {
      ctx.fillStyle = color;
      for (let k = 0; k < 7; k++) {
        const z0 = -0.9 + k * 0.3;
        ctx.beginPath();
        const pts = [[3.0, z0 * 0.2], [1.6, z0 * 0.6 - 0.12], [0.4 - k * 0.15, z0 + 0.05], [1.2, z0 * 0.7 + 0.1], [2.6, z0 * 0.2 + 0.05]];
        pts.forEach(([x, z], i) => { const [px, py] = fn(x, z); i ? ctx.quadraticCurveTo(px - 20, py + 15, px, py) : ctx.moveTo(px, py); });
        ctx.closePath(); ctx.fill();
      }
    };
    llama((x, z) => p.arriba(x, z), col.acento);
    for (const der of [true, false]) llama((x, z) => p.lado(x, 0.45 + z * 0.25, der), col.acento);
  },
};
export const NOMBRES_PATRON = { lisa: 'Lisa', franjas: 'Franjas', flecha: 'Flecha', degradado: 'Degradado', rayo: 'Rayo', geometrico: 'Geométrico', digital: 'Camuflaje digital', llamas: 'Llamas' };

// Dibuja la librea completa (colores, patrón, patrocinadores UPGAMES y número)
export function dibujarLibrea(canvas, { patron = 'franjas', colores, numero = 7, imagen = null }) {
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
  const col = { base: '#0d47ff', acento: '#00e5ff', tercero: '#ffffff', ...colores };
  if (imagen) {
    ctx.drawImage(imagen, 0, 0, W, H);
    return canvas;
  }
  ctx.fillStyle = col.base; ctx.fillRect(0, 0, W, H);
  const p = new Pincel(ctx, W, H);
  (PATRONES[patron] || PATRONES.lisa)(p, col, ctx, W, H);
  // patrocinadores: la publicidad de la casa
  const letra = contraste(col.base);
  p.textoLados('UPGAMES', -0.45, 0.42, 0.17, letra, 1.25);
  p.textoLados('upgames.games', -0.45, 0.27, 0.07, letra, 1.0, '700');
  p.textoArriba('UPGAMES', -1.05, 0, 0.16, letra, 0);
  p.textoArriba('UPCOINS', 1.55, 0, 0.12, letra, 0);
  p.textoArriba('UPGAMES', -2.25, 0, 0.18, letra, Math.PI / 2);             // alerón trasero
  p.textoArriba('NEXUS IA', 2.83, -0.55, 0.12, letra, Math.PI / 2);         // alerón delantero
  p.textoArriba('UPGAMES', 2.83, 0.55, 0.12, letra, Math.PI / 2);
  p.textoLados('UPGAMES', -2.2, 0.85, 0.16, letra, 0.55);                   // derivas del alerón trasero
  p.textoLados('LIVE', 2.62, 0.17, 0.12, letra, 0.45);                      // derivas del delantero
  p.textoLados('UPCOINS', 1.2, 0.42, 0.08, letra, 0.9, '800');
  // número: morro y aleta
  p.textoArriba(String(numero), 2.05, 0, 0.3, letra, Math.PI / 2);
  p.textoLados(String(numero), -1.15, 0.66, 0.2, letra, 0.4);
  return canvas;
}

function contraste(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111111' : '#ffffff';
}

// ─── Casco ─────────────────────────────────────────────────────────────────
export const NOMBRES_CASCO = { clasico: 'Clásico', rayas: 'Rayas', estrellas: 'Estrellas', damero: 'Damero', llamas: 'Llamas', neon: 'Neón' };
export function texturaCasco(diseno = 'clasico', colores = {}) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const x = cv.getContext('2d');
  const base = colores.base || '#ffffff', acento = colores.acento || '#0d47ff';
  x.fillStyle = base; x.fillRect(0, 0, 256, 128);
  if (diseno === 'clasico') { x.fillStyle = acento; x.fillRect(0, 52, 256, 18); x.fillRect(118, 0, 20, 128); }
  else if (diseno === 'rayas') { x.fillStyle = acento; for (let k = 0; k < 256; k += 32) x.fillRect(k, 0, 12, 128); }
  else if (diseno === 'estrellas') {
    x.fillStyle = acento;
    const r = aleatorio(5);
    for (let k = 0; k < 26; k++) {
      const cx = r() * 256, cy = r() * 100, s = 5 + r() * 9;
      x.beginPath();
      for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, rr = i % 2 ? s * 0.45 : s; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      x.fill();
    }
  } else if (diseno === 'damero') { x.fillStyle = acento; for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) x.fillRect(i * 16, j * 16, 16, 16); }
  else if (diseno === 'llamas') {
    x.fillStyle = acento;
    for (let k = 0; k < 10; k++) { x.beginPath(); x.moveTo(k * 26, 128); x.quadraticCurveTo(k * 26 + 20, 70, k * 26 + 6, 30 + (k % 3) * 10); x.quadraticCurveTo(k * 26 + 30, 80, k * 26 + 26, 128); x.fill(); }
  } else if (diseno === 'neon') {
    x.fillStyle = '#0b0b10'; x.fillRect(0, 0, 256, 128);
    x.strokeStyle = acento; x.lineWidth = 4; x.shadowColor = acento; x.shadowBlur = 12;
    for (let k = 0; k < 5; k++) { x.beginPath(); x.moveTo(0, 20 + k * 22); x.bezierCurveTo(80, 0 + k * 22, 170, 50 + k * 22, 256, 20 + k * 22); x.stroke(); }
    x.shadowBlur = 0;
  }
  x.fillStyle = contraste(base); x.font = '900 italic 16px Arial'; x.textAlign = 'center';
  x.fillText('UPGAMES', 64, 100); x.fillText('UPGAMES', 192, 100);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Material de la carrocería según el acabado comprado
export function materialLibrea(textura, acabado = 'brillo', fisico = true) {
  const base = { map: textura };
  if (!fisico) return new THREE.MeshStandardMaterial({ ...base, metalness: acabado === 'cromado' || acabado === 'dorado' ? 0.8 : 0.3, roughness: acabado === 'mate' ? 0.8 : 0.35 });
  switch (acabado) {
    case 'mate': return new THREE.MeshPhysicalMaterial({ ...base, metalness: 0.1, roughness: 0.78, clearcoat: 0 });
    case 'perlado': return new THREE.MeshPhysicalMaterial({ ...base, metalness: 0.3, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.8, iridescenceIOR: 1.6, sheen: 0.4 });
    case 'cromado': return new THREE.MeshPhysicalMaterial({ ...base, metalness: 1, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.02 });
    case 'dorado': return new THREE.MeshPhysicalMaterial({ ...base, color: 0xffd27a, metalness: 1, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.03 });
    default: return new THREE.MeshPhysicalMaterial({ ...base, metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
  }
}
