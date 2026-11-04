import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source=readFileSync(new URL('../public/scene-workshop-ui.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function module(){const window={};vm.runInNewContext(source,{window,crypto:webcrypto,URL,console,setTimeout,clearTimeout,Date,Promise});return window.RpgSceneWorkshop;}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const scrollMeta={scroll_w:{name:'武器強化捲',price:75},scroll_a:{name:'防具強化捲',price:50},scroll_r:{name:'洗屬性捲',price:60},blessed_scroll_w:{name:'祝福武器卷',price:null},guaranteed_scroll_w:{name:'必成武器卷',price:null}};
function equipment(extra={}){
  return {id:'gear-a',name:'調查長劍',tier:2,slot:'weapon',slotName:'武器',classReq:'sword',className:'劍士',statName:'攻擊力',stat:180,rarityName:'稀有',enhance:4,equipped:false,inTrade:null,scroll:'scroll_w',blessedScroll:'blessed_scroll_w',scrollCost:2,
    enhanceNext:{success:.5,nothing:.4,break:.1},blessedEnhanceNext:{success:.6,nothing:.3,break:.1},enhanceGrowth:{statName:'攻擊力',byLevel:Array.from({length:16},(_,i)=>100+i*20)},
    affixes:{slots:3,quality:'B',lines:[{index:0,key:'meleePct',name:'近戰傷害',value:.04,score:50,quality:'B',range:[.01,.1]},{index:1,key:'maxHpPct',name:'生命',value:.05,score:70,quality:'A',range:[.01,.1]},{index:2,key:'critPct',name:'爆擊',value:.02,score:30,quality:'C',range:[.01,.05]}]},
    rerollCost:{scrolls:2,fee:60},rerollPrices:[{scrolls:2,fee:60},{scrolls:4,fee:240},{scrolls:8,fee:540}],...extra};
}
const me=(extra={})=>({ok:true,realmId:'permanent',character:{tgId:'hero-a',name:'調查員',baseClass:'sword',classPath:'A1',gold:10000,revision:1,partyId:null},equipment:[equipment()],inventory:{scroll_w:1,scroll_r:4,blessed_scroll_w:2,guaranteed_scroll_w:1},...extra});
const available={ok:true,realmId:'permanent',functions:[{id:'attack',key:'meleePct',name:'攻擊'},{id:'life',key:'maxHpPct',name:'生命'},{id:'critical',key:'critPct',name:'爆擊'}]};
const job=(extra={})=>({id:'job-new',itemId:'gear-a',itemName:'調查長劍',characterId:'hero-a',ownerAccountId:'account-a',target:8,blessed:false,status:'running',reason:null,level:4,attempts:0,spentGold:0,spentScrolls:0,...extra});
const row=(j,kind='auto_enhance_end')=>({kind,refId:j.id,ownerAccountId:'account-a',job:j});
const memoryStorage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};};
function harness(custom=()=>undefined,options={}){
  const api=options.api||module(),storage=options.storage||memoryStorage(),draft=options.draft||{},calls=[];
  let context={accountId:'account-a',realmId:'permanent',characterId:'hero-a',epoch:1},active=true,changes=0;
  const host={draft,storage,getContext:()=>context,current:()=>active,onChanged:()=>changes++,request:async(action,body)=>{
    calls.push({action,body:plain(body)});const value=await custom(action,body);if(value!==undefined)return value;
    if(action==='me')return me();if(action==='meta')return {ok:true,meta:{items:scrollMeta}};
    if(action==='background/status')return {ok:true,realmId:context.realmId,jobs:[]};
    if(action==='auto-reroll/options')return available;
    throw new Error('Unexpected action '+action);
  }};
  const client=api.createClient(host);
  return {api,client,host,storage,draft,calls,changes:()=>changes,setContext:value=>context=value,deactivate:()=>active=false};
}
const selection=(extra={})=>({kind:'enhance',itemId:'gear-a',mode:'normal',background:false,target:8,...extra});
const enhanced=()=>({...me({character:{...me().character,revision:2},equipment:[equipment({enhance:5,stat:200})]}),result:{itemId:'gear-a',itemName:'調查長劍',result:'success',from:4,to:5,used:{scroll_w:2},goldCost:75}});

