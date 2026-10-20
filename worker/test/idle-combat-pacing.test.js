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
  assert.ok(r.times[1]-r.times[0]>=3000&&r.times[1]-r.times[0]<=5000,'gap '+(r.times[1]-r.times[0]));
  assert.ok(r.times[2]-r.times[1]>=3000&&r.times[2]-r.times[1]<=5000);
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

function killRound(){const a=enemy('a','海塞壬',100),b=enemy('b','潮蟲',100);
  return {id:'kill',mapId:4,before:[a,b],after:[{...a,id:'c'},b],events:[
    {type:'hit',targetId:'a',enemy:a,damage:100,beforeHp:100,afterHp:0,skill:false},
    {type:'spawn',slot:0,enemy:{...a,id:'c'}},
    {type:'hit',targetId:'b',enemy:b,damage:100,beforeHp:100,afterHp:0,skill:false},
    {type:'spawn',slot:1,enemy:{...b,id:'d'}}]};}

test('each kill shows real 經驗值/gold/drop popups that add up to the report totals',async()=>{
  const h=idleBattleHarness(),me=idleMe({mapId:4,level:35}),round=killRound();
  const made=[];const orig=h.document.createElement;h.document.createElement=t=>{const e=orig(t);made.push(e);return e;};
  me.battle.idleCombat={enemies:round.after,round};
  h.battle.sync(me,idleReport({combat:round,ticks:1,kills:2,elites:0,exp_gained:101,gold_gained:55,drops:{scroll:3},used:{}}));
  await hitTimes(h);
  const texts=made.filter(e=>/\bfl\b/.test(e.className||'')).map(e=>({c:e.className,t:e.textContent}));
  const sum=(re)=>texts.filter(x=>re.test(x.c)).reduce((n,x)=>n+Number((x.t.match(/\d+/)||[0])[0]),0);
  assert.equal(sum(/exp/),101);assert.equal(sum(/gold(?!.*scroll)/)-3,55);
  assert.ok(texts.some(x=>x.t.includes('強化卷軸')));
  assert.equal(texts.filter(x=>/exp/.test(x.c)).length,2);assert.deepEqual(h.errors,[]);
});

test('gaps are filled with cosmetic swings that never change monster 生命值',async()=>{
  const h=fixture(mk());await h.advance(1500);
  const hp=()=>h.battle.state.group.map(e=>e.mon?.hp).join();
  const seen=new Set();for(let i=0;i<40;i++){await h.advance(100);seen.add(hp());}
  assert.ok(seen.size<=3);assert.deepEqual(h.errors,[]);
});

async function popups(steps,mutate){
  const h=idleBattleHarness({reducedMotion:false}),round=killRound();if(mutate)mutate(round);
  const made=[];const orig=h.document.createElement;h.document.createElement=t=>{const e=orig(t);made.push(e);return e;};
  const me=idleMe({mapId:4,level:35});me.battle.idleCombat={enemies:round.after,round};
  const rep=idleReport({combat:round,ticks:1,kills:2,elites:0,exp_gained:101,gold_gained:55,drops:{scroll:3},used:{}});
  steps(h,me,rep);
  for(let i=0;i<1400;i++)await h.advance(50);
  assert.deepEqual(h.errors,[]);
  return made.filter(e=>/\bfl\b/.test(e.className||'')).map(e=>e.textContent).filter(t=>!t.startsWith('−'));
}

test('round delivered by the idle feed first, report arriving later, still shows the real kill popups',async()=>{
  const t=await popups((h,me,rep)=>{h.battle.sync(me,null);h.battle.sync(me,rep);});
  assert.equal(t.filter(x=>/經驗值/.test(x)).length,2);assert.ok(t.includes('+50 經驗值'));assert.ok(t.some(x=>x.includes('強化卷軸')));
});

test('summarized round (no per-hit events) still shows the real totals once',async()=>{
  const t=await popups((h,me,rep)=>h.battle.sync(me,rep),r=>{r.events=[];r.summarized=true;});
  assert.deepEqual(t,['+101 經驗值','+55 金幣','強化卷軸 ×3']);
});
