import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { freshDb } from './d1-shim.js';
import { T0 } from './helpers.js';
import * as Player from '../src/services/player.js';
import * as Trade from '../src/services/trade.js';
import * as Direct from '../src/services/direct-trade-actions.js';
import { handle } from '../src/index.js';
import { MONSTER_ART_REVISION } from '../src/game/monster-art-compatibility.js';

const RAW='b71122a3-99c0-4d53-8ab7-8ecda9910b4f';
const storageId=raw=>'app:dt_'+raw.replaceAll('-','').toLowerCase();
const gold=(f,id)=>f.db.prepare('SELECT gold FROM rpg_characters WHERE tg_id=?').get(id).gold;
const qty=(f,id)=>f.db.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='scroll_w'").get(id).quantity;
const operations=f=>f.db.prepare('SELECT * FROM rpg_trade_operations WHERE trade_id=? ORDER BY created_at,request_id').all(f.id);
function dbState(f) {
  const names=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name),hash=createHash('sha256');
  for (const name of names) {
    const escaped='"'+name.replaceAll('"','""')+'"';
    hash.update(JSON.stringify([name,f.db.prepare('SELECT * FROM '+escaped+' ORDER BY rowid').all()]));
  }
  return {sha256:hash.digest('hex'),totalChanges:f.db.prepare('SELECT total_changes() AS n').get().n};
}
async function fixture(t,realmId='permanent') {
  const DB=freshDb(),db=DB.sqlite;
  t.after(()=>db.close());
  const env={DB,REALM_CONTEXT:{id:realmId,phase:'ACTIVE'},
    ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};
  for(const [id,name] of [['111','DirectTradeA'],['222','DirectTradeB'],['333','DirectTradeC']]){
    await Player.createCharacter(env,{tgId:id,name,gender:'m',baseClass:'sword'},T0);
    db.prepare('UPDATE rpg_characters SET gold=10000 WHERE tg_id=?').run(id);
    db.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'scroll_w',10)").run(id);
  }
  const opened=await Trade.openTradeStmts(env,{aTg:'111',bTg:'222'},T0);
  await DB.batch(opened.stmts);
  return {DB,db,env,id:opened.id,realmId};
}
function body(f,kind,payload={},id=RAW,offerRev=0,actor='111') {
  return {accountId:actor,realmId:f.realmId,selectedCharacterId:actor,contextEpoch:5,
    tradeId:f.id,kind,requestId:id,offerRev,...payload};
}
async function reject(promise,code) {
  await assert.rejects(promise,error=>error?.code===code,'expected '+code);
}
async function api(f,action,input,actor='111') {
  const response=await handle(new Request('http://rpg/app/api/trade/'+action,{
    method:'POST',headers:{'Content-Type':'application/json','X-Dev-Tg-Id':actor,
      'X-Realm-Id':f.realmId,'X-Monster-Art-Revision':MONSTER_ART_REVISION,
      'X-Debug-Now':String(T0)},body:JSON.stringify(input)
  }),f.env);
  return {status:response.status,data:await response.json()};
}

