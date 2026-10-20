import test from 'node:test';import assert from 'node:assert/strict';
import {starRingGearDropPlan,starRingEquipmentReward,STAR_RING_GEAR_YIELD as POLICY} from '../src/game/star-ring-gear.js';
import {gearSellPrice} from '../src/game/gear.js';import * as E from '../src/game/star-ring.js';import * as R from '../src/services/star-ring.js';
import {skillExpedition,shortParty,NOW} from './star-ring-skill-fixture.js';import {mkChar,T0} from './helpers.js';
const rich=i=>({grade:'S',expHours:4,defeats:[i*2,i*2+1].flatMap(hourIndex=>[{rank:'elite',hourIndex,serial:1},{rank:'elite',hourIndex,serial:2},{rank:'boss',hourIndex,serial:3}])});
const actor=E.snapshot({char:mkChar({tg_id:'1',base_class:'sword',class_path:'A1',level:80}),equipment:[]});
const state=(seed='yield')=>({id:'ring:yield',seed,engineVersion:3,tier:80,difficulty:'normal',startedAt:T0,endsAt:T0+E.DURATION,actors:[actor],results:Array.from({length:6},(_,i)=>rich(i))});
async function fixture(t,opts={}){const f=await skillExpedition({runTier:40,...opts});t.after(f.close);return f;}
const records=f=>f.db.prepare('SELECT * FROM rpg_star_ring_rewards WHERE run_id=? ORDER BY char_id,stage').all(f.id);
const equipment=f=>f.db.prepare("SELECT * FROM rpg_equipment WHERE source='star_ring' ORDER BY id").all();

test('six checkpoint guarantees, real elite/boss deaths only, one hunt extra per checkpoint and 55 total even with unbounded guardian boost',()=>{
 const s=state(),a={...actor,guardian:{lootBonus:1000}},ids=[];
 for(let i=0;i<6;i++){
  const old=i===5?[{id:'old:0'},{id:'old:1'}]:[],r=rich(i);r.defeats.push(...r.defeats,{rank:'boss',hourIndex:99,serial:1},{rank:'boss',hourIndex:(i+1)*2,serial:999});
  const p=starRingGearDropPlan(s,a,i,r,old);assert.equal(p.guaranteed,8);assert.equal(p.huntExtra,1);assert.equal(p.gradeExtra,i===5?1:0);ids.push(...p.ids);
  for(const empty of [{defeats:[]},{sightings:r.defeats},{defeats:r.defeats.map(d=>({...d,rank:'normal'}))},{defeats:[{rank:'boss',hourIndex:(i+1)*2,serial:1}]}])assert.equal(starRingGearDropPlan(s,a,i,empty,old).huntExtra,0);
 }
 assert.equal(ids.length,POLICY.maximum);assert.equal(new Set(ids).size,55);assert.ok(ids.includes('old:0')&&ids.includes('old:1'));
 for(const version of [1,2])assert.equal(starRingGearDropPlan({...s,engineVersion:version},a,0,rich(0),[]).huntExtra,0);
});

test('private personal equipment stream is deterministic, order-independent and does not mutate departure actors, combat or old grade items',()=>{
 const s=state(),old=[{id:'old:0'},{id:'old:1'}],before=structuredClone(s),original=structuredClone(old),expected=starRingEquipmentReward(s,actor,5,old,80);
 for(const i of [3,0,4,2,1])starRingEquipmentReward(s,{...actor,id:'other'},i,[],80);
 assert.deepEqual(starRingEquipmentReward(s,actor,5,old,80),expected);assert.deepEqual(s,before);assert.deepEqual(old,original);
 assert.deepEqual(expected.slice(0,2).map(e=>e.id),old.map(e=>e.id));assert.ok(expected.every(e=>e.bound===0&&!e.is_equipped&&e.trade_id==null&&e.tier===8&&['legendary','supreme'].includes(e.element_tier)));
});

