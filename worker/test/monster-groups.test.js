import test from 'node:test';
import assert from 'node:assert/strict';
import {idleBattleHarness,idleMe} from './idle-battle-harness.js';

test('basic attack motion affects only the chosen enemy and cannot fabricate health damage',async()=>{
  const h=idleBattleHarness(),me=idleMe();h.battle.sync(me);await h.advance(1100);
  assert.deepEqual(Array.from(h.battle.state.group,e=>e.refs.mAct.classList.contains('knock')),[true,false,false,false]);
  assert.ok(h.battle.state.group.every(e=>e.mon.hp===1));assert.equal(me.character.hp,77);
});
test('a three-target spell keeps three impact effects without inventing three damage amounts',async()=>{
  const h=idleBattleHarness({random:()=>0}),me=idleMe();me.battle.skill.targets=3;h.battle.sync(me);await h.advance(1300);
  assert.deepEqual(Array.from(h.battle.state.group,e=>e.refs.mAct.classList.contains('knock')),[true,true,true,false]);
  assert.ok(h.battle.state.group.every(e=>e.mon.hp===1));assert.equal(me.character.mp,31);
  assert.doesNotMatch(h.root.querySelector('.floats').children.map(e=>e.textContent).join(' '),/\d|MISS|EXP|金幣/);
});
test('clicking another target is applied between motions and preserves authoritative character HP',async()=>{
  const h=idleBattleHarness();h.battle.sync(idleMe());await h.advance(1100);
  h.battle.state.group[3].refs.mon.listeners.get('click')();await h.advance(1100);
  assert.equal(h.battle.state.selected,3);assert.equal(h.battle.state.me.character.hp,77);assert.equal(h.root.dataset.lastReport,undefined);assert.deepEqual(h.errors,[]);
});
