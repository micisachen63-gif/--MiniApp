(() => {
 'use strict';
 const C=window.RpgGuardianContract,mounts=new WeakMap();
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function mount(scene,{config,tree,canStart,commit,onFinish,onHolding,signal,distance=110,action='summon'}){
  mounts.get(scene)?.cleanup();
  const anchor=scene.querySelector('.guardian-feather-anchor');
  if(!anchor)return null;
  const distanceSource=distance;let gestureDistance=Number.isFinite(distance)&&distance>0?distance:110;
  function measureDistance(){const value=typeof distanceSource==='function'?distanceSource():distanceSource;gestureDistance=Number.isFinite(value)&&value>0?value:110;}
  if(!['summon','fuse'].includes(action))throw new TypeError('Unknown guardian pull action');
  anchor.innerHTML=`<button type="button" class="guardian-preview-feather guardian-pull-reveal guardian-summon-gesture" data-guardian-start-pull aria-label="${action==='fuse'?'向下拉羽毛完成合成':'向下拉羽毛召喚'}；拉到底放開才結算"><div class="guardian-card-cover">${config.featherArtUrl?`<img class="guardian-held-feather-art" src="${esc(config.featherArtUrl)}" alt="向下拔取的祈願神羽" draggable="false">`:''}<small>向下拔取</small></div><div class="guardian-pull-flow" aria-hidden="true"></div></button>`;
  const button=anchor.querySelector('button'),listeners=[],frames=new Set();
  let pointer=null,origin=0,progress=0,moved=false,fullMove=false,disposed=false,started=false,settled=false,result=null,highest=null,released=false,complete=false,completed=false,earlyHuman=false,paintFrame=null,finishing=false;
  const instruction=document.createElement('p');instruction.className='guardian-summon-instruction';instruction.textContent='長按胸前神羽，向下拔取';instruction.setAttribute('role','status');scene.append(instruction);
  const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const hasFrames=typeof window.requestAnimationFrame==='function'&&typeof window.cancelAnimationFrame==='function';
  function listen(node,name,fn,options){node.addEventListener(name,fn,options);listeners.push(()=>node.removeEventListener(name,fn,options));}
  function frame(fn){if(disposed)return null;if(!hasFrames||reducedMotion?.matches){fn();return null;}const id=window.requestAnimationFrame(()=>{frames.delete(id);if(!disposed)fn();});frames.add(id);return id;}
  function renderProgress(){if(disposed)return;button.style.setProperty('--guardian-reveal-progress',String(progress));button.style.setProperty('--guardian-pull-distance',progress*gestureDistance+'px');tree?.progress(progress);
   for(const q of C.QUALITY_ORDER)button.classList.toggle('guardian-quality-'+q,!!highest&&q===highest.quality&&progress>.5);
   button.classList.toggle('is-edge-visible',!!highest&&progress>.5);
   const text=started&&!settled?'神羽回應中…請稍候，無需再拉一次':highest?'神羽已回應，準備迎接結果':progress>=1?'放開羽毛，迎接星光':progress>.5?'神羽已發亮 · 繼續向下拉到底':progress>0?'繼續向下 · 拉到底放開才結算':'長按胸前神羽，向下拔取';
   if(instruction.textContent!==text)instruction.textContent=text;
  }
  function paint(value){progress=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;if(paintFrame!==null)return;paintFrame=frame(()=>{paintFrame=null;renderProgress();});}
  function flushPaint(){if(paintFrame!==null){window.cancelAnimationFrame(paintFrame);frames.delete(paintFrame);paintFrame=null;}renderProgress();}
  function finish(){if(disposed||completed||finishing||!released||!started||!settled)return;finishing=true;flushPaint();
   const deliver=()=>{if(disposed||completed)return;completed=true;onFinish(result,{complete:!!result&&complete,releasedEarly:earlyHuman});};
   // A slow response still gets one painted frame of the real quality before the host replaces the stage.
   if(result&&complete)frame(()=>frame(deliver));else deliver();
  }
  function begin(){if(started||disposed)return;started=true;paint(progress);
   // Latch before calling the host, so repeated moves and synchronous host callbacks cannot charge twice.
   let value;try{value=commit();}catch{value=null;}
   Promise.resolve(value).then(operation=>{if(disposed)return;try{const candidate=C.operation(operation,operation?.charId);if(candidate.status==='committed'&&candidate.action===action&&candidate.results.length){result=candidate;highest=result.results.reduce((a,b)=>C.QUALITY_ORDER.indexOf(b.quality)>C.QUALITY_ORDER.indexOf(a.quality)?b:a);}}catch{/* The host retains the original pending receipt; presentation never invents a result. */}}).catch(()=>{/* The host owns recovery and error copy. */}).then(()=>{if(disposed)return;settled=true;paint(progress);finish();});
  }
  function releaseCapture(id){try{if(id!==null)button.releasePointerCapture(id);}catch{/* Browser may already have released capture. */}}
  function down(e){if(disposed||pointer!==null||started||!canStart()||signal?.aborted||e.isTrusted!==true||e.isPrimary===false||e.button>0||!Number.isInteger(e.pointerId)||!Number.isFinite(e.clientY))return;
   try{button.setPointerCapture(e.pointerId);}catch{return;}measureDistance();e.preventDefault();pointer=e.pointerId;origin=e.clientY;moved=false;fullMove=false;released=false;complete=false;earlyHuman=false;button.classList.remove('is-bouncing');button.classList.add('is-pulling');paint(0);onHolding?.();
  }
  function move(e){if(disposed||pointer===null||e.isTrusted!==true||e.pointerId!==pointer||!Number.isFinite(e.clientY))return;e.preventDefault();if(Math.abs(e.clientY-origin)>=3)moved=true;paint((e.clientY-origin)/gestureDistance);fullMove||=progress>=1;}
  function up(e){if(disposed||pointer===null||e.pointerId!==pointer)return;if(e.isTrusted!==true||!Number.isFinite(e.clientY)){cancel(e);return;}e.preventDefault();paint((e.clientY-origin)/gestureDistance);const id=pointer;pointer=null;released=true;complete=moved&&fullMove&&progress>=1&&canStart();earlyHuman=!complete;button.classList.remove('is-pulling');releaseCapture(id);
   if(complete)begin();
   if(!started){button.classList.add('is-bouncing');tree?.releasedEarly();paint(0);released=false;}
   else if(!complete){tree?.releasedEarly();paint(0);}onHolding?.();finish();
  }
  function cancel(e){if(disposed||pointer===null||e?.pointerId!==undefined&&e.pointerId!==pointer)return;const id=pointer;pointer=null;released=true;complete=false;earlyHuman=false;button.classList.remove('is-pulling');releaseCapture(id);tree?.suppressClickAfterDrag();paint(0);if(!started)released=false;onHolding?.();finish();}
  function visibility(){if(document.hidden)cancel();}
  function activate(e){if(!e||e.isTrusted!==true||e.repeat||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||!['Enter',' '].includes(e.key)||disposed||started||pointer!==null||signal?.aborted||!canStart())return false;e.preventDefault?.();complete=true;released=true;earlyHuman=false;paint(1);begin();onHolding?.();finish();return true;}
  function keyboard(e){activate(e);}
  function contextmenu(e){e.preventDefault();}
  function cleanup(){if(disposed)return;disposed=true;const id=pointer;pointer=null;releaseCapture(id);frames.forEach(id=>window.cancelAnimationFrame(id));frames.clear();paintFrame=null;listeners.splice(0).forEach(remove=>remove());button.classList.remove('is-pulling');instruction.remove?.();if(mounts.get(scene)===api)mounts.delete(scene);}
  const isInteracting=()=>!disposed&&(pointer!==null||started&&!completed);
  const api={activate,cleanup,isInteracting,getState:()=>({progress,committed:!!result,requesting:started&&!settled,pointer,disposed,interacting:isInteracting()})};mounts.set(scene,api);
  listen(button,'pointerdown',down);listen(button,'lostpointercapture',cancel);listen(button,'keydown',keyboard);listen(button,'contextmenu',contextmenu);
  listen(window,'pointermove',move,{capture:true,passive:false});listen(window,'pointerup',up,{capture:true,passive:false});listen(window,'pointercancel',cancel,true);listen(window,'blur',cancel);listen(window,'pagehide',cancel);listen(window,'resize',cancel);listen(document,'visibilitychange',visibility);
  if(signal)listen(signal,'abort',cleanup,{once:true});if(signal?.aborted)cleanup();
  return api;
 }
 window.RpgGuardianSummonGesture=Object.freeze({mount});
})();
