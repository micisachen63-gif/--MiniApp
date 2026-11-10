(() => {
 'use strict';
 let modulePromise=null,legacyPromise=null;const receipts=new Map();
 function loadLegacy(){return legacyPromise||(legacyPromise=import('/skill-vfx-legacy.mjs').catch(error=>{legacyPromise=null;throw error;}));}
 const alive=m=>m&&!m.left&&!(Number(m.maxHp)>0&&Number(m.hp)<=0);
 function eligibleEvents(p){const b=p?.battle;if(!b||['complete','ended'].includes(p.status))return [];const members=b.members||p.members||[];let events=b.events||[];
  // The first beat and hourly arrivals may contain only a system notice.
  // Keep combat poses moving without predicting damage, HP or rewards.
  if(events.every(e=>e.actorId==='system')&&p.status==='running'&&Number(b.enemy?.hp)>0)events=members.filter(alive).map(m=>({actorId:m.id,skillId:'attack',cosmetic:true,presentationOnly:true}));
  const queue=[];
  events.forEach((event,index)=>{
   const member=members.find(m=>String(m.id)===String(event.actorId));
   const castReceipt=[event.vfx,...(Array.isArray(event.vfxEvents)?event.vfxEvents:[])].some(raw=>raw?.kind==='cast'&&raw.actorId===String(event.actorId));
   if(event.actorId!=='boss'&&typeof event.skillId==='string'&&member&&(alive(member)||castReceipt)){queue.push({event,index,member});return;}
   // Periodic and reflection containers may belong to the system or boss. Only
   // explicit effect receipts identify their real owner; never animate a cast
   // from an aggregate damage label or invent a basic-attack identity.
   if(event.cosmetic||event.presentationOnly)return;
   const effects=[event.vfx,...(Array.isArray(event.vfxEvents)?event.vfxEvents:[])].filter(raw=>raw?.kind==='effect'&&typeof raw.actorId==='string');
   const actors=[...new Set(effects.map(raw=>raw.actorId))];
   for(const actorId of actors){
    const owner=members.find(m=>String(m.id)===actorId);if(!owner)continue;
    queue.push({event:{actorId,vfxEvents:effects.filter(raw=>raw.actorId===actorId)},index:index+':effect:'+actorId,member:owner,effectOnly:true});
   }
  });
  return queue;}
 function load(){if(!modulePromise)modulePromise=import('/expedition/hero-art-playback.js?v=20261104-skill-vfx1').catch(e=>{modulePromise=null;throw e;});return modulePromise;}
 function mount(scene,party,{playback,legacyModule}={}){
  if(!scene||!party?.battle)return ()=>{};
  let stopped=false,running=false,active=null,timer=0,releaseWait=null,legacy=null,legacyApi=null;const media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'),b=party.battle,key=String(party.id)+':'+String(b.stageIndex)+':'+String(b.sequence),queue=eligibleEvents(party);
  if(!receipts.has(key))receipts.set(key,new Set());while(receipts.size>24)receipts.delete(receipts.keys().next().value);const seen=receipts.get(key);
  const valid=()=>!stopped&&scene.isConnected&&!document.hidden&&!media?.matches;
  const actorNode=id=>[...scene.querySelectorAll('[data-member-id]')].find(n=>String(n.dataset.memberId)===String(id));
  const targetNodes=()=>{const enemy=scene.querySelector('[data-sr-monster]');return [{id:String(b.enemy?.id||'boss'),node:enemy?.querySelector?.('img')||enemy},...((b.members||party.members)||[]).map(value=>({id:String(value.id),node:actorNode(value.id)?.querySelector('img')}))];};
  function cancelAction(){active?.stop?.();active=null;legacy?.clear('cancelled');clearTimeout(timer);if(releaseWait){releaseWait();releaseWait=null;}}
  function stop(){if(stopped)return;stopped=true;cancelAction();legacy?.destroy();legacy=null;document.removeEventListener('visibilitychange',visibility);media?.removeEventListener?.('change',visibility);}
  function visibility(){if(document.hidden||media?.matches)cancelAction();else void run();}
  const wait=ms=>new Promise(resolve=>{releaseWait=resolve;timer=setTimeout(()=>{releaseWait=null;resolve();},ms);});
  function motion(holder,self,loading=false){if(!holder.animate)return null;try{const a=holder.animate([{translate:'0px 0px'},{translate:self?'0px -5px':'8px -2px',offset:.45},{translate:'0px 0px'}],{duration:loading?1800:650,iterations:loading?Infinity:1,easing:'ease-in-out'});return {stop:()=>a.cancel()};}catch{return null;}}
  async function run(){
   if(running||!valid()||!queue.length)return;running=true;
   try{
   let api;try{api=playback||await load();}catch{api=null;}if(!valid())return;
   if(!legacy&&queue.some(item=>item.event.vfx||item.event.vfxEvents?.length)){
     try{
       legacyApi=legacyModule||await loadLegacy();if(!valid())return;
       legacy=await legacyApi.createLegacyVfxLayer(scene,{mode:'star-ring',contextKey:key,allowProjection:true,isCurrent:valid});
       await legacy?.prepare(queue.flatMap(item=>legacyApi.legacyDescriptors(item.event)));
     }catch{legacy?.destroy();legacy=null;}
     if(!valid())return;
   }
   while(valid()){
   let played=false;
   for(const {event,index,member,effectOnly}of queue){
    if(!valid())return;
    const holder=actorNode(member.id),actor=holder?.querySelector('img'),enemy=scene.querySelector('[data-sr-monster]');if(!holder||!actor||!enemy)continue;
    if(effectOnly){
      if(seen.has(index)||!legacy)continue;
      seen.add(index);
      const receipts=legacyApi.legacyDescriptors(event).filter(raw=>!(raw.targetKind==='enemy'&&b.spawn&&!b.enemy?.id));
      let remaining=0,accepted=0;
      for(const raw of receipts){
        const owner=actorNode(raw.actorId)?.querySelector('img');if(!owner)continue;
        const geometry=legacyApi.legacyDomGeometry(scene,owner,targetNodes(),{actorId:raw.actorId});
        const result=await legacy.play(raw,geometry,{canStart:valid});
        if(result.accepted){remaining=Math.max(remaining,result.remainingMs||0);accepted++;}
      }
      if(accepted){played=true;scene.dataset.effectReceipts=String((Number(scene.dataset.effectReceipts)||0)+accepted);
        scene.dataset.visualMode=receipts.some(raw=>raw.source==='deterministic-projection')?'projection':'confirmed';
        await wait(remaining+50);
      }
      continue;
    }
    const cosmetic=!!event.presentationOnly||!!event.cosmetic||seen.has(index),visualEvent=cosmetic?{...event,vfx:undefined,vfxEvents:[],cosmetic:true,presentationOnly:true,damage:0,healed:0,shielded:0,restoredMp:0}:event;
    const eventVfx=!cosmetic&&legacy?legacyApi.legacyDescriptors(event).filter(raw=>!(raw.targetKind==='enemy'&&b.spawn&&!b.enemy?.id)):[];
    const modern=eventVfx.some(raw=>legacy.timing(raw)),timing=eventVfx.map(raw=>legacy.timing(raw)).filter(Boolean),duration=Math.max(650,...timing.map(value=>300+value.remainingMs));
    // A committed/projection cast can precede death later in the same beat.
    // Only a validated first receipt may replay it; dead actors never join the cosmetic loop.
    const recordedCast=!cosmetic&&eventVfx.some(raw=>raw.kind==='cast'&&raw.actorId===String(member.id)&&legacy.timing(raw));
    if(!alive(member)&&!recordedCast)continue;
    const targetId=event.targetId&&event.actorId!=='boss'?event.targetId:null,target=targetId?actorNode(targetId)?.querySelector('img'):Number(event.healed)>0||event.skillId==='role_aid'||event.skillId==='role_guard'?actor:enemy;
    active=motion(holder,target===actor,true);
    let prepared=true;try{await api?.preparePartyArt([member],[visualEvent],{eventsOnly:true});}catch{prepared=false;}active?.stop?.();active=null;if(!valid()||!actor.isConnected||(!alive(member)&&!recordedCast))return;
    try{active=prepared?api?.startRegistryAction(scene,actor,target||actor,member,visualEvent,{duration,impactAt:300,containedActor:true,effectScale:modern?0:.45,effectOpacity:.8,isCancelled:()=>!valid(),reduced:!!media?.matches}):null;}catch{active=null;}
    if(active)scene.dataset.registryCombat='ready';
    else active=motion(holder,target===actor);
    if(!active)continue;played=true;seen.add(index);scene.dataset.heroActions=String((Number(scene.dataset.heroActions)||0)+1);scene.dataset.visualMode=cosmetic?'presentation':eventVfx.some(raw=>raw.source==='deterministic-projection')?'projection':'confirmed';
    if(modern){
      await wait(300);if(!valid())return;active?.draw?.(300/duration);
      const native=active?.geometry?.(),targets=targetNodes();
      for(const raw of eventVfx){
        const owner=actorNode(raw.actorId)?.querySelector('img');if(!owner)continue;
        const geometry=legacyApi.legacyDomGeometry(scene,owner,targets,{actorId:raw.actorId,
          ...(raw.actorId===String(member.id)?{from:native?.from,foot:native?.foot,bodyHeight:native?.bodyHeight}:{})});
        await legacy.play(raw,geometry,{canStart:valid});
      }
      await wait(duration-300+50);
    }else await wait(700);
    active?.stop?.();active=null;
   }
   if(!played)return;scene.dataset.combatCycles=String((Number(scene.dataset.combatCycles)||0)+1);await wait(650);
   }
   }finally{running=false;}
  }
  document.addEventListener('visibilitychange',visibility);media?.addEventListener?.('change',visibility);void run();return stop;
 }
 globalThis.RpgStarRingHeroes={mount,eligibleEvents};
})();
