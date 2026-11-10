import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW,OWNER,changes,snapshot,put,seedSigils,typedId} from './guardian-scene-fixture.js';
import * as Receipt from '../src/services/guardian-receipt.js';
import * as Guardian from '../src/services/guardian-sigil.js';
import * as Auto from '../src/services/guardian-auto.js';
import {activeSettings} from '../src/game/guardian-sigil-config.js';
import {mulberry32} from '../src/game/rng.js';
import {createCharacter} from '../src/services/player.js';
import {ASSIST_ITEM} from '../src/game/guardian-assist.js';

const count=(f,table)=>f.sql.prepare('SELECT count(*) n FROM '+table).get().n;
const inv=(f,item,tg=f.tg)=>f.sql.prepare('SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item=?').get(tg,item)?.quantity||0;
const unchanged=(f,before,n)=>{assert.deepEqual(snapshot(f.db),before);assert.equal(changes(f.db),n);};
const normal=async(f,n=1,id='guardian-summon-test-001')=>f.body('summon',{pool:'normal',count:n,expectedCosts:(await f.scene()).guardian.quotes.summon.normal.find(q=>q.count===n).expectedCosts},id);
const assertReceipt=async(f,body,first)=>{const before=snapshot(f.db),n=changes(f.db),read=await f.read(body),again=await f.run(body);assert.equal(read.found,true);assert.deepEqual(read.result,first.result);assert.deepEqual(again.result,first.result);assert.equal(again.replayed,true);unchanged(f,before,n);};

test('scene and missing receipt are SELECT-only before welcome, during auto and on frozen realms',async t=>{
 const f=await fixture(t),body=f.body('welcome'),before=snapshot(f.db),n=changes(f.db);
 const scene=await f.scene();assert.equal(scene.guardian.state.welcome.claimed,false);assert.equal(scene.guardian.state.welcome.eligible,true);assert.equal('scene' in scene,false);
 const r=await f.read(body);assert.equal(r.found,false);assert.equal(r.recoveryAllowed,true);
 unchanged(f,before,n);
 f.env.REALM_CONTEXT.phase='FROZEN';
 assert.equal((await f.scene()).guardian.control.writable,false);assert.equal((await f.read(body)).recoveryAllowed,false);
 await assert.rejects(f.run(body),{code:'realm_read_only'});unchanged(f,before,n);
});

test('explicit welcome keeps original account grant and original trigger ledger once under concurrent requests',async t=>{
 const f=await fixture(t),body=f.body('welcome'),output=await Promise.all([f.run(body),f.run(body)]);
 assert.deepEqual(output[0].result,output[1].result);
 assert.deepEqual(output[0].result.welcome,{accountId:OWNER,recipientCharacterId:OWNER,draws:200,createdAt:NOW});
 assert.equal(inv(f,'guardian_free_normal'),200);assert.equal(count(f,'rpg_guardian_welcome'),1);
 await assertReceipt(f,body,output[0]);
 const other=await f.run(f.body('welcome',{},'welcome-again-other-id'));assert.deepEqual(other.result,output[0].result);assert.equal(inv(f,'guardian_free_normal'),200);
 const before=snapshot(f.db),n=changes(f.db);f.sql.prepare("UPDATE rpg_ledger SET item_delta=199 WHERE event_id=?").run('guardian-welcome:'+OWNER);
 await assert.rejects(f.read(body),{code:'guardian_receipt_corrupt'});
 assert.notDeepEqual(snapshot(f.db),before);assert.ok(changes(f.db)>n);
});

test('new summon and auto start require explicit welcome without granting or touching resources',async t=>{
 const f=await fixture(t),before=snapshot(f.db),n=changes(f.db);
 await assert.rejects(f.run(await normal(f)),{code:'guardian_welcome_required'});
 await assert.rejects(f.run(f.body('auto-start',{pool:'normal',count:1,targetType:'any',targetRank:6,maxGold:0})),{code:'guardian_welcome_required'});
 unchanged(f,before,n);
});

