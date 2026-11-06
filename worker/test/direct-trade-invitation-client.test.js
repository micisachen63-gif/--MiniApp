import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {mulberry32} from '../src/game/rng.js';
import {makeGear} from '../src/game/gear.js';
import {insertEquipStmt} from '../src/db.js';
import * as Player from '../src/services/player.js';
import * as Share from '../src/services/share.js';
import * as Invite from '../src/services/direct-trade-invitations.js';

const SOURCE=fs.readFileSync(new URL('../public/scene-direct-trade-invitation-client.js',import.meta.url),'utf8');
const RAW='b554b3cb-f096-4b80-b8ae-c8a945b34e1f';
const RAW2='a6d2ae00-01ce-42c6-b24a-15596765d378';
const storage=()=>{const map=new Map();return {map,getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};};
const locks=()=>{
 const queues=new Map(),calls=[];
 return {calls,async request(key,options,fn){
   calls.push({key,options});
   let release;
   const pending=new Promise(resolve=>release=resolve);
   const previous=queues.get(key)||Promise.resolve();
   queues.set(key,previous.then(()=>pending));await previous;
   try{return await fn();}finally{release();}
 }};
};
function module(){
 const sandbox={AbortController,console,Date};
 vm.runInNewContext(SOURCE,sandbox);
 return sandbox.RpgSceneDirectTradeInvitations;
}
async function setup(t,who='222'){
 const DB=freshDb(),db=DB.sqlite;
 t.after(()=>db.close());
 const env={DB,REALM_CONTEXT:{id:'permanent',phase:'ACTIVE'}};
 for(const [id,name] of [['111','InviteClientOwner'],['222','InviteClientBuyer']]){
  await Player.createCharacter(env,{tgId:id,name:id==='111'?'IClientOwner':'IClientBuyer',baseClass:'sword',gender:'m'},T0);
  db.prepare('UPDATE rpg_characters SET gold=10000 WHERE tg_id=?').run(id);
 }
 const gear=makeGear({id:'invite-client-gear',tgId:'111',cls:'sword',slot:'boots',kind:'boots',tier:1,
   rng:mulberry32(11),now:T0,source:'shop',forceRarity:'common'});
 Object.assign(gear,{is_equipped:0,bound:0});
 await insertEquipStmt(DB,gear).run();
 const share=await Share.shareItem(env,{tgId:'111',equipId:gear.id},T0);
 const ctx={accountId:who,realmId:'permanent',characterId:who,epoch:3};
 const store=storage(),lock=locks(),calls=[],changes=[];
 const host={
  getContext:()=>({...ctx}),current:()=>true,storage:store,locks:lock,requestId:()=>RAW,
  request:async(action,body,options)=>{
   calls.push({action,body,options});
   if(action==='trade/invitation-scoped')return Invite.run(env,who,body,T0);
   if(action==='trade/invitation-receipt')return Invite.receipt(env,who,body,T0);
   throw Error('unexpected action: '+action);
  },
  onChanged:(value,meta)=>changes.push({value,meta})
 };
 const factory=module(),client=factory.createClient(host);
 const count=table=>db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
 return {DB,db,env,who,share,gear,ctx,store,lock,calls,changes,host,factory,client,count};
}
const first=f=>({shareId:f.share.id});

test('canonical payload and signature reject extra fields or different original invitation target',()=>{
 const m=module();
 assert.equal(m.payloadOf('request',{shareId:'s1'}).shareId,'s1');
 assert.equal(m.payloadOf('accept',{reqId:'q1'}).reqId,'q1');
 assert.equal(m.payloadOf('open',{equipId:'x',targetCharId:'222'}).targetCharId,'222');
 for(const [kind,payload]of [['request',{}],['request',{shareId:'s1',extra:true}],['accept',{shareId:'x'}],['open',{equipId:'x'}],['open',{equipId:'x',targetCharId:'222',memo:'unexpected'}]]){
  assert.equal(m.payloadOf(kind,payload),null);
 }
 const ctx={accountId:'111',realmId:'permanent',characterId:'111'};
 assert.notEqual(m.signature(ctx,'request',RAW,{shareId:'s1'}),m.signature(ctx,'request',RAW,{shareId:'s2'}));
});

