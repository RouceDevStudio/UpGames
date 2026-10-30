// Protecciones del circuito con las que se puede chocar: bidones de agua que
// revientan, neumáticos que salen despedidos de la barrera, marcas de pintura y
// goma en los muros, y restos en la pista que pinchan (los comisarios los retiran).

import * as THREE from 'three';

function texturaBidon() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#ff7a00'; x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#ffffff'; x.fillRect(0, 44, 256, 40);
  x.fillStyle = '#0d47ff'; x.font = '900 italic 30px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('UPGAMES', 64, 64); x.fillText('UPGAMES', 192, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Barreras {
  constructor(scene, c, { escombros, efectos, calidad = 1 }) {
    this.scene = scene; this.c = c; this.escombros = escombros; this.efectos = efectos;
    // bidones de agua
    const geo = new THREE.CylinderGeometry(0.42, 0.42, 0.95, 16); geo.translate(0, 0.475, 0);
    this.matBidon = new THREE.MeshStandardMaterial({ map: texturaBidon(), roughness: 0.5 });
    this.bidones = c.bidones.map(b => {
      const m = c.muestra(b.s);
      return { x: m.x - m.tz * b.d, z: m.z + m.tx * b.d, y: m.y + c.caida(m.i, b.d), vivo: true };
    });
    this.inst = new THREE.InstancedMesh(geo, this.matBidon, Math.max(1, this.bidones.length));
    this.inst.castShadow = calidad >= 2; this.inst.receiveShadow = true;
    this.plantillaBidon = new THREE.Mesh(geo, this.matBidon);
    this._colocarBidones();
    scene.add(this.inst);
    // neumático suelto de barrera
    const geoN = new THREE.TorusGeometry(0.28, 0.12, 8, 14); geoN.rotateX(Math.PI / 2);
    this.plantillaNeum = new THREE.Mesh(geoN, new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.9 }));
    // marcas en los muros (decals)
    this.maxMarcas = 90;
    this.marcas = [];
    this.geoMarca = new THREE.PlaneGeometry(1, 1);
    this.matMarcas = [0x0b0b0c, 0x2a2a2c, 0x5a2a20].map(c2 => new THREE.MeshStandardMaterial({ color: c2, transparent: true, opacity: 0.75, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    // restos que pinchan: { obj, x, z, t }
    this.restos = [];
  }

  _colocarBidones() {
    const m = new THREE.Matrix4();
    this.bidones.forEach((b, k) => {
      if (b.vivo) m.makeTranslation(b.x, b.y, b.z); else m.makeScale(0, 0, 0);
      this.inst.setMatrixAt(k, m);
    });
    this.inst.instanceMatrix.needsUpdate = true;
  }

  _salpicar(x, y, z, vx, vz) {
    const h = this.efectos?.humo; if (!h) return;
    for (let k = 0; k < 26; k++) {
      const r = Math.random;
      h.emitir(x, y + 0.6, z, vx * 0.4 + (r() - 0.5) * 7, 1.5 + r() * 4, vz * 0.4 + (r() - 0.5) * 7, 0.9, 0.5, 0.8 + r() * 0.6, 2.4, 0.78, 0.86, 1.0);
    }
  }

  _marca(g, coche, base) {
    const c = this.c, m = c.muestra(g.i * c.paso);
    const sg = g.lado ? 1 : -1;
    const ancho = Math.min(3.5, 0.6 + g.bruto * 0.15), alto = 0.18 + Math.min(0.35, g.bruto * 0.02);
    const mesh = new THREE.Mesh(this.geoMarca, this.matMarcas[g.tipo === 0 ? (Math.random() < 0.5 ? 0 : 1) : 2]);
    if (g.tipo === 0 && base) {   // pintura del coche en el hormigón
      mesh.material = this.matMarcas[0].clone(); mesh.material.color.set(base); mesh.material.opacity = 0.55;
    }
    mesh.scale.set(ancho, alto, 1);
    const d = (c.muro[g.lado][g.i] - 0.03) * sg;
    mesh.position.set(m.x - m.tz * d, m.y + c.caida(m.i, d) + 0.25 + Math.random() * 0.25, m.z + m.tx * d);
    mesh.rotation.y = -Math.atan2(m.tz, m.tx) + (g.lado ? Math.PI : 0);
    this.scene.add(mesh);
    this.marcas.push(mesh);
    if (this.marcas.length > this.maxMarcas) this.scene.remove(this.marcas.shift());
  }

  /** Revisa a cada coche: golpes contra muros y bidones, y restos pisados. Devuelve eventos de sonido. */
  actualizar(dt, participantes) {
    const ev = [];
    for (const p of participantes) {
      const car = p.coche;
      // golpes contra muros (los apunta la física)
      if (car.golpesMuro?.length) {
        for (const g of car.golpesMuro) {
          this._marca(g, car, p.equipo?.base);
          if (g.tipo === 1 && g.bruto > 5) {
            // la barrera de neumáticos suelta algunos
            const n = Math.min(5, Math.floor(g.bruto / 4));
            for (let k = 0; k < n; k++) {
              this.plantillaNeum.position.set(g.x + (Math.random() - 0.5), car.y + 0.3 + k * 0.25, g.z + (Math.random() - 0.5));
              this.plantillaNeum.updateMatrixWorld(true);
              this.escombros.lanzar(this.plantillaNeum, new THREE.Vector3(Math.cos(car.psi) * car.vx * 0.3, 0, Math.sin(car.psi) * car.vx * 0.3), { radio: 0.4, alto: 1 });
            }
          }
          if (g.tipo === 2 && g.bruto > 5) ev.push({ tipo: 'tecpro', fuerza: g.bruto });
        }
        car.golpesMuro.length = 0;
      }
      // bidones de agua
      if (car.velocidad > 3) for (let k = 0; k < this.bidones.length; k++) {
        const b = this.bidones[k];
        if (!b.vivo) continue;
        const dx = b.x - car.x, dz = b.z - car.z;
        if (dx * dx + dz * dz > 2.6 * 2.6) continue;
        // ¿dentro de la silueta del coche?
        const cos = Math.cos(car.psi), sin = Math.sin(car.psi);
        const lx = dx * cos + dz * sin, ly = -dx * sin + dz * cos;
        if (Math.abs(lx) > 2.8 || Math.abs(ly) > 1.25) continue;
        b.vivo = false;
        const vel = new THREE.Vector3(cos * car.vx, 0, sin * car.vx);
        this.plantillaBidon.position.set(b.x, b.y, b.z); this.plantillaBidon.updateMatrixWorld(true);
        this.escombros.lanzar(this.plantillaBidon, vel.clone().multiplyScalar(0.7), { radio: 0.45, alto: 2 });
        this._salpicar(b.x, b.y, b.z, vel.x, vel.z);
        // el agua frena el coche sin destrozarlo
        car.vx *= 0.9;
        if (car.vx > 25) { car.fuenteGolpe = 'bidón'; car.aplicarGolpe(lx > 0 ? 2.5 : -2.0, 0, 4 + car.vx * 0.04); }
        ev.push({ tipo: 'bidon', fuerza: car.vx / 10, jugador: p.jugador });
        this._colocarBidones();
      }
      // restos en la pista: pinchazo si se pisan deprisa
      if (car.velocidad > 15) for (const r of this.restos) {
        if (r.pisados.has(car)) continue;
        const dx = r.obj.position.x - car.x, dz = r.obj.position.z - car.z;
        if (dx * dx + dz * dz > 1.6) continue;
        r.pisados.add(car);
        const k = Math.floor(Math.random() * 4);
        if (Math.random() < 0.3 && !car.dano.pinchazo[k]) { car.dano.pinchazo[k] = true; car.eventos.push('dano:pinchazo' + k); }
      }
    }
    // los restos que quedan quietos en el asfalto son peligrosos hasta que los retiran
    for (const e of this.escombros.lista) {
      if (e.restoRegistrado || e.radio < 0.06 || e.v.lengthSq() > 0.5) continue;
      e.restoRegistrado = true;
      const pr = this.c.proyectar(e.obj.position.x, e.obj.position.z, -1, {});
      if (Math.abs(pr.d) < this.c.semiAncho[pr.i] + 0.5) { this.restos.push({ obj: e.obj, pisados: new Set(), escombro: e }); e.vida = Math.min(e.vida, 35); }
    }
    this.restos = this.restos.filter(r => r.escombro.vida > 0);
    return ev;
  }

  reponer() { for (const b of this.bidones) b.vivo = true; this._colocarBidones(); for (const m of this.marcas) this.scene.remove(m); this.marcas = []; }
}
