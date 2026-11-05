import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createLife,advanceLife,addActive,LIFE_MS,CHOICE_MS} from '../public/fate/life.js';

const source = fs.readFileSync(new URL('../public/scene-fate-ui.js',import.meta.url),'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const drain = () => new Promise(resolve => setImmediate(resolve));
const NOW = Date.parse('2026-11-05T02:00:00Z');
const SCOPE = {accountId:'owner',realmId:'permanent',characterId:'actor'};
const original = createLife({version:3,orbit:0,zodiac:null,seed:'1234abcd',startedAt:NOW-1440000});
const completed = advanceLife(original,addActive(original.startedAt,LIFE_MS));
const CODE = completed.code;
function activeLife({draft=original,id='original-life',rev=1,at=NOW}={}) {
  const view = advanceLife(draft,at), slot = view.slots[view.index];
  let storyAt = Math.min(at,view.completed ? view.endAt-1 : at);
  if (view.draft.answers.length > draft.answers.length) storyAt = Math.min(storyAt,addActive(view.slots[draft.answers.length],CHOICE_MS)-1);
  return {id,rev,status:'active',startedAt:draft.startedAt,nextAt:view.nextAt,draft:plain(draft),
    timing:{displayAt:at,storyAt,index:view.index,available:view.available,opensAt:slot??null,deadline:slot?addActive(slot,CHOICE_MS):null,nextAt:view.nextAt,endAt:view.endAt,night:view.night,completionDue:view.completed,settlementPending:view.completed||view.draft.answers.length!==draft.answers.length,persistedAnswerCount:draft.answers.length,projectedAnswerCount:view.draft.answers.length}};
}
function fixture({active=null,at=NOW,revision=1,token='domain-1',phase='ACTIVE',context={},completed:count=0,gifts=[],claimMilestones=[]}={}) {
  const opened = gifts.filter(gift=>gift.status==='opened').length;
  return {ok:true,now:at,...SCOPE,...context,revision,readSequence:0,fate:{
    state:{heroName:'目前英雄',active,completed:count,startedToday:active?1:0,limit:4,night:false,milestone:null,last:null,dmBlocked:false},
    history:{entries:[],next:null,memorials:[],receipts:[]},
    gifts:{name:'四世星輝匣',item:'fate_cycle_gift',interval:4,completed:count,earned:Math.floor(count/4),claimable:claimMilestones.length,unopened:gifts.length-opened,opened,nextIn:4-count%4,pool:[{id:'weapon',chance:5,items:{guaranteed_scroll_w:1}},{id:'armor',chance:5,items:{guaranteed_scroll_a:1}},{id:'scrolls',chance:90,items:{scroll_w:2,scroll_a:2}}],claimMilestones,entries:gifts,nextCursor:null,filter:'claimed'},
    countries:[{id:'TW',name:'臺灣',cityName:'臺北',currency:'TWD'},{id:'JP',name:'日本',cityName:'東京',currency:'JPY'}],
    control:{realmPhase:phase,writable:phase==='ACTIVE',startAllowed:phase==='ACTIVE'&&!active,startBlock:null},
    domain:{version:1,token,life:active?{id:active.id,rev:active.rev,status:'active'}:null,lifeRevision:{count:count+(active?1:0),totalRevision:active?.rev||0,lastStartedAt:active?.startedAt||0,lastCompletedAt:0},completed:count,startedToday:active?1:0,profile:{rev:0,updatedAt:0},daily:{day:'2026-11-05',rev:0,createdAt:0,count:0,totalRevision:0},social:{count:0,totalRevision:0},gifts:{claimed:gifts.length,opened},memorials:{count:0,lastCreatedAt:0},operations:{lifeCount:0,giftCount:0,receiptCount:0}}
  }};
}
const gift = (id='gift-exact',milestone=4,status='claimed') => ({id,milestone,status,createdAt:NOW,openedAt:status==='opened'?NOW:null,items:status==='opened'?{scroll_w:2,scroll_a:2}:null});
function harness(extra={},options={}) {
  let context={...SCOPE,epoch:0,...options.context}, at=NOW, next=0;
  const calls=[],states=[],changed=[],values=options.values||new Map();
  const storage=options.storage||{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  const sandbox={AbortController,URL,console,...extra,...(options.importer?{__fateImport:options.importer}:{})};
  const executable=options.importer?source.replace(/\bimport\(/g,'__fateImport('):source;
  vm.runInNewContext(executable,sandbox,{filename:'scene-fate-ui.js'});
  const host={getContext:()=>context,current:()=>true,now:()=>at,newRequestId:()=> 'sf_test_original_'+(++next),storage,draft:{},actor:{name:'目前英雄'},onState:state=>states.push(plain(state)),onChanged:(value,operation)=>changed.push({value:plain(value),operation:plain(operation)}),
    request:(action,body,options)=>new Promise((resolve,reject)=>calls.push({action,body:plain(body),options,resolve,reject}))};
  return {api:sandbox.RpgSceneFate,host,calls,states,changed,values,storage,create:()=>sandbox.RpgSceneFate.createClient(host),setContext:next=>{context={...context,...next};},advance:ms=>{at+=ms;},getContext:()=>context};
}
function replyScene(call,value=fixture()) { call.resolve({...plain(value),readSequence:call.body.readSequence}); }
async function read(h,c,value=fixture(),query) { const task=c.refresh(query); assert.equal(h.calls.at(-1).action,'fate/scene'); replyScene(h.calls.at(-1),value); assert.equal(await task,true,c.state.error); }
async function lose(h,c,prepare=()=>c.prepareStart('TW',false),error=Error('lost reply')) {
  assert.equal(prepare(),true,c.state.error); const task=c.submit(); assert.equal(h.calls.at(-1).action,'fate/action-scoped'); h.calls.at(-1).reject(error); assert.equal(await task,false); return plain(c.pending());
}
function result(record) {
  if(record.kind==='start')return {lifeId:'original-started-life'};
  if(record.kind==='choice')return {lifeId:record.body.lifeId,index:record.body.index,answer:record.body.answer};
  if(record.kind==='keep')return {saved:true,countsAsLife:false};
  if(record.kind==='gift-claim')return {claimed:record.body.expectedMilestones.length,giftIds:record.body.expectedMilestones.map(n=>'original-gift-'+n),remaining:0};
  return {giftId:record.body.giftId,milestone:4,reward:'scrolls',items:{scroll_w:2,scroll_a:2}};
}
function receipt(record,{found=true,recoveryAllowed=false,revision=1,at=NOW,context={},original=result(record),...extra}={}) {
  const scope={...SCOPE,...context},costs=record.kind==='start'?{dailyStarts:original.already===true?0:1}:record.kind==='gift-open'?{fate_cycle_gift:1}:{};
  return {ok:true,now:at,...scope,revision,kind:record.kind,requestId:record.id,signature:record.signature,found,recoveryAllowed,result:found?plain(original):null,
    receipt:found?{version:1,kind:record.kind,requestId:record.id,requestKey:'scene:app:'+record.id,signature:record.signature,scope,createdAt:NOW,result:plain(original),costs,authority:{table:record.kind.startsWith('gift-')?'rpg_fate_gift_operations':'rpg_fate_operations'},
      ...(record.kind==='gift-claim'?{proof:{completed:record.body.expectedMilestones.at(-1)||0,ownedMilestones:[],milestones:record.body.expectedMilestones}}:{})}:null,...extra};
}
async function check(h,c,record,value=receipt(record),snapshot=fixture()) {
  const task=c.checkPending(record.id); replyScene(h.calls.at(-1),snapshot); await drain(); assert.equal(h.calls.at(-1).action,'fate/receipt'); h.calls.at(-1).resolve(value); return task;
}
const cases=[
  {name:'start false',scene:()=>fixture(),prepare:c=>c.prepareStart('TW',false)},
  {name:'choice 0',scene:()=>fixture({active:activeLife()}),prepare:c=>c.prepareChoice(0,0)},
  {name:'choice 1',scene:()=>fixture({active:activeLife()}),prepare:c=>c.prepareChoice(0,1)},
  {name:'keep',scene:()=>fixture(),prepare:c=>c.prepareKeep(CODE)},
  {name:'claim',scene:()=>fixture({completed:8,claimMilestones:[4,8]}),prepare:c=>c.prepareClaim()},
  {name:'open exact',scene:()=>fixture({completed:8,gifts:[gift('gift-first'),gift('gift-exact',8)]}),prepare:c=>c.prepareOpen('gift-exact')}
];
test('Fate only reads on open/refresh and respects every non-ACTIVE realm',async t=>{
  for(const phase of ['ACTIVE','FROZEN','ARCHIVED','DELETING'])await t.test(phase,async()=>{
    const h=harness(),c=h.create(); await read(h,c,fixture({phase})); await read(h,c,fixture({phase}));
    assert.equal(c.prepareStart('TW',false),phase==='ACTIVE'); c.cancel();
    assert.equal(h.values.size,0);assert.ok(h.calls.every(call=>call.action==='fate/scene'));c.dispose();
  });
});
test('canonical F1 preserves false and zero, exact code/gift and rejects coercion, extras, private data and reordered milestones',()=>{
  const {api}=harness(),start={mode:'random',country:'TW',showSign:false,socialInvite:false},choice={lifeId:'life',index:0,answer:0};
  assert.deepEqual(plain(api.canonical('start',start)),start);assert.deepEqual(plain(api.canonical('choice',choice)),choice);
  assert.equal(api.signature('choice',choice),'{"kind":"choice","lifeId":"life","index":0,"answer":0}');
  assert.equal(api.signature('start',start),'{"kind":"start","mode":"random","country":"TW","showSign":false,"socialInvite":false}');
  for(const [kind,body]of [['start',{...start,showSign:0}],['start',{...start,socialInvite:undefined}],['start',{...start,mode:'birthday'}],['start',{...start,birthDate:'2000-01-01'}],['start',{...start,country:'tw'}],['choice',{...choice,answer:false}],['choice',{...choice,index:'0'}],['choice',{...choice,index:-1}],['choice',{...choice,lifeId:''}],['keep',{code:CODE+' '}],['gift-open',{}],['gift-open',{giftId:'gift',oldest:true}],['gift-claim',{expectedMilestones:[8,4]}],['gift-claim',{expectedMilestones:[4,4]}],['gift-claim',{expectedMilestones:[3]}],['gift-claim',{expectedMilestones:Array.from({length:26},(_,i)=>(i+1)*4)}]])assert.equal(api.canonical(kind,body),null,kind+JSON.stringify(body));
  assert.deepEqual(plain(api.canonical('gift-claim',{expectedMilestones:[]})),{expectedMilestones:[]});
  assert.deepEqual(plain(api.canonical('gift-claim',{expectedMilestones:Array.from({length:25},(_,i)=>(i+1)*4)})).expectedMilestones.length,25);
  assert.equal(api.canonical('choice',{lifeId:'life',index:45,answer:0}).index,45,'original version, not UI hard-coded bounds, is final authority');
});
test('invalid pagination does not coerce false/zero and never starts a request',async()=>{
  const h=harness(),c=h.create();for(const query of [{giftStatus:false},{giftStatus:0},{giftStatus:''},{before:0},{giftAfter:6},{readSequence:0}])assert.equal(await c.refresh(query),false);
  assert.equal(h.calls.length,0);c.dispose();
});
test('latest issued read rejects late snapshots despite equal player revision and token order is never chronology',async()=>{
  const h=harness(),c=h.create(),old=c.refresh(),a=h.calls.at(-1),newer=c.refresh(),b=h.calls.at(-1);
  assert.equal(a.options.signal.aborted,true);replyScene(b,fixture({token:'aaa-new'}));assert.equal(await newer,true);
  replyScene(a,fixture({token:'zzz-old'}));assert.equal(await old,false);assert.equal(c.state.data.fate.domain.token,'aaa-new');
  await read(h,c,fixture({token:'000-even-newer',at:NOW+1}));assert.equal(c.state.revision,1);
  const task=c.refresh();replyScene(h.calls.at(-1),fixture({at:NOW}));assert.equal(await task,false);assert.equal(c.state.data.now,NOW+1);c.dispose();
});
test('unchanged player revision cannot hide active life rollback or suppress domain changes',async()=>{
  const h=harness(),c=h.create();await read(h,c,fixture({active:activeLife({rev:5}),token:'z'}));
  assert.equal(c.prepareChoice(0,0),true);await read(h,c,fixture({active:activeLife({rev:5}),token:'a'}));assert.equal(c.state.confirm,null);
  const task=c.refresh();replyScene(h.calls.at(-1),fixture({active:activeLife({rev:4}),at:NOW+1}));assert.equal(await task,false);assert.equal(c.state.data.fate.state.active.rev,5);
  c.dispose();
});
test('read sequence echo and composite domain consistency are required',async t=>{
  for(const damage of ['echo','life','completed','aggregate'])await t.test(damage,async()=>{
    const h=harness(),c=h.create(),task=c.refresh(),call=h.calls.at(-1),value=fixture({active:activeLife()});value.readSequence=call.body.readSequence;
    if(damage==='echo')value.readSequence--;if(damage==='life')value.fate.domain.life.rev++;if(damage==='completed')value.fate.domain.completed++;if(damage==='aggregate')delete value.fate.domain.lifeRevision;
    call.resolve(value);assert.equal(await task,false);assert.equal(c.state.data,null);c.dispose();
  });
});
test('confirmation captures snapshot and expires at original choice deadline without reroll or retarget',async()=>{
  const h=harness(),c=h.create();await read(h,c,fixture({active:activeLife()}));assert.equal(c.prepareChoice(0,0),true);
  h.advance(CHOICE_MS);assert.equal(c.choiceOpen(),false);assert.equal(await c.submit(),false);assert.equal(h.values.size,0);assert.equal(h.calls.length,1);
  await read(h,c,fixture({active:activeLife({at:NOW+CHOICE_MS}),at:NOW+CHOICE_MS}));assert.equal(c.prepareChoice(0,1),false);c.dispose();
});
test('no gift-open fallback and exact milestone intent is captured without sorting or truncation',async()=>{
  const h=harness(),c=h.create();await read(h,c,fixture({completed:8,gifts:[gift('one',4),gift('two',8)],claimMilestones:[4,8]}));
  assert.equal(c.prepareOpen(undefined),false);assert.equal(c.prepareOpen('foreign'),false);assert.equal(c.prepareOpen('two'),true);assert.equal(c.state.confirm.body.giftId,'two');c.cancel();
  assert.equal(c.prepareClaim(),true);assert.deepEqual(plain(c.state.confirm.body),{expectedMilestones:[4,8]});
  await read(h,c,fixture({completed:12,claimMilestones:[8,12],token:'eligibility-changed'}));assert.equal(c.state.confirm,null);assert.equal(h.calls.filter(call=>call.action==='fate/action-scoped').length,0);c.dispose();
});
test('all F1 intents persist full canonical wire body before POST and remount recovers only immutable original receipt',async t=>{
  for(const row of cases)await t.test(row.name,async()=>{
    const h=harness(),c=h.create();await read(h,c,row.scene());assert.equal(row.prepare(c),true);c.cancel();assert.equal(h.values.size,0);
    const record=await lose(h,c,()=>row.prepare(c));assert.deepEqual(record.wireBody,{kind:record.kind,...record.body,realmId:'permanent',selectedCharacterId:'actor'});
    assert.equal(record.signature,h.api.signature(record.kind,record.body));assert.deepEqual(h.calls.at(-1).body,record.wireBody);assert.equal(h.changed.length,0);
    const raw=[...h.values.values()][0];c.dispose();const remount=h.create();assert.deepEqual(plain(remount.pending()),record);
    assert.equal(await check(h,remount,record,receipt(record),row.scene()),true,remount.state.error);assert.equal([...h.values.values()][0],raw);
    assert.equal(h.calls.filter(call=>call.action==='fate/action-scoped').length,1);
    const snapshot=plain(remount.state.data);assert.equal(remount.acknowledge(record.id),true);assert.equal(h.values.size,0);assert.equal(h.calls.at(-1).action,'fate/scene');
    assert.deepEqual(plain(remount.state.data),snapshot,'receipt never replaces evolving scene');replyScene(h.calls.at(-1),row.scene());await drain();assert.equal(h.changed.length,1);remount.dispose();
  });
});
test('write failure or failed storage readback never sends an unrecorded operation',async t=>{
  for(const mode of ['throw','replace','unavailable'])await t.test(mode,async()=>{
    const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(mode==='throw')throw Error('quota');values.set(key,mode==='replace'?'corrupt':value);},removeItem:key=>values.delete(key)};
    if(mode==='unavailable')storage.getItem=()=>{throw Error('denied');};
    const h=harness({}, {storage,values}),c=h.create();await read(h,c);if(mode==='unavailable')assert.equal(c.prepareStart('TW',false),false);else{assert.equal(c.prepareStart('TW',false),true);assert.equal(await c.submit(),false);}
    assert.equal(h.calls.filter(call=>call.action==='fate/action-scoped').length,0);assert.ok(c.state.storageError);if(mode==='replace')assert.equal([...values.values()][0],'corrupt');c.dispose();
  });
});
test('corrupt raw pending is never overwritten or removed, while remembered original remains readable',async()=>{
  const h=harness(),c=h.create();await read(h,c);const record=await lose(h,c),key=[...h.values.keys()][0],raw=h.values.get(key);
  h.values.set(key,'{"partial":');assert.equal(c.pending().id,record.id);assert.ok(c.state.storageError);assert.equal(c.markRevealed(record.id),false);assert.equal(c.prepareStart('TW',false),false);
  assert.equal(await check(h,c,record),true);assert.equal(c.acknowledge(record.id),false);assert.equal(c.prepareRecovery(record.id),false);assert.equal(h.values.get(key),'{"partial":');
  c.dispose();const mounted=h.create();assert.equal(mounted.pending(),null);assert.ok(mounted.state.storageError);h.values.set(key,raw);assert.equal(mounted.pending().id,record.id);mounted.dispose();
});
test('matching full receipt required: wrong scope, ID, signature, original result, costs and claim proof stay pending',async t=>{
  for(const damage of ['scope','id','signature','result-copy','costs','result-body','claim-proof'])await t.test(damage,async()=>{
    const h=harness(),c=h.create(),isClaim=damage==='claim-proof',snapshot=isClaim?fixture({completed:4,claimMilestones:[4]}):fixture({active:activeLife()});
    await read(h,c,snapshot);const record=await lose(h,c,()=>isClaim?c.prepareClaim():c.prepareChoice(0,0)),value=receipt(record);
    if(damage==='scope')value.receipt.scope.characterId='other';if(damage==='id')value.receipt.requestId='different_original';if(damage==='signature')value.receipt.signature+=' ';
    if(damage==='result-copy')value.receipt.result.extra=true;if(damage==='costs')value.receipt.costs.gold=1;
    if(damage==='result-body'){value.result.answer=1;value.receipt.result.answer=1;}if(damage==='claim-proof')value.receipt.proof.milestones=[8];
    assert.equal(await check(h,c,record,value,snapshot),false);assert.equal(c.acknowledge(record.id),false);assert.equal(c.prepareRecovery(record.id),false);assert.equal(c.pending().id,record.id);c.dispose();
  });
});
test('partial authoritative operation never grants recovery; miss permits only explicit exact-ID same-body retry',async t=>{
  for(const recoveryAllowed of [false,true])await t.test(String(recoveryAllowed),async()=>{
    const h=harness(),c=h.create();await read(h,c);const record=await lose(h,c),wire=plain(h.calls.at(-1).body);
    assert.equal(await check(h,c,record,receipt(record,{found:false,recoveryAllowed})),true);assert.equal(h.calls.filter(call=>call.action==='fate/action-scoped').length,1);
    assert.equal(c.prepareRecovery(record.id),recoveryAllowed);
    if(recoveryAllowed){const task=c.submit(),call=h.calls.at(-1);assert.deepEqual(call.body,wire);call.resolve(receipt(record));await drain();assert.equal(h.calls.at(-1).action,'fate/scene');replyScene(h.calls.at(-1));assert.equal(await task,true);assert.equal(c.state.lastResult.id,record.id);}
    c.dispose();
  });
});
test('prior missing receipt cannot authorize recovery after canonical pending intent changes',async()=>{
  const h=harness(),c=h.create();await read(h,c);const record=await lose(h,c);await check(h,c,record,receipt(record,{found:false,recoveryAllowed:true}));
  const changed=plain(record);changed.body.showSign=true;changed.wireBody.showSign=true;changed.signature=h.api.signature(changed.kind,changed.body);h.values.set([...h.values.keys()][0],JSON.stringify(changed));
  assert.equal(c.prepareRecovery(record.id),false);assert.equal(c.pending().body.showSign,true);assert.equal(h.calls.filter(call=>call.action==='fate/action-scoped').length,1);c.dispose();
});
test('A/B/A epoch and dispose invalidate late read, mutation and receipt without clearing durable intent',async t=>{
  for(const kind of ['read','action','receipt','disposed'])await t.test(kind,async()=>{
    const h=harness(),c=h.create();await read(h,c);let task,call,record;
    if(kind==='read'){task=c.refresh();call=h.calls.at(-1);}
    else if(kind==='action'||kind==='disposed'){assert.equal(c.prepareStart('TW',false),true);task=c.submit();call=h.calls.at(-1);record=plain(c.pending());}
    else {record=await lose(h,c);task=c.checkPending(record.id);replyScene(h.calls.at(-1));await drain();call=h.calls.at(-1);}
    const states=h.states.length;
    if(kind==='disposed')c.dispose();else{h.setContext({realmId:'season',characterId:'other',epoch:1});h.setContext({...SCOPE,epoch:2});}
    if(kind==='read')replyScene(call,fixture({token:'late'}));else call.resolve(receipt(record));
    assert.equal(await task,false);assert.equal(h.states.length,states);assert.equal(h.changed.length,0);if(record)assert.equal([...h.values.values()][0],JSON.stringify(record));c.dispose();
  });
});
test('late acknowledgement cannot delete a newer record with reused ID but changed canonical payload',async()=>{
  const h=harness(),c=h.create();await read(h,c);assert.equal(c.prepareStart('TW',false),true);const task=c.submit(),record=plain(c.pending()),call=h.calls.at(-1),changed=plain(record);
  changed.body.showSign=true;changed.wireBody.showSign=true;changed.signature=h.api.signature(changed.kind,changed.body);h.values.set([...h.values.keys()][0],JSON.stringify(changed));
  call.resolve(receipt(record));assert.equal(await task,false);assert.deepEqual(plain(c.pending()),changed);assert.equal(h.changed.length,0);c.dispose();
});
test('history receipt is pure and does not clear unrelated pending; app namespace and captured scope are enforced',async()=>{
  const h=harness(),c=h.create();await read(h,c);const pending=await lose(h,c),historical={...pending,id:'sf_historical_only',body:{...pending.body,requestId:'sf_historical_only'}},snapshot=fixture();
  snapshot.fate.history.receipts=[{version:1,kind:historical.kind,requestKey:'scene:app:'+historical.id,signature:historical.signature,scope:SCOPE,createdAt:NOW}];await read(h,c,snapshot);
  assert.equal(await c.readHistoryReceipt('scene:service:'+historical.id),false);
  const task=c.readHistoryReceipt('scene:app:'+historical.id);assert.equal(h.calls.at(-1).action,'fate/receipt');h.calls.at(-1).resolve(receipt(historical));assert.equal(await task,true);
  assert.deepEqual(plain(c.pending()),pending);assert.equal(c.state.historyReceipt.id,historical.id);assert.equal(h.changed.length,0);
  const late=c.readHistoryReceipt('scene:app:'+historical.id),call=h.calls.at(-1);h.setContext({characterId:'other',epoch:1});h.setContext({...SCOPE,epoch:2});call.resolve(receipt(historical));assert.equal(await late,false);c.dispose();
});
test('Atlas player revision cannot make stale Fate actions writable before fresh domain read',async()=>{
  const h=harness(),c=h.create();await read(h,c);assert.equal(c.prepareStart('TW',false),true);c.update({...SCOPE,revision:2});assert.equal(c.state.confirm,null);assert.equal(c.state.stale,true);assert.equal(h.calls.at(-1).action,'fate/scene');
  replyScene(h.calls.at(-1),fixture({revision:1}));await drain();assert.equal(c.prepareStart('TW',false),false);await read(h,c,fixture({revision:2,token:'new'}));assert.equal(c.prepareStart('TW',false),true);c.dispose();
});

class FateRoot {
  constructor() {
    this.isConnected=true;this.scrollTop=0;this.reveals=0;this.focuses=[];this.controls=[];this.panels=[];this.events=new Map();this.html='';this.visibility=new Map();this.countdown={textContent:''};
    this.ownerDocument={body:{kind:'body'},hidden:false,baseURI:'http://127.0.0.1/scene/',head:{append(){}},createElement(){return {setAttribute(){}};},addEventListener:(name,fn)=>this.visibility.set(name,fn),removeEventListener:name=>this.visibility.delete(name)};this.ownerDocument.activeElement=this.ownerDocument.body;
  }
  contains(node){return node?.root===this&&this.controls.includes(node);}
  addEventListener(name,fn){this.events.set(name,fn);}removeEventListener(name){this.events.delete(name);}
  get innerHTML(){return this.html;}
  set innerHTML(html){
    if(this.contains(this.ownerDocument.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;
    this.html=html;this.controls=[];this.panels=[];
    for(const match of html.matchAll(/<section[^>]*data-sf-pending[^>]*>/g))this.panels.push({start:match.index,end:html.indexOf('</section>',match.index),scrollIntoView:()=>{this.reveals++;this.scrollTop=0;}});
    for(const match of html.matchAll(/<(button|input|select|textarea)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)){
      const attributes=match[2],dataset={};for(const attribute of attributes.matchAll(/\bdata-([a-z0-9-]+)="([^"]*)"/g))dataset[attribute[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=attribute[2];
      const root=this,panel=this.panels.find(value=>match.index>value.start&&match.index<value.end);
      this.controls.push({root,dataset,tagName:match[1].toUpperCase(),value:attributes.match(/value="([^"]*)"/)?.[1]||'',checked:/(?:^|\s)checked(?:\s|$)/.test(attributes),disabled:/(?:^|\s)disabled(?:\s|$)/.test(attributes),selectionStart:null,selectionEnd:null,
        setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
        closest(selector){return selector==='[data-sf-action]'?this:selector==='[data-sf-pending]'?panel:null;},
        focus(){if(!this.disabled){root.ownerDocument.activeElement=this;root.focuses.push({...dataset});}}
      });
    }
  }
  querySelectorAll(selector){
    if(selector==='button,input,select,textarea')return this.controls;
    const action=selector.match(/^\[data-sf-action="([^"]+)"\]$/)?.[1];return action?this.controls.filter(control=>control.dataset.sfAction===action):[];
  }
  querySelector(selector){
    if(selector==='[data-sf-confirm]')return this.html.includes('data-sf-confirm')?{scrollIntoView(){}}:null;
    if(selector==='[data-sf-countdown]')return this.html.includes('data-sf-countdown')?this.countdown:null;
    return this.querySelectorAll(selector)[0]||null;
  }
  button(action,fields={}){return this.controls.find(control=>control.dataset.sfAction===action&&Object.entries(fields).every(([field,value])=>control.dataset[field]===String(value)));}
  field(name){return this.controls.find(control=>control.dataset.sfField===name);}
  async click(action,fields={}){const target=this.button(action,fields);assert.ok(target,'missing control '+action);if(!target.disabled)target.focus();return this.events.get('click')?.({target});}
}
async function mountHarness(data=fixture(),options={},params={}){
  const frames=new Map(),intervals=new Map();let next=0;
  const h=harness({requestAnimationFrame(fn){const id=++next;frames.set(id,{fn,cancelled:false});return id;},cancelAnimationFrame(id){if(frames.has(id))frames.get(id).cancelled=true;},setInterval(fn,ms){const id=++next;intervals.set(id,{fn,ms});return id;},clearInterval(id){intervals.delete(id);},...(options.scriptUrl?{document:{currentScript:{src:options.scriptUrl}}}:{})},options);
  if(!options.importer)h.host.story=options.story||await import('../public/scene-fate-story.js');
  const root=new FateRoot();if(options.baseURI)root.ownerDocument.baseURI=options.baseURI;if(options.documentURL)root.ownerDocument.location={href:options.documentURL};
  const view=h.api.mount(root,h.host,params);replyScene(h.calls.at(-1),data);await drain();await drain();
  return {h,root,view,frames,intervals,flush(ignoreCancel=false){const batch=[...frames.values()];frames.clear();for(const frame of batch)if(ignoreCancel||!frame.cancelled)frame.fn();}};
}
test('mount uses one window; pure visibility/15-second refresh never starts life, claim or opening and dispose cleans up',async()=>{
  const m=await mountHarness();assert.equal((m.root.html.match(/class="sf-window"/g)||[]).length,1);assert.equal(m.root.field('showSign').checked,true);
  assert.equal(m.root.button('start').disabled,false);assert.ok(!/iframe|fate\/me|fate\/state/.test(m.root.html));
  m.intervals.forEach(({fn,ms})=>{if(ms===15000)fn();});assert.equal(m.h.calls.at(-1).action,'fate/scene');replyScene(m.h.calls.at(-1));await drain();
  m.root.visibility.get('visibilitychange')();replyScene(m.h.calls.at(-1));await drain();assert.ok(m.h.calls.every(call=>call.action==='fate/scene'));
  m.view.dispose();assert.equal(m.intervals.size,0);assert.equal(m.root.visibility.size,0);assert.equal(m.root.events.size,0);
});
test('choice zero confirmation focuses cancel and returns focus to the exact original answer without mutation',async()=>{
  const m=await mountHarness(fixture({active:activeLife()}),{}, {tab:'current'});assert.ok(m.root.button('choice',{sfAnswer:0}),'original story must load');
  await m.root.click('choice',{sfIndex:0,sfAnswer:0});assert.equal(m.root.ownerDocument.activeElement.dataset.sfAction,'cancel');
  assert.equal(m.view.client.state.confirm.body.answer,0);assert.equal(m.view.client.state.confirm.body.index,0);
  await m.root.click('cancel');assert.deepEqual(m.root.ownerDocument.activeElement.dataset,{sfAction:'choice',sfIndex:'0',sfAnswer:'0'});assert.equal(m.h.values.size,0);assert.equal(m.h.calls.length,1);
  m.h.advance(CHOICE_MS);m.intervals.forEach(({fn,ms})=>{if(ms===1000)fn();});assert.equal(m.root.button('choice',{sfAnswer:0}).disabled,true);m.view.dispose();
});
test('unknown pending auto-reveal focuses safe receipt check once, survives remount, and never auto-retries',async()=>{
  const m=await mountHarness();await m.root.click('start');const task=m.root.click('confirm');m.h.calls.at(-1).reject(Error('lost reply'));await task;
  const record=m.view.client.pending();m.flush();assert.equal(m.root.ownerDocument.activeElement.dataset.sfAction,'check-pending');assert.equal(m.root.reveals,1);assert.equal(m.view.client.pending().revealed,true);
  m.view.dispose();const mounted=await mountHarness(fixture(),{values:m.h.values});mounted.flush();assert.equal(mounted.root.reveals,0);assert.equal(mounted.h.calls.length,1);assert.equal(mounted.view.client.pending().id,record.id);mounted.view.dispose();
});
test('queued pending focus never steals focus from a new interaction, hidden document or ABA context',async t=>{
  for(const reason of ['interaction','hidden','aba','dispose'])await t.test(reason,async()=>{
    const m=await mountHarness();await m.root.click('start');const task=m.root.click('confirm');m.h.calls.at(-1).reject(Error('lost'));await task;assert.ok(m.frames.size);
    const focused=m.root.focuses.length;
    if(reason==='interaction')m.root.button('tab',{sfTab:'history'}).focus();
    if(reason==='hidden')m.root.ownerDocument.hidden=true;
    if(reason==='aba'){m.h.setContext({characterId:'other',epoch:1});m.h.setContext({...SCOPE,epoch:2});}
    if(reason==='dispose')m.view.dispose();
    m.flush(true);assert.equal(m.root.reveals,0);assert.equal(m.root.focuses.length,focused+(reason==='interaction'?1:0));m.view.dispose();
  });
});
test('late async original story load cannot repaint disposed or changed context',async()=>{
  let release;const promise=new Promise(resolve=>{release=resolve;}),original=await import('../public/scene-fate-story.js'),model=await original.projectCurrent(activeLife());
  const m=await mountHarness(fixture({active:activeLife()}),{story:{...original,projectCurrent:()=>promise}},{tab:'current'}),before=m.root.html;
  m.h.setContext({characterId:'other',epoch:1});m.h.setContext({...SCOPE,epoch:2});release(model);await drain();assert.equal(m.root.html,before);m.view.dispose();
});
test('receipt result with extra fields, absent authority or future timestamp is not acknowledged',async t=>{
  for(const damage of ['extra-result','missing-authority','future'])await t.test(damage,async()=>{
    const h=harness(),c=h.create();await read(h,c);const record=await lose(h,c),value=receipt(record);
    if(damage==='extra-result'){value.result.seed='not-original';value.receipt.result.seed='not-original';}
    if(damage==='missing-authority')delete value.receipt.authority;
    if(damage==='future')value.receipt.createdAt=NOW+1;
    assert.equal(await check(h,c,record,value),false);assert.equal(c.acknowledge(record.id),false);assert.equal(c.pending().id,record.id);c.dispose();
  });
});
test('pending private extras and malformed revealed flags are corrupt and preserved byte for byte',async t=>{
  for(const extra of [{birthDate:'2000-01-01'},{revealed:'yes'}])await t.test(Object.keys(extra)[0],async()=>{
    const h=harness(),c=h.create();await read(h,c);const record=await lose(h,c),key=[...h.values.keys()][0],raw=JSON.stringify({...record,...extra});h.values.set(key,raw);c.dispose();
    const remount=h.create();assert.equal(remount.pending(),null);assert.ok(remount.state.storageError);assert.equal(remount.markRevealed(record.id),false);assert.equal(h.values.get(key),raw);remount.dispose();
  });
});

test('verified immutable receipt remains acknowledgeable after pure refresh raises observation time or revision',async t=>{
  for(const update of [{name:'time',at:NOW+15000,revision:1},{name:'revision',at:NOW,revision:2},{name:'both',at:NOW+15000,revision:2}])await t.test(update.name,async()=>{
    const h=harness(),c=h.create();await read(h,c);const record=await lose(h,c),originalReceipt=receipt(record);
    assert.equal(await check(h,c,record,originalReceipt),true);
    const newer=fixture({at:update.at,revision:update.revision,active:activeLife({id:'new-current-life',rev:7,at:update.at}),token:'new-current-domain'});
    await read(h,c,newer);const snapshot=plain(c.state.data),pendingRaw=[...h.values.values()][0],calls=h.calls.length;
    assert.deepEqual(plain(c.state.receipt),originalReceipt,'pure refresh retains the already checked original receipt');
    assert.equal(c.acknowledge(record.id),true,'immutable original result remains valid after background read');
    assert.equal(h.values.size,0);assert.notEqual(pendingRaw,undefined);assert.deepEqual(plain(c.state.data),snapshot,'acknowledgement must not roll back current life or domain');
    assert.equal(c.state.revision,update.revision);assert.equal(c.state.minObservedAt,update.at);assert.equal(c.state.lastResult.id,record.id);
    assert.deepEqual(plain(c.state.lastResult.result),originalReceipt.result);assert.equal(h.changed.length,1);assert.equal(h.changed[0].operation.acknowledged,true);
    assert.equal(h.calls.length,calls+1);assert.equal(h.calls.at(-1).action,'fate/scene');assert.equal(h.calls.filter(call=>call.action==='fate/action-scoped').length,1,'ack never resends');
    replyScene(h.calls.at(-1),newer);await drain();assert.deepEqual(plain(c.state.data.fate),snapshot.fate);c.dispose();
  });
});
test('new receipt network replies still require current observation/revision floors',async()=>{
  const h=harness(),c=h.create();await read(h,c);const record=await lose(h,c),newer=fixture({at:NOW+15000,revision:2,token:'new-current-domain'});
  await read(h,c,newer);assert.equal(await check(h,c,record,receipt(record),newer),false);
  assert.equal(c.state.receipt,null);assert.equal(c.acknowledge(record.id),false);assert.equal(c.pending().id,record.id);assert.equal(h.changed.length,0);assert.equal(c.state.data.now,NOW+15000);c.dispose();
});
test('acknowledgement after newer scene still rejects altered receipt scope and changed durable intent',async t=>{
  for(const damage of ['top-scope','nested-scope','pending'])await t.test(damage,async()=>{
    const h=harness(),c=h.create();await read(h,c);const record=await lose(h,c);assert.equal(await check(h,c,record),true);
    await read(h,c,fixture({at:NOW+15000,revision:2,token:'newer'}));
    if(damage==='top-scope')c.state.receipt.characterId='other';
    if(damage==='nested-scope')c.state.receipt.receipt.scope.characterId='other';
    if(damage==='pending'){const changed=plain(record);changed.body.showSign=true;changed.wireBody.showSign=true;changed.signature=h.api.signature(changed.kind,changed.body);h.values.set([...h.values.keys()][0],JSON.stringify(changed));}
    assert.equal(c.acknowledge(record.id),false);assert.equal(h.values.size,1);assert.equal(h.changed.length,0);assert.equal(h.calls.filter(call=>call.action==='fate/action-scoped').length,1);c.dispose();
  });
});

test('story and private dynamic entries stay at current document origin root from nested virtual HUD and ordinary paths',async t=>{
  const entries=['/scene-fate-story.js?v=fate-f1-20261105','/scene-fate-private-ui.js?v=fate-f2-20261105'];
  assert.equal((source.match(/\bimport\(/g)||[]).length,entries.length,'the import trap observes exactly the story and private entry sites');
  assert.deepEqual([...source.matchAll(/\bimport\(new URL\('([^']+)'/g)].map(match=>match[1]),entries,'only the two expected root module entries are imported');
  const originalStory=await import('../public/scene-fate-story.js');
  for(const row of [
    {name:'nested virtual HUD',scriptUrl:'https://game.example/ui-generated-20261030/hud-angels-20261102/scene-fate-ui.js?v=old',documentURL:'https://game.example/ui-generated-20261030/preview.html',baseURI:'https://game.example/ui-generated-20261030/preview.html'},
    {name:'root script',scriptUrl:'https://game.example/scene-fate-ui.js',documentURL:'https://game.example/scene/',baseURI:'https://game.example/scene/'},
    {name:'no currentScript',documentURL:'https://game.example/ui-generated-20261030/preview.html',baseURI:'https://game.example/ui-generated-20261030/preview.html'},
    {name:'document origin wins over foreign asset base',scriptUrl:'https://asset.example/scene-fate-ui.js',documentURL:'https://game.example/ui-generated-20261030/preview.html',baseURI:'https://asset.example/assets/'}
  ])await t.test(row.name,async()=>{
    const imports=[],m=await mountHarness(fixture({active:activeLife()}),{...row,importer:url=>{imports.push(url);return Promise.resolve(originalStory);}},{tab:'current'});
    assert.deepEqual(imports,['https://game.example/scene-fate-story.js?v=fate-f1-20261105']);
    for(const name of ['life','cycles','model','formal-events','event-catalog-v1','ending-story','ending-timeline','locality-ui','country-runtime-v9'])assert.equal(new URL('./fate/'+name+'.js',imports[0]).href,'https://game.example/fate/'+name+'.js');
    assert.ok(m.root.button('choice',{sfIndex:0,sfAnswer:0}),'actual original story projects after canonical entry');
    assert.equal(m.h.calls.length,1);assert.equal(m.h.calls[0].action,'fate/scene');m.view.dispose();
    const privateImports=[],privateApi={mount(){return {client:{state:{busy:false}},dispose(){}};}};
    const privateView=await mountHarness(fixture(),{...row,importer:url=>{privateImports.push(url);return Promise.resolve(privateApi);}},{section:'private'});
    assert.deepEqual(privateImports,['https://game.example/scene-fate-private-ui.js?v=fate-f2-20261105']);
    assert.equal(privateView.h.calls.length,1);assert.equal(privateView.h.calls[0].action,'fate/scene');privateView.view.dispose();
  });
});
test('dynamic story import failure uses clear Chinese retry and preserves the same life without exposing internal URL',async()=>{
  const originalStory=await import('../public/scene-fate-story.js'),imports=[];let fail=true;
  const m=await mountHarness(fixture({active:activeLife()}),{scriptUrl:'https://game.example/ui-generated-20261030/hud-angels-20261102/scene-fate-ui.js',documentURL:'https://game.example/ui-generated-20261030/preview.html',importer:url=>{imports.push(url);return fail?Promise.reject(Error('Failed to fetch dynamically imported module: '+url)):Promise.resolve(originalStory);}},{tab:'current'});
  assert.match(m.root.html,/原故事暫時無法載入/);assert.ok(m.root.button('retry-story'));assert.doesNotMatch(m.root.html,/Failed to fetch|dynamically imported|https:\/\/game\.example/);
  const before=plain(m.view.client.state.data.fate.state.active);fail=false;await m.root.click('retry-story');await drain();await drain();
  assert.equal(imports.length,2);assert.equal(imports[0],imports[1]);assert.ok(m.root.button('choice',{sfIndex:0,sfAnswer:0}));assert.deepEqual(plain(m.view.client.state.data.fate.state.active),before);
  assert.equal(m.h.calls.length,1);assert.equal(m.h.values.size,0);m.view.dispose();
});
