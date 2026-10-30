// Vida en el circuito: puestos de comisarios que agitan banderas (amarilla en la zona
// de un incidente, verde al pasarlo, azul a quien van a doblar).

import * as THREE from 'three';

export class Comisarios {
  constructor(scene, c, calidad) {
    this.c = c;
    this.puestos = [];
    const paso = calidad >= 2 ? 220 : 320;
    const matTraje = new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.8 });
    const matCasco = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const matAsta = new THREE.MeshStandardMaterial({ color: 0x222222 });
    this.mats = { amarilla: new THREE.MeshStandardMaterial({ color: 0xffd21f, side: THREE.DoubleSide, roughness: 0.7 }),
      verde: new THREE.MeshStandardMaterial({ color: 0x18c45a, side: THREE.DoubleSide, roughness: 0.7 }),
      azul: new THREE.MeshStandardMaterial({ color: 0x1f6fff, side: THREE.DoubleSide, roughness: 0.7 }) };
    const geoCuerpo = new THREE.CapsuleGeometry(0.2, 0.9, 4, 8); geoCuerpo.translate(0, 0.65, 0);
    const geoCabeza = new THREE.SphereGeometry(0.14, 10, 8); geoCabeza.translate(0, 1.42, 0);
    const geoBandera = new THREE.PlaneGeometry(0.9, 0.6, 6, 1); geoBandera.translate(0.45, 0, 0);
    for (let s = 120; s < c.largo - 60; s += paso) {
      const m = c.muestra(s), i = m.i;
      const lado = c.curvSuave[i] > 0 ? 0 : 1;          // exterior de la curva (o cualquiera en recta)
      if (lado === 1 && c.enZonaPit[i]) continue;
      const sg = lado ? 1 : -1, d = sg * (c.muro[lado][i] + 1.6);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geoCuerpo, matTraje), new THREE.Mesh(geoCabeza, matCasco));
      const brazo = new THREE.Group(); brazo.position.set(0, 1.25, 0);
      const asta = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 5), matAsta); asta.position.y = 0.7; brazo.add(asta);
      const bandera = new THREE.Mesh(geoBandera.clone(), this.mats.amarilla); bandera.position.y = 1.15; bandera.visible = false; brazo.add(bandera);
      g.add(brazo);
      g.position.set(m.x - m.tz * d, m.y + c.caida(i, d) + 0.6, m.z + m.tx * d);
      g.rotation.y = -Math.atan2(m.tz, m.tx) + (lado ? -Math.PI / 2 : Math.PI / 2);
      g.traverse(o => { if (o.isMesh) o.castShadow = calidad >= 2; });
      scene.add(g);
      this.puestos.push({ s, g, brazo, bandera, fase: Math.random() * 6, verdeHasta: 0 });
    }
    this.t = 0;
  }

  /** sesion: amarillas y VSC; jugador: para la azul. */
  actualizar(dt, sesion) {
    this.t += dt;
    const L = this.c.largo;
    for (const p of this.puestos) {
      let tipo = null;
      if (sesion?.vsc) tipo = 'amarilla';
      else if (sesion?.amarillas?.length) {
        for (const a of sesion.amarillas) {
          const ds = this.c.envolver(a.s - p.s);
          if (ds < 260) { tipo = 'amarilla'; break; }               // incidente más adelante
          if (ds > L - 120) { p.verdeHasta = this.t + 6; }           // justo pasado el incidente
        }
      }
      if (!tipo && p.verdeHasta > this.t) tipo = 'verde';
      p.bandera.visible = !!tipo;
      if (tipo) {
        p.bandera.material = this.mats[tipo];
        // agitar: el brazo va de lado a lado y la tela ondea
        p.brazo.rotation.z = Math.sin(this.t * 7 + p.fase) * 0.8;
        const pos = p.bandera.geometry.attributes.position;
        for (let k = 0; k < pos.count; k++) { const x = pos.getX(k); pos.setZ(k, Math.sin(this.t * 14 + x * 6 + p.fase) * 0.08 * x); }
        pos.needsUpdate = true;
      } else p.brazo.rotation.z = 0.2;
    }
  }
}

