import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/atlas-ui.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const context=(realmId='permanent',characterId='hero-a',epoch=1)=>({realmId,characterId,epoch});
const snapshot=(scope=context(),extra={})=>({ok:true,realmId:scope.realmId,characterId:scope.characterId,profile:{buildId:'sword_whirlwind',supportIds:['economy']},run:null,materials:{},now:100,...extra});
function module(){const window={};vm.runInNewContext(source,{window,AbortController,Intl});return window.RpgAtlasUI;}
function harness(request,store=new Map()){
  const ids=new Map(),calls=[];let sequence=0;
  const host={request:async(action,body,options)=>{calls.push({action,body,options});return request(action,body,options);},mutationKey:(action,body)=>action+':'+JSON.stringify(body),pendingRequestId:key=>{if(!ids.has(key))ids.set(key,'request_'+(++sequence));return ids.get(key);},clearPendingRequest:key=>ids.delete(key),loadPendingOperation:scope=>store.get(scope.realmId+':'+scope.characterId),savePendingOperation:(scope,value)=>{const key=scope.realmId+':'+scope.characterId;if(value)store.set(key,plain(value));else store.delete(key);},refresh:async()=>null};
  const ui=module(),client=ui.createClient(host);client.setContext(context());return {client,host,calls,ids,store,ui};
}

test('late Atlas reads cannot overwrite another realm, including a rapid A-B-A return',async()=>{
  const first=deferred(),second=deferred();let reads=0;
  const h=harness(async action=>action==='atlas/catalog'?{catalog:{enabled:true}}:(++reads===1?first.promise:second.promise));
  const before=h.client.refresh();await tick();h.client.setContext(context('season_1','hero-b',2));h.client.setContext(context('permanent','hero-a',3));
  const after=h.client.refresh();await tick();second.resolve(snapshot(context(),{materials:{atlas_shard:9}}));await after;
  first.resolve(snapshot(context(),{materials:{atlas_shard:999}}));await before;
  assert.equal(h.client.state.snapshot.materials.atlas_shard,9);assert.equal(h.client.state.context.epoch,3);
});

test('disabled Atlas uses its explicit empty state and does not manufacture status data',async()=>{
  const h=harness(async action=>{assert.equal(action,'atlas/catalog');return {catalog:{enabled:false}};});await h.client.refresh();
  assert.equal(h.client.state.catalog.enabled,false);assert.equal(h.client.state.snapshot,null);assert.equal(h.calls.length,1);
});

test('a status read that began before a mutation cannot replace the committed mutation result',async()=>{
  const old=deferred();const h=harness(async action=>action==='atlas/catalog'?{catalog:{enabled:true}}:action==='atlas/status'?old.promise:snapshot(context(),{materials:{atlas_shard:7}}));
  const reading=h.client.refresh();await tick();await h.client.operate('atlas/craft',{itemId:'gear',recipeId:'temper'});
  old.resolve(snapshot(context(),{materials:{atlas_shard:99}}));await reading;
  assert.equal(h.client.state.snapshot.materials.atlas_shard,7);assert.equal(h.client.state.busy,false);
});

test('uncertain mutation restores its exact payload and ID, blocks a different mutation, and clears only after confirmation',async()=>{
  let fail=true;const h=harness(async(action,body)=>{if(fail)throw Object.assign(Error('lost response'),{uncertain:true});return snapshot();});
  const payload={mapId:'laurel_intro',mapCount:2,durationMinutes:30,supplies:{hp:3,mp:4}};
  await h.client.operate('atlas/start',payload);assert.equal(h.store.size,1);const requestId=h.calls[0].body.requestId;
  await h.client.operate('atlas/configure',{buildId:'sword_counter',supportIds:[]});assert.equal(h.calls.length,1);
  h.client.setContext(context('season_1','hero-b',2));assert.equal(h.client.state.pending,null);h.client.setContext(context('permanent','hero-a',3));assert.deepEqual(plain(h.client.state.pending.payload),payload);
  fail=false;await h.client.operate(h.client.state.pending.action,h.client.state.pending.payload);
  assert.equal(h.calls[1].body.requestId,requestId);assert.deepEqual(plain(h.calls[1].body.supplies),payload.supplies);assert.equal(h.store.size,0);assert.equal(h.ids.size,0);assert.equal(h.client.state.pending,null);
});

test('offline catch-up continues only the same run, has a 16-call limit, and refreshes assets once',async()=>{
  let chunks=0,refreshes=0;const h=harness(async(action,body)=>{assert.ok(['atlas/stop','atlas/settle'].includes(action));assert.equal(body.runId,'run-a');chunks++;return snapshot(context(),{run:{id:'run-a',status:'running',progress:{catchingUp:true}}});});h.host.refresh=async()=>{refreshes++;};
  const result=await h.client.operate('atlas/stop',{runId:'run-a'});
  assert.equal(chunks,16);assert.equal(refreshes,1);assert.equal(result.run.progress.catchingUp,true);assert.equal(new Set(h.calls.map(call=>call.body.requestId)).size,1);assert.equal(h.client.state.pending,null);
});

