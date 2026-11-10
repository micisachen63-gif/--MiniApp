import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { freshDb } from './d1-shim.js';
import { createCharacter } from '../src/services/player.js';
import { view as ringScene } from '../src/services/star-ring-scene.js';
import { view as ringReceipt } from '../src/services/star-ring-receipt.js';
import { run as ringOperation } from '../src/services/star-ring-scoped.js';

const source=fs.readFileSync(new URL('../public/scene-star-ring-ui.js',import.meta.url),'utf8');
const NOW=Date.parse('2026-11-05T04:00:00Z'),RUN='ring:'+'a'.repeat(32),OTHER='ring:'+'b'.repeat(32);
const plain=value=>JSON.parse(JSON.stringify(value)),drain=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const TACTICS=['steady','balanced','deep'].map(id=>({id,name:{steady:'穩健',balanced:'均衡',deep:'深入'}[id]}));
const AURA={id:'star_ring_aura_dawn',name:'曙星之環',cost:60,level:40,description:'晨曦星砂',art:'/art/star-ring-surround-20261026/surround-dawn.webp',icon:'/art/star-ring-rewards-20261018/icon-dawn.webp'};
function fixture({char='a',account='u',realm='permanent',revision=1,partyRev=1,status='lobby',now=NOW}={}){
 const allowed=()=>({allowed:true,reason:null});
 const party={id:RUN,name:'星海遠征',status,rev:partyRev,leaderId:char,recipientCharId:char,readonly:false,settlementPending:false,tier:40,difficulty:'normal',tactic:'balanced',nextTactic:null,
  createdAt:now-1000,expiresAt:now+1800000,startedAt:status==='running'?now-7200000:null,endsAt:now+43200000,nextAt:now+7200000,completedStages:0,
  me:{id:char,leader:true,ready:true,left:false,rewards:{exp:0,items:{},equipment:[]}},roleCoverage:{missing:[]},
  members:[{id:char,name:'星海旅人',level:90,ready:true,left:false,roles:['aid'],hp:70,mp:30,maxHp:200,maxMp:100}],
  stages:Array.from({length:6},(_,i)=>({index:i,name:'遠征節點 '+(i+1),status:i===0?'active':'pending',endsAt:now+(i+1)*7200000,result:null})),
  controls:{join:allowed(),ready:allowed(),start:allowed(),tactic:allowed(),leave:allowed()},log:[]};
 const offer=(id,name,cost,extra)=>({id,name,cost,currency:'star_ring_token',currencyName:'星征徽記',canExchange:true,reason:null,...extra});
 return {ok:true,accountId:account,realmId:realm,characterId:char,revision,now,realmPhase:'ACTIVE',readOnly:false,
  character:{id:char,name:'星海旅人',level:90,hp:120,mp:60,stats:{maxHp:200,maxMp:100}},
  catalog:{tiers:[{id:40,name:'初星征途',canCreate:true}],tactics:TACTICS,duration:43200000,stageMs:7200000,hourMs:3600000},
  active:null,party,parties:[party],history:[],daily:{scope:'character',used:false,limit:1,remaining:1,resetsAt:Date.parse('2026-11-05T16:00:00Z')},
  presence:{backgroundRunId:null,lobbyRunId:null,foregroundPartyId:null,canCreate:true,reason:null},
  shop:{canOperate:true,reason:null,balances:{star_ring_token:2000,star_ring_core:240},cosmetics:{catalog:[AURA],owned:[AURA.id],equipped:AURA,currency:'star_ring_token',balance:2000},
   offers:[offer('reroll','洗屬性卷 ×5',5,{item:'scroll_r',qty:5}),offer('gear','本職業遠征裝備',40,{gear:true}),offer(AURA.id,AURA.name,60,{cosmetic:AURA.id}),offer('core-w','必過的武器強化卷',60,{currency:'star_ring_core',currencyName:'星冕核心',item:'guaranteed_scroll_w',qty:1})]}};
}
function harness(extra={},options={}){
 let time=NOW,context={accountId:'u',realmId:'permanent',characterId:'a',epoch:0,...options.context};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
 const sandbox={AbortController,URL,URLSearchParams,console,Date:Clock,...extra};vm.runInNewContext(source,sandbox,{filename:'scene-star-ring-ui.js'});
 const values=options.values||new Map(),calls=[],changed=[],events=[];
 const host={getContext:()=>({...context}),current:()=>true,storage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},
  onState:s=>events.push({revision:s.revision,busy:s.busy,stale:s.stale}),onChanged:(v,operation)=>changed.push({value:plain(v),operation:plain(operation)}),
  request:(action,body,options)=>{const d=deferred();calls.push({action,body:plain(body),options,...d});return d.promise;}};
 return {api:sandbox.RpgSceneStarRing,host,calls,changed,events,values,create:()=>sandbox.RpgSceneStarRing.createClient(host),setContext:c=>{context={...context,...c};},setNow:n=>{time=n;}};
}
async function read(h,c,value=fixture(),query={}){
 const pending=c.refresh(query);assert.equal(h.calls.at(-1).action,'star-ring/scene');h.calls.at(-1).resolve(value);assert.equal(await pending,true);
}
function prepare(c,kind='shop',value='reroll'){
 return kind==='create'?c.prepareCreate({tier:40,difficulty:'normal',tactic:'balanced'}):kind==='action'?c.prepareAction('ready',{ready:false}):kind==='cosmetic'?c.prepareCosmetic(value===null?null:AURA.id):c.prepareShop(value);
}
async function unknown(h,c,kind='shop',value='reroll'){
 assert.equal(prepare(c,kind,value),true);const waiting=c.submit();h.calls.at(-1).reject(Error('lost after possible commit'));assert.equal(await waiting,false);return plain(c.pending());
}
function fields(r){const b=r.body;if(r.kind==='create')return {tier:b.tier,difficulty:b.difficulty,tactic:b.tactic};if(r.kind==='action')return {partyId:b.partyId,action:b.action,...(b.action==='ready'?{ready:b.ready}:b.action==='tactic'?{tactic:b.tactic}:{})};return r.kind==='shop'?{offerId:b.offerId}:{cosmeticId:b.cosmeticId};}
function result(r){
 if(r.kind==='create')return {partyId:RUN,...fields(r)};
 if(r.kind==='action'||r.kind==='cosmetic')return fields(r);
 if(r.expected.cosmetic)return {offerId:r.body.offerId,items:{},equipment:[],cosmetic:r.expected.cosmetic};
 if(r.expected.gear)return {offerId:r.body.offerId,items:{},equipment:[{id:'original-random-gear',name:'原始遠征法袍',slot:'armor',tier:9}]};
 return {offerId:r.body.offerId,items:{[r.expected.item]:r.expected.qty},equipment:[]};
}
function receipt(r,{found=true,revision=1,result:operationResult=result(r),...override}={}){
 return {ok:true,now:NOW,accountId:'u',realmId:'permanent',characterId:'a',revision,kind:r.kind,requestId:r.id,signature:JSON.stringify({kind:r.kind,...fields(r)}),found,recoveryAllowed:!found,
  result:found?operationResult:null,receipt:found?{version:1,kind:r.kind,requestId:r.id,createdAt:NOW,costs:r.kind==='shop'&&!operationResult.alreadyOwned?{[r.expected.currency]:r.expected.cost}:{}}:null,...override};
}
async function check(h,c,r,value,snapshot=fixture()){
 const pending=c.checkPending(r.id);assert.equal(h.calls.at(-1).action,'star-ring/scene');h.calls.at(-1).resolve(snapshot);await drain();
 assert.equal(h.calls.at(-1).action,'star-ring/receipt');assert.deepEqual(h.calls.at(-1).body,{kind:r.kind,...r.body});h.calls.at(-1).resolve(value);return pending;
}
test('pure scene is the only mount/read authority and frozen or historical views cannot prepare writes',async()=>{
 for(const mode of ['frozen','report']){
  const h=harness(),c=h.create(),value=fixture(),query=mode==='report'?{partyId:RUN,recipientCharId:'a-old'}:{};
  if(mode==='frozen'){value.readOnly=true;value.realmPhase='FROZEN';}else{value.party.recipientCharId='a-old';value.party.readonly=true;}
  await read(h,c,value,query);
  for(const kind of ['create','action','shop','cosmetic'])assert.equal(prepare(c,kind),false,mode+':'+kind);
  assert.equal(c.pending(),null);assert.deepEqual(h.calls.map(x=>x.action),['star-ring/scene']);assert.equal(c.state.data.character.id,'a');c.dispose();
 }
});
test('create, action ready=false, shop and cosmetic null preserve complete typed canonical bodies',async t=>{
 for(const [kind,value,expected] of [
  ['create',null,{tier:40,difficulty:'normal',tactic:'balanced'}],
  ['action',null,{partyId:RUN,action:'ready',ready:false}],
  ['shop','reroll',{offerId:'reroll'}],['cosmetic',null,{cosmeticId:null}]
 ])await t.test(kind,async()=>{
  const h=harness(),c=h.create();await read(h,c);assert.equal(prepare(c,kind,value),true);assert.deepEqual(plain(c.state.confirm.body),expected);
  c.cancel();assert.equal(h.calls.length,1);assert.equal(c.pending(),null);
  const r=await unknown(h,c,kind,value);assert.deepEqual(r.body,{...expected,requestId:r.id});assert.equal(r.signature,JSON.stringify({kind,...expected}));
  assert.match(r.id,/^[A-Za-z0-9_-]{8,64}$/);assert.deepEqual(h.calls.at(-1).body,r.body);c.dispose();
 });
});
test('unknown operation survives pure refresh, reopen, reload and A/B/A with its original request ID',async()=>{
 const h=harness(),c=h.create();await read(h,c);const r=await unknown(h,c);
 await read(h,c,fixture({revision:2}));assert.equal(prepare(c,'action'),false);c.dispose();
 h.setContext({characterId:'b',epoch:1});const b=h.create();assert.equal(b.pending(),null);b.dispose();
 h.setContext({characterId:'a',epoch:2});const a=h.create();assert.deepEqual(plain(a.pending()),r);a.dispose();
 const reload=harness({}, {values:h.values}),restored=reload.create();assert.deepEqual(plain(restored.pending()),r);assert.equal(reload.calls.length,0);restored.dispose();
 assert.equal(h.calls.filter(x=>x.action.endsWith('-scoped')).length,1);
});
test('not_found is not acknowledgement; only explicit same-ID same-body confirmation recovers each kind',async t=>{
 for(const kind of ['create','action','shop','cosmetic'])await t.test(kind,async()=>{
  const h=harness(),c=h.create();await read(h,c);const r=await unknown(h,c,kind,kind==='cosmetic'?null:'reroll');
  assert.equal(await check(h,c,r,receipt(r,{found:false})),true);assert.deepEqual(plain(c.pending()),r);assert.equal(c.acknowledge(r.id),false);
  await read(h,c);assert.equal(h.calls.filter(x=>x.action.endsWith('-scoped')).length,1);assert.equal(c.prepareRecovery(r.id),true);c.cancel();
  assert.equal(c.prepareRecovery(r.id),true);const retried=c.submit();assert.deepEqual(h.calls.at(-1).body,r.body);
  h.calls.at(-1).resolve(receipt(r,{revision:2}));await drain();assert.equal(h.calls.at(-1).action,'star-ring/scene');h.calls.at(-1).resolve(fixture({revision:2}));
  assert.equal(await retried,true);assert.equal(c.pending(),null);assert.equal(c.state.lastResult.id,r.id);assert.equal(h.calls.filter(x=>x.action.endsWith('-scoped')).length,2);c.dispose();
 });
});
test('mismatched identity, signature, original result, typed cost or receipt version cannot clear pending',async()=>{
 const patches=[
  {characterId:'b'},{realmId:'season'},{accountId:'v'},{revision:0},{kind:'create'},{requestId:'another_request'},
  {signature:'different'}, {result:{offerId:'reroll',items:{scroll_r:4},equipment:[]}},
  {receipt:{version:1,kind:'shop',requestId:'wrong',createdAt:NOW,costs:{star_ring_token:5}}},
  {receipt:{version:1,kind:'shop',createdAt:NOW,costs:{}}},
  {found:false,result:{},receipt:null},{found:false,result:null,receipt:{},recoveryAllowed:true}
 ];
 for(const patch of patches){
  const h=harness(),c=h.create();await read(h,c);const r=await unknown(h,c);
  assert.equal(await check(h,c,r,{...receipt(r),...patch}),false,JSON.stringify(patch));assert.ok(c.pending());assert.equal(c.acknowledge(r.id),false);c.dispose();
 }
 for(const value of ['5',4,6]){
  const h=harness(),c=h.create();await read(h,c);const r=await unknown(h,c),v=receipt(r);v.receipt.costs.star_ring_token=value;
  assert.equal(await check(h,c,r,v),false);assert.ok(c.pending());c.dispose();
 }
});
test('matching receipt requires explicit acknowledgement; original random gear and zero-cost already-owned cosmetics are retained',async()=>{
 for(const offer of ['gear',AURA.id]){
  const h=harness(),c=h.create();await read(h,c);const r=await unknown(h,c,'shop',offer),saved=result(r);
  if(offer===AURA.id)saved.alreadyOwned=true;
  assert.equal(await check(h,c,r,receipt(r,{result:saved})),true);assert.ok(c.pending());assert.equal(c.acknowledge(r.id),true);
  assert.deepEqual(plain(c.state.lastResult.result),saved);assert.deepEqual(plain(c.state.lastResult.costs),offer===AURA.id?{}:{star_ring_token:40});
  assert.equal(h.calls.filter(x=>x.action.endsWith('-scoped')).length,1);c.dispose();
 }
});
test('a newer receipt raises the revision floor; only a fresh scene permits acknowledgement',async()=>{
 const h=harness(),c=h.create();await read(h,c);const r=await unknown(h,c);
 assert.equal(await check(h,c,r,receipt(r,{revision:3})),true);assert.equal(c.state.stale,true);assert.equal(c.acknowledge(r.id),false);
 const old=c.refresh();h.calls.at(-1).resolve(fixture({revision:2}));assert.equal(await old,false);assert.ok(c.pending());
 await read(h,c,fixture({revision:3}));assert.equal(c.acknowledge(r.id),true);assert.equal(c.pending(),null);c.dispose();
});
test('scene party revision never goes backwards, and changes invalidate open confirmations',async()=>{
 const h=harness(),c=h.create();await read(h,c,fixture({partyRev:3}));assert.equal(c.prepareAction('start'),true);
 const old=c.refresh();h.calls.at(-1).resolve(fixture({revision:2,partyRev:2}));assert.equal(await old,false);assert.equal(c.state.confirm,null);
 await read(h,c,fixture({revision:3,partyRev:4}));assert.equal(c.prepareAction('start'),true);
 await read(h,c,fixture({revision:4,partyRev:5}));assert.equal(c.state.confirm,null);assert.equal(await c.submit(),false);c.dispose();
});
test('A/B/A blocks late 200, late 409 and late receipt without clearing the original operation',async t=>{
 for(const mode of ['200','409','receipt'])await t.test(mode,async()=>{
  const h=harness(),c=h.create();await read(h,c);let r,waiting,call;
  if(mode==='receipt'){r=await unknown(h,c);waiting=c.checkPending(r.id);h.calls.at(-1).resolve(fixture());await drain();call=h.calls.at(-1);}
  else{prepare(c);waiting=c.submit();r=plain(c.pending());call=h.calls.at(-1);}
  h.setContext({realmId:'season',characterId:'b',epoch:1});h.setContext({realmId:'permanent',characterId:'a',epoch:2});
  if(mode==='409')call.reject(Object.assign(Error('late failure'),{status:409,code:'request_reused'}));else call.resolve(receipt(r));
  assert.equal(await waiting,false);assert.deepEqual(plain(c.pending()),r);assert.equal(h.changed.length,0);assert.equal(h.calls.filter(x=>x.action.endsWith('-scoped')).length,1);
  const current=h.create();assert.deepEqual(plain(current.pending()),r);assert.equal(current.state.lastResult,null);c.dispose();current.dispose();
 });
});
test('recovery is disabled when original evidence is incomplete or realm becomes frozen',async()=>{
 const h=harness(),c=h.create();await read(h,c);const r=await unknown(h,c);
 assert.equal(await check(h,c,r,receipt(r,{found:false,recoveryAllowed:false})),true);assert.equal(c.prepareRecovery(r.id),false);
 const frozen=fixture({revision:2});frozen.readOnly=true;await read(h,c,frozen);
 assert.equal(c.prepareRecovery(r.id),false);assert.ok(c.pending());assert.equal(h.calls.filter(x=>x.action.endsWith('-scoped')).length,1);c.dispose();
});
test('deep links distinguish report and explicit join intent; invitations never copy dev identity',()=>{
 const h=harness(),api=h.api;
 assert.deepEqual(plain(api.parseDestination('?ringParty='+RUN+'&ringJoin=1')),{partyId:RUN,joinIntent:true,tab:'current'});
 assert.deepEqual(plain(api.parseDestination('?ringParty='+RUN+'&ringChar=a-old&ringJoin=1')),{partyId:RUN,recipientCharId:'a-old',joinIntent:false,tab:'current'});
 assert.deepEqual(plain(api.parseDestination('', 'ring_'+'a'.repeat(32))),{partyId:RUN,joinIntent:true,tab:'current'});
 for(const value of ['?ringParty=broken&ringJoin=1','?ringParty='+RUN+'&ringChar=%3Cscript%3E','?ringChar=a-old'])assert.equal(api.parseDestination(value),null);
 const url=new URL(api.invitationUrl('http://127.0.0.1:9773/?accountId=90101&characterId=private#debug',RUN));assert.equal(url.searchParams.get('ringParty'),RUN);assert.equal(url.searchParams.get('ringJoin'),'1');assert.equal(url.searchParams.size,2);assert.equal(url.hash,'');
 assert.equal(api.invitationUrl('javascript:alert(1)',RUN),null);assert.equal(h.calls.length,0);
});

