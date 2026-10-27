/* ══════════════════════════════════════════════════════════════════
   UpGames · Pagos — tarjeta de crédito/débito primero, PayPal después.
   El formulario de la tarjeta lo dibuja PayPal (campos seguros): los datos
   nunca pasan por UpGames. Uso:
     UGPagos.botones(el, { crearOrden, capturar, alExito })
     UGPagos.tienda(el, { alComprar })      // paquetes de monedas
   ══════════════════════════════════════════════════════════════════ */
'use strict';
(() => {
  if (window.UGPagos) return;
  const API = (window.UG_CONFIG && window.UG_CONFIG.API_URL) || 'https://upgames-production.up.railway.app';
  const token = () => { try { return localStorage.getItem('token') || ''; } catch (_) { return ''; } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n); };

  async function api(path, opts = {}) {
    const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.success === false) { const e = new Error(d.error || 'Error de conexión'); e.status = r.status; e.data = d; throw e; }
    return d;
  }

  // Estilos una sola vez, con prefijo propio para no chocar con ninguna página
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
  .ugp-or{display:flex;align-items:center;gap:10px;color:#6C7180;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
  .ugp-or::before,.ugp-or::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.1)}
  .ugp-safe{font-size:.72rem;color:#8a90a0;line-height:1.5;text-align:center;margin:0}
  .ugp-msg{font-size:.8rem;color:#A3A8B6;text-align:center;padding:10px;border-radius:12px;background:rgba(255,255,255,.04);margin:0}
  .ugp-msg.warn{color:#ffd27a;background:rgba(255,204,77,.08);border:1px solid rgba(255,204,77,.22)}
  .ugp-load{height:48px;border-radius:24px;background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.1),rgba(255,255,255,.05));background-size:200% 100%;animation:ugpSk 1.2s infinite}
  @keyframes ugpSk{to{background-position:-200% 0}}
  .ugp-packs{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px}
  .ugp-pack{position:relative;padding:14px 8px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);text-align:center;cursor:pointer;color:inherit;font:inherit;transition:border-color .15s,background .15s,transform .12s}
  .ugp-pack:active{transform:scale(.97)}
  .ugp-pack.on{border-color:#ffcc4d;background:rgba(255,204,77,.09)}
  .ugp-pack .m{font-size:1.1rem;font-weight:800;color:#ffcc4d}
  .ugp-pack .u{font-size:.82rem;color:#A3A8B6;font-weight:700;margin-top:2px}
  .ugp-pack .x{position:absolute;top:-8px;right:8px;padding:2px 6px;border-radius:6px;background:#32D583;color:#06210f;font-size:.62rem;font-weight:800}
  .ugp-bal{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:14px;background:rgba(255,204,77,.08);border:1px solid rgba(255,204,77,.22)}
  .ugp-bal b{font-size:1.4rem;color:#ffcc4d}
  .ugp-bal small{color:#A3A8B6;font-size:.75rem}`;
  function estilos() { if (document.getElementById('ugp-css')) return; const s = document.createElement('style'); s.id = 'ugp-css'; s.textContent = css; document.head.appendChild(s); }

  let cfg = null, sdk = null;
  async function config() {
    if (!cfg) cfg = api('/live/config').catch(e => { cfg = null; throw e; });
    return cfg;
  }
  function cargarSDK(clientId) {
    if (sdk) return sdk;
    sdk = new Promise((ok, ko) => {
      const s = document.createElement('script');
      // enable-funding=card: botón propio de tarjeta (pago como invitado, sin cuenta PayPal)
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons,funding-eligibility&enable-funding=card&disable-funding=paylater,venmo`;
      s.async = true;
      s.onload = () => ok(window.paypal);
      s.onerror = () => { sdk = null; ko(new Error('No se pudo cargar el procesador de pagos. Revisa tu conexión.')); };
      document.head.appendChild(s);
    });
    return sdk;
  }

  /**
   * Botones de pago: tarjeta (protagonista) + PayPal.
   * opts.crearOrden(): Promise<orderID>   opts.capturar(orderID): Promise<resultado>
   * opts.alExito(resultado)               opts.alError?(mensaje)
   */
  async function botones(el, opts) {
    estilos();
    el.innerHTML = `<div class="ugp"><div class="ugp-load"></div></div>`;
    let c;
    try { c = await config(); } catch (e) { el.innerHTML = `<p class="ugp-msg warn">${esc(e.message)}</p>`; return; }
    if (!c.paypal) { el.innerHTML = `<p class="ugp-msg warn">Los pagos con tarjeta se están activando. Vuelve en unos minutos.</p>`; return; }
    let pp;
    try { pp = await cargarSDK(c.paypal.clientId); } catch (e) { el.innerHTML = `<p class="ugp-msg warn">${esc(e.message)}</p>`; return; }
    el.innerHTML = `<div class="ugp">
      <div class="ugp-card" data-ugp="card">
        <span class="ugp-tag">RECOMENDADO</span>
        <div class="ugp-card-h"><div class="ugp-ic">💳</div><div><b>Tarjeta de crédito o débito</b><small>Sin cuenta de PayPal · en segundos</small></div></div>
        <div class="ugp-brands"><span>VISA</span><span>MASTERCARD</span><span>AMEX</span><span>DÉBITO</span></div>
        <div data-ugp="card-btn"></div>
      </div>
      <div class="ugp-or">o</div>
      <div data-ugp="pp-btn"></div>
      <p class="ugp-safe">🔒 Pago cifrado procesado por PayPal. UpGames nunca ve ni guarda los datos de tu tarjeta.</p>
    </div>`;
    const comunes = {
      createOrder: () => opts.crearOrden(),
      onApprove: async (data, actions) => {
        try { opts.alExito(await opts.capturar(data.orderID)); }
        catch (e) {
          if (e.data?.reintentar) return actions.restart();
          (opts.alError || alert)(e.message);
        }
      },
      onError: () => (opts.alError || alert)('No se pudo procesar el pago. Intenta de nuevo o usa otra tarjeta.'),
    };
    const card = pp.Buttons({ ...comunes, fundingSource: pp.FUNDING.CARD, style: { layout: 'vertical', shape: 'pill', height: 48 } });
    if (card.isEligible()) await card.render(el.querySelector('[data-ugp="card-btn"]')).catch(() => {});
    else {
      // Algunas cuentas/países no habilitan el botón de invitado: la tarjeta se
      // ingresa dentro de la ventana de PayPal ("Pagar con tarjeta de débito o crédito")
      el.querySelector('[data-ugp="card-btn"]').innerHTML = '<p class="ugp-msg">Pulsa el botón de abajo y elige <b>“Pagar con tarjeta de débito o crédito”</b> en la ventana segura.</p>';
    }
    const paypalBtn = pp.Buttons({ ...comunes, fundingSource: pp.FUNDING.PAYPAL, style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'pay', height: 45 } });
    if (paypalBtn.isEligible()) await paypalBtn.render(el.querySelector('[data-ugp="pp-btn"]')).catch(() => {});
  }

  /** Tienda de monedas: saldo + paquetes + pago (tarjeta primero). */
  async function tienda(el, { alComprar, aviso } = {}) {
    estilos();
    if (!token()) { el.innerHTML = '<p class="ugp-msg">Inicia sesión para comprar monedas.</p>'; return; }
    el.innerHTML = '<div class="ugp"><div class="ugp-load"></div></div>';
    let c, saldo;
    try { [c, saldo] = await Promise.all([config(), api('/monedas/saldo')]); }
    catch (e) { el.innerHTML = `<p class="ugp-msg warn">${esc(e.message)}</p>`; return; }
    el.innerHTML = `<div class="ugp">
      <div class="ugp-bal"><div><small>Tus monedas</small><br><b data-ugp="bal">🪙 ${fmt(saldo.monedas)}</b></div><small style="text-align:right">${aviso || 'Para regalos en lives y<br>acceso directo a enlaces'}</small></div>
      <div class="ugp-packs">${c.paquetes.map(p => `<button type="button" class="ugp-pack" data-p="${esc(p.id)}">${p.extra ? `<span class="x">${esc(p.extra)}</span>` : ''}<div class="m">🪙 ${fmt(p.monedas)}</div><div class="u">US$${p.usd.toFixed(2)}</div></button>`).join('')}</div>
      <div data-ugp="pago"><p class="ugp-msg">Elige un paquete para pagar con tarjeta o PayPal.</p></div>
      <p class="ugp-safe">Las monedas no son reembolsables ni canjeables por dinero. <a href="./terminos_condiciones.html#pagos" target="_blank" style="color:#32D583">Términos</a></p>
    </div>`;
    el.querySelectorAll('.ugp-pack').forEach(b => b.onclick = () => {
      el.querySelectorAll('.ugp-pack').forEach(x => x.classList.toggle('on', x === b));
      botones(el.querySelector('[data-ugp="pago"]'), {
        crearOrden: async () => (await api('/monedas/orden', { method: 'POST', body: { paquete: b.dataset.p } })).orderID,
        capturar: orderID => api('/monedas/capturar', { method: 'POST', body: { orderID } }),
        alExito: d => { const bal = el.querySelector('[data-ugp="bal"]'); if (bal) bal.textContent = `🪙 ${fmt(d.monedas)}`; alComprar?.(d); },
        alError: msg => { const p = el.querySelector('[data-ugp="pago"]'); p.insertAdjacentHTML('afterbegin', `<p class="ugp-msg warn">${esc(msg)}</p>`); },
      });
    });
  }

  window.UGPagos = { api, config, botones, tienda, fmt };
})();