test('confirmed original share request writes once, verified receipt clears durable pending',async t=>{
 const f=await setup(t);
 assert.equal(f.client.prepare('request',first(f)),true);
 assert.equal(await f.client.submit(),true);
 assert.equal(f.count('rpg_trade_requests'),1);
 assert.equal(f.count('rpg_trade_operations'),1);
 assert.equal(f.calls.filter(x=>x.action==='trade/invitation-scoped').length,1);
 assert.equal(f.calls[0].body.requestId,RAW);
 assert.equal(f.calls[0].body.recovery,false);
 assert.equal(f.store.getItem(f.client.storageKey),null);
 assert.equal(f.changes.length,1);
 f.client.dispose();
});

test('unknown first request with no server dispatch persists original until explicit missing receipt recovery',async t=>{
 const f=await setup(t),real=f.host.request;
 let blocked=true;
 f.host.request=async(action,body,options)=>{
  if(action==='trade/invitation-scoped'&&blocked){blocked=false;f.calls.push({action,body,options});throw Object.assign(Error('preflight transport broke'),{uncertain:true});}
  return real(action,body,options);
 };
 assert.equal(f.client.prepare('request',first(f)),true);
 assert.equal(await f.client.submit(),false);
 assert.equal(f.count('rpg_trade_requests'),0);
 const saved=JSON.parse(f.store.getItem(f.client.storageKey));
 assert.equal(saved.requestId,RAW);assert.equal(saved.attempts,1);
 assert.equal(await f.client.checkPending(),true);
 assert.equal(f.client.state.receipt.found,false);
 assert.equal(f.client.prepareRecovery(),true);
 assert.equal(await f.client.submit(),true);
 assert.equal(f.count('rpg_trade_requests'),1);assert.equal(f.count('rpg_trade_operations'),1);
 const writes=f.calls.filter(x=>x.action==='trade/invitation-scoped');
 assert.equal(writes.length,2);assert.equal(writes[0].body.recovery,false);assert.equal(writes[1].body.recovery,true);
 assert.equal(writes[0].body.requestId,writes[1].body.requestId);
 assert.equal(writes[0].body.shareId,writes[1].body.shareId);
 assert.equal(f.store.getItem(f.client.storageKey),null);
 f.client.dispose();
});

test('committed but lost response is acknowledged from receipt without a second mutation',async t=>{
 const f=await setup(t),real=f.host.request;
 f.host.request=async(action,body,options)=>{
  if(action==='trade/invitation-scoped'){
   const done=await real(action,body,options);
   throw Object.assign(Error('response lost after commit'),{uncertain:true,done});
  }
  return real(action,body,options);
 };
 assert.equal(f.client.prepare('request',first(f)),true);
 assert.equal(await f.client.submit(),false);
 assert.equal(f.count('rpg_trade_requests'),1);
 assert.equal(await f.client.checkPending(),true);
 assert.equal(f.client.state.receipt.found,true);
 assert.equal(f.client.prepareRecovery(),false);
 assert.equal(await f.client.acknowledge(),true);
 assert.equal(f.calls.filter(x=>x.action==='trade/invitation-scoped').length,1);
 assert.equal(f.store.getItem(f.client.storageKey),null);
 f.client.dispose();
});

test('scoped accept from owner runs once and can be reconciled by original receipt after transport loss',async t=>{
 const f=await setup(t,'111');
 const requested=await Invite.run(f.env,'222',{
  accountId:'222',realmId:'permanent',selectedCharacterId:'222',contextEpoch:3,
  kind:'request',requestId:RAW2,shareId:f.share.id
 },T0);
 const operationId=requested.result.reqId;
 const real=f.host.request;
 f.host.request=async(action,body,options)=>{
  if(action==='trade/invitation-scoped'){
   const done=await real(action,body,options);
   throw Object.assign(Error('lost response'),{uncertain:true,done});
  }
  return real(action,body,options);
 };
 assert.equal(f.client.prepare('accept',{reqId:operationId}),true);
 assert.equal(await f.client.submit(),false);
 assert.equal(f.count('rpg_trades'),1);
 assert.equal(await f.client.checkPending(),true);
 assert.equal(f.client.state.receipt.result.status,'accepted');
 assert.equal(await f.client.acknowledge(),true);
 assert.equal(f.count('rpg_trades'),1);
 assert.equal(f.calls.filter(x=>x.action==='trade/invitation-scoped').length,1);
 f.client.dispose();
});

