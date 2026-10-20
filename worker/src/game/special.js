import {masteredSkill,masteredMechanics,outputMultiplier,utilityMultiplier} from './skill-mastery.js';
import {THIEF_MECHANICS,addThiefPoison,armThiefCounter,triggerThiefCounter,nextThiefStrikeCount,thiefPrimaryMechanics,applyThiefPrimary} from './thief-skills.js';
import {elementalDamage} from './elements.js';
import {guardianDamageMultiplier} from './guardian-effects.js';
import {equippedAura} from './star-ring-cosmetics.js';
import { SPECIAL_SKILLS } from './special-data.js';
import { GameError } from './classes.js';
import {combatPct,takenMultiplier,specialCost,spendMana,restoreOnAction} from './combat-passives.js';
export { SPECIAL_SKILLS };
export const SKILL_MAP = Object.fromEntries(SPECIAL_SKILLS.map(s => [s.id,s]));
const first = ['狂戰士','騎士','遊俠','德魯伊','元素法師','秘術師'];
const second = ['血怒戰神','劍聖','聖騎士','鐵壁守衛','逐風神射','蒼穹風舞','森靈馭獸','月影獵使','大魔導士','冰霜術士','時空術士','召喚師'];
export const baseOf = s => s.eligibleBase||({技術書:'sword',精靈水晶:'archer',魔法書:'mage'})[s.bookType];
export function eligible(c,s) {
 if(!s || c.base_class!==baseOf(s) || c.level<s.level || String(c.class_path||'').length<s.advancementTier)return false;
 const p=String(c.class_path||'');
 if(s.eligiblePaths)return s.eligiblePaths.some(path=>p.startsWith(path));
 if(s.advancementTier===1)return (Number(s.id.split("_")[1])-1)%2===(p[0]==='A'?0:1);
 if(s.advancementTier===2)return (Number(s.id.split("_")[1])-7)%4===(['A1','A2','B1','B2'].indexOf(p.slice(0,2)));
 return true;
}
export function specialState(c){let x;try{x=JSON.parse(c.special_json||'{}')}catch{x={}}return {learned:[],loadout:[],auto:{},cooldowns:{},mode:'safe',budget:0,towerBest:0,...x};}
export const saveSpecial=(c,x)=>{c.special_json=JSON.stringify(x);};
export function validateCast(c,x,id,now,{equipped=true,catalog=SKILL_MAP}={}){
 const base=catalog[id];const s=base?specialCost(masteredSkill(base,x),combatPct(c)):base;if(!eligible(c,s)||!x.learned.includes(id)||(equipped&&!x.loadout.includes(id)))throw new GameError('skill','尚未學會或未裝備此職業技能');
 if((x.cooldowns[id]||0)>now)throw new GameError('cooldown','技能仍在冷卻中');
 if(c.mp<s.mp)throw new GameError('mp','魔力不足');return s;
}
// Numerical definitions are explicit; combat never interprets translated prose.
const mechanics = {
 ...THIEF_MECHANICS,
 skill_01_1:{breakDef:.15},skill_01_2:{atkUp:.2,takenUp:.1},skill_01_3:{execute:.3,executeBonus:.25},
 skill_02_1:{interrupt:true},skill_02_2:{guard:.4,reduce:.15},skill_02_3:{shield:1.6,reflect:1.4},
 skill_03_1:{penetrate:.2},skill_03_2:{enemyNextReduce:.1,addsOnly:true},skill_03_3:{nextDamage:.2,nextReduce:.15,target:true},
 skill_04_1:{mark:.08},skill_04_2:{heal:2.4,target:true},skill_04_3:{interrupt:true,uninterruptBonus:.1},
 skill_05_1:{dot:.25,dotCount:2},skill_05_2:{enemyNextReduce:.15,interrupt:true},skill_05_3:{shieldBonus:.4},
 skill_06_1:{penetrate:.15},skill_06_2:{shield:2,target:true},skill_06_3:{echo:.2},
 skill_07_1:{leech:.08,leechCap:.12},skill_07_2:{lastStand:true},skill_08_1:{coefficient:3.75},skill_08_2:{penetrate:.3},
 skill_09_1:{heal:1.4,lowest:true},skill_09_2:{shield:1.2,all:true,cleanse:true},skill_10_1:{guard:.5,reduce:.2},skill_10_2:{breakDef:.2},
 skill_11_1:{penetrate:.25},skill_11_2:{critUp:.2,critUses:2,duration:90},skill_12_1:{},skill_12_2:{nextReduce:.2,all:true},
 skill_13_1:{healDamage:.15,healCap:.1,lowest:true},skill_13_2:{heal:1.6,all:true,cleanse:true},
 skill_14_1:{breakDef:.15},skill_14_2:{interrupt:true},skill_15_1:{dot:.3,dotCount:2},skill_15_2:{shieldBonus:.5},
 skill_16_1:{enemyNextReduce:.15},skill_16_2:{shield:2.6,shieldSlow:.1,target:true},
 skill_17_1:{interrupt:true,uninterruptBonus:.1},skill_17_2:{accelerate:true,target:true},
 skill_18_1:{coefficient:0,summon:1.1,summonCount:3},skill_18_2:{nextReduce:.35,target:true},
 skill_19_1:{breakDef:.2},skill_19_2:{damageUp:.1,reduce:.1,all:true},skill_20_1:{interrupt:true},skill_20_2:{heal:2.4,all:true,cleanse:true},
 skill_21_1:{shieldBonus:.5},skill_21_2:{shield:1.8,reduce:.1,all:true},
 skill_22_1:{penetrate:.2,execute:.25,executeBonus:.2},skill_22_2:{shield:2,nextReduce:.2,all:true},
 skill_23_1:{coefficient:5.7,mark:.1},skill_23_2:{heal:3,all:true,overflow:.5,overflowCap:1},
 skill_24_1:{singleCoefficient:6,shieldBonus:.3},skill_24_2:{revive:true,target:true},
};
export const MECHANICS=mechanics;
export function skillCoefficient(s){return (mechanics[s.id]?.coefficient??Number(s.damage.match(/([\d.]+)A/)?.[1]||0))*outputMultiplier(s);}
const buff=(a,type,value,now,seconds=60,uses=null)=>{a.buffs??=[];a.buffs=a.buffs.filter(b=>b.type!==type);a.buffs.push({type,value,until:now+seconds*1000,uses});};
export function valueOf(a,type,now){return (a.buffs||[]).filter(b=>b.type===type&&b.until>now&&(b.uses==null||b.uses>0)).reduce((n,b)=>Math.max(n,b.value),0);}
const consume=(a,type)=>{for(const b of a.buffs||[])if(b.type===type&&b.uses!=null)b.uses--;};
const lowest=team=>team.filter(a=>a.hp>0).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];
export function damageEnemy(enemy,raw,m,now,actor=null){
 raw=actor?elementalDamage(raw*guardianDamageMultiplier(actor),actor,enemy):raw;
 if(enemy.combatant){return receiveDamage(enemy,raw*(enemy.damageScale??1)*(1+valueOf(enemy,'mark',now)),[enemy],actor||{},now,{elementApplied:true,defMultiplier:(1-valueOf(enemy,'breakDef',now))*(1-(m.penetrate||0)),shieldBonus:m.shieldBonus||0});}
 const def=enemy.def*(1-valueOf(enemy,'breakDef',now))*(1-(m.penetrate||0));
 let amount=Math.max(1,Math.round(raw*100/(100+Math.max(0,def))*(1+valueOf(enemy,'mark',now))));
 let shield=enemy.shield||0;if(shield){const absorbed=Math.min(shield,amount*(1+(m.shieldBonus||0)));enemy.shield-=absorbed;amount=Math.max(0,amount-absorbed/(1+(m.shieldBonus||0)));}
 const dealt=Math.min(enemy.hp,Math.round(amount),enemy.damageBudget??Infinity);enemy.hp-=dealt;if(enemy.damageBudget!=null)enemy.damageBudget-=dealt;return dealt;
}
// A native action pays mana once in its adapter, then resolves genuinely independent strikes.
// Special books do not call this scheduler. No extra polling, SQL, rewards or player requests.
export function performThiefNativeStrikes(actor,enemy,now,{cast=true,baseRaw,rng=()=>.5,critMultiplier=1.5,variance=false,actionId=null}={}){
 const count=nextThiefStrikeCount(actor),strikes=[];let damage=0;
 for(let index=0;index<count&&actor.hp>0&&enemy.hp>0&&(enemy.damageBudget??Infinity)>0;index++){
  const crit=rng()<Math.min(.8,(actor.crit||.05)+valueOf(actor,'critUp',now)),m=thiefPrimaryMechanics(actor,enemy,now,{cast});
  let raw=baseRaw*(1+valueOf(actor,'atkUp',now))*(1+valueOf(actor,'damageUp',now))*(1+valueOf(actor,'nextDamage',now))*(1-valueOf(actor,'enemyNextReduce',now));
  if(crit)raw*=critMultiplier;if(variance)raw*=.9+rng()*.2;
  const beforeHp=enemy.hp,dealt=damageEnemy(enemy,raw*m.damageMultiplier,m,now,actor);
  damage+=dealt;strikes.push({index,crit,damage:dealt,beforeHp,afterHp:enemy.hp});
  if(dealt)for(const type of ['nextDamage','critUp','enemyNextReduce'])consume(actor,type);
 }
 const statuses=applyThiefPrimary(actor,enemy,now,{cast,damage,actionId});
 return {damage,crit:strikes.some(s=>s.crit),strikes,attackSpeedMultiplier:actor.attackSpeedMultiplier||1.8,...(statuses.length?{statuses}:{})};
}
export function performSkill(actor,team,enemy,s,targetId,now,rng=()=>.5,context={}){
 const original=mechanics[s.id];if(!original)throw new GameError('skill','技能未定義');
 const m=masteredMechanics(s,original);
 let target=m.lowest?lowest(team):team.find(a=>a.id===targetId)||actor;
 if(m.revive){if(context.revived)throw new GameError('revive','每隊每場只能復活一次');if(!target||target.hp>0)throw new GameError('target','請選擇倒地的隊友');target.hp=Math.ceil(target.maxHp*.25*outputMultiplier(s));context.revived=true;return {damage:0,healed:target.hp,revived:true,targets:[target.id]};}
 if(m.accelerate){if((target.acceleratedUntil||0)>now)throw new GameError('accelerate','此隊友的加速保護尚未結束');const ids=Object.keys(target.special.cooldowns).filter(id=>(target.special.cooldowns[id]||0)>now&&SKILL_MAP[id]?.advancementTier<4);if(!ids.length)throw new GameError('target','隊友沒有冷卻中的非終極技能');const id=ids.sort((a,b)=>target.special.cooldowns[b]-target.special.cooldowns[a])[0];target.special.cooldowns[id]=Math.max(now,target.special.cooldowns[id]-Math.round(30000*utilityMultiplier(s)));target.acceleratedUntil=now+180000;return {damage:0,accelerated:id};}
 if(!target||target.hp<=0)throw new GameError('target','隊友已倒地，請選擇其他目標');
 let coef=m.singleCoefficient??skillCoefficient(s);let raw=actor.atk*coef*(1+valueOf(actor,'atkUp',now))*(1+valueOf(actor,'damageUp',now))*(1+valueOf(actor,'nextDamage',now))*(1-valueOf(actor,'enemyNextReduce',now));
 if(s.advancementTier<4)raw*=1+valueOf(actor,'echo',now);
 if(m.execute&&enemy.hp/enemy.maxHp<=m.execute)raw*=1+m.executeBonus;
 if(m.uninterruptBonus&&!enemy.interruptible)raw*=1+m.uninterruptBonus;
 const crit=rng()<Math.min(.8,(actor.crit||.05)+valueOf(actor,'critUp',now));if(crit)raw*=1.5;
 const damage=coef>0?damageEnemy(enemy,raw,m,now,actor):0;
 if(damage){consume(actor,'nextDamage');consume(actor,'critUp');consume(actor,'enemyNextReduce');if(s.advancementTier<4)consume(actor,'echo');}
 if(m.breakDef)buff(enemy,'breakDef',m.breakDef,now);if(m.mark)buff(enemy,'mark',m.mark,now);
 if(m.interrupt&&enemy.windup&&enemy.interruptible)enemy.interrupted=true;
 if(m.enemyNextReduce&&!m.addsOnly)buff(enemy,'enemyNextReduce',m.enemyNextReduce,now,60,1);
 const targets=m.all?team.filter(a=>a.hp>0):[m.target||m.lowest?target:actor];let healed=0,shielded=0;
 for(const a of targets){
  const healing=(actor.atk*(m.heal||0)+damage*(m.healDamage||0))*(1+(actor.affixPct?.healingPct||0));const heal=m.healCap?Math.min(healing,a.maxHp*m.healCap):healing;
  const gained=Math.min(a.maxHp-a.hp,Math.round(heal));a.hp+=gained;healed+=gained;
  let shield=actor.atk*(m.shield||0)*(1+(actor.affixPct?.shieldPct||0));if(m.overflow)shield+=Math.min(actor.atk*m.overflowCap,Math.max(0,heal-gained)*m.overflow);
  if(shield){shielded+=Math.round(shield);buff(a,'shield',Math.round(shield),now);}
  for(const type of ['atkUp','takenUp','reduce','nextReduce','nextDamage','damageUp','echo','critUp'])if(m[type])buff(a,type,m[type],now,m.duration||60,['nextReduce','nextDamage','echo'].includes(type)?1:type==='critUp'?m.critUses:null);
  if(m.cleanse)a.debuffs=(a.debuffs||[]).slice(1);
 }
 if(m.guard){actor.guard={target:target.id,pct:m.guard,until:now+60000};}
 if(m.reflect)buff(actor,'reflect',actor.atk*m.reflect,now,60,1);
 if(m.shieldSlow)buff(target,'shieldSlow',m.shieldSlow,now);
 if(m.lastStand)buff(actor,'lastStand',1,now,60*utilityMultiplier(s),1);
 if(m.leech)actor.hp=Math.min(actor.maxHp,actor.hp+Math.round(Math.min(damage*m.leech,actor.maxHp*m.leechCap)));
 if(m.thiefPoison)addThiefPoison({...actor,atk:actor.atk*outputMultiplier(s)},enemy,now);
 if(m.thiefCounter)armThiefCounter(actor,now,m.thiefCounter);
 if(m.dot)enemy.dots=(enemy.dots||[]).concat({owner:actor.id,source:{element:actor.element,weaponElem:0,affixPct:actor.affixPct,base:actor.base,guardian:actor.guardian},damage:actor.atk*m.dot*(1+(actor.affixPct?.dotPct||0)),left:m.dotCount,next:now+30000});
 if(m.summon)actor.summon={source:{element:actor.element,weaponElem:0,affixPct:actor.affixPct,base:actor.base,guardian:actor.guardian},damage:actor.atk*m.summon*(1+(actor.affixPct?.summonPct||0)),left:m.summonCount,next:now+30000};
 return {damage,healed,shielded,targets:targets.map(a=>a.id),crit:damage>0&&crit};
}
export function receiveDamage(a,raw,team,enemy,now,{guarded=false,elementApplied=false,defMultiplier=1,defApplied=false,shieldBonus=0}={}){
 if(a.hp<=0)return 0;
 if(!guarded&&!elementApplied)raw=elementalDamage(raw,enemy,a,{bonus:false});
 const defense=defApplied?1:(a.defenseScale??100)/((a.defenseScale??100)+Math.max(0,a.def*defMultiplier));
 let amount=guarded?raw:raw*takenMultiplier(a)*defense*(1-valueOf(a,'reduce',now))*(1-valueOf(a,'nextReduce',now))*(1+valueOf(a,'takenUp',now));if(!guarded)consume(a,'nextReduce');
 if(!guarded){const guard=team.find(x=>x.id!==a.id&&x.hp>0&&x.guard?.target===a.id&&x.guard.until>now);if(guard){const share=amount*guard.guard.pct;amount-=share;guard.guard=null;receiveDamage(guard,share,team,enemy,now,{guarded:true});}}
 const shield=(a.buffs||[]).find(x=>x.type==='shield'&&x.until>now&&x.value>0);if(shield){const absorbed=Math.min(shield.value,amount*(1+shieldBonus));shield.value-=absorbed;amount-=absorbed/(1+shieldBonus);if(absorbed&&valueOf(a,'reflect',now)){const reflected=valueOf(a,'reflect',now);consume(a,'reflect');damageEnemy(enemy,reflected,{},now,{...a,weaponElem:0});}if(absorbed&&valueOf(a,'shieldSlow',now))buff(enemy,'enemyNextReduce',valueOf(a,'shieldSlow',now),now,60,1);}
 const taken=Math.min(a.hp,Math.round(Math.max(0,amount)));a.hp-=taken;
 if(a.hp<=0&&valueOf(a,'lastStand',now)){a.hp=1;consume(a,'lastStand');}triggerThiefCounter(a,taken,now);return taken;
}
// Executing a cast is atomic in the caller's player/party transaction.
export function castSpecial(actor,team,enemy,skill,targetId,now,rng=()=>.5,context={}){
 const result=performSkill(actor,team,enemy,skill,targetId,now,rng,context);
 const sustain=restoreOnAction(actor,result.damage,{cast:true,enabled:enemy.hp>0&&context.applySustain!==false});
 const spentMp=spendMana(actor,skill.mp,rng);actor.special.cooldowns[skill.id]=now+skill.cooldownSeconds*1000;
 return {...result,healed:(result.healed||0)+sustain.healed,selfHealed:sustain.healed,spentMp};
}
export function combatActor(c,s,{id=c.tg_id,hp=c.hp??s.maxHp,mp=c.mp??s.maxMp}={}){
 return {id,name:c.name,base:c.base_class,path:c.class_path||'',level:c.level??s.level,guardian:c.guardian,aura:equippedAura(c),
  collectionBlessing:s.collectionBlessing,maxHp:s.maxHp,maxMp:s.maxMp,hp:Math.min(s.maxHp,hp),mp:Math.min(s.maxMp,mp),
  atk:s.atk,def:s.def,taken:s.taken,attackSpeedMultiplier:s.attackSpeedMultiplier||1,skill:{...s.skill},element:s.element,weaponElem:s.weaponElem,elementResist:s.elementResist,
  crit:.05+(s.pct.critPct||0),affixPct:{...s.pct},special:structuredClone(specialState(c)),buffs:[],actions:0};
}
export function periodic(team,enemy,now,{sustain=true}={}){
 for(const d of enemy.dots||[])while(d.left>0&&d.next<=now&&(!d.until||d.next<=d.until)){const damage=damageEnemy(enemy,d.damage,{},now,d.source),owner=team.find(a=>a.id===d.owner);if(sustain&&owner)restoreOnAction(owner,damage,{enabled:enemy.hp>0});d.left--;d.next+=30000;}
 enemy.dots=(enemy.dots||[]).filter(d=>d.kind!=='thiefPoison'||d.left>0&&d.until>now&&enemy.hp>0);
 for(const a of team){if(a.hp<=0)continue;const s=a.summon;while(s?.left>0&&s.next<=now){const damage=damageEnemy(enemy,s.damage,{},now,s.source);if(sustain)restoreOnAction(a,damage,{enabled:enemy.hp>0});s.left--;s.next+=30000;}}
}


