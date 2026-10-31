// Menú radial: se abre con la pulsación larga. Se puede deslizar el dedo hasta una opción y
// soltar, o soltar en el centro y tocar la opción después.

const el = document.getElementById('radial');
let abierto = false;

export function abrirRadial(x, y, opciones, idPuntero) {
  cerrar();
  const r = Math.min(96, Math.min(innerWidth, innerHeight) * 0.22);
  x = Math.min(Math.max(x, r + 36), innerWidth - r - 36);
  y = Math.min(Math.max(y, r + 36), innerHeight - r - 36);
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  el.innerHTML = '<button class="centro"></button>';
  const botones = opciones.map((op, i) => {
    const a = -Math.PI / 2 + (i / opciones.length) * Math.PI * 2;
    const b = document.createElement('button');
    b.innerHTML = `${op.icono || ''}<span>${op.nombre}</span>`;
    b.style.left = `${Math.cos(a) * r}px`; b.style.top = `${Math.sin(a) * r}px`;
    b.style.animationDelay = `${i * 18}ms`;
    b.disabled = !!op.desactivado;
    b.addEventListener('click', () => { cerrar(); op.hacer(); });
    el.appendChild(b);
    return { b, op };
  });
  el.hidden = false;
  abierto = true;

  const bajo = (e) => {
    const t = document.elementFromPoint(e.clientX, e.clientY);
    return botones.find((q) => q.b === t || q.b.contains(t));
  };
  const mover = (e) => {
    if (e.pointerId !== idPuntero) return;
    const q = bajo(e);
    for (const o of botones) o.b.classList.toggle('sobre', o === q);
  };
  const soltar = (e) => {
    if (e.pointerId !== idPuntero) return;
    removeEventListener('pointermove', mover);
    removeEventListener('pointerup', soltar);
    const q = bajo(e);
    if (q && !q.b.disabled) { cerrar(); q.op.hacer(); }
    else for (const o of botones) o.b.classList.remove('sobre');
    // a partir de aquí, tocar fuera cierra
    setTimeout(() => addEventListener('pointerdown', fuera, { once: true, capture: true }), 0);
  };
  const fuera = (e) => { if (!el.contains(e.target)) cerrar(); else addEventListener('pointerdown', fuera, { once: true, capture: true }); };
  addEventListener('pointermove', mover);
  addEventListener('pointerup', soltar);
  navigator.vibrate?.(12);
}

function cerrar() {
  if (!abierto) return;
  abierto = false;
  el.hidden = true;
  el.innerHTML = '';
}