test('canonical payloads preserve null, false and zero and reject missing full confirmations',async t=>{
 const f=await fixture(t);
 const active=f.body('activate',{itemId:null}),lock=f.body('lock',{itemId:'fixture-item',locked:false}),auto=f.body('auto-start',{pool:'normal',count:1,targetType:'magic',targetRank:0,maxGold:0});
 assert.throws(()=>Receipt.operation('sale',f.body('sale',{characterId:f.tg,itemIds:['x'.repeat(65)],expectedGold:10}),'app'),{code:'guardian_receipt_input'});
 assert.match(Receipt.operation('activate',active,'app').signature,/"itemId":null/);
 assert.match(Receipt.operation('lock',lock,'app').signature,/"locked":false/);
 assert.match(Receipt.operation('auto-start',auto,'app').signature,/"targetRank":0,"maxGold":0/);
 for(const b of [{...active,itemId:undefined},{...lock,locked:undefined},{...auto,maxGold:undefined},{...f.body('assist'),mode:'supply',itemId:'',quantity:1,autoRenew:false,expectedCosts:{gold:0,stones:0}}])assert.throws(()=>Receipt.operation(b.kind,b,'app'),{code:'guardian_receipt_input'});
 const incomplete=await normal(f);delete incomplete.expectedCosts.freeNormalDraws;assert.throws(()=>Receipt.operation(incomplete.kind,incomplete,'app'),{code:'guardian_receipt_input'});
 assert.throws(()=>Receipt.operation('welcome',{...f.body('welcome'),requestId:'scene:app:forged'},'app'),{code:'guardian_receipt_input'});
 await assert.rejects(Guardian.summon(f.env,f.tg,{pool:'normal',count:1,requestId:'scene:app:forged-legacy'},NOW),{code:'request'});
});

test('summon retains original random IDs, full payload and cost ledgers through identical concurrent requests and later sale',async t=>{
 const f=await fixture(t,{welcome:true}),body=await normal(f,5),r=await Promise.all([f.run(body),f.run(body)]);
 assert.deepEqual(r[0].result,r[1].result);assert.equal(inv(f,'guardian_free_normal'),195);
 assert.equal(count(f,'rpg_guardian_sigils'),5);assert.equal(r[0].result.operation.requestId,'scene:app:'+body.requestId);
 const items=(await f.scene()).guardian.state.inventory.items,expectedGold=items.reduce((a,i)=>a+i.sellPrice,0);
 const sold=f.body('sale',{characterId:f.tg,itemIds:items.map(i=>i.id),expectedGold});
 const sale=await f.run(sold);assert.equal(count(f,'rpg_guardian_sigils'),0);await assertReceipt(f,sold,sale);await assertReceipt(f,body,r[0]);
 await assert.rejects(f.read({...body,count:1}),{code:'request_reused'});
 await assert.rejects(f.run(f.body('activate',{itemId:null},body.requestId)),{code:'request_reused'});
 const cfg=activeSettings(f.env);f.env.GUARDIAN_SETTINGS=JSON.stringify({...cfg,enabled:false});
 await assertReceipt(f,body,r[0]);
});

test('live override quotes match original partial-free ten pricing and featured remainder conservation',async t=>{
 const f=await fixture(t,{welcome:true,settings:{normalSingleGold:997,normalTenGold:8123}});
 put(f,'guardian_free_normal',3);
 const body=await normal(f,10),first=await f.run(body);
 assert.deepEqual(first.receipt.costs,{gold:6979,vouchers:0,credits:0,freeNormalDraws:3});
 assert.equal((await f.scene()).guardian.state.balances.gold,100000-6979);
 put(f,'guardian_voucher',2);f.sql.prepare('UPDATE rpg_characters SET guardian_draw_remainder=2 WHERE tg_id=?').run(f.tg);
 const q=(await f.scene()).guardian.quotes.summon.featured.find(q=>q.count===5);
 assert.deepEqual(q.expectedCosts,{gold:0,vouchers:1,credits:5,freeNormalDraws:0});assert.equal(q.after.remainder,2);
 const b=f.body('summon',{pool:'featured',count:5,expectedCosts:q.expectedCosts},'featured-credit-001'),r=await f.run(b);
 assert.equal(inv(f,'guardian_voucher'),1);assert.equal((await f.scene()).guardian.state.balances.remainder,2);await assertReceipt(f,b,r);
});