class RingRoot{
 constructor(){this.isConnected=true;this.scrollTop=0;this.reveals=0;this.focuses=[];this.controls=[];this.panels=[];this.events=new Map();this.html='';this.visibility=new Map();
  this.ownerDocument={body:{kind:'body'},documentElement:{kind:'html'},hidden:false,addEventListener:(k,f)=>this.visibility.set(k,f),removeEventListener:k=>this.visibility.delete(k)};this.ownerDocument.activeElement=this.ownerDocument.body;}
 contains(node){return node?.root===this&&this.controls.includes(node);}
 addEventListener(k,fn){this.events.set(k,fn);}removeEventListener(k){this.events.delete(k);}
 get innerHTML(){return this.html;}
 set innerHTML(html){
  if(this.contains(this.ownerDocument.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;
  this.html=html;this.controls=[];this.panels=[];
  for(const m of html.matchAll(/<section[^>]*data-ssr-pending="([^"]+)"[^>]*>/g))this.panels.push({id:m[1],start:m.index,end:html.indexOf('</section>',m.index),scrollIntoView:()=>{this.reveals++;this.scrollTop=0;}});
  for(const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
   const dataset={};for(const a of m[1].matchAll(/\bdata-([a-z0-9-]+)="([^"]*)"/g))dataset[a[1].replace(/-([a-z])/g,(_,v)=>v.toUpperCase())]=a[2];
   const root=this,panel=this.panels.find(p=>m.index>p.start&&m.index<p.end);
   this.controls.push({root,dataset,disabled:/(?:^|\s)disabled(?:\s|$)/.test(m[1]),setAttribute(){},
    closest(selector){return selector==='[data-ssr-action]'?this:selector==='[data-ssr-pending]'?panel:null;},
    focus(){if(!this.disabled){root.ownerDocument.activeElement=this;root.focuses.push({...dataset});}}});
  }
 }
 querySelectorAll(selector){if(selector==='button')return this.controls;const action=selector.match(/^\[data-ssr-action="([^"]+)"\]$/)?.[1];return action?this.controls.filter(b=>b.dataset.ssrAction===action):[];}
 querySelector(selector){if(selector==='[data-ssr-confirm]')return this.html.includes('data-ssr-confirm')?{scrollIntoView(){}}:null;return this.querySelectorAll(selector)[0]||null;}
 button(action,fields={}){return this.controls.find(b=>b.dataset.ssrAction===action&&Object.entries(fields).every(([k,v])=>b.dataset[k]===String(v)));}
 async click(action,fields={}){const target=this.button(action,fields);assert.ok(target,'missing control '+action);if(!target.disabled)target.focus();return this.events.get('click')?.({target});}
}
async function mountHarness(data=fixture(),options={},params={}){
 const frames=new Map(),intervals=new Map();let next=0;
 const h=harness({requestAnimationFrame(fn){const id=++next;frames.set(id,{fn,cancelled:false});return id;},cancelAnimationFrame(id){if(frames.has(id))frames.get(id).cancelled=true;},
  setInterval(fn){const id=++next;intervals.set(id,fn);return id;},clearInterval(id){intervals.delete(id);}},options);
 const root=new RingRoot(),view=h.api.mount(root,h.host,params);h.calls.at(-1).resolve(data);await drain();
 return {h,root,view,frames,intervals,flush(ignoreCancel=false){const batch=[...frames.values()];frames.clear();for(const f of batch)if(ignoreCancel||!f.cancelled)f.fn();}};
}
async function lostShop(m){
 await m.root.click('tab',{tab:'shop'});await m.root.click('buy',{offer:'reroll'});assert.equal(m.root.ownerDocument.activeElement.dataset.ssrAction,'cancel');
 const submit=m.root.click('confirm');m.h.calls.at(-1).reject(Error('lost write'));await submit;await drain();return JSON.parse([...m.h.values.values()][0]);
}
test('cancel and Back restore the exact action source without posting; current actor spend is labelled',async()=>{
 const m=await mountHarness();await m.root.click('ready');assert.equal(m.root.ownerDocument.activeElement.dataset.ssrAction,'cancel');assert.equal(m.view.handleBack(),true);assert.equal(m.root.ownerDocument.activeElement.dataset.ssrAction,'ready');
 await m.root.click('tab',{tab:'shop'});await m.root.click('buy',{offer:'gear'});assert.match(m.root.html,/消耗 40 星征徽記/);assert.match(m.root.html,/目前角色/);await m.root.click('cancel');assert.equal(m.root.ownerDocument.activeElement.dataset.offer,'gear');
 assert.equal(m.h.calls.filter(x=>x.action.endsWith('-scoped')).length,0);m.view.dispose();
});
test('unknown reveal focuses pure lookup once; poll, visibility, reload and reopen never retry or steal later focus',async()=>{
 const m=await mountHarness(),r=await lostShop(m);m.flush();assert.equal(m.root.reveals,1);assert.equal(m.root.ownerDocument.activeElement.dataset.ssrAction,'check-pending');
 m.root.scrollTop=480;m.root.button('tab',{tab:'cosmetics'}).focus();[...m.intervals.values()][0]();m.h.calls.at(-1).resolve(fixture());await drain();m.flush();
 assert.equal(m.root.reveals,1);assert.equal(m.root.scrollTop,480);assert.equal(m.root.ownerDocument.activeElement.dataset.tab,'cosmetics');
 m.root.visibility.get('visibilitychange')();m.h.calls.at(-1).resolve(fixture());await drain();assert.equal(m.h.calls.filter(x=>x.action.endsWith('-scoped')).length,1);m.view.dispose();
 const reopened=await mountHarness(fixture(),{values:m.h.values},{partyId:RUN,joinIntent:true});reopened.flush();assert.equal(reopened.root.reveals,0);assert.match(reopened.root.html,new RegExp(r.id));assert.equal(reopened.h.calls.length,1);reopened.view.dispose();
});
test('queued unknown reveal cannot override later focus, dispose, detach, hidden document or A/B/A',async t=>{
 for(const kind of ['focus','dispose','detached','hidden','context'])await t.test(kind,async()=>{
  const m=await mountHarness();await lostShop(m);const outside={kind:'new-focus'};m.root.ownerDocument.activeElement=outside;
  if(kind==='dispose')m.view.dispose();if(kind==='detached')m.root.isConnected=false;if(kind==='hidden')m.root.ownerDocument.hidden=true;
  if(kind==='context'){m.h.setContext({characterId:'b',epoch:1});m.h.setContext({characterId:'a',epoch:2});}
  m.flush(true);assert.equal(m.root.reveals,0);assert.equal(m.root.ownerDocument.activeElement,outside);m.view.dispose();
 });
});
test('invitation load and report load perform no join; explicit join-ready needs confirmation',async()=>{
 const value=fixture();value.party.me=null;value.party.leaderId='leader';value.party.members=[];
 const m=await mountHarness(value,{}, {partyId:RUN,joinIntent:true});
 assert.match(m.root.html,/data-ssr-join-intent/);assert.deepEqual(m.h.calls.map(x=>x.action),['star-ring/scene']);await m.root.click('join-ready');assert.match(m.root.html,/data-ssr-confirm/);await m.root.click('cancel');assert.equal(m.h.calls.length,1);m.view.dispose();
 const report=fixture();report.party.recipientCharId='a-old';report.party.readonly=true;
 const old=await mountHarness(report,{}, {partyId:RUN,recipientCharId:'a-old',joinIntent:true});
 assert.match(old.root.html,/data-ssr-report/);assert.match(old.root.html,/目前操作角色維持 星海旅人/);assert.equal(old.root.button('join-ready'),undefined);assert.equal(old.root.button('ready'),undefined);assert.doesNotMatch(old.root.html,/data-ssr-join-intent/);old.view.dispose();
});
test('due twelve-hour projection keeps saved stages/rewards distinct from battle snapshot and current HP',async()=>{
 const value=fixture({status:'running'});value.party.endsAt=NOW-1;value.party.nextAt=NOW-1;value.party.settlementPending=true;
 value.party.battle={preview:true,enemy:{name:'遠征魔物',hp:900,maxHp:1000},members:value.party.members};value.party.pendingRankReward={preview:true};
 const m=await mountHarness(value);assert.match(m.root.html,/等待伺服器結算/);assert.match(m.root.html,/已結算階段 0 \/ 6/);assert.match(m.root.html,/data-ssr-stage-settled="0"/);
 assert.doesNotMatch(m.root.html,/data-ssr-stage-settled="1"/);assert.match(m.root.html,/目前角色/);assert.match(m.root.html,/生命 120 \/ 200/);assert.match(m.root.html,/遠征生命 70 \/ 200/);assert.match(m.root.html,/尚未計入已領收益/);m.view.dispose();
});
test('cosmetic tab uses original preview art, equipped status and explicit null unequip without legacy API calls',async()=>{
 const m=await mountHarness(fixture(),{}, {tab:'cosmetics'});assert.match(m.root.html,/星紋素材預覽/);assert.match(m.root.html,/surround-dawn.webp/);assert.match(m.root.html,/穿戴中/);
 await m.root.click('equip',{cosmetic:'none'});assert.match(m.root.html,/卸下星紋/);await m.root.click('cancel');assert.equal(m.h.calls.length,1);m.view.dispose();
});
test('actual SQLite scene, original operations and typed receipts drive the UI with original random gear identity',async t=>{
 const env={DB:freshDb(),REALM_CONTEXT:{id:'permanent',phase:'ACTIVE'}};t.after(()=>env.DB.sqlite.close());
 await createCharacter(env,{tgId:'111',name:'星環前端契約',gender:'m',baseClass:'mage'},NOW);
 await env.DB.prepare("UPDATE rpg_characters SET level=90,class_path='B1' WHERE tg_id='111'").run();
 for(const [item,n]of [['star_ring_token',2000],['star_ring_core',240]])await env.DB.prepare('INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES(?,?,?)').bind('111',item,n).run();
 const h=harness({}, {context:{accountId:'111',characterId:'111'}}),calls=[];let loseShop=false;
 h.host.request=async(action,body)=>{
  const wire={...body,realmId:'permanent',selectedCharacterId:'111'};calls.push({action,body:plain(wire)});
  if(action==='star-ring/scene')return ringScene(env,'111',wire,NOW);
  if(action==='star-ring/receipt')return ringReceipt(env,'111',wire,NOW,'app');
  const kind=({'star-ring/create-scoped':'create','star-ring/action-scoped':'action','star-ring/shop-scoped':'shop','star-ring/cosmetics/equip-scoped':'cosmetic'})[action];assert.ok(kind,action);
  const value=await ringOperation(env,'111',kind,wire,NOW,'app');if(kind==='shop'&&loseShop){loseShop=false;throw Error('reply lost after original transaction');}return value;
 };
 const c=h.create();t.after(()=>c.dispose());assert.equal(await c.refresh(),true,c.state.error);assert.equal(c.state.data.shop.balances.star_ring_token,2000);
 assert.equal(c.prepareCreate({tier:40,difficulty:'normal',tactic:'balanced'}),true);assert.equal(await c.submit(),true,c.state.error);const partyId=c.state.data.party.id;assert.match(partyId,/^ring:[a-f0-9]{32}$/);
 for(const [action,extra] of [['ready',{ready:false}],['ready',{ready:true}],['tactic',{tactic:'steady'}]]){
  assert.equal(c.prepareAction(action,extra),true,c.state.error);assert.equal(await c.submit(),true,c.state.error);
 }
 for(const offer of ['reroll','core-w',AURA.id]){assert.equal(c.prepareShop(offer),true,c.state.error);assert.equal(await c.submit(),true,c.state.error);}
 assert.equal(c.prepareCosmetic(AURA.id),true);assert.equal(await c.submit(),true,c.state.error);assert.equal(c.state.data.shop.cosmetics.equipped.id,AURA.id);
 assert.equal(c.prepareCosmetic(null),true);assert.equal(await c.submit(),true,c.state.error);assert.equal(c.state.data.shop.cosmetics.equipped,null);
 loseShop=true;assert.equal(c.prepareShop('gear'),true);assert.equal(await c.submit(),false);const r=plain(c.pending());
 assert.equal(await c.checkPending(r.id),true,c.state.error);const original=plain(c.state.receipt.result.equipment);assert.equal(original.length,1);assert.ok(original[0].id);
 assert.equal(c.acknowledge(r.id),true);assert.deepEqual(plain(c.state.lastResult.result.equipment),original);
 assert.equal(c.prepareAction('leave'),true);assert.equal(await c.submit(),true,c.state.error);
 assert.equal(calls.filter(x=>x.action==='star-ring/shop-scoped').length,4);assert.ok(calls.every(x=>['star-ring/scene','star-ring/receipt'].includes(x.action)||x.action.endsWith('-scoped')));
});

test('historical report to shop clears the report query before permitting current actor spending',async()=>{
 const report=fixture();report.party.recipientCharId='a-old';report.party.readonly=true;
 const m=await mountHarness(report,{}, {partyId:RUN,recipientCharId:'a-old',joinIntent:true});
 const switchTab=m.root.click('tab',{tab:'shop'});assert.equal(m.h.calls.at(-1).action,'star-ring/scene');assert.deepEqual(m.h.calls.at(-1).body,{});
 assert.equal(m.root.button('buy',{offer:'reroll'}).disabled,true);
 m.h.calls.at(-1).resolve(fixture());await switchTab;assert.match(m.root.html,/目前角色/);assert.match(m.root.html,/星海旅人/);
 assert.doesNotMatch(m.root.html,/data-ssr-report/);assert.equal(m.root.button('buy',{offer:'reroll'}).disabled,false);
 await m.root.click('buy',{offer:'reroll'});assert.match(m.root.html,/物品放入目前角色背包/);await m.root.click('cancel');
 assert.equal(m.h.calls.filter(x=>x.action.endsWith('-scoped')).length,0);m.view.dispose();
});
test('acknowledging a committed create opens its original party with only a pure read',async()=>{
 const h=harness(),c=h.create();await read(h,c);const r=await unknown(h,c,'create');
 assert.equal(await check(h,c,r,receipt(r)),true);assert.equal(c.acknowledge(r.id),true);
 assert.deepEqual(plain(c.getQuery()),{partyId:RUN});assert.equal(h.calls.at(-1).action,'star-ring/scene');assert.deepEqual(h.calls.at(-1).body,{partyId:RUN});
 assert.equal(h.changed.at(-1).operation.acknowledged,true);h.calls.at(-1).resolve(fixture());await drain();assert.equal(c.state.stale,false);
 assert.equal(h.calls.filter(x=>x.action.endsWith('-scoped')).length,1);c.dispose();
});