test('manual enhancement uses server odds, exact missing-scroll price and supplied ability growth',()=>{
  const api=module(),item=equipment(),p=api.enhancePlan(item,me(),{items:scrollMeta},{mode:'normal'});
  assert.equal(p.error,'');assert.equal(p.cost.gold,75);assert.equal(p.cost.scrolls,2);assert.equal(p.odds.break,.1);
  assert.deepEqual(plain(p.gain),{name:'攻擊力',before:180,after:200,delta:20});
  const blessed=api.enhancePlan(item,me(),{items:scrollMeta},{mode:'blessed'});
  assert.equal(blessed.cost.gold,0);assert.equal(blessed.cost.scrolls,1);assert.equal(blessed.odds.success,.6);assert.equal(blessed.odds.break,.1);
  const guaranteed=api.enhancePlan(item,me(),{items:scrollMeta},{mode:'guaranteed'});
  assert.equal(guaranteed.odds.success,1);assert.equal(guaranteed.odds.break,0);
  assert.match(api.enhancePlan(item,me(),{items:scrollMeta},{mode:'guaranteed',background:true,target:8}).error,/手動/);
  assert.match(api.enhancePlan(equipment({enhance:15,enhanceNext:null}),me(),{items:scrollMeta},{}).error,/上限/);
});

test('reroll preserves full-lock limits, prices and all-slot useful type locks for background mode',()=>{
  const api=module(),item=equipment();
  const manual=api.rerollPlan(item,me(),{items:scrollMeta},{locks:[0,1],typeLocks:[2]});
  assert.equal(manual.error,'');assert.deepEqual(plain(manual.payload),{itemId:'gear-a',locks:[0,1]});
  assert.equal(manual.cost.scrolls,8);assert.equal(manual.cost.fee,540);assert.equal(manual.cost.gold,780);
  assert.match(api.rerollPlan(item,me(),{items:scrollMeta},{locks:[0,1,2]}).error,/至少/);
  const allTypes=api.rerollPlan(item,me(),{items:scrollMeta},{background:true,locks:[],typeLocks:[0,1,2],functions:[],quality:'SS',maxGold:2000},available);
  assert.equal(allTypes.error,'');assert.equal(allTypes.cost.scrolls,14);assert.equal(allTypes.cost.fee,960);assert.equal(allTypes.cost.gold,1560);
  const noPurchase=api.rerollPlan(item,me({inventory:{scroll_r:99}}),{items:{}},{locks:[0]});
  assert.equal(noPurchase.cost.gold,240,'labor still costs gold even when every required scroll is held');
});

test('background targets enforce usable kinds, fixed-line semantics, free slots and a real first-attempt budget',()=>{
  const api=module(),item=equipment(),base={background:true,locks:[0],typeLocks:[],functions:['attack'],quality:'',maxGold:''};
  assert.match(api.rerollPlan(item,me(),{items:scrollMeta},base,available).error,/完整鎖定/);
  const p=api.rerollPlan(item,me(),{items:scrollMeta},{...base,quality:'A'},available);
  assert.equal(p.error,'');assert.match(p.rule,/其餘 2 條/);assert.equal(p.reached,false);
  assert.match(api.rerollPlan(item,me(),{items:scrollMeta},{...base,locks:[],quality:'SS',maxGold:0},available).error,/第一次/);
  assert.match(api.rerollPlan(item,me(),{items:scrollMeta},{...base,locks:[],typeLocks:[0],functions:[],quality:'SS'},{functions:available.functions.filter(fn=>fn.id!=='attack')}).error,/適用/);
});

test('trade, party-equipped and existing background jobs prevent a new preview plan',()=>{
  const api=module();
  assert.match(api.enhancePlan(equipment({inTrade:'trade'}),me(),{items:scrollMeta},{}).error,/交易/);
  assert.match(api.enhancePlan(equipment({equipped:true}),me({character:{...me().character,partyId:'party'}}),{items:scrollMeta},{}).error,/組隊/);
  assert.match(api.enhancePlan(equipment(),me(),{items:scrollMeta},{},[row(job())]).error,/背景作業/);
  assert.match(api.enhancePlan(equipment(),me(),{items:scrollMeta},{background:true,target:8},[row(job({itemId:'other',characterId:'hero-b'}))]).error,/帳號/);
});