test('stale expected free costs cannot silently convert into paid summon; no final authority is created',async t=>{
 const f=await fixture(t,{welcome:true}),body=await normal(f,5);put(f,'guardian_free_normal',0);
 const before=snapshot(f.db),n=changes(f.db);await assert.rejects(f.run(body),{code:'guardian_quote_changed'});unchanged(f,before,n);
 assert.equal((await f.read(body)).found,false);assert.equal(count(f,'rpg_guardian_operations'),0);
});

test('fusion success and deterministic original failure retain primary choice, consumed IDs and original fee',async t=>{
 const f=await fixture(t,{welcome:true}),ids=seedSigils(f),cfg=activeSettings(f.env);
 const good=f.body('fuse',{itemIds:[...ids].reverse(),primaryId:ids[2],expectedCosts:{gold:cfg.upgradeGoldFees[0]}},'fusion-success-001'),a=await f.run(good);
 assert.equal(a.result.operation.success,true);assert.equal(a.result.operation.results[0].rank,2);await assertReceipt(f,good,a);
 const high=seedSigils(f,{rank:5,prefix:'fixture-failure'}),chance=cfg.upgradeSuccess[4];
 let seed=0;while(mulberry32(seed)()<chance)seed++;
 const mock=t.mock.method(crypto,'getRandomValues',arr=>{arr.fill(seed);return arr;});
 const bad=f.body('fuse',{itemIds:high,primaryId:high[1],expectedCosts:{gold:cfg.upgradeGoldFees[4]}},'fusion-failure-001');
 let failed;try{failed=await f.run(bad);}finally{mock.mock.restore();}
 assert.equal(failed.result.operation.success,false);assert.equal(failed.result.operation.refundedId,high[1]);assert.equal(failed.result.operation.results[0].id,high[1]);assert.equal(failed.result.operation.consumedIds.length,3);
 await assertReceipt(f,bad,failed);
});

test('activate null, exact false lock, and unbind each preserve original result and protection',async t=>{
 const f=await fixture(t,{welcome:true}),[id]=seedSigils(f,{count:1}),active=f.body('activate',{itemId:id},'activate-card-001');
 await assertReceipt(f,active,await f.run(active));
 const locked=f.body('lock',{itemId:id,locked:true},'lock-card-001');await assertReceipt(f,locked,await f.run(locked));
 const unbind=f.body('unbind',{itemId:id,expectedCosts:{unbind:activeSettings(f.env).unbindScrolls[0]}},'unbind-card-001');
 await assert.rejects(f.run(unbind),{code:'protected'});
 const unlocked=f.body('lock',{itemId:id,locked:false},'unlock-card-001');await assertReceipt(f,unlocked,await f.run(unlocked));
 const clear=f.body('activate',{itemId:null},'activate-null-001');assert.deepEqual((await f.run(clear)).result.operation.results,[]);
 put(f,'unbind',10);const result=await f.run(unbind);assert.equal(result.result.operation.results[0].bound,false);await assertReceipt(f,unbind,result);
});

