// Circuito: trazado, muestreo, superficies, trazada ideal y perfil de velocidad.
// No depende de Three.js para poder probar las físicas en Node.

import { COCHE, G, RHO_AIRE } from './config.js';

// Trazado tipo "tortuga": rectas (S) y curvas de radio constante (A).
// Ángulo positivo = curva a la derecha. La línea de meta está en s = 0.
// Las longitudes marcadas con `ajusta` y el ángulo con `cierra` se recalculan
// para que el circuito cierre exactamente.
const TRAZADO_VALLE = {
  id: 'valle',
  nombre: 'Autódromo Valle del Cóndor',
  corto: 'Valle Andino',
  tipo: 'montaña',
  ritmoIA: 79.8,           // vuelta de la IA con habilidad 1,0 en seco (para la clasificación simulada)
  pais: 'Colombia',
  ancho: 14,
  segmentos: [
    { t: 'S', l: 640, nombre: 'Recta principal' },
    { t: 'A', r: 20, a: 92, nombre: 'T1 La Cumbre' },
    { t: 'S', l: 170, ajusta: true },
    { t: 'A', r: 60, a: -48, nombre: 'T2' },
    { t: 'A', r: 70, a: 44, nombre: 'T3' },
    { t: 'A', r: 95, a: -30, nombre: 'T4' },
    { t: 'S', l: 560, nombre: 'Recta del Río' },
    { t: 'A', r: 32, a: 122, nombre: 'T5 El Remanso' },
    { t: 'S', l: 430, nombre: 'Recta del Lago' },
    { t: 'A', r: 400, a: -12, nombre: 'Kink' },
    { t: 'S', l: 380 },
    { t: 'A', r: 170, a: 74, nombre: 'T6 Curva Grande' },
    { t: 'S', l: 240 },
    { t: 'A', r: 26, a: -84, nombre: 'T7 Los Andes' },
    { t: 'S', l: 70 },
    { t: 'A', r: 22, a: 140, nombre: 'T8 Horquilla' },
    { t: 'S', l: 160 },
    { t: 'A', r: 60, a: -40, nombre: 'T8b' },
    { t: 'S', l: 300 },
    { t: 'A', r: 130, a: 40, nombre: 'T9' },
    { t: 'S', l: 120 },
    { t: 'A', r: 17, a: -62, nombre: 'T10 Chicane' },
    { t: 'A', r: 17, a: 62, nombre: 'T11 Chicane' },
    { t: 'S', l: 60 },
    { t: 'A', r: 75, a: 0, cierra: true, nombre: 'T12 Parabólica' },
    { t: 'S', l: 330, ajusta: true, nombre: 'Recta principal' },
  ],
  // relieve: suma de senos periódicos (amplitud m, armónico, fase)
  relieve: [[11, 1, 0.6], [5, 2, 2.1], [2.2, 5, 0.3], [1.2, 9, 1.4]],
  // zonas DRS: en metros desde la meta (negativo = antes de la meta) o relativas a una recta con nombre
  drs: [{ ini: -280, fin: 560, det: -420 }, { recta: 'Recta del Río', ini: 90, fin: -40, det: -300 }],
};

// Urbano tipo Mónaco: estrecho, muros pegados, horquilla lenta y túnel junto al puerto
const TRAZADO_PUERTO = {
  id: 'puerto',
  nombre: 'Circuito Urbano Puerto Real',
  corto: 'Puerto Real',
  pais: 'Costa Caribe',
  tipo: 'urbano',
  ritmoIA: 58.8,
  ancho: 11,
  urbano: true,            // muros a pocos metros, sin grava ni hierba
  rectaAncha: [500, 260],
  segmentos: [
    { t: 'S', l: 540, nombre: 'Recta del Puerto' },
    { t: 'A', r: 22, a: 90, nombre: 'T1 Santa Bárbara' },
    { t: 'S', l: 230, nombre: 'Subida del Casino' },
    { t: 'A', r: 45, a: -50, nombre: 'T2 Plaza' },
    { t: 'A', r: 40, a: 50, nombre: 'T3 Casino' },
    { t: 'S', l: 100, ajusta: true },
    { t: 'A', r: 12, a: 135, nombre: 'T4 Horquilla del Hotel' },
    { t: 'S', l: 70 },
    { t: 'A', r: 16, a: -45, nombre: 'T5 Portier' },
    { t: 'S', l: 330, nombre: 'Túnel' },
    { t: 'A', r: 500, a: 16, nombre: 'Curva del Túnel' },
    { t: 'S', l: 120 },
    { t: 'A', r: 18, a: -50, nombre: 'T6 Chicane del Puerto' },
    { t: 'A', r: 18, a: 50, nombre: 'T7 Chicane' },
    { t: 'S', l: 240 },
    { t: 'A', r: 30, a: 74, nombre: 'T8 Tabaco' },
    { t: 'S', l: 260, nombre: 'Muelle' },
    { t: 'A', r: 14, a: -45, nombre: 'T9 Piscina' },
    { t: 'A', r: 14, a: 45, nombre: 'T10 Piscina' },
    { t: 'S', l: 120 },
    { t: 'A', r: 15, a: 0, cierra: true, nombre: 'T11 Rascasse' },
    { t: 'S', l: 240, ajusta: true, nombre: 'Recta del Puerto' },
  ],
  relieve: [[4, 1, 1.2], [2, 2, 0.4], [0.8, 4, 2.0]],
  drs: [{ ini: -200, fin: 500, det: -320 }],
};

