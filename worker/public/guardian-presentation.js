(function(){
 'use strict';
 const C=window.RpgGuardianContract,mounts=new WeakMap(),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // A receipt always restores the same place. The small offsets stay inside each
 // formation cell, so a selected or floating angel cannot cover its neighbours.
 function position(operationId,index,total){if(total===1)return {x:50,y:44,width:88,height:78,angle:0,z:1,delay:0};let hash=2166136261;for(const char of operationId+'|'+index){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}const jitter=(hash>>>0)%9-4,five=total===5,column=five?(index<3?index:index-3):index%5,row=five?(index<3?0:1):Math.floor(index/5);return {x:(five?(row?34.5:19)+column*31:12+column*19)+jitter*.12,y:(five?26+row*44:27+row*42)+jitter*.18,width:five?28:17.5,height:five?41:36,angle:jitter*.45,z:index+1,delay:-((hash>>>0)%40)/10};}
 function mount(scene,options){
  mounts.get(scene)?.cleanup();
  const config=C.config(options.config),operation=C.operation(options.operation,options.operation.charId);
  if(operation.status!=='committed'||!['summon','fuse'].includes(operation.action)||!operation.results.length)return null;
  scene.classList.remove('is-batch-ready','is-single-result','is-guardian-scattering');scene.querySelector('.guardian-preview-results')?.remove();
  const previous=options.previous?.operationId===operation.operationId?options.previous:{},revealed=new Set((Array.isArray(previous.revealed)?previous.revealed:[]).filter(id=>operation.results.some(item=>item.id===id)));
  let ready=previous.ready===true,phase=ready?'selection':'held',selected=operation.results.some(item=>item.id===previous.selected)?previous.selected:null,pull=null,tap=null,disposed=false,scatterTimer=null,scatterVideoDeadline=null,scatterStartedAt=0,scatterLayer=null,scatterVideo=null,scatterGeneration=0,scatterHaptics=null,publishedInteraction=false;
  const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)'),videoListeners=[],transitionVideoUrl=C.safeArtUrl(options.transitionVideoUrl||config.transitionVideoUrl||scene.dataset?.guardianTransitionVideo);
  const durationValue=options.transitionDurationMs??config.transitionDurationMs,scatterDuration=Number.isFinite(durationValue)?Math.max(500,Math.min(2000,durationValue)):1600;
  const listeners=[],tree=window.RpgGuardianWorldTree.mount(scene,{serverNow:options.serverNow,resultMode:ready});
  const snapshot=()=>({operationId:operation.operationId,ready,phase,selected,revealed:[...revealed],action:operation.action,success:operation.success});
  const isInteracting=()=>!disposed&&(phase==='scatter'||tap!==null||pull?.isInteracting()===true);
  function interactionChanged(){if(disposed)return;const value=isInteracting();if(value===publishedInteraction)return;publishedInteraction=value;options.onInteractionChange?.(value);}
  function listen(node,name,fn,settings){node.addEventListener(name,fn,settings);listeners.push(()=>node.removeEventListener(name,fn,settings));}
  function update(){if(!disposed)options.onUpdate?.(snapshot());}
  function feather(item,index){
   const pos=position(operation.operationId,index,operation.results.length),type=config.types.find(type=>type.id===item.type),quality=config.qualities.find(quality=>quality.id===item.quality),open=revealed.has(item.id),strong=C.QUALITY_ORDER.indexOf(item.quality)>=C.QUALITY_ORDER.indexOf('purple');
   const art=open?(type?.artUrl?'<img class="guardian-result-portrait" data-guardian-art src="'+esc(type.artUrl)+'" alt="'+esc(type.alt||type.name)+'" decoding="async"><span class="guardian-result-sparks" aria-hidden="true"><i>✦</i><i>✧</i></span>':'<span class="guardian-result-art-unavailable" aria-hidden="true">◇</span>'):'<img class="guardian-result-feather" src="'+esc(config.featherArtUrl)+'" alt="尚未揭曉的守護神羽">';
   const outcome=operation.action==='fuse'?(operation.success===false?'合成未成功 · 主天使已保留':'合成成功'):'',label=open?'<b>'+esc(type.name.replace(/^天使[・·．]\s*/,''))+'</b><span>'+esc(quality.name+'色')+'</span>'+(outcome?'<em class="guardian-fusion-outcome">'+esc(outcome)+'</em>':''):operation.action==='fuse'?'點選神羽，揭曉合成結果':'第 '+(index+1)+' 根';
   return '<button type="button" class="guardian-preview-result guardian-quality-'+item.quality+(strong?' guardian-result-radiant':'')+' '+(open?'is-revealed ':'')+(selected===item.id?'is-selected':'')+'" data-guardian-result="'+esc(item.id)+'" style="--feather-x:'+pos.x+'%;--feather-y:'+pos.y+'%;--result-width:'+pos.width+'%;--result-height:'+pos.height+'%;--feather-angle:'+pos.angle+'deg;--feather-z:'+pos.z+';--feather-delay:'+pos.delay+'s" '+(phase==='scatter'?'disabled ':'')+'aria-pressed="'+(selected===item.id)+'" aria-label="第'+(index+1)+'根守護羽毛，'+(open?esc(quality.name+'色 '+type.name):esc(quality.name+'色神羽，點選揭曉'))+'"><span class="guardian-item-feather">'+art+'</span><small class="guardian-result-label">'+label+'</small></button>';
  }
  function renderResults(){if(ready&&options.revealAllOnReady)operation.results.forEach(item=>revealed.add(item.id));let container=scene.querySelector('.guardian-preview-results');if(!container){container=document.createElement('div');container.className='guardian-preview-results guardian-results-'+operation.results.length;container.setAttribute('aria-label','本批守護天使');scene.append(container);}container.innerHTML=operation.results.map(feather).join('');update();}
  function originPoint(value){if(value&&Number.isFinite(value.x)&&Number.isFinite(value.y))return {x:Math.max(0,Math.min(100,value.x)),y:Math.max(0,Math.min(100,value.y))};const box=scene.getBoundingClientRect?.(),held=scene.querySelector('.guardian-held-feather-art')?.getBoundingClientRect?.();if(box?.width>0&&box?.height>0&&held&&[box.left,box.top,held.left,held.top,held.width,held.height].every(Number.isFinite))return {x:Math.max(0,Math.min(100,(held.left+held.width/2-box.left)/box.width*100)),y:Math.max(0,Math.min(100,(held.top+held.height/2-box.top)/box.height*100))};return {x:50,y:59};}
  const now=()=>{const value=window.performance?.now?.();return Number.isFinite(value)?value:Date.now();};
  function stopVideo(){if(scatterVideoDeadline!==null){clearTimeout(scatterVideoDeadline);scatterVideoDeadline=null;}videoListeners.splice(0).forEach(remove=>remove());if(scatterVideo){try{scatterVideo.pause();}catch{}try{scatterVideo.removeAttribute('src');}catch{}try{scatterVideo.load();}catch{}scatterVideo.remove?.();scatterVideo=null;}scatterLayer?.classList.remove('is-video-ready');}
  function clearScatter(){scatterGeneration++;if(scatterTimer!==null){clearTimeout(scatterTimer);scatterTimer=null;}stopVideo();scatterHaptics?.cleanup();scatterHaptics=null;scatterLayer?.remove();scatterLayer=null;scene.classList.remove('is-guardian-scattering');}
  function finishScatter(){if(disposed||phase!=='scatter')return false;phase='selection';clearScatter();scene.classList.add('is-batch-ready');scene.querySelector('.guardian-feather-anchor').replaceChildren();tree.progress(0);renderResults();interactionChanged();return true;}
  function playScatterVideo(generation){
   if(!transitionVideoUrl||window.navigator?.connection?.saveData||!(/\.webm(?:\?.*)?$/i.test(transitionVideoUrl)))return;
   const video=document.createElement('video');if(!video.canPlayType?.('video/webm; codecs="vp9"'))return;
   let frameReady=false,playing=false,syncRequested=false,aligned=false,adopted=false;scatterVideo=video;video.className='guardian-scatter-video';video.muted=true;video.defaultMuted=true;video.playsInline=true;video.preload='metadata';video.setAttribute('muted','');video.setAttribute('playsinline','');video.setAttribute('aria-hidden','true');
   const current=()=>!disposed&&phase==='scatter'&&generation===scatterGeneration&&scatterVideo===video;
   const probe=()=>{try{if(!(video.videoWidth>0&&video.videoHeight>0))throw Error('No frame');const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(video,0,0,2,2,0,0,2,2);if(ctx.getImageData(0,0,1,1).data[3]>32)throw Error('Opaque video');return true;}catch{return false;}};
   const show=()=>{
    if(!current()||!frameReady||!playing||adopted)return;
    const elapsed=now()-scatterStartedAt;if(!Number.isFinite(elapsed)||elapsed<0||elapsed>180){stopVideo();return;}
    // A cold decoder must not restart the burst halfway through the fallback.
    // Both effects share the original clock; seeking never extends its deadline.
    if(!syncRequested){syncRequested=true;try{video.currentTime=elapsed/1000;}catch{stopVideo();return;}if(video.seeking)return;aligned=true;}
    if(!aligned)return;if(!probe()){stopVideo();return;}
    adopted=true;if(scatterVideoDeadline!==null){clearTimeout(scatterVideoDeadline);scatterVideoDeadline=null;}scatterLayer?.classList.add('is-video-ready');
   };
   const on=(name,handler)=>{video.addEventListener(name,handler);videoListeners.push(()=>video.removeEventListener(name,handler));};
   on('loadeddata',()=>{if(!current())return;if(!probe()){stopVideo();return;}frameReady=true;show();});
   on('seeked',()=>{if(!current()||!syncRequested)return;aligned=true;frameReady=probe();if(!frameReady){stopVideo();return;}show();});
   on('ended',()=>{if(current()){if(adopted)finishScatter();else stopVideo();}});on('error',()=>{if(current())stopVideo();});scatterVideoDeadline=setTimeout(()=>{if(current()&&!adopted)stopVideo();},180);scatterLayer.append(video);video.src=transitionVideoUrl;
   try{Promise.resolve(video.play()).then(()=>{if(!current())return;playing=true;show();},()=>{if(current())stopVideo();});}catch{stopVideo();}
  }
  function scatter(origin){
   phase='scatter';scatterStartedAt=now();scene.classList.add('is-guardian-scattering');scene.style.setProperty('--guardian-scatter-duration',scatterDuration+'ms');const generation=++scatterGeneration;scatterLayer=document.createElement('div');scatterLayer.className='guardian-scatter';scatterLayer.setAttribute('aria-hidden','true');scatterLayer.style.setProperty('--guardian-scatter-x',origin.x+'%');scatterLayer.style.setProperty('--guardian-scatter-y',origin.y+'%');scatterLayer.style.setProperty('--guardian-scatter-duration',scatterDuration+'ms');
   const flights=[[-43,-36,-55],[-30,-47,42],[-13,-38,-24],[18,-44,66],[40,-32,-46],[-47,-7,22],[46,8,-64],[-34,31,54],[-9,42,-36],[22,34,40],[43,28,-25],[4,-52,35],[-39,-19,68],[-22,-27,-49],[-4,-43,56],[30,-38,-62],[48,-15,34],[-48,16,-37],[35,20,59],[-25,42,-71],[8,47,28],[30,45,-51],[-17,16,47],[14,-18,-33]];
   scatterLayer.innerHTML='<div class="guardian-scatter-fallback"><span class="guardian-scatter-burst"></span>'+flights.map(([x,y,angle],index)=>'<span class="guardian-scatter-feather" style="--scatter-dx:'+x+'cqw;--scatter-dy:'+y+'cqh;--scatter-rotation:'+angle+'deg;--scatter-delay:'+(index%3)*35+'ms"><img src="'+esc(config.featherArtUrl)+'" alt=""></span>').join('')+'</div>';
   scene.append(scatterLayer);scatterHaptics=window.RpgGuardianHaptics?.create?.();scatterHaptics?.scatter?.(operation);scatterTimer=setTimeout(finishScatter,scatterDuration);renderResults();interactionChanged();playScatterVideo(generation);
  }
  function freezeHeldFeather(){const anchor=scene.querySelector('.guardian-feather-anchor');let held=anchor.querySelector('.guardian-held-feather-art');if(!held){const highest=operation.results.reduce((a,b)=>C.QUALITY_ORDER.indexOf(b.quality)>C.QUALITY_ORDER.indexOf(a.quality)?b:a);anchor.innerHTML='<button type="button" class="guardian-preview-feather guardian-pull-reveal guardian-summon-gesture is-edge-visible guardian-quality-'+highest.quality+' guardian-scatter-held" disabled aria-hidden="true" style="--guardian-reveal-progress:1;--guardian-pull-distance:90px"><div class="guardian-card-cover"><img class="guardian-held-feather-art" src="'+esc(config.featherArtUrl)+'" alt=""></div></button>';}tree.progress(1);}
  function expand(settings={}){if(disposed)return;pull?.cleanup();pull=null;ready=true;scene.classList.toggle('is-single-result',operation.results.length===1);tree.resultMode?.(true);tree.suppressClickAfterDrag();if(settings.animate!==false&&!reducedMotion?.matches&&!document.hidden){scene.classList.remove('is-batch-ready');freezeHeldFeather();scatter(originPoint(settings.origin));}else{phase='selection';scene.classList.add('is-batch-ready');scene.querySelector('.guardian-feather-anchor').replaceChildren();tree.progress(0);renderResults();interactionChanged();}}
  function choose(node){if(disposed||phase!=='selection')return;const item=operation.results.find(item=>item.id===node?.dataset.guardianResult);if(!item)return;if(operation.results.length===1||selected===item.id)revealed.add(item.id);selected=item.id;renderResults();}
  function releaseTap(){const old=tap;tap=null;if(old){try{old.node.releasePointerCapture(old.id);}catch{/* Capture may already have been released. */}}return old;}
  function down(event){const node=event.target.closest?.('[data-guardian-result]');if(disposed||!ready||phase!=='selection'||!node||!scene.contains(node)||event.isPrimary===false||event.button>0||tap||!Number.isInteger(event.pointerId)||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;try{node.setPointerCapture(event.pointerId);}catch{return;}event.preventDefault();tap={node,id:event.pointerId,x:event.clientX,y:event.clientY};interactionChanged();}
  function up(event){if(disposed||!tap||event.pointerId!==tap.id)return;const old=releaseTap();event.preventDefault();const box=old.node.getBoundingClientRect();if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)&&Math.hypot(event.clientX-old.x,event.clientY-old.y)<=12&&event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom)choose(old.node);interactionChanged();}
  function cancel(event){if(disposed||!tap||event.pointerId!==tap.id)return;releaseTap();interactionChanged();}
  function suspend(){if(disposed)return;releaseTap();pull?.suspend();if(!finishScatter())interactionChanged();}
  function visibility(){if(document.hidden)suspend();}
  function keyboard(event){if(!disposed&&ready&&!isInteracting()&&event.isTrusted===true&&!event.repeat&&!event.isComposing&&['Enter',' '].includes(event.key)){event.preventDefault();choose(event.target.closest?.('[data-guardian-result]'));}}
  function revealAll(){if(!ready||disposed||isInteracting())return;window.RpgGuardianHaptics?.revealAll(operation);operation.results.forEach(item=>revealed.add(item.id));renderResults();}
  function cleanup(){if(disposed)return;disposed=true;listeners.splice(0).forEach(remove=>remove());releaseTap();pull?.cleanup();pull=null;clearScatter();tree.cleanup();if(mounts.get(scene)===api)mounts.delete(scene);}
  const api={snapshot,isInteracting,getState:()=>({...snapshot(),revealed:[...revealed],disposed,tapPointerId:tap?.id??null,pull:pull?.getState()??null,transitionVideo:!!scatterVideo}),revealAll,openBatch(){if(disposed||ready||isInteracting())return;const highest=operation.results.reduce((a,b)=>C.QUALITY_ORDER.indexOf(b.quality)>C.QUALITY_ORDER.indexOf(a.quality)?b:a);window.RpgGuardianHaptics?.trigger(operation,highest.id,1);expand();},cleanup};
  mounts.set(scene,api);
  listen(scene,'pointerdown',down);listen(scene,'pointerup',up);listen(scene,'pointercancel',cancel);listen(scene,'lostpointercapture',cancel);listen(scene,'keydown',keyboard);
  listen(window,'blur',suspend);listen(window,'pagehide',suspend);listen(window,'resize',suspend);listen(document,'visibilitychange',visibility);
  if(ready)expand({animate:options.playTransition===true,origin:options.transitionOrigin});else{
   const highest=operation.results.reduce((best,item)=>C.QUALITY_ORDER.indexOf(item.quality)>C.QUALITY_ORDER.indexOf(best.quality)?item:best),art=config.featherArtUrl?'<img class="guardian-held-feather-art" src="'+esc(config.featherArtUrl)+'" alt="可向下拉取的大銀白羽毛">':'';
   scene.querySelector('.guardian-feather-anchor').innerHTML='<button type="button" class="guardian-preview-feather guardian-pull-reveal" data-guardian-batch-pull aria-label="向下拉大羽毛展開本批結果"><div class="guardian-card-face" aria-hidden="true"></div><div class="guardian-card-cover">'+art+'<small>向下拉取</small></div><div class="guardian-pull-flow" aria-hidden="true"></div></button>';
   const node=scene.querySelector('[data-guardian-batch-pull]');
   // Scene ownership keeps a just-triggered quality pulse alive across the pull-to-results transition.
   pull=window.RpgGuardianPull.create(node,{operation,itemId:highest.id,distance:scene.dataset?.guardianAngelPose==='portrait'?90:110,cleanupHaptics:false,onProgress:progress=>tree.progress(progress),onInteractionChange:interactionChanged,onCancel:detail=>{if(detail.reason==='released_early')tree.releasedEarly();else tree.suppressClickAfterDrag();},onReveal:expand});
   listen(node,'keydown',event=>{if(event.isTrusted===true&&!event.repeat&&!event.isComposing&&(event.key==='Enter'||event.key===' ')&&!isInteracting()){event.preventDefault();api.openBatch();}});update();
  }
  return api;
 }
 window.RpgGuardianPresentation=Object.freeze({mount,position});
})();
