// Modo cine de la repetición: renderiza la escena a una textura con profundidad y la
// pasa por un único sombreador con desenfoque de enfoque (profundidad de campo),
// etalonaje de color, aberración cromática, viñeta, grano y bandas panorámicas.
// Todo va dentro de la imagen, así que también sale en los vídeos grabados.

import * as THREE from 'three';

export const FILTROS = ['natural', 'cine', 'calido', 'frio', 'bn', 'vintage'];
export const NOMBRES_FILTRO = { natural: 'Natural', cine: 'Cine', calido: 'Cálido', frio: 'Frío', bn: 'Blanco y negro', vintage: 'Película antigua' };

const FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 resolucion;
uniform float cerca, lejos, foco, apertura, tiempo, barras, grano, vineta, aberracion;
uniform int filtro;
varying vec2 vUv;

float profundidad(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * cerca * lejos / (lejos + cerca - z * (lejos - cerca));
}
// radio de desenfoque en píxeles según lo lejos que esté del plano de foco
float coc(float d) { return clamp(abs(d - foco) / max(d, 0.1) * apertura, 0.0, 14.0); }
float azar(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  vec3 col;
  float d = profundidad(uv);
  float r = apertura > 0.0 ? coc(d) : 0.0;
  if (r > 0.5) {
    // disco de muestras en espiral áurea; las muestras más enfocadas que el centro pesan menos
    vec3 suma = vec3(0.0); float peso = 0.0;
    for (int k = 0; k < 28; k++) {
      float fk = float(k) + 0.5;
      float rr = sqrt(fk / 28.0) * r;
      float a = fk * 2.39996;
      vec2 o = vec2(cos(a), sin(a)) * rr / resolucion;
      float rs = coc(profundidad(uv + o));
      float w = smoothstep(rr - 1.0, rr + 1.0, max(rs, r * 0.5));
      suma += texture2D(tColor, uv + o).rgb * w; peso += w;
    }
    col = suma / max(peso, 0.001);
  } else col = texture2D(tColor, uv).rgb;
  if (aberracion > 0.0) {
    vec2 dc = (uv - 0.5) * aberracion / resolucion * 6.0;
    col.r = mix(col.r, texture2D(tColor, uv + dc).r, 0.8);
    col.b = mix(col.b, texture2D(tColor, uv - dc).b, 0.8);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 c = gl_FragColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (filtro == 1) {          // cine: sombras verdeazuladas, luces anaranjadas, más contraste
    c = mix(c, c * vec3(0.86, 1.0, 1.08), 1.0 - smoothstep(0.0, 0.5, l));
    c = mix(c, c * vec3(1.1, 1.0, 0.86), smoothstep(0.45, 1.0, l));
    c = mix(vec3(l), c, 0.92); c = (c - 0.5) * 1.08 + 0.52;
  } else if (filtro == 2) c *= vec3(1.08, 1.0, 0.86);
  else if (filtro == 3) c *= vec3(0.9, 1.0, 1.1);
  else if (filtro == 4) { c = vec3(l); c = (c - 0.5) * 1.3 + 0.5; }
  else if (filtro == 5) { c = mix(vec3(l), c, 0.65) * vec3(1.06, 0.98, 0.82); c = c * 0.85 + 0.08; }
  // viñeta
  vec2 q = uv - 0.5; q.x *= resolucion.x / resolucion.y;
  c *= 1.0 - vineta * smoothstep(0.35, 1.0, length(q));
  // grano de película
  c += (azar(uv * resolucion + tiempo * 61.0) - 0.5) * grano;
  // bandas panorámicas
  if (abs(uv.y - 0.5) > 0.5 - barras) c = vec3(0.0);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class Cine {
  constructor(renderer) {
    this.r = renderer;
    const tam = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(tam.x, tam.y, { type: THREE.HalfFloatType, samples: 4 });
    this.rt.depthTexture = new THREE.DepthTexture(tam.x, tam.y);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, resolucion: { value: tam.clone() },
        cerca: { value: 0.1 }, lejos: { value: 9000 }, foco: { value: 10 }, apertura: { value: 0 }, tiempo: { value: 0 },
        barras: { value: 0 }, grano: { value: 0 }, vineta: { value: 0 }, aberracion: { value: 0 }, filtro: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG, depthTest: false, depthWrite: false,
    });
    this.escena = new THREE.Scene();
    this.escena.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    this.camOrto = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // ajustes del usuario
    this.opc = { apertura: 0, filtro: 'natural', barras: false, grano: 0, vineta: 0 };
  }

  ajustarTam() {
    const tam = this.r.getDrawingBufferSize(new THREE.Vector2());
    if (tam.x !== this.rt.width || tam.y !== this.rt.height) {
      this.rt.setSize(tam.x, tam.y);
      this.mat.uniforms.resolucion.value.copy(tam);
    }
  }

  /** foco: distancia de enfoque en metros (normalmente al coche seguido). */
  render(scene, cam, foco, dt) {
    this.ajustarTam();
    const u = this.mat.uniforms, o = this.opc;
    u.cerca.value = cam.near; u.lejos.value = cam.far;
    u.foco.value += (foco - u.foco.value) * Math.min(1, dt * 6);
    // la apertura se escala con el zoom: con teleobjetivo el fondo se desenfoca más
    u.apertura.value = o.apertura * 22 * Math.max(0.6, 50 / cam.fov);
    u.tiempo.value = (u.tiempo.value + dt) % 100;
    u.filtro.value = Math.max(0, FILTROS.indexOf(o.filtro));
    u.barras.value = o.barras ? Math.max(0, 0.5 - (innerWidth / innerHeight) / 2.39 / 2) : 0;
    u.grano.value = o.grano + (o.filtro === 'vintage' ? 0.05 : 0);
    u.vineta.value = o.vineta;
    u.aberracion.value = o.filtro === 'vintage' ? 0.5 : o.filtro === 'cine' ? 0.2 : 0;
    this.r.setRenderTarget(this.rt);
    this.r.render(scene, cam);
    this.r.setRenderTarget(null);
    this.r.render(this.escena, this.camOrto);
  }

  liberar() { this.rt.depthTexture?.dispose(); this.rt.dispose(); this.mat.dispose(); }
}
