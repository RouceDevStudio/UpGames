// Escenario: cielo, luz, terreno, pista, bordillos, escapatorias, muros, gradas,
// boxes, pórtico de salida con semáforo, carteles de frenada y vegetación.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import * as TX from './texturas.js';

const SOL_ELEVACION = 34, SOL_AZIMUT = 215;

// Cinta indexada a lo largo de la pista. `perfil(i)` devuelve K pares [d, dy].
function cinta(c, perfil, { filtro = null, uDe = null, escalaV = 10, yBase = 0 } = {}) {
  const n = c.n;
  const K = perfil(0).length;
  const filas = n + 1;
  const pos = new Float32Array(filas * K * 3), uv = new Float32Array(filas * K * 2);
  for (let r = 0; r < filas; r++) {
    const i = r % n;
    const nx = -c.tz[i], nz = c.tx[i];
    const cols = perfil(i);
    for (let j = 0; j < K; j++) {
      const [d, dy] = cols[j];
      const k = r * K + j;
      pos[k * 3] = c.x[i] + nx * d;
      pos[k * 3 + 1] = c.y[i] + dy + yBase;
      pos[k * 3 + 2] = c.z[i] + nz * d;
      uv[k * 2] = uDe ? uDe(j, d, i) : j / (K - 1);
      uv[k * 2 + 1] = r * c.paso / escalaV;
    }
  }
  const idx = [];
  for (let r = 0; r < n; r++) {
    if (filtro && !(filtro(r % n) && filtro((r + 1) % n))) continue;
    for (let j = 0; j < K - 1; j++) {
      const a = r * K + j, b = (r + 1) * K + j, cc = r * K + j + 1, d = (r + 1) * K + j + 1;
      idx.push(a, cc, b, cc, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

class Terreno {
  constructor(c, calidad) {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < c.n; i++) {
      minx = Math.min(minx, c.x[i]); maxx = Math.max(maxx, c.x[i]);
      minz = Math.min(minz, c.z[i]); maxz = Math.max(maxz, c.z[i]);
    }
    const margen = 900;
    this.x0 = minx - margen; this.z0 = minz - margen;
    this.ancho = maxx - minx + 2 * margen; this.alto = maxz - minz + 2 * margen;
    this.celda = calidad >= 2 ? 10 : 16;
    this.nx = Math.ceil(this.ancho / this.celda) + 1; this.nz = Math.ceil(this.alto / this.celda) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    this.dist = new Float32Array(this.nx * this.nz);
    // submuestreo del trazado
    const sub = [];
    for (let i = 0; i < c.n; i += 3) sub.push(i);
    const rnd = TX.aleatorio(77);
    // ruido de colinas (malla gruesa)
    const gN = 24, ruido = new Float32Array(gN * gN).map(() => rnd());
    const colina = (x, z) => {
      const fx = (x - this.x0) / this.ancho * (gN - 1), fz = (z - this.z0) / this.alto * (gN - 1);
      const ix = Math.max(0, Math.min(gN - 2, Math.floor(fx))), iz = Math.max(0, Math.min(gN - 2, Math.floor(fz)));
      const tx = fx - ix, tz = fz - iz;
      const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
      const a = ruido[iz * gN + ix], b = ruido[iz * gN + ix + 1], cc = ruido[(iz + 1) * gN + ix], d = ruido[(iz + 1) * gN + ix + 1];
      return (a + (b - a) * sx) * (1 - sz) + (cc + (d - cc) * sx) * sz;
    };
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      const x = this.x0 + ix * this.celda, z = this.z0 + iz * this.celda;
      let wsum = 0, hsum = 0, dmin = Infinity, imin = 0;
      for (const i of sub) {
        const d2 = (c.x[i] - x) ** 2 + (c.z[i] - z) ** 2;
        if (d2 < dmin) { dmin = d2; imin = i; }
        const w = 1 / (d2 * Math.sqrt(d2) + 50);
        wsum += w; hsum += w * c.y[i];
      }
      const dist = Math.sqrt(dmin);
      const hPista = c.y[imin];
      const hSuave = hsum / wsum;
      // junto a la pista manda su altura; lejos, la media suavizada más colinas
      const mezcla = Math.min(1, Math.max(0, (dist - 30) / 120));
      let h = hPista * (1 - mezcla) + hSuave * mezcla - 0.55;
      const lejos = Math.min(1, Math.max(0, (dist - 160) / 700));
      h += lejos * lejos * (colina(x, z) * 160 + 10);
      const k = iz * this.nx + ix;
      this.h[k] = h; this.dist[k] = dist;
    }
  }

  altura(x, z) {
    const fx = (x - this.x0) / this.celda, fz = (z - this.z0) / this.celda;
    const ix = Math.max(0, Math.min(this.nx - 2, Math.floor(fx))), iz = Math.max(0, Math.min(this.nz - 2, Math.floor(fz)));
    const tx = fx - ix, tz = fz - iz;
    const h = this.h, n = this.nx;
    const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  distancia(x, z) {
    const ix = Math.max(0, Math.min(this.nx - 1, Math.round((x - this.x0) / this.celda)));
    const iz = Math.max(0, Math.min(this.nz - 1, Math.round((z - this.z0) / this.celda)));
    return this.dist[iz * this.nx + ix];
  }

  malla(material) {
    const g = new THREE.PlaneGeometry(this.ancho, this.alto, this.nx - 1, this.nz - 1);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k) + this.x0 + this.ancho / 2;
      const z = p.getZ(k) + this.z0 + this.alto / 2;
      p.setXYZ(k, x, 0, z);
      uv.setXY(k, x / 30, z / 30);
    }
    // el orden de PlaneGeometry rotado coincide con la rejilla (filas en z)
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      const k = iz * this.nx + ix;
      p.setY(k, this.h[k]);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }
}

export function construirEscenario(scene, renderer, c, calidad) {
  const res = { luces: [], actualizables: [] };
  const anis = renderer.capabilities.getMaxAnisotropy();

  // --- Cielo y entorno ---------------------------------------------------
  const cielo = new Sky();
  cielo.scale.setScalar(20000);
  const u = cielo.material.uniforms;
  u.turbidity.value = 5.5; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  const sol = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SOL_ELEVACION), THREE.MathUtils.degToRad(SOL_AZIMUT));
  u.sunPosition.value.copy(sol);
  scene.add(cielo);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const escenaCielo = new THREE.Scene();
  const cielo2 = new Sky(); cielo2.scale.setScalar(1000);
  for (const k in u) if (cielo2.material.uniforms[k]) cielo2.material.uniforms[k].value = u[k].value;
  escenaCielo.add(cielo2);
  // suelo verdoso en el mapa de entorno para reflejos creíbles en la pintura
  const sueloEnv = new THREE.Mesh(new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4d5a3a }));
  sueloEnv.position.y = -20; escenaCielo.add(sueloEnv);
  const env = pmrem.fromScene(escenaCielo, 0.02).texture;
  scene.environment = env;
  pmrem.dispose();
  scene.fog = new THREE.Fog(0xb9c8d6, 700, calidad >= 2 ? 5200 : 3200);
  res.sol = sol;

  const luzSol = new THREE.DirectionalLight(0xfff1dc, 3.2);
  luzSol.position.copy(sol).multiplyScalar(300);
  if (calidad >= 1) {
    luzSol.castShadow = true;
    const t = calidad >= 3 ? 4096 : calidad >= 2 ? 2048 : 1024;
    luzSol.shadow.mapSize.set(t, t);
    const ext = calidad >= 2 ? 42 : 30;
    Object.assign(luzSol.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 700 });
    luzSol.shadow.bias = -0.00025; luzSol.shadow.normalBias = 0.04;
  }
  scene.add(luzSol); scene.add(luzSol.target);
  res.luzSol = luzSol;
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x55603f, 0.55));

  // --- Materiales ---------------------------------------------------------
  const asf = TX.texturasAsfalto(calidad >= 2 ? 512 : 256);
  for (const t of [asf.mapa, asf.normal, asf.rugosidad]) { t.anisotropy = anis; }
  const matAsfalto = new THREE.MeshStandardMaterial({
    map: asf.mapa, normalMap: calidad >= 2 ? asf.normal : null, roughnessMap: asf.rugosidad,
    roughness: 1, metalness: 0, color: 0x6c6d72, normalScale: new THREE.Vector2(0.6, 0.6),
  });
  const matEscape = matAsfalto.clone(); matEscape.color = new THREE.Color(0x85878d);
  const texH = TX.texturaHierba(calidad >= 2 ? 512 : 256); texH.anisotropy = anis;
  const matHierba = new THREE.MeshStandardMaterial({ map: texH, roughness: 0.95, color: 0xdde8d0 });
  const texT = TX.texturaTerreno(256); texT.anisotropy = anis;
  const matTerreno = new THREE.MeshStandardMaterial({ map: texT, roughness: 1, color: 0xd8e0cc });
  const texG = TX.texturaGrava(); texG.anisotropy = anis;
  const matGrava = new THREE.MeshStandardMaterial({ map: texG, roughness: 1 });
  const matBordillo = new THREE.MeshStandardMaterial({ map: TX.texturaBordillo(), roughness: 0.55 });
  const matLinea = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const texGoma = TX.texturaGoma();
  const matGoma = new THREE.MeshStandardMaterial({ map: texGoma, transparent: true, opacity: 0.55, roughness: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, color: 0x000000 });
  const texMuro = TX.texturaMuro(); texMuro.anisotropy = anis;
  const matMuro = new THREE.MeshStandardMaterial({ map: texMuro, roughness: 0.6 });
  const matNeum = new THREE.MeshStandardMaterial({ map: TX.texturaNeumaticos(), roughness: 0.9 });
  const matHormigon = new THREE.MeshStandardMaterial({ color: 0xc9cbc8, roughness: 0.9 });

  const hw = (i) => c.semiAncho[i];

  // --- Terreno -------------------------------------------------------------
  const terreno = new Terreno(c, calidad);
  res.terreno = terreno;
  scene.add(terreno.malla(matTerreno));

  // --- Asfalto ------------------------------------------------------------
  const COLS = calidad >= 2 ? 6 : 3;
  const carretera = new THREE.Mesh(cinta(c, (i) => {
    const out = [];
    for (let j = 0; j < COLS; j++) out.push([-hw(i) + 2 * hw(i) * j / (COLS - 1), 0]);
    return out;
  }, { uDe: (j, d) => d / 7, escalaV: 7 }), matAsfalto);
  carretera.receiveShadow = true;
  scene.add(carretera);

  // líneas blancas de borde
  for (const sg of [-1, 1]) {
    const m = new THREE.Mesh(cinta(c, (i) => [[sg * (hw(i) - 0.55), 0.004], [sg * (hw(i) - 0.3), 0.004]]), matLinea);
    m.receiveShadow = true;
    scene.add(m);
  }
  // goma sobre la trazada
  const t = c.trazada;
  const goma = new THREE.Mesh(cinta(c, (i) => [[t.off[i] - 1.6, 0.006], [t.off[i] + 1.6, 0.006]], { escalaV: 30 }), matGoma);
  goma.receiveShadow = true;
  scene.add(goma);

  // --- Bordillos -----------------------------------------------------------
  for (const sg of [-1, 1]) {
    const g = cinta(c, (i) => [[sg * hw(i), 0.0], [sg * (hw(i) + 0.4), 0.06], [sg * (hw(i) + 1.3), 0.02]],
      { filtro: (i) => c.bordillo[i], escalaV: 2.0, uDe: (j) => j / 2 });
    const m = new THREE.Mesh(g, matBordillo); m.receiveShadow = true; scene.add(m);
  }

  // --- Escapatorias: franja asfaltada, hierba y grava hasta el muro ----------
  for (const sg of [-1, 1]) {
    const lado = sg > 0 ? 1 : 0;
    const ini = (i) => sg * (hw(i) + (c.bordillo[i] ? 1.3 : 0));
    const franja = new THREE.Mesh(cinta(c, (i) => [[ini(i), 0.0], [sg * (hw(i) + 2.6), 0.0]], { uDe: (j, d) => d / 7, escalaV: 7 }), matEscape);
    franja.receiveShadow = true; scene.add(franja);
    const perfilExt = (i) => {
      const w = c.muro[lado][i];
      const out = [];
      const ds = [hw(i) + 2.6, hw(i) + 3.2, hw(i) + 6, hw(i) + 10, Math.max(hw(i) + 11, w + 0.2)];
      for (const d of ds) out.push([sg * Math.min(d, w + 0.2), c.caida(i, sg * Math.min(d, w + 0.2))]);
      return out;
    };
    const hierba = new THREE.Mesh(cinta(c, perfilExt, { filtro: (i) => !c.grava[lado][i], uDe: (j, d) => d / 12, escalaV: 12 }), matHierba);
    hierba.receiveShadow = true; scene.add(hierba);
    const grava = new THREE.Mesh(cinta(c, perfilExt, { filtro: (i) => c.grava[lado][i], uDe: (j, d) => d / 5, escalaV: 5, yBase: 0.03 }), matGrava);
    grava.receiveShadow = true; scene.add(grava);
    // franja de hierba más allá del muro (une con el terreno)
    const fuera = new THREE.Mesh(cinta(c, (i) => {
      const w = c.muro[lado][i];
      return [[sg * (w + 0.2), c.caida(i, sg * (w + 0.2))], [sg * (w + 14), -0.6]];
    }, { uDe: (j, d) => d / 12, escalaV: 12 }), matHierba);
    fuera.receiveShadow = true; scene.add(fuera);
    // muro: hormigón con publicidad o barrera de neumáticos en zonas de grava
    const muro = (filtro, mat, alto) => {
      const g = cinta(c, (i) => {
        const w = c.muro[lado][i];
        const y0 = c.caida(i, sg * w);
        return [[sg * w, y0 - 0.1], [sg * w, y0 + alto]];
      }, { filtro, escalaV: mat === matMuro ? 16 : 2.4, uDe: (j) => 1 - j });
      const m = new THREE.Mesh(g, mat);
      mat.side = THREE.DoubleSide;
      m.castShadow = calidad >= 2; m.receiveShadow = true;
      scene.add(m);
    };
    muro((i) => !c.grava[lado][i], matMuro, 1.05);
    muro((i) => c.grava[lado][i], matNeum, 1.0);
    // valla de protección sobre los muros
    if (calidad >= 2) {
      const texV = TX.texturaValla(); texV.repeat.set(1, 1);
      const matV = new THREE.MeshStandardMaterial({ map: texV, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.6, depthWrite: false });
      const g = cinta(c, (i) => {
        const w = c.muro[lado][i] + 0.3;
        const y0 = c.caida(i, sg * w) + 1.05;
        return [[sg * w, y0], [sg * (w + 0.4), y0 + 3.2]];
      }, { escalaV: 1.6, uDe: (j) => j * 2 });
      scene.add(new THREE.Mesh(g, matV));
    }
  }

  // --- Línea de salida, parrilla y pórtico -------------------------------
  const m0 = c.muestra(0);
  const ang0 = Math.atan2(m0.tz, m0.tx);
  const meta = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2 * hw(0)), new THREE.MeshStandardMaterial({ map: cuadros(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }));
  meta.rotation.x = -Math.PI / 2; meta.rotation.z = -ang0;
  meta.position.set(m0.x, m0.y + 0.008, m0.z);
  meta.receiveShadow = true;
  scene.add(meta);
  for (let k = 0; k < 10; k++) {
    const s = c.largo - 14 - 8 * k;
    const mk = c.muestra(s);
    const d = k % 2 === 0 ? -2.6 : 2.6;
    const ga = Math.atan2(mk.tz, mk.tx);
    const marca = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 2.4), matLinea);
    marca.rotation.x = -Math.PI / 2; marca.rotation.z = -ga;
    marca.position.set(mk.x - mk.tz * d + mk.tx * 2.9, mk.y + 0.01, mk.z + mk.tx * d + mk.tz * 2.9);
    scene.add(marca);
  }
  res.semaforo = portico(scene, c, m0, ang0, hw(0));

  // --- Gradas, boxes y edificios en la recta principal ----------------------
  const texPublico = TX.texturaPublico();
  const matGrada = new THREE.MeshStandardMaterial({ map: texPublico, roughness: 0.9 });
  const matTecho = new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.5, metalness: 0.3 });
  const matEdif = new THREE.MeshStandardMaterial({ map: TX.texturaEdificio(), roughness: 0.6 });
  for (const [s0, largo] of [[-260, 150], [-90, 160], [120, 170], [330, 140]]) grada(scene, c, s0, largo, -1, matGrada, matTecho, matHormigon);
  boxes(scene, c, -230, 400, matEdif, matTecho, matHormigon);
  // tribuna en la horquilla y en la Parabólica
  for (const cv of c.curvas) {
    if (/Horquilla|Remanso|Parab/.test(cv.nombre)) {
      const lado = cv.nombre.includes('Parab') ? -1 : -1;
      grada(scene, c, cv.s - 60, 110, lado, matGrada, matTecho, matHormigon);
    }
  }
  // puente publicitario en la Recta del Río
  const rr = c.curvas.find(x => x.nombre.startsWith('T5'));
  if (rr) puente(scene, c, rr.s - 330, matHormigon);
  carteles(scene, c);

  // --- Vegetación -----------------------------------------------------------
  arboles(scene, c, terreno, calidad);
  montanas(scene, terreno);

  return res;
}

