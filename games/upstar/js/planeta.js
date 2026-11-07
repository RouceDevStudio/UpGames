// Un planeta: cubo «esferizado» de 6 caras, cada una un árbol de cuadrados (quadtree) que se
// subdivide cerca de la cámara y se simplifica lejos. Así un planeta de miles de km² se dibuja
// con unos pocos cientos de trozos: el detalle solo existe donde estás mirando. Cada trozo se
// calcula en un hilo aparte (trozo.worker.js) con la misma fórmula que usa el resto del juego.
//
// Además: agua (o lava), atmósfera con brillo en el borde, anillos y flora cerca del suelo.

import * as THREE from 'three';
import { crearRelieve } from './universo.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash, azar } from './ruido.js';

const N = 16;                      // cuadrados por lado de cada trozo
const MAX_PROF = 10;               // profundidad máxima del árbol (trozos de ~10-20 m)
const DIVIDIR = 2.3;               // se divide cuando la cámara está a menos de tamaño × DIVIDIR (más alto = más distancia de detalle)

// ─── Hilos de trabajo compartidos por todos los planetas ────────────────────────────────────────
const hilos = [], cola = [], pendientes = new Map();
let siguienteId = 1;
function iniciarHilos() {
  if (hilos.length) return;
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  for (let k = 0; k < n; k++) {
    const w = new Worker(new URL('./trozo.worker.js', import.meta.url), { type: 'module' });
    w.ocupado = false;
    w.onmessage = (e) => { w.ocupado = false; const cb = pendientes.get(e.data.id); pendientes.delete(e.data.id); cb?.(e.data); despachar(); };
    hilos.push(w);
  }
}
function pedir(datos, prioridad, cb) {
  const id = siguienteId++;
  cola.push({ id, datos, prioridad, cb });
  return id;
}
function despachar() {
  if (!cola.length) return;
  cola.sort((a, b) => a.prioridad() - b.prioridad());
  for (const w of hilos) {
    if (w.ocupado || !cola.length) continue;
    const t = cola.shift();
    if (t.cancelado) continue;
    w.ocupado = true; pendientes.set(t.id, t.cb);
    w.postMessage({ id: t.id, ...t.datos });
  }
}
export const estadisticasHilos = () => ({ cola: cola.length, enCurso: pendientes.size });

// índices comunes: rejilla + faldón (por las dos caras para que se vea desde cualquier lado)
let _indices = null;
function indices() {
  if (_indices) return _indices;
  const g = (i, j) => j * (N + 1) + i, nV = (N + 1) * (N + 1), ix = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) ix.push(g(i, j), g(i + 1, j), g(i, j + 1), g(i + 1, j), g(i + 1, j + 1), g(i, j + 1));
  const anillo = [];
  for (let i = 0; i < N; i++) anillo.push(g(i, 0));
  for (let j = 0; j < N; j++) anillo.push(g(N, j));
  for (let i = N; i > 0; i--) anillo.push(g(i, N));
  for (let j = N; j > 0; j--) anillo.push(g(0, j));
  for (let k = 0; k < 4 * N; k++) {
    const a = anillo[k], b = anillo[(k + 1) % (4 * N)], sa = nV + k, sb = nV + (k + 1) % (4 * N);
    ix.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
  }
  _indices = new THREE.BufferAttribute(new Uint16Array(ix), 1);
  return _indices;
}

// ─── Materiales de dibujo (cel shading) ─────────────────────────────────────────────────────
let _rampa = null;
export function rampa() {
  if (_rampa) return _rampa;
  const d = new Uint8Array([70, 70, 70, 255, 150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]);
  _rampa = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat); _rampa.minFilter = _rampa.magFilter = THREE.NearestFilter; _rampa.needsUpdate = true;
  return _rampa;
}
/** Material de dibujo con contorno (los bordes de la silueta se oscurecen). */
export function materialToon(opc = {}, contorno = 0.55) {
  const m = new THREE.MeshToonMaterial({ gradientMap: rampa(), ...opc });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{
      float borde = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
      outgoingLight *= 1.0 - ${contorno.toFixed(2)} * smoothstep(0.6, 0.92, borde);
    }
    #include <opaque_fragment>`);
  };
  return m;
}

