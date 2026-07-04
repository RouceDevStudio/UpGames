/* ==================================================================
   PLAZMA BURST 2 — Capa de controles táctiles para móvil (UpGames)
   Se inyecta same-origin sobre el juego original y traduce toques a
   la entrada que el juego ya entiende:
     · pointermove en <body>  -> apuntar (cursor)
     · onmousedown/onmouseup  -> disparar / clicar menús
     · onkeydown/onkeyup      -> mover, saltar, recargar, etc.
     · wheel                  -> cambiar de arma
   No modifica el juego; solo le habla en su propio idioma.
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

/* neutralizar bloqueo de puntero (irrelevante en móvil, molesto en escritorio) */
try{ if('LOCK_CURSOR' in window) window.LOCK_CURSOR=false; }catch(e){}
try{ Element.prototype.requestPointerLock=function(){}; }catch(e){}

/* ---------- Motor de entrada (híbrido: ruta global + handlers de elemento) ----------
   El juego usa DOS canales de puntero según la pantalla:
   · Juego / name_prompt: pointermove global en <body> + window.onmousedown/onmouseup
   · Menús: cada panel DOM tiene sus propios el.onpointermove / el.onmousedown / el.onclick
            que leen e.offsetX. Cubrimos ambos en cada acción. */
var curX=window.innerWidth/2, curY=window.innerHeight/2;
var mouseIsDown=false;
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
// clic completo con tiempos de fotograma (hover -> press -> release)
function tapAt(x,y){ moveCursor(x,y); setTimeout(function(){ mouseButton(true,x,y); setTimeout(function(){mouseButton(false,x,y);},160); },90); }

var down={}; // teclas mantenidas
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
function tapKey(kc,code,ch){ keyEvent(true,kc,code,ch); setTimeout(function(){keyEvent(false,kc,code,ch);},40); }
function wheel(dir){
  try{ var e=new NWheel('wheel',{bubbles:true,cancelable:true,view:window,deltaY:dir*100,deltaMode:0,clientX:curX,clientY:curY}); document.dispatchEvent(e);}catch(err){}
}
function noop(){}

/* ---------- Mapa de teclas (dobles: flechas + WASD, por robustez) ---------- */
var K={
  left:[[37,'ArrowLeft','ArrowLeft'],[65,'KeyA','a']],
  right:[[39,'ArrowRight','ArrowRight'],[68,'KeyD','d']],
  up:[[38,'ArrowUp','ArrowUp'],[87,'KeyW','w']],
  down:[[40,'ArrowDown','ArrowDown'],[83,'KeyS','s']],
  reload:[[82,'KeyR','r']],
  use:[[69,'KeyE','e']],
  selfdestruct:[[81,'KeyQ','q']]
};
function holdDir(name,on){ var a=K[name]; for(var i=0;i<a.length;i++){ on?keyDown(a[i][0],a[i][1],a[i][2]):keyUp(a[i][0],a[i][1],a[i][2]); } }
function tapAction(name){ var k=K[name][0]; tapKey(k[0],k[1],k[2]); }

/* ---------- ¿Estamos dentro de una misión? ---------- */
function label(){ try{ return String(typeof currentLabel!=='undefined'?currentLabel:(window.currentLabel||'')); }catch(e){ return ''; } }
// Etiquetas de escena de JUEGO (solo estas activan el joystick). Cualquier otra = menú.
var GAME_LABELS=['gaming','playing','ingame','in_game','battle'];
function inGame(){
  var l=label().toLowerCase();
  if(!l)return false;
  for(var i=0;i<GAME_LABELS.length;i++){ if(l.indexOf(GAME_LABELS[i])!==-1) return true; }
  return false;
}

/* ================= UI ================= */
var root,gameLayer,hint;
function el(tag,id,cls,parent){var e=document.createElement(tag);if(id)e.id=id;if(cls)e.className=cls;(parent||root).appendChild(e);return e;}

