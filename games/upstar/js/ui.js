// Menús: menú del jugador (mapa, inventario y fabricación, bitácora), estación (reparar, mercado,
// implantes, astillero, misiones, terminal), minijuego de hackeo y fichas de descubrimiento.
import { E, guardar, anadir, capacidad, cargaTotal } from './estado.js';
import { MODELOS } from './nave.js';
import { dibujarMapa, COSTE_SECTOR } from './mapa.js';
import { hash, azar } from './ruido.js';
import { nombre, expedicionSemana } from './universo.js';
import { token } from './red.js';

const $ = (s) => document.querySelector(s);
export const RECURSOS = { cristal: { n: 'Cristal de neón', c: '#00f0ff', precio: 18 }, ferrita: { n: 'Ferrita', c: '#ffb347', precio: 10 }, carbono: { n: 'Carbono', c: '#7dff6b', precio: 6 }, plasma: { n: 'Célula de plasma', c: '#ff2e88', precio: 60 } };
export const RECETAS = [
  { id: 'reparar', n: 'Kit de reparación', d: '+35 % de casco', coste: { ferrita: 5, carbono: 3 }, usar: () => { E.casco = Math.min(100, E.casco + 35); } },
  { id: 'plasma', n: 'Célula de plasma', d: 'Combustible de pulso y salto (+40 %)', coste: { cristal: 4 }, usar: () => { E.combustible = Math.min(100, E.combustible + 40); } },
  { id: 'escudo', n: 'Célula de escudo', d: 'Escudo al 100 %', coste: { cristal: 3, ferrita: 2 }, usar: () => { E.escudo = 100; } },
  { id: 'traje', n: 'Recarga de traje', d: 'Soporte vital al 100 %', coste: { carbono: 4 }, usar: () => { E.traje = 100; } },
  { id: 'base', n: 'Módulo de base', d: 'Planta una base donde estés (a pie)', coste: { ferrita: 10, carbono: 6 }, usar: null },
];
export const IMPLANTES = {
  termica: { n: 'Visión térmica', d: 'Las criaturas brillan a través del terreno (tecla T).', precio: 900 },
  dobleSalto: { n: 'Propulsores de tobillo', d: 'Doble salto a pie.', precio: 700 },
  escanerPlus: { n: 'Escáner cuántico', d: 'Escáner con el doble de alcance.', precio: 1100 },
  pielBlindada: { n: 'Piel blindada', d: 'La mitad de daño a pie (criaturas y clima).', precio: 1300 },
};
const COLORES = ['#2a2f45', '#e8ecf5', '#101114', '#3a0d4f', '#0d3b2a', '#4a1414'], ACENTOS = ['#ff2e88', '#00f0ff', '#b4ff39', '#ffd23f', '#ff7a00', '#9b5de5'];
export const HISTORIA = [
  { t: 'Una señal en el ruido', d: 'Tu receptor capta una transmisión cifrada que se repite cada 7,3 segundos. Viene del sector 0 · 0 · −48. Nadie en la estación sabe qué es. Visita otro sistema para triangular su origen.', ok: () => E.visitados.length >= 2 },
  { t: 'Firma biológica', d: 'La señal cambia cuando escaneas vida. Como si respondiera. Escanea tres especies distintas.', ok: () => E.escaneados >= 3 },
  { t: 'Los que estuvieron antes', d: 'Las ruinas de los planetas tienen terminales con el mismo patrón que la señal. Hackea uno.', ok: () => (E.hackeos || 0) >= 1 },
  { t: 'El rastro', d: 'El terminal contenía coordenadas parciales. La expedición de esta semana va hacia allí: llega a su sector (marcado en dorado en el mapa).', ok: () => E.expedicion === expedicionSemana().semana },
  { t: 'Más cerca', d: 'Cada salto hacia la Señal la vuelve más nítida. Acércate 5 sectores más a ella desde donde empezaste.', ok: () => (E.cercaSenal || 0) >= 5 },
  { t: 'Continuará…', d: 'La Señal ya no es ruido: es una voz. Dice tu nombre. (El siguiente capítulo llegará en una actualización.)', ok: () => false },
];

