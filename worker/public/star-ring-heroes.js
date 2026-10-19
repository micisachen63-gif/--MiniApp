(() => {
 'use strict';
 let modulePromise=null;const receipts=new Map();
 const alive=m=>m&&!m.left&&!(Number(m.maxHp)>0&&Number(m.hp)<=0);
 function eligibleEvents(p){const b=p?.battle;if(!b||['complete','ended'].includes(p.status))return [];const members=b.members||p.members||[];let events=b.events||[];
  // The first beat and hourly arrivals may contain only a system notice.
  // Keep combat poses moving without predicting damage, HP or rewards.
  if(events.every(e=>e.actorId==='system')&&p.status==='running'&&Number(b.enemy?.hp)>0)events=members.filter(alive).map(m=>({actorId:m.id,skillId:'attack',cosmetic:true,presentationOnly:true}));
  return events.map((event,index)=>({event,index,member:members.find(m=>String(m.id)===String(event.actorId))})).filter(x=>x.event.actorId!=='boss'&&typeof x.event.skillId==='string'&&alive(x.member));}
 function load(){if(!modulePromise)modulePromise=import('/expedition/hero-art-playback.js?v=20261019-combat-loop1').catch(e=>{modulePromise=null;throw e;});return modulePromise;}
 function mount(scene,party,{playback}={}){
  if(!scene||!party?.battle)return ()=>{};
  let stopped=false,running=false,active=null,timer=0,releaseWait=null;const media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'),b=party.battle,key=String(party.id)+':'+String(b.stageIndex)+':'+String(b.sequence),queue=eligibleEvents(party);
  if(!receipts.has(key))receipts.set(key,new Set());while(receipts.size>24)receipts.delete(receipts.keys().next().value);const seen=receipts.get(key);
  const valid=()=>!stopped&&scene.isConnected&&!document.hidden&&!media?.matches;
  const actorNode=id=>[...scene.querySelectorAll('[data-member-id]')].find(n=>String(n.dataset.memberId)===String(id));
  function cancelAction(){active?.stop?.();active=null;clearTimeout(timer);if(releaseWait){releaseWait();releaseWait=null;}}
  function stop(){if(stopped)return;stopped=true;cancelAction();document.removeEventListener('visibilitychange',visibility);media?.removeEventListener?.('change',visibility);}
  function visibility(){if(document.hidden||media?.matches)cancelAction();else void run();}
  const wait=ms=>new Promise(resolve=>{releaseWait=resolve;timer=setTimeout(()=>{releaseWait=null;resolve();},ms);});
  function motion(holder,self,loading=false){if(!holder.animate)return null;try{const a=holder.animate([{translate:'0px 0px'},{translate:self?'0px -5px':'8px -2px',offset:.45},{translate:'0px 0px'}],{duration:loading?1800:650,iterations:loading?Infinity:1,easing:'ease-in-out'});return {stop:()=>a.cancel()};}catch{return null;}}
  async function run(){
   if(running||!valid()||!queue.length)return;running=true;
   try{
   let api;try{api=playback||await load();}catch{api=null;}if(!valid())return;
   while(valid()){
   let played=false;
   for(const {event,index,member}of queue){
    if(!valid())return;
    const holder=actorNode(member.id),actor=holder?.querySelector('img'),enemy=scene.querySelector('[data-sr-monster]');if(!holder||!actor||!enemy)continue;
    const cosmetic=!!event.presentationOnly||seen.has(index),visualEvent=cosmetic?{...event,cosmetic:true,presentationOnly:true,damage:0,healed:0,shielded:0,restoredMp:0}:event;
    const targetId=event.targetId&&event.actorId!=='boss'?event.targetId:null,target=targetId?actorNode(targetId)?.querySelector('img'):Number(event.healed)>0||event.skillId==='role_aid'||event.skillId==='role_guard'?actor:enemy;
    active=motion(holder,target===actor,true);
    let prepared=true;try{await api?.preparePartyArt([member],[visualEvent],{eventsOnly:true});}catch{prepared=false;}active?.stop?.();active=null;if(!valid()||!actor.isConnected||!alive(member))return;
    try{active=prepared?api?.startRegistryAction(scene,actor,target||actor,member,visualEvent,{duration:650,impactAt:300,containedActor:true,effectScale:.45,effectOpacity:.8,isCancelled:()=>!valid(),reduced:!!media?.matches}):null;}catch{active=null;}
    if(active)scene.dataset.registryCombat='ready';
    else active=motion(holder,target===actor);
    if(!active)continue;played=true;seen.add(index);scene.dataset.heroActions=String((Number(scene.dataset.heroActions)||0)+1);scene.dataset.visualMode=cosmetic?'presentation':'confirmed';
    await wait(700);active?.stop?.();active=null;
   }
   if(!played)return;scene.dataset.combatCycles=String((Number(scene.dataset.combatCycles)||0)+1);await wait(650);
   }
   }finally{running=false;}
  }
  document.addEventListener('visibilitychange',visibility);media?.addEventListener?.('change',visibility);void run();return stop;
 }
 globalThis.RpgStarRingHeroes={mount,eligibleEvents};
})();