test('missing original scoped receipt is a byte-stable pure read in permanent and season',async t=>{
  for(const realm of ['permanent','season-a']){
    const f=await fixture(t,realm),before=dbState(f),op=body(f,'gold',{gold:100});
    const r=await Direct.receipt(f.env,'111',op,T0);
    assert.equal(r.found,false);assert.equal(r.status,'missing');assert.equal(r.recoveryAllowed,true);
    assert.equal(r.receipt,null);assert.equal(r.result,null);assert.deepEqual(dbState(f),before);
  }
});
test('typed scoped gold receipt commits in the original atomic operation and replays without a second economic effect',async t=>{
  const f=await fixture(t),op=body(f,'gold',{gold:100});
  const committed=await Direct.run(f.env,'111',op,T0);
  assert.equal(committed.found,true);assert.equal(committed.replayed,false);assert.equal(committed.result.gold,100);
  assert.equal(gold(f,'111'),9900);assert.equal(operations(f).length,1);
  const record=JSON.parse(operations(f)[0].result_json);
  assert.equal(record.receiptType,'scoped-direct-trade-v1');assert.equal(record.signature,committed.signature);
  assert.equal(record.kind,'gold');assert.equal(record.requestId,RAW);assert.equal(record.accountId,'111');
  assert.equal(record.offerRev,0);assert.deepEqual(record.payload,{gold:100});
  const before=dbState(f);
  const replay=await Direct.run(f.env,'111',op,T0);
  assert.equal(replay.replayed,true);assert.deepEqual(replay.result,committed.result);
  assert.equal((await Direct.receipt(f.env,'111',op,T0)).status,'committed');
  assert.deepEqual(dbState(f),before);
});
test('same UUID changed action, gold, offerRev or account cannot recover another original receipt',async t=>{
  const f=await fixture(t),original=body(f,'gold',{gold:100});
  await Direct.run(f.env,'111',original,T0);
  const before=dbState(f);
  await reject(Direct.run(f.env,'111',body(f,'gold',{gold:900}),T0),'request_reused');
  await reject(Direct.run(f.env,'111',body(f,'add',{item:'scroll_w',qty:1}),T0),'request_reused');
  await reject(Direct.receipt(f.env,'111',body(f,'gold',{gold:100},RAW,1),T0),'request_reused');
  await reject(Direct.receipt(f.env,'111',{...original,accountId:'222'},T0),'account_changed');
  assert.equal(operations(f).length,1);assert.equal(qty(f,'111'),10);assert.deepEqual(dbState(f),before);
});
test('legacy rows cannot masquerade as signed receipts and old API cannot read a scoped row as a legacy operation',async t=>{
  const f=await fixture(t),op=body(f,'gold',{gold:100}),legacyId=storageId(RAW);
  await Trade.setGold(f.env,{tgId:'111',tradeId:f.id,gold:100,requestId:legacyId},T0);
  const before=dbState(f);
  await reject(Direct.receipt(f.env,'111',op,T0),'request_reused');
  await reject(Direct.run(f.env,'111',op,T0),'request_reused');
  assert.deepEqual(dbState(f),before);
  const another=await fixture(t),signed=body(another,'gold',{gold:100});
  await Direct.run(another.env,'111',signed,T0);
  await reject(Trade.setGold(another.env,{tgId:'111',tradeId:another.id,gold:100,requestId:legacyId},T0),'request_reused');
});
test('distinct signed add/remove actions preserve original item escrow and each typed result',async t=>{
  const f=await fixture(t);
  const a=await Direct.run(f.env,'111',body(f,'add',{item:'scroll_w',qty:3},randomUUID()),T0);
  assert.equal(a.result.added,'scroll_w');assert.equal(a.result.qty,3);
  assert.equal(f.db.prepare("SELECT qty FROM rpg_trade_items WHERE trade_id=? AND kind='item'").get(f.id).qty,3);
  const b=await Direct.run(f.env,'111',body(f,'remove',{item:'scroll_w',qty:1},randomUUID(),1),T0);
  assert.equal(b.result.removed,'scroll_w');assert.equal(b.result.qty,1);
  assert.equal(qty(f,'111'),8);assert.equal(f.db.prepare("SELECT qty FROM rpg_trade_items WHERE trade_id=? AND kind='item'").get(f.id).qty,2);
  assert.equal(operations(f).length,2);
});
test('both locks and original two OKs settle one trade with signed replay and conserved goods',async t=>{
  const f=await fixture(t);
  await Direct.run(f.env,'111',body(f,'add',{item:'scroll_w',qty:2},randomUUID()),T0);
  const rev=1;
  await Direct.run(f.env,'111',body(f,'lock',{},randomUUID(),rev),T0);
  await Direct.run(f.env,'222',body(f,'lock',{},randomUUID(),rev,'222'),T0);
  const first=await Direct.run(f.env,'111',body(f,'confirm',{},randomUUID(),rev),T0);
  assert.equal(first.result.done,false);
  const finalBody=body(f,'confirm',{},randomUUID(),rev,'222');
  const done=await Direct.run(f.env,'222',finalBody,T0);
  assert.equal(done.result.done,true);
  assert.equal((await Trade.tradeView(f.env,f.id,'111',T0)).status,'done');
  assert.equal(qty(f,'111'),8);assert.equal(qty(f,'222'),12);
  const finalNotes=f.db.prepare("SELECT tg_id FROM rpg_outbox WHERE kind='trade_end' AND json_extract(payload_json,'$.tradeId')=? ORDER BY tg_id").all(f.id);
  assert.deepEqual(finalNotes.map(x=>x.tg_id),['111','222'],'one DM per original party after the only final swap');
  const before=dbState(f),replayed=await Direct.run(f.env,'222',finalBody,T0);
  assert.equal(replayed.replayed,true);assert.deepEqual(replayed.result,done.result);
  assert.deepEqual(dbState(f),before);assert.equal(operations(f).length,5);
});
test('signed cancellation returns original escrow once and receipt remains readable when closed',async t=>{
  const f=await fixture(t);
  await Direct.run(f.env,'111',body(f,'gold',{gold:100},randomUUID()),T0);
  await Direct.run(f.env,'111',body(f,'add',{item:'scroll_w',qty:2},randomUUID(),1),T0);
  const request=body(f,'cancel',{},randomUUID(),2),cancelled=await Direct.run(f.env,'222',body(f,'cancel',{},request.requestId,2,'222'),T0);
  assert.equal(cancelled.result.status,'cancelled');assert.equal(gold(f,'111'),10000);
  assert.equal(qty(f,'111'),10);assert.equal((await Trade.tradeView(f.env,f.id,'111',T0)).status,'cancelled');
  const cancelNotes=f.db.prepare("SELECT tg_id FROM rpg_outbox WHERE kind='trade_end' AND json_extract(payload_json,'$.tradeId')=? ORDER BY tg_id").all(f.id);
  assert.deepEqual(cancelNotes.map(x=>x.tg_id),['111','222'],'cancellation notifies each party exactly once');
  const before=dbState(f),again=await Direct.receipt(f.env,'222',body(f,'cancel',{},request.requestId,2,'222'),T0);
  assert.equal(again.found,true);assert.equal(again.result.status,'cancelled');assert.deepEqual(dbState(f),before);
});
test('committed response loss recovers the original typed receipt without posting another operation',async t=>{
  const f=await fixture(t),original=f.env.DB.batch.bind(f.env.DB);
  let failOnce=true;
  f.env.DB.batch=async stmts=>{
    const result=await original(stmts);
    if(failOnce){failOnce=false;throw Error('synthetic_response_lost_after_commit');}
    return result;
  };
  const op=body(f,'gold',{gold:250});
  try {
    const result=await Direct.run(f.env,'111',op,T0);
    assert.equal(result.found,true);assert.equal(result.replayed,true);assert.equal(result.result.gold,250);
    assert.equal(operations(f).length,1);assert.equal(gold(f,'111'),9750);
  } finally {f.env.DB.batch=original;}
});
test('receipt INSERT failure rolls back original money/escrow/ledger, and the same request can be tried after repairing fixture',async t=>{
  const f=await fixture(t),op=body(f,'gold',{gold:100});
  f.db.exec("CREATE TRIGGER deny_new_trade_receipt BEFORE INSERT ON rpg_trade_operations WHEN NEW.request_id LIKE 'app:dt_%' BEGIN SELECT RAISE(ABORT,'synthetic_receipt_denied'); END");
  const before=dbState(f),ledgerBefore=f.db.prepare('SELECT COUNT(*) AS n FROM rpg_ledger').get().n;
  await assert.rejects(Direct.run(f.env,'111',op,T0));
  // SQLite total_changes counts trigger/transaction attempts even if they
  // were rolled back. Authoritative table hashes and actual balances/ledger
  // rows prove conservation, not that diagnostic counter.
  assert.equal(dbState(f).sha256,before.sha256);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rpg_ledger').get().n,ledgerBefore);
  assert.equal(gold(f,'111'),10000);assert.equal(operations(f).length,0);
  f.db.exec('DROP TRIGGER deny_new_trade_receipt');
  const accepted=await Direct.run(f.env,'111',op,T0);
  assert.equal(accepted.result.gold,100);assert.equal(operations(f).length,1);
});
test('stale offer and timed-out window reject unknown new signed intents without lazy expiry writes',async t=>{
  const f=await fixture(t),v=body(f,'gold',{gold:100});
  await Direct.run(f.env,'111',v,T0);
  const before=dbState(f);
  await reject(Direct.run(f.env,'111',body(f,'add',{item:'scroll_w',qty:1},randomUUID(),0),T0),'offer_changed');
  assert.deepEqual(dbState(f),before);
  f.db.prepare('UPDATE rpg_trades SET expires_at=? WHERE id=?').run(T0-1,f.id);
  const due=dbState(f);
  const u=body(f,'add',{item:'scroll_w',qty:1},randomUUID(),1);
  await reject(Direct.run(f.env,'111',u,T0),'closed');
  const missing=await Direct.receipt(f.env,'111',u,T0);
  assert.equal(missing.found,false);assert.equal(missing.recoveryAllowed,false);
  assert.deepEqual(dbState(f),due);
  assert.equal(f.db.prepare('SELECT status FROM rpg_trades WHERE id=?').get(f.id).status,'open');
});
test('foreign trade member, selected actor, realm and malformed UUIDs are rejected before writes',async t=>{
  const f=await fixture(t),before=dbState(f),op=body(f,'gold',{gold:200});
  await reject(Direct.run(f.env,'333',body(f,'gold',{gold:200},RAW,0,'333'),T0),'not_party');
  await reject(Direct.run(f.env,'111',{...op,realmId:'season-a'},T0),'realm_mismatch');
  await reject(Direct.run(f.env,'111',{...op,selectedCharacterId:'222'},T0),'character_changed');
  await reject(Direct.run(f.env,'111',{...op,contextEpoch:-1},T0),'trade_context');
  await reject(Direct.run(f.env,'111',{...op,requestId:'not-an-uuid'},T0),'request');
  assert.deepEqual(dbState(f),before);
});
test('frozen realm can only read or replay original signed receipt, never start missing mutation',async t=>{
  const f=await fixture(t,'season-a'),op=body(f,'gold',{gold:200});
  await Direct.run(f.env,'111',op,T0);
  f.env.REALM_CONTEXT.phase='FROZEN';
  const before=dbState(f);
  assert.equal((await Direct.receipt(f.env,'111',op,T0)).found,true);
  assert.equal((await Direct.run(f.env,'111',op,T0)).replayed,true);
  await reject(Direct.run(f.env,'111',body(f,'gold',{gold:900},randomUUID(),1),T0),'realm_read_only');
  assert.deepEqual(dbState(f),before);
});
test('real Mini App trade/receipt and trade/action-scoped routes keep raw UUID and actor authentication',async t=>{
  const f=await fixture(t),op=body(f,'gold',{gold:100});
  const missing=await api(f,'receipt',op);
  assert.equal(missing.status,200,JSON.stringify(missing.data));assert.equal(missing.data.found,false);
  const submitted=await api(f,'action-scoped',op);
  assert.equal(submitted.status,200,JSON.stringify(submitted.data));assert.equal(submitted.data.found,true);
  assert.equal(submitted.data.requestId,RAW);assert.equal(submitted.data.result.gold,100);
  const before=dbState(f),saved=await api(f,'receipt',op);
  assert.equal(saved.status,200);assert.equal(saved.data.receipt.requestId,RAW);assert.deepEqual(dbState(f),before);
});
test('same signed UUID in two isolated realm DBs never crosses source, scope or ledger',async t=>{
  const p=await fixture(t,'permanent'),s=await fixture(t,'season-a');
  const pp=body(p,'gold',{gold:100}),ss=body(s,'gold',{gold:200});
  await Direct.run(p.env,'111',pp,T0);await Direct.run(s.env,'111',ss,T0);
  const pa=dbState(p),sa=dbState(s);
  assert.equal((await Direct.receipt(p.env,'111',pp,T0)).result.gold,100);
  assert.equal((await Direct.receipt(s.env,'111',ss,T0)).result.gold,200);
  assert.notEqual((await Direct.receipt(p.env,'111',pp,T0)).signature,(await Direct.receipt(s.env,'111',ss,T0)).signature);
  assert.deepEqual(dbState(p),pa);assert.deepEqual(dbState(s),sa);
});

