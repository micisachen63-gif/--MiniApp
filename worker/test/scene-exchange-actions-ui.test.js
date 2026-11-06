import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {monsterArtCompatibility,MONSTER_ART_REVISION} from '../src/game/monster-art-compatibility.js';

const actionSource=fs.readFileSync(new URL('../public/scene-exchange-client.js',import.meta.url),'utf8');
const uiSource=fs.readFileSync(new URL('../public/scene-exchange-ui.js',import.meta.url),'utf8');
const NOW=Date.parse('2026-11-06T06:00:00.000Z');
const BASE=Object.freeze({accountId:'exchange-actions-account',realmId:'permanent',characterId:'actor-a',epoch:7});
const UUID='11111111-2222-4333-8444-555555555555';
const UUID2='66666666-7777-4888-8999-aaaaaaaaaaaa';
const clean=value=>JSON.parse(JSON.stringify(value));
const drain=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const defaults=()=>({category:'all',classReq:'all',tier:null,quality:'all',enhanceMin:null,enhanceMax:null});
function sharedLocks(){
 const tails=new Map(),events=[];
 return {events,request(name,options,callback){
  assert.equal(options.mode,'exclusive');const previous=tails.get(name)||Promise.resolve();
  const promise=previous.catch(()=>{}).then(async()=>{events.push(['enter',name]);try{return await callback();}finally{events.push(['leave',name]);}});
  tails.set(name,promise.catch(()=>{}));return promise;
 }};
}
function memoryStorage(){
 const values=new Map(),events=[];
 return {values,events,failGet:false,failSet:false,failRemove:false,
  getItem(key){if(this.failGet)throw Error('get blocked');const value=values.get(key)??null;this.onGet?.(key,value);return value;},
  setItem(key,value){events.push(['set',key,value]);if(this.failSet)throw Error('quota');values.set(key,String(value));},
  removeItem(key){events.push(['remove',key]);if(this.failRemove)throw Error('remove blocked');values.delete(key);}
 };
}
function candidate(kind='item',ref='red_1',extra={}){
 return {kind,ref,[kind==='equip'?'equipId':kind==='guardian'?'guardianId':'item']:ref,qty:kind==='item'?15:1,
  name:kind==='item'?'初級紅藥水':kind==='equip'?'月光之劍':'守護天使',emoji:'✦',desc:'原始物品說明',equipment:null,guardian:null,
  category:kind==='equip'?'equipment':kind==='guardian'?'guardian':'other',classReq:'any',quality:null,tier:null,enhance:null,...extra};
}
function listing(id='listing-1',extra={}){
 return {...candidate(),id,qty:3,price:140,fee:7,netGold:133,status:'active',seller:{characterId:'seller-1',name:'原出售旅者'},
  createdAt:NOW-2000,updatedAt:NOW-1000,ownedByMe:false,canBuy:true,...extra};
}
function quote(row=listing()){
 return {kind:row.kind,ref:row.ref??row[row.kind==='equip'?'equipId':row.kind==='guardian'?'guardianId':'item'],
  qty:row.qty,price:row.price,sellerCharacterId:row.seller?.characterId??BASE.characterId,sellerName:row.seller?.name??'目前旅者',name:row.name};
}
function page({context=BASE,tab='browse',filters=defaults(),revision=4,serverNow=NOW,items,nextCursor=null,...extra}={}){
 return {ok:true,schemaVersion:1,accountId:context.accountId,realmId:context.realmId,characterId:context.characterId,contextEpoch:context.epoch,
  revision,serverNow,pageSize:30,tab,filters:['browse','sellable'].includes(tab)?filters:null,role:tab==='history'?'all':null,
  items:items??[tab==='sellable'?candidate():listing()],meta:tab==='history'?null:{pageSize:30,maxActive:20,taxPct:.05,maxPrice:1000000,maxQty:99999,categories:['equipment','guardian','other']},nextCursor,...extra};
}
function harness({context=BASE,storage=memoryStorage(),document,requestId=()=>UUID,locks=sharedLocks()}={}){
 let currentContext={...context},active=true;
 const calls=[],changes=[],states=[],listeners=new Map();
 const sandbox={AbortController,console,Intl,Date,URL,Uint8Array,setTimeout,clearTimeout,localStorage:storage,
  addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(listener);},
  removeEventListener(type,listener){listeners.get(type)?.delete(listener);}};
 if(document)sandbox.document=document;
 sandbox.setInterval=()=>{throw Error('Exchange cannot poll');};
 vm.runInNewContext(actionSource,sandbox,{filename:'scene-exchange-client.js'});
 vm.runInNewContext(uiSource,sandbox,{filename:'scene-exchange-ui.js'});
 const host={storage,requestId,locks,getContext:()=>({...currentContext}),current:()=>active,
  getActor:()=>({id:currentContext.characterId,name:'目前旅者'}),actor:{name:'目前旅者'},
  onState:state=>states.push({busy:state.busy,checking:state.checking,error:state.error}),
  onChanged:(value,info)=>changes.push({value:clean(value),info:clean(info)}),
  artUrl:value=>'http://127.0.0.1:9866/'+String(value).replace(/^\//,''),
  request(action,body,options={}){
   const pending=deferred(),call={action,body:clean(body),signal:options.signal,...pending};calls.push(call);
   if(action==='atlas/status')pending.resolve({ok:true});
   return pending.promise;
  }};
 const api=sandbox.RpgSceneExchangeActions;
 return {api,ui:sandbox.RpgSceneExchange,host,calls,changes,states,storage,create:()=>api.createClient(host),
  setContext(patch){currentContext={...currentContext,...patch};},setCurrent(value){active=value;},
  storageEvent(key){for(const listener of listeners.get('storage')||[])listener({key});}};
}
function committed(h,call,q=quote(),{replayed=false,revision=5}={}){
 const body=call.body,kind=body.kind,payload=clean(h.api.canonicalPayload(kind,body)),fee=Math.ceil(q.price/20);
 const row=listing(kind==='create'?'created-listing':body.listingId,{
  kind:q.kind,ref:q.ref,[q.kind==='equip'?'equipId':q.kind==='guardian'?'guardianId':'item']:q.ref,
  name:q.name,qty:q.qty,price:q.price,fee,netGold:q.price-fee,
  seller:{characterId:q.sellerCharacterId,name:q.sellerName||'原出售旅者'},status:{create:'active',buy:'sold',cancel:'cancelled'}[kind],
  ownedByMe:kind!=='buy',canBuy:false});
 const result={action:kind,listingId:row.id,listing:row,price:q.price,qty:q.qty,fee:kind==='cancel'?0:fee,netGold:kind==='cancel'?0:q.price-fee,
  ...(kind==='cancel'?{returnedCharacterId:q.sellerCharacterId}:{})};
 const signature=h.api.signature(kind,body);
 return {ok:true,schemaVersion:1,accountId:body.accountId,realmId:body.realmId,characterId:body.characterId,contextEpoch:body.contextEpoch,
  revision,serverNow:NOW,kind,requestId:body.requestId,signature,found:true,status:'committed',result,
  receipt:{schemaVersion:1,scope:{accountId:body.accountId,realmId:body.realmId,characterId:body.characterId},kind,requestId:body.requestId,payload,signature,createdAt:NOW},
  recoveryAllowed:false,...(call.action==='exchange/action-scoped'?{replayed}:{})};
}
function missing(h,call,recoveryAllowed=true){
 const value=committed(h,call);return {...value,found:false,status:'missing',result:null,receipt:null,recoveryAllowed};
}
function rejection(h,call,code='gold'){
 const body=missing(h,call,false);delete body.replayed;
 const exchangeRejection={...body,ok:false,status:'rejected',definitiveRejection:true,error:code,message:'原權威拒絕：'+code};
 return Object.assign(Error(exchangeRejection.message),{code,status:400,uncertain:false,exchangeRejection});
}
async function started(h,invoke){
 const before=h.calls.length,pending=invoke();await drain();assert.equal(h.calls.length,before+1);
 return {pending,call:h.calls[before]};
}
function prepareBuy(c,row=listing()){assert.equal(c.prepare('buy',{listingId:row.id},quote(row),4),true);}
async function unknown(h,c,row=listing()){
 prepareBuy(c,row);const op=await started(h,()=>c.submit());op.call.reject(Object.assign(Error('response lost'),{uncertain:true}));
 assert.equal(await op.pending,false);assert.ok(c.pending());return op.call;
}

