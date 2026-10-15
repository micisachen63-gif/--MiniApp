import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {idleBattleHarness,idleMe,idleReport} from './idle-battle-harness.js';
const source=readFileSync(new URL('../public/expedition/combat-playback.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const {combatStrikeSteps}=vm.runInNewContext(source+'\n({combatStrikeSteps})');

test('two-strike replay accepts only the settled contiguous HP transitions and commits member mana/healing at the final snapshot',()=>{
 const before={enemyHp:1000,members:[{id:'a',hp:100,mp:50}]},after={enemyHp:700,members:[{id:'a',hp:105,mp:46}]};
 const event={base:'thief',skillId:'attack',damage:300,strikes:[{damage:100,beforeHp:1000,afterHp:900},{damage:200,beforeHp:900,afterHp:700}],after};
 const original=JSON.stringify({event,before}),steps=combatStrikeSteps(event,before);
 assert.equal(steps.length,2);assert.equal(steps[0].enemyHp,900);assert.strictEqual(steps[0].members,before.members);assert.strictEqual(steps[1],after);assert.equal(JSON.stringify({event,before}),original);
 for(const invalid of [{...event,base:'sword'},{...event,skillId:'skill_thief_04'},{...event,damage:301},{...event,after:{...after,enemyHp:600}},{...event,strikes:[{...event.strikes[0],beforeHp:999},event.strikes[1]]}])assert.equal(combatStrikeSteps(invalid,before).length,1);
 assert.equal(combatStrikeSteps(event,{...before,enemyHp:999}).length,1,'stale action cannot invent a rewind or extra hit');
});

test('reduced-motion thief idle replay applies one committed hit, no duplicate rewards, and cancels old-character recovery',async()=>{
 const h=idleBattleHarness({reducedMotion:true}),before={id:'thief-fixture',name:'假目標',mapId:1,hp:100,maxHp:100},after={...before,hp:60};
 const round={id:'thief-reduced:1',mapId:1,before:[before],after:[after],attackSpeedMultiplier:1.8,events:[{type:'hit',targetId:before.id,enemy:after,beforeHp:100,afterHp:60,damage:40,strike:0,attackSpeedMultiplier:1.8,skill:true,skillName:'迅刃突刺'}]};
 const me=idleMe({baseClass:'thief',revision:2});me.battle.attackSpeedMultiplier=1.8;me.battle.idleCombat={enemies:[after],round};
 const report=idleReport({kills:0,exp_gained:0,gold_gained:0,elites:0,drops:{},used:{},combat:round});h.battle.sync(me,report);await h.advance(3000);
 assert.equal(h.root.dataset.completedRound,round.id);assert.equal(JSON.parse(h.root.dataset.lastHit).damage,40);assert.equal(JSON.parse(h.root.dataset.lastHit).hp,60);
 const epoch=h.battle.state.visualEpoch;h.battle.sync(me,report);assert.equal(h.battle.state.visualEpoch,epoch);
 const next=idleMe({baseClass:'thief',tgId:'next-fixture',revision:1,hp:25});h.battle.sync(next);await h.advance(3000);assert.equal(h.battle.state.me.character.hp,25);assert.equal(h.root.dataset.lastReport,undefined);assert.deepEqual(h.errors,[]);
});
