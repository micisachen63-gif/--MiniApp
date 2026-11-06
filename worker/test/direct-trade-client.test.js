import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import * as Player from '../src/services/player.js';
import * as Trade from '../src/services/trade.js';
import * as Direct from '../src/services/direct-trade-actions.js';

const source=fs.readFileSync(new URL('../public/scene-direct-trade-client.js',import.meta.url),'utf8');
const RAW='8c5b2d26-9211-4a1c-b97e-5929a471c57f';
const makeStorage=()=>{
  const map=new Map();
  return {map,getItem:key=>map.has(key)?map.get(key):null,
    setItem:(key,value)=>{map.set(key,String(value));},removeItem:key=>map.delete(key)};
};
function locks(){
  const locks=new Map(),calls=[];
  return {calls,async request(key,options,fn){
    calls.push({key,options});
    let done;const gate=new Promise(resolve=>{done=resolve;});
    const previous=locks.get(key)||Promise.resolve();
    locks.set(key,previous.then(()=>gate));
    await previous;
    try{return await fn();}finally{done();}
  }};
}
function module(){
  const target={AbortController,console,Date};
  vm.runInNewContext(source,target);
  return target.RpgSceneDirectTradeActions;
}
async function fixture(t){
  const DB=freshDb(),db=DB.sqlite;
  t.after(()=>db.close());
  const env={DB,REALM_CONTEXT:{id:'permanent',phase:'ACTIVE'}};
  for(const [id,name] of [['111','ClientActor'],['222','ClientPeer']]){
    await Player.createCharacter(env,{tgId:id,name,gender:'m',baseClass:'sword'},T0);
    db.prepare('UPDATE rpg_characters SET gold=10000 WHERE tg_id=?').run(id);
    db.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,'scroll_w',10)").run(id);
  }
  const {id}=await Trade.openTradeStmts(env,{aTg:'111',bTg:'222'},T0).then(async x=>(await DB.batch(x.stmts),x));
  const ctx={accountId:'111',realmId:'permanent',characterId:'111',epoch:5};
  const saved=makeStorage(),lockService=locks(),calls=[],notices=[],changed=[];
  const host={
    tradeId:id,storage:saved,locks:lockService,getContext:()=>({...ctx}),current:()=>true,
    requestId:()=>RAW,
    request:async(action,body,options)=>{
      calls.push({action,body,options});
      if(action==='trade/receipt')return Direct.receipt(env,'111',body,T0);
      if(action==='trade/action-scoped')return Direct.run(env,'111',body,T0);
      throw Error('unexpected action '+action);
    },
    onState:s=>notices.push({pending:!!s.pending,busy:s.busy,error:s.error}),
    onChanged:(value,meta)=>changed.push({value,meta})
  };
  const g=module(),client=g.createClient(host);
  const ledger=()=>db.prepare('SELECT * FROM rpg_trade_operations ORDER BY created_at').all();
  const gold=()=>db.prepare("SELECT gold FROM rpg_characters WHERE tg_id='111'").get().gold;
  return {DB,db,env,id,ctx,saved,lockService,calls,notices,changed,host,client,g,ledger,gold};
}
const trade=(f,offerRev=0)=>({id:f.id,status:'open',offerRev,a:{name:'甲方'},b:{name:'乙方'},expiryPendingMaintenance:false});

test('strict canonical payload and signature reject mixed assets, unknown amounts and excess fields',()=>{
  const g=module(),p=g.payloadOf;
  assert.deepEqual(Object.keys(p('lock',{})),[]);
  assert.equal(p('add',{item:'scroll_w',qty:3}).assetKind,'item');
  assert.equal(p('remove',{item:'scroll_w'}).qty,null);
  assert.equal(p('gold',{gold:0}).gold,0);
  for(const [kind,value] of [['gold',{gold:'100'}],['gold',{gold:-1}],['add',{item:'scroll_w',qty:0}],['add',{item:'scroll_w',equipId:'also'}],['lock',{gold:1}],['remove',{item:'scroll_w',qty:-2}]])
    assert.equal(p(kind,value),null);
  const scope={accountId:'111',realmId:'permanent',characterId:'111',tradeId:'t1'};
  assert.notEqual(g.signature(scope,'gold',RAW,0,{gold:1}),g.signature(scope,'gold',RAW,0,{gold:2}));
});