test('confirmation stays cold, cancellation creates no UUID or storage, and a fresh write is durable before transport',async()=>{
 let ids=0;const h=harness({requestId:()=>{ids++;return UUID;}}),c=h.create();
 assert.equal(h.calls.length,0);prepareBuy(c);assert.equal(ids,0);assert.equal(c.cancel(),true);
 assert.equal(h.storage.events.length,0);assert.equal(h.calls.length,0);
 prepareBuy(c);const op=await started(h,()=>c.submit()),record=c.pending();
 assert.equal(ids,1);assert.equal(record.requestId,UUID);assert.deepEqual(clean(record.body),op.call.body);
 assert.equal(op.call.body.recovery,false);assert.equal(record.body.listingId,'listing-1');
 assert.deepEqual(Object.keys(record.body).sort(),['accountId','realmId','selectedCharacterId','contextEpoch','characterId','kind','requestId','recovery','listingId'].sort());
 assert.equal(JSON.parse(h.storage.getItem(c.storageKey)).signature,h.api.signature('buy',op.call.body));
 assert.equal(h.storage.events[0][0],'set');
 op.call.resolve(committed(h,op.call));assert.equal(await op.pending,true);assert.equal(c.pending(),null);assert.equal(h.changes.length,1);c.dispose();
});

test('create candidates retain raw references and the original whole-batch price with exact fee rounding',async t=>{
 for(const [kind,field,ref,qty]of [['item','item','collection:key-1',8],['equip','equipId','equipment-uuid',1],['guardian','guardianId','guardian-uuid',1]]){
  await t.test(kind,async()=>{
   const h=harness(),c=h.create(),q=quote(listing('ignored',{...candidate(kind,ref),qty,price:140,seller:{characterId:BASE.characterId,name:'目前旅者'}}));
   assert.equal(c.prepare('create',{[field]:ref,qty,price:140},q,4),true);
   const op=await started(h,()=>c.submit());assert.equal(op.call.body[field],ref);assert.equal(op.call.body.price,140);assert.equal(op.call.body.qty,qty);
   assert.deepEqual(clean(h.api.canonicalPayload('create',op.call.body)),{kind,ref,qty,price:140,characterId:BASE.characterId});
   op.call.resolve(committed(h,op.call,q));assert.equal(await op.pending,true);assert.equal(c.state.lastResult.receipt.result.fee,7);assert.equal(c.state.lastResult.receipt.result.netGold,133);c.dispose();
  });
 }
});

test('a missing response is resolved by pure receipt lookup, never a replay or a fresh UUID',async()=>{
 const h=harness(),c=h.create(),original=await unknown(h,c),stored=h.storage.getItem(c.storageKey);
 const check=await started(h,()=>c.checkPending());assert.equal(check.call.action,'exchange/receipt');
 assert.deepEqual(check.call.body,{...original.body,recovery:true});check.call.resolve(committed(h,check.call));assert.equal(await check.pending,true);
 assert.equal(h.storage.getItem(c.storageKey),stored);assert.equal(h.calls.filter(x=>x.action==='exchange/action-scoped').length,1);
 assert.equal(c.prepareRecovery(),false);assert.equal(await c.acknowledge(),true);assert.equal(c.pending(),null);assert.equal(h.changes[0].info.recovered,true);
 assert.equal(h.calls.length,2);c.dispose();
});

test('missing retains the full intent and needs explicit same-ID recovery confirmation before a second POST',async()=>{
 let ids=0;const h=harness({requestId:()=>{ids++;return UUID;}}),c=h.create(),original=await unknown(h,c);
 const check=await started(h,()=>c.checkPending());check.call.resolve(missing(h,check.call));assert.equal(await check.pending,true);
 assert.ok(c.pending());assert.equal(h.calls.length,2);assert.equal(await c.acknowledge(),false);
 assert.equal(c.prepareRecovery(),true);assert.equal(h.calls.length,2);assert.equal(c.cancel(),true);assert.equal(h.calls.length,2);
 assert.equal(c.prepareRecovery(),true);const op=await started(h,()=>c.submit());
 assert.deepEqual(op.call.body,{...original.body,recovery:true});assert.equal(c.pending().attempts,2);assert.equal(ids,1);
 assert.deepEqual(clean(c.pending().body),original.body);op.call.resolve(committed(h,op.call,quote(),{replayed:true}));assert.equal(await op.pending,true);assert.equal(c.pending(),null);c.dispose();
});

