import { useState, useEffect, useRef } from "react";

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Inter:wght@400;500;600;700;800;900&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  @keyframes dealCard    { 0%{transform:translate(-50px,-80px) rotate(-12deg) scale(.5);opacity:0} 65%{transform:translate(3px,3px) rotate(1deg) scale(1.03)} 100%{transform:none;opacity:1} }
  @keyframes flipCard    { 0%{transform:scaleX(1)} 50%{transform:scaleX(0)} 100%{transform:scaleX(1)} }
  @keyframes floatUp     { 0%{transform:translateY(0) scale(1);opacity:1} 100%{transform:translateY(-70px) scale(1.5);opacity:0} }
  @keyframes popIn       { 0%{transform:scale(.35) rotate(-8deg);opacity:0} 68%{transform:scale(1.08) rotate(1deg)} 100%{transform:scale(1) rotate(0);opacity:1} }
  @keyframes slideUp     { from{transform:translateY(28px);opacity:0} to{transform:none;opacity:1} }
  @keyframes slideDown   { from{transform:translateY(-18px);opacity:0} to{transform:none;opacity:1} }
  @keyframes shake       { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-10px) rotate(-1.5deg)} 40%{transform:translateX(10px) rotate(1.5deg)} 60%{transform:translateX(-6px)} 80%{transform:translateX(6px)} }
  @keyframes fire        { 0%,100%{transform:scale(1) rotate(-3deg);filter:brightness(1)} 33%{transform:scale(1.15) rotate(3deg);filter:brightness(1.2)} 66%{transform:scale(.95) rotate(-1deg);filter:brightness(.9)} }
  @keyframes orb         { 0%,100%{transform:translateY(0) scale(1);opacity:.3} 50%{transform:translateY(-18px) scale(1.1);opacity:.55} }
  @keyframes neon        { 0%,100%{text-shadow:0 0 10px #f0c040,0 0 30px rgba(240,192,64,.5)} 50%{text-shadow:0 0 20px #f0c040,0 0 60px rgba(240,192,64,.8),0 0 100px rgba(240,192,64,.35)} }
  @keyframes goldShimmer { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
  @keyframes tableGlow   { 0%,100%{box-shadow:0 0 40px rgba(240,192,64,.06),inset 0 0 50px rgba(0,0,0,.5)} 50%{box-shadow:0 0 80px rgba(240,192,64,.14),inset 0 0 50px rgba(0,0,0,.5)} }
  @keyframes pulse       { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.55;transform:scale(.95)} }
  @keyframes confetti    { 0%{transform:translateY(-10px) rotate(0);opacity:1} 100%{transform:translateY(210px) rotate(740deg);opacity:0} }
  @keyframes winGlow     { 0%,100%{box-shadow:0 8px 24px rgba(0,0,0,.6),0 0 0 2px #4caf50,0 0 18px rgba(76,175,80,.5)} 50%{box-shadow:0 8px 24px rgba(0,0,0,.6),0 0 0 3px #4caf50,0 0 36px rgba(76,175,80,.85)} }
  @keyframes glowBorder  { 0%,100%{box-shadow:0 0 0 2px var(--gc),0 0 16px var(--gc-a)} 50%{box-shadow:0 0 0 3px var(--gc),0 0 32px var(--gc-a),0 0 56px var(--gc-b)} }
  @keyframes toastAnim   { 0%{transform:translateX(110px);opacity:0} 12%{transform:translateX(-3px);opacity:1} 85%{transform:translateX(0);opacity:1} 100%{transform:translateX(110px);opacity:0} }
  @keyframes chipBounce  { from{transform:translateY(-18px) scale(.6);opacity:0} to{transform:none;opacity:1} }
  @keyframes bonusPop    { 0%{transform:scale(.4) rotate(-12deg);opacity:0} 65%{transform:scale(1.1) rotate(2deg)} 100%{transform:scale(1) rotate(0);opacity:1} }

  .deal     { animation: dealCard   .42s cubic-bezier(.22,1,.36,1) both }
  .flip     { animation: flipCard   .38s ease-in-out }
  .pop-in   { animation: popIn      .46s cubic-bezier(.34,1.56,.64,1) both }
  .slide-up { animation: slideUp    .34s cubic-bezier(.22,1,.36,1) both }
  .slide-dn { animation: slideDown  .3s ease both }
  .shk      { animation: shake      .44s ease-in-out }
  .fire     { animation: fire       .5s ease-in-out infinite }
  .pulse    { animation: pulse      1.2s ease-in-out infinite }
  .neon     { animation: neon       2.5s ease-in-out infinite }
  .chip-in  { animation: chipBounce .28s cubic-bezier(.34,1.56,.64,1) both }
  .win-card { animation: winGlow    1.1s ease-in-out infinite }
  .glow-c   { animation: glowBorder .9s ease-in-out infinite }
  .toast    { animation: toastAnim  3.2s cubic-bezier(.22,1,.36,1) forwards }

  .card-el  { transition: transform .14s, box-shadow .14s; user-select:none; }
  .card-el:hover { transform: translateY(-4px) scale(1.04); }

  .chip-el  { transition: transform .12s cubic-bezier(.34,1.56,.64,1), box-shadow .12s; cursor:pointer; }
  .chip-el:hover  { transform: translateY(-6px) scale(1.13); }
  .chip-el:active { transform: scale(.94); }

  .btn { border:none; font-family:'Inter',sans-serif; font-weight:900; letter-spacing:1.5px;
    cursor:pointer; position:relative; overflow:hidden;
    transition: transform .1s, filter .1s; }
  .btn::after { content:''; position:absolute; inset:0;
    background:linear-gradient(to bottom,rgba(255,255,255,.1),transparent); pointer-events:none; }
  .btn:hover  { transform:translateY(-2px); filter:brightness(1.1); }
  .btn:active { transform:scale(.97); filter:brightness(.94); }
  .btn:disabled { opacity:.32; cursor:not-allowed; transform:none; filter:none; }

  .felt { position:relative; animation: tableGlow 4s ease-in-out infinite; }
  .felt::before { content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
    background: radial-gradient(ellipse at 50% 0%,rgba(255,255,255,.04) 0%,transparent 60%),
    repeating-linear-gradient(45deg,transparent 0,transparent 3px,rgba(0,0,0,.05) 3px,rgba(0,0,0,.05) 4px); }

  .glass  { background:rgba(255,255,255,.03); backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,.07); }
  .glass-g{ background:rgba(240,192,64,.04);  backdrop-filter:blur(10px); border:1px solid rgba(240,192,64,.14); }

  .neon-line { height:1px; background:linear-gradient(90deg,transparent,rgba(240,192,64,.4),rgba(240,192,64,.8),rgba(240,192,64,.4),transparent);
    box-shadow:0 0 8px rgba(240,192,64,.35); }

  ::-webkit-scrollbar { width:4px; }
  ::-webkit-scrollbar-thumb { background:rgba(240,192,64,.28); border-radius:2px; }
`;

// ── CONSTANTS ──────────────────────────────────────────────────────
const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const REDS  = new Set(["♥","♦"]);

const CHIPS = [
  {v:500,   bg:"#e8e8e8",ring:"#bdbdbd",sh:"#fff",   lbl:"500"},
  {v:1000,  bg:"#ef5350",ring:"#b71c1c",sh:"#ff8a80",lbl:"1K"},
  {v:5000,  bg:"#42a5f5",ring:"#1565c0",sh:"#82b1ff",lbl:"5K"},
  {v:10000, bg:"#66bb6a",ring:"#2e7d32",sh:"#b9f6ca",lbl:"10K"},
  {v:25000, bg:"#ab47bc",ring:"#6a1b9a",sh:"#ea80fc",lbl:"25K"},
  {v:50000, bg:"#ffca28",ring:"#f57f17",sh:"#fff9c4",lbl:"50K"},
  {v:100000,bg:"#ff7043",ring:"#bf360c",sh:"#ff9e80",lbl:"100K"},
];

const DIFF = {
  easy:{label:"Fácil",   stand:16,hitSoft17:false,decks:1,color:"#66bb6a",hint:true},
  med: {label:"Medio",   stand:17,hitSoft17:false,decks:2,color:"#ffb300",hint:false},
  hard:{label:"Difícil", stand:17,hitSoft17:true, decks:6,color:"#ef5350",hint:false},
};

const DLR = {
  start:["Buena suerte...","Las cartas nunca mienten.","¿Otro intento?","La casa siempre espera.","Ya sé cómo termina esto."],
  pBJ:  ["Increíble. Blackjack.","No puede ser...","Esta vez tuviste suerte."],
  dBJ:  ["Blackjack. La casa gana.","¿Sorprendido?","Esta era mía desde el principio."],
  pBust:["Te pasaste. Adiós.","Demasiado ambicioso.","La codicia tiene un precio."],
  dBust:["La casa se pasó. Disfrútalo.","Mala mano. Por ahora.","No siempre puedo ganar."],
  win:  ["Bien jugado… por ahora.","Disfrútalo mientras dura.","¿Crees que podés ganar dos veces?"],
  lose: ["La casa siempre gana.","Predecible.","Era inevitable."],
  push: ["Empate. Nadie gana.","Un empate es casi perder."],
};

const DAILY = [10000,15000,20000,25000,35000,50000,100000];

const BACKS = [
  {id:"royal",   name:"Royal Blue", price:0,      c1:"#1a237e",c2:"#3949ab",pat:true},
  {id:"crimson", name:"Crimson",    price:8000,   c1:"#7f0000",c2:"#c62828",pat:true},
  {id:"obsidian",name:"Obsidian",   price:20000,  c1:"#0d0d0d",c2:"#212121",pat:false},
  {id:"aurora",  name:"Aurora",     price:45000,  c1:"#004d40",c2:"#00897b",pat:true},
  {id:"galaxy",  name:"Galaxy",     price:100000, c1:"#090929",c2:"#1a1a5e",pat:false},
];
const FELTS = [
  {id:"classic",name:"Classic Green",price:0,      bg:"radial-gradient(ellipse at 50% -10%,#1b5e20,#0a2a0a 60%,#020802)"},
  {id:"royal",  name:"Royal Blue",   price:10000,  bg:"radial-gradient(ellipse at 50% -10%,#0d47a1,#041030 60%,#010510)"},
  {id:"noir",   name:"Noir",         price:25000,  bg:"radial-gradient(ellipse at 50% -10%,#1c1c1c,#050505 60%,#000)"},
  {id:"crimson",name:"Crimson",      price:50000,  bg:"radial-gradient(ellipse at 50% -10%,#7f0000,#2a0000 60%,#080000)"},
  {id:"gold",   name:"Golden Hall",  price:120000, bg:"radial-gradient(ellipse at 50% -10%,#3e2700,#150d00 60%,#040200)"},
];

const HAND_CLR={9:"#f0c040",8:"#f0c040",7:"#ce93d8",6:"#64b5f6",5:"#66bb6a",4:"#66bb6a",3:"#64b5f6",2:"#ffa726",1:"#ffa726",0:"#90a4ae"};
const PPAY={9:250,8:50,7:25,6:9,5:6,4:4,3:3,2:2,1:1,0:1};
const PNAME={9:"Royal Flush",8:"Straight Flush",7:"Four of a Kind",6:"Full House",5:"Flush",4:"Straight",3:"Three of a Kind",2:"Two Pair",1:"Pair",0:"High Card"};
const COIN_PACKS=[
  {id:"s",name:"Starter",    coins:50000,  bonus:0,       real:"$0.99",clr:"#42a5f5",icon:"💰"},
  {id:"p",name:"Popular",    coins:150000, bonus:50000,   real:"$1.99",clr:"#f0c040",icon:"💎",tag:"+ POPULAR"},
  {id:"h",name:"High Roller",coins:500000, bonus:200000,  real:"$4.99",clr:"#ce93d8",icon:"👑"},
  {id:"v",name:"VIP Bundle", coins:1500000,bonus:1000000, real:"$9.99",clr:"#ff7043",icon:"🏆",tag:"MEJOR VALOR"},
];

const LS  = "cnx_v5";
const rnd = a => a[0|Math.random()*a.length];
const tod = () => new Date().toISOString().slice(0,10);

function loadS(){ try{const r=localStorage.getItem(LS);return r?JSON.parse(r):null;}catch{return null;} }
function saveS(d){ try{localStorage.setItem(LS,JSON.stringify(d));}catch{} }

// ── AUDIO ──────────────────────────────────────────────────────────
let AX=null;
const ax=()=>(AX??=new(window.AudioContext||window.webkitAudioContext)());
const tn=(f,dur,tp="sine",v=.13,dl=0)=>{try{const c=ax(),o=c.createOscillator(),g=c.createGain();o.type=tp;o.frequency.value=f;const t=c.currentTime+dl;g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(g).connect(c.destination);o.start(t);o.stop(t+dur);}catch{}};
const SFX={
  card:()=>{try{const c=ax(),b=c.createBuffer(1,c.sampleRate*.06,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.exp(-i/d.length*12);const s=c.createBufferSource(),g=c.createGain();s.buffer=b;g.gain.value=.09;s.connect(g).connect(c.destination);s.start();}catch{}},
  chip:()=>tn(880,.1,"sine",.08),
  click:()=>tn(1100,.05,"square",.04),
  win:()=>[523,659,784,1047].forEach((f,i)=>tn(f,.24,"sine",.16,i*.1)),
  lose:()=>[300,250,200].forEach((f,i)=>tn(f,.2,"sawtooth",.09,i*.13)),
  bj:()=>[523,659,784,659,784,1047,784,1319].forEach((f,i)=>tn(f,.19,"sine",.17,i*.09)),
  push:()=>tn(440,.28,"sine",.09),
  buy:()=>[600,750,900,1050].forEach((f,i)=>tn(f,.15,"sine",.1,i*.07)),
  split:()=>[600,800].forEach((f,i)=>tn(f,.17,"triangle",.12,i*.1)),
  bonus:()=>[400,520,660,820,1040,1320].forEach((f,i)=>tn(f,.17,"sine",.15,i*.08)),
};

// ── GAME ENGINE ────────────────────────────────────────────────────
const mkDeck=n=>{const d=[];for(let k=0;k<n;k++)for(const s of SUITS)for(const r of RANKS)d.push({s,r,id:`${r}${s}${k}`});return d;};
const shuf=d=>{const a=[...d];for(let i=a.length-1;i>0;i--){const j=0|Math.random()*(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
const cv=r=>["J","Q","K"].includes(r)?10:r==="A"?11:+r;
const tot=h=>{let t=h.reduce((s,c)=>s+cv(c.r),0),a=h.filter(c=>c.r==="A").length;while(t>21&&a-->0)t-=10;return t;};
const bust=h=>tot(h)>21;
const isBJ=h=>h.length===2&&tot(h)===21;
const isSoft17=h=>tot(h)===17&&h.some(c=>c.r==="A");
const canSplitH=h=>h.length===2&&cv(h[0].r)===cv(h[1].r);

const bjHint=(hand,up,spl)=>{
  const p=tot(hand),d=cv(up?.r||"2");
  if(spl&&canSplitH(hand)){
    const r=hand[0].r;
    if(r==="A"||r==="8")return{a:"SPLIT",c:"#ff9800",t:"Siempre dividí Ases y Ochos"};
    if(["5","10","J","Q","K"].includes(r))return{a:"NO SPLIT",c:"#ef5350",t:"Nunca dividás 10s ni 5s"};
    if((r==="2"||r==="3"||r==="7")&&d<=7)return{a:"SPLIT",c:"#ff9800",t:"Dividí contra dealer ≤7"};
    if(r==="6"&&d<=6)return{a:"SPLIT",c:"#ff9800",t:"Dividí 6s vs dealer débil"};
    if(r==="9"&&d!==7&&d<=9)return{a:"SPLIT",c:"#ff9800",t:"Dividí 9s (excepto vs 7,10,A)"};
  }
  if(p>=17)return{a:"STAND",c:"#42a5f5",t:"17+ → siempre plantate"};
  if(p<=8) return{a:"HIT",c:"#66bb6a",t:"≤8 → pedí carta siempre"};
  if(p===11)return{a:"DOUBLE",c:"#ff9800",t:"11 → doblá si podés"};
  if(p===10&&d<=9)return{a:"DOUBLE",c:"#ff9800",t:"10 vs dealer ≤9 → doblá"};
  if(p>=13&&p<=16&&d<=6)return{a:"STAND",c:"#42a5f5",t:"Dealer débil → plantate"};
  if(p>=13&&p<=16&&d>=7)return{a:"HIT",c:"#66bb6a",t:"Dealer fuerte → pedí carta"};
  if(p===12&&d>=4&&d<=6)return{a:"STAND",c:"#42a5f5",t:"12 vs dealer 4-6 → plantate"};
  return{a:"HIT",c:"#66bb6a",t:"Estrategia básica → pedí carta"};
};

const cn=r=>({A:14,K:13,Q:12,J:11,"10":10}[r]||+r);
function evalPk(hand){
  if(!hand||hand.length!==5)return{rank:0,name:"?"};
  const vals=hand.map(c=>cn(c.r)).sort((a,b)=>b-a);
  const fl=new Set(hand.map(c=>c.s)).size===1;
  const st=vals.every((v,i)=>!i||vals[i-1]-v===1)||String(vals)==="14,5,4,3,2";
  const cnt={};vals.forEach(v=>cnt[v]=(cnt[v]||0)+1);
  const grp=Object.entries(cnt).sort((a,b)=>+b[1]-+a[1]||+b[0]-+a[0]);
  const [tc,sc]=[+grp[0][1],grp[1]?+grp[1][1]:0];
  if(fl&&st&&vals[0]===14&&vals[4]===10)return{rank:9,name:PNAME[9]};
  if(fl&&st)return{rank:8,name:PNAME[8]};
  if(tc===4)return{rank:7,name:PNAME[7]};
  if(tc===3&&sc===2)return{rank:6,name:PNAME[6]};
  if(fl)return{rank:5,name:PNAME[5]};
  if(st)return{rank:4,name:PNAME[4]};
  if(tc===3)return{rank:3,name:PNAME[3]};
  if(tc===2&&sc===2)return{rank:2,name:PNAME[2]};
  if(tc===2)return{rank:1,name:PNAME[1]};
  return{rank:0,name:PNAME[0]};
}
function pkHL(hand,ev){
  if(!hand||hand.length!==5)return[];
  const cnt={};hand.forEach(c=>cnt[cn(c.r)]=(cnt[cn(c.r)]||0)+1);
  const r=ev.rank;
  if(r>=8||r===6||r===5||r===4)return[0,1,2,3,4];
  if(r===7){const v=+Object.entries(cnt).find(([,c])=>c===4)[0];return hand.map((c,i)=>cn(c.r)===v?i:-1).filter(i=>i>=0);}
  if(r===3){const v=+Object.entries(cnt).find(([,c])=>c===3)[0];return hand.map((c,i)=>cn(c.r)===v?i:-1).filter(i=>i>=0);}
  if(r===2){const pv=new Set(Object.entries(cnt).filter(([,c])=>c>=2).map(([v])=>+v));return hand.map((c,i)=>pv.has(cn(c.r))?i:-1).filter(i=>i>=0);}
  if(r===1){const v=+Object.entries(cnt).find(([,c])=>c===2)[0];return hand.map((c,i)=>cn(c.r)===v?i:-1).filter(i=>i>=0);}
  return[hand.reduce((mi,c,i,a)=>cn(c.r)>cn(a[mi].r)?i:mi,0)];
}

// ── CARD ───────────────────────────────────────────────────────────
function Card({card,hidden=false,delay=0,revealing=false,glowColor=null,winAnim=false,back=BACKS[0],small=false}){
  const isRed=card&&REDS.has(card.s);
  const W=small?52:66, H=small?76:98;
  let shadow="0 8px 26px rgba(0,0,0,.65),0 2px 4px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.22)";
  if(glowColor)shadow=`0 8px 20px rgba(0,0,0,.5),0 0 0 2px ${glowColor},0 0 20px ${glowColor}88`;
  return(
    <div className={`card-el deal${revealing?" flip":""}${winAnim?" win-card":""}`}
      style={{animationDelay:`${delay}ms`,width:W,height:H,borderRadius:10,flexShrink:0,
        background:hidden?`linear-gradient(135deg,${back.c1},${back.c2})`:"#f7f3ec",
        boxShadow:shadow,border:`1.5px solid ${hidden?"rgba(255,255,255,.16)":"rgba(0,0,0,.14)"}`,
        display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}}>
      {hidden?(
        <>
          <div style={{position:"absolute",inset:4,borderRadius:7,
            border:"1.5px solid rgba(255,255,255,.1)",
            background:back.pat?"repeating-linear-gradient(45deg,rgba(255,255,255,.03) 0,rgba(255,255,255,.03) 2px,transparent 2px,transparent 10px)":"none"}}/>
          <div style={{fontSize:small?16:22,color:"rgba(255,255,255,.1)",fontFamily:"serif",position:"relative"}}>♦</div>
        </>
      ):(
        <>
          <div style={{position:"absolute",top:4,left:6,lineHeight:1.2,textAlign:"center"}}>
            <div style={{fontSize:small?10:13,fontWeight:900,color:isRed?"#c62828":"#1a1a1a",fontFamily:"'Cinzel',Georgia,serif"}}>{card.r}</div>
            <div style={{fontSize:small?11:15,color:isRed?"#c62828":"#1a1a1a",lineHeight:.9}}>{card.s}</div>
          </div>
          <div style={{fontSize:small?24:36,color:isRed?"#c62828":"#1a1a1a",fontFamily:"Georgia,serif",
            textShadow:isRed?"0 1px 4px rgba(198,40,40,.25)":"0 1px 4px rgba(0,0,0,.1)"}}>{card.s}</div>
          <div style={{position:"absolute",bottom:4,right:6,lineHeight:1.2,textAlign:"center",transform:"rotate(180deg)"}}>
            <div style={{fontSize:small?10:13,fontWeight:900,color:isRed?"#c62828":"#1a1a1a",fontFamily:"'Cinzel',Georgia,serif"}}>{card.r}</div>
            <div style={{fontSize:small?11:15,color:isRed?"#c62828":"#1a1a1a",lineHeight:.9}}>{card.s}</div>
          </div>
        </>
      )}
    </div>
  );
}

// ── CHIP ───────────────────────────────────────────────────────────
function Chip({chip,size=50,onClick,disabled=false,ai=0}){
  return(
    <div className="chip-el chip-in" onClick={disabled?undefined:()=>{SFX.chip();onClick&&onClick();}}
      style={{animationDelay:`${ai*40}ms`,width:size,height:size,borderRadius:"50%",
        background:`radial-gradient(circle at 34% 30%,${chip.sh},${chip.bg} 42%,${chip.ring})`,
        border:`3px solid ${chip.ring}`,
        boxShadow:`0 4px 14px rgba(0,0,0,.5),inset 0 2px 0 ${chip.sh}44,inset 0 -2px 0 rgba(0,0,0,.3)`,
        display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:9,fontWeight:900,color:"rgba(0,0,0,.72)",letterSpacing:.5,
        opacity:disabled?.28:1,cursor:disabled?"not-allowed":"pointer",userSelect:"none",flexShrink:0}}>
      {chip.lbl}
    </div>
  );
}

// ── CONFETTI ───────────────────────────────────────────────────────
function Confetti({active}){
  if(!active)return null;
  const C=["#f0c040","#ef5350","#42a5f5","#66bb6a","#ab47bc","#ff7043","#26c6da","#ec407a","#fff"];
  return(
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,overflow:"hidden"}}>
      {Array.from({length:55},(_,i)=>(
        <div key={i} style={{position:"absolute",left:`${Math.random()*100}%`,top:-18,
          width:4+Math.random()*9,height:4+Math.random()*9,background:C[i%C.length],
          borderRadius:Math.random()>.4?"50%":"2px",
          animation:`confetti ${.65+Math.random()*.85}s ${Math.random()*1.1}s ease-in forwards`}}/>
      ))}
    </div>
  );
}

// ── TOAST ──────────────────────────────────────────────────────────
function Toast({msg,type="win"}){
  const T={win:{bg:"#1b5e20",br:"#4caf50",tx:"#a5d6a7",ic:"✅"},
    bj:{bg:"#3e2700",br:"#f0c040",tx:"#ffe082",ic:"⭐"},lose:{bg:"#7f0000",br:"#ef5350",tx:"#ffcdd2",ic:"💀"},
    info:{bg:"#0d2137",br:"#42a5f5",tx:"#bbdefb",ic:"ℹ️"},fire:{bg:"#3e1500",br:"#ff7043",tx:"#ffccbc",ic:"🔥"},
    bonus:{bg:"#3e2700",br:"#f0c040",tx:"#ffe082",ic:"🎁"},split:{bg:"#1a237e",br:"#7986cb",tx:"#c5cae9",ic:"✂️"},
    buy:{bg:"#1a0033",br:"#ce93d8",tx:"#e1bee7",ic:"💎"}};
  const c=T[type]||T.info;
  return(
    <div className="toast" style={{position:"fixed",top:72,right:12,background:c.bg,border:`1.5px solid ${c.br}`,
      borderRadius:14,padding:"10px 16px",color:c.tx,fontWeight:800,fontSize:13,
      boxShadow:"0 8px 32px rgba(0,0,0,.6)",zIndex:2000,maxWidth:240,display:"flex",gap:8,alignItems:"center",lineHeight:1.35}}>
      <span style={{fontSize:15,flexShrink:0}}>{c.ic}</span>{msg}
    </div>
  );
}

// ── SCORE BADGE ────────────────────────────────────────────────────
function SB({v,busted,bj:isB,color="#f0c040"}){
  return(
    <div style={{display:"inline-flex",alignItems:"center",gap:5,
      background:busted?"rgba(239,83,80,.13)":isB?"rgba(240,192,64,.13)":"rgba(0,0,0,.38)",
      border:`1.5px solid ${busted?"#ef535044":isB?"#f0c04044":color+"33"}`,
      borderRadius:8,padding:"3px 9px"}}>
      <span style={{fontFamily:"'Cinzel',serif",fontSize:15,fontWeight:900,letterSpacing:1,
        color:busted?"#ef5350":isB?"#f0c040":color}}>{v}</span>
      {isB&&<span style={{fontSize:9,color:"#f0c040",fontWeight:700,letterSpacing:1}}>BJ</span>}
      {busted&&<span style={{fontSize:9,color:"#ef5350",fontWeight:700}}>BUST</span>}
    </div>
  );
}

// ── DAILY BONUS ────────────────────────────────────────────────────
function DailyModal({streak,amount,onClose}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.93)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:900,padding:16}}>
      <div className="bonusPop pop-in" style={{
        background:"linear-gradient(160deg,#1a1200,#2a1d00)",border:"2px solid rgba(240,192,64,.5)",
        borderRadius:24,padding:28,width:"100%",maxWidth:390,textAlign:"center",
        boxShadow:"0 0 80px rgba(240,192,64,.18),0 24px 60px rgba(0,0,0,.8)"}}>
        <div style={{fontSize:50,marginBottom:8,display:"inline-block"}} className="fire">🎁</div>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:22,fontWeight:900,color:"#f0c040",letterSpacing:3,marginBottom:4}}>
          ¡BONO DIARIO!</div>
        <div style={{fontSize:11,color:"rgba(255,255,255,.38)",marginBottom:22,letterSpacing:1}}>
          Día {streak} — volvé mañana para ganar más</div>
        <div style={{display:"flex",gap:5,justifyContent:"center",marginBottom:24,flexWrap:"wrap"}}>
          {DAILY.map((amt,i)=>{const done=i<streak,today=i===streak-1;return(
            <div key={i} style={{width:44,borderRadius:12,padding:"7px 3px",textAlign:"center",
              background:today?"rgba(240,192,64,.17)":done?"rgba(76,175,80,.09)":"rgba(255,255,255,.02)",
              border:`2px solid ${today?"#f0c040":done?"#4caf50":"rgba(255,255,255,.06)"}`,transition:"all .3s"}}>
              <div style={{fontSize:8,fontWeight:700,color:today?"#f0c040":done?"#4caf50":"#444",marginBottom:2,letterSpacing:1}}>D{i+1}</div>
              <div style={{fontSize:today?17:11}}>{today?"⭐":done?"✓":"🔒"}</div>
              <div style={{fontSize:8,color:today?"#f0c040":done?"#4caf50":"#333",marginTop:3,fontWeight:700}}>${(amt/1000).toFixed(0)}K</div>
            </div>
          );})}
        </div>
        <div className="neon" style={{fontFamily:"'Cinzel',serif",fontSize:38,fontWeight:900,color:"#f0c040",marginBottom:6}}>
          +${amount.toLocaleString()}</div>
        <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginBottom:22}}>monedas acreditadas</div>
        <button className="btn" onClick={onClose} style={{width:"100%",padding:14,borderRadius:14,fontSize:15,
          background:"linear-gradient(135deg,#f0c040,#e5a000,#f0c040)",backgroundSize:"200% 100%",
          animation:"goldShimmer 3s ease infinite",color:"#1a0f00",letterSpacing:2}}>¡RECLAMAR! 🎉</button>
      </div>
    </div>
  );
}

// ── COIN STORE ─────────────────────────────────────────────────────
function CoinStore({onBuy,onClose}){
  const [sel,setSel]=useState(null);
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.95)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:800,padding:16,overflowY:"auto"}}>
      <div className="pop-in" style={{background:"linear-gradient(160deg,#0a0518,#06020e)",
        border:"1.5px solid rgba(206,147,216,.3)",borderRadius:24,padding:24,width:"100%",maxWidth:400,
        boxShadow:"0 0 60px rgba(206,147,216,.1),0 24px 60px rgba(0,0,0,.8)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <div>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:18,fontWeight:900,color:"#ce93d8",letterSpacing:3}}>💎 TIENDA</div>
            <div style={{fontSize:9,color:"rgba(255,255,255,.22)",letterSpacing:2,marginTop:2}}>MONEDAS DE JUEGO</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.09)",
            borderRadius:10,color:"#666",fontSize:18,padding:"5px 11px",cursor:"pointer",lineHeight:1}}>✕</button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
          {COIN_PACKS.map(pk=>(
            <div key={pk.id} onClick={()=>{SFX.click();setSel(pk.id);}} style={{borderRadius:14,
              border:`2px solid ${sel===pk.id?pk.clr:"rgba(255,255,255,.07)"}`,
              background:sel===pk.id?`${pk.clr}12`:"rgba(255,255,255,.02)",
              padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,transition:"all .2s",position:"relative"}}>
              {pk.tag&&<div style={{position:"absolute",top:-9,right:10,background:pk.clr,color:"#000",
                fontSize:8,fontWeight:900,padding:"2px 9px",borderRadius:20,letterSpacing:1}}>{pk.tag}</div>}
              <div style={{fontSize:30,flexShrink:0}}>{pk.icon}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:800,color:"#fff",marginBottom:2}}>{pk.name}</div>
                <div style={{fontSize:11,color:pk.clr,fontWeight:700}}>
                  ${pk.coins.toLocaleString()} monedas
                  {pk.bonus>0&&<span style={{color:"rgba(255,255,255,.28)"}}> + ${pk.bonus.toLocaleString()} bonus</span>}
                </div>
              </div>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:16,fontWeight:900,color:pk.clr}}>{pk.real}</div>
            </div>
          ))}
        </div>
        <button className="btn" disabled={!sel} onClick={()=>{const pk=COIN_PACKS.find(p=>p.id===sel);if(pk)onBuy(pk);}}
          style={{width:"100%",padding:14,borderRadius:14,fontSize:14,
            background:sel?"linear-gradient(135deg,#ce93d8,#9c27b0)":"rgba(255,255,255,.04)",
            color:sel?"#fff":"#444"}}>
          {sel?`COMPRAR — ${COIN_PACKS.find(p=>p.id===sel)?.real}`:"ELEGÍ UN PAQUETE"}
        </button>
        <div style={{fontSize:8,color:"rgba(255,255,255,.1)",textAlign:"center",marginTop:10,letterSpacing:1}}>Demo · no se realizan cobros reales</div>
      </div>
    </div>
  );
}

// ── BROKE MODAL ────────────────────────────────────────────────────
function BrokeModal({onBuy,onClose}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.95)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:800,padding:16}}>
      <div className="pop-in" style={{background:"linear-gradient(160deg,#200a0a,#0d0404)",
        border:"2px solid rgba(239,83,80,.4)",borderRadius:24,padding:28,width:"100%",maxWidth:340,textAlign:"center",
        boxShadow:"0 0 60px rgba(239,83,80,.14),0 24px 60px rgba(0,0,0,.8)"}}>
        <div style={{fontSize:52,marginBottom:10}}>💸</div>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:20,fontWeight:900,color:"#ef5350",letterSpacing:2,marginBottom:8}}>SIN FICHAS</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,.33)",marginBottom:24,lineHeight:1.7}}>Te quedaste sin monedas.<br/>Comprá más para seguir jugando.</div>
        <button className="btn" onClick={onBuy} style={{width:"100%",padding:14,borderRadius:14,
          background:"linear-gradient(135deg,#ce93d8,#9c27b0)",color:"#fff",fontSize:14,marginBottom:10}}>
          💎 COMPRAR MONEDAS</button>
        <button onClick={onClose} style={{width:"100%",padding:12,borderRadius:12,
          border:"1px solid rgba(255,255,255,.07)",background:"transparent",color:"#555",fontWeight:700,fontSize:12,cursor:"pointer"}}>
          VOLVER AL MENÚ</button>
      </div>
    </div>
  );
}

// ── STATS MODAL ────────────────────────────────────────────────────
function StatsModal({stats,onClose}){
  const wr=stats.hands?Math.round(stats.wins/stats.hands*100):0;
  const rows=[["🃏","Manos",stats.hands],["✅","Victorias",stats.wins],["❌","Derrotas",stats.losses],
    ["🤝","Empates",stats.pushes],["⭐","Blackjacks",stats.blackjacks||0],["✂️","Splits",stats.splits||0],
    ["📈","Win Rate",`${wr}%`],["🔥","Racha máx.",stats.maxStreak||0],["💰","Mayor ganancia",`$${(stats.bigWin||0).toLocaleString()}`]];
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.9)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:700,padding:16}}>
      <div className="pop-in" style={{background:"linear-gradient(160deg,#0a1a0a,#050d05)",
        border:"1.5px solid rgba(240,192,64,.18)",borderRadius:22,padding:24,width:"100%",maxWidth:340,
        boxShadow:"0 24px 60px rgba(0,0,0,.8)"}}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:16,fontWeight:900,color:"#f0c040",textAlign:"center",marginBottom:18,letterSpacing:3}}>
          ESTADÍSTICAS</div>
        {rows.map(([ic,lb,vl])=>(
          <div key={lb} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
            <span style={{fontSize:13,width:20,textAlign:"center"}}>{ic}</span>
            <span style={{flex:1,fontSize:12,color:"rgba(255,255,255,.45)"}}>{lb}</span>
            <span style={{fontSize:13,fontWeight:800,color:"#fff"}}>{vl}</span>
          </div>
        ))}
        <button className="btn" onClick={onClose} style={{width:"100%",marginTop:18,padding:12,borderRadius:12,
          background:"#f0c040",color:"#1a0f00",fontSize:13,letterSpacing:2}}>CERRAR</button>
      </div>
    </div>
  );
}
// ── SHOP SCREEN ────────────────────────────────────────────────────
function ShopScreen({bankroll,owned,sel,onBuy,onSelect,onClose,onCoinStore}){
  const [tab,setTab]=useState("backs");
  const [hover,setHover]=useState(null);
  const items=tab==="backs"?BACKS:FELTS;
  const selId=tab==="backs"?sel.back:sel.felt;
  const prev=hover||(items.find(i=>i.id===selId)||items[0]);
  return(
    <div style={{minHeight:"100vh",background:"radial-gradient(ellipse at 50% 0%,#1a0a2e,#06020a)",
      fontFamily:"'Inter',sans-serif",color:"#fff",padding:16,display:"flex",flexDirection:"column",alignItems:"center"}}>
      <style>{CSS}</style>
      <div style={{position:"fixed",width:220,height:220,borderRadius:"50%",background:"rgba(206,147,216,.07)",
        top:"-5%",left:"-8%",filter:"blur(60px)",animation:"orb 6s ease-in-out infinite",pointerEvents:"none",zIndex:0}}/>
      <div style={{position:"fixed",width:160,height:160,borderRadius:"50%",background:"rgba(240,192,64,.05)",
        top:"50%",right:"-5%",filter:"blur(50px)",animation:"orb 6s ease-in-out infinite",animationDelay:"2s",pointerEvents:"none",zIndex:0}}/>

      <div style={{width:"100%",maxWidth:430,display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22,position:"relative",zIndex:1}}>
        <button onClick={onClose} style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",
          borderRadius:10,color:"#888",padding:"8px 13px",cursor:"pointer",fontSize:18,lineHeight:1}}>←</button>
        <div style={{textAlign:"center"}}>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:18,fontWeight:900,color:"#ce93d8",letterSpacing:4}}>TIENDA</div>
          <div style={{fontSize:9,color:"rgba(255,255,255,.18)",letterSpacing:3,marginTop:2}}>PERSONALIZACIÓN</div>
        </div>
        <div onClick={onCoinStore} style={{background:"rgba(240,192,64,.07)",border:"1px solid rgba(240,192,64,.18)",
          borderRadius:10,padding:"7px 12px",cursor:"pointer",textAlign:"right"}}>
          <div style={{fontSize:8,color:"#888",letterSpacing:1}}>BANKROLL</div>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:14,fontWeight:900,color:"#f0c040"}}>${bankroll.toLocaleString()}</div>
          <div style={{fontSize:8,color:"#ce93d8"}}>+ añadir</div>
        </div>
      </div>

      <div style={{width:"100%",maxWidth:430,display:"flex",gap:8,marginBottom:18,position:"relative",zIndex:1}}>
        {[{id:"backs",l:"🂠 Reverso"},{id:"felts",l:"🎰 Mesa"}].map(({id,l})=>(
          <button key={id} onClick={()=>{SFX.click();setTab(id);setHover(null);}} style={{flex:1,padding:11,borderRadius:12,border:"none",
            fontWeight:800,fontSize:12,cursor:"pointer",
            background:tab===id?"rgba(206,147,216,.11)":"rgba(255,255,255,.03)",
            color:tab===id?"#ce93d8":"#555",
            borderBottom:tab===id?"2.5px solid #ce93d8":"2.5px solid transparent",transition:"all .2s"}}>
            {l}</button>
        ))}
      </div>

      <div className="slide-dn" style={{width:"100%",maxWidth:430,marginBottom:16,position:"relative",zIndex:1}}>
        {tab==="backs"?(
          <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:16,padding:16,display:"flex",alignItems:"center",gap:16}}>
            <Card card={{r:"K",s:"♠"}} hidden back={BACKS.find(b=>b.id===prev.id)||BACKS[0]}/>
            <div>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:15,fontWeight:700,color:"#fff",marginBottom:4}}>{prev.name}</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.38)",marginBottom:5}}>
                {prev.price===0?"Gratis":owned.has(prev.id)?"✅ Comprado":"$"+prev.price.toLocaleString()}</div>
              {prev.id===selId&&<div style={{fontSize:10,color:"#ce93d8",fontWeight:700}}>★ Equipado</div>}
            </div>
          </div>
        ):(
          <div style={{width:"100%",height:70,borderRadius:16,overflow:"hidden",
            background:(FELTS.find(f=>f.id===prev.id)||FELTS[0]).bg,
            display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",
            border:"1px solid rgba(255,255,255,.07)"}}>
            <div style={{fontWeight:800,color:"rgba(255,255,255,.7)",fontSize:13}}>{prev.name}</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,.35)"}}>
              {prev.price===0?"Gratis":owned.has(prev.id)?"✅ Comprado":"$"+prev.price.toLocaleString()}</div>
          </div>
        )}
      </div>

      <div style={{width:"100%",maxWidth:430,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:24,position:"relative",zIndex:1}}>
        {items.map(item=>{
          const isOwned=item.price===0||owned.has(item.id);
          const isSel=item.id===selId;
          const canBuy=!isOwned&&bankroll>=item.price;
          return(
            <div key={item.id} onMouseEnter={()=>setHover(item)} onMouseLeave={()=>setHover(null)}
              style={{borderRadius:14,
                border:`2px solid ${isSel?"#ce93d8":isOwned?"rgba(76,175,80,.28)":"rgba(255,255,255,.05)"}`,
                background:isSel?"rgba(206,147,216,.06)":"rgba(255,255,255,.02)",padding:12,transition:"all .2s"}}>
              {tab==="backs"?(
                <div style={{width:"100%",height:54,borderRadius:10,marginBottom:8,
                  background:`linear-gradient(135deg,${item.c1},${item.c2})`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  color:"rgba(255,255,255,.1)",fontSize:18,fontFamily:"serif",
                  boxShadow:"0 4px 12px rgba(0,0,0,.4)"}}>♦</div>
              ):(
                <div style={{width:"100%",height:54,borderRadius:10,marginBottom:8,
                  background:(FELTS.find(f=>f.id===item.id)||FELTS[0]).bg,
                  boxShadow:"0 4px 12px rgba(0,0,0,.4)"}}/>
              )}
              <div style={{fontSize:11,fontWeight:800,color:"#ccc",marginBottom:7}}>{item.name}</div>
              {isSel?(
                <div style={{padding:5,borderRadius:7,background:"rgba(206,147,216,.14)",color:"#ce93d8",fontSize:10,fontWeight:800,textAlign:"center"}}>★ ACTIVO</div>
              ):isOwned?(
                <button className="btn" onClick={()=>{SFX.click();onSelect(tab==="backs"?"back":"felt",item.id);}}
                  style={{width:"100%",padding:5,borderRadius:7,background:"rgba(76,175,80,.13)",color:"#66bb6a",fontSize:10}}>
                  EQUIPAR</button>
              ):(
                <button className="btn" disabled={!canBuy}
                  onClick={()=>{if(canBuy){SFX.buy();onBuy(item.id,item.price,tab==="backs"?"back":"felt");}}}
                  style={{width:"100%",padding:5,borderRadius:7,fontSize:10,
                    background:canBuy?"linear-gradient(135deg,#ce93d8,#9c27b0)":"rgba(255,255,255,.03)",
                    color:canBuy?"#fff":"#333"}}>
                  {`$${item.price.toLocaleString()}${!canBuy?" 🔒":""}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MAIN MENU ──────────────────────────────────────────────────────
function MainMenu({save,onStart,onShop,onCoinStore}){
  const [diff,setDiff]=useState("med");
  const [showStats,setShowStats]=useState(false);
  const felt=FELTS.find(f=>f.id===save.sel.felt)||FELTS[0];
  const modes=[
    {id:"bj_solo",icon:"🎴",title:"Blackjack Solo",         sub:"vs Casa · Doble · Split · Seguro"},
    {id:"bj_pvp", icon:"⚔️", title:"Jugador vs Jugador",    sub:"PvP · Sin dealer · El mejor de 21"},
    {id:"bj_coop",icon:"🤝",title:"Cooperativo vs Casa",    sub:"2 jugadores vs el dealer"},
    {id:"poker",  icon:"♠",  title:"Póker 5 Cartas",        sub:"Draw Poker · Multiplicadores ×250"},
  ];
  return(
    <div style={{minHeight:"100vh",background:felt.bg,fontFamily:"'Inter',sans-serif",color:"#fff",
      display:"flex",flexDirection:"column",alignItems:"center",padding:"22px 16px 48px",position:"relative",overflow:"hidden"}}>
      <style>{CSS}</style>
      {showStats&&<StatsModal stats={save.stats} onClose={()=>setShowStats(false)}/>}
      <div style={{position:"fixed",width:300,height:300,borderRadius:"50%",background:"rgba(240,192,64,.05)",
        top:"-8%",left:"50%",transform:"translateX(-50%)",filter:"blur(70px)",
        animation:"orb 6s ease-in-out infinite",pointerEvents:"none",zIndex:0}}/>

      {/* Bankroll + streak */}
      <div className="glass-g slide-dn" style={{width:"100%",maxWidth:430,borderRadius:18,padding:"13px 20px",
        marginBottom:22,display:"flex",alignItems:"center",justifyContent:"space-between",position:"relative",zIndex:1}}>
        <div>
          <div style={{fontSize:9,color:"rgba(255,255,255,.28)",letterSpacing:4,marginBottom:2}}>BANKROLL</div>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:26,fontWeight:900,
            color:save.bankroll<10000?"#ef5350":"#f0c040"}}>${save.bankroll.toLocaleString()}</div>
          {save.bankroll<10000&&<div style={{fontSize:9,color:"#ef5350",marginTop:2}}>⚠ Fondos bajos</div>}
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,.28)",letterSpacing:2,marginBottom:4}}>RACHA DIARIA</div>
          <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end"}}>
            <span className="fire" style={{fontSize:22,display:"inline-block"}}>🔥</span>
            <span style={{fontFamily:"'Cinzel',serif",fontSize:24,fontWeight:900,color:"#ff7043"}}>{save.loginStreak||0}</span>
          </div>
          <div style={{fontSize:8,color:"rgba(255,255,255,.22)"}}>días seguidos</div>
        </div>
      </div>

      {/* Logo */}
      <div className="slide-dn" style={{textAlign:"center",marginBottom:26,animationDelay:".05s",position:"relative",zIndex:1}}>
        <div style={{fontSize:11,letterSpacing:10,color:"rgba(240,192,64,.3)",marginBottom:7}}>♠ ♥ ♦ ♣</div>
        <div className="neon" style={{fontFamily:"'Cinzel',serif",fontSize:40,fontWeight:900,color:"#f0c040",letterSpacing:5,lineHeight:1.1}}>
          CASINO<br/><span style={{fontSize:26,letterSpacing:12}}>NEXUS</span></div>
        <div style={{fontSize:9,color:"rgba(255,255,255,.12)",letterSpacing:4,marginTop:8}}>v5 · PROFESSIONAL</div>
      </div>

      <div className="neon-line" style={{width:"100%",maxWidth:430,marginBottom:20,position:"relative",zIndex:1}}/>

      {/* Mode buttons */}
      <div style={{width:"100%",maxWidth:430,marginBottom:16,position:"relative",zIndex:1,display:"flex",flexDirection:"column",gap:9}}>
        {modes.map((m,i)=>(
          <button key={m.id} className="btn" onClick={()=>{SFX.click();onStart(m.id,diff);}}
            style={{width:"100%",padding:"15px 18px",borderRadius:16,
              border:"1.5px solid rgba(240,192,64,.07)",background:"rgba(0,0,0,.3)",color:"#fff",
              display:"flex",alignItems:"center",gap:14,textAlign:"left",animationDelay:`${.08+i*.05}s`}}>
            <span style={{fontSize:26,flexShrink:0}}>{m.icon}</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:14,marginBottom:3,letterSpacing:.5}}>{m.title}</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,.26)",fontWeight:500}}>{m.sub}</div>
            </div>
            <span style={{color:"rgba(240,192,64,.28)",fontSize:22,flexShrink:0}}>›</span>
          </button>
        ))}
      </div>

      {/* Difficulty */}
      <div style={{width:"100%",maxWidth:430,marginBottom:14,position:"relative",zIndex:1}}>
        <div style={{fontSize:8,letterSpacing:5,color:"rgba(255,255,255,.18)",marginBottom:10,textAlign:"center"}}>DIFICULTAD</div>
        <div style={{display:"flex",gap:8}}>
          {Object.entries(DIFF).map(([k,d])=>(
            <button key={k} onClick={()=>{SFX.click();setDiff(k);}} style={{flex:1,padding:"10px 0",borderRadius:12,cursor:"pointer",
              border:`2px solid ${diff===k?d.color:"rgba(255,255,255,.05)"}`,
              background:diff===k?`${d.color}16`:"rgba(0,0,0,.22)",
              color:diff===k?d.color:"#444",fontWeight:800,fontSize:13,fontFamily:"'Inter',sans-serif",transition:"all .2s"}}>
              {d.label}</button>
          ))}
        </div>
        {diff==="easy"&&<div className="slide-dn" style={{textAlign:"center",fontSize:9,color:"#66bb6a",marginTop:6}}>💡 Hints de estrategia básica activados</div>}
        {diff==="hard"&&<div className="slide-dn" style={{textAlign:"center",fontSize:9,color:"#ef5350",marginTop:6}}>⚠ 6 mazos · Dealer pide soft 17 · Sin ayudas</div>}
      </div>

      {/* Action row */}
      <div style={{width:"100%",maxWidth:430,display:"flex",gap:8,marginBottom:8,position:"relative",zIndex:1}}>
        <button className="btn" onClick={()=>{SFX.click();onShop();}} style={{flex:1,padding:11,borderRadius:12,
          background:"rgba(206,147,216,.07)",border:"1.5px solid rgba(206,147,216,.18)",color:"#ce93d8",fontSize:12}}>🛍 Tienda</button>
        <button className="btn" onClick={()=>{SFX.click();setShowStats(true);}} style={{flex:1,padding:11,borderRadius:12,
          background:"rgba(255,255,255,.04)",border:"1.5px solid rgba(255,255,255,.07)",color:"#aaa",fontSize:12}}>📊 Stats</button>
        <button className="btn" onClick={()=>{SFX.click();onCoinStore();}} style={{flex:1,padding:11,borderRadius:12,
          background:"rgba(240,192,64,.07)",border:"1.5px solid rgba(240,192,64,.18)",color:"#f0c040",fontSize:12}}>💎 Comprar</button>
      </div>
    </div>
  );
}

