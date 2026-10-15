import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {publicConfig} from '../src/game/guardian-sigil-config.js';

const read=name=>fs.readFileSync(new URL('../public/'+name,import.meta.url),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
function setup(rows=[],extra={}) {
  const window={},ctx=vm.createContext({window,fetch(){throw Error('fusion UI must not perform HTTP');},setTimeout(){throw Error('no fusion UI timer');},requestAnimationFrame(){throw Error('no fusion UI animation loop');}});
  vm.runInContext(read('guardian-sigil-contract.js'),ctx);vm.runInContext(read('guardian-fusion-ui.js'),ctx);
  const config=window.RpgGuardianContract.config(publicConfig({})),state={charId:'hero-a',unlocked:true,balances:{gold:100000},inventory:{items:rows,nextCursor:null},actions:{fuse:true},...extra};
  return {ui:window.RpgGuardianFusionUI,config,state,window};
}
const angel=(id,quality='white',type='melee',extra={})=>({id,quality,type,active:false,locked:false,inTrade:false,bound:false,...extra});
const materialSet=(quality='white',type='melee',n=4)=>Array.from({length:n},(_,i)=>angel(type+'-'+i,quality,type));
function dom() {let html='';const events=new Map();return {contains:()=>true,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),get innerHTML(){return html;},set innerHTML(value){html=value;},click(key,value){const button={disabled:false,dataset:{[key]:value},hasAttribute:name=>name==='data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())};events.get('click')?.({target:{closest:()=>button}});},listenerCount:()=>events.size};}

test('quality tabs show only the chosen quality and switching clears previous materials',()=>{
  const {ui,config,state}=setup([...materialSet(),angel('gold-only','gold')]);let s=ui.createSelection(config,state);s=ui.toggle(config,state,s,'melee-0');
  assert.deepEqual(plain(ui.normalize(config,state,null).itemIds),[]);
  const white=ui.markup(config,state,s);assert.match(white,/data-guardian-fusion-item="melee-0"/);assert.doesNotMatch(white,/data-guardian-fusion-item="gold-only"/);
  s=ui.setQuality(config,state,s,'gold');assert.equal(s.primaryId,null);assert.deepEqual(plain(s.itemIds),[]);assert.match(ui.markup(config,state,s),/data-guardian-fusion-item="gold-only"/);
});
test('first clicked card is the primary and only an explicit deselection may replace it',()=>{
  const {ui,config,state}=setup(materialSet());let s=ui.createSelection(config,state);s=ui.toggle(config,state,s,'melee-2');s=ui.toggle(config,state,s,'melee-1');
  assert.equal(s.primaryId,'melee-2');assert.deepEqual(plain(s.itemIds),['melee-2','melee-1']);assert.match(ui.markup(config,state,s),/主天使 · 失敗保留/);
  s=ui.toggle(config,state,s,'melee-2');assert.equal(s.primaryId,'melee-1');assert.deepEqual(plain(s.itemIds),['melee-1']);
});
test('one-click registration uses the real same-type four-material stage and avoids protected cards',()=>{
  const rows=[...materialSet('white','melee',3),...materialSet('white','ranged',4),...materialSet('white','magic',6).map(row=>({...row,bound:true})),angel('protected','white','loot',{locked:true})];
  const {ui,config,state}=setup(rows),s=ui.fill(config,state,ui.createSelection(config,state)),q=ui.quote(config,state,s);
  assert.equal(q.requiredCount,4);assert.equal(q.selectedCount,4);assert.equal(q.primary.type,'ranged');assert.equal(q.binding,false);assert.equal(q.fee,config.rules.upgradeStages[0].goldFee);assert.equal(q.successRate,config.rules.upgradeStages[0].successRate);
  assert.ok(q.items.every(row=>row.type==='ranged'));assert.equal(q.ok,true);
});
test('registration preserves the chosen primary even if another type could fill a batch',()=>{
  const {ui,config,state}=setup([...materialSet('white','melee',3),...materialSet('white','ranged',6)]);
  const clicked=ui.toggle(config,state,ui.createSelection(config,state),'melee-2'),s=ui.fill(config,state,clicked),q=ui.quote(config,state,s);
  assert.equal(s.primaryId,'melee-2');assert.equal(s.itemIds.length,3);assert.ok(q.items.every(row=>row.type==='melee'));assert.equal(q.ok,false);assert.match(q.reason,/還需要 1 位/);
});
test('gold and pink stages use six mixed materials from the server and expose actual binding inheritance',()=>{
  for(const quality of ['gold','pink']) {
    const {ui,config,state}=setup(Array.from({length:8},(_,i)=>angel('mixed-'+i,quality,['melee','ranged','magic','loot'][i%4],{bound:i===0})));
    let s=ui.toggle(config,state,ui.createSelection(config,state,quality),'mixed-0');s=ui.fill(config,state,s);const q=ui.quote(config,state,s);
    assert.equal(q.requiredCount,6);assert.equal(q.items.length,6);assert.equal(q.primary.id,'mixed-0');assert.equal(q.binding,true);assert.ok(new Set(q.items.map(row=>row.type)).size>1);assert.match(ui.markup(config,state,s),/新天使與失敗保留的主天使都會綁定/);
  }
});
test('a protected, moved or missing primary never silently turns another card into the retained one',()=>{
  const {ui,config,state}=setup(materialSet()),s=ui.fill(config,state,ui.createSelection(config,state));
  for(const patch of [{locked:true},{active:true},{inTrade:true},{inExchange:true},{exchangeId:'market'}]) {
    const nextState={...state,inventory:{items:state.inventory.items.map(row=>row.id===s.primaryId?{...row,...patch}:row)}};const clean=ui.normalize(config,nextState,s);
    assert.equal(clean.primaryId,null);assert.equal(clean.itemIds.length,0);assert.match(clean.notice,/主天使的狀態已更新/);assert.throws(()=>ui.freeze(config,nextState,s));
  }
  const removed={...state,inventory:{items:state.inventory.items.filter(row=>row.id!==s.primaryId)}};assert.equal(ui.normalize(config,removed,s).primaryId,null);
});
test('late protection of an extra material prunes it and freezes no incomplete batch',()=>{
  const {ui,config,state}=setup(materialSet()),s=ui.fill(config,state,ui.createSelection(config,state)),id=s.itemIds[1];
  const nextState={...state,inventory:{items:state.inventory.items.map(row=>row.id===id?{...row,inTrade:true}:row)}};
  assert.equal(ui.normalize(config,nextState,s).itemIds.length,3);assert.equal(ui.quote(config,nextState,s).ok,false);assert.throws(()=>ui.freeze(config,nextState,s),/還需要/);
});
test('selection cannot exceed the configured maximum or mix incompatible types/qualities',()=>{
  const {ui,config,state}=setup([...materialSet('white','melee',5),angel('wrong-type','white','magic'),angel('wrong-quality','blue','melee')]);
  let s=ui.fill(config,state,ui.createSelection(config,state));for(const id of ['melee-4','wrong-type','wrong-quality'])s=ui.toggle(config,state,s,id);
  assert.equal(s.itemIds.length,4);assert.ok(!s.itemIds.some(id=>id.startsWith('wrong')));
});
test('cyan, pending rules, unknown resources and insufficient gold cannot prepare or invent fees',()=>{
  const {ui,config,state}=setup([...materialSet(),angel('highest','cyan')]),s=ui.fill(config,state,ui.createSelection(config,state));
  assert.equal(ui.quote(config,state,ui.createSelection(config,state,'cyan')).ok,false);
  assert.throws(()=>ui.freeze(config,{...state,balances:{gold:0}},s),/金幣不足/);assert.throws(()=>ui.freeze(config,{...state,balances:{gold:null}},s),/金幣資料/);
  assert.equal(ui.quote({...config,status:'pending_approval'},state,s).ok,false);
  const missing={...config,rules:{...config.rules,upgradeStages:config.rules.upgradeStages.map(stage=>({...stage,goldFee:null}))}};assert.equal(ui.quote(missing,state,s).fee,null);assert.throws(()=>ui.freeze(missing,state,s),/規則尚未完整/);
});
test('freeze only prepares immutable canonical material IDs and never makes a request or spends a resource',()=>{
  const {ui,config,state}=setup(materialSet()),before=plain(state),s=ui.fill(config,state,ui.createSelection(config,state)),frozen=ui.freeze(config,state,s);
  assert.equal(Object.isFrozen(frozen),true);assert.equal(Object.isFrozen(frozen.itemIds),true);assert.deepEqual(plain(frozen),{itemIds:plain(s.itemIds),primaryId:s.primaryId,configVersion:config.configVersion});assert.deepEqual(plain(state),before);
});
test('DOM buttons select, fill and prepare exactly once without submitting, and pending/cleanup makes old controls inert',()=>{
  const {ui,config,state}=setup(materialSet()),root=dom(),changes=[],prepared=[];
  const handle=ui.mount(root,{config,state,selection:ui.createSelection(config,state),onChange:s=>changes.push(s),onPrepare:(payload,quote)=>prepared.push({payload,quote})});
  root.click('guardianFusionItem','melee-2');root.click('guardianFusionFill','');assert.equal(changes.length,2);assert.equal(handle.selection().primaryId,'melee-2');
  root.click('guardianFusionPrepare','');assert.equal(prepared.length,1);assert.equal(prepared[0].quote.ok,true);assert.equal(prepared[0].payload.primaryId,'melee-2');
  handle.update(config,state,handle.selection(),{disabled:true});root.click('guardianFusionPrepare','');assert.equal(prepared.length,1);
  handle.cleanup();root.click('guardianFusionItem','melee-1');assert.equal(changes.length,2);assert.equal(root.listenerCount(),0);
});
test('character changes discard old selections and unsafe labels/art cannot become executable markup',()=>{
  const {ui,config,state}=setup(materialSet()),s=ui.fill(config,state,ui.createSelection(config,state));
  assert.equal(ui.normalize(config,{...state,charId:'other'},s).itemIds.length,0);
  const poisoned={...config,types:config.types.map(row=>({...row,name:'<img src=x onerror=bad()>',artUrl:'javascript:bad()'}))},html=ui.markup(poisoned,state,s);
  assert.doesNotMatch(html,/src="javascript:|<img src=x onerror/);assert.match(html,/&lt;img src=x onerror=bad\(\)&gt;/);assert.match(html,/src="\/art\/guardian-sigil-20261013\/melee.webp"/);
});
test('incomplete inventory remains explicit and bound materials stay visible and selectable',()=>{
  const {ui,config,state}=setup(materialSet().map(row=>({...row,bound:true})),{inventory:{items:materialSet().map(row=>({...row,bound:true})),nextCursor:'more'}}),s=ui.fill(config,state,ui.createSelection(config,state));
  assert.equal(ui.quote(config,state,s).ok,true);assert.equal(ui.quote(config,state,s).binding,true);assert.match(ui.markup(config,state,s),/目前為已載入的背包/);
});

test('quality-tab counts use server-wide eligible totals and an in-flight filtered read does not claim the tab is empty',()=>{
  const {ui,config,state}=setup([],{inventory:{items:[],quality:'gold',eligibleCounts:{white:37,gold:9},nextCursor:null,totalCount:50}}),s=ui.createSelection(config,state,'white');
  const html=ui.markup(config,state,s,{disabled:true,loading:true});assert.match(html,/data-guardian-fusion-quality="white"[^>]*><span>白色<\/span><small>37<\/small>/);assert.match(html,/正在尋找這個品質的天使/);assert.doesNotMatch(html,/這個品質還沒有天使/);
  const root=dom(),handle=ui.mount(root,{config,state,selection:s,disabled:true,loading:true});assert.match(root.innerHTML,/正在尋找/);handle.update(config,{...state,inventory:{items:materialSet(),quality:'white',eligibleCounts:{white:37},totalCount:50}},s,{disabled:false,loading:false});assert.match(root.innerHTML,/data-guardian-fusion-item="melee-0"/);assert.doesNotMatch(root.innerHTML,/正在尋找/);handle.cleanup();
});
