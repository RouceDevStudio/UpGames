// Dibuja el trazado en SVG para revisar el diseño: node tools/plano.mjs > plano.svg
import { Circuito } from "../js/track.js";
const c = new Circuito(process.argv[2] || "valle");
let minx=1e9,maxx=-1e9,minz=1e9,maxz=-1e9;
for (let i=0;i<c.n;i++){minx=Math.min(minx,c.x[i]);maxx=Math.max(maxx,c.x[i]);minz=Math.min(minz,c.z[i]);maxz=Math.max(maxz,c.z[i]);}
const pad=80, W=maxx-minx+2*pad, H=maxz-minz+2*pad;
const P=(x,z)=>`${(x-minx+pad).toFixed(1)},${(z-minz+pad).toFixed(1)}`;
let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="1200" style="background:#163">`;
const lado=(sgn,arr)=>{let p='';for(let i=0;i<=c.n;i++){const k=i%c.n;const nx=-c.tz[k],nz=c.tx[k];p+=P(c.x[k]+nx*sgn*arr[k],c.z[k]+nz*sgn*arr[k])+' ';}return p;};
s+=`<polyline points="${lado(-1,c.muro[0])}" fill="none" stroke="#f55" stroke-width="2"/>`;
s+=`<polyline points="${lado(1,c.muro[1])}" fill="none" stroke="#f55" stroke-width="2"/>`;
let p='';for(let i=0;i<=c.n;i++){const k=i%c.n;p+=P(c.x[k],c.z[k])+' ';}
s+=`<polyline points="${p}" fill="none" stroke="#444" stroke-width="14"/>`;
p='';for(let i=0;i<=c.n;i++){const k=i%c.n;p+=P(c.trazada.x[k],c.trazada.z[k])+' ';}
s+=`<polyline points="${p}" fill="none" stroke="#0f0" stroke-width="1.5"/>`;
for (const cv of c.curvas){const m=c.muestra(cv.s);s+=`<text x="${(m.x-minx+pad+15)}" y="${(m.z-minz+pad)}" fill="#fff" font-size="22">${cv.nombre}</text>`;}
const m0=c.muestra(0);s+=`<circle cx="${m0.x-minx+pad}" cy="${m0.z-minz+pad}" r="10" fill="#fff"/>`;
s+='</svg>';
console.log(s);
let vmin=1e9; for(let i=0;i<c.n;i++) vmin=Math.min(vmin,c.perfil[i]);
// tiempo de vuelta estimado por el perfil
let t=0; for(let i=0;i<c.n;i++) t+=c.trazada.ds[i]/c.perfil[i];
console.error('largo',c.largo.toFixed(0),'m  muestras',c.n,' vuelta teórica',t.toFixed(2),'s  vmax',(Math.max(...c.perfil)*3.6).toFixed(0),'vmin',(vmin*3.6).toFixed(0), 'desnivel', (Math.max(...c.y)-Math.min(...c.y)).toFixed(1));
console.error(c.segmentos.filter(s=>s.ajusta||s.cierra).map(s=>JSON.stringify(s)).join('\n'));
