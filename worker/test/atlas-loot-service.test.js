import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb,D1Shim} from './d1-shim.js';
import {T0} from './helpers.js';
import * as Player from '../src/services/player.js';
import * as Atlas from '../src/services/atlas.js';
import {createAtlasRun,advanceAtlasRun} from '../src/game/atlas-engine.js';
import {materializeAtlasEquipment,atlasInventoryDrops} from '../src/game/atlas-loot.js';
import {makeGear,convertWeapon} from '../src/game/gear.js';
import {applyEquipmentAbilityPatch} from '../src/realm/asset-preservation.js';
import {loadPlayer,insertEquipStmt} from '../src/db.js';
import {SLOTS} from '../src/game/constants.js';
import {computeStats} from '../src/game/stats.js';
import {mulberry32} from '../src/game/rng.js';

async function fixture(t,{minutes=60}={}){
 const env={DB:freshDb(),ATLAS_ENABLED:'true',REALM_CONTEXT:{id:'permanent',phase:'ACTIVE'}},db=env.DB.sqlite,id='98821';
 t.after(()=>db.close());
 await Player.createCharacter(env,{tgId:id,name:'星圖戰利品驗證',baseClass:'sword',gender:'f'},T0,mulberry32(7));
 db.prepare("UPDATE rpg_characters SET level=120,class_path='A1',gold=100000,last_settle_at=? WHERE tg_id=?").run(T0,id);
 db.prepare('UPDATE rpg_equipment SET is_equipped=0 WHERE tg_id=?').run(id);
 for(const slot of SLOTS){
  const gear=makeGear({id:'actual-'+slot,tgId:id,cls:'sword',slot,kind:'greatsword',tier:12,forceRarity:'advanced',rng:mulberry32(8),now:T0});
  gear.is_equipped=1;gear.enhance_level=4;await insertEquipStmt(env.DB,gear).run();
 }
 let p=await loadPlayer(env.DB,id),stats=computeStats(p.char,p.equipment.filter(e=>e.is_equipped));
 db.prepare('UPDATE rpg_characters SET hp=?,mp=? WHERE tg_id=?').run(stats.maxHp,stats.maxMp,id);
 await Atlas.start(env,id,{requestId:'loot-integration-start',mapId:'laurel_intro',queueMode:'duration',durationMinutes:minutes,supplies:{hp:0,mp:0}},T0);
 const row=db.prepare('SELECT * FROM rpg_atlas_runs').get(),original=JSON.parse(row.state_json);
 // Fix the server RNG only inside this test fixture; API clients cannot supply it.
 const state=createAtlasRun({runId:row.id,realmId:'permanent',seed:20261104,startAt:original.startedAt,durationSeconds:original.durationSeconds,queueMode:'duration',mapId:'laurel_intro',buildId:original.buildId,supports:original.supports,automation:original.automation,snapshot:{...original.snapshot,classPath:'A1'},supplies:{hp:0,mp:0,hpRestore:50,mpRestore:40}});
 db.prepare('UPDATE rpg_atlas_runs SET state_json=? WHERE id=?').run(JSON.stringify(state),row.id);
 return {env,db,id,state,runId:row.id};
}
async function finish(f,at){let out;for(let i=0;i<50;i++){out=await Atlas.settle(f.env,f.id,{runId:f.runId},at);if(out.run.status!=='running'||!out.run.progress.catchingUp)return out;}throw Error('bounded settlement failed to catch up');}
test('new equipment materializes deterministically from frozen run tier/class and rejects inconsistent blueprints',async t=>{
 const f=await fixture(t),advanced=advanceAtlasRun(f.state,f.state.startedAt+3600,{maxSteps:2000});
 const r=advanced.rewards.find(r=>r.equipment?.length);assert.ok(r,'fixture reaches a real earned equipment drop');
 const one=materializeAtlasEquipment(f.state,r,f.id),two=materializeAtlasEquipment(f.state,r,f.id);
 assert.deepEqual(one,two);assert.equal(one[0].tier,1);assert.equal(one[0].source,'atlas');assert.equal(one[0].created_at,(f.state.startedAt+r.elapsedSeconds)*1000);
 assert.equal(JSON.parse(one[0].bonus_json).atlasLootRunId,f.runId);
 for(const patch of [{tier:12},{baseClass:'mage'},{classPath:'B1'},{source:'shop'},{seed:-1},{rulesVersion:'unknown'}])
  assert.throws(()=>materializeAtlasEquipment(f.state,{...r,equipment:[{...r.equipment[0],...patch}]},f.id),{code:'atlas_loot_invalid'});
 assert.throws(()=>atlasInventoryDrops(f.state,{items:{blessed_scroll_w:1}}),{code:'atlas_loot_invalid'});
});
test('eight-hour settle atomically deposits bounded real gear/ordinary scrolls and exact activity totals once',async t=>{
 const f=await fixture(t,{minutes:480}),before=await loadPlayer(f.env.DB,f.id),out=await finish(f,T0+480*60000);
 assert.equal(out.run.status,'completed');assert.equal(out.run.progress.processedSeconds,480*60);
 const state=JSON.parse(f.db.prepare('SELECT state_json FROM rpg_atlas_runs').get().state_json),p=await loadPlayer(f.env.DB,f.id);
 const drops=p.equipment.filter(e=>e.source==='atlas');
 assert.ok(drops.length>0&&drops.length<=48);assert.equal(drops.length,state.totals.equipment);
 assert.ok(drops.every(e=>e.tier===1));assert.equal(new Set(drops.map(e=>e.id)).size,drops.length);
 for(const key of ['scroll_w','scroll_a'])assert.equal((p.inv[key]||0)-(before.inv[key]||0),state.totals.items[key]||0);
 assert.ok(Object.values(state.totals.items).reduce((a,b)=>a+b,0)<=96);
 const sums=Object.fromEntries(f.db.prepare('SELECT kind,SUM(quantity) n FROM rpg_atlas_activity_events GROUP BY kind').all().map(r=>[r.kind,r.n]));
 assert.equal(sums.loot_equipment,drops.length);assert.equal(sums.kill,state.metrics.kills);assert.equal(sums.survival,state.metrics.survivalSeconds);
 assert.equal(sums.encounter,state.metrics.encountersCompleted);assert.equal(sums.completion,state.metrics.mapsCompleted);
 assert.equal(out.scene.run.report.equipment,drops.length);assert.deepEqual(out.scene.run.report.items,state.totals.items);
 const count=f.db.prepare('SELECT COUNT(*) n FROM rpg_ledger').get().n;
 await Atlas.settle(f.env,f.id,{runId:f.runId},T0+481*60000);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_ledger').get().n,count);
 assert.equal((await loadPlayer(f.env.DB,f.id)).equipment.length,p.equipment.length);
 assert.deepEqual((await loadPlayer(f.env.DB,f.id)).inv,p.inv);
});
test('equipment-insert failure rolls back the entire run, inventories, materials, events and reward receipts',async t=>{
 const f=await fixture(t),before=await loadPlayer(f.env.DB,f.id),run=f.db.prepare('SELECT * FROM rpg_atlas_runs').get(),events=f.db.prepare('SELECT COUNT(*) n FROM rpg_atlas_activity_events').get().n,ledger=f.db.prepare('SELECT COUNT(*) n FROM rpg_ledger').get().n;
 f.db.exec("CREATE TRIGGER atlas_loot_fail BEFORE INSERT ON rpg_equipment WHEN NEW.source='atlas' BEGIN SELECT RAISE(ABORT,'atlas-loot-fail'); END");
 await assert.rejects(Atlas.settle(f.env,f.id,{runId:f.runId},T0+60*60000),/atlas-loot-fail/);
 assert.deepEqual(await loadPlayer(f.env.DB,f.id),before);assert.deepEqual(f.db.prepare('SELECT * FROM rpg_atlas_runs').get(),run);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_atlas_activity_events').get().n,events);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_ledger').get().n,ledger);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_atlas_materials').get().n,0);
});
test('manual stop flushes actual sub-minute living time once at the fixed cutoff',async t=>{
 const f=await fixture(t),out=await Atlas.stop(f.env,f.id,{runId:f.runId,requestId:'loot-stop-seventeen'},T0+17000);
 assert.equal(out.run.status,'stopped');
 const sum=()=>f.db.prepare("SELECT SUM(quantity) n FROM rpg_atlas_activity_events WHERE kind='survival'").get().n;
 assert.equal(sum(),17);
 await Atlas.stop(f.env,f.id,{runId:f.runId,requestId:'loot-stop-seventeen'},T0+31000);assert.equal(sum(),17);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM rpg_equipment WHERE source='atlas'").get().n,0);
});
test('Atlas provenance survives legitimate branch conversion and cannot be removed by an ability patch',()=>{
 const e=makeGear({id:'atlas-provenance',tgId:'1',cls:'sword',slot:'weapon',kind:'greatsword',tier:2,forceRarity:'advanced',rng:mulberry32(4),now:T0,source:'atlas'});
 e.enhance_level=13;const tags={atlasLootVersion:'atlas-loot-v1',atlasLootRunId:'run-a',atlasLootMapId:'laurel_survey',atlasLootRewardId:'reward-a'};
 e.bonus_json=JSON.stringify({...JSON.parse(e.bonus_json),...tags});
 const changed=convertWeapon(e);assert.equal(changed.enhance_level,13);for(const [k,v]of Object.entries(tags))assert.equal(JSON.parse(changed.bonus_json)[k],v);
 assert.throws(()=>applyEquipmentAbilityPatch(e,{bonus_json:'{}'}),{code:'asset_preservation'});
});

test('missing activity migration rejects a new permanent v4 run before any supply reservation',async t=>{
 const db=new D1Shim();t.after(()=>db.sqlite.close());
 for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')&&Number(f.slice(0,4))<=40).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8').replaceAll('\r\n','\n'));
 const env={DB:db,ATLAS_ENABLED:'true',REALM_CONTEXT:{id:'permanent'}},id='98829';
 await Player.createCharacter(env,{tgId:id,name:'舊結構保護',gender:'f',baseClass:'sword'},T0,mulberry32(7));
 const before=await loadPlayer(db,id);
 await assert.rejects(Atlas.start(env,id,{requestId:'schema-pending-start',mapId:'laurel_intro',mapCount:1,durationMinutes:10,supplies:{hp:0,mp:0}},T0),{code:'atlas_schema_pending'});
 assert.deepEqual(await loadPlayer(db,id),before);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM rpg_atlas_runs').get().n,0);
});
