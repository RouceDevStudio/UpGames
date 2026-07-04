/* ==================================================================
   PLAZMA BURST 2 — Controles táctiles estilo GAMEPAD para móvil (UpGames)
   Adaptación móvil del juego original. Traduce toques de botones fijos a
   la entrada que el juego ya entiende:
     · pointermove en <body>  -> apuntar (cursor)
     · onmousedown/onmouseup  -> disparar / clicar menús
     · onkeydown/onkeyup      -> mover, saltar, recargar, etc.
     · wheel                  -> cambiar de arma
================================================================== */
(function(){
"use strict";
if(window.__pb2tLoaded)return; window.__pb2tLoaded=true;

var start=function(){
  if(!document.body){return setTimeout(start,60);}
  if(window.__pb2tInit)return; window.__pb2tInit=true;
  build();
};

/* ---------- Constructores nativos (el juego re-define Event/MouseEvent) ---------- */
var NW=(function(){
  try{var f=document.createElement('iframe');
    f.style.cssText='position:absolute;width:0;height:0;border:0;left:-9999px;top:-9999px';
    (document.documentElement||document.body).appendChild(f);
    return f.contentWindow;
  }catch(e){return window;}
})();
var NPointer=NW.PointerEvent||NW.MouseEvent||window.MouseEvent;
var NWheel=NW.WheelEvent||window.WheelEvent;
function noop(){}

try{ if('LOCK_CURSOR' in window) window.LOCK_CURSOR=false; }catch(e){}
try{ Element.prototype.requestPointerLock=function(){}; }catch(e){}

/* ================= MOTOR DE ENTRADA (validado) ================= */
var curX=window.innerWidth/2, curY=window.innerHeight/2, mouseIsDown=false;
function inOverlay(el){ return !!(el&&el.closest&&el.closest('#pb2t-root')); }
function mkEvt(el,x,y,type,btn,btns){
  var r=el.getBoundingClientRect();
  return {offsetX:x-r.left,offsetY:y-r.top,layerX:x-r.left,layerY:y-r.top,
    clientX:x,clientY:y,pageX:x,pageY:y,screenX:x,screenY:y,x:x,y:y,movementX:0,movementY:0,
    button:btn,buttons:btns,which:btn+1,detail:1,pointerType:'mouse',pointerId:1,isPrimary:true,pressure:btns?0.5:0,
    target:el,currentTarget:el,srcElement:el,view:window,type:type,
    shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,
    getCoalescedEvents:function(){return[this];},getPredictedEvents:function(){return[];},getModifierState:function(){return false;},
    preventDefault:noop,stopPropagation:noop,stopImmediatePropagation:noop};
}
function moveCursor(x,y){
  curX=x; curY=y;
  try{ document.body.dispatchEvent(new NPointer('pointermove',{bubbles:true,cancelable:true,view:window,
    clientX:x,clientY:y,screenX:x,screenY:y,button:-1,buttons:mouseIsDown?1:0,
    pointerType:'mouse',pointerId:1,isPrimary:true})); }catch(err){}
  var el=document.elementFromPoint(x,y);
  if(el&&!inOverlay(el)&&el!==document.body){
    if(el.onpointermove){try{el.onpointermove(mkEvt(el,x,y,'pointermove',-1,0));}catch(e){}}
    if(el.onmousemove){try{el.onmousemove(mkEvt(el,x,y,'mousemove',-1,0));}catch(e){}}
  }
}
function mouseButton(dn,x,y){
  if(x==null)x=curX; if(y==null)y=curY;
  mouseIsDown=dn;
  var g=dn?window.onmousedown:window.onmouseup;
  if(typeof g==='function'){ try{ g(mkEvt(document.body,x,y,dn?'mousedown':'mouseup',0,dn?1:0)); }catch(err){} }
  var el=document.elementFromPoint(x,y);
  if(el&&!inOverlay(el)&&el!==document.body){
    if(dn){
      if(el.onpointerdown){try{el.onpointerdown(mkEvt(el,x,y,'pointerdown',0,1));}catch(e){}}
      if(el.onmousedown){try{el.onmousedown(mkEvt(el,x,y,'mousedown',0,1));}catch(e){}}
    }else{
      if(el.onpointerup){try{el.onpointerup(mkEvt(el,x,y,'pointerup',0,0));}catch(e){}}
      if(el.onmouseup){try{el.onmouseup(mkEvt(el,x,y,'mouseup',0,0));}catch(e){}}
      if(el.onclick){try{el.onclick(mkEvt(el,x,y,'click',0,0));}catch(e){}}
    }
  }
}
function tapAt(x,y){ moveCursor(x,y); setTimeout(function(){ mouseButton(true,x,y); setTimeout(function(){mouseButton(false,x,y);},160); },90); }

var down={};
function keyEvent(isDown,keyCode,code,keyChar){
  var fn=isDown?window.onkeydown:window.onkeyup;
  var e={keyCode:keyCode,code:code,key:keyChar,which:keyCode,charCode:0,location:0,repeat:false,
    shiftKey:!!down[16],ctrlKey:false,altKey:false,metaKey:false,
    getModifierState:function(){return false;},
    preventDefault:noop,stopPropagation:noop,stopImmediatePropagation:noop};
  try{ if(typeof fn==='function') fn(e); }catch(err){}
}
function keyDown(kc,code,ch){ if(down[kc])return; down[kc]=true; keyEvent(true,kc,code,ch); }
function keyUp(kc,code,ch){ if(!down[kc])return; down[kc]=false; keyEvent(false,kc,code,ch); }
function tapKey(kc,code,ch){ keyEvent(true,kc,code,ch); setTimeout(function(){keyEvent(false,kc,code,ch);},45); }
function wheel(dir){
  try{ document.dispatchEvent(new NWheel('wheel',{bubbles:true,cancelable:true,view:window,deltaY:dir*100,deltaMode:0,clientX:curX,clientY:curY})); }catch(err){}
}
function releaseAll(){ for(var k in down){ if(down[k]){ keyEvent(false,+k,'',''); down[k]=false; } } if(mouseIsDown)mouseButton(false); }

/* teclas (flechas + WASD por robustez) */
var K={
  left:[[37,'ArrowLeft','ArrowLeft'],[65,'KeyA','a']],
  right:[[39,'ArrowRight','ArrowRight'],[68,'KeyD','d']],
  up:[[38,'ArrowUp','ArrowUp'],[87,'KeyW','w']],
  down:[[40,'ArrowDown','ArrowDown'],[83,'KeyS','s']],
  reload:[[82,'KeyR','r']],
  use:[[69,'KeyE','e']]
};
function holdDir(name,on){ var a=K[name]; for(var i=0;i<a.length;i++){ on?keyDown(a[i][0],a[i][1],a[i][2]):keyUp(a[i][0],a[i][1],a[i][2]); } }
function tapAction(name){ var k=K[name][0]; tapKey(k[0],k[1],k[2]); }

/* ---------- modo juego vs menú (lista negra: robusto) ---------- */
function label(){ try{ return String(typeof currentLabel!=='undefined'?currentLabel:(window.currentLabel||'')); }catch(e){ return ''; } }
var MENU_LABELS=['name_prompt','name','menu','main','difch','difficulty','equipment','campaign','custom',
  'credit','achiev','setting','loading','load','lobby','create','logs','confirm','failed','fail',
  'faq','multiplayer','official','shop','editor','pause'];
function inGame(){
  var l=label().toLowerCase();
  if(!l)return false;
  for(var i=0;i<MENU_LABELS.length;i++){ if(l.indexOf(MENU_LABELS[i])!==-1) return false; }
  return true;
}

/* ================= AIM + FIRE (anillo de 8 direcciones, autodisparo) ================= */
var aimVec=null, aimHeld=0, aimTimer=null;
function aimOrigin(){ return {x:window.innerWidth*0.5, y:window.innerHeight*0.46}; }
function aimTick(){
  if(!aimVec)return;
  var o=aimOrigin(), R=Math.min(window.innerWidth,window.innerHeight)*0.92;
  moveCursor(o.x+aimVec.x*R, o.y+aimVec.y*R);
  if(!mouseIsDown) mouseButton(true);
}
function aimStart(vx,vy){
  aimVec={x:vx,y:vy}; aimHeld++;
  aimTick();
  if(!aimTimer) aimTimer=setInterval(aimTick,55);
}
function aimStop(){
  aimHeld=Math.max(0,aimHeld-1);
  if(aimHeld===0){ if(aimTimer){clearInterval(aimTimer);aimTimer=null;} if(mouseIsDown)mouseButton(false); aimVec=null; }
}

/* ================= UI ================= */
var root, gameLayer, hint, aimBox;
function el(tag,id,cls,parent){var e=document.createElement(tag);if(id)e.id=id;if(cls)e.className=cls;(parent||root).appendChild(e);return e;}

function build(){
  root=el('div','pb2t-root',null,document.body);

  var rot=el('div','pb2t-rotate',null,document.body); rot.className='on';
  rot.innerHTML='<div class="ic">📱</div><div style="font-weight:800;letter-spacing:1px">GIRA TU DISPOSITIVO</div><div style="font-size:12px;opacity:.7">Plazma Burst 2 se juega en horizontal</div>';

  // sistema (siempre)
  var sysL=el('div','pb2t-sysL','pb2t-sys');
  var bEsc=el('div',null,'pb2t-syschip',sysL); bEsc.textContent='☰ MENÚ';
  bindTap(bEsc,function(){ tapKey(27,'Escape','Escape'); });
  var bHelp=el('div',null,'pb2t-syschip',sysL); bHelp.textContent='?';
  bindTap(bHelp,function(){ if(hint)hint.style.opacity=(hint.style.opacity==='0'?'1':'0'); });

  // capa de juego
  gameLayer=el('div','pb2t-game');

  // D-pad de movimiento (izquierda)
  var dpad=el('div','pb2t-dpad',null,gameLayer);
  var bL=el('div','pb2t-dL','pb2t-btn',dpad); bL.innerHTML='◀';
  var bR=el('div','pb2t-dR','pb2t-btn',dpad); bR.innerHTML='▶';
  bindHold(bL,function(o){ holdDir('left',o); });
  bindHold(bR,function(o){ holdDir('right',o); });

  // acciones sueltas
  var jump=el('div','pb2t-jump','pb2t-btn',gameLayer); jump.innerHTML='▲<small>salto</small>';
  var crouch=el('div','pb2t-crouch','pb2t-btn',gameLayer); crouch.innerHTML='▼<small>agach</small>';
  bindHold(jump,function(o){ holdDir('up',o); });
  bindHold(crouch,function(o){ holdDir('down',o); });

  // utilidades
  var reload=el('div','pb2t-reload','pb2t-btn',gameLayer); reload.innerHTML='⟳<small>recarg</small>';
  var use=el('div','pb2t-use','pb2t-btn',gameLayer); use.innerHTML='✋<small>usar</small>';
  var wprev=el('div','pb2t-wprev','pb2t-btn',gameLayer); wprev.textContent='‹';
  var wnext=el('div','pb2t-wnext','pb2t-btn',gameLayer); wnext.textContent='›';
  bindTapBtn(reload,function(){ tapAction('reload'); });
  bindTapBtn(use,function(){ tapAction('use'); });
  bindTapBtn(wprev,function(){ wheel(-1); });
  bindTapBtn(wnext,function(){ wheel(1); });

  // anillo de puntería + disparo (derecha): 8 botones
  aimBox=el('div','pb2t-aim',null,gameLayer);
  var hub=el('div','pb2t-aimhub',null,aimBox); hub.innerHTML='APUNTA<br>+FUEGO';
  var DIRS=[
    {a:'↑', vx:0,  vy:-1},
    {a:'↗', vx:0.71, vy:-0.71},
    {a:'→', vx:1,  vy:0},
    {a:'↘', vx:0.71, vy:0.71},
    {a:'↓', vx:0,  vy:1},
    {a:'↙', vx:-0.71,vy:0.71},
    {a:'←', vx:-1, vy:0},
    {a:'↖', vx:-0.71,vy:-0.71}
  ];
  aimBox._btns=[];
  DIRS.forEach(function(d){
    var bb=el('div',null,'pb2t-btn',aimBox); bb.textContent=d.a; bb._d=d;
    bindHold(bb,function(o){ o?aimStart(d.vx,d.vy):aimStop(); });
    aimBox._btns.push(bb);
  });

  hint=el('div','pb2t-hint',null,gameLayer);
  hint.innerHTML='<b>◀ ▶</b> mover · <b>▲</b> saltar · <b>▼</b> agacharse · anillo derecho: <b>apunta y dispara</b> en 8 direcciones · <b>‹ ›</b> cambiar arma';
  setTimeout(function(){ if(hint)hint.style.opacity='0'; },8000);

  layout();
  window.addEventListener('resize',layout);
  window.addEventListener('orientationchange',function(){setTimeout(layout,300);});

  initMenuPointer();
  setInterval(updateMode,250); updateMode();

  window.PB2T={tapAt:tapAt,tapKey:tapKey,holdDir:holdDir,mouseButton:mouseButton,moveCursor:moveCursor,
    wheel:wheel,aimStart:aimStart,aimStop:aimStop,inGame:inGame,label:label,setMode:setMode,_down:down,
    press:function(id){var e=document.getElementById(id);if(e&&e.__on)e.__on();},
    release:function(id){var e=document.getElementById(id);if(e&&e.__off)e.__off();}};
}

function layout(){
  var W=window.innerWidth,H=window.innerHeight,sb=envpx('safe-area-inset-bottom')+14,
      sr=envpx('safe-area-inset-right')+14, sl=envpx('safe-area-inset-left')+14;
  // D-pad izquierda (◀ ▶ juntos)
  place('pb2t-dL', sl+42,  H-sb-42);
  place('pb2t-dR', sl+126, H-sb-42);
  // salto / agacharse (cerca del pulgar izquierdo, arriba)
  place('pb2t-jump',   sl+84, H-sb-120);
  place('pb2t-crouch', sl+178,H-sb-92);
  // utilidades
  place('pb2t-reload', sl+26, H-sb-118);
  place('pb2t-use',    sl+230,H-sb-150);
  place('pb2t-wprev',  W-sr-172, sb+90);
  place('pb2t-wnext',  W-sr-172, sb+40);
  // anillo de puntería (derecha)
  var cx=W-sr-84, cy=H-sb-84, R=70;
  var hub=document.getElementById('pb2t-aimhub'); if(hub){hub.style.left=cx+'px';hub.style.top=cy+'px';}
  if(aimBox&&aimBox._btns){
    aimBox._btns.forEach(function(bb,i){
      var ang=-Math.PI/2 + i*(Math.PI/4); // empieza arriba, sentido horario
      var x=cx+Math.cos(ang)*R, y=cy+Math.sin(ang)*R;
      bb.style.left=x+'px'; bb.style.top=y+'px';
    });
  }
  var hn=document.getElementById('pb2t-hint'); if(hn){hn.style.left='50%';hn.style.top='11%';hn.style.transform='translateX(-50%)';}
}
function place(id,x,y){var e=document.getElementById(id);if(!e)return;e.style.left=x+'px';e.style.top=y+'px';}
function envpx(v){try{var t=document.createElement('div');t.style.cssText='position:fixed;height:env('+v+')';document.body.appendChild(t);var h=t.offsetHeight;document.body.removeChild(t);return h||0;}catch(e){return 0;}}

/* ---------- modo ---------- */
var mode='menu';
function updateMode(){ setMode(inGame()?'game':'menu'); }
function setMode(m){
  if(m===mode)return; mode=m;
  gameLayer.classList.toggle('on',m==='game');
  if(m!=='game'){ releaseAll(); if(aimTimer){clearInterval(aimTimer);aimTimer=null;} aimVec=null; aimHeld=0; }
}

/* ---------- binding de botones (multitáctil, cada botón independiente) ---------- */
function bindHold(node,cb){
  node.__on=function(){ if(node.__pressed)return; node.__pressed=true; node.classList.add('press'); cb(true); };
  node.__off=function(){ if(!node.__pressed)return; node.__pressed=false; node.classList.remove('press'); cb(false); };
  node.addEventListener('touchstart',function(e){e.preventDefault();e.stopPropagation();node.__on();},{passive:false});
  var end=function(e){e.preventDefault();e.stopPropagation();node.__off();};
  node.addEventListener('touchend',end); node.addEventListener('touchcancel',end);
  node.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();node.__on();});
  window.addEventListener('mouseup',function(){node.__off();});
}
function bindTapBtn(node,cb){
  node.__on=function(){ node.classList.add('press'); cb(); };
  node.__off=function(){ node.classList.remove('press'); };
  node.addEventListener('touchstart',function(e){e.preventDefault();e.stopPropagation();node.__on();setTimeout(node.__off,110);},{passive:false});
  node.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();node.__on();setTimeout(node.__off,110);});
}
function bindTap(node,cb){ // chips de sistema
  node.addEventListener('touchstart',function(e){e.preventDefault();e.stopPropagation();cb();},{passive:false});
  node.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();cb();});
}

