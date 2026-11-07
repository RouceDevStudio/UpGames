// Galaxia: los sistemas vecinos se ven en el cielo como estrellas en su dirección real (cada
// sector es un cubo; el sistema (x+1, y, z) está siempre en la misma dirección). Apuntas a una y
// saltas hacia ella: túnel de hiperespacio en esa dirección y llegas al nuevo sistema por el lado
// que da al anterior (que queda a tu espalda). También hay un mapa en 2D para elegir destino.
import * as THREE from 'three';
import { colorEstrella, nombre, SENAL, expedicionSemana } from './universo.js';
import { hash } from './ruido.js';

const RADIO = 4;            // sectores alrededor que se ven en el cielo
export const COSTE_SECTOR = 12;   // combustible por sector saltado

export class Galaxia {
  constructor(scene) {
    this.scene = scene; this.estrellas = [];
    const g = new THREE.BufferGeometry();
    this.pts = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      vertexShader: `attribute float tam; varying vec3 vC; void main() { vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = tam; gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w * 0.9999; }`,
      fragmentShader: `varying vec3 vC; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float n = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * (n * n * 1.8 + smoothstep(0.12, 0.0, d)), 1.0); }`,
    }));
    this.pts.frustumCulled = false; scene.add(this.pts);
    // túnel de hiperespacio
    const n = 900, p = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, r = 6 + Math.random() * 40, z = -Math.random() * 600; p.set([Math.cos(a) * r, Math.sin(a) * r, z, Math.cos(a) * r, Math.sin(a) * r, z - 20], i * 6); }
    const gt = new THREE.BufferGeometry(); gt.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.tunel = new THREE.LineSegments(gt, new THREE.LineBasicMaterial({ color: '#7fe9ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, fog: false }));
    this.tunel.frustumCulled = false; this.tunel.visible = false; scene.add(this.tunel);
    this.salto = null;
  }

  /** Recalcula las estrellas vecinas del sector actual. */
  poner(sector) {
    this.sector = sector; this.estrellas = [];
    const pos = [], col = [], tam = [], c = new THREE.Color();
    for (let x = -RADIO; x <= RADIO; x++) for (let y = -2; y <= 2; y++) for (let z = -RADIO; z <= RADIO; z++) {
      if (!x && !y && !z) continue;
      const s = [sector[0] + x, sector[1] + y, sector[2] + z], d = Math.hypot(x, y, z);
      if (d > RADIO + 0.5) continue;
      const dir = new THREE.Vector3(x, y, z).normalize();
      this.estrellas.push({ sector: s, dir, dist: d, nombre: nombre(hash(hash(...s, 7), 1), false) });
      pos.push(dir.x * 1e6, dir.y * 1e6, dir.z * 1e6);
      c.set(colorEstrella(...s)).toArray(col, col.length);
      tam.push(Math.max(3, 15 / d));
    }
    const g = this.pts.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('tam', new THREE.Float32BufferAttribute(tam, 1));
    g.computeBoundingSphere();
  }

  /** La estrella a la que apunta una dirección (dentro de ~4°), o null. */
  apuntada(dir) {
    let mejor = null, m = Math.cos(4 * Math.PI / 180);
    for (const e of this.estrellas) { const a = e.dir.dot(dir); if (a > m) { m = a; mejor = e; } }
    return mejor;
  }
  direccionA(sector) { return new THREE.Vector3(sector[0] - this.sector[0], sector[1] - this.sector[1], sector[2] - this.sector[2]).normalize(); }
  /** Dirección a la Señal (para la historia). */
  senal() { return this.direccionA(SENAL); }

  iniciarSalto(destino, dir) { this.salto = { t: 0, destino, dir: dir.clone(), cargado: false }; }
  /** Avanza la animación; devuelve 'cargar' a mitad del túnel y 'fin' al terminar. */
  actualizar(dt, cam) {
    this.pts.position.copy(cam.position);
    const s = this.salto; if (!s) { this.tunel.visible = false; return null; }
    s.t += dt;
    this.tunel.visible = true;
    this.tunel.position.copy(cam.position); this.tunel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), s.dir);
    const p = this.tunel.geometry.attributes.position.array, v = 900 * Math.min(1, s.t * 1.5);
    for (let i = 0; i < p.length; i += 6) { p[i + 2] += v * dt; p[i + 5] = p[i + 2] - 10 - v * 0.08; if (p[i + 2] > 20) { p[i + 2] -= 620; } }
    this.tunel.geometry.attributes.position.needsUpdate = true;
    this.tunel.material.opacity = Math.min(1, s.t * 2) * Math.min(1, (3.4 - s.t) * 2);
    if (s.t > 1.6 && !s.cargado) { s.cargado = true; return 'cargar'; }
    if (s.t > 3.4) { this.salto = null; this.tunel.visible = false; return 'fin'; }
    return 'tunel';
  }
}