// ── BLACKJACK GAME ─────────────────────────────────────────────────
function BJGame({mode,difficulty,bankroll,cosmetics,onExit,onStats,onBroke}){
  const D=DIFF[difficulty];
  const CB=BACKS.find(b=>b.id===cosmetics.back)||BACKS[0];
  const TF=FELTS.find(f=>f.id===cosmetics.felt)||FELTS[0];
  const isPvP=mode==="bj_pvp", isCoop=mode==="bj_coop";

  const [deck,setDeck]=useState([]);
  const dkRef=useRef([]);
  const [dlr,setDlr]=useState([]);
  const [h1,setH1]=useState([]);
  const [h1b,setH1b]=useState(null);
  const [h2,setH2]=useState([]);
  const [b1,setB1]=useState(bankroll);
  const [b2,setB2]=useState(bankroll);
  const [bet1,setBet1]=useState(0);
  const [bet1b,setBet1b]=useState(0);
  const [bet2,setBet2]=useState(0);
  const [splitOn,setSplitOn]=useState(false);
  const [splitIdx,setSplitIdx]=useState(0);
  const [phase,setPhase]=useState("bet1");
  const [result,setResult]=useState(null);
  const [dlrMsg,setDlrMsg]=useState(rnd(DLR.start));
  const [mood,setMood]=useState("😐");
  const [thinking,setThk]=useState(false);
  const [boom,setBoom]=useState(false);
  const [shaking,setShaking]=useState(false);
  const [streak,setStreak]=useState(0);
  const [toast,setToast]=useState(null);
  const [ins,setIns]=useState("none");
  const [insBet,setInsBet]=useState(0);
  const [hist,setHist]=useState([]);
  const [holeHid,setHoleHid]=useState(true);
  const [holeFlip,setHoleFl]=useState(false);
  const [winCards,setWinCards]=useState([]);
  const [showBroke,setShowBroke]=useState(false);

  const flash=(msg,t)=>{setToast({msg,type:t});setTimeout(()=>setToast(null),3000);};
  const shake=()=>{setShaking(true);setTimeout(()=>setShaking(false),500);};
  const confetti=(ms=1700)=>{setBoom(true);setTimeout(()=>setBoom(false),ms);};
  const showHole=["dlr","res"].includes(phase);
  const activeH=splitOn?(splitIdx===0?h1:h1b??[]):h1;
  const hint=D.hint&&activeH.length>0&&dlr.length>0&&phase==="p1"?bjHint(activeH,dlr[0],canSplitH(h1)&&!splitOn):null;

  function revealHole(){setHoleFl(true);setTimeout(()=>setHoleHid(false),220);setTimeout(()=>setHoleFl(false),470);}
  function drawCard(){const c=dkRef.current[0];dkRef.current=dkRef.current.slice(1);setDeck([...dkRef.current]);return c;}

  function addChip(pl,amt){SFX.chip();if(pl===1&&b1>=amt){setB1(v=>v-amt);setBet1(v=>v+amt);}if(pl===2&&b2>=amt){setB2(v=>v-amt);setBet2(v=>v+amt);}}
  function clearBet(pl){SFX.click();if(pl===1){setB1(v=>v+bet1);setBet1(0);}if(pl===2){setB2(v=>v+bet2);setBet2(0);}}

  function startDeal(){
    if(!bet1)return;
    if((isCoop||isPvP)&&!bet2)return;
    const dk=shuf(mkDeck(D.decks));
    let i=0;
    const nh1=[dk[i++],dk[i++]];
    const nd=isPvP?[]:[dk[i++],dk[i++]];
    const nh2=(isCoop||isPvP)?[dk[i++],dk[i++]]:[];
    dkRef.current=dk.slice(i);setDeck(dk.slice(i));
    setH1(nh1);setH2(nh2);setDlr(nd);
    setH1b(null);setSplitOn(false);setSplitIdx(0);setBet1b(0);
    setIns("none");setInsBet(0);setHoleHid(true);setHoleFl(false);setWinCards([]);
    setDlrMsg(rnd(DLR.start));setMood("😐");SFX.card();
    if(isPvP){setPhase("p1");return;}
    if(isBJ(nh1)||isBJ(nd)){setTimeout(()=>resolveAll(nh1,nd,nh2,bet1,bet2,null,0),900);return;}
    if(nd[0]?.r==="A")setTimeout(()=>setIns("offered"),700);
    setPhase("p1");
  }

  function hit(pl=1){
    SFX.card();const card=drawCard();
    if(pl===1){
      if(splitOn){
        if(splitIdx===0){const nh=[...h1,card];setH1(nh);if(bust(nh)){shake();setTimeout(()=>setSplitIdx(1),500);}}
        else{const nh=[...h1b,card];setH1b(nh);if(bust(nh)){shake();setTimeout(()=>p1Done(h1,nh),500);}}
      }else{const nh=[...h1,card];setH1(nh);if(bust(nh)){shake();setTimeout(()=>p1Done(nh,null),600);}}
    }else{const nh=[...h2,card];setH2(nh);if(bust(nh)){shake();setTimeout(()=>{if(isPvP)resolveAll(h1,dlr,nh,bet1,bet2,h1b,bet1b);else runDealer(h1,dlr,nh,bet1,bet2,h1b,bet1b);},650);}}
  }

  function stand(pl=1){
    SFX.click();
    if(pl===1){
      if(splitOn){if(splitIdx===0)setSplitIdx(1);else p1Done(h1,h1b);}
      else p1Done(h1,null);
    }else{
      if(isPvP) resolveAll(h1,dlr,h2,bet1,bet2,h1b,bet1b);
      else runDealer(h1,dlr,h2,bet1,bet2,h1b,bet1b);
    }
  }

  function p1Done(ph1,ph1b){
    if(isPvP){setPhase("handoff");return;}
    if(isCoop&&bet2>0){setPhase("p2");return;}
    runDealer(ph1,dlr,h2,bet1,bet2,ph1b,bet1b);
  }

  function doDouble(pl=1){
    if(pl===1&&b1>=bet1){
      const nb=bet1*2;setB1(v=>v-bet1);setBet1(nb);
      const card=drawCard();const nh=[...h1,card];setH1(nh);SFX.card();
      if(bust(nh))shake();setTimeout(()=>p1Done(nh,null),500);
    }else if(pl===2&&b2>=bet2){
      const nb=bet2*2;setB2(v=>v-bet2);setBet2(nb);
      const card=drawCard();const nh=[...h2,card];setH2(nh);SFX.card();
      if(bust(nh))shake();setTimeout(()=>runDealer(h1,dlr,nh,bet1,nb,h1b,bet1b),500);
    }
  }

  function doSplit(){
    if(!canSplitH(h1)||b1<bet1)return;SFX.split();
    const c1=drawCard(),c2=drawCard();
    const nh1=[h1[0],c1],nh1b=[h1[1],c2];
    setB1(v=>v-bet1);setBet1b(bet1);
    setH1(nh1);setH1b(nh1b);setSplitOn(true);setSplitIdx(0);
    flash("✂️ ¡Mano dividida!","split");onStats({splits:1});
  }

  function takeIns(){const cost=Math.floor(bet1/2);if(b1<cost)return;setB1(v=>v-cost);setInsBet(cost);setIns("taken");SFX.chip();}

  function runDealer(ph1,dh,ph2,bA,bB,ph1b,bAb){
    if(isPvP)return;
    setPhase("dlr");setThk(true);setMood("🤔");revealHole();
    let dhand=[...dh];
    function step(){
      const t=tot(dhand),go=t<D.stand||(D.hitSoft17&&isSoft17(dhand));
      if(go&&t<=21){
        const c=dkRef.current[0];dkRef.current=dkRef.current.slice(1);
        dhand=[...dhand,c];setDlr([...dhand]);setDeck([...dkRef.current]);SFX.card();setTimeout(step,700);
      }else{setThk(false);setTimeout(()=>resolveAll(ph1,dhand,ph2,bA,bB,ph1b,bAb),380);}
    }
    setTimeout(step,960);
  }

  function resolveAll(ph1,dh,ph2,bA,bB,ph1b,bAb){
    setDlr(dh);setPhase("res");
    const insG=ins==="taken"&&isBJ(dh)?insBet*2:0;
    if(isPvP){
      const t1=tot(ph1),t2=tot(ph2),bj1=isBJ(ph1),bj2=isBJ(ph2),b1b=bust(ph1),b2b=bust(ph2);
      let r1,r2;
      if(bj1&&!bj2){r1="bj";r2="lose";}else if(bj2&&!bj1){r1="lose";r2="bj";}
      else if(b1b&&!b2b){r1="lose";r2="win";}else if(b2b&&!b1b){r1="win";r2="lose";}
      else if(b1b&&b2b){r1="push";r2="push";}
      else if(t1>t2){r1="win";r2="lose";}else if(t2>t1){r1="lose";r2="win";}else{r1="push";r2="push";}
      const pay=(r,b)=>r==="bj"?Math.floor(b*2.5):r==="win"?b*2:r==="push"?b:0;
      const g1=pay(r1,bA),g2=pay(r2,bB);
      setB1(v=>v+g1);setB2(v=>v+g2);
      if(r1==="win"||r1==="bj"){SFX.win();confetti();}else if(r1==="lose")SFX.lose();else SFX.push();
      setResult({isPvP:true,r1,r2,g1,g2,bA,bB});
      setHist(h=>[{r1,bA,g1},...h.slice(0,9)]);
      onStats({hands:1,wins:r1==="win"||r1==="bj"?1:0,losses:r1==="lose"?1:0,pushes:r1==="push"?1:0,blackjacks:r1==="bj"?1:0,bigWin:g1-bA,maxStreak:0});
      return;
    }
    const calc=(h,bjF)=>{
      if(bjF&&isBJ(dh))return"push";if(bjF)return"bj";if(bust(h))return"lose";
      if(bust(dh))return"win";const t=tot(h),dt=tot(dh);return t>dt?"win":dt>t?"lose":"push";
    };
    const r1=calc(ph1,isBJ(ph1)),r1b=ph1b?calc(ph1b,isBJ(ph1b)):null,r2=isCoop&&ph2.length>0?calc(ph2,isBJ(ph2)):null;
    const pay=(r,b)=>r==="bj"?Math.floor(b*2.5):r==="win"?b*2:r==="push"?b:0;
    const g1=pay(r1,bA)+insG,g1b=r1b!==null?pay(r1b,bAb):0,g2=r2!==null?pay(r2,bB):0;
    setB1(v=>v+g1+g1b);if(isCoop)setB2(v=>v+g2);
    const won=r1==="win"||r1==="bj";const ns=won?streak+1:0;setStreak(ns);
    if(won&&!bust(ph1))setWinCards(ph1.map((_,i)=>i));
    setMood({bj:"😲",win:"😤",lose:"😏",push:"😐"}[r1]||"😐");
    if(r1==="bj"){SFX.bj();confetti(2400);setDlrMsg(rnd(DLR.pBJ));flash("⭐ ¡BLACKJACK! +$"+(g1-bA).toLocaleString(),"bj");}
    else if(isBJ(dh)){SFX.lose();setDlrMsg(rnd(DLR.dBJ));flash("Dealer Blackjack 😱","lose");}
    else if(bust(ph1)){SFX.lose();setDlrMsg(rnd(DLR.pBust));}
    else if(bust(dh)){SFX.win();confetti();setDlrMsg(rnd(DLR.dBust));}
    else if(won){SFX.win();confetti();setDlrMsg(rnd(DLR.win));if(ns>=3)flash(`🔥 Racha de ${ns}!`,"fire");}
    else if(r1==="lose"){SFX.lose();setDlrMsg(rnd(DLR.lose));}
    else{SFX.push();setDlrMsg(rnd(DLR.push));}
    onStats({hands:1,wins:won?1:0,losses:r1==="lose"?1:0,pushes:r1==="push"?1:0,blackjacks:r1==="bj"?1:0,bigWin:g1-bA,maxStreak:ns});
    setResult({r1,r1b,r2,g1,g1b,g2,bA,bAb:bAb||0,bB,splitWas:!!ph1b,dBJ:isBJ(dh)});
    setHist(h=>[{r1,bA,g1},...h.slice(0,9)]);
  }

  function nextHand(){
    SFX.click();
    if(b1<=0&&bet1<=0){setShowBroke(true);return;}
    setH1([]);setH2([]);setDlr([]);setBet1(0);setBet2(0);setResult(null);
    setIns("none");setInsBet(0);setWinCards([]);setHoleHid(true);
    setH1b(null);setSplitOn(false);setSplitIdx(0);setBet1b(0);setPhase("bet1");
  }

  const RC={win:"#4caf50",bj:"#f0c040",lose:"#ef5350",push:"#ffa726"};
  const RL={win:"GANASTE 🎉",bj:"¡BLACKJACK! 💥",lose:"PERDISTE 💀",push:"EMPATE 🤝"};
  const canDbl=phase==="p1"&&!splitOn&&h1.length===2&&b1>=bet1;
  const canSplitNow=phase==="p1"&&!splitOn&&canSplitH(h1)&&b1>=bet1;
  const titles={bj_solo:"BLACKJACK",bj_pvp:"J1 ⚔️ J2",bj_coop:"COOP vs CASA"};

  return(
    <div style={{minHeight:"100vh",background:TF.bg,fontFamily:"'Inter',sans-serif",color:"#fff",
      padding:"12px 12px 40px",display:"flex",flexDirection:"column",alignItems:"center",position:"relative"}}>
      <style>{CSS}</style>
      <Confetti active={boom}/>
      {toast&&<Toast msg={toast.msg} type={toast.type}/>}
      {showBroke&&<BrokeModal onBuy={()=>{setShowBroke(false);onBroke();}} onClose={()=>onExit(Math.max(b1,b2))}/>}

      {/* ── PvP HANDOFF ─────────────────────────────────────── */}
      {isPvP&&phase==="handoff"&&(
        <div style={{position:"fixed",inset:0,zIndex:500,background:"#000",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
          gap:22,padding:32,fontFamily:"'Inter',sans-serif"}}>
          <div className="neon" style={{fontFamily:"'Cinzel',serif",fontSize:40,fontWeight:900,
            color:"#f0c040",letterSpacing:4,lineHeight:1}}>⚔️</div>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:20,fontWeight:900,color:"#f0c040",
            letterSpacing:3,textAlign:"center"}}>J1 — LISTO</div>
          <div className="neon-line" style={{width:180}}/>
          <div style={{fontSize:13,color:"rgba(255,255,255,.4)",textAlign:"center",lineHeight:2}}>
            Entregá el dispositivo al<br/>
            <span style={{color:"#42a5f5",fontWeight:900,fontSize:18,letterSpacing:2}}>JUGADOR 2</span>
          </div>
          <div style={{fontSize:10,color:"rgba(255,255,255,.18)",textAlign:"center",letterSpacing:1}}>
            Las cartas de J1 quedan ocultas hasta el final
          </div>
          <button className="btn" onClick={()=>{SFX.click();setPhase("p2");}}
            style={{padding:"15px 44px",borderRadius:16,fontSize:15,marginTop:10,letterSpacing:2,
              background:"linear-gradient(135deg,#42a5f5,#1565c0)",color:"#fff",
              boxShadow:"0 4px 24px rgba(66,165,245,.35)"}}>
            J2 — LISTO ▶
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{width:"100%",maxWidth:480,display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <button onClick={()=>onExit(Math.max(b1,b2))} style={{background:"rgba(0,0,0,.4)",border:"1px solid rgba(255,255,255,.07)",
          borderRadius:10,color:"#666",fontSize:20,padding:"6px 12px",cursor:"pointer",lineHeight:1}}>←</button>
        <div style={{textAlign:"center"}}>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:13,fontWeight:900,color:"#f0c040",letterSpacing:3}}>{titles[mode]}</div>
          <div style={{fontSize:9,color:D.color,letterSpacing:3,marginTop:2}}>{D.label.toUpperCase()}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {streak>=2&&<div className="fire" style={{display:"inline-block",fontSize:12,color:"#ff7043",fontWeight:900}}>🔥{streak}</div>}
        </div>
      </div>

      {/* Budget bars */}
      <div style={{width:"100%",maxWidth:480,display:"flex",gap:8,marginBottom:12}}>
        {[{lbl:isPvP?"J1":isCoop?"J1":"TÚ",bgt:b1,bt:bet1,on:["bet1","p1"].includes(phase),clr:"#f0c040"},
          ...((isCoop||isPvP)?[{lbl:isPvP?"J2":"J2",bgt:b2,bt:bet2,on:["bet2","p2"].includes(phase),clr:"#42a5f5"}]:[])
        ].map(({lbl,bgt,bt,on,clr},i)=>(
          <div key={i} style={{flex:1,borderRadius:14,padding:"10px 14px",
            background:on?"rgba(0,0,0,.45)":"rgba(0,0,0,.22)",
            border:`1.5px solid ${on?clr+"44":"rgba(255,255,255,.05)"}`,
            boxShadow:on?`0 0 20px ${clr}14`:"none",transition:"all .3s"}}>
            <div style={{fontSize:9,color:on?clr:"#444",letterSpacing:2,marginBottom:3,fontWeight:700}}>{lbl}</div>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:20,fontWeight:900,color:bgt<10000?"#ef5350":clr}}>${bgt.toLocaleString()}</div>
            {bt>0&&<div style={{fontSize:9,color:"rgba(255,255,255,.28)",marginTop:2}}>apuesta ${bt.toLocaleString()}{splitOn&&bet1b>0&&i===0?` + $${bet1b.toLocaleString()}`:""}</div>}
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="felt" style={{width:"100%",maxWidth:480,background:"rgba(0,0,0,.25)",
        border:"1px solid rgba(255,255,255,.04)",borderRadius:22,padding:16,marginBottom:12}}>
        {!isPvP&&(
          <div style={{background:"radial-gradient(ellipse at 50% 0%,rgba(240,192,64,.05),transparent 70%)",borderRadius:14,padding:"10px 12px",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <div className={thinking?"pulse":""} style={{fontSize:26,transition:"all .3s"}}>{mood}</div>
              <div>
                <div style={{fontSize:8,color:"rgba(255,255,255,.22)",letterSpacing:3}}>DEALER</div>
                {dlr.length>0&&<SB v={showHole?(holeHid?cv(dlr[0]?.r||"2"):tot(dlr)):cv(dlr[0]?.r||"2")}
                  busted={showHole&&!holeHid&&bust(dlr)}/>}
              </div>
              <div style={{flex:1,textAlign:"right",fontSize:10,color:"rgba(255,255,255,.18)",fontStyle:"italic",lineHeight:1.35,maxWidth:160}}>"{dlrMsg}"</div>
            </div>
            <div style={{display:"flex",gap:7,flexWrap:"wrap",minHeight:98}}>
              {dlr.map((c,i)=><Card key={c.id||i} card={c} hidden={i===1?(showHole?holeHid:true):false}
                revealing={i===1&&holeFlip} delay={i*100} back={CB}/>)}
            </div>
          </div>
        )}
        <div className="neon-line" style={{marginBottom:12}}/>
        {/* P1 */}
        {h1.length>0&&(
          <div style={{marginBottom:(isCoop||isPvP)&&h2.length>0?12:0}}>
            {splitOn&&h1b?(
              <div>
                <div style={{fontSize:8,color:"#7986cb",letterSpacing:3,marginBottom:9,fontWeight:700}}>✂️ SPLIT — J1</div>
                <div style={{display:"flex",gap:10}}>
                  {[{h:h1,bet:bet1,on:splitIdx===0,lbl:"A"},{h:h1b,bet:bet1b,on:splitIdx===1,lbl:"B"}].map((s,si)=>(
                    <div key={si} style={{flex:1,borderRadius:14,padding:10,
                      background:s.on?"rgba(121,134,203,.07)":"rgba(0,0,0,.18)",
                      border:`1.5px solid ${s.on?"rgba(121,134,203,.38)":"rgba(255,255,255,.04)"}`,transition:"all .3s"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:7}}>
                        <span style={{fontSize:9,color:s.on?"#7986cb":"#555",fontWeight:700}}>Mano {s.lbl}{s.on?" ◀":""}</span>
                        <SB v={tot(s.h)} busted={bust(s.h)} bj={isBJ(s.h)} color="#7986cb"/>
                      </div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {s.h.map((c,i)=><Card key={c.id||i} card={c} delay={i*70} back={CB} small/>)}
                      </div>
                      <div style={{fontSize:8,color:"rgba(255,255,255,.22)",marginTop:6}}>Apuesta ${s.bet.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            ):(
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <span style={{fontSize:8,color:phase==="p1"?"#f0c040":"rgba(255,255,255,.22)",letterSpacing:3,fontWeight:700}}>
                    {isPvP?"J1":isCoop?"J1":"TÚ"}{phase==="p1"?" ◀":""}</span>
                  {h1.length>0&&(isPvP&&phase==="p2"
                    ?<SB v={"?"} color="#f0c040"/>
                    :<SB v={tot(h1)} busted={bust(h1)} bj={isBJ(h1)} color="#f0c040"/>)}
                </div>
                <div className={shaking?"shk":""} style={{display:"flex",gap:7,flexWrap:"wrap",minHeight:98}}>
                  {h1.map((c,i)=><Card key={c.id||i} card={c}
                    hidden={isPvP&&phase==="p2"&&i>0}
                    delay={i*90} back={CB}
                    winAnim={phase==="res"&&winCards.includes(i)&&(result?.r1==="win"||result?.r1==="bj")}/>)}
                </div>
              </div>
            )}
          </div>
        )}
        {/* P2 */}
        {(isCoop||isPvP)&&h2.length>0&&(
          <div style={{paddingTop:12,borderTop:"1px solid rgba(255,255,255,.04)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{fontSize:8,color:phase==="p2"?"#42a5f5":"rgba(255,255,255,.22)",letterSpacing:3,fontWeight:700}}>
                J2{phase==="p2"?" ◀":""}</span>
              {h2.length>0&&(isPvP&&phase==="p1"
                ?<SB v={"?"} color="#42a5f5"/>
                :<SB v={tot(h2)} busted={bust(h2)} bj={isBJ(h2)} color="#42a5f5"/>)}
            </div>
            <div style={{display:"flex",gap:7,flexWrap:"wrap",minHeight:98}}>
              {h2.map((c,i)=><Card key={c.id||i} card={c}
                hidden={isPvP&&phase==="p1"&&i>0}
                delay={i*90} back={CB}/>)}
            </div>
          </div>
        )}
      </div>

      {/* Hint */}
      {hint&&<div className="slide-up" style={{width:"100%",maxWidth:480,marginBottom:10,
        background:"rgba(0,0,0,.38)",border:`1.5px solid ${hint.c}38`,borderRadius:12,padding:"9px 14px",
        display:"flex",gap:10,alignItems:"center"}}>
        <span style={{fontSize:16}}>💡</span>
        <div><div style={{fontSize:12,fontWeight:800,color:hint.c}}>{hint.a}</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,.32)",marginTop:1}}>{hint.t}</div></div>
      </div>}

      {/* Insurance */}
      {ins==="offered"&&phase==="p1"&&<div className="slide-up" style={{width:"100%",maxWidth:480,marginBottom:10,
        background:"rgba(255,193,7,.05)",border:"1.5px solid rgba(255,193,7,.28)",borderRadius:14,padding:"12px 16px"}}>
        <div style={{fontSize:12,color:"#ffc107",fontWeight:800,marginBottom:10}}>
          🛡 Dealer muestra As — ¿Seguro? (${Math.floor(bet1/2).toLocaleString()})</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn" disabled={b1<Math.floor(bet1/2)} onClick={takeIns}
            style={{flex:1,padding:10,borderRadius:10,background:"#f9a825",color:"#1a0f00",fontSize:12}}>SÍ — ASEGURAR</button>
          <button className="btn" onClick={()=>setIns("declined")}
            style={{flex:1,padding:10,borderRadius:10,background:"rgba(0,0,0,.32)",color:"#888",fontSize:12}}>NO, SEGUIR</button>
        </div>
      </div>}

      {/* Result */}
      {result&&<div className="pop-in" style={{width:"100%",maxWidth:480,marginBottom:12,
        background:"rgba(0,0,0,.52)",border:`1.5px solid ${RC[result.r1]}28`,borderRadius:18,padding:"16px 18px",
        textAlign:"center",boxShadow:`0 0 40px ${RC[result.r1]}14`}}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:24,fontWeight:900,color:RC[result.r1],
          textShadow:`0 0 20px ${RC[result.r1]}88`,marginBottom:6}}>
          {result.isPvP?"J1: ":""}{RL[result.r1]}</div>
        {result.splitWas&&result.r1b&&<div style={{fontSize:11,color:"rgba(255,255,255,.38)",marginBottom:5}}>
          <span style={{color:RC[result.r1]}}>Mano A: {RL[result.r1]}</span>
          <span style={{color:"#333",margin:"0 7px"}}>·</span>
          <span style={{color:RC[result.r1b]}}>Mano B: {RL[result.r1b]}</span></div>}
        {result.isPvP&&result.r2&&<div style={{fontSize:15,color:RC[result.r2],fontWeight:800,marginTop:4}}>J2: {RL[result.r2]}</div>}
        {!result.isPvP&&result.r2&&isCoop&&<div style={{fontSize:13,color:RC[result.r2],marginTop:4}}>J2: {RL[result.r2]}</div>}
        <div style={{fontSize:12,color:"rgba(255,255,255,.38)",marginTop:8}}>
          {(result.g1||0)+(result.g1b||0)>(result.bA||0)+(result.bAb||0)
            ?`+$${((result.g1||0)+(result.g1b||0)-(result.bA||0)-(result.bAb||0)).toLocaleString()} netos`
            :(result.g1||0)+(result.g1b||0)===0?`-$${((result.bA||0)+(result.bAb||0)).toLocaleString()} perdidos`
            :"Recuperaste la apuesta"}
        </div>
      </div>}

      {/* Controls */}
      <div style={{width:"100%",maxWidth:480}}>
        {phase==="bet1"&&<div className="slide-up">
          <div style={{fontSize:8,letterSpacing:5,color:"rgba(255,255,255,.16)",marginBottom:12,textAlign:"center"}}>
            {(isCoop||isPvP)?"JUGADOR 1 — APUESTA":"ELIGE TU APUESTA"}</div>
          <div style={{display:"flex",gap:7,justifyContent:"center",flexWrap:"wrap",marginBottom:14}}>
            {CHIPS.filter(c=>c.v<=b1).map((c,i)=><Chip key={c.v} chip={c} ai={i} onClick={()=>addChip(1,c.v)}/>)}
          </div>
          {bet1>0&&<div style={{textAlign:"center",marginBottom:12,fontSize:12,color:"#f0c040",fontWeight:700}}>
            Apostado: ${bet1.toLocaleString()}
            <button onClick={()=>clearBet(1)} style={{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:11,marginLeft:8}}>← quitar</button>
          </div>}
          <button className="btn" disabled={!bet1}
            onClick={()=>{if(isCoop||isPvP){SFX.click();setPhase("bet2");}else{SFX.click();startDeal();}}}
            style={{width:"100%",padding:16,borderRadius:14,fontSize:15,
              background:bet1?"linear-gradient(135deg,#f0c040,#e5a000)":"rgba(255,255,255,.04)",
              color:bet1?"#1a0f00":"#333"}}>
            {(isCoop||isPvP)?"SIGUIENTE →":`REPARTIR — $${bet1.toLocaleString()}`}
          </button>
          {!b1&&!bet1&&<div style={{textAlign:"center",marginTop:10,fontSize:12,color:"#ef5350"}}>
            Sin fichas 💸 <button onClick={()=>setShowBroke(true)} style={{background:"none",border:"none",color:"#ce93d8",cursor:"pointer",textDecoration:"underline"}}>Comprar</button>
          </div>}
        </div>}

        {phase==="bet2"&&(isCoop||isPvP)&&<div className="slide-up">
          <div style={{fontSize:8,letterSpacing:5,color:"#42a5f5",marginBottom:12,textAlign:"center",fontWeight:700}}>
            JUGADOR 2 — APUESTA</div>
          <div style={{display:"flex",gap:7,justifyContent:"center",flexWrap:"wrap",marginBottom:14}}>
            {CHIPS.filter(c=>c.v<=b2).map((c,i)=><Chip key={c.v} chip={c} ai={i} onClick={()=>addChip(2,c.v)}/>)}
          </div>
          {bet2>0&&<div style={{textAlign:"center",marginBottom:12,fontSize:12,color:"#42a5f5",fontWeight:700}}>
            Apostado: ${bet2.toLocaleString()}
            <button onClick={()=>clearBet(2)} style={{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:11,marginLeft:8}}>← quitar</button>
          </div>}
          <button className="btn" disabled={!bet2} onClick={()=>{SFX.click();startDeal();}}
            style={{width:"100%",padding:16,borderRadius:14,fontSize:15,
              background:bet2?"linear-gradient(135deg,#42a5f5,#1565c0)":"rgba(255,255,255,.04)",
              color:bet2?"#fff":"#333"}}>
            {`REPARTIR — $${bet2.toLocaleString()}`}
          </button>
        </div>}

        {phase==="p1"&&ins!=="offered"&&<div className="slide-up" style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          <button className="btn" onClick={()=>hit(1)} style={{flex:1,padding:15,borderRadius:14,
            background:"linear-gradient(135deg,#2e7d32,#43a047)",color:"#fff",fontSize:14,minWidth:68}}>HIT</button>
          <button className="btn" onClick={()=>stand(1)} style={{flex:1,padding:15,borderRadius:14,
            background:"linear-gradient(135deg,#1565c0,#1976d2)",color:"#fff",fontSize:14,minWidth:68}}>STAND</button>
          {canDbl&&<button className="btn" onClick={()=>doDouble(1)} style={{flex:1,padding:15,borderRadius:14,
            background:"linear-gradient(135deg,#6a1b9a,#8e24aa)",color:"#fff",fontSize:14,minWidth:68}}>2× DOBLE</button>}
          {canSplitNow&&<button className="btn" onClick={doSplit} style={{flex:1,padding:15,borderRadius:14,
            background:"linear-gradient(135deg,#e65100,#f57f17)",color:"#fff",fontSize:14,minWidth:68}}>✂️ SPLIT</button>}
        </div>}

        {phase==="p2"&&(isCoop||isPvP)&&<div className="slide-up">
          <div style={{textAlign:"center",fontSize:8,color:"#42a5f5",letterSpacing:4,marginBottom:10,fontWeight:700}}>
            TURNO — J2</div>
          <div style={{display:"flex",gap:7}}>
            <button className="btn" onClick={()=>hit(2)} style={{flex:1,padding:15,borderRadius:14,
              background:"linear-gradient(135deg,#1565c0,#1976d2)",color:"#fff",fontSize:14}}>HIT</button>
            <button className="btn" onClick={()=>stand(2)} style={{flex:1,padding:15,borderRadius:14,
              background:"linear-gradient(135deg,#4a148c,#6a1b9a)",color:"#fff",fontSize:14}}>STAND</button>
            {h2.length===2&&b2>=bet2&&!isPvP&&<button className="btn" onClick={()=>doDouble(2)} style={{flex:1,padding:15,borderRadius:14,
              background:"linear-gradient(135deg,#1b5e20,#2e7d32)",color:"#fff",fontSize:14}}>2× DOBLE</button>}
          </div>
        </div>}

        {phase==="dlr"&&<div style={{textAlign:"center",padding:22}}>
          <div className="pulse" style={{fontSize:32,marginBottom:8,display:"inline-block"}}>🎴 🎴 🎴</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,.28)",letterSpacing:2}}>LA CASA JUEGA...</div>
        </div>}

        {phase==="res"&&<div className="slide-up" style={{display:"flex",gap:8}}>
          <button className="btn" onClick={nextHand} style={{flex:2,padding:15,borderRadius:14,
            background:"linear-gradient(135deg,#f0c040,#e5a000)",color:"#1a0f00",fontSize:14,letterSpacing:1}}>
            NUEVA MANO</button>
          <button onClick={()=>onExit(Math.max(b1,b2))} style={{flex:1,padding:15,borderRadius:14,
            border:"1px solid rgba(255,255,255,.05)",background:"rgba(0,0,0,.28)",
            color:"#555",fontSize:12,cursor:"pointer",fontWeight:700}}>MENÚ</button>
        </div>}
      </div>

      {hist.length>0&&<div style={{width:"100%",maxWidth:480,marginTop:22,paddingTop:14,borderTop:"1px solid rgba(255,255,255,.04)"}}>
        <div style={{fontSize:8,letterSpacing:5,color:"rgba(255,255,255,.1)",marginBottom:9}}>HISTORIAL</div>
        {hist.map((h,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,.03)",fontSize:11,opacity:1-i*.08}}>
            <span style={{color:{win:"#4caf50",bj:"#f0c040",lose:"#ef5350",push:"#ffa726"}[h.r1]}}>
              {{win:"✓ Victoria",bj:"★ Blackjack",lose:"✗ Derrota",push:"= Empate"}[h.r1]}</span>
            <span style={{color:"rgba(255,255,255,.18)",fontSize:10}}>${h.bA.toLocaleString()}</span>
            <span style={{color:h.g1>h.bA?"#4caf50":h.g1===0?"#ef5350":"#ffa726",fontWeight:700}}>
              {h.g1>h.bA?`+$${(h.g1-h.bA).toLocaleString()}`:h.g1===0?`-$${h.bA.toLocaleString()}`:"±$0"}</span>
          </div>
        ))}
      </div>}
    </div>
  );
}

// ── POKER GAME ─────────────────────────────────────────────────────
function PKGame({bankroll,cosmetics,onExit,onStats,onBroke}){
  const CB=BACKS.find(b=>b.id===cosmetics.back)||BACKS[0];
  const TF=FELTS.find(f=>f.id===cosmetics.felt)||FELTS[0];
  const [dk,setDk]=useState([]);
  const [player,setPlayer]=useState([]);
  const [dealer,setDealer]=useState([]);
  const [budget,setBudget]=useState(bankroll);
  const [bet,setBet]=useState(0);
  const [phase,setPhase]=useState("bet");
  const [disc,setDisc]=useState(new Set());
  const [result,setResult]=useState(null);
  const [pHl,setPHl]=useState([]);
  const [dHl,setDHl]=useState([]);
  const [boom,setBoom]=useState(false);
  const [toast,setToast]=useState(null);
  const [hist,setHist]=useState([]);
  const [showBroke,setShowBroke]=useState(false);
  const flash=(msg,t)=>{setToast({msg,type:t});setTimeout(()=>setToast(null),3000);};
  const phC=result?HAND_CLR[result.pe.rank]:"#f0c040";
  const dhC=result?HAND_CLR[result.de.rank]:"#f0c040";
  function deal(){if(!bet)return;const d=shuf(mkDeck(1));setPlayer(d.slice(0,5));setDealer(d.slice(5,10));setDk(d.slice(10));setDisc(new Set());setPHl([]);setDHl([]);setPhase("discard");SFX.card();}
  function draw(){
    SFX.click();const idxs=[...disc].sort((a,b)=>a-b);
    let ph=[...player],d=[...dk];
    idxs.forEach(i=>{ph[i]=d[0];d=d.slice(1);});
    setPlayer(ph);setDk(d);
    const dh=[...dealer];const dVals=dh.map(c=>cn(c.r));const dCnt={};dVals.forEach(v=>dCnt[v]=(dCnt[v]||0)+1);
    const keepV=new Set(Object.entries(dCnt).filter(([,c])=>c>=2).map(([v])=>+v));
    const dFlush=new Set(dh.map(c=>c.s)).size===1;const ds=[...dVals].sort((a,b)=>b-a);
    const dSt=ds.every((v,i)=>!i||ds[i-1]-v===1);
    const newDh=dh.map(c=>{if(dFlush||dSt||keepV.has(cn(c.r)))return c;const nc=d[0];d=d.slice(1);return nc;});
    setDealer(newDh);setTimeout(()=>resolve(ph,newDh),150);
  }
  function resolve(ph,dh){
    const pe=evalPk(ph),de=evalPk(dh);
    let res,gain=0;
    if(pe.rank>de.rank){res="win";gain=bet+bet*PPAY[pe.rank];}else if(pe.rank<de.rank){res="lose";}else{res="push";gain=bet;}
    setPHl(pkHL(ph,pe));setDHl(pkHL(dh,de));
    setBudget(v=>v+gain);setResult({res,gain,pe,de});setPhase("result");
    if(res==="win"){SFX.win();if(pe.rank>=6){SFX.bj();setBoom(true);setTimeout(()=>setBoom(false),2400);}flash(`${pe.name}! +$${(gain-bet).toLocaleString()}`,"win");}
    else if(res==="lose"){SFX.lose();flash(de.name+" — dealer","lose");}else SFX.push();
    onStats({hands:1,wins:res==="win"?1:0,losses:res==="lose"?1:0,pushes:res==="push"?1:0,bigWin:gain-bet});
    setHist(h=>[{res,bet,gain,ph:pe.name,dh:de.name},...h.slice(0,7)]);
  }
  function nextHand(){if(budget<=0){setShowBroke(true);return;}setPlayer([]);setDealer([]);setBet(0);setResult(null);setPHl([]);setDHl([]);setPhase("bet");SFX.click();}
  const pEv=player.length===5?evalPk(player):null;
  const RC={win:"#4caf50",lose:"#ef5350",push:"#ffa726"};
  return(
    <div style={{minHeight:"100vh",background:TF.bg,fontFamily:"'Inter',sans-serif",color:"#fff",
      padding:"12px 12px 40px",display:"flex",flexDirection:"column",alignItems:"center",position:"relative"}}>
      <style>{CSS}</style>
      <Confetti active={boom}/>
      {toast&&<Toast msg={toast.msg} type={toast.type}/>}
      {showBroke&&<BrokeModal onBuy={()=>{setShowBroke(false);onBroke();}} onClose={()=>onExit(budget)}/>}
      <div style={{width:"100%",maxWidth:480,display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <button onClick={()=>onExit(budget)} style={{background:"rgba(0,0,0,.4)",border:"1px solid rgba(255,255,255,.07)",
          borderRadius:10,color:"#666",fontSize:20,padding:"6px 12px",cursor:"pointer",lineHeight:1}}>←</button>
        <div style={{textAlign:"center"}}>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:13,fontWeight:900,color:"#ce93d8",letterSpacing:3}}>PÓKER 5 CARTAS</div>
          <div style={{fontSize:9,color:"#555",letterSpacing:3,marginTop:2}}>DRAW POKER</div>
        </div>
        <div style={{background:"rgba(206,147,216,.07)",border:"1px solid rgba(206,147,216,.18)",borderRadius:10,padding:"7px 12px",textAlign:"right"}}>
          <div style={{fontSize:8,color:"#888",letterSpacing:1}}>FICHAS</div>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:14,fontWeight:900,color:"#ce93d8"}}>${budget.toLocaleString()}</div>
        </div>
      </div>
      {phase==="bet"&&<div className="slide-up glass" style={{width:"100%",maxWidth:480,borderRadius:16,padding:14,marginBottom:14}}>
        <div style={{fontSize:8,letterSpacing:5,color:"#ce93d8",marginBottom:10,textAlign:"center",fontWeight:700}}>TABLA DE PAGOS</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3px 20px"}}>
          {Object.entries(PNAME).reverse().map(([r,n])=>(
            <div key={r} style={{display:"flex",justifyContent:"space-between",fontSize:10,padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
              <span style={{color:HAND_CLR[r]||"#888"}}>{n}</span>
              <span style={{color:"#ce93d8",fontWeight:800}}>{PPAY[r]}×</span>
            </div>
          ))}
        </div>
      </div>}
      {dealer.length>0&&<div className="felt glass" style={{width:"100%",maxWidth:480,borderRadius:18,padding:14,marginBottom:10}}>
        <div style={{fontSize:8,color:"rgba(255,255,255,.2)",letterSpacing:3,marginBottom:8,fontWeight:700}}>
          DEALER {result&&<span style={{color:dhC}}>— {result.de.name}</span>}</div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          {dealer.map((c,i)=><Card key={c.id||i} card={c} hidden={phase==="discard"} delay={i*80} back={CB}
            glowColor={dHl.includes(i)&&phase==="result"?dhC:null}/>)}
        </div>
      </div>}
      {player.length>0&&<div className="felt glass" style={{width:"100%",maxWidth:480,borderRadius:18,padding:14,marginBottom:10,
        border:`1.5px solid ${phase==="discard"?"rgba(206,147,216,.28)":"rgba(255,255,255,.05)"}`}}>
        <div style={{fontSize:8,color:"#888",letterSpacing:3,marginBottom:9,display:"flex",alignItems:"center",gap:8,fontWeight:700}}>
          TU MANO
          {pEv&&<span style={{color:HAND_CLR[pEv.rank]||"#888"}}> — {pEv.name}</span>}
          {phase==="discard"&&<span style={{color:"rgba(255,166,38,.45)",fontSize:9,fontWeight:500}}> · Toca para descartar (máx 3)</span>}
        </div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          {player.map((c,i)=>(
            <div key={c.id||i} onClick={()=>{if(phase!=="discard")return;SFX.click();setDisc(s=>{const n=new Set(s);n.has(i)?n.delete(i):(n.size<3&&n.add(i));return n;});}}
              style={{cursor:phase==="discard"?"pointer":"default",position:"relative",
                opacity:disc.has(i)?.38:1,transform:disc.has(i)?"translateY(10px)":"none",transition:"all .18s"}}>
              <Card card={c} delay={i*80} back={CB} glowColor={pHl.includes(i)&&phase==="result"?phC:null}/>
              {disc.has(i)&&<div style={{position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",
                background:"#ef5350",borderRadius:6,fontSize:8,padding:"2px 7px",color:"#fff",fontWeight:900,whiteSpace:"nowrap"}}>DESCARTAR</div>}
            </div>
          ))}
        </div>
        {phase==="result"&&result&&pHl.length>0&&<div className="slide-up" style={{marginTop:10,padding:"7px 10px",
          background:`${phC}10`,borderRadius:10,borderLeft:`3px solid ${phC}`,fontSize:11}}>
          <span style={{color:phC,fontWeight:800}}>{result.pe.name}</span>
          <span style={{color:"rgba(255,255,255,.32)",marginLeft:6}}>— cartas iluminadas forman la jugada</span>
        </div>}
      </div>}
      {result&&<div className="pop-in" style={{width:"100%",maxWidth:480,background:"rgba(0,0,0,.52)",
        border:`1.5px solid ${RC[result.res]}28`,borderRadius:18,padding:16,marginBottom:12,textAlign:"center"}}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:20,fontWeight:900,color:RC[result.res],
          textShadow:`0 0 18px ${RC[result.res]}88`,marginBottom:4}}>
          {result.res==="win"?"¡GANASTE! 🎉":result.res==="lose"?"PERDISTE 💀":"EMPATE 🤝"}</div>
        <div style={{fontSize:11,color:"rgba(255,255,255,.38)"}}>
          <span style={{color:phC,fontWeight:700}}>{result.pe.name}</span>
          <span style={{color:"#333",margin:"0 7px"}}>vs</span>
          <span style={{color:dhC,fontWeight:700}}>{result.de.name}</span>
        </div>
        {result.res==="win"&&<div style={{fontFamily:"'Cinzel',serif",fontSize:18,color:"#f0c040",fontWeight:900,marginTop:8}}>+${(result.gain-bet).toLocaleString()}</div>}
      </div>}
      <div style={{width:"100%",maxWidth:480}}>
        {phase==="bet"&&<div className="slide-up">
          <div style={{display:"flex",gap:7,justifyContent:"center",flexWrap:"wrap",marginBottom:14}}>
            {CHIPS.filter(c=>c.v<=budget).map((c,i)=><Chip key={c.v} chip={c} ai={i} onClick={()=>{setBudget(v=>v-c.v);setBet(v=>v+c.v);}}/>)}
          </div>
          {bet>0&&<div style={{textAlign:"center",marginBottom:12,fontSize:12,color:"#ce93d8",fontWeight:700}}>
            Apuesta: ${bet.toLocaleString()}
            <button onClick={()=>{setBudget(v=>v+bet);setBet(0);}} style={{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:11,marginLeft:8}}>← quitar</button>
          </div>}
          <button className="btn" disabled={!bet} onClick={deal} style={{width:"100%",padding:16,borderRadius:14,fontSize:15,
            background:bet?"linear-gradient(135deg,#ce93d8,#9c27b0)":"rgba(255,255,255,.04)",color:bet?"#fff":"#333"}}>
            {bet?`REPARTIR — $${bet.toLocaleString()}`:"ELEGÍ UNA APUESTA"}</button>
          {!budget&&<div style={{textAlign:"center",marginTop:10,fontSize:12,color:"#ef5350"}}>
            Sin fichas <button onClick={()=>setShowBroke(true)} style={{background:"none",border:"none",color:"#ce93d8",cursor:"pointer",textDecoration:"underline"}}>Comprar</button></div>}
        </div>}
        {phase==="discard"&&<div className="slide-up">
          <div style={{fontSize:11,color:"rgba(255,255,255,.28)",marginBottom:10,textAlign:"center"}}>
            {disc.size===0?"Mantené tu mano o tocá hasta 3 cartas para cambiar":`Cambiarás ${disc.size} carta${disc.size>1?"s":""}`}</div>
          <button className="btn" onClick={draw} style={{width:"100%",padding:16,borderRadius:14,fontSize:15,
            background:"linear-gradient(135deg,#ce93d8,#9c27b0)",color:"#fff"}}>
            {disc.size===0?"✓ MANTENER MANO":`↻ CAMBIAR ${disc.size} CARTA${disc.size>1?"S":""}`}</button>
        </div>}
        {phase==="result"&&<div className="slide-up" style={{display:"flex",gap:8}}>
          <button className="btn" onClick={nextHand} style={{flex:2,padding:15,borderRadius:14,
            background:"linear-gradient(135deg,#ce93d8,#9c27b0)",color:"#fff",fontSize:14}}>NUEVA MANO</button>
          <button onClick={()=>onExit(budget)} style={{flex:1,padding:15,borderRadius:14,
            border:"1px solid rgba(255,255,255,.05)",background:"rgba(0,0,0,.28)",color:"#555",fontSize:12,cursor:"pointer",fontWeight:700}}>MENÚ</button>
        </div>}
      </div>
      {hist.length>0&&<div style={{width:"100%",maxWidth:480,marginTop:22,paddingTop:14,borderTop:"1px solid rgba(255,255,255,.04)"}}>
        <div style={{fontSize:8,letterSpacing:5,color:"rgba(255,255,255,.1)",marginBottom:8}}>HISTORIAL</div>
        {hist.map((h,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",
            borderBottom:"1px solid rgba(255,255,255,.03)",fontSize:10,opacity:1-i*.1}}>
            <span style={{color:RC[h.res]}}>{h.ph}</span>
            <span style={{color:"rgba(255,255,255,.18)"}}>vs {h.dh}</span>
            <span style={{color:h.gain>h.bet?"#4caf50":h.gain===0?"#ef5350":"#ffa726",fontWeight:700}}>
              {h.gain>h.bet?`+$${(h.gain-h.bet).toLocaleString()}`:h.gain===0?`-$${h.bet.toLocaleString()}`:"±$0"}</span>
          </div>
        ))}
      </div>}
    </div>
  );
}