function cuadros() {
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 256;
  const x = cv.getContext('2d');
  for (let i = 0; i < 2; i++) for (let j = 0; j < 16; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; x.fillRect(i * 16, j * 16, 16, 16); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  return t;
}

// Pórtico con el semáforo de salida (5 columnas de luces)
function portico(scene, c, m0, ang, hw) {
  const g = new THREE.Group();
  const matEst = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.6 });
  const ancho = 2 * hw + 6;
  const viga = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, ancho), matEst);
  viga.position.y = 7.2; g.add(viga);
  for (const sg of [-1, 1]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.7, 7.8, 0.7), matEst);
    col.position.set(0, 3.9, sg * ancho / 2); col.castShadow = true; g.add(col);
  }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 5.2), new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.4 }));
  panel.position.set(-0.6, 6.2, 0); g.add(panel);
  const luces = [];
  const geoL = new THREE.CircleGeometry(0.22, 20);
  for (let k = 0; k < 5; k++) {
    const col = [];
    for (let f = 0; f < 2; f++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 0, roughness: 0.2 });
      const l = new THREE.Mesh(geoL, mat);
      l.rotation.y = -Math.PI / 2;
      l.position.set(-0.86, 6.45 - f * 0.5, -2 + k * 1.0);
      g.add(l); col.push(mat);
    }
    luces.push(col);
  }
  // banderola UPGAMES
  const cartel = new THREE.Mesh(new THREE.PlaneGeometry(ancho * 0.8, 1.0), new THREE.MeshStandardMaterial({ map: TX.texturaCartel('UPGAMES', '#0d47ff', '#ffffff'), roughness: 0.6 }));
  cartel.rotation.y = -Math.PI / 2; cartel.position.set(-0.51, 7.2, 0);
  g.add(cartel);
  g.position.set(m0.x, m0.y, m0.z);
  g.rotation.y = -ang;
  viga.castShadow = true;
  scene.add(g);
  return {
    poner(n) {
      luces.forEach((col, k) => col.forEach(m => { m.emissiveIntensity = k < n ? 4 : 0; m.color.setHex(k < n ? 0xff2020 : 0x220000); }));
    },
  };
}

