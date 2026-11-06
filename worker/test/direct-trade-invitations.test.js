import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {makeGear} from '../src/game/gear.js';
import {mulberry32} from '../src/game/rng.js';
import {insertEquipStmt} from '../src/db.js';
import * as Player from '../src/services/player.js';
import * as Share from '../src/services/share.js';
import * as Trade from '../src/services/trade.js';
import * as Invite from '../src/services/direct-trade-invitations.js';
import {handle} from '../src/index.js';
import {MONSTER_ART_REVISION} from '../src/game/monster-art-compatibility.js';

const RAW='ea15b275-e09a-4c30-b7c6-107e50bb24c2';
const stamp=uuid=>'app:ti_'+uuid.replaceAll('-','');
const counted=(f,name)=>f.db.prepare('SELECT COUNT(*) AS n FROM '+name).get().n;
function state(f){
  const h=createHash('sha256');
  const tables=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name);
  for(const name of tables){
    const escaped='"'+name.replaceAll('"','""')+'"';
    h.update(JSON.stringify([name,f.db.prepare('SELECT * FROM '+escaped+' ORDER BY rowid').all()]));
  }
  return h.digest('hex');
}
async function fixture(t,realm='permanent'){
  const DB=freshDb(),db=DB.sqlite;
  t.after(()=>db.close());
  const env={DB,REALM_CONTEXT:{id:realm,phase:'ACTIVE'},ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true',ALLOW_DEBUG_TIME:'true'};
  for(const [id,name] of [['111','InviteOwner'],['222','InviteBuyer'],['333','InviteOther']]){
    await Player.createCharacter(env,{tgId:id,name,baseClass:'sword',gender:'m'},T0);
    db.prepare('UPDATE rpg_characters SET gold=10000,level=50 WHERE tg_id=?').run(id);
  }
  const gear=makeGear({id:'invite-gear-1',tgId:'111',cls:'sword',slot:'boots',kind:'boots',
    tier:1,rng:mulberry32(17),now:T0,source:'shop',forceRarity:'common'});
  Object.assign(gear,{bound:0,is_equipped:0});
  await insertEquipStmt(DB,gear).run();
  const share=await Share.shareItem(env,{tgId:'111',equipId:gear.id},T0);
  return {DB,db,env,gear,share,realm};
}
function body(f,who,kind,data={},requestId=RAW){
  return {accountId:who,realmId:f.realm,selectedCharacterId:who,contextEpoch:3,
    kind,requestId,...data};
}
const requestBody=f=>body(f,'222','request',{shareId:f.share.id});
const acceptBody=(f,id,raw=randomUUID())=>body(f,'111','accept',{reqId:id},raw);
const rejectBody=(f,id,raw=randomUUID())=>body(f,'111','reject',{reqId:id},raw);
const withdrawBody=(f,id,raw=randomUUID())=>body(f,'222','withdraw',{reqId:id},raw);
const openBody=f=>body(f,'111','open',{equipId:f.gear.id,targetCharId:'222'});
async function reject(promise,code){
 await assert.rejects(promise,error=>error?.code===code,'Expected '+code);
}

test('missing invitation receipt is truly pure and preserves same original UUID in permanent and season',async t=>{
 for(const realm of ['permanent','season-a']){
  const f=await fixture(t,realm),op=requestBody(f),before=state(f);
  const missing=await Invite.receipt(f.env,'222',op,T0);
  assert.equal(missing.status,'missing');assert.equal(missing.recoveryAllowed,true);
  assert.equal(missing.found,false);assert.equal(missing.result,null);
  assert.equal(state(f),before);
 }
});
test('share request and original typed receipt commit together, and same UUID replays once',async t=>{
 const f=await fixture(t),op=requestBody(f),before=counted(f,'rpg_trade_requests');
 const created=await Invite.run(f.env,'222',op,T0);
 assert.equal(created.found,true);assert.equal(created.replayed,false);
 assert.equal(created.result.reqId,'q'+RAW.replaceAll('-',''));
 assert.equal(created.result.shareId,f.share.id);
 assert.equal(created.result.status,'pending');
 assert.equal(counted(f,'rpg_trade_requests'),before+1);
 const row=f.db.prepare("SELECT result_json FROM rpg_trade_operations WHERE trade_id='direct-trade-invites-v1' AND tg_id='222' AND request_id=?").get(stamp(RAW));
 assert(row);assert.equal(JSON.parse(row.result_json).receiptType,'scoped-direct-trade-invitation-v1');
 const stable=state(f),again=await Invite.run(f.env,'222',op,T0);
 assert.equal(again.replayed,true);assert.deepEqual(again.result,created.result);
 assert.equal((await Invite.receipt(f.env,'222',op,T0)).found,true);
 assert.equal(state(f),stable,'pure replay cannot send another group DM or create another request');
});
test('request UUID rejects changed share, action, actor or world instead of replaying another invite',async t=>{
 const f=await fixture(t),op=requestBody(f);
 await Invite.run(f.env,'222',op,T0);
 const before=state(f);
 await reject(Invite.run(f.env,'222',{...op,shareId:'another-share'},T0),'request_reused');
 await reject(Invite.receipt(f.env,'222',{...body(f,'222','withdraw',{reqId:'q'+RAW.replaceAll('-','')})},T0),'request_reused');
 await reject(Invite.receipt(f.env,'222',{...op,realmId:'season-a'},T0),'realm_mismatch');
 const third=await Invite.receipt(f.env,'333',{...op,accountId:'333',selectedCharacterId:'333'},T0);
 assert.equal(third.found,false,'a foreign actor sees no original receipt');
 assert.equal(third.status,'missing');
 assert.equal(state(f),before);
});
test('original accepted share request opens one pre-escrowed trade and both receipts remain valid',async t=>{
 const f=await fixture(t),asking=requestBody(f);
 const sent=await Invite.run(f.env,'222',asking,T0);
 const op=acceptBody(f,sent.result.reqId);
 const accepted=await Invite.run(f.env,'111',op,T0);
 assert.equal(accepted.found,true);assert.equal(accepted.result.status,'accepted');
 assert.equal(accepted.result.reqId,sent.result.reqId);
 assert.equal(counted(f,'rpg_trades'),1);
 const trade=await Trade.tradeView(f.env,accepted.result.tradeId,'111',T0);
 assert.equal(trade.status,'open');assert.equal(trade.a.lines.length,1);assert.equal(trade.a.lines[0].ref,f.gear.id);
 assert.equal((await Invite.receipt(f.env,'111',op,T0)).found,true);
 const after=state(f);
 assert.equal((await Invite.run(f.env,'111',op,T0)).replayed,true);
 assert.equal((await Invite.receipt(f.env,'222',asking,T0)).found,true);
 assert.equal(state(f),after);
});
test('scoped reject and withdraw produce distinct atomic terminal receipts without escrow creation',async t=>{
 for(const action of ['reject','withdraw']){
  const f=await fixture(t),sent=await Invite.run(f.env,'222',requestBody(f),T0);
  const op=action==='reject'?rejectBody(f,sent.result.reqId):withdrawBody(f,sent.result.reqId);
  const actor=action==='reject'?'111':'222';
  const done=await Invite.run(f.env,actor,op,T0);
  assert.equal(done.result.status,action==='reject'?'rejected':'cancelled');
  assert.equal(counted(f,'rpg_trades'),0);
  const stable=state(f),receipt=await Invite.receipt(f.env,actor,op,T0);
  assert.equal(receipt.found,true);assert.equal((await Invite.run(f.env,actor,op,T0)).replayed,true);
  assert.equal(state(f),stable);
 }
});
test('gear-open scoped UUID is bound to exact target and gear and includes original escrow',async t=>{
 const f=await fixture(t),op=openBody(f);
 const created=await Invite.run(f.env,'111',op,T0);
 assert.equal(created.result.status,'open');assert.equal(created.result.targetCharId,'222');
 const trade=await Trade.tradeView(f.env,created.result.tradeId,'111',T0);
 assert.equal(trade.a.lines[0].ref,f.gear.id);
 const before=state(f);
 assert.equal((await Invite.run(f.env,'111',op,T0)).replayed,true);
 await reject(Invite.run(f.env,'111',{...op,targetCharId:'333'},T0),'request_reused');
 await reject(Invite.run(f.env,'111',{...op,equipId:'new-gear'},T0),'request_reused');
 assert.equal(state(f),before);assert.equal(counted(f,'rpg_trades'),1);
});
test('reply lost after invitation commit only recovers typed original receipt with no second request',async t=>{
 const f=await fixture(t),original=f.env.DB.batch.bind(f.env.DB);
 let once=true;
 f.env.DB.batch=async stmts=>{
  const result=await original(stmts);
  if(once){once=false;throw Error('simulated response transport loss after commit');}
  return result;
 };
 try{
  const value=await Invite.run(f.env,'222',requestBody(f),T0);
  assert.equal(value.replayed,true);assert.equal(value.found,true);
  assert.equal(counted(f,'rpg_trade_requests'),1);
 }finally{f.env.DB.batch=original;}
});
test('atomic invitation receipt insertion failure rolls back original request and outbox',async t=>{
 const f=await fixture(t),op=requestBody(f);
 f.db.exec("CREATE TRIGGER deny_invite_receipt BEFORE INSERT ON rpg_trade_operations WHEN NEW.trade_id='direct-trade-invites-v1' BEGIN SELECT RAISE(ABORT,'synthetic_receipt_rejected'); END");
 const before=state(f),count=counted(f,'rpg_outbox');
 await assert.rejects(Invite.run(f.env,'222',op,T0));
 assert.equal(state(f),before);assert.equal(counted(f,'rpg_trade_requests'),0);
 assert.equal(counted(f,'rpg_outbox'),count);
 f.db.exec('DROP TRIGGER deny_invite_receipt');
 const created=await Invite.run(f.env,'222',op,T0);
 assert.equal(created.found,true);assert.equal(counted(f,'rpg_trade_requests'),1);
});
test('atomic acceptance receipt insertion failure does not escrow equipment or change pending invitation',async t=>{
 const f=await fixture(t),sent=await Invite.run(f.env,'222',requestBody(f),T0);
 const op=acceptBody(f,sent.result.reqId),before=counted(f,'rpg_trade_operations');
 f.db.exec("CREATE TRIGGER deny_invite_accept BEFORE INSERT ON rpg_trade_operations WHEN NEW.trade_id='direct-trade-invites-v1' BEGIN SELECT RAISE(ABORT,'synthetic_accept_receipt_denied'); END");
 const baseline=state(f);
 await assert.rejects(Invite.run(f.env,'111',op,T0));
 assert.equal(state(f),baseline);
 assert.equal(counted(f,'rpg_trades'),0);
 assert.equal(counted(f,'rpg_trade_operations'),before);
 assert.equal(f.db.prepare('SELECT status FROM rpg_trade_requests WHERE id=?').get(sent.result.reqId).status,'pending');
 f.db.exec('DROP TRIGGER deny_invite_accept');
 const accepted=await Invite.run(f.env,'111',op,T0);
 assert.equal(accepted.found,true);assert.equal(counted(f,'rpg_trades'),1);
});
test('expired request is rejected by scoped accept without lazy expiry mutation',async t=>{
 const f=await fixture(t),sent=await Invite.run(f.env,'222',requestBody(f),T0);
 f.db.prepare('UPDATE rpg_trade_requests SET expires_at=? WHERE id=?').run(T0-1,sent.result.reqId);
 const frozen=state(f),op=acceptBody(f,sent.result.reqId);
 await reject(Invite.run(f.env,'111',op,T0),'closed');
 assert.equal(state(f),frozen);
 assert.equal(f.db.prepare('SELECT status FROM rpg_trade_requests WHERE id=?').get(sent.result.reqId).status,'pending');
});
test('frozen season permits exact saved receipt read but no new original invitation write',async t=>{
 const f=await fixture(t,'season-a'),done=await Invite.run(f.env,'222',requestBody(f),T0);
 f.env.REALM_CONTEXT.phase='FROZEN';
 const before=state(f);
 assert.equal((await Invite.receipt(f.env,'222',requestBody(f),T0)).found,true);
 assert.equal((await Invite.run(f.env,'222',requestBody(f),T0)).replayed,true);
 await reject(Invite.run(f.env,'222',body(f,'222','request',{shareId:f.share.id},randomUUID()),T0),'realm_read_only');
 assert.equal(state(f),before);
});
test('Mini App direct invitation scoped and pure receipt use authenticated actor, no legacy replay',async t=>{
 const f=await fixture(t),op=requestBody(f);
 const headers={'Content-Type':'application/json','X-Dev-Tg-Id':'222','X-Realm-Id':f.realm,
   'X-Monster-Art-Revision':MONSTER_ART_REVISION,'X-Debug-Now':String(T0)};
 const send=async(action)=>{
  const res=await handle(new Request('http://local/app/api/trade/'+action,{
    method:'POST',headers,body:JSON.stringify(op)}),f.env);
  return {status:res.status,body:await res.json()};
 };
 const missing=await send('invitation-receipt');
 assert.equal(missing.status,200,JSON.stringify(missing.body));assert.equal(missing.body.found,false);
 const submitted=await send('invitation-scoped');
 assert.equal(submitted.status,200,JSON.stringify(submitted.body));assert.equal(submitted.body.found,true);
 const stable=state(f),receipt=await send('invitation-receipt');
 assert.equal(receipt.status,200);assert.equal(receipt.body.found,true);assert.equal(state(f),stable);
});


test('parallel same original invitation UUID commits one request and one receipt',async t=>{
 const f=await fixture(t),op=requestBody(f);
 const attempts=await Promise.allSettled(Array.from({length:4},()=>Invite.run(f.env,'222',op,T0)));
 assert(attempts.some(x=>x.status==='fulfilled'));
 const receipt=await Invite.receipt(f.env,'222',op,T0);
 assert.equal(receipt.found,true);
 assert.equal(counted(f,'rpg_trade_requests'),1);
 assert.equal(counted(f,'rpg_trade_operations'),1);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM rpg_outbox WHERE kind='trade_request'").get().n,1);
 const old=state(f);
 assert.equal((await Invite.run(f.env,'222',op,T0)).replayed,true);
 assert.equal(state(f),old);
});
test('two concurrent accept attempts cannot create two windows or duplicate escrow',async t=>{
 const f=await fixture(t);
 const asked=await Invite.run(f.env,'222',requestBody(f),T0);
 const op=acceptBody(f,asked.result.reqId);
 const attempts=await Promise.allSettled([Invite.run(f.env,'111',op,T0),Invite.run(f.env,'111',op,T0)]);
 assert(attempts.some(x=>x.status==='fulfilled'));
 const receipt=await Invite.receipt(f.env,'111',op,T0);
 assert.equal(receipt.found,true);
 assert.equal(counted(f,'rpg_trades'),1);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM rpg_trade_items WHERE kind='equip' AND trade_id=?").get(receipt.result.tradeId).n,1);
});
test('a new UUID cannot bypass original pending request uniqueness',async t=>{
 const f=await fixture(t);
 const original=await Invite.run(f.env,'222',requestBody(f),T0);
 const fresh=body(f,'222','request',{shareId:f.share.id},randomUUID());
 const before=state(f);
 await assert.rejects(Invite.run(f.env,'222',fresh,T0));
 assert.equal((await Invite.receipt(f.env,'222',fresh,T0)).found,false);
 assert.equal((await Invite.receipt(f.env,'222',requestBody(f),T0)).result.reqId,original.result.reqId);
 assert.equal(state(f),before);
});


test('same-account alternate character cannot claim an original scoped invitation UUID',async t=>{
 const f=await fixture(t),op=requestBody(f);
 await Invite.run(f.env,'222',op,T0);
 const alt=await Player.createCharacter(f.env,{tgId:'222',name:'InviteAlt',baseClass:'mage',gender:'f'},T0);
 const newId=alt.char.tg_id;
 assert.notEqual(newId,'222');
 f.db.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(newId,'222');
 const foreign={...op,selectedCharacterId:newId};
 const before=state(f);
 await reject(Invite.receipt(f.env,newId,foreign,T0),'request_reused');
 assert.equal(state(f),before);
});
test('tampered invitation result fails closed and cannot silently issue a second request',async t=>{
 const f=await fixture(t),op=requestBody(f);
 await Invite.run(f.env,'222',op,T0);
 const old=f.db.prepare("SELECT result_json FROM rpg_trade_operations WHERE trade_id='direct-trade-invites-v1' AND tg_id='222'").get();
 const changed=JSON.parse(old.result_json);
 changed.result.shareId='fake-share-id';
 f.db.prepare("UPDATE rpg_trade_operations SET result_json=? WHERE trade_id='direct-trade-invites-v1' AND tg_id='222'").run(JSON.stringify(changed));
 const before=state(f);
 await reject(Invite.receipt(f.env,'222',op,T0),'trade_invitation_receipt_corrupt');
 await reject(Invite.run(f.env,'222',op,T0),'trade_invitation_receipt_corrupt');
 assert.equal(state(f),before);
});