test('preview only reads and one explicit acknowledgement commits one manual attempt',async()=>{
  const h=harness(action=>action==='enhance'?enhanced():undefined);await h.client.refresh();await h.client.preview(selection());
  assert.ok(h.client.state.preview);assert.equal(h.calls.filter(call=>call.action==='enhance').length,0);
  await h.client.confirm(false);assert.equal(h.calls.filter(call=>call.action==='enhance').length,0);
  await h.client.confirm(true);
  const calls=h.calls.filter(call=>call.action==='enhance');assert.equal(calls.length,1);assert.match(calls[0].body.requestId,/^[A-Za-z0-9_-]{6,64}$/);
  assert.equal(h.client.state.me.equipment[0].enhance,5);assert.equal(h.client.state.pending,null);assert.equal(h.changes(),1);
});

test('lost manual reply survives remount and uses exact pure-read receipt lookup without another enhancement',async()=>{
  const api=module(),storage=memoryStorage();let found=false;const writes=[];
  const request=(action,body)=>{
    if(action==='enhance'){writes.push(plain(body));throw Object.assign(new Error('reply lost after commit'),{uncertain:true});}
    if(action==='forge/receipt')return {ok:true,realmId:'permanent',kind:'enhance',requestId:body.requestId,found,entries:found?[{type:'強化',note:'調查長劍 +4→+5',item:'scroll_w',itemDelta:-2,goldDelta:0,createdAt:1}]:[]};
  };
  const first=harness(request,{api,storage});await first.client.refresh();await first.client.preview(selection());await first.client.confirm(true);
  const pending=plain(first.client.state.pending);first.client.dispose();
  const second=harness(request,{api,storage});await second.client.refresh();assert.equal(second.client.state.pending.payload.requestId,pending.payload.requestId);
  await second.client.recover();assert.ok(second.client.state.pending);assert.equal(writes.length,1);
  found=true;await second.client.recover();assert.equal(writes.length,1);assert.equal(second.client.state.pending,null);assert.equal(second.changes(),1);
  assert.equal(second.client.state.result.entries[0].note,'調查長劍 +4→+5');
  const checks=second.calls.filter(call=>call.action==='forge/receipt');assert.deepEqual(checks[0].body,{kind:'enhance',requestId:pending.payload.requestId});
});

test('unknown background enhancement only checks existing status and never starts a second job',async()=>{
  const h=harness(action=>{
    if(action==='auto-enhance/start')throw Object.assign(new Error('lost'),{uncertain:true});
    if(action==='auto-enhance/status')return {ok:true,realmId:'permanent',job:job()};
  });
  await h.client.refresh();await h.client.preview(selection({background:true}));await h.client.confirm(true);
  assert.ok(h.client.state.pending);await h.client.recover();
  assert.equal(h.calls.filter(call=>call.action==='auto-enhance/start').length,1);assert.equal(h.calls.filter(call=>call.action==='auto-enhance/status').length,1);
  assert.equal(h.client.state.pending,null);assert.equal(h.changes(),1);
});

test('an old completed matching background job cannot falsely resolve a new unknown start',async()=>{
  const old=job({id:'old-job',status:'ended',reason:'resources'});
  const h=harness(action=>{
    if(action==='background/status')return {ok:true,jobs:[row(old)]};
    if(action==='auto-enhance/start')throw Object.assign(new Error('lost'),{uncertain:true});
    if(action==='auto-enhance/status')return {ok:true,job:old};
  });
  await h.client.refresh();await h.client.preview(selection({background:true}));await h.client.confirm(true);await h.client.recover();
  assert.ok(h.client.state.pending);assert.equal(h.changes(),0);assert.equal(h.calls.filter(call=>call.action==='auto-enhance/start').length,1);
});

test('automatic reroll retries only the exact saved request/configuration supported by its replay contract',async()=>{
  const bodies=[];const h=harness((action,body)=>{
    if(action==='auto-reroll/start'){bodies.push(plain(body));if(bodies.length===1)throw new Error('lost response');return {ok:true,job:job({config:{...body,keys:['meleePct']},result:equipment().affixes})};}
  });
  await h.client.refresh();await h.client.preview({kind:'reroll',itemId:'gear-a',background:true,locks:[],typeLocks:[],functions:['attack'],quality:'SS',maxGold:5000});
  await h.client.confirm(true);assert.ok(h.client.state.pending);
  await h.client.preview(selection({itemId:'changed'}));await h.client.recover();
  assert.equal(bodies.length,2);assert.deepEqual(bodies[1],bodies[0]);assert.equal(h.client.state.pending,null);
});

