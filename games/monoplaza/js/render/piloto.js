// Piloto: modelo aparte del coche (torso, HANS, casco con visera, hombros, brazos con codo
// y manos con dedos). Los brazos van por cinemática inversa a las empuñaduras del volante.
// En un golpe fuerte el volante pega latigazos y gira solo; el piloto lo suelta y cruza
// los brazos sobre el pecho para protegerse las muñecas, como en la vida real, y la
// cabeza se encoge contra el HANS. Pasado el golpe vuelve a coger el volante.

import * as THREE from 'three';
import { texturaCasco } from './librea.js';

const BRAZO = 0.27, ANTEBRAZO = 0.25;          // m
const _x = new THREE.Vector3(1, 0, 0), _z = new THREE.Vector3(0, 0, 1);

function casco(matCasco, matNegro, calidad) {
  const g = new THREE.Group();
  // carcasa: esfera alargada y aplanada por los lados, con la mentonera prolongada
  const gC = new THREE.SphereGeometry(0.135, calidad >= 2 ? 36 : 22, calidad >= 2 ? 24 : 14);
  const p = gC.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    x *= 1.12; z *= 0.92;
    if (y < -0.02 && x > 0) { x += (-0.02 - y) * 0.55; }
    if (y < -0.07) { y = -0.07 - (-0.07 - y) * 0.6; }
    p.setXYZ(i, x, y, z);
  }
  gC.computeVertexNormals(); gC.rotateY(Math.PI);
  g.add(new THREE.Mesh(gC, matCasco));
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.1395, 28, 10, -Math.PI * 0.28, Math.PI * 0.56, Math.PI * 0.42, Math.PI * 0.12),
    new THREE.MeshPhysicalMaterial({ color: 0x0b0d14, metalness: 0.7, roughness: 0.04, clearcoat: 1, iridescence: 0.9, iridescenceIOR: 1.6 }));
  visor.rotation.y = Math.PI; visor.scale.set(1.12, 1, 0.92); g.add(visor);
  const aler = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.16), matCasco); aler.position.set(-0.13, 0.06, 0); aler.rotation.z = -0.25; g.add(aler);
  const toma = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.05), matNegro); toma.position.set(0.04, 0.135, 0); g.add(toma);
  return g;
}

// guante: palma, dedos juntos y pulgar (apunta a +x local; se orienta con el antebrazo)
function guanteGeo() {
  const palma = new THREE.BoxGeometry(0.075, 0.03, 0.07); palma.translate(0.035, 0, 0);
  const dedos = new THREE.CapsuleGeometry(0.017, 0.045, 3, 8); dedos.rotateZ(Math.PI / 2); dedos.scale(1, 1, 2.1); dedos.translate(0.09, -0.004, 0);
  const pulgar = new THREE.CapsuleGeometry(0.012, 0.03, 3, 6); pulgar.rotateZ(Math.PI / 2.6); pulgar.translate(0.045, 0.012, 0.04);
  const pulgar2 = pulgar.clone(); pulgar2.translate(0, 0, -0.08);
  return [palma, dedos, pulgar, pulgar2];
}

/**
 * opc: { traje, guante, matNegro, equipado, colores, columna (Group de la columna de dirección), calidad }
 * Se añade a la carrocería en su origen: todo está en coordenadas de la carrocería.
 */