// ── ROOT APP ───────────────────────────────────────────────────────
export default function App(){
  const init=()=>{
    const s=loadS();
    const base={bankroll:100000,owned:["royal"],sel:{back:"royal",felt:"classic"},
      stats:{hands:0,wins:0,losses:0,pushes:0,blackjacks:0,bigWin:0,maxStreak:0,splits:0},
      lastLogin:null,loginStreak:0};
    return s?{...base,...s,stats:{...base.stats,...(s.stats||{})}}:base;
  };
  const [save,setSave]=useState(init);
  const [screen,setScreen]=useState("menu");
  const [mode,setMode]=useState(null);
  const [diff,setDiff]=useState("med");
  const [daily,setDaily]=useState(null);
  const [showCoins,setShowCoins]=useState(false);
  const [appToast,setAppToast]=useState(null);

  useEffect(()=>{saveS(save);},[save]);

  useEffect(()=>{
    const today=tod();if(save.lastLogin===today)return;
    const yest=new Date();yest.setDate(yest.getDate()-1);const yStr=yest.toISOString().slice(0,10);
    const ns=save.lastLogin===yStr?(save.loginStreak||0)+1:1;
    const amt=DAILY[Math.min(ns-1,DAILY.length-1)];
    setSave(s=>({...s,lastLogin:today,loginStreak:ns,bankroll:s.bankroll+amt}));
    setDaily({amount:amt,streak:ns});setTimeout(SFX.bonus,400);
  },[]);

  const flashApp=(msg,type)=>{setAppToast({msg,type});setTimeout(()=>setAppToast(null),3200);};
  const addStats=d=>setSave(s=>({...s,stats:{
    hands:s.stats.hands+(d.hands||0),wins:s.stats.wins+(d.wins||0),
    losses:s.stats.losses+(d.losses||0),pushes:s.stats.pushes+(d.pushes||0),
    blackjacks:s.stats.blackjacks+(d.blackjacks||0),
    bigWin:Math.max(s.stats.bigWin||0,d.bigWin||0),
    maxStreak:Math.max(s.stats.maxStreak||0,d.maxStreak||0),
    splits:(s.stats.splits||0)+(d.splits||0),
  }}));
  const buyItem=(id,price,type)=>setSave(s=>{
    if(s.bankroll<price)return s;
    return{...s,bankroll:s.bankroll-price,owned:[...new Set([...s.owned,id])],sel:{...s.sel,[type]:id}};
  });
  const selectItem=(type,id)=>setSave(s=>({...s,sel:{...s.sel,[type]:id}}));
  const exit=budget=>{setSave(s=>({...s,bankroll:budget}));setScreen("menu");};
  const handleCoinBuy=pk=>{
    setSave(s=>({...s,bankroll:s.bankroll+pk.coins+(pk.bonus||0)}));
    setShowCoins(false);SFX.buy();
    flashApp(`💎 +${(pk.coins+(pk.bonus||0)).toLocaleString()} monedas!`,"buy");
  };

  return(
    <>
      <style>{CSS}</style>
      {appToast&&<Toast msg={appToast.msg} type={appToast.type}/>}
      {daily&&<DailyModal streak={daily.streak} amount={daily.amount} onClose={()=>setDaily(null)}/>}
      {showCoins&&<CoinStore onBuy={handleCoinBuy} onClose={()=>setShowCoins(false)}/>}

      {screen==="shop"&&<ShopScreen bankroll={save.bankroll} owned={new Set(save.owned)} sel={save.sel}
        onBuy={buyItem} onSelect={selectItem} onClose={()=>setScreen("menu")} onCoinStore={()=>setShowCoins(true)}/>}

      {screen==="menu"&&<MainMenu save={save}
        onStart={(m,d)=>{setMode(m);setDiff(d);setScreen("game");}}
        onShop={()=>setScreen("shop")} onCoinStore={()=>setShowCoins(true)}/>}

      {screen==="game"&&mode==="poker"&&<PKGame bankroll={save.bankroll} cosmetics={save.sel}
        onExit={exit} onStats={addStats} onBroke={()=>setShowCoins(true)}/>}

      {screen==="game"&&mode!=="poker"&&<BJGame mode={mode} difficulty={diff} bankroll={save.bankroll} cosmetics={save.sel}
        onExit={exit} onStats={addStats} onBroke={()=>setShowCoins(true)}/>}
    </>
  );
}
