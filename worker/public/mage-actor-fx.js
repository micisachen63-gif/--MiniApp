/* Pose-synchronous native palm/staff light only. Battle owns actions, timers, impact and state. */
(()=>{
 'use strict';
 const script=document.currentScript;
 let baseURL=new URL('../',script?.src||location.href),manifest=null,loadFlight=null,manifestEpoch=0;
 const cache=new Map(),actors=new WeakMap(),CACHE_LIMIT=2;
 const stats={frames:[],clears:0,peakCachedImages:0};
 const record=value=>{stats.frames.push(value);if(stats.frames.length>160)stats.frames.shift();};
 const absolute=src=>new URL(src,baseURL).href;
 const entryFor=key=>manifest?.entries?.find(e=>e.key===key)||manifest?.characters?.[key]||null;
 function evict(src,state){if(cache.get(src)!==state)return;cache.delete(src);state.image.onload=state.image.onerror=null;if(!state.done){state.done=true;state.resolve(false);}state.image.src='';}
 function configure(value,options={}){manifestEpoch++;for(const [src,state]of cache)evict(src,state);manifest=value;loadFlight=null;if(options.baseURL)baseURL=new URL(options.baseURL,location.href);return true;}
 function load(){if(manifest)return Promise.resolve(manifest);if(!loadFlight){const epoch=manifestEpoch;loadFlight=fetch(absolute(script?.dataset.manifest||'manifest.fragment.json')).then(r=>{if(!r.ok)throw Error('Mage actor manifest unavailable');return r.json();}).then(value=>{if(epoch!==manifestEpoch)return manifest;manifest=value;return value;}).catch(error=>{loadFlight=null;throw error;});}return loadFlight;}
 function touch(src,state){if(cache.get(src)!==state)return;cache.delete(src);cache.set(src,state);}
 function imageFor(spec){
  if(!spec?.src)return Promise.resolve(false);const src=absolute(spec.src),prior=cache.get(src);if(prior){touch(src,prior);return prior.promise;}
  while(cache.size>=CACHE_LIMIT){const old=cache.keys().next().value;evict(old,cache.get(old));}
  const image=new Image(),state={image,ready:false,done:false,resolve:null,promise:null};state.promise=new Promise(resolve=>state.resolve=resolve);cache.set(src,state);stats.peakCachedImages=Math.max(stats.peakCachedImages,cache.size);
  const finish=ready=>{if(state.done)return;state.done=true;state.ready=ready;image.onload=image.onerror=null;state.resolve(ready);if(!ready&&cache.get(src)===state)cache.delete(src);};
  image.onload=()=>finish(cache.get(src)===state&&image.naturalWidth===spec.cellWidth*spec.cols&&image.naturalHeight===spec.cellHeight*spec.rows);image.onerror=()=>finish(false);image.src=src;return state.promise;
 }
 async function warm(key){await load();const entry=entryFor(key);return entry?.actorMagic?.overlayRequired?imageFor(entry.actorMagic.fx||entry.normalFx):false;}
 function clearActor(hero){const state=hero&&actors.get(hero);if(!state)return;state.revision++;state.key=null;state.ctx.setTransform(1,0,0,1,0,0);state.ctx.clearRect(0,0,state.canvas.width,state.canvas.height);state.canvas.hidden=true;stats.clears++;}
 function actorFrame({hero,sheet,key,frame,active=false}){
  if(!hero||!sheet)return false;const entry=entryFor(key),magic=entry?.actorMagic;
  if(!active||!magic?.overlayRequired||!magic.anchorsReviewed||!Number.isInteger(frame)||!magic.poses?.[frame]){clearActor(hero);return false;}
  let state=actors.get(hero);
  if(!state){const canvas=document.createElement('canvas');canvas.className='mage-native-magic';canvas.style.cssText='position:absolute;pointer-events:none;z-index:4;filter:none';const parent=hero.querySelector('.act')||sheet.parentElement||hero;parent.appendChild(canvas);state={canvas,ctx:canvas.getContext('2d',{willReadFrequently:true}),revision:0,key:null};actors.set(hero,state);}
  clearActor(hero);state.key=key;
  const spec=magic.fx||entry.normalFx,src=absolute(spec.src),cached=cache.get(src);
  if(!cached?.ready){const revision=state.revision,epoch=manifestEpoch;imageFor(spec).then(ready=>{if(ready&&state.revision===revision&&state.key===key&&epoch===manifestEpoch&&hero.isConnected&&sheet.isConnected&&!document.hidden)actorFrame({hero,sheet,key,frame,active});});return false;}
  if(!hero.isConnected||!sheet.isConnected||document.hidden)return false;
  const width=parseFloat(sheet.style.width)||sheet.offsetWidth,height=parseFloat(sheet.style.height)||sheet.offsetHeight;if(!(width>0&&height>0))return false;
  const d=Math.min(2,window.devicePixelRatio||1);Object.assign(state.canvas.style,{left:sheet.style.left||'0px',top:sheet.style.top||'0px',width:width+'px',height:height+'px'});
  state.canvas.width=Math.max(1,Math.round(width*d));state.canvas.height=Math.max(1,Math.round(height*d));
  state.ctx.setTransform(d,0,0,d,0,0);state.ctx.clearRect(0,0,width,height);state.ctx.globalCompositeOperation='source-over';state.ctx.shadowBlur=0;
  const sx=width/entry.animation.cellWidth,sy=height/entry.animation.cellHeight;let painted=0;
  for(const layer of magic.poses[frame].layers||[]){
   if(!Array.isArray(layer.anchorPx)||!Number.isInteger(layer.sourceCell)||layer.sourceCell<0||layer.sourceCell>=spec.cols*spec.rows)continue;
   const [x,y]=layer.anchorPx,pw=layer.pixelWidth*sx,ph=pw*spec.cellHeight/spec.cellWidth,cell=layer.sourceCell;
   state.ctx.globalAlpha=Math.max(0,Math.min(1,layer.opacity??1));state.ctx.drawImage(cached.image,cell%spec.cols*spec.cellWidth,Math.floor(cell/spec.cols)*spec.cellHeight,spec.cellWidth,spec.cellHeight,x*sx-pw/2,y*sy-ph/2,pw,ph);painted++;
  }
  state.canvas.hidden=painted===0;touch(src,cached);record({key,frame,painted,clearBeforeDraw:true,sourceCells:magic.poses[frame].layers.map(l=>l.sourceCell),anchors:magic.poses[frame].layers.map(l=>l.anchorPx),revision:state.revision});return painted>0;
 }
 window.RpgMageHeroFX={configure,load,warm,actorFrame,clearActor,stats,cacheStatus:()=>({size:cache.size,limit:CACHE_LIMIT,sources:[...cache.keys()],peak:stats.peakCachedImages})};
})();
