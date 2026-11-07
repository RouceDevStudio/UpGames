// Tutorial guiado de la primera partida: una tarjeta arriba en el centro con el paso actual,
// que avanza sola cuando haces lo que pide. Cada paso trae el texto para teclado y para táctil.
// Se puede saltar y repetir desde Ajustes. El progreso se guarda en este dispositivo.
const CLAVE = 'upstar.tutorial.v1';

// s = estado que manda main.js cada fotograma (ver main.js → estadoTutorial)
const PASOS = [
  { t: 'Acelera', pc: 'Pulsa <b>W</b> para subir el acelerador (se queda donde lo dejas). <b>S</b> lo baja hasta la reversa y <b>X</b> lo pone a cero.', tc: 'Desliza hacia arriba la barra <b>AVANCE</b> de la derecha. Abajo está la <b>REVERSA</b>.', ok: (s) => s.acel > 0.35 },
  { t: 'Dirige la nave', pc: 'Haz clic en la pantalla para capturar el ratón y muévelo para apuntar el morro (o usa las flechas). <b>Q/E</b> giran sobre sí misma.', tc: 'Arrastra la <b>palanca</b> de la izquierda para apuntar el morro.', ok: (s, d) => (d.giro = (d.giro || 0) + s.giro * s.dt) > 1.6 },
  { t: 'Turbo y pulso', pc: 'Mantén <b>Mayús</b> para el turbo, o <b>Espacio</b> para el pulso: viaja miles de m/s entre planetas.', tc: 'Mantén <b>TURBO</b> o <b>PULSO</b> para ir más rápido. El pulso es para cruzar el sistema.', ok: (s, d) => (d.t = (d.t || 0) + (s.rapido ? s.dt : 0)) > 1.2 },
  { t: 'Dispara', pc: 'Clic izquierdo o <b>K</b> disparan los láseres (contra piratas y asteroides).', tc: 'Pulsa <b>FUEGO</b>.', ok: (s) => s.fuego },
  { t: 'Escanea', pc: 'Pulsa <b>R</b> para escanear lo que tienes delante: planetas, criaturas y ruinas dan créditos y llevan tu nombre.', tc: 'Pulsa <b>ESCÁNER</b> arriba a la derecha.', ok: (s, d) => s.escaneos > (d.base ??= s.escaneos) },
  { t: 'Viaja a un planeta', pc: 'Apunta a un planeta (sus nombres flotan en el cielo) y usa el pulso para acercarte. Al entrar en la atmósfera el pulso se corta solo.', tc: 'Apunta a un planeta y mantén <b>PULSO</b> para acercarte. En la atmósfera se corta solo.', ok: (s) => s.atm > 0.05 },
  { t: 'Aterriza', pc: 'Baja por debajo de 350 m y pulsa <b>L</b>: el piloto automático nivela la nave y la posa.', tc: 'Baja por debajo de 350 m y pulsa el botón <b>ATERRIZAR</b> que aparece.', ok: (s) => s.estado === 'aterrizada' },
  { t: 'Bájate de la nave', pc: 'Pulsa <b>F</b> para salir a pie.', tc: 'Pulsa <b>BAJAR DE LA NAVE</b>.', ok: (s) => s.modo === 'pie' },
  { t: 'Explora y mina', pc: '<b>WASD</b> andar, ratón mirar, <b>Espacio</b> saltar (mantén: jetpack). Apunta a un cristal o roca y mantén el clic para minar.', tc: 'Palanca para andar, arrastra a la derecha para mirar, <b>SALTO</b> (mantén: jetpack). Mantén <b>MINAR</b> apuntando a un cristal o roca.', ok: (s, d) => s.carga > (d.base ??= s.carga) },
  { t: 'Vuelve a la nave', pc: 'Acércate a la nave y pulsa <b>F</b> para subir. Tu traje se gasta fuera: vigila la barra TRAJE.', tc: 'Acércate a la nave y pulsa <b>SUBIR A LA NAVE</b>. Vigila la barra TRAJE.', ok: (s, d) => s.modo === 'nave' && d.estuvo, cada: (s, d) => { if (s.modo === 'pie') d.estuvo = true; } },
  { t: 'Despega', pc: 'Sube el acelerador con <b>W</b> y tira del morro hacia arriba hasta salir de la atmósfera.', tc: 'Sube el acelerador y tira de la palanca hacia ti para subir hasta el espacio.', ok: (s) => s.estado === 'espacio' && s.atm <= 0 },
  { t: 'Elige otra estrella', pc: 'Pulsa <b>M</b> para abrir el mapa de la galaxia y toca una estrella cercana para marcarla como destino.', tc: 'Pulsa <b>MENÚ</b> → Mapa y toca una estrella cercana para marcarla como destino.', ok: (s) => s.destino },
  { t: 'Salto hiperespacial', pc: 'Cierra el mapa, apunta la nave a la <b>marca verde</b> del destino y pulsa <b>J</b>. Cada sector gasta combustible.', tc: 'Cierra el menú, apunta a la <b>marca verde</b> y pulsa <b>SALTO</b>. Cada sector gasta combustible.', ok: (s) => s.salto },
];