function materialAtmosfera(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(color) }, sol: { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vW;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = normalize(w.xyz - (modelMatrix * vec4(0,0,0,1)).xyz); vN = normalize(normalMatrix * normal); vec4 mv = viewMatrix * w; vV = -mv.xyz; gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `uniform vec3 color; uniform vec3 sol; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float dia = smoothstep(-0.35, 0.4, dot(vW, normalize(sol)));
        gl_FragColor = vec4(color * f * (0.15 + 0.85 * dia) * 1.4, 1.0);
      }`,
  });
}

// Flora y minerales instanciados por trozo: cristales de neón, rocas (ferrita) y plantas (carbono)
let _geos = null;
export function geosFlora() {
  if (_geos) return _geos;
  const cristal = new THREE.ConeGeometry(0.6, 4, 5, 1); cristal.translate(0, 2, 0);
  const roca = new THREE.DodecahedronGeometry(1.1, 0); roca.scale(1.3, 0.8, 1.1); roca.translate(0, 0.5, 0);
  const tronco = new THREE.CylinderGeometry(0.18, 0.28, 3, 5); tronco.translate(0, 1.5, 0);
  const copa = new THREE.IcosahedronGeometry(1.4, 0); copa.scale(1, 0.8, 1); copa.translate(0, 3.4, 0);
  const planta = mergeGeometries([tronco.toNonIndexed(), copa.toNonIndexed()]);
  _geos = [cristal, roca, planta];
  return _geos;
}
export const RECURSO_FLORA = ['cristal', 'ferrita', 'carbono'];

export class Planeta {
  constructor(scene, p, sol) {
    this.p = p; this.R = p.radio;
    this.grupo = new THREE.Group(); this.grupo.position.set(...p.pos);
    scene.add(this.grupo);
    this.altura = crearRelieve(p);
    this.mat = materialToon({ vertexColors: true });
    this.matFlora = [
      materialToon({ color: new THREE.Color(p.pal[1]), emissive: new THREE.Color(p.pal[1]), emissiveIntensity: 0.45 }, 0.35),
      materialToon({ color: new THREE.Color(p.pal[3]).multiplyScalar(0.6) }, 0.5),
      materialToon({ color: new THREE.Color(p.pal[2]), emissive: new THREE.Color(p.pal[4]), emissiveIntensity: 0.12 }, 0.45),
    ];
    this.minables = new Set();        // mallas instanciadas que se pueden minar (para el láser)
    iniciarHilos();
    this.raices = [0, 1, 2, 3, 4, 5].map(c => this._nodo(c, 0, 0, 1, 0, null));
    // agua o lava
    if (p.agua) {
      const mar = this.R + p.nivelMar * p.amplitud;
      const mAgua = materialToon({ color: new THREE.Color(p.mar), transparent: !p.lava, opacity: 0.86, emissive: p.lava ? new THREE.Color(p.mar) : 0x000000, emissiveIntensity: p.lava ? 0.9 : 0 }, 0.3);
      this.agua = new THREE.Mesh(new THREE.SphereGeometry(mar, 160, 100), mAgua);
      this.agua.renderOrder = 1;
      this.grupo.add(this.agua);
    }
    // atmósfera
    this.atm = new THREE.Mesh(new THREE.SphereGeometry(this.R * 1.16, 96, 64), materialAtmosfera(p.cielo));
    this.atm.material.uniforms.sol.value.copy(sol);
    this.grupo.add(this.atm);
    // anillos
    if (p.anillos) {
      const g = new THREE.RingGeometry(this.R * 1.5, this.R * 2.3, 128, 1);
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 4;
      const x = cv.getContext('2d');
      for (let i = 0; i < 256; i++) { const a = 0.15 + 0.6 * Math.abs(Math.sin(i * 0.37 + p.semilla % 7) * Math.sin(i * 0.11)); x.fillStyle = `rgba(255,255,255,${a})`; x.fillRect(i, 0, 1, 4); }
      const tex = new THREE.CanvasTexture(cv);
      // la textura va a lo largo del radio
      const uv = g.attributes.uv, pos = g.attributes.position;
      for (let i = 0; i < uv.count; i++) { const r = Math.hypot(pos.getX(i), pos.getY(i)); uv.setXY(i, (r - this.R * 1.5) / (this.R * 0.8), 0.5); }
      this.anillo = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(p.pal[3]), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      this.anillo.rotation.x = Math.PI / 2 - 0.35; this.anillo.rotation.y = 0.4;
      this.grupo.add(this.anillo);
    }
    this.trozos = 0;
    // lunas: pequeñas esferas de dibujo que orbitan despacio (se ven desde la superficie)
    this.lunas = [];
    const rl = azar(hash(p.semilla, 31));
    for (let k = 0; k < (p.lunas || 0); k++) {
      const ml = new THREE.Mesh(new THREE.IcosahedronGeometry(this.R * (0.12 + rl() * 0.12), 3), materialToon({ color: new THREE.Color(p.pal[2 + k]).lerp(new THREE.Color('#888'), 0.5) }));
      ml.userData = { d: this.R * (3 + k * 1.4 + rl()), v: 0.01 + rl() * 0.02, a: rl() * 6.28, inc: rl() - 0.5 };
      this.grupo.add(ml); this.lunas.push(ml);
    }
    this.estructuras = null;           // ciudad y ruinas: se construyen al acercarse
  }

