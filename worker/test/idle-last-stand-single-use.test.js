import test from 'node:test';import assert from 'node:assert/strict';
import {mkChar,starterGear,T0} from './helpers.js';import {idleStats} from '../src/game/stats.js';import {settleIdle} from '../src/game/idle.js';import {idleSpecial} from '../src/game/special-idle.js';import {POTIONS} from '../src/game/constants.js';
function run(low=true){const c=mkChar({tg_id:'79',level:75,class_path:'A1',map_id:8,auto_red_pct:0,special_json:JSON.stringify({learned:['skill_07_2'],mastery:{skill_07_2:10},loadout:['skill_07_2'],pending:'skill_07_2',partyStamina:{points:80,at:T0}})}),eq=starterGear(c,1),s=idleStats(c,eq);c.hp=Math.ceil(s.maxHp*(low?.3:1));c.mp=s.maxMp;return {eq,...settleIdle(c,{},eq,T0+60000)};}
test('a real fatal elite consumes the mastered idle last stand before the next minute in its longer protection window',()=>{
 const r=run();assert.equal(r.report.elites,1);assert.equal(r.char.hp,1);assert.equal(r.report.deaths,0);const x=JSON.parse(r.char.special_json),b=x.idleActor.buffs.find(b=>b.type==='lastStand');assert.equal(b.uses,0);assert.equal(x.mastery.skill_07_2,10);assert.deepEqual(x.partyStamina,{points:80,at:T0});
 const next=idleSpecial(r.char,{},idleStats(r.char,r.eq),T0+120000,{chooseBlue:()=>null,use:()=>assert.fail('no potion'),potions:POTIONS,day:'2026-10-08',rng:()=>1});assert.equal(next.eliteProtected,false);assert.equal(JSON.parse(r.char.special_json).cooldowns.skill_07_2,T0+60000+180000);
});
test('a nonfatal elite does not spend the one-shot protection prematurely',()=>{
 const r=run(false);assert.equal(r.report.elites,1);assert(r.char.hp>1);assert.equal(r.report.deaths,0);assert.equal(JSON.parse(r.char.special_json).idleActor.buffs.find(b=>b.type==='lastStand').uses,1);
});