test('assist buys, starts, pauses, resumes and records explicit supply false without duplicate stone consumption',async t=>{
 const f=await fixture(t,{welcome:true}),[id]=seedSigils(f,{count:1}),cfg=activeSettings(f.env);
 const body=(mode,fields,requestId)=>f.body('assist',{mode,itemId:'',quantity:1,autoRenew:false,autoBuy:false,expectedCosts:{gold:0,stones:0},...fields},requestId);
 const buy=body('buy',{quantity:2,expectedCosts:{gold:2*cfg.assist.stoneGold,stones:0}},'assist-buy-001');await assertReceipt(f,buy,await f.run(buy));
 const start=body('start',{itemId:id,expectedCosts:{gold:0,stones:1}},'assist-start-001');await assertReceipt(f,start,await f.run(start));
 const stop=body('stop',{},'assist-stop-001');await assertReceipt(f,stop,await f.run(stop));
 const resume=body('start',{itemId:id},'assist-resume-001'),r=await f.run(resume);assert.equal(r.result.operation.resumed,true);assert.equal(inv(f,ASSIST_ITEM),1);await assertReceipt(f,resume,r);
 const supply=body('supply',{autoBuy:false},'assist-supply-false-001');await assertReceipt(f,supply,await f.run(supply));
 assert.equal((await f.scene()).guardian.state.assist.autoBuy,false);
});

test('whole-inventory eligible counts and same-page shop protections survive pagination',async t=>{
 const f=await fixture(t,{welcome:true}),ids=seedSigils(f,{count:45});
 f.sql.prepare('UPDATE rpg_guardian_sigils SET locked=1 WHERE id=?').run(ids[0]);
 f.sql.prepare('UPDATE rpg_guardian_sigils SET active=1,bound=1 WHERE id=?').run(ids[1]);
 const before=snapshot(f.db),n=changes(f.db),a=(await f.scene({quality:'white'})).guardian,b=(await f.scene({quality:'white',cursor:a.state.inventory.nextCursor})).guardian;
 assert.equal(a.state.inventory.items.length,40);assert.equal(b.state.inventory.items.length,5);
 assert.equal(a.state.inventory.eligibleCounts.white,43);assert.deepEqual(a.shop.items,a.state.inventory.items);
 assert.ok(a.state.inventory.items[0].protection.fuse);assert.ok(a.state.inventory.items[1].sellBlock);unchanged(f,before,n);
});

test('typed shells cannot recover a corrupt original full operation, costs or ledger; partial authority stays unresolved',async t=>{
 const f=await fixture(t,{welcome:true}),body=await normal(f),r=await f.run(body),id=r.result.operation.operationId;
 const original=f.sql.prepare('SELECT * FROM rpg_guardian_operations WHERE operation_id=?').get(id);
 f.sql.prepare("UPDATE rpg_guardian_operations SET cost_json='{}' WHERE operation_id=?").run(id);
 await assert.rejects(f.read(body),{code:'guardian_receipt_corrupt'});
 f.sql.prepare('UPDATE rpg_guardian_operations SET cost_json=? WHERE operation_id=?').run(original.cost_json,id);
 f.sql.prepare('UPDATE rpg_ledger SET gold_delta=-999 WHERE event_id=?').run('guardian:'+id);
 await assert.rejects(f.read(body),{code:'guardian_receipt_corrupt'});
 f.sql.prepare('UPDATE rpg_ledger SET gold_delta=0 WHERE event_id=?').run('guardian:'+id);
 f.sql.prepare('DELETE FROM rpg_ledger WHERE event_id=?').run(typedId(body));
 const before=snapshot(f.db),n=changes(f.db),missing=await f.read(body);assert.equal(missing.found,false);assert.equal(missing.recoveryAllowed,false);
 await assert.rejects(f.run(body),{code:'guardian_receipt_unverified'});unchanged(f,before,n);
});

