// Local sword branch: native actor spell layer and different ordinary/skill programs.
// Damage and the single impact callback remain owned by the existing battle engine.
(()=>{
 'use strict';const script=document.currentScript,ROOT=new URL('./',script?.src||location.href);let manifest=null,loadFlight=null;
 const imageCache=new Map(),actors=new WeakMap(),stats={actorFrames:[],dispatch:[],effectFrames:[],clears:0,cacheLimit:4,peakCachedSets:0};
 const record=(key,data)=>{stats[key].push(data);if(stats[key].length>1600)stats[key].shift();};
 const source=src=>new URL(src,ROOT).href;
 function load(){if(!loadFlight)loadFlight=fetch(source((script?.dataset.manifest||'sword-branch-manifest.json')+'?v='+new URL(script?.src||location.href).searchParams.get('v'))).then(r=>{if(!r.ok)throw Error('Sword manifest unavailable');return r.json();}).then(value=>{manifest=value;return value;}).catch(error=>{loadFlight=null;throw error;});return loadFlight;}
 function touch(code,state){imageCache.delete(code);imageCache.set(code,state);}
 function ensureFx(code){const existing=imageCache.get(code);if(existing){touch(code,existing);return existing.promise;}const spec=manifest?.effects[code];if(!spec)return Promise.resolve(false);
   while(imageCache.size>=4){const oldest=imageCache.keys().next().value,old=imageCache.get(oldest);imageCache.delete(oldest);old.image.onload=old.image.onerror=null;if(!old.ready)old.resolve(false);old.image.src='';}
   const image=new Image(),state={image,ready:false,resolve:null,promise:null};state.promise=new Promise(resolve=>{state.resolve=resolve;});imageCache.set(code,state);stats.peakCachedSets=Math.max(stats.peakCachedSets,imageCache.size);
   image.onload=()=>{if(imageCache.get(code)!==state){state.resolve(false);return;}state.ready=image.naturalWidth===spec.cellWidth*spec.cols&&image.naturalHeight===spec.cellHeight*spec.rows;image.onload=image.onerror=null;state.resolve(state.ready);};image.onerror=()=>{state.resolve(false);if(imageCache.get(code)===state)imageCache.delete(code);};image.src=source(spec.src);return state.promise;
 }
 async function warm(key){await load();const entry=manifest.characters[key];return entry?ensureFx(entry.fxCode):false;}
 function owner(cls,path){if(cls!=='sword'||!manifest)return null;return Object.values(manifest.characters).find(v=>v.path===path)||null;}
 function slice(g,code,cell,x,y,width,alpha=1,rotation=0){const spec=manifest.effects[code],cached=imageCache.get(code),image=cached?.ready?cached.image:null;if(!spec||!image||alpha<=0)return false;touch(code,cached);const height=width*spec.cellHeight/spec.cellWidth;g.save();g.globalAlpha*=Math.max(0,Math.min(1,alpha));g.globalCompositeOperation='source-over';g.shadowBlur=0;g.translate(x,y);g.rotate(rotation);g.drawImage(image,cell%spec.cols*spec.cellWidth,Math.floor(cell/spec.cols)*spec.cellHeight,spec.cellWidth,spec.cellHeight,-width/2,-height/2,width,height);g.restore();return true;}
 function clearActor(hero){const state=actors.get(hero);if(!state)return;state.revision=(state.revision||0)+1;state.ctx.setTransform(1,0,0,1,0,0);state.ctx.clearRect(0,0,state.canvas.width,state.canvas.height);state.canvas.hidden=true;stats.clears++;}
 function actorFrame({hero,sheet,key,frame,active=true}){
   const entry=manifest?.characters[key];if(!entry||window.SwordBranchMode==='baseline'){clearActor(hero);return false;}
   let state=actors.get(hero);
   if(!state){const canvas=document.createElement('canvas');canvas.className='sword-native-magic';canvas.style.cssText='position:absolute;pointer-events:none;z-index:4;filter:none';hero.querySelector('.act').appendChild(canvas);state={canvas,ctx:canvas.getContext('2d',{willReadFrequently:true})};actors.set(hero,state);}
   clearActor(hero);
   if(!active||!entry.actorMagic.overlayRequired||!entry.actorMagic.anchorsReviewed||!entry.actorMagic.anchors)return false;
   if(!imageCache.get(entry.fxCode)?.ready){const revision=state.revision;ensureFx(entry.fxCode).then(ready=>{if(ready&&state.revision===revision&&hero.isConnected&&sheet.isConnected)actorFrame({hero,sheet,key,frame,active});});return false;}
   const width=parseFloat(sheet.style.width),height=parseFloat(sheet.style.height),d=Math.min(2,devicePixelRatio||1);if(!width||!height)return false;
   Object.assign(state.canvas.style,{left:sheet.style.left,top:sheet.style.top,width:width+'px',height:height+'px'});state.canvas.width=Math.round(width*d);state.canvas.height=Math.round(height*d);state.ctx.setTransform(d,0,0,d,0,0);state.ctx.globalAlpha=1;state.ctx.globalCompositeOperation='source-over';
   const i=Math.min(entry.actorMagic.anchors.length-1,Math.max(0,frame)),anchor=entry.actorMagic.anchors[i],cell=entry.actorMagic.cells[i],scale=width/entry.animation.cellWidth,size=entry.actorMagic.pixelSizes[i]*scale;
   const painted=slice(state.ctx,entry.fxCode,cell,width*anchor[0],height*anchor[1],size,.88);
   state.canvas.hidden=!painted;record('actorFrames',{key,frame:i,sourceCell:cell,anchor,size,painted,clearBeforeDraw:true,active,mock:window.SwordBranchSynthetic===true});return painted;
 }
 function profile(name,cls,path){const entry=owner(cls,path);if(!entry)return null;return {swordBranch:true,code:entry.fxCode,path,cls,name,color:path[0]==='A'?'#e68d76':'#b9d7f1'};}
 function draw(g,k,from,to,p){
   if(!p?.swordBranch)return false;if(!Number.isFinite(k)||k<0||k>=1)return true;
   const basic=!!p.basic,code=p.code,angle=Math.atan2(to.y-from.y,to.x-from.x);let phase,cell,x,y,width,alpha=1,rotation=0;
   if(basic){
     if(k<.10){phase='blade-prime';cell=0;x=from.x;y=from.y;width=44;alpha=k/.10;}
     else if(k<.65){phase='single-blade-flight';cell=3;const t=(k-.10)/.55;x=from.x+(to.x-from.x)*t;y=from.y+(to.y-from.y)*t;width=100;rotation=angle;}
     else {phase='short-contact';cell=7;x=to.x;y=to.y;width=76;alpha=Math.max(0,1-(k-.65)/.20);}
   }else{
     if(k<.28){phase='ritual-charge';cell=k<.14?0:1;x=from.x;y=from.y;width=76;rotation=k*2;alpha=Math.min(1,k/.08);}
     else if(k<.65){phase='two-stage-flight';cell=k<.465?2:3;const t=(k-.28)/.37;x=from.x+(to.x-from.x)*t;y=from.y+(to.y-from.y)*t-Math.sin(t*Math.PI)*16;width=150;rotation=angle;}
     else if(k<.92){phase='profession-impact';cell=Math.min(6,4+Math.floor((k-.65)/.27*3));x=to.x;y=to.y;width=215;}
     else {phase='dissipation';cell=7;x=to.x;y=to.y;width=150;alpha=(1-k)/.08;}
   }
   const painted=slice(g,code,cell,x,y,width,alpha,rotation);
   const stamp=(basic?'normal':'skill')+':'+code+':'+phase+':'+cell;
   if(stats.lastStamp!==stamp){stats.lastStamp=stamp;record('effectFrames',{attack:basic?'normal':'skill',code,phase,sourceCell:cell,position:[x,y],width,painted,mock:window.SwordBranchSynthetic===true});}
   return true;
 }
 function install(){const api=window.RpgSkillFX;if(!api||api.__swordNativeBranch||window.SwordBranchMode==='baseline')return;api.__swordNativeBranch=true;const previous={prepare:api.prepare?.bind(api),profile:api.profile.bind(api),draw:api.draw.bind(api)};
   api.prepare=(cls,path)=>cls==='sword'?load().then(()=>{const entry=owner(cls,path);return entry?ensureFx(entry.fxCode):previous.prepare?.(cls,path);}):previous.prepare?.(cls,path);
   api.profile=(name,cls,path)=>{const candidate=profile(name,cls,path);if(candidate)record('dispatch',{name,cls,path,code:candidate.code,mock:window.SwordBranchSynthetic===true});return candidate?{...previous.profile(name,cls,path),...candidate}:previous.profile(name,cls,path);};
   api.draw=(g,k,from,to,p)=>{if(!draw(g,k,from,to,p))previous.draw(g,k,from,to,p);};
 }
 window.RpgSwordBranchFX={load,warm,install,actorFrame,clearActor,profile,draw,stats,cacheStatus:()=>({size:imageCache.size,limit:4,keys:[...imageCache.keys()],peak:stats.peakCachedSets}),manifest:()=>manifest};install();
})();