/* ---------- puntero de menú (tap para clicar pantallas del juego) ---------- */
function initMenuPointer(){
  var sx=0,sy=0,tid=null,downAt=0;
  document.addEventListener('touchstart',function(e){
    if(mode==='game')return;
    if(e.target.closest&&e.target.closest('#pb2t-root'))return; // no robar toques a chips/botones
    var t=e.changedTouches[0];
    var real=document.elementFromPoint(t.clientX,t.clientY);
    if(real&&(real.tagName==='INPUT'||real.tagName==='TEXTAREA'||(real.className&&(''+real.className).indexOf('pb2Input')!==-1))){ tid=null; try{real.focus();}catch(_){}; return; }
    tid=t.identifier; sx=t.clientX; sy=t.clientY; downAt=Date.now();
    moveCursor(sx,sy);
    setTimeout(function(){ if(tid!==null) mouseButton(true,sx,sy); },70);
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(mode==='game'||tid===null)return;
    for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i]; if(t.identifier!==tid)continue; sx=t.clientX; sy=t.clientY; moveCursor(sx,sy); }
  },{passive:true});
  document.addEventListener('touchend',function(e){
    if(mode==='game'||tid===null)return;
    for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i]; if(t.identifier!==tid)continue;
      tid=null;
      var wait=Math.max(0,230-(Date.now()-downAt));
      setTimeout(function(){ mouseButton(false); },wait);
    }
  },{passive:true});
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
})();