// Capa sobre la imagen: gotas en la visera/lente, destello del sol y viñeta de velocidad.
// Rendimiento: las gotas se pintan desde un sprite hecho una vez (antes se creaba un degradado
// por gota y por cuadro) y la viñeta es un elemento CSS al que solo se le cambia la opacidad.
function spriteGota() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  // gota con borde oscuro (refracción), brillo arriba a la izquierda y centro claro
  let gr = x.createRadialGradient(32, 32, 10, 32, 32, 31);
  gr.addColorStop(0, 'rgba(225,235,245,0.38)'); gr.addColorStop(0.7, 'rgba(140,160,180,0.45)'); gr.addColorStop(0.93, 'rgba(20,28,36,0.7)'); gr.addColorStop(1, 'rgba(20,28,36,0)');
  x.fillStyle = gr; x.beginPath(); x.arc(32, 32, 31, 0, Math.PI * 2); x.fill();
  gr = x.createRadialGradient(23, 21, 0, 23, 21, 11);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.beginPath(); x.arc(23, 21, 11, 0, Math.PI * 2); x.fill();
  return cv;
}

export class CapaCamara {
  constructor(lienzo) {
    this.cv = lienzo; this.x = lienzo.getContext('2d');
    this.gotas = [];          // gotas grandes que se mueven
    this.micro = [];          // microgotas que quedan pegadas a la visera
    this.activa = false; this._sucio = false;
    this.sprite = spriteGota();
    // viñeta de velocidad: un div con degradado fijo, solo cambia su opacidad
    this.vineta = document.createElement('div');
    Object.assign(this.vineta.style, { position: 'fixed', inset: '0', pointerEvents: 'none', opacity: '0', zIndex: getComputedStyle(lienzo).zIndex || '1',
      background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,1) 100%)' });
    lienzo.parentNode?.insertBefore(this.vineta, lienzo.nextSibling);
  }
  /**
   * lluvia 0..1; aBordo: cámara de cabina/cara/T-cam; casco: visera del piloto (el viento sube
   * las gotas); velocidad en m/s; spray 0..1 detrás de otro coche (más agua).
   */
  actualizar(dt, { lluvia = 0, aBordo = false, casco = false, velocidad = 0, spray = 0, solPantalla = null, hora = 'dia' }) {
    const cv = this.cv, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; this._sucio = true; }
    const x = this.x;
    if (this._sucio) { x.clearRect(0, 0, w, h); this._sucio = false; }
    let algo = false;
    const v = velocidad;
    if (aBordo && lluvia > 0.05) {
      algo = true;
      const agua = lluvia * (1 + spray * 2.5);
      const esc = Math.min(w, h) / 400;
      if (this.gotas.length < 90 && Math.random() < agua * dt * 80) this.gotas.push({ x: Math.random() * w, y: Math.random() * h * (casco ? 1 : 0.8), r: (5 + Math.random() * 11) * esc, vida: 0.8 + Math.random() * 2.2, pegada: Math.random() * 0.4 });
      const cx = w / 2, cy = h * 0.55;
      for (const g of this.gotas) {
        g.vida -= dt;
        // pegada: las gotas tardan un instante en empezar a moverse
        if ((g.pegada -= dt) > 0) continue;
        if (casco && v > 12) {
          // en la visera el aire empuja hacia arriba y hacia los lados; más rápido, más estela
          g.vx = (g.x - cx) * 0.9 * (v / 60); g.vy = -(40 + v * 4.5) * (g.r / (8 * esc));
        } else {
          g.vx = (g.x - cx) * dt * v * 0.2; g.vy = (25 + v * 2.5) * (g.r / (8 * esc));
        }
        const ox = g.x, oy = g.y;
        g.x += g.vx * dt; g.y += g.vy * dt;
        // al moverse deja microgotas detrás
        if (Math.random() < dt * 14 && this.micro.length < 160) this.micro.push({ x: ox, y: oy, r: g.r * (0.18 + Math.random() * 0.2), vida: 1.5 + Math.random() * 3 });
      }
      this.gotas = this.gotas.filter(g => g.vida > 0 && g.x > -40 && g.x < w + 40 && g.y > -60 && g.y < h + 60);
      // a mucha velocidad el aire limpia antes las microgotas
      const limpia = 1 + Math.max(0, v - 30) * 0.05;
      for (const m of this.micro) m.vida -= dt * limpia;
      this.micro = this.micro.filter(m => m.vida > 0);
      x.clearRect(0, 0, w, h);
      const sp = this.sprite;
      for (const m of this.micro) { x.globalAlpha = Math.min(1, m.vida) * 0.9; x.drawImage(sp, m.x - m.r, m.y - m.r, m.r * 2, m.r * 2); }
      for (const g of this.gotas) {
        // estela: la gota se estira en la dirección en la que corre
        const vel = Math.hypot(g.vx || 0, g.vy || 0), est = Math.min(3.5, 1 + vel / 260);
        x.globalAlpha = Math.min(1, g.vida * 1.5);
        x.drawImage(sp, g.x - g.r * 0.85, g.y - g.r * est * (g.vy < 0 ? 0.2 : 0.8), g.r * 1.7, g.r * 2 * est);
      }
      x.globalAlpha = 1;
      this._sucio = true;
    } else if (this.gotas.length || this.micro.length) { this.gotas.length = 0; this.micro.length = 0; x.clearRect(0, 0, w, h); }
    // destello del sol cuando se mira hacia él
    if (solPantalla && hora !== 'noche' && lluvia < 0.3) {
      const [sx, sy] = solPantalla;
      if (sx > -0.2 * w && sx < 1.2 * w && sy > -0.2 * h && sy < 1.2 * h) {
        algo = true;
        if (!(aBordo && lluvia > 0.05)) x.clearRect(0, 0, w, h);
        const cx = w / 2, cy = h / 2;
        const fuerza = Math.max(0, 1 - Math.hypot(sx - cx, sy - cy) / (w * 0.8));
        x.globalCompositeOperation = 'lighter';
        const halo = x.createRadialGradient(sx, sy, 0, sx, sy, w * 0.25);
        halo.addColorStop(0, `rgba(255,240,210,${0.35 * fuerza})`); halo.addColorStop(1, 'rgba(255,240,210,0)');
        x.fillStyle = halo; x.fillRect(0, 0, w, h);
        for (const [t, r, col] of [[0.35, 28, '255,200,120'], [0.6, 16, '140,200,255'], [0.85, 42, '255,140,90'], [1.3, 22, '180,255,200']]) {
          const px = sx + (cx - sx) * t * 2, py = sy + (cy - sy) * t * 2;
          const gr = x.createRadialGradient(px, py, 0, px, py, r);
          gr.addColorStop(0, `rgba(${col},${0.22 * fuerza})`); gr.addColorStop(1, `rgba(${col},0)`);
          x.fillStyle = gr; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
        }
        x.globalCompositeOperation = 'source-over';
        this._sucio = true;
      }
    }
    // viñeta de velocidad (CSS): los bordes se oscurecen por encima de ~215 km/h
    const k = v > 60 ? Math.min(1, (v - 60) / 35) * 0.35 : 0;
    if (Math.abs(k - (this._vin || 0)) > 0.01) { this._vin = k; this.vineta.style.opacity = k.toFixed(3); }
    this.activa = algo || k > 0;
  }
}