test('stop requires preview and confirmation; an unknown reply is resolved by status, not another stop',async()=>{
  let ended=false;const h=harness(action=>{
    if(action==='background/status')return {ok:true,jobs:[row(job({status:ended?'ended':'running',reason:ended?'stopped':null}))]};
    if(action==='auto-enhance/stop'){ended=true;throw new Error('lost stop reply');}
    if(action==='auto-enhance/status')return {ok:true,job:job({status:'ended',reason:'stopped'})};
  });
  await h.client.refresh();assert.equal(h.client.previewStop('job-new'),true);
  assert.equal(h.calls.filter(call=>call.action.endsWith('/stop')).length,0);
  await h.client.confirm(true);await h.client.recover();
  assert.equal(h.calls.filter(call=>call.action==='auto-enhance/stop').length,1);assert.equal(h.client.state.pending,null);
  const foreign=harness(action=>action==='background/status'?{ok:true,jobs:[row(job({characterId:'hero-b'}))]}:undefined);
  await foreign.client.refresh();assert.equal(foreign.client.previewStop('job-new'),false);
});

test('a late A-B-A read cannot paint another epoch and a disposed write preserves its pending receipt',async()=>{
  const read=deferred(),h=harness(action=>action==='me'?read.promise:undefined);
  const loading=h.client.refresh();
  h.setContext({accountId:'account-a',realmId:'permanent',characterId:'hero-a',epoch:3});read.resolve(me());await loading;
  assert.equal(h.client.state.me,null);
  const response=deferred(),other=harness(action=>action==='enhance'?response.promise:undefined);
  await other.client.refresh();await other.client.preview(selection());const committing=other.client.confirm(true),pending=plain(other.client.state.pending);
  other.client.dispose();response.resolve(enhanced());await committing;
  assert.deepEqual(plain(other.client.state.pending),pending);assert.equal(other.changes(),0);
});

test('late target options cannot replace the currently requested item and wrong-realm receipts stay unresolved',async()=>{
  const early=deferred(),h=harness((action,body)=>action==='auto-reroll/options'?(body.itemId==='gear-a'?early.promise:{...available,functions:[]}):undefined);
  const first=h.client.loadOptions('gear-a');await h.client.loadOptions('gear-b');early.resolve(available);await first;
  assert.equal(h.client.state.options['gear-a'],undefined);assert.deepEqual(plain(h.client.state.options['gear-b'].functions),[]);
  const bad=harness((action,body)=>action==='enhance'?Promise.reject(new Error('lost')):action==='forge/receipt'?{ok:true,realmId:'season-other',kind:'enhance',requestId:body.requestId,found:true,entries:[{note:'foreign'}]}:undefined);
  await bad.client.refresh();await bad.client.preview(selection());await bad.client.confirm(true);await bad.client.recover();
  assert.ok(bad.client.state.pending);assert.equal(bad.client.state.result,null);assert.equal(bad.changes(),0);
});

test('HTTP timeout remains uncertain, definitive rejection clears pending, and double clicks do not duplicate writes',async()=>{
  const timeout=harness(action=>action==='enhance'?Promise.reject(Object.assign(new Error('timeout'),{status:408})):undefined);
  await timeout.client.refresh();await timeout.client.preview(selection());await timeout.client.confirm(true);assert.ok(timeout.client.state.pending);
  const denied=harness(action=>action==='enhance'?Promise.reject(Object.assign(new Error('item now locked'),{status:409,code:'auto_active',uncertain:false})):undefined);
  await denied.client.refresh();await denied.client.preview(selection());await denied.client.confirm(true);assert.equal(denied.client.state.pending,null);assert.match(denied.client.state.error,/locked/);
  const deferredWrite=deferred(),h=harness(action=>action==='enhance'?deferredWrite.promise:undefined);
  await h.client.refresh();await h.client.preview(selection());const first=h.client.confirm(true);await h.client.confirm(true);
  assert.equal(h.calls.filter(call=>call.action==='enhance').length,1);deferredWrite.resolve(enhanced());await first;
});

test('confirmation presents actual costs, break risks, lock semantics and safely escaped source text',()=>{
  const api=module(),p=api.enhancePlan(equipment({name:'<img src=x onerror=bad>'}),me(),{items:scrollMeta},{mode:'normal'});
  const html=api.previewHtml(p);
  assert.match(html,/75 金幣/);assert.match(html,/10%/);assert.match(html,/永久消失/);assert.match(html,/data-sw-confirm disabled/);
  assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;img'));
  assert.match(api.resultHtml({recovered:true,entries:[{note:'<script>bad</script>'}]}),/&lt;script&gt;/);
});