let audio = null, alCambiarNave = null, alPlantarBase = null, juego = null;
export function iniciarUI(opc) { ({ audio, alCambiarNave, alPlantarBase, juego } = opc); }

function panel(titulo, pestanas, activa, alCerrar) {
  const p = $('#panel'); p.classList.add('visible');
  p.innerHTML = `<div class="cab"><b>${titulo}</b><div class="pest">${pestanas.map(([id, n]) => `<button data-p="${id}" class="${id === activa ? 'sel' : ''}">${n}</button>`).join('')}</div><button class="cerrar">✕</button></div><div class="cuerpo"></div>`;
  p.querySelector('.cerrar').onclick = () => { cerrarPanel(); alCerrar?.(); };
  return p;
}
export function cerrarPanel() { $('#panel').classList.remove('visible'); $('#panel').innerHTML = ''; juego.enMenu = false; }
const costeTxt = (c) => Object.entries(c).map(([r, n]) => `<span style="color:${RECURSOS[r].c}">${n} ${RECURSOS[r].n.toLowerCase()}</span>`).join(' + ');
const puede = (c) => Object.entries(c).every(([r, n]) => (E.inventario[r] || 0) >= n);
const pagar = (c) => { for (const [r, n] of Object.entries(c)) anadir(r, -n); };