test('reopened pending only rebinds the caller epoch and never submits while discovering it',async()=>{
 const storage=memoryStorage(),a=harness({storage}),old=a.create(),original=await unknown(a,old);old.dispose();
 const h=harness({storage,context:{...BASE,epoch:19},requestId:()=>{throw Error('must retain UUID');}}),c=h.create();
 assert.equal(h.calls.length,0);assert.equal(c.pending().body.contextEpoch,7);
 const check=await started(h,()=>c.checkPending());assert.deepEqual(check.call.body,{...original.body,contextEpoch:19,recovery:true});
 check.call.resolve(missing(h,check.call));assert.equal(await check.pending,true);assert.equal(c.prepareRecovery(),true);
 const op=await started(h,()=>c.submit());assert.deepEqual(op.call.body,check.call.body);assert.equal(c.pending().body.contextEpoch,7);
 op.call.reject(Object.assign(Error('still unknown'),{uncertain:true}));assert.equal(await op.pending,false);assert.equal(c.pending().requestId,UUID);c.dispose();
});

test('historical immutable receipt can be acknowledged after newer scene revisions and failed refreshes',async()=>{
 const h=harness(),c=h.create();await unknown(h,c);c.update({...BASE,live:{revision:800}});
 const check=await started(h,()=>c.checkPending());check.call.resolve(committed(h,check.call,quote(),{revision:4}));assert.equal(await check.pending,true);
 c.update({...BASE,live:{revision:1000}});assert.equal(await c.acknowledge(),true);assert.equal(c.state.lastResult.receipt.revision,4);assert.equal(c.pending(),null);c.dispose();
});

test('cancel keeps the original seller actor, including another character of the same account',async()=>{
 const h=harness(),c=h.create(),row=listing('shared-listing',{seller:{characterId:'same-account-other-actor',name:'另一位原賣家'},ownedByMe:true,canBuy:false});
 assert.equal(c.prepare('cancel',{listingId:row.id},quote(row),4),true);const op=await started(h,()=>c.submit());
 assert.equal(op.call.body.characterId,BASE.characterId);op.call.resolve(committed(h,op.call,quote(row)));assert.equal(await op.pending,true);
 assert.equal(c.state.lastResult.receipt.result.returnedCharacterId,'same-account-other-actor');assert.equal(c.state.lastResult.receipt.result.fee,0);c.dispose();
});

test('scope changes, A-B-A epochs, close and dispose leave persisted unknown operations untouched',async t=>{
 for(const [name,alter]of [
  ['account',(h)=>h.setContext({accountId:'other'})],['realm',(h)=>h.setContext({realmId:'other'})],
  ['actor',(h)=>h.setContext({characterId:'actor-b'})],['A-B-A',(h)=>{h.setContext({characterId:'actor-b',epoch:8});h.setContext({characterId:BASE.characterId,epoch:9});}],
  ['closed',(h)=>h.setCurrent(false)],['disposed',(h,c)=>c.dispose()]
 ])await t.test(name,async()=>{
  const h=harness(),c=h.create();prepareBuy(c);const op=await started(h,()=>c.submit()),stored=h.storage.getItem(c.storageKey);
  alter(h,c);op.call.resolve(committed(h,op.call));assert.equal(await op.pending,false);
  assert.equal(h.storage.getItem(c.storageKey),stored);assert.equal(h.changes.length,0);assert.equal(await c.checkPending(),false);c.dispose();
 });
});

test('late receipt from a previous window cannot clear a current record or paint after closure',async()=>{
 const h=harness(),c=h.create();await unknown(h,c);const check=await started(h,()=>c.checkPending()),stored=h.storage.getItem(c.storageKey),states=h.states.length;
 h.setContext({epoch:BASE.epoch+2});check.call.resolve(committed(h,check.call));assert.equal(await check.pending,false);
 assert.equal(h.storage.getItem(c.storageKey),stored);assert.equal(h.states.length,states);assert.equal(await c.acknowledge(),false);c.dispose();
});

test('unavailable, corrupt and write-failed storage fail closed before any POST',async t=>{
 for(const kind of ['malformed','scope','signature','unavailable','quota','readback'])await t.test(kind,async()=>{
  const storage=memoryStorage(),h=harness({storage}),key=h.api.storageKeyFor(BASE);
  if(kind==='malformed')storage.setItem(key,'{broken');
  if(['scope','signature'].includes(kind)){
   const seed=h.create();await unknown(h,seed);seed.dispose();const record=JSON.parse(storage.getItem(key));
   if(kind==='scope')record.scope.realmId='foreign';else record.signature='altered';storage.setItem(key,JSON.stringify(record));h.calls.length=0;
  }
  if(kind==='unavailable')storage.failGet=true;
  if(kind==='quota')storage.failSet=true;
  if(kind==='readback')storage.setItem=function(key,value){this.events.push(['set',key,value]);};
  const before=storage.values.get(key),c=h.create();
  if(['quota','readback'].includes(kind)){prepareBuy(c);assert.equal(await c.submit(),false);}
  else assert.equal(c.prepare('buy',{listingId:'listing-1'},quote(),4),false);
  assert.equal(h.calls.length,0);assert.equal(storage.values.get(key),before);assert.ok(c.state.storageError||c.state.error);c.dispose();
 });
});

test('changed pending storage is never overwritten or deleted by a late mutation or receipt',async t=>{
 for(const mode of ['mutation','receipt'])await t.test(mode,async()=>{
  const h=harness(),c=h.create();let op;
  if(mode==='mutation'){prepareBuy(c);op=await started(h,()=>c.submit());}
  else {await unknown(h,c);op=await started(h,()=>c.checkPending());}
  const replacement=clean(c.pending());replacement.requestId=UUID2;replacement.body.requestId=UUID2;
  h.storage.setItem(c.storageKey,JSON.stringify(replacement));const stored=h.storage.getItem(c.storageKey);
  op.call.resolve(committed(h,op.call));assert.equal(await op.pending,false);assert.equal(h.storage.getItem(c.storageKey),stored);assert.equal(h.changes.length,0);c.dispose();
 });
});