  /** Ciudad de neón y ruinas sobre la superficie (deterministas). */
  _construirEstructuras() {
    const p = this.p, g = new THREE.Group(); this.estructuras = g; this.grupo.add(g);
    this.ruinas = []; this.ciudad = null;
    const sobre = (d, alto = 0) => { const h = Math.max(this.altura(d.x, d.y, d.z), p.agua ? p.nivelMar * p.amplitud : -1e9); return d.clone().multiplyScalar(this.R + h + alto); };
    const orientar = (obj, d) => { obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); };
    if (p.ciudad) {
      const d0 = new THREE.Vector3(...p.ciudad).normalize(), r = azar(hash(p.semilla, 41));
      const n = 70, geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
      const cv = document.createElement('canvas'); cv.width = 32; cv.height = 128; const x = cv.getContext('2d');
      x.fillStyle = '#0b0618'; x.fillRect(0, 0, 32, 128);
      for (let j = 4; j < 128; j += 6) for (let i = 3; i < 32; i += 7) if (Math.random() < 0.55) { x.fillStyle = Math.random() < 0.5 ? '#00f0ff' : '#ff2e88'; x.fillRect(i, j, 4, 3); }
      const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      const im = new THREE.InstancedMesh(geo, mat, n), mt = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      const tang = new THREE.Vector3(0, 1, 0).cross(d0).normalize(), bit = d0.clone().cross(tang);
      for (let k = 0; k < n; k++) {
        const a = r() * 6.28, rr = Math.sqrt(r()) * 900;
        const d = d0.clone().multiplyScalar(this.R).addScaledVector(tang, Math.cos(a) * rr).addScaledVector(bit, Math.sin(a) * rr).normalize();
        const h = 40 + r() ** 2 * 260 * (1 - rr / 1100), w = 18 + r() * 30;
        q.setFromUnitVectors(up, d);
        mt.compose(sobre(d, -5), q, new THREE.Vector3(w, h, w)); im.setMatrixAt(k, mt);
      }
      im.computeBoundingSphere(); g.add(im);
      // faro de la ciudad: haz de luz que se ve desde lejos
      const haz = new THREE.Mesh(new THREE.CylinderGeometry(6, 30, 2500, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#ff2e88', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      haz.geometry.translate(0, 1250, 0); haz.position.copy(sobre(d0)); orientar(haz, d0); g.add(haz);
      this.ciudad = { dir: d0, pos: sobre(d0) };
    }
    const matR = materialToon({ color: new THREE.Color(p.pal[3]).lerp(new THREE.Color('#777'), 0.6) });
    const matT = new THREE.MeshBasicMaterial({ color: '#00f0ff' });
    p.ruinas.forEach((rd, k) => {
      const d = new THREE.Vector3(...rd).normalize(), r = azar(hash(p.semilla, 60 + k));
      const ru = new THREE.Group(); ru.position.copy(sobre(d, -1)); orientar(ru, d);
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * 6.28, alto = 6 + r() * 14;
        const pil = new THREE.Mesh(new THREE.BoxGeometry(2.2, alto, 2.2), matR); pil.position.set(Math.cos(a) * 16, alto / 2, Math.sin(a) * 16); pil.rotation.z = (r() - 0.5) * 0.3; ru.add(pil);
      }
      const arco = new THREE.Mesh(new THREE.TorusGeometry(9, 1.2, 6, 16, Math.PI), matR); arco.position.y = 0; ru.add(arco);
      // terminal antiguo (se hackea) con su luz
      const term = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 0.8), matR); term.position.set(0, 1.2, 3); ru.add(term);
      const pant = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), matT); pant.position.set(0, 1.9, 3.41); ru.add(pant);
      g.add(ru);
      ru.updateMatrix();
      // (posiciones relativas al centro del planeta; en el mundo: + grupo.position)
      this.ruinas.push({ k, pos: ru.position.clone(), terminal: new THREE.Vector3(0, 1.5, 3).applyMatrix4(ru.matrix), id: `r:${p.semilla}:${k}` });
    });
  }

  _nodo(cara, u0, v0, tam, prof, padre) {
    const n = { cara, u0, v0, tam, prof, padre, hijos: null, malla: null, flora: null, id: 0, listo: false };
    // centro aproximado (sin relieve) para decidir el detalle
    n.centro = dirCubo(cara, u0 + tam / 2, v0 + tam / 2, new THREE.Vector3()).multiplyScalar(this.R);
    n.tamMundo = tam * this.R * 1.6;
    return n;
  }

  _pedir(n) {
    if (n.id) return;
    const p = this.p, cam = this._cam;
    const datos = { p: { semilla: p.semilla, radio: p.radio, amplitud: p.amplitud, nivelMar: p.nivelMar, escala: p.escala, montes: p.montes, tipo: p.tipo, pal: p.pal, agua: p.agua },
      cara: n.cara, u0: n.u0, v0: n.v0, tam: n.tam, N, flora: n.prof >= MAX_PROF - 1 ? 40 : 0 };
    n.id = pedir(datos, () => n.centro.distanceToSquared(cam) - (n.prof << 20), (r) => this._recibir(n, r));
  }

  _recibir(n, r) {
    if (n.muerto) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(r.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(r.col, 3));
    g.setIndex(indices());
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mat);
    m.position.set(...r.centro); m.visible = false;
    m.matrixAutoUpdate = false; m.updateMatrix();
    this.grupo.add(m);
    n.malla = m; n.listo = true; this.trozos++;
    n.centro.set(...r.centro);
    if (r.fl && r.fl.length) {
      const k = r.fl.length / 9, por = [[], [], []];
      for (let i = 0; i < k; i++) por[r.fl[i * 9 + 8]].push(i);
      const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), s = new THREE.Vector3(), pp = new THREE.Vector3(), q2 = new THREE.Quaternion();
      n.flora = [];
      por.forEach((lista, tipo) => {
        if (!lista.length) return;
        const im = new THREE.InstancedMesh(geosFlora()[tipo], this.matFlora[tipo], lista.length);
        lista.forEach((i, j) => {
          const f = r.fl.subarray(i * 9, i * 9 + 9);
          d.set(f[3], f[4], f[5]); q.setFromUnitVectors(up, d).multiply(q2.setFromAxisAngle(up, f[7] * 6.28));
          // (cristales de 2-7 m, rocas de 1-3 m y plantas de 3-6 m: a escala del astronauta)
          const e = tipo === 0 ? [f[6] * (0.35 + f[7] * 0.3), f[6] * (0.45 + f[7] * 0.55)] : tipo === 1 ? [f[6] * 0.7, f[6] * 0.6] : [f[6] * 0.55, f[6] * (0.6 + f[7] * 0.5)];
          s.set(e[0], e[1], e[0]);
          mt.compose(pp.set(f[0], f[1], f[2]), q, s); im.setMatrixAt(j, mt);
        });
        im.position.copy(m.position); im.visible = false; im.computeBoundingSphere();
        im.userData = { tipo, recurso: RECURSO_FLORA[tipo], vida: new Float32Array(lista.length).fill(1) };
        this.grupo.add(im); n.flora.push(im); this.minables.add(im);
      });
    }
  }

  _borrar(n) {
    n.muerto = true;
    if (n.malla) { this.grupo.remove(n.malla); n.malla.geometry.dispose(); this.trozos--; }
    if (n.flora) for (const f of n.flora) { this.grupo.remove(f); f.dispose(); this.minables.delete(f); }
    n.malla = null; n.flora = null;
    for (const t of cola) if (t.id === n.id) t.cancelado = true;
    if (n.hijos) for (const h of n.hijos) this._borrar(h);
    n.hijos = null;
  }

  /** camMundo: posición de la cámara en el mundo. Decide qué trozos se ven. */
  actualizar(camMundo) {
    this._cam = this._cam || new THREE.Vector3();
    this._cam.copy(camMundo).sub(this.grupo.position);
    const dist = this._cam.length();
    for (const r of this.raices) this._recorrer(r, dist);
    despachar();
    if (!this.estructuras && dist < this.R * 4) this._construirEstructuras();
    const t = performance.now() / 1000;
    for (const l of this.lunas) { const u = l.userData, a = u.a + t * u.v; l.position.set(Math.cos(a) * u.d, Math.sin(a) * u.d * u.inc, Math.sin(a) * u.d); }
  }

  // devuelve true si el nodo (o sus hijos) cubre su zona con mallas listas
  _recorrer(n, dist) {
    if (!n.listo) this._pedir(n);
    const d = n.centro.distanceTo(this._cam);
    // por detrás del horizonte no hace falta detalle
    const quiere = n.prof < MAX_PROF && d < n.tamMundo * DIVIDIR && dist < this.R * 6;
    if (quiere) {
      if (!n.hijos) {
        const h = n.tam / 2;
        n.hijos = [[0, 0], [h, 0], [0, h], [h, h]].map(([a, b]) => this._nodo(n.cara, n.u0 + a, n.v0 + b, h, n.prof + 1, n));
      }
      let todos = true;
      for (const h of n.hijos) todos = this._recorrer(h, dist) && todos;
      if (todos) { this._ver(n, false); return true; }
      // mientras llegan los hijos, el padre tapa el hueco
      for (const h of n.hijos) this._ocultarRama(h);
      this._ver(n, true);
      return n.listo;
    }
    if (n.hijos) { for (const h of n.hijos) this._borrar(h); n.hijos = null; }
    this._ver(n, true);
    return n.listo;
  }
  _ver(n, si) { if (n.malla) n.malla.visible = si; if (n.flora) for (const f of n.flora) f.visible = si; }
  _ocultarRama(n) { this._ver(n, false); if (n.hijos) for (const h of n.hijos) this._ocultarRama(h); }

  /** Altura del suelo (m sobre el radio) bajo un punto del mundo, y la dirección «arriba». */
  suelo(pMundo, outArriba) {
    const v = outArriba.copy(pMundo).sub(this.grupo.position).normalize();
    let h = this.altura(v.x, v.y, v.z);
    if (this.p.agua) h = Math.max(h, this.p.nivelMar * this.p.amplitud);
    return h;
  }

  ponerSol(s) { this.atm.material.uniforms.sol.value.copy(s); }

  destruir() {
    for (const r of this.raices) this._borrar(r);
    this.grupo.parent?.remove(this.grupo);
    this.grupo.traverse(o => { o.geometry?.dispose?.(); });
  }
}

const CARAS = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
function dirCubo(cara, u, v, out) {
  const [n, a, b] = CARAS[cara], s = u * 2 - 1, t = v * 2 - 1;
  const x = n[0] + a[0] * s + b[0] * t, y = n[1] + a[1] * s + b[1] * t, z = n[2] + a[2] * s + b[2] * t;
  const x2 = x * x, y2 = y * y, z2 = z * z;
  return out.set(x * Math.sqrt(1 - y2 / 2 - z2 / 2 + y2 * z2 / 3), y * Math.sqrt(1 - z2 / 2 - x2 / 2 + z2 * x2 / 3), z * Math.sqrt(1 - x2 / 2 - y2 / 2 + x2 * y2 / 3));
}
