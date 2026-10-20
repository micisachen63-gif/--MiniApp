import {masteredSkill} from './skill-mastery.js';
import {needsBlue,blueTarget} from './auto-blue.js';
import {thiefPrimaryMechanics,applyThiefPrimary,triggerThiefCounter,nextThiefStrikeCount} from './thief-skills.js';
import { SKILL_MAP,eligible,specialState,saveSpecial,castSpecial,combatActor,periodic,valueOf } from './special.js';
import {mapForLevel} from './formulas.js';
import {specialCost} from './combat-passives.js';
import {mapElement} from './elements.js';
// One action per minute. A special skill replaces the normal attack and is off by default.
export function idleSpecial(c,inv,s,now,{chooseBlue,use,potions,day,rng=()=>.5}){
 const x=specialState(c);if(c.base_class!=='thief'&&!x.pending&&!Object.keys(x.auto).length&&!x.idleActor)return null;
 if(c.base_class==='thief'&&x.thiefIdleMap!==mapForLevel(c.level)){delete x.idleEnemy;x.thiefIdleMap=mapForLevel(c.level);}
 // The actual idle damage budget applies the guardian multiplier once in idle.js.
 const a={...combatActor(c,s),guardian:null,special:x,buffs:x.idleActor?.buffs||[],summon:x.idleActor?.summon};
 const enemy={hp:s.atk*100,maxHp:s.atk*100,def:s.std*.05,element:mapElement(c.map_id),level:c.level,buffs:x.idleEnemy?.buffs||[],dots:x.idleEnemy?.dots||[],interruptible:true,windup:true};
 periodic([a],enemy,now,{sustain:false});
 const periodicDamage=enemy.maxHp-enemy.hp;
 if(x.costDay!==day){x.costDay=day;x.extraCost=0;}
 const manual=x.pending;let selected;
 for(const id of manual?[manual]:x.loadout){
  const base=SKILL_MAP[id],skill=base?specialCost(masteredSkill(base,x),s.pct):base,mode=x.auto[id];if(!eligible(c,skill)||!x.learned.includes(id)||(x.cooldowns[id]||0)>now)continue;
  if(!manual&&(!mode||mode==='lowHp'&&a.hp/a.maxHp>=.5||mode==='elite'&&Math.floor(now/60000)%33!==0))continue;
  if(['skill_17_2','skill_24_2'].includes(id))continue;
  // Safe mode spends current MP only. Strong mode consumes owned blue potions up to the daily replacement-cost limit.
  if(needsBlue(c,a.mp,s.maxMp,skill.mp)&&x.mode==='strong'){const target=blueTarget(c,s.maxMp,skill.mp);let key;do{key=chooseBlue(inv,c.map_id);if(!key)break;const cost=potions[key].price||0;if((x.extraCost||0)+cost>(x.budget||0))break;use(key);x.extraCost=(x.extraCost||0)+cost;a.mp=Math.min(s.maxMp,a.mp+potions[key].heal);}while(a.mp<target);}
  if(a.mp<skill.mp)continue;selected=skill;break;
 }
 let damage=periodicDamage;
 if(selected){const result=castSpecial(a,[a],enemy,selected,a.id,now,rng,{applySustain:false});damage+=result.damage;if(manual)delete x.pending;}
 const normalBonus=Math.min(1.5,(1+valueOf(a,'atkUp',now))*(1+valueOf(a,'damageUp',now))*(1+valueOf(a,'nextDamage',now))+periodicDamage/Math.max(1,s.atk*s.skill.mult));
 const ratio=selected?Math.min(1.5,Math.max(.15,damage/Math.max(1,s.atk*s.skill.mult))):null;
 // The existing idle pressure is already reduced by DEF; apply only active skill protection here.
 let loss=s.hpLoss*(1-valueOf(a,'reduce',now))*(1-valueOf(a,'nextReduce',now))*(1+valueOf(a,'takenUp',now));
 const shield=a.buffs.find(b=>b.type==='shield'&&b.until>now&&b.value>0);if(shield&&loss>0){const absorb=Math.min(loss,shield.value);shield.value-=absorb;loss-=absorb;}
 triggerThiefCounter(a,loss,now);
 for(const buff of a.buffs)if(buff.type==='nextReduce'&&buff.uses>0)buff.uses--;
 c.hp=Math.min(s.maxHp,a.hp);c.mp=a.mp;x.idleActor={buffs:a.buffs.filter(b=>b.until>now&&(b.uses==null||b.uses>0)),summon:a.summon};x.idleEnemy={buffs:enemy.buffs.filter(b=>b.until>now),dots:(enemy.dots||[]).filter(d=>d.left>0)};saveSpecial(c,x);
 return {selected,ratio,normalBonus,nativeSteadyBonus:Math.min(1.5,(1+valueOf(a,'atkUp',now))*(1+valueOf(a,'damageUp',now))),periodicBonus:periodicDamage/Math.max(1,s.atk*s.skill.mult),hpLoss:loss,eliteProtected:valueOf(a,'lastStand',now)>0,extraCost:x.extraCost};
}

