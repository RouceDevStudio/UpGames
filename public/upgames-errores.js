/* Reporta los errores de JavaScript de los visitantes al servidor (modulos/alertas.js):
   un error nuevo avisa por correo al equipo. Máximo 5 por página y sin repetir el mismo. */
(function () {
  const API = (window.UG_CONFIG && window.UG_CONFIG.API_URL) || 'https://upgames-production.up.railway.app';
  const vistos = new Set(); let n = 0;
  function enviar(mensaje, stack) {
    try {
      mensaje = String(mensaje || '').slice(0, 500);
      if (!mensaje || n >= 5 || vistos.has(mensaje)) return;
      vistos.add(mensaje); n++;
      const cuerpo = JSON.stringify({ mensaje, stack: String(stack || '').slice(0, 4000), pagina: location.pathname + location.search.slice(0, 80) });
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/errores/cliente', new Blob([cuerpo], { type: 'application/json' }));
      else fetch(API + '/errores/cliente', { method: 'POST', body: cuerpo, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function () {});
    } catch (_) {}
  }
  addEventListener('error', function (e) { if (e && e.message) enviar(e.message + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : ''), e.error && e.error.stack); });
  addEventListener('unhandledrejection', function (e) { const r = e && e.reason; enviar('Promesa: ' + (r && r.message ? r.message : String(r)), r && r.stack); });
  window.ugReportarError = enviar;
})();
