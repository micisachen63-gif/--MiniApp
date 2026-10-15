import {SKILL_MAP,MECHANICS,eligible,specialState,validateCast,skillCoefficient,receiveDamage} from './special.js';

export const ROLE_NAMES={guard:'守護',heal:'治療',interrupt:'打斷',cleanse:'淨化',break:'破盾',area:'清怪',burst:'爆發',damage:'輸出'};
export const RAID_PROFILES={
 titan:{name:'泰坦的誓約',hp:180,roles:['guard','heal','burst'],phases:['guard','heal','burst'],copy:'接住鎖魂重擊，再用治療穩住隊伍，把握破綻反攻。'},
 oracle:{name:'神諭的試問',hp:210,roles:['interrupt','cleanse','break'],phases:['interrupt','cleanse','break'],copy:'中斷滅團詠唱、驅散侵蝕，再以破盾技能擊碎結界。'},
 stars:{name:'星穹的終章',hp:240,roles:['guard','heal','area'],phases:['guard','heal','adds','burst'],copy:'守住被點名的夥伴、恢復重傷，依路線清除星靈或擊破裂隙。'}
};
export const skillTargets=s=>Number(String(s?.damage||'').match(/最多\s*(\d+)\s*敵/)?.[1]||1);
export function abilityKeys(skill){const m=MECHANICS[skill?.id]||{};return [
 m.guard&&'guard',(m.heal||m.healDamage)&&'heal',m.interrupt&&'interrupt',m.cleanse&&'cleanse',
 (m.shieldBonus||m.penetrate||m.breakDef)&&'break',skillTargets(skill)>=3&&'area',skillCoefficient(skill)>=3.3&&'burst'
 ].filter(Boolean);}