// Coche de seguridad: deportivo plateado con barra de luces (naranja con SC en pista,
// verde cuando entra a boxes al final de la vuelta).
export class CocheSeguridad {
  constructor(scene) {
    const g = this.raiz = new THREE.Group();
    // perfil lateral extruido a lo ancho (x = largo, y = alto)
    const perfil = new THREE.Shape();
    perfil.moveTo(-2.3, 0.18); perfil.lineTo(2.25, 0.18); perfil.quadraticCurveTo(2.45, 0.3, 2.35, 0.55);
    perfil.lineTo(1.0, 0.72); perfil.quadraticCurveTo(0.2, 1.22, -0.8, 1.18); perfil.quadraticCurveTo(-1.9, 1.0, -2.3, 0.75);
    perfil.lineTo(-2.3, 0.18);
    const cuerpo = new THREE.ExtrudeGeometry(perfil, { depth: 1.9, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
    cuerpo.translate(0, 0, -0.95);
    const matCarro = new THREE.MeshPhysicalMaterial({ color: 0xb8bec6, metalness: 0.8, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
    g.add(new THREE.Mesh(cuerpo, matCarro));
    // lunas oscuras
    const vidrio = new THREE.MeshStandardMaterial({ color: 0x0b0e14, metalness: 0.6, roughness: 0.1 });
    const parabrisas = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.6), vidrio);
    parabrisas.position.set(0.62, 0.93, 0); parabrisas.rotation.set(0, Math.PI / 2, 0); parabrisas.rotateX(-0.95);
    g.add(parabrisas);
    // franjas rojas y verdes laterales
    for (const [col, y] of [[0xd9161c, 0.42], [0x18c45a, 0.52]]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.07, 2.08), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }));
      f.position.set(0, y, 0); g.add(f);
    }
    // ruedas
    const geoR = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 18); geoR.rotateX(Math.PI / 2);
    const matR = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
    this.ruedas = [];
    for (const [x, z] of [[1.45, 0.9], [1.45, -0.9], [-1.45, 0.9], [-1.45, -0.9]]) {
      const r = new THREE.Mesh(geoR, matR); r.position.set(x, 0.34, z); g.add(r); this.ruedas.push(r);
    }
    // barra de luces
    const barra = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 1.2), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    barra.position.set(-0.5, 1.24, 0); g.add(barra);
    this.luces = [];
    for (const z of [-0.42, 0.42]) {
      const m = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xff8a00, emissiveIntensity: 0 });
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.32), m);
      l.position.set(-0.5, 1.3, z); g.add(l); this.luces.push(m);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.visible = false;
    scene.add(g);
    this.t = 0;
  }
  actualizar(dt, sc) {
    this.raiz.visible = !!sc;
    if (!sc) return;
    this.t += dt;
    this.raiz.position.set(sc.x, sc.y, sc.z);
    this.raiz.rotation.set(0, -sc.psi, 0);
    for (const r of this.ruedas) r.rotation.z -= sc.v * dt / 0.34;
    const col = sc.entra ? 0x18ff6a : 0xff8a00;
    this.luces.forEach((m, k) => { m.emissive.setHex(col); m.emissiveIntensity = Math.sin(this.t * 12 + k * Math.PI) > 0 ? 4 : 0.2; });
  }
}

