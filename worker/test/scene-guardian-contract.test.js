import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fixture, NOW, OWNER, changes, snapshot, put, seedSigils } from './guardian-scene-fixture.js';
import * as Scene from '../src/services/guardian-scene.js';
import * as Scoped from '../src/services/guardian-scoped.js';
import * as Receipt from '../src/services/guardian-receipt.js';
import * as Atlas from '../src/services/atlas.js';
import { createCharacter } from '../src/services/player.js';

const plain = value => JSON.parse(JSON.stringify(value));
const endpoint = 'http://127.0.0.1:9782/app/api/';
const sources = ['scene-live-session.js','scene-guardian-ui.js'].map(name =>
  fs.readFileSync(new URL('../public/' + name,import.meta.url),'utf8'));

// This bridge deliberately uses the real shared session's JSON/headers. The
// transport never fills in missing body fields or rewrites mutation payloads.
async function bridge(t, options = {}) {
  const f = await fixture(t,options);
  const calls = [], committed = [], stored = new Map();
  const h = {f,calls,committed,stored,loseNextWrite:false,dropNextWriteBeforeCommit:false};
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  const sandbox = {AbortController,URL,URLSearchParams,console,Date:Clock,
    crypto:globalThis.crypto,setTimeout,clearTimeout,queueMicrotask};
  vm.createContext(sandbox);
  for (const source of sources) vm.runInContext(source,sandbox);
  const session = sandbox.RpgSceneSession.create({
    endpoint,accountId:OWNER,realmId:'permanent',characterId:OWNER,now:()=>NOW,
    fetch:async(url,options)=>{
      const action=url.slice(endpoint.length),body=JSON.parse(options.body);
      const call={action,body,headers:plain(options.headers)};
      calls.push(call);
      assert.equal(options.method,'POST');
      assert.equal(call.headers['X-Dev-Tg-Id'],OWNER);
      assert.equal(call.headers['X-Realm-Id'],'permanent');
      assert.equal(body.selectedCharacterId,OWNER);
      if(action.startsWith('guardian/')) assert.equal(body.realmId,'permanent');
      if(action==='guardian/action-scoped' && h.dropNextWriteBeforeCommit) {
        h.dropNextWriteBeforeCommit=false;throw Error('Request deliberately never reached the service');
      }
      let value;
      try {
        if(action==='guardian/scene') value=await Scene.view(f.env,body.selectedCharacterId,body,NOW);
        else if(action==='guardian/receipt') value=await Receipt.view(f.env,body.selectedCharacterId,body,NOW,'app');
        else if(action==='guardian/action-scoped') value=await Scoped.run(f.env,body.selectedCharacterId,body,NOW,'app');
        else if(action==='atlas/status') value=await Atlas.status(f.env,body.selectedCharacterId,NOW);
        else throw Error('Unexpected bridge action '+action);
      } catch(error) {
        return {ok:false,status:error.status||400,json:async()=>({ok:false,error:error.code||'bridge_error',message:error.message})};
      }
      call.result=plain(value);
      if(action==='guardian/action-scoped') {
        committed.push(call);
        if(h.loseNextWrite) {h.loseNextWrite=false;throw Error('Committed response deliberately lost');}
      }
      return {ok:true,status:200,json:async()=>plain(value)};
    },
  });
  const client = sandbox.RpgSceneGuardian.createClient({
    getContext:()=>session.getContext(),current:()=>true,
    request:(...args)=>session.request(...args),
    storage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},
  });
  Object.assign(h,{client,session});
  t.after(()=>{client.dispose();session.dispose();});
  return h;
}
async function submit(h,prepare,kind) {
  assert.equal(prepare(),true,h.client.state.error||h.client.state.notice);
  assert.equal(await h.client.submit(),true,h.client.state.error);
  const call=h.committed.at(-1);
  assert.equal(call.body.kind,kind);
  assert.equal(call.result.kind,kind);
  assert.equal(call.result.requestId,call.body.requestId);
  assert.equal(call.result.signature,h.client.state.lastResult.signature);
  assert.equal(h.client.pending(),null);
  assert.equal(h.client.state.stale,false);
  return call;
}
function seed(h,options) {
  const ids=seedSigils(h.f,options);
  h.f.sql.prepare('UPDATE rpg_guardian_operations SET result_json=?,created_at=? WHERE operation_id=?').run(
    JSON.stringify({fixtureOnly:true,notAReceipt:true,status:'synthetic-initial-input',seedIds:ids}),
    NOW-86400000,'fixture-op-'+options.prefix);
  return ids;
}