function colocarEnPista(c, obj, s, d, rotExtra = 0) {
  const m = c.muestra(s);
  obj.position.set(m.x - m.tz * d, m.y, m.z + m.tx * d);
  obj.rotation.y = -Math.atan2(m.tz, m.tx) + rotExtra;
}

function grada(scene, c, s0, largo, lado, matGrada, matTecho, matBase) {
  const tramos = Math.max(1, Math.round(largo / 30));
  for (let k = 0; k < tramos; k++) {
    const s = s0 + (k + 0.5) * largo / tramos;
    const i = Math.floor(c.envolver(s) / c.paso) % c.n;
    const d = lado * (c.muro[lado > 0 ? 1 : 0][i] + 9);
    const g = new THREE.Group();
    const L = largo / tramos - 1;
    const filas = 8;
    for (let f = 0; f < filas; f++) {
      const esc = new THREE.Mesh(new THREE.BoxGeometry(L, 0.9 + f * 0.9, 1.6), f % 2 ? matBase : matGrada);
      esc.position.set(0, (0.9 + f * 0.9) / 2, -lado * (-f * 1.6));
      g.add(esc);
    }
    // frente de público inclinado
    const frente = new THREE.Mesh(new THREE.PlaneGeometry(L, Math.hypot(filas * 1.6, filas * 0.9)), matGrada);
    frente.position.set(0, filas * 0.45 + 0.5, lado * filas * 0.8 - lado * 0.8);
    frente.rotation.x = lado > 0 ? Math.atan2(0.9, 1.6) - Math.PI / 2 : -(Math.atan2(0.9, 1.6) - Math.PI / 2);
    frente.rotation.y = lado > 0 ? Math.PI : 0;
    g.add(frente);
    const techo = new THREE.Mesh(new THREE.BoxGeometry(L, 0.25, filas * 1.6 + 3), matTecho);
    techo.position.set(0, filas * 0.9 + 4, lado * filas * 0.8);
    techo.rotation.x = lado * 0.08;
    g.add(techo);
    for (const x of [-L / 2 + 0.5, L / 2 - 0.5]) {
      const pilar = new THREE.Mesh(new THREE.BoxGeometry(0.4, filas * 0.9 + 4, 0.4), matBase);
      pilar.position.set(x, (filas * 0.9 + 4) / 2, lado * filas * 1.5);
      g.add(pilar);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    colocarEnPista(c, g, s, d);
    scene.add(g);
  }
}

function boxes(scene, c, s0, largo, matEdif, matTecho, matBase) {
  const tramos = Math.round(largo / 50);
  for (let k = 0; k < tramos; k++) {
    const s = s0 + (k + 0.5) * largo / tramos;
    const i = Math.floor(c.envolver(s) / c.paso) % c.n;
    const d = c.muro[1][i] + 14;
    const g = new THREE.Group();
    const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(50, 9, 16), [matBase, matBase, matTecho, matBase, matBase, matEdif]);
    cuerpo.position.y = 4.5;
    // la cara -z mira a la pista
    cuerpo.material = [matBase, matBase, matTecho, matBase, matEdif, matEdif];
    g.add(cuerpo);
    const alero = new THREE.Mesh(new THREE.BoxGeometry(50, 0.3, 4), matTecho);
    alero.position.set(0, 9.2, -9.5); g.add(alero);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    colocarEnPista(c, g, s, d);
    scene.add(g);
  }
  // muro de boxes con tejadillos del equipo
  const muro = new THREE.Mesh(new THREE.BoxGeometry(largo, 1.1, 0.5), matBase);
  const sm = s0 + largo / 2;
  const i = Math.floor(c.envolver(sm) / c.paso) % c.n;
  colocarEnPista(c, muro, sm, c.muro[1][i] + 3);
  muro.position.y += 0.55; muro.castShadow = true;
  scene.add(muro);
}

