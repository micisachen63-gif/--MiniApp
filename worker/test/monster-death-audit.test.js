import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {MAPS} from '../src/game/constants.js';
import {newBoss,performAttack} from '../src/game/boss.js';
import {idleStats,standardSet} from '../src/game/stats.js';
import {mkChar,T0} from './helpers.js';
import {idleBattleHarness,idleMe,idleReport} from './idle-battle-harness.js';
const source=fs.readFileSync(new URL('../public/battle.js',import.meta.url),'utf8');
const extract=name=>{const a=source.indexOf('    async function '+name+'('),b=source.indexOf('\n    }',a)+6;assert.ok(a>=0);return source.slice(a,b);};
for(const map of Object.values(MAPS)){
  test(`map ${map.id}: unsettled motion cannot invent defeated monsters or rewards`,async()=>{
    const h=idleBattleHarness(),me=idleMe({mapId:map.id,level:map.min});me.battle.monsters=map.monsters;me.battle.elite=map.elite;h.battle.sync(me);await h.advance(12000);
    assert.equal(h.root.dataset.lastReport,undefined);assert.ok(h.battle.state.group.every(e=>e.mon.hp===1));assert.deepEqual(h.errors,[]);
  });
  for(const state of ['fighting','no_mp'])test(`map ${map.id}: settlement reprise keeps exact totals with ${state}`,async()=>{
    const h=idleBattleHarness(),me=idleMe({mapId:map.id,level:map.min,state});me.battle.monsters=map.monsters;me.battle.elite=map.elite;h.battle.sync(me,idleReport({kills:4,elites:1,used:{}}));await h.advance(10000);
    const totals=JSON.parse(h.root.dataset.lastReport);assert.equal(totals.kills,4);assert.equal(totals.exp,123);assert.equal(totals.gold,77);assert.equal(me.character.hp,77);assert.deepEqual(h.errors,[]);
  });
  test(`map ${map.id}: boss ${map.boss.name} has finite HP and accepts positive damage`,()=>{
    const boss=newBoss({id:'audit',start:T0,end:T0+1800000},map.id,()=>.5,'-1004342516953'),c=mkChar({level:map.min,base_class:'sword',class_path:map.id>6?'A1':map.id>3?'A':''}),stats=idleStats(c,standardSet(c.base_class,c.level));c.hp=stats.maxHp;c.mp=stats.maxMp;
    const r=performAttack({c,inv:{red_4:999,blue_4:999},stats,boss,rng:()=>.5,now:T0});assert.ok(Number.isFinite(boss.hp)&&boss.hp>0);assert.ok(Number.isFinite(r.damage)&&r.damage>0);
  });
}
function reportEpisode(report){const a=source.indexOf('    function settlementTotals('),b=source.indexOf('    function sync(',a),ctx=vm.createContext({});vm.runInContext(source.slice(a,b)+';this.run=episode;',ctx);return ctx.run(report);}
test('zero server kills never creates a representative defeated enemy and still preserves exact gains',()=>{
  const e=reportEpisode({ticks:1,kills:0,exp_gained:9,gold_gained:3});assert.equal(e.kills.length,0);assert.equal(e.totals.exp,9);assert.equal(e.totals.gold,3);
});
test('large reports keep complete kills, EXP, gold and drop quantities together rather than dividing them into made-up encounters',()=>{
  for(let kills=1;kills<=100;kills++){const e=reportEpisode({ticks:60,kills,exp_gained:kills*11,gold_gained:kills*7,drops:{scroll:99}});assert.ok(e.kills.length<=3);assert.equal(e.totals.kills,kills);assert.equal(e.totals.exp,kills*11);assert.equal(e.totals.gold,kills*7);assert.equal(e.totals.drops.scroll,99);assert.ok(e.kills.every(k=>!('exp' in k)&&!('gold' in k)&&!('count' in k)));}
});
test('representative death hides the monster and cannot credit settlement totals again',async()=>{
  const S={mon:{name:'海崖塞壬'},reportTotals:{kills:4,exp:40,gold:20}},attrs={},root={dataset:{}},E={mAct:{},mon:{style:{},setAttribute(k,v){attrs[k]=v;}}},ctx=vm.createContext({S,root,E,checkScene(){},monPt:()=>({x:0,y:0}),animateMonsterSheet(){},play(){},burst(){},wait:async()=>{},saveEnemy(){},renderTargets(){}});
  vm.runInContext(extract('killMonster')+';this.run=killMonster;',ctx);await ctx.run({elite:false});assert.deepEqual(S.reportTotals,{kills:4,exp:40,gold:20});assert.equal(E.mon.style.opacity,'0');assert.equal(E.mon.tabIndex,-1);assert.equal(attrs['aria-hidden'],'true');assert.equal(root.dataset.visualDefeats,undefined);
});