export class Tutorial {
  constructor() {
    let g = null; try { g = JSON.parse(localStorage.getItem(CLAVE) || 'null'); } catch { /* nada */ }
    this.paso = g?.paso ?? 0; this.hecho = !!g?.hecho; this.d = {}; this.tOk = 0;
    const el = document.createElement('div'); el.id = 'tuto';
    document.body.appendChild(el); this.el = el;
    el.addEventListener('click', (e) => {
      if (e.target.dataset.t === 'saltar') this.terminar(true);
      else if (e.target.dataset.t === 'sig') this.avanzar();
      else if (e.target.dataset.t === 'min') el.classList.toggle('min');
    });
    this.pintar();
  }
  _guardar() { try { localStorage.setItem(CLAVE, JSON.stringify({ paso: this.paso, hecho: this.hecho })); } catch { /* nada */ } }
  reiniciar() { this.paso = 0; this.hecho = false; this.d = {}; this._guardar(); this.pintar(); }
  terminar(saltado = false) {
    this.hecho = true; this._guardar();
    if (saltado) { this.el.classList.remove('visible'); return; }
    this.el.innerHTML = `<div class="tt"><small>TUTORIAL COMPLETADO</small><b>¡Ya eres piloto!</b></div><p>El universo es infinito: cada estrella es un sistema distinto. Sigue la Señal en la Bitácora, cumple misiones en la estación y pon tu nombre a lo que descubras. Puedes repetir el tutorial en <b>Menú → Ajustes</b>.</p><div class="bts"><button data-t="saltar">Cerrar</button></div>`;
    this.el.classList.add('visible', 'fin'); this.alFin?.();
    setTimeout(() => this.el.classList.remove('visible'), 12000);
  }
  avanzar() {
    this.paso++; this.d = {}; this.tOk = 0; this._guardar();
    if (this.paso >= PASOS.length) this.terminar(); else { this.pintar(); this.alPaso?.(); }
  }
  pintar() {
    if (this.hecho) { this.el.classList.remove('visible'); return; }
    const p = PASOS[this.paso], tactil = !document.body.classList.contains('teclado'), k = this.paso + 1;
    this.el.classList.remove('fin', 'ok');
    this.el.innerHTML = `<div class="tt"><small>TUTORIAL · ${k}/${PASOS.length}</small><b>${p.t}</b><button data-t="min" title="Minimizar">–</button></div><p>${tactil ? p.tc : p.pc}</p>
      <div class="prog"><i style="width:${(this.paso / PASOS.length) * 100}%"></i></div>
      <div class="bts"><button data-t="saltar">Saltar tutorial</button><button data-t="sig">Siguiente ›</button></div>`;
    this.el.classList.add('visible'); this._tactil = tactil;
  }
  /** s: estado del juego en este fotograma (lo da main.js) */
  actualizar(s) {
    if (this.hecho) return;
    const p = PASOS[this.paso]; if (!p) return;
    const tactil = !document.body.classList.contains('teclado');
    if (tactil !== this._tactil) this.pintar();
    if (this.tOk > 0) { this.tOk -= s.dt; if (this.tOk <= 0) this.avanzar(); return; }
    p.cada?.(s, this.d);
    if (p.ok(s, this.d)) { this.tOk = 0.9; this.el.classList.add('ok'); this.alOk?.(); }
  }
}
