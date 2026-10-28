/* ══════════════════════════════════════════════════════════════════
   UpGames · Pagos — un componente para todos los cobros.
   Métodos, en este orden:
     1. 💳 Tarjeta de crédito o débito — Mercado Pago (Card Payment Brick);
        si Mercado Pago no está activo, el botón de tarjeta de PayPal.
     2. PayPal.
     3. UpCoins (los comprados y los ganados como creador: una sola moneda).
   Los formularios de tarjeta los dibujan Mercado Pago / PayPal: los datos de la
   tarjeta nunca pasan por UpGames.
   Uso:
     UGPagos.pagar(el, { producto: 'plan:pase30', alExito })
     UGPagos.tienda(el, { alComprar })        // paquetes de UpCoins
     UGPagos.planes(el, { alComprar })        // Premium
   ══════════════════════════════════════════════════════════════════ */
'use strict';
(() => {
  if (window.UGPagos) return;
  const API = (window.UG_CONFIG && window.UG_CONFIG.API_URL) || 'https://upgames-production.up.railway.app';
  const token = () => { try { return localStorage.getItem('token') || ''; } catch (_) { return ''; } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n); };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
  const local = (monto, moneda) => { try { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: moneda, maximumFractionDigits: moneda === 'COP' || moneda === 'CLP' ? 0 : 2 }).format(monto); } catch (_) { return `${moneda} ${monto}`; } };

  async function api(path, opts = {}) {
    const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.success === false) { const e = new Error(d.error || 'Error de conexión'); e.status = r.status; e.data = d; throw e; }
    return d;
  }
  // Reporta al servidor un fallo que solo ocurre en el navegador del usuario
  const diag = (nombre, mensaje, contexto = '') => {
    try { fetch(API + '/live/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'pagos', nombre, mensaje: String(mensaje).slice(0, 240), contexto }), keepalive: true }).catch(() => {}); } catch (_) {}
  };

  const css = `
  .ugp{display:flex;flex-direction:column;gap:10px;font-family:inherit}
  .ugp-card{position:relative;padding:14px;border-radius:16px;background:linear-gradient(135deg,rgba(50,213,131,.16),rgba(90,200,250,.10));border:1.5px solid rgba(50,213,131,.55);box-shadow:0 10px 30px -14px rgba(50,213,131,.6)}
  .ugp-card-h{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .ugp-card-h b{font-size:1rem;color:#fff;display:block;line-height:1.25}
  .ugp-card-h small{display:block;color:#A3A8B6;font-size:.75rem;margin-top:2px}
  .ugp-ic{width:40px;height:40px;border-radius:12px;background:#32D583;color:#06210f;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0}
  .ugp-tag{position:absolute;top:-9px;right:12px;padding:2px 8px;border-radius:6px;background:#32D583;color:#06210f;font-size:.62rem;font-weight:800;letter-spacing:.04em}
  .ugp-brands{display:flex;gap:6px;margin:-2px 0 10px 50px;flex-wrap:wrap}
  .ugp-brands span{padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);font-size:.62rem;font-weight:800;letter-spacing:.04em;color:#dfe3ea}
  .ugp-precio{margin-left:auto;text-align:right;font-weight:800;color:#fff;font-size:1rem;white-space:nowrap}
  .ugp-precio small{display:block;color:#A3A8B6;font-size:.68rem;font-weight:600}
  .ugp-or{display:flex;align-items:center;gap:10px;color:#6C7180;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
  .ugp-or::before,.ugp-or::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.1)}
  .ugp-resumen{padding:11px 13px;border-radius:12px;background:rgba(90,200,250,.07);border:1px solid rgba(90,200,250,.22);font-size:.82rem;line-height:1.5;color:#dfe6f2}
  .ugp-resumen small{display:block;margin-top:6px;color:#9aa3b5;font-size:.72rem}.ugp-resumen a{color:#5AC8FA}
  .ugp-safe{font-size:.72rem;color:#8a90a0;line-height:1.5;text-align:center;margin:0}
  .ugp-msg{font-size:.8rem;color:#A3A8B6;text-align:center;padding:10px;border-radius:12px;background:rgba(255,255,255,.04);margin:0}
  .ugp-msg.warn{color:#ffd27a;background:rgba(255,204,77,.08);border:1px solid rgba(255,204,77,.22)}
  .ugp-msg.ok{color:#7ff0b5;background:rgba(50,213,131,.1);border:1px solid rgba(50,213,131,.3)}
  .ugp-load{height:48px;border-radius:24px;background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.1),rgba(255,255,255,.05));background-size:200% 100%;animation:ugpSk 1.2s infinite}
  @keyframes ugpSk{to{background-position:-200% 0}}
  .ugp-alt{display:flex;align-items:center;gap:10px;width:100%;padding:12px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#fff;font:inherit;font-weight:700;font-size:.88rem;cursor:pointer;text-align:left}
  .ugp-alt:disabled{opacity:.5;cursor:default}
  .ugp-alt small{display:block;color:#A3A8B6;font-weight:500;font-size:.72rem}
  .ugp-alt .e{font-size:1.3rem}
  .ugp-alt .p{margin-left:auto;color:#ffcc4d;white-space:nowrap}
  .ugp-packs{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px}
  .ugp-pack{position:relative;padding:14px 8px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);text-align:center;cursor:pointer;color:inherit;font:inherit;transition:border-color .15s,background .15s,transform .12s}
  .ugp-pack:active{transform:scale(.97)}
  .ugp-pack.on{border-color:#ffcc4d;background:rgba(255,204,77,.09)}
  .ugp-pack .m{font-size:1.1rem;font-weight:800;color:#ffcc4d}
  .ugp-pack .u{font-size:.82rem;color:#A3A8B6;font-weight:700;margin-top:2px}
  .ugp-pack .x{position:absolute;top:-8px;right:8px;padding:2px 6px;border-radius:6px;background:#32D583;color:#06210f;font-size:.62rem;font-weight:800}
  .ugp-plan .m{color:#5AC8FA}
  .ugp-bal{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:14px;background:rgba(255,204,77,.08);border:1px solid rgba(255,204,77,.22)}
  .ugp-bal b{font-size:1.4rem;color:#ffcc4d}
  .ugp-bal small{color:#A3A8B6;font-size:.75rem}
  .ugp-mp{min-height:60px}
  .ugp-uc{border-color:rgba(255,204,77,.35)!important;background:rgba(255,204,77,.07)!important}
  .ugp-fiesta{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);backdrop-filter:blur(5px);padding:16px}
  .ugp-fiesta-c{width:min(380px,100%);text-align:center;background:linear-gradient(160deg,#16202a,#0e1117);border:1px solid rgba(255,204,77,.4);border-radius:22px;padding:26px 20px;color:#eef1f6;animation:ugpPop .35s cubic-bezier(.2,1.4,.4,1)}
  .ugp-fiesta-ic{font-size:3.2rem;animation:ugpBrillo 1.6s ease-in-out infinite}
  .ugp-fiesta-c b{display:block;font-size:1.25rem;margin:8px 0 6px}.ugp-fiesta-c p{margin:0 0 16px;color:#b9c0cd;font-size:.9rem;line-height:1.5}
  .ugp-fiesta-c button{border:0;border-radius:12px;padding:12px 26px;background:#32D583;color:#04110a;font-weight:800;font-size:.95rem;cursor:pointer;font-family:inherit}
  @keyframes ugpPop{from{transform:scale(.6);opacity:0}}@keyframes ugpBrillo{50%{transform:scale(1.15);filter:drop-shadow(0 0 14px rgba(255,204,77,.8))}}`;
  function estilos() { if (document.getElementById('ugp-css')) return; const s = document.createElement('style'); s.id = 'ugp-css'; s.textContent = css; document.head.appendChild(s); }

  const MOTIVOS = {
    sin_configurar: 'Los pagos con tarjeta se están activando. Vuelve en unos minutos.',
    credenciales_invalidas: 'Los pagos con tarjeta están en mantenimiento en este momento. Puedes pagar con tus UpCoins.',
    no_disponible: 'El procesador de pagos no responde en este momento. Inténtalo de nuevo en unos minutos.',
  };

  let cat = null;
  const catalogo = () => (cat = cat || api('/tienda/catalogo').catch(e => { cat = null; throw e; }));
  // Compatibilidad: el live usaba /live/config
  const config = catalogo;

  function cargarScript(src, global) {
    if (window[global]) return Promise.resolve(window[global]);
    return new Promise((ok, ko) => {
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = () => ok(window[global]);
      s.onerror = () => { s.remove(); diag('sdk_no_carga', src.split('?')[0], navigator.onLine ? 'online' : 'offline'); ko(new Error(navigator.onLine ? 'No se pudo cargar el procesador de pagos. Si usas un bloqueador de anuncios, desactívalo en esta página e inténtalo de nuevo.' : 'Sin conexión a internet. Conéctate e inténtalo de nuevo.')); };
      document.head.appendChild(s);
    });
  }
  const cargarPayPal = id => cargarScript(`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(id)}&currency=USD&intent=capture&components=buttons,funding-eligibility&enable-funding=card&disable-funding=paylater,venmo`, 'paypal');
  const cargarMP = () => cargarScript('https://sdk.mercadopago.com/js/v2', 'MercadoPago');

  /** Precio en USD del producto según el catálogo (el servidor vuelve a calcularlo al cobrar). */
  function usdDe(c, producto) {
    const [t, id] = producto.split(':');
    if (t === 'monedas') return c.paquetes.find(x => x.id === id).usd;
    if (t === 'plan') return c.planes.find(x => x.id === id).usd;
    if (t === 'acceso') return c.acceso.usd;
    return (ucDe(c, producto) || 0) * c.monedaUsd;
  }
  /** Precio en UpCoins (null: se compra con dinero, p. ej. un paquete de UpCoins). */
  function ucDe(c, producto) {
    const [t, id] = producto.split(':');
    if (t === 'plan') return c.planes.find(x => x.id === id).monedas;
    if (t === 'acceso') return c.acceso.monedas;
    if (t === 'ia') return c.ia?.find(x => x.id === id)?.monedas ?? null;
    if (t === 'impulso') return c.impulso?.monedas ?? null;
    return null;
  }
  const soloUC = producto => /^(ia|impulso):/.test(producto);

  /** Celebración al terminar una compra (la notificación queda además en la campana). */
  function celebrar(d, producto) {
    const t = producto.split(':')[0];
    const [ic, titulo, sub] = t === 'plan' ? ['⭐', '¡Has desbloqueado Premium!', `Activo hasta el ${new Date(d.hasta).toLocaleDateString('es-CO')}: sin anuncios, NEXUS ilimitado y más visibilidad.${d.monedasRegalo ? ` + 🪙 ${fmt(d.monedasRegalo)} UpCoins de regalo.` : ''}`]
      : t === 'monedas' ? ['🪙', `¡Has adquirido ${fmt(d.acreditadas || 0)} UpCoins!`, `${d.bono ? `Incluye ${fmt(d.bono)} extra por ser Premium. ` : ''}Úsalos en lives, NEXUS IA, Premium o para destacar tus publicaciones.`]
      : t === 'ia' ? ['🧠', `+${d.mensajes} mensajes de NEXUS`, 'Ya puedes seguir conversando.']
      : t === 'impulso' ? ['🚀', '¡Publicación destacada!', `Aparece arriba en el inicio hasta el ${new Date(d.destacadoHasta).toLocaleString('es-CO')}.`]
      : ['⚡', '¡Acceso directo desbloqueado!', 'El enlace se abre al instante, sin espera ni anuncios.'];
    const o = document.createElement('div');
    o.className = 'ugp-fiesta'; o.setAttribute('role', 'dialog');
    o.innerHTML = `<div class="ugp-fiesta-c"><div class="ugp-fiesta-ic">${ic}</div><b>${esc(titulo)}</b><p>${esc(sub)}</p><button type="button">¡Genial!</button></div>`;
    o.onclick = e => { if (e.target === o || e.target.tagName === 'BUTTON') o.remove(); };
    document.body.appendChild(o);
    setTimeout(() => o.remove(), 9000);
    try { window.dispatchEvent(new CustomEvent('ug:upcoins')); } catch (_) {}   // refrescar contadores
  }
  const localDe = (c, producto) => c.local ? c.local[producto] ?? (producto.startsWith('acceso:') ? c.local.acceso : null) : null;

  /**
   * Monta todas las formas de pago para un producto.
   * opts: { producto, alExito(resultado), alError?(msg), saldo?: bool, monedas?: bool, estado?: {saldo, monedas, saldoBloqueado} }
   */
  async function pagar(el, opts) {
    estilos();
    el.innerHTML = '<div class="ugp"><div class="ugp-load"></div></div>';
    let c, est = opts.estado;
    try { [c, est] = await Promise.all([catalogo(), est ? Promise.resolve(est) : (token() ? api('/tienda/mi-plan').catch(() => null) : null)]); }
    catch (e) { el.innerHTML = `<p class="ugp-msg warn">${esc(e.message)}</p>`; return; }
    const m = c.metodos, producto = opts.producto;
    const aviso = msg => { el.querySelector('[data-ugp="aviso"]').innerHTML = msg ? `<p class="ugp-msg warn">${esc(msg)}</p>` : ''; (opts.alError || (() => {}))(msg); };
    const exito = d => { if (d?.hasta) try { localStorage.setItem('ug_pase_hasta', localStorage.getItem('user_admin') + '|' + (+new Date(d.hasta))); } catch (_) {}
      el.querySelector('[data-ugp="aviso"]').innerHTML = '<p class="ugp-msg ok">✅ ¡Pago confirmado!</p>';
      celebrar(d, producto); opts.alExito?.(d); };
    const plan = producto.startsWith('plan:') ? c.planes.find(x => `plan:${x.id}` === producto) : null;
    const precioUC = ucDe(c, producto);
    const ucs = est?.upcoins || { total: est?.monedas || 0, bloqueadas: false };
    const puedeUC = precioUC != null && opts.monedas !== false && est;
    const conDinero = !soloUC(producto);

    // Lo que recibe, dicho antes de pagar (Ley 1480: información clara y previa)
    const paq = producto.startsWith('monedas:') ? c.paquetes.find(x => `monedas:${x.id}` === producto) : null;
    const pIA = producto.startsWith('ia:') ? c.ia?.find(x => `ia:${x.id}` === producto) : null;
    const recibes = plan ? `<b>${esc(plan.nombre)}</b> durante ${plan.dias} días: sin anuncios y enlaces directos, NEXUS IA ilimitado, más visibilidad para tus publicaciones, +10% de UpCoins en cada paquete e insignia ⭐ en los lives. <b>Pagando con dinero</b> recibes además 🪙 ${fmt(plan.monedasRegalo || 0)} UpCoins de regalo. Los días se suman si ya eres Premium.`
      : paq ? `<b>🪙 ${fmt(paq.monedas)} UpCoins</b>${est?.plan ? ` + ${fmt(paq.bonoPase ?? Math.floor(paq.monedas * (c.bonoPaquete || 0.1)))} extra por ser Premium` : ''}, para regalos en lives, NEXUS IA, Premium, accesos directos o destacar tus publicaciones. No vencen.`
      : pIA ? `<b>${pIA.mensajes} mensajes de NEXUS IA</b> para usar cuando se acaben tus mensajes gratis del día. No vencen.`
      : producto.startsWith('impulso:') ? `<b>Destacar tu publicación ${c.impulso.horas} horas</b>: aparece arriba en el inicio, marcada como "Promocionado".`
      : `<b>Acceso directo</b> a esta publicación: se abre al instante, sin espera ni anuncios, y queda desbloqueada en tu cuenta.`;
    const resumen = `<div class="ugp-resumen"><div>${recibes}</div><small>Pago único · <b>sin renovación automática</b> · retracto en 5 días hábiles si no lo has usado · <a href="./terminos_condiciones.html#pagos" target="_blank" rel="noopener">Términos</a></small></div>`;
    const usd = conDinero ? usdDe(c, producto) : 0;

    el.innerHTML = `<div class="ugp">
      ${resumen}
      <div data-ugp="aviso"></div>
      ${puedeUC ? `<button type="button" class="ugp-alt ugp-uc" data-ugp="upcoins" ${ucs.total < precioUC ? 'disabled' : ''}>
        <span class="e">🪙</span><span>Pagar con UpCoins<small>${ucs.total < precioUC ? `Tienes ${fmt(Math.floor(ucs.total))} · te faltan ${fmt(Math.ceil(precioUC - ucs.total))}` : `Tienes ${fmt(Math.floor(ucs.total))}`}${ucs.bloqueadas ? ' · los ganados están reservados por un retiro pendiente' : ''}</small></span><span class="p">${fmt(precioUC)} UC</span></button>` : ''}
      ${conDinero ? (m.tarjeta ? `<div class="ugp-card">
        <span class="ugp-tag">RECOMENDADO</span>
        <div class="ugp-card-h"><div class="ugp-ic">💳</div><div><b>Tarjeta de crédito o débito</b><small>${m.tarjeta === 'mercadopago' ? 'Visa, Mastercard, Amex, débito · Mercado Pago' : 'Sin cuenta de PayPal · en segundos'}</small></div>
          <div class="ugp-precio">US$${usd.toFixed(2)}${m.mercadopago && localDe(c, producto) ? `<small>${esc(local(localDe(c, producto), m.mercadopago.moneda))}</small>` : ''}</div></div>
        <div class="ugp-brands"><span>VISA</span><span>MASTERCARD</span><span>AMEX</span><span>DÉBITO</span></div>
        <div data-ugp="tarjeta" class="ugp-mp"><div class="ugp-load"></div></div>
      </div>` : `<p class="ugp-msg warn">${esc(MOTIVOS[c.pagos] || MOTIVOS.sin_configurar)}</p>`) : ''}
      ${conDinero && m.paypal && m.tarjeta === 'mercadopago' ? '<div class="ugp-or">o</div><div data-ugp="paypal"></div>' : ''}
      ${conDinero && m.tarjeta ? `<p class="ugp-safe">🔒 Pago cifrado. ${m.tarjeta === 'mercadopago' ? 'Mercado Pago' : 'PayPal'} procesa tu tarjeta: UpGames nunca ve ni guarda sus datos.</p>` : ''}
      ${!conDinero && ucs.total < precioUC ? `<button type="button" class="ugp-alt" data-ugp="recargar"><span class="e">➕</span><span>Conseguir UpCoins<small>Desde US$1,29 con tarjeta o PayPal</small></span></button>` : ''}
    </div>`;

    // UpCoins (instantáneo): primero los comprados, luego los ganados
    const bUC = el.querySelector('[data-ugp="upcoins"]');
    if (bUC) bUC.onclick = async () => {
      bUC.disabled = true;
      try { exito(await api('/tienda/pagar', { method: 'POST', body: { producto, metodo: 'upcoins', clave: uid() } })); }
      catch (e) { aviso(e.message); bUC.disabled = false; }
    };
    const bRec = el.querySelector('[data-ugp="recargar"]');
    if (bRec) bRec.onclick = () => tienda(el, { alComprar: () => pagar(el, opts) });
    if (!conDinero) return;

    // Tarjeta con Mercado Pago (Card Payment Brick)
    const caja = el.querySelector('[data-ugp="tarjeta"]');
    if (caja && m.tarjeta === 'mercadopago') {
      try {
        const MP = await cargarMP();
        const mp = new MP(m.mercadopago.publicKey, { locale: 'es-CO' });
        caja.id = caja.id || 'ugp-mp-' + uid().slice(0, 8);
        caja.innerHTML = '';
        await mp.bricks().create('cardPayment', caja.id, {
          initialization: { amount: localDe(c, producto) },
          customization: { paymentMethods: { maxInstallments: 1 }, visual: { style: { theme: 'dark' } } },
          callbacks: {
            onReady: () => {},
            onError: e => { diag('brick_error', e?.message || e?.type || 'error'); },
            onSubmit: formData => api('/pagos/mp/pagar', { method: 'POST', body: { producto, formData, clave: uid() } })
              .then(d => { if (d.estado === 'pendiente') aviso(d.mensaje); else exito(d); })
              .catch(e => { aviso(e.message); throw e; }),
          },
        });
      } catch (e) { caja.innerHTML = `<p class="ugp-msg warn">${esc(e.message || 'No se pudo cargar el pago con tarjeta')}</p>`; }
    }

    // PayPal (como botón de tarjeta si no hay Mercado Pago, o como segunda opción)
    const ppCaja = m.tarjeta === 'paypal' ? caja : el.querySelector('[data-ugp="paypal"]');
    if (ppCaja && m.paypal) {
      try {
        const cfgLive = await api('/live/config');
        if (!cfgLive.paypal) throw new Error(MOTIVOS[cfgLive.pagos] || MOTIVOS.sin_configurar);
        const pp = await cargarPayPal(cfgLive.paypal.clientId);
        ppCaja.innerHTML = '';
        const comunes = {
          createOrder: async () => (await api('/tienda/paypal/orden', { method: 'POST', body: { producto } })).orderID,
          onApprove: async (data, actions) => {
            try { exito(await api('/tienda/paypal/capturar', { method: 'POST', body: { orderID: data.orderID } })); }
            catch (e) { if (e.data?.reintentar) return actions.restart(); aviso(e.message); }
          },
          onError: err => { diag('boton_error', err?.message || err); aviso('No se pudo procesar el pago. Intenta de nuevo o usa otra tarjeta.'); },
        };
        const fuente = m.tarjeta === 'paypal' ? pp.FUNDING.CARD : pp.FUNDING.PAYPAL;
        const b = pp.Buttons({ ...comunes, fundingSource: fuente, style: { layout: 'vertical', shape: 'pill', height: 46, ...(fuente === pp.FUNDING.PAYPAL ? { color: 'gold', label: 'pay' } : {}) } });
        if (b.isEligible()) await b.render(ppCaja);
        else if (m.tarjeta === 'paypal') {
          const alt = pp.Buttons({ ...comunes, fundingSource: pp.FUNDING.PAYPAL, style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'pay', height: 46 } });
          ppCaja.insertAdjacentHTML('beforebegin', '<p class="ugp-msg">Pulsa el botón y elige <b>“Pagar con tarjeta de débito o crédito”</b> en la ventana segura.</p>');
          await alt.render(ppCaja);
        }
      } catch (e) { ppCaja.innerHTML = `<p class="ugp-msg warn">${esc(e.message)}</p>`; }
    }
  }

  /** Compatibilidad con la página puente anterior (PayPal con órdenes propias). */
  async function botones(el, opts) { return pagar(el, { producto: opts.producto || 'acceso:x', alExito: opts.alExito, alError: opts.alError }); }

  /** Tienda de monedas: saldo + paquetes + pago. */
  async function tienda(el, { alComprar, aviso } = {}) {
    estilos();
    if (!token()) { el.innerHTML = '<p class="ugp-msg">Inicia sesión para conseguir UpCoins.</p>'; return; }
    el.innerHTML = '<div class="ugp"><div class="ugp-load"></div></div>';
    let c, est;
    try { [c, est] = await Promise.all([catalogo(), api('/tienda/mi-plan')]); }
    catch (e) { el.innerHTML = `<p class="ugp-msg warn">${esc(e.message)}</p>`; return; }
    el.innerHTML = `<div class="ugp">
      <div class="ugp-bal"><div><small>Tus UpCoins</small><br><b data-ugp="bal">🪙 ${fmt(Math.floor(est.upcoins?.total ?? est.monedas))}</b></div><small style="text-align:right">${aviso || `1 UpCoin = US$0,02<br>úsalos en lives, NEXUS, Premium y más`}</small></div>
      <div class="ugp-packs">${c.paquetes.map(p => `<button type="button" class="ugp-pack" data-p="${esc(p.id)}">${p.extra ? `<span class="x">${esc(p.extra)}</span>` : ''}<div class="m">🪙 ${fmt(p.monedas)}</div><div class="u">US$${p.usd.toFixed(2)}</div></button>`).join('')}</div>
      <div data-ugp="pago"><p class="ugp-msg">Elige un paquete para pagar con tarjeta o PayPal.${est.plan ? ` <b style="color:#FFC83D">Por ser Premium recibes +${Math.round((c.bonoPaquete || 0.1) * 100)}% de UpCoins extra.</b>` : ''}</p></div>
      <p class="ugp-safe">Los UpCoins comprados se usan dentro de UpGames y no se cambian por dinero (los que ganas como creador sí se pueden retirar). Si no los usas, puedes retractarte en 5 días hábiles. <a href="./terminos_condiciones.html#pagos" target="_blank" style="color:#32D583">Términos</a></p>
    </div>`;
    el.querySelectorAll('.ugp-pack').forEach(b => b.onclick = () => {
      el.querySelectorAll('.ugp-pack').forEach(x => x.classList.toggle('on', x === b));
      pagar(el.querySelector('[data-ugp="pago"]'), {
        producto: `monedas:${b.dataset.p}`, estado: est, monedas: false,
        alExito: async d => { try { const e2 = await api('/tienda/mi-plan'); const bal = el.querySelector('[data-ugp="bal"]'); if (bal) bal.textContent = `🪙 ${fmt(Math.floor(e2.upcoins?.total ?? e2.monedas))}`; } catch (_) {} alComprar?.(d); },
      });
    });
  }

  /** Premium: elegir plan y pagarlo (con dinero o con UpCoins). */
  async function planes(el, { alComprar, estado } = {}) {
    estilos();
    el.innerHTML = '<div class="ugp"><div class="ugp-load"></div></div>';
    let c, est = estado;
    try { [c, est] = await Promise.all([catalogo(), est ? Promise.resolve(est) : api('/tienda/mi-plan')]); }
    catch (e) { el.innerHTML = `<p class="ugp-msg warn">${esc(e.message)}</p>`; return; }
    el.innerHTML = `<div class="ugp">
      <div class="ugp-packs">${c.planes.map(p => `<button type="button" class="ugp-pack ugp-plan" data-p="${esc(p.id)}">${p.destacado ? '<span class="x">POPULAR</span>' : ''}<div class="m">${esc(p.nombre)}</div><div class="u">US$${p.usd.toFixed(2)} · 🪙 ${fmt(p.monedas)}</div><div class="u" style="font-weight:700;font-size:.72rem;color:#FFC83D">+🪙 ${fmt(p.monedasRegalo || 0)} de regalo pagando con dinero</div><div class="u" style="font-weight:500;font-size:.7rem">${esc(p.dias)} días · ${esc(p.resumen)}</div></button>`).join('')}</div>
      <div data-ugp="pago"><p class="ugp-msg">Elige tu Premium. ${est.plan ? 'Los días se suman a tu Premium actual.' : 'Sin cobros automáticos: pagas solo cuando quieras renovar.'}</p></div>
    </div>`;
    el.querySelectorAll('.ugp-pack').forEach(b => b.onclick = () => {
      el.querySelectorAll('.ugp-pack').forEach(x => x.classList.toggle('on', x === b));
      pagar(el.querySelector('[data-ugp="pago"]'), { producto: `plan:${b.dataset.p}`, estado: est, alExito: d => alComprar?.(d) });
    });
  }

  /** Créditos de NEXUS: elegir paquete y pagarlo con UpCoins. */
  async function creditosIA(el, { alComprar } = {}) {
    estilos();
    el.innerHTML = '<div class="ugp"><div class="ugp-load"></div></div>';
    let c; try { c = await catalogo(); } catch (e) { el.innerHTML = `<p class="ugp-msg warn">${esc(e.message)}</p>`; return; }
    el.innerHTML = `<div class="ugp"><div class="ugp-packs">${(c.ia || []).map(p => `<button type="button" class="ugp-pack" data-p="${esc(p.id)}">${p.extra ? `<span class="x">${esc(p.extra)}</span>` : ''}<div class="m">🧠 ${p.mensajes} mensajes</div><div class="u">🪙 ${fmt(p.monedas)} UC</div></button>`).join('')}</div><div data-ugp="pago"></div></div>`;
    el.querySelectorAll('.ugp-pack').forEach(b => b.onclick = () => {
      el.querySelectorAll('.ugp-pack').forEach(x => x.classList.toggle('on', x === b));
      pagar(el.querySelector('[data-ugp="pago"]'), { producto: `ia:${b.dataset.p}`, alExito: d => alComprar?.(d) });
    });
  }

  window.UGPagos = { api, config, catalogo, pagar, botones, tienda, planes, creditosIA, fmt, uid };
})();