// Party automation selects only legal equipped skills, without mutating combat state.
export function autoPartyAction(actor,team,enemy,now,context={}){
 const alive=team.filter(a=>a.hp>0),lowest=alive.slice().sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0]||actor,dead=team.find(a=>a.hp<=0),choices=[];
 for(const id of actor.special?.loadout||[]){let skill;try{skill=validateCast({base_class:actor.base,class_path:actor.path,level:actor.level,mp:actor.mp,affixPct:actor.affixPct},actor.special,id,now)}catch{continue}const m=MECHANICS[id];if(!m)continue;let target=actor,priority=40;
 if(m.revive){if(!dead||context.revived)continue;target=dead;priority=100;}
 else if(m.heal&&!skillCoefficient(skill)){if(lowest.hp/lowest.maxHp>.65)continue;target=lowest;priority=90;}
 else if(m.accelerate){target=alive.find(a=>(a.acceleratedUntil||0)<=now&&Object.keys(a.special?.cooldowns||{}).some(k=>a.special.cooldowns[k]>now&&SKILL_MAP[k]?.advancementTier<4));if(!target)continue;priority=25;}
 else if(m.interrupt){if(!enemy.windup||!enemy.interruptible||enemy.interrupted){if(!skillCoefficient(skill))continue;}else priority=80;}
 else if(m.addsOnly&&!enemy.adds)continue;
 else if(!skillCoefficient(skill)){if(Object.keys(m).some(key=>['atkUp','damageUp','nextReduce','reduce','guard'].includes(key)&&valueOf(actor,key,now)>0))continue;priority=30;}
 if(m.target&&!m.revive&&!m.accelerate)target=lowest;
 choices.push({skillId:id,targetId:target.id,priority});
 }choices.sort((a,b)=>b.priority-a.priority);return choices.length?{skillId:choices[0].skillId,targetId:choices[0].targetId}:{skillId:'attack',targetId:actor.id};
}