test('fake receipt cannot clear pending intent or submit another action',async t=>{
 const f=await setup(t);
 f.host.request=async(action,body)=>{
  if(action==='trade/invitation-scoped')throw Error('offline');
  return {...await Invite.receipt(f.env,f.who,body,T0),signature:'tampered'};
 };
 assert(f.client.prepare('request',first(f)));
 assert.equal(await f.client.submit(),false);
 const raw=f.store.getItem(f.client.storageKey);
 assert.equal(await f.client.checkPending(),false);
 assert.equal(f.client.state.receipt,null);
 assert.equal(await f.client.acknowledge(),false);
 assert.equal(f.client.prepareRecovery(),false);
 assert.equal(f.store.getItem(f.client.storageKey),raw);
 assert.equal(f.count('rpg_trade_requests'),0);
 f.client.dispose();
});

test('reopening a pending request never auto-posts or rotates UUID',async t=>{
 const f=await setup(t);
 f.host.request=async()=>{throw Error('network offline');};
 assert(f.client.prepare('request',first(f)));
 assert.equal(await f.client.submit(),false);
 const saved=f.store.getItem(f.client.storageKey);
 f.client.dispose();
 const other=f.factory.createClient({...f.host,request:async(action,body)=>{
   f.calls.push({action,body});
   return Invite.receipt(f.env,f.who,body,T0);
 }});
 assert.equal(other.pending().requestId,RAW);
 assert.equal(f.store.getItem(other.storageKey),saved);
 assert.equal(await other.checkPending(),true);
 assert(f.calls.every(x=>x.action!=='trade/invitation-scoped'));
 other.dispose();
});

test('native Web Locks missing refuses all mutation and no UUID is persisted',async t=>{
 const f=await setup(t);
 f.client.dispose();
 const noLock=f.factory.createClient({...f.host,locks:null});
 assert(noLock.state.lockError);
 assert.equal(noLock.prepare('request',first(f)),false);
 assert.equal(await noLock.submit(),false);
 assert.equal(f.calls.length,0);
 assert.equal(f.store.map.size,0);
 noLock.dispose();
});

test('same actor two windows contend for one pending slot even if first network response is slow',async t=>{
 const f=await setup(t),client2=f.factory.createClient({...f.host,requestId:()=>RAW2});
 let unblock;
 const paused=new Promise(resolve=>unblock=resolve);
 const original=f.host.request;
 const slow=async(action,body,options)=>{
  if(action==='trade/invitation-scoped')await paused;
  return original(action,body,options);
 };
 // Both clients must use the same lock and durable storage with separate IDs.
 f.client.dispose();client2.dispose();
 const first=f.factory.createClient({...f.host,request:slow,requestId:()=>RAW});
 const second=f.factory.createClient({...f.host,request:slow,requestId:()=>RAW2});
 assert(first.prepare('request',firstPayload(f)));
 assert(second.prepare('request',firstPayload(f)));
 const a=first.submit(),b=second.submit();
 await new Promise(resolve=>setImmediate(resolve));
 unblock();
 assert.equal(await a,true);assert.equal(await b,false);
 assert.equal(f.count('rpg_trade_requests'),1);
 assert.equal(f.count('rpg_trade_operations'),1);
 first.dispose();second.dispose();
});

function firstPayload(f){return {shareId:f.share.id};}

test('A-B-A generation changed before original response keeps the first intent pending, never acknowledges it for new actor context',async t=>{
 const f=await setup(t),original=f.host.request;
 let unblock;const held=new Promise(resolve=>unblock=resolve);
 f.host.request=async(action,body,options)=>{
  if(action==='trade/invitation-scoped')await held;
  return original(action,body,options);
 };
 assert(f.client.prepare('request',first(f)));
 const submitted=f.client.submit();
 await new Promise(resolve=>setImmediate(resolve));
 f.ctx.epoch=4;f.ctx.epoch=5;
 unblock();
 assert.equal(await submitted,false);
 assert(f.store.getItem(f.client.storageKey));
 assert.equal(f.client.state.lastResult,null);
 f.client.dispose();
});