test('original UUID is persisted and read back before one POST, then original receipt clears it',async t=>{
  const f=await fixture(t);f.client.update(trade(f));
  assert.equal(f.client.prepare('gold',{gold:100},trade(f)),true);
  assert.equal(f.client.state.confirm.kind,'gold');
  assert.equal(await f.client.submit(),true);
  assert.equal(f.calls.filter(x=>x.action==='trade/action-scoped').length,1);
  assert.equal(f.calls[0].body.requestId,RAW);
  assert.equal(f.gold(),9900);assert.equal(f.ledger().length,1);
  assert.equal(f.saved.getItem(f.client.storageKey),null);
  assert.equal(f.changed.length,1);
  f.client.dispose();
});

test('transport loss before submission preserves original UUID and recovery resubmits same body only after explicit receipt check',async t=>{
  const f=await fixture(t);f.client.update(trade(f));
  const real=f.host.request;let first=true;
  f.host.request=async(action,body,options)=>{
    if(action==='trade/action-scoped'&&first){first=false;f.calls.push({action,body,options});throw Object.assign(Error('network lost'),{uncertain:true});}
    return real(action,body,options);
  };
  assert(f.client.prepare('gold',{gold:150},trade(f)));
  assert.equal(await f.client.submit(),false);
  assert.equal(f.gold(),10000);const persisted=JSON.parse(f.saved.getItem(f.client.storageKey));
  assert.equal(persisted.requestId,RAW);assert.equal(persisted.attempts,1);
  assert.equal(f.client.state.receipt,null);
  assert.equal(await f.client.checkPending(),true);
  assert.equal(f.client.state.receipt.status,'missing');
  assert.equal(f.client.state.receipt.recoveryAllowed,true);
  assert.equal(f.client.prepareRecovery(),true);
  assert.equal(await f.client.submit(),true);
  assert.equal(f.gold(),9850);assert.equal(f.ledger().length,1);
  const writes=f.calls.filter(x=>x.action==='trade/action-scoped');
  assert.equal(writes.length,2);assert.deepEqual(writes.map(x=>x.body.requestId),[RAW,RAW]);
  assert.equal(writes[0].body.recovery,false);assert.equal(writes[1].body.recovery,true);
  assert.equal(writes[1].body.gold,writes[0].body.gold);
  assert.equal(f.saved.getItem(f.client.storageKey),null);f.client.dispose();
});

test('committed-but-lost response is resolved only by pure receipt and acknowledgement with no second POST',async t=>{
  const f=await fixture(t);f.client.update(trade(f));
  const real=f.host.request;
  f.host.request=async(action,body,options)=>{
    if(action==='trade/action-scoped'){const result=await real(action,body,options);throw Object.assign(Error('response lost'),{uncertain:true,result});}
    return real(action,body,options);
  };
  assert(f.client.prepare('gold',{gold:200},trade(f)));
  assert.equal(await f.client.submit(),false);
  assert.equal(f.gold(),9800);assert.equal(f.ledger().length,1);
  assert.equal(await f.client.checkPending(),true);
  assert.equal(f.client.state.receipt.found,true);
  assert.equal(f.client.prepareRecovery(),false,'known commit is not recoverable');
  assert.equal(await f.client.acknowledge(),true);
  assert.equal(f.saved.getItem(f.client.storageKey),null);
  assert.equal(f.calls.filter(x=>x.action==='trade/action-scoped').length,1);
  f.client.dispose();
});

test('an invalid or forged receipt cannot clear a pending UUID and cannot cause an economic retry',async t=>{
  const f=await fixture(t);f.client.update(trade(f));
  f.host.request=async(action,body)=>action==='trade/action-scoped'
    ?Promise.reject(Error('lost')):({...await Direct.receipt(f.env,'111',body,T0),signature:'tampered'});
  assert(f.client.prepare('gold',{gold:300},trade(f)));
  assert.equal(await f.client.submit(),false);
  const raw=f.saved.getItem(f.client.storageKey);
  assert.equal(await f.client.checkPending(),false);
  assert.equal(f.client.state.receipt,null);
  assert.equal(await f.client.acknowledge(),false);
  assert.equal(f.client.prepareRecovery(),false);
  assert.equal(f.saved.getItem(f.client.storageKey),raw);
  assert.equal(f.gold(),10000);f.client.dispose();
});

