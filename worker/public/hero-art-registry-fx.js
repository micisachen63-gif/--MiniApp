/* Exact authored role effects. Compound class renderers retain their own dispatch. */
(()=>{'use strict';const api=window.RpgSkillFX;if(!api)return;
const images=new Map(),limit=6,pixelBudget=32000000,stats={draws:0,byKey:{},byKind:{},recent:[]};
function touch(src,state){images.delete(src);images.set(src,state);}
function load(spec){if(!spec?.src||spec.mainBattleRenderer)return Promise.resolve(null);const cached=images.get(spec.src);if(cached){touch(spec.src,cached);return cached.ready;}
 const pixels=(spec.cellWidth||723)*(spec.cellHeight||723)*spec.cols*spec.rows;
 const evict=()=>{const key=images.keys().next().value,old=images.get(key);images.delete(key);old.im.onload=old.im.onerror=null;old.resolve(null);old.im.src='';};
 while(images.size&&(images.size>=limit||[...images.values()].reduce((n,s)=>n+s.pixels,0)+pixels>pixelBudget))evict();
 const im=new Image(),state={im,pixels,resolve:null,ready:null};state.ready=new Promise(resolve=>{state.resolve=resolve;});images.set(spec.src,state);im.onload=()=>{if(images.get(spec.src)!==state)return state.resolve(null);state.pixels=im.naturalWidth*im.naturalHeight;while(images.size>1&&[...images.values()].reduce((n,s)=>n+s.pixels,0)>pixelBudget){if(images.keys().next().value===spec.src)touch(spec.src,state);evict();}if(state.pixels>pixelBudget){images.delete(spec.src);state.resolve(null);im.src='';return;}state.resolve(im);};im.onerror=()=>{if(images.get(spec.src)===state)images.delete(spec.src);state.resolve(null);};im.src=spec.src;return state.ready;
}
const prepare=api.prepare?.bind(api),profile=api.profile.bind(api),draw=api.draw.bind(api);
// The battle engine warms the selected exact identity; this path hook preserves class renderers.
api.prepare=(cls,path='')=>prepare?.(cls,path);
api.profile=(name,cls,path)=>({...profile(name,cls,path),artPath:path,artClass:cls,artSkillName:name});
function sample(spec,phase){const native=spec.frames||spec.cols*spec.rows,sequence=spec.frameSequence||Array.from({length:native},(_,i)=>i),durations=spec.durationsMs?.length===sequence.length?spec.durationsMs:sequence.map(()=>1),total=durations.reduce((a,b)=>a+b,0),impact=spec.phaseAnchors?.indexOf('to');if(impact>0){const authored=durations.slice(0,impact).reduce((n,v)=>n+v,0)/total;phase=phase<.65?phase/.65*authored:authored+(phase-.65)/.35*(1-authored);}const t=phase*total;let i=0,begin=0;while(i<sequence.length-1&&t>=begin+durations[i])begin+=durations[i++];return{frame:sequence[i],phaseFrame:i,sequence,durations,total,t};}
api.draw=(g,phase,from,to,p)=>{const registry=window.RpgHeroArtRegistry,key=p.artKey||p.heroKey,spec=key&&registry?.fx(key,p.basic?'normal':'skill'),state=spec&&images.get(spec.src),im=state?.im;
 if(spec?.mainBattleRenderer||!p.basic&&p.artClass==='archer'&&['獵鷹助攻','獵鷹標記','靈獸撲擊','萬獸神尊・終章','野獸之王'].includes(p.artSkillName))return draw(g,phase,from,to,p);
 if(!spec||!im?.complete||!im.naturalWidth)return draw(g,phase,from,to,p);if(phase<0||phase>=1)return;touch(spec.src,state);
 const sampled=sample(spec,phase),{frame,phaseFrame}=sampled,cw=im.naturalWidth/spec.cols,ch=im.naturalHeight/spec.rows;let progress=Math.max(0,Math.min(1,(phase-.18)/.47)),anchor=phase<.18?'from':phase<.65?'travel':'to';
 if(spec.phaseAnchors?.length===sampled.sequence.length){anchor=spec.phaseAnchors[phaseFrame];const travel=spec.phaseAnchors.map((a,i)=>a==='travel'?i:-1).filter(i=>i>=0);if(travel.length){const start=sampled.durations.slice(0,travel[0]).reduce((a,b)=>a+b,0),end=sampled.durations.slice(0,travel.at(-1)+1).reduce((a,b)=>a+b,0);progress=Math.max(0,Math.min(1,(sampled.t-start)/(end-start)));}}
 const x=anchor==='from'?from.x:anchor==='travel'?from.x+(to.x-from.x)*progress:to.x,y=anchor==='from'?from.y:anchor==='travel'?from.y+(to.y-from.y)*progress:to.y,width=spec.renderWidth||(p.basic?150:225),height=width*ch/cw;
 g.save();g.globalAlpha*=spec.intensity??1;g.globalCompositeOperation='source-over';g.shadowBlur=0;g.drawImage(im,frame%spec.cols*cw,Math.floor(frame/spec.cols)*ch,cw,ch,x-width/2,y-height/2,width,height);g.restore();stats.draws++;stats.byKey[key]=(stats.byKey[key]||0)+1;const kind=p.basic?'normal':'skill';stats.byKind[kind]=(stats.byKind[kind]||0)+1;stats.recent.push({key,kind,frame,phaseFrame,anchor,phase,from:{x:from.x,y:from.y},to:{x:to.x,y:to.y},src:spec.src});if(stats.recent.length>96)stats.recent.shift();
};
window.RpgHeroArtFX={stats,prepare(key){return Promise.all(['normal','skill'].map(k=>load(window.RpgHeroArtRegistry?.fx(key,k))));},cacheStatus:()=>({size:images.size,limit,pixels:[...images.values()].reduce((n,s)=>n+s.pixels,0),pixelBudget,keys:[...images.keys()]})};})();