test('generic 400 and partial, foreign or mismatched rejection envelopes keep pending',async t=>{
 const mutations=[
  ['generic',error=>{delete error.exchangeRejection;}],
  ['marker absent',error=>{delete error.exchangeRejection.definitiveRejection;}],
  ['account',error=>{error.exchangeRejection.accountId='foreign';}],
  ['epoch',error=>{error.exchangeRejection.contextEpoch++;}],
  ['UUID',error=>{error.exchangeRejection.requestId=UUID2;}],
  ['signature',error=>{error.exchangeRejection.signature='foreign';}],
  ['scope error',error=>{error.code='realm_mismatch';error.exchangeRejection.error='realm_mismatch';}],
  ['uncertain',error=>{error.uncertain=true;}],
  ['server error',error=>{error.status=500;}],
  ['found',error=>{error.exchangeRejection.found=true;}]
 ];
 for(const[name,mutate]of mutations)await t.test(name,async()=>{
  const h=harness(),c=h.create();prepareBuy(c);const op=await started(h,()=>c.submit()),error=rejection(h,op.call);mutate(error);
  op.call.reject(error);assert.equal(await op.pending,false);assert.ok(c.pending());assert.equal(h.changes.length,0);c.dispose();
 });
});

test('only a complete definitive rejection of the fresh first attempt clears its own pending record',async()=>{
 const h=harness(),c=h.create();prepareBuy(c);const op=await started(h,()=>c.submit());op.call.reject(rejection(h,op.call));
 assert.equal(await op.pending,false);assert.equal(c.pending(),null);assert.match(c.state.error,/原權威拒絕/);assert.equal(h.changes.length,0);
 assert.equal(c.prepare('buy',{listingId:'different'},quote(),4),true);c.cancel();c.dispose();
});

test('a rejection marker after any unknown or recovery cannot clear the original intent',async()=>{
 const h=harness(),c=h.create();await unknown(h,c);const check=await started(h,()=>c.checkPending());check.call.resolve(missing(h,check.call));await check.pending;
 c.prepareRecovery();const op=await started(h,()=>c.submit());op.call.reject(rejection(h,op.call));assert.equal(await op.pending,false);assert.equal(c.pending().attempts,2);c.dispose();
});

test('malformed or mismatching receipts cannot settle or replace the original pending operation',async t=>{
 const cases=[
  ['canonical payload',v=>v.receipt.payload.listingId='another'],['UUID',v=>v.requestId=UUID2],['epoch',v=>v.contextEpoch++],
  ['result listing',v=>v.result.listingId='another'],['price',v=>v.result.price++],['quantity',v=>v.result.qty++],
  ['fee',v=>v.result.fee++],['seller',v=>v.result.listing.seller.characterId='other'],['status',v=>v.result.listing.status='active'],
  ['missing shape',v=>{v.found=false;v.status='missing';v.result=null;}]
 ];
 for(const[name,mutate]of cases)await t.test(name,async()=>{
  const h=harness(),c=h.create();await unknown(h,c);const original=h.storage.getItem(c.storageKey),check=await started(h,()=>c.checkPending()),value=committed(h,check.call);mutate(value);
  check.call.resolve(value);assert.equal(await check.pending,false);assert.equal(c.state.receipt,null);assert.equal(await c.acknowledge(),false);
  assert.equal(h.storage.getItem(c.storageKey),original);assert.equal(h.calls.filter(x=>x.action==='exchange/action-scoped').length,1);c.dispose();
 });
});

test('frozen realm missing receipt cannot authorize a recovery POST',async()=>{
 const h=harness(),c=h.create();await unknown(h,c);const check=await started(h,()=>c.checkPending());check.call.resolve(missing(h,check.call,false));assert.equal(await check.pending,true);
 assert.equal(c.prepareRecovery(),false);assert.equal(await c.submit(),false);assert.equal(h.calls.length,2);assert.ok(c.pending());c.dispose();
});

test('failed deletion preserves an acknowledged receipt for a safe later retry',async()=>{
 const h=harness(),c=h.create();await unknown(h,c);const check=await started(h,()=>c.checkPending());check.call.resolve(committed(h,check.call));await check.pending;
 h.storage.failRemove=true;assert.equal(await c.acknowledge(),false);assert.ok(c.pending());assert.equal(c.state.receipt.found,true);assert.equal(h.changes.length,0);
 h.storage.failRemove=false;assert.equal(await c.acknowledge(),true);assert.equal(c.pending(),null);assert.equal(h.changes.length,1);assert.equal(h.calls.length,2);c.dispose();
});

test('each actor and realm has an isolated pending key and storage changes invalidate unsubmitted confirmation',async()=>{
 const h=harness(),c=h.create();prepareBuy(c);const other=h.api.storageKeyFor({...BASE,realmId:'other'});
 assert.notEqual(other,c.storageKey);h.storage.setItem(other,'unrelated');h.storageEvent(other);assert.ok(c.state.confirm);
 h.storage.setItem(c.storageKey,'corrupt');h.storageEvent(c.storageKey);assert.equal(c.state.confirm,null);assert.ok(c.state.storageError);assert.equal(await c.submit(),false);assert.equal(h.calls.length,0);c.dispose();
});