export function crearPiloto({ traje, guante, matNegro, equipado = {}, colores = {}, columna, calidad = 1 }) {
  const grupo = new THREE.Group();
  grupo.name = 'piloto';
  const hi = calidad >= 2;
  // pecho (asoma por el habitáculo) con más polígonos para que se vea redondo
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.16, hi ? 10 : 6, hi ? 24 : 14), traje);
  torso.rotation.x = Math.PI / 2; torso.scale.set(1, 1.15, 0.86); torso.position.set(0.0, 0.632, 0);
  grupo.add(torso);
  // asiento acolchado alrededor del cuerpo: el piloto sale del asiento, no de la carrocería
  const matAsiento = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.95 });
  const asiento = new THREE.Mesh(new THREE.CircleGeometry(1, 28), matAsiento);
  asiento.rotation.x = -Math.PI / 2; asiento.scale.set(0.15, 0.25, 1); asiento.position.set(0.0, 0.6035, 0);
  grupo.add(asiento);
  // arnés de seguridad: dos cintas sobre los hombros, la del abdomen y la hebilla
  const matCinta = new THREE.MeshStandardMaterial({ color: 0xd9381e, roughness: 0.7 });
  const geoCinta = new THREE.BoxGeometry(0.045, 1, 0.006);
  const cintas = [-1, 1].map(l => {
    const m = new THREE.Mesh(geoCinta, matCinta);
    const a = new THREE.Vector3(0.02, 0.715, l * 0.085), b = new THREE.Vector3(0.105, 0.612, l * 0.03);
    const dd = b.clone().sub(a); m.position.copy(a).addScaledVector(dd, 0.5); m.scale.y = dd.length();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dd.normalize());
    grupo.add(m); return m;
  });
  const hebilla = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 16), new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 1, roughness: 0.3 }));
  hebilla.rotation.z = Math.PI / 2 - 0.5; hebilla.position.set(0.108, 0.617, 0); grupo.add(hebilla);
  void cintas;
  // hombros redondeados (de ellos cuelgan los brazos)
  const geoHombro = new THREE.SphereGeometry(0.048, hi ? 18 : 12, hi ? 14 : 10);
  const hombros = [-1, 1].map(l => { const m = new THREE.Mesh(geoHombro, traje); m.position.set(0.05, 0.665, l * 0.165); grupo.add(m); return m; });
  const hans = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.03, 8, 20, Math.PI * 1.3), matNegro);
  hans.rotation.set(Math.PI / 2, 0, Math.PI * 0.85); hans.position.set(0.02, 0.70, 0);
  grupo.add(hans);
  const cuello = new THREE.Group();
  cuello.position.set(0.04, 0.72, 0);
  const matCasco = new THREE.MeshPhysicalMaterial({ map: texturaCasco(equipado.casco || 'clasico', equipado.cascoColores || { base: colores.tercero || '#ffffff', acento: colores.base || '#0d47ff' }), roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04 });
  const cabeza = casco(matCasco, matNegro, calidad);
  cabeza.position.set(0.04, 0.085, 0);
  cuello.add(cabeza);
  grupo.add(cuello);
  // brazos: brazo, codo y antebrazo; manos con guante
  const seg = hi ? 16 : 10;
  const geoBrazo = new THREE.CylinderGeometry(0.034, 0.03, 1, seg, 3), geoAnte = new THREE.CylinderGeometry(0.03, 0.024, 1, seg, 3);
  const geoCodo = new THREE.SphereGeometry(0.031, seg, 10);
  // puño del guante (manguito) donde termina el antebrazo
  const geoPuno = new THREE.CylinderGeometry(0.032, 0.034, 0.05, seg);
  const gg = guanteGeo();
  const brazos = [-1, 1].map(() => {
    const b = { brazo: new THREE.Mesh(geoBrazo, traje), ante: new THREE.Mesh(geoAnte, traje), codo: new THREE.Mesh(geoCodo, traje), mano: new THREE.Group() };
    for (const g of gg) b.mano.add(new THREE.Mesh(g, guante));
    const puno = new THREE.Mesh(geoPuno, guante); puno.rotation.z = Math.PI / 2; puno.position.x = -0.015; b.mano.add(puno);
    grupo.add(b.brazo, b.ante, b.codo, b.mano);
    return b;
  });
  grupo.traverse(o => { if (o.isMesh) o.castShadow = true; });

  const S = new THREE.Vector3(), T = new THREE.Vector3(), E = new THREE.Vector3(), d = new THREE.Vector3(), pol = new THREE.Vector3(), tmp = new THREE.Vector3();
  const agarre = new THREE.Vector3(), pecho = new THREE.Vector3(), arriba = new THREE.Vector3(0, 1, 0);
  // estado del choque
  const choque = { t: 99, dur: 0, w: 0, ang: 0, soltar: 0, golpePrevio: 0 };

  const cilindro = (m, a, b) => {
    tmp.copy(b).sub(a); const L = tmp.length();
    m.position.copy(a).addScaledVector(tmp, 0.5);
    m.quaternion.setFromUnitVectors(arriba, tmp.normalize());
    m.scale.set(1, L, 1);
  };

  // cinemática inversa de dos huesos: el codo hacia fuera y abajo
  const ik = (b, hombro, objetivo, lado) => {
    d.copy(objetivo).sub(hombro);
    const dist = Math.min(d.length(), (BRAZO + ANTEBRAZO) * 0.995);
    d.normalize();
    const cosA = Math.max(-1, Math.min(1, (BRAZO * BRAZO + dist * dist - ANTEBRAZO * ANTEBRAZO) / (2 * BRAZO * dist)));
    pol.set(-0.25, -0.65, lado * 0.75).normalize();
    pol.addScaledVector(d, -pol.dot(d)).normalize();
    E.copy(hombro).addScaledVector(d, BRAZO * cosA).addScaledVector(pol, BRAZO * Math.sqrt(1 - cosA * cosA));
    T.copy(hombro).addScaledVector(d, dist);
    cilindro(b.brazo, hombro, E);
    cilindro(b.ante, E, T);
    b.codo.position.copy(E);
    // la mano sigue la dirección del antebrazo
    b.mano.position.copy(T);
    b.mano.quaternion.setFromUnitVectors(_x, tmp.copy(T).sub(E).normalize());
  };

  return {
    grupo, cuello, casco: cabeza,
    mirada: 0,
    /** Devuelve el ángulo que debe tener el volante (rad) y coloca brazos y cabeza. */
    actualizar(car, dt) {
      const angPiloto = (car.anguloVolante || 0) * 9;
      // ¿golpe fuerte? (los pequeños roces no)
      const imp = Math.max(car.impacto || 0, car.picoGolpe || 0);
      if (imp > 7 && choque.t > 0.6 && imp > choque.golpePrevio + 2) {
        choque.t = 0; choque.dur = Math.min(3.2, 1.2 + imp * 0.06);
        choque.w = (Math.random() < 0.5 ? -1 : 1) * Math.min(26, 8 + imp * 0.8);     // rad/s
        choque.ang = angPiloto;
      }
      choque.golpePrevio = imp > 2 ? Math.max(choque.golpePrevio, imp) : 0;
      let angVol = angPiloto;
      if (dt > 0) choque.t += dt;
      const enChoque = choque.t < choque.dur;
      // las manos fuera del volante: rápido al soltarlo, más despacio al volver a cogerlo
      const objSoltar = enChoque ? 1 : 0;
      choque.soltar += (objSoltar - choque.soltar) * Math.min(1, dt * (enChoque ? 14 : 2.5));
      if (choque.soltar > 0.02) {
        // volante libre: latigazo inicial, gira solo y se frena con los topes (±170°)
        if (enChoque) {
          choque.w *= Math.exp(-dt * 1.1);
          choque.w += Math.sin(choque.t * 23) * 6 * Math.exp(-choque.t * 3) * dt * 60 * 0.02;
          choque.ang += choque.w * dt;
          const tope = 3.0;
          if (Math.abs(choque.ang) > tope) { choque.ang = Math.sign(choque.ang) * tope; choque.w = -choque.w * 0.45; }
        } else choque.ang += (angPiloto - choque.ang) * Math.min(1, dt * 3);
        angVol = choque.ang;
      }
      // cabeza: mira a la curva y se mueve con las fuerzas G; en el golpe se encoge y vibra
      const objMirar = -Math.max(-0.5, Math.min(0.5, (car.anguloVolante || 0) * 2.6)) * (1 - choque.soltar);
      this.mirada += (objMirar - this.mirada) * Math.min(1, dt * 6);
      cuello.rotation.y = this.mirada + (enChoque ? Math.sin(choque.t * 31) * 0.05 * Math.exp(-choque.t * 2) : 0);
      cuello.rotation.x = Math.max(-0.25, Math.min(0.25, -(car.ayF || 0) * 0.012));
      cuello.rotation.z = Math.max(-0.15, Math.min(0.2, (car.axF || 0) * 0.006)) - choque.soltar * 0.18;   // barbilla al pecho
      cuello.position.y = 0.72 - choque.soltar * 0.012;
      // brazos: empuñadura del volante ↔ brazos cruzados sobre el pecho
      for (let s = 0; s < 2; s++) {
        const lado = s ? 1 : -1;
        agarre.set(0, 0, lado * 0.125).applyAxisAngle(_x, angVol).applyAxisAngle(_z, columna.rotation.z).add(columna.position);
        // cruzados: cada mano al hombro contrario, una algo por encima de la otra
        pecho.set(0.13 + s * 0.02, 0.63 + s * 0.035, -lado * 0.1);
        T.copy(agarre).lerp(pecho, choque.soltar);
        S.set(0.05, 0.665, lado * 0.165);
        ik(brazos[s], S, T, lado);
        hombros[s].position.copy(S);
      }
      return angVol;
    },
  };
}
