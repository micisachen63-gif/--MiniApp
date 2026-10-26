(() => {
 'use strict';
 const ROOT='/art/star-ring-rewards-20261018/',IDS=['star_ring_aura_dawn','star_ring_aura_moon','star_ring_aura_eclipse'];
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const key=a=>IDS.includes(typeof a==='string'?a:a?.id)?(typeof a==='string'?a:a.id).replace('star_ring_aura_',''):null;
 const art=a=>key(a)?'/art/star-ring-surround-20261026/surround-'+key(a)+'.webp':null;
 const icon=a=>key(a)?ROOT+'icon-'+key(a)+'.webp':null;
 const silhouetteCache=new Map();
 async function silhouette(image){
  const src=image.currentSrc||image.src;if(!src||!image.naturalWidth||!globalThis.document?.createElement)return null;
  if(!silhouetteCache.has(src))silhouetteCache.set(src,(async()=>{
   const canvas=document.createElement('canvas'),w=256,h=Math.max(1,Math.round(w*image.naturalHeight/image.naturalWidth));canvas.width=w;canvas.height=h;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,w,h);const data=ctx.getImageData(0,0,w,h).data;
   let left=w,top=h,right=-1,bottom=-1;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>8){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
   if(right<=left||bottom<=top)return null;
   let footLeft=w,footRight=-1;for(let y=Math.floor(bottom-(bottom-top)*.1);y<=bottom;y++)for(let x=left;x<=right;x++)if(data[(y*w+x)*4+3]>8){footLeft=Math.min(footLeft,x);footRight=Math.max(footRight,x);}
   return {left:left/w,right:(right+1)/w,top:top/h,bottom:(bottom+1)/h,footX:footRight>=footLeft?(footLeft+footRight+1)/2/w:(left+right+1)/2/w};
  })().catch(()=>null));
  return silhouetteCache.get(src);
 }
 // Portrait normalization happens after load. Follow its real size and crop,
 // rather than preserving coordinates measured before attachment or alpha fit.
 function follow(node,image,holder,options={}){
  let stopped=false,frame=null,bounds=null,src='';
  const sync=()=>{frame=null;if(!stopped&&node.isConnected&&image.isConnected&&holder.isConnected)position(node,image,holder,{...options,bounds});};
  const schedule=()=>{if(!stopped&&frame==null)frame=requestAnimationFrame(sync);};
  const load=()=>{const current=image.currentSrc||image.src;src=current;bounds=null;const phase=String(options.phaseKey??current??'').split('').reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%6400;node.style.setProperty?.('--sr-fx-delay',-phase+'ms');schedule();void silhouette(image).then(value=>{if(!stopped&&src===current){bounds=value;schedule();}});};
  image.addEventListener('load',load);
  const visibility=()=>node.toggleAttribute?.('data-fx-paused',!!globalThis.document?.hidden);globalThis.document?.addEventListener?.('visibilitychange',visibility);visibility();
  const resize=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;resize?.observe(image);if(holder!==image)resize?.observe(holder);
  const changes=typeof MutationObserver==='function'?new MutationObserver(()=>{if(src!==(image.currentSrc||image.src))load();else schedule();}):null;changes?.observe(image,{attributes:true,attributeFilter:['src','style','class']});
  load();const stop=()=>{stopped=true;if(frame!=null)cancelAnimationFrame(frame);image.removeEventListener('load',load);globalThis.document?.removeEventListener?.('visibilitychange',visibility);resize?.disconnect();changes?.disconnect();};stop.refresh=schedule;return stop;
 }
 const safeHero=url=>typeof url==='string'&&/^\/?art\/[a-zA-Z0-9_./?=&%-]+$/.test(url)&&!url.includes('..')?url:null;
 function markup(a,extra=''){const p=art(a);return p?'<span class="star-ring-aura '+esc(extra)+'" data-cosmetic-aura="'+esc(typeof a==='string'?a:a.id)+'" aria-hidden="true" style="--sr-surround-art:url('+p+')"><span class="sr-aura-rear"></span><span class="sr-aura-lustre"></span><i class="sr-aura-mote"></i><i class="sr-aura-mote"></i><i class="sr-aura-mote"></i><i class="sr-aura-mote"></i><i class="sr-aura-mote"></i><i class="sr-aura-mote"></i></span>':'';}
 // Each equipment kind resolves through the shared class/slot collection map.
 function gearArt(e){return globalThis.RpgStarRingGearArt?.gearArt(e)||null;}
 function itemArt(id){if(id==='star_ring_core')return '/art/star-ring-rank-rewards-20261019/star-ring-core.webp';if(/^guaranteed_scroll_[wa]$/.test(id))return '/art/items-scrolls-pink-20261018/'+id+'.webp';if(id==='star_ring_token')return '/art/star-ring-20261018/star_ring_token.webp';if(IDS.includes(id))return icon(id);if(['scroll_w','scroll_a','scroll_r','blessed_scroll_w','blessed_scroll_a'].includes(id))return '/art/items-scrolls-cutout-20261011/'+id+'.webp';return null;}
 function view(s,host={}){
  const data=s.data,cat=data?.catalog||[],selected=cat.find(a=>a.id===s.preview)||data?.equipped||cat[0],owned=new Set(data?.owned||[]),me=host.me?.(),hero=safeHero(host.actorArt?.(me?.character||me||{})),equipped=data?.equipped?.id;
  return '<section class="sr-wardrobe" aria-label="星環專屬外觀"><header><div><span>CELESTIAL ATELIER</span><h3>星環衣櫥</h3></div><b>'+(data?Number(data.balance||0).toLocaleString('zh-TW')+' 枚徽記':'')+'</b></header><p>讓遠方的星光，環繞身側。永久綁定此角色，僅改變外觀。</p>'+(s.error?'<p class="sr-cosmetic-error" role="alert">'+esc(s.error)+'</p>':'')+(!data?'<button type="button" data-cosmetic-load '+(s.busy?'disabled':'')+'>'+(s.busy?'正在展開星圖…':'查看專屬外觀')+'</button>':'<div class="sr-cosmetic-preview">'+markup(selected,'sr-preview-aura')+(hero?'<img class="sr-preview-hero" src="'+esc(hero)+'" alt="'+esc(me?.character?.name||me?.name||'目前角色')+'的外觀預覽">':'<p class="sr-preview-missing">角色圖同步中</p>')+'<div class="sr-preview-label"><small>外觀預覽</small><b>'+esc(selected?.name||'尚未穿戴')+'</b></div></div><div class="sr-cosmetic-cards">'+cat.filter(a=>key(a)).map(a=>{const own=owned.has(a.id),on=equipped===a.id;return '<article class="'+(selected?.id===a.id?'is-previewed':'')+'"><button class="sr-cosmetic-select" type="button" data-cosmetic-preview="'+a.id+'" aria-pressed="'+(selected?.id===a.id)+'"><img src="'+icon(a)+'" alt=""><b>'+esc(a.name)+'</b><small>'+esc(a.description||'遠征專屬環身星光')+'</small></button><span class="sr-cosmetic-price">'+(on?'穿戴中':own?'已永久解鎖':Number(a.cost).toLocaleString('zh-TW')+' 枚星征徽記')+'</span><button type="button" data-cosmetic-'+(own?'equip':'buy')+'="'+(on?'none':a.id)+'" '+(s.busy||!own&&(Number(data.balance)<Number(a.cost)||Number(me?.character?.level??me?.level??0)<Number(a.level||40))?'disabled':'')+'>'+(on?'卸下':own?'穿戴':Number(me?.character?.level??me?.level??0)<Number(a.level||40)?'Lv.'+Number(a.level||40)+' 解鎖':'兌換外觀')+'</button></article>';}).join('')+'</div><p class="sr-cosmetic-note">同時穿戴一種 · 不佔裝備欄位 · 不增加戰鬥能力</p>')+'</section>';
 }
 function mount(root,host,{autoload=true}={}){
  const owner=String(host.me?.()?.character?.tgId??host.me?.()?.tgId??''),state={data:null,busy:false,error:'',preview:null},requests=new Map();let disposed=false,epoch=0;
  const valid=()=>!disposed&&root.isConnected&&owner===String(host.me?.()?.character?.tgId??host.me?.()?.tgId??'');
  const paint=()=>{if(!valid())return;root.innerHTML=view(state,host);const image=root.querySelector?.('.sr-preview-hero'),node=root.querySelector?.('.sr-preview-aura'),holder=root.querySelector?.('.sr-cosmetic-preview');if(image&&node&&holder){const sync=()=>{if(valid()&&image.isConnected)position(node,image,holder);};image.addEventListener('load',sync,{once:true});if(image.complete)sync();}};
  const req=action=>{const storage='starRingCosmetic:'+owner+':'+action;if(!requests.has(action)){let old;try{old=sessionStorage.getItem(storage);}catch{}requests.set(action,old||globalThis.crypto?.randomUUID?.()||String(Date.now())+'-'+Math.random());try{sessionStorage.setItem(storage,requests.get(action));}catch{}}return requests.get(action);};
  const done=action=>{requests.delete(action);try{sessionStorage.removeItem('starRingCosmetic:'+owner+':'+action);}catch{}};
  async function run(action='load',id=null){
   if(!valid()||state.busy)return;state.busy=true;state.error='';const version=++epoch;
   try{paint();let r;if(action==='buy'){r=await host.api('star-ring/shop',{offerId:id,requestId:req('buy:'+id)});if(r?.ok===false)throw Error(r.message||'兌換未完成');done('buy:'+id);state.data=r.cosmetics||await host.api('star-ring/cosmetics',{});}else{r=await host.api(action==='equip'?'star-ring/cosmetics/equip':'star-ring/cosmetics',action==='equip'?{cosmeticId:id==='none'?null:id,requestId:req('equip:'+id)}:{});if(r?.ok===false)throw Error(r.message||'外觀尚未更新');if(action==='equip')done('equip:'+id);state.data=r;}
    if(!valid()||version!==epoch)return;if(action!=='load'){host.toast?.(action==='buy'?'專屬外觀已永久解鎖':id==='none'?'已卸下外觀':'已穿戴專屬外觀');await host.refresh?.();}
   }catch(e){if(valid()&&version===epoch)state.error=e.message||'暫時無法取得外觀，請重試。';}finally{if(valid()&&version===epoch){state.busy=false;paint();}}
  }
  const click=e=>{const b=e.target.closest?.('button');if(!b||!root.contains(b)||b.disabled||state.busy)return;const d=b.dataset;if(d.cosmeticPreview){state.preview=d.cosmeticPreview;paint();}else if(d.cosmeticBuy)run('buy',d.cosmeticBuy);else if(d.cosmeticEquip)run('equip',d.cosmeticEquip);else if(Object.hasOwn(d,'cosmeticLoad'))run();};
  root.addEventListener('click',click);paint();if(autoload)void run();return ()=>{disposed=true;epoch++;root.removeEventListener('click',click);};
 }
 // A portrait-proportioned surround effect. Geometry follows the visible body;
 // the artwork never rotates or stretches into a ground disc.
 function placement(image,container,{contain=true,maxWidthRatio=null,maxHeightRatio=null,bounds=null}={}){
  const r=image.getBoundingClientRect(),c=container.getBoundingClientRect(),ratio=image.naturalWidth/image.naturalHeight;
  if(!Number.isFinite(ratio)||!ratio)return null;
  const style=globalThis.getComputedStyle?.(image),fill=style?.objectFit==='fill',w=fill?r.width:Math.min(r.width,r.height*ratio),h=fill?r.height:w/ratio;
  const pos=String(style?.objectPosition||'50% 100%').split(/\s+/),fraction=(v,fallback)=>v==='left'||v==='top'?0:v==='right'||v==='bottom'?1:v==='center'?.5:/^-?[\d.]+%$/.test(v)?Number.parseFloat(v)/100:fallback;
  const x=r.left-c.left+(r.width-w)*fraction(pos[0],.5),y=r.top-c.top+(r.height-h)*fraction(pos[1],1),b=bounds||{left:0,right:1,top:0,bottom:1,footX:.5};
  const bodyHeight=h*(b.bottom-b.top),bodyWidth=w*(b.right-b.left),height=bodyHeight*1.1,center=(b.left+b.right)/2;
  const p={left:x+w*(b.footX*.65+center*.35),top:y+h*(b.top+b.bottom)/2,width:Math.max(height*.78,Math.min(bodyWidth*1.2,height*1.05)),height};
  const scale=Math.min(1,maxWidthRatio>0&&c.width>0?c.width*maxWidthRatio/p.width:1,maxHeightRatio>0&&c.height>0?c.height*maxHeightRatio/p.height:1,contain&&c.width>0?Math.max(1,c.width-8)/p.width:1,contain&&c.height>0?Math.max(1,c.height-8)/p.height:1);
  p.width*=scale;p.height*=scale;
  if(contain&&c.width>0&&c.height>0){p.left=Math.max(4+p.width/2,Math.min(c.width-4-p.width/2,p.left));p.top=Math.max(4+p.height/2,Math.min(c.height-4-p.height/2,p.top));}
  return p;
 }
 function position(node,image,container,options){const p=placement(image,container,options);if(!p)return;Object.assign(node.style,{left:(p.left-p.width/2)+'px',top:(p.top-p.height/2)+'px',width:p.width+'px',height:p.height+'px',bottom:'auto',transform:'none'});node.style.setProperty?.('--sr-effect-height',p.height+'px');node.style.setProperty?.('--sr-lower-path',`ellipse(${p.width*.43}px ${p.height*.14}px at ${p.width*.5}px ${p.height*.66}px)`);node.style.setProperty?.('--sr-upper-path',`ellipse(${p.width*.4}px ${p.height*.1}px at ${p.width*.5}px ${p.height*.47}px)`);}
 function mountActors(scene,members,selector='.scene-hero'){
  if(!scene)return ()=>{};const fields=[];let disposed=false;
  const shared=!!scene.matches?.('.sr-arena,.battle-scene');
  for(const member of members||[]){
   if(!key(member.aura))continue;
   const actor=[...scene.querySelectorAll(selector)].find(n=>String(n.dataset.memberId)===String(member.id)),image=actor?.matches?.('img')?actor:actor?.querySelector('img');if(!image)continue;
   const holder=shared||actor.matches('img')?scene:actor;
   let node=shared?[...holder.querySelectorAll(':scope > .star-ring-aura')].find(n=>String(n.dataset.cosmeticMember)===String(member.id)):holder.querySelector(':scope > .star-ring-aura');
   if(!node){holder.insertAdjacentHTML('beforeend',markup(member.aura,'scene-cosmetic-aura'));node=holder.lastElementChild;}
   if(node.dataset)node.dataset.cosmeticMember=String(member.id);
   const stop=follow(node,image,holder,{contain:true,phaseKey:member.id});fields.push({node,stop});
  }
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>fields.forEach(f=>f.stop.refresh())):null;observer?.observe(scene);return ()=>{if(disposed)return;disposed=true;observer?.disconnect();for(const f of fields){f.stop();f.node.remove();}};
 }
 globalThis.RpgStarRingCosmetics=Object.freeze({mountActors,ids:IDS,key,art,icon,markup,gearArt,itemArt,render:view,mount,placement,position,follow});
})();