// ─── Menú del jugador ────────────────────────────────────────────────────────────────────
export function abrirMenu(pest = 'mapa') {
  juego.enMenu = true;
  const p = panel('MENÚ', [['mapa', 'Mapa'], ['inv', 'Inventario'], ['bit', 'Bitácora'], ['cuenta', 'Cuenta']], pest);
  p.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { audio.boton(); abrirMenu(b.dataset.p); });
  const c = p.querySelector('.cuerpo');
  if (pest === 'mapa') {
    const exp = expedicionSemana();
    c.innerHTML = `<canvas id="mapaCv"></canvas><div class="lado">
      <p>Toca una estrella para marcarla como destino. Luego apunta la nave a su marca verde en el cielo y pulsa <b>SALTO</b>.</p>
      <p class="tenue">Cada sector saltado gasta ${COSTE_SECTOR} % de combustible. Tienes <b>${Math.round(E.combustible)} %</b>.</p>
      <p><span style="color:#ffd23f">◯</span> Expedición de la semana: sector <b>${exp.sector.join(' · ')}</b> (+500 créditos)</p>
      <p><span style="color:#ff2e88">◆</span> La Señal: sector 0 · 0 · −48</p>
      <p id="mapaSel" class="tenue"></p></div>`;
    const cv = $('#mapaCv');
    requestAnimationFrame(() => {
      const elegir = dibujarMapa(cv, juego.sector, E, juego.destino);
      cv.onclick = (e) => {
        const r = cv.getBoundingClientRect(), s = elegir((e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio);
        if (!s || s.join() === juego.sector.join()) return;
        juego.destino = s; audio.boton();
        const d = Math.hypot(s[0] - juego.sector[0], s[1] - juego.sector[1], s[2] - juego.sector[2]);
        $('#mapaSel').innerHTML = `Destino: <b>${nombre(hash(hash(...s, 7), 1), false)}</b> (${s.join(' · ')}) · ${d.toFixed(1)} sectores · ${Math.ceil(d * COSTE_SECTOR)} % de combustible`;
        dibujarMapa(cv, juego.sector, E, juego.destino);
      };
    });
  } else if (pest === 'inv') {
    c.innerHTML = `<div class="col"><h4>Bodega ${cargaTotal()}/${capacidad()}</h4>${Object.entries(RECURSOS).map(([k, r]) => `<div class="fila"><i style="background:${r.c}"></i>${r.n}<b>${E.inventario[k] || 0}</b></div>`).join('')}
      <h4>Estado</h4><div class="fila">Casco<b>${Math.round(E.casco)} %</b></div><div class="fila">Escudo<b>${Math.round(E.escudo)} %</b></div><div class="fila">Combustible<b>${Math.round(E.combustible)} %</b></div><div class="fila">Traje<b>${Math.round(E.traje)} %</b></div><div class="fila">Créditos<b>${E.creditos} ¢</b></div></div>
      <div class="col"><h4>Fabricar</h4>${RECETAS.map(r => `<div class="receta"><div><b>${r.n}</b><small>${r.d}</small><small>${costeTxt(r.coste)}</small></div><button data-r="${r.id}" ${puede(r.coste) ? '' : 'disabled'}>Fabricar</button></div>`).join('')}</div>`;
    c.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
      const r = RECETAS.find(x => x.id === b.dataset.r); if (!puede(r.coste)) return;
      if (r.id === 'base') { if (!alPlantarBase()) return; pagar(r.coste); }
      else { pagar(r.coste); r.usar(); }
      audio.recoger(); guardar(); abrirMenu('inv');
    });
  } else if (pest === 'bit') {
    const desc = Object.entries(E.descubiertos).slice(-40).reverse();
    c.innerHTML = `<div class="col"><h4>La Señal</h4>${HISTORIA.slice(0, E.historia.paso + 1).map((h, k) => `<div class="nota ${k < E.historia.paso ? 'hecha' : ''}"><b>${k < E.historia.paso ? '✓ ' : '▸ '}${h.t}</b><small>${h.d}</small></div>`).join('')}</div>
      <div class="col"><h4>Descubrimientos (${Object.keys(E.descubiertos).length})</h4>${desc.map(([, d]) => `<div class="fila"><span>${d.tipo === 'planeta' ? '🪐' : d.tipo === 'criatura' ? '🦎' : '🏛️'} ${d.nombre}</span><small>${d.por ? 'por @' + d.por : ''}</small></div>`).join('') || '<p class="tenue">Escanea planetas, criaturas y ruinas.</p>'}
      <h4>Récords de anillos</h4>${Object.entries(E.records).map(([s, t]) => `<div class="fila">Sector ${s}<b>${t.toFixed(2)} s</b></div>`).join('') || '<p class="tenue">Cruza el anillo verde junto a la estación para empezar una carrera.</p>'}</div>`;
  } else if (pest === 'cuenta') {
    c.innerHTML = `<div class="col"><h4>Cuenta de UpGames</h4>${token() ? '<p>Sesión iniciada: tu partida se guarda en la nube, tus descubrimientos llevan tu nombre y te ven los demás jugadores.</p>' : '<p>Inicia sesión en <a href="https://upgames.games" target="_blank">upgames.games</a> para guardar en la nube, registrar descubrimientos y jugar online.</p>'}
      <p class="tenue">Jugadores en tu sector: ${juego.online?.otros.size || 0}${juego.online?.conectado ? '' : ' (sin conexión)'}</p></div>
      <div class="col"><h4>Controles</h4><p class="tenue">Teclado: W/S acelerador (se queda donde lo dejas) · X parar · ratón o ↑↓←→ dirección · Q/E alabeo · Mayús turbo · Espacio pulso · clic o K disparar · L aterrizar · F bajar/subir · R escanear · J salto · M mapa · I inventario · C cámara · T visión térmica.</p></div>`;
  }
}