function build(){
  root=el('div','pb2t-root',null,document.body);

  // aviso de rotación
  var rot=el('div','pb2t-rotate',null,document.body);
  rot.className='on'; rot.innerHTML='<div class="ic">📱</div><div style="font-weight:800;letter-spacing:1px">GIRA TU DISPOSITIVO</div><div style="font-size:12px;opacity:.7">Plazma Burst 2 se juega en horizontal</div>';

  // barra de sistema (siempre): Menú(ESC) y ayuda
  var sysL=el('div','pb2t-sysL','pb2t-sys');
  var bEsc=el('div',null,'pb2t-syschip',sysL); bEsc.textContent='☰ MENÚ';
  bindTap(bEsc,function(){ tapKey(27,'Escape','Escape'); });
  var bHelp=el('div',null,'pb2t-syschip',sysL); bHelp.textContent='?';
  bindTap(bHelp,function(){ if(hint)hint.style.opacity=(hint.style.opacity==='0'?'1':'0'); });

  // capa de juego (joystick + botones)
  gameLayer=el('div','pb2t-game');

  // zonas
  var zL=el('div','pb2t-zoneL','pb2t-zone',gameLayer);
  var zR=el('div','pb2t-zoneR','pb2t-zone',gameLayer);
  var stL=el('div','pb2t-stickL','pb2t-stick',gameLayer); var nubL=el('div','pb2t-nubL','pb2t-nub',stL);
  var stR=el('div','pb2t-stickR','pb2t-stick',gameLayer); var nubR=el('div','pb2t-nubR','pb2t-nub',stR);

  // botones
  var jump=el('div','pb2t-jump','pb2t-btn',gameLayer); jump.innerHTML='▲<small>salto</small>';
  var fire=el('div','pb2t-fire','pb2t-btn',gameLayer); fire.innerHTML='🔥<small>fuego</small>';
  var crouch=el('div','pb2t-crouch','pb2t-btn',gameLayer); crouch.innerHTML='▼<small>agach</small>';
  var use=el('div','pb2t-use','pb2t-btn',gameLayer); use.innerHTML='✋<small>usar</small>';
  var reload=el('div','pb2t-reload','pb2t-btn',gameLayer); reload.innerHTML='⟳<small>recarg</small>';
  var wprev=el('div','pb2t-wprev','pb2t-btn',gameLayer); wprev.textContent='‹';
  var wnext=el('div','pb2t-wnext','pb2t-btn',gameLayer); wnext.textContent='›';

  hint=el('div','pb2t-hint',null,gameLayer);
  hint.innerHTML='Izquierda: joystick para <b>moverte</b> y <b>saltar</b> · Derecha: arrastra para <b>apuntar</b> y <b>disparar</b>';

  layout();
  window.addEventListener('resize',layout);
  window.addEventListener('orientationchange',function(){setTimeout(layout,300);});

  bindHold(jump,function(o){ holdDir('up',o); jump.classList.toggle('press',o); });
  bindHold(crouch,function(o){ holdDir('down',o); crouch.classList.toggle('press',o); });
  bindHold(fire,function(o){ mouseButton(o); fire.classList.toggle('press',o); });
  bindTap(use,function(){ tapAction('use'); flashPress(use); });
  bindTap(reload,function(){ tapAction('reload'); flashPress(reload); });
  bindTap(wprev,function(){ wheel(-1); flashPress(wprev); });
  bindTap(wnext,function(){ wheel(1); flashPress(wnext); });

  initStick(zL,stL,nubL,onMove);
  initAim(zR,stR,nubR);
  initMenuPointer();

  setInterval(updateMode,250);
  updateMode();

  window.PB2T={tapAt:tapAt,tapKey:tapKey,holdDir:holdDir,mouseButton:mouseButton,moveCursor:moveCursor,
    wheel:wheel,inGame:inGame,label:label,setMode:setMode,onMove:onMove,_down:down};
}