test('10,000 independent personal drop plans retain bounded economy and 1,000 real Lv120 recipes retain 2% supreme and shop-sale limits',()=>{
 const samples=10000,stats=[];
 for(const difficulty of ['normal','advanced']){
  let total=0,boosted=0,min=Infinity,max=0;
  for(let n=0;n<samples;n++){
   const s={...state('yield-economy-'+n),difficulty};let count=0,boost=0;
   for(let i=0;i<6;i++){
    const old=i===5?E.stageReward(s,actor,i,s.results[i]).equipment:[];
    count+=starRingGearDropPlan(s,actor,i,s.results[i],old).ids.length;
    const b={...actor,guardian:{lootBonus:.5}},oldBoost=i===5?E.stageReward(s,b,i,s.results[i]).equipment:[];
    boost+=starRingGearDropPlan(s,b,i,s.results[i],oldBoost).ids.length;
   }
   assert.ok(count>=48&&count<=55);assert.ok(boost>=count&&boost<=55);total+=count;boosted+=boost;min=Math.min(min,count);max=Math.max(max,count);
  }
  const expected=48+6*(1-.75**2*.95**4)+(difficulty==='advanced'?.6:.35);
  assert.ok(Math.abs(total/samples-expected)<.06);assert.ok(boosted>total);stats.push({difficulty,mean:total/samples,guardian50Mean:boosted/samples,min,max});
 }
 let minted=0,supreme=0,sell=0,maxSale=0;
 for(let n=0;n<1000;n++){
  const s=state('sale-economy-'+n);let sale=0;
  for(let i=0;i<6;i++)for(const e of starRingEquipmentReward(s,actor,i,i===5?[{id:'old:0'}]:[],120)){
   minted++;supreme+=Number(e.element_tier==='supreme');sale+=gearSellPrice(e);assert.ok(gearSellPrice(e)<=1848);
  }
  sell+=sale;maxSale=Math.max(maxSale,sale);
 }
 assert.ok(supreme/minted>.01&&supreme/minted<.03);assert.ok(maxSale<=POLICY.maximum*1848);
 console.log('GEAR_YIELD_ECONOMY '+JSON.stringify({samples,assumption:'4 actual elites + 2 actual bosses each checkpoint, S grade; not live player telemetry',stats,level120:{recipes:minted,supremeRate:supreme/minted,averageSaleGold:sell/1000,maxSampleSaleGold:maxSale,hardSaleGoldCap:POLICY.maximum*1848}}));
});

for(const version of [1,2,3])test(`v${version}: real checkpoints grant gear before completion; online/offline receipts, backpack and DM all match with retry protection`,async t=>{
 const f=await fixture(t,{version}),initial=f.state();
 let previous=0;
 for(let stage=0;stage<6;stage++){
  const p=await R.view(f.env,f.id,f.ids[0],NOW+(stage+1)*E.STAGE_MS),count=p.me.rewards.equipment.length;
  assert.ok(count>=previous+8);assert.equal(p.completedStages,stage+1);previous=count;
  const receipt=JSON.parse(f.db.prepare('SELECT reward_json FROM rpg_star_ring_rewards WHERE run_id=? AND char_id=? AND stage=?').get(f.id,f.ids[0],stage).reward_json);assert.ok(receipt.equipment.every(e=>e.created_at===NOW+(stage+1)*E.STAGE_MS));
  assert.equal(equipment(f).filter(e=>e.tg_id===f.ids[0]).length,count);
 }
 const done=await R.view(f.env,f.id,f.ids[0],NOW+E.DURATION);assert.ok(previous>=48&&previous<=55);assert.deepEqual(f.state().actors,initial.actors);
 const beforeRows=records(f),beforeGear=equipment(f);
 for(const who of f.ids){
  const p=await R.view(f.env,f.id,who,NOW+E.DURATION),message=JSON.parse(f.db.prepare("SELECT payload_json FROM rpg_outbox WHERE kind='star_ring_complete' AND tg_id=?").get(who).payload_json);
  assert.deepEqual(message.rewards,p.me.rewards);assert.deepEqual(p.me.rewards.equipment.map(e=>e.id).sort(),beforeGear.filter(e=>e.tg_id===who).map(e=>e.id).sort());
 }
 await Promise.all([R.sweep(f.env,NOW+E.DURATION+1),R.view(f.env,f.id,f.ids[0],NOW+E.DURATION+1)]);assert.deepEqual(records(f),beforeRows);assert.deepEqual(equipment(f),beforeGear);
 assert.equal(f.db.prepare("SELECT count(*) n FROM rpg_outbox WHERE kind='star_ring_complete'").get().n,5);
});

