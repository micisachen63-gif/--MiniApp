import { SKILL_MAP,eligible,specialState,saveSpecial,castSpecial,combatActor,periodic,valueOf } from './special.js';
import {specialCost} from './combat-passives.js';
import {mapElement} from './elements.js';
// One action per minute. A special skill replaces the normal attack and is off by default.
export function idleSpecial(c,inv,s,now,{chooseBlue,use,potions,day,rng=()=>.5}){
 const x=specialState(c);if(!x.pending&&!Object.keys(x.auto).length&&!x.idleActor)return null;
 // The actual idle damage budget applies the guardian multiplier once in idle.js.
 const a={...combatActor(c,s),guardian:null,special:x,buffs:x.idleActor?.buffs||[],summon:x.idleActor?.summon};
 const enemy={hp:s.atk*100,maxHp:s.atk*100,def:s.std*.05,element:mapElement(c.map_id),level:c.level,buffs:x.idleEnemy?.buffs||[],dots:x.idleEnemy?.dots||[],interruptible:true,windup:true};
 periodic([a],enemy,now,{sustain:false});
 const periodicDamage=enemy.maxHp-enemy.hp;
 if(x.costDay!==day){x.costDay=day;x.extraCost=0;}
 const manual=x.pending;let selected;
 for(const id of manual?[manual]:x.loadout){
  const base=SKILL_MAP[id],skill=base?specialCost(base,s.pct):base,mode=x.auto[id];if(!eligible(c,skill)||!x.learned.includes(id)||(x.cooldowns[id]||0)>now)continue;
  if(!manual&&(!mode||mode==='lowHp'&&a.hp/a.maxHp>=.5||mode==='elite'&&Math.floor(now/60000)%33!==0))continue;
  if(['skill_17_2','skill_24_2'].includes(id))continue;
  // Safe mode spends current MP only. Strong mode consumes owned blue potions up to the daily replacement-cost limit.
  if(a.mp<skill.mp&&x.mode==='strong'&&c.auto_blue){let key;while(a.mp<skill.mp&&(key=chooseBlue(inv,c.map_id))){const cost=potions[key].price||0;if((x.extraCost||0)+cost>(x.budget||0))break;use(key);x.extraCost=(x.extraCost||0)+cost;a.mp=Math.min(s.maxMp,a.mp+potions[key].heal);}}
  if(a.mp<skill.mp)continue;selected=skill;break;
 }
 let damage=periodicDamage;
 if(selected){const result=castSpecial(a,[a],enemy,selected,a.id,now,rng,{applySustain:false});damage+=result.damage;if(manual)delete x.pending;}
 const normalBonus=Math.min(1.5,(1+valueOf(a,'atkUp',now))*(1+valueOf(a,'damageUp',now))*(1+valueOf(a,'nextDamage',now))+periodicDamage/Math.max(1,s.atk*s.skill.mult));
 const ratio=selected?Math.min(1.5,Math.max(.15,damage/Math.max(1,s.atk*s.skill.mult))):null;
 // The existing idle pressure is already reduced by DEF; apply only active skill protection here.
 let loss=s.hpLoss*(1-valueOf(a,'reduce',now))*(1-valueOf(a,'nextReduce',now))*(1+valueOf(a,'takenUp',now));
 const shield=a.buffs.find(b=>b.type==='shield'&&b.until>now&&b.value>0);if(shield&&loss>0){const absorb=Math.min(loss,shield.value);shield.value-=absorb;loss-=absorb;}
 for(const buff of a.buffs)if(buff.type==='nextReduce'&&buff.uses>0)buff.uses--;
 c.hp=Math.min(s.maxHp,a.hp);c.mp=a.mp;x.idleActor={buffs:a.buffs.filter(b=>b.until>now&&(b.uses==null||b.uses>0)),summon:a.summon};x.idleEnemy={buffs:enemy.buffs.filter(b=>b.until>now),dots:(enemy.dots||[]).filter(d=>d.left>0)};saveSpecial(c,x);
 return {selected,ratio,normalBonus,hpLoss:loss,eliteProtected:valueOf(a,'lastStand',now)>0,extraCost:x.extraCost};
}