// Rápido tipo Monza: rectas larguísimas, chicanes y curvas rápidas, poca carga
const TRAZADO_VELOZ = {
  id: 'veloz',
  nombre: 'Autódromo Veloz del Parque',
  corto: 'Autódromo Veloz',
  pais: 'Llanura del Norte',
  tipo: 'parque',
  ritmoIA: 64.6,
  ancho: 14,
  rectaAncha: [600, 320],
  segmentos: [
    { t: 'S', l: 700, nombre: 'Rettifilo' },
    { t: 'A', r: 20, a: 75, nombre: 'T1 Variante Prima' },
    { t: 'A', r: 20, a: -75, nombre: 'T2 Variante Prima' },
    { t: 'S', l: 200 },
    { t: 'A', r: 300, a: 45, nombre: 'T3 Curva Grande' },
    { t: 'S', l: 100, ajusta: true },
    { t: 'A', r: 24, a: -55, nombre: 'T4 Roggia' },
    { t: 'A', r: 24, a: 55, nombre: 'T5 Roggia' },
    { t: 'S', l: 120 },
    { t: 'A', r: 75, a: 55, nombre: 'T6 Lesmo 1' },
    { t: 'S', l: 80 },
    { t: 'A', r: 60, a: 80, nombre: 'T7 Lesmo 2' },
    { t: 'S', l: 900, nombre: 'Recta del Serraglio' },
    { t: 'A', r: 28, a: -45, nombre: 'T8 Ascari' },
    { t: 'A', r: 70, a: 80, nombre: 'T9 Ascari' },
    { t: 'A', r: 120, a: -15, nombre: 'T10 Ascari' },
    { t: 'S', l: 700, nombre: 'Recta de la Parabólica' },
    { t: 'A', r: 110, a: 0, cierra: true, nombre: 'T11 Parabolica' },
    { t: 'S', l: 360, ajusta: true, nombre: 'Rettifilo' },
  ],
  relieve: [[2.5, 1, 0.2], [1.2, 3, 1.1]],
  drs: [{ ini: -300, fin: 900, det: -460 }, { recta: 'Recta del Serraglio', ini: 120, fin: -60, det: -260 }],
};

export const CIRCUITOS = { valle: TRAZADO_VALLE, puerto: TRAZADO_PUERTO, veloz: TRAZADO_VELOZ };
export const circuitoDe = id => CIRCUITOS[id] || TRAZADO_VALLE;

function construirPolilinea(segs, paso) {
  const pts = [];
  let x = 0, z = 0, h = 0;
  pts.push({ x, z, h });
  for (const sg of segs) {
    if (sg.t === 'S') {
      const n = Math.max(1, Math.round(sg.l / paso));
      for (let i = 1; i <= n; i++) {
        const d = sg.l / n;
        x += Math.cos(h) * d; z += Math.sin(h) * d;
        pts.push({ x, z, h });
      }
    } else {
      const ang = sg.a * Math.PI / 180;
      const largo = Math.abs(ang) * sg.r;
      const n = Math.max(1, Math.round(largo / paso));
      const dh = ang / n, d = largo / n;
      for (let i = 1; i <= n; i++) {
        // avance por cuerda en el punto medio del arco elemental
        const hm = h + dh / 2;
        const cuerda = 2 * sg.r * Math.sin(Math.abs(dh) / 2);
        x += Math.cos(hm) * (Math.abs(ang) > 0 ? cuerda : d);
        z += Math.sin(hm) * (Math.abs(ang) > 0 ? cuerda : d);
        h += dh;
        pts.push({ x, z, h });
      }
    }
  }
  return { pts, x, z, h };
}

// Ajusta el ángulo de cierre y las dos rectas marcadas para que el trazado cierre.
function cerrarTrazado(def) {
  const segs = def.segmentos.map(s => ({ ...s }));
  const ic = segs.findIndex(s => s.cierra);
  const suma = segs.reduce((a, s, i) => a + (s.t === 'A' && i !== ic ? s.a : 0), 0);
  segs[ic].a = 360 - suma;
  const aj = segs.map((s, i) => s.ajusta ? i : -1).filter(i => i >= 0);
  // dirección de cada recta ajustable
  const dirDe = (idx) => {
    let h = 0;
    for (let i = 0; i < idx; i++) if (segs[i].t === 'A') h += segs[i].a * Math.PI / 180;
    return [Math.cos(h), Math.sin(h)];
  };
  for (let it = 0; it < 3; it++) {
    const r = construirPolilinea(segs, 1);
    const [ax, az] = dirDe(aj[0]); const [bx, bz] = dirDe(aj[1]);
    // resolver ax·u + bx·v = -x ; az·u + bz·v = -z
    const det = ax * bz - bx * az;
    const u = (-r.x * bz + bx * r.z) / det;
    const v = (-ax * r.z + az * r.x) / det;
    segs[aj[0]].l += u; segs[aj[1]].l += v;
  }
  return segs;
}

