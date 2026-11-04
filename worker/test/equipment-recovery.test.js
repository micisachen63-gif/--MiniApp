import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb,D1Shim} from './d1-shim.js';
import {T0} from './helpers.js';
import {readFileSync,readdirSync} from 'node:fs';
import * as Player from '../src/services/player.js';
import * as Recovery from '../src/services/equipment-recovery.js';
import * as Collection from '../src/services/equipment-collection.js';
import {archiveIdentity,recoveryYield,recoveryReforgeCost,highValueEquipment} from '../src/game/equipment-recovery.js';
import {makeGear,gearOffers,gearSellPrice} from '../src/game/gear.js';
import {insertEquipStmt,loadPlayer} from '../src/db.js';
import {mulberry32} from '../src/game/rng.js';
import {equipmentCollectionCatalog,equipmentCollectionBonuses} from '../src/game/equipment-collection.js';

async function fixture(t,{db=freshDb(),flag='true'}={}){
 const env={DB:db,EQUIPMENT_RECOVERY_ENABLED:flag,EQUIPMENT_COLLECTION_ENABLED:'true',ATLAS_ENABLED:'true',REALM_CONTEXT:{id:'permanent',phase:'ACTIVE'}};
 t.after(()=>db.sqlite.close());
 const p=await Player.createCharacter(env,{tgId:'98801',name:'精煉驗證角色',gender:'f',baseClass:'sword'},T0,mulberry32(3));
 db.sqlite.prepare('UPDATE rpg_characters SET level=120,gold=100000,last_settle_at=? WHERE tg_id=?').run(T0,p.char.tg_id);
 return {env,db:db.sqlite,id:p.char.tg_id};
}
async function add(f,id,options={}){
 const e=makeGear({id,tgId:f.id,cls:'sword',slot:'weapon',kind:'sword',tier:1,rng:mulberry32(24),now:T0,forceRarity:'common',source:'shop',...options});
 if(options.enhance!=null)e.enhance_level=options.enhance;
 await insertEquipStmt(f.env.DB,e).run();return e;
}
async function body(f,mode,items,id='recovery-operation-001'){
 const b={mode,itemIds:items.map(e=>e.id)},p=await Recovery.preview(f.env,f.id,b,T0);
 return {...b,token:p.token,requestId:id,acknowledge:true,confirmHighValue:p.requiresHighValueConfirmation};
}
test('all actual legacy/new equipment offers including branch weapons have stable archive identities; quality recovery is capped',()=>{
 let count=0;
 for(const cls of ['sword','archer','mage','thief'])for(const path of ['','A','B']){
  for(const o of gearOffers({base_class:cls,class_path:path,level:120})){
   const e=makeGear({id:'offer',tgId:'1',cls,slot:o.slot,kind:o.kind,tier:o.tier,rng:()=>.2,now:T0,forceRarity:'common'});
   assert.ok(archiveIdentity(e),JSON.stringify(o));count++;
   for(const source of ['shop','starter','elite','star_ring','atlas','boss'])assert.ok(archiveIdentity({...e,source}));
   assert.ok(recoveryYield({...e,element_tier:'supreme'})<=e.tier*2);
   assert.equal(recoveryYield({...e,source:'starter'}),0);
   assert.ok(recoveryReforgeCost(e).dust>=recoveryYield({...e,element_tier:'supreme'})*5);
   // Shop -> salvage -> direct reforge cannot mint a sellable scroll/currency;
   // the unchanged NPC sell price is below purchase even before the reroll fee.
   assert.ok(gearSellPrice(e)<o.price);
  }
 }
 assert.ok(count>1000);assert.equal(archiveIdentity({slot:'weapon',tier:99}),null);
});
test('first archive persists the full original snapshot and leaves v1 grants untouched; duplicate archive is refused',async t=>{
 const f=await fixture(t),e=await add(f,'archive-original',{enhance:7,forceRarity:'legendary',source:'atlas'});
 const p=await loadPlayer(f.env.DB,f.id),before=equipmentCollectionBonuses(p.char),b=await body(f,'archive',[e]);
 const count=f.db.prepare('SELECT COUNT(*) n FROM rpg_equipment').get().n;
 const result=await Recovery.action(f.env,f.id,b,T0);
 assert.equal(result.result.newEntries,1);assert.equal(result.archivedCount,1);assert.equal(result.dust,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_equipment').get().n,count-1);
 assert.deepEqual(JSON.parse(f.db.prepare('SELECT snapshot_json FROM rpg_equipment_archive').get().snapshot_json),e);
 assert.deepEqual(equipmentCollectionBonuses((await loadPlayer(f.env.DB,f.id)).char),before);
 const e2=await add(f,'archive-duplicate',{enhance:0,forceRarity:'legendary',source:'atlas'});
 await assert.rejects(Recovery.preview(f.env,f.id,{mode:'archive',itemIds:[e2.id]},T0),{code:'archive_exists'});
 assert.ok(f.db.prepare('SELECT id FROM rpg_equipment WHERE id=?').get(e2.id));
});
test('legacy donated snapshots count as discovered archives without consuming another item or granting stats twice',async t=>{
 const f=await fixture(t),c=equipmentCollectionCatalog('sword')[0],r=c.requirements[0];
 const e=await add(f,'legacy-donated',{enhance:r.minEnhance});
 const p=await Collection.preview(f.env,f.id,{collectionId:c.id,requirementId:r.id,itemId:e.id},T0);
 await Collection.submit(f.env,f.id,{collectionId:c.id,requirementId:r.id,itemId:e.id,token:p.token,requestId:'legacy-collection-001'},T0);
 const v=await Recovery.view(f.env,f.id,T0);
 assert.equal(v.archivedCount,1);assert.equal(v.entries[0].origin,'legacy_collection');
 assert.equal(f.db.prepare("SELECT SUM(quantity) n FROM rpg_atlas_activity_events WHERE kind='collection'").get().n,1);
 await Collection.submit(f.env,f.id,{collectionId:c.id,requirementId:r.id,itemId:e.id,token:p.token,requestId:'legacy-collection-001'},T0);
 assert.equal(f.db.prepare("SELECT SUM(quantity) n FROM rpg_atlas_activity_events WHERE kind='collection'").get().n,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_equipment_archive').get().n,0);
 const twin=await add(f,'legacy-twin');await assert.rejects(Recovery.preview(f.env,f.id,{mode:'archive',itemIds:[twin.id]},T0),{code:'archive_exists'});
});
test('safe duplicate suggestion keeps a first copy and excludes enhanced, legacy-needed, worn and starter items',async t=>{
 const f=await fixture(t),one=await add(f,'duplicate-a'),two=await add(f,'duplicate-b'),enhanced=await add(f,'duplicate-c',{enhance:2});
 let v=await Recovery.view(f.env,f.id,T0);
 assert.equal(v.items.find(e=>e.id===enhanced.id).suggestedSalvage,false);
 assert.equal(v.items.find(e=>e.id===enhanced.id).legacyNeeded,true);
 // An enhanced copy is retained, so both ordinary surplus copies may be suggested.
 assert.equal(v.items.find(e=>e.id===one.id).suggestedSalvage,true);assert.equal(v.items.find(e=>e.id===two.id).suggestedSalvage,true);
 for(const e of v.items.filter(e=>e.source==='starter'))assert.equal(e.suggestedSalvage,false);
 assert.ok(v.items.filter(e=>e.suggestedSalvage).every(e=>!e.highValue&&!e.blockedReason));
});
test('50-piece salvage is atomic, replay-safe, bounded per statement and credits actual collection activity once',async t=>{
 const f=await fixture(t),items=[];
 for(let i=0;i<50;i++)items.push(await add(f,'batch-'+i));
 const request=await body(f,'salvage',items,'salvage-batch-fifty');
 const original=f.env.DB.prepare.bind(f.env.DB);let max=0;
 f.env.DB.prepare=(sql)=>{const stmt=original(sql),bind=stmt.bind.bind(stmt);stmt.bind=(...args)=>{max=Math.max(max,args.length);assert.ok(args.length<=100);return bind(...args);};return stmt;};
 const out=await Recovery.action(f.env,f.id,request,T0);assert.equal(out.dust,50);assert.equal(out.result.count,50);assert.ok(max>0);
 const again=await Recovery.action(f.env,f.id,request,T0);assert.equal(again.replayed,true);assert.equal(again.dust,50);
 assert.equal(f.db.prepare("SELECT SUM(quantity) n FROM rpg_atlas_activity_events WHERE kind='reclaim'").get().n,50);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_equipment_recovery_operations').get().n,1);
 await assert.rejects(Recovery.action(f.env,f.id,{...request,mode:'archive'},T0),{code:'request_reused'});
});
test('recovery materials are consumed by real independent-affix reroll, preserving +N and every protected field',async t=>{
 const f=await fixture(t),target=await add(f,'reforge-target',{tier:2,kind:'greatsword',source:'atlas',enhance:13,forceRarity:'legendary'});
 const bonus=JSON.parse(target.bonus_json);target.bonus_json=JSON.stringify({...bonus,atlasLootVersion:'atlas-loot-v1',atlasLootRunId:'snapshot-run',atlasLootMapId:'laurel_survey',atlasLootRewardId:'r1'});
 f.db.prepare('UPDATE rpg_equipment SET bonus_json=? WHERE id=?').run(target.bonus_json,target.id);
 const scraps=[];for(let i=0;i<20;i++)scraps.push(await add(f,'scrap-'+i));
 await Recovery.action(f.env,f.id,await body(f,'salvage',scraps,'feed-reforge'),T0);
 const pre=await loadPlayer(f.env.DB,f.id),b=await body(f,'reforge',[target],'reforge-real-action'),res=await Recovery.action(f.env,f.id,b,T0);
 const row={...f.db.prepare('SELECT * FROM rpg_equipment WHERE id=?').get(target.id)};
 assert.equal(res.dust,0);assert.equal(res.gold,pre.char.gold-60);
 assert.ok(res.result.affixes.after.lines.length>0);
 for(const key of Object.keys(target))if(key!=='affixes_json')assert.deepEqual(row[key],target[key],key);
 assert.equal((await loadPlayer(f.env.DB,f.id)).inv.scroll_r||0,pre.inv.scroll_r||0);
 const replay=await Recovery.action(f.env,f.id,b,T0);assert.equal(replay.replayed,true);assert.equal(replay.gold,res.gold);
 await assert.rejects(Recovery.preview(f.env,f.id,{mode:'reforge',itemIds:[target.id]},T0),{code:'insufficient'});
});
test('token changes, high-value acknowledgement, equipped, escrow, running and processing jobs all preserve target gear',async t=>{
 const f=await fixture(t),e=await add(f,'protected-gear',{enhance:6}),b=await body(f,'salvage',[e],'protected-operation');
 await assert.rejects(Recovery.action(f.env,f.id,{...b,confirmHighValue:false},T0),{code:'recovery_high_value'});
 await assert.rejects(Recovery.action(f.env,f.id,{...b,acknowledge:false},T0),{code:'recovery_confirmation'});
 f.db.prepare('UPDATE rpg_equipment SET bound=1 WHERE id=?').run(e.id);
 await assert.rejects(Recovery.action(f.env,f.id,b,T0),{code:'equipment_changed'});
 f.db.prepare('UPDATE rpg_equipment SET bound=0 WHERE id=?').run(e.id);
 for(const patch of [{is_equipped:1},{trade_id:'escrow'}]){
  const [key,val]=Object.entries(patch)[0];f.db.prepare('UPDATE rpg_equipment SET '+key+'=? WHERE id=?').run(val,e.id);
  await assert.rejects(Recovery.action(f.env,f.id,b,T0));f.db.prepare('UPDATE rpg_equipment SET '+key+'=? WHERE id=?').run(e[key],e.id);
 }
 for(const status of ['running','processing']){
  f.db.prepare('INSERT INTO rpg_auto_enhance(id,owner,tg_id,item_id,item_name,target,blessed,status,level,next_at,created_at,updated_at) VALUES(?,?,?,?,?,15,0,?,?,?, ?,?)').run('recovery-job-'+status,f.id,f.id,e.id,e.name,status,e.enhance_level,T0,T0,T0);
  await assert.rejects(Recovery.action(f.env,f.id,b,T0));f.db.prepare('DELETE FROM rpg_auto_enhance WHERE id=?').run('recovery-job-'+status);
 }
 assert.ok(f.db.prepare('SELECT id FROM rpg_equipment WHERE id=?').get(e.id));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_equipment_recovery_operations').get().n,0);
});
test('receipt failure rolls back all gear, materials, gold and quest activity; concurrent spends have one winner',async t=>{
 const f=await fixture(t),items=[await add(f,'atomic-one'),await add(f,'atomic-two')],b=await body(f,'salvage',items,'atomic-failure');
 f.db.exec("CREATE TRIGGER recovery_fail BEFORE INSERT ON rpg_equipment_recovery_operations BEGIN SELECT RAISE(ABORT,'recovery-fail'); END");
 await assert.rejects(Recovery.action(f.env,f.id,b,T0),/recovery-fail/);
 for(const e of items)assert.ok(f.db.prepare('SELECT id FROM rpg_equipment WHERE id=?').get(e.id));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_equipment_recovery_balances').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_atlas_activity_events').get().n,0);
 f.db.exec('DROP TRIGGER recovery_fail');
 const results=await Promise.allSettled([Recovery.action(f.env,f.id,{...b,requestId:'concurrent-one'},T0),Recovery.action(f.env,f.id,{...b,requestId:'concurrent-two'},T0)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await Recovery.view(f.env,f.id,T0)).dust,2);
});
test('phase cutoff and selected-character changes stop new operations but committed replies survive flag closure',async t=>{
 const f=await fixture(t),e=await add(f,'realm-guard'),b=await body(f,'salvage',[e],'realm-guard-action');
 f.env.REALM_CONTEXT.cutoffAt=T0;await assert.rejects(Recovery.action(f.env,f.id,b,T0),{code:'realm_closed'});delete f.env.REALM_CONTEXT.cutoffAt;
 f.db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run('another-character',f.id);
 await assert.rejects(Recovery.action(f.env,f.id,b,T0),{code:'character_changed'});
 f.db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(f.id,f.id);
 await Recovery.action(f.env,f.id,b,T0);f.env.EQUIPMENT_RECOVERY_ENABLED='false';
 const reply=await Recovery.action(f.env,f.id,b,T0);assert.equal(reply.replayed,true);assert.equal(reply.enabled,false);
});
test('disabled old schema never touches a new recovery table',async t=>{
 const db=new D1Shim();for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')&&Number(x.slice(0,4))<=40).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n'));
 const f=await fixture(t,{db,flag:'false'}),v=await Recovery.view(f.env,f.id,T0);assert.equal(v.enabled,false);
 const e=await add(f,'old-schema-item');await assert.rejects(Recovery.action(f.env,f.id,{mode:'salvage',itemIds:[e.id],requestId:'old-schema-action',token:'a'.repeat(64),acknowledge:true},T0),{code:'equipment_recovery_unavailable'});
});

test('a late equipment mutation inside a multi-item action aborts the whole archive batch',async t=>{
 const f=await fixture(t),one=await add(f,'late-item-one'),two=await add(f,'late-item-two',{slot:'armor'}),b=await body(f,'archive',[one,two],'late-archive-race');
 const original=f.env.DB.batch.bind(f.env.DB);let injected=false;
 f.env.DB.batch=async statements=>{
  if(!injected&&statements.some(s=>s.sql.includes('INSERT INTO rpg_equipment_archive'))){injected=true;f.db.prepare('UPDATE rpg_equipment SET is_equipped=1 WHERE id=?').run(two.id);}
  return original(statements);
 };
 await assert.rejects(Recovery.action(f.env,f.id,b,T0));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_equipment_archive').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM rpg_equipment_recovery_operations').get().n,0);
 for(const e of [one,two])assert.ok(f.db.prepare('SELECT id FROM rpg_equipment WHERE id=?').get(e.id));
});
