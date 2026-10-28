import {dungeonTheme} from './dungeon-art.js?v=20261012-tower-roster1';
import {preparePartyArt,startRegistryAction} from './hero-art-playback.js?v=20261028-visible-body1';

const sessions=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const finite=Number.isFinite;
function session(id){
 if(!sessions.has(id)){
  sessions.set(id,{cursor:null,sequence:0,rev:-1,latest:null});
  if(sessions.size>20)sessions.delete(sessions.keys().next().value);
 }
 return sessions.get(id);
}
export const combatCursor=id=>sessions.get(id)?.cursor||null;
function turnsFor(p,s){
 const turns=(p.battleTurns||[p.battleTurn]).filter(Boolean);
 const latest=turns.at(-1)||p.battleTurn;
 if(latest&&(!finite(latest.before?.enemyMaxHp)||!latest.before?.members?.every(a=>finite(a.mp)&&finite(a.maxMp)))){
  // Old stored rounds cannot reconstruct mana or a different floor's enemy safely.
  s.cursor=latest.id;s.sequence=latest.sequence||s.sequence;s.synced=true;
  return [];
 }
 if(p.battleSync?.hasGap){
  s.cursor=p.battleSync.latestTurnId||p.battleTurn?.id||s.cursor;
  s.sequence=p.battleTurn?.sequence||s.sequence;
  s.synced=true;
  return [];
 }
 if(!s.cursor)return turns.slice(-1); // Joining a battle shows its latest resolved round.
 const index=turns.findIndex(t=>t.id===s.cursor);
 return (index>=0?turns.slice(index+1):turns).filter(t=>t.id!==s.cursor&&(!t.sequence||t.sequence>s.sequence));
}
function viewAt(p,snapshot,turn){
 if(!snapshot)return p;
 return {...p,floor:snapshot.floor??turn?.floor??p.floor,round:turn?.round??p.round,
  enemy:p.enemy?{...p.enemy,hp:snapshot.enemyHp,maxHp:snapshot.enemyMaxHp||p.enemy.maxHp,name:snapshot.enemyName||p.enemy.name}:null,
  members:p.members.map(m=>({...m,...snapshot.members?.find(a=>String(a.id)===String(m.id))}))};
}
// Called before HTML is inserted, so final 生命值 never flashes before a replay rewinds it.
export function combatView(p){
 preparePartyArt(p.members,(p.battleTurns||[p.battleTurn]).filter(Boolean).flatMap(t=>t.events||[]));
 const s=session(p.id);
 if(finite(p.rev)&&p.rev<s.rev)return s.latest||p;
 s.rev=p.rev??s.rev;s.latest=p;
 const next=turnsFor(p,s)[0];
 return next?viewAt(p,next.before,next):p;
}
function effect(scene,from,to,kind){
 const a=from.getBoundingClientRect(),b=to.getBoundingClientRect(),r=scene.getBoundingClientRect(),el=document.createElement('i');
 el.className='combat-projectile '+kind;
 el.style.cssText='left:'+(a.x+a.width/2-r.x)+'px;top:'+(a.y+a.height*.45-r.y)+'px;--tx:'+(b.x+b.width/2-a.x-a.width/2)+'px;--ty:'+(b.y+b.height*.45-a.y-a.height*.45)+'px';
 scene.append(el);setTimeout(()=>el.remove(),850);
}
function number(scene,target,value,heal=false){
 if(!value)return;
 const a=target.getBoundingClientRect(),r=scene.getBoundingClientRect(),el=document.createElement('b');
 el.className='combat-number'+(heal?' heal':'');el.textContent=(heal?'+':'−')+Math.abs(value);
 el.style.cssText='left:'+(a.x+a.width/2-r.x)+'px;top:'+(a.y-r.y+10)+'px';
 scene.append(el);setTimeout(()=>el.remove(),1100);
}
function applySnapshot(scene,p,snapshot,round=p.round){
 if(!snapshot)return;
 const frame=viewAt(p,snapshot,{round}),art=dungeonTheme(frame),floor=frame.floor;
 if(scene.dataset.combatFloor!==String(floor)){
  scene.dataset.combatFloor=String(floor);
  const bg=scene.querySelector('.scene-bg'),boss=scene.querySelector('.scene-boss');
  if(bg)bg.src='/'+art.background;
  if(boss){boss.src='/'+art.boss;boss.style.setProperty('--boss-accent',art.accent);}
 }
 const floorLabel=scene.querySelector('.scene-floor');
 if(floorLabel)floorLabel.textContent=(p.kind==='tower'?`第 ${floor} 層 · ${art.rank==='boss'?'首領':'小怪'}`:'三人職業秘藏')+` · 第 ${round}／${p.roundLimit||40} 回合`;
 const maximum=snapshot.enemyMaxHp||p.enemy?.maxHp,hp=snapshot.enemyHp;
 if(finite(hp)&&maximum){
  const percent=Math.max(0,Math.min(100,Math.round(hp/maximum*100))),bar=scene.querySelector('.boss-meter .meter i'),text=scene.querySelector('.boss-meter small');
  if(bar)bar.style.width=percent+'%';
  if(text)text.textContent=`${snapshot.enemyName||art.name} · 生命值 ${hp}／${maximum}（${percent}%）`;
 }
 const layout=scene.closest('.party-layout');
 for(const a of snapshot.members||[]){
  const member=[...layout?.querySelectorAll('.members [data-member-id]')||[]].find(el=>el.dataset.memberId===String(a.id));
  const hero=[...scene.querySelectorAll('.scene-hero')].find(el=>el.dataset.memberId===String(a.id));
  if(hero)hero.classList.toggle('combat-down',a.hp<=0);
  if(member){
   const hpText=member.querySelector('[data-member-hp]'),mpText=member.querySelector('[data-member-mp]');
   if(hpText)hpText.textContent=`生命值 ${a.hp}／${a.maxHp}${a.hp<=0?' · 倒地':''}`;
   if(mpText&&finite(a.mp))mpText.textContent=`魔力 ${a.mp}／${a.maxMp}`;
  }
 }
}
function impact(scene,p,before,after,round=p.round){
 const boss=scene.querySelector('.scene-boss');
 if(boss&&finite(before?.enemyHp)&&finite(after?.enemyHp)&&before.enemyHp!==after.enemyHp){
  const delta=after.enemyHp-before.enemyHp;boss.classList.add('combat-hit');number(scene,boss,delta,delta>0);
 }
 const heroes=[...scene.querySelectorAll('.scene-hero')];
 for(const a of after?.members||[]){
  const old=before?.members?.find(x=>String(x.id)===String(a.id)),target=heroes.find(el=>el.dataset.memberId===String(a.id));
  if(old&&target&&old.hp!==a.hp){const delta=a.hp-old.hp;target.classList.add('combat-hit');number(scene,target,delta,delta>0);}
 }
 applySnapshot(scene,p,after,round);
}
// A replay may split only the exact strike 生命值 transitions already settled by the server.
// 魔力/healing/final buffs stay on the one authoritative action snapshot.
export function combatStrikeSteps(event,before){
 const fallback=[event.after],strikes=event.strikes;
 if(event.base!=='thief'||event.skillId!=='attack'||!Array.isArray(strikes)||!strikes.length||strikes.length>3||!finite(before?.enemyHp)||!finite(event.after?.enemyHp))return fallback;
 let hp=before.enemyHp,total=0;
 for(const strike of strikes){if(!finite(strike.damage)||strike.damage<0||strike.beforeHp!==hp||!finite(strike.afterHp)||hp-strike.afterHp!==strike.damage)return fallback;total+=strike.damage;hp=strike.afterHp;}
 if(total!==event.damage||hp!==event.after.enemyHp)return fallback;
 return strikes.map((strike,index)=>index===strikes.length-1?event.after:{...before,enemyHp:strike.afterHp});
}
export async function playCombat(scene,p){
 if(!scene)return;
 const artWarm=preparePartyArt(p.members,(p.battleTurns||[p.battleTurn]).filter(Boolean).flatMap(t=>t.events||[]));
 const s=session(p.id),turns=turnsFor(p,s),boss=scene.querySelector('.scene-boss');
 if(!boss||!turns.length){
  if(s.synced){s.synced=false;scene.dataset.combatSync='已同步最新戰況';}
  return;
 }
 const heroes=[...scene.querySelectorAll('.scene-hero')],label=document.createElement('span');
 label.className='combat-label';scene.append(label);
 const fast=turns.length>1||reduced(),windup=fast?60:240,pause=fast?85:280;
 const cancelled=()=>{
  if(scene.isConnected&&!document.hidden)return false;
  // Hidden pages catch up to a snapshot instead of replaying an already impacted hit.
  s.cursor=p.battleTurn?.id||turns.at(-1)?.id||s.cursor;s.sequence=p.battleTurn?.sequence||turns.at(-1)?.sequence||s.sequence;
  applySnapshot(scene,p,{floor:p.floor,enemyHp:p.enemy?.hp,enemyMaxHp:p.enemy?.maxHp,enemyName:p.enemy?.name,members:p.members},p.round);
  return true;
 };
 let artAction=null;
 try{
  if(!fast)await artWarm;
  for(const turn of turns){
   if(cancelled())return;
   scene.dataset.playingTurn=turn.id;applySnapshot(scene,p,turn.before,turn.round);
   let previous=turn.before;
   for(const event of turn.events||[]){
    if(cancelled())return;
    label.textContent=event.label||'回合結算';
    const actor=event.actorId==='boss'?boss:heroes.find(el=>el.dataset.memberId===String(event.actorId));
    const member=p.members.find(m=>String(m.id)===String(event.actorId));
    const offensive=event.skillId==='attack'||Number(event.damage)>0||event.after?.enemyHp<previous?.enemyHp;
    const steps=combatStrikeSteps(event,previous),cycleWindup=windup/steps.length,cyclePause=pause/steps.length;
    for(let strikeIndex=0;strikeIndex<steps.length;strikeIndex++){
     if(cancelled())return;
     const after=steps[strikeIndex],strikeEvent={...event,strikeIndex,strikeCount:steps.length};
     if(actor&&actor!==boss&&!fast&&offensive)artAction=startRegistryAction(scene,actor,boss,member,strikeEvent,{duration:cycleWindup+cyclePause,impactAt:cycleWindup,isCancelled:cancelled});
     if(actor&&!artAction)actor.classList.add(event.skillId==='defend'?'combat-guard':'combat-strike');
     if(actor&&actor!==boss&&after?.enemyHp<previous?.enemyHp&&!fast&&!artAction?.hasFx)effect(scene,actor,boss,event.base==='archer'?'arrow':event.base==='mage'?'magic':'slash');
     await sleep(cycleWindup);if(cancelled())return;
     // Each cycle traverses the complete native sequence, including its authored recovery.
     artAction?.draw(cycleWindup/(cycleWindup+cyclePause));
     impact(scene,p,previous,after,turn.round);previous=after||previous;
     await sleep(cyclePause);if(event.base==='thief')artAction?.draw(1);artAction?.stop();artAction=null;[boss,...heroes].forEach(el=>el.classList.remove('combat-strike','combat-hit','combat-guard'));
    }
   }
   if(cancelled())return;
   // Mana recovery and floor-clear recovery are real server deltas as well.
   label.textContent=turn.final?.floor!==turn.floor?'本層通關 · 整隊前進':'回合回復';
   impact(scene,p,previous,turn.after,turn.round);
   applySnapshot(scene,p,turn.final||turn.after,turn.final?.floor!==turn.floor?1:turn.round);
   s.cursor=turn.id;s.sequence=turn.sequence||s.sequence;
  }
  applySnapshot(scene,p,{floor:p.floor,enemyHp:p.enemy?.hp,enemyMaxHp:p.enemy?.maxHp,enemyName:p.enemy?.name,members:p.members},p.round);
 }finally{
  artAction?.stop();
  label.remove();scene.dataset.playingTurn='';
  [boss,...heroes].forEach(el=>el.classList.remove('combat-strike','combat-hit','combat-guard'));
 }
}
