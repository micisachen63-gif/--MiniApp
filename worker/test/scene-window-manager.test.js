import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/scene-window-manager.js',import.meta.url),'utf8');
function hubNode(){return {children:[],dataset:{},attributes:{},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(k,v){this.attributes[k]=v;},focus(){},click(){this.onclick?.();},querySelector(selector){const m=/\[data-hub-tab="([^"]+)"\]/.exec(selector),walk=n=>{if(m&&n.dataset.hubTab===m[1]&&n.attributes.role==='tab')return n;for(const child of n.children){const found=walk(child);if(found)return found;}};return walk(this);}};}
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
 const node=hubNode;
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

function ledgerRoutesFixture({loadSceneModule} = {}) {
 const social=fs.readFileSync(new URL('../public/scene-social-preview.js',import.meta.url),'utf8');
 const routeStart=social.indexOf('const unifiedRoutes={'),routeEnd=social.indexOf('const moduleFlights=',routeStart);
 const hubStart=social.indexOf('function paintHub('),mountStart=social.indexOf('async function mountUnified('),mountEnd=social.indexOf('function installUnifiedShell(',mountStart);
 assert.ok(routeStart>=0&&routeEnd>routeStart&&hubStart>=0&&mountStart>hubStart&&mountEnd>mountStart);
 const node=hubNode;
 const context={accountId:'a',realmId:'permanent',characterId:'a1',epoch:1},calls=[],mounted={dispose(){}};
 const box={actor:{tgId:'a1',name:'旅人',level:40},liveSession:{getSnapshot:()=>({run:null})},document:{createElement:node},
  bootstrap(){throw Error('a shared route must use the current actor');},
  unifiedHost(api,entry){return {...api,params:entry.params,getContext:()=>context};},
  loadSceneModule:loadSceneModule||async function(file,name){calls.push({file,name});return {mount(container,host,options){calls.push({container,host,options});return mounted;}};},
  window:{}};
 vm.runInNewContext(source+'\n'+social.slice(routeStart,routeEnd)+'\n'+social.slice(hubStart,mountEnd)+'\nglobalThis.ledgerRoutes=unifiedRoutes;globalThis.paintLedgerHub=paintHub;globalThis.mountLedgerRoute=mountUnified;',box);
 const state=box.RpgSceneWindows.createState({routes:Object.keys(box.ledgerRoutes),getContext:()=>context});
 return {box,state,context,calls,mounted,node};
}

test('ledger mounts its real lazy client in the existing character-group window lifecycle',async()=>{
 const h=ledgerRoutesFixture(),body=h.node();
 assert.equal(h.box.ledgerRoutes.ledger.title,'帳務紀錄');assert.equal(h.box.ledgerRoutes.ledger.group,'character');
 h.state.navigate('character');const entry=h.state.navigate('ledger'),current=h.state.ticket();
 assert.equal(await h.box.mountLedgerRoute(entry,body,{current}),h.mounted);
 assert.deepEqual(h.calls[0],{file:'scene-ledger-ui',name:'RpgSceneLedger'});
 assert.equal(h.calls[1].container,body);assert.equal(h.calls[1].host.current,current);
 assert.equal(h.state.back().route,'character');assert.equal(current(),false);
 assert.equal(await h.box.mountLedgerRoute(entry,body,{current}),undefined);
 assert.equal(h.calls.length,2,'stale views cannot reload or mount another ledger client');
});

test('character hub opens ledger and the existing Star Ring cosmetics tab through real tile handlers',async()=>{
 const h=ledgerRoutesFixture(),body=h.node();h.state.navigate('character');
 h.box.paintLedgerHub(body,'character',{draft:{hubTab:'records'},navigate:(route,params)=>h.state.navigate(route,params)});
 const grid=body.children.find(node=>node.className==='scene-hub-grid');
 const ledger=grid.children.filter(node=>node.dataset.sceneRoute==='ledger');
 assert.equal(ledger.length,1);assert.equal(ledger[0].children[0].textContent,'帳務紀錄');
 ledger[0].onclick();assert.equal(h.state.current().route,'ledger');assert.equal(h.state.back().route,'character');
 body.querySelector('[data-hub-tab="hero"]').click();
 const heroGrid=body.children.find(n=>n.className==='scene-hub-grid');
 const wardrobe=heroGrid.children.filter(node=>node.children[0]?.textContent==='星紋衣櫥');
 assert.equal(wardrobe.length,1);assert.equal(wardrobe[0].dataset.sceneRoute,'star-ring-shop');
 wardrobe[0].onclick();const entry=h.state.current();assert.equal(entry.route,'star-ring-shop');assert.equal(entry.params.tab,'cosmetics');
 assert.equal(await h.box.mountLedgerRoute(entry,h.node(),{current:h.state.ticket()}),h.mounted);
 assert.deepEqual(h.calls[0],{file:'scene-star-ring-ui',name:'RpgSceneStarRing'});
 assert.equal(h.calls[1].options.tab,'cosmetics','the shortcut reuses the existing scoped Star Ring client');
 assert.equal(h.state.back().route,'character');
});

test('a ledger module arriving after navigation cannot attach to the new shared window body',async()=>{
 let resolve,mounts=0;
 const pending=new Promise(yes=>{resolve=yes;});
 const h=ledgerRoutesFixture({loadSceneModule:()=>pending}),entry=h.state.navigate('ledger'),current=h.state.ticket();
 const mounting=h.box.mountLedgerRoute(entry,h.node(),{current});
 h.state.navigate('equipment');
 resolve({mount(){mounts++;return {dispose(){}};}});
 assert.equal(await mounting,undefined);assert.equal(mounts,0);
});

// Every original feature must remain reachable after classification, with no
// duplicate tile or accidental navigation-history entry on category changes.
test('functional tabs retain every hub feature and preserve local tab state',()=>{
 const social=fs.readFileSync(new URL('../public/scene-social-preview.js',import.meta.url),'utf8');
 const start=social.indexOf('function paintHub('),end=social.indexOf('async function mountUnified(',start);
 const box={actor:{name:'旅人',level:120},liveSession:{getSnapshot:()=>({run:{active:false}})},document:{createElement:hubNode}};
 vm.runInNewContext(social.slice(start,end)+'\nglobalThis.paint=paintHub;',box);
 const expected={character:['equipment','inventory','star-ring-shop','guardian','characters','skills','career','build','talents','book-tools','progression','ledger','lineage'],adventure:['expedition','live-status','progression','supplies','maps','party','tower','boss','star-ring','quests','fate','daily','journal'],camp:['workshop','tower-imprint','inscription','recovery','gearbook','shop','exchange','direct-trade','supplies','guardian-summon','fate-gifts','boss-essence','star-ring-shop','collections']};
 assert.doesNotMatch(social.slice(start,end),/bestiary|怪物圖鑑/,'怪物圖鑑 removed from 冒險 > 任務旅章 (owner decision 2026-11-10)');
 for(const [route,routes] of Object.entries(expected)){
  const body=hubNode(),calls=[],host={draft:{},navigate:(...v)=>calls.push(v)};box.paint(body,route,host);
  const tabs=body.children[0].children.map(t=>t.dataset.hubTab),found=[];
  for(const tab of tabs){body.querySelector('[data-hub-tab="'+tab+'"]').click();assert.equal(host.draft.hubTab,tab);assert.equal(calls.length,0,'classification stays in the same window');const grid=body.children.find(c=>c.className==='scene-hub-grid');for(const tile of grid.children){found.push(tile.dataset.sceneRoute);tile.onclick();}calls.length=0;}
  assert.deepEqual(found.slice().sort(),routes.slice().sort(),route+' complete original destinations');assert.equal(new Set(found).size,found.length);
  const saved=host.draft.hubTab;box.paint(body,route,host);assert.equal(host.draft.hubTab,saved,'Back/reopen preserves classification');
  let prevented=false;body.children[0].children.at(-1).onkeydown({key:'Home',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(host.draft.hubTab,tabs[0]);
  host.draft.hubTab='unrelated-category';box.paint(body,route,host);assert.equal(host.draft.hubTab,tabs[0]);
 }
});

test('scene social layer polls chat only while the chat window is open and has no quest poll (owner decision 2026-11-10)',()=>{
 const social=fs.readFileSync(new URL('../public/scene-social-preview.js',import.meta.url),'utf8');
 const polls=[...social.matchAll(/setInterval\(([\s\S]{0,160}?),(\d+)\)/g)].filter(m=>/chat\.refresh|refreshQuests/.test(m[1]));
 assert.equal(polls.length,1);assert.match(polls[0][1],/kind!=='chat'/);assert.equal(polls[0][2],'5000');
 assert.doesNotMatch(social,/questPoll/);assert.match(social,/rpg:scene-manual-refresh/);
 assert.doesNotMatch(social,/['"]bestiary['"]/,'no bestiary route or hub tile');
});
