// Real session -> scoped client -> native HTTP Request -> App -> SQLite.
// The transport forwards the client's exact body and headers. It never supplies
// missing account, realm, actor, epoch, compatibility headers, or receipt fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { initialized, NOW } from './realm-test-helpers.js';
import { createCharacter } from '../src/services/player.js';
import { resolveRealm, scopeEnvForRealm } from '../src/realm/index.js';
import { handle } from '../src/index.js';
import { seedLedgerQa } from '../tools/ledger-qa-fixture.mjs';
import { seedExchangeActionsQa, exchangeActionsQaState } from '../tools/exchange-actions-qa-fixture.mjs';

const sessionSource=fs.readFileSync(new URL('../public/scene-live-session.js',import.meta.url),'utf8');
const catalogSource=fs.readFileSync(new URL('../public/monster-expansion-catalog.js',import.meta.url),'utf8');
const actionSource=fs.readFileSync(new URL('../public/scene-exchange-client.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const drain=()=>new Promise(resolve=>setImmediate(resolve));
const endpoint='http://127.0.0.1:9872/app/api/';
function sharedLocks(){
 const tails=new Map();
 return {request(name,options,callback){
  assert.equal(options.mode,'exclusive');
  const previous=tails.get(name)||Promise.resolve();let release;
  const gate=new Promise(resolve=>{release=resolve;});tails.set(name,gate);
  return previous.then(()=>callback({name,mode:'exclusive'})).finally(()=>{release();if(tails.get(name)===gate)tails.delete(name);});
 }};
}
function storage(){
 const items=new Map();
 return {getItem:key=>items.has(key)?items.get(key):null,setItem:(key,value)=>items.set(key,String(value)),removeItem:key=>items.delete(key)};
}
async function setup(t,{realmId='permanent',gold}={}){
 const env=await initialized(t);Object.assign(env,{ENVIRONMENT:'development',ALLOW_DEV_AUTH:'true'});
 const permanent=scopeEnvForRealm(env,await resolveRealm(env,'permanent'));
 for(const [index,baseClass]of ['sword','archer','mage','thief'].entries())
  await createCharacter(permanent,{tgId:'90101',charSlot:index+1,name:'線路'+baseClass,baseClass,gender:'f'},NOW);
 await seedLedgerQa(env,NOW);const seed=await seedExchangeActionsQa(env,NOW),manifest=seed.realms[realmId];
 const db=realmId==='permanent'?env.DB:env.DB_SEASON;
 if(gold!==undefined)db.sqlite.prepare('UPDATE rpg_characters SET gold=? WHERE tg_id=?').run(gold,manifest.mainCharacterId);
 const calls=[],changes=[],sharedStorage=storage(),locks=sharedLocks();let fault=null;
 const transport=async(url,init)=>{
  // Native Request intentionally replaces CurrentClientRequest, which would
  // otherwise hide missing client compatibility headers.
  const request=new Request(url,init),body=JSON.parse(await request.clone().text());
  const call={action:new URL(url).pathname.slice('/app/api/'.length),method:request.method,
   headers:Object.fromEntries(request.headers),body,bodyText:await request.clone().text(),status:null,data:null,delivered:false};
  calls.push(call);
  const chosen=call.action==='exchange/action-scoped'?fault:null;if(chosen)fault=null;
  if(chosen==='drop-before'){call.fault=chosen;throw Error('synthetic connection failed before server');}
  if(chosen==='generic-400'){
   call.fault=chosen;call.status=400;call.data={ok:false,error:'gold',message:'Generic response has no definitive proof'};call.delivered=true;
   return Response.json(call.data,{status:400});
  }
  const response=await handle(request,env);call.status=response.status;call.data=await response.clone().json();
  if(chosen==='drop-after'){
   assert.equal(response.status,200,JSON.stringify(call.data));assert.equal(call.data.status,'committed');
   call.fault=chosen;throw Error('synthetic response lost after original SQLite commit');
  }
  call.delivered=true;return response;
 };
 const sandbox={AbortController,queueMicrotask,setTimeout,clearTimeout,console,crypto,fetch:transport};
 sandbox.window=sandbox;
 const loadCatalog=()=>vm.runInNewContext(catalogSource,sandbox,{filename:'monster-expansion-catalog.js'});loadCatalog();
 vm.runInNewContext(sessionSource,sandbox,{filename:'scene-live-session.js'});
 vm.runInNewContext(actionSource,sandbox,{filename:'scene-exchange-client.js'});
 const session=sandbox.RpgSceneSession.create({endpoint,fetch:transport,accountId:'90101',realmId,characterId:manifest.mainCharacterId});
 t.after(()=>session.dispose());await session.refresh();
 let client;
 const mount=()=>{
  client?.dispose();
  client=sandbox.RpgSceneExchangeActions.createClient({getContext:session.getContext,request:session.request,storage:sharedStorage,locks,
   onChanged:(value,info)=>changes.push({value:plain(value),info:plain(info)})});
  client.update(session.getSnapshot());return client;
 };
 const unsubscribe=session.subscribe(snapshot=>client?.update(snapshot));mount();
 t.after(()=>{unsubscribe();client.dispose();});
 return {env,seed,manifest,db,realmId,session,calls,changes,sharedStorage,mount,get client(){return client;},
  fault(value){assert.equal(fault,null);fault=value;},
  catalogRevision:()=>sandbox.RpgMonsterExpansionArtRevision,
  unloadCatalog(){vm.runInNewContext('delete globalThis.RpgMonsterExpansion;delete globalThis.RpgMonsterExpansionArtRevision;',sandbox);},loadCatalog,
  state:()=>exchangeActionsQaState(env,seed)};
}
function createPlan(f){
 const id=f.manifest.assets.createEquipment,row=f.state()[f.realmId==='permanent'?'permanent':'season'].equipment.find(row=>row.id===id);
 return {kind:'create',payload:{equipId:id,qty:1,price:911},
  quote:{kind:'equip',ref:id,qty:1,price:911,sellerCharacterId:f.manifest.mainCharacterId,sellerName:'原角色',name:row.name}};
}
function listedPlan(f,kind,label){
 const target=f.manifest.listingTargets[label];
 return {kind,payload:{listingId:target.listingId},
  quote:{kind:target.kind,ref:target.ref,qty:target.qty,price:target.price,sellerCharacterId:target.sellerCharacterId,sellerName:'刊登角色',name:label}};
}
function prepare(f,plan){
 assert.equal(f.client.prepare(plan.kind,plan.payload,plan.quote,f.session.getSnapshot().live.revision),true,f.client.state.error);
}
const writes=f=>f.calls.filter(call=>call.action==='exchange/action-scoped');
const receipts=f=>f.calls.filter(call=>call.action==='exchange/receipt');
function exactWire(call,f,record,{recovery=false,epoch=f.session.getContext().epoch}={}){
 assert.equal(call.method,'POST');assert.equal(call.headers['content-type'],'application/json');
 assert.equal(call.headers['x-monster-art-revision'],f.catalogRevision(),'actual session emits the loaded published catalog revision');
 assert.equal(call.headers['x-dev-tg-id'],'90101');assert.equal(call.headers['x-realm-id'],f.realmId);
 assert.equal(call.body.accountId,'90101');assert.equal(call.body.realmId,f.realmId);
 assert.equal(call.body.characterId,f.manifest.mainCharacterId);assert.equal(call.body.selectedCharacterId,f.manifest.mainCharacterId);
 assert.equal(call.body.contextEpoch,epoch);assert.equal(call.body.recovery,recovery);
 assert.deepEqual(call.body,{...plain(record.body),contextEpoch:epoch,recovery});
 assert.equal(call.bodyText,JSON.stringify(call.body),'native transport keeps original serialized JSON');
}
function originalOperation(f,requestId){
 const op=f.db.sqlite.prepare('SELECT * FROM rpg_exchange_operations WHERE account_tg_id=? AND request_id=?').get('90101',requestId);
 return op&&{...op,payload:JSON.parse(op.payload_json),result:JSON.parse(op.result_json)};
}

test('native session/client wire restores lost create, buy and cancel responses only through original receipts',async t=>{
 for(const kind of ['create','buy','cancel'])await t.test(kind,async t=>{
  const f=await setup(t),plan=kind==='create'?createPlan(f):listedPlan(f,kind,kind==='buy'?'buyEquipment':'cancelAlternateEquipment');
  prepare(f,plan);f.fault('drop-after');assert.equal(await f.client.submit(),false);
  const record=plain(f.client.pending());assert(record);assert.match(record.requestId,/^[0-9a-f-]{36}$/);
  assert.equal(record.attempts,1);assert.equal(writes(f).length,1);exactWire(writes(f)[0],f,record);
  const original=originalOperation(f,record.requestId);assert(original);assert.equal(original.action,kind);
  assert.equal(original.payload_json,JSON.stringify(JSON.parse(record.signature).payload));
  const committed=f.state(),firstCalls=f.calls.length;
  // Reopening a client reads the saved original intent; it cannot replay it.
  f.mount();await drain();assert.equal(f.calls.length,firstCalls);assert.equal(f.client.pending().requestId,record.requestId);
  assert.equal(await f.client.checkPending(),true,f.client.state.error);
  assert.equal(receipts(f).length,1);exactWire(receipts(f)[0],f,record,{recovery:true});
  assert.equal(f.client.state.receipt.found,true);assert.deepEqual(plain(f.client.state.receipt.result),original.result);
  assert.equal(f.client.state.receipt.requestId,record.requestId);assert.equal(f.client.state.receipt.signature,record.signature);
  assert.deepEqual(f.state(),committed,'receipt lookup is SELECT-only across both full databases');
  assert.equal(await f.client.acknowledge(),true);assert.equal(f.client.pending(),null);await drain();
  assert.equal(writes(f).length,1);assert.deepEqual(f.state(),committed);
  assert.equal(f.changes.length,1);assert.deepEqual(f.changes[0].value.result,original.result);assert.equal(f.changes[0].info.recovered,true);
 });
});

test('season native wire keeps missing intent and retries only after explicit confirmation with same UUID and economic payload',async t=>{
 const f=await setup(t,{realmId:'season_2026_01'}),plan=createPlan(f),before=f.state();
 prepare(f,plan);f.fault('drop-before');assert.equal(await f.client.submit(),false);
 const record=plain(f.client.pending());assert(record);assert.equal(writes(f).length,1);exactWire(writes(f)[0],f,record);
 assert.equal(originalOperation(f,record.requestId),undefined);assert.deepEqual(f.state(),before);
 assert.equal(await f.client.checkPending(),true);assert.equal(f.client.state.receipt.status,'missing');
 assert.equal(f.client.state.receipt.found,false);assert.equal(f.client.state.receipt.recoveryAllowed,true);
 assert.equal(f.client.pending().requestId,record.requestId);assert.equal(await f.client.acknowledge(),false);
 await drain();assert.equal(writes(f).length,1);assert.deepEqual(f.state(),before);
 assert.equal(f.client.prepareRecovery(),true);assert.equal(writes(f).length,1,'opening recovery confirmation does not write');
 assert.equal(await f.client.submit(),true,f.client.state.error);assert.equal(writes(f).length,2);
 exactWire(writes(f)[1],f,record,{recovery:true});assert.equal(f.client.pending(),null);
 const after=f.state();assert.equal(after.season.acceptanceOperationCount,before.season.acceptanceOperationCount+1);
 assert.deepEqual(after.databases.permanent,before.databases.permanent);assert(originalOperation(f,record.requestId));
 assert.equal(writes(f)[0].delivered,false);assert.equal(writes(f)[1].delivered,true);
});

test('real wire preserves generic initial 400 and recovery rejection, but clears a complete fresh business rejection',async t=>{
 await t.test('generic 400 and recovery stay pending',async t=>{
  const f=await setup(t,{gold:0}),plan=listedPlan(f,'buy','buyEquipment'),before=f.state();
  prepare(f,plan);f.fault('generic-400');assert.equal(await f.client.submit(),false);
  const record=plain(f.client.pending());assert(record);assert.equal(record.attempts,1);
  assert.equal(writes(f)[0].data.definitiveRejection,undefined);
  assert.equal(await f.client.checkPending(),true);assert.equal(f.client.state.receipt.found,false);
  assert.equal(f.client.prepareRecovery(),true);assert.equal(await f.client.submit(),false);
  exactWire(writes(f)[1],f,record,{recovery:true});assert.equal(writes(f)[1].status,400);
  assert.equal(writes(f)[1].data.error,'gold');assert.equal(writes(f)[1].data.definitiveRejection,undefined);
  assert.equal(f.client.pending().requestId,record.requestId);assert.equal(f.client.pending().attempts,2);
  assert.deepEqual(f.state(),before,'failed operations and their receipt checks do not change either database');
 });
 await t.test('authoritative fresh rejection permits a corrected next intent',async t=>{
  const f=await setup(t,{gold:0}),before=f.state();prepare(f,listedPlan(f,'buy','buyEquipment'));
  assert.equal(await f.client.submit(),false);assert.equal(writes(f).length,1);
  const rejected=writes(f)[0];assert.equal(rejected.status,400);assert.equal(rejected.data.error,'gold');
  assert.equal(rejected.data.definitiveRejection,true);assert.equal(rejected.data.status,'rejected');
  assert.equal(f.client.pending(),null);assert.deepEqual(f.state(),before);
  prepare(f,createPlan(f));assert.equal(await f.client.submit(),true,f.client.state.error);
  assert.equal(writes(f).length,2);assert.notEqual(writes(f)[1].body.requestId,rejected.body.requestId);
  assert.equal(f.client.pending(),null);assert.equal(f.state().permanent.acceptanceOperationCount,before.permanent.acceptanceOperationCount+1);
 });
});

test('missing published metadata is rejected and loading the real catalog never replays a pending mutation',async t=>{
 const f=await setup(t),plan=createPlan(f),before=f.state();prepare(f,plan);f.unloadCatalog();
 assert.equal(await f.client.submit(),false);assert.equal(writes(f).length,1);
 const rejected=writes(f)[0],record=plain(f.client.pending());assert(record);
 assert.equal(rejected.headers['x-monster-art-revision'],undefined);assert.equal(rejected.status,409);
 assert.equal(rejected.data.error,'assets_update_required');assert.equal(rejected.data.definitiveRejection,undefined);
 assert.deepEqual(f.state(),before);
 f.loadCatalog();await drain();assert.equal(writes(f).length,1,'metadata arrival is not authority to resend a mutation');
 assert.equal(await f.client.checkPending(),true);assert.equal(f.client.state.receipt.status,'missing');
 exactWire(receipts(f)[0],f,record,{recovery:true});assert.deepEqual(f.state(),before);
 assert.equal(f.client.prepareRecovery(),true);assert.equal(await f.client.submit(),true,f.client.state.error);
 assert.equal(writes(f).length,2);exactWire(writes(f)[1],f,record,{recovery:true});
 assert.equal(f.client.pending(),null);assert(originalOperation(f,record.requestId));
});