test('real client/session/SQLite bridge keeps reads pure and recovers the original random summon after a lost response',async t=>{
  const h=await bridge(t),c=h.client,f=h.f;
  put(f,'guardian_voucher',2);
  f.sql.prepare('UPDATE rpg_characters SET guardian_draw_remainder=2 WHERE tg_id=?').run(OWNER);
  const initial=snapshot(f.db),initialChanges=changes(f.db);
  assert.equal(await c.refresh(),true,c.state.error);
  assert.deepEqual(snapshot(f.db),initial);
  assert.equal(changes(f.db),initialChanges);
  assert.equal(c.state.data.guardian.state.welcome.claimed,false);
  assert.equal(c.prepareSummon('normal',5),false);
  assert.equal(h.committed.length,0);

  const welcome=await submit(h,()=>c.prepareWelcome(),'welcome');
  assert.equal(welcome.result.result.welcome.draws,200);
  assert.equal(c.state.data.guardian.state.balances.freeNormalDraws,200);
  const quoted=plain(c.summonQuote('normal',5).expectedCosts);
  assert.equal(c.prepareSummon('normal',5),true,c.state.error);
  h.loseNextWrite=true;
  assert.equal(await c.submit(),false);
  const pending=plain(c.pending()),original=h.committed.at(-1);
  assert.ok(pending.id);
  assert.deepEqual(original.body,pending.wireBody);
  assert.deepEqual(original.body.expectedCosts,quoted);
  assert.match(c.state.error,/待核對/);
  const committed=snapshot(f.db),committedChanges=changes(f.db),writes=h.committed.length;
  assert.equal(await c.checkPending(pending.id),true,c.state.error);
  assert.equal(c.state.receipt.found,true);
  assert.deepEqual(plain(c.state.receipt.result),original.result.result);
  assert.deepEqual(snapshot(f.db),committed);
  assert.equal(changes(f.db),committedChanges);
  assert.equal(h.committed.length,writes);
  assert.equal(c.acknowledge(pending.id),true,c.state.error);
  assert.equal(c.pending(),null);
  assert.equal(c.state.data.guardian.state.balances.freeNormalDraws,195);

  const featuredQuote=plain(c.summonQuote('featured',5));
  const featured=await submit(h,()=>c.prepareSummon('featured',5),'summon');
  assert.deepEqual(featured.body.expectedCosts,featuredQuote.expectedCosts);
  assert.equal(c.state.data.guardian.state.balances.remainder,featuredQuote.after.remainder);
  const read=await h.session.request('guardian/receipt',original.body);
  assert.equal(read.found,true);
  assert.deepEqual(plain(read.result),original.result.result);
  assert.ok(h.calls.some(call=>call.action==='atlas/status'));
});

test('real client/server contract covers fusion, active null, lock false, unbind, assist flags and exact sale IDs',async t=>{
  const h=await bridge(t,{welcome:true}),c=h.client,f=h.f;
  const fusion=seed(h,{prefix:'bridge-fusion',rank:1,count:4,type:'melee'});
  const sale=seed(h,{prefix:'bridge-sale',rank:1,count:1,type:'loot'});
  const bound=seed(h,{prefix:'bridge-bound',rank:2,count:1,bound:1,type:'magic'});
  const support=seed(h,{prefix:'bridge-support',rank:6,count:1,type:'magic'});
  put(f,'unbind',100);put(f,'guardian_summon_stone',3);
  assert.equal(await c.refresh(),true,c.state.error);

  await submit(h,()=>c.prepareLock(sale[0],true),'lock');
  const unlocked=await submit(h,()=>c.prepareLock(sale[0],false),'lock');
  assert.equal(unlocked.body.locked,false);
  await submit(h,()=>c.prepareActivate(support[0]),'activate');
  const started=await submit(h,()=>c.prepareAssist('start',{
    itemId:support[0],quantity:1,autoRenew:false,autoBuy:false}),'assist');
  assert.equal(started.body.autoRenew,false);assert.equal(started.body.autoBuy,false);
  assert.deepEqual(started.body.expectedCosts,{gold:0,stones:1});
  assert.equal(c.state.data.guardian.state.assist.stoneCount,2);
  await submit(h,()=>c.prepareAssist('stop',{autoRenew:false,autoBuy:false}),'assist');
  const deactivated=await submit(h,()=>c.prepareActivate(null),'activate');
  assert.equal(deactivated.body.itemId,null);

  const unbound=await submit(h,()=>c.prepareUnbind(bound[0]),'unbind');
  assert.equal(c.getItem(bound[0]).bound,false);
  assert.equal(c.state.data.guardian.state.balances.unbindScrolls,100-unbound.body.expectedCosts.unbind);
  const fused=await submit(h,()=>c.prepareFuse(fusion[2],fusion),'fuse');
  assert.equal(fused.body.primaryId,fusion[2]);
  assert.deepEqual([...fused.body.itemIds].sort(),[...fusion].sort());
  for(const id of fusion) assert.equal(f.sql.prepare('SELECT id FROM rpg_guardian_sigils WHERE id=?').get(id),undefined);

  const sold=await submit(h,()=>c.prepareSale([sale[0]]),'sale');
  assert.equal(sold.body.characterId,OWNER);
  assert.deepEqual(sold.result.result.sale.items.map(item=>item.id),[sale[0]]);
  assert.equal(sold.result.result.sale.gold,sold.body.expectedGold);
  assert.equal(f.sql.prepare('SELECT id FROM rpg_guardian_sigils WHERE id=?').get(sale[0]),undefined);
  const recovered=await h.session.request('guardian/receipt',fused.body);
  assert.deepEqual(plain(recovered.result),fused.result.result);
});

