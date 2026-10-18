// Exact-identity visual playback. Combat owns snapshots, damage and event order.
const cache=new Map();
const atlasBitmaps=new Map();
let warmSources=new Set();
const activeActions=new Set();
const hudLayers=new WeakMap();
const closedDisplayBitmaps=new WeakSet();
export const playbackStats={started:0,frames:0,normal:0,skill:0,cleanup:0,fallback:0,clippingViolations:0,keys:[],lastGeometry:null,seenFrames:{},seenFxFrames:{},seenFxAnchors:{},peakBitmapPixels:0,closedBitmaps:0,releasedSourceImages:0,atlasFailures:0,downsampledDisplayFrames:0,resizeFallbacks:0,resizeFallbackRecent:[],cycleReceipts:[]};
function image(src){if(!src)return null;if(!cache.has(src)){const im=new Image();im.decoding='async';im.src=src;cache.set(src,im);if(cache.size>16)cache.delete(cache.keys().next().value);}const im=cache.get(src);return im.complete&&im.naturalWidth?im:null;}
function registry(){try{return window.RpgHeroArtRegistry||window.parent?.RpgHeroArtRegistry||null;}catch{return null;}}
const norm=(b,w,h)=>!b?[0,0,1,1]:b.some(v=>v>1)?[b[0]/w,b[1]/h,b[2]/w,b[3]/h]:b;
function union(boxes){if(!boxes)return[0,0,1,1];return Array.isArray(boxes[0])?[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))]:boxes;}
function rootSource(src){return typeof src==='string'&&!/^(?:\/|https?:|data:|blob:)/.test(src)?'/'+src.replace(/^\.\//,''):src;}
function descriptor(value){if(!value)return null;if(typeof value==='string')return{src:rootSource(value),cols:1,rows:1,frames:1};return{...value,src:rootSource(value.src),companions:value.companions?.map(descriptor)};}
function lookup(member,kind,event){const api=registry();if(!api||!member)return null;const identity={...member,baseClass:member.baseClass||member.base,classPath:member.classPath||member.path||''};const key=api.key(identity);if(!key)return null;const name=event?.skillName||event?.label,override=kind==='skill'&&identity.baseClass==='archer'&&/^B[12]{0,3}$/.test(identity.classPath)?api.get?.(key)?.skillFxOverrides?.[name]:null;const animation=descriptor(api.animation(key)),fx=descriptor(override||api.fx(key,kind));return{key,animation,fx};}
const MAX_BITMAP_PIXELS=128000000,MAX_ATLASES=12;
// Display-only cache derivatives. Source atlases and all logical coordinates stay native.
const DISPLAY_MAX_EDGE=896,DISPLAY_PIXEL_TARGET=32000000;
function bitmapPixels(){return[...atlasBitmaps.values()].reduce((sum,x)=>sum+(x.pixels||0),0);}
function closeFrames(frames){for(const bitmap of frames)if(bitmap&&!closedDisplayBitmaps.has(bitmap)){closedDisplayBitmaps.add(bitmap);bitmap.close?.();playbackStats.closedBitmaps++;}}
function releaseImage(src,im){if(cache.get(src)===im)cache.delete(src);im.onload=im.onerror=null;im.src='';playbackStats.releasedSourceImages++;}
function evictBitmaps(reserve=0){if(atlasBitmaps.size<=MAX_ATLASES&&bitmapPixels()+reserve<=DISPLAY_PIXEL_TARGET)return;for(const[src,entry]of atlasBitmaps){if(entry.ready&&!entry.users&&!warmSources.has(src)){atlasBitmaps.delete(src);closeFrames(entry.frames);}if(atlasBitmaps.size<=MAX_ATLASES&&bitmapPixels()+reserve<=DISPLAY_PIXEL_TARGET)break;}}
function noteResizeFallback(src,reason,native,requested,actual){playbackStats.resizeFallbacks++;playbackStats.resizeFallbackRecent.push({src,reason,native,requested,actual,displayMemoryLimit:'32M target may be exceeded; current-party native fallback is preserved up to128M hard budget.'});if(playbackStats.resizeFallbackRecent.length>16)playbackStats.resizeFallbackRecent.shift();}
async function displayBitmap(im,x,y,c,src){const ratio=Math.min(1,DISPLAY_MAX_EDGE/Math.max(c.w,c.h)),width=Math.max(1,Math.floor(c.w*ratio)),height=Math.max(1,Math.floor(c.h*ratio)),resize=width<c.w||height<c.h;let bitmap,noted=false;
 if(resize){try{bitmap=await createImageBitmap(im,x,y,c.w,c.h,{resizeWidth:width,resizeHeight:height,resizeQuality:'high'});}catch(error){if(!['TypeError','NotSupportedError'].includes(error?.name))throw error;bitmap=await createImageBitmap(im,x,y,c.w,c.h);noteResizeFallback(src,error.name,[c.w,c.h],[width,height],[bitmap.width,bitmap.height]);noted=true;}
  if(bitmap.width!==width||bitmap.height!==height){if(!noted)noteResizeFallback(src,'resize dimensions not honoured',[c.w,c.h],[width,height],[bitmap.width,bitmap.height]);}
  else playbackStats.downsampledDisplayFrames++;
 }else bitmap=await createImageBitmap(im,x,y,c.w,c.h);
 if(bitmap.width>Math.ceil(c.w)||bitmap.height>Math.ceil(c.h)){closeFrames([bitmap]);throw new RangeError('Display bitmap unexpectedly upscaled');}return bitmap;
}
function prepareAtlas(spec){
 if(!spec?.src)return Promise.resolve(false);
 if(atlasBitmaps.has(spec.src)){const entry=atlasBitmaps.get(spec.src);atlasBitmaps.delete(spec.src);atlasBitmaps.set(spec.src,entry);return entry.promise;}
 image(spec.src);const im=cache.get(spec.src),entry={ready:false,users:0,frames:[],size:null,promise:null,pixels:0};atlasBitmaps.set(spec.src,entry);
 const fail=()=>{closeFrames(entry.frames);entry.frames=[];entry.pixels=0;if(atlasBitmaps.get(spec.src)===entry)atlasBitmaps.delete(spec.src);releaseImage(spec.src,im);playbackStats.atlasFailures++;return false;};
 entry.promise=im.decode().then(async()=>{
  if(atlasBitmaps.get(spec.src)!==entry){releaseImage(spec.src,im);return false;}
  entry.size={naturalWidth:im.naturalWidth,naturalHeight:im.naturalHeight};
  if(typeof createImageBitmap!=='function'){if(atlasBitmaps.get(spec.src)===entry)atlasBitmaps.delete(spec.src);return false;}
  const total=(spec.cols||1)*(spec.rows||1),c=cell(im,spec,0);
  entry.nativeCell=[c.w,c.h];
  const ratio=Math.min(1,DISPLAY_MAX_EDGE/Math.max(c.w,c.h)),reserve=Math.max(1,Math.floor(c.w*ratio))*Math.max(1,Math.floor(c.h*ratio))*total;evictBitmaps(reserve);if(bitmapPixels()+reserve>MAX_BITMAP_PIXELS)return fail();
  // Wait for every crop to settle so one rejection cannot leak sibling bitmaps.
  const crops=await Promise.allSettled(Array.from({length:total},(_,index)=>displayBitmap(im,index%(spec.cols||1)*c.w,Math.floor(index/(spec.cols||1))*c.h,c,spec.src).then(bitmap=>{entry.frames[index]=bitmap;entry.pixels+=bitmap.width*bitmap.height;if(atlasBitmaps.get(spec.src)!==entry)closeFrames([bitmap]);else playbackStats.peakBitmapPixels=Math.max(playbackStats.peakBitmapPixels,bitmapPixels());return bitmap;})));
  entry.frames=crops.filter(x=>x.status==='fulfilled').map(x=>x.value);
  if(crops.some(x=>x.status==='rejected'))return fail();
  entry.pixels=entry.frames.reduce((n,b)=>n+b.width*b.height,0);entry.displayDerivative=entry.frames.some(b=>b.width<c.w||b.height<c.h);entry.nativePixels=entry.size.naturalWidth*entry.size.naturalHeight;evictBitmaps();if(bitmapPixels()>MAX_BITMAP_PIXELS)return fail();
  if(atlasBitmaps.get(spec.src)!==entry){closeFrames(entry.frames);entry.frames=[];releaseImage(spec.src,im);return false;}
  entry.ready=true;releaseImage(spec.src,im);evictBitmaps();return true;
 }).catch(fail);
 return entry.promise;
}
export async function preparePartyArt(members,events=[]){const specs=new Map(),add=a=>{for(const spec of [a?.animation,a?.fx,...a?.fx?.companions||[]])if(spec?.src)specs.set(spec.src,spec);};for(const member of members||[])for(const kind of ['normal','skill'])add(lookup(member,kind));for(const event of events){const member=members?.find(x=>String(x.id)===String(event.actorId));if(member)add(lookup(member,event.skillId&&event.skillId!=='attack'?'skill':'normal',event));}const selected=warmSources.size===specs.size&&[...specs.keys()].every(src=>warmSources.has(src))?warmSources:(warmSources=new Set(specs.keys())),result=[];evictBitmaps();for(const spec of specs.values()){if(selected!==warmSources)break;result.push(await prepareAtlas(spec));}return result;}
function frameProgram(spec){const cells=(spec.cols||1)*(spec.rows||1),first=spec.firstFrame||0,total=Number(spec.frames)||cells,sequence=spec.frameSequence?.length?spec.frameSequence:Array.from({length:Math.max(1,total-first)},(_,i)=>first+i),raw=spec.durationsMs||spec.frameDurationsMs,weights=raw?.length===sequence.length?raw:raw?.length===cells?sequence.map(i=>raw[i]):sequence.map(()=>1);return{sequence,weights:weights.map(x=>Number.isFinite(x)&&x>0?x:1)};}
export function frameSample(spec,phase){const{sequence,weights}=frameProgram(spec),sum=weights.reduce((a,b)=>a+b,0),time=Math.min(.999999,Math.max(0,phase))*sum;let cursor=0,phaseFrame=0;while(phaseFrame<weights.length-1&&time>=cursor+weights[phaseFrame])cursor+=weights[phaseFrame++];return{sourceCell:sequence[phaseFrame],phaseFrame};}
function frameAt(spec,phase){return frameSample(spec,phase).sourceCell;}
function actorImpactPhase(spec){if(Number.isFinite(spec.impactPhase))return Math.max(0,Math.min(.999999,spec.impactPhase));const{sequence,weights}=frameProgram(spec),sum=weights.reduce((a,b)=>a+b,0),duration=Number.isFinite(spec.durationMs)&&spec.durationMs>0?spec.durationMs:sum;if(Number.isFinite(spec.releaseAtMs)&&spec.releaseAtMs>=0)return Math.min(.999999,spec.releaseAtMs/duration);const at=sequence.indexOf(spec.releaseFrameIndex);return at>=0?weights.slice(0,at).reduce((a,b)=>a+b,0)/sum:.5;}
// Optional contain geometry for compact formations. Legacy callers retain their
// full DOM rectangles; a portrait scene can anchor actions to the actual image.
export function containedImageRect(actor,rect=actor.getBoundingClientRect()){
 const width=Number(actor.naturalWidth),height=Number(actor.naturalHeight),style=getComputedStyle(actor);
 if(style.objectFit!=='contain'||!(width>0&&height>0&&rect.width>0&&rect.height>0))return rect;
 const scale=Math.min(rect.width/width,rect.height/height),w=width*scale,h=height*scale,position=String(style.objectPosition||'50% 100%').trim().split(/\s+/);
 const fraction=(v,fallback)=>v==='center'?.5:v==='left'||v==='top'?0:v==='right'||v==='bottom'?1:/^-?[\d.]+%$/.test(v)?Number.parseFloat(v)/100:fallback;
 const x=(rect.x??rect.left)+(rect.width-w)*fraction(position[0],.5),y=(rect.y??rect.top)+(rect.height-h)*fraction(position[1],1);
 return {x,y,left:x,top:y,right:x+w,bottom:y+h,width:w,height:h};
}
function actorFlipped(actor){const style=getComputedStyle(actor);if(Number(style.scale?.split(' ')[0])<0)return true;try{return new DOMMatrixReadOnly(style.transform).a<0;}catch{return false;}}
function nativeCastPoint(spec,index,c,p,mirror,fallback){const raw=spec.castAnchorsPx?.[index],point=Array.isArray(raw)?raw:raw&&[raw.x,raw.y];return point?.length===2&&point.every(Number.isFinite)?{x:p.x+(mirror?c.w-point[0]:point[0])*p.s,y:p.y+point[1]*p.s,nativePx:point.slice(),sourceCell:index,authored:true}: {...fallback,sourceCell:index,authored:false};}
function effectImpactPhase(spec){if(Number.isFinite(spec.impactPhase))return spec.impactPhase;const{weights}=frameProgram(spec),at=spec.phaseAnchors?.findIndex(x=>x==='to');return at>0?weights.slice(0,at).reduce((a,b)=>a+b,0)/weights.reduce((a,b)=>a+b,0):.5;}
function cell(im,spec,index){const cols=spec.cols||1,rows=spec.rows||1,w=im.naturalWidth/cols,h=im.naturalHeight/rows;return{x:index%cols*w,y:Math.floor(index/cols)*h,w,h};}
function fit(box,cw,ch,width,height,anchorX,footY,targetHeight){const b=norm(box,cw,ch),bw=(b[2]-b[0])*cw,bh=(b[3]-b[1])*ch,pad=5,s=Math.min(targetHeight/bh,(width-pad*2)/bw,(height-pad*2)/bh);let x=anchorX-(b[0]+b[2])*cw*s/2,y=footY-b[3]*ch*s;x=Math.max(pad-b[0]*cw*s,Math.min(x,width-pad-b[2]*cw*s));y=Math.max(pad-b[1]*ch*s,Math.min(y,height-pad-b[3]*ch*s));return{x,y,s,b};}
function geometry(p,c,w,h){const b=p.b,rect={left:p.x+b[0]*c.w*p.s,top:p.y+b[1]*c.h*p.s,right:p.x+b[2]*c.w*p.s,bottom:p.y+b[3]*c.h*p.s},finite=Object.values(rect).every(Number.isFinite);const clipped=!finite||rect.left<-.1||rect.top<-.1||rect.right>w+.1||rect.bottom>h+.1;if(clipped)playbackStats.clippingViolations++;return{rect,finite,clipped};}
function protectHud(scene){let state=hudLayers.get(scene);if(!state){state={users:0,slots:[...scene.querySelectorAll('.scene-floor,.boss-meter')].map(el=>({el,value:el.style.getPropertyValue('z-index'),priority:el.style.getPropertyPriority('z-index')}))};hudLayers.set(scene,state);for(const slot of state.slots)slot.el.style.setProperty('z-index','12','important');}state.users++;return()=>{if(--state.users)return;for(const slot of state.slots)slot.el.style.setProperty('z-index',slot.value,slot.priority);hudLayers.delete(scene);};}
export function startRegistryAction(scene,actor,target,member,event,{duration=520,impactAt=240,isCancelled=()=>false,reduced=false,containedActor=false,effectScale=1,effectOpacity=1}={}){
 const visualEffectScale=Number.isFinite(effectScale)?Math.max(0,Math.min(3,effectScale)):1,visualEffectOpacity=Number.isFinite(effectOpacity)?Math.max(0,Math.min(1,effectOpacity)):1;
 const kind=event.skillId&&event.skillId!=='attack'||(member?.baseClass||member?.base)==='thief'&&event.nativeSkill?'skill':'normal',entry=lookup(member,kind,event),spec=entry?.animation,actorAtlas=spec?.src&&atlasBitmaps.get(spec.src),im=actorAtlas?.ready?actorAtlas.size:spec?.src&&image(spec.src);
 if(reduced||!spec||!im||event.skillId==='defend'){playbackStats.fallback++;return null;}
 // While a large atlas is being cut into native bitmaps, keep the correct still/fallback.
 if(typeof createImageBitmap==='function'&&actorAtlas&&!actorAtlas.ready){playbackStats.fallback++;return null;}
 const fx=entry.fx,effectAtlas=fx?.src&&atlasBitmaps.get(fx.src),effect=effectAtlas?.ready?effectAtlas.size:fx?.src&&image(fx.src),canvas=document.createElement('canvas');canvas.className='registry-combat-art';canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:9';scene.append(canvas);
 if(actorAtlas)actorAtlas.users++;if(effectAtlas)effectAtlas.users++;
 const companions=(fx?.companions||[]).map(spec=>{const atlas=atlasBitmaps.get(spec.src),im=atlas?.ready?atlas.size:image(spec.src);if(atlas)atlas.users++;return{spec,atlas,im};});
 const restoreHud=protectHud(scene);
 const priorVisibility=actor.style.visibility;actor.style.visibility='hidden';let raf=0,started=performance.now(),done=false,lastPhase=0;const sourceFrames=[];
 const stop=()=>{if(done)return;done=true;activeActions.delete(stop);cancelAnimationFrame(raf);canvas.remove();actor.style.visibility=priorVisibility;restoreHud();if(actorAtlas)actorAtlas.users--;if(effectAtlas)effectAtlas.users--;for(const c of companions)if(c.atlas)c.atlas.users--;evictBitmaps();playbackStats.cleanup++;if((member.baseClass||member.base)==='thief'){playbackStats.cycleReceipts.push({key:entry.key,kind,duration,completed:lastPhase>=.999,sourceFrames:sourceFrames.slice(),strikeIndex:event.strikeIndex??0,strikeCount:event.strikeCount??1});if(playbackStats.cycleReceipts.length>32)playbackStats.cycleReceipts.shift();}};activeActions.add(stop);
 playbackStats.started++;playbackStats[kind]++;playbackStats.keys.push(entry.key);
 const draw=phase=>{
  lastPhase=phase;
  const r=scene.getBoundingClientRect(),actorBox=actor.getBoundingClientRect(),a=containedActor?containedImageRect(actor,actorBox):actorBox,targetBox=target===actor?actorBox:target.getBoundingClientRect(),t=containedActor?containedImageRect(target,targetBox):targetBox,w=scene.clientWidth,h=scene.clientHeight,dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);const g=canvas.getContext('2d');g.scale(dpr,dpr);g.imageSmoothingQuality='high';g.clearRect(0,0,w,h);
  const impactFraction=Math.max(.1,Math.min(.9,impactAt/duration)),nativeImpact=actorImpactPhase(spec),nativePhase=phase<impactFraction?phase/impactFraction*nativeImpact:nativeImpact+(phase-impactFraction)/(1-impactFraction)*(1-nativeImpact);
  const index=frameAt(spec,nativePhase);if(sourceFrames.at(-1)!==index)sourceFrames.push(index);const c=cell(im,spec,index),bounds=union(spec.unionFrameBounds||spec.frameBounds||spec.bodyBounds||spec.fig),mirror=actorFlipped(actor),b=norm(bounds,c.w,c.h),paintedBounds=mirror?[1-b[2],b[1],1-b[0],b[3]]:b,placement=fit(paintedBounds,c.w,c.h,w,h,a.x+a.width*.5-r.x,a.bottom-r.y,a.height),dw=c.w*placement.s,dh=c.h*placement.s;
  g.save();if(mirror){g.translate(placement.x+dw,placement.y);g.scale(-1,1);}const dx=mirror?0:placement.x,dy=mirror?0:placement.y;
  if(actorAtlas?.ready){const bitmap=actorAtlas.frames[index];g.drawImage(bitmap,0,0,bitmap.width,bitmap.height,dx,dy,dw,dh);}else g.drawImage(im,c.x,c.y,c.w,c.h,dx,dy,dw,dh);g.restore();
  const seen=playbackStats.seenFrames[entry.key]||(playbackStats.seenFrames[entry.key]={normal:[],skill:[]});if(!seen[kind].includes(index))seen[kind].push(index);
  playbackStats.lastGeometry={key:entry.key,kind,character:geometry(placement,c,w,h),fx:null,characterFrame:index,stage:{width:w,height:h},hudProtected:[...scene.querySelectorAll('.scene-floor,.boss-meter')].every(el=>el.style.zIndex==='12')};
  const from=nativeCastPoint(spec,index,c,placement,mirror,{x:a.x+a.width*.65-r.x,y:a.y+a.height*.4-r.y}),to={x:t.x+t.width*.5-r.x,y:t.y+t.height*.45-r.y};
  Object.assign(playbackStats.lastGeometry,{nativeImpactPhase:nativeImpact,nativePhase,from,mirror,placement:{x:placement.x,y:placement.y,scale:placement.s,cellWidth:c.w,cellHeight:c.h}});
  function effectLayer(spec,image,atlas){if(!image||visualEffectScale<=0||visualEffectOpacity<=0)return null;const impact=effectImpactPhase(spec),effectPhase=phase<impactFraction?phase/impactFraction*impact:impact+(phase-impactFraction)/(1-impactFraction)*(1-impact),sample=frameSample(spec,effectPhase),index=sample.sourceCell,q=cell(image,spec,index),bounds=union(spec.unionFrameBounds||spec.frameBounds),anchor=spec.phaseAnchors?.[sample.phaseFrame]||'to',travel=Math.min(1,Math.max(0,(phase-.15)/Math.max(.05,impactFraction-.15))),at=anchor==='from'?from:anchor==='travel'?{x:from.x+(to.x-from.x)*travel,y:from.y+(to.y-from.y)*travel}:to;
   const maxHeight=Math.min(kind==='skill'?h*.8:h*.5,(spec.renderWidth||(kind==='skill'?235:150))*q.h/q.w)*visualEffectScale,mirror=spec.mirrorToTarget&&to.x<from.x,b=norm(bounds,q.w,q.h),paintedBounds=mirror?[1-b[2],b[1],1-b[0],b[3]]:b,p=fit(paintedBounds,q.w,q.h,w,h,at.x+(spec.offset?.x||0),at.y+maxHeight*.45+(spec.offset?.y||0),maxHeight),dw=q.w*p.s,dh=q.h*p.s;
   g.save();g.globalAlpha*=(spec.intensity??1)*visualEffectOpacity;if(mirror){g.translate(p.x+dw,p.y);g.scale(-1,1);}const dx=mirror?0:p.x,dy=mirror?0:p.y;if(atlas?.ready){const bitmap=atlas.frames[index];g.drawImage(bitmap,0,0,bitmap.width,bitmap.height,dx,dy,dw,dh);}else g.drawImage(image,q.x,q.y,q.w,q.h,dx,dy,dw,dh);g.restore();
   const seen=playbackStats.seenFxFrames[entry.key]||(playbackStats.seenFxFrames[entry.key]={normal:[],skill:[]});if(!seen[kind].includes(index))seen[kind].push(index);const anchors=playbackStats.seenFxAnchors[entry.key]||(playbackStats.seenFxAnchors[entry.key]={normal:[],skill:[]});if(!anchors[kind].includes(anchor))anchors[kind].push(anchor);return{...geometry(p,q,w,h),src:spec.src,sourceCell:index,phaseFrame:sample.phaseFrame,anchor};
  }
  if(effect){playbackStats.lastGeometry.fx=effectLayer(fx,effect,effectAtlas);playbackStats.lastGeometry.companions=companions.map(c=>effectLayer(c.spec,c.im,c.atlas)).filter(Boolean);}
  else if(typeof fx?.draw==='function'&&visualEffectScale>0&&visualEffectOpacity>0){
   if(visualEffectScale===1&&visualEffectOpacity===1)fx.draw(g,nativePhase,from,to,{...event,basic:kind==='normal',characterKey:entry.key});
   else {g.save();g.translate(to.x,to.y);g.scale(visualEffectScale,visualEffectScale);g.globalAlpha*=visualEffectOpacity;
    // Preserve both weapon/target positions while reducing authored local FX
    // dimensions. Canvas FX may assign alpha internally, so retain the cap.
    const context=visualEffectOpacity===1?g:new Proxy(g,{get(target,key){const value=Reflect.get(target,key,target);return key==='globalAlpha'?value/visualEffectOpacity:typeof value==='function'?value.bind(target):value;},set(target,key,value){Reflect.set(target,key,key==='globalAlpha'?value*visualEffectOpacity:value,target);return true;}});
    fx.draw(context,nativePhase,{...from,x:(from.x-to.x)/visualEffectScale,y:(from.y-to.y)/visualEffectScale},{...to,x:0,y:0},{...event,basic:kind==='normal',characterKey:entry.key});g.restore();
   }
  }
  playbackStats.frames++;
 };
 const tick=now=>{if(done)return;if(document.hidden||!scene.isConnected||isCancelled()){stop();return;}if(started===null)started=now;const phase=Math.min(1,(now-started)/duration);draw(phase);if(phase<1)raf=requestAnimationFrame(tick);else stop();};if((member.baseClass||member.base)==='thief')draw(0);raf=requestAnimationFrame(tick);
 return{stop,key:entry.key,kind,draw,hasFx:!!effect||typeof fx?.draw==='function'};
}
export function disposeArt(){for(const stop of [...activeActions])stop();for(const entry of atlasBitmaps.values())closeFrames(entry.frames);atlasBitmaps.clear();for(const[src,im]of cache)releaseImage(src,im);cache.clear();warmSources=new Set();}
window.addEventListener('pagehide',disposeArt);
export const registryPlayback={preparePartyArt,startRegistryAction,dispose:disposeArt,frameSample,cacheStats:()=>({entries:atlasBitmaps.size,pixels:bitmapPixels(),pixelBudget:MAX_BITMAP_PIXELS,displayPixelTarget:DISPLAY_PIXEL_TARGET,displayMaxEdge:DISPLAY_MAX_EDGE,representation:'display-cache-derivative; source atlas remains native',bitmapNativeRGBAExact:false,resizeQuality:'high',neverUpscale:true,resizeFallbacks:playbackStats.resizeFallbacks,memoryTargetExceeded:bitmapPixels()>DISPLAY_PIXEL_TARGET,maxAtlases:MAX_ATLASES,activeActions:activeActions.size,rawImages:cache.size,rawDecodedPixels:[...cache.values()].reduce((n,im)=>n+im.naturalWidth*im.naturalHeight,0),warmSources:warmSources.size,warmReady:[...warmSources].filter(src=>atlasBitmaps.get(src)?.ready).length,atlases:[...atlasBitmaps].map(([src,e])=>({src,ready:e.ready,nativeCell:e.nativeCell,nativePixels:e.nativePixels,displayPixels:e.pixels,displayDerivative:e.displayDerivative,frameSizes:e.frames.filter(Boolean).map(b=>[b.width,b.height])}))}),stats:playbackStats};