test('mounted forms restore host drafts and return from confirmation inside the same window',async()=>{
  const h=harness(),draft=h.draft;draft.itemId='gear-a';draft.tab='reroll';draft.scrollTop=123;
  draft.items={'gear-a':{enhance:{mode:'blessed',background:false,target:8},reroll:{background:true,locks:[0],typeLocks:[],functions:['life'],quality:'S',maxGold:'3000'}}};
  const root={innerHTML:'',scrollTop:0,contains:()=>false,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},removeEventListener(){}};
  const mounted=h.api.mount(root,h.host);await new Promise(resolve=>setImmediate(resolve));
  assert.match(root.innerHTML,/value="3000"/);assert.match(root.innerHTML,/value="S" selected/);assert.match(root.innerHTML,/workshopItem/);
  assert.equal(draft.itemId,'gear-a');assert.equal(root.scrollTop,123);
  await mounted.client.preview({kind:'reroll',itemId:'gear-a',background:false,locks:[0]});
  assert.match(root.innerHTML,/data-sw-confirmation/);assert.equal(mounted.handleBack(),true);assert.equal(mounted.handleBack(),false);
  root.scrollTop=177;mounted.dispose();assert.equal(draft.scrollTop,177);
  const second=h.api.mount(root,h.host);await new Promise(resolve=>setImmediate(resolve));assert.equal(root.scrollTop,177);assert.match(root.innerHTML,/value="3000"/);second.dispose();
});

