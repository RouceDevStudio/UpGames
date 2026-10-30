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

// Capa sobre la imagen: gotas en la cámara a bordo y destello del sol
export class CapaCamara {
  constructor(lienzo) {
    this.cv = lienzo; this.x = lienzo.getContext('2d');
    this.gotas = [];
    this.activa = false;
  }
  actualizar(dt, { lluvia = 0, aBordo = false, velocidad = 0, solPantalla = null, hora = 'dia' }) {
    const cv = this.cv, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const x = this.x;
    x.clearRect(0, 0, w, h);
    let algo = false;
    // gotas que caen sobre la lente y resbalan con la velocidad
    if (aBordo && lluvia > 0.05) {
      algo = true;
      if (this.gotas.length < 70 && Math.random() < lluvia * dt * 45) this.gotas.push({ x: Math.random() * w, y: Math.random() * h * 0.8, r: 3 + Math.random() * 9, vida: 1 + Math.random() * 2 });
      this.gotas = this.gotas.filter(g => (g.vida -= dt) > 0);
      for (const g of this.gotas) {
        g.y += (20 + velocidad * 2.5) * dt * (g.r / 8);
        g.x += (g.x - w / 2) * dt * velocidad * 0.004;
        const a = Math.min(1, g.vida) * 0.55;
        const gr = x.createRadialGradient(g.x - g.r * 0.3, g.y - g.r * 0.3, 0, g.x, g.y, g.r);
        gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.6, `rgba(180,200,220,${a * 0.35})`); gr.addColorStop(1, 'rgba(120,140,160,0)');
        x.fillStyle = gr; x.beginPath(); x.ellipse(g.x, g.y, g.r * 0.8, g.r, 0, 0, Math.PI * 2); x.fill();
      }
    } else this.gotas.length = 0;
    // destello del sol cuando se mira hacia él
    if (solPantalla && hora !== 'noche' && lluvia < 0.3) {
      const [sx, sy] = solPantalla;
      if (sx > -0.2 * w && sx < 1.2 * w && sy > -0.2 * h && sy < 1.2 * h) {
        algo = true;
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
      }
    }
    // viñeta de velocidad: los bordes se oscurecen y estiran por encima de 250 km/h
    if (velocidad > 60) {
      algo = true;
      const k = Math.min(1, (velocidad - 60) / 35) * 0.35;
      const gr = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${k})`);
      x.fillStyle = gr; x.fillRect(0, 0, w, h);
    }
    this.activa = algo;
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
