import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {freshDb} from './d1-shim.js';
import {T0} from './helpers.js';
import {createCharacter} from '../src/services/player.js';
import * as G from '../src/services/guardian-sigil.js';

const read=file=>fs.readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const key=name=>name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
function node(){const events=new Map();return {innerHTML:'',contains:()=>true,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),click(dataset){const button={dataset,disabled:false,closest:()=>({dataset:{guardianId:dataset.guardianId}}),hasAttribute:name=>Object.hasOwn(dataset,key(name))};events.get('click')?.({target:{closest:()=>button}});},change(attribute,checked){events.get('change')?.({target:{checked,hasAttribute:name=>key(name)===attribute}});}};}
async function fixture(rank=1){
  const env={DB:freshDb()};env.DB.sqlite.exec('PRAGMA foreign_keys=ON');
  await createCharacter(env,{tgId:'790',name:'隔離神羽旅者',gender:'f',baseClass:'mage'},T0);
  await env.DB.prepare("UPDATE rpg_characters SET level=50,gold=100000 WHERE tg_id='790'").run();
  await env.DB.prepare('INSERT INTO rpg_guardian_operations(operation_id,account_id,char_id,request_id,action,payload_hash,config_version,cost_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('controls-seed','790','790','controls-seed','summon','0'.repeat(64),'fixture','{}','{}',T0).run();
  for(let i=0;i<(rank>=6?6:4);i++)await G.insertSigil(env.DB,{id:'m'+i,char_id:'790',type:'magic',quality:rank,bound:i===3?1:0,source_operation_id:'controls-seed',created_at:T0}).run();
  await env.DB.prepare("INSERT INTO rpg_inventory(tg_id,item,quantity) VALUES('790','guardian_summon_stone',2)").run();
  return {env,config:G.config(env).config,state:await G.state(env,'790',T0)};
}
function harness({config,state,host={},initialView='fuse'}={}){
  const root=node(),slot=node(),scene={dataset:{guardianAngelPose:'portrait'}},writes=[],receipts=[],presentationOptions=[];let gesture,actor=state.charId,id=0,pendingWrite,pendingRead;
  root.querySelector=selector=>selector==='[data-guardian-fusion-root]'&&root.innerHTML.includes('data-guardian-fusion-root')?slot:selector==='.guardian-worldtree-scene'&&root.innerHTML.includes('guardian-worldtree-scene')?scene:null;
  const window={RpgGuardianWorldTree:{markup:()=>'<div class="guardian-worldtree-scene"></div>',mount:()=>({cleanup(){}})},RpgGuardianSummonGesture:{mount:(_scene,options)=>{let held=false;gesture={options,async complete(){if(held||!options.canStart())return null;held=true;const result=await options.commit();held=false;options.onFinish(result,{complete:!!result});return result;},isInteracting:()=>held,getState:()=>({pointer:held?1:null,requesting:held}),cleanup(){}};return gesture;}},RpgGuardianPresentation:{mount:(_scene,options)=>{presentationOptions.push(options);return {cleanup(){},isInteracting:()=>false};}}};
  const context=vm.createContext({window,AbortController,setTimeout,clearTimeout});
  for(const file of ['guardian-sigil-contract.js','guardian-fusion-batch.js','guardian-fusion-ui.js','guardian-ritual.js','guardian-sigil.js'])vm.runInContext(read(file),context);
  const adapter={characterId:()=>actor,requestId:()=>`controls_request_${++id}`,confirm:async()=>true,saveReceipt:(operation,presentation)=>receipts.push({operation,presentation}),...host,
    ...(typeof host.state==='function'?{state:options=>{pendingRead=Promise.resolve(host.state(options));return pendingRead;}}:{}),
    mutate:(action,body)=>{writes.push({action,body:plain(body)});pendingWrite=Promise.resolve(host.mutate?.(action,body));return pendingWrite;}};
  const controller=window.RpgGuardianSigil.mount(root,{config,state,host:adapter,interactive:true,autoLoad:false,initialView});
  return {root,slot,window,writes,receipts,presentationOptions,controller,get gesture(){return gesture;},get pendingWrite(){return pendingWrite;},get pendingRead(){return pendingRead;},setActor:value=>actor=value,prepare(){slot.click({guardianFusionFill:''});slot.click({guardianFusionPrepare:''});}};
}

test('fusion selection, entering its ritual and returning to materials perform zero mutations',async()=>{
  const f=await fixture(),h=harness({...f,host:{mutate:()=>{throw Error('preparation must not mutate');}}});
  assert.match(h.root.innerHTML,/guardian-fusion-picker/);assert.match(h.root.innerHTML,/guardian-fusion-resource/);assert.doesNotMatch(h.root.innerHTML,/guardian-resources|guardian-tabs|data-guardian-action="summon"/);assert.match(h.slot.innerHTML,/guardian-fusion-quality-tabs/);assert.match(h.slot.innerHTML,/guardian-fusion-toolbar/);assert.match(h.slot.innerHTML,/guardian-fusion-grid/);assert.match(h.slot.innerHTML,/guardian-fusion-footer/);
  h.prepare();assert.match(h.root.innerHTML,/guardian-fusion-ritual/);assert.match(h.root.innerHTML,/素材尚未扣除/);assert.equal(h.writes.length,0);
  assert.equal(h.gesture.options.action,'fuse');
  h.root.click({guardianFusionReturn:''});assert.match(h.root.innerHTML,/data-guardian-fusion-root/);assert.match(h.root.innerHTML,/guardian-fusion-picker/);assert.equal(h.writes.length,0);
  assert.equal(f.env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_guardian_sigils WHERE char_id='790'").get().n,4);assert.equal(f.env.DB.sqlite.prepare("SELECT gold FROM rpg_characters WHERE tg_id='790'").get().gold,100000);h.controller.cleanup();
});

test('only a completed fusion gesture submits the frozen IDs once and renders the true committed fuse result',async()=>{
  const f=await fixture(),h=harness({...f,host:{mutate:(action,body)=>G[action](f.env,'790',body,T0)}});
  h.prepare();const result=await h.gesture.complete();await tick();
  assert.equal(result.action,'fuse');assert.equal(result.success,true);assert.equal(h.writes.length,1);assert.equal(h.writes[0].action,'fuse');assert.deepEqual(h.writes[0].body.itemIds,['m0','m1','m2','m3']);assert.equal(h.writes[0].body.primaryId,'m0');
  assert.equal(h.presentationOptions.at(-1).operation.action,'fuse');assert.equal(h.presentationOptions.at(-1).operation.results[0].quality,'green');assert.equal(h.presentationOptions.at(-1).operation.results[0].bound,true);
  assert.equal(f.env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_guardian_sigils WHERE char_id='790'").get().n,1);assert.equal(f.env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_guardian_operations WHERE action='fuse'").get().n,1);assert.deepEqual(f.env.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);h.controller.cleanup();
});

test('failed fusion presents the exact refunded primary and keeps failure distinct from a new summon',async()=>{
  const f=await fixture(6);f.env.GUARDIAN_SETTINGS=JSON.stringify({upgradeSuccess:[1,.95,.85,.8,.4,1e-12,.95]});f.config=G.config(f.env).config;
  const h=harness({...f,host:{mutate:(action,body)=>G[action](f.env,'790',body,T0)}});
  h.slot.click({guardianFusionQuality:'gold'});h.prepare();const result=await h.gesture.complete();
  assert.equal(result.action,'fuse');assert.equal(result.success,false);assert.equal(result.refundedId,'m0');assert.equal(result.results[0].id,'m0');assert.equal(result.results[0].quality,'gold');assert.equal(result.results[0].bound,true);
  assert.match(h.root.innerHTML,/主羽毛已退還/);assert.equal(h.presentationOptions.at(-1).operation.success,false);assert.equal(h.presentationOptions.at(-1).operation.results[0].id,'m0');assert.equal(f.env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_guardian_sigils WHERE char_id='790'").get().n,1);h.controller.cleanup();
});

test('committed fusion response loss restores pending material IDs and retries exactly the same UUID without another fee',async()=>{
  const f=await fixture();let pending=null,receipt=null,drop=true;const sent=[];
  const host={savePending:value=>pending=plain(value),loadPending:()=>pending,clearPending:()=>pending=null,saveReceipt:operation=>receipt=operation,loadReceipt:()=>receipt?{operation:receipt}:null,mutate:async(action,body)=>{sent.push(plain(body));const value=await G[action](f.env,'790',body,T0);if(drop){drop=false;throw Object.assign(Error('lost after commit'),{uncertain:true});}return value;}};
  const first=harness({...f,host});first.prepare();await first.gesture.complete();assert.ok(pending);assert.match(first.root.innerHTML,/原升階待確認/);assert.equal(sent.length,1);const charged=f.env.DB.sqlite.prepare("SELECT gold FROM rpg_characters WHERE tg_id='790'").get().gold;first.controller.cleanup();
  const restored=harness({...f,state:await G.state(f.env,'790',T0),host});assert.match(restored.root.innerHTML,/原升階待確認/);assert.equal(sent.length,1);restored.root.click({guardianRetry:''});await restored.pendingWrite;await tick();
  assert.deepEqual(sent[0],sent[1]);assert.equal(pending,null);assert.equal(f.env.DB.sqlite.prepare("SELECT gold FROM rpg_characters WHERE tg_id='790'").get().gold,charged);assert.equal(f.env.DB.sqlite.prepare("SELECT COUNT(*) n FROM rpg_guardian_operations WHERE action='fuse'").get().n,1);assert.equal(restored.presentationOptions.at(-1).operation.action,'fuse');restored.controller.cleanup();
});

test('card summon, cancel and resume use real assist snapshots; continuation changes no balance or current enabled status',async()=>{
  const f=await fixture(),calls=[];const h=harness({...f,initialView:'inventory',host:{mutate:async(action,body)=>{calls.push({action,body:plain(body)});return G[action](f.env,'790',body,T0);}}});
  assert.match(h.root.innerHTML,/data-guardian-action="assist"/);assert.match(h.root.innerHTML,/guardian-item-management/);assert.match(h.root.innerHTML,/data-guardian-assist-continuation/);
  h.root.change('guardianAssistContinuation',true);assert.equal(calls.length,0,'an unselected continuation preference is a draft');
  h.root.click({guardianAction:'assist',guardianId:'m0'});await tick();await h.pendingWrite;await tick();assert.equal(calls[0].action,'assist');assert.equal(calls[0].body.mode,'start');assert.equal(calls[0].body.autoRenew,true);
  let state=await G.state(f.env,'790',T0);assert.equal(state.assist.enabled,true);assert.equal(state.assist.stoneCount,1);assert.equal(state.activeGuardian.id,'m0');assert.equal(state.activeGuardian.bound,true);
  h.root.change('guardianAssistContinuation',false);await h.pendingWrite;await tick();state=await G.state(f.env,'790',T0);assert.equal(calls.at(-1).body.mode,'continuation');assert.equal(state.assist.enabled,true);assert.equal(state.assist.autoRenew,false);assert.equal(state.assist.stoneCount,1);
  h.root.click({guardianAction:'assist',guardianId:'m0'});await h.pendingWrite;await tick();state=await G.state(f.env,'790',T0);assert.equal(calls.at(-1).body.mode,'stop');assert.equal(state.assist.enabled,false);assert.equal(state.assist.remainingBattles,1440);assert.equal(state.activeGuardian.id,'m0');
  h.root.click({guardianAction:'assist',guardianId:'m0'});await h.pendingWrite;await tick();state=await G.state(f.env,'790',T0);assert.equal(calls.at(-1).body.mode,'start');assert.equal(state.assist.enabled,true);assert.equal(state.assist.stoneCount,1);assert.equal(state.assist.remainingBattles,1440);assert.equal(state.balances.gold,100000);h.controller.cleanup();
});

test('a prepared fusion cannot submit after the actor switches or a selected material becomes protected',async()=>{
  const f=await fixture(),h=harness({...f,host:{mutate:()=>{throw Error('invalid preparation must not submit');}}});h.prepare();h.controller.update({state:{...f.state,revision:f.state.revision+1,inventory:{items:f.state.inventory.items.map(item=>item.id==='m0'?{...item,inTrade:true}:item)}}});
  assert.equal(await h.gesture.complete(),null);assert.equal(h.writes.length,0);h.controller.cleanup();
  const switched=harness({...f,host:{mutate:()=>{throw Error('changed actor must not submit');}}});switched.prepare();switched.setActor('791');await switched.gesture.complete();assert.equal(switched.writes.length,0);switched.controller.cleanup();
});

test('an uncertain card summon keeps recovery visible even with a previous receipt; replay consumes one stone only',async()=>{
  const f=await fixture();let drop=true,pending=null;const sent=[],old={operationId:'old-draw',requestId:'old-request',charId:'790',action:'summon',status:'committed',results:[f.state.inventory.items[0]]};
  const h=harness({...f,initialView:'inventory',host:{loadReceipt:()=>({operation:old}),savePending:value=>pending=plain(value),clearPending:()=>pending=null,mutate:async(action,body)=>{sent.push(plain(body));const value=await G[action](f.env,'790',body,T0);if(drop){drop=false;throw Object.assign(Error('lost assist reply'),{uncertain:true});}return value;}}});
  h.root.click({guardianAction:'assist',guardianId:'m0'});await tick();await h.pendingWrite.catch(()=>{});await tick();assert.ok(pending);assert.match(h.root.innerHTML,/data-guardian-recover/);assert.match(h.root.innerHTML,/有一筆操作待確認/);
  h.root.click({guardianRetry:''});await h.pendingWrite;await tick();assert.deepEqual(sent[0],sent[1]);assert.equal(pending,null);const state=await G.state(f.env,'790',T0);assert.equal(state.assist.stoneCount,1);assert.equal(state.assist.enabled,true);h.controller.cleanup();
});

test('fusion fetches only the selected quality once, caches same-revision tabs and restores the ordinary inventory',async()=>{
  const f=await fixture();for(let i=0;i<40;i++)await G.insertSigil(f.env.DB,{id:'a'+String(i).padStart(2,'0'),char_id:'790',type:'magic',quality:6,source_operation_id:'controls-seed',created_at:T0}).run();f.state=await G.state(f.env,'790',T0);
  assert.ok(f.state.inventory.items.every(item=>item.quality==='gold'),'the ordinary first page initially hides white cards');
  const reads=[],h=harness({...f,initialView:'overview',host:{state:options=>{reads.push({...options});return G.state(f.env,'790',T0,options);},mutate:()=>{throw Error('browsing must not write');}}});
  h.root.click({guardianView:'fuse'});await h.pendingRead;await tick();assert.equal(reads.length,1);assert.equal(reads[0].quality,'white');assert.equal(reads[0].cursor,undefined);assert.match(h.slot.innerHTML,/guardian-fusion-item="m0"/);assert.doesNotMatch(h.slot.innerHTML,/guardian-fusion-item="a00"/);assert.match(h.slot.innerHTML,/金色<\/span><small>40/);
  h.slot.click({guardianFusionQuality:'gold'});await h.pendingRead;await tick();assert.equal(reads.length,2);assert.equal(reads[1].quality,'gold');assert.match(h.slot.innerHTML,/guardian-fusion-item="a00"/);
  h.slot.click({guardianFusionQuality:'white'});await tick();assert.equal(reads.length,2,'same-character, same-revision quality tab uses its authoritative cache');assert.match(h.slot.innerHTML,/guardian-fusion-item="m0"/);
  h.root.click({guardianView:'inventory'});await tick();assert.equal(reads.length,2);assert.match(h.root.innerHTML,/data-guardian-id="a00"/);assert.doesNotMatch(h.root.innerHTML,/data-guardian-id="m0"/);assert.equal(h.writes.length,0);h.controller.cleanup();
});

test('same-quality pagination preserves later selected cards; refreshed revision validates their neighbourhood and removes protected materials',async()=>{
  const f=await fixture();for(let i=0;i<55;i++)await G.insertSigil(f.env.DB,{id:'W'+String(i).padStart(2,'0'),char_id:'790',type:'magic',quality:1,source_operation_id:'controls-seed',created_at:T0}).run();f.state=await G.state(f.env,'790',T0);
  const reads=[],h=harness({...f,initialView:'overview',host:{state:options=>{reads.push({...options});return G.state(f.env,'790',T0,options);},mutate:()=>{throw Error('material browsing must not write');}}});
  h.root.click({guardianView:'fuse'});await h.pendingRead;await tick();h.root.click({guardianMore:''});await h.pendingRead;await tick();assert.equal(reads.length,2);assert.equal(reads[1].quality,'white');assert.equal(reads[1].cursor,'W39');assert.match(h.slot.innerHTML,/guardian-fusion-item="W00"/);assert.match(h.slot.innerHTML,/guardian-fusion-item="m3"/);
  for(const id of ['m0','m1','m2','m3'])h.slot.click({guardianFusionItem:id});assert.match(h.slot.innerHTML,/已選 <strong>4／4/);
  await h.controller.refresh();assert.equal(reads.length,3,'unchanged revision refresh uses one quality read and retains validated later pages');assert.match(h.slot.innerHTML,/已選 <strong>4／4/);assert.match(h.slot.innerHTML,/data-guardian-fusion-item="m0"[^>]+aria-pressed="true"/);
  await G.lock(f.env,'790',{itemId:'m1',locked:true,requestId:'quality-lock-1'},T0);
  await h.controller.refresh();assert.equal(reads.length,5,'changed revision reads page one plus the selected later neighbourhood, not the whole inventory');assert.equal(reads.at(-1).quality,'white');assert.equal(reads.at(-1).cursor,'W54');assert.match(h.slot.innerHTML,/已選 <strong>3／4/);assert.match(h.slot.innerHTML,/data-guardian-fusion-prepare disabled/);assert.equal(h.writes.length,0);h.controller.cleanup();
});

test('a late quality read is aborted on character switch and cannot populate another character or start a fusion',async()=>{
  const f=await fixture();let resolve,options;const h=harness({...f,initialView:'overview',host:{state:value=>{options=value;return new Promise(done=>resolve=done);},mutate:()=>{throw Error('late data must not write');}}});
  h.root.click({guardianView:'fuse'});assert.equal(options.quality,'white');assert.match(h.slot.innerHTML,/正在尋找這個品質/);assert.match(h.slot.innerHTML,/data-guardian-fusion-prepare disabled/);
  h.setActor('791');h.controller.update({state:{...f.state,charId:'791',inventory:{items:[],nextCursor:null,eligibleCounts:Object.fromEntries(f.config.qualityOrder.map(quality=>[quality,0]))}}});assert.equal(options.signal.aborted,true);
  resolve({...f.state,inventory:{...f.state.inventory,quality:'white'}});await h.pendingRead;await tick();assert.doesNotMatch(h.slot.innerHTML,/guardian-fusion-item="m0"/);assert.equal(h.writes.length,0);h.controller.cleanup();
});

test('inventory quality tabs read only the selected quality, keep actor/revision caches separate from fusion, and paginate with that filter',async()=>{
 const f=await fixture();for(let i=0;i<45;i++)await G.insertSigil(f.env.DB,{id:'I'+String(i).padStart(2,'0'),char_id:'790',type:'magic',quality:1,source_operation_id:'controls-seed',created_at:T0}).run();await G.insertSigil(f.env.DB,{id:'blue-card',char_id:'790',type:'ranged',quality:3,source_operation_id:'controls-seed',created_at:T0}).run();f.state=await G.state(f.env,'790',T0);const reads=[];
 const h=harness({...f,initialView:'inventory',host:{state:options=>{reads.push({...options});return G.state(f.env,'790',T0,options);},mutate:()=>{throw Error('filter browsing must not write');}}});
 assert.match(h.root.innerHTML,/guardian-inventory-picker/);assert.match(h.root.innerHTML,/guardian-inventory-picker-content/);assert.doesNotMatch(h.root.innerHTML,/guardian-resources|guardian-tabs|guardian-stage-notice/);assert.match(h.root.innerHTML,/<footer class="guardian-assist-continuation">/);assert.equal((h.root.innerHTML.match(/data-guardian-inventory-quality=/g)||[]).length,9);h.root.click({guardianInventoryQuality:'white'});await h.pendingRead;await tick();assert.equal(reads.length,1);assert.equal(reads[0].quality,'white');assert.doesNotMatch(h.root.innerHTML,/data-guardian-id="blue-card"/);
 h.root.click({guardianMore:''});await h.pendingRead;await tick();assert.equal(reads.length,2);assert.equal(reads[1].quality,'white');assert.equal(reads[1].cursor,'I39');assert.match(h.root.innerHTML,/data-guardian-id="I00"/);assert.match(h.root.innerHTML,/data-guardian-id="m3"/);
 h.root.click({guardianInventoryQuality:'all'});await tick();assert.equal(reads.length,2,'return to the same-revision all cache has no read');h.root.click({guardianInventoryQuality:'white'});await tick();assert.equal(reads.length,2);assert.match(h.root.innerHTML,/data-guardian-id="m3"/);
 h.root.click({guardianInventoryQuality:'blue'});await h.pendingRead;await tick();assert.equal(reads.length,3);assert.equal(reads[2].quality,'blue');assert.match(h.root.innerHTML,/data-guardian-id="blue-card"/);assert.doesNotMatch(h.root.innerHTML,/data-guardian-id="m0"/);
 h.root.click({guardianView:'fuse'});await h.pendingRead;await tick();assert.equal(reads.length,4);assert.equal(reads[3].quality,'white');h.root.click({guardianView:'inventory'});await tick();assert.equal(reads.length,4,'fusion white does not replace the cached blue inventory page');assert.match(h.root.innerHTML,/data-guardian-id="blue-card"/);assert.equal(h.writes.length,0);h.controller.cleanup();
});

test('inventory refresh preserves its quality and a real assist write invalidates pages; an active later-page angel remains cancellable',async()=>{
 const f=await fixture();for(let i=0;i<45;i++)await G.insertSigil(f.env.DB,{id:'I'+String(i).padStart(2,'0'),char_id:'790',type:'magic',quality:1,source_operation_id:'controls-seed',created_at:T0}).run();f.state=await G.state(f.env,'790',T0);const reads=[];
 const h=harness({...f,initialView:'inventory',host:{state:options=>{reads.push({...options});return G.state(f.env,'790',T0,options);},mutate:(action,body)=>G[action](f.env,'790',body,T0)}});
 h.root.click({guardianInventoryQuality:'white'});await h.pendingRead;await tick();await h.controller.refresh();assert.equal(reads.length,2);assert.equal(reads[1].quality,'white');h.root.click({guardianMore:''});await h.pendingRead;await tick();assert.match(h.root.innerHTML,/data-guardian-id="m0"/);
 h.root.click({guardianAction:'assist',guardianId:'m0'});await tick();await h.pendingWrite;await tick();await h.pendingRead;await tick();assert.equal(reads.at(-1).quality,'white');assert.match(h.root.innerHTML,/data-guardian-id="m0"/,'active guardian is visible even after filtered page one refresh');assert.match(h.root.innerHTML,/data-guardian-inventory-quality="white" aria-selected="true"/);
 h.root.click({guardianAction:'assist',guardianId:'m0'});await h.pendingWrite;await tick();await h.pendingRead;await tick();const s=await G.state(f.env,'790',T0);assert.equal(s.assist.enabled,false);assert.equal(s.assist.remainingBattles,1440);assert.equal(s.assist.stoneCount,1);
 h.root.click({guardianInventoryQuality:'all'});await tick();assert.match(h.root.innerHTML,/data-guardian-id="m0"/);assert.equal(h.writes.length,2);h.controller.cleanup();
});

test('inventory quality requests cancel stale tabs and late responses cannot replace the selected tab or a changed actor',async()=>{
 const f=await fixture(),waiting=[];const h=harness({...f,initialView:'inventory',host:{state:options=>new Promise(resolve=>waiting.push({options,resolve})),mutate:()=>{throw Error('late inventory must not mutate');}}});
 h.root.click({guardianInventoryQuality:'white'});assert.match(h.root.innerHTML,/正在尋找這個品質/);assert.doesNotMatch(h.root.innerHTML,/尚未持有這個品質/);h.root.click({guardianInventoryQuality:'blue'});assert.equal(waiting[0].options.signal.aborted,true);waiting[1].resolve({...f.state,inventory:{...f.state.inventory,quality:'blue',items:[]}});await h.pendingRead;await tick();waiting[0].resolve({...f.state,inventory:{...f.state.inventory,quality:'white'}});await tick();assert.match(h.root.innerHTML,/data-guardian-inventory-quality="blue" aria-selected="true"/);assert.doesNotMatch(h.root.innerHTML,/data-guardian-id="m0"/);
 h.root.click({guardianInventoryQuality:'gold'});const old=h.pendingRead;h.setActor('791');h.controller.update({state:{...f.state,charId:'791',inventory:{items:[],nextCursor:null}}});assert.equal(waiting[2].options.signal.aborted,true);waiting[2].resolve({...f.state,inventory:{...f.state.inventory,quality:'gold'}});await old;await tick();assert.doesNotMatch(h.root.innerHTML,/data-guardian-id="m0"/);assert.equal(h.writes.length,0);h.controller.cleanup();
});
