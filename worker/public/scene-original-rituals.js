/* Original presentation modules, connected to the scoped scene clients.
 * This layer never sends a game request or invents an economic result. */
(() => {
 'use strict';
 const flights=new Map(),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function script(name){if(flights.has(name))return flights.get(name);const p=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/'+name;s.onload=resolve;s.onerror=()=>{flights.delete(name);s.remove();reject(Error('原版動畫素材載入失敗，請返回重試'));};document.head.append(s);});flights.set(name,p);return p;}
 function style(name){if(document.querySelector('link[data-original-style="'+name+'"]'))return;const l=document.createElement('link');l.rel='stylesheet';l.dataset.originalStyle=name;l.href='/'+name;document.head.append(l);}
 function shell(root,title,id){
  const doc=root.ownerDocument,ov=doc.createElement('section'),parent=root.closest('.scene-social-card')||root.parentNode;let closed=false,committing=false,cleanup=()=>{},resolve;
  const previous=root.inert;root.inert=true;ov.className='scene-retained-ritual';if(id)ov.id=id;ov.setAttribute('aria-label',title);parent.append(ov);
  const done=new Promise(r=>resolve=r);
  function close(force=false){if(closed||committing&&!force)return false;closed=true;cleanup();ov.hidden=true;ov.remove();root.inert=previous;resolve();return true;}
  return {ov,done,close,current:()=>!closed&&ov.isConnected,setCommitting:v=>{committing=v;},setCleanup:fn=>cleanup=fn};
 }
 function forge(root,{item,plan,icon,commit,current}){
  const h=shell(root,'神匠鍛造','forge');
  void(async()=>{
   try{
    style('forge-ritual.css');await script('forge-ritual.js');if(!h.current()||!current())return h.close(true);
    const api=window.RpgForgeRitual;h.setCleanup(()=>api.dispose());
    const ready=api.prepare(h.ov,item,icon,plan.mode==='blessed',{mode:plan.kind==='reroll'?'reroll':'enhance',summary:plan.cost.name+' ×'+plan.cost.scrolls+' · 金幣 '+plan.cost.gold,
      choose:false,guaranteed:plan.mode==='guaranteed',guaranteedHave:plan.cost.have,guaranteedKey:plan.cost.key,guaranteedName:plan.cost.name,guaranteedArt:'/art/items-scrolls-pink-20261018/'+plan.cost.key+'.webp',autoTarget:plan.background?plan.target:null});
    h.ov.classList.add('scene-retained-ritual');h.ov.querySelector('.fr-auto')?.setAttribute('hidden','');
    h.ov.querySelectorAll('img').forEach(img=>{const src=img.getAttribute('src');if(src?.startsWith('art/'))img.src='/'+src;});
    if(!await ready){h.close(true);return;}if(!h.current()||!current())return h.close(true);
    h.setCommitting(true);const start=Date.now(),result=await commit();if(!h.current()||!current())return h.close(true);
    await new Promise(r=>setTimeout(r,Math.max(0,850-(Date.now()-start))));if(!h.current())return;
    if(result?.action==='enhance'&&result.result)api.reveal(h.ov,result.result.result==='success'?'success':result.result.result==='break'?'break':'nothing',result.result.to);
    else if(result?.action==='reroll'&&result.result){api.reveal(h.ov,'reroll');const title=h.ov.querySelector('.fr-name'),r=result.result;if(title)title.textContent=(r.itemName||item.name)+' · 品質 '+(r.before?.quality||'未鑑定')+' → '+(r.after?.quality||'結果待核對');}
    else {h.ov.classList.remove('charging');const label=h.ov.querySelector('.fr-instruction');if(label)label.textContent=result?.job?'背景作業已啟動，返回查看真實進度':'結果尚待核對，請返回確認原紀錄';}
    h.setCommitting(false);const footer=document.createElement('div');footer.className='fg-b';const close=document.createElement('button');close.type='button';close.className='btn gold';close.textContent='返回工坊';close.onclick=()=>h.close();footer.append(close);h.ov.querySelector('.fg-box').append(footer);close.focus({preventScroll:true});
   }catch(error){h.setCommitting(false);h.ov.innerHTML='<p role="alert">'+esc(error.message)+'</p><button type="button">返回工坊</button>';h.ov.querySelector('button').onclick=()=>h.close();}
  })();return h;
 }
 function summon(root,{config,commit,current}){
  const h=shell(root,'神羽祈願','scene-original-summon');let tree=null,gesture=null,presentation=null;
  h.setCleanup(()=>{gesture?.cleanup();presentation?.cleanup();tree?.cleanup();});
  void(async()=>{
   try{
    for(const css of ['guardian-sigil.css','guardian-ritual-ui.css'])style(css);
    for(const file of ['guardian-sigil-contract.js','guardian-haptics.js','guardian-scene-media.js','guardian-worldtree.js','guardian-pull.js','guardian-summon-gesture.js','guardian-presentation.js']){await script(file);if(!h.current()||!current())return h.close(true);}
    const cfg=window.RpgGuardianContract.config(config);
    h.ov.innerHTML='<header><b>世界樹 · 神羽祈願</b><button type="button" data-ritual-back>返回</button></header><div class="scene-original-guardian">'+window.RpgGuardianWorldTree.markup(cfg)+'</div><p class="scene-ritual-status" role="status">長按胸前神羽，向下拔取；拉到底放開後才結算。</p><footer><button type="button" data-ritual-reveal hidden>全部揭曉</button></footer>';
    const scene=h.ov.querySelector('.guardian-worldtree-scene'),back=h.ov.querySelector('[data-ritual-back]'),label=h.ov.querySelector('.scene-ritual-status');back.onclick=()=>h.close();tree=window.RpgGuardianWorldTree.mount(scene);
    gesture=window.RpgGuardianSummonGesture.mount(scene,{config:cfg,tree,distance:()=>tree.pullDistance(),canStart:()=>h.current()&&current(),
      commit:async()=>{h.setCommitting(true);back.disabled=true;const result=await commit();return result;},
      onFinish(operation,detail){if(!h.current()||!current())return;gesture?.cleanup();tree?.cleanup();gesture=null;tree=null;h.setCommitting(false);back.disabled=false;
       if(!operation){label.textContent='原結果尚待核對，請返回查詢；不會重新扣款。';return;}
       label.textContent='神羽已回應，點選羽毛查看天使原畫。';presentation=window.RpgGuardianPresentation.mount(scene,{config:cfg,operation,previous:{operationId:operation.operationId,ready:true},playTransition:detail.complete,serverNow:Date.now()});
       const reveal=h.ov.querySelector('[data-ritual-reveal]');reveal.hidden=false;reveal.onclick=()=>presentation?.revealAll();
      }});
   }catch(error){h.setCommitting(false);h.ov.innerHTML='<p role="alert">'+esc(error.message)+'</p><button type="button">返回召喚</button>';h.ov.querySelector('button').onclick=()=>h.close();}
  })();return h;
 }
 window.RpgSceneRituals={forge,summon};
})();