test('atomic typed-receipt abort rolls back original summon rewards, resources and original authority',async t=>{
 const f=await fixture(t,{welcome:true}),body=await normal(f,10);
 f.sql.exec("CREATE TRIGGER fixture_abort_receipt BEFORE INSERT ON rpg_ledger WHEN NEW.type='天使場景操作收據' BEGIN SELECT RAISE(ABORT,'fixture_receipt_failure'); END");
 const before=snapshot(f.db);await assert.rejects(f.run(body),/fixture_receipt_failure/);assert.deepEqual(snapshot(f.db),before);
 assert.equal(count(f,'rpg_guardian_operations'),0);assert.equal(inv(f,'guardian_free_normal'),200);
});

test('auto start snapshot is exact and immutable across real runner steps, stop, seen and later new jobs',async t=>{
 const f=await fixture(t,{welcome:true}),body=f.body('auto-start',{pool:'normal',count:1,targetType:'any',targetRank:6,maxGold:0},'auto-exact-start-001');
 const first=await f.run(body),job=first.result.job;assert.equal(job.characterId,f.tg);assert.equal(job.batches,0);assert.equal(job.maxGold,0);
 const before=snapshot(f.db),n=changes(f.db);await f.scene();await f.read(body);unchanged(f,before,n);
 await Auto.step(f.env,job.id,NOW);assert.ok(f.sql.prepare('SELECT batches FROM rpg_guardian_auto WHERE id=?').get(job.id).batches===1);
 await assertReceipt(f,body,first);
 const stop=f.body('auto-stop',{jobId:job.id},'auto-stop-exact-001'),stopped=await f.run(stop,NOW+1);assert.equal(stopped.result.job.status,'ended');
 const seen=f.body('auto-seen',{jobId:job.id},'auto-seen-exact-001'),seenResult=await f.run(seen,NOW+2);assert.equal(seenResult.result.job.seen,true);
 const next=f.body('auto-start',{pool:'featured',count:5,targetType:'magic',targetRank:0,maxGold:null},'auto-exact-next-001');await f.run(next,NOW+3);
 assert.deepEqual((await f.read(body,NOW+4)).result,first.result);assert.deepEqual((await f.read(stop,NOW+4)).result,stopped.result);assert.deepEqual((await f.read(seen,NOW+4)).result,seenResult.result);
 await assert.rejects(f.read({...body,pool:'featured'}),{code:'request_reused'});
});

test('another current character controls owned source job while receipt preserves both identities and no-op snapshot',async t=>{
 const f=await fixture(t,{welcome:true}),created=await createCharacter(f.env,{tgId:OWNER,name:'天使整合測乙',baseClass:'archer',gender:'f',charSlot:2},NOW),other=created.char.tg_id;
 f.sql.prepare('UPDATE rpg_characters SET level=30 WHERE tg_id=?').run(other);
 const start=f.body('auto-start',{pool:'normal',count:1,targetType:'magic',targetRank:0,maxGold:null},'auto-source-job-001'),a=await f.run(start);
 f.sql.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(other,OWNER);f.tg=other;
 const scene=await f.scene();assert.equal(scene.guardian.auto.sourceCharacter.id,OWNER);
 const stop=f.body('auto-stop',{jobId:a.result.job.id},'other-actor-stop-001'),stopped=await f.run(stop,NOW+1);
 assert.equal(stopped.receipt.scope.characterId,other);assert.equal(stopped.result.job.characterId,OWNER);
 const cfg=activeSettings(f.env);f.env.GUARDIAN_SETTINGS=JSON.stringify({...cfg,enabled:false});
 const again=f.body('auto-stop',{jobId:a.result.job.id},'other-actor-noop-001'),noop=await f.run(again,NOW+2);assert.deepEqual(noop.result,stopped.result);
 const seen=f.body('auto-seen',{jobId:a.result.job.id},'other-actor-seen-001'),done=await f.run(seen,NOW+3);await assertReceipt(f,seen,done);
});

