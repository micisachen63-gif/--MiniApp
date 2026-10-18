(() => {
 'use strict';
 const BASE='/art/star-ring-20261018/';
 function source(path,type){const p=String(path||'');return new RegExp('^/art/star-ring-20261018/map-(?:0[1-9]|1[0-2])\\.'+type+'(?:\\?[A-Za-z0-9_=&%-]+)?$').test(p)?p:'';}
 function normalize(scene={}){const hour=Math.max(0,Math.min(11,Number(scene.hourIndex)||0)),image=source(scene.image,'webp')||BASE+'background.webp',video=source(scene.video,'mp4');return {hourIndex:hour,image,video};}
 function create(){
  const layer=document.createElement('div');layer.className='sr-battle-sky sr-scenery';layer.dataset.srScenery='';
  let stopped=false,current=null,signature='',fadeTimer=0;const captures=new Map(),motion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'),connection=globalThis.navigator?.connection;
  const allowsVideo=()=>!motion?.matches&&!connection?.saveData;
  const valid=frame=>!stopped&&frame===current;
  function disposeFrame(frame){if(!frame)return;frame.video?.pause();if(frame.video){frame.video.oncanplay=frame.video.onerror=null;frame.video.removeAttribute('src');frame.video.load?.();captures.delete(frame.video);}frame.poster.onload=null;frame.poster.onerror=null;frame.node.remove();}
  function play(frame){if(!valid(frame)||!frame.video||document.hidden||!allowsVideo()||!layer.isConnected)return;try{const r=frame.video.play();r?.catch?.(()=>{frame.video.style.opacity='0';});}catch{frame.video.style.opacity='0';}}
  function reveal(frame){if(!valid(frame))return;frame.node.style.opacity='1';const obsolete=[...layer.children].filter(n=>n!==frame.node);for(const node of obsolete)node.style.opacity='0';clearTimeout(fadeTimer);fadeTimer=setTimeout(()=>{for(const old of frame.previous||[])disposeFrame(old);frame.previous=[];},700);}
  function video(frame){
   if(!frame.scene.video||!allowsVideo()||frame.video)return;
   const v=document.createElement('video');v.className='sr-scenery-video';v.muted=true;v.defaultMuted=true;v.autoplay=true;v.loop=true;v.playsInline=true;v.preload='metadata';v.poster=frame.scene.image;v.setAttribute('muted','');v.setAttribute('playsinline','');v.setAttribute('aria-hidden','true');v.style.opacity='0';
   frame.video=v;v.oncanplay=()=>{if(!valid(frame))return;reveal(frame);v.style.opacity='1';play(frame);};v.onerror=()=>{if(!valid(frame))return;v.style.opacity='0';frame.poster.style.opacity='1';reveal(frame);};v.src=frame.scene.video;frame.node.append(v);play(frame);
  }
  function update(scene){
   const next=normalize(scene),key=JSON.stringify(next);if(key===signature){if(current&&!current.video)video(current);return;}
   signature=key;clearTimeout(fadeTimer);const previous=current?[current,...current.previous||[]]:[],node=document.createElement('div'),poster=document.createElement('img');node.className='sr-scenery-frame';node.style.opacity=current?'0':'1';poster.className='sr-scenery-poster';poster.alt='';poster.setAttribute('aria-hidden','true');poster.decoding='async';poster.style.opacity='1';
   current={scene:next,node,poster,video:null,previous};const frame=current;poster.onload=()=>reveal(frame);poster.onerror=()=>{if(valid(frame)){poster.onerror=null;poster.src=BASE+'background.webp';reveal(frame);}};node.append(poster);layer.append(node);poster.src=next.image;video(frame);
  }
  function capture(){if(stopped)return;for(const frame of current?[current,...current.previous||[]]:[])if(frame.video)captures.set(frame.video,{time:Number(frame.video.currentTime)||0,playing:!frame.video.paused});}
  function attach(placeholder,scene){if(stopped||!placeholder)return;placeholder.replaceWith(layer);update(scene);if(current?.video){const before=captures.get(current.video);if(before?.time>0&&Number(current.video.currentTime)<before.time-.5){try{current.video.currentTime=before.time;}catch{}}play(current);}}
  function visibility(){if(stopped)return;if(document.hidden||!allowsVideo()){for(const frame of current?[current,...current.previous||[]]:[]){frame.video?.pause();if(!allowsVideo()&&frame.video)frame.video.style.opacity='0';}}else if(current){video(current);if(current.video?.readyState>=2)current.video.style.opacity='1';play(current);}}
  function stop(){if(stopped)return;stopped=true;clearTimeout(fadeTimer);document.removeEventListener('visibilitychange',visibility);motion?.removeEventListener?.('change',visibility);connection?.removeEventListener?.('change',visibility);for(const frame of current?[current,...current.previous||[]]:[])disposeFrame(frame);current=null;layer.remove();captures.clear();}
  document.addEventListener('visibilitychange',visibility);motion?.addEventListener?.('change',visibility);connection?.addEventListener?.('change',visibility);
  return {attach,capture,stop,element:layer};
 }
 globalThis.RpgStarRingScenery={create,normalize};
})();