/** Mapa 2D de la galaxia (vista desde arriba: x a la derecha, z abajo). Devuelve el sector tocado. */
export function dibujarMapa(cv, sector, E, destino) {
  const W = cv.width = cv.clientWidth * (devicePixelRatio || 1), H = cv.height = cv.clientHeight * (devicePixelRatio || 1);
  const x = cv.getContext('2d'), N = 8, paso = Math.min(W, H) / (N * 2 + 1.5);
  x.fillStyle = '#07040f'; x.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, exp = expedicionSemana().sector;
  x.strokeStyle = 'rgba(0,240,255,.08)';
  for (let i = -N; i <= N; i++) { x.beginPath(); x.moveTo(cx + i * paso, cy - N * paso); x.lineTo(cx + i * paso, cy + N * paso); x.stroke(); x.beginPath(); x.moveTo(cx - N * paso, cy + i * paso); x.lineTo(cx + N * paso, cy + i * paso); x.stroke(); }
  // alcance de salto con el combustible actual
  const alcance = Math.floor(E.combustible / COSTE_SECTOR);
  x.strokeStyle = 'rgba(255,46,136,.5)'; x.setLineDash([6, 6]); x.beginPath(); x.arc(cx, cy, alcance * paso, 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
  const puntos = [];
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
    const s = [sector[0] + i, sector[1], sector[2] + j], px = cx + i * paso, py = cy + j * paso;
    const visitado = E.visitados.includes(s.join(','));
    x.fillStyle = colorEstrella(...s); x.globalAlpha = visitado ? 1 : 0.55;
    x.beginPath(); x.arc(px, py, paso * (visitado ? 0.2 : 0.13), 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
    if (visitado) { x.strokeStyle = '#ffffff55'; x.beginPath(); x.arc(px, py, paso * 0.3, 0, Math.PI * 2); x.stroke(); }
    if (s[0] === exp[0] && s[2] === exp[2]) { x.strokeStyle = '#ffd23f'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, paso * 0.42, 0, Math.PI * 2); x.stroke(); x.lineWidth = 1; }
    if (destino && s[0] === destino[0] && s[2] === destino[2]) { x.strokeStyle = '#39ff88'; x.lineWidth = 3; x.strokeRect(px - paso * 0.4, py - paso * 0.4, paso * 0.8, paso * 0.8); x.lineWidth = 1; }
    puntos.push({ s, px, py });
  }
  // tú
  x.strokeStyle = '#00f0ff'; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, paso * 0.45, 0, Math.PI * 2); x.stroke(); x.lineWidth = 1;
  // la Señal
  const ds = [SENAL[0] - sector[0], SENAL[2] - sector[2]], l = Math.hypot(...ds) || 1;
  x.fillStyle = '#ff2e88'; x.font = `${Math.round(paso * 0.32)}px system-ui`; x.textAlign = 'center';
  const sx = cx + ds[0] / l * Math.min(l, N) * paso, sy = cy + ds[1] / l * Math.min(l, N) * paso;
  x.beginPath(); x.moveTo(sx, sy - 8); x.lineTo(sx + 6, sy); x.lineTo(sx, sy + 8); x.lineTo(sx - 6, sy); x.fill();
  x.fillText('LA SEÑAL', sx, sy - 12);
  return (px, py) => { let m = null, dm = paso * 0.5; for (const q of puntos) { const d = Math.hypot(q.px - px, q.py - py); if (d < dm) { dm = d; m = q.s; } } return m; };
}
