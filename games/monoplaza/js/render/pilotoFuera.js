// Piloto fuera del coche: tras un abandono sale del habitáculo, se aparta del coche y
// camina (o cojea, si está herido) hasta detrás del muro. Mientras está en la pista se le
// puede atropellar: sale despedido, queda tendido unos segundos y se levanta herido.

import * as THREE from 'three';
import { Persona } from './personas.js';

const MAX = 4;                 // pilotos a pie a la vez (rendimiento)
const _v = new THREE.Vector3();

export class PilotosFuera {
  constructor(scene, circuito, calidad = 1) {
    this.scene = scene; this.c = circuito; this.calidad = calidad;
    this.lista = [];
  }

  /**
   * coche: el monoplaza abandonado; modelo: su modelo 3D (para ocultar al piloto de dentro
   * y copiarle el casco); equipo: colores; herido: si el golpe le ha dejado tocado.
   */
  salir({ coche, modelo, equipo, numero = 1, herido = false, participante = null }) {
    if (this.lista.some(p => p.coche === coche)) return null;
    if (this.lista.length >= MAX) this._quitar(this.lista[0]);
    const per = new Persona({ color: equipo?.base || '#0d47ff', texto: equipo?.corto === 'UPG' ? 'UPGAMES' : (equipo?.nombre || 'UPGAMES').split(' ')[0].toUpperCase(), numero, rol: 'piloto', calidad: this.calidad });
    // el mismo casco que lleva dentro del coche
    if (modelo?.piloto?.casco) {
      const casco = modelo.piloto.casco.clone();
      casco.position.set(0.035, 0.06, 0); casco.scale.setScalar(1.08);
      per.cabeza.add(casco);
    }
    if (modelo?.piloto?.grupo) modelo.piloto.grupo.visible = false;
    const c = this.c, p = coche.proj;
    // sale por el lado del muro más cercano
    const lado = (p.d ?? 0) >= 0 ? 1 : -1;
    const f = { per, coche, modelo, participante, lado, estado: 'sale', t: 0, herido, salud: herido ? 0.55 : 1,
      pos: new THREE.Vector3(coche.x, coche.y + 0.45, coche.z), vel: new THREE.Vector3(), rumbo: coche.psi, tumbado: 0, giro: 0 };
    per.raiz.position.copy(f.pos);
    per.raiz.rotation.y = -coche.psi;
    per.poner('sentado', 0.01);
    this.scene.add(per.raiz);
    this.lista.push(f);
    void c;
    return f;
  }

  _quitar(f) {
    this.scene.remove(f.per.raiz);
    f.per.raiz.traverse(o => { if (o.isMesh || o.isSkinnedMesh) o.geometry?.dispose?.(); });
    this.lista = this.lista.filter(x => x !== f);
  }

  /** Tras recrear los modelos de los coches: el piloto que está fuera no puede seguir dentro. */
  ocultarEn(modelos, participantes) {
    for (const f of this.lista) { const k = participantes.findIndex(q => q.coche === f.coche); const m = modelos[k]; if (m?.piloto?.grupo) { m.piloto.grupo.visible = false; f.modelo = m; } }
  }

  limpiar() { for (const f of [...this.lista]) { if (f.modelo?.piloto?.grupo) f.modelo.piloto.grupo.visible = true; this._quitar(f); } }