test('catch-up stops immediately when the original realm context changes',async()=>{
  const delayed=deferred();const h=harness(()=>delayed.promise);const operation=h.client.operate('atlas/settle',{runId:'old-run'});h.client.setContext(context('season_1','hero-b',2));delayed.resolve(snapshot(context(),{run:{id:'old-run',status:'running',progress:{catchingUp:true}}}));
  assert.equal(await operation,null);assert.equal(h.calls.length,1);assert.equal(h.client.state.snapshot,null);assert.equal(h.client.state.busy,false);
});

test('permanent quest reads never run in a season and late permanent progress cannot leak into it',async()=>{
  const delayed=deferred(),h=harness(()=>delayed.promise);const reading=h.client.refreshQuests();h.client.setContext(context('season_1','hero-b',2));
  delayed.resolve({...snapshot(),quests:[{id:'tutorial',progress:999}]});await reading;assert.equal(h.client.state.quests,null);
  assert.equal(await h.client.refreshQuests(),null);assert.equal(h.calls.length,1);
});

test('a quest claim accepts the actual quest receipt without discarding the current exploration',async()=>{
  const run={id:'run-a',status:'completed',report:{gold:80}};
  const h=harness(async action=>action==='atlas/catalog'?{catalog:{enabled:true}}:action==='atlas/status'?snapshot(context(),{run}):{...snapshot(),quests:[{id:'learn-build',claimed:true}],rewards:{materials:{atlas_shard:2},gold:0,exp:0},receiptId:'receipt-a'});
  await h.client.refresh();await h.client.operate('atlas/quests/claim',{questId:'learn-build',periodKey:'once'});
  assert.equal(h.client.state.snapshot.run.id,'run-a');assert.equal(h.client.state.quests.quests[0].claimed,true);assert.equal(h.client.state.quests.rewards.materials.atlas_shard,2);assert.equal(h.client.state.pending,null);
});

test('progress and reports use server fields, preserve zero values, and escape report text',()=>{
  const ui=module();assert.equal(ui.progressPercent({progress:{ratio:.35}}),35);assert.equal(ui.progressPercent({progress:{elapsedSeconds:99}}),0);
  assert.match(ui.progressLabel({completedMaps:2,mapCount:7,progress:{catchingUp:true}}),/2 \/ 7.*仍在結算/);
  const html=ui.reportHtml({gold:0,kills:2,deaths:0,used:{hp:3,mp:0},materials:{atlas_iron:4},reason:'<script>'},{materials:[{id:'atlas_iron',name:'月桂精鐵'}]});
  assert.match(html,/月桂精鐵/);assert.match(html,/生命藥水消耗/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|裝備掉落|補給花費/);assert.match(html,/<strong>0<\/strong>/);
});

test('duration progress uses the server mode and actual clears without inventing a map quota',()=>{
  const ui=module();
  const label=ui.progressLabel({queueMode:'duration',mapCount:null,completedMaps:123,progress:{catchingUp:true}});
  assert.match(label,/123 張星圖/);assert.match(label,/派遣時間結束/);assert.match(label,/仍在結算/);
  assert.doesNotMatch(label,/待同步|\/ 96/);
});

function apiHarness(){const requests=[],S={realmId:'permanent',contextEpoch:1,apiEpoch:0,me:{character:{tgId:'hero-a'}}};const window={RpgRequest:{request:(action,body,headers)=>{const d=deferred();requests.push({action,body,headers,...d});return d.promise;}}};const ctx=vm.createContext({S,window,expansion:null,initData:'',devTg:'111',tg:null,refreshMe(){},setTimeout(){},openCharacterSelect(){},resetRealmContext(){S.contextEpoch++;S.me=null;}});vm.runInContext(app.slice(app.indexOf('  const readActions='),app.indexOf('  const pendingRequestMemory='))+';this.call=api;this.key=mutationKey;',ctx);return {S,ctx,requests};}
test('the actual shared API helper sends the realm header and rejects an old A-B-A response',async()=>{
  const h=apiHarness(),pending=h.ctx.call('atlas/status');assert.equal(h.requests[0].headers['X-Realm-Id'],'permanent');assert.equal(h.requests[0].body.selectedCharacterId,'hero-a');
  h.S.realmId='season_1';h.S.contextEpoch++;h.S.realmId='permanent';h.S.contextEpoch++;h.requests[0].resolve({res:{status:200},j:snapshot()});await assert.rejects(pending,{code:'context_changed'});
  const old=h.ctx.key('atlas/start',{mapId:'laurel_intro'});h.S.realmId='season_1';assert.notEqual(old,h.ctx.key('atlas/start',{mapId:'laurel_intro'}));
});