// Fuegos artificiales para celebrar una victoria o un podio: cohetes que suben y estallan
// en esferas de chispas de colores que caen apagándose.
export class Fuegos {
  constructor(scene, calidad = 2) {
    this.scene = scene;
    this.max = calidad >= 2 ? 2400 : 1000;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 3); this.col = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3); this.vida = new Float32Array(this.max);
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -9999;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.puntos = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.puntos.frustumCulled = false;
    scene.add(this.puntos);
    this.libre = 0; this.t = 0; this.activo = 0; this.cohetes = [];
  }

  /** Lanza fuegos durante `seg` segundos alrededor de `centro` (Vector3). */
  lanzar(centro, seg = 10, alEstallar = null) { this.centro = centro.clone(); this.activo = seg; this.alEstallar = alEstallar; }

  _estallar(x, y, z) {
    const cols = [[1, 0.25, 0.2], [1, 0.85, 0.3], [0.3, 0.8, 1], [0.4, 1, 0.5], [1, 0.4, 1], [1, 1, 1]];
    const c = cols[Math.floor(Math.random() * cols.length)], n = 160 + Math.floor(Math.random() * 120), fuerza = 14 + Math.random() * 10;
    for (let k = 0; k < n; k++) {
      const i = this.libre; this.libre = (this.libre + 1) % this.max;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), v = fuerza * (0.85 + Math.random() * 0.3);
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.sin(ph) * Math.cos(th) * v, Math.cos(ph) * v, Math.sin(ph) * Math.sin(th) * v], i * 3);
      this.col.set(c, i * 3); this.vida[i] = 1.6 + Math.random() * 0.8;
    }
    this.alEstallar?.(new THREE.Vector3(x, y, z));
  }

  actualizar(dt) {
    this.t += dt;
    if (this.activo > 0) {
      this.activo -= dt;
      if (Math.random() < dt * 2.2) {
        const c = this.centro;
        this.cohetes.push({ x: c.x + (Math.random() - 0.5) * 120, y: c.y + 5, z: c.z + (Math.random() - 0.5) * 120, vy: 38 + Math.random() * 12, t: 1.1 + Math.random() * 0.5 });
      }
    }
    // cohetes subiendo (dejan una estela) y estallido al final
    this.cohetes = this.cohetes.filter(r => {
      r.y += r.vy * dt; r.vy -= 9.8 * dt; r.t -= dt;
      const i = this.libre; this.libre = (this.libre + 1) % this.max;
      this.pos.set([r.x, r.y, r.z], i * 3); this.vel.set([0, -2, 0], i * 3); this.col.set([1, 0.7, 0.4], i * 3); this.vida[i] = 0.4;
      if (r.t <= 0) { this._estallar(r.x, r.y, r.z); return false; }
      return true;
    });
    let vivas = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.vida[i] <= 0) continue;
      vivas++;
      this.vida[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= 6 * dt; this.vel[o] *= 1 - dt * 1.2; this.vel[o + 1] *= 1 - dt * 1.2; this.vel[o + 2] *= 1 - dt * 1.2;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      const f = Math.max(0, Math.min(1, this.vida[i]));
      this.col[o] *= 0.985 + f * 0.015; this.col[o + 1] *= 0.98 + f * 0.02; this.col[o + 2] *= 0.98 + f * 0.02;
      if (this.vida[i] <= 0) { this.pos[o + 1] = -9999; }
    }
    this.puntos.visible = vivas > 0 || this.cohetes.length > 0;
    this.puntos.geometry.attributes.position.needsUpdate = true;
    this.puntos.geometry.attributes.color.needsUpdate = true;
  }
}
