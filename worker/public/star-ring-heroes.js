(() => {
 'use strict';
 let modulePromise=null;const receipts=new Map();
 const alive=m=>m&&!m.left&&!(Number(m.maxHp)>0&&Number(m.hp)<=0);
 function eligibleEvents(p){const b=p?.battle;if(!b||['complete','ended'].includes(p.status))return [];const members=b.members||p.members||[];return (b.events||[]).map((event,index)=>({event,index,member:members.find(m=>String(m.id)===String(event.actorId))})).filter(x=>x.event.actorId!=='boss'&&typeof x.event.skillId==='string'&&alive(x.member));}
 function load(){if(!modulePromise)modulePromise=import('/expedition/hero-art-playback.js?v=20261018-star-ring1').catch(e=>{modulePromise=null;throw e;});return modulePromise;}
 function mount(scene,party,{playback}={}){
  if(!scene||!party?.battle)return ()=>{};
  let stopped=false,active=null,timer=0,releaseWait=null;const media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'),b=party.battle,key=String(party.id)+':'+String(b.stageIndex)+':'+String(b.sequence),queue=eligibleEvents(party);
  if(!receipts.has(key))receipts.set(key,new Set());while(receipts.size>24)receipts.delete(receipts.keys().next().value);const seen=receipts.get(key);
  const valid=()=>!stopped&&scene.isConnected&&!document.hidden&&!media?.matches;
  const actorNode=id=>[...scene.querySelectorAll('[data-member-id]')].find(n=>String(n.dataset.memberId)===String(id));
  function cancelAction(){active?.stop?.();active=null;clearTimeout(timer);if(releaseWait){releaseWait();releaseWait=null;}}
  function stop(){if(stopped)return;stopped=true;cancelAction();document.removeEventListener('visibilitychange',visibility);media?.removeEventListener?.('change',visibility);}
  function visibility(){if(document.hidden||media?.matches)cancelAction();}
  async function run(){
   if(!valid())return;
   let api;try{api=playback||await load();}catch{return;}if(!valid())return;
   for(const {event,index,member}of queue){
    if(!valid())return;if(seen.has(index))continue;
    const holder=actorNode(member.id),actor=holder?.querySelector('img'),enemy=scene.querySelector('[data-sr-monster]');if(!holder||!actor||!enemy)continue;
    try{await api.preparePartyArt([member],[event]);}catch{continue;}if(!valid()||!actor.isConnected||!alive(member))return;
    const targetId=event.targetId&&event.actorId!=='boss'?event.targetId:null,target=targetId?actorNode(targetId)?.querySelector('img'):Number(event.healed)>0||event.skillId==='role_aid'||event.skillId==='role_guard'?actor:enemy;
    try{active=api.startRegistryAction(scene,actor,target||actor,member,event,{duration:650,impactAt:300,containedActor:true,effectScale:.45,effectOpacity:.8,isCancelled:()=>!valid(),reduced:!!media?.matches});}catch{active=null;}
    if(!active)continue;seen.add(index);scene.dataset.registryCombat='ready';
    await new Promise(resolve=>{releaseWait=resolve;timer=setTimeout(()=>{releaseWait=null;resolve();},700);});active?.stop?.();active=null;
   }
  }
  document.addEventListener('visibilitychange',visibility);media?.addEventListener?.('change',visibility);void run();return stop;
 }
 globalThis.RpgStarRingHeroes={mount,eligibleEvents};
})();
