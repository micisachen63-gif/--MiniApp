import test from 'node:test';
import assert from 'node:assert/strict';
import {potionPreference,potionOptions} from '../src/game/potion-choice.js';
import {choosePotion,settleIdle,supplyHours,refillPlan,autoResume} from '../src/game/idle.js';
import {settings,refill} from '../src/services/player.js';
import {playerView} from '../src/views.js';
import {performAttack} from '../src/game/boss.js';
import {idleStats} from '../src/game/stats.js';
import {mkChar,starterGear,T0} from './helpers.js';

const pref=(red='red_1',blue='blue_2')=>JSON.stringify({autoRedPotion:red,autoBluePotion:blue,autoBluePct:70});
test('legacy automatic choice retains level ordering; explicit choice never drains another tier',()=>{
 const inv={red_1:20,red_2:10,blue_1:10,blue_2:3};
 assert.equal(choosePotion(inv,'red',6),'red_2');
 const c=mkChar({level:60,special_json:pref()});
 assert.equal(choosePotion(inv,'red',6,c),'red_1');assert.equal(choosePotion(inv,'blue',6,c),'blue_2');
 assert.equal(choosePotion({...inv,blue_2:0},'blue',6,c),null);
 assert.equal(potionPreference({special_json:'broken'},'red'),'auto');
});
test('per-character settings preserve skills, guardian supply and thresholds, reject wrong kind and locked purchases',()=>{
 const c=mkChar({level:60,special_json:JSON.stringify({learned:['skill_02_1'],guardianStoneSupply:true,autoBluePct:70})}),work={char:c,inv:{},equipment:starterGear(c)};
 settings(work,{}, {autoRedPotion:'red_1',autoBluePotion:'blue_2'});
 assert.deepEqual(JSON.parse(c.special_json),{learned:['skill_02_1'],guardianStoneSupply:true,autoBluePct:70,autoRedPotion:'red_1',autoBluePotion:'blue_2'});
 for(const v of ['blue_1','ward',null,'__proto__'])assert.throws(()=>settings(work,{}, {autoRedPotion:v}));
 assert.throws(()=>settings(work,{}, {autoBluePotion:'blue_4'}));
 work.inv.blue_4=1;settings(work,{}, {autoBluePotion:'blue_4'});assert.equal(potionPreference(c,'blue'),'blue_4');
 work.inv.blue_4=0;assert.throws(()=>refill(work,{now:T0},{requestId:'test'}),/尚未解鎖/);
 settings(work,{}, {autoBluePotion:'auto'});assert.equal(potionPreference(c,'blue'),'auto');
 assert.equal(potionPreference(mkChar(),'red'),'auto');
});
test('idle drinks chosen HP and MP potions; empty choice never falls back and town recovery respects chosen stock',()=>{
 const c=mkChar({level:59,class_path:'A',hp:1,mp:1,special_json:pref()}),eq=starterGear(c),inv={red_1:1000,red_2:1000,blue_1:1000,blue_2:1000};
 const result=settleIdle(c,inv,eq,T0+60000);assert(result.report.used.red_1>0);assert(result.report.used.blue_2>0);assert.equal(result.inv.red_2,1000);assert.equal(result.inv.blue_1,1000);
 const empty=settleIdle(c,{blue_1:1000,red_2:1000},eq,T0+60000);assert.equal(empty.report.used.blue_1,undefined);assert.equal(empty.report.used.red_2,undefined);
 const town={...c,idle_state:'town_no_red'};assert.equal(autoResume(town,{red_2:100},100),false);assert.equal(autoResume(town,{red_1:1},100),true);
});
test('supply view, recovery hours and refill debit follow independent HP/MP choices including partial affordable refill',()=>{
 const c=mkChar({level:59,class_path:'A',gold:10000000,special_json:pref()}),eq=starterGear(c),inv={red_2:100000,blue_1:100000};
 const sup=supplyHours(c,inv,eq);assert.equal(sup.red,0);assert.equal(sup.blue,0);assert.equal(sup.redKey,'red_1');assert.equal(sup.blueKey,'blue_2');
 const plan=refillPlan(c,inv,eq,24,sup);assert(plan.red_1>0&&plan.blue_2>0);assert.equal(plan.red_2,undefined);
 const work={char:c,inv:{...inv},equipment:eq},before=c.gold,result=refill(work,{now:T0},{requestId:'chosen'});
 assert.equal(before-c.gold,result.result.cost);assert.equal(work.inv.red_2,inv.red_2);assert.equal(work.inv.blue_1,inv.blue_1);assert.deepEqual(result.ledger.map(x=>x.item),['red_1','blue_2']);
 assert.equal(refillPlan(c,work.inv,eq).cost,0);
 const view=playerView(work,{now:T0});assert.equal(view.supply.redKey,'red_1');assert.equal(view.supply.blueKey,'blue_2');assert.equal(view.character.autoRedPotion,'red_1');assert.equal(view.supply.redOptions.length,4);
 const small={char:{...c,gold:100},inv:{},equipment:eq},partial=refill(small,{now:T0},{requestId:'partial'});assert(partial.result.partial);assert(small.char.gold>=0);assert.equal(partial.result.cost,(small.inv.red_1||0)*6+(small.inv.blue_2||0)*14);
 assert.equal(potionOptions(c,{},'red').find(x=>x.key==='red_4').unlocked,false);
});
test('group boss applies explicit potion types without spending other stocks',()=>{
 const c=mkChar({level:59,class_path:'A',mp:1,hp:1,special_json:pref()}),stats=idleStats(c,starterGear(c)),inv={red_1:1000,red_2:1000,blue_1:1000,blue_2:1000};
 const r=performAttack({c,inv,stats,boss:{id:'choice',map_id:6,hp:1000000,max_hp:1000000,element:'fire'},rng:()=>.5,now:T0});
 assert(r.used.blue_2>0);assert.equal(inv.blue_1,1000);assert.equal(inv.red_2,1000);
});
