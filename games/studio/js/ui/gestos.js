// Gestos sobre el lienzo:
// - 1 dedo: tocar = seleccionar; arrastrar en vacío = orbitar (el gizmo se lleva su propio arrastre).
// - 2 dedos: orbitar moviendo los dos y zoom pellizcando.
// - 3 dedos: desplazar.
// - Doble toque: enfocar lo seleccionado. Pulsación larga: menú radial.
// Ratón: izquierdo orbita, derecho/central o Mayús+izquierdo desplaza, rueda hace zoom.

const MOVER = 9;          // píxeles antes de que un toque cuente como arrastre
const LARGA = 520;        // ms para la pulsación larga
const DOBLE = 320;        // ms entre toques del doble toque

export function instalarGestos(el, camOrb, { ocupado, alTocar, alDobleToque, alPulsacionLarga }) {
  const ptrs = new Map(); // id → { x, y }
  let inicio = null;      // primer dedo: { id, x, y, t, movido }
  let temporizador = 0;
  let ultimoToque = null; // { x, y, t }
  let base = null;        // para 2/3 dedos: { cx, cy, d, n }
  let ignorar = new Set(); // punteros que no son nuestros (gizmo o menú radial)

  const centroide = () => {
    let cx = 0, cy = 0;
    for (const p of ptrs.values()) { cx += p.x; cy += p.y; }
    const n = ptrs.size; cx /= n; cy /= n;
    let d = 0;
    if (n >= 2) { const [a, b] = [...ptrs.values()]; d = Math.hypot(a.x - b.x, a.y - b.y); }
    return { cx, cy, d, n };
  };
  const cancelarLarga = () => { clearTimeout(temporizador); temporizador = 0; };

  el.addEventListener('pointerdown', (e) => {
    // El gizmo registra su pointerdown antes: si ya está arrastrando, ese dedo es suyo.
    if (ocupado()) { ignorar.add(e.pointerId); return; }
    el.setPointerCapture?.(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, boton: e.button, mayus: e.shiftKey });
    if (ptrs.size === 1) {
      inicio = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), movido: false };
      if (e.pointerType !== 'mouse' || e.button === 0) {
        temporizador = setTimeout(() => {
          temporizador = 0;
          if (!inicio || inicio.movido || ptrs.size !== 1) return;
          ignorar.add(inicio.id); ptrs.delete(inicio.id);
          alPulsacionLarga(inicio.x, inicio.y, inicio.id);
          inicio = null;
        }, LARGA);
      }
    } else {
      cancelarLarga();
      if (inicio) inicio.movido = true; // ya no es un toque
      base = centroide();
    }
  });

  el.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p || ignorar.has(e.pointerId)) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) {
      if (inicio && !inicio.movido) {
        if (Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) < MOVER) return;
        inicio.movido = true; cancelarLarga();
      }
      if (ocupado()) return;
      const desplazar = e.pointerType === 'mouse' && (p.boton === 1 || p.boton === 2 || p.mayus);
      if (desplazar) camOrb.desplazar(dx, dy, el.clientHeight);
      else camOrb.orbitar(dx, dy);
      return;
    }
    const c = centroide();
    if (!base || base.n !== c.n) { base = c; return; }
    const mx = c.cx - base.cx, my = c.cy - base.cy;
    if (c.n === 2) {
      camOrb.orbitar(mx, my);
      if (base.d > 0 && c.d > 0) camOrb.zoom(base.d / c.d);
    } else {
      camOrb.desplazar(mx, my, el.clientHeight);
    }
    base = c;
  });

  const soltar = (e) => {
    if (ignorar.delete(e.pointerId)) return;
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    cancelarLarga();
    if (ptrs.size === 0 && inicio && !inicio.movido && e.type === 'pointerup' && !ocupado()) {
      const ahora = performance.now();
      if (ultimoToque && ahora - ultimoToque.t < DOBLE && Math.hypot(e.clientX - ultimoToque.x, e.clientY - ultimoToque.y) < 40) {
        ultimoToque = null;
        alDobleToque(e.clientX, e.clientY);
      } else {
        ultimoToque = { x: e.clientX, y: e.clientY, t: ahora };
        alTocar(e.clientX, e.clientY);
      }
    }
    if (ptrs.size === 0) inicio = null;
    base = ptrs.size >= 2 ? centroide() : null;
  };
  el.addEventListener('pointerup', soltar);
  el.addEventListener('pointercancel', soltar);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    camOrb.zoom(Math.exp(e.deltaY * 0.0012));
  }, { passive: false });
}