test('request ID remains stable in memory when browser storage is blocked',()=>{
  let sequence=0;const ctx=vm.createContext({localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}},rid:()=>String(++sequence)});
  vm.runInContext(app.slice(app.indexOf('  const pendingRequestMemory='),app.indexOf('  const idleReportWindows'))+';this.get=pendingRequestId;this.clear=clearPendingRequest;',ctx);
  assert.equal(ctx.get('operation'),ctx.get('operation'));ctx.clear('operation');assert.equal(ctx.get('operation'),'2');
});

test('the original market host keeps pending offers separate for the same character ID in two realms',()=>{
  const values=new Map(),S={realmId:'permanent',me:{character:{tgId:'111'}},shop:{},shopTab:'weapon'},window={RpgMarketExchange:{requestId:()=> 'fixture-request',mount:(_view,host)=>{window.host=host;return {};}}};
  const ctx=vm.createContext({S,window,devTg:'111',tg:null,esc:String,fmt:String,gearIcon(){},api(){},confirmSheet(){},toast(){},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});
  const start=app.indexOf('  function mountMarket(view)'),end=app.indexOf('  function openGuardianShop',start);
  vm.runInContext('let marketActor,marketShopRef,marketShopTab,marketShopSaleSignature,marketController;'+app.slice(start,end)+';this.mount=mountMarket;',ctx);
  ctx.mount({});const permanent=window.host;permanent.savePending('111',{requestId:'permanent-offer'});assert.ok(values.has('elfRpgExchangePending:111:111'));
  S.realmId='season-a';ctx.mount({});const season=window.host;assert.equal(season.loadPending('111'),null);season.savePending('111',{requestId:'season-offer'});
  assert.equal(permanent.loadPending('111').requestId,'permanent-offer');assert.equal(season.loadPending('111').requestId,'season-offer');assert.equal(values.size,2);
});

test('context reset replaces the equipment revision cache before a same-ID low-revision realm is loaded',()=>{
  const S={realmId:'season-a',contextEpoch:1,apiEpoch:1,me:{character:{tgId:'111'}}},window={dispatchEvent(){}},ctx=vm.createContext({S,window,CustomEvent:class{},$:()=>({hidden:true}),resetFight(){},render(){}});
  vm.runInContext(fs.readFileSync(new URL('../public/equipment-live-sync.js',import.meta.url),'utf8'),ctx);
  vm.runInContext('let equipmentSync=window.RpgEquipmentLiveSync.create(),equipmentSyncQueued=true,tradeSelection=0,shopForActor="111",forgeSession=0;const idleReportWindows=new Map();this.sync=()=>equipmentSync;',ctx);
  const old=ctx.sync();old.observe([{kind:'auto_enhance_end',refId:'old-run',job:{characterId:'111'}}],{characterId:'111',revision:1000},'111');assert.equal(old.pending('111'),true);
  vm.runInContext(app.slice(app.indexOf('  function resetRealmContext()'),app.indexOf('  const realmStorageKey='))+';resetRealmContext();',ctx);
  const current=ctx.sync();assert.notEqual(current,old);assert.equal(current.accept({character:{tgId:'111',revision:1},equipment:[]},current.begin('111')),true);assert.equal(current.pending('111'),false);assert.equal(S.contextEpoch,2);assert.equal(S.me,null);
});

test('the actual character selector renders all eight retained characters and does not invent creation slots',()=>{
  const S={realmId:'permanent',realms:[{id:'permanent',name:'永久世界'}],maxCharacters:4,characters:Array.from({length:8},(_,n)=>({charId:'hero-'+n,slot:n+1,name:'旅人'+n,baseClass:'sword',gender:'f',level:10})),meta:{classes:{sword:{name:'劍士'}}}};
  const ctx=vm.createContext({S,artSrc:()=>null,heroKey:()=>'',esc:String});vm.runInContext(app.slice(app.indexOf('  function characterSelectView()'),app.indexOf('  function resetRealmContext()'))+';this.view=characterSelectView;',ctx);const html=ctx.view();
  assert.equal((html.match(/data-select=/g)||[]).length,8);assert.doesNotMatch(html,/data-new=/);assert.match(html,/8 名冒險者/);assert.match(html,/旅人7/);
  S.characters=S.characters.slice(5);const retained=ctx.view();assert.equal((retained.match(/data-select=/g)||[]).length,3);assert.equal((retained.match(/data-new=/g)||[]).length,1);
});