function flashPress(b){ b.classList.add('press'); setTimeout(function(){b.classList.remove('press');},110); }

function layout(){
  var W=window.innerWidth,H=window.innerHeight,sb=safeB(),sr=safeR(),sl=safeL();
  place('pb2t-jump', W-sr-64, H-sb-70);
  place('pb2t-fire', W-sr-140, H-sb-118);
  place('pb2t-crouch', W-sr-150, H-sb-46);
  place('pb2t-use', sl+94, H-sb-46);
  place('pb2t-reload', sl+30, H-sb-92);
  place('pb2t-wprev', W-sr-40, H-sb-198);
  place('pb2t-wnext', W-sr-40, H-sb-148);
  var hn=document.getElementById('pb2t-hint'); if(hn){hn.style.left='50%';hn.style.top='62%';hn.style.transform='translateX(-50%)';}
}
function place(id,x,y){var e=document.getElementById(id);if(!e)return;e.style.left=x+'px';e.style.top=y+'px';e.style.transform='translate(-50%,-50%)';}
function safeB(){return envpx('safe-area-inset-bottom')+10;}
function safeR(){return envpx('safe-area-inset-right')+10;}
function safeL(){return envpx('safe-area-inset-left')+10;}
function envpx(v){try{var t=document.createElement('div');t.style.cssText='position:fixed;height:env('+v+')';document.body.appendChild(t);var h=t.offsetHeight;document.body.removeChild(t);return h||0;}catch(e){return 0;}}

/* ---------- modo juego / menú ---------- */
var mode='menu';
function updateMode(){ setMode(inGame()?'game':'menu'); }
function setMode(m){
  if(m===mode)return; mode=m;
  gameLayer.classList.toggle('on',m==='game');
  if(m!=='game'){ for(var k in down){ if(down[k]){ keyEvent(false,+k,'',''); down[k]=false; } } if(mouseIsDown)mouseButton(false); }
}

/* ---------- joystick de movimiento ---------- */
function initStick(zone,base,nub,cb){
  var id=null,cx=0,cy=0,R=58;
  zone.addEventListener('touchstart',function(e){
    for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];
      if(id!==null)continue; id=t.identifier; cx=t.clientX; cy=t.clientY;
      base.style.left=cx+'px'; base.style.top=cy+'px'; base.classList.add('on'); hideHint();
    } e.preventDefault();
  },{passive:false});
  window.addEventListener('touchmove',function(e){
    for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i]; if(t.identifier!==id)continue;
      var dx=t.clientX-cx,dy=t.clientY-cy,m=Math.hypot(dx,dy)||1,mm=Math.min(m,R);
      nub.style.left=(66+dx/m*mm*.5)+'px'; nub.style.top=(66+dy/m*mm*.5)+'px';
      cb(dx/R,dy/R); e.preventDefault();
    }
  },{passive:false});
  function end(e){ for(var i=0;i<e.changedTouches.length;i++){ if(e.changedTouches[i].identifier===id){ id=null; base.classList.remove('on'); nub.style.left='66px'; nub.style.top='66px'; cb(0,0); } } }
  window.addEventListener('touchend',end); window.addEventListener('touchcancel',end);
}
function onMove(x,y){
  holdDir('left', x<-.32);
  holdDir('right', x>.32);
  holdDir('up', y<-.5);
  holdDir('down', y>.55);
}