// ─── Estación ──────────────────────────────────────────────────────────────────────────────
export function abrirEstacion(sis, pest = 'reparar') {
  juego.enMenu = true;
  const f = sis.faccion, pr = (n) => Math.round(n * f.precio);
  const p = panel(`${sis.estacion.nombre.toUpperCase()} · <span style="color:${f.color}">${f.nombre}</span>`, [['reparar', 'Reparar'], ['mercado', 'Mercado'], ['implantes', 'Implantes'], ['astillero', 'Astillero'], ['misiones', 'Misiones'], ['terminal', 'Terminal']], pest, () => juego.desatracar());
  p.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { audio.boton(); abrirEstacion(sis, b.dataset.p); });
  const c = p.querySelector('.cuerpo');
  const pie = `<p class="tenue">Créditos: <b>${E.creditos} ¢</b> · Reputación: ${Object.entries(E.reputacion).map(([k, v]) => `${k === 'corp' ? 'Corp.' : k === 'sind' ? 'Sind.' : 'IA'} ${v}`).join(' · ')}</p>`;
  if (pest === 'reparar') {
    const coste = pr(Math.ceil((100 - E.casco) * 6 + (100 - E.escudo) * 2));
    c.innerHTML = `<div class="col"><p>${f.desc}</p><div class="fila">Casco<b>${Math.round(E.casco)} %</b></div><div class="fila">Escudo<b>${Math.round(E.escudo)} %</b></div><div class="fila">Combustible<b>${Math.round(E.combustible)} %</b></div><div class="fila">Traje<b>${Math.round(E.traje)} %</b></div>
      <button id="bRep" ${coste > E.creditos || coste === 0 ? 'disabled' : ''}>Reparar casco y escudo · ${coste} ¢</button>
      <button id="bComb" ${E.creditos < pr(150) || E.combustible >= 100 ? 'disabled' : ''}>Llenar combustible · ${pr(150)} ¢</button>${pie}</div>`;
    $('#bRep').onclick = () => { E.creditos -= coste; E.casco = 100; E.escudo = 100; E.traje = 100; audio.recoger(); guardar(); abrirEstacion(sis, pest); };
    $('#bComb').onclick = () => { E.creditos -= pr(150); E.combustible = 100; audio.recoger(); guardar(); abrirEstacion(sis, pest); };
  } else if (pest === 'mercado') {
    c.innerHTML = `<div class="col"><h4>Vender</h4>${Object.entries(RECURSOS).map(([k, r]) => `<div class="fila"><i style="background:${r.c}"></i>${r.n} (${E.inventario[k] || 0})<button data-v="${k}" ${E.inventario[k] ? '' : 'disabled'}>Vender todo · ${pr(r.precio) * (E.inventario[k] || 0)} ¢</button></div>`).join('')}</div>
      <div class="col"><h4>Comprar</h4><div class="fila">Célula de plasma<button data-c="plasma" ${E.creditos < pr(90) ? 'disabled' : ''}>${pr(90)} ¢</button></div><div class="fila">Ferrita ×10<button data-c="ferrita" ${E.creditos < pr(130) ? 'disabled' : ''}>${pr(130)} ¢</button></div>${pie}</div>`;
    c.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { const k = b.dataset.v; E.creditos += pr(RECURSOS[k].precio) * E.inventario[k]; E.inventario[k] = 0; audio.recoger(); guardar(); abrirEstacion(sis, pest); });
    c.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { const k = b.dataset.c; if (k === 'plasma') { E.creditos -= pr(90); anadir('plasma', 1); } else { E.creditos -= pr(130); anadir('ferrita', 10); } audio.recoger(); guardar(); abrirEstacion(sis, pest); });
  } else if (pest === 'implantes') {
    const desc = f.id === 'ia' ? 0.8 : 1;
    c.innerHTML = `<div class="col">${Object.entries(IMPLANTES).map(([k, i]) => `<div class="receta"><div><b>${i.n}</b><small>${i.d}</small></div>${E.implantes[k] ? '<span class="ok">Instalado</span>' : `<button data-i="${k}" ${E.creditos < Math.round(i.precio * desc) ? 'disabled' : ''}>${Math.round(i.precio * desc)} ¢</button>`}</div>`).join('')}${f.id === 'ia' ? '<p class="tenue">El Colectivo IA te hace un 20 % de descuento.</p>' : ''}${pie}</div>`;
    c.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const k = b.dataset.i; E.creditos -= Math.round(IMPLANTES[k].precio * desc); E.implantes[k] = true; audio.descubrir(); guardar(); abrirEstacion(sis, pest); });
  } else if (pest === 'astillero') {
    c.innerHTML = `<div class="col"><h4>Modelos</h4>${Object.entries(MODELOS).map(([k, m]) => `<div class="receta"><div><b>${m.nombre}</b><small>${m.desc}</small></div>${E.nave.modelo === k ? '<span class="ok">Tu nave</span>' : `<button data-m="${k}" ${E.creditos < pr(m.precio) ? 'disabled' : ''}>${m.precio ? pr(m.precio) + ' ¢' : 'Gratis'}</button>`}</div>`).join('')}</div>
      <div class="col"><h4>Pintura (150 ¢)</h4><div class="paleta">${COLORES.map(c => `<i data-cc="${c}" style="background:${c}"></i>`).join('')}</div><h4>Neón</h4><div class="paleta">${ACENTOS.map(c => `<i data-ca="${c}" style="background:${c}"></i>`).join('')}</div>${pie}</div>`;
    c.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const k = b.dataset.m; E.creditos -= pr(MODELOS[k].precio); E.nave.modelo = k; alCambiarNave(); audio.descubrir(); guardar(); abrirEstacion(sis, pest); });
    const pintar = (campo, v) => { if (E.creditos < 150) return; E.creditos -= 150; if (campo === 'acento') { E.nave.colores.acento = v; E.nave.colores.luz = v === '#ff2e88' ? '#00f0ff' : v; } else E.nave.colores.casco = v; alCambiarNave(); audio.boton(); guardar(); abrirEstacion(sis, pest); };
    c.querySelectorAll('[data-cc]').forEach(b => b.onclick = () => pintar('casco', b.dataset.cc));
    c.querySelectorAll('[data-ca]').forEach(b => b.onclick = () => pintar('acento', b.dataset.ca));
  } else if (pest === 'misiones') {
    const lista = misionesDe(sis);
    c.innerHTML = `<div class="col">${lista.map((m, k) => { const act = E.misiones.find(x => x.id === m.id); const hecha = act && progreso(act) >= m.n;
      return `<div class="receta"><div><b>${m.t}</b><small>${m.d} · Recompensa: ${m.premio} ¢</small>${act ? `<small>Progreso: ${Math.min(m.n, progreso(act))}/${m.n}</small>` : ''}</div>${act?.cobrada ? '<span class="ok">Cobrada</span>' : hecha ? `<button data-cobrar="${k}">Cobrar</button>` : act ? '<span class="tenue">En curso</span>' : `<button data-acc="${k}">Aceptar</button>`}</div>`; }).join('')}${pie}</div>`;
    c.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => { const m = lista[+b.dataset.acc]; E.misiones.push({ id: m.id, tipo: m.tipo, base: contador(m.tipo, m), objetivo: m.objetivo }); guardar(); abrirEstacion(sis, pest); });
    c.querySelectorAll('[data-cobrar]').forEach(b => b.onclick = () => { const m = lista[+b.dataset.cobrar], act = E.misiones.find(x => x.id === m.id); act.cobrada = true; E.creditos += m.premio; E.reputacion[f.id] += 3; audio.descubrir(); guardar(); abrirEstacion(sis, pest); });
  } else if (pest === 'terminal') {
    c.innerHTML = `<div class="col"><p>Terminal de datos de la estación. Hackearlo da créditos, pero ${f.id === 'corp' ? 'la Corporación no lo verá con buenos ojos' : 'aquí a nadie le importa'}.</p><button id="bHack">Hackear</button>${pie}</div>`;
    $('#bHack').onclick = () => hackeo(f.id === 'sind' ? 2 : 1, (ok) => { if (ok) { E.creditos += f.id === 'sind' ? 400 : 200; E.reputacion.sind += 2; if (f.id === 'corp') E.reputacion.corp -= 3; E.hackeos = (E.hackeos || 0) + 1; } guardar(); abrirEstacion(sis, 'terminal'); });
  }
}