function puente(scene, c, s, matBase) {
  const i = Math.floor(c.envolver(s) / c.paso) % c.n;
  const ancho = c.muro[0][i] + c.muro[1][i] + 6;
  const g = new THREE.Group();
  const tablero = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, ancho), matBase);
  tablero.position.y = 8; g.add(tablero);
  const tex = TX.texturaMuro('UPGAMES');
  tex.repeat.set(2, 1);
  for (const sg of [-1, 1]) {
    const banda = new THREE.Mesh(new THREE.PlaneGeometry(ancho, 2.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    banda.position.set(sg * 1.62, 9.4, 0); banda.rotation.y = sg * Math.PI / 2; g.add(banda);
    const pilar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, 1.2), matBase);
    pilar.position.set(0, 4.5, sg * (ancho / 2 - 1)); g.add(pilar);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const m = c.muestra(s);
  g.position.set(m.x - m.tz * ((c.muro[1][i] - c.muro[0][i]) / 2), m.y, m.z + m.tx * ((c.muro[1][i] - c.muro[0][i]) / 2));
  g.rotation.y = -Math.atan2(m.tz, m.tx);
  scene.add(g);
}

// Carteles de distancia antes de las frenadas fuertes
function carteles(scene, c) {
  const geo = new THREE.PlaneGeometry(1.2, 0.6);
  const mats = { 100: null, 200: null, 300: null };
  for (const k of [100, 200, 300]) mats[k] = new THREE.MeshStandardMaterial({ map: TX.texturaCartel(String(k)), roughness: 0.5, side: THREE.DoubleSide });
  const poste = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6);
  const matPoste = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.5, roughness: 0.4 });
  const perfil = c.perfil;
  for (let i = 0; i < c.n; i++) {
    // inicio de frenada: la velocidad empieza a caer bruscamente
    const a = perfil[(i - 1 + c.n) % c.n], b = perfil[i], fin = perfil[(i + 60) % c.n];
    if (!(a >= b && perfil[(i - 2 + c.n) % c.n] < a + 0.01 && a - fin > 25)) continue;
    if (perfil[(i - 3 + c.n) % c.n] > a + 0.05) continue;
    // la curva va a la derecha o izquierda: carteles en el exterior
    let curvSum = 0;
    for (let j = 0; j < 80; j++) curvSum += c.curv[(i + j) % c.n];
    const lado = curvSum > 0 ? -1 : 1;
    const sFrenada = i * c.paso;
    for (const dist of [300, 200, 100]) {
      const s = sFrenada + 100 - dist;
      const k = Math.floor(c.envolver(s) / c.paso) % c.n;
      const d = lado * (c.semiAncho[k] + 3.6);
      const g = new THREE.Group();
      const p = new THREE.Mesh(geo, mats[dist]); p.position.y = 1.3; g.add(p);
      const pp = new THREE.Mesh(poste, matPoste); pp.position.y = 0.6; g.add(pp);
      colocarEnPista(c, g, s, d, Math.PI / 2);
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      scene.add(g);
    }
    i += 60;
  }
}