test('captured actor change at original batch boundary blocks action, resources, receipt and outbox',async t=>{
 const f=await fixture(t,{welcome:true}),created=await createCharacter(f.env,{tgId:OWNER,name:'天使整合測丙',baseClass:'sword',gender:'m',charSlot:2},NOW),other=created.char.tg_id;
 const body=await normal(f,10),original=f.db.batch.bind(f.db);let switched=false;
 f.db.batch=async statements=>{
  if(!switched&&statements.some(s=>s.sql?.startsWith('INSERT INTO rpg_guardian_operations('))){switched=true;f.sql.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(other,OWNER);}
  return original(statements);
 };
 const gold=f.sql.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(OWNER).gold,outbox=count(f,'rpg_outbox');
 await assert.rejects(f.run(body),{code:'character_changed'});assert.equal(switched,true);assert.equal(count(f,'rpg_guardian_operations'),0);assert.equal(inv(f,'guardian_free_normal',OWNER),200);assert.equal(count(f,'rpg_outbox'),outbox);assert.equal(f.sql.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(OWNER).gold,gold);
});

for(const family of ['welcome','sale','auto-start','auto-stop','auto-seen'])test('typed receipt abort rolls back the entire original '+family+' transaction',async t=>{
 const f=await fixture(t,{welcome:family!=='welcome'});
 let body;
 if(family==='welcome')body=f.body('welcome');
 else if(family==='sale'){const ids=seedSigils(f,{count:2});body=f.body('sale',{characterId:f.tg,itemIds:ids,expectedGold:20});}
 else {
  const start=f.body('auto-start',{pool:'normal',count:1,targetType:'magic',targetRank:0,maxGold:0},'atomic-auto-start-001');
  if(family==='auto-start')body=start;
  else {
   const created=await f.run(start);
   const stop=f.body('auto-stop',{jobId:created.result.job.id},'atomic-auto-stop-001');
   if(family==='auto-stop')body=stop;
   else {await f.run(stop);body=f.body('auto-seen',{jobId:created.result.job.id},'atomic-auto-seen-001');}
  }
 }
 f.sql.exec("CREATE TRIGGER fixture_abort_family BEFORE INSERT ON rpg_ledger WHEN NEW.type='天使場景操作收據' BEGIN SELECT RAISE(ABORT,'fixture_family_abort'); END");
 const before=snapshot(f.db);await assert.rejects(f.run(body),/fixture_family_abort/);assert.deepEqual(snapshot(f.db),before);assert.equal((await f.read(body)).found,false);
});

test('exact auto source request is saved atomically and a later corrupted job request cannot replace it',async t=>{
 const f=await fixture(t,{welcome:true}),start=f.body('auto-start',{pool:'normal',count:1,targetType:'magic',targetRank:0,maxGold:null},'exact-original-job-001'),created=await f.run(start);
 const stop=f.body('auto-stop',{jobId:created.result.job.id},'exact-original-stop-001'),stopped=await f.run(stop);
 assert.equal(stopped.receipt.authority.jobRequestId,'scene:app:'+start.requestId);
 f.sql.prepare('UPDATE rpg_guardian_auto SET request_id=? WHERE id=?').run('other-corrupted-request',created.result.job.id);
 await assert.rejects(f.read(stop),{code:'guardian_receipt_corrupt'});
 await assert.rejects(f.read(start),{code:'guardian_receipt_corrupt'});
});

test('a disconnected final batch is recovered using the exact committed receipt without a new summon or ledger',async t=>{
 const f=await fixture(t,{welcome:true}),body=await normal(f,5),original=f.db.batch.bind(f.db);let lost=false;
 f.db.batch=async statements=>{
  const result=await original(statements);
  if(!lost&&statements.some(s=>s.sql?.startsWith('INSERT INTO rpg_guardian_operations('))){lost=true;throw new Error('fixture_connection_lost_after_commit');}
  return result;
 };
 const first=await f.run(body);assert.equal(lost,true);assert.equal(count(f,'rpg_guardian_operations'),1);assert.equal(inv(f,'guardian_free_normal'),195);
 await assertReceipt(f,body,first);
});