test('explicit item and tab deep links replace an intervening choice while plain reopening preserves form drafts',async()=>{
  const h=harness(action=>action==='me'?me({equipment:[equipment(),equipment({id:'gear-b',name:'另一把調查劍'})]}):undefined);
  const root={innerHTML:'',scrollTop:0,contains:()=>false,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},removeEventListener(){}};
  const first=h.api.mount(root,h.host,{itemId:'gear-a',tab:'enhance'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.draft.itemId,'gear-a');assert.equal(h.draft.tab,'enhance');
  h.draft.itemId='gear-b';h.draft.tab='reroll';
  h.draft.items['gear-b']={enhance:{mode:'blessed',background:false,target:8},reroll:{background:false,locks:[1],typeLocks:[],functions:[],quality:'S',maxGold:'2750'}};
  first.update();first.dispose();
  const plainReopen=h.api.mount(root,h.host);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.draft.itemId,'gear-b');assert.equal(h.draft.tab,'reroll');
  assert.match(root.innerHTML,/<option value="gear-b" selected>/);
  plainReopen.dispose();
  const fromOriginalItem=h.api.mount(root,h.host,{itemId:'gear-a',tab:'enhance'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.draft.itemId,'gear-a');assert.equal(h.draft.tab,'enhance');
  assert.match(root.innerHTML,/<option value="gear-a" selected>/);
  assert.match(root.innerHTML,/data-sw-tab="enhance" aria-pressed="true"/);
  assert.deepEqual(plain(h.draft.items['gear-b'].reroll),{background:false,locks:[1],typeLocks:[],functions:[],quality:'S',maxGold:'2750'});
  fromOriginalItem.dispose();
  const requestedReroll=h.api.mount(root,h.host,{tab:'reroll'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.draft.itemId,'gear-a');assert.equal(h.draft.tab,'reroll');
  assert.match(root.innerHTML,/data-sw-tab="reroll" aria-pressed="true"/);
  assert.ok(h.calls.every(call=>['me','meta','background/status','auto-reroll/options'].includes(call.action)),'opening a destination never starts a forge operation');
  requestedReroll.dispose();h.client.dispose();
});

test('a disposed recovery cannot clear a newer same-scope pending receipt when its background status arrives late',async()=>{
  const api=module(),saved=memoryStorage(),draft={},late=deferred();
  const originalJob=job({id:'job-original',status:'ended',reason:'target',level:8});
  let holdBackground=false,waiting=0;
  const old=harness(action=>{
    if(action==='auto-enhance/start')throw Object.assign(new Error('old start response lost'),{uncertain:true});
    if(action==='auto-enhance/status')return {ok:true,realmId:'permanent',job:originalJob};
    if(action==='background/status'&&holdBackground){waiting++;return late.promise;}
  },{api,storage:saved,draft});
  await old.client.refresh();await old.client.preview(selection({background:true}));await old.client.confirm(true);
  assert.equal(old.client.state.pending.action,'auto-enhance/start');
  holdBackground=true;
  const oldRecovery=old.client.recover();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(waiting,1,'the old recovery must be suspended after its specific status lookup');
  old.client.dispose();old.deactivate();

  const active=harness(action=>{
    if(action==='auto-enhance/status')return {ok:true,realmId:'permanent',job:originalJob};
    if(action==='enhance')throw Object.assign(new Error('new enhancement response lost'),{uncertain:true});
  },{api,storage:saved,draft});
  await active.client.refresh();await active.client.recover();
  assert.equal(active.client.state.pending,null);
  await active.client.preview(selection());await active.client.confirm(true);
  const pending=plain(active.client.state.pending),stored=Array.from(saved.values.entries());
  assert.equal(pending.action,'enhance');assert.ok(pending.payload.requestId);
  assert.deepEqual(plain(draft.pending),pending);
  const changes=active.changes(),calls=active.calls.length;
  late.resolve({ok:true,realmId:'permanent',jobs:[row(originalJob)]});await oldRecovery;
  assert.deepEqual(plain(active.client.state.pending),pending);
  assert.deepEqual(plain(draft.pending),pending,'an old continuation must not erase the shared route draft');
  assert.deepEqual(Array.from(saved.values.entries()),stored,'the new receipt must remain recoverable after another remount');
  assert.equal(old.changes(),0);assert.equal(active.changes(),changes);assert.equal(active.calls.length,calls);
  const reopened=harness(()=>undefined,{api,storage:saved,draft:{}});
  assert.deepEqual(plain(reopened.client.state.pending),pending);
  active.client.dispose();reopened.client.dispose();
});

test('mounted equipment resolves existing art IDs and metadata paths like inventory while unsupported art stays a symbol',async()=>{
  const cases=[
    {name:'plate boots ID',extra:{slot:'boots',art:'boots_plate',source:'starter'},path:'/art/v2/boots_plate.webp'},
    {name:'sword ID',extra:{art:'wpn_sword',source:'elite'},path:'/art/v2/wpn_sword.webp'},
    {name:'explicit src metadata',extra:{art:{src:'/art/v2/helm_plate.webp'}},path:'/art/v2/helm_plate.webp'},
    {name:'explicit path metadata',extra:{art:{path:'/art/v2/wpn_sword.webp'}},path:'/art/v2/wpn_sword.webp'},
    {name:'star-ring art',extra:{art:'boots_plate',source:'star_ring'},path:null},
    {name:'thief art',extra:{art:'boots_leather',classReq:'thief'},path:null},
    {name:'non-ID art',extra:{art:'../boots_plate'},path:null},
    {name:'missing art',extra:{art:null},path:null},
    {name:'malformed metadata',extra:{art:{src:42}},path:null}
  ];
  for(const entry of cases){
    const h=harness(action=>action==='me'?me({equipment:[equipment(entry.extra)]}):undefined),paths=[];
    h.host.artUrl=path=>{paths.push(path);return 'http://127.0.0.1:9692'+path;};
    const root={innerHTML:'',scrollTop:0,contains:()=>false,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},removeEventListener(){}};
    const mounted=h.api.mount(root,h.host,{itemId:'gear-a'});await new Promise(resolve=>setImmediate(resolve));
    if(entry.path){
      assert.ok(paths.length>0,entry.name);assert.ok(paths.every(path=>path===entry.path),entry.name);
      assert.ok(root.innerHTML.includes('src="http://127.0.0.1:9692'+entry.path+'"'),entry.name);
      assert.equal(root.innerHTML.includes('src="http://127.0.0.1:9692boots_plate"'),false);
      assert.equal(root.innerHTML.includes('src="http://127.0.0.1:9692/boots_plate"'),false);
    }else{
      assert.deepEqual(paths,[],entry.name);assert.match(root.innerHTML,/sw-art-empty/,entry.name);
      assert.equal(root.innerHTML.includes('<img class="sw-item-art"'),false,entry.name);
    }
    assert.ok(h.calls.every(call=>['me','meta','background/status'].includes(call.action)));
    mounted.dispose();h.client.dispose();
  }
});
