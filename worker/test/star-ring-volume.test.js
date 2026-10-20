import test from 'node:test';import assert from 'node:assert/strict';
import {skillExpedition,NOW} from './star-ring-skill-fixture.js';
import * as E from '../src/game/star-ring.js';import * as R from '../src/services/star-ring.js';import * as P from '../src/services/player.js';
import {makeStarRingGear,starRingEquipmentReward,STAR_RING_GEAR_YIELD as POLICY} from '../src/game/star-ring-gear.js';
import {gearSellPrice,convertWeapon,tradeBlock} from '../src/game/gear.js';import {itemStat,itemExtras} from '../src/game/stats.js';import {equipmentView} from '../src/views.js';import {insertEquipStmt} from '../src/db.js';import {rngFor} from '../src/game/rng.js';
const receipts=f=>f.db.prepare('SELECT * FROM rpg_star_ring_rewards WHERE run_id=? ORDER BY char_id,stage').all(f.id);
const owned=(f,who=f.ids[0])=>f.db.prepare("SELECT * FROM rpg_equipment WHERE source='star_ring' AND tg_id=? ORDER BY id").all(who);
async function fixture(t,version=3){const f=await skillExpedition({version,runTier:40});t.after(f.close);return f;}
function downgrade(f,{empty=false}={}){
 for(const row of receipts(f)){
  const r=JSON.parse(row.reward_json),kept=empty?[]:r.equipment.filter(e=>!e.id.includes(':volume:'));
  for(const e of r.equipment)if(!kept.some(k=>k.id===e.id))f.db.prepare('DELETE FROM rpg_equipment WHERE id=?').run(e.id);
  for(const e of kept){const bonus=JSON.parse(e.bonus_json);delete bonus.starRingYieldVersion;e.bonus_json=JSON.stringify(bonus);f.db.prepare('UPDATE rpg_equipment SET bonus_json=? WHERE id=?').run(e.bonus_json,e.id);}
  r.equipment=kept;if(empty)delete r.gearDrops;else r.gearDrops={...r.gearDrops,version:1,guaranteed:1};
  f.db.prepare('UPDATE rpg_star_ring_rewards SET reward_json=? WHERE run_id=? AND char_id=? AND stage=?').run(JSON.stringify(r),f.id,row.char_id,row.stage);
 }
}
for(const version of [1,2,3])for(const online of [true,false])test(`running v${version}, ${online?'online':'offline'}: next receipt tops up old checkpoints once; sold old gear and original receipts remain untouched`,async t=>{
 const f=await fixture(t,version);await R.view(f.env,f.id,f.ids[0],NOW+2*E.STAGE_MS);downgrade(f);
 const old=receipts(f),prior=owned(f),sold=prior[0];f.db.prepare('DELETE FROM rpg_equipment WHERE id=?').run(sold.id);
 const before=f.state(),gold=f.character().gold;
 if(online){
  await R.view(f.env,f.id,f.ids[0],NOW+3*E.STAGE_MS);
  const r=JSON.parse(receipts(f).find(r=>r.char_id===f.ids[0]&&r.stage===2).reward_json);
  assert.deepEqual(r.gearDrops.catchup,[{stage:0,guaranteed:7},{stage:1,guaranteed:7}]);
  assert.ok(r.equipment.length>=22&&r.equipment.length<=23);
 }
 await Promise.allSettled([R.view(f.env,f.id,f.ids[0],NOW+E.DURATION),R.sweep(f.env,NOW+E.DURATION)]);
 const done=await R.view(f.env,f.id,f.ids[0],NOW+E.DURATION),saved=receipts(f);
 assert.equal(done.status,'complete');assert.deepEqual(saved.filter(r=>r.stage<2),old);
 assert.deepEqual(f.state().actors,before.actors);assert.equal(f.character().gold,gold);
 for(const who of f.ids){
  const rows=saved.filter(r=>r.char_id===who).map(r=>JSON.parse(r.reward_json)),items=rows.flatMap(r=>r.equipment),catchups=rows.flatMap(r=>r.gearDrops?.catchup||[]);
  assert.deepEqual(catchups,[{stage:0,guaranteed:7},{stage:1,guaranteed:7}]);assert.ok(items.length>=48&&items.length<=55);
  assert.equal(new Set(items.map(e=>e.id)).size,items.length);
  assert.equal(owned(f,who).length,items.length-Number(who===f.ids[0]));
  const dm=JSON.parse(f.db.prepare("SELECT payload_json FROM rpg_outbox WHERE kind='star_ring_complete' AND tg_id=?").get(who).payload_json);
  assert.deepEqual(dm.rewards.equipment,items);
 }
 assert.equal(f.db.prepare('SELECT 1 FROM rpg_equipment WHERE id=?').get(sold.id),undefined);
 await R.view(f.env,f.id,f.ids[0],NOW+E.DURATION+1);assert.deepEqual(receipts(f),saved);
});
test('pre-guarantee legacy stages receive eight missing items, with rollback/retry keeping awards and catchup receipt atomic',async t=>{
 const f=await fixture(t);await R.view(f.env,f.id,f.ids[0],NOW+E.STAGE_MS);downgrade(f,{empty:true});
 const old=receipts(f),batch=f.env.DB.batch.bind(f.env.DB);let failed=false;
 f.env.DB.batch=async stmts=>{if(!failed&&stmts.some(s=>s.sql.startsWith('INSERT INTO rpg_star_ring_rewards'))){failed=true;return batch([...stmts,f.env.DB.prepare('INSERT INTO no_such_volume_table VALUES(1)')]);}return batch(stmts);};
 await assert.rejects(R.view(f.env,f.id,f.ids[0],NOW+2*E.STAGE_MS));assert.deepEqual(receipts(f),old);assert.equal(owned(f).length,0);
 await R.view(f.env,f.id,f.ids[0],NOW+2*E.STAGE_MS);
 const row=JSON.parse(receipts(f).find(r=>r.char_id===f.ids[0]&&r.stage===1).reward_json);assert.deepEqual(row.gearDrops.catchup,[{stage:0,guaranteed:8}]);assert.ok(owned(f).length>=16);
});
test('completed and departed legacy histories do not get retroactive awards',async t=>{
 const f=await fixture(t);await R.view(f.env,f.id,f.ids[0],NOW+E.STAGE_MS);downgrade(f);
 await R.action(f.env,f.ids[0],{partyId:f.id,action:'leave'},NOW+E.STAGE_MS+1);const left=owned(f);
 await R.view(f.env,f.id,f.ids[1],NOW+E.DURATION);assert.deepEqual(owned(f),left);
 downgrade(f);const rows=receipts(f),gear=owned(f,f.ids[1]);await R.sweep(f.env,NOW+E.DURATION+1);await R.view(f.env,f.id,f.ids[1],NOW+E.DURATION+2);
 assert.deepEqual(receipts(f),rows);assert.deepEqual(owned(f,f.ids[1]),gear);
});
test('volume gear retains exact combat stats, affixes, tradeability and conversion marker; only new reward buyback changes',async t=>{
 const f=await fixture(t),s=f.state(),a=s.actors[0],r=E.simulateStage(s,0),items=starRingEquipmentReward(s,a,0,[],80,r);
 assert.equal(POLICY.minimum,48);assert.ok(POLICY.minimum>720*.03*(1+.4*2));
 assert.ok(items.length>=8&&items.length<=9);
 for(const e of items){const legacy={...e,bonus_json:JSON.stringify({...JSON.parse(e.bonus_json),starRingYieldVersion:undefined})};
  assert.deepEqual(itemStat(e,a.base),itemStat(legacy,a.base));assert.deepEqual(itemExtras(e),itemExtras(legacy));assert.equal(tradeBlock(e),null);
  assert.equal(gearSellPrice(e),Math.max(1,Math.floor(gearSellPrice(legacy)*.18)));assert.match(equipmentView(f.character(),e).sellNote,/18%/);
 }
 for(let i=0;i<100;i++){
  const w=makeStarRingGear({id:'convert',tgId:a.id,cls:a.base,classPath:'A1',level:80,rng:rngFor('volume-convert'+i),now:NOW});if(!w.branch_req)continue;
  w.bonus_json=JSON.stringify({...JSON.parse(w.bonus_json),starRingYieldVersion:2});const converted=convertWeapon(w);assert.equal(JSON.parse(converted.bonus_json).starRingYieldVersion,2);assert.equal(gearSellPrice(converted),gearSellPrice(w));return;
 }
 assert.fail('branch conversion fixture');
});
test('mixed old/new gear sells through real service at displayed prices once; long expedition IDs remain batch-sellable',async t=>{
 const f=await fixture(t);await R.view(f.env,f.id,f.ids[0],NOW+E.STAGE_MS);const newItem=owned(f).find(e=>e.id.length>64);assert.ok(newItem);
 const legacy={...newItem,id:'legacy-volume-control',bonus_json:JSON.stringify({...JSON.parse(newItem.bonus_json),starRingYieldVersion:undefined})};await insertEquipStmt(f.env.DB,legacy).run();
 const before=f.character().gold,expected=gearSellPrice(newItem)+gearSellPrice(legacy),input={itemIds:[newItem.id,legacy.id],requestId:'volume-batch-sale'};
 const sale=()=>P.withPlayer(f.env,f.ids[0],NOW+E.STAGE_MS,(w,c)=>P.sellGearBatch(w,c,input));
 const result=await sale();assert.equal(result.result.gold,expected);assert.equal(f.character().gold,before+expected);await assert.rejects(sale());assert.equal(f.character().gold,before+expected);
 assert.equal(f.db.prepare('SELECT count(*) n FROM rpg_equipment WHERE id IN (?,?)').get(newItem.id,legacy.id).n,0);
 await assert.rejects(P.withPlayer(f.env,f.ids[0],NOW+E.STAGE_MS,(w,c)=>P.sellGearBatch(w,c,{itemIds:['x'.repeat(161)],requestId:'oversized'})),e=>e.code==='selection');
});
test('five already-paid old stages catch up at final settlement without changing other rewards or paid-stage records',async t=>{
 const f=await fixture(t);await R.view(f.env,f.id,f.ids[0],NOW+5*E.STAGE_MS);downgrade(f);const old=receipts(f),reference=f.state();
 const final=E.simulateStage(reference,5);reference.results.push(final);
 await Promise.allSettled([R.view(f.env,f.id,f.ids[0],NOW+E.DURATION),R.view(f.env,f.id,f.ids[1],NOW+E.DURATION)]);
 const done=await R.view(f.env,f.id,f.ids[0],NOW+E.DURATION);assert.deepEqual(receipts(f).filter(r=>r.stage<5),old);assert.deepEqual(f.state().results,reference.results);
 for(const who of f.ids){const row=JSON.parse(receipts(f).find(r=>r.char_id===who&&r.stage===5).reward_json),actor=reference.actors.find(a=>a.id===who),prior=E.stageReward(reference,actor,5,final);
  assert.equal(row.gearDrops.catchup.reduce((n,c)=>n+c.guaranteed,0),35);assert.deepEqual(row.items,prior.items);assert.equal(row.exp,prior.exp);
  assert.ok(owned(f,who).length>=48&&owned(f,who).length<=55);
 }
 assert.equal(done.me.rewards.equipment.length,owned(f).length);
});