const decode=text=>text.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
class Element {
  constructor(document,tag) {
    this.ownerDocument=document;this.tagName=tag.toUpperCase();this.nodeType=tag==='#text'?3:1;
    this.parentNode=null;this.nodes=[];this.attributes=new Map();this.events=new Map();this.text='';
    this.disabled=false;this.hidden=false;this.value='';this.scrollTop=0;
    this.dataset=new Proxy({},{
      get:(_,key)=>this.getAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase())) ?? undefined,
      set:(_,key,value)=>{this.setAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value);return true;}
    });
  }
  get childNodes(){return this.nodes;}
  get children(){return this.nodes.filter(node=>node.nodeType===1);}
  get isConnected(){return this===this.ownerDocument.body || this===this.ownerDocument.head || !!this.parentNode?.isConnected;}
  get className(){return this.getAttribute('class') || '';}
  set className(value){this.setAttribute('class',value);}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='disabled')this.disabled=true;if(name==='hidden')this.hidden=true;if(name==='value')this.value=String(value);if(name==='name')this.name=String(value);}
  getAttribute(name){return this.attributes.get(name) ?? null;}
  hasAttribute(name){return this.attributes.has(name);}
  removeAttribute(name){this.attributes.delete(name);if(name==='disabled')this.disabled=false;if(name==='hidden')this.hidden=false;}
  append(...items){
    for(let item of items){
      if(typeof item!=='object'){const node=this.ownerDocument.createTextNode(String(item));item=node;}
      if(item.parentNode)item.parentNode.nodes=item.parentNode.nodes.filter(node=>node!==item);
      item.parentNode=this;this.nodes.push(item);
    }
  }
  appendChild(node){this.append(node);return node;}
  replaceChildren(...nodes){
    if(this.nodes.some(node=>node.contains(this.ownerDocument.activeElement)))this.ownerDocument.activeElement=this.ownerDocument.body;
    for(const node of this.nodes)node.parentNode=null;
    this.nodes=[];this.text='';this.append(...nodes);
  }
  contains(node){return node===this || this.nodes.some(child=>child.contains(node));}
  get textContent(){return this.text+this.nodes.map(node=>node.textContent).join('');}
  set textContent(value){this.replaceChildren();this.text=String(value);}
  get innerHTML(){return this.html || '';}
  set innerHTML(value){
    this.html=String(value);this.ownerDocument.htmlWrites.push(this.html);this.replaceChildren();
    const stack=[this];
    for(const token of this.html.match(/<[^>]*>|[^<]+/g) || []){
      if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}
      if(token.startsWith('<')){
        const match=token.match(/^<([a-z0-9-]+)([\s\S]*?)\/?>$/i);
        if(!match)continue;
        const node=this.ownerDocument.createElement(match[1]);
        for(const attr of match[2].matchAll(/([^\s=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g))node.setAttribute(attr[1],decode(attr[2]??attr[3]??attr[4]??''));
        stack.at(-1).append(node);
        if(!['INPUT','LINK','IMG','BR','HR','META'].includes(node.tagName) && !token.endsWith('/>'))stack.push(node);
      }else stack.at(-1).append(this.ownerDocument.createTextNode(decode(token)));
    }
  }
  matches(selector){
    if(this.nodeType!==1)return false;
    const attr=selector.match(/^(?:([a-z0-9-]+))?\[([a-z0-9-]+)(?:([*]?=)"([^"]*)")?\]$/i);
    if(attr){
      if(attr[1]&&this.tagName!==attr[1].toUpperCase())return false;
      const value=this.getAttribute(attr[2]);
      return value!==null && (!attr[3] || (attr[3]==='*='?value.includes(attr[4]):value===attr[4]));
    }
    if(selector.startsWith('.'))return this.className.split(/\s+/).includes(selector.slice(1));
    return this.tagName===selector.toUpperCase();
  }
  querySelectorAll(selector){
    const found=[];
    for(const child of this.nodes){if(child.matches(selector))found.push(child);found.push(...child.querySelectorAll(selector));}
    return found;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
  closest(selector){return this.matches(selector)?this:this.parentNode?.closest(selector) || null;}
  addEventListener(type,listener){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(listener);}
  removeEventListener(type,listener){this.events.get(type)?.delete(listener);}
  dispatch(type){
    const event={type,target:this,preventDefault(){},stopPropagation(){this.stopped=true;}};
    for(let node=this;node;node=node.parentNode){for(const listener of [...node.events.get(type)||[]])listener(event);if(event.stopped)break;}
  }
  click(){if(!this.disabled)this.dispatch('click');}
  change(value){this.value=value;this.dispatch('change');}
  focus(){if(this.isConnected&&!this.disabled)this.ownerDocument.activeElement=this;}
}
function documentFixture(){
  const document={baseURI:'http://127.0.0.1:9853/scene-live-preview.html',htmlWrites:[]};
  document.createElement=tag=>new Element(document,tag);
  document.createTextNode=text=>{const node=new Element(document,'#text');node.text=String(text);return node;};
  document.head=document.createElement('head');document.body=document.createElement('body');document.activeElement=document.body;
  document.querySelector=selector=>document.head.querySelector(selector)||document.body.querySelector(selector);
  const root=document.createElement('main');document.body.append(root);
  return {document,root};
}

async function mounted(value=page()){
 const {document,root}=documentFixture(),h=harness({document}),view=h.ui.mount(root,h.host);
 assert.equal(h.calls[0].action,'exchange/scene');h.calls[0].resolve(value);await drain();
 return {document,root,h,view,find:key=>root.querySelector('[data-exchange-'+key+']')};
}
async function sellableMounted(items=[candidate()]){
 const all=await mounted();all.root.querySelector('[data-exchange-tab="sellable"]').click();await drain();
 assert.equal(all.h.calls.at(-1).action,'exchange/sellable-scene');all.h.calls.at(-1).resolve(page({tab:'sellable',items}));await drain();return all;
}

test('sellable candidates have a kind:ref identity, an independent cursor and all six scoped filters',async()=>{
 const h=harness(),c=h.ui.createClient(h.host);
 let op=await started(h,()=>c.setTab('sellable'));assert.equal(op.call.action,'exchange/sellable-scene');
 assert.deepEqual(op.call.body,{accountId:BASE.accountId,realmId:BASE.realmId,selectedCharacterId:BASE.characterId,cursor:null,contextEpoch:BASE.epoch,filters:defaults()});
 op.call.resolve(page({tab:'sellable',items:[candidate('item','same'),candidate('equip','same')],nextCursor:'opaque-kind-ref-cursor'}));assert.equal(await op.pending,true);
 assert.equal(c.state.data.items.length,2);assert.equal(c.state.data.items[0].id,undefined);assert.equal(c.state.data.items[0].price,undefined);
 op=await started(h,()=>c.next());assert.equal(op.call.body.cursor,'opaque-kind-ref-cursor');op.call.reject(Error('page unavailable'));assert.equal(await op.pending,false);
 const retry=await started(h,()=>c.retry());assert.deepEqual(retry.call.body,op.call.body);retry.call.resolve(page({tab:'sellable',items:[]}));assert.equal(await retry.pending,true);
 const filters={category:'equipment',classReq:'sword',tier:5,quality:'legendary',enhanceMin:4,enhanceMax:8};
 op=await started(h,()=>c.setFilters(filters));assert.deepEqual(op.call.body.filters,filters);assert.equal(op.call.body.cursor,null);
 op.call.resolve(page({tab:'sellable',filters,items:[]}));await op.pending;
 op=await started(h,()=>c.setTab('browse'));assert.equal(op.call.action,'exchange/scene');assert.deepEqual(op.call.body.filters,defaults());
 op.call.resolve(page());await op.pending;
 op=await started(h,()=>c.setTab('sellable'));assert.deepEqual(op.call.body.filters,filters);op.call.resolve(page({tab:'sellable',filters,items:[]}));await op.pending;c.dispose();
});

test('candidate parser rejects malformed ref, duplicate kind:ref and listing-shaped substitute without replacing data',async t=>{
 for(const[name,items]of [
  ['mismatch',[candidate('item','red_1',{item:'blue_1'})]],['duplicate',[candidate(),candidate()]],
  ['missing ref',[{kind:'item',item:'red_1',name:'Incomplete',qty:3}]],['non-item quantity',[candidate('equip','equip-one',{qty:2})]]
 ])await t.test(name,async()=>{
  const h=harness(),c=h.ui.createClient(h.host);let op=await started(h,()=>c.setTab('sellable'));op.call.resolve(page({tab:'sellable'}));await op.pending;const before=clean(c.state.data);
  op=await started(h,()=>c.refresh());op.call.resolve(page({tab:'sellable',items,revision:99}));assert.equal(await op.pending,false);assert.deepEqual(clean(c.state.data),before);c.dispose();
 });
});

test('the create draft retains input nodes, values, IME and focus through snapshot staleness and pure refresh',async t=>{
 const {document,root,h,view,find}=await sellableMounted();t.after(()=>view.dispose());
 root.querySelector('[data-exchange-pick="item:red_1"]').click();
 const qty=root.querySelector('[data-exchange-draft="qty"]'),price=root.querySelector('[data-exchange-draft="price"]');
 qty.value='8';price.value='140';price.focus();price.dispatch('compositionstart');price.dispatch('input');
 assert.equal(find('draft-fee').textContent,'7 金幣');assert.equal(find('draft-net').textContent,'133 金幣');
 const before=h.calls.length;view.update({...BASE,live:{revision:9}});assert.equal(h.calls.length,before);
 assert.equal(root.querySelector('[data-exchange-draft="price"]'),price);assert.equal(document.activeElement,price);
 assert.equal(price.disabled,false);assert.equal(qty.disabled,false);assert.equal(price.value,'140');assert.equal(qty.value,'8');
 assert.equal(find('create-review').disabled,true,'stale draft is editable but cannot be submitted');
 find('refresh').click();await drain();assert.equal(price.disabled,false);assert.equal(document.activeElement,price);
 h.calls.at(-1).resolve(page({tab:'sellable',revision:9,serverNow:NOW+1}));await drain();price.dispatch('compositionend');
 assert.equal(root.querySelector('[data-exchange-draft="price"]'),price);assert.equal(document.activeElement,price);
 assert.equal(price.value,'140');assert.equal(qty.value,'8');assert.equal(find('create-review').disabled,false);
 assert.equal(document.htmlWrites.length,1);assert.equal(h.calls.filter(x=>x.action==='exchange/action-scoped').length,0);
});

test('create uses an in-window confirmation and cancel restores the same draft and focused control',async t=>{
 const {document,root,h,view,find}=await sellableMounted();t.after(()=>view.dispose());
 root.querySelector('[data-exchange-pick="item:red_1"]').click();
 const qty=root.querySelector('[data-exchange-draft="qty"]'),price=root.querySelector('[data-exchange-draft="price"]');
 qty.value='8';price.value='140';find('create-review').focus();root.scrollTop=220;find('create-form').dispatch('submit');
 assert.equal(find('confirm-pane').hidden,false);assert.equal(find('list-pane').hidden,true);
 assert.match(find('confirm-pane').textContent,/數量8/);assert.match(find('confirm-pane').textContent,/整批總價140/);
 assert.match(find('confirm-pane').textContent,/成交手續費7/);assert.match(find('confirm-pane').textContent,/成交後實收133/);
 assert.equal(root.querySelectorAll('[role="dialog"]').length,0);assert.equal(h.calls.filter(x=>x.action==='exchange/action-scoped').length,0);
 assert.equal(view.handleBack(),true);assert.equal(find('confirm-pane').hidden,true);assert.equal(find('list-pane').hidden,false);
 assert.equal(document.activeElement,find('create-review'));assert.equal(root.scrollTop,220);assert.equal(price.value,'140');assert.equal(qty.value,'8');
 find('create-form').dispatch('submit');find('submit').click();await drain();const op=h.calls.find(x=>x.action==='exchange/action-scoped');
 assert.ok(op);assert.equal(op.body.qty,8);assert.equal(op.body.price,140);assert.equal(op.body.item,'red_1');assert.equal(op.body.recovery,false);
 op.reject(Object.assign(Error('lost response'),{uncertain:true}));await drain();assert.equal(find('pending').hidden,false);assert.equal(find('recover').hidden,true);
});

test('cross-character cancel confirmation names the original seller and never creates a second sheet',async t=>{
 const {root,h,view,find}=await mounted();t.after(()=>view.dispose());
 root.querySelector('[data-exchange-tab="mine"]').click();await drain();
 const row=listing('mine-other',{ownedByMe:true,canBuy:false,seller:{characterId:'other-owned-actor',name:'原出售角色 星霧'}});
 h.calls.at(-1).resolve(page({tab:'mine',items:[row]}));await drain();root.querySelector('[data-exchange-cancel="mine-other"]').click();
 assert.match(find('confirm-pane').textContent,/原出售角色 星霧/);assert.match(find('confirm-pane').textContent,/不收取回費用/);
 assert.equal(root.querySelectorAll('[role="dialog"]').length,0);assert.equal(h.calls.filter(x=>x.action==='exchange/action-scoped').length,0);
 find('confirm-cancel').click();assert.equal(find('confirm-pane').hidden,true);assert.equal(view.actions.pending(),null);
});

test('the pending panel distinguishes missing receipt from explicit retry and displays immutable receipt before acknowledgment',async t=>{
 const {root,h,view,find}=await mounted();t.after(()=>view.dispose());
 root.querySelector('[data-exchange-buy="listing-1"]').click();find('submit').click();await drain();
 const action=h.calls.at(-1);assert.equal(action.action,'exchange/action-scoped');action.reject(Object.assign(Error('lost'),{uncertain:true}));await drain();
 assert.equal(find('pending').dataset.requestId,UUID);find('check-pending').click();await drain();
 const check=h.calls.at(-1);assert.equal(check.action,'exchange/receipt');check.resolve(missing(h,check));await drain();
 assert.equal(find('recover').hidden,false);assert.equal(find('ack').hidden,true);assert.equal(h.calls.filter(x=>x.action==='exchange/action-scoped').length,1);
 find('recover').click();assert.match(find('confirm-title').textContent,/重試/);find('confirm-cancel').click();
 find('check-pending').click();await drain();const found=h.calls.at(-1);found.resolve(committed(h,found));await drain();
 assert.equal(find('ack').hidden,false);assert.equal(find('recover').hidden,true);assert.match(find('receipt-result').textContent,/付款140/);
 view.update({...BASE,live:{revision:100}});find('ack').click();await drain();assert.equal(view.actions.pending(),null);
 assert.equal(h.calls.filter(x=>x.action==='exchange/action-scoped').length,1);assert.ok(h.calls.some(x=>x.action==='atlas/status'));
});

test('backend identity and raw reference limits are rejected locally before creating a pending intent',()=>{
 const h=harness(),c=h.create(),tooLong='x'.repeat(129),accepted='x'.repeat(128);
 assert.equal(c.prepare('buy',{listingId:tooLong},quote(),4),false);assert.equal(c.pending(),null);assert.equal(h.calls.length,0);
 assert.equal(c.prepare('create',{item:tooLong,qty:1,price:140},{...quote(),ref:tooLong,qty:1,sellerCharacterId:BASE.characterId},4),false);
 assert.equal(c.prepare('buy',{listingId:accepted},quote(),4),true);c.cancel();c.dispose();
 assert.throws(()=>harness({context:{...BASE,accountId:tooLong}}).create(),/角色與世界/);
});

test('the real session uses published monster metadata on each read and keeps the existing missing-metadata gate',async t=>{
 const sessionSource=fs.readFileSync(new URL('../public/scene-live-session.js',import.meta.url),'utf8');
 const catalogSource=fs.readFileSync(new URL('../public/monster-expansion-catalog.js',import.meta.url),'utf8');
 const calls=[],sandbox={AbortController,queueMicrotask,console,setTimeout,clearTimeout,setInterval(){throw Error('No polling in this request test');},clearInterval(){}};
 sandbox.window=sandbox;
 const fetch=async(url,options)=>{
  const action=url.split('/app/api/')[1],revision=options.headers['X-Monster-Art-Revision'];
  calls.push({action,headers:clean(options.headers),body:JSON.parse(options.body)});
  const blocked=monsterArtCompatibility(action,revision);
  return {ok:!blocked,status:blocked?.status??200,json:async()=>blocked?{ok:false,...blocked}:{ok:true,found:false,status:'missing',result:null,receipt:null}};
 };
 sandbox.fetch=fetch;vm.runInNewContext(sessionSource,sandbox,{filename:'scene-live-session.js'});
 const session=sandbox.RpgSceneSession.create({endpoint:'http://127.0.0.1:9866/app/api/',fetch,accountId:BASE.accountId,realmId:BASE.realmId,characterId:BASE.characterId});
 t.after(()=>session.dispose());
 const body={accountId:BASE.accountId,realmId:BASE.realmId,characterId:BASE.characterId,selectedCharacterId:BASE.characterId,
  contextEpoch:session.getContext().epoch,kind:'buy',requestId:UUID,listingId:'listing-1',recovery:true};
 await assert.rejects(session.request('exchange/receipt',body),error=>error.code==='assets_update_required'&&error.uncertain===false);
 assert.equal(calls[0].headers['X-Monster-Art-Revision'],undefined);
 vm.runInNewContext(catalogSource,sandbox,{filename:'monster-expansion-catalog.js'});
 assert.equal(sandbox.RpgMonsterExpansionArtRevision,MONSTER_ART_REVISION);
 await drain();assert.equal(calls.length,1,'metadata appearing cannot cause a network request');
 await session.request('exchange/receipt',body);assert.equal(calls[1].headers['X-Monster-Art-Revision'],MONSTER_ART_REVISION);
 assert.deepEqual(calls[1].body,body);
 sandbox.RpgMonsterExpansionArtRevision='bad\r\nheader';
 await assert.rejects(session.request('exchange/receipt',body),error=>error.code==='assets_update_required');
 assert.equal(calls[2].headers['X-Monster-Art-Revision'],undefined);
 sandbox.RpgMonsterExpansion={revision:MONSTER_ART_REVISION};
 await session.request('exchange/receipt',body);assert.equal(calls[3].headers['X-Monster-Art-Revision'],MONSTER_ART_REVISION);
 assert.ok(calls.every(call=>call.action==='exchange/receipt'));
});

test('exclusive cross-window reservation prevents the proven null-read overwrite and sends only one durable UUID',async()=>{
 const storage=memoryStorage(),locks=sharedLocks(),ha=harness({storage,locks}),hb=harness({storage,locks,requestId:()=>UUID2}),a=ha.create(),b=hb.create();
 prepareBuy(a);prepareBuy(b);let second,triggered=false;
 storage.onGet=(key,value)=>{if(!triggered&&key===a.storageKey&&value===null&&locks.events.at(-1)?.[0]==='enter'){triggered=true;second=b.submit();}};
 const first=a.submit();await drain();await drain();
 assert.equal(triggered,true);assert.equal(await second,false);assert.equal(ha.calls.length,1);assert.equal(hb.calls.length,0);
 assert.equal(JSON.parse(storage.getItem(a.storageKey)).requestId,UUID);assert.equal(b.pending().requestId,UUID);
 storage.onGet=null;ha.calls[0].resolve(committed(ha,ha.calls[0]));assert.equal(await first,true);assert.equal(storage.getItem(a.storageKey),null);a.dispose();b.dispose();
});

test('acknowledgment read-remove is atomic with a new reservation and never deletes the next UUID',async()=>{
 const storage=memoryStorage(),locks=sharedLocks(),ha=harness({storage,locks}),hb=harness({storage,locks,requestId:()=>UUID2}),a=ha.create(),b=hb.create();
 prepareBuy(b);await unknown(ha,a);const lookup=await started(ha,()=>a.checkPending());lookup.call.resolve(committed(ha,lookup.call));await lookup.pending;
 let next,triggered=false;
 storage.onGet=(key,value)=>{if(!triggered&&key===a.storageKey&&value!==null&&locks.events.at(-1)?.[0]==='enter'){triggered=true;next=b.submit();}};
 assert.equal(await a.acknowledge(),true);await drain();storage.onGet=null;
 assert.equal(triggered,true);assert.equal(hb.calls.length,1);assert.equal(JSON.parse(storage.getItem(a.storageKey)).requestId,UUID2);
 assert.equal(ha.changes.length,1);hb.calls[0].resolve(committed(hb,hb.calls[0]));assert.equal(await next,true);assert.equal(storage.getItem(a.storageKey),null);a.dispose();b.dispose();
});

test('recovery attempt reservation excludes an older fresh confirmation from another window',async()=>{
 const storage=memoryStorage(),locks=sharedLocks(),ha=harness({storage,locks}),hb=harness({storage,locks,requestId:()=>UUID2}),a=ha.create(),b=hb.create();
 prepareBuy(b);const original=await unknown(ha,a);const lookup=await started(ha,()=>a.checkPending());lookup.call.resolve(missing(ha,lookup.call));await lookup.pending;
 assert.equal(a.prepareRecovery(),true);const recovery=a.submit(),fresh=b.submit();await drain();assert.equal(await fresh,false);assert.equal(hb.calls.length,0);
 const call=ha.calls.at(-1);assert.equal(call.action,'exchange/action-scoped');assert.deepEqual(call.body,{...original.body,recovery:true});
 assert.equal(a.pending().attempts,2);call.resolve(committed(ha,call,quote(),{replayed:true}));assert.equal(await recovery,true);assert.equal(a.pending(),null);a.dispose();b.dispose();
});

test('missing Web Locks fails closed for writes and acknowledgment while still allowing pure receipt lookup',async()=>{
 const storage=memoryStorage(),seed=harness({storage}),a=seed.create();await unknown(seed,a);a.dispose();
 const h=harness({storage,locks:null}),c=h.create();assert.ok(c.state.lockError);
 const check=await started(h,()=>c.checkPending());check.call.resolve(committed(h,check.call));assert.equal(await check.pending,true);
 assert.equal(await c.acknowledge(),false);assert.ok(c.pending());assert.equal(c.prepareRecovery(),false);assert.equal(await c.submit(),false);
 assert.equal(h.calls.length,1);c.dispose();
 const fresh=harness({locks:null}),d=fresh.create();assert.equal(d.prepare('buy',{listingId:'listing-1'},quote(),4),false);
 assert.equal(await d.submit(),false);assert.equal(fresh.calls.length,0);assert.equal(fresh.storage.events.length,0);d.dispose();
});

test('scope changes while waiting for reservation never send a stale mutation',async()=>{
 const locks=sharedLocks(),gate=deferred(),h=harness({locks}),c=h.create();
 const held=locks.request(c.storageKey,{mode:'exclusive'},()=>gate.promise);await drain();prepareBuy(c);
 const op=c.submit();h.setContext({characterId:'actor-b',epoch:8});h.setContext({characterId:BASE.characterId,epoch:9});
 gate.resolve();await held;assert.equal(await op,false);assert.equal(h.calls.length,0);assert.equal(h.storage.getItem(c.storageKey),null);c.dispose();
});

test('scope is rechecked after an acquired reservation before transport and after clear before onChanged',async()=>{
 let h,changeAfterReservation=false;
 const queue=sharedLocks(),locks={request(name,options,callback){return queue.request(name,options,()=>{
  const value=callback();if(changeAfterReservation)h.setContext({epoch:BASE.epoch+2});return value;
 });}};
 h=harness({locks});const c=h.create();prepareBuy(c);changeAfterReservation=true;
 assert.equal(await c.submit(),false);assert.equal(h.calls.length,0);assert.equal(JSON.parse(h.storage.getItem(c.storageKey)).requestId,UUID);c.dispose();
 let h2,changeAfterClear=false;const queue2=sharedLocks(),locks2={request(name,options,callback){return queue2.request(name,options,()=>{
  const value=callback();if(changeAfterClear)h2.setContext({epoch:BASE.epoch+2});return value;
 });}};
 h2=harness({locks:locks2});const d=h2.create();await unknown(h2,d);const check=await started(h2,()=>d.checkPending());check.call.resolve(committed(h2,check.call));await check.pending;
 changeAfterClear=true;assert.equal(await d.acknowledge(),false);assert.equal(h2.changes.length,0);d.dispose();
});

test('a delayed storage event cannot pair an old receipt with a new pending UUID in the renderer',async t=>{
 const {root,h,view,find}=await mounted();t.after(()=>view.dispose());
 root.querySelector('[data-exchange-buy="listing-1"]').click();find('submit').click();await drain();
 h.calls.at(-1).reject(Object.assign(Error('lost response'),{uncertain:true}));await drain();
 find('check-pending').click();await drain();const first=h.calls.at(-1);first.resolve(committed(h,first));await drain();
 assert.equal(find('ack').hidden,false);assert.match(find('receipt-result').textContent,/購買完成/);
 const replacement=clean(view.actions.pending());replacement.requestId=UUID2;replacement.kind='cancel';
 replacement.body={...replacement.body,requestId:UUID2,kind:'cancel',listingId:'replacement-listing'};
 replacement.signature=h.api.signature(replacement.kind,replacement.body);replacement.expected.name='另一筆待核對刊登';
 const raw=JSON.stringify(replacement);h.storage.setItem(view.actions.storageKey,raw);
 // Deliberately omit the storage event. Any ordinary scene repaint must still bind the displayed receipt.
 view.update({...BASE,live:{revision:77}});
 assert.equal(find('pending').dataset.requestId,UUID2);assert.match(find('pending-summary').textContent,/另一筆待核對刊登/);
 assert.doesNotMatch(find('pending-state').textContent,/已找到|完成收據/);assert.equal(find('receipt-result').textContent,'');
 assert.equal(find('ack').hidden,true);assert.equal(find('recover').hidden,true);assert.match(find('operation-notice').textContent,/紀錄已更新.*重新查詢/);
 assert.equal(h.storage.getItem(view.actions.storageKey),raw);assert.equal(h.calls.filter(call=>call.action==='exchange/action-scoped').length,1);
 find('check-pending').click();await drain();const next=h.calls.at(-1);
 assert.equal(next.action,'exchange/receipt');assert.equal(next.body.requestId,UUID2);assert.equal(next.body.kind,'cancel');
 next.resolve(missing(h,next));await drain();assert.equal(find('recover').hidden,false);assert.equal(find('ack').hidden,true);
});