/* ---------- aim stick (derecha) ---------- */
function initAim(zone,base,nub){
  var id=null,cx=0,cy=0,R=64,firing=false;
  zone.addEventListener('touchstart',function(e){
    for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i];
      if(id!==null)continue; id=t.identifier; cx=t.clientX; cy=t.clientY;
      base.style.left=cx+'px'; base.style.top=cy+'px'; base.classList.add('on'); hideHint(); aimUpdate(0,0,false);
    } e.preventDefault();
  },{passive:false});
  window.addEventListener('touchmove',function(e){
    for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i]; if(t.identifier!==id)continue;
      var dx=t.clientX-cx,dy=t.clientY-cy,m=Math.hypot(dx,dy)||1,mm=Math.min(m,R);
      nub.style.left=(66+dx/m*mm*.5)+'px'; nub.style.top=(66+dy/m*mm*.5)+'px';
      aimUpdate(dx/R,dy/R,m>R*.42); e.preventDefault();
    }
  },{passive:false});
  function end(e){ for(var i=0;i<e.changedTouches.length;i++){ if(e.changedTouches[i].identifier===id){ id=null; base.classList.remove('on'); nub.style.left='66px'; nub.style.top='66px'; if(firing){firing=false;mouseButton(false);} } } }
  window.addEventListener('touchend',end); window.addEventListener('touchcancel',end);
  function aimUpdate(dx,dy,shoot){
    var ox=window.innerWidth*0.5, oy=window.innerHeight*0.46;
    var rad=Math.min(window.innerWidth,window.innerHeight)*0.9;
    var len=Math.hypot(dx,dy); if(len<0.001){dx=1;dy=0;len=1;}
    moveCursor(ox+(dx/len)*rad, oy+(dy/len)*rad);
    if(shoot&&!firing){firing=true;mouseButton(true);}
    else if(!shoot&&firing){firing=false;mouseButton(false);}
  }
}

/* ---------- puntero de menú ---------- */
function initMenuPointer(){
  var sx=0,sy=0,tid=null,downAt=0;
  document.addEventListener('touchstart',function(e){
    if(mode==='game')return;
    if(e.target.closest&&e.target.closest('.pb2t-syschip'))return;
    var t=e.changedTouches[0];
    // tap sobre input DOM -> enfocar (teclado nativo para el nombre)
    var real=document.elementFromPoint(t.clientX,t.clientY);
    if(real&&(real.tagName==='INPUT'||real.tagName==='TEXTAREA'||(real.className&&(''+real.className).indexOf('pb2Input')!==-1))){ tid=null; try{real.focus();}catch(_){}; return; }
    tid=t.identifier; sx=t.clientX; sy=t.clientY; downAt=Date.now();
    moveCursor(sx,sy);
    setTimeout(function(){ if(tid!==null) mouseButton(true,sx,sy); },70); // hover -> press
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(mode==='game'||tid===null)return;
    for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i]; if(t.identifier!==tid)continue; sx=t.clientX; sy=t.clientY; moveCursor(sx,sy); }
  },{passive:true});
  document.addEventListener('touchend',function(e){
    if(mode==='game'||tid===null)return;
    for(var i=0;i<e.changedTouches.length;i++){var t=e.changedTouches[i]; if(t.identifier!==tid)continue;
      tid=null;
      // duración mínima press->release para que el hit-test del juego lo registre (~150ms tras el press a los 70ms)
      var wait=Math.max(0,230-(Date.now()-downAt));
      setTimeout(function(){ mouseButton(false); },wait);
    }
  },{passive:true});
}

/* ---------- binding helpers ---------- */
function bindHold(node,cb){
  node.addEventListener('touchstart',function(e){e.preventDefault();e.stopPropagation();cb(true);},{passive:false});
  var up=function(e){e.preventDefault();cb(false);};
  node.addEventListener('touchend',up); node.addEventListener('touchcancel',up);
  node.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();cb(true);});
  window.addEventListener('mouseup',function(){cb(false);});
}
function bindTap(node,cb){
  node.addEventListener('touchstart',function(e){e.preventDefault();e.stopPropagation();cb();},{passive:false});
  node.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();cb();});
}
var hintHidden=false;
function hideHint(){ if(hintHidden)return; hintHidden=true; if(hint)hint.style.opacity='0'; }

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
})();