test('unknown result never automatically retries when client reopens from persisted storage',async t=>{
  const f=await fixture(t);f.client.update(trade(f));
  f.host.request=async()=>{throw Object.assign(Error('offline'),{uncertain:true});};
  assert(f.client.prepare('gold',{gold:100},trade(f)));
  assert.equal(await f.client.submit(),false);
  const raw=f.saved.getItem(f.client.storageKey);
  f.client.dispose();
  const newHost={...f.host,request:async(action,body)=>{f.calls.push({action,body});return Direct.receipt(f.env,'111',body,T0);}};
  const resumed=f.g.createClient(newHost);
  assert.equal(resumed.pending().requestId,RAW);
  assert.equal(f.calls.filter(x=>x.action==='trade/action-scoped').length,0);
  assert.equal(f.saved.getItem(resumed.storageKey),raw);
  assert.equal(await resumed.checkPending(),true);
  assert.equal(resumed.state.receipt.status,'missing');
  assert.equal(f.gold(),10000);resumed.dispose();
});

test('without native Web Locks, no write is allowed even when storage exists',async t=>{
  const f=await fixture(t);f.client.dispose();
  const host={...f.host,locks:null};
  const c=f.g.createClient(host);c.update(trade(f));
  assert(c.state.lockError);
  assert.equal(c.prepare('gold',{gold:100},trade(f)),false);
  assert.equal(await c.submit(),false);
  assert.equal(f.calls.length,0);assert.equal(f.saved.map.size,0);c.dispose();
});

test('two tabs with the same trade scope cannot create concurrent intents and send distinct UUIDs',async t=>{
  const f=await fixture(t);const sibling=f.g.createClient({...f.host});
  f.client.update(trade(f));sibling.update(trade(f));
  const real=f.host.request;let release;
  const pause=new Promise(resolve=>{release=resolve;});
  let sent=0;
  f.host.request=async(action,body,opts)=>{
    if(action==='trade/action-scoped'){sent++;await pause;}
    return real(action,body,opts);
  };
  // Sibling uses same deferred network while keeping its own client state.
  // Prepare before either tab writes, then contend for the exclusive native lock.
  const secondHost={...f.host},third=f.g.createClient(secondHost);
  third.update(trade(f));
  assert(f.client.prepare('gold',{gold:100},trade(f)));
  assert(third.prepare('gold',{gold:900},trade(f)));
  const first=f.client.submit(),second=third.submit();
  await new Promise(resolve=>setImmediate(resolve));
  release();
  assert.equal(await first,true);assert.equal(await second,false);
  assert.equal(sent,1);assert.equal(f.gold(),9900);assert.equal(f.ledger().length,1);
  f.client.dispose();sibling.dispose();third.dispose();
});

test('A-B-A epoch switch while original result is inflight leaves durable pending untouched',async t=>{
  const f=await fixture(t);f.client.update(trade(f));
  let release;const inFlight=new Promise(resolve=>{release=resolve;});
  const real=f.host.request;
  f.host.request=async(action,body,opts)=>{
    if(action==='trade/action-scoped'){await inFlight;return real(action,body,opts);}
    return real(action,body,opts);
  };
  assert(f.client.prepare('gold',{gold:150},trade(f)));
  const pending=f.client.submit();
  await new Promise(resolve=>setImmediate(resolve));
  f.ctx.epoch=6;f.ctx.epoch=7; // actor returned, context generation did not
  release();
  assert.equal(await pending,false);
  assert(f.saved.getItem(f.client.storageKey));
  assert.equal(f.client.state.lastResult,null);
  f.client.dispose();
});

test('a storage change from another tab cancels stale confirmation and preserves a newer record',async t=>{
  const f=await fixture(t);f.client.update(trade(f));
  assert(f.client.prepare('gold',{gold:100},trade(f)));
  const second=f.g.createClient({...f.host});second.update(trade(f));
  const actual=second.pending();
  assert.equal(actual,null);
  assert(f.client.state.confirm);
  // A pending record is synchronously persisted by the other window.
  assert(second.prepare('gold',{gold:300},trade(f)));
  const request=second.submit();
  await request;
  // This client must not use its earlier review without rechecking storage.
  assert.equal(await f.client.submit(),false);
  assert.equal(f.gold(),9700);assert.equal(f.ledger().length,1);
  f.client.dispose();second.dispose();
});

test('review is invalidated by a newer offerRev without sending or persisting',async t=>{
  const f=await fixture(t);f.client.update(trade(f));
  assert(f.client.prepare('gold',{gold:100},trade(f)));
  assert(f.client.update(trade(f,1)));
  assert.equal(f.client.state.confirm,null);
  assert.equal(await f.client.submit(),false);
  assert.equal(f.saved.map.size,0);f.client.dispose();
});