function suavizarCircular(arr, radio, veces = 1) {
  const n = arr.length;
  let a = arr.slice();
  for (let v = 0; v < veces; v++) {
    const b = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -radio; k <= radio; k++) s += a[(i + k + n) % n];
      b[i] = s / (2 * radio + 1);
    }
    a = b;
  }
  return a;
}

export class Circuito {
  constructor(def = TRAZADO_VALLE) {
    if (typeof def === 'string') def = circuitoDe(def);
    this.def = def;
    this.id = def.id;
    this.nombre = def.nombre;
    this.paso = 2;
    const segs = cerrarTrazado(def);
    this.segmentos = segs;
    const { pts } = construirPolilinea(segs, 1);
    pts.pop(); // el último coincide con el primero
    // remuestreo uniforme cada `paso` metros
    const acum = [0];
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1], b = pts[i % pts.length];
      acum.push(acum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.largo = acum[pts.length];
    const n = Math.round(this.largo / this.paso);
    this.n = n;
    this.paso = this.largo / n;
    const X = new Float64Array(n), Z = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = i * this.paso;
      while (acum[j + 1] < s) j++;
      const a = pts[j], b = pts[(j + 1) % pts.length];
      const t = (s - acum[j]) / (acum[j + 1] - acum[j] || 1);
      X[i] = a.x + (b.x - a.x) * t; Z[i] = a.z + (b.z - a.z) * t;
    }
    // suavizado ligero para que la curvatura sea continua (transiciones tipo clotoide)
    const xs = suavizarCircular(Array.from(X), 4, 3), zs = suavizarCircular(Array.from(Z), 4, 3);
    this.x = Float64Array.from(xs); this.z = Float64Array.from(zs);
    this._derivadas();
    this._relieve();
    this._superficies();
    this.trazada = this._trazadaIdeal();
    this.perfil = this._perfilVelocidad(this.trazada);
    // perfil en tráfico: con aire sucio se pierde carga y agarre (las curvas rápidas dejan de ir a fondo)
    this.perfilSucio = this._perfilVelocidad(this.trazada, { mu: 1.55 * 0.96, clA: 4.6 * 0.74 });
    // neumáticos fríos o gastados: 15 % menos de agarre (en las curvas rápidas pesa mucho más)
    this.perfilFrio = this._perfilVelocidad(this.trazada, { mu: 1.55 * 0.85 });
    this.perfilFrioSucio = this._perfilVelocidad(this.trazada, { mu: 1.55 * 0.85 * 0.96, clA: 4.6 * 0.74 });
    this._indexar();
    // nombres de curvas por posición
    this.curvas = [];
    let s = 0;
    for (const sg of segs) {
      const largo = sg.t === 'S' ? sg.l : Math.abs(sg.a) * Math.PI / 180 * sg.r;
      if (sg.t === 'A' && sg.nombre) this.curvas.push({ s: s + largo / 2, nombre: sg.nombre, r: sg.r });
      s += largo;
    }
    this.drs = [];
    for (const z of def.drs) {
      if (z.recta) {
        const rr = this._sDeSegmento(z.recta);
        if (rr) this.drs.push({ ini: rr.s0 + z.ini, fin: rr.s1 + z.fin, deteccion: this.envolver(rr.s0 + z.det) });
      } else this.drs.push({ ini: this.envolver(z.ini), fin: z.fin, deteccion: this.envolver(z.det) });
    }
    this.sectores = [this.largo / 3, 2 * this.largo / 3];
    this._calleBoxes();
    this._protecciones();
    this._superficieViva();
  }

  // Perfil con el agarre multiplicado por f (pista mojada). Se calcula al pedirlo y se guarda
  // cuantizado: con carga aerodinámica la velocidad en curva rápida cae mucho más que √f.
  perfilAgarre(f) {
    const q = Math.max(0.3, Math.min(1, Math.round(f * 20) / 20));
    if (q >= 1) return this.perfil;
    this._perfiles ??= new Map();
    if (!this._perfiles.has(q)) this._perfiles.set(q, this._perfilVelocidad(this.trazada, { mu: 1.55 * q }));
    return this._perfiles.get(q);
  }

  // Tiempo de vuelta teórico con un agarre relativo f (1 = seco)
  vueltaTeorica(f = 1) {
    const v = this.perfilAgarre(f);
    let t = 0;
    for (let i = 0; i < this.n; i++) t += this.trazada.ds[i] / v[i];
    return t;
  }

  _sDeSegmento(nombre) {
    let s = 0;
    for (const sg of this.segmentos) {
      const largo = sg.t === 'S' ? sg.l : Math.abs(sg.a) * Math.PI / 180 * sg.r;
      if (sg.nombre === nombre && s > 0) return { s0: s, s1: s + largo };
      s += largo;
    }
    return null;
  }

  envolver(s) { s %= this.largo; return s < 0 ? s + this.largo : s; }

  _derivadas() {
    const n = this.n, X = this.x, Z = this.z;
    this.tx = new Float64Array(n); this.tz = new Float64Array(n);
    this.curv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      let dx = X[b] - X[a], dz = Z[b] - Z[a];
      const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      this.tx[i] = dx; this.tz[i] = dz;
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      // dθ/ds; positivo = curva a la derecha (giro de t hacia la normal derecha)
      const cross = this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b];
      const dot = this.tx[a] * this.tx[b] + this.tz[a] * this.tz[b];
      this.curv[i] = Math.atan2(cross, dot) / (2 * this.paso);
    }
    this.curvSuave = Float64Array.from(suavizarCircular(Array.from(this.curv), 3, 2));
  }

  _relieve() {
    const n = this.n;
    this.y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / n * Math.PI * 2;
      let h = 0;
      for (const [amp, k, f] of this.def.relieve) h += amp * Math.sin(k * u + f);
      this.y[i] = h;
    }
    // la recta principal un poco más plana (zona de boxes)
    const plano = 220 / this.paso;
    const y0 = this.y[0];
    for (let k = -plano; k <= plano; k++) {
      const i = (k + n) % n;
      const w = 0.5 + 0.5 * Math.cos(Math.PI * k / plano);
      this.y[i] = this.y[i] * (1 - w * 0.7) + y0 * w * 0.7;
    }
    this.y = Float64Array.from(suavizarCircular(Array.from(this.y), 6, 3));
    this.pendiente = new Float64Array(n);
    this.curvVert = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      this.pendiente[i] = (this.y[b] - this.y[a]) / (2 * this.paso);
      this.curvVert[i] = (this.y[b] - 2 * this.y[i] + this.y[a]) / (this.paso * this.paso);
    }
  }

  // Bordillos, escapatorias, grava y muros (izquierda = -1, derecha = +1)
  _superficies() {
    const n = this.n, hw = this.def.ancho / 2;
    this.semiAncho = new Float64Array(n).fill(hw);
    // recta principal más ancha
    const [ra, rb] = this.def.rectaAncha || [560, 300];
    for (let i = 0; i < n; i++) {
      const s = i * this.paso;
      if (s < ra || s > this.largo - rb) this.semiAncho[i] = hw + 1.5;
    }
    this.semiAncho = Float64Array.from(suavizarCircular(Array.from(this.semiAncho), 10, 2));
    const k = this.curvSuave;
    const bordillo = new Uint8Array(n), gravaI = new Uint8Array(n), gravaD = new Uint8Array(n);
    const dil = (src, r) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (src[i]) for (let j = -r; j <= r; j++) out[(i + j + n) % n] = 1;
      return out;
    };
    const urbano = !!this.def.urbano;
    for (let i = 0; i < n; i++) {
      if (Math.abs(k[i]) > 1 / 260) bordillo[i] = 1;
      // grava en el exterior de curvas lentas y medias (en la ciudad no hay)
      if (urbano) continue;
      if (k[i] > 1 / 200) gravaI[i] = 1;   // curva a la derecha: exterior izquierdo
      if (k[i] < -1 / 200) gravaD[i] = 1;
    }
    this.bordillo = dil(bordillo, urbano ? 4 : 8);
    this.grava = [dil(gravaI, 30), dil(gravaD, 30)];
    // muros: distancia deseada limitada por la cercanía de otras partes del trazado
    // (en la ciudad, guardarraíles a 3 m del asfalto y un poco más en las frenadas)
    const deseado = urbano ? hw + 3.2 : 26;
    this.muro = [new Float64Array(n).fill(deseado), new Float64Array(n).fill(deseado)];
    const cell = 40, grid = new Map();
    const key = (cx, cz) => cx * 100003 + cz;
    for (let i = 0; i < n; i++) {
      const kk = key(Math.floor(this.x[i] / cell), Math.floor(this.z[i] / cell));
      if (!grid.has(kk)) grid.set(kk, []);
      grid.get(kk).push(i);
    }
    const ventana = Math.round(60 / this.paso);
    for (let i = 0; i < n; i++) {
      const nx = -this.tz[i], nz = this.tx[i];
      const cx = Math.floor(this.x[i] / cell), cz = Math.floor(this.z[i] / cell);
      for (let gx = cx - 2; gx <= cx + 2; gx++) for (let gz = cz - 2; gz <= cz + 2; gz++) {
        const lst = grid.get(key(gx, gz)); if (!lst) continue;
        for (const j of lst) {
          let ds = Math.abs(i - j); ds = Math.min(ds, n - ds);
          if (ds < ventana) continue;
          const dx = this.x[j] - this.x[i], dz = this.z[j] - this.z[i];
          const dist = Math.hypot(dx, dz);
          if (dist > 2 * deseado + 20) continue;
          const lado = (dx * nx + dz * nz) >= 0 ? 1 : 0; // 1 = derecha
          const lim = Math.max(this.semiAncho[i] + (urbano ? 2.2 : 4), dist / 2 - 3);
          if (lim < this.muro[lado][i]) this.muro[lado][i] = lim;
        }
      }
      if (urbano && this.muro[0][i] > hw + 3.2) { this.muro[0][i] = hw + 3.2; }
      if (urbano && this.muro[1][i] > hw + 3.2) { this.muro[1][i] = hw + 3.2; }
      // en el interior de curvas cerradas el muro no puede pasar del centro de giro
      const kk = k[i];
      if (Math.abs(kk) > 1e-4) {
        const lado = kk > 0 ? 1 : 0;
        const lim = Math.max(this.semiAncho[i] + (urbano ? 2 : 3), 0.75 / Math.abs(kk));
        if (lim < this.muro[lado][i]) this.muro[lado][i] = lim;
      }
    }
    for (const lado of [0, 1]) {
      // un muro no puede tener cambios bruscos
      let m = Array.from(this.muro[lado]);
      for (let v = 0; v < 2; v++) {
        const mm = m.slice();
        for (let i = 0; i < n; i++) {
          let mn = Infinity;
          for (let j = -12; j <= 12; j++) mn = Math.min(mn, m[(i + j + n) % n]);
          mm[i] = mn;
        }
        m = suavizarCircular(mm, 8, 2);
      }
      this.muro[lado] = Float64Array.from(m);
    }
  }

  // Trazada de mínima curvatura por relajación dentro de los límites de la pista
  _trazadaIdeal() {
    const n = this.n;
    const off = new Float64Array(n);
    const margen = 1.3;
    const px = new Float64Array(n), pz = new Float64Array(n);
    for (let it = 0; it < 1400; it++) {
      for (let i = 0; i < n; i++) {
        px[i] = this.x[i] - this.tz[i] * off[i];
        pz[i] = this.z[i] + this.tx[i] * off[i];
      }
      for (let i = 0; i < n; i++) {
        const a = (i - 3 + n) % n, b = (i + 3) % n;
        const mx = (px[a] + px[b]) / 2, mz = (pz[a] + pz[b]) / 2;
        // proyección del punto medio sobre la normal (derecha = (-tz, tx))
        const nx = -this.tz[i], nz = this.tx[i];
        const objetivo = (mx - this.x[i]) * nx + (mz - this.z[i]) * nz;
        const lim = this.semiAncho[i] - margen;
        off[i] += (objetivo - off[i]) * 0.5;
        if (off[i] > lim) off[i] = lim; else if (off[i] < -lim) off[i] = -lim;
      }
    }
    const offS = suavizarCircular(Array.from(off), 2, 2);
    const t = { off: Float64Array.from(offS), x: new Float64Array(n), z: new Float64Array(n), curv: new Float64Array(n), ds: new Float64Array(n) };
    for (let i = 0; i < n; i++) {
      t.x[i] = this.x[i] - this.tz[i] * t.off[i];
      t.z[i] = this.z[i] + this.tx[i] * t.off[i];
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n, b = (i + 2) % n;
      const ax = t.x[i] - t.x[a], az = t.z[i] - t.z[a];
      const bx = t.x[b] - t.x[i], bz = t.z[b] - t.z[i];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      const cross = ax * bz - az * bx, dot = ax * bx + az * bz;
      t.curv[i] = Math.atan2(cross, dot) / ((la + lb) / 2);
      const c = (i + 1) % n;
      t.ds[i] = Math.hypot(t.x[c] - t.x[i], t.z[c] - t.z[i]);
    }
    t.curv = Float64Array.from(suavizarCircular(Array.from(t.curv), 2, 2));
    return t;
  }

  // Velocidad máxima en cada punto de la trazada (modelo de masa puntual con carga aerodinámica)
  _perfilVelocidad(t, opc = {}) {
    const n = this.n;
    const m = COCHE.masaSeca + 40;
    const mu = opc.mu ?? 1.55;
    const clA = opc.clA ?? 4.6, cdA = opc.cdA ?? 1.07;
    const kA = 0.5 * RHO_AIRE * clA, kD = 0.5 * RHO_AIRE * cdA;
    const P = 640000 * 0.92;
    const vmax = 97;
    const v = new Float64Array(n);
    // el agarre efectivo baja con la carga (sensibilidad del neumático): a mucha velocidad
    // la carga aerodinámica no rinde el 100 %, así que se resuelve por bisección
    const muV = (vv) => {
      const fz = (m * G + kA * vv * vv) / 4;
      return mu * Math.max(0.62, Math.min(1.12, 1 - 0.085 * (fz / 3500 - 1))) / 0.97;
    };
    for (let i = 0; i < n; i++) {
      const k = Math.abs(t.curv[i]) + 1e-6;
      const cabe = (vv) => muV(vv) * (m * G + kA * vv * vv) >= m * vv * vv * k;
      if (cabe(vmax)) { v[i] = vmax; continue; }
      let lo = 5, hi = vmax;
      for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (cabe(mid)) lo = mid; else hi = mid; }
      v[i] = lo;
    }
    // dos pasadas de cada tipo por ser circular
    for (let pasada = 0; pasada < 2; pasada++) {
      for (let k = 0; k < n; k++) {         // aceleración
        const i = k, j = (k + 1) % n;
        const vi = v[i];
        const lat = vi * vi * Math.abs(t.curv[i]);
        const gripTot = mu * (m * G + kA * vi * vi);
        const longDisp = Math.sqrt(Math.max(0, gripTot * gripTot - (m * lat) ** 2)) * 0.6; // tracción solo atrás
        const fuerza = Math.min(P / Math.max(vi, 5), longDisp) - kD * vi * vi - COCHE.rodadura * m * G - m * G * this.pendiente[i];
        const vj = Math.sqrt(Math.max(0, vi * vi + 2 * fuerza / m * t.ds[i]));
        if (vj < v[j]) v[j] = vj;
      }
      for (let k = n - 1; k >= 0; k--) {    // frenada
        const i = (k + 1) % n, j = k;
        const vi = v[i];
        const lat = vi * vi * Math.abs(t.curv[i]);
        const gripTot = mu * 0.97 * (m * G + kA * vi * vi);
        const longDisp = Math.sqrt(Math.max(0, gripTot * gripTot - (m * lat) ** 2));
        const fuerza = longDisp + kD * vi * vi + m * G * this.pendiente[j];
        const vj = Math.sqrt(Math.max(0, vi * vi + 2 * fuerza / m * t.ds[j]));
        if (vj < v[j]) v[j] = vj;
      }
    }
    return v;
  }

  _indexar() {
    this._celda = 30;
    this._grid = new Map();
    for (let i = 0; i < this.n; i++) {
      const k = this._k(Math.floor(this.x[i] / this._celda), Math.floor(this.z[i] / this._celda));
      if (!this._grid.has(k)) this._grid.set(k, []);
      this._grid.get(k).push(i);
    }
  }
  _k(cx, cz) { return cx * 100003 + cz; }

  // Índice de muestra más cercano; `pista` acelera la búsqueda con el índice anterior
  masCercano(x, z, pista = -1) {
    const n = this.n;
    if (pista >= 0) {
      let best = pista, bd = Infinity;
      for (let k = -25; k <= 25; k++) {
        const i = (pista + k + n) % n;
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      if (bd < 60 * 60) return best;
    }
    const cx = Math.floor(x / this._celda), cz = Math.floor(z / this._celda);
    let best = 0, bd = Infinity;
    for (let r = 1; r <= 8 && bd === Infinity; r++) {
      for (let gx = cx - r; gx <= cx + r; gx++) for (let gz = cz - r; gz <= cz + r; gz++) {
        const lst = this._grid.get(this._k(gx, gz)); if (!lst) continue;
        for (const i of lst) {
          const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    if (bd === Infinity) for (let i = 0; i < n; i++) {
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Proyección de (x,z) en coordenadas de pista: s (distancia), d (desplazamiento lateral, + derecha)
  proyectar(x, z, pista = -1, out = {}) {
    const n = this.n;
    let i = this.masCercano(x, z, pista);
    let dx = x - this.x[i], dz = z - this.z[i];
    let a = dx * this.tx[i] + dz * this.tz[i];
    // refina con el segmento vecino
    if (a < 0) { i = (i - 1 + n) % n; dx = x - this.x[i]; dz = z - this.z[i]; a = dx * this.tx[i] + dz * this.tz[i]; }
    const j = (i + 1) % n;
    const t = Math.max(0, Math.min(1, a / this.paso));
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t, tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const l = Math.hypot(tx, tz);
    out.i = i; out.t = t;
    out.s = (i + t) * this.paso;
    out.d = (dx * -tz + dz * tx) / l;
    out.tx = tx / l; out.tz = tz / l;
    out.y = this.y[i] + (this.y[j] - this.y[i]) * t;
    out.pendiente = this.pendiente[i];
    out.curvVert = this.curvVert[i] + (this.curvVert[j] - this.curvVert[i]) * t;
    return out;
  }

  // Muestreo interpolado por s
  muestra(s, out = {}) {
    s = this.envolver(s);
    const f = s / this.paso, i = Math.floor(f) % this.n, j = (i + 1) % this.n, t = f - Math.floor(f);
    out.x = this.x[i] + (this.x[j] - this.x[i]) * t;
    out.z = this.z[i] + (this.z[j] - this.z[i]) * t;
    out.y = this.y[i] + (this.y[j] - this.y[i]) * t;
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t, tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const l = Math.hypot(tx, tz);
    out.tx = tx / l; out.tz = tz / l;
    out.i = i;
    return out;
  }

  // Altura del suelo y tipo de superficie a un desplazamiento lateral d del centro
  superficie(i, d) {
    const hw = this.semiAncho[i];
    const ad = Math.abs(d), lado = d >= 0 ? 1 : 0;
    if (ad <= hw) return SUP_ASFALTO;
    if (lado === 1 && this.enZonaPit[i] && d <= hw + this.pit.ancho + 1) return SUP_ASFALTO;
    if (this.bordillo[i] && ad <= hw + 1.3) return SUP_BORDILLO;
    if (ad <= hw + 2.5) return SUP_ESCAPE;
    return this.grava[lado][i] ? SUP_GRAVA : SUP_HIERBA;
  }

  // caída del terreno fuera del asfalto (perfil de arcén)
  caida(i, d) {
    if (d > 0 && this.enZonaPit?.[i]) return 0;
    const ad = Math.abs(d) - this.semiAncho[i] - 3;
    if (ad <= 0) return 0;
    return -Math.min(0.35, ad * 0.03);
  }
}

// Calle de boxes paralela a la recta principal, a la derecha (lado del interior del circuito)
Circuito.prototype._calleBoxes = function () {
  const L = this.largo;
  const pit = this.pit = {
    entrada: this.envolver(-150),     // se abandona la pista
    limiteIni: this.envolver(-55),    // línea del limitador
    limiteFin: 330,
    salida: 430,                      // se vuelve a la pista
    ancho: 16,                        // desde el borde de la pista hasta los garajes
    carril: 9.5,                      // centro del carril (desde el borde)
    muroDe: 3.0, muroA: 3.9,          // muro de boxes entre la pista y el carril
    garajes: [],
    limite: 80 / 3.6,
  };
  pit.largo = this.envolver(pit.salida - pit.entrada);
  this.enZonaPit = new Uint8Array(this.n);
  for (let i = 0; i < this.n; i++) {
    const u = this.envolver(i * this.paso - pit.entrada);
    if (u <= pit.largo) {
      this.enZonaPit[i] = 1;
      this.muro[1][i] = this.semiAncho[i] + pit.ancho + 0.6;
    }
  }
  // 11 garajes, uno por equipo, entre las dos líneas del limitador
  const ini = this.envolver(pit.limiteIni + 45), tramo = this.envolver(pit.limiteFin - 30 - ini);
  for (let k = 0; k < 11; k++) pit.garajes.push(this.envolver(ini + tramo * (k + 0.5) / 11));
};

// Distancia recorrida dentro de la zona de boxes (o -1 si s está fuera)
Circuito.prototype.uPit = function (s) {
  const u = this.envolver(s - this.pit.entrada);
  return u <= this.pit.largo ? u : -1;
};

// Desplazamiento lateral del centro del carril de boxes en s (entra y sale en rampa)
Circuito.prototype.dCarrilPit = function (s) {
  const p = this.pit, i = Math.floor(this.envolver(s) / this.paso) % this.n;
  const hw = this.semiAncho[i];
  const u = this.uPit(s);
  if (u < 0) return hw - 2;
  const uLimI = this.envolver(p.limiteIni - p.entrada), uLimF = this.envolver(p.limiteFin - p.entrada);
  const suave = (t) => t * t * (3 - 2 * t);
  let t = 1;
  if (u < uLimI) t = suave(Math.min(1, u / uLimI));
  else if (u > uLimF) t = 1 - suave(Math.min(1, (u - uLimF) / (p.largo - uLimF)));
  return hw - 2 + (p.carril + 2) * t;
};

// ¿Está el punto dentro del carril de boxes con limitador?
Circuito.prototype.enLimitador = function (s, d) {
  const p = this.pit;
  const u = this.uPit(s);
  if (u < 0) return false;
  const i = Math.floor(this.envolver(s) / this.paso) % this.n;
  return u >= this.envolver(p.limiteIni - p.entrada) && u <= this.envolver(p.limiteFin - p.entrada) && d > this.semiAncho[i] + p.muroA - 0.5;
};

// ¿Hay muro de boxes en esta muestra? (entre las líneas del limitador)
Circuito.prototype.hayMuroPit = function (i) {
  const u = this.uPit(i * this.paso), p = this.pit;
  return u >= 0 && u >= this.envolver(p.limiteIni - p.entrada) + 35 && u <= this.envolver(p.limiteFin - p.entrada) - 25;
};

// Protecciones: tipo de barrera de cada muro (0 hormigón, 1 neumáticos, 2 TecPro),
// bordillos altos (salchichas) tras los pianos de las chicanes y bidones de agua
export const BARRERA_HORMIGON = 0, BARRERA_NEUMATICOS = 1, BARRERA_TECPRO = 2;
// cuánto del golpe llega al coche y cuánto rebota
export const BARRERAS = [
  { nombre: 'hormigón', dano: 1.0, rebote: 0.25 },
  { nombre: 'neumáticos', dano: 0.6, rebote: 0.12 },
  { nombre: 'TecPro', dano: 0.5, rebote: 0.08 },
];
Circuito.prototype._protecciones = function () {
  const n = this.n, k = this.curvSuave, urbano = !!this.def.urbano;
  this.barrera = [new Uint8Array(n), new Uint8Array(n)];
  this.salchicha = [new Uint8Array(n), new Uint8Array(n)];
  for (const lado of [0, 1]) {
    for (let i = 0; i < n; i++) {
      if (lado === 1 && this.enZonaPit[i]) continue;
      // exterior de la curva: donde se llega de frente
      const exterior = lado === 1 ? k[i] < -1 / 140 : k[i] > 1 / 140;
      if (this.grava[lado][i]) this.barrera[lado][i] = BARRERA_NEUMATICOS;
      else if (exterior && (urbano || Math.abs(k[i]) > 1 / 60)) this.barrera[lado][i] = BARRERA_TECPRO;
    }
    // ampliar un poco las zonas para que no queden huecos de un metro
    const b = this.barrera[lado].slice();
    for (let i = 0; i < n; i++) if (b[i]) for (let j = -6; j <= 6; j++) { const q = (i + j + n) % n; if (!this.barrera[lado][q] && !(lado === 1 && this.enZonaPit[q])) this.barrera[lado][q] = b[i]; }
  }
  // salchichas en el interior de las curvas lentas de las chicanes (no en la ciudad)
  if (!urbano) for (const cv of this.curvas) {
    if (cv.r > 30) continue;
    const i0 = Math.floor(this.envolver(cv.s) / this.paso) % n;
    const lado = k[i0] > 0 ? 1 : 0;           // interior
    for (let j = -6; j <= 6; j++) this.salchicha[lado][(i0 + j + n) % n] = 1;
  }
  // bidones de agua: en la punta de la entrada a boxes y en las escapatorias de las chicanes
  this.bidones = [];
  const pe = this.pit.entrada, iPe = Math.floor(pe / this.paso) % n;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - (r > 1 ? 1 : 0); c++) this.bidones.push({ s: this.envolver(pe + 26 + r * 1.1), d: this.semiAncho[iPe] + 2.2 + c * 1.0 });
  for (const cv of this.curvas) {
    if (cv.r > 25) continue;
    const i0 = Math.floor(this.envolver(cv.s) / this.paso) % n;
    const lado = k[i0] > 0 ? 0 : 1;                // exterior
    const sg = lado ? 1 : -1;
    if (this.muro[lado][i0] - this.semiAncho[i0] < 5) continue;
    for (let c = 0; c < 3; c++) this.bidones.push({ s: this.envolver(cv.s + 25), d: sg * (this.muro[lado][(i0 + 12) % n] - 0.9 - c * 1.0) });
  }
};

// Bordillo alto en el punto (i, d)?
Circuito.prototype.enSalchicha = function (i, d) {
  const lado = d >= 0 ? 1 : 0, ad = Math.abs(d), hw = this.semiAncho[i];
  return this.salchicha[lado][i] && ad > hw + 1.35 && ad < hw + 2.1;
};

// Canicas (bolitas de goma) fuera de la trazada en las curvas, y charcos en los puntos
// bajos de la pista que aparecen con lluvia fuerte.
Circuito.prototype._superficieViva = function () {
  const n = this.n, k = this.curvSuave;
  this.canicas = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (Math.abs(k[i]) > 0.006 && !this.enZonaPit[i]) this.canicas[i] = 1;
  // charcos: puntos bajos locales (o cada ~700 m si la pista es llana), deterministas
  let sem = 97 + n;
  const rnd = () => ((sem = (sem * 16807) % 2147483647) / 2147483647);
  this.charcos = [];
  this.charcoEn = new Int16Array(n).fill(-1);
  const vent = Math.round(120 / this.paso);
  const cand = [];
  for (let i = 0; i < n; i += Math.max(1, Math.round(10 / this.paso))) {
    if (this.enZonaPit[i] || i < vent) continue;
    let bajo = 0;
    for (let j = -vent; j <= vent; j += 4) bajo += this.y[(i + j + n) % n] - this.y[i];
    cand.push({ i, bajo: bajo + rnd() * 2 });
  }
  cand.sort((a, b) => b.bajo - a.bajo);
  const cuantos = Math.max(4, Math.round(this.largo / 700));
  for (const c of cand) {
    if (this.charcos.length >= cuantos) break;
    if (this.charcos.some(o => Math.abs(this.envolver(o.s - c.i * this.paso + this.largo / 2) - this.largo / 2) < 250)) continue;
    const hw = this.semiAncho[c.i];
    const largo = 6 + rnd() * 8, ancho = 2 + rnd() * 2.5;
    const d = (rnd() * 2 - 1) * (hw - ancho * 0.5);
    const id = this.charcos.length;
    this.charcos.push({ s: c.i * this.paso, i: c.i, d, largo, ancho, prof: 0.6 + rnd() * 0.4 });
    const m = Math.ceil(largo / 2 / this.paso);
    for (let j = -m; j <= m; j++) this.charcoEn[(c.i + j + n) % n] = id;
  }
};

// Profundidad relativa del charco en (i, d) con la pista a nivel de agua 'agua' (0 = seco)
Circuito.prototype.charco = function (i, d, agua) {
  if (agua < 0.35) return 0;
  const id = this.charcoEn[i];
  if (id < 0) return 0;
  const ch = this.charcos[id];
  const ds = Math.abs(this.envolver(i * this.paso - ch.s + this.largo / 2) - this.largo / 2) / (ch.largo / 2);
  const dd = Math.abs(d - ch.d) / (ch.ancho / 2);
  const r = ds * ds + dd * dd;
  return r < 1 ? ch.prof * (1 - r) * Math.min(1, (agua - 0.35) / 0.25) : 0;
};

// ¿Rueda sobre las canicas? (asfalto en curva, a más de 3.5 m de la trazada)
Circuito.prototype.enCanicas = function (i, d) {
  return this.canicas[i] && Math.abs(d) < this.semiAncho[i] && Math.abs(d - this.trazada.off[i]) > 3.5;
};

export const SUP_ASFALTO = 0, SUP_BORDILLO = 1, SUP_ESCAPE = 2, SUP_HIERBA = 3, SUP_GRAVA = 4;
// agarre relativo, resistencia a la rodadura (fracción de Fz), rugosidad visual/vibración
export const SUPERFICIES = [
  { nombre: 'asfalto', mu: 1.0, rod: 0.0, vib: 0 },
  { nombre: 'bordillo', mu: 0.93, rod: 0.004, vib: 1 },
  { nombre: 'escapatoria', mu: 0.88, rod: 0.002, vib: 0.1 },
  { nombre: 'hierba', mu: 0.52, rod: 0.05, vib: 0.5 },
  { nombre: 'grava', mu: 0.45, rod: 0.32, vib: 0.8 },
];

export { TRAZADO_VALLE, TRAZADO_PUERTO, TRAZADO_VELOZ };