  /** Devuelve eventos: { tipo: 'atropello', victima, culpable (participante), fuerza }. */
  actualizar(dt, participantes) {
    const ev = [], c = this.c;
    for (const f of this.lista) {
      const per = f.per;
      f.t += dt;
      const pr = c.proyectar(f.pos.x, f.pos.z, -1, {});
      const i = pr.i >= 0 ? pr.i : 0;
      const muro = c.muro[f.lado > 0 ? 1 : 0][i];
      const suelo = (d) => pr.y + c.caida(i, d);
      const enPista = Math.abs(pr.d) < muro - 0.2;
      if (f.estado === 'sale') {
        // salida en fases (más lenta si está herido): quita el volante, se pone de pie en el
        // habitáculo agarrado al halo, pasa una pierna por encima del pontón, salta al suelo
        // (flexiona al caer) y mira el coche un momento antes de irse
        const r = f.herido ? 1.6 : 1, t = f.t / r;
        const nx = -Math.sin(f.coche.psi) * f.lado, nz = Math.cos(f.coche.psi) * f.lado;   // lateral del coche
        const ax = Math.cos(f.coche.psi), az = Math.sin(f.coche.psi);                       // hacia el morro
        const base = f.coche.y;
        const suave = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
        let lat = 0, alto = 0.45, fase;
        if (t < 1.1) { fase = 'quita_volante'; }
        // (alto = altura de los pies: sentado en el asiento 0,45; de pie en el fondo del habitáculo 0,12;
        // pisando el pontón 0,55)
        else if (t < 2.3) { fase = 'apoya'; alto = 0.45 - 0.33 * suave((t - 1.1) / 0.8); }
        else if (t < 3.4) { fase = 'trepa'; const k = suave((t - 2.3) / 1.1); lat = 0.72 * k; alto = 0.12 + 0.43 * Math.sin(Math.min(1, k * 1.3) * Math.PI / 2); }
        else if (t < 3.9) { fase = 'de_pie'; const k = (t - 3.4) / 0.5; lat = 0.72 + 0.6 * k; alto = (0.55 + (base - suelo(pr.d))) * (1 - k * k) + Math.sin(k * Math.PI) * 0.15; }
        else if (t < 4.4) { fase = 'preparado'; lat = 1.3; alto = 0; }                        // aterriza flexionando
        else { fase = f.herido ? 'estabiliza' : 'de_pie'; lat = 1.3; alto = 0; }
        if (fase !== f.fase) { f.fase = fase; per.poner(fase, fase === 'preparado' ? 0.12 : 0.35); }
        if (per.volante) per.volante.visible = t > 1.1;      // se lleva el volante (como en la tele)
        f.pos.x = f.coche.x + nx * lat - ax * 0.15; f.pos.z = f.coche.z + nz * lat - az * 0.15;
        f.pos.y = (t < 3.4 ? base : suelo(pr.d)) + alto;
        // mira hacia delante en el coche, luego hacia el coche (de lado) antes de marcharse
        f.rumbo = t < 3.4 ? f.coche.psi : Math.atan2(-nz, -nx);
        if (t > 5.2) { f.estado = 'camina'; f.t = 0; per.poner('de_pie', 0.4); }
      } else if (f.estado === 'camina') {
        // hacia el muro y, al llegar, por encima de él hasta quedar detrás
        const objD = f.lado * (muro + 2.6);
        const m = c.muestra(c.envolver(pr.s + 4));
        const ox = m.x - m.tz * objD, oz = m.z + m.tx * objD;
        const dx = ox - f.pos.x, dz = oz - f.pos.z, L = Math.hypot(dx, dz);
        const vel = f.herido ? 0.75 : 1.5;
        per.andar = vel;
        if (L < 0.3) { f.estado = 'fuera'; f.t = 0; per.andar = 0; per.poner(f.herido ? 'espera' : 'senala', 0.5); }
        else {
          f.pos.x += dx / L * vel * dt; f.pos.z += dz / L * vel * dt;
          f.rumbo = Math.atan2(dz, dx);
          // salta el muro (~1 m) cuando pasa por encima
          const dm = Math.abs(Math.abs(pr.d) - muro);
          f.pos.y = suelo(pr.d) + (dm < 0.8 ? Math.cos(dm / 0.8 * Math.PI / 2) * 1.1 : 0);
          // cojera: el cuerpo se ladea a cada paso
          if (f.herido) per.raiz.rotation.x = Math.sin(f.t * 5) * 0.08;
        }
      } else if (f.estado === 'volando') {
        // atropellado: vuela, gira y cae
        f.vel.y -= 9.8 * dt;
        f.pos.addScaledVector(f.vel, dt);
        f.giro += dt * 9;
        const sY = suelo(pr.d);
        if (f.pos.y <= sY) { f.pos.y = sY; f.vel.multiplyScalar(0.35); f.vel.y = Math.abs(f.vel.y) > 1.5 ? -f.vel.y * 0.3 : 0; if (Math.hypot(f.vel.x, f.vel.z) < 0.6 && f.vel.y === 0) { f.estado = 'tendido'; f.t = 0; } }
      } else if (f.estado === 'tendido') {
        f.pos.y = suelo(pr.d) + 0.14;
        if (f.t > 6) { f.estado = 'camina'; f.t = 0; f.herido = true; per.poner('de_pie', 0.8); }
      } else if (f.estado === 'fuera') {
        // detrás del muro mirando a la pista (si está bien, saluda al público de vez en cuando)
        f.rumbo = Math.atan2(-c.tx[i] * f.lado, c.tz[i] * f.lado);
        if (!f.herido && f.t > 3) per.poner(Math.sin(f.t * 0.5) > 0.6 ? 'lamento' : 'jarra', 0.6);
        if (f.t > 90) { this._quitar(f); continue; }
      }
      // ¿lo atropella alguien? (solo mientras está en la pista y de pie o tendido)
      if (enPista && (f.estado === 'camina' || f.estado === 'tendido' || f.estado === 'sale') && f.t > 0.2) {
        for (const q of participantes) {
          const car = q.coche;
          if (car === f.coche || car.velocidad < 2.5) continue;
          const dx = f.pos.x - car.x, dz = f.pos.z - car.z;
          if (dx * dx + dz * dz > 9) continue;
          const cs = Math.cos(car.psi), sn = Math.sin(car.psi);
          const lx = dx * cs + dz * sn, ly = -dx * sn + dz * cs;
          if (Math.abs(lx) > 2.6 || Math.abs(ly) > 1.05) continue;
          const v = car.velocidad;
          f.estado = 'volando'; f.t = 0;
          f.vel.set(cs * v * 0.55 + (Math.random() - 0.5) * 2, 2 + v * 0.12, sn * v * 0.55 + (Math.random() - 0.5) * 2);
          f.salud = Math.max(0, f.salud - Math.min(1, v / 40));
          per.andar = 0; per.poner('de_pie', 0.1);
          // el coche lo nota: pierde algo de velocidad y se daña el morro
          car.vx *= 0.92;
          car.fuenteGolpe = 'piloto'; car.aplicarGolpe?.(2.4, ly, 4 + v * 0.15);
          ev.push({ tipo: 'atropello', victima: f.participante, culpable: q, fuerza: v });
          break;
        }
      }
      // colocar el modelo
      per.raiz.position.copy(f.pos);
      per.raiz.rotation.y = -f.rumbo;
      const tumb = f.estado === 'volando' ? f.giro : f.estado === 'tendido' ? Math.PI / 2 : 0;
      f.tumbado += (tumb - f.tumbado) * Math.min(1, dt * (f.estado === 'volando' ? 30 : 4));
      per.raiz.rotation.z = f.estado === 'tendido' || f.estado === 'volando' ? f.tumbado : f.tumbado * 0;
      if (f.estado !== 'camina' || !f.herido) per.raiz.rotation.x *= 0.9;
      per.actualizar(dt);
    }
    return ev;
  }
}
