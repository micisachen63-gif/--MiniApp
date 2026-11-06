import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/scene-window-manager.js',import.meta.url),'utf8');
function fixture(){const box={};vm.runInNewContext(source,box);let context={accountId:'a',realmId:'permanent',characterId:'a1',epoch:1};const state=box.RpgSceneWindows.createState({routes:['inventory','item','camp'],getContext:()=>context});return {state,setContext(value){context={...context,...value};}};}
test('returning to a list preserves its draft and separates item details',()=>{
 const {state}=fixture();state.navigate('inventory');state.draft().search='月桂';state.draft().selected=['gear-a'];state.navigate('item',{itemId:'gear-a'});state.draft().position='ring1';state.navigate('item',{itemId:'gear-b'});state.draft().position='ring2';assert.equal(state.back().params.itemId,'gear-a');assert.equal(state.draft().position,'ring1');assert.equal(state.back().route,'inventory');assert.equal(state.draft().search,'月桂');assert.equal(state.draft().selected[0],'gear-a');
});
test('closing and reopening retains a draft but invalidates late responses',()=>{
 const {state}=fixture();state.navigate('inventory');state.draft().quantity='7';const old=state.ticket();state.close();assert.equal(old(),false);state.navigate('inventory');assert.equal(state.draft().quantity,'7');assert.equal(old(),false);assert.equal(state.ticket()(),true);
});
test('A to B to A navigation cannot accept the first A response',()=>{
 const {state}=fixture();state.navigate('item',{itemId:'gear-a'});const old=state.ticket();state.navigate('camp',{},{reset:true});state.navigate('item',{itemId:'gear-a'});assert.equal(old(),false);assert.equal(state.depth(),2);state.back();assert.equal(state.current().route,'camp');assert.equal(state.back(),null);
});
test('account, world, character and epoch changes each isolate pending views and drafts',()=>{
 for(const change of [{accountId:'b'},{realmId:'season'},{characterId:'a2'},{epoch:2}]){
  const {state,setContext}=fixture();state.navigate('inventory');state.draft().search='私人草稿';const old=state.ticket();setContext(change);assert.equal(old(),false);assert.equal(state.syncContext(),true);assert.equal(state.current(),null);state.navigate('inventory');assert.equal(state.draft().search,undefined);
 }
});
test('unknown routes and mutable caller params cannot corrupt navigation',()=>{
 const {state}=fixture(),params={itemId:'gear-a',unsafe:{nested:true}};state.navigate('item',params);params.itemId='gear-b';assert.equal(state.current().params.itemId,'gear-a');assert.equal(state.current().params.unsafe,undefined);assert.throws(()=>state.navigate('missing'),/未知/);assert.equal(state.current().route,'item');assert.equal(state.depth(),1);
});

test('live status uses the existing unified route and preserves its scoped mount lifecycle',async()=>{
 const social=fs.readFileSync(new URL('../public/scene-social-preview.js',import.meta.url),'utf8');
 const routeStart=social.indexOf('const unifiedRoutes={'),routeEnd=social.indexOf('const moduleFlights=',routeStart);
 const mountStart=social.indexOf('async function mountUnified('),mountEnd=social.indexOf('function installUnifiedShell(',mountStart);
 assert.ok(routeStart>=0&&routeEnd>routeStart&&mountStart>=0&&mountEnd>mountStart,'real route and mount definitions are available');
 const calls=[],body={},context={accountId:'a',realmId:'permanent',characterId:'a1',epoch:1};
 const mounted={dispose(){}};
 const box={actor:{tgId:'a1'},bootstrap(){throw Error('status mount must not bootstrap another data source');},
  unifiedHost(api,entry){return {...api,params:entry.params,getContext:()=>context};},
  window:{RpgSceneLiveView:{mountStatus(container,host){calls.push({container,host});return mounted;}},
   RpgSceneAtlasGuide:{mount(){throw Error('live status must not fall through to the Atlas form');}}}};
 vm.runInNewContext(source+'\n'+social.slice(routeStart,routeEnd)+'\n'+social.slice(mountStart,mountEnd)+'\nglobalThis.statusRoutes=unifiedRoutes;globalThis.mountStatusRoute=mountUnified;',box);
 assert.equal(box.statusRoutes['live-status'].title,'出征狀態');
 assert.equal(box.statusRoutes['live-status'].group,'adventure');
 const state=box.RpgSceneWindows.createState({routes:Object.keys(box.statusRoutes),getContext:()=>context});
 const entry=state.navigate('live-status'),current=state.ticket();
 const view=await box.mountStatusRoute(entry,body,{current});
 assert.equal(view,mounted,'returns the real dispose contract to the existing window manager');
 assert.equal(calls.length,1);assert.equal(calls[0].container,body);assert.equal(calls[0].host.current,current);
 state.navigate('expedition');
 assert.equal(await box.mountStatusRoute(entry,body,{current}),undefined,'a stale view cannot reattach the live card');
 assert.equal(calls.length,1);
 assert.equal(state.back().route,'live-status','normal back navigation returns to the same status route');
 const active=state.ticket();context.epoch++;
 assert.equal(active(),false);assert.equal(state.syncContext(),true);assert.equal(state.current(),null);
});

test('adventure hub keeps live status reachable through the existing route history',()=>{
 const social=fs.readFileSync(new URL('../public/scene-social-preview.js',import.meta.url),'utf8');
 const routeStart=social.indexOf('const unifiedRoutes={'),routeEnd=social.indexOf('const moduleFlights=',routeStart);
 const hubStart=social.indexOf('function paintHub('),hubEnd=social.indexOf('async function mountUnified(',hubStart);
 assert.ok(routeStart>=0&&routeEnd>routeStart&&hubStart>=0&&hubEnd>hubStart);
 const node=()=>({children:[],dataset:{},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;}});
 let active=false;const context={accountId:'a',realmId:'permanent',characterId:'a1',epoch:1};
 const box={actor:{name:'旅人',level:1},liveSession:{getSnapshot:()=>({run:{active}})},document:{createElement:node}};
 vm.runInNewContext(source+'\n'+social.slice(routeStart,routeEnd)+'\n'+social.slice(hubStart,hubEnd)+'\nglobalThis.statusRoutes=unifiedRoutes;globalThis.paintStatusHub=paintHub;',box);
 for(active of [false,true]){
  const body=node(),state=box.RpgSceneWindows.createState({routes:Object.keys(box.statusRoutes),getContext:()=>context});
  state.navigate('adventure');
  box.paintStatusHub(body,'adventure',{navigate:route=>state.navigate(route)});
  const grid=body.children.find(n=>n.className==='scene-hub-grid');
  const entries=grid.children.filter(n=>n.dataset.sceneRoute==='live-status');
  assert.equal(entries.length,1,'status stays reachable both at camp and during an expedition');
  assert.equal(entries[0].children[0].textContent,'出征狀態');
  assert.match(entries[0].children[1].textContent,/敵人.*事件/);
  entries[0].onclick();
  assert.equal(state.current().route,'live-status','the actual tile handler uses the registered shared route');
  assert.equal(state.back().route,'adventure');
 }
});
