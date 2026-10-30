// Helicóptero de la tele (UPGAMES TV): sigue al líder desde el aire con el morro inclinado,
// se ladea en los giros y el rotor gira con su disco borroso. Sin líder, sobrevuela el circuito.

import * as THREE from 'three';

function texturaRotulo() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#0d47ff'; x.font = '900 italic 70px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('UPGAMES', 200, 64);
  x.fillStyle = '#e8202a'; x.font = '900 italic 60px Arial, sans-serif'; x.fillText('TV', 430, 66);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function texturaDisco() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d'), g = x.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, 'rgba(40,40,45,0.0)'); g.addColorStop(0.25, 'rgba(40,40,45,0.22)'); g.addColorStop(0.9, 'rgba(40,40,45,0.16)'); g.addColorStop(1, 'rgba(40,40,45,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

export function crearHelicoptero(calidad = 2) {
  const g = new THREE.Group();
  const blanco = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.35, metalness: 0.2 });
  const azul = new THREE.MeshStandardMaterial({ color: 0x0d47ff, roughness: 0.4, metalness: 0.2 });
  const oscuro = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.5, metalness: 0.6 });
  const cristal = new THREE.MeshStandardMaterial({ color: 0x0a1626, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.5 });
  const seg = calidad >= 2 ? 24 : 14;
  // cabina y fuselaje (morro hacia +x)
  const cuerpo = new THREE.Mesh(new THREE.SphereGeometry(1, seg, seg / 2), blanco);
  cuerpo.scale.set(2.6, 1.35, 1.25); g.add(cuerpo);
  const franja = new THREE.Mesh(new THREE.SphereGeometry(1.01, seg, seg / 2, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.18), azul);
  franja.scale.copy(cuerpo.scale); g.add(franja);
  const parabrisas = new THREE.Mesh(new THREE.SphereGeometry(1.02, seg, seg / 2, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.18, Math.PI * 0.32), cristal);
  parabrisas.scale.set(2.6, 1.35, 1.25); g.add(parabrisas);
  // cola
  const cola = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 5.2, 10), blanco);
  cola.rotation.z = Math.PI / 2; cola.position.set(-4.6, 0.35, 0); g.add(cola);
  const deriva = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.7, 0.1), azul);
  deriva.position.set(-7.0, 1.1, 0); deriva.rotation.z = -0.35; g.add(deriva);
  const estab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 1.8), azul);
  estab.position.set(-6.2, 0.45, 0); g.add(estab);
  // rótulos a ambos lados de la cola (se leen bien desde los dos lados)
  const matRot = new THREE.MeshBasicMaterial({ map: texturaRotulo(), transparent: true });
  for (const sg of [1, -1]) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), matRot);
    r.position.set(-0.6, 0.15, sg * 1.27); if (sg < 0) r.rotation.y = Math.PI;
    g.add(r);
  }
  // patines
  for (const sg of [1, -1]) {
    const patin = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.4, 6), oscuro);
    patin.rotation.z = Math.PI / 2; patin.position.set(0.1, -1.75, sg * 1.05); g.add(patin);
    for (const px of [-0.9, 1.0]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), oscuro);
      m.position.set(px, -1.4, sg * 0.95); m.rotation.x = sg * 0.3; g.add(m);
    }
  }
  // cámara de TV (bola giroestabilizada bajo el morro)
  const bola = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), oscuro);
  bola.position.set(2.0, -1.15, 0); g.add(bola);
  // rotor principal: palas + disco borroso (cuando gira rápido)
  const rotor = new THREE.Group(); rotor.position.set(0, 1.55, 0); g.add(rotor);
  const eje = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.5, 8), oscuro); eje.position.y = -0.2; rotor.add(eje);
  const palas = new THREE.Group(); rotor.add(palas);
  for (let k = 0; k < 4; k++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.04, 0.32), oscuro);
    p.position.x = 2.6; const brazo = new THREE.Group(); brazo.rotation.y = k * Math.PI / 2; brazo.add(p); palas.add(brazo);
  }
  const disco = new THREE.Mesh(new THREE.CircleGeometry(5.3, 40), new THREE.MeshBasicMaterial({ map: texturaDisco(), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  disco.rotation.x = -Math.PI / 2; disco.position.y = 0.02; rotor.add(disco);
  // rotor de cola
  const rotorCola = new THREE.Group(); rotorCola.position.set(-7.1, 1.1, 0.12); g.add(rotorCola);
  for (let k = 0; k < 2; k++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.03), oscuro);
    p.rotation.z = k * Math.PI / 2; rotorCola.add(p);
  }
  // luces de navegación (roja que parpadea arriba)
  const baliza = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  baliza.position.set(-1.2, 1.25, 0); g.add(baliza);
  g.traverse(o => { if (o.isMesh && o !== disco) o.castShadow = calidad >= 2; });

  const pos = new THREE.Vector3(), vel = new THREE.Vector3(), obj = new THREE.Vector3(), tmp = new THREE.Vector3();
  let t = 0, rumbo = 0, ladeo = 0, cabeceo = 0, iniciado = false, ang = 0;
  return {
    grupo: g,
    /** foco: posición del coche a seguir (o null); centro y radio: para sobrevolar sin foco. */
    actualizar(dt, foco, centro, radio) {
      if (!dt) return;
      t += dt;
      palas.rotation.y += dt * 38; rotorCola.rotation.z += dt * 90;
      baliza.visible = (t % 1.2) < 0.15;
      if (foco) {
        // por detrás y a un lado del coche, a unos 45 m de altura
        const h = foco.psi ?? rumbo;
        obj.set(foco.x - 55 * Math.cos(h) + 30 * Math.sin(h), (foco.y || 0) + 45, foco.z - 55 * Math.sin(h) - 30 * Math.cos(h));
      } else {
        ang += dt * 0.05;
        obj.set(centro.x + Math.cos(ang) * radio, 110, centro.z + Math.sin(ang) * radio);
      }
      if (!iniciado) { pos.copy(obj); pos.y += 30; iniciado = true; }
      // vuela hacia el objetivo con aceleración limitada (nada de teletransportes)
      tmp.copy(obj).sub(pos);
      const dist = tmp.length();
      const vDeseo = tmp.multiplyScalar(Math.min(95, dist * 0.9) / Math.max(dist, 1e-3));
      vel.lerp(vDeseo, Math.min(1, dt * 0.9));
      pos.addScaledVector(vel, dt);
      const vh = Math.hypot(vel.x, vel.z);
      if (vh > 3) {
        const r = Math.atan2(vel.z, vel.x);
        let dr = r - rumbo; while (dr > Math.PI) dr -= 2 * Math.PI; while (dr < -Math.PI) dr += 2 * Math.PI;
        const giro = dr * Math.min(1, dt * 1.2);
        rumbo += giro;
        ladeo += (Math.max(-0.45, Math.min(0.45, -giro / Math.max(dt, 1e-3) * vh * 0.012)) - ladeo) * Math.min(1, dt * 2);
      } else ladeo *= 1 - Math.min(1, dt * 2);
      cabeceo += (-Math.min(0.28, vh * 0.004) - cabeceo) * Math.min(1, dt * 1.5);
      g.position.copy(pos);
      g.position.y += Math.sin(t * 0.9) * 0.4;          // leve balanceo en el aire
      g.rotation.set(ladeo, -rumbo, cabeceo, 'YXZ');
    },
  };
}
