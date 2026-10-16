import test from 'node:test';
import assert from 'node:assert/strict';
import {idleBattleHarness,idleMe,idleReport} from './idle-battle-harness.js';

const enemy=(id,name,hp=100)=>({id,name,mapId:4,hp,maxHp:100,elite:false});
function fixture(round,{ticks=1,reducedMotion=false}={}){
  const h=idleBattleHarness({reducedMotion}),me=idleMe({mapId:4,level:35});
  me.battle.idleCombat={enemies:round.after,round};
  h.battle.sync(me,idleReport({combat:round,ticks,kills:0,elites:0,used:{}}));
  return h;
}
const mk=()=>{const a=enemy('a','海塞壬'),b=enemy('b','潮蟲');
  return {id:'pace',mapId:4,before:[a,b],after:[{...a,hp:70},{...b,hp:60}],events:[
    {type:'hit',targetId:'a',enemy:a,damage:10,beforeHp:100,afterHp:90,skill:false},
    {type:'hit',targetId:'b',enemy:b,damage:20,beforeHp:100,afterHp:80,skill:false},
    {type:'hit',targetId:'a',enemy:a,damage:20,beforeHp:90,afterHp:70,skill:false}]};};

async function hitTimes(h,limit=70000){
  const times=[];let last=null,t=0;
  while(t<limit&&!h.root.dataset.completedRound){await h.advance(50);t+=50;
    const k=h.root.dataset.lastHit;if(k&&k!==last){last=k;times.push(t);}}
  return {times,t,done:h.root.dataset.completedRound};
}

test('a settlement\'s committed hits are spread across the minute, not burst',async()=>{
  const h=fixture(mk());const r=await hitTimes(h);
  assert.equal(r.times.length,3);assert.equal(r.done,'pace');
  assert.ok(r.times[1]-r.times[0]>=8000,'gap '+(r.times[1]-r.times[0]));
  assert.ok(r.times[2]-r.times[1]>=8000);
  assert.ok(r.t<=60000,'finished within a minute: '+r.t);
  assert.deepEqual(h.errors,[]);assert.deepEqual(JSON.parse(h.root.dataset.lastReport).kills,0);
});

test('offline (multi-tick) reports and reduced motion replay without pacing',async()=>{
  const r1=await hitTimes(fixture(mk(),{ticks:30}));
  assert.ok(r1.t<12000,'offline replay fast: '+r1.t);
  const r2=await hitTimes(fixture(mk(),{reducedMotion:true}));
  assert.ok(r2.t<12000);
});

test('between settlements the monsters take no decorative damage or swings',async()=>{
  const h=fixture(mk());await hitTimes(h);
  const hp=h.battle.state.group.map(e=>e.mon.hp);
  await h.advance(20000);
  assert.deepEqual(h.battle.state.group.map(e=>e.mon.hp),hp);assert.deepEqual(h.errors,[]);
});