test('concurrent offline catchup creates one gear set per recipient, immutable 30 receipts and exact five completion payloads',async t=>{
 const f=await fixture(t);await Promise.allSettled([R.view(f.env,f.id,f.ids[0],NOW+E.DURATION),R.view(f.env,f.id,f.ids[1],NOW+E.DURATION),R.sweep(f.env,NOW+E.DURATION)]);
 const done=await R.view(f.env,f.id,f.ids[0],NOW+E.DURATION),saved=records(f),gear=equipment(f);assert.equal(done.status,'complete');assert.equal(saved.length,30);assert.ok(gear.length>=240&&gear.length<=275);assert.equal(new Set(gear.map(e=>e.id)).size,gear.length);
 for(const who of f.ids){const p=await R.view(f.env,f.id,who,NOW+E.DURATION),dm=JSON.parse(f.db.prepare("SELECT payload_json FROM rpg_outbox WHERE kind='star_ring_complete' AND tg_id=?").get(who).payload_json);assert.deepEqual(dm.rewards,p.me.rewards);}
 await R.sweep(f.env,NOW+E.DURATION+1);assert.deepEqual(records(f),saved);assert.deepEqual(equipment(f),gear);
});

test('atomic checkpoint failure cannot leave gear without receipt; retry grants exactly one checkpoint',async t=>{
 const f=await fixture(t),batch=f.env.DB.batch.bind(f.env.DB);let failed=false;
 f.env.DB.batch=async stmts=>{if(!failed&&stmts.some(s=>s.sql.startsWith('INSERT INTO rpg_star_ring_rewards'))){failed=true;return batch([...stmts,f.env.DB.prepare('INSERT INTO no_such_table VALUES(1)')]);}return batch(stmts);};
 await assert.rejects(R.view(f.env,f.id,f.ids[0],NOW+E.STAGE_MS));assert.equal(records(f).length,0);assert.equal(equipment(f).length,0);assert.equal(f.state().results.length,0);
 const p=await R.view(f.env,f.id,f.ids[0],NOW+E.STAGE_MS);assert.equal(p.completedStages,1);assert.equal(records(f).length,5);assert.ok(equipment(f).length>=40&&equipment(f).length<=45);
});

test('leaving mid-expedition retains only completed-stage equipment; no later guarantee or completion DM for the departing player',async t=>{
 const f=await fixture(t),who=f.ids[0];await R.action(f.env,who,{partyId:f.id,action:'leave',requestId:'yield-leave'},NOW+E.STAGE_MS+1);
 const before=equipment(f).filter(e=>e.tg_id===who);assert.ok(before.length>=8&&before.length<=9);await R.sweep(f.env,NOW+E.DURATION);
 assert.deepEqual(equipment(f).filter(e=>e.tg_id===who),before);assert.equal(records(f).filter(r=>r.char_id===who).length,1);assert.equal(f.db.prepare("SELECT count(*) n FROM rpg_outbox WHERE kind='star_ring_complete' AND tg_id=?").get(who).n,0);
});

test('foreground tower keeps live HP, MP and skill config while background gear arrives and its own completion finishes',async t=>{
 const f=await fixture(t),short=await shortParty(f,'tower'),live=f.character(),snapshot=f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(short).state_json;
 const p=await R.view(f.env,f.id,f.ids[0],NOW+E.DURATION),after=f.character();assert.ok(p.me.rewards.equipment.length>=48);
 assert.equal(after.party_id,short);assert.equal(after.hp,live.hp);assert.equal(after.mp,live.mp);assert.equal(after.special_json,live.special_json);assert.equal(f.db.prepare('SELECT state_json FROM rpg_parties WHERE id=?').get(short).state_json,snapshot);
 assert.equal(equipment(f).filter(e=>e.tg_id===f.ids[0]).length,p.me.rewards.equipment.length);
});