function arboles(scene, c, terreno, calidad) {
  const rnd = TX.aleatorio(99);
  const n = calidad >= 2 ? 1400 : 600;
  const tronco = new THREE.CylinderGeometry(0.18, 0.28, 3, 6); tronco.translate(0, 1.5, 0);
  const copaPino = new THREE.ConeGeometry(2.2, 7, 8); copaPino.translate(0, 6, 0);
  const copaFrondosa = new THREE.IcosahedronGeometry(2.8, 1); copaFrondosa.translate(0, 5, 0);
  const matTronco = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 });
  const matPino = new THREE.MeshStandardMaterial({ color: 0x2c4a2a, roughness: 0.95, flatShading: true });
  const matFrond = new THREE.MeshStandardMaterial({ color: 0x3f6331, roughness: 0.95, flatShading: true });
  const it = new THREE.InstancedMesh(tronco, matTronco, n);
  const ip = new THREE.InstancedMesh(copaPino, matPino, n);
  const ifr = new THREE.InstancedMesh(copaFrondosa, matFrond, n);
  let np = 0, nf = 0, nt = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  let intentos = 0;
  while (nt < n && intentos < n * 30) {
    intentos++;
    const x = terreno.x0 + rnd() * terreno.ancho, z = terreno.z0 + rnd() * terreno.alto;
    const dist = terreno.distancia(x, z);
    if (dist < 48 || dist > 650) continue;
    // más densidad cerca de la pista (bosquetes)
    if (rnd() > 1.15 - dist / 700) continue;
    const y = terreno.altura(x, z);
    const s = 0.7 + rnd() * 0.8;
    e.set(0, rnd() * Math.PI * 2, 0); q.setFromEuler(e); sc.set(s, s * (0.85 + rnd() * 0.4), s); p.set(x, y - 0.2, z);
    m.compose(p, q, sc);
    it.setMatrixAt(nt++, m);
    col.setHSL(0.27 + rnd() * 0.06, 0.35 + rnd() * 0.2, 0.75 + rnd() * 0.3);
    if (rnd() < 0.5) { ip.setMatrixAt(np, m); ip.setColorAt(np++, col); }
    else { ifr.setMatrixAt(nf, m); ifr.setColorAt(nf++, col); }
  }
  it.count = nt; ip.count = np; ifr.count = nf;
  for (const im of [it, ip, ifr]) { im.castShadow = calidad >= 2; im.receiveShadow = false; im.frustumCulled = false; scene.add(im); }
}

function montanas(scene, terreno) {
  // anillo de montañas lejanas que la niebla azula
  const cx = terreno.x0 + terreno.ancho / 2, cz = terreno.z0 + terreno.alto / 2;
  const R = Math.max(terreno.ancho, terreno.alto) * 0.5 + 900;
  const seg = 96;
  const rnd = TX.aleatorio(3);
  const alturas = [];
  for (let k = 0; k < seg; k++) alturas.push(180 + rnd() * 420 + Math.sin(k * 0.4) * 120);
  const pos = [], idx = [];
  for (let k = 0; k <= seg; k++) {
    const a = k / seg * Math.PI * 2;
    const h = alturas[k % seg];
    const x = Math.cos(a), z = Math.sin(a);
    pos.push(cx + x * R, -20, cz + z * R, cx + x * (R + 300), h, cz + z * (R + 300), cx + x * (R + 900), h * 0.4, cz + z * (R + 900));
  }
  for (let k = 0; k < seg; k++) {
    const a = k * 3, b = (k + 1) * 3;
    idx.push(a, b, a + 1, b, b + 1, a + 1, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x5d6e57, roughness: 1, flatShading: true, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(g, mat));
}