test('real client/session auto lifecycle preserves explicit zero versus null and reads the exact old job receipt',async t=>{
  const h=await bridge(t,{welcome:true}),c=h.client;
  assert.equal(await c.refresh(),true,c.state.error);
  const first=await submit(h,()=>c.prepareAutoStart({
    pool:'normal',count:1,targetType:'any',targetRank:6,maxGold:0}),'auto-start');
  assert.equal(first.body.maxGold,0);
  const firstJob=first.result.result.job;
  assert.equal(firstJob.maxGold,0);assert.equal(firstJob.status,'running');
  const stopped=await submit(h,()=>c.prepareAutoStop(),'auto-stop');
  assert.equal(stopped.body.jobId,firstJob.id);
  assert.equal(stopped.result.result.job.id,firstJob.id);
  assert.equal(stopped.result.result.job.status,'ended');
  const seen=await submit(h,()=>c.prepareAutoSeen(),'auto-seen');
  assert.equal(seen.body.jobId,firstJob.id);
  assert.equal(seen.result.result.job.seen,true);
  const second=await submit(h,()=>c.prepareAutoStart({
    pool:'normal',count:5,targetType:'magic',targetRank:0,maxGold:null}),'auto-start');
  assert.equal(second.body.maxGold,null);
  assert.notEqual(second.result.result.job.id,firstJob.id);
  const before=snapshot(h.f.db),n=changes(h.f.db);
  const old=await h.session.request('guardian/receipt',first.body);
  assert.equal(old.found,true);
  assert.deepEqual(plain(old.result.job),firstJob);
  assert.equal(old.result.job.status,'running');
  assert.equal(c.autoJob().id,second.result.result.job.id);
  assert.deepEqual(snapshot(h.f.db),before);
  assert.equal(changes(h.f.db),n);
});

test('original welcome recovery can name another owned recipient without granting a second account gift',async t=>{
  const h=await bridge(t),c=h.client,f=h.f;
  assert.equal(await c.refresh(),true,c.state.error);
  assert.equal(c.prepareWelcome(),true,c.state.error);
  h.dropNextWriteBeforeCommit=true;
  assert.equal(await c.submit(),false);
  const original=plain(c.pending());
  assert.equal(h.committed.length,0);

  // Another session for this same account explicitly claims the original gift
  // while A still holds its unknown, never-committed request.
  const created=await createCharacter(f.env,{
    tgId:OWNER,name:'天使贈禮測乙',baseClass:'archer',gender:'f',charSlot:2},NOW);
  const other=created.char.tg_id;
  f.sql.prepare('UPDATE rpg_characters SET level=15,last_settle_at=? WHERE tg_id=?').run(NOW,other);
  f.sql.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(other,OWNER);
  const gifted=await Scoped.run(f.env,other,f.body('welcome',{},'other-owned-welcome-001',other),NOW,'app');
  assert.equal(gifted.result.welcome.recipientCharacterId,other);
  f.sql.prepare('UPDATE rpg_accounts SET active_char_id=? WHERE account_tg_id=?').run(OWNER,OWNER);

  assert.equal(await c.checkPending(original.id),true,c.state.error);
  assert.equal(c.state.receipt.found,false);
  assert.equal(c.state.receipt.recoveryAllowed,true);
  assert.equal(c.prepareRecovery(original.id),true,c.state.error);
  h.loseNextWrite=true;
  assert.equal(await c.submit(),false);
  assert.deepEqual(plain(c.pending().wireBody),original.wireBody);
  const before=snapshot(f.db),n=changes(f.db);
  assert.equal(await c.checkPending(original.id),true,c.state.error);
  assert.equal(c.state.receipt.found,true);
  assert.equal(c.state.receipt.result.welcome.recipientCharacterId,other);
  assert.equal(c.state.receipt.receipt.scope.characterId,OWNER);
  assert.equal(c.acknowledge(original.id),true,c.state.error);
  assert.deepEqual(plain(c.state.lastResult.result),gifted.result);
  assert.equal(c.pending(),null);
  assert.deepEqual(snapshot(f.db),before);assert.equal(changes(f.db),n);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM rpg_guardian_welcome WHERE account_id=?').get(OWNER).n,1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM rpg_ledger WHERE event_id=?").get('guardian-welcome:'+OWNER).n,1);
  assert.equal(f.sql.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='guardian_free_normal'").get(OWNER)?.quantity||0,0);
  assert.equal(f.sql.prepare("SELECT quantity FROM rpg_inventory WHERE tg_id=? AND item='guardian_free_normal'").get(other).quantity,200);
});
