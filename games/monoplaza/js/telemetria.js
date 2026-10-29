// Telemetría por vuelta: velocidad, acelerador y freno cada 10 m de pista,
// y gráfico de la última vuelta contra la mejor (con la diferencia de tiempo).

const PASO = 10;

export class Telemetria {
  constructor(largo) {
    this.largo = largo;
    this.n = Math.ceil(largo / PASO);
    this.actual = this._nueva();
    this.ultima = null;
    this.mejor = null;
  }
  _nueva() { return { v: new Float32Array(this.n), a: new Float32Array(this.n), f: new Float32Array(this.n), t: new Float32Array(this.n), ok: new Uint8Array(this.n) }; }

  registrar(s, car, tVuelta) {
    const k = Math.floor(s / PASO) % this.n;
    const L = this.actual;
    L.v[k] = car.velocidad * 3.6; L.a[k] = car.mandos.acelerador; L.f[k] = car.mandos.freno; L.t[k] = tVuelta; L.ok[k] = 1;
  }

  cerrarVuelta(tiempo, valida) {
    const L = this.actual;
    const completa = L.ok.reduce((a, b) => a + b, 0) > this.n * 0.9;
    if (completa) {
      L.tiempo = tiempo; L.valida = valida;
      this.ultima = L;
      if (valida && (!this.mejor || tiempo < this.mejor.tiempo)) this.mejor = L;
    }
    this.actual = this._nueva();
  }

  dibujar(cv, fmt, curvas = []) {
    const x = cv.getContext('2d'), W = cv.width, H = cv.height;
    x.clearRect(0, 0, W, H);
    const m = { l: 60, r: 16, t: 20, b: 40 };
    const hV = (H - m.t - m.b) * 0.62, hD = (H - m.t - m.b) * 0.3, yD = m.t + hV + (H - m.t - m.b) * 0.08;
    const X = (k) => m.l + k / (this.n - 1) * (W - m.l - m.r);
    const vmax = 360;
    const Y = (v) => m.t + hV * (1 - v / vmax);
    x.font = '22px system-ui, sans-serif'; x.fillStyle = 'rgba(255,255,255,.55)'; x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 1;
    for (let v = 0; v <= vmax; v += 60) { x.beginPath(); x.moveTo(m.l, Y(v)); x.lineTo(W - m.r, Y(v)); x.stroke(); x.fillText(String(v), 6, Y(v) + 7); }
    for (const cv2 of curvas) { const k = cv2.s / PASO; x.fillStyle = 'rgba(255,255,255,.35)'; x.fillText(cv2.nombre.split(' ')[0], X(k) - 14, H - 10); }
    if (!this.ultima) { x.fillStyle = '#fff'; x.fillText('Completa una vuelta para ver la telemetría', m.l + 20, H / 2); return; }
    const linea = (arr, col, w = 3) => { x.strokeStyle = col; x.lineWidth = w; x.beginPath(); for (let k = 0; k < this.n; k++) { const px = X(k), py = Y(arr[k]); k ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); };
    if (this.mejor && this.mejor !== this.ultima) linea(this.mejor.v, 'rgba(184,77,255,.9)', 3);
    linea(this.ultima.v, '#00e5ff', 3);
    // pedales (franja inferior del gráfico de velocidad)
    for (let k = 0; k < this.n; k++) {
      const a = this.ultima.a[k], f = this.ultima.f[k];
      if (f > 0.05) { x.fillStyle = `rgba(255,59,59,${0.25 + f * 0.6})`; x.fillRect(X(k), m.t + hV - 10, (W - m.l - m.r) / this.n + 1, 10); }
      else if (a > 0.05) { x.fillStyle = `rgba(47,224,122,${0.15 + a * 0.5})`; x.fillRect(X(k), m.t + hV - 10, (W - m.l - m.r) / this.n + 1, 10); }
    }
    // diferencia de tiempo con la mejor vuelta
    if (this.mejor && this.mejor !== this.ultima) {
      let dmax = 0.5;
      const dif = new Float32Array(this.n);
      for (let k = 0; k < this.n; k++) { dif[k] = this.ultima.t[k] - this.mejor.t[k]; dmax = Math.max(dmax, Math.abs(dif[k])); }
      const YD = (d) => yD + hD / 2 - d / dmax * hD / 2;
      x.strokeStyle = 'rgba(255,255,255,.2)'; x.lineWidth = 1; x.beginPath(); x.moveTo(m.l, YD(0)); x.lineTo(W - m.r, YD(0)); x.stroke();
      x.lineWidth = 3; x.beginPath();
      for (let k = 0; k < this.n; k++) { const py = YD(dif[k]); k ? x.lineTo(X(k), py) : x.moveTo(X(k), py); }
      x.strokeStyle = '#ffd23f'; x.stroke();
      x.fillStyle = 'rgba(255,255,255,.6)'; x.fillText(`Δ ±${dmax.toFixed(2)} s`, 6, yD + 12);
    }
    x.fillStyle = '#00e5ff'; x.fillText(`Última ${fmt(this.ultima.tiempo)}`, m.l + 10, m.t + 24);
    if (this.mejor) { x.fillStyle = '#b84dff'; x.fillText(`Mejor ${fmt(this.mejor.tiempo)}`, m.l + 260, m.t + 24); }
  }
}