// misiones deterministas de cada estación
export function misionesDe(sis) {
  const r = azar(hash(sis.semilla, 88)), out = [];
  const tipos = [['escanear', 'Biólogo de campo', 'Escanea {n} especies'], ['piratas', 'Caza de piratas', 'Derriba {n} cazas piratas'], ['minar', 'Pedido de cristal', 'Consigue {n} cristales de neón'], ['visitar', 'Mensajería', 'Visita {n} sistemas nuevos']];
  for (let k = 0; k < 3; k++) {
    const [tipo, t, d] = tipos[Math.floor(r() * tipos.length)], n = tipo === 'piratas' ? 2 + Math.floor(r() * 3) : tipo === 'visitar' ? 1 + Math.floor(r() * 2) : 3 + Math.floor(r() * 6);
    out.push({ id: `${sis.semilla}:${k}`, tipo, t, d: d.replace('{n}', n), n, premio: 150 + n * 70 });
  }
  return out;
}
function contador(tipo) { return tipo === 'escanear' ? E.escaneados : tipo === 'piratas' ? E.piratas : tipo === 'minar' ? (E.minadoCristal || 0) : E.visitados.length; }
function progreso(act) { return contador(act.tipo) - act.base; }

// ─── Minijuego de hackeo: memorizar una secuencia de símbolos ───────────────────────────────
export function hackeo(dificultad, fin) {
  const SIMB = ['◆', '▲', '●', '■', '✚', '⬢'], n = 3 + dificultad, sec = Array.from({ length: n }, () => Math.floor(Math.random() * SIMB.length));
  const h = $('#hack'); h.classList.add('visible');
  h.innerHTML = `<b>HACKEO</b><div class="sec">${sec.map(i => `<span>${SIMB[i]}</span>`).join('')}</div><small>Memoriza la secuencia…</small><div class="botones">${SIMB.map((s, i) => `<button data-s="${i}" disabled>${s}</button>`).join('')}</div>`;
  let pos = 0;
  setTimeout(() => {
    h.querySelector('.sec').innerHTML = sec.map(() => '<span>?</span>').join(''); h.querySelector('small').textContent = 'Repítela';
    h.querySelectorAll('[data-s]').forEach(b => { b.disabled = false; b.onclick = () => {
      audio.boton();
      if (+b.dataset.s !== sec[pos]) { h.querySelector('small').textContent = '✕ ACCESO DENEGADO'; audio.alarma(); setTimeout(() => { h.classList.remove('visible'); fin(false); }, 900); return; }
      h.querySelectorAll('.sec span')[pos].textContent = SIMB[sec[pos]]; pos++;
      if (pos === n) { h.querySelector('small').textContent = '✓ ACCESO CONCEDIDO'; audio.descubrir(); setTimeout(() => { h.classList.remove('visible'); fin(true); }, 900); }
    }; });
  }, 1400 + n * 350);
}

