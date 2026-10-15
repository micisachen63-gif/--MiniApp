import test from 'node:test';
import assert from 'node:assert/strict';
import {idleBattleHarness,idleMe,idleReport} from './idle-battle-harness.js';

test('unsettled combat stays vivid without inventing damage, criticals, health, kills or gains',async()=>{
  const h=idleBattleHarness();h.battle.sync(idleMe());await h.advance(10000);
  assert.equal(h.battle.state.me.character.hp,77);assert.equal(h.battle.state.me.character.mp,31);
  assert.equal(h.root.querySelector('.hbars .h i').style.transform,'scaleX(0.77)');assert.equal(h.root.querySelector('.hbars .m i').style.transform,'scaleX(0.62)');
  assert.equal(h.root.dataset.lastReport,undefined);assert.ok(h.battle.state.group.length>0);
  assert.ok(h.battle.state.group.every(e=>e.mon?.hp===1));
  const text=h.root.querySelector('.floats').children.map(e=>e.textContent).join(' ');assert.doesNotMatch(text,/MISS|\d|EXP|金幣|擊殺/);
  assert.deepEqual(h.errors,[]);assert.deepEqual(h.requests,['monster-layout.json']);
});

test('committed settlement is shown once with exact totals and full item counts, never inferred potion healing',async()=>{
  const h=idleBattleHarness(),me=idleMe({revision:2,hp:91,mp:40}),r=idleReport({exp_lost:9,relics:[{name:'星石'}]});
  h.battle.sync(me,r);
  assert.deepEqual(JSON.parse(h.root.dataset.lastReport),{kills:8,exp:123,gold:77,expLost:9,drops:{scroll:7},used:{red_1:2},relics:1});
  assert.match(h.root.querySelector('.settlement-main').textContent,/擊敗 8.*經驗 \+123 −9.*金幣 \+77/);
  assert.match(h.root.querySelector('.settlement-items').textContent,/強化卷軸 ×7.*遺物 ×1.*使用 小紅水 ×2/);
  const epoch=h.battle.state.visualEpoch;h.battle.sync(me,r);assert.equal(h.battle.state.visualEpoch,epoch);
  await h.advance(10000);assert.equal(h.root.querySelector('.hbars .h i').style.transform,'scaleX(0.91)');assert.equal(h.root.querySelector('.hbars .m i').style.transform,'scaleX(0.8)');
  const floats=h.root.querySelector('.floats').children.map(e=>e.textContent).join(' ');assert.doesNotMatch(floats,/2000|\+\d+ HP|\+\d+ MP|MISS/);assert.deepEqual(h.errors,[]);
});

test('older character revisions and overlapping report windows cannot replace authoritative state or repeat rewards',()=>{
  const h=idleBattleHarness();h.battle.sync(idleMe({revision:5,hp:91}),idleReport());const shown=h.root.dataset.lastReport;
  assert.equal(h.battle.sync(idleMe({revision:4,hp:1}),idleReport({kills:99})),false);assert.equal(h.battle.state.me.character.hp,91);
  h.battle.sync(idleMe({revision:6,hp:80}),idleReport({from_at:30000,to_at:90000,kills:99}));assert.equal(h.root.dataset.lastReport,shown);
  h.battle.sync(idleMe({revision:7}),idleReport({from_at:60000,to_at:120000,kills:4}));assert.equal(JSON.parse(h.root.dataset.lastReport).kills,4);
});

test('character and map changes cancel old settlement motion and clear old summary while keeping each character report deduplication',async()=>{
  const h=idleBattleHarness();h.battle.sync(idleMe(),idleReport());await h.advance(100);
  h.battle.sync(idleMe({tgId:'222',revision:1,hp:25,mapId:2,baseClass:'mage'}));assert.equal(h.root.dataset.lastReport,undefined);assert.equal(h.root.querySelector('.settlement-summary').hidden,true);
  await h.advance(4000);assert.equal(h.battle.state.me.character.tgId,'222');assert.equal(h.root.querySelector('.hbars .h i').style.transform,'scaleX(0.25)');
  assert.ok(h.battle.state.group.every(e=>!e.mon?.elite));assert.deepEqual(h.errors,[]);
  h.battle.sync(idleMe({revision:2}),idleReport());assert.equal(h.root.dataset.lastReport,undefined);
  h.battle.sync(idleMe({revision:3,mapId:3}),idleReport({from_at:60000,to_at:120000}));assert.equal(JSON.parse(h.root.dataset.lastReport).kills,8);
});

test('hidden-tab report updates keep real HP and replace the pending visual episode with the newest settlement',async()=>{
  const h=idleBattleHarness();h.battle.sync(idleMe());await h.advance(100);h.document.hidden=true;
  h.battle.sync(idleMe({revision:2,hp:10}),idleReport());h.battle.sync(idleMe({revision:3,hp:80}),idleReport({from_at:60000,to_at:120000,kills:2}));
  assert.equal(h.root.querySelector('.hbars .h i').style.transform,'scaleX(0.8)');assert.equal(JSON.parse(h.root.dataset.lastReport).kills,2);assert.equal(h.battle.state.queue.length,1);
  h.document.hidden=false;await h.advance(8000);assert.equal(h.battle.state.queue.length,0);assert.deepEqual(h.errors,[]);
});

test('cancelling a full attack cannot let its delayed recovery alter the next character scene',async()=>{
  for(const baseClass of ['sword','mage','archer']){
    const h=idleBattleHarness({reducedMotion:false,random:()=>0});h.battle.sync(idleMe({baseClass}));await h.advance(2400);
    h.battle.sync(idleMe({tgId:'222',baseClass,revision:2,hp:46,mapId:4}));await h.advance(9000);
    assert.equal(h.battle.state.me.character.hp,46);assert.equal(h.battle.state.me.character.tgId,'222');assert.equal(h.root.dataset.lastReport,undefined);assert.deepEqual(h.errors,[]);
  }
});