export function actorCapabilities(a){
 const c={base_class:a.base??a.base_class,class_path:a.path??a.class_path,level:a.level},x=a.special||specialState(a);
 const skills=(x.loadout||[]).filter(id=>x.learned?.includes(id)&&eligible(c,SKILL_MAP[id])).map(id=>SKILL_MAP[id]);
 const keys=new Set(['damage',...skills.flatMap(abilityKeys)]);
 if(a.skill?.targets>=3)keys.add('area');if(a.skill?.mult>=3.3)keys.add('burst');
 return {keys:[...keys],skills:skills.map(s=>({id:s.id,name:s.name,abilities:abilityKeys(s)}))};
}
export const raidProfile=(id,approach='sweep')=>{const p=RAID_PROFILES[id];if(!p)return null;return id==='stars'&&approach==='burst'?{...p,roles:['guard','heal','burst'],extra:['break'],phases:['guard','heal','break','burst']}:p;};
export function coverage(actors,id,approach='sweep'){
 const p=raidProfile(id,approach);if(!p)return null;
 const caps=actors.map(a=>({id:a.id??a.tg_id,name:a.name,...actorCapabilities(a)}));let best=[];
 function assign(i,used,slots){if(slots.filter(s=>s.actorId).length>best.filter(s=>s.actorId).length)best=slots.slice();if(i===p.roles.length)return;
  const key=p.roles[i];for(const a of caps.filter(a=>!used.has(a.id)&&a.keys.includes(key)))assign(i+1,new Set([...used,a.id]),[...slots,{key,name:ROLE_NAMES[key],actorId:a.id,actorName:a.name}]);
  assign(i+1,used,[...slots,{key,name:ROLE_NAMES[key],actorId:null}]);
 }assign(0,new Set(),[]);
 const slots=p.roles.map((key,i)=>best[i]||{key,name:ROLE_NAMES[key],actorId:null}),missing=slots.filter(s=>!s.actorId).map(s=>s.name);
 for(const key of p.extra||[])if(!caps.some(a=>a.keys.includes(key)))missing.push(ROLE_NAMES[key]);
 return {name:p.name,copy:p.copy,approach,slots,missing,ready:actors.length===3&&!missing.length,members:caps,intervalMs:12000};
}
export const activeRaid=s=>s.roleRules===1&&!!RAID_PROFILES[s.dungeonId];
const alive=s=>s.actors.filter(a=>a.hp>0);
const holder=(s,key)=>s.formation?.slots.find(x=>x.key===key)?.actorId;
const low=s=>alive(s).slice().sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];
const TITLES={guard:'鎖魂重擊',heal:'裂地餘傷',interrupt:'神諭終咒',cleanse:'侵蝕印記',break:'不滅結界',adds:'星靈降臨',burst:'星核破綻'};
export function initRaid(s){
 s.tactics={phase:0,failures:0,completed:[],current:null};
 for(const a of s.actors)a.contribution={damage:0,healing:0,shielding:0,guarded:0,taken:0,interrupts:0,cleanses:0,mechanics:0};
 prepareRaidPhase(s);
}
export function prepareRaidPhase(s){
 const p=raidProfile(s.dungeonId,s.approach),t=s.tactics;if(!p||!t||t.current||t.phase>=p.phases.length)return;
 const kind=p.phases[t.phase],target=alive(s).filter(a=>a.id!==holder(s,'guard')).sort((a,b)=>a.def-b.def)[0]||low(s);
 t.current={kind,name:TITLES[kind],startedRound:s.round,resolveRound:s.round+1,targetId:target?.id,healed:0,cleansed:0,interrupted:false,breaker:false,burst:false};
 s.enemy.phaseFloorHp=Math.max(1,Math.floor(s.enemy.maxHp*(1-(t.phase+1)/p.phases.length)));
 s.enemy.breakOnly=kind==='break';s.enemy.shield=kind==='break'?s.level*10:0;
 s.enemy.adds=kind==='adds'?{hp:s.level*12,maxHp:s.level*12,count:3}:null;
 if(kind==='heal'||kind==='cleanse')for(const a of alive(s)){
  // Actual wound, recorded in the prior turn's final snapshot (or initial encounter state).
  a.hp=Math.max(1,a.hp-Math.ceil(a.maxHp*.22));
  a.debuffs??=[];a.debuffs.push({type:kind==='heal'?'raid-wound':'raid-curse',phase:t.phase});
 }
}
export function raidForecast(s){
 if(!activeRaid(s)||!s.tactics)return null;const t=s.tactics,c=t.current;
 if(!c)return {name:'破綻已掌握',copy:'所有機制已完成，全力擊敗首領。',complete:true,completed:t.completed,failures:t.failures};
 const target=s.actors.find(a=>a.id===c.targetId),copy={
 guard:`${target?.name||'隊友'}被點名；請用守護分攤，接下下一回合重擊。`,
 heal:`餘傷已造成實際損血；請用治療技能恢復至少 ${Math.ceil(s.level*1.2)} HP。`,
 interrupt:'首領正在詠唱；請在下一回合結算前施放打斷。',
 cleanse:'全隊染上侵蝕；請用淨化技能解除至少一枚印記。',
 break:'結界抵擋普通攻擊；請用破盾、穿透或破甲技能擊碎護盾。',
 adds:'三隻星靈守住首領；請用至少三目標的範圍技能清除。',
 burst:'破綻已顯現；請施放高倍率技能，或打出一次原生技能爆擊。'
 }[c.kind];
 return {...c,copy,targetName:target?.name,roundsLeft:Math.max(0,c.resolveRound-s.round),phase:t.phase+1,total:raidProfile(s.dungeonId,s.approach).phases.length,failures:t.failures,
 shield:s.enemy.shield||0,adds:s.enemy.adds,completed:t.completed};
}
export function raidAutoAction(a,s,now){
 const c=s.tactics?.current;if(!c)return null;
 const wanted={guard:'guard',heal:'heal',interrupt:'interrupt',cleanse:'cleanse',break:'break',adds:'area',burst:'burst'}[c.kind];
 const choices=[];for(const id of a.special?.loadout||[]){let skill;try{skill=validateCast({base_class:a.base,class_path:a.path,level:a.level,mp:a.mp,affixPct:a.affixPct},a.special,id,now)}catch{continue;}
  if(abilityKeys(skill).includes(wanted))choices.push(skill);
 }
 if(c.kind==='guard'&&a.guard?.target===c.targetId&&a.guard.until>now)return {skillId:'attack',targetId:a.id};
 if(c.kind==='interrupt'&&c.interrupted||c.kind==='cleanse'&&c.cleansed>0||c.kind==='heal'&&c.healed>=Math.ceil(s.level*1.2)||c.kind==='burst'&&c.burst)return {skillId:'attack',targetId:a.id};
 if(choices.length){const skill=choices[0];return {skillId:skill.id,targetId:c.kind==='guard'?c.targetId:c.kind==='heal'?low(s)?.id:a.id};}
 // Hold vital support/interrupt cooldowns for their announced mechanic. Native attacks remain available.
 return {skillId:'attack',targetId:a.id};
}
export function recordRaidAction(s,a,action,result){
 const x=a.contribution??={damage:0,healing:0,shielding:0,guarded:0,taken:0,interrupts:0,cleanses:0,mechanics:0};
 x.damage+=(result.damage||0)+(result.addDamage||0);x.healing+=result.healed||0;x.cleanses+=result.cleansed||0;
 if(!s.tactics?.current)return;
 const c=s.tactics.current,m=MECHANICS[action.skillId]||{},skill=SKILL_MAP[action.skillId];
 if(c.kind==='heal'&&(m.heal||m.healDamage))c.healed+=Math.max(0,(result.healed||0)-(result.selfHealed||0));
 if(c.kind==='cleanse')c.cleansed+=result.cleansed||0;
 if(c.kind==='interrupt'&&m.interrupt&&s.enemy.interrupted&&!c.interrupted){c.interrupted=true;x.interrupts++;}
 if(c.kind==='break'&&(m.shieldBonus||m.penetrate||m.breakDef))c.breaker=true;
 if(c.kind==='burst'&&(skill&&skillCoefficient(skill)>=3.3||result.nativeSkill&&(a.skill?.mult>=3.3||result.crit)))c.burst=true;
}
export function resolveRaid(s,now){
 const c=s.tactics.current;if(!c||s.round<c.resolveRound)return null;
 const guard=alive(s).find(a=>a.id!==c.targetId&&a.guard?.target===c.targetId&&a.guard.until>now);
 const success={guard:!!guard,heal:c.healed>=Math.ceil(s.level*1.2),interrupt:c.interrupted,cleanse:c.cleansed>0,
  break:c.breaker&&s.enemy.shield<=0,adds:!s.enemy.adds?.hp,burst:c.burst}[c.kind];
 const hits=[];const hit=(a,raw)=>{const damage=receiveDamage(a,raw,s.actors,s.enemy,now);hits.push({id:a.id,damage});};
 if(c.kind==='guard'&&s.actors.find(a=>a.id===c.targetId)?.hp>0)hit(s.actors.find(a=>a.id===c.targetId),s.level*18);
 if(success){s.tactics.completed.push(c.name);for(const a of alive(s))a.contribution.mechanics++;
  s.tactics.phase++;s.enemy.shield=0;s.enemy.adds=null;s.enemy.breakOnly=false;s.tactics.current=null;
  if(s.tactics.phase>=raidProfile(s.dungeonId,s.approach).phases.length)s.enemy.phaseFloorHp=0;
 }else{
  s.tactics.failures++;for(const a of alive(s))hit(a,s.level*10*(1+.35*(s.tactics.failures-1)));
  s.tactics.current=null; // A failed check retries the same phase; no indefinite stuck room.
 }
 return {name:c.name,success,hits,failedRun:s.tactics.failures>=3};
}