// ─── Ficha de descubrimiento (con nombre editable) ──────────────────────────────────────────
export function ficha(d, alNombrar) {
  const f = $('#ficha'); f.classList.add('visible');
  f.innerHTML = `<small>${d.tipo === 'criatura' ? 'NUEVA ESPECIE' : d.tipo === 'planeta' ? 'NUEVO PLANETA' : 'RUINA ANTIGUA'}</small>
    <input id="fNombre" value="${d.nombre}" maxlength="28"><div class="datos">${d.datos.map(([k, v]) => `<span>${k}<b>${v}</b></span>`).join('')}</div>
    ${d.por ? `<p class="tenue">Descubierto por @${d.por}</p>` : token() ? '<p class="tenue">Eres el primero: ponle nombre y regístralo para todos.</p>' : '<p class="tenue">Inicia sesión en UpGames para registrarlo con tu nombre.</p>'}
    <div class="acc"><button id="fOk">${d.por ? 'Cerrar' : 'Registrar'}</button></div>`;
  const inp = $('#fNombre'); inp.disabled = !!d.por;
  $('#fOk').onclick = () => { f.classList.remove('visible'); if (!d.por) alNombrar(inp.value.trim() || d.nombre); };
  clearTimeout(ficha._t); ficha._t = setTimeout(() => { if (document.activeElement !== inp) f.classList.remove('visible'); }, 12000);
}