// Idle settles an aggregate integer damage budget. Native statuses alter that same budget;
// they do not add synthetic kills, extra attacks, or a second sustain payment.
export function idleThiefNative(c,s,now,{cast=true}={}){
 if(c.base_class!=='thief'||!cast)return {multiplier:1,statuses:[]};
 const x=specialState(c),a={...combatActor(c,s),guardian:null,buffs:x.idleActor?.buffs||[]};
 const enemy={hp:s.atk*100,maxHp:s.atk*100,def:s.std*.05,buffs:x.idleEnemy?.buffs||[],dots:x.idleEnemy?.dots||[]};
 const m=thiefPrimaryMechanics(a,enemy,now,{cast});
 const def=Math.max(0,enemy.def*(1-valueOf(enemy,'breakDef',now)));
 const multiplier=m.damageMultiplier*(1+valueOf(enemy,'mark',now))*(100+def)/(100+def*(1-m.penetrate));
 const statuses=applyThiefPrimary(a,enemy,now,{cast,damage:s.atk*s.skill.mult,actionId:String(now)});
 const lossMultiplier=1-valueOf(enemy,'enemyNextReduce',now);
 for(const b of enemy.buffs)if(b.type==='enemyNextReduce'&&b.uses>0)b.uses--;
 x.idleEnemy={buffs:enemy.buffs.filter(b=>b.until>now&&(b.uses==null||b.uses>0)),dots:(enemy.dots||[]).filter(d=>d.left>0)};
 saveSpecial(c,x);
 return {multiplier,statuses,lossMultiplier};
}

// The aggregate idle adapter must never carry a thief's mark or poison onto a new monster.
export function clearThiefIdleNative(c){
 if(c.base_class!=='thief')return;
 const x=specialState(c);delete x.thiefIdleTarget;
 if(x.idleEnemy)x.idleEnemy={...x.idleEnemy,buffs:(x.idleEnemy.buffs||[]).filter(b=>b.origin!=='thiefPrimary'),dots:(x.idleEnemy.dots||[]).filter(d=>d.kind!=='thiefPoison')};
 saveSpecial(c,x);
}
export function prepareThiefIdleEncounter(c,combat){
 if(c.base_class!=='thief')return null;
 const target=combat.enemies[combat.target===1?1:0]?.id,x=specialState(c);
 if(x.thiefIdleTarget!==target){clearThiefIdleNative(c);const current=specialState(c);current.thiefIdleTarget=target;saveSpecial(c,current);}
 return target;
}

export function idleThiefStrikePlan(c,s,combat,now,rng){
 if(c.base_class!=='thief')return null;
 const x=specialState(c),a={...combatActor(c,s),buffs:x.idleActor?.buffs||[],thiefAttackCarry:combat.thiefAttackCarry||0};
 const count=nextThiefStrikeCount(a,3);combat.thiefAttackCarry=a.thiefAttackCarry;
 const strikes=Array.from({length:count},(_,index)=>{
  const crit=rng()<Math.min(.8,a.crit+valueOf(a,'critUp',now)),weight=(crit?1.5:1)*(1+valueOf(a,'nextDamage',now))*(1-valueOf(a,'enemyNextReduce',now));
  for(const buff of a.buffs)if(['critUp','nextDamage','enemyNextReduce'].includes(buff.type)&&buff.uses>0)buff.uses--;
  return {index,crit,weight};
 });
 x.idleActor={...x.idleActor,buffs:a.buffs.filter(b=>b.until>now&&(b.uses==null||b.uses>0))};saveSpecial(c,x);
 return {strikes,factor:strikes.reduce((sum,s)=>sum+s.weight,0)/count,attackSpeedMultiplier:a.attackSpeedMultiplier};
}