test('parallel same-UUID requests have one signed original receipt and one gold escrow effect',async t=>{
  const f=await fixture(t),op=body(f,'gold',{gold:100});
  const results=await Promise.allSettled(Array.from({length:3},()=>Direct.run(f.env,'111',op,T0)));
  assert(results.some(row=>row.status==='fulfilled'));
  for(const row of results)if(row.status==='rejected')
    assert(['conflict','request_reused'].includes(row.reason?.code),'only original concurrency rejection allowed');
  const saved=await Direct.receipt(f.env,'111',op,T0);
  assert.equal(saved.found,true);assert.equal(saved.result.gold,100);
  assert.equal(gold(f,'111'),9900);assert.equal(operations(f).length,1);
  assert.equal((await Trade.tradeView(f.env,f.id,'111',T0)).offerRev,1);
});
test('explicit same-UUID recovery can finish a missing intent once and cannot change the saved body',async t=>{
  const f=await fixture(t),op=body(f,'gold',{gold:450},RAW,0);
  assert.equal((await Direct.receipt(f.env,'111',op,T0)).recoveryAllowed,true);
  const recovered=await Direct.run(f.env,'111',{...op,recovery:true},T0);
  assert.equal(recovered.found,true);assert.equal(recovered.replayed,false);
  assert.equal(recovered.result.gold,450);assert.equal(gold(f,'111'),9550);
  const before=dbState(f);
  assert.equal((await Direct.run(f.env,'111',{...op,recovery:true},T0)).replayed,true);
  await reject(Direct.run(f.env,'111',{...op,gold:900,recovery:true},T0),'request_reused');
  assert.deepEqual(dbState(f),before);
});
test('a tampered stored result cannot be falsely presented as the original committed amount',async t=>{
  const f=await fixture(t),op=body(f,'gold',{gold:100});
  await Direct.run(f.env,'111',op,T0);
  const saved=JSON.parse(operations(f)[0].result_json);
  saved.result.gold=900;
  f.db.prepare('UPDATE rpg_trade_operations SET result_json=? WHERE trade_id=? AND tg_id=? AND request_id=?')
    .run(JSON.stringify(saved),f.id,'111',storageId(RAW));
  await reject(Direct.receipt(f.env,'111',op,T0),'trade_receipt_corrupt');
  await reject(Direct.run(f.env,'111',op,T0),'trade_receipt_corrupt');
  assert.equal(gold(f,'111'),9900);
});
test('a same-account alternate character switch immediately before commit aborts scoped trade without any escrow effect',async t=>{
  const f=await fixture(t),created=await Player.createCharacter(f.env,{tgId:'111',name:'AltTrade',gender:'f',baseClass:'mage'},T0);
  const alternate=created.char.tg_id;
  assert.notEqual(alternate,'111');
  const originalBatch=f.env.DB.batch.bind(f.env.DB);
  let switched=false;
  f.env.DB.batch=async statements=>{
    if(!switched){
      switched=true;
      f.db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(alternate,'111');
    }
    return originalBatch(statements);
  };
  const ledgerBefore=f.db.prepare('SELECT COUNT(*) AS n FROM rpg_ledger').get().n;
  try {
    await reject(Direct.run(f.env,'111',body(f,'gold',{gold:100}),T0),'character_changed');
  } finally {f.env.DB.batch=originalBatch;}
  assert.equal(switched,true);assert.equal(operations(f).length,0);
  assert.equal(gold(f,'111'),10000);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rpg_ledger').get().n,ledgerBefore);
  assert.equal(f.db.prepare('SELECT offer_rev FROM rpg_trades WHERE id=?').get(f.id).offer_rev,0);
});
